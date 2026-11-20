-- Aprova Luvi — verificação dos privilégios do service_role (migration 16). SOMENTE LEITURA: cole no SQL Editor
-- e clique em Run. Rode ANTES e DEPOIS da migration 16 (20261120120000_service_role_grants).
--
-- Resultado: uma tabela com as colunas bloco, tipo, verificacao e valor.
--   tipo = violacao  -> contagem; DEPOIS da migration, todas precisam ser 0.
--   tipo = impressao -> resumo (md5) do estado; precisa ser IDÊNTICO antes e depois (prova que nada indevido mudou).
--
-- ANTES da migration, num projeto criado depois de 30/05/2026 (produção, medido em 2026-11-20):
--   bloco 1 = 12 e bloco 2 = 12 (privilégios que faltam ao service_role); bloco 3 = 51 (o service_role tem TRUNCATE,
--   REFERENCES e TRIGGER nas 17 tabelas: 17 x 3); blocos 4 a 9 = 0.
-- ANTES, num projeto antigo (desenvolvimento, com privilégios automáticos): os blocos 1 e 2 dão 0 e o bloco 3
--   mostra o EXCESSO (o service_role tem ALL); a migration 16 também o reduz ao mínimo.
-- DEPOIS, em qualquer projeto (a migration revoga os 51 e concede o mínimo): blocos 1 a 9 = 0; as impressões dos blocos 10 a 14 iguais às de antes.
-- Se algo divergir, pare e traga o resultado: não rode a migration de novo nem conceda privilégios à mão.

with expected_table(tbl, priv) as (values
  ('organizations', 'SELECT'), ('profiles', 'SELECT'), ('profiles', 'DELETE'), ('clients', 'SELECT'),
  ('approvers', 'SELECT'), ('approver_invites', 'SELECT'), ('materials', 'SELECT'), ('material_versions', 'SELECT'),
  ('material_version_contents', 'SELECT'), ('material_files', 'SELECT'), ('comments', 'SELECT'), ('decisions', 'SELECT')
),
expected_col(tbl, col, priv) as (values
  ('organizations', 'name', 'INSERT'), ('organizations', 'slug', 'INSERT'),
  ('profiles', 'id', 'INSERT'), ('profiles', 'organization_id', 'INSERT'), ('profiles', 'full_name', 'INSERT'),
  ('profiles', 'email', 'INSERT'), ('profiles', 'role', 'INSERT'),
  ('approvers', 'profile_id', 'UPDATE'),
  ('approver_invites', 'status', 'UPDATE'), ('approver_invites', 'sent_at', 'UPDATE'),
  ('approver_invites', 'expires_at', 'UPDATE'), ('approver_invites', 'accepted_at', 'UPDATE')
),
pub_tables as (
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
sr as (select oid from pg_roles where rolname = 'service_role')
select 1 as bloco, 'violacao' as tipo, 'privilégios de TABELA que faltam ao service_role' as verificacao,
  (select count(*) from expected_table e
    where not has_table_privilege('service_role', format('public.%I', e.tbl), e.priv))::text as valor
union all
select 2, 'violacao', 'privilégios de COLUNA (INSERT/UPDATE) que faltam ao service_role',
  (select count(*) from expected_col e
    where not has_column_privilege('service_role', format('public.%I', e.tbl), e.col, e.priv))::text
union all
select 3, 'violacao', 'privilégios de tabela do service_role ALÉM do necessário',
  (select count(*) from pub_tables t
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    where has_table_privilege('service_role', t.oid, p.priv)
      and not exists (select 1 from expected_table e where e.tbl = t.relname and e.priv = p.priv))::text
union all
select 4, 'violacao', 'privilégios de coluna do service_role além do necessário',
  (select count(*) from pg_attribute a join pub_tables t on t.oid = a.attrelid
    cross join sr
    cross join lateral aclexplode(a.attacl) x
    where a.attacl is not null and a.attnum > 0 and not a.attisdropped and x.grantee = sr.oid
      and not exists (select 1 from expected_col e where e.tbl = t.relname and e.col = a.attname and e.priv = x.privilege_type))::text
union all
select 5, 'violacao', 'service_role com algum privilégio em sequências do schema public (deve ser nenhum)',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and case when c.relkind = 'S' then has_sequence_privilege('service_role', c.oid, 'USAGE,SELECT,UPDATE') else false end)::text
union all
select 6, 'violacao', 'service_role com privilégio direto em tabela do schema app (deve ser nenhum)',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'p')
      and (has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           or has_any_column_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')))::text
union all
select 7, 'violacao', 'tabelas do schema public sem RLS ligada',
  (select count(*) from pub_tables t join pg_class c on c.oid = t.oid where not c.relrowsecurity)::text
union all
select 8, 'violacao', 'privilégios de tabela ou coluna do papel anon no schema public (deve ser nenhum)',
  ((select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public')
   + (select count(*) from information_schema.role_column_grants where grantee = 'anon' and table_schema = 'public'))::text
union all
select 9, 'violacao', 'tabelas esperadas do schema public ausentes (devem ser as 17 do app)',
  (17 - (select count(*) from pub_tables t where t.relname in (
    'organizations', 'profiles', 'clients', 'approvers', 'projects', 'materials', 'material_versions', 'material_files',
    'material_version_contents', 'approval_requests', 'approval_links', 'approval_verifications', 'approval_link_sessions',
    'comments', 'decisions', 'audit_events', 'approver_invites')))::text
union all
select 10, 'impressao', 'md5: privilégios de TABELA de anon e authenticated (public)',
  coalesce(md5(string_agg(grantee || ':' || table_name || ':' || privilege_type, ',' order by grantee, table_name, privilege_type)), '-')
  from information_schema.role_table_grants where grantee in ('anon', 'authenticated') and table_schema = 'public'
union all
select 11, 'impressao', 'md5: privilégios de COLUNA de anon e authenticated (public)',
  coalesce(md5(string_agg(grantee || ':' || table_name || ':' || column_name || ':' || privilege_type, ',' order by grantee, table_name, column_name, privilege_type)), '-')
  from information_schema.role_column_grants where grantee in ('anon', 'authenticated') and table_schema = 'public'
union all
select 12, 'impressao', 'md5: políticas RLS (public, storage e app)',
  coalesce(md5(string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' order by schemaname, tablename, policyname)), '-')
  from pg_policies where schemaname in ('public', 'storage', 'app')
union all
select 13, 'impressao', 'md5: EXECUTE de funções (public e app) para anon, authenticated e service_role',
  coalesce(md5(string_agg(p.oid::regprocedure::text || ':' || r.rolname, ',' order by p.oid::regprocedure::text, r.rolname)), '-')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
  where n.nspname in ('public', 'app') and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
union all
select 14, 'impressao', 'md5: gatilhos do usuário (public) e quantidade de tabelas',
  coalesce(md5(string_agg(c.relname || ':' || t.tgname, ',' order by c.relname, t.tgname)), '-') || ' / ' || count(distinct c.relname)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
order by 1;
