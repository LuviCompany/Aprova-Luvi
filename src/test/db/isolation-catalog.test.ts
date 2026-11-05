// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, createMaterial, createTestDb, openLinkSession, seedBase, sha256Hex, type SentMaterial, type TestDb } from "./harness";

/**
 * Isolamento entre clientes dirigido pelo CATÁLOGO: para TODA tabela do schema public que tem `client_id` (inclusive as que
 * forem criadas no futuro), um aprovador de OUTRO cliente, a equipe de OUTRA agência e o anônimo enxergam ZERO linhas do
 * cliente A, e o storage dele também. Se alguém criar uma tabela nova com client_id e esquecer a RLS, este teste reprova.
 */

let db: TestDb;
let a: SentMaterial;
let tables: string[] = [];

const countFor = async (role: "userB" | "outraAgencia" | "anon" | "designer" | "userA", sql: string, params: unknown[] = []): Promise<number> => {
  const run = async () => Number((await db.query<{ n: string }>(sql, params)).rows[0].n);
  try {
    if (role === "anon") return await db.asAnon(run);
    const user = { userB: IDS.userClienteB, outraAgencia: IDS.staffOutraOrg, designer: IDS.designer, userA: IDS.userClienteA }[role];
    return await db.asUser(user, run);
  } catch (error) {
    if (/permission denied/i.test((error as Error).message)) return 0; // sem grant = sem acesso
    throw error;
  }
};

beforeAll(async () => {
  db = await createTestDb();
  await seedBase(db);
  // Um ciclo completo do cliente A: envio, link com sessão, comentário, decisão, convite e auditoria.
  a = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true, approverId: IDS.aprovadorALink });
  const token = "isolamento-a";
  await db.asUser(IDS.designer, () =>
    db.query("select public.create_approval_link($1,$2,$3, now() + interval '7 days')", [a.requestId, IDS.aprovadorALink, sha256Hex(token)]),
  );
  await openLinkSession(db, token); // approval_verifications + approval_link_sessions
  await db.asUser(IDS.designer, () =>
    db.query("insert into public.comments (material_id, version_id, client_id, slide, author_role, author_profile_id, body) values ($1,$2,$3,null,'luvi',$4,'Comentário da equipe')", [a.materialId, a.versionId, IDS.clienteA, IDS.designer]),
  );
  await db.asUser(IDS.admin, () => db.query("select public.prepare_approver_invite($1)", [IDS.aprovadorALink]));
  const b = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true });
  await db.asUser(IDS.userClienteA, () => db.query("select public.decide_as_approver($1, 'aprovado', '')", [b.requestId]));

  tables = (
    await db.query<{ table_name: string }>(
      `select distinct c.table_name from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.column_name = 'client_id' order by 1`,
    )
  ).rows.map((r) => r.table_name);
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe("isolamento por cliente, pelo catálogo", () => {
  it("o catálogo enxerga as tabelas de negócio com client_id (a regra não é vazia)", () => {
    for (const t of [
      "approvers", "projects", "materials", "material_versions", "material_files", "approval_requests", "approval_links",
      "comments", "decisions", "material_version_contents", "approver_invites", "approval_verifications", "approval_link_sessions",
    ]) {
      // approval_verifications e approval_link_sessions não têm client_id (ligam por link): só as demais precisam estar aqui
      if (t === "approval_verifications" || t === "approval_link_sessions") continue;
      expect(tables, t).toContain(t);
    }
  });

  it("aprovador de OUTRO cliente: zero linhas do cliente A em TODAS as tabelas com client_id", async () => {
    const leaks: string[] = [];
    for (const t of tables) {
      const n = await countFor("userB", `select count(*) as n from public.${t} where client_id = $1`, [IDS.clienteA]);
      if (n > 0) leaks.push(`${t}: ${n}`);
    }
    expect(leaks).toEqual([]);
  });

  it("equipe de OUTRA agência: zero linhas do cliente A em todas as tabelas com client_id", async () => {
    const leaks: string[] = [];
    for (const t of tables) {
      const n = await countFor("outraAgencia", `select count(*) as n from public.${t} where client_id = $1`, [IDS.clienteA]);
      if (n > 0) leaks.push(`${t}: ${n}`);
    }
    expect(leaks).toEqual([]);
  });

  it("anônimo: nada em nenhuma tabela com client_id", async () => {
    const leaks: string[] = [];
    for (const t of tables) {
      const n = await countFor("anon", `select count(*) as n from public.${t}`);
      if (n > 0) leaks.push(`${t}: ${n}`);
    }
    expect(leaks).toEqual([]);
  });

  it("controle positivo: a equipe do cliente A e o aprovador do próprio cliente enxergam o que é deles (não é bloqueio total)", async () => {
    for (const t of ["materials", "material_versions", "material_files", "approval_requests", "approval_links", "comments", "decisions", "material_version_contents", "approver_invites"]) {
      expect(await countFor("designer", `select count(*) as n from public.${t} where client_id = $1`, [IDS.clienteA]), `equipe ${t}`).toBeGreaterThan(0);
    }
    for (const t of ["materials", "material_versions", "material_files", "decisions", "material_version_contents"]) {
      expect(await countFor("userA", `select count(*) as n from public.${t} where client_id = $1`, [IDS.clienteA]), `aprovador ${t}`).toBeGreaterThan(0);
    }
  });

  it("segredos do link (códigos e sessões) e links não são legíveis por aprovador nem por anônimo, de nenhum cliente", async () => {
    for (const role of ["userA", "userB", "anon"] as const) {
      expect(await countFor(role, "select count(*) as n from public.approval_verifications"), role).toBe(0);
      expect(await countFor(role, "select count(*) as n from public.approval_link_sessions"), role).toBe(0);
      expect(await countFor(role, "select count(*) as n from public.approval_links"), role).toBe(0);
    }
  });

  it("storage: arquivos do cliente A invisíveis para outro cliente, outra agência e anônimo; a equipe do A os vê", async () => {
    const sql = "select count(*) as n from storage.objects where bucket_id = 'materials' and name like $1";
    const like = `${IDS.clienteA}/%`;
    expect(await countFor("userB", sql, [like])).toBe(0);
    expect(await countFor("outraAgencia", sql, [like])).toBe(0);
    expect(await countFor("anon", sql, [like])).toBe(0);
    expect(await countFor("designer", sql, [like])).toBeGreaterThan(0);
    expect(await countFor("userA", sql, [like])).toBeGreaterThan(0);
  });

  it("aprovador de outro cliente não decide, não comenta e não cria link no material do cliente A", async () => {
    const decide = await db
      .asUser(IDS.userClienteB, () => db.query("select public.decide_as_approver($1, 'aprovado', '')", [a.requestId]))
      .then(() => null, (e: Error) => e.message);
    expect(decide).toMatch(/sem permissão/);
    const comment = await db
      .asUser(IDS.userClienteB, () =>
        db.query("insert into public.comments (material_id, version_id, client_id, slide, author_role, author_approver_id, body) values ($1,$2,$3,null,'cliente',$4,'invasor')", [a.materialId, a.versionId, IDS.clienteA, IDS.aprovadorB]),
      )
      .then(() => null, (e: Error) => e.message);
    expect(comment).toMatch(/row-level security|violates/);
    const link = await db
      .asUser(IDS.userClienteB, () => db.query("select public.create_approval_link($1,$2,$3, now() + interval '1 day')", [a.requestId, IDS.aprovadorALink, sha256Hex("invasor")]))
      .then(() => null, (e: Error) => e.message);
    expect(link).toMatch(/sem permissão/);
  });
});
