// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, errorOf, seedBase, type TestDb } from "./harness";

/**
 * Auditoria por introspecção: em vez de testar casos, varre o catálogo do Postgres e exige que
 * NENHUM objeto exista com permissão além da lista abaixo. Se alguém criar uma tabela, função
 * ou política nova com acesso aberto por engano, estes testes quebram.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await seedBase(db);
}, 60_000);

afterAll(async () => {
  await db.close();
});

const q = async <T extends Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;

const tables = async () => (await q<{ relname: string }>(
  `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' order by 1`,
)).map((r) => r.relname);

const hasTable = async (role: string, table: string, privs: string) =>
  (await q<{ ok: boolean }>(`select has_table_privilege('${role}', 'public.${table}', '${privs}') as ok`))[0].ok;
const hasAnyColumn = async (role: string, table: string, privs: string) =>
  (await q<{ ok: boolean }>(`select has_any_column_privilege('${role}', 'public.${table}', '${privs}') as ok`))[0].ok;
const hasColumn = async (role: string, table: string, column: string, privs: string) =>
  (await q<{ ok: boolean }>(`select has_column_privilege('${role}', 'public.${table}', '${column}', '${privs}') as ok`))[0].ok;

describe("tabelas", () => {
  it("anônimo não tem NENHUM privilégio em NENHUMA tabela", async () => {
    for (const t of await tables()) {
      expect(await hasAnyColumn("anon", t, "SELECT,INSERT,UPDATE,REFERENCES"), t).toBe(false);
      expect(await hasTable("anon", t, "SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER"), t).toBe(false);
    }
  });

  it("usuários autenticados nunca podem truncar, referenciar nem criar trigger em tabela alguma", async () => {
    for (const t of await tables()) {
      expect(await hasTable("authenticated", t, "TRUNCATE,REFERENCES,TRIGGER"), t).toBe(false);
    }
  });

  it("tabelas de registro imutável não são alteráveis pelo app (nem por coluna)", async () => {
    for (const t of ["decisions", "audit_events", "material_versions", "comments", "approval_links", "approval_requests"]) {
      expect(await hasAnyColumn("authenticated", t, "UPDATE"), `${t} UPDATE`).toBe(false);
      expect(await hasTable("authenticated", t, "DELETE"), `${t} DELETE`).toBe(false);
    }
  });

  it("decisões e auditoria nem aceitam INSERT do app (só as funções do banco gravam)", async () => {
    for (const t of ["decisions", "audit_events", "approval_links"]) {
      expect(await hasAnyColumn("authenticated", t, "INSERT"), t).toBe(false);
    }
  });

  it("segredos do fluxo por link não têm nenhum acesso para o app", async () => {
    for (const t of ["approval_verifications", "approval_link_sessions"]) {
      expect(await hasAnyColumn("authenticated", t, "SELECT,INSERT,UPDATE"), t).toBe(false);
      expect(await hasTable("authenticated", t, "DELETE"), t).toBe(false);
    }
  });

  it("colunas sensíveis ficam fora dos grants", async () => {
    expect(await hasColumn("authenticated", "approval_links", "token_hash", "SELECT")).toBe(false);
    expect(await hasColumn("authenticated", "materials", "status", "UPDATE")).toBe(false);
    expect(await hasColumn("authenticated", "materials", "status", "INSERT")).toBe(false);
    expect(await hasColumn("authenticated", "profiles", "role", "UPDATE")).toBe(false);
    expect(await hasColumn("authenticated", "profiles", "active", "UPDATE")).toBe(false);
    expect(await hasColumn("authenticated", "profiles", "organization_id", "UPDATE")).toBe(false);
    expect(await hasColumn("authenticated", "approvers", "profile_id", "INSERT")).toBe(false);
    expect(await hasColumn("authenticated", "approvers", "profile_id", "UPDATE")).toBe(false);
    expect(await hasColumn("authenticated", "clients", "organization_id", "UPDATE")).toBe(false);
    expect(await hasColumn("authenticated", "materials", "created_at", "INSERT")).toBe(false);
    expect(await hasColumn("authenticated", "comments", "author_name", "INSERT")).toBe(false);
  });

  it("o servidor (service_role) mantém acesso total", async () => {
    for (const t of await tables()) {
      expect(await hasTable("service_role", t, "SELECT,INSERT,UPDATE"), t).toBe(true);
    }
  });
});

describe("funções", () => {
  const AUTHENTICATED_ALLOWED = [
    "public.decide_as_approver",
    "public.create_approval_link",
    "public.revoke_approval_link",
    "public.cancel_approval_request",
    "app.my_role",
    "app.my_org",
    "app.is_staff",
    "app.is_admin",
    "app.can_manage_clients",
    "app.staff_can_access",
    "app.my_client_ids",
    "app.my_approver_id",
    "app.version_was_sent",
    "app.material_was_sent",
    "app.material_visible_project",
    "app.try_uuid",
  ].sort();

  const functions = () =>
    q<{ name: string; sig: string; secdef: boolean; config: string[] | null; anon: boolean; auth: boolean; service: boolean }>(
      `select n.nspname || '.' || p.proname as name, p.oid::regprocedure::text as sig,
              p.prosecdef as secdef, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'app') order by 1`,
    );

  it("anônimo não executa nenhuma função dos schemas public e app", async () => {
    const offenders = (await functions()).filter((f) => f.anon).map((f) => f.sig);
    expect(offenders).toEqual([]);
  });

  it("usuários autenticados executam EXATAMENTE a lista permitida (nada a mais)", async () => {
    const granted = [...new Set((await functions()).filter((f) => f.auth).map((f) => f.name))].sort();
    expect(granted).toEqual(AUTHENTICATED_ALLOWED);
  });

  it("decide_via_link e o núcleo de decisão são exclusivos do servidor", async () => {
    const byName = Object.fromEntries((await functions()).map((f) => [f.name, f]));
    expect(byName["public.decide_via_link"].auth).toBe(false);
    expect(byName["public.decide_via_link"].anon).toBe(false);
    expect(byName["public.decide_via_link"].service).toBe(true);
    expect(byName["app.record_decision"].auth).toBe(false);
    expect(byName["app.write_audit"].auth).toBe(false);
  });

  it("toda função SECURITY DEFINER fixa search_path vazio (sem sequestro por schema)", async () => {
    const definers = (await functions()).filter((f) => f.secdef);
    expect(definers.length).toBeGreaterThan(10);
    const bad = definers.filter((f) => !(f.config ?? []).includes('search_path=""')).map((f) => f.sig);
    expect(bad).toEqual([]);
  });
});

describe("políticas RLS", () => {
  it("toda política vale só para 'authenticated' (nenhuma para anon ou PUBLIC)", async () => {
    const rows = await q<{ tablename: string; policyname: string; roles: string[] | string }>(
      "select tablename, policyname, roles from pg_policies where schemaname in ('public','storage')",
    );
    expect(rows.length).toBeGreaterThan(30);
    const bad = rows
      .filter((r) => String(Array.isArray(r.roles) ? r.roles.join(",") : r.roles).replace(/[{}]/g, "") !== "authenticated")
      .map((r) => `${r.tablename}.${r.policyname}`);
    expect(bad).toEqual([]);
  });

  it("toda política do storage está presa ao bucket 'materials'", async () => {
    const rows = await q<{ policyname: string; qual: string | null; with_check: string | null }>(
      "select policyname, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects'",
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(`${r.qual ?? ""}${r.with_check ?? ""}`, r.policyname).toContain("materials");
  });

  it("o storage não tem política de UPDATE (uploads não sobrescrevem arquivos)", async () => {
    const rows = await q<{ cmd: string }>("select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'");
    expect(rows.map((r) => r.cmd).sort()).toEqual(["DELETE", "INSERT", "SELECT", "SELECT"]);
  });
});

describe("privilégios padrão para objetos FUTUROS", () => {
  it("uma tabela criada depois das migrations nasce fechada para anon e authenticated", async () => {
    await db.exec("create table public.zz_futura (id int)");
    try {
      expect(await hasAnyColumn("anon", "zz_futura", "SELECT,INSERT,UPDATE")).toBe(false);
      expect(await hasAnyColumn("authenticated", "zz_futura", "SELECT,INSERT,UPDATE")).toBe(false);
      expect(await hasTable("authenticated", "zz_futura", "DELETE,TRUNCATE")).toBe(false);
      expect(await hasTable("service_role", "zz_futura", "SELECT")).toBe(true);
    } finally {
      await db.exec("drop table public.zz_futura");
    }
  });

  it("função nova só fica fechada com REVOKE explícito (limitação do Postgres, vigiada pela auditoria acima)", async () => {
    await db.exec("create function public.zz_f() returns int language sql as 'select 1'");
    await db.exec("create function app.zz_g() returns int language sql as 'select 1'");
    const has = async (role: string, sig: string) =>
      (await q<{ ok: boolean }>(`select has_function_privilege('${role}', '${sig}', 'EXECUTE') as ok`))[0].ok;
    try {
      // Sem o REVOKE, o EXECUTE implícito de PUBLIC deixa o anônimo chamar a função. É por isso que
      // a auditoria "anônimo não executa nenhuma função" existe: ela reprova esse esquecimento.
      expect(await has("anon", "public.zz_f()")).toBe(true);

      await db.exec("revoke execute on function public.zz_f() from public, anon; revoke execute on function app.zz_g() from public, anon;");
      for (const sig of ["public.zz_f()", "app.zz_g()"]) {
        expect(await has("anon", sig), sig).toBe(false);
        expect(await has("authenticated", sig), sig).toBe(false);
      }
      const erro = await db.asUser("00000000-0000-4000-8000-000000000010", () => errorOf(() => db.query("select public.zz_f()")));
      expect(erro).toMatch(/permission denied/);
    } finally {
      await db.exec("drop function public.zz_f(); drop function app.zz_g();");
    }
  });
});
