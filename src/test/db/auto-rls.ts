import type { TestDb } from "./harness";

/**
 * Imita o "RLS automático" que projetos novos do Supabase trazem: função public.rls_auto_enable() (SECURITY
 * DEFINER, search_path = pg_catalog) + event trigger ensure_rls em ddl_command_end. Instale ANTES das
 * migrations para reproduzir o projeto de produção.
 */
export const OFFICIAL_BODY = `
declare cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null and cmd.schema_name in ('public') then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception when others then
        raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
        raise;
      end;
    else
      raise log 'rls_auto_enable: skip %', cmd.object_identity;
    end if;
  end loop;
end;`;

export interface RlsOptions {
  definer?: boolean;
  searchPath?: string;
  body?: string;
  name?: string;
  /** Nome do event trigger; null = sem event trigger. */
  trigger?: string | null;
  tags?: string;
  owner?: string;
}

export async function installAutoRls(db: TestDb, o: RlsOptions = {}) {
  const name = o.name ?? "rls_auto_enable";
  await db.exec(`
    create function public.${name}() returns event_trigger language plpgsql
    ${o.definer === false ? "" : "security definer"}
    set search_path = ${o.searchPath ?? "pg_catalog"}
    as $fn$${o.body ?? OFFICIAL_BODY}$fn$`);
  if (o.owner) await db.exec(`create role ${o.owner}; alter function public.${name}() owner to ${o.owner}`);
  if (o.trigger !== null) {
    await db.exec(
      `create event trigger ${o.trigger ?? "ensure_rls"} on ddl_command_end when tag in (${o.tags ?? "'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'"}) execute function public.${name}()`,
    );
  }
}
