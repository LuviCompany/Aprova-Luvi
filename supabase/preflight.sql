-- Aprova Luvi — PRÉ-VOO (somente leitura): rode ANTES de aplicar qualquer migration.
--
-- COMO USAR: o SQL Editor do Supabase mostra apenas o resultado da ÚLTIMA consulta quando se
-- executa vários comandos de uma vez. Por isso:
--   1) Rode SOZINHO o bloco "SUMMARY" abaixo (selecione só ele e clique em Run). Ele devolve UMA
--      tabela com a contagem de cada verificação. Todas as linhas devem ter violacoes = 0.
--   2) Só se alguma linha tiver violacoes > 0, rode o bloco "CHECK" correspondente, também
--      sozinho (selecione só ele), para ver exatamente o que existe.
--   3) Os blocos "INFO" são só para você olhar (rode um por vez); não são violações.
-- Nenhum comando altera dados.
--
-- Se qualquer contagem for maior que 0: pare, não aplique as migrations e traga o resultado.
-- Um banco vazio é também a melhor evidência de que nenhum aplicativo o usa; para fechar essa
-- conclusão, confira também no painel: Logs > API Gateway (sem tráfego nos últimos dias),
-- Edge Functions (vazio), Database > Webhooks (vazio) e Integrations (nenhuma conectada).

-- SUMMARY: contagem de todas as verificações em um único resultado (rode este primeiro)
select verificacao, violacoes
from (
  select 1 as ordem, 'objetos de usuário em public/app (tabelas, funções, tipos)' as verificacao,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'app') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
         and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e'))
    + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'app')
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
         -- Única exceção: a função oficial do "RLS automático" do Supabase, e SÓ se a estrutura inteira bate
         -- (dono, linguagem, SECURITY DEFINER, search_path, corpo e event trigger ensure_rls). Qualquer
         -- variação continua sendo contada. Veja o bloco "CHECK: função public.rls_auto_enable".
         and not coalesce((p.proname = 'rls_auto_enable' and p.pronamespace = 'public'::regnamespace
           and p.pronargs = 0 and p.prorettype = 'event_trigger'::regtype
           and p.prolang = (select l.oid from pg_language l where l.lanname = 'plpgsql')
           and p.prosecdef and p.proowner = 'postgres'::regrole
           and p.proconfig = array['search_path=pg_catalog']
           and p.prosrc ~* 'pg_event_trigger_ddl_commands\(\)' and p.prosrc ~* 'enable row level security'
           and p.prosrc !~* '\m(grant|revoke|drop|truncate|copy|dblink|http)\M|insert\s+into|delete\s+from|update\s+\S+\s+set|create\s+(role|user|function|extension)|set\s+role'
           and cardinality(regexp_split_to_array(lower(p.prosrc), '\mexecute\M')) = 2
           and exists (select 1 from pg_event_trigger e
                       where e.evtfoid = p.oid and e.evtname = 'ensure_rls' and e.evtevent = 'ddl_command_end'
                         and e.evtenabled in ('O', 'A')
                         and e.evttags @> array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']
                         and e.evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'])), false))
    + (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
       where n.nspname in ('public', 'app') and t.typtype in ('e', 'd')
         and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')) as violacoes
  union all select 2, 'schema app já existe', (select count(*) from pg_namespace where nspname = 'app')
  union all select 3, 'usuários no Auth', (select count(*) from auth.users)
  union all select 4, 'buckets do Storage', (select count(*) from storage.buckets)
  union all select 5, 'arquivos no Storage', (select count(*) from storage.objects)
  union all select 6, 'políticas em storage.objects',
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects')
  union all select 7, 'tabelas publicadas no Realtime',
    (select count(*) from pg_publication_tables where pubname = 'supabase_realtime')
) resumo
order by ordem;

-- CHECK: objetos de usuário já existentes nos schemas public e app (tabelas, views, sequências, funções, tipos)
select 'relação' as tipo, n.nspname || '.' || c.relname as nome
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'app') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
union all
select 'função', n.nspname || '.' || p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  and not coalesce((p.proname = 'rls_auto_enable' and p.pronamespace = 'public'::regnamespace
    and p.pronargs = 0 and p.prorettype = 'event_trigger'::regtype
    and p.prolang = (select l.oid from pg_language l where l.lanname = 'plpgsql')
    and p.prosecdef and p.proowner = 'postgres'::regrole
    and p.proconfig = array['search_path=pg_catalog']
    and p.prosrc ~* 'pg_event_trigger_ddl_commands\(\)' and p.prosrc ~* 'enable row level security'
    and p.prosrc !~* '\m(grant|revoke|drop|truncate|copy|dblink|http)\M|insert\s+into|delete\s+from|update\s+\S+\s+set|create\s+(role|user|function|extension)|set\s+role'
    and cardinality(regexp_split_to_array(lower(p.prosrc), '\mexecute\M')) = 2
    and exists (select 1 from pg_event_trigger e
                where e.evtfoid = p.oid and e.evtname = 'ensure_rls' and e.evtevent = 'ddl_command_end'
                  and e.evtenabled in ('O', 'A')
                  and e.evttags @> array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']
                  and e.evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'])), false)
union all
select 'tipo', n.nspname || '.' || t.typname
from pg_type t join pg_namespace n on n.oid = t.typnamespace
where n.nspname in ('public', 'app') and t.typtype in ('e', 'd')
  and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e');

-- CHECK: schema "app" já existe (as migrations o criam; um preexistente indica uso anterior)
select nspname as schema
from pg_namespace
where nspname = 'app';

-- CHECK: usuários já cadastrados no Auth do projeto
select id, email
from auth.users
limit 20;

-- CHECK: buckets do Storage já existentes
select id as bucket, public
from storage.buckets;

-- CHECK: arquivos já existentes no Storage
select bucket_id, count(*) as arquivos
from storage.objects
group by bucket_id;

-- CHECK: políticas já existentes em storage.objects
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects';

-- CHECK: tabelas já publicadas no Realtime
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime';

-- CHECK: função public.rls_auto_enable (RLS automática do Supabase) presente, mas FORA do padrão esperado
-- (vazio = não existe ou é exatamente a função oficial: SECURITY DEFINER, search_path = pg_catalog, plpgsql,
-- dono postgres, corpo que só habilita RLS e event trigger ensure_rls em ddl_command_end para CREATE TABLE,
-- CREATE TABLE AS e SELECT INTO). Se aparecer uma linha, ela é contada no SUMMARY e o que difere está aqui.
select p.proname as funcao,
       pg_get_userbyid(p.proowner) as dono,
       (select l.lanname from pg_language l where l.oid = p.prolang) as linguagem,
       p.prosecdef as security_definer,
       p.proconfig::text as configuracao,
       p.prorettype::regtype::text as retorno,
       (select string_agg(e.evtname || ' (' || e.evtevent || ')', ', ') from pg_event_trigger e where e.evtfoid = p.oid) as event_triggers
from pg_proc p
where p.proname = 'rls_auto_enable' and p.pronamespace = 'public'::regnamespace
  and not coalesce((p.pronargs = 0 and p.prorettype = 'event_trigger'::regtype
    and p.prolang = (select l.oid from pg_language l where l.lanname = 'plpgsql')
    and p.prosecdef and p.proowner = 'postgres'::regrole
    and p.proconfig = array['search_path=pg_catalog']
    and p.prosrc ~* 'pg_event_trigger_ddl_commands\(\)' and p.prosrc ~* 'enable row level security'
    and p.prosrc !~* '\m(grant|revoke|drop|truncate|copy|dblink|http)\M|insert\s+into|delete\s+from|update\s+\S+\s+set|create\s+(role|user|function|extension)|set\s+role'
    and cardinality(regexp_split_to_array(lower(p.prosrc), '\mexecute\M')) = 2
    and exists (select 1 from pg_event_trigger e
                where e.evtfoid = p.oid and e.evtname = 'ensure_rls' and e.evtevent = 'ddl_command_end'
                  and e.evtenabled in ('O', 'A')
                  and e.evttags @> array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']
                  and e.evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'])), false);

-- INFO: RLS automática do Supabase (public.rls_auto_enable + event trigger ensure_rls): definição, dono e permissões
select pg_get_functiondef(p.oid) as definicao,
       pg_get_userbyid(p.proowner) as dono,
       p.proacl::text as permissoes_execute,
       (select string_agg(e.evtname || ': ' || e.evtevent || ' ' || e.evttags::text || ' (' || e.evtenabled::text || ')', '; ')
          from pg_event_trigger e where e.evtfoid = p.oid) as event_trigger
from pg_proc p
where p.proname = 'rls_auto_enable' and p.pronamespace = 'public'::regnamespace;

-- INFO: extensões instaladas (confira se há alguma que você não reconhece)
select extname as extensao, extversion as versao
from pg_extension
order by extname;

-- INFO: gatilhos de evento do banco (ex.: RLS automática de novas tabelas)
select evtname as gatilho, evtevent as evento, evtenabled as habilitado
from pg_event_trigger
order by evtname;

-- INFO: privilégios padrão para objetos novos (o Supabase concede ao anon/authenticated; a migration 1 revoga)
select pg_get_userbyid(defaclrole) as criador,
       case when defaclnamespace = 0 then '(global)' else defaclnamespace::regnamespace::text end as schema,
       case defaclobjtype when 'r' then 'tabelas' when 'S' then 'sequências' when 'f' then 'funções'
                          when 'T' then 'tipos' when 'n' then 'schemas' else defaclobjtype::text end as objetos,
       defaclacl::text as acl
from pg_default_acl
order by 1, 2, 3;
