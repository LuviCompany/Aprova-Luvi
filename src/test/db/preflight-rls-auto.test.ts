// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

/**
 * Projetos novos do Supabase podem vir com o "RLS automático": função public.rls_auto_enable() + event
 * trigger ensure_rls. O pré-voo (supabase/preflight.sql) aceita EXCLUSIVAMENTE esse objeto e só se a estrutura
 * inteira bater (dono, linguagem, SECURITY DEFINER, search_path, corpo e event trigger). Qualquer variação, ou
 * qualquer outro objeto, continua sendo acusado. As mesmas regras valem nos blocos do verify.sql que olham
 * funções (executáveis por anon/authenticated e SECURITY DEFINER sem search_path vazio).
 */

const parse = (file: string) =>
  readFileSync(join(process.cwd(), "supabase", file), "utf8")
    .split(/^-- (?=SUMMARY:|CHECK:|INFO:)/m)
    .slice(1)
    .map((block) => {
      const [head, ...rest] = block.split("\n");
      const kind = head.startsWith("SUMMARY:") ? "summary" : head.startsWith("CHECK:") ? "check" : "info";
      return { kind, title: head.replace(/^(CHECK|INFO):\s*/, "").trim(), query: rest.join("\n").replace(/^--.*$/gm, "").trim().replace(/;\s*$/, "") };
    });

const preflight = parse("preflight.sql");
const summary = preflight.find((b) => b.kind === "summary")!;
const checks = preflight.filter((b) => b.kind === "check");
const infos = preflight.filter((b) => b.kind === "info");
const objectsCheck = checks[0];
const diagnostic = checks.find((c) => c.title.startsWith("função public.rls_auto_enable"))!;

const verify = readFileSync(join(process.cwd(), "supabase", "verify.sql"), "utf8")
  .split(/^-- CHECK: /m)
  .slice(1)
  .map((block) => {
    const [title, ...rest] = block.split("\n");
    return { title: title.trim(), query: rest.join("\n").replace(/^--.*$/gm, "").trim().replace(/;\s*$/, "") };
  });
const verifyFunctionChecks = [
  "funções de public/app executáveis pelo anônimo",
  "funções executáveis por authenticated fora da lista permitida",
  "funções SECURITY DEFINER sem search_path vazio",
].map((start) => verify.find((c) => c.title.startsWith(start))!);

const OFFICIAL_BODY = `
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

interface RlsOptions {
  definer?: boolean;
  searchPath?: string;
  body?: string;
  name?: string;
  /** Nome do event trigger; null = sem event trigger. */
  trigger?: string | null;
  tags?: string;
  owner?: string;
}

async function installAutoRls(db: TestDb, o: RlsOptions = {}) {
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

async function withDb<T>(fn: (db: TestDb) => Promise<T>, migrate = false) {
  const db = await createTestDb({ migrate });
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

const row1 = async (db: TestDb) => Number((await db.query<{ violacoes: string | number }>(summary.query)).rows[0].violacoes);

const variants: Array<[string, RlsOptions]> = [
  ["sem SECURITY DEFINER", { definer: false }],
  ["search_path diferente de pg_catalog", { searchPath: "public" }],
  ["sem o event trigger", { trigger: null }],
  ["event trigger com outro nome", { trigger: "outro_gatilho" }],
  ["event trigger para tags diferentes", { tags: "'CREATE TABLE'" }],
  ["dono diferente de postgres", { owner: "dono_falso" }],
  ["corpo com instrução extra (concessão de privilégios)", { body: OFFICIAL_BODY.replace("raise log 'rls_auto_enable: skip %'", "grant all on all tables in schema public to anon; raise log 'x %'") }],
  ["corpo com um segundo EXECUTE", { body: OFFICIAL_BODY.replace("raise log 'rls_auto_enable: skip %'", "execute 'select 1'; raise log 'x %'") }],
  ["corpo que não habilita RLS", { body: OFFICIAL_BODY.replace(/enable row level security/g, "force row level security") }],
];

describe("supabase/preflight.sql: RLS automática do Supabase (rls_auto_enable)", () => {
  it("aceita a função oficial com o event trigger ensure_rls: o SUMMARY zera e nenhum bloco acusa", async () => {
    await withDb(async (db) => {
      await installAutoRls(db);
      const rows = (await db.query<{ violacoes: string | number }>(summary.query)).rows;
      expect(rows.map((r) => Number(r.violacoes))).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect((await db.query(objectsCheck.query)).rows).toEqual([]);
      expect((await db.query(diagnostic.query)).rows).toEqual([]);
      for (const i of infos) await expect(db.query(i.query)).resolves.toBeDefined();
    });
  });

  it("a função oficial não pode ser chamada diretamente (retorna event_trigger)", async () => {
    await withDb(async (db) => {
      await installAutoRls(db);
      await expect(db.query("select public.rls_auto_enable()")).rejects.toThrow(/trigger/i);
    });
  });

  it("o bloco INFO mostra definição, dono, permissões e event trigger", async () => {
    await withDb(async (db) => {
      await installAutoRls(db);
      const info = infos.find((i) => i.title.startsWith("RLS automática"))!;
      const rows = (await db.query<Record<string, string>>(info.query)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].definicao).toContain("rls_auto_enable");
      expect(rows[0].dono).toBe("postgres");
      expect(rows[0].event_trigger).toContain("ensure_rls");
    });
  });

  for (const [label, options] of variants) {
    it(`ACUSA a função se for diferente do padrão: ${label}`, async () => {
      await withDb(async (db) => {
        await installAutoRls(db, options);
        expect(await row1(db), "SUMMARY linha 1").toBe(1);
        expect((await db.query(objectsCheck.query)).rows).toEqual([{ tipo: "função", nome: "public.rls_auto_enable" }]);
        expect((await db.query(diagnostic.query)).rows).toHaveLength(1);
      });
    });
  }

  it("ACUSA outra função qualquer, mesmo com a oficial presente e válida", async () => {
    await withDb(async (db) => {
      await installAutoRls(db);
      await db.exec("create function public.minha_funcao() returns int language sql as 'select 1'");
      expect(await row1(db)).toBe(1);
      expect((await db.query(objectsCheck.query)).rows).toEqual([{ tipo: "função", nome: "public.minha_funcao" }]);
    });
  });

  it("ACUSA uma função com a mesma estrutura, mas com outro nome", async () => {
    await withDb(async (db) => {
      await installAutoRls(db, { name: "rls_auto_enable_2" });
      expect(await row1(db)).toBe(1);
      expect((await db.query(objectsCheck.query)).rows).toEqual([{ tipo: "função", nome: "public.rls_auto_enable_2" }]);
    });
  });

  it("uma tabela solta continua acusada com a RLS automática instalada", async () => {
    await withDb(async (db) => {
      await installAutoRls(db);
      await db.exec("create table public.alguma_coisa (id int)");
      expect(await row1(db)).toBe(1);
      expect((await db.query(objectsCheck.query)).rows).toEqual([{ tipo: "relação", nome: "public.alguma_coisa" }]);
    });
  });
});

describe("a condição da exceção é idêntica em todos os lugares", () => {
  it("preflight (SUMMARY e CHECK) e verify (3 blocos) usam exatamente o mesmo texto", () => {
    const read = (file: string) => readFileSync(join(process.cwd(), "supabase", file), "utf8");
    const find = (text: string) =>
      (text.match(/not coalesce\(\(p\.proname = 'rls_auto_enable'[\s\S]*?\), false\)/g) ?? []).map((m) => m.replace(/\s+/g, " "));
    const inPreflight = find(read("preflight.sql"));
    const inVerify = find(read("verify.sql"));
    expect(inPreflight).toHaveLength(2);
    expect(inVerify).toHaveLength(3);
    expect(new Set([...inPreflight, ...inVerify]).size).toBe(1);
  });
});

describe("supabase/verify.sql: a mesma exceção, e só ela, nos blocos que olham funções", () => {
  it("os três blocos existem", () => {
    for (const c of verifyFunctionChecks) expect(c, "bloco ausente").toBeDefined();
  });

  it("com a função oficial instalada (executável por PUBLIC, como no Supabase) nenhum bloco acusa", async () => {
    await withDb(async (db) => {
      await installAutoRls(db);
      const { rows } = await db.query<{ ok: boolean }>("select has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE') as ok");
      expect(rows[0].ok, "o teste precisa exercitar a exceção: anon tem EXECUTE por PUBLIC").toBe(true);
      for (const c of verifyFunctionChecks) expect((await db.query(c.query)).rows, c.title).toEqual([]);
    }, true);
  });

  for (const [label, options] of variants) {
    it(`ACUSA no verify.sql se a função for diferente do padrão: ${label}`, async () => {
      await withDb(async (db) => {
        await installAutoRls(db, options);
        const flagged = await Promise.all(verifyFunctionChecks.map(async (c) => (await db.query(c.query)).rows.length));
        expect(flagged.some((n) => n > 0), label).toBe(true);
      }, true);
    });
  }
});
