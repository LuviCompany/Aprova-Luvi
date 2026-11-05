// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, createMaterial, createTestDb, errorOf, seedBase, uid, type TestDb } from "./harness";

/**
 * Privacidade (migration D3): o aprovador lê só a PRÓPRIA linha de approvers. Antes, qualquer aprovador de um cliente lia
 * nome, e-mail, cargo e profile_id dos colegas do mesmo cliente.
 */

let db: TestDb;
const rows = async <T,>(user: string, sql: string, params: unknown[] = []) =>
  db.asUser(user, async () => (await db.query<T>(sql, params)).rows);

beforeAll(async () => {
  db = await createTestDb();
  await seedBase(db);
  // Mais um colega com login no MESMO cliente A (para provar que um não enxerga o outro).
  await db.exec(`
    insert into auth.users (id, email) values ('${uid(70)}', 'colega@clientea.test');
    insert into public.profiles (id, organization_id, full_name, email, role, active)
      values ('${uid(70)}', '${IDS.orgLuvi}', 'Colega A', 'colega@clientea.test', 'cliente', true);
    insert into public.approvers (id, client_id, profile_id, name, email, job_title, active)
      values ('${uid(71)}', '${IDS.clienteA}', '${uid(70)}', 'Colega A', 'colega@clientea.test', 'Diretora', true);
    -- A mesma pessoa (userClienteA) também aprova para o cliente B.
    insert into public.approvers (id, client_id, profile_id, name, email, active)
      values ('${uid(72)}', '${IDS.clienteB}', '${IDS.userClienteA}', 'Aprovador A', 'a@clientea.test', true);
  `);
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe("aprovador do portal lê só a própria linha de approvers", () => {
  it("não enxerga nome, e-mail, cargo nem profile_id dos colegas do mesmo cliente", async () => {
    const mine = await rows<{ id: string; client_id: string }>(IDS.userClienteA, "select id, client_id from public.approvers order by client_id");
    const ids = mine.map((r) => r.id).sort();
    expect(ids).toEqual([IDS.aprovadorA, uid(72)].sort());
    // nenhum colega do cliente A: só-link, inativo, o outro aprovador com login
    for (const colleague of [IDS.aprovadorALink, IDS.aprovadorInativo, uid(71)]) expect(ids).not.toContain(colleague);

    const exposed = await rows(IDS.userClienteA, "select name, email, job_title, profile_id from public.approvers where id = any($1::uuid[])", [[IDS.aprovadorALink, IDS.aprovadorInativo, uid(71)]]);
    expect(exposed).toEqual([]);
    expect(await rows(IDS.userClienteA, "select 1 from public.approvers where email in ('colega@clientea.test','link@clientea.test','inativo@clientea.test')")).toEqual([]);
  });

  it("quem aprova por duas empresas vê as duas linhas dele, e nada do outro cliente", async () => {
    const mine = await rows<{ client_id: string }>(IDS.userClienteA, "select client_id from public.approvers");
    expect(mine.map((r) => r.client_id).sort()).toEqual([IDS.clienteA, IDS.clienteB].sort());
    // userClienteB vê só a linha dele no cliente B, não a de userClienteA nesse mesmo cliente
    const b = await rows<{ id: string }>(IDS.userClienteB, "select id from public.approvers");
    expect(b.map((r) => r.id)).toEqual([IDS.aprovadorB]);
  });

  it("o vínculo ainda funciona como o portal usa (profile_id + ativo, com o nome da empresa)", async () => {
    const links = await rows<{ id: string; client: { name: string } | null }>(
      IDS.userClienteA,
      "select a.id, to_jsonb(c) as client from public.approvers a join public.clients c on c.id = a.client_id where a.profile_id = $1 and a.active",
      [IDS.userClienteA],
    );
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.client !== null)).toBe(true);
  });

  it("vínculo desativado ou de cliente arquivado some até da própria leitura (fail-closed)", async () => {
    await db.query("update public.approvers set active = false where id = $1", [uid(72)]);
    expect((await rows(IDS.userClienteA, "select 1 from public.approvers")).length).toBe(1);
    await db.query("update public.approvers set active = true where id = $1", [uid(72)]);
    await db.query("update public.clients set active = false where id = $1", [IDS.clienteB]);
    expect((await rows<{ client_id: string }>(IDS.userClienteA, "select client_id from public.approvers")).map((r) => r.client_id)).toEqual([IDS.clienteA]);
    await db.query("update public.clients set active = true where id = $1", [IDS.clienteB]);
  });

  it("a equipe da agência continua vendo todos os aprovadores dos seus clientes; outra agência, nenhum; anônimo, erro", async () => {
    const staff = await rows<{ id: string }>(IDS.designer, "select id from public.approvers where client_id = $1", [IDS.clienteA]);
    expect(staff.map((r) => r.id).sort()).toEqual([IDS.aprovadorA, IDS.aprovadorALink, IDS.aprovadorInativo, uid(71)].sort());
    expect(await rows(IDS.staffOutraOrg, "select 1 from public.approvers")).toEqual([]);
    expect(await db.asAnon(() => errorOf(() => db.query("select 1 from public.approvers")))).toMatch(/permission denied/);
  });

  it("nada que o portal faz depende de ler os colegas: decidir, comentar e ler as decisões do cliente seguem funcionando", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true });
    // comentar (a política usa app.my_approver_id, SECURITY DEFINER)
    const versionId = m.versionId;
    await db.asUser(IDS.userClienteA, () =>
      db.query(
        "insert into public.comments (material_id, version_id, client_id, slide, author_role, author_approver_id, body) values ($1,$2,$3,null,'cliente',$4,'Comentário de teste')",
        [m.materialId, versionId, IDS.clienteA, IDS.aprovadorA],
      ),
    );
    // decidir
    await db.asUser(IDS.userClienteA, () => db.query("select public.decide_as_approver($1, 'aprovado', '')", [m.requestId]));
    const decisions = await rows<{ approver_id: string }>(IDS.userClienteA, "select approver_id from public.decisions where material_id = $1", [m.materialId]);
    expect(decisions).toHaveLength(1);
    // o histórico expõe só o uuid do aprovador (sem nome nem e-mail): o app o mostra como "Você" ou "Outro aprovador"
    expect(Object.keys((await rows<Record<string, unknown>>(IDS.userClienteA, "select * from public.decisions limit 1"))[0])).not.toEqual(expect.arrayContaining(["name", "email"]));
  });

  it("o texto da política restringe ao próprio profile_id (o que o verify.sql confere no projeto real)", async () => {
    const { rows: p } = await db.query<{ qual: string }>("select qual from pg_policies where tablename = 'approvers' and policyname = 'approvers_select_portal'");
    expect(p).toHaveLength(1);
    expect(p[0].qual).toMatch(/profile_id/);
  });
});
