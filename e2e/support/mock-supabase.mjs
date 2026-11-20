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
 * Materiais (etapa B): imita o PostgREST de `materials` (lista com contagem e página, cadastro, edição, exclusão) e as
 * travas do banco que a interface precisa ver (conteúdo travado fora de rascunho, cliente arquivado, FK de versões).
 *
 * Versões, arquivos e storage (etapas C e D): imita versões (número automático, congelamento da anterior), arquivos com
 * as regras do banco (tipo x material, posição, versão enviada), a ordenação, a revisão e o storage privado (URL assinada de
 * envio e de leitura, upload multipart, intervalo de bytes, CORS), para o upload real do navegador.
 *
 * Usuários de teste (qualquer senha): admin@luvi.test, atendimento@luvi.test, designer@luvi.test,
 * cliente@luvi.test (aprova para 2 empresas) e cliente1@luvi.test (aprova para 1).
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { handleApproval } from "./mock-approval.mjs";

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
const USER_CREATED = {
  "admin@luvi.test": "2026-02-10T12:00:00Z",
  "designer@luvi.test": "2026-03-05T12:00:00Z",
  "atendimento@luvi.test": "2026-04-20T12:00:00Z",
  "cliente@luvi.test": "2026-05-01T12:00:00Z",
  "cliente1@luvi.test": "2026-05-02T12:00:00Z",
};

const fresh = () => ({ clients: [], projects: [], approvers: [], invites: [], materials: [], versions: [], files: [], contents: [], requests: [], decisions: [], links: [], verifications: [], sessions: [], comments: [], objects: {}, tokens: {} });
let tick = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 3, 12, 0, tick++)).toISOString();
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
    if (["select", "order", "limit", "offset"].includes(key) || key.includes(".")) continue;
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


const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "*",
};
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "application/pdf"];

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Extrai o arquivo (parte de nome vazio) de um corpo multipart, como o cliente oficial do Supabase envia. */
function parseMultipartFile(buffer, contentType) {
  const boundary = /boundary=(.+)$/.exec(contentType ?? "")?.[1];
  if (!boundary) return null;
  const delimiter = Buffer.from("--" + boundary);
  let start = buffer.indexOf(delimiter);
  while (start !== -1) {
    const headerEnd = buffer.indexOf("\r\n\r\n", start);
    if (headerEnd === -1) return null;
    const head = buffer.slice(start + delimiter.length, headerEnd).toString();
    const next = buffer.indexOf(delimiter, headerEnd);
    if (/name=""/.test(head) && next !== -1) {
      return { bytes: buffer.slice(headerEnd + 4, next - 2), mime: /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() ?? "application/octet-stream" };
    }
    start = next;
  }
  return null;
}

function handleStorage(req, res, url, path) {
  const respond = (status, body, headers = {}) => {
    const text = body === undefined ? "" : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { ...CORS, "content-type": typeof body === "object" && !Buffer.isBuffer(body) ? "application/json" : (headers["content-type"] ?? "application/octet-stream"), ...headers });
    res.end(text);
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  const rest = path.replace("/storage/v1/", "");
  const m = /^object\/(upload\/sign|sign)\/materials\/(.+)$/.exec(rest);
  const secret = /^Bearer sb_secret_/.test(req.headers.authorization ?? "");
  const staff = (() => {
    if (secret) return { role: "service" };
    const w = actor(req);
    if (w && w.role !== "cliente") return w;
    // aprovador do portal: lê arquivo de empresa em que tem vínculo ativo e que já foi enviado
    if (w && rest.startsWith("object/sign/materials/")) {
      const objectPath = decodeURIComponent(rest.slice("object/sign/materials/".length));
      const file = state.files.find((f) => f.storage_path === objectPath);
      const linked = file && state.approvers.some((a) => a.profile_id === w.id && a.active && a.client_id === file.client_id);
      if (linked && state.requests.some((r) => r.version_id === file.version_id)) return w;
    }
    return null;
  })();

  return (async () => {
    if (m && m[1] === "upload/sign" && req.method === "POST") {
      if (!staff) return respond(403, { error: "Unauthorized", message: "new row violates row-level security policy" });
      const objectPath = decodeURIComponent(m[2]);
      const token = randomUUID();
      state.tokens[token] = { path: objectPath, kind: "upload" };
      return respond(200, { url: `/object/upload/sign/materials/${m[2]}?token=${token}` });
    }
    if (m && m[1] === "upload/sign" && req.method === "PUT") {
      const token = url.searchParams.get("token");
      const grant = state.tokens[token ?? ""];
      const objectPath = decodeURIComponent(m[2]);
      if (!grant || grant.kind !== "upload" || grant.path !== objectPath) return respond(403, { error: "invalid token" });
      const raw = await readRaw(req);
      const file = parseMultipartFile(raw, req.headers["content-type"]);
      if (!file) return respond(400, { error: "corpo inválido" });
      if (!ALLOWED_MIME.includes(file.mime)) return respond(415, { error: "mime type not supported" });
      if (file.bytes.length > 52428800) return respond(413, { error: "The object exceeded the maximum allowed size" });
      if (state.objects[objectPath]) return respond(409, { error: "The resource already exists" });
      delete state.tokens[token];
      state.objects[objectPath] = { bytes: file.bytes, mime: file.mime };
      return respond(200, { Key: `materials/${objectPath}` });
    }
    if (m && m[1] === "sign" && req.method === "POST") {
      if (!staff) return respond(403, { error: "Unauthorized" });
      const objectPath = decodeURIComponent(m[2]);
      if (!state.objects[objectPath]) return respond(400, { error: "Object not found", message: "Object not found" });
      // RLS do storage: só arquivos de clientes que a equipe enxerga
      if (!clientOf(objectPath.split("/")[0])) return respond(400, { error: "Object not found", message: "Object not found" });
      const token = randomUUID();
      state.tokens[token] = { path: objectPath, kind: "read" };
      return respond(200, { signedURL: `/object/sign/materials/${m[2]}?token=${token}` });
    }
    if (m && m[1] === "sign" && req.method === "GET") {
      const token = url.searchParams.get("token");
      const grant = state.tokens[token ?? ""];
      const objectPath = decodeURIComponent(m[2]);
      const object = state.objects[objectPath];
      if (!grant || grant.kind !== "read" || grant.path !== objectPath || !object) return respond(400, { error: "invalid token" });
      const range = /^bytes=(\d+)-(\d+)?$/.exec(req.headers.range ?? "");
      if (range) {
        const from = Number(range[1]);
        const to = Math.min(range[2] ? Number(range[2]) : object.bytes.length - 1, object.bytes.length - 1);
        return respond(206, object.bytes.slice(from, to + 1), { "content-type": object.mime, "content-range": `bytes ${from}-${to}/${object.bytes.length}`, "cache-control": "no-store" });
      }
      return respond(200, object.bytes, { "content-type": object.mime, "cache-control": "no-store" });
    }
    if (rest === "object/materials" && req.method === "DELETE") {
      if (!staff) return respond(403, { error: "Unauthorized" });
      const { prefixes = [] } = JSON.parse((await readRaw(req)).toString() || "{}");
      for (const p of prefixes) delete state.objects[p];
      return respond(200, prefixes.map((name) => ({ name })));
    }
    return respond(404, { error: "rota de storage não existe no mock" });
  })();
}


/** Congela o conteúdo apresentado de uma versão (cópia imutável), como a função do banco. */
function contentOf(version) {
  const m = state.materials.find((x) => x.id === version.material_id);
  return {
    title: m.title, description: m.description, caption: m.caption, type: m.type, aspect_ratio: m.aspect_ratio,
    channel: m.channel, publish_date: m.publish_date, due_date: m.due_date,
    files: state.files.filter((x) => x.version_id === version.id).sort((a, b) => a.slide_position - b.slide_position)
      .map((x) => ({ position: x.slide_position, kind: x.kind, mime_type: x.mime_type, original_name: x.original_name, size_bytes: x.size_bytes, checksum_sha256: x.checksum_sha256 })),
  };
}

function freezeVersion(version) {
  if (state.contents.some((c) => c.version_id === version.id)) return;
  state.contents.push({
    version_id: version.id,
    material_id: version.material_id,
    client_id: version.client_id,
    frozen_at: stamp(),
    content: contentOf(version),
  });
}

const helpers = () => ({ raise, rlsError, matches, stamp, freezeVersion, contentOf, clientOf });

/** Cria a próxima versão como o gatilho do banco (congela a anterior e devolve o material a rascunho). */
function createVersion(material, note, userId, viaRevision = false) {
  const own = state.versions.filter((v) => v.material_id === material.id);
  const previous = own.sort((a, b) => b.number - a.number)[0];
  if (previous) freezeVersion(previous);
  const version = { id: randomUUID(), material_id: material.id, client_id: material.client_id, number: (previous?.number ?? 0) + 1, note, created_at: stamp(), created_by: userId };
  state.versions.push(version);
  if (material.status !== "rascunho") { void viaRevision; material.status = "rascunho"; }
  return version;
}

const KIND_OF = { "image/jpeg": "imagem", "image/png": "imagem", "image/webp": "imagem", "video/mp4": "video", "video/quicktime": "video", "application/pdf": "pdf" };
function fileRuleError(material, version, row) {
  const latest = Math.max(...state.versions.filter((v) => v.material_id === material.id).map((v) => v.number));
  if (material.status !== "rascunho") return raise("material fora de rascunho: inicie uma revisão para trocar os arquivos", "23514");
  if (version.number !== latest) return raise("só a versão mais recente aceita arquivos", "23514");
  if (!String(row.storage_path).startsWith(`${material.client_id}/${material.id}/`)) return raise("caminho do arquivo fora da pasta do material", "23514");
  const ok =
    (material.type === "imagem" && row.kind === "imagem" && row.slide_position === 1) ||
    (material.type === "video" && row.kind === "video" && row.slide_position === 1) ||
    (material.type === "pdf" && row.kind === "pdf" && row.slide_position === 1) ||
    (material.type === "carrossel" && ["imagem", "video"].includes(row.kind) && row.slide_position >= 1 && row.slide_position <= 10);
  return ok ? null : raise("arquivo incompatível com o tipo do material", "23514");
}

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const params = [...url.searchParams.entries()];

  if (path === "/__health") return send(res, 200, { ok: true });
  if (path.startsWith("/__approval/")) {
    await handleApproval({ state, req, res, url, path, params, table: "", who: null, service: false, readBody, send, h: helpers() });
    return;
  }
  if (path === "/__reset") {
    state = fresh();
    return send(res, 200, { ok: true });
  }
  if (path === "/__objects") return send(res, 200, Object.keys(state.objects).sort());
  if (path === "/__seed") {
    const body = await readBody(req);
    for (const c of body.clients ?? []) state.clients.push({ segment: "", initials: "XX", active: true, organization_id: ORG, ...c });
    for (const a of body.approvers ?? []) state.approvers.push({ job_title: "", active: true, profile_id: null, ...a });
    for (const p of body.projects ?? []) state.projects.push({ description: "", due_date: null, status: "ativo", ...p });
    for (const m of body.materials ?? []) {
      state.materials.push({ status: "rascunho", description: "", caption: "", channel: "", aspect_ratio: null, publish_date: null, due_date: null, created_at: stamp(), updated_at: stamp(), ...m });
    }
    for (const v of body.versions ?? []) {
      const number = state.versions.filter((x) => x.material_id === v.material_id).length + 1;
      state.versions.push({ id: randomUUID(), number, note: "", created_at: stamp(), created_by: null, ...v });
    }
    for (const x of body.files ?? []) {
      state.files.push({ id: randomUUID(), checksum_sha256: null, original_name: "arquivo.jpg", size_bytes: 10, created_at: stamp(), ...x });
      if (x.storage_path) state.objects[x.storage_path] = { bytes: Buffer.from(x.bytes ?? "ffd8ffe0", "hex"), mime: x.mime_type ?? "image/jpeg" };
    }
    for (const c of body.contents ?? []) state.contents.push({ frozen_at: stamp(), ...c });
    for (const d of body.decisions ?? []) state.decisions.push({ id: randomUUID(), via: "portal", approver_name: "Aprovador Teste", requested_at: null, ...d });
    for (const r of body.requests ?? []) {
      const version = state.versions.find((v) => v.id === r.version_id);
      // padrões de uma solicitação já respondida: os testes antigos só informam a versão
      state.requests.push({ id: randomUUID(), status: "decidida", approver_id: "00000000-0000-4000-8000-0000000000aa", submission_id: randomUUID(), due_at: null, message: "", created_at: stamp(), material_id: version?.material_id, client_id: version?.client_id, ...r });
    }
    return send(res, 200, { ok: true });
  }

  // ---- Storage (URLs assinadas; o navegador envia e lê direto daqui, de outra origem: CORS)
  if (path.startsWith("/storage/v1/")) return handleStorage(req, res, url, path);

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
  // A chave secreta (service_role) é usada só pelo fluxo de aprovação por link, no servidor: lê tudo, como a RLS ignorada.
  const service = /^Bearer sb_secret_/.test(req.headers.authorization ?? "");
  const who = service ? { id: null, role: "admin", name: "service", email: "", service: true } : actor(req);
  if (!who) return send(res, 401, { code: "PGRST301", message: "JWT inválido" });
  const canManage = who.role === "admin" || who.role === "atendimento";
  const isStaff = who.role !== "cliente";

  const approvalCtx = { state, req, res, url, path, params, table: path.replace("/rest/v1/", ""), who, service, readBody, send, h: helpers() };
  if (path.startsWith("/rest/v1/rpc/") && req.method === "POST") {
    if (await handleApproval(approvalCtx)) return;
  }

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
    if (fn === "reorder_version_files") {
      const version = state.versions.find((v) => v.id === body.p_version_id);
      if (!version || !isStaff) return send(res, 400, raise("sem permissão", "42501"));
      if (state.requests.some((r) => r.version_id === version.id)) return send(res, 400, raise("versão já enviada para aprovação: a ordem não muda", "23514"));
      const latest = Math.max(...state.versions.filter((v) => v.material_id === version.material_id).map((v) => v.number));
      if (version.number !== latest) return send(res, 400, raise("só a versão mais recente pode ser reordenada", "23514"));
      const own = state.files.filter((x) => x.version_id === version.id);
      const order = body.p_order ?? [];
      if (order.length !== own.length || new Set(order).size !== own.length || order.some((id) => !own.some((x) => x.id === id))) {
        return send(res, 400, raise("a ordem precisa listar todos os arquivos da versão, sem repetir", "22023"));
      }
      order.forEach((id, i) => { own.find((x) => x.id === id).slide_position = i + 1; });
      return send(res, 200, null);
    }
    if (fn === "start_material_revision") {
      const material = state.materials.find((x) => x.id === body.p_material_id);
      if (!material || !isStaff) return send(res, 400, raise("sem permissão", "42501"));
      if (!["aprovado", "alteracao"].includes(material.status)) return send(res, 400, raise("só material aprovado ou com alteração pedida pode entrar em revisão", "23514"));
      const reason = String(body.p_reason ?? "").trim();
      if (reason.length < 10 || reason.length > 500) return send(res, 400, raise("informe o motivo da revisão (de 10 a 500 caracteres)", "22023"));
      const version = createVersion(material, reason, who.id, true);
      return send(res, 200, version.id);
    }
    return send(res, 404, { code: "PGRST202", message: `função ${fn} não existe no mock` });
  }

  const table = path.replace("/rest/v1/", "");
  if (await handleApproval({ ...approvalCtx, table })) return;

  if (table === "profiles" && req.method === "GET") {
    if (url.searchParams.has("id")) {
      const row = { id: who.id, full_name: who.name, email: who.email, role: who.role, organization_id: ORG, active: true };
      return send(res, 200, matches(row, params) ? [row] : []);
    }
    // listagem (tela Usuários): a RLS só mostra a organização à equipe; aprovador de cliente não lista ninguém
    if (!isStaff) return send(res, 200, []);
    const rows = Object.entries(USERS)
      .map(([email, u]) => ({ id: u.id, full_name: u.name, email, role: u.role, organization_id: ORG, active: true, created_at: USER_CREATED[email] }))
      .filter((row) => matches(row, params))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
    return send(res, 200, rows);
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
          return { ...p, clients: client ? { name: client.name, active: client.active } : null, materials: [{ count: state.materials.filter((m) => m.project_id === p.id).length }], approved: [{ count: state.materials.filter((m) => m.project_id === p.id && m.status === "aprovado").length }] };
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

  if (table === "materials") {
    const CONTENT = ["title", "description", "caption", "channel", "aspect_ratio"];
    const PROTECTED = ["id", "status", "client_id", "project_id", "type", "created_by", "created_at", "updated_at"];
    const embed = (m) => {
      const client = clientOf(m.client_id);
      const project = state.projects.find((p) => p.id === m.project_id);
      return {
        ...m,
        clients: client ? { name: client.name, active: client.active } : null,
        projects: project ? { name: project.name, status: project.status } : null,
        versions: [{ count: state.versions.filter((v) => v.material_id === m.id).length }],
      };
    };
    if (req.method === "GET") {
      if (!isStaff) return send(res, 200, []); // a RLS do portal só mostra material enviado (nenhum, no mock)
      const rows = state.materials
        .filter((m) => matches(m, params))
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : rows.length;
      const page = rows.slice(offset, offset + limit);
      const range = page.length ? `${offset}-${offset + page.length - 1}` : "*";
      const headers = /count=exact/.test(req.headers.prefer ?? "") ? { "content-range": `${range}/${rows.length}` } : {};
      return send(res, 200, page.map(embed), headers);
    }
    if (req.method === "POST") {
      if (!isStaff) return send(res, 403, rlsError("materials"));
      const body = await readBody(req);
      if (body.created_by !== who.id) return send(res, 403, rlsError("materials"));
      if ("status" in body || "id" in body) return send(res, 403, { code: "42501", message: "permission denied for table materials" });
      if (!clientOf(body.client_id)?.active) return send(res, 400, raise("cliente arquivado: reative o cliente antes de cadastrar em materials", "23514"));
      if (!state.projects.some((p) => p.id === body.project_id && p.client_id === body.client_id)) {
        return send(res, 409, { code: "23503", message: "violates foreign key constraint" });
      }
      if (String(body.caption ?? "").length > 2200) return send(res, 400, { code: "23514", message: "violates check constraint" });
      const row = { id: randomUUID(), status: "rascunho", description: "", caption: "", channel: "", aspect_ratio: null, publish_date: null, due_date: null, created_at: stamp(), updated_at: stamp(), ...body };
      state.materials.push(row);
      return wantsRows(req) ? send(res, 201, [row]) : send(res, 201);
    }
    if (req.method === "PATCH") {
      if (!isStaff) return send(res, 200, []);
      const body = await readBody(req);
      if (PROTECTED.some((k) => k in body)) return send(res, 403, { code: "42501", message: "permission denied for table materials" });
      const rows = state.materials.filter((m) => matches(m, params));
      for (const row of rows) {
        if (row.status !== "rascunho" && CONTENT.some((k) => k in body && body[k] !== row[k])) {
          return send(res, 400, raise("material já enviado para aprovação: o conteúdo só muda numa nova revisão", "23514"));
        }
      }
      for (const row of rows) {
        Object.assign(row, body);
        row.updated_at = stamp();
      }
      return wantsRows(req) ? send(res, 200, rows.map((r) => ({ id: r.id }))) : send(res, 204);
    }
    if (req.method === "DELETE") {
      if (!isStaff) return send(res, 403, { code: "42501", message: "permission denied for table materials" });
      // RLS: só rascunho; FK: nada com versão.
      const rows = state.materials.filter((m) => matches(m, params) && m.status === "rascunho");
      if (rows.some((r) => state.versions.some((v) => v.material_id === r.id))) {
        return send(res, 409, { code: "23503", message: "violates foreign key constraint" });
      }
      state.materials = state.materials.filter((m) => !rows.includes(m));
      return wantsRows(req) ? send(res, 200, rows.map((r) => ({ id: r.id }))) : send(res, 204);
    }
  }

  if (table === "decisions" && req.method === "GET") {
    if (!isStaff) return send(res, 200, []);
    const rows = state.decisions.filter((d) => matches(d, params)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return send(res, 200, rows.map((d) => ({ id: d.id, material_id: d.material_id, decision: d.decision, via: d.via, created_at: d.created_at, approvers: { name: d.approver_name }, approval_requests: d.requested_at ? { created_at: d.requested_at } : null })));
  }

  if (table === "material_versions") {
    const select = url.searchParams.get("select") ?? "";
    if (req.method === "GET") {
      if (!isStaff) return send(res, 200, []);
      let rows = state.versions.filter((v) => matches(v, params));
      const [col, dir] = (url.searchParams.get("order") ?? "number.asc").split(".");
      rows = rows.sort((a, b) => (dir === "desc" ? b[col] - a[col] : a[col] - b[col]));
      if (url.searchParams.get("limit")) rows = rows.slice(0, Number(url.searchParams.get("limit")));
      const counts = /material_files\(count\)/.test(select);
      return send(
        res,
        200,
        rows.map((v) => {
          const files = state.files.filter((x) => x.version_id === v.id).sort((a, b) => a.slide_position - b.slide_position);
          const content = state.contents.find((c) => c.version_id === v.id);
          const requests = state.requests.filter((r) => r.version_id === v.id).length;
          return {
            ...v,
            profiles: byId(v.created_by) ? { full_name: byId(v.created_by)[1].name } : null,
            material_files: counts ? [{ count: files.length }] : files,
            material_version_contents: content ? { content: content.content, frozen_at: content.frozen_at } : null,
            approval_requests: [{ count: requests }],
          };
        }),
      );
    }
    if (req.method === "POST") {
      if (!isStaff) return send(res, 403, rlsError("material_versions"));
      const body = await readBody(req);
      if (body.created_by !== who.id) return send(res, 403, rlsError("material_versions"));
      const material = state.materials.find((x) => x.id === body.material_id && x.client_id === body.client_id);
      if (!material) return send(res, 400, raise("material inválido para esta versão"));
      if (material.status === "aprovado") return send(res, 400, raise("material aprovado: use a operação de revisão para criar uma nova versão", "23514"));
      const version = createVersion(material, body.note ?? "", who.id);
      return wantsRows(req) ? send(res, 201, [{ id: version.id }]) : send(res, 201);
    }
  }

  if (table === "material_files") {
    if (req.method === "GET") {
      if (!isStaff) return send(res, 200, []);
      const rows = state.files.filter((x) => matches(x, params)).sort((a, b) => a.slide_position - b.slide_position);
      return send(res, 200, rows);
    }
    if (req.method === "POST") {
      if (!isStaff) return send(res, 403, rlsError("material_files"));
      const body = await readBody(req);
      const list = Array.isArray(body) ? body : [body];
      const created = [];
      for (const row of list) {
        if (row.created_by !== who.id) return send(res, 403, rlsError("material_files"));
        const version = state.versions.find((v) => v.id === row.version_id && v.material_id === row.material_id && v.client_id === row.client_id);
        const material = state.materials.find((x) => x.id === row.material_id);
        if (!version || !material) return send(res, 409, { code: "23503", message: "violates foreign key constraint" });
        if (state.requests.some((r) => r.version_id === version.id)) return send(res, 403, rlsError("material_files"));
        if (state.files.some((x) => x.version_id === version.id && x.slide_position === row.slide_position) || state.files.some((x) => x.storage_path === row.storage_path)) {
          return send(res, 409, { code: "23505", message: "duplicate key value violates unique constraint" });
        }
        if (!KIND_OF[row.mime_type] || KIND_OF[row.mime_type] !== row.kind) return send(res, 400, { code: "23514", message: "violates check constraint" });
        const problem = fileRuleError(material, version, row);
        if (problem) return send(res, 400, problem);
        created.push({ id: randomUUID(), created_at: stamp(), checksum_sha256: null, ...row });
      }
      state.files.push(...created);
      return wantsRows(req) ? send(res, 201, created) : send(res, 201);
    }
    if (req.method === "DELETE") {
      if (!isStaff) return send(res, 403, { code: "42501", message: "permission denied for table material_files" });
      const rows = state.files.filter((x) => matches(x, params) && !state.requests.some((r) => r.version_id === x.version_id));
      state.files = state.files.filter((x) => !rows.includes(x));
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
