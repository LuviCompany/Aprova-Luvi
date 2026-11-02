// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IDS,
  createMaterial,
  createTestDb,
  errorOf,
  seedBase,
  sha256Hex,
  type SentMaterial,
  type TestDb,
} from "./harness";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await seedBase(db);
}, 60_000);

afterAll(async () => {
  await db.close();
});

const sent = (clientId = IDS.clienteA, projectId = IDS.projetoA) =>
  createMaterial(db, { clientId, projectId, sent: true });

const statusOf = async (materialId: string) =>
  (await db.query<{ status: string }>("select status from public.materials where id=$1", [materialId])).rows[0].status;

const decide = (user: string, m: SentMaterial, decision: "aprovado" | "alteracao", note = "") =>
  db.asUser(user, () => db.query("select public.decide_as_approver($1, $2, $3)", [m.requestId, decision, note]));

const createLink = async (
  m: SentMaterial,
  seed: string,
  approverId = IDS.aprovadorALink,
  days = 7,
): Promise<string> =>
  db.asUser(IDS.designer, async () => {
    const { rows } = await db.query<{ id: string }>(
      "select public.create_approval_link($1,$2,$3, now() + ($4 || ' days')::interval) as id",
      [m.requestId, approverId, sha256Hex(seed), String(days)],
    );
    return rows[0].id;
  });

describe("aprovação autenticada (portal)", () => {
  it("aprova: grava decisão, encerra a solicitação, atualiza o material e audita", async () => {
    const m = await sent();
    await decide(IDS.userClienteA, m, "aprovado");

    expect(await statusOf(m.materialId)).toBe("aprovado");
    const req = await db.query<{ status: string; closed_at: string | null }>("select status, closed_at from public.approval_requests where id=$1", [m.requestId]);
    expect(req.rows[0].status).toBe("decidida");
    expect(req.rows[0].closed_at).not.toBeNull();

    const d = await db.query<{ decision: string; via: string; approver_id: string; link_id: string | null }>(
      "select decision, via, approver_id, link_id from public.decisions where request_id=$1",
      [m.requestId],
    );
    expect(d.rows).toEqual([{ decision: "aprovado", via: "portal", approver_id: IDS.aprovadorA, link_id: null }]);

    const audit = await db.query("select 1 from public.audit_events where action='decision.recorded' and metadata->>'material_id'=$1", [m.materialId]);
    expect(audit.rows).toHaveLength(1);
  });

  it("solicitação de alteração exige descrição de pelo menos 10 caracteres", async () => {
    const m = await sent();
    expect(await errorOf(() => decide(IDS.userClienteA, m, "alteracao", "curto"))).toMatch(/check/i);
    expect(await errorOf(() => decide(IDS.userClienteA, m, "alteracao", "          "))).toMatch(/check/i);
    expect(await statusOf(m.materialId)).toBe("aguardando");

    await decide(IDS.userClienteA, m, "alteracao", "Trocar a foto do slide 2 por uma mais clara");
    expect(await statusOf(m.materialId)).toBe("alteracao");
  });

  it("não aceita uma segunda decisão para a mesma solicitação", async () => {
    const m = await sent();
    await decide(IDS.userClienteA, m, "aprovado");
    expect(await errorOf(() => decide(IDS.userClienteA, m, "alteracao", "mudei de ideia, refazer tudo"))).toMatch(/já foi encerrada/);
    expect(await statusOf(m.materialId)).toBe("aprovado");
  });

  it("só o aprovador do cliente dono decide: outro cliente, equipe e perfil inativo são barrados", async () => {
    const m = await sent();
    expect(await errorOf(() => decide(IDS.userClienteB, m, "aprovado"))).toMatch(/sem permissão/);
    expect(await errorOf(() => decide(IDS.designer, m, "aprovado"))).toMatch(/sem permissão/);
    expect(await errorOf(() => decide(IDS.admin, m, "aprovado"))).toMatch(/sem permissão/);
    expect(await errorOf(() => decide(IDS.userInativo, m, "aprovado"))).toMatch(/sem permissão/);
    expect(await statusOf(m.materialId)).toBe("aguardando");
  });

  it("solicitação inexistente responde igual a solicitação de outro cliente (sem vazar existência)", async () => {
    const m = await sent();
    const ghost = db.asUser(IDS.userClienteB, () => errorOf(() => db.query("select public.decide_as_approver('00000000-0000-4000-8000-00000000ffff','aprovado','')")));
    const foreign = db.asUser(IDS.userClienteB, () => errorOf(() => db.query("select public.decide_as_approver($1,'aprovado','')", [m.requestId])));
    expect(await ghost).toBe(await foreign);
  });

  it("ninguém grava decisão diretamente na tabela", async () => {
    const m = await sent();
    const erro = await db.asUser(IDS.userClienteA, () =>
      errorOf(() =>
        db.query(
          `insert into public.decisions (request_id, material_id, version_id, client_id, decision, approver_id, via)
           values ($1,$2,$3,$4,'aprovado',$5,'portal')`,
          [m.requestId, m.materialId, m.versionId, IDS.clienteA, IDS.aprovadorA],
        ),
      ),
    );
    expect(erro).toMatch(/permission denied/);
  });

  it("o cliente e a equipe enxergam a mesma decisão (sincronia portal/dashboard)", async () => {
    const m = await sent();
    await decide(IDS.userClienteA, m, "aprovado");
    const query = async (user: string) =>
      db.asUser(user, async () => (await db.query<{ decision: string }>("select decision from public.decisions where request_id=$1", [m.requestId])).rows);
    expect(await query(IDS.userClienteA)).toEqual([{ decision: "aprovado" }]);
    expect(await query(IDS.designer)).toEqual([{ decision: "aprovado" }]);
    expect(await query(IDS.userClienteB)).toEqual([]);
  });
});

describe("aprovação por link seguro", () => {
  it("a equipe cria o link guardando só o hash; o servidor decide com o link validado", async () => {
    const m = await sent();
    const linkId = await createLink(m, "link-feliz");

    const stored = await db.query<{ token_hash: string }>("select token_hash from public.approval_links where id=$1", [linkId]);
    expect(stored.rows[0].token_hash).toBe(sha256Hex("link-feliz"));

    await db.asService(() => db.query("select public.decide_via_link($1,'aprovado','', $2, $3)", [linkId, sha256Hex("ip"), "Mozilla/5.0 teste"]));

    expect(await statusOf(m.materialId)).toBe("aprovado");
    const d = await db.query<{ via: string; link_id: string; approver_id: string; ip_hash: string }>(
      "select via, link_id, approver_id, ip_hash from public.decisions where request_id=$1",
      [m.requestId],
    );
    expect(d.rows[0]).toEqual({ via: "link", link_id: linkId, approver_id: IDS.aprovadorALink, ip_hash: sha256Hex("ip") });
    const link = await db.query<{ used_at: string | null }>("select used_at from public.approval_links where id=$1", [linkId]);
    expect(link.rows[0].used_at).not.toBeNull();
  });

  it("o link é de uso único", async () => {
    const m = await sent();
    const linkId = await createLink(m, "uso-unico");
    await db.asService(() => db.query("select public.decide_via_link($1,'aprovado','')", [linkId]));
    const erro = await db.asService(() => errorOf(() => db.query("select public.decide_via_link($1,'aprovado','')", [linkId])));
    expect(erro).toMatch(/já utilizado/);
  });

  it("rejeita link expirado", async () => {
    const m = await sent();
    const linkId = await createLink(m, "expirado");
    await db.query(
      "update public.approval_links set created_at = now() - interval '10 days', expires_at = now() - interval '1 day' where id=$1",
      [linkId],
    );
    const erro = await db.asService(() => errorOf(() => db.query("select public.decide_via_link($1,'aprovado','')", [linkId])));
    expect(erro).toMatch(/expirado/);
    expect(await statusOf(m.materialId)).toBe("aguardando");
  });

  it("rejeita link revogado", async () => {
    const m = await sent();
    const linkId = await createLink(m, "revogado");
    await db.asUser(IDS.designer, () => db.query("select public.revoke_approval_link($1)", [linkId]));
    const erro = await db.asService(() => errorOf(() => db.query("select public.decide_via_link($1,'aprovado','')", [linkId])));
    expect(erro).toMatch(/revogado/);
  });

  it("usuários do app não podem chamar decide_via_link (só o servidor)", async () => {
    const m = await sent();
    const linkId = await createLink(m, "so-servidor");
    for (const user of [IDS.designer, IDS.userClienteA, IDS.admin]) {
      const erro = await db.asUser(user, () => errorOf(() => db.query("select public.decide_via_link($1,'aprovado','')", [linkId])));
      expect(erro).toMatch(/permission denied/);
    }
    expect(await db.asAnon(() => errorOf(() => db.query("select public.decide_via_link($1,'aprovado','')", [linkId])))).toMatch(/permission denied/);
  });

  it("recusa link cuja solicitação já foi decidida pelo portal", async () => {
    const m = await sent();
    const linkId = await createLink(m, "portal-primeiro", IDS.aprovadorA);
    await decide(IDS.userClienteA, m, "aprovado");
    const erro = await db.asService(() => errorOf(() => db.query("select public.decide_via_link($1,'alteracao','quero mudar tudo agora')", [linkId])));
    expect(erro).toMatch(/encerrada/);
  });

  it("validade máxima de 30 dias e mínimo no futuro", async () => {
    const m = await sent();
    expect(await errorOf(() => createLink(m, "longo", IDS.aprovadorALink, 31))).toMatch(/30 dias/);
    expect(await errorOf(() => createLink(m, "passado", IDS.aprovadorALink, -1))).toMatch(/30 dias/);
    expect(await errorOf(() => createLink(m, "no-limite", IDS.aprovadorALink, 30))).toBeNull();
  });

  it("só a equipe da mesma agência cria link, e só com aprovador do próprio cliente", async () => {
    const m = await sent();
    const create = (user: string, approver: string, seed: string) =>
      db.asUser(user, () =>
        errorOf(() =>
          db.query("select public.create_approval_link($1,$2,$3, now() + interval '7 days')", [m.requestId, approver, sha256Hex(seed)]),
        ),
      );
    expect(await create(IDS.userClienteA, IDS.aprovadorALink, "c1")).toMatch(/sem permissão/);
    expect(await create(IDS.staffOutraOrg, IDS.aprovadorALink, "c2")).toMatch(/sem permissão/);
    expect(await create(IDS.designer, IDS.aprovadorB, "c3")).toMatch(/aprovador inválido/);
    expect(await create(IDS.designer, IDS.aprovadorALink, "c4")).toBeNull();
  });

  it("o hash do token é único e tem formato validado", async () => {
    const m = await sent();
    await createLink(m, "duplicado");
    expect(await errorOf(() => createLink(m, "duplicado"))).toMatch(/unique|duplicate/i);
    const erro = await db.asUser(IDS.designer, () =>
      errorOf(() => db.query("select public.create_approval_link($1,$2,'token-em-texto-puro', now() + interval '1 day')", [m.requestId, IDS.aprovadorALink])),
    );
    expect(erro).toMatch(/check/i);
  });

  it("outra agência não revoga links alheios", async () => {
    const m = await sent();
    const linkId = await createLink(m, "alheio");
    const erro = await db.asUser(IDS.staffOutraOrg, () => errorOf(() => db.query("select public.revoke_approval_link($1)", [linkId])));
    expect(erro).toMatch(/sem permissão/);
  });
});

describe("cancelamento e ciclo de versões", () => {
  it("cancelar a solicitação devolve o material a rascunho e revoga os links", async () => {
    const m = await sent();
    const linkId = await createLink(m, "para-cancelar");
    await db.asUser(IDS.designer, () => db.query("select public.cancel_approval_request($1)", [m.requestId]));

    expect(await statusOf(m.materialId)).toBe("rascunho");
    const link = await db.query<{ revoked_at: string | null }>("select revoked_at from public.approval_links where id=$1", [linkId]);
    expect(link.rows[0].revoked_at).not.toBeNull();
    const erro = await db.asService(() => errorOf(() => db.query("select public.decide_via_link($1,'aprovado','')", [linkId])));
    expect(erro).toMatch(/revogado/);
  });

  it("clientes não cancelam solicitações", async () => {
    const m = await sent();
    const erro = await db.asUser(IDS.userClienteA, () => errorOf(() => db.query("select public.cancel_approval_request($1)", [m.requestId])));
    expect(erro).toMatch(/sem permissão/);
  });

  it("ciclo completo: alteração -> nova versão -> reenvio -> aprovação, preservando o histórico", async () => {
    const m = await sent();
    await decide(IDS.userClienteA, m, "alteracao", "Ajustar o logo e o preço do slide 3");
    expect(await statusOf(m.materialId)).toBe("alteracao");

    // Equipe cria a v2 (com arquivo) e reenvia.
    await db.asUser(IDS.designer, async () => {
      const v = await db.query<{ id: string }>(
        "insert into public.material_versions (material_id, client_id, note, created_by) values ($1,$2,'v2 ajustada',$3) returning id",
        [m.materialId, IDS.clienteA, IDS.designer],
      );
      const versionId = v.rows[0].id;
      await db.query(
        `insert into public.material_files (version_id, material_id, client_id, slide_position, kind, storage_path,
           original_name, mime_type, size_bytes, created_by)
         values ($1,$2,$3,1,'imagem',$4,'v2.png','image/png',100,$5)`,
        [versionId, m.materialId, IDS.clienteA, `${IDS.clienteA}/${m.materialId}/${versionId}/v2.png`, IDS.designer],
      );
      expect(await statusOf(m.materialId)).toBe("rascunho"); // não visível como pendente ainda
      await db.query("insert into public.approval_requests (material_id, version_id, client_id, requested_by) values ($1,$2,$3,$4)", [
        m.materialId,
        versionId,
        IDS.clienteA,
        IDS.designer,
      ]);
    });
    expect(await statusOf(m.materialId)).toBe("aguardando");

    const open = await db.query<{ id: string }>("select id from public.approval_requests where material_id=$1 and status='aberta'", [m.materialId]);
    await db.asUser(IDS.userClienteA, () => db.query("select public.decide_as_approver($1,'aprovado','')", [open.rows[0].id]));
    expect(await statusOf(m.materialId)).toBe("aprovado");

    const versions = await db.query<{ number: number }>("select number from public.material_versions where material_id=$1 order by number", [m.materialId]);
    const decisions = await db.query<{ decision: string; version_id: string }>(
      "select d.decision, v.number::text as version_id from public.decisions d join public.material_versions v on v.id = d.version_id where d.material_id=$1 order by v.number",
      [m.materialId],
    );
    expect(versions.rows.map((v) => v.number)).toEqual([1, 2]);
    expect(decisions.rows).toEqual([
      { decision: "alteracao", version_id: "1" },
      { decision: "aprovado", version_id: "2" },
    ]);
  });

  it("decisões são imutáveis até para o servidor (service_role)", async () => {
    const m = await sent();
    await decide(IDS.userClienteA, m, "aprovado");
    await db.asService(async () => {
      expect(await errorOf(() => db.query("update public.decisions set decision='alteracao', note='mudando o passado agora'"))).toMatch(/imutável/);
      expect(await errorOf(() => db.query("delete from public.decisions"))).toMatch(/imutável/);
      expect(await errorOf(() => db.exec("truncate public.decisions"))).toMatch(/imutável/);
    });
  });
});
