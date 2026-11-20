// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IDS, createMaterial, createTestDb, seedBase, uid, type TestDb } from "./harness";

/**
 * Migration 16: privilégios explícitos do service_role.
 *
 * Desde 30/05/2026 os projetos novos do Supabase não dão mais privilégios automáticos nas tabelas do schema public
 * (o de produção nasceu assim; o de desenvolvimento, não). O harness reproduz os dois modos: "legacy" (ALL por padrão) e
 * "2026" (nada por padrão). Aqui se prova: (1) a falha de produção existe sem a migration; (2) com ela, cada operação que
 * o código do servidor faz com a chave secreta funciona; (3) nada além disso funciona; (4) nada mais mudou no banco.
 */

const M16 = "20261120120000";
const migration = readFileSync(join(process.cwd(), "supabase", "migrations", `${M16}_service_role_grants.sql`), "utf8");
const verifySql = readFileSync(join(process.cwd(), "supabase", "verify-service-role.sql"), "utf8");

type Check = { bloco: number; tipo: string; verificacao: string; valor: string };
const runVerify = async (db: TestDb): Promise<Check[]> => (await db.query<Check>(verifySql)).rows;
const violations = (rows: Check[]) => Object.fromEntries(rows.filter((r) => r.tipo === "violacao").map((r) => [r.bloco, Number(r.valor)]));
const prints = (rows: Check[]) => Object.fromEntries(rows.filter((r) => r.tipo === "impressao").map((r) => [r.bloco, r.valor]));

const denied = async (db: TestDb, sql: string, params: unknown[] = []) => {
  await expect(db.asService(() => db.query(sql, params))).rejects.toThrow(/permission denied/i);
};

interface Env {
  db: TestDb;
  before: Check[];
  after: Check[];
}
const envs = {} as Record<"2026" | "legacy", Env>;

beforeAll(async () => {
  for (const mode of ["2026", "legacy"] as const) {
    const db = await createTestDb({ supabaseDefaults: mode, stopBefore: M16 });
    await seedBase(db);
    const before = await runVerify(db);
    envs[mode] = { db, before, after: [] };
  }
});

describe("antes da migration 16 (projeto novo do Supabase, como a produção)", () => {
  it("reproduz o erro de produção: o service_role não lê profiles (42501)", async () => {
    await expect(envs["2026"].db.asService(() => envs["2026"].db.query("select count(*) from public.profiles"))).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("o SQL de verificação acusa o que a produção mostrou: 12 + 12 privilégios que faltam e 51 a mais (17 tabelas x TRUNCATE/REFERENCES/TRIGGER)", async () => {
    expect(violations(envs["2026"].before)).toEqual({ 1: 12, 2: 12, 3: 51, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 });
    const extra = await envs["2026"].db.query<{ priv: string; n: string }>(
      `select p.priv, count(*)::text as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
         cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
        where s.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege('service_role', c.oid, p.priv)
        group by p.priv order by 1`,
    );
    expect(extra.rows).toEqual([
      { priv: "REFERENCES", n: "17" },
      { priv: "TRIGGER", n: "17" },
      { priv: "TRUNCATE", n: "17" },
    ]);
  });

  it("no projeto antigo (desenvolvimento) não falta nada, mas há EXCESSO (ALL por padrão)", () => {
    const v = violations(envs.legacy.before);
    expect(v[1]).toBe(0);
    expect(v[2]).toBe(0);
    expect(v[3]).toBeGreaterThan(0);
  });
});

describe("depois da migration 16", () => {
  beforeAll(async () => {
    for (const mode of ["2026", "legacy"] as const) {
      await envs[mode].db.exec(migration);
      envs[mode].after = await runVerify(envs[mode].db);
    }
  });

  it("todas as verificações de violação ficam em 0, nos dois tipos de projeto", () => {
    for (const mode of ["2026", "legacy"] as const) {
      expect(violations(envs[mode].after), mode).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 });
    }
  });

  it("nada indevido mudou: privilégios de anon/authenticated, políticas, funções e gatilhos idênticos", () => {
    for (const mode of ["2026", "legacy"] as const) {
      expect(prints(envs[mode].after), mode).toEqual(prints(envs[mode].before));
    }
  });

  it("anon e authenticated ficam iguais no projeto novo e no antigo (as migrations 1 a 15 bastam sem os padrões)", () => {
    const novo = prints(envs["2026"].after);
    const antigo = prints(envs.legacy.after);
    expect(novo[10]).toBe(antigo[10]); // tabelas
    expect(novo[11]).toBe(antigo[11]); // colunas
    expect(novo[12]).toBe(antigo[12]); // políticas
  });

  it("o estado final do service_role é igual nos dois tipos de projeto e a migration é repetível", async () => {
    const { db } = envs["2026"];
    await db.exec(migration);
    expect(violations(await runVerify(db))).toEqual(violations(envs["2026"].after));
  });
});

describe("o que o código do servidor faz com a chave secreta funciona (projeto novo, sem padrões)", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = envs["2026"].db; // migration 16 já aplicada pelo bloco anterior
    await db.query("insert into public.approver_invites (approver_id, client_id, prepared_by) values ($1,$2,$3)", [
      IDS.aprovadorALink,
      IDS.clienteA,
      IDS.admin,
    ]);
  });

  const svc = <T>(fn: () => Promise<T>) => db.asService(fn);

  it("bootstrap-admin: lê perfis, cria a organização e o perfil admin", async () => {
    const adminId = uid(900);
    await db.query("insert into auth.users (id, email) values ($1, 'novo-admin@luvi.test')", [adminId]);
    await svc(async () => {
      const count = await db.query<{ n: string }>("select count(*)::text as n from public.profiles");
      expect(Number(count.rows[0].n)).toBeGreaterThan(0);
      const org = await db.query<{ id: string }>("insert into public.organizations (name, slug) values ('Luvi Company', 'luvi-company') returning id");
      await db.query("select id from public.organizations where slug = 'luvi-company'");
      await db.query("insert into public.profiles (id, organization_id, full_name, email, role) values ($1,$2,'Admin Novo','novo-admin@luvi.test','admin')", [
        adminId,
        org.rows[0].id,
      ]);
      await db.query("select id, email, role from public.profiles where email = 'novo-admin@luvi.test'");
    });
  });

  it("convite de aprovador: consulta, cria o perfil, liga ao aprovador, atualiza o convite e desfaz", async () => {
    const userId = uid(901);
    await db.query("insert into auth.users (id, email) values ($1, 'link@clientea.test')", [userId]);
    await svc(async () => {
      await db.query("select id, client_id, name, email, active, profile_id from public.approvers where id = $1", [IDS.aprovadorALink]);
      await db.query("select id, name, active, organization_id from public.clients where id = $1", [IDS.clienteA]);
      await db.query("select id, status, sent_at from public.approver_invites where approver_id = $1 and status in ('preparado','enviado')", [IDS.aprovadorALink]);
      await db.query("select id from public.profiles where email = 'link@clientea.test'");
      await db.query("insert into public.profiles (id, organization_id, full_name, email, role) values ($1,$2,'Aprovador Link','link@clientea.test','cliente')", [userId, IDS.orgLuvi]);
      await db.query("update public.approvers set profile_id = $1 where id = $2", [userId, IDS.aprovadorALink]);
      await db.query("update public.approver_invites set status = 'enviado', sent_at = now(), expires_at = now() + interval '1 day' where approver_id = $1", [IDS.aprovadorALink]);
      await db.query("update public.approver_invites set status = 'aceito', accepted_at = now() where approver_id = $1 and status = 'enviado'", [IDS.aprovadorALink]);
      // desfazer (caminho de falha do envio)
      await db.query("update public.approver_invites set status = 'preparado', sent_at = null, expires_at = null where approver_id = $1", [IDS.aprovadorALink]);
      await db.query("update public.approvers set profile_id = null where id = $1", [IDS.aprovadorALink]);
      await db.query("delete from public.profiles where id = $1", [userId]);
    });
    // a auditoria dos gatilhos foi gravada mesmo sem o service_role ter acesso a audit_events
    const audit = await db.query<{ n: string }>("select count(*)::text as n from public.audit_events where entity_id = $1", [IDS.aprovadorALink]);
    expect(Number(audit.rows[0].n)).toBeGreaterThan(0);
  });

  it("revisão pelo link e arquivos: lê material, versão, conteúdo congelado, arquivos, comentários e decisões", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true });
    await svc(async () => {
      await db.query("select status from public.materials where id = $1 and client_id = $2", [m.materialId, IDS.clienteA]);
      await db.query("select number from public.material_versions where id = $1", [m.versionId]);
      await db.query("select frozen_at, content from public.material_version_contents where version_id = $1", [m.versionId]);
      const files = await db.query("select id, storage_path from public.material_files where version_id = $1", [m.versionId]);
      expect(files.rows).toHaveLength(1);
      await db.query("select id, author_name, body from public.comments where material_id = $1", [m.materialId]);
      await db.query("select id, decision, via, note from public.decisions where material_id = $1", [m.materialId]);
    });
  });

  it("as funções do fluxo por link continuam executáveis pelo service_role (e não falham por permissão)", async () => {
    await svc(async () => {
      const r = await db.query("select public.link_resolve($1) as r", ["a".repeat(64)]);
      expect(r.rows).toHaveLength(1);
    });
  });
});

describe("e nada além disso (princípio do mínimo privilégio)", () => {
  const db = () => envs["2026"].db;

  it("não lê as tabelas de segredo, solicitações, projetos nem auditoria", async () => {
    for (const t of ["approval_links", "approval_verifications", "approval_link_sessions", "approval_requests", "projects", "audit_events"]) {
      await denied(db(), `select 1 from public.${t} limit 1`);
    }
  });

  it("não escreve em decisões, comentários, versões, arquivos, materiais, clientes nem projetos", async () => {
    for (const sql of [
      "insert into public.decisions (id) values (gen_random_uuid())",
      "update public.decisions set note = 'x'",
      "delete from public.decisions",
      "insert into public.comments (id) values (gen_random_uuid())",
      "delete from public.comments",
      "update public.material_versions set note = 'x'",
      "delete from public.material_files",
      "update public.materials set title = 'x'",
      "insert into public.clients (id) values (gen_random_uuid())",
      "update public.clients set name = 'x'",
      "update public.approvers set name = 'x'",
      "update public.approver_invites set prepared_by = null",
      "update public.profiles set role = 'admin'",
      "insert into public.organizations (id) values (gen_random_uuid())",
      "delete from public.organizations",
    ]) {
      await denied(db(), sql);
    }
  });

  it("não faz TRUNCATE e não lê nem escreve no schema app", async () => {
    await denied(db(), "truncate public.profiles");
    await denied(db(), "select 1 from app.revision_tickets limit 1");
    await denied(db(), "insert into app.revision_tickets (material_id, txid, actor) values (gen_random_uuid(), 1, gen_random_uuid())");
  });
});
