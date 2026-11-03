-- Aprova Luvi — Módulo 4, migration D2/2: aprovação por link rápido (sem login).
--
-- Fluxo (tudo executado pelo SERVIDOR com service_role; o navegador nunca fala com o banco):
--   1. link_resolve        — o token (hash) existe e está utilizável? (nada do material é mostrado ainda)
--   2. link_issue_code     — gera um código temporário de 6 dígitos (só o HMAC dele é guardado) para o e-mail
--                            do aprovador; limites: 1 a cada 60 s, 5 por hora, validade de 10 min
--   3. link_verify_code    — confere o código (máx. 5 tentativas por código); em caso de acerto cria uma
--                            SESSÃO curta (hash do identificador do cookie), válida por 30 min
--   4. link_session_context— valida token + sessão e devolve a identidade/escopo do link
--   5. decide_with_link_session — ÚNICO caminho de decisão por link; revalida tudo sob bloqueio.
-- A função antiga decide_via_link (que decidia sem exigir verificação) deixa de existir.
-- Tentativas erradas NÃO levantam exceção (a exceção desfaria o contador): devolvem um status.

-- Um link só vale para a SOLICITAÇÃO do próprio aprovador (a solicitação é individual).
create or replace function public.create_approval_link(
  p_request_id uuid,
  p_approver_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_id uuid;
begin
  select * into r from public.approval_requests where id = p_request_id;
  if not found or auth.uid() is null or not app.staff_can_access(r.client_id) then
    raise exception 'sem permissão';
  end if;
  perform 1 from public.materials where id = r.material_id for update;
  select * into r from public.approval_requests where id = p_request_id for update;
  if r.status <> 'aberta' then
    raise exception 'a solicitação não está aberta';
  end if;
  if r.approver_id is distinct from p_approver_id or not exists (
    select 1 from public.approvers a
    where a.id = p_approver_id and a.client_id = r.client_id and a.active
  ) then
    raise exception 'aprovador inválido para esta solicitação';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'a validade do link deve estar entre agora e 30 dias';
  end if;

  -- Reemissão: o link anterior (ainda aberto) é revogado; só um link ativo por solicitação.
  update public.approval_links set revoked_at = now(), revoked_by = auth.uid()
    where request_id = r.id and revoked_at is null and used_at is null;

  insert into public.approval_links (request_id, client_id, approver_id, token_hash, expires_at, created_by)
  values (r.id, r.client_id, p_approver_id, p_token_hash, p_expires_at, auth.uid())
  returning id into v_id;

  perform app.write_audit(r.client_id, auth.uid(), null, 'approval_link.created', 'approval_link', v_id,
                          jsonb_build_object('approver_id', p_approver_id, 'request_id', r.id,
                                             'material_id', r.material_id, 'version_id', r.version_id,
                                             'expires_at', p_expires_at));
  return v_id;
end;
$$;

create or replace function public.revoke_approval_link(p_link_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.approval_links;
begin
  select * into l from public.approval_links where id = p_link_id;
  if not found or auth.uid() is null or not app.staff_can_access(l.client_id) then
    raise exception 'sem permissão';
  end if;
  update public.approval_links
    set revoked_at = now(), revoked_by = auth.uid()
    where id = l.id and revoked_at is null;
  perform app.write_audit(l.client_id, auth.uid(), null, 'approval_link.revoked', 'approval_link', l.id,
                          jsonb_build_object('request_id', l.request_id, 'approver_id', l.approver_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Estado de um link (interno)
-- ---------------------------------------------------------------------------
create function app.link_state(p_link_id uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when l.id is null then 'invalid'
    when l.revoked_at is not null then 'revoked'
    when l.used_at is not null then 'used'
    when l.expires_at <= now() then 'expired'
    when r.status <> 'aberta' or m.status <> 'aguardando'
         or v.number is distinct from (select max(x.number) from public.material_versions x where x.material_id = r.material_id)
         or not exists (
           select 1 from public.approvers a join public.clients c on c.id = a.client_id
           where a.id = l.approver_id and a.client_id = l.client_id and a.active and c.active
         ) then 'closed'
    else 'ok'
  end
  from (select 1) one
  left join public.approval_links l on l.id = p_link_id
  left join public.approval_requests r on r.id = l.request_id
  left join public.materials m on m.id = r.material_id
  left join public.material_versions v on v.id = r.version_id;
$$;
revoke execute on function app.link_state(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Resolver o link (antes de qualquer verificação: não mostra nada do material)
-- ---------------------------------------------------------------------------
create function public.link_resolve(p_token_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.approval_links;
  v_state text;
  v_email text;
  v_client text;
begin
  select * into l from public.approval_links where token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_state := app.link_state(l.id);
  if v_state <> 'ok' then
    return jsonb_build_object('status', v_state);
  end if;
  select a.email, c.name into v_email, v_client
    from public.approvers a join public.clients c on c.id = a.client_id where a.id = l.approver_id;
  return jsonb_build_object(
    'status', 'ok',
    'client_name', v_client,
    'email_hint', left(v_email, 1) || '***@' || split_part(v_email, '@', 2)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Emitir código de verificação
-- ---------------------------------------------------------------------------
create function public.link_issue_code(p_token_hash text, p_code_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.approval_links;
  v_state text;
  v_email text;
  v_name text;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'código inválido';
  end if;
  select * into l from public.approval_links where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_state := app.link_state(l.id);
  if v_state <> 'ok' then
    return jsonb_build_object('status', v_state);
  end if;
  if exists (select 1 from public.approval_verifications v where v.link_id = l.id and v.created_at > now() - interval '60 seconds') then
    return jsonb_build_object('status', 'cooldown');
  end if;
  if (select count(*) from public.approval_verifications v where v.link_id = l.id and v.created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('status', 'limit');
  end if;
  -- Só o código mais recente vale.
  update public.approval_verifications set expires_at = now()
    where link_id = l.id and consumed_at is null and expires_at > now();
  insert into public.approval_verifications (link_id, code_hash, expires_at)
    values (l.id, p_code_hash, now() + interval '10 minutes');
  select a.email, a.name into v_email, v_name from public.approvers a where a.id = l.approver_id;
  return jsonb_build_object('status', 'ok', 'email', v_email, 'approver_name', v_name, 'link_id', l.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Conferir o código e abrir a sessão
-- ---------------------------------------------------------------------------
create function public.link_verify_code(p_token_hash text, p_code_hash text, p_session_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.approval_links;
  v public.approval_verifications;
  v_state text;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' or p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'dados inválidos';
  end if;
  select * into l from public.approval_links where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_state := app.link_state(l.id);
  if v_state <> 'ok' then
    return jsonb_build_object('status', v_state);
  end if;
  select * into v from public.approval_verifications
    where link_id = l.id and consumed_at is null and expires_at > now()
    order by created_at desc limit 1 for update;
  if not found then
    return jsonb_build_object('status', 'no_code');
  end if;
  if v.attempts >= 5 then
    return jsonb_build_object('status', 'locked');
  end if;
  update public.approval_verifications set attempts = attempts + 1 where id = v.id;
  if v.code_hash <> p_code_hash then
    return jsonb_build_object('status', 'invalid_code', 'remaining', 4 - v.attempts);
  end if;
  update public.approval_verifications set consumed_at = now() where id = v.id;
  insert into public.approval_link_sessions (link_id, session_hash, expires_at)
    values (l.id, p_session_hash, now() + interval '30 minutes');
  perform app.write_audit(l.client_id, null, l.approver_id, 'approval_link.verified', 'approval_link', l.id,
                          jsonb_build_object('request_id', l.request_id));
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Contexto da sessão (token + sessão válidos => identidade e escopo)
-- ---------------------------------------------------------------------------
create function public.link_session_context(p_token_hash text, p_session_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.approval_links;
  r public.approval_requests;
  v_state text;
  v_name text;
begin
  select * into l from public.approval_links where token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_state := app.link_state(l.id);
  if v_state <> 'ok' then
    return jsonb_build_object('status', v_state);
  end if;
  if p_session_hash is null or not exists (
    select 1 from public.approval_link_sessions s
    where s.link_id = l.id and s.session_hash = p_session_hash and s.expires_at > now()
  ) then
    return jsonb_build_object('status', 'no_session');
  end if;
  select * into r from public.approval_requests where id = l.request_id;
  select a.name into v_name from public.approvers a where a.id = l.approver_id;
  return jsonb_build_object(
    'status', 'ok', 'link_id', l.id, 'request_id', r.id, 'material_id', r.material_id,
    'version_id', r.version_id, 'client_id', r.client_id, 'approver_id', l.approver_id,
    'approver_name', v_name, 'due_at', r.due_at, 'message', r.message
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Decisão por link (único caminho)
-- ---------------------------------------------------------------------------
drop function public.decide_via_link(uuid, public.decision_kind, text, text, text);

create function public.decide_with_link_session(
  p_token_hash text,
  p_session_hash text,
  p_decision public.decision_kind,
  p_note text default '',
  p_ip_hash text default null,
  p_user_agent text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.approval_links;
  r public.approval_requests;
  v_state text;
begin
  select * into l from public.approval_links where token_hash = p_token_hash;
  if not found then
    raise exception 'link inválido';
  end if;
  select * into r from public.approval_requests where id = l.request_id;
  -- Ordem de bloqueio global: material, solicitação, link.
  perform 1 from public.materials where id = r.material_id for update;
  perform 1 from public.approval_requests where id = r.id for update;
  select * into l from public.approval_links where id = l.id for update;
  v_state := app.link_state(l.id);
  if v_state <> 'ok' then
    raise exception 'link indisponível (%)', v_state;
  end if;
  if p_session_hash is null or not exists (
    select 1 from public.approval_link_sessions s
    where s.link_id = l.id and s.session_hash = p_session_hash and s.expires_at > now()
  ) then
    raise exception 'sessão de verificação inválida ou expirada';
  end if;
  return app.record_decision(l.request_id, l.approver_id, p_decision, p_note, 'link', l.id, p_ip_hash, p_user_agent);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões: tudo isto é só do servidor (service_role).
-- ---------------------------------------------------------------------------
revoke all on function public.link_resolve(text) from public, anon, authenticated;
revoke all on function public.link_issue_code(text, text) from public, anon, authenticated;
revoke all on function public.link_verify_code(text, text, text) from public, anon, authenticated;
revoke all on function public.link_session_context(text, text) from public, anon, authenticated;
revoke all on function public.decide_with_link_session(text, text, public.decision_kind, text, text, text) from public, anon, authenticated;
grant execute on function public.link_resolve(text) to service_role;
grant execute on function public.link_issue_code(text, text) to service_role;
grant execute on function public.link_verify_code(text, text, text) to service_role;
grant execute on function public.link_session_context(text, text) to service_role;
grant execute on function public.decide_with_link_session(text, text, public.decision_kind, text, text, text) to service_role;
