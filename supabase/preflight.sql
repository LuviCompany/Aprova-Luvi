-- Aprova Luvi — PRÉ-VOO (somente leitura): rode ANTES de aplicar qualquer migration.
--
-- Cole no SQL Editor do projeto e execute. Os blocos "CHECK" devolvem linhas que indicam que o
-- projeto NÃO está vazio ou já tem algo que conflita: o resultado esperado é "0 linhas" em todos.
-- Os blocos "INFO" só mostram o estado para você conferir (não são violações).
-- Nenhum comando altera dados.
--
-- Se qualquer CHECK devolver linhas: pare, não aplique as migrations e traga o resultado.
-- Um banco vazio é também a melhor evidência de que nenhum aplicativo o usa; para fechar essa
-- conclusão, confira também no painel: Logs > API Gateway (sem tráfego nos últimos dias),
-- Edge Functions (vazio), Database > Webhooks (vazio) e Integrations (nenhuma conectada).

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

-- INFO: extensões instaladas (confira se há alguma que você não reconhece)
select extname as extensao, extversion as versao
from pg_extension
order by extname;

-- INFO: gatilhos de evento do banco (ex.: RLS automática de novas tabelas)
select evtname as gatilho, evtevent as evento, evtenabled as habilitado
from pg_event_trigger
order by evtname;

-- INFO: privilégios padrão para objetos novos (o Supabase concede ao anon/authenticated; a migration 1 revoga)
select pg_get_userbyid(defaclrole) as criador, defaclobjtype as tipo, defaclacl::text as acl
from pg_default_acl
order by 1, 2;
