// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IDS,
  codeHashOf,
  createMaterial,
  createTestDb,
  errorOf,
  openLinkSession,
  seedBase,
  sessionHashOf,
  sha256Hex,
  uid,
  type TestDb,
} from "./harness";

/**
 * Módulo 4 — vários aprovadores. Política: TODOS os designados aprovam => aprovado; QUALQUER pedido
 * de alteração => ajustes, com o restante da rodada cancelado e todas as decisões preservadas.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await seedBase(db);
}, 180_000);

afterAll(async () => {
  await db.close();
});

const rows = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const draft = () => createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA });
const statusOf = async (id: string) => (await rows<{ status: string }>("select status from public.materials where id=$1", [id]))[0].status;
const submit = (user: string, versionId: string, approvers: string[], due: string | null = null) =>
  db.asUser(user, async () => (await db.query<{ s: string }>("select public.submit_for_approval($1,$2::uuid[],$3,'') as s", [versionId, approvers, due])).rows[0].s);
const requestsOf = (materialId: string) =>
  rows<{ id: string; approver_id: string; status: string; submission_id: string }>(
    "select id, approver_id, status, submission_id from public.approval_requests where material_id=$1 order by approver_id",
    [materialId],
  );
const requestOf = async (materialId: string, approverId: string) =>
  (await requestsOf(materialId)).find((r) => r.approver_id === approverId)!;
const portalDecide = (user: string, requestId: string, decision: "aprovado" | "alteracao", note = "") =>
  db.asUser(user, () => db.query("select public.decide_as_approver($1,$2,$3)", [requestId, decision, note]));
const linkFor = (requestId: string, approverId: string, token: string) =>
  db.asUser(IDS.designer, () =>
    db.query("select public.create_approval_link($1,$2,$3, now() + interval '7 days')", [requestId, approverId, sha256Hex(token)]),
  );
const linkDecide = async (token: string, decision: "aprovado" | "alteracao", note = "") => {
  const { tokenHash, sessionHash } = await openLinkSession(db, token);
  return db.asService(() => db.query("select public.decide_with_link_session($1,$2,$3,$4)", [tokenHash, sessionHash, decision, note]));
};

describe("envio para aprovação (submit_for_approval)", () => {
  it("cria uma solicitação INDIVIDUAL por aprovador, na mesma rodada e versão, e audita sem texto livre", async () => {
    const m = await draft();
    const sub = await submit(IDS.designer, m.versionId, [IDS.aprovadorA, IDS.aprovadorALink]);
    const rs = await requestsOf(m.materialId);
    expect(rs).toHaveLength(2);
    expect(new Set(rs.map((r) => r.submission_id))).toEqual(new Set([sub]));
    expect(rs.map((r) => r.status)).toEqual(["aberta", "aberta"]);
    expect(await statusOf(m.materialId)).toBe("aguardando");

    const audit = await rows<{ actor_profile_id: string; metadata: Record<string, unknown> }>(
      "select actor_profile_id, metadata from public.audit_events where action='material.submitted' and entity_id=$1",
      [m.materialId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_profile_id).toBe(IDS.designer);
    expect(audit[0].metadata).toMatchObject({ client_id: IDS.clienteA, version_id: m.versionId, submission_id: sub, approvers: 2 });
    expect(JSON.stringify(audit[0].metadata)).not.toMatch(/@/);
    // congelou o conteúdo apresentado
    expect(await rows("select 1 from public.material_version_contents where version_id=$1", [m.versionId])).toHaveLength(1);
  });

  it("valida a lista de aprovadores, o prazo, o estado e as permissões", async () => {
    const m = await draft();
    const falha = (user: string, ids: string[], due: string | null = null) => errorOf(() => submit(user, m.versionId, ids, due));
    expect(await falha(IDS.designer, [])).toMatch(/de 1 a 20 aprovadores/);
    expect(await falha(IDS.designer, [IDS.aprovadorA, IDS.aprovadorA])).toMatch(/sem repetir/);
    expect(await falha(IDS.designer, [IDS.aprovadorB])).toMatch(/aprovador inválido/); // de outro cliente
    expect(await falha(IDS.designer, [IDS.aprovadorA], "2000-01-01T00:00:00Z")).toMatch(/prazo/);
    expect(await falha(IDS.userClienteA, [IDS.aprovadorA])).toMatch(/sem permissão/);
    expect(await falha(IDS.staffOutraOrg, [IDS.aprovadorA])).toMatch(/sem permissão/);
    expect(await db.asAnon(() => errorOf(() => db.query("select public.submit_for_approval($1,$2::uuid[])", [m.versionId, [IDS.aprovadorA]])))).toMatch(/permission denied/);
    expect(await statusOf(m.materialId)).toBe("rascunho"); // nada foi criado pelas falhas
    expect(await requestsOf(m.materialId)).toHaveLength(0);

    await db.query("update public.approvers set active=false where id=$1", [IDS.aprovadorALink]);
    expect(await falha(IDS.designer, [IDS.aprovadorA, IDS.aprovadorALink])).toMatch(/inativo/);
    await db.query("update public.approvers set active=true where id=$1", [IDS.aprovadorALink]);
    expect(await requestsOf(m.materialId)).toHaveLength(0); // tudo-ou-nada

    await submit(IDS.designer, m.versionId, [IDS.aprovadorA]);
    expect(await falha(IDS.designer, [IDS.aprovadorA])).toMatch(/só material em rascunho/);
  });

  it("ninguém insere solicitação direto na tabela (nem a equipe)", async () => {
    const m = await draft();
    for (const user of [IDS.designer, IDS.admin, IDS.userClienteA]) {
      const erro = await db.asUser(user, () =>
        errorOf(() =>
          db.query(
            "insert into public.approval_requests (material_id, version_id, client_id, requested_by, approver_id, submission_id) values ($1,$2,$3,$4,$5,$5)",
            [m.materialId, m.versionId, IDS.clienteA, user, IDS.aprovadorA],
          ),
        ),
      );
      expect(erro).toMatch(/permission denied/);
    }
  });

  it("cada aprovador enxerga só a PRÓPRIA solicitação; a equipe vê todas", async () => {
    const m = await draft();
    await submit(IDS.designer, m.versionId, [IDS.aprovadorA, IDS.aprovadorALink]);
    const ver = (user: string) => db.asUser(user, async () => (await db.query<{ approver_id: string }>("select approver_id from public.approval_requests where material_id=$1", [m.materialId])).rows.map((r) => r.approver_id));
    expect(await ver(IDS.userClienteA)).toEqual([IDS.aprovadorA]);
    expect((await ver(IDS.designer)).sort()).toEqual([IDS.aprovadorA, IDS.aprovadorALink].sort());
    expect(await ver(IDS.userClienteB)).toEqual([]);
  });
});

describe("política de aprovação final (todos aprovam)", () => {
  const sentTwo = async () => {
    const m = await draft();
    await submit(IDS.designer, m.versionId, [IDS.aprovadorA, IDS.aprovadorALink]);
    return m;
  };

  it("com dois aprovadores o material só vira aprovado quando OS DOIS aprovam (portal + link)", async () => {
    const m = await sentTwo();
    const rA = await requestOf(m.materialId, IDS.aprovadorA);
    const rL = await requestOf(m.materialId, IDS.aprovadorALink);
    await linkFor(rL.id, IDS.aprovadorALink, "dois-aprovam");

    await portalDecide(IDS.userClienteA, rA.id, "aprovado");
    expect(await statusOf(m.materialId)).toBe("aguardando"); // falta o outro
    await linkDecide("dois-aprovam", "aprovado");
    expect(await statusOf(m.materialId)).toBe("aprovado");

    const d = await rows<{ approver_id: string; via: string; decision: string }>(
      "select approver_id, via, decision from public.decisions where material_id=$1 order by created_at, id",
      [m.materialId],
    );
    expect(d).toEqual([
      { approver_id: IDS.aprovadorA, via: "portal", decision: "aprovado" },
      { approver_id: IDS.aprovadorALink, via: "link", decision: "aprovado" },
    ]);
  });

  it("um pedido de alteração leva a ajustes, cancela o restante da rodada, revoga os links e preserva as aprovações", async () => {
    const m = await sentTwo();
    const rA = await requestOf(m.materialId, IDS.aprovadorA);
    const rL = await requestOf(m.materialId, IDS.aprovadorALink);
    await linkFor(rL.id, IDS.aprovadorALink, "quem-ficou");

    await portalDecide(IDS.userClienteA, rA.id, "alteracao", "Ajustar o logo do slide 1");
    expect(await statusOf(m.materialId)).toBe("alteracao");
    expect((await requestOf(m.materialId, IDS.aprovadorA)).status).toBe("decidida");
    expect((await requestOf(m.materialId, IDS.aprovadorALink)).status).toBe("cancelada");
    expect((await rows<{ revoked_at: string | null }>("select revoked_at from public.approval_links where request_id=$1", [rL.id]))[0].revoked_at).not.toBeNull();

    // o outro aprovador não consegue mais decidir (nem por link: já está revogado/fechado)
    const { tokenHash } = { tokenHash: sha256Hex("quem-ficou") };
    const status = await db.asService(() => db.query<{ r: { status: string } }>("select public.link_resolve($1) as r", [tokenHash]));
    expect(status.rows[0].r.status).toBe("revoked");
  });

  it("aprovação já dada é preservada quando o segundo aprovador pede alteração", async () => {
    const m = await sentTwo();
    const rA = await requestOf(m.materialId, IDS.aprovadorA);
    const rL = await requestOf(m.materialId, IDS.aprovadorALink);
    await linkFor(rL.id, IDS.aprovadorALink, "pede-depois");
    await portalDecide(IDS.userClienteA, rA.id, "aprovado");
    await linkDecide("pede-depois", "alteracao", "Trocar a legenda por favor");
    expect(await statusOf(m.materialId)).toBe("alteracao");
    const d = await rows<{ decision: string }>("select decision from public.decisions where material_id=$1 order by created_at, id", [m.materialId]);
    expect(d.map((x) => x.decision)).toEqual(["aprovado", "alteracao"]);
  });

  it("decisões são imutáveis e uma solicitação só aceita UMA decisão", async () => {
    const m = await sentTwo();
    const rA = await requestOf(m.materialId, IDS.aprovadorA);
    await portalDecide(IDS.userClienteA, rA.id, "aprovado");
    expect(await errorOf(() => portalDecide(IDS.userClienteA, rA.id, "alteracao", "mudei de ideia agora"))).toMatch(/encerrada/);
    expect(await db.asService(() => errorOf(() => db.query("update public.decisions set decision='alteracao' where request_id=$1", [rA.id])))).toMatch(/imutável/);
    expect(await rows("select 1 from public.decisions where request_id=$1", [rA.id])).toHaveLength(1);
  });

  it("o aprovador de uma solicitação não decide a do colega (mesmo cliente)", async () => {
    const m = await sentTwo();
    const rL = await requestOf(m.materialId, IDS.aprovadorALink);
    expect(await errorOf(() => portalDecide(IDS.userClienteA, rL.id, "aprovado"))).toMatch(/não autorizado/);
    expect(await errorOf(() => portalDecide(IDS.userClienteB, rL.id, "aprovado"))).toMatch(/sem permissão/);
  });

  it("aprovador desativado no meio da rodada: a solicitação dele não pode mais ser decidida", async () => {
    const m = await sentTwo();
    const rA = await requestOf(m.materialId, IDS.aprovadorA);
    await db.query("update public.approvers set active=false where id=$1", [IDS.aprovadorA]);
    expect(await errorOf(() => portalDecide(IDS.userClienteA, rA.id, "aprovado"))).toMatch(/sem permissão/);
    await db.query("update public.approvers set active=true where id=$1", [IDS.aprovadorA]);
  });
});

describe("cancelar a rodada e reenviar", () => {
  it("cancelar uma solicitação cancela a rodada inteira, revoga links e devolve a rascunho; as decisões já dadas ficam", async () => {
    const m = await draft();
    await submit(IDS.designer, m.versionId, [IDS.aprovadorA, IDS.aprovadorALink]);
    const rA = await requestOf(m.materialId, IDS.aprovadorA);
    const rL = await requestOf(m.materialId, IDS.aprovadorALink);
    await linkFor(rL.id, IDS.aprovadorALink, "cancelar-rodada");
    await portalDecide(IDS.userClienteA, rA.id, "aprovado");

    await db.asUser(IDS.designer, () => db.query("select public.cancel_approval_request($1)", [rL.id]));
    expect(await statusOf(m.materialId)).toBe("rascunho");
    expect((await requestsOf(m.materialId)).map((r) => r.status).sort()).toEqual(["cancelada", "decidida"]);
    expect(await rows("select 1 from public.decisions where material_id=$1", [m.materialId])).toHaveLength(1);
    expect((await rows<{ revoked_at: string | null }>("select revoked_at from public.approval_links where request_id=$1", [rL.id]))[0].revoked_at).not.toBeNull();
    const audit = await rows<{ metadata: Record<string, unknown> }>("select metadata from public.audit_events where action='approval_request.cancelled' and entity_id=$1", [rL.id]);
    expect(audit).toHaveLength(1);
  });

  it("reenviar a MESMA versão sem mexer no conteúdo funciona; com conteúdo alterado exige nova versão", async () => {
    const m = await draft();
    await submit(IDS.designer, m.versionId, [IDS.aprovadorA]);
    const antes = (await rows<{ content: unknown }>("select content from public.material_version_contents where version_id=$1", [m.versionId]))[0].content;
    const r = await requestOf(m.materialId, IDS.aprovadorA);
    await db.asUser(IDS.designer, () => db.query("select public.cancel_approval_request($1)", [r.id]));
    expect(await statusOf(m.materialId)).toBe("rascunho");

    expect(await errorOf(() => submit(IDS.designer, m.versionId, [IDS.aprovadorA]))).toBeNull();
    const r2 = (await requestsOf(m.materialId)).find((x) => x.status === "aberta")!;
    await db.asUser(IDS.designer, () => db.query("select public.cancel_approval_request($1)", [r2.id]));

    await db.query("update public.materials set title='Título alterado depois do envio' where id=$1", [m.materialId]);
    expect(await errorOf(() => submit(IDS.designer, m.versionId, [IDS.aprovadorA]))).toMatch(/crie uma nova versão/);
    const depois = (await rows<{ content: unknown }>("select content from public.material_version_contents where version_id=$1", [m.versionId]))[0].content;
    expect(depois).toEqual(antes); // o conteúdo congelado nunca muda
  });

  it("alteração -> nova versão -> novo envio: cada versão tem sua rodada, congelamento e histórico", async () => {
    const m = await draft();
    const s1 = await submit(IDS.designer, m.versionId, [IDS.aprovadorA, IDS.aprovadorALink]);
    const rA = await requestOf(m.materialId, IDS.aprovadorA);
    await portalDecide(IDS.userClienteA, rA.id, "alteracao", "Trocar a imagem principal");
    expect(await statusOf(m.materialId)).toBe("alteracao");

    const v2 = (await rows<{ id: string }>(
      "insert into public.material_versions (material_id, client_id, note, created_by) values ($1,$2,'v2',$3) returning id",
      [m.materialId, IDS.clienteA, IDS.designer],
    ))[0].id;
    await db.query(
      `insert into public.material_files (version_id, material_id, client_id, slide_position, kind, storage_path, original_name, mime_type, size_bytes, created_by)
       values ($1,$2,$3,1,'imagem',$4,'v2.png','image/png',100,$5)`,
      [v2, m.materialId, IDS.clienteA, `${IDS.clienteA}/${m.materialId}/${v2}/v2.png`, IDS.designer],
    );
    const s2 = await submit(IDS.designer, v2, [IDS.aprovadorA, IDS.aprovadorALink]);
    expect(s2).not.toBe(s1);
    expect(await rows("select 1 from public.material_version_contents where material_id=$1", [m.materialId])).toHaveLength(2);

    const novas = (await requestsOf(m.materialId)).filter((r) => r.submission_id === s2);
    for (const r of novas) {
      if (r.approver_id === IDS.aprovadorA) await portalDecide(IDS.userClienteA, r.id, "aprovado");
    }
    const rL2 = novas.find((r) => r.approver_id === IDS.aprovadorALink)!;
    await linkFor(rL2.id, IDS.aprovadorALink, "v2-link");
    await linkDecide("v2-link", "aprovado");
    expect(await statusOf(m.materialId)).toBe("aprovado");
    // histórico completo: 1 alteração (v1) + 2 aprovações (v2)
    const d = await rows<{ n: number; decision: string }>(
      "select v.number as n, d.decision from public.decisions d join public.material_versions v on v.id=d.version_id where d.material_id=$1 order by v.number, d.decision",
      [m.materialId],
    );
    expect(d).toEqual([
      { n: 1, decision: "alteracao" },
      { n: 2, decision: "aprovado" },
      { n: 2, decision: "aprovado" },
    ]);
  });
});

describe("código de verificação do link", () => {
  const prepared = async (token: string) => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true, approverId: IDS.aprovadorALink });
    await linkFor(m.requestId, IDS.aprovadorALink, token);
    return { m, tokenHash: sha256Hex(token) };
  };
  const call = async (fn: string, args: unknown[]) =>
    db.asService(async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(",");
      return (await db.query<{ r: Record<string, unknown> }>(`select public.${fn}(${placeholders}) as r`, args)).rows[0].r;
    });

  it("o banco só guarda o HASH do código e da sessão; a auditoria da verificação não leva código", async () => {
    const { m, tokenHash } = await prepared("v-hash");
    const issued = await call("link_issue_code", [tokenHash, codeHashOf("v-hash")]);
    expect(issued).toMatchObject({ status: "ok", email: "link@clientea.test" });
    const v = await rows<{ code_hash: string }>("select code_hash from public.approval_verifications");
    expect(v.every((x) => /^[0-9a-f]{64}$/.test(x.code_hash))).toBe(true);
    expect(await call("link_verify_code", [tokenHash, codeHashOf("v-hash"), sessionHashOf("v-hash")])).toEqual({ status: "ok" });
    const audit = await rows<{ metadata: Record<string, unknown>; actor_approver_id: string }>(
      "select metadata, actor_approver_id from public.audit_events where action='approval_link.verified' and metadata->>'request_id'=$1",
      [m.requestId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_approver_id).toBe(IDS.aprovadorALink);
    expect(JSON.stringify(audit[0].metadata)).not.toContain(codeHashOf("v-hash"));
  });

  it("código errado: conta tentativas e bloqueia na 5ª (mesmo o código certo depois); novo código só após o intervalo", async () => {
    const { tokenHash } = await prepared("v-tentativas");
    await call("link_issue_code", [tokenHash, codeHashOf("v-tentativas")]);
    for (let i = 0; i < 5; i++) {
      const r = await call("link_verify_code", [tokenHash, sha256Hex(`errado${i}`), sessionHashOf("v-tentativas")]);
      expect(r).toMatchObject({ status: "invalid_code", remaining: 4 - i });
    }
    expect(await call("link_verify_code", [tokenHash, codeHashOf("v-tentativas"), sessionHashOf("v-tentativas")])).toEqual({ status: "locked" });
    expect(await rows("select 1 from public.approval_link_sessions where session_hash=$1", [sessionHashOf("v-tentativas")])).toHaveLength(0);
    // um novo código dentro de 60 s é recusado (cooldown)
    expect(await call("link_issue_code", [tokenHash, codeHashOf("outro")])).toEqual({ status: "cooldown" });
  });

  it("passado o intervalo, um novo código invalida o anterior; há limite de 5 códigos por hora", async () => {
    const { tokenHash } = await prepared("v-limite");
    await call("link_issue_code", [tokenHash, codeHashOf("a1")]);
    await db.query("update public.approval_verifications set created_at = now() - interval '2 minutes' where link_id = (select id from public.approval_links where token_hash=$1)", [tokenHash]);
    await call("link_issue_code", [tokenHash, codeHashOf("a2")]);
    // o código antigo deixou de valer
    expect(await call("link_verify_code", [tokenHash, codeHashOf("a1"), sessionHashOf("x1")])).toMatchObject({ status: "invalid_code" });
    expect(await call("link_verify_code", [tokenHash, codeHashOf("a2"), sessionHashOf("x2")])).toEqual({ status: "ok" });

    const { tokenHash: t2 } = await prepared("v-limite-2");
    for (let i = 0; i < 5; i++) {
      expect(await call("link_issue_code", [t2, codeHashOf(`c${i}`)])).toMatchObject({ status: "ok" });
      await db.query("update public.approval_verifications set created_at = created_at - interval '2 minutes' where link_id = (select id from public.approval_links where token_hash=$1)", [t2]);
    }
    expect(await call("link_issue_code", [t2, codeHashOf("c9")])).toEqual({ status: "limit" });
  });

  it("código expirado (10 min) e link inexistente respondem sem vazar nada", async () => {
    const { tokenHash } = await prepared("v-expira");
    await call("link_issue_code", [tokenHash, codeHashOf("v-expira")]);
    await db.query("update public.approval_verifications set expires_at = now() - interval '1 second' where link_id = (select id from public.approval_links where token_hash=$1)", [tokenHash]);
    expect(await call("link_verify_code", [tokenHash, codeHashOf("v-expira"), sessionHashOf("v-expira")])).toEqual({ status: "no_code" });
    expect(await call("link_resolve", [sha256Hex("nao-existe")])).toEqual({ status: "invalid" });
    expect(await call("link_issue_code", [sha256Hex("nao-existe"), codeHashOf("x")])).toEqual({ status: "invalid" });
    expect(await call("link_session_context", [sha256Hex("nao-existe"), sessionHashOf("x")])).toEqual({ status: "invalid" });
  });

  it("link_resolve só mostra o e-mail mascarado; o contexto só aparece com sessão válida e traz o escopo do link", async () => {
    const { m, tokenHash } = await prepared("v-contexto");
    const r = await call("link_resolve", [tokenHash]);
    expect(r).toEqual({ status: "ok", client_name: "Cliente A Teste", email_hint: "l***@clientea.test" });
    expect(await call("link_session_context", [tokenHash, sessionHashOf("v-contexto")])).toEqual({ status: "no_session" });
    await openLinkSession(db, "v-contexto");
    const ctx = await call("link_session_context", [tokenHash, sessionHashOf("v-contexto")]);
    expect(ctx).toMatchObject({ status: "ok", request_id: m.requestId, material_id: m.materialId, version_id: m.versionId, client_id: IDS.clienteA, approver_id: IDS.aprovadorALink });
  });

  it("código que não tem 64 hex é rejeitado e o cliente arquivado fecha o link", async () => {
    const { tokenHash } = await prepared("v-formato");
    expect(await db.asService(() => errorOf(() => db.query("select public.link_issue_code($1,'123456')", [tokenHash])))).toMatch(/código inválido/);
    await db.query("update public.clients set active=false where id=$1", [IDS.clienteA]);
    expect(await call("link_resolve", [tokenHash])).toEqual({ status: "closed" });
    await db.query("update public.clients set active=true where id=$1", [IDS.clienteA]);
  });
});

describe("limites e isolamento", () => {
  it("tamanho da rodada: no máximo 20 aprovadores", async () => {
    const m = await draft();
    const muitos = Array.from({ length: 21 }, (_, i) => uid(700 + i));
    expect(await errorOf(() => submit(IDS.designer, m.versionId, muitos))).toMatch(/de 1 a 20 aprovadores/);
  });

  it("material de outro cliente nunca entra na rodada", async () => {
    const outro = await createMaterial(db, { clientId: IDS.clienteB, projectId: IDS.projetoB });
    const erro = await errorOf(() => submit(IDS.designer, outro.versionId, [IDS.aprovadorA]));
    expect(erro).toMatch(/aprovador inválido|material inválido/);
  });
});
