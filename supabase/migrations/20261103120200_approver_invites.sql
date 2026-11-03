-- Aprova Luvi — Módulo 3, etapa A.2, migration M3/4: preparação de convites de acesso.
--
-- SÓ REGISTRA a intenção de convidar um aprovador para o portal. Esta migration NÃO envia e-mail,
-- NÃO cria usuário no Supabase Auth e NÃO emite nem guarda token: o e-mail vem sempre da linha do
-- aprovador e o token será do Supabase Auth, na Fase 3 (SMTP/Resend). As transições "enviado" e
-- "aceito" ficam reservadas ao service_role.

create type public.invite_status as enum ('preparado', 'enviado', 'aceito', 'revogado', 'expirado');

create table public.approver_invites (
  id uuid primary key default gen_random_uuid(),
  approver_id uuid not null,
  client_id uuid not null,
  status public.invite_status not null default 'preparado',
  prepared_by uuid references public.profiles (id),
  prepared_at timestamptz not null default now(),
  sent_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  foreign key (approver_id, client_id) references public.approvers (id, client_id),
  check (status <> 'enviado' or sent_at is not null),
  check (status <> 'aceito' or accepted_at is not null),
  check (status <> 'revogado' or revoked_at is not null)
);
create index approver_invites_client_id_idx on public.approver_invites (client_id);
create index approver_invites_approver_id_idx on public.approver_invites (approver_id);
-- No máximo UM convite em aberto por aprovador.
create unique index approver_invites_one_open_per_approver
  on public.approver_invites (approver_id) where status in ('preparado', 'enviado');

alter table public.approver_invites enable row level security;

-- A equipe só LÊ. Nenhuma escrita direta: criar e revogar passam pelas funções abaixo.
revoke all on public.approver_invites from anon, authenticated;
grant select on public.approver_invites to authenticated;
create policy invites_select_staff on public.approver_invites
  for select to authenticated
  using (app.staff_can_access(client_id));

-- Prepara o convite de um aprovador ATIVO e SEM login, de cliente ATIVO.
create function public.prepare_approver_invite(p_approver_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.approvers;
  v_id uuid;
begin
  select x.* into a from public.approvers x where x.id = p_approver_id;
  if not app.can_manage_clients() or not found or not app.staff_can_access(a.client_id) then
    raise exception 'sem permissão';
  end if;
  if not a.active then
    raise exception 'aprovador inativo';
  end if;
  if a.profile_id is not null then
    raise exception 'o aprovador já tem acesso ao portal';
  end if;
  if not exists (select 1 from public.clients c where c.id = a.client_id and c.active) then
    raise exception 'cliente arquivado: reative o cliente antes de preparar convites';
  end if;

  insert into public.approver_invites (approver_id, client_id, prepared_by)
  values (a.id, a.client_id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.prepare_approver_invite(uuid) from public, anon;
grant execute on function public.prepare_approver_invite(uuid) to authenticated, service_role;

-- Cancela um convite ainda aberto (preparado ou enviado).
create function public.revoke_approver_invite(p_invite_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.approver_invites;
begin
  select x.* into i from public.approver_invites x where x.id = p_invite_id for update;
  if not app.can_manage_clients() or not found or not app.staff_can_access(i.client_id) then
    raise exception 'sem permissão';
  end if;
  if i.status not in ('preparado', 'enviado') then
    raise exception 'o convite não está em aberto';
  end if;
  update public.approver_invites set status = 'revogado', revoked_at = now() where id = i.id;
end;
$$;
revoke all on function public.revoke_approver_invite(uuid) from public, anon;
grant execute on function public.revoke_approver_invite(uuid) to authenticated, service_role;

-- Desativar o aprovador cancela o convite que ainda estiver aberto.
create function app.approvers_revoke_open_invites() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.approver_invites
     set status = 'revogado', revoked_at = now()
   where approver_id = new.id and status in ('preparado', 'enviado');
  return new;
end;
$$;
revoke execute on function app.approvers_revoke_open_invites() from public, anon, authenticated;

create trigger approvers_revoke_open_invites after update of active on public.approvers
  for each row when (old.active and not new.active)
  execute function app.approvers_revoke_open_invites();
