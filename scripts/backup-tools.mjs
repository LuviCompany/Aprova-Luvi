#!/usr/bin/env node
/**
 * Ferramentas de backup do Aprova Luvi (sem dependências novas). Procedimento completo: docs/BACKUP.md.
 *
 *   storage-backup   --out PASTA                 copia o bucket privado `materials` (SOMENTE LEITURA no Supabase) e grava o manifesto SHA-256
 *   storage-verify   --dir PASTA [--manifest A]  confere o espelho contra o manifesto (offline, não precisa de chave)
 *   storage-restore  --dir PASTA                 simulação do envio dos arquivos para um projeto (padrão: não escreve nada)
 *                    --dir PASTA --execute --project-host HOST   envia só o que falta, NUNCA sobrescreve
 *   seal   --in ARQUIVO --out ARQUIVO.sealed     cifra (AES-256-GCM; senha em BACKUP_PASSPHRASE)
 *   unseal --in ARQUIVO.sealed [--out ARQUIVO | --check]   decifra, ou só confere a integridade sem gravar o conteúdo
 *
 * Segurança:
 *  - storage-backup só aceita o projeto de PRODUÇÃO e a chave SECRETA; só LÊ (lista, baixa, consulta material_files);
 *  - o espelho só cresce: nada local é apagado, mesmo que o objeto suma do Supabase (os arquivos são imutáveis no app);
 *  - recusa gravar dentro do repositório (nunca versionar) e em pasta sincronizada (OneDrive etc.) sem --allow-cloud-sync;
 *  - chaves e senha vêm só do ambiente do terminal e nunca são impressas nem gravadas.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PRODUCTION_SUPABASE_HOST, classifyKey } from "../src/lib/env.ts";
import { listAll } from "./cleanup-storage-orphans.mjs";

export const BUCKET = "materials";
const PAGE = 1000;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOLEAN_FLAGS = new Set(["execute", "check", "allow-cloud-sync"]);
const SHA256 = /^[0-9a-f]{64}$/;

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

/** Nome de objeto do Storage -> caminho relativo seguro no disco (sem "..", barras invertidas, caracteres proibidos no Windows). */
export function safeObjectPath(name) {
  if (typeof name !== "string" || !name || name.length > 400) throw new Error("Nome de objeto inválido.");
  const parts = name.split("/");
  for (const p of parts) {
    if (!p || p === "." || p === ".." || /[\\:*?"<>|\u0000-\u001f]/.test(p) || /[ .]$/.test(p)) {
      throw new Error(`Nome de objeto inseguro (ignorado): ${JSON.stringify(name)}`);
    }
  }
  return parts.join("/");
}

/** Pasta de destino: fora do repositório e (sem confirmação) fora de pastas sincronizadas na nuvem. */
export function assertSafeOutDir(out, { allowCloud = false, repoRoot = REPO_ROOT } = {}) {
  if (!out) throw new Error("Informe --out/--dir com a pasta do backup.");
  const abs = resolve(out);
  const rel = relative(repoRoot, abs);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error("A pasta do backup não pode ficar dentro do repositório (backup nunca é versionado).");
  }
  if (!allowCloud && /onedrive|dropbox|google ?drive|icloud/i.test(abs)) {
    throw new Error("A pasta está numa área sincronizada com a nuvem. Escolha uma pasta local cifrada ou use --allow-cloud-sync de forma consciente.");
  }
  return abs;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const statOrNull = (path) => stat(path).catch(() => null);

async function readDbFiles(admin) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("material_files")
      .select("storage_path,size_bytes,checksum_sha256,mime_type")
      .order("storage_path")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Falha ao ler material_files: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const stampOf = (now) => new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** Copia o bucket para `<outDir>/materials` e grava `manifest-<data>.json`. Só lê do Supabase. */
export async function runStorageBackup({ admin, outDir, now = Date.now(), projectHost = "", log = () => {} }) {
  const [objects, rows] = await Promise.all([listAll(admin.storage), readDbFiles(admin)]);
  const byPath = new Map(rows.map((r) => [r.storage_path, r]));
  const root = join(outDir, "materials");
  const files = [];
  const problems = [];
  let downloaded = 0;
  let reused = 0;

  if (objects.length === 0 && rows.length > 0) {
    problems.push("O storage está vazio, mas o banco tem registros de arquivos (projeto errado ou listagem falhou).");
  }

  for (const object of objects) {
    let rel;
    try {
      rel = safeObjectPath(object.name);
    } catch (error) {
      problems.push(error.message);
      continue;
    }
    const dest = join(root, ...rel.split("/"));
    const have = await statOrNull(dest);
    if (!have || (object.size != null && have.size !== Number(object.size))) {
      const { data, error } = await admin.storage.from(BUCKET).download(object.name);
      if (error || !data) {
        problems.push(`Falha ao baixar ${object.name}: ${error?.message ?? "sem conteúdo"}`);
        continue;
      }
      await mkdir(dirname(dest), { recursive: true });
      const tmp = `${dest}.part`;
      await writeFile(tmp, Buffer.from(await data.arrayBuffer()));
      await rename(tmp, dest);
      downloaded++;
    } else {
      reused++;
    }
    const size = (await stat(dest)).size;
    const sha256 = await sha256File(dest);
    const row = byPath.get(object.name);
    if (row?.checksum_sha256 && row.checksum_sha256 !== sha256) problems.push(`SHA-256 diferente do registrado no banco: ${object.name}`);
    if (row && Number(row.size_bytes) !== size) problems.push(`Tamanho diferente do registrado no banco: ${object.name}`);
    files.push({ path: rel, size, sha256, mime: row?.mime_type ?? null, inDb: Boolean(row) });
  }

  const stored = new Set(objects.map((o) => o.name));
  const dbRowsWithoutObject = rows.map((r) => r.storage_path).filter((p) => !stored.has(p));
  for (const p of dbRowsWithoutObject) problems.push(`Registro no banco sem objeto no storage: ${p}`);

  const manifest = {
    version: 1,
    createdAt: new Date(now).toISOString(),
    projectHost,
    bucket: BUCKET,
    objectCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    dbRowCount: rows.length,
    objectsWithoutRecord: files.filter((f) => !f.inDb).map((f) => f.path),
    dbRowsWithoutObject,
    problems,
    files,
  };
  await mkdir(outDir, { recursive: true });
  const manifestPath = join(outDir, `manifest-${stampOf(now)}.json`);
  await writeFile(`${manifestPath}.part`, JSON.stringify(manifest, null, 2));
  await rename(`${manifestPath}.part`, manifestPath);
  log(`Baixados agora: ${downloaded}; já existiam: ${reused}; total no manifesto: ${files.length}`);
  return { manifestPath, manifest, downloaded, reused, problems };
}

async function loadManifest(dir, manifestPath) {
  let path = manifestPath ? resolve(manifestPath) : null;
  if (!path) {
    const names = (await readdir(dir)).filter((n) => /^manifest-.*\.json$/.test(n)).sort();
    if (!names.length) throw new Error("Nenhum manifest-*.json na pasta.");
    path = join(dir, names[names.length - 1]);
  }
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (manifest?.version !== 1 || manifest.bucket !== BUCKET || !Array.isArray(manifest.files)) throw new Error("Manifesto inválido ou de outra versão.");
  for (const f of manifest.files) {
    safeObjectPath(f.path);
    if (!SHA256.test(f.sha256) || !Number.isInteger(f.size)) throw new Error("Manifesto com entrada inválida.");
  }
  return { path, manifest };
}

/** Confere o espelho contra o manifesto: existência, tamanho e SHA-256 de cada arquivo. */
export async function verifyStorageDir({ dir, manifestPath = undefined }) {
  const { path, manifest } = await loadManifest(dir, manifestPath);
  const root = join(dir, "materials");
  const missing = [];
  const mismatched = [];
  for (const f of manifest.files) {
    const file = join(root, ...f.path.split("/"));
    const have = await statOrNull(file);
    if (!have) missing.push(f.path);
    else if (have.size !== f.size || (await sha256File(file)) !== f.sha256) mismatched.push(f.path);
  }
  const known = new Set(manifest.files.map((f) => f.path));
  let extra = 0;
  for (const entry of await readdir(root, { recursive: true }).catch(() => [])) {
    const rel = String(entry).split("\\").join("/");
    if (rel.endsWith(".part") || known.has(rel)) continue;
    if ((await stat(join(root, rel))).isFile()) extra++;
  }
  const ok = !missing.length && !mismatched.length && !manifest.problems?.length;
  return { ok, manifestPath: path, checked: manifest.files.length, missing, mismatched, extra, manifestProblems: manifest.problems ?? [], manifest };
}

/** Envia ao bucket os arquivos do espelho que ainda não existem lá. Padrão: simulação. Nunca sobrescreve. */
export async function runStorageRestore({ admin, dir, manifestPath = undefined, execute = false, log = () => {} }) {
  const check = await verifyStorageDir({ dir, manifestPath });
  if (check.missing.length || check.mismatched.length) {
    throw new Error(`O espelho não confere com o manifesto (faltando ${check.missing.length}, alterados ${check.mismatched.length}). Nada foi enviado.`);
  }
  const remote = new Set((await listAll(admin.storage)).map((o) => o.name));
  const pending = check.manifest.files.filter((f) => !remote.has(f.path));
  const noMime = pending.filter((f) => !f.mime);
  if (noMime.length) throw new Error(`${noMime.length} arquivo(s) sem tipo MIME no manifesto (não estavam no banco). Nada foi enviado.`);
  log(`No projeto: ${remote.size} objeto(s); a enviar: ${pending.length}; já presentes (ficam): ${check.manifest.files.length - pending.length}`);
  if (!execute) return { pending: pending.length, uploaded: 0, skipped: 0 };
  let uploaded = 0;
  let skipped = 0;
  for (const f of pending) {
    const body = await readFile(join(dir, "materials", ...f.path.split("/")));
    const { error } = await admin.storage.from(BUCKET).upload(f.path, body, { contentType: f.mime, upsert: false });
    if (error) {
      if (/already exists|duplicate/i.test(error.message)) skipped++;
      else throw new Error(`Falha ao enviar ${f.path} (já enviados: ${uploaded}): ${error.message}`);
    } else uploaded++;
  }
  return { pending: pending.length, uploaded, skipped };
}

// ---------- cifragem de arquivos (AES-256-GCM, senha em BACKUP_PASSPHRASE) ----------
const MAGIC = Buffer.from("ALBK1\n");
const HEADER = MAGIC.length + 16 + 12;
const TAG = 16;
export const MIN_PASSPHRASE = 16;
const deriveKey = (passphrase, salt) => scryptSync(passphrase, salt, 32, { N: 2 ** 16, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });

function checkPassphrase(p) {
  if (typeof p !== "string" || p.length < MIN_PASSPHRASE) throw new Error(`Defina BACKUP_PASSPHRASE com pelo menos ${MIN_PASSPHRASE} caracteres.`);
}

export async function sealFile(inPath, outPath, passphrase) {
  checkPassphrase(passphrase);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  cipher.setAAD(header);
  const handle = await open(outPath, "wx");
  try {
    await handle.write(header);
    for await (const chunk of createReadStream(inPath)) {
      const enc = cipher.update(chunk);
      if (enc.length) await handle.write(enc);
    }
    const last = cipher.final();
    if (last.length) await handle.write(last);
    await handle.write(cipher.getAuthTag());
  } catch (error) {
    await handle.close();
    await rm(outPath, { force: true });
    throw error;
  }
  await handle.close();
}

/** Decifra para `outPath` (ou, com outPath nulo, só confere a integridade sem gravar o conteúdo). */
export async function unsealFile(inPath, outPath, passphrase) {
  checkPassphrase(passphrase);
  const size = (await stat(inPath)).size;
  if (size < HEADER + TAG) throw new Error("Arquivo cifrado inválido (pequeno demais).");
  const src = await open(inPath, "r");
  let header;
  let tag;
  try {
    header = Buffer.alloc(HEADER);
    await src.read(header, 0, HEADER, 0);
    tag = Buffer.alloc(TAG);
    await src.read(tag, 0, TAG, size - TAG);
  } finally {
    await src.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Este arquivo não é um backup cifrado do Aprova Luvi.");
  const salt = header.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = header.subarray(MAGIC.length + 16);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const out = outPath ? await open(outPath, "wx") : null;
  try {
    if (size > HEADER + TAG) {
      for await (const chunk of createReadStream(inPath, { start: HEADER, end: size - TAG - 1 })) {
        const plain = decipher.update(chunk);
        if (out && plain.length) await out.write(plain);
      }
    }
    const last = decipher.final();
    if (out && last.length) await out.write(last);
  } catch {
    if (out) {
      await out.close();
      await rm(outPath, { force: true });
    }
    throw new Error("Senha incorreta ou arquivo corrompido/adulterado. Nada foi gravado.");
  }
  if (out) await out.close();
}

// ---------- linha de comando ----------
export function buildSupabasePlan(env, { requireProduction }) {
  const errors = [];
  const url = env.SUPABASE_URL?.trim();
  const secret = (env.SUPABASE_SECRET_KEY || "").trim();
  let host = "";
  try {
    host = new URL(url ?? "").host.toLowerCase();
  } catch {
    errors.push("Defina SUPABASE_URL com a URL do projeto.");
  }
  if (requireProduction && host && host !== PRODUCTION_SUPABASE_HOST) errors.push(`O backup do storage só aceita o projeto de produção (${PRODUCTION_SUPABASE_HOST}).`);
  if (!secret) errors.push("Defina SUPABASE_SECRET_KEY (chave `sb_secret_…`) no ambiente do terminal.");
  else if (classifyKey(secret) !== "secret") errors.push("A chave informada não é a SECRETA (`sb_secret_…`).");
  return { errors, url, secret, host };
}

async function makeAdmin(plan) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(plan.url, plan.secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

const fail = (message, code = 1) => {
  console.error(`Erro: ${message}`);
  process.exit(code);
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const allowCloud = args["allow-cloud-sync"] === true;

  if (command === "storage-backup") {
    const plan = buildSupabasePlan(process.env, { requireProduction: true });
    if (plan.errors.length) return plan.errors.forEach((e) => console.error(`Erro: ${e}`)), process.exit(1);
    const outDir = assertSafeOutDir(args.out, { allowCloud });
    console.log(`Projeto: ${plan.host}\nBucket : ${BUCKET}\nDestino: ${outDir}\nModo   : somente leitura no Supabase\n`);
    const result = await runStorageBackup({ admin: await makeAdmin(plan), outDir, projectHost: plan.host, log: console.log });
    console.log(`Manifesto: ${result.manifestPath}\nObjetos: ${result.manifest.objectCount} (${result.manifest.totalBytes} bytes)`);
    if (result.problems.length) {
      for (const p of result.problems.slice(0, 20)) console.error(`PROBLEMA: ${p}`);
      return fail(`${result.problems.length} problema(s): o backup NÃO deve ser considerado válido.`, 2);
    }
    return console.log("Backup do storage concluído sem problemas. Rode também: storage-verify.");
  }

  if (command === "storage-verify") {
    const dir = assertSafeOutDir(args.dir, { allowCloud: true });
    const r = await verifyStorageDir({ dir, manifestPath: args.manifest });
    console.log(`Manifesto: ${r.manifestPath}\nConferidos: ${r.checked}; faltando: ${r.missing.length}; alterados: ${r.mismatched.length}; extras no espelho: ${r.extra}`);
    for (const p of r.missing.slice(0, 10)) console.error(`FALTA: ${p}`);
    for (const p of r.mismatched.slice(0, 10)) console.error(`ALTERADO: ${p}`);
    for (const p of r.manifestProblems.slice(0, 10)) console.error(`PROBLEMA NO MANIFESTO: ${p}`);
    return r.ok ? console.log("Espelho íntegro.") : fail("o espelho NÃO confere com o manifesto.", 2);
  }

  if (command === "storage-restore") {
    const dir = assertSafeOutDir(args.dir, { allowCloud: true });
    const execute = args.execute === true;
    let admin = null;
    if (execute || process.env.SUPABASE_URL) {
      const plan = buildSupabasePlan(process.env, { requireProduction: false });
      if (plan.errors.length) return plan.errors.forEach((e) => console.error(`Erro: ${e}`)), process.exit(1);
      if (execute && String(args["project-host"] ?? "").toLowerCase() !== plan.host) return fail(`--execute exige --project-host ${plan.host} (confirma o projeto de destino).`);
      console.log(`Projeto de destino: ${plan.host}\nModo: ${execute ? "ENVIO (nunca sobrescreve)" : "simulação"}\n`);
      admin = await makeAdmin(plan);
    }
    if (!admin) return fail("Defina SUPABASE_URL e SUPABASE_SECRET_KEY do projeto de destino.");
    const r = await runStorageRestore({ admin, dir, manifestPath: args.manifest, execute, log: console.log });
    return console.log(execute ? `Enviados: ${r.uploaded}; já existiam: ${r.skipped}.` : `Simulação: ${r.pending} arquivo(s) seriam enviados. Nada foi gravado.`);
  }

  if (command === "seal" || command === "unseal") {
    if (!args.in) return fail("Informe --in.");
    const pass = process.env.BACKUP_PASSPHRASE;
    if (command === "seal") {
      if (!args.out) return fail("Informe --out.");
      await sealFile(resolve(args.in), resolve(args.out), pass);
      return console.log("Arquivo cifrado gravado. Guarde a senha no gerenciador de senhas: sem ela o backup é irrecuperável.");
    }
    if (!args.out && args.check !== true) return fail("Informe --out ARQUIVO ou --check.");
    await unsealFile(resolve(args.in), args.check === true ? null : resolve(args.out), pass);
    return console.log(args.check === true ? "Integridade confirmada (nada foi gravado)." : "Arquivo decifrado.");
  }

  fail("Comandos: storage-backup | storage-verify | storage-restore | seal | unseal (veja docs/BACKUP.md).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
