-- Aprova Luvi — Fase 2, migration 3/4: grants mínimos e Row Level Security.
--
-- Modelo:
--   anon            -> nenhum acesso a tabelas (o fluxo por link passa pelo servidor com service_role).
--   authenticated   -> equipe (admin/designer/atendimento) ou aprovador de cliente; o que cada um
--                      enxerga é decidido pelas políticas abaixo.
--   service_role    -> servidor de confiança (ignora RLS). Nunca vai ao navegador.
--
-- O Supabase concede ALL a anon/authenticated em tabelas novas do schema public. Revogamos tudo
-- e concedemos só o necessário, por tabela e por coluna.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.approvers enable row level security;
alter table public.projects enable row level security;
alter table public.materials enable row level security;
alter table public.material_versions enable row level security;
alter table public.material_files enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_links enable row level security;
alter table public.approval_verifications enable row level security;
alter table public.approval_link_sessions enable row level security;
alter table public.comments enable row level security;
alter table public.decisions enable row level security;
alter table public.audit_events enable row level security;

-- ---------------------------------------------------------------------------
-- Grants (authenticated)
-- ---------------------------------------------------------------------------
grant select on public.organizations to authenticated;

-- Perfis: leitura; o próprio usuário só altera o nome. Papel, status e criação de usuários
-- ficam com o servidor (service_role), depois de checar que quem pede é admin.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

grant select on public.clients to authenticated;
grant insert (organization_id, name, segment, initials, active) on public.clients to authenticated;
grant update (name, segment, initials, active) on public.clients to authenticated;

-- profile_id (vínculo com login) fica fora do grant: só o servidor liga usuário a aprovador.
grant select on public.approvers to authenticated;
grant insert (client_id, name, email, job_title, active) on public.approvers to authenticated;
grant update (name, job_title, active) on public.approvers to authenticated;

grant select on public.projects to authenticated;
grant insert (client_id, name, description, status, due_date, created_by) on public.projects to authenticated;
grant update (name, description, status, due_date) on public.projects to authenticated;

-- "status" do material fica fora dos grants: só as funções de aprovação o alteram.
grant select on public.materials to authenticated;
grant insert (project_id, client_id, title, description, type, channel, due_date, created_by)
  on public.materials to authenticated;
grant update (title, description, channel, due_date) on public.materials to authenticated;
grant delete on public.materials to authenticated;

grant select on public.material_versions to authenticated;
grant insert (material_id, client_id, note, created_by) on public.material_versions to authenticated;

grant select on public.material_files to authenticated;
grant insert (version_id, material_id, client_id, slide_position, kind, storage_path,
              original_name, mime_type, size_bytes, checksum_sha256, created_by)
  on public.material_files to authenticated;
grant delete on public.material_files to authenticated;

grant select on public.approval_requests to authenticated;
grant insert (material_id, version_id, client_id, requested_by, due_at, message)
  on public.approval_requests to authenticated;

-- token_hash não é legível por ninguém além do servidor.
grant select (id, request_id, client_id, approver_id, expires_at, revoked_at, used_at, created_at)
  on public.approval_links to authenticated;

grant select on public.comments to authenticated;
grant insert (material_id, version_id, client_id, slide, author_role, author_profile_id,
              author_approver_id, body)
  on public.comments to authenticated;

grant select on public.decisions to authenticated;
grant select on public.audit_events to authenticated;

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------

-- organizations
create policy organizations_select_staff on public.organizations
  for select to authenticated
  using (app.is_staff() and id = (select app.my_org()));

-- profiles
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_select_staff on public.profiles
  for select to authenticated
  using (app.is_staff() and organization_id = (select app.my_org()));
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- clients
create policy clients_select_staff on public.clients
  for select to authenticated
  using (app.is_staff() and organization_id = (select app.my_org()));
create policy clients_select_portal on public.clients
  for select to authenticated
  using (id in (select app.my_client_ids()));
create policy clients_insert_staff on public.clients
  for insert to authenticated
  with check (app.can_manage_clients() and organization_id = (select app.my_org()));
create policy clients_update_staff on public.clients
  for update to authenticated
  using (app.can_manage_clients() and organization_id = (select app.my_org()))
  with check (app.can_manage_clients() and organization_id = (select app.my_org()));

-- approvers
create policy approvers_select_staff on public.approvers
  for select to authenticated
  using (app.staff_can_access(client_id));
create policy approvers_select_portal on public.approvers
  for select to authenticated
  using (client_id in (select app.my_client_ids()));
create policy approvers_insert_staff on public.approvers
  for insert to authenticated
  with check (app.can_manage_clients() and app.staff_can_access(client_id));
create policy approvers_update_staff on public.approvers
  for update to authenticated
  using (app.can_manage_clients() and app.staff_can_access(client_id))
  with check (app.can_manage_clients() and app.staff_can_access(client_id));

-- projects
create policy projects_select_staff on public.projects
  for select to authenticated
  using (app.staff_can_access(client_id));
create policy projects_select_portal on public.projects
  for select to authenticated
  using (client_id in (select app.my_client_ids()) and app.material_visible_project(id));
create policy projects_insert_staff on public.projects
  for insert to authenticated
  with check (app.staff_can_access(client_id) and created_by = (select auth.uid()));
create policy projects_update_staff on public.projects
  for update to authenticated
  using (app.staff_can_access(client_id))
  with check (app.staff_can_access(client_id));

-- materials: o cliente só vê materiais que já tiveram solicitação de aprovação enviada.
create policy materials_select_staff on public.materials
  for select to authenticated
  using (app.staff_can_access(client_id));
create policy materials_select_portal on public.materials
  for select to authenticated
  using (client_id in (select app.my_client_ids()) and app.material_was_sent(id));
create policy materials_insert_staff on public.materials
  for insert to authenticated
  with check (app.staff_can_access(client_id) and created_by = (select auth.uid()));
create policy materials_update_staff on public.materials
  for update to authenticated
  using (app.staff_can_access(client_id))
  with check (app.staff_can_access(client_id));
create policy materials_delete_staff on public.materials
  for delete to authenticated
  using (app.staff_can_access(client_id) and status = 'rascunho' and not app.material_was_sent(id));

-- material_versions (imutáveis: sem política de update/delete)
create policy versions_select_staff on public.material_versions
  for select to authenticated
  using (app.staff_can_access(client_id));
create policy versions_select_portal on public.material_versions
  for select to authenticated
  using (client_id in (select app.my_client_ids()) and app.version_was_sent(id));
create policy versions_insert_staff on public.material_versions
  for insert to authenticated
  with check (app.staff_can_access(client_id) and created_by = (select auth.uid()));

-- material_files: arquivos de versão já enviada não mudam.
create policy files_select_staff on public.material_files
  for select to authenticated
  using (app.staff_can_access(client_id));
create policy files_select_portal on public.material_files
  for select to authenticated
  using (client_id in (select app.my_client_ids()) and app.version_was_sent(version_id));
create policy files_insert_staff on public.material_files
  for insert to authenticated
  with check (
    app.staff_can_access(client_id)
    and created_by = (select auth.uid())
    and not app.version_was_sent(version_id)
  );
create policy files_delete_staff on public.material_files
  for delete to authenticated
  using (app.staff_can_access(client_id) and not app.version_was_sent(version_id));

-- approval_requests (criação pela equipe; encerramento só via funções)
create policy requests_select_staff on public.approval_requests
  for select to authenticated
  using (app.staff_can_access(client_id));
create policy requests_select_portal on public.approval_requests
  for select to authenticated
  using (client_id in (select app.my_client_ids()));
create policy requests_insert_staff on public.approval_requests
  for insert to authenticated
  with check (app.staff_can_access(client_id) and requested_by = (select auth.uid()));

-- approval_links: só a equipe enxerga metadados; criação/revogação via funções.
create policy links_select_staff on public.approval_links
  for select to authenticated
  using (app.staff_can_access(client_id));

-- comments (append-only)
create policy comments_select_staff on public.comments
  for select to authenticated
  using (app.staff_can_access(client_id));
create policy comments_select_portal on public.comments
  for select to authenticated
  using (client_id in (select app.my_client_ids()) and app.version_was_sent(version_id));
create policy comments_insert_staff on public.comments
  for insert to authenticated
  with check (
    app.staff_can_access(client_id)
    and author_role = 'luvi'
    and author_profile_id = (select auth.uid())
  );
create policy comments_insert_portal on public.comments
  for insert to authenticated
  with check (
    client_id in (select app.my_client_ids())
    and author_role = 'cliente'
    and author_approver_id = app.my_approver_id(client_id)
    and app.version_was_sent(version_id)
  );

-- decisions: sem política de insert; só app.record_decision grava.
create policy decisions_select_staff on public.decisions
  for select to authenticated
  using (app.staff_can_access(client_id));
create policy decisions_select_portal on public.decisions
  for select to authenticated
  using (client_id in (select app.my_client_ids()));

-- audit_events: leitura só por administradores da organização.
create policy audit_select_admin on public.audit_events
  for select to authenticated
  using (app.is_admin() and organization_id = (select app.my_org()));

-- approval_verifications e approval_link_sessions: RLS ligado e nenhuma política,
-- nenhum grant. Somente service_role acessa.
