#!/usr/bin/env node
/**
 * Limpeza segura de arquivos ÓRFÃOS do bucket privado `materials` (objetos que nenhum registro de material_files usa).
 * O padrão é RELATÓRIO: lê e mostra, sem apagar nada.
 *
 *   # 1) relatório (somente leitura): objetos, órfãos apagáveis, recentes, fora do padrão e registros sem objeto
 *   node --env-file=.env.local scripts/cleanup-storage-orphans.mjs
 *   # 2) apagar de verdade (confirma o projeto, limite de segurança e carência mínima)
 *   node --env-file=.env.local scripts/cleanup-storage-orphans.mjs --execute --project-host xxxx.supabase.co [--older-than-hours 24] [--max-delete 200]
 *
 * Regras de segurança:
 *  - só apaga objeto SEM registro em material_files, no padrão <uuid cliente>/<uuid material>/…, e mais antigo que a carência
 *    (padrão 24 h, mínimo 1 h) para nunca pegar um envio em andamento;
 *  - o que está fora do padrão e os registros sem objeto só são RELATADOS (o histórico de versões é imutável);
 *  - recusa apagar se o banco não tem arquivo nenhum mas o storage tem (projeto errado/consulta falha) e se o plano passa de --max-delete;
 *  - --execute exige --project-host igual ao host de SUPABASE_URL; exige a chave SECRETA; nunca imprime chaves nem URLs assinadas.
 */
import { pathToFileURL } from "node:url";
import { classifyKey } from "../src/lib/env.ts";
import { DEFAULT_GRACE_HOURS, MIN_GRACE_HOURS, deletionBlockers, planOrphans } from "../src/lib/storage/orphans.ts";
import { parseArgs } from "./bootstrap-admin.mjs";

const BUCKET = "materials";
const PAGE = 1000;

export function buildPlan(argv, env) {
  const args = parseArgs(argv);
  const errors = [];
  const url = env.SUPABASE_URL?.trim();
  const secret = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  let supabaseHost = "";
  try {
    supabaseHost = new URL(url ?? "").host;
  } catch {
    errors.push("Defina SUPABASE_URL com a URL do projeto.");
  }
  const kind = classifyKey(secret);
  if (!secret) errors.push("Defina SUPABASE_SECRET_KEY (chave `sb_secret_…`) no ambiente.");
  else if (kind !== "secret" && kind !== "legacy-service-role") errors.push("A chave informada não é a SECRETA (`sb_secret_…`).");

  const graceHours = args["older-than-hours"] === undefined ? DEFAULT_GRACE_HOURS : Number(args["older-than-hours"]);
  if (!Number.isFinite(graceHours) || graceHours < MIN_GRACE_HOURS) errors.push(`--older-than-hours precisa ser um número >= ${MIN_GRACE_HOURS}.`);
  const maxDelete = args["max-delete"] === undefined ? 200 : Number(args["max-delete"]);
  if (!Number.isInteger(maxDelete) || maxDelete < 1) errors.push("--max-delete precisa ser um inteiro >= 1.");

  const execute = args.execute === true;
  if (execute && !errors.length && String(args["project-host"] ?? "").toLowerCase() !== supabaseHost.toLowerCase()) {
    errors.push(`--execute exige --project-host ${supabaseHost} (confirma que este é o projeto certo).`);
  }
  return { errors, mode: execute ? "execute" : "report", url, secret, supabaseHost, graceHours, maxDelete };
}

/** Lista TODOS os objetos do bucket, descendo pelas pastas. */
export async function listAll(storage) {
  const out = [];
  const walk = async (prefix) => {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await storage.from(BUCKET).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(`Falha ao listar o storage: ${error.message}`);
      for (const entry of data ?? []) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null || entry.id === undefined) await walk(path); // pasta
        else out.push({ name: path, createdAt: entry.created_at ?? entry.updated_at ?? null, size: entry.metadata?.size ?? null });
      }
      if (!data || data.length < PAGE) break;
    }
  };
  await walk("");
  return out;
}

async function listFilePaths(admin) {
  const paths = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("material_files").select("storage_path").order("storage_path").range(from, from + PAGE - 1);
    if (error) throw new Error(`Falha ao ler material_files: ${error.message}`);
    paths.push(...(data ?? []).map((r) => r.storage_path));
    if (!data || data.length < PAGE) break;
  }
  return paths;
}

async function main() {
  const plan = buildPlan(process.argv.slice(2), process.env);
  if (plan.errors.length) {
    for (const e of plan.errors) console.error(`Erro: ${e}`);
    process.exit(1);
  }
  console.log(`Projeto Supabase : ${plan.supabaseHost}\nBucket           : ${BUCKET}\nCarência         : ${plan.graceHours} h\nModo             : ${plan.mode}\n`);

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(plan.url, plan.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const [objects, filePaths] = await Promise.all([listAll(admin.storage), listFilePaths(admin)]);
  const result = planOrphans({ objects, filePaths, now: Date.now(), graceHours: plan.graceHours });

  console.log(`Objetos no storage             : ${objects.length}`);
  console.log(`Com registro (ficam)           : ${result.kept}`);
  console.log(`Órfãos apagáveis               : ${result.deletable.length}`);
  console.log(`Sem registro, mas recentes     : ${result.recent.length} (podem ser envios em andamento; ficam)`);
  console.log(`Fora do padrão (nunca apagados): ${result.unexpected.length}`);
  console.log(`Registros sem objeto (só relato): ${result.missing.length}`);
  for (const o of result.deletable.slice(0, 20)) console.log(`  apagável: ${o.name} (${o.createdAt ?? "sem data"})`);
  for (const o of result.unexpected.slice(0, 10)) console.log(`  fora do padrão: ${o.name}`);
  for (const p of result.missing.slice(0, 10)) console.log(`  registro sem objeto: ${p}`);

  if (plan.mode === "report") {
    console.log("\nRelatório: nada foi apagado. Use --execute --project-host <host> para apagar os órfãos apagáveis.");
    return;
  }
  const blockers = deletionBlockers({ plan: result, fileRowCount: filePaths.length, objectCount: objects.length, maxDelete: plan.maxDelete });
  if (blockers.length) {
    for (const b of blockers) console.error(`Recusado: ${b}`);
    process.exit(2);
  }
  let removed = 0;
  for (let i = 0; i < result.deletable.length; i += 100) {
    const batch = result.deletable.slice(i, i + 100).map((o) => o.name);
    const { error } = await admin.storage.from(BUCKET).remove(batch);
    if (error) {
      console.error(`Erro ao apagar um lote (já apagados: ${removed}): ${error.message}`);
      process.exit(3);
    }
    removed += batch.length;
  }
  console.log(`\nApagados: ${removed} objeto(s) órfão(s). Nenhum registro do banco foi alterado.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Erro: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
