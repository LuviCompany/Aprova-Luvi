-- Aprova Luvi — contagem de linhas por tabela (SOMENTE LEITURA). Usada por scripts/backup-db.ps1 e pelo ensaio de restauração
-- (docs/BACKUP.md): a contagem do banco restaurado precisa ser igual à do backup. Saída: "tabela;linhas".
select table_schema || '.' || table_name as tabela,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as linhas
from information_schema.tables
where table_type = 'BASE TABLE'
  and (table_schema in ('public', 'app') or (table_schema, table_name) in (('auth', 'users'), ('auth', 'identities'), ('storage', 'buckets')))
order by 1;
