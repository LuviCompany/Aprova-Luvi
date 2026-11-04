/**
 * Parte do servidor FALSO (mock-supabase.mjs) que imita o MOTOR DE APROVAÇÃO do Módulo 4: envio por aprovador,
 * decisão no portal, política "todos aprovam", cancelamento, links com código/sessão e leituras do portal.
 *
 * Como o resto do mock, isto só dá à interface algo para reagir. As regras de verdade (RLS, concorrência, limites)
 * são do banco e estão testadas em src/test/db (Postgres em memória com as migrations D1/D2).
 *
 * As funções `link_*` e `decide_with_link_session` só respondem à chave SECRETA (service_role), como no banco.
 */
import { randomUUID } from "node:crypto";

const CODE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 30 * 60_000;
const COOLDOWN_MS = 60_000;
const HOUR_MS = 3_600_000;

const iso = (ms) => new Date(ms).toISOString();

export async function handleApproval(c) {
  const { state, req, res, url, path, table, who, service, readBody, send, h } = c;
  const isStaff = who?.role !== "cliente";

  // ---- ganchos de teste (tempo): envelhecem registros sem esperar de verdade
  if (path.startsWith("/__approval/")) {
    const what = path.replace("/__approval/", "");
    if (what === "expire-code") for (const v of state.verifications) v.expires_at = Date.now() - 1000;
    else if (what === "expire-cooldown") for (const v of state.verifications) v.created_at = Math.min(v.created_at, Date.now() - COOLDOWN_MS - 1000);
    else if (what === "expire-link") for (const l of state.links) l.expires_at = Date.now() - 1000;
    else if (what === "expire-session") for (const s of state.sessions) s.expires_at = Date.now() - 1000;
    else return send(res, 404, { message: "gancho desconhecido" }), true;
    return send(res, 200, { ok: true }), true;
  }

  const myApprovers = () => state.approvers.filter((a) => who && a.profile_id === who.id && a.active && h.clientOf(a.client_id)?.active);
  const myClientIds = () => new Set(myApprovers().map((a) => a.client_id));
  const sentMaterial = (m) => state.requests.some((r) => r.material_id === m.id);
  const nameOf = (id) => state.approvers.find((a) => a.id === id)?.name ?? "Aprovador";
  const latestNumber = (materialId) => Math.max(0, ...state.versions.filter((v) => v.material_id === materialId).map((v) => v.number));

  // ---------------------------------------------------------------- decisão (núcleo)
  function applyDecision(request, approverId, decision, note, via, linkId) {
    const material = state.materials.find((m) => m.id === request.material_id);
    const version = state.versions.find((v) => v.id === request.version_id);
    if (request.status !== "aberta") return h.raise("esta solicitação já foi encerrada");
    const approver = state.approvers.find((a) => a.id === approverId);
    if (request.approver_id !== approverId || !approver?.active || !h.clientOf(request.client_id)?.active) return h.raise("aprovador não autorizado para esta solicitação");
    if (material.status !== "aguardando" || version.number !== latestNumber(material.id)) return h.raise("esta solicitação é de uma versão que não está mais em aprovação");
    const cleanNote = String(note ?? "").trim();
    if (decision === "alteracao" && cleanNote.length < 10) return { code: "23514", message: 'new row for relation "decisions" violates check constraint "decisions_check"' };
    state.decisions.push({
      id: randomUUID(), request_id: request.id, material_id: request.material_id, version_id: request.version_id, client_id: request.client_id,
      decision, note: cleanNote, approver_id: approverId, approver_name: approver.name, via, link_id: linkId ?? null,
      created_at: h.stamp(), requested_at: request.created_at,
    });
    request.status = "decidida";
    if (linkId) { const l = state.links.find((x) => x.id === linkId); if (l && !l.used_at) l.used_at = Date.now(); }
    if (decision === "alteracao") {
      material.status = "alteracao";
      for (const r of state.requests.filter((x) => x.submission_id === request.submission_id && x.status === "aberta")) {
        r.status = "cancelada";
        for (const l of state.links.filter((x) => x.request_id === r.id && !x.revoked_at)) l.revoked_at = Date.now();
      }
    } else if (!state.requests.some((x) => x.submission_id === request.submission_id && x.status === "aberta")) {
      material.status = "aprovado";
    }
    return null;
  }

  function linkState(l) {
    if (!l) return "invalid";
    if (l.revoked_at) return "revoked";
    if (l.used_at) return "used";
    if (l.expires_at <= Date.now()) return "expired";
    const r = state.requests.find((x) => x.id === l.request_id);
    const m = r && state.materials.find((x) => x.id === r.material_id);
    const v = r && state.versions.find((x) => x.id === r.version_id);
    const a = state.approvers.find((x) => x.id === l.approver_id);
    if (!r || r.status !== "aberta" || m?.status !== "aguardando" || v?.number !== latestNumber(r.material_id) || !a?.active || !h.clientOf(l.client_id)?.active) return "closed";
    return "ok";
  }
  const linkByHash = (hash) => state.links.find((l) => l.token_hash === hash);
  const sessionOk = (l, sessionHash) => state.sessions.some((s) => s.link_id === l.id && s.session_hash === sessionHash && s.expires_at > Date.now());

  // ---------------------------------------------------------------- RPCs
  if (path.startsWith("/rest/v1/rpc/") && req.method === "POST") {
    const fn = path.replace("/rest/v1/rpc/", "");
    const LINK_FNS = ["link_resolve", "link_issue_code", "link_verify_code", "link_session_context", "decide_with_link_session"];
    const OWN_FNS = ["submit_for_approval", "cancel_approval_request", "create_approval_link", "revoke_approval_link", "decide_as_approver", ...LINK_FNS];
    if (!OWN_FNS.includes(fn)) return false;
    const body = await readBody(req);
    const denied = () => (send(res, 403, { code: "42501", message: `permission denied for function ${fn}` }), true);

    if (LINK_FNS.includes(fn)) {
      if (!service) return denied();
      const l = linkByHash(body.p_token_hash);
      if (fn === "link_resolve") {
        if (!l) return send(res, 200, { status: "invalid" }), true;
        const st = linkState(l);
        if (st !== "ok") return send(res, 200, { status: st }), true;
        const a = state.approvers.find((x) => x.id === l.approver_id);
        return send(res, 200, { status: "ok", client_name: h.clientOf(l.client_id).name, email_hint: `${a.email.slice(0, 1)}***@${a.email.split("@")[1]}` }), true;
      }
      if (fn === "link_issue_code") {
        if (!/^[0-9a-f]{64}$/.test(body.p_code_hash ?? "")) return send(res, 400, h.raise("código inválido")), true;
        if (!l) return send(res, 200, { status: "invalid" }), true;
        const st = linkState(l);
        if (st !== "ok") return send(res, 200, { status: st }), true;
        const mine = state.verifications.filter((v) => v.link_id === l.id);
        if (mine.some((v) => v.created_at > Date.now() - COOLDOWN_MS)) return send(res, 200, { status: "cooldown" }), true;
        if (mine.filter((v) => v.created_at > Date.now() - HOUR_MS).length >= 5) return send(res, 200, { status: "limit" }), true;
        for (const v of mine) if (!v.consumed_at && v.expires_at > Date.now()) v.expires_at = Date.now();
        state.verifications.push({ id: randomUUID(), link_id: l.id, code_hash: body.p_code_hash, expires_at: Date.now() + CODE_TTL_MS, attempts: 0, consumed_at: null, created_at: Date.now() });
        const a = state.approvers.find((x) => x.id === l.approver_id);
        return send(res, 200, { status: "ok", email: a.email, approver_name: a.name, link_id: l.id }), true;
      }
      if (fn === "link_verify_code") {
        if (!/^[0-9a-f]{64}$/.test(body.p_code_hash ?? "") || !/^[0-9a-f]{64}$/.test(body.p_session_hash ?? "")) return send(res, 400, h.raise("dados inválidos")), true;
        if (!l) return send(res, 200, { status: "invalid" }), true;
        const st = linkState(l);
        if (st !== "ok") return send(res, 200, { status: st }), true;
        const v = state.verifications.filter((x) => x.link_id === l.id && !x.consumed_at && x.expires_at > Date.now()).sort((a, b) => b.created_at - a.created_at)[0];
        if (!v) return send(res, 200, { status: "no_code" }), true;
        if (v.attempts >= 5) return send(res, 200, { status: "locked" }), true;
        v.attempts += 1;
        if (v.code_hash !== body.p_code_hash) return send(res, 200, { status: "invalid_code", remaining: 5 - v.attempts }), true;
        v.consumed_at = Date.now();
        state.sessions.push({ id: randomUUID(), link_id: l.id, session_hash: body.p_session_hash, expires_at: Date.now() + SESSION_TTL_MS });
        return send(res, 200, { status: "ok" }), true;
      }
      if (fn === "link_session_context") {
        if (!l) return send(res, 200, { status: "invalid" }), true;
        const st = linkState(l);
        if (st !== "ok") return send(res, 200, { status: st }), true;
        if (!sessionOk(l, body.p_session_hash)) return send(res, 200, { status: "no_session" }), true;
        const r = state.requests.find((x) => x.id === l.request_id);
        return send(res, 200, {
          status: "ok", link_id: l.id, request_id: r.id, material_id: r.material_id, version_id: r.version_id, client_id: r.client_id,
          approver_id: l.approver_id, approver_name: nameOf(l.approver_id), due_at: r.due_at ?? null, message: r.message ?? "",
        }), true;
      }
      // decide_with_link_session
      if (!l) return send(res, 400, h.raise("link inválido")), true;
      const st = linkState(l);
      if (st !== "ok") return send(res, 400, h.raise(`link indisponível (${st})`)), true;
      if (!sessionOk(l, body.p_session_hash)) return send(res, 400, h.raise("sessão de verificação inválida ou expirada")), true;
      const r = state.requests.find((x) => x.id === l.request_id);
      const problem = applyDecision(r, l.approver_id, body.p_decision, body.p_note, "link", l.id);
      return problem ? (send(res, 400, problem), true) : (send(res, 200, randomUUID()), true);
    }

    if (service) return denied();

    if (fn === "decide_as_approver") {
      if (isStaff) return send(res, 400, h.raise("sem permissão para decidir esta solicitação")), true;
      const r = state.requests.find((x) => x.id === body.p_request_id);
      const approver = r && myApprovers().find((a) => a.id === r.approver_id);
      if (!approver) return send(res, 400, h.raise("sem permissão para decidir esta solicitação")), true;
      const problem = applyDecision(r, approver.id, body.p_decision, body.p_note, "portal", null);
      return problem ? (send(res, 400, problem), true) : (send(res, 200, randomUUID()), true);
    }

    if (!isStaff) return denied();

    if (fn === "submit_for_approval") {
      const version = state.versions.find((v) => v.id === body.p_version_id);
      const material = version && state.materials.find((m) => m.id === version.material_id);
      if (!material) return send(res, 400, h.raise("sem permissão", "42501")), true;
      if (material.status !== "rascunho") return send(res, 400, h.raise("só material em rascunho pode ser enviado para aprovação", "23514")), true;
      const ids = body.p_approver_ids ?? [];
      if (ids.length < 1 || ids.length > 20 || new Set(ids).size !== ids.length) return send(res, 400, h.raise("escolha de 1 a 20 aprovadores, sem repetir", "22023")), true;
      if (body.p_due_at && Date.parse(body.p_due_at) <= Date.now()) return send(res, 400, h.raise("o prazo precisa estar no futuro", "22023")), true;
      if (version.number !== latestNumber(material.id)) return send(res, 400, h.raise("somente a versão mais recente pode ser enviada para aprovação")), true;
      if (!state.files.some((f) => f.version_id === version.id)) return send(res, 400, h.raise("a versão não possui arquivos")), true;
      const frozen = state.contents.find((x) => x.version_id === version.id);
      if (frozen && JSON.stringify(frozen.content) !== JSON.stringify(h.contentOf(version))) {
        return send(res, 400, h.raise("o conteúdo mudou desde o último envio desta versão; crie uma nova versão", "23514")), true;
      }
      for (const id of ids) {
        const a = state.approvers.find((x) => x.id === id);
        if (!a || a.client_id !== material.client_id || !a.active || !h.clientOf(a.client_id)?.active) {
          return send(res, 400, h.raise("aprovador inválido, inativo ou de cliente arquivado", "23514")), true;
        }
      }
      const submission = randomUUID();
      h.freezeVersion(version);
      for (const id of ids) {
        state.requests.push({
          id: randomUUID(), material_id: material.id, version_id: version.id, client_id: material.client_id, requested_by: who.id,
          due_at: body.p_due_at ?? null, message: body.p_message ?? "", approver_id: id, submission_id: submission, status: "aberta", created_at: h.stamp(),
        });
      }
      material.status = "aguardando";
      return send(res, 200, submission), true;
    }

    if (fn === "cancel_approval_request") {
      const r = state.requests.find((x) => x.id === body.p_request_id);
      if (!r) return send(res, 400, h.raise("sem permissão")), true;
      if (r.status !== "aberta") return send(res, 400, h.raise("apenas solicitações abertas podem ser canceladas")), true;
      for (const x of state.requests.filter((y) => y.submission_id === r.submission_id && y.status === "aberta")) x.status = "cancelada";
      for (const l of state.links.filter((y) => state.requests.some((x) => x.id === y.request_id && x.submission_id === r.submission_id) && !y.revoked_at)) l.revoked_at = Date.now();
      const m = state.materials.find((x) => x.id === r.material_id);
      if (m?.status === "aguardando") m.status = "rascunho";
      return send(res, 200, null), true;
    }

    if (fn === "create_approval_link") {
      const r = state.requests.find((x) => x.id === body.p_request_id);
      if (!r) return send(res, 400, h.raise("sem permissão")), true;
      if (r.status !== "aberta") return send(res, 400, h.raise("a solicitação não está aberta")), true;
      if (r.approver_id !== body.p_approver_id) return send(res, 400, h.raise("aprovador inválido para esta solicitação")), true;
      const expires = Date.parse(body.p_expires_at);
      if (!(expires > Date.now()) || expires > Date.now() + 30 * 86_400_000) return send(res, 400, h.raise("a validade do link deve estar entre agora e 30 dias")), true;
      if (!/^[0-9a-f]{64}$/.test(body.p_token_hash ?? "")) return send(res, 400, { code: "23514", message: "violates check constraint" }), true;
      if (state.links.some((l) => l.token_hash === body.p_token_hash)) return send(res, 409, { code: "23505", message: "duplicate key value violates unique constraint" }), true;
      for (const l of state.links.filter((x) => x.request_id === r.id && !x.revoked_at && !x.used_at)) l.revoked_at = Date.now();
      const link = { id: randomUUID(), request_id: r.id, client_id: r.client_id, approver_id: r.approver_id, token_hash: body.p_token_hash, expires_at: expires, revoked_at: null, used_at: null, created_at: Date.now() };
      state.links.push(link);
      return send(res, 200, link.id), true;
    }

    if (fn === "revoke_approval_link") {
      const l = state.links.find((x) => x.id === body.p_link_id);
      if (!l) return send(res, 400, h.raise("sem permissão")), true;
      if (!l.revoked_at) l.revoked_at = Date.now();
      return send(res, 200, null), true;
    }
    return false;
  }

  // ---------------------------------------------------------------- tabelas
  const rowsFor = (list) => list.filter((row) => h.matches(row, c.params));

  if (table === "approval_requests" && req.method === "GET") {
    let rows = rowsFor(state.requests);
    if (!isStaff) { const mine = new Set(myApprovers().map((a) => a.id)); rows = rows.filter((r) => mine.has(r.approver_id)); }
    const [col, dir] = (url.searchParams.get("order") ?? "created_at.asc").split(".");
    rows = rows.sort((a, b) => (dir === "desc" ? -1 : 1) * String(a[col]).localeCompare(String(b[col])));
    if (url.searchParams.get("limit")) rows = rows.slice(0, Number(url.searchParams.get("limit")));
    return send(res, 200, rows.map((r) => {
      const approver = state.approvers.find((a) => a.id === r.approver_id);
      const version = state.versions.find((v) => v.id === r.version_id);
      return {
        ...r,
        approvers: approver ? { name: approver.name, email: approver.email } : null,
        material_versions: version ? { number: version.number } : null,
        decisions: state.decisions.filter((d) => d.request_id === r.id).map((d) => ({ decision: d.decision, note: d.note, via: d.via, created_at: d.created_at })),
        approval_links: state.links.filter((l) => l.request_id === r.id).map((l) => ({ id: l.id, expires_at: iso(l.expires_at), revoked_at: l.revoked_at ? iso(l.revoked_at) : null, used_at: l.used_at ? iso(l.used_at) : null, created_at: iso(l.created_at) })),
      };
    })), true;
  }

  if (table === "decisions" && req.method === "GET") {
    let rows = rowsFor(state.decisions).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (!isStaff) { const clients = myClientIds(); rows = rows.filter((d) => clients.has(d.client_id)); }
    if (url.searchParams.get("limit")) rows = rows.slice(0, Number(url.searchParams.get("limit")));
    return send(res, 200, rows.map((d) => {
      const version = state.versions.find((v) => v.id === d.version_id);
      const material = state.materials.find((m) => m.id === d.material_id);
      return {
        ...d,
        approvers: { name: d.approver_name },
        approval_requests: d.requested_at ? { created_at: d.requested_at } : null,
        material_versions: version ? { number: version.number, materials: material ? { title: material.title } : null } : null,
      };
    })), true;
  }

  if (table === "material_version_contents" && req.method === "GET") {
    let rows = rowsFor(state.contents);
    if (!isStaff) { const clients = myClientIds(); rows = rows.filter((x) => clients.has(x.client_id)); }
    return send(res, 200, rows), true;
  }

  if (table === "comments") {
    if (req.method === "GET") {
      let rows = rowsFor(state.comments).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      if (!isStaff) { const clients = myClientIds(); rows = rows.filter((x) => clients.has(x.client_id)); }
      return send(res, 200, rows), true;
    }
    if (req.method === "POST") {
      if (isStaff) return send(res, 403, h.rlsError("comments")), true;
      const body = await readBody(req);
      const approver = myApprovers().find((a) => a.id === body.author_approver_id && a.client_id === body.client_id);
      const version = state.versions.find((v) => v.id === body.version_id && v.material_id === body.material_id);
      if (body.author_role !== "cliente" || !approver || !version || !state.requests.some((r) => r.version_id === version.id)) return send(res, 403, h.rlsError("comments")), true;
      if (!String(body.body ?? "").trim()) return send(res, 400, { code: "23514", message: "violates check constraint" }), true;
      state.comments.push({ id: randomUUID(), material_id: body.material_id, version_id: body.version_id, client_id: body.client_id, slide: body.slide ?? null, author_role: "cliente", author_name: approver.name, body: String(body.body).trim(), created_at: h.stamp() });
      return send(res, 201), true;
    }
  }

  // leituras do portal (cliente): só o que foi enviado e é da empresa dele
  if (!isStaff && req.method === "GET") {
    const clients = myClientIds();
    if (table === "materials") {
      const mine = new Set(myApprovers().map((a) => a.id));
      const rows = rowsFor(state.materials).filter((m) => clients.has(m.client_id) && sentMaterial(m));
      return send(res, 200, rows.map((m) => ({
        ...m,
        projects: { name: state.projects.find((p) => p.id === m.project_id)?.name ?? "—" },
        material_versions: state.versions.filter((v) => v.material_id === m.id).map((v) => ({ id: v.id, number: v.number })),
        approval_requests: state.requests.filter((r) => r.material_id === m.id && mine.has(r.approver_id)).map((r) => ({ id: r.id, status: r.status, version_id: r.version_id, due_at: r.due_at ?? null })),
      }))), true;
    }
    if (table === "material_versions" || table === "material_files") {
      const list = table === "material_versions" ? state.versions : state.files;
      let rows = rowsFor(list).filter((x) => clients.has(x.client_id) && state.requests.some((r) => r.version_id === (table === "material_versions" ? x.id : x.version_id)));
      const [col, dir] = (url.searchParams.get("order") ?? "").split(".");
      if (col) rows = rows.sort((a, b) => (dir === "desc" ? -1 : 1) * (typeof a[col] === "number" ? a[col] - b[col] : String(a[col]).localeCompare(String(b[col]))));
      return send(res, 200, rows), true;
    }
  }
  return false;
}
