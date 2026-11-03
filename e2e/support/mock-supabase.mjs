#!/usr/bin/env node
/**
 * Servidor FALSO de Auth + PostgREST, só para o E2E das telas reais de clientes e projetos.
 * Roda em memória na porta 59998, sem rede externa e sem credenciais.
 *
 * O que ele prova: renderização das telas com sessão, formulários, Server Actions, cookies,
 * revalidação e comportamento por papel NA INTERFACE.
 * O que ele NÃO prova: a RLS e as constraints do Postgres. Isso é do teste de banco
 * (src/test/db/clients-projects.test.ts, Postgres em memória com as migrations reais) e da
 * validação das consultas contra o projeto real.
 *
 * Usuários de teste (qualquer senha): admin@luvi.test, atendimento@luvi.test, designer@luvi.test.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = 59998;
const ORG = "0b8f2a6e-5d8c-4a3e-9f57-2f1a3c4d5e6f";
const USERS = {
  "admin@luvi.test": { id: "11111111-1111-4111-8111-111111111111", role: "admin", name: "Admin Teste" },
  "atendimento@luvi.test": { id: "33333333-3333-4333-8333-333333333333", role: "atendimento", name: "Atendimento Teste" },
  "designer@luvi.test": { id: "22222222-2222-4222-8222-222222222222", role: "designer", name: "Designer Teste" },
};
const byId = (id) => Object.entries(USERS).find(([, u]) => u.id === id);

const fresh = () => ({ clients: [], projects: [] });
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
    if (op === "ilike" && !likeToRegExp(value).test(String(cell))) return false;
  }
  return true;
}

const rlsError = (table) => ({ code: "42501", message: `new row violates row-level security policy for table "${table}"` });

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

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const params = [...url.searchParams.entries()];

  if (path === "/__health") return send(res, 200, { ok: true });
  if (path === "/__reset") {
    state = fresh();
    return send(res, 200, { ok: true });
  }

  // ---- Auth
  if (path === "/auth/v1/token" && req.method === "POST") {
    const { email } = await readBody(req);
    if (!USERS[email]) return send(res, 400, { error_code: "invalid_credentials", code: 400, msg: "Invalid login credentials" });
    const access = tokenFor(email);
    return send(res, 200, {
      access_token: access,
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
  const table = path.replace("/rest/v1/", "");
  const canManage = who.role === "admin" || who.role === "atendimento";

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
          approvers: [],
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
          const client = state.clients.find((c) => c.id === p.client_id);
          return { ...p, clients: client ? { name: client.name, active: client.active } : null, materials: [{ count: 0 }], approved: [{ count: 0 }] };
        }),
      );
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      if (body.created_by !== who.id) return send(res, 403, rlsError("projects"));
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

  return send(res, 404, { code: "PGRST205", message: `tabela ${table} não existe no mock` });
}

createServer((req, res) => {
  handle(req, res).catch((error) => send(res, 500, { message: String(error) }));
}).listen(PORT, "127.0.0.1", () => console.log(`mock-supabase em http://127.0.0.1:${PORT}`));
