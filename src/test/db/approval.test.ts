// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IDS,
  createMaterial,
  createTestDb,
  openLinkSession,
  sessionHashOf,
  uid,
  errorOf,
  seedBase,
  sha256Hex,
  type SentMaterial,
  type TestDb,
} from "./harness";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ serviceRoleFullAccess: true }); // prova as travas até para um servidor com ALL (mínimo real: service-role-grants.test.ts)
  await seedBase(db);
}, 180_000);

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

describe("aprovação por link seguro (código + sessão)", () => {
  // O link pertence à solicitação individual do aprovador sem login (aprovadorALink).
  const sentLink = () => createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true, approverId: IDS.aprovadorALink });
  const decideLink = (tokenHash: string, sessionHash: string | null, decision: "aprovado" | "alteracao", note = "", ip = sha256Hex("ip")) =>
    db.asService(() =>
      db.query("select public.decide_with_link_session($1,$2,$3,$4,$5,$6)", [tokenHash, sessionHash, decision, note, ip, "Mozilla/5.0 teste"]),
    );

  it("a equipe cria o link guardando só o hash; o servidor decide com token + sessão verificada", async () => {
    const m = await sentLink();
    const linkId = await createLink(m, "link-feliz");

    const stored = await db.query<{ token_hash: string }>("select token_hash from public.approval_links where id=$1", [linkId]);
    expect(stored.rows[0].token_hash).toBe(sha256Hex("link-feliz"));

    const { tokenHash, sessionHash } = await openLinkSession(db, "link-feliz");
    await decideLink(tokenHash, sessionHash, "aprovado");

    expect(await statusOf(m.materialId)).toBe("aprovado");
    const d = await db.query<{ via: string; link_id: string; approver_id: string; ip_hash: string }>(
      "select via, link_id, approver_id, ip_hash from public.decisions where request_id=$1",
      [m.requestId],
    );
    expect(d.rows[0]).toEqual({ via: "link", link_id: linkId, approver_id: IDS.aprovadorALink, ip_hash: sha256Hex("ip") });
    const link = await db.query<{ used_at: string | null }>("select used_at from public.approval_links where id=$1", [linkId]);
    expect(link.rows[0].used_at).not.toBeNull();
  });

  it("sem sessão verificada a decisão é recusada (o token sozinho não basta)", async () => {
    const m = await sentLink();
    await createLink(m, "sem-sessao");
    const tokenHash = sha256Hex("sem-sessao");
    expect(await errorOf(() => decideLink(tokenHash, null, "aprovado"))).toMatch(/sessão/);
    expect(await errorOf(() => decideLink(tokenHash, sessionHashOf("outra"), "aprovado"))).toMatch(/sessão/);
    expect(await statusOf(m.materialId)).toBe("aguardando");
  });

  it("a sessão de um link não vale para outro link", async () => {
    const m1 = await sentLink();
    const m2 = await sentLink();
    await createLink(m1, "link-um");
    await createLink(m2, "link-dois");
    const um = await openLinkSession(db, "link-um");
    expect(await errorOf(() => decideLink(sha256Hex("link-dois"), um.sessionHash, "aprovado"))).toMatch(/sessão/);
    expect(await statusOf(m2.materialId)).toBe("aguardando");
  });

  it("o link é de uso único", async () => {
    const m = await sentLink();
    await createLink(m, "uso-unico");
    const { tokenHash, sessionHash } = await openLinkSession(db, "uso-unico");
    await decideLink(tokenHash, sessionHash, "aprovado");
    expect(await errorOf(() => decideLink(tokenHash, sessionHash, "aprovado"))).toMatch(/link indisponível \(used\)/);
  });

  it("alteração por link exige descrição de 10+ caracteres e leva o material para ajustes", async () => {
    const m = await sentLink();
    await createLink(m, "pede-alteracao");
    const { tokenHash, sessionHash } = await openLinkSession(db, "pede-alteracao");
    expect(await errorOf(() => decideLink(tokenHash, sessionHash, "alteracao", "curto"))).toMatch(/check|note/i);
    expect(await statusOf(m.materialId)).toBe("aguardando");
    await decideLink(tokenHash, sessionHash, "alteracao", "Trocar a imagem do slide 2");
    expect(await statusOf(m.materialId)).toBe("alteracao");
  });

  it("rejeita link expirado", async () => {
    const m = await sentLink();
    const linkId = await createLink(m, "expirado");
    const { tokenHash, sessionHash } = await openLinkSession(db, "expirado");
    await db.query(
      "update public.approval_links set created_at = now() - interval '10 days', expires_at = now() - interval '1 day' where id=$1",
      [linkId],
    );
    expect(await errorOf(() => decideLink(tokenHash, sessionHash, "aprovado"))).toMatch(/expired/);
    expect(await statusOf(m.materialId)).toBe("aguardando");
  });

  it("rejeita link revogado (inclusive com sessão já aberta)", async () => {
    const m = await sentLink();
    const linkId = await createLink(m, "revogado");
    const { tokenHash, sessionHash } = await openLinkSession(db, "revogado");
    await db.asUser(IDS.designer, () => db.query("select public.revoke_approval_link($1)", [linkId]));
    expect(await errorOf(() => decideLink(tokenHash, sessionHash, "aprovado"))).toMatch(/revoked/);
    const ctx = await db.asService(() => db.query<{ r: { status: string } }>("select public.link_session_context($1,$2) as r", [tokenHash, sessionHash]));
    expect(ctx.rows[0].r.status).toBe("revoked");
  });

  it("sessão expirada não decide", async () => {
    const m = await sentLink();
    await createLink(m, "sessao-velha");
    const { tokenHash, sessionHash } = await openLinkSession(db, "sessao-velha");
    await db.query("update public.approval_link_sessions set expires_at = now() - interval '1 second'");
    expect(await errorOf(() => decideLink(tokenHash, sessionHash, "aprovado"))).toMatch(/sessão/);
  });

  it("usuários do app (e o anônimo) não chamam nenhuma função do fluxo por link; decide_via_link não existe", async () => {
    const m = await sentLink();
    await createLink(m, "so-servidor");
    const calls = [
      "select public.link_resolve($1)",
      "select public.link_issue_code($1, $1)",
      "select public.link_verify_code($1, $1, $1)",
      "select public.link_session_context($1, $1)",
      "select public.decide_with_link_session($1, $1, 'aprovado')",
    ];
    for (const sql of calls) {
      for (const user of [IDS.designer, IDS.userClienteA, IDS.admin]) {
        expect(await db.asUser(user, () => errorOf(() => db.query(sql, [sha256Hex("so-servidor")]))), sql).toMatch(/permission denied/);
      }
      expect(await db.asAnon(() => errorOf(() => db.query(sql, [sha256Hex("so-servidor")]))), sql).toMatch(/permission denied/);
    }
    expect(await db.asService(() => errorOf(() => db.query("select public.decide_via_link($1,'aprovado','')", [uid(1)])))).toMatch(/does not exist/);
  });

  it("recusa link cuja solicitação já foi decidida pelo portal (sincronia portal/link)", async () => {
    const m = await sent();
    await createLink(m, "portal-primeiro", IDS.aprovadorA);
    const { tokenHash, sessionHash } = await openLinkSession(db, "portal-primeiro");
    await decide(IDS.userClienteA, m, "aprovado");
    expect(await errorOf(() => decideLink(tokenHash, sessionHash, "alteracao", "quero mudar tudo agora"))).toMatch(/closed/);
    const status = await db.asService(() => db.query<{ r: { status: string } }>("select public.link_resolve($1) as r", [tokenHash]));
    expect(status.rows[0].r.status).toBe("closed");
  });

  it("validade máxima de 30 dias e mínimo no futuro", async () => {
    const m = await sentLink();
    expect(await errorOf(() => createLink(m, "longo", IDS.aprovadorALink, 31))).toMatch(/30 dias/);
    expect(await errorOf(() => createLink(m, "passado", IDS.aprovadorALink, -1))).toMatch(/30 dias/);
    expect(await errorOf(() => createLink(m, "no-limite", IDS.aprovadorALink, 30))).toBeNull();
  });

  it("só a equipe da mesma agência cria link, e só para o aprovador DA solicitação", async () => {
    const m = await sentLink();
    const create = (user: string, approver: string, seed: string) =>
      db.asUser(user, () =>
        errorOf(() =>
          db.query("select public.create_approval_link($1,$2,$3, now() + interval '7 days')", [m.requestId, approver, sha256Hex(seed)]),
        ),
      );
    expect(await create(IDS.userClienteA, IDS.aprovadorALink, "c1")).toMatch(/sem permissão/);
    expect(await create(IDS.staffOutraOrg, IDS.aprovadorALink, "c2")).toMatch(/sem permissão/);
    expect(await create(IDS.designer, IDS.aprovadorB, "c3")).toMatch(/aprovador inválido/);
    expect(await create(IDS.designer, IDS.aprovadorA, "c3b")).toMatch(/aprovador inválido/); // outro aprovador do mesmo cliente
    expect(await create(IDS.designer, IDS.aprovadorALink, "c4")).toBeNull();
  });

  it("reemitir o link revoga o anterior (só um link ativo por solicitação)", async () => {
    const m = await sentLink();
    const antigo = await createLink(m, "antigo");
    const novo = await createLink(m, "novo");
    const rows = await db.query<{ id: string; revoked_at: string | null }>("select id, revoked_at from public.approval_links where request_id=$1", [m.requestId]);
    expect(rows.rows.find((r) => r.id === antigo)?.revoked_at).not.toBeNull();
    expect(rows.rows.find((r) => r.id === novo)?.revoked_at).toBeNull();
  });

  it("o hash do token é único e tem formato validado", async () => {
    const m = await sentLink();
    const m2 = await sentLink();
    await createLink(m, "duplicado");
    expect(await errorOf(() => createLink(m2, "duplicado"))).toMatch(/unique|duplicate/i);
    const erro = await db.asUser(IDS.designer, () =>
      errorOf(() => db.query("select public.create_approval_link($1,$2,'token-em-texto-puro', now() + interval '1 day')", [m.requestId, IDS.aprovadorALink])),
    );
    expect(erro).toMatch(/check/i);
  });

  it("outra agência não revoga links alheios", async () => {
    const m = await sentLink();
    const linkId = await createLink(m, "alheio");
    const erro = await db.asUser(IDS.staffOutraOrg, () => errorOf(() => db.query("select public.revoke_approval_link($1)", [linkId])));
    expect(erro).toMatch(/sem permissão/);
  });
});

describe("cancelamento e ciclo de versões", () => {
  it("cancelar a solicitação devolve o material a rascunho e revoga os links", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true, approverId: IDS.aprovadorALink });
    const linkId = await createLink(m, "para-cancelar");
    const sessao = await openLinkSession(db, "para-cancelar");
    await db.asUser(IDS.designer, () => db.query("select public.cancel_approval_request($1)", [m.requestId]));

    expect(await statusOf(m.materialId)).toBe("rascunho");
    const link = await db.query<{ revoked_at: string | null }>("select revoked_at from public.approval_links where id=$1", [linkId]);
    expect(link.rows[0].revoked_at).not.toBeNull();
    const erro = await db.asService(() => errorOf(() => db.query("select public.decide_with_link_session($1,$2,'aprovado')", [sessao.tokenHash, sessao.sessionHash])));
    expect(erro).toMatch(/revoked/);
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
      await db.query("select public.submit_for_approval($1, array[$2]::uuid[])", [versionId, IDS.aprovadorA]);
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

describe("cliente arquivado (active = false)", () => {
  const setClientActive = (active: boolean) =>
    db.query("update public.clients set active = $1 where id = $2", [active, IDS.clienteA]);

  it("o aprovador de um cliente arquivado não decide pelo portal", async () => {
    const m = await sent();
    await setClientActive(false);
    try {
      expect(await errorOf(() => decide(IDS.userClienteA, m, "aprovado"))).toMatch(/sem permissão/);
    } finally {
      await setClientActive(true);
    }
    expect(await statusOf(m.materialId)).toBe("aguardando");
  });

  it("nem por link já emitido: o núcleo da decisão revalida o cliente", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true, approverId: IDS.aprovadorALink });
    await createLink(m, "cliente-arquivado");
    const { tokenHash, sessionHash } = await openLinkSession(db, "cliente-arquivado");
    await setClientActive(false);
    try {
      const erro = await db.asService(() =>
        errorOf(() => db.query("select public.decide_with_link_session($1,$2,'aprovado')", [tokenHash, sessionHash])),
      );
      expect(erro).toMatch(/link indisponível \(closed\)/);
    } finally {
      await setClientActive(true);
    }
    expect(await statusOf(m.materialId)).toBe("aguardando");
  });

  it("reativar o cliente restabelece o acesso", async () => {
    const m = await sent();
    await setClientActive(false);
    await setClientActive(true);
    expect(await errorOf(() => decide(IDS.userClienteA, m, "aprovado"))).toBeNull();
  });
});
