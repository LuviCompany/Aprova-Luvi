-- Aprova Luvi — Módulo 4, migration D1/2: aprovação com vários aprovadores.
--
-- Modelo: cada ENVIO para aprovação (uma "rodada", submission_id) cria uma SOLICITAÇÃO INDIVIDUAL por
-- aprovador designado (approval_requests.approver_id), todas ligadas à mesma versão. Cada solicitação
-- recebe no máximo UMA decisão (imutável). POLÍTICA DE APROVAÇÃO FINAL (padrão inicial):
--   * o material só vira "aprovado" quando TODOS os aprovadores designados da rodada aprovam;
--   * se QUALQUER um pedir alteração, o material vai para "alteracao" (ajustes), as solicitações
--     ainda abertas da rodada são CANCELADAS e seus links revogados; as decisões já registradas
--     (inclusive as de aprovação) ficam preservadas para sempre;
--   * cancelar uma solicitação cancela a rodada inteira e devolve o material a "rascunho".
-- O envio passa a ser SÓ pela função public.submit_for_approval (o app perde o INSERT direto).
-- Decisões concorrentes são serializadas pelo bloqueio da linha do material (mesma ordem de
-- bloqueio em todas as funções: material, depois solicitação).

alter table public.approval_requests
  add column approver_id uuid,
  add column submission_id uuid;

alter table public.approval_requests
  add constraint approval_requests_approver_fk
  foreign key (approver_id, client_id) references public.approvers (id, client_id);
-- Linhas novas sempre têm aprovador e rodada (NOT VALID: não reescreve linhas anteriores, se houver).
alter table public.approval_requests
  add constraint approval_requests_approver_required
  check (approver_id is not null and submission_id is not null) not valid;

drop index public.approval_requests_one_open_per_version;
create unique index approval_requests_one_open_per_approver
  on public.approval_requests (version_id, approver_id) where status = 'aberta';
create index approval_requests_submission_idx on public.approval_requests (submission_id);

-- O envio agora só acontece por submit_for_approval (SECURITY DEFINER).
revoke insert on public.approval_requests from authenticated;

create or replace function app.requests_before_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest integer;
  v_number integer;
  v_status public.material_status;
begin
  if auth.uid() is not null and not app.staff_can_access(new.client_id) then
    raise exception 'new row violates row-level security policy for table "%"', tg_table_name
      using errcode = '42501';
  end if;
  if new.approver_id is null or new.submission_id is null then
    raise exception 'informe o aprovador e a rodada de envio';
  end if;
  select m.status into v_status from public.materials m
    where m.id = new.material_id and m.client_id = new.client_id;
  if not found then
    raise exception 'material inválido para esta solicitação';
  end if;
  if v_status = 'rascunho' then
    null;
  elsif v_status = 'aguardando' and exists (
    select 1 from public.approval_requests r
    where r.submission_id = new.submission_id and r.version_id = new.version_id and r.status = 'aberta'
  ) then
    null; -- mais um aprovador da mesma rodada
  else
    raise exception 'o material não pode ser enviado para aprovação no estado atual (%)', v_status
      using errcode = '23514';
  end if;
  select v.number into v_number from public.material_versions v where v.id = new.version_id;
  select max(v.number) into latest from public.material_versions v where v.material_id = new.material_id;
  if v_number is distinct from latest then
    raise exception 'somente a versão mais recente pode ser enviada para aprovação';
  end if;
  if not exists (select 1 from public.material_files f where f.version_id = new.version_id) then
    raise exception 'a versão não possui arquivos';
  end if;
  if not exists (
    select 1 from public.approvers a join public.clients c on c.id = a.client_id
    where a.id = new.approver_id and a.client_id = new.client_id and a.active and c.active
  ) then
    raise exception 'aprovador inválido, inativo ou de cliente arquivado';
  end if;
  new.status := 'aberta';
  new.closed_at := null;
  return new;
end;
$$;

-- Conteúdo apresentado de uma versão (o que o aprovador vê). Fonte única do congelamento e da comparação.
create function app.version_content(p_version_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'title', m.title,
           'description', m.description,
           'caption', m.caption,
           'type', m.type,
           'aspect_ratio', m.aspect_ratio,
           'channel', m.channel,
           'publish_date', m.publish_date,
           'due_date', m.due_date,
           'files', coalesce((
             select jsonb_agg(jsonb_build_object(
               'position', f.slide_position, 'kind', f.kind, 'mime_type', f.mime_type,
               'original_name', f.original_name, 'size_bytes', f.size_bytes,
               'checksum_sha256', f.checksum_sha256
             ) order by f.slide_position)
             from public.material_files f where f.version_id = v.id
           ), '[]'::jsonb))
  from public.material_versions v
  join public.materials m on m.id = v.material_id and m.client_id = v.client_id
  where v.id = p_version_id;
$$;
revoke execute on function app.version_content(uuid) from public, anon, authenticated, service_role;

create or replace function app.freeze_version_content(p_version_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.material_version_contents (version_id, material_id, client_id, content)
  select v.id, v.material_id, v.client_id, app.version_content(v.id)
  from public.material_versions v
  where v.id = p_version_id
  on conflict (version_id) do nothing;
end;
$$;

-- Cada aprovador enxerga somente as PRÓPRIAS solicitações (as decisões do cliente seguem visíveis
-- para acompanhar quem já respondeu).
drop policy requests_select_portal on public.approval_requests;
create policy requests_select_portal on public.approval_requests
  for select to authenticated
  using (client_id in (select app.my_client_ids()) and approver_id = app.my_approver_id(client_id));

-- Núcleo da decisão: ÚNICO caminho que grava decisões e muda o status do material por decisão.
create or replace function app.record_decision(
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
  v_status public.material_status;
  v_number integer;
  v_latest integer;
  v_open integer;
begin
  select * into r from public.approval_requests where id = p_request_id;
  if not found then
    raise exception 'solicitação inexistente';
  end if;
  -- Ordem de bloqueio: material, depois solicitação (serializa decisões concorrentes do mesmo material).
  select m.status into v_status from public.materials m where m.id = r.material_id for update;
  select * into r from public.approval_requests where id = p_request_id for update;
  if r.status <> 'aberta' then
    raise exception 'esta solicitação já foi encerrada';
  end if;
  if r.approver_id is distinct from p_approver_id or not exists (
    select 1 from public.approvers a join public.clients c on c.id = a.client_id
    where a.id = p_approver_id and a.client_id = r.client_id and a.active and c.active
  ) then
    raise exception 'aprovador não autorizado para esta solicitação';
  end if;
  select v.number into v_number from public.material_versions v where v.id = r.version_id;
  select max(v.number) into v_latest from public.material_versions v where v.material_id = r.material_id;
  if v_status <> 'aguardando' or v_number is distinct from v_latest then
    raise exception 'esta solicitação é de uma versão que não está mais em aprovação';
  end if;

  insert into public.decisions (
    request_id, material_id, version_id, client_id, decision, note,
    approver_id, via, link_id, ip_hash, user_agent
  ) values (
    r.id, r.material_id, r.version_id, r.client_id, p_decision, coalesce(btrim(p_note), ''),
    p_approver_id, p_via, p_link_id, p_ip_hash, left(p_user_agent, 300)
  ) returning id into v_id;

  update public.approval_requests set status = 'decidida', closed_at = now() where id = r.id;
  if p_link_id is not null then
    update public.approval_links set used_at = now() where id = p_link_id and used_at is null;
  end if;

  if p_decision = 'alteracao' then
    update public.materials set status = 'alteracao' where id = r.material_id;
    -- As demais solicitações abertas da rodada ficam sem objeto: cancela e revoga os links.
    with cancelled as (
      update public.approval_requests set status = 'cancelada', closed_at = now()
      where submission_id = r.submission_id and status = 'aberta'
      returning id
    )
    update public.approval_links set revoked_at = now()
    where revoked_at is null and request_id in (select id from cancelled);
  else
    select count(*) into v_open from public.approval_requests
      where submission_id = r.submission_id and status = 'aberta';
    if v_open = 0 then
      update public.materials set status = 'aprovado' where id = r.material_id;
    end if;
  end if;

  perform app.write_audit(
    r.client_id, null, p_approver_id, 'decision.recorded', 'decision', v_id,
    jsonb_build_object('decision', p_decision, 'via', p_via, 'material_id', r.material_id,
                       'version_id', r.version_id, 'request_id', r.id),
    p_ip_hash
  );
  return v_id;
end;
$$;

-- Cancela a RODADA inteira (todas as solicitações abertas do mesmo envio) e devolve o material a rascunho.
create or replace function public.cancel_approval_request(p_request_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
begin
  select * into r from public.approval_requests where id = p_request_id;
  if not found or auth.uid() is null or not app.staff_can_access(r.client_id) then
    raise exception 'sem permissão';
  end if;
  perform 1 from public.materials where id = r.material_id for update;
  select * into r from public.approval_requests where id = p_request_id for update;
  if r.status <> 'aberta' then
    raise exception 'apenas solicitações abertas podem ser canceladas';
  end if;
  update public.approval_requests set status = 'cancelada', closed_at = now()
    where submission_id = r.submission_id and status = 'aberta';
  update public.approval_links set revoked_at = now(), revoked_by = auth.uid()
    where revoked_at is null
      and request_id in (select id from public.approval_requests where submission_id = r.submission_id);
  update public.materials set status = 'rascunho' where id = r.material_id and status = 'aguardando';
  perform app.write_audit(r.client_id, auth.uid(), null, 'approval_request.cancelled', 'approval_request', r.id,
                          jsonb_build_object('material_id', r.material_id, 'version_id', r.version_id));
end;
$$;

-- Envio para aprovação: UMA solicitação individual por aprovador, na mesma rodada, numa só transação.
-- Devolve o id da rodada (submission_id).
create function public.submit_for_approval(
  p_version_id uuid,
  p_approver_ids uuid[],
  p_due_at timestamptz default null,
  p_message text default ''
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.material_versions;
  v_status public.material_status;
  v_submission uuid := gen_random_uuid();
  v_approver uuid;
  v_count integer := coalesce(array_length(p_approver_ids, 1), 0);
begin
  select * into v from public.material_versions where id = p_version_id;
  if not found or auth.uid() is null or not app.staff_can_access(v.client_id) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select m.status into v_status from public.materials m where m.id = v.material_id for update;
  if v_status <> 'rascunho' then
    raise exception 'só material em rascunho pode ser enviado para aprovação' using errcode = '23514';
  end if;
  if v_count < 1 or v_count > 20 or (select count(distinct x) from unnest(p_approver_ids) as x) <> v_count
     or exists (select 1 from unnest(p_approver_ids) as x where x is null) then
    raise exception 'escolha de 1 a 20 aprovadores, sem repetir' using errcode = '22023';
  end if;
  if p_due_at is not null and p_due_at <= now() then
    raise exception 'o prazo precisa estar no futuro' using errcode = '22023';
  end if;
  -- O conteúdo congelado de uma versão nunca muda: reenviar a MESMA versão só vale se nada mudou.
  if exists (
    select 1 from public.material_version_contents c
    where c.version_id = v.id and c.content is distinct from app.version_content(v.id)
  ) then
    raise exception 'o conteúdo mudou desde o último envio desta versão; crie uma nova versão'
      using errcode = '23514';
  end if;
  foreach v_approver in array p_approver_ids loop
    insert into public.approval_requests (
      material_id, version_id, client_id, requested_by, due_at, message, approver_id, submission_id
    ) values (
      v.material_id, v.id, v.client_id, auth.uid(), p_due_at, coalesce(p_message, ''), v_approver, v_submission
    );
  end loop;
  perform app.write_audit(
    v.client_id, auth.uid(), null, 'material.submitted', 'material', v.material_id,
    jsonb_build_object('client_id', v.client_id, 'actor_role', app.my_role(), 'version_id', v.id,
                       'submission_id', v_submission, 'approvers', v_count)
  );
  return v_submission;
end;
$$;
revoke execute on function public.submit_for_approval(uuid, uuid[], timestamptz, text) from public, anon;
grant execute on function public.submit_for_approval(uuid, uuid[], timestamptz, text) to authenticated;
