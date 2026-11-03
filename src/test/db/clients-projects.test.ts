// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, createTestDb, errorOf, seedBase, type TestDb } from "./harness";

/**
 * Módulo 3, etapa A: o que cada papel pode fazer com clientes e projetos NO BANCO (RLS + grants).
 * É a barreira final por trás das Server Actions; os testes das ações estão em
 * src/app/admin/actions.test.ts.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await seedBase(db);
}, 180_000);

afterAll(async () => {
  await db.close();
});

const insertClient = (userId: string, name: string, orgId: string = IDS.orgLuvi, initials = "NC") =>
  db.asUser(userId, () =>
    errorOf(() =>
      db.query(
        "insert into public.clients (organization_id, name, segment, initials, active) values ($1, $2, '', $3, true)",
        [orgId, name, initials],
      ),
    ),
  );

const insertProject = (userId: string, clientId: string, name: string, createdBy: string | null = userId) =>
  db.asUser(userId, () =>
    errorOf(() =>
      db.query(
        "insert into public.projects (client_id, name, description, status, due_date, created_by) values ($1, $2, '', 'ativo', null, $3)",
        [clientId, name, createdBy],
      ),
    ),
  );

const clientNamesFor = (userId: string) =>
  db.asUser(userId, async () => (await db.query<{ name: string }>("select name from public.clients order by name")).rows.map((r) => r.name));

describe("cadastro de clientes por papel", () => {
  it("admin e atendimento cadastram clientes na própria organização", async () => {
    expect(await insertClient(IDS.admin, "Cliente do Admin")).toBeNull();
    expect(await insertClient(IDS.atendimento, "Cliente do Atendimento")).toBeNull();
  });

  it("designer só lê: o cadastro é negado pela RLS", async () => {
    expect(await insertClient(IDS.designer, "Cliente do Designer")).toMatch(/row-level security/);
    expect(await clientNamesFor(IDS.designer)).toContain("Cliente A Teste");
  });

  it("aprovador (papel cliente) e anônimo não cadastram", async () => {
    expect(await insertClient(IDS.userClienteA, "Cliente do Aprovador")).toMatch(/row-level security/);
    const anon = await db.asAnon(() => errorOf(() => db.query("insert into public.clients (organization_id, name, initials) values ($1, 'X Anon', 'XA')", [IDS.orgLuvi])));
    expect(anon).toMatch(/permission denied/);
  });

  it("ninguém cadastra cliente em OUTRA organização", async () => {
    expect(await insertClient(IDS.admin, "Invasor", IDS.orgOutra)).toMatch(/row-level security/);
    expect(await insertClient(IDS.staffOutraOrg, "Invasor 2", IDS.orgLuvi)).toMatch(/row-level security/);
  });

  it("nome repetido na mesma organização é barrado; em outra organização é permitido", async () => {
    expect(await insertClient(IDS.admin, "Nome Único")).toBeNull();
    expect(await insertClient(IDS.atendimento, "Nome Único")).toMatch(/duplicate key|unique/);
    expect(await insertClient(IDS.staffOutraOrg, "Nome Único", IDS.orgOutra)).toBeNull();
  });

  it("iniciais fora do formato (minúsculas, mais de 3, vazias, símbolos) são recusadas", async () => {
    for (const bad of ["ab", "ABCD", "", "A-", "Ç"]) {
      expect(await insertClient(IDS.admin, `Formato ${bad}`, IDS.orgLuvi, bad), bad).toMatch(/violates check constraint/);
    }
    expect(await insertClient(IDS.admin, "Formato Bom", IDS.orgLuvi, "A1")).toBeNull();
  });

  it("nome curto demais é recusado", async () => {
    expect(await insertClient(IDS.admin, "A")).toMatch(/violates check constraint/);
  });

  it("isolamento: cada equipe só enxerga os clientes da própria organização", async () => {
    const luvi = await clientNamesFor(IDS.admin);
    expect(luvi).toContain("Cliente A Teste");
    expect(luvi).not.toContain("Cliente de Outra Agência");
    expect(await clientNamesFor(IDS.staffOutraOrg)).toEqual(["Cliente de Outra Agência", "Nome Único"]);
  });
});

describe("edição e arquivamento de clientes", () => {
  const update = (userId: string, sql: string, params: unknown[]) =>
    db.asUser(userId, async () => {
      try {
        const result = await db.query(sql, params);
        return { error: null as string | null, affected: result.affectedRows ?? 0 };
      } catch (error) {
        return { error: (error as Error).message, affected: 0 };
      }
    });

  it("atendimento e admin editam nome, segmento, iniciais e arquivam", async () => {
    const ok = await update(IDS.atendimento, "update public.clients set name = 'Cliente A Renomeado', segment = 'Novo', initials = 'AR' where id = $1", [IDS.clienteA]);
    expect(ok).toEqual({ error: null, affected: 1 });
    const archived = await update(IDS.admin, "update public.clients set active = false where id = $1", [IDS.clienteA]);
    expect(archived).toEqual({ error: null, affected: 1 });
    const back = await update(IDS.admin, "update public.clients set active = true, name = 'Cliente A Teste' where id = $1", [IDS.clienteA]);
    expect(back).toEqual({ error: null, affected: 1 });
  });

  it("designer não altera nada (a RLS filtra a linha: 0 linhas afetadas)", async () => {
    const result = await update(IDS.designer, "update public.clients set segment = 'Hack' where id = $1", [IDS.clienteB]);
    expect(result.affected).toBe(0);
    const row = (await db.query<{ segment: string }>("select segment from public.clients where id = $1", [IDS.clienteB])).rows[0];
    expect(row.segment).toBe("Saúde");
  });

  it("a organização de um cliente não pode ser trocada (sem permissão de UPDATE na coluna)", async () => {
    const result = await update(IDS.admin, "update public.clients set organization_id = $2 where id = $1", [IDS.clienteB, IDS.orgOutra]);
    expect(result.error).toMatch(/permission denied/);
  });

  it("outra organização não edita nem arquiva clientes da Luvi", async () => {
    const result = await update(IDS.staffOutraOrg, "update public.clients set active = false where id = $1", [IDS.clienteB]);
    expect(result.affected).toBe(0);
  });

  it("ninguém apaga clientes: não existe permissão de DELETE (arquivar é active = false)", async () => {
    for (const user of [IDS.admin, IDS.atendimento, IDS.designer]) {
      const result = await update(user, "delete from public.clients where id = $1", [IDS.clienteB]);
      expect(result.error, user).toMatch(/permission denied/);
    }
  });

  it("cliente arquivado some do portal (aprovador perde o acesso), mas continua para a equipe", async () => {
    await db.exec(`update public.clients set active = false where id = '${IDS.clienteB}'`);
    const portal = await db.asUser(IDS.userClienteB, async () => (await db.query("select id from public.clients")).rows);
    expect(portal).toHaveLength(0);
    expect(await clientNamesFor(IDS.designer)).toContain("Cliente B Teste");
    await db.exec(`update public.clients set active = true where id = '${IDS.clienteB}'`);
  });
});

describe("projetos por papel", () => {
  it("qualquer equipe ativa cria projeto (admin, atendimento e designer), com created_by = ela mesma", async () => {
    expect(await insertProject(IDS.admin, IDS.clienteA, "Projeto do Admin")).toBeNull();
    expect(await insertProject(IDS.atendimento, IDS.clienteA, "Projeto do Atendimento")).toBeNull();
    expect(await insertProject(IDS.designer, IDS.clienteA, "Projeto do Designer")).toBeNull();
  });

  it("created_by de outra pessoa ou ausente é recusado (não dá para forjar a autoria)", async () => {
    expect(await insertProject(IDS.designer, IDS.clienteA, "Autoria falsa", IDS.admin)).toMatch(/row-level security/);
    expect(await insertProject(IDS.designer, IDS.clienteA, "Sem autoria", null)).toMatch(/row-level security/);
  });

  it("aprovador, anônimo e outra organização não criam projeto", async () => {
    expect(await insertProject(IDS.userClienteA, IDS.clienteA, "Do aprovador")).toMatch(/row-level security/);
    expect(await insertProject(IDS.staffOutraOrg, IDS.clienteA, "Invasor")).toMatch(/row-level security/);
    const anon = await db.asAnon(() => errorOf(() => db.query("insert into public.projects (client_id, name) values ($1, 'Anon')", [IDS.clienteA])));
    expect(anon).toMatch(/permission denied/);
  });

  it("não cria projeto para cliente de outra organização (nem escondendo o cliente)", async () => {
    expect(await insertProject(IDS.admin, IDS.clienteOutraOrg, "Cruzado")).toMatch(/row-level security/);
  });

  it("edita nome, descrição, status e data; o cliente do projeto não muda", async () => {
    const id = (await db.query<{ id: string }>("select id from public.projects where name = 'Projeto do Admin'")).rows[0].id;
    const ok = await db.asUser(IDS.designer, () =>
      errorOf(() => db.query("update public.projects set name = 'Projeto Editado', description = 'd', status = 'pausado', due_date = '2026-12-15' where id = $1", [id])),
    );
    expect(ok).toBeNull();
    const trocaCliente = await db.asUser(IDS.admin, () =>
      errorOf(() => db.query("update public.projects set client_id = $2 where id = $1", [id, IDS.clienteB])),
    );
    expect(trocaCliente).toMatch(/permission denied/);
  });

  it("status e nome seguem as regras do banco", async () => {
    const status = await db.asUser(IDS.admin, () =>
      errorOf(() => db.query("insert into public.projects (client_id, name, status, created_by) values ($1, 'Status ruim', 'arquivado', $2)", [IDS.clienteA, IDS.admin])),
    );
    expect(status).toMatch(/invalid input value for enum/);
    expect(await insertProject(IDS.admin, IDS.clienteA, "x")).toMatch(/violates check constraint/);
  });

  it("outra organização não vê nem altera projetos da Luvi; ninguém apaga projetos", async () => {
    const seen = await db.asUser(IDS.staffOutraOrg, async () => (await db.query("select id from public.projects where client_id = $1", [IDS.clienteA])).rows);
    expect(seen).toHaveLength(0);
    for (const user of [IDS.admin, IDS.designer]) {
      const result = await db.asUser(user, () => errorOf(() => db.query("delete from public.projects where client_id = $1", [IDS.clienteA])));
      expect(result, user).toMatch(/permission denied/);
    }
  });

  it("portal: o aprovador só vê projetos que já têm material enviado para aprovação", async () => {
    const rows = await db.asUser(IDS.userClienteA, async () => (await db.query("select id from public.projects")).rows);
    expect(rows).toHaveLength(0); // nenhum material enviado neste arquivo de teste
  });

  it("a equipe lista projetos com a contagem de materiais por projeto (base das telas)", async () => {
    const rows = await db.asUser(IDS.designer, async () =>
      (
        await db.query<{ name: string; materiais: string }>(
          `select p.name, count(m.id)::text as materiais
             from public.projects p left join public.materials m on m.project_id = p.id
            where p.client_id = $1 group by p.name order by p.name`,
          [IDS.clienteA],
        )
      ).rows,
    );
    expect(rows.map((r) => r.name)).toContain("Projeto A");
    expect(rows.every((r) => r.materiais === "0")).toBe(true);
  });
});

// As três lacunas antigas (projeto em cliente arquivado, nome sem diferenciar caixa e auditoria) foram
// fechadas pelas migrations da etapa A.2 e são testadas em src/test/db/approvers-a2.test.ts.
