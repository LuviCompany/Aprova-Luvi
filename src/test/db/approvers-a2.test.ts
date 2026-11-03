// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, createMaterial, createTestDb, errorOf, seedBase, sha256Hex, uid, type TestDb } from "./harness";

/**
 * Módulo 3, etapa A.2: as quatro migrations 20261103120000 a 20261103120300 (integridade de
 * clientes/projetos, aprovador em vários clientes, convites preparados e auditoria), testadas
 * em Postgres em memória com TODAS as migrations aplicadas.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await seedBase(db);
}, 180_000);

afterAll(async () => {
  await db.close();
});

const rows = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;
const as = {
  admin: IDS.admin,
  atendimento: IDS.atendimento,
  designer: IDS.designer,
  portal: IDS.userClienteA,
  outraOrg: IDS.staffOutraOrg,
};
const run = (user: string, sql: string, params: unknown[] = []) =>
  db.asUser(user, () => errorOf(() => db.query(sql, params)));
const setClientActive = (id: string, active: boolean) =>
  db.exec(`update public.clients set active = ${active} where id = '${id}'`);
const insertProject = (user: string, clientId: string, name: string) =>
  run(user, "insert into public.projects (client_id, name, created_by) values ($1, $2, $3)", [clientId, name, user]);
const insertApprover = (user: string, clientId: string, email: string) =>
  run(user, "insert into public.approvers (client_id, name, email) values ($1, 'Pessoa Teste', $2)", [clientId, email]);
const link = (user: string, source: string, client: string) =>
  db.asUser(user, async () => {
    try {
      const result = await db.query<{ id: string }>("select public.link_approver_to_client($1, $2) as id", [source, client]);
      return { id: result.rows[0].id, error: null as string | null };
    } catch (error) {
      return { id: null as string | null, error: (error as Error).message };
    }
  });
const prepare = (user: string, approver: string) =>
  db.asUser(user, async () => {
    try {
      const result = await db.query<{ id: string }>("select public.prepare_approver_invite($1) as id", [approver]);
      return { id: result.rows[0].id, error: null as string | null };
    } catch (error) {
      return { id: null as string | null, error: (error as Error).message };
    }
  });

// ---------------------------------------------------------------------------------------------
describe("M1 — cliente arquivado não recebe projeto nem aprovador novo", () => {
  it("equipe e servidor são barrados pelo BANCO, mesmo chamando direto", async () => {
    await setClientActive(IDS.clienteA, false);
    try {
      for (const [papel, user] of [["admin", as.admin], ["atendimento", as.atendimento], ["designer", as.designer]] as const) {
        expect(await insertProject(user, IDS.clienteA, `P ${papel}`), papel).toMatch(/cliente arquivado/);
      }
      expect(await insertApprover(as.admin, IDS.clienteA, "novo@clientea.test")).toMatch(/cliente arquivado/);
      const service = await db.asService(() =>
        errorOf(() => db.query("insert into public.projects (client_id, name) values ($1, 'P servidor')", [IDS.clienteA])),
      );
      expect(service).toMatch(/cliente arquivado/);
    } finally {
      await setClientActive(IDS.clienteA, true);
    }
  });

  it("reativado, volta a aceitar", async () => {
    expect(await insertProject(as.admin, IDS.clienteA, "Projeto depois de reativar")).toBeNull();
    expect(await insertApprover(as.admin, IDS.clienteA, "depois@clientea.test")).toBeNull();
  });

  it("não vaza a existência de clientes de outra organização (a RLS responde primeiro)", async () => {
    await setClientActive(IDS.clienteA, false);
    try {
      expect(await insertProject(as.outraOrg, IDS.clienteA, "Invasor")).toMatch(/row-level security/);
      expect(await insertApprover(as.outraOrg, IDS.clienteA, "x@invasor.test")).toMatch(/row-level security/);
    } finally {
      await setClientActive(IDS.clienteA, true);
    }
  });

  it("projetos que já existiam continuam editáveis depois do arquivamento do cliente", async () => {
    await setClientActive(IDS.clienteB, false);
    try {
      expect(await run(as.admin, "update public.projects set status = 'concluido' where id = $1", [IDS.projetoB])).toBeNull();
    } finally {
      await setClientActive(IDS.clienteB, true);
      await db.exec(`update public.projects set status = 'ativo' where id = '${IDS.projetoB}'`);
    }
  });
});

describe("M1 — nome do cliente sem diferenciar maiúsculas e espaços", () => {
  const insertClient = (user: string, name: string, org: string = IDS.orgLuvi) =>
    run(user, "insert into public.clients (organization_id, name, initials) values ($1, $2, 'XX')", [org, name]);

  it("barra variações de caixa e de espaços na mesma organização", async () => {
    expect(await insertClient(as.admin, "Casa Aurora Única")).toBeNull();
    for (const variante of ["casa aurora única", "CASA AURORA ÚNICA", "  Casa   Aurora  Única ", "casa\taurora\núnica"]) {
      expect(await insertClient(as.atendimento, variante), variante).toMatch(/clients_org_name_ci_key|duplicate key/);
    }
  });

  it("outra organização pode usar o mesmo nome; acento diferente é outro nome", async () => {
    expect(await insertClient(as.outraOrg, "Casa Aurora Única", IDS.orgOutra)).toBeNull();
    expect(await insertClient(as.admin, "Casa Aurora Unica")).toBeNull();
  });

  it("renomear para um nome que colide também é barrado", async () => {
    const erro = await run(as.admin, "update public.clients set name = 'CASA AURORA ÚNICA' where id = $1", [IDS.clienteB]);
    expect(erro).toMatch(/clients_org_name_ci_key|duplicate key/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("M2 — o mesmo login em vários clientes", () => {
  it("uma pessoa com login aprova para dois clientes, e o portal enxerga os dois", async () => {
    await db.asService(() =>
      db.query(
        "insert into public.approvers (id, client_id, profile_id, name, email) values ($1, $2, $3, 'Aprovador A', 'a@clientea.test')",
        [uid(500), IDS.clienteB, IDS.userClienteA],
      ),
    );
    const visiveis = await db.asUser(IDS.userClienteA, async () =>
      (await db.query<{ id: string }>("select id from public.clients order by name")).rows.map((r) => r.id),
    );
    expect(visiveis).toEqual([IDS.clienteA, IDS.clienteB]);
    const meus = await db.asUser(IDS.userClienteA, async () =>
      (await db.query<{ a: string; b: string }>("select app.my_approver_id($1) as a, app.my_approver_id($2) as b", [IDS.clienteA, IDS.clienteB])).rows[0],
    );
    expect(meus.a).toBe(IDS.aprovadorA);
    expect(meus.b).toBe(uid(500));
  });

  it("o mesmo login não entra duas vezes no mesmo cliente", async () => {
    const erro = await db.asService(() =>
      errorOf(() =>
        db.query("insert into public.approvers (client_id, profile_id, name, email) values ($1, $2, 'Outro Nome', 'a@clientea.test')", [IDS.clienteA, IDS.userClienteA]),
      ),
    );
    expect(erro).toMatch(/approvers_profile_client_key|duplicate key/);
  });

  it("linhas sem login (só link) continuam podendo repetir em vários clientes", async () => {
    await insertApprover(as.admin, IDS.clienteA, "so.link@pessoa.test");
    await insertApprover(as.admin, IDS.clienteB, "so.link@pessoa.test");
    const total = await rows<{ n: string }>("select count(*)::text as n from public.approvers where email = 'so.link@pessoa.test'");
    expect(total[0].n).toBe("2");
  });

  it("login de outra organização não vincula a cliente desta", async () => {
    const erro = await db.asService(() =>
      errorOf(() =>
        db.query("insert into public.approvers (client_id, profile_id, name, email) values ($1, $2, 'X', 'staff@outra.test')", [IDS.clienteA, IDS.staffOutraOrg]),
      ),
    );
    expect(erro).toMatch(/papel "cliente" na mesma organização/);
  });

  it("o e-mail do aprovador precisa ser o do login (não vincula um login a outro e-mail)", async () => {
    const erro = await db.asService(() =>
      errorOf(() =>
        db.query("insert into public.approvers (client_id, profile_id, name, email) values ($1, $2, 'B', 'outro.email@clienteb.test')", [IDS.clienteB, IDS.userClienteB]),
      ),
    );
    expect(erro).toMatch(/mesmo do login vinculado/);
  });

  it("o app não consegue trocar e-mail nem login de um aprovador (sem grant)", async () => {
    expect(await run(as.admin, "update public.approvers set email = 'novo@x.test' where id = $1", [IDS.aprovadorA])).toMatch(/permission denied/);
    expect(await run(as.admin, "update public.approvers set profile_id = $2 where id = $1", [IDS.aprovadorALink, IDS.userClienteB])).toMatch(/permission denied/);
    expect(await run(as.admin, "insert into public.approvers (client_id, profile_id, name, email) values ($1, $2, 'Z Z', 'z@clientea.test')", [IDS.clienteA, IDS.userClienteB])).toMatch(/permission denied/);
  });
});

describe("M2 — link_approver_to_client", () => {
  it("admin e atendimento vinculam uma pessoa a outro cliente, copiando os dados e o login", async () => {
    const result = await link(as.atendimento, IDS.aprovadorB, IDS.clienteA);
    expect(result.error).toBeNull();
    const [novo] = await rows<{ client_id: string; profile_id: string | null; name: string; email: string; active: boolean }>(
      "select client_id, profile_id, name, email, active from public.approvers where id = $1",
      [result.id],
    );
    expect(novo).toEqual({ client_id: IDS.clienteA, profile_id: IDS.userClienteB, name: "Aprovador B", email: "b@clienteb.test", active: true });
  });

  it("vincular de novo ao mesmo cliente é barrado", async () => {
    expect((await link(as.admin, IDS.aprovadorB, IDS.clienteA)).error).toMatch(/duplicate key|approvers_client_id_email_key/);
  });

  it("designer, aprovador do portal, anônimo e outra organização não vinculam", async () => {
    for (const [nome, user] of [["designer", as.designer], ["portal", as.portal], ["outra org", as.outraOrg]] as const) {
      expect((await link(user, IDS.aprovadorALink, IDS.clienteB)).error, nome).toMatch(/sem permissão/);
    }
    const anon = await db.asAnon(() =>
      errorOf(() => db.query("select public.link_approver_to_client($1, $2)", [IDS.aprovadorALink, IDS.clienteB])),
    );
    expect(anon).toMatch(/permission denied/);
  });

  it("origem inexistente e origem de outra organização respondem igual: sem permissão", async () => {
    expect((await link(as.admin, uid(999), IDS.clienteB)).error).toMatch(/sem permissão/);
    expect((await link(as.outraOrg, IDS.aprovadorALink, IDS.clienteOutraOrg)).error).toMatch(/sem permissão/);
  });

  it("origem inativa, mesmo cliente e cliente de destino arquivado são recusados", async () => {
    await db.exec(`update public.approvers set active = false where id = '${IDS.aprovadorInativo}'`);
    expect((await link(as.admin, IDS.aprovadorInativo, IDS.clienteB)).error).toMatch(/origem inativo/);
    await db.exec(`update public.approvers set active = true where id = '${IDS.aprovadorInativo}'`);

    expect((await link(as.admin, IDS.aprovadorALink, IDS.clienteA)).error).toMatch(/mesmo cliente/);

    await setClientActive(IDS.clienteB, false);
    try {
      expect((await link(as.admin, IDS.aprovadorALink, IDS.clienteB)).error).toMatch(/cliente arquivado/);
    } finally {
      await setClientActive(IDS.clienteB, true);
    }
  });
});

describe("M2 — desativar um aprovador", () => {
  it("revoga os links pendentes DELE, preserva as decisões e não toca em outros vínculos", async () => {
    const decidida = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true, title: "Já decidido" });
    await db.asUser(IDS.userClienteA, () => db.query("select public.decide_as_approver($1, 'aprovado', '')", [decidida.requestId]));

    const aberta = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true, title: "Em aberto" });
    const linkDoAprovador = await db.asUser(IDS.designer, async () =>
      (await db.query<{ id: string }>("select public.create_approval_link($1, $2, $3, now() + interval '7 days') as id", [aberta.requestId, IDS.aprovadorA, sha256Hex("l-a")])).rows[0].id,
    );
    const linkDeOutro = await db.asUser(IDS.designer, async () =>
      (await db.query<{ id: string }>("select public.create_approval_link($1, $2, $3, now() + interval '7 days') as id", [aberta.requestId, IDS.aprovadorALink, sha256Hex("l-b")])).rows[0].id,
    );

    expect(await run(as.atendimento, "update public.approvers set active = false where id = $1", [IDS.aprovadorA])).toBeNull();

    const [revogado] = await rows<{ revoked_at: string | null; revoked_by: string | null }>("select revoked_at, revoked_by from public.approval_links where id = $1", [linkDoAprovador]);
    expect(revogado.revoked_at).not.toBeNull();
    expect(revogado.revoked_by).toBe(IDS.atendimento);
    const [intacto] = await rows<{ revoked_at: string | null }>("select revoked_at from public.approval_links where id = $1", [linkDeOutro]);
    expect(intacto.revoked_at).toBeNull();

    // histórico preservado
    const decisoes = await rows("select 1 from public.decisions where request_id = $1", [decidida.requestId]);
    expect(decisoes).toHaveLength(1);
    // e o aprovador desativado não decide mais
    const erro = await db.asUser(IDS.userClienteA, () => errorOf(() => db.query("select public.decide_as_approver($1, 'aprovado', '')", [aberta.requestId])));
    expect(erro).toMatch(/sem permissão/);

    // reativar NÃO ressuscita o link revogado
    await run(as.admin, "update public.approvers set active = true where id = $1", [IDS.aprovadorA]);
    const [depois] = await rows<{ revoked_at: string | null }>("select revoked_at from public.approval_links where id = $1", [linkDoAprovador]);
    expect(depois.revoked_at).not.toBeNull();
  });

  it("desativar o vínculo de um cliente não afeta o mesmo login em outro cliente", async () => {
    await run(as.admin, "update public.approvers set active = false where id = $1", [uid(500)]); // vínculo com o cliente B
    const clientes = await db.asUser(IDS.userClienteA, async () => (await db.query<{ id: string }>("select id from public.clients")).rows.map((r) => r.id));
    expect(clientes).toEqual([IDS.clienteA]);
    await run(as.admin, "update public.approvers set active = true where id = $1", [uid(500)]);
  });

  it("link já usado não é alterado (só pendentes)", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true, title: "Link usado" });
    const id = await db.asUser(IDS.designer, async () =>
      (await db.query<{ id: string }>("select public.create_approval_link($1, $2, $3, now() + interval '7 days') as id", [m.requestId, IDS.aprovadorALink, sha256Hex("usado")])).rows[0].id,
    );
    await db.asService(() => db.query("select public.decide_via_link($1, 'aprovado', '')", [id]));
    await run(as.admin, "update public.approvers set active = false where id = $1", [IDS.aprovadorALink]);
    const [row] = await rows<{ used_at: string | null; revoked_at: string | null }>("select used_at, revoked_at from public.approval_links where id = $1", [id]);
    expect(row.used_at).not.toBeNull();
    expect(row.revoked_at).toBeNull();
    await run(as.admin, "update public.approvers set active = true where id = $1", [IDS.aprovadorALink]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("M3 — convites preparados (sem envio, sem token)", () => {
  let inviteId: string;

  it("admin prepara o convite de um aprovador ativo e sem login", async () => {
    const result = await prepare(as.admin, IDS.aprovadorALink);
    expect(result.error).toBeNull();
    inviteId = result.id!;
    const [row] = await rows<{ status: string; prepared_by: string; client_id: string; sent_at: string | null }>(
      "select status, prepared_by, client_id, sent_at from public.approver_invites where id = $1",
      [inviteId],
    );
    expect(row).toEqual({ status: "preparado", prepared_by: IDS.admin, client_id: IDS.clienteA, sent_at: null });
  });

  it("não guarda token, e-mail nem nome", async () => {
    const colunas = await rows<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'approver_invites'");
    expect(colunas.map((c) => c.column_name).filter((c) => /token|mail|name|hash|secret/i.test(c))).toEqual([]);
  });

  it("só um convite em aberto por aprovador", async () => {
    expect((await prepare(as.atendimento, IDS.aprovadorALink)).error).toMatch(/approver_invites_one_open_per_approver|duplicate key/);
  });

  it("recusa aprovador com login, inativo, de cliente arquivado e sem permissão", async () => {
    expect((await prepare(as.admin, IDS.aprovadorA)).error).toMatch(/já tem acesso ao portal/);
    await db.exec(`update public.approvers set active = false where id = '${IDS.aprovadorInativo}'`);
    await db.exec(`insert into public.approvers (id, client_id, name, email) values ('${uid(600)}', '${IDS.clienteB}', 'Sem Login B', 'semlogin@clienteb.test')`);
    await db.exec(`update public.approvers set active = false where id = '${uid(600)}'`);
    expect((await prepare(as.admin, uid(600))).error).toMatch(/aprovador inativo/);
    await db.exec(`update public.approvers set active = true where id = '${uid(600)}'`);
    await setClientActive(IDS.clienteB, false);
    try {
      expect((await prepare(as.admin, uid(600))).error).toMatch(/cliente arquivado/);
    } finally {
      await setClientActive(IDS.clienteB, true);
    }
    for (const [nome, user] of [["designer", as.designer], ["portal", as.portal], ["outra org", as.outraOrg]] as const) {
      expect((await prepare(user, uid(600))).error, nome).toMatch(/sem permissão/);
    }
    const anon = await db.asAnon(() => errorOf(() => db.query("select public.prepare_approver_invite($1)", [uid(600)])));
    expect(anon).toMatch(/permission denied/);
  });

  it("ninguém grava direto na tabela; equipe lê, portal e outra organização não veem", async () => {
    for (const user of [as.admin, as.atendimento, as.designer]) {
      expect(await run(user, "insert into public.approver_invites (approver_id, client_id) values ($1, $2)", [IDS.aprovadorALink, IDS.clienteA]), user).toMatch(/permission denied/);
      expect(await run(user, "update public.approver_invites set status = 'aceito'", []), user).toMatch(/permission denied/);
      expect(await run(user, "delete from public.approver_invites", []), user).toMatch(/permission denied/);
    }
    const veDesigner = await db.asUser(IDS.designer, async () => (await db.query("select id from public.approver_invites")).rows.length);
    const vePortal = await db.asUser(IDS.userClienteA, async () => (await db.query("select id from public.approver_invites")).rows.length);
    const veOutra = await db.asUser(IDS.staffOutraOrg, async () => (await db.query("select id from public.approver_invites")).rows.length);
    expect(veDesigner).toBeGreaterThan(0);
    expect(vePortal).toBe(0);
    expect(veOutra).toBe(0);
  });

  it("cancela o convite aberto; cancelar de novo é recusado; dá para preparar outro depois", async () => {
    expect((await db.asUser(IDS.designer, () => errorOf(() => db.query("select public.revoke_approver_invite($1)", [inviteId])))) ?? "").toMatch(/sem permissão/);
    expect(await run(as.atendimento, "select public.revoke_approver_invite($1)", [inviteId])).toBeNull();
    const [row] = await rows<{ status: string; revoked_at: string | null }>("select status, revoked_at from public.approver_invites where id = $1", [inviteId]);
    expect(row.status).toBe("revogado");
    expect(row.revoked_at).not.toBeNull();
    expect(await run(as.admin, "select public.revoke_approver_invite($1)", [inviteId])).toMatch(/não está em aberto/);
    expect((await prepare(as.admin, IDS.aprovadorALink)).error).toBeNull();
  });

  it("desativar o aprovador cancela o convite que estava aberto", async () => {
    await run(as.admin, "update public.approvers set active = false where id = $1", [IDS.aprovadorALink]);
    const abertos = await rows("select 1 from public.approver_invites where approver_id = $1 and status in ('preparado','enviado')", [IDS.aprovadorALink]);
    expect(abertos).toHaveLength(0);
    await run(as.admin, "update public.approvers set active = true where id = $1", [IDS.aprovadorALink]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("M4 — auditoria sem dados pessoais", () => {
  type Event = { action: string; entity_type: string; entity_id: string; organization_id: string; actor_profile_id: string | null; metadata: Record<string, unknown>; created_at: string };
  const eventsOf = (entityId: string) =>
    rows<Event>("select action, entity_type, entity_id, organization_id, actor_profile_id, metadata, created_at from public.audit_events where entity_id = $1 order by id", [entityId]);
  const NOME = "Auditoria Teste Ltda";
  let clientId: string;

  it("criar cliente registra organização, responsável, registro, ação e data/hora", async () => {
    const [row] = await db.asUser(IDS.admin, async () =>
      (await db.query<{ id: string }>("insert into public.clients (organization_id, name, segment, initials) values ($1, $2, 'Segredo do segmento', 'AT') returning id", [IDS.orgLuvi, NOME])).rows,
    );
    clientId = row.id;
    const [ev] = await eventsOf(clientId);
    expect(ev).toMatchObject({ action: "client.created", entity_type: "client", entity_id: clientId, organization_id: IDS.orgLuvi, actor_profile_id: IDS.admin });
    expect(ev.created_at).toBeTruthy();
    expect(ev.metadata).toMatchObject({ client_id: clientId, actor_role: "admin" });
  });

  it("editar, arquivar e reativar viram eventos distintos, com só os nomes das colunas", async () => {
    await run(as.atendimento, "update public.clients set segment = 'Outro segmento' where id = $1", [clientId]);
    await run(as.atendimento, "update public.clients set active = false where id = $1", [clientId]);
    await run(as.atendimento, "update public.clients set active = true where id = $1", [clientId]);
    const events = await eventsOf(clientId);
    expect(events.map((e) => e.action)).toEqual(["client.created", "client.updated", "client.archived", "client.reactivated"]);
    expect(events[1].metadata.changed).toEqual(["segment"]);
    expect(events[1].actor_profile_id).toBe(IDS.atendimento);
    expect(events[1].metadata.actor_role).toBe("atendimento");
    expect(events[2].metadata.changed).toEqual(["active"]);
  });

  it("atualização que só mexe em updated_at não gera evento", async () => {
    const antes = (await eventsOf(clientId)).length;
    await run(as.admin, "update public.clients set name = name where id = $1", [clientId]);
    expect((await eventsOf(clientId)).length).toBe(antes);
  });

  it("projetos: criação e edição, com status anterior e novo", async () => {
    const [p] = await db.asUser(IDS.designer, async () =>
      (await db.query<{ id: string }>("insert into public.projects (client_id, name, created_by) values ($1, 'Projeto Auditado', $2) returning id", [clientId, IDS.designer])).rows,
    );
    await run(as.designer, "update public.projects set status = 'pausado', name = 'Projeto Auditado 2' where id = $1", [p.id]);
    const events = await eventsOf(p.id);
    expect(events.map((e) => e.action)).toEqual(["project.created", "project.updated"]);
    expect(events[1].metadata).toMatchObject({ status_from: "ativo", status_to: "pausado", changed: ["name", "status"], client_id: clientId });
    expect(events[0].actor_profile_id).toBe(IDS.designer);
  });

  it("aprovadores: criar, vincular (ação própria), desativar e reativar", async () => {
    const [a] = await db.asUser(IDS.admin, async () =>
      (await db.query<{ id: string }>("insert into public.approvers (client_id, name, email) values ($1, 'Pessoa Auditada', 'pessoa.auditada@exemplo.test') returning id", [clientId])).rows,
    );
    await run(as.admin, "update public.approvers set active = false where id = $1", [a.id]);
    await run(as.admin, "update public.approvers set active = true where id = $1", [a.id]);
    expect((await eventsOf(a.id)).map((e) => e.action)).toEqual(["approver.created", "approver.deactivated", "approver.reactivated"]);

    const vinculo = await link(as.admin, a.id, IDS.clienteB);
    expect((await eventsOf(vinculo.id!)).map((e) => e.action)).toEqual(["approver.linked"]);
    // o marcador não vaza: o próximo cadastro volta a ser "created"
    const [b] = await db.asUser(IDS.admin, async () =>
      (await db.query<{ id: string }>("insert into public.approvers (client_id, name, email) values ($1, 'Outra Pessoa', 'outra.pessoa@exemplo.test') returning id", [IDS.clienteB])).rows,
    );
    expect((await eventsOf(b.id)).map((e) => e.action)).toEqual(["approver.created"]);
  });

  it("convites: preparado e revogado", async () => {
    const [a] = await rows<{ id: string }>("select id from public.approvers where email = 'outra.pessoa@exemplo.test'");
    const preparado = await prepare(as.admin, a.id);
    expect((await eventsOf(preparado.id!)).map((e) => e.action)).toEqual(["approver_invite.prepared"]);
    await run(as.admin, "select public.revoke_approver_invite($1)", [preparado.id]);
    const events = await eventsOf(preparado.id!);
    expect(events.map((e) => e.action)).toEqual(["approver_invite.prepared", "approver_invite.revoked"]);
    expect(events[1].metadata).toMatchObject({ status_from: "preparado", status_to: "revogado" });
  });

  it("ações do servidor (service_role) ficam com responsável nulo", async () => {
    const [row] = await db.asService(async () =>
      (await db.query<{ id: string }>("insert into public.clients (organization_id, name, initials) values ($1, 'Cliente do Servidor', 'CS') returning id", [IDS.orgLuvi])).rows,
    );
    const [ev] = await eventsOf(row.id);
    expect(ev.action).toBe("client.created");
    expect(ev.actor_profile_id).toBeNull();
    expect(ev.organization_id).toBe(IDS.orgLuvi);
  });

  it("NENHUM evento guarda nome, e-mail ou texto livre; o metadata só tem chaves conhecidas", async () => {
    const todos = await rows<{ action: string; metadata: Record<string, unknown> }>(
      "select action, metadata from public.audit_events where entity_type in ('client','project','approver','approver_invite')",
    );
    expect(todos.length).toBeGreaterThan(10);
    const permitidas = new Set(["client_id", "actor_role", "changed", "status_from", "status_to"]);
    for (const ev of todos) {
      for (const key of Object.keys(ev.metadata)) expect(permitidas.has(key), `${ev.action}: ${key}`).toBe(true);
    }
    const texto = JSON.stringify(todos);
    for (const proibido of [NOME, "Segredo do segmento", "Outro segmento", "Pessoa Auditada", "pessoa.auditada@exemplo.test", "Projeto Auditado", "@"]) {
      expect(texto, proibido).not.toContain(proibido);
    }
  });

  it("só administrador lê; ninguém altera nem apaga", async () => {
    const admin = await db.asUser(IDS.admin, async () => (await db.query("select 1 from public.audit_events where entity_type = 'client'")).rows.length);
    expect(admin).toBeGreaterThan(0);
    for (const user of [IDS.atendimento, IDS.designer, IDS.userClienteA]) {
      const n = await db.asUser(user, async () => (await db.query("select 1 from public.audit_events")).rows.length);
      expect(n, user).toBe(0);
    }
    expect(await errorOf(() => db.query("update public.audit_events set action = 'x_x'"))).toMatch(/imutável/);
    expect(await errorOf(() => db.query("delete from public.audit_events"))).toMatch(/imutável/);
  });

  it("falha na operação não deixa evento órfão (a auditoria entra na mesma transação)", async () => {
    const antes = (await rows("select 1 from public.audit_events")).length;
    await run(as.designer, "insert into public.clients (organization_id, name, initials) values ($1, 'Negado', 'NG')", [IDS.orgLuvi]); // RLS nega
    expect((await rows("select 1 from public.audit_events")).length).toBe(antes);
  });
});
