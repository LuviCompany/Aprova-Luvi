#!/usr/bin/env node
/**
 * Servidor FALSO de Auth + PostgREST, só para o E2E das telas reais (clientes, projetos, aprovadores
 * e escolha de empresa no portal). Roda em memória na porta 59998, sem rede externa e sem credenciais.
 *
 * O que ele prova: renderização das telas com sessão, formulários, Server Actions, cookies,
 * revalidação e comportamento por papel NA INTERFACE.
 * O que ele NÃO prova: a RLS, as constraints e as funções do Postgres. Isso é do teste de banco
 * (src/test/db, Postgres em memória com as migrations reais) e da validação das consultas contra o
 * projeto real. As regras de banco imitadas aqui (convite, vínculo, cliente arquivado) existem só
 * para a interface ter o que reagir.
 *
 * Usuários de teste (qualquer senha): admin@luvi.test, atendimento@luvi.test, designer@luvi.test,
 * cliente@luvi.test (aprova para 2 empresas) e cliente1@luvi.test (aprova para 1).
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = 59998;
const ORG = "0b8f2a6e-5d8c-4a3e-9f57-2f1a3c4d5e6f";
const USERS = {
  "admin@luvi.test": { id: "11111111-1111-4111-8111-111111111111", role: "admin", name: "Admin Teste" },
  "atendimento@luvi.test": { id: "33333333-3333-4333-8333-333333333333", role: "atendimento", name: "Atendimento Teste" },
  "designer@luvi.test": { id: "22222222-2222-4222-8222-222222222222", role: "designer", name: "Designer Teste" },
  "cliente@luvi.test": { id: "44444444-4444-4444-8444-444444444444", role: "cliente", name: "Marina Prado" },
  "cliente1@luvi.test": { id: "55555555-5555-4555-8555-555555555555", role: "cliente", name: "Paulo Aurora" },
};
const byId = (id) => Object.entries(USERS).find(([, u]) => u.id === id);

const fresh = () => ({ clients: [], projects: [], approvers: [], invites: [] });
let state = fresh();

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const tokenFor = (email) => {
  const user = USERS[email];
  const now = Math.floor(Date.now() / 1000);
  // HS256 e assinatura arbitrária: o supabase-js valida chamando /auth/v1/user.
  return [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub: user.id, email, role: "authenticated", aud: "authenticated", exp: now + 3600, iat: now, session_id: randomUUID(), aal: "aal1" }),
    "assinatura-de-teste",
  ].join(".");
};
const authUser = (email) => ({
  id: USERS[email].id,
  aud: "authenticated",
  role: "authenticated",
  email,
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
});

function actor(req) {
  const header = req.headers.authorization ?? "";
  const token = header.replace(/^Bearer /, "");
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const { sub } = JSON.parse(Buffer.from(payload, "base64url").toString());
    const found = byId(sub);
    return found ? { email: found[0], ...found[1] } : null;
  } catch {
    return null;
  }
}

/** ILIKE do PostgREST: `%`/`*` são curingas e `\` escapa. */
function likeToRegExp(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%" || c === "*") out += ".*";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

function matches(row, params) {
  for (const [key, raw] of params) {
    if (["select", "order", "limit"].includes(key) || key.includes(".")) continue;
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    const cell = row[key];
    if (op === "eq" && String(cell) !== value) return false;
    if (op === "neq" && String(cell) === value) return false;
    if (op === "ilike" && !likeToRegExp(value).test(String(cell))) return false;
    if (op === "in") {
      const list = value.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
      if (!list.includes(String(cell))) return false;
    }
  }
  return true;
}

const rlsError = (table) => ({ code: "42501", message: `new row violates row-level security policy for table "${table}"` });
const raise = (message, code = "P0001") => ({ code, message });

function send(res, status, body, headers = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  return text ? JSON.parse(text) : {};
}

const wantsRows = (req) => /return=representation/.test(req.headers.prefer ?? "");
const clientOf = (id) => state.clients.find((c) => c.id === id);
const norm = (s) => String(s).trim().toLowerCase();

/** Imita a função do banco: revoga convite aberto quando o aprovador é desativado. */
function deactivateSideEffects(approver) {
  for (const invite of state.invites) {
    if (invite.approver_id === approver.id && ["preparado", "enviado"].includes(invite.status)) invite.status = "revogado";
  }
}

function approverRow(a) {
  const client = clientOf(a.client_id);
  return { ...a, clients: client ? { name: client.name } : null, client: client ? { name: client.name } : null };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const params = [...url.searchParams.entries()];

  if (path === "/__health") return send(res, 200, { ok: true });
  if (path === "/__reset") {
    state = fresh();
    return send(res, 200, { ok: true });
  }
  if (path === "/__seed") {
    const body = await readBody(req);
    for (const c of body.clients ?? []) state.clients.push({ segment: "", initials: "XX", active: true, organization_id: ORG, ...c });
    for (const a of body.approvers ?? []) state.approvers.push({ job_title: "", active: true, profile_id: null, ...a });
    return send(res, 200, { ok: true });
  }

  // ---- Auth
  if (path === "/auth/v1/token" && req.method === "POST") {
    const { email } = await readBody(req);
    if (!USERS[email]) return send(res, 400, { error_code: "invalid_credentials", code: 400, msg: "Invalid login credentials" });
    return send(res, 200, {
      access_token: tokenFor(email),
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "refresh-de-teste",
      user: authUser(email),
    });
  }
  if (path === "/auth/v1/user" && req.method === "GET") {
    const who = actor(req);
    return who ? send(res, 200, authUser(who.email)) : send(res, 401, { code: 401, msg: "invalid JWT" });
  }
  if (path === "/auth/v1/logout") return send(res, 204);
  if (path.startsWith("/auth/v1/")) return send(res, 404, { msg: "não implementado no mock" });

  // ---- PostgREST
  const who = actor(req);
  if (!who) return send(res, 401, { code: "PGRST301", message: "JWT inválido" });
  const canManage = who.role === "admin" || who.role === "atendimento";
  const isStaff = who.role !== "cliente";

  // RPCs (funções do banco imitadas)
  if (path.startsWith("/rest/v1/rpc/") && req.method === "POST") {
    const fn = path.replace("/rest/v1/rpc/", "");
    const body = await readBody(req);

    if (fn === "link_approver_to_client") {
      const source = state.approvers.find((a) => a.id === body.p_source_approver_id);
      const dest = clientOf(body.p_client_id);
      if (!canManage || !dest || !source || !clientOf(source.client_id)) return send(res, 400, raise("sem permissão"));
      if (!source.active) return send(res, 400, raise("aprovador de origem inativo"));
      if (source.client_id === dest.id) return send(res, 400, raise("a origem e o destino são o mesmo cliente"));
      if (!dest.active) return send(res, 400, raise("cliente arquivado: reative o cliente antes de cadastrar em approvers", "23514"));
      if (state.approvers.some((a) => a.client_id === dest.id && a.email === source.email)) {
        return send(res, 409, { code: "23505", message: "duplicate key value violates unique constraint" });
      }
      const row = { id: randomUUID(), client_id: dest.id, profile_id: source.profile_id, name: source.name, email: source.email, job_title: source.job_title, active: true };
      state.approvers.push(row);
      return send(res, 200, row.id);
    }
    if (fn === "prepare_approver_invite") {
      const a = state.approvers.find((x) => x.id === body.p_approver_id);
      if (!canManage || !a) return send(res, 400, raise("sem permissão"));
      if (!a.active) return send(res, 400, raise("aprovador inativo"));
      if (a.profile_id) return send(res, 400, raise("o aprovador já tem acesso ao portal"));
      if (!clientOf(a.client_id)?.active) return send(res, 400, raise("cliente arquivado: reative o cliente antes de preparar convites"));
      if (state.invites.some((i) => i.approver_id === a.id && ["preparado", "enviado"].includes(i.status))) {
        return send(res, 409, { code: "23505", message: "duplicate key value violates unique constraint" });
      }
      const invite = { id: randomUUID(), approver_id: a.id, client_id: a.client_id, status: "preparado" };
      state.invites.push(invite);
      return send(res, 200, invite.id);
    }
    if (fn === "revoke_approver_invite") {
      const invite = state.invites.find((i) => i.id === body.p_invite_id);
      if (!canManage || !invite) return send(res, 400, raise("sem permissão"));
      if (!["preparado", "enviado"].includes(invite.status)) return send(res, 400, raise("o convite não está em aberto"));
      invite.status = "revogado";
      return send(res, 200, null);
    }
    return send(res, 404, { code: "PGRST202", message: `função ${fn} não existe no mock` });
  }

  const table = path.replace("/rest/v1/", "");

  if (table === "profiles" && req.method === "GET") {
    const row = { id: who.id, full_name: who.name, email: who.email, role: who.role, organization_id: ORG, active: true };
    return send(res, 200, matches(row, params) ? [row] : []);
  }

  if (table === "clients") {
    if (req.method === "GET") {
      const rows = state.clients.filter((c) => matches(c, params)).sort((a, b) => a.name.localeCompare(b.name));
      return send(
        res,
        200,
        rows.map((c) => ({
          ...c,
          projects: [{ count: state.projects.filter((p) => p.client_id === c.id).length }],
          pending: [{ count: 0 }],
          approvers: state.approvers.filter((a) => a.client_id === c.id).map((a) => ({ id: a.id, name: a.name, email: a.email, job_title: a.job_title, active: a.active })),
        })),
      );
    }
    if (req.method === "POST") {
      if (!canManage) return send(res, 403, rlsError("clients"));
      const body = await readBody(req);
      if (state.clients.some((c) => c.name === body.name)) {
        return send(res, 409, { code: "23505", message: 'duplicate key value violates unique constraint "clients_organization_id_name_key"' });
      }
      const row = { id: randomUUID(), segment: "", active: true, ...body };
      state.clients.push(row);
      return wantsRows(req) ? send(res, 201, [row]) : send(res, 201);
    }
    if (req.method === "PATCH") {
      if (!canManage) return send(res, 200, []); // a RLS filtra a linha: nenhuma linha afetada
      const body = await readBody(req);
      const rows = state.clients.filter((c) => matches(c, params));
      for (const row of rows) Object.assign(row, body);
      return wantsRows(req) ? send(res, 200, rows.map((r) => ({ id: r.id }))) : send(res, 204);
    }
  }

  if (table === "projects") {
    if (req.method === "GET") {
      const rows = state.projects.filter((p) => matches(p, params)).sort((a, b) => a.name.localeCompare(b.name));
      return send(
        res,
        200,
        rows.map((p) => {
          const client = clientOf(p.client_id);
          return { ...p, clients: client ? { name: client.name, active: client.active } : null, materials: [{ count: 0 }], approved: [{ count: 0 }] };
        }),
      );
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      if (body.created_by !== who.id) return send(res, 403, rlsError("projects"));
      if (!clientOf(body.client_id)?.active) return send(res, 400, raise("cliente arquivado: reative o cliente antes de cadastrar em projects", "23514"));
      const row = { id: randomUUID(), description: "", due_date: null, status: "ativo", ...body };
      state.projects.push(row);
      return wantsRows(req) ? send(res, 201, [row]) : send(res, 201);
    }
    if (req.method === "PATCH") {
      const body = await readBody(req);
      const rows = state.projects.filter((p) => matches(p, params));
      for (const row of rows) Object.assign(row, body);
      return wantsRows(req) ? send(res, 200, rows.map((r) => ({ id: r.id }))) : send(res, 204);
    }
  }

  if (table === "approvers") {
    if (req.method === "GET") {
      let rows = state.approvers.filter((a) => matches(a, params));
      if (!isStaff) {
        // RLS do portal: só os próprios vínculos, ativos, de clientes ativos
        rows = rows.filter((a) => a.profile_id === who.id && a.active && clientOf(a.client_id)?.active);
      }
      return send(res, 200, rows.sort((a, b) => a.name.localeCompare(b.name)).map(approverRow));
    }
    if (req.method === "POST") {
      if (!canManage) return send(res, 403, rlsError("approvers"));
      const body = await readBody(req);
      if ("profile_id" in body) return send(res, 403, { code: "42501", message: "permission denied for table approvers" });
      if (!clientOf(body.client_id)?.active) return send(res, 400, raise("cliente arquivado: reative o cliente antes de cadastrar em approvers", "23514"));
      if (state.approvers.some((a) => a.client_id === body.client_id && norm(a.email) === norm(body.email))) {
        return send(res, 409, { code: "23505", message: 'duplicate key value violates unique constraint "approvers_client_id_email_key"' });
      }
      const row = { id: randomUUID(), profile_id: null, job_title: "", active: true, ...body };
      state.approvers.push(row);
      return wantsRows(req) ? send(res, 201, [row]) : send(res, 201);
    }
    if (req.method === "PATCH") {
      if (!canManage) return send(res, 200, []);
      const body = await readBody(req);
      if ("email" in body || "profile_id" in body) return send(res, 403, { code: "42501", message: "permission denied for table approvers" });
      const rows = state.approvers.filter((a) => matches(a, params));
      for (const row of rows) {
        const wasActive = row.active;
        Object.assign(row, body);
        if (wasActive && row.active === false) deactivateSideEffects(row);
      }
      return wantsRows(req) ? send(res, 200, rows.map((r) => ({ id: r.id }))) : send(res, 204);
    }
  }

  if (table === "approver_invites" && req.method === "GET") {
    if (!isStaff) return send(res, 200, []);
    return send(res, 200, state.invites.filter((i) => matches(i, params)));
  }

  return send(res, 404, { code: "PGRST205", message: `tabela ${table} não existe no mock` });
}

createServer((req, res) => {
  handle(req, res).catch((error) => send(res, 500, { message: String(error) }));
}).listen(PORT, "127.0.0.1", () => console.log(`mock-supabase em http://127.0.0.1:${PORT}`));
