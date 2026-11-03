-- Aprova Luvi — verificação PÓS-MIGRATION (somente leitura).
--
-- Cole no SQL Editor do Supabase DEPOIS de aplicar as 4 migrations. Cada bloco "CHECK" devolve
-- as linhas que VIOLAM uma regra: o resultado esperado é SEMPRE "0 linhas" em todos os blocos.
-- Nenhum comando altera dados.
--
-- Estes mesmos blocos rodam nos testes automatizados (src/test/db/verify-sql.test.ts), então o
-- que foi testado em memória é exatamente o que se confere no projeto real.

-- CHECK: tabelas do schema public sem RLS ligada
select c.relname as tabela
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- CHECK: privilégios de tabela para o papel anon (deve ser nenhum)
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';

-- CHECK: privilégios de coluna para o papel anon (deve ser nenhum)
select table_name, column_name, privilege_type
from information_schema.role_column_grants
where grantee = 'anon' and table_schema = 'public';

-- CHECK: authenticated com TRUNCATE, REFERENCES ou TRIGGER em alguma tabela
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public'
  and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');

-- CHECK: tabelas imutáveis alteráveis pelo app (UPDATE/DELETE por authenticated)
select t.relname as tabela
from pg_class t join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relkind = 'r'
  and t.relname in ('decisions', 'audit_events', 'material_versions', 'comments',
                    'approval_links', 'approval_requests')
  and (has_any_column_privilege('authenticated', t.oid, 'UPDATE')
       or has_table_privilege('authenticated', t.oid, 'DELETE'));

-- CHECK: tabelas de segredos acessíveis ao app
select t.relname as tabela
from pg_class t join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relname in ('approval_verifications', 'approval_link_sessions')
  and has_any_column_privilege('authenticated', t.oid, 'SELECT,INSERT,UPDATE');

-- CHECK: colunas sensíveis expostas
select 'approval_links.token_hash legível' as problema
where has_column_privilege('authenticated', 'public.approval_links', 'token_hash', 'SELECT')
union all select 'materials.status gravável'
where has_column_privilege('authenticated', 'public.materials', 'status', 'UPDATE')
   or has_column_privilege('authenticated', 'public.materials', 'status', 'INSERT')
union all select 'profiles.role/active/organization_id graváveis'
where has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
   or has_column_privilege('authenticated', 'public.profiles', 'active', 'UPDATE')
   or has_column_privilege('authenticated', 'public.profiles', 'organization_id', 'UPDATE')
union all select 'approvers.profile_id gravável'
where has_column_privilege('authenticated', 'public.approvers', 'profile_id', 'INSERT')
   or has_column_privilege('authenticated', 'public.approvers', 'profile_id', 'UPDATE');

-- CHECK: funções de public/app executáveis pelo anônimo
select n.nspname || '.' || p.proname as funcao
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app') and has_function_privilege('anon', p.oid, 'EXECUTE');

-- CHECK: funções executáveis por authenticated fora da lista permitida
select n.nspname || '.' || p.proname as funcao
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app')
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  and (n.nspname || '.' || p.proname) not in (
    'public.decide_as_approver', 'public.create_approval_link', 'public.revoke_approval_link',
    'public.cancel_approval_request', 'public.link_approver_to_client', 'public.prepare_approver_invite',
    'public.revoke_approver_invite', 'public.reorder_version_files', 'public.start_material_revision', 'app.my_role', 'app.my_org', 'app.is_staff', 'app.is_admin',
    'app.can_manage_clients', 'app.staff_can_access', 'app.my_client_ids', 'app.my_approver_id',
    'app.version_was_sent', 'app.material_was_sent', 'app.material_visible_project', 'app.try_uuid'
  );

-- CHECK: decide_via_link acessível a quem não é o servidor
select 'decide_via_link executável por anon/authenticated' as problema
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'decide_via_link'
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- CHECK: funções SECURITY DEFINER sem search_path vazio
select n.nspname || '.' || p.proname as funcao
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app') and p.prosecdef
  and not coalesce(p.proconfig @> array['search_path=""'], false);

-- CHECK: políticas que não são exclusivas do papel authenticated
select tablename, policyname, roles
from pg_policies
where schemaname in ('public', 'storage') and tablename in (
    'organizations', 'profiles', 'clients', 'approvers', 'projects', 'materials', 'material_versions',
    'material_files', 'approval_requests', 'approval_links', 'comments', 'decisions', 'audit_events', 'objects',
    'approver_invites'
  )
  and roles::text <> '{authenticated}';

-- CHECK: bucket "materials" ausente ou público ou sem limites
select 'bucket materials inexistente, público ou sem limites' as problema
where not exists (
  select 1 from storage.buckets
  where id = 'materials' and public = false and file_size_limit is not null and allowed_mime_types is not null
);

-- CHECK: políticas de storage.objects fora do bucket materials (nenhuma política pode ser genérica)
select policyname
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'materials_objects_%'
  and coalesce(qual, '') || coalesce(with_check, '') not like '%materials%';

-- CHECK: política de UPDATE em storage.objects para o app (uploads não podem sobrescrever)
select policyname
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')
  and 'authenticated' = any (roles);

-- CHECK: cadastro livre — perfis sem usuário correspondente no Auth
select p.id
from public.profiles p left join auth.users u on u.id = p.id
where u.id is null;

-- ---------------------------------------------------------------------------
-- Módulo 3, etapa A.2 (migrations 20261103120000 a 20261103120300). Estes blocos só passam DEPOIS
-- de aplicar as quatro migrations da A.2; antes delas, os blocos "ausente" devolvem linhas.
-- ---------------------------------------------------------------------------

-- CHECK: convites de aprovador graváveis diretamente pelo app (só as funções gravam)
select 'approver_invites aceita escrita direta do app' as problema
where has_any_column_privilege('authenticated', 'public.approver_invites', 'INSERT,UPDATE')
   or has_table_privilege('authenticated', 'public.approver_invites', 'DELETE')
   or has_any_column_privilege('anon', 'public.approver_invites', 'SELECT,INSERT,UPDATE');

-- CHECK: gatilhos de auditoria ausentes (clientes, projetos, aprovadores, convites)
select t.tabela
from (values ('clients'), ('projects'), ('approvers'), ('approver_invites')) as t(tabela)
where not exists (
  select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
  where c.relname = t.tabela and g.tgname = t.tabela || '_audit_row' and not g.tgisinternal
);

-- CHECK: guarda de cliente arquivado ausente (projetos e aprovadores)
select t.tabela
from (values ('projects'), ('approvers')) as t(tabela)
where not exists (
  select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
  where c.relname = t.tabela and g.tgname = t.tabela || '_guard_active_client' and not g.tgisinternal
);

-- CHECK: índice único do nome do cliente (sem diferenciar caixa) ausente
select 'clients_org_name_ci_key ausente' as problema
where not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'clients_org_name_ci_key');

-- CHECK: login por cliente (unique profile_id, client_id) ausente, ou unique antigo de profile_id ainda presente
select 'approvers_profile_client_key ausente' as problema
where not exists (select 1 from pg_constraint where conname = 'approvers_profile_client_key')
union all select 'approvers_profile_id_key ainda existe'
where exists (select 1 from pg_constraint where conname = 'approvers_profile_id_key');

-- CHECK: eventos de auditoria com nome, e-mail ou texto livre no metadata (só ids, papel e colunas)
select id, action
from public.audit_events
where metadata ?| array['name', 'email', 'full_name', 'job_title', 'note', 'body', 'title'];

-- ---------------------------------------------------------------------------
-- Módulo 3, etapa B (migrations 20261104120000 e 20261104120100). Estes blocos só passam DEPOIS
-- de aplicar as duas migrations da etapa B; antes delas, os blocos "ausente" devolvem linhas.
-- ---------------------------------------------------------------------------

-- CHECK: gatilhos de material ausentes (trava de conteúdo, trava de status e guarda de cliente arquivado)
select t.nome as gatilho
from (values ('materials_guard_content'), ('materials_guard_status'), ('materials_guard_active_client')) as t(nome)
where not exists (
  select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
  where c.relname = 'materials' and g.tgname = t.nome and not g.tgisinternal
);

-- CHECK: auditoria de materiais ausente (gatilho em INSERT, UPDATE e DELETE)
select 'materials_audit_row ausente ou sem INSERT/UPDATE/DELETE' as problema
where not exists (
  select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
  where c.relname = 'materials' and g.tgname = 'materials_audit_row' and not g.tgisinternal
    and (g.tgtype & 28) = 28
);

-- CHECK: colunas protegidas de materials graváveis pelo app (identificadores, status, tipo, autoria)
select c.col as coluna_com_update
from (values ('id'), ('project_id'), ('client_id'), ('type'), ('status'), ('created_by'), ('created_at'), ('updated_at')) as c(col)
where has_column_privilege('authenticated', 'public.materials', c.col, 'UPDATE')
union all
select c.col || ' (insert)'
from (values ('id'), ('status'), ('created_at'), ('updated_at')) as c(col)
where has_column_privilege('authenticated', 'public.materials', c.col, 'INSERT')
union all
select 'anon com privilégio em materials'
where has_any_column_privilege('anon', 'public.materials', 'SELECT,INSERT,UPDATE');

-- CHECK: tabelas do schema app acessíveis pela API ou sem RLS (os tíquetes de revisão não podem ser lidos nem forjados)
select c.relname as tabela
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'app' and c.relkind = 'r'
  and (not c.relrowsecurity
       or has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE'));

-- CHECK: funções internas de tíquete e de trava executáveis por algum papel da API (nenhuma pode ser)
select p.proname as funcao, r.rolname as papel
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
where n.nspname = 'app'
  and p.proname in ('grant_revision_ticket', 'has_revision_ticket', 'materials_guard_status', 'materials_guard_content',
                   'freeze_version_content', 'requests_freeze_content', 'material_files_validate')
  and has_function_privilege(r.rolname, p.oid, 'EXECUTE');

-- ---------------------------------------------------------------------------
-- Módulo 3, etapas C e D (migrations 20261105120000 e 20261105120100).
-- ---------------------------------------------------------------------------

-- CHECK: regras de arquivos e conteúdo por versão ausentes ou abertas (C1 e C2)
select 'material_files_validate ausente' as problema
where not exists (
  select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
  where c.relname = 'material_files' and g.tgname = 'material_files_validate' and not g.tgisinternal
)
union all select 'requests_freeze_content ausente'
where not exists (
  select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
  where c.relname = 'approval_requests' and g.tgname = 'requests_freeze_content' and not g.tgisinternal
)
union all select 'material_version_contents ausente ou sem RLS'
where not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'material_version_contents' and c.relrowsecurity
)
union all select 'material_version_contents gravável pelo app ou visível ao anônimo'
where has_any_column_privilege('authenticated', to_regclass('public.material_version_contents'), 'INSERT,UPDATE')
   or has_table_privilege('authenticated', to_regclass('public.material_version_contents'), 'DELETE')
   or has_any_column_privilege('anon', to_regclass('public.material_version_contents'), 'SELECT,INSERT,UPDATE')
union all select 'imutabilidade de material_version_contents ausente'
where not exists (
  select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
  where c.relname = 'material_version_contents' and g.tgname = 'version_contents_immutable' and not g.tgisinternal
);
