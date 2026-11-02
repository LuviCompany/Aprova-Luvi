-- Aprova Luvi — Fase 2, migration 2/4: funções de autorização e regras de aprovação.
--
-- Funções SECURITY DEFINER sempre fixam search_path vazio e qualificam todos os nomes.
-- O schema "app" não é exposto pela API do Supabase; só o que está em "public" vira RPC.

-- ---------------------------------------------------------------------------
-- Helpers de autorização (usados nas políticas RLS)
-- ---------------------------------------------------------------------------
create function app.try_uuid(p text) returns uuid
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid
  end;
$$;

create function app.my_role() returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active;
$$;

create function app.my_org() returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.organization_id from public.profiles p where p.id = auth.uid() and p.active;
$$;

create function app.is_staff() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(app.my_role() in ('admin', 'designer', 'atendimento'), false);
$$;

create function app.is_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(app.my_role() = 'admin', false);
$$;

create function app.can_manage_clients() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(app.my_role() in ('admin', 'atendimento'), false);
$$;

-- Equipe com acesso a um cliente: ativa e da mesma organização do cliente.
create function app.staff_can_access(p_client_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_staff() and exists (
    select 1 from public.clients c
    where c.id = p_client_id and c.organization_id = app.my_org()
  );
$$;

-- Clientes do usuário logado como aprovador (portal). Perfil e vínculo precisam estar ativos.
create function app.my_client_ids() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select a.client_id
  from public.approvers a
  join public.profiles p on p.id = a.profile_id
  join public.clients c on c.id = a.client_id
  where a.profile_id = auth.uid()
    and a.active and p.active and c.active
    and p.role = 'cliente';
$$;

-- Aprovador do usuário logado dentro de um cliente (ou null).
create function app.my_approver_id(p_client_id uuid) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select a.id
  from public.approvers a
  join public.profiles p on p.id = a.profile_id
  join public.clients c on c.id = a.client_id
  where a.profile_id = auth.uid() and a.client_id = p_client_id
    and a.active and p.active and c.active and p.role = 'cliente';
$$;

-- O cliente só enxerga versões e materiais que já foram enviados para aprovação.
create function app.version_was_sent(p_version_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.approval_requests r where r.version_id = p_version_id);
$$;

create function app.material_was_sent(p_material_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.approval_requests r where r.material_id = p_material_id);
$$;

-- Projeto visível ao cliente: ao menos um material dele já foi enviado para aprovação.
create function app.material_visible_project(p_project_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.materials m
    join public.approval_requests r on r.material_id = m.id
    where m.project_id = p_project_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Registro de decisão (núcleo, não exposto)
-- ---------------------------------------------------------------------------
create function app.record_decision(
  p_request_id uuid,
  p_approver_id uuid,
  p_decision public.decision_kind,
  p_note text,
  p_via public.decision_channel,
  p_link_id uuid,
  p_ip_hash text,
  p_user_agent text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_id uuid;
begin
  select * into r from public.approval_requests where id = p_request_id for update;
  if not found then
    raise exception 'solicitação inexistente';
  end if;
  if r.status <> 'aberta' then
    raise exception 'esta solicitação já foi encerrada';
  end if;
  if not exists (
    select 1 from public.approvers a
    join public.clients c on c.id = a.client_id
    where a.id = p_approver_id and a.client_id = r.client_id and a.active and c.active
  ) then
    raise exception 'aprovador não autorizado para esta solicitação';
  end if;

  insert into public.decisions (
    request_id, material_id, version_id, client_id, decision, note,
    approver_id, via, link_id, ip_hash, user_agent
  ) values (
    r.id, r.material_id, r.version_id, r.client_id, p_decision, coalesce(btrim(p_note), ''),
    p_approver_id, p_via, p_link_id, p_ip_hash, left(p_user_agent, 300)
  ) returning id into v_id;

  update public.approval_requests set status = 'decidida', closed_at = now() where id = r.id;
  update public.materials set status = p_decision::text::public.material_status where id = r.material_id;
  if p_link_id is not null then
    update public.approval_links set used_at = now() where id = p_link_id and used_at is null;
  end if;

  perform app.write_audit(
    r.client_id, null, p_approver_id, 'decision.recorded', 'decision', v_id,
    jsonb_build_object('decision', p_decision, 'via', p_via, 'material_id', r.material_id,
                       'version_id', r.version_id),
    p_ip_hash
  );
  return v_id;
end;
$$;

-- Decisão no portal: o aprovador é o próprio usuário autenticado.
create function public.decide_as_approver(
  p_request_id uuid,
  p_decision public.decision_kind,
  p_note text default ''
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_approver uuid;
begin
  select r.client_id into v_client from public.approval_requests r where r.id = p_request_id;
  v_approver := case when v_client is null then null else app.my_approver_id(v_client) end;
  if v_approver is null then
    -- Mesma resposta para "não existe" e "não é seu": não vaza a existência do recurso.
    raise exception 'sem permissão para decidir esta solicitação';
  end if;
  return app.record_decision(p_request_id, v_approver, p_decision, p_note, 'portal', null, null, null);
end;
$$;

-- Decisão por link: só o servidor (service_role) chama, depois de validar token + código.
-- O banco revalida o estado do link por segurança em profundidade.
create function public.decide_via_link(
  p_link_id uuid,
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
  v_request uuid;
begin
  select request_id into v_request from public.approval_links where id = p_link_id;
  if v_request is null then
    raise exception 'link inválido';
  end if;
  perform 1 from public.approval_requests where id = v_request for update;
  select * into l from public.approval_links where id = p_link_id for update;
  if not found then
    raise exception 'link inválido';
  end if;
  if l.revoked_at is not null then
    raise exception 'link revogado';
  end if;
  if l.expires_at <= now() then
    raise exception 'link expirado';
  end if;
  if l.used_at is not null then
    raise exception 'link já utilizado';
  end if;
  return app.record_decision(l.request_id, l.approver_id, p_decision, p_note, 'link', l.id, p_ip_hash, p_user_agent);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operações da equipe sobre solicitações e links
-- ---------------------------------------------------------------------------
create function public.create_approval_link(
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
  select * into r from public.approval_requests where id = p_request_id for update;
  if not found or not app.staff_can_access(r.client_id) then
    raise exception 'sem permissão';
  end if;
  if r.status <> 'aberta' then
    raise exception 'a solicitação não está aberta';
  end if;
  if not exists (
    select 1 from public.approvers a
    where a.id = p_approver_id and a.client_id = r.client_id and a.active
  ) then
    raise exception 'aprovador inválido para este cliente';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'a validade do link deve estar entre agora e 30 dias';
  end if;

  insert into public.approval_links (request_id, client_id, approver_id, token_hash, expires_at, created_by)
  values (r.id, r.client_id, p_approver_id, p_token_hash, p_expires_at, auth.uid())
  returning id into v_id;

  perform app.write_audit(r.client_id, auth.uid(), null, 'approval_link.created', 'approval_link', v_id,
                          jsonb_build_object('approver_id', p_approver_id, 'expires_at', p_expires_at));
  return v_id;
end;
$$;

create function public.revoke_approval_link(p_link_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.approval_links;
begin
  select * into l from public.approval_links where id = p_link_id;
  if not found or not app.staff_can_access(l.client_id) then
    raise exception 'sem permissão';
  end if;
  update public.approval_links
    set revoked_at = now(), revoked_by = auth.uid()
    where id = l.id and revoked_at is null;
  perform app.write_audit(l.client_id, auth.uid(), null, 'approval_link.revoked', 'approval_link', l.id);
end;
$$;

create function public.cancel_approval_request(p_request_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
begin
  select * into r from public.approval_requests where id = p_request_id for update;
  if not found or not app.staff_can_access(r.client_id) then
    raise exception 'sem permissão';
  end if;
  if r.status <> 'aberta' then
    raise exception 'apenas solicitações abertas podem ser canceladas';
  end if;
  update public.approval_requests set status = 'cancelada', closed_at = now() where id = r.id;
  update public.approval_links set revoked_at = now(), revoked_by = auth.uid()
    where request_id = r.id and revoked_at is null;
  update public.materials set status = 'rascunho' where id = r.material_id;
  perform app.write_audit(r.client_id, auth.uid(), null, 'approval_request.cancelled', 'approval_request', r.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões de execução: nada é público; o servidor usa service_role.
-- ---------------------------------------------------------------------------
revoke all on function public.decide_as_approver(uuid, public.decision_kind, text) from public, anon;
revoke all on function public.decide_via_link(uuid, public.decision_kind, text, text, text) from public, anon, authenticated;
revoke all on function public.create_approval_link(uuid, uuid, text, timestamptz) from public, anon;
revoke all on function public.revoke_approval_link(uuid) from public, anon;
revoke all on function public.cancel_approval_request(uuid) from public, anon;

grant execute on function public.decide_as_approver(uuid, public.decision_kind, text) to authenticated, service_role;
grant execute on function public.decide_via_link(uuid, public.decision_kind, text, text, text) to service_role;
grant execute on function public.create_approval_link(uuid, uuid, text, timestamptz) to authenticated, service_role;
grant execute on function public.revoke_approval_link(uuid) to authenticated, service_role;
grant execute on function public.cancel_approval_request(uuid) to authenticated, service_role;

-- Funções do schema app: executáveis só por quem precisa avaliar políticas.
revoke all on all functions in schema app from public, anon;
grant usage on schema app to authenticated, service_role;
grant execute on function
  app.my_role(), app.my_org(), app.is_staff(), app.is_admin(), app.can_manage_clients(),
  app.staff_can_access(uuid), app.my_client_ids(), app.my_approver_id(uuid),
  app.version_was_sent(uuid), app.material_was_sent(uuid), app.material_visible_project(uuid),
  app.try_uuid(text)
  to authenticated, service_role;
