#!/usr/bin/env node
/**
 * Cria a organização "Luvi Company" e o PRIMEIRO administrador, por convite por e-mail.
 * Roda uma única vez por projeto Supabase, na sua máquina.
 *
 * O padrão é SIMULAÇÃO: valida tudo e mostra o plano SEM tocar na rede.
 *
 *   # 1) simulação (nenhuma chamada de rede)
 *   node scripts/bootstrap-admin.mjs --email voce@luvicompany.com.br --name "Seu Nome"
 *   # 2) teste de conexão, somente leitura (confere a chave secreta e o schema)
 *   node scripts/bootstrap-admin.mjs --email ... --name ... --check-connection
 *   # 3) execução real: cria a organização e ENVIA o convite por e-mail
 *   node scripts/bootstrap-admin.mjs --email ... --name ... --execute --project-host xxxx.supabase.co
 *
 * Variáveis (do ambiente do terminal, nunca de argumento nem de arquivo versionado):
 *   SUPABASE_URL, SUPABASE_SECRET_KEY (`sb_secret_…`; legado aceito: SUPABASE_SERVICE_ROLE_KEY),
 *   APP_URL (obrigatória: é para onde o link do convite aponta; sem valor padrão de propósito).
 *
 * Travas de segurança:
 *  - exige a chave SECRETA (recusa `sb_publishable_…` e a chave anon legada);
 *  - --execute exige --project-host igual ao host de SUPABASE_URL (evita rodar no projeto errado);
 *  - recusa APP_URL de produção sem --allow-production, e http fora de localhost;
 *  - só roda em banco sem perfis; nenhuma senha é criada ou exibida; a chave nunca é impressa.
 *
 * ATENÇÃO: o modo --execute ainda NÃO foi executado contra um projeto Supabase real.
 */
import { pathToFileURL } from "node:url";
import { classifyKey } from "../src/lib/env.ts";

export const PRODUCTION_HOSTS = ["aprova.luvicompany.com.br"];

const FLAGS = new Set(["execute", "check-connection", "allow-production"]);

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (FLAGS.has(key)) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

/** Valida argumentos e ambiente e devolve o plano. Função pura: não toca em rede nem em disco. */
export function buildPlan(argv, env) {
  const args = parseArgs(argv);
  const errors = [];

  const url = env.SUPABASE_URL?.trim();
  const secret = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const appUrlRaw = env.APP_URL?.trim();
  const email = String(args.email ?? "").trim().toLowerCase();
  const name = String(args.name ?? "").trim();

  let supabaseHost = "";
  try {
    const parsed = new URL(url ?? "");
    supabaseHost = parsed.host;
    if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      errors.push("SUPABASE_URL deve usar https.");
    }
  } catch {
    errors.push("Defina SUPABASE_URL com a URL do projeto.");
  }

  const keyKind = classifyKey(secret);
  if (!secret) errors.push("Defina SUPABASE_SECRET_KEY (chave `sb_secret_…`) no ambiente.");
  else if (keyKind !== "secret" && keyKind !== "legacy-service-role") {
    errors.push(
      keyKind === "publishable" || keyKind === "legacy-anon"
        ? "A chave informada é PÚBLICA. O bootstrap exige a chave SECRETA (`sb_secret_…`)."
        : "SUPABASE_SECRET_KEY não parece uma chave do Supabase (esperado `sb_secret_…`).",
    );
  }

  let appUrl = "";
  let appHost = "";
  if (!appUrlRaw) errors.push("Defina APP_URL (para onde o link do convite aponta). Não há valor padrão de propósito.");
  else {
    try {
      const parsed = new URL(appUrlRaw);
      appUrl = parsed.origin;
      appHost = parsed.hostname;
      const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
      if (parsed.protocol !== "https:" && !local) errors.push("APP_URL deve usar https (ou ser localhost).");
      if (PRODUCTION_HOSTS.includes(parsed.hostname) && !args["allow-production"]) {
        errors.push(`APP_URL aponta para a PRODUÇÃO (${parsed.hostname}). Use --allow-production só se for intencional.`);
      }
    } catch {
      errors.push("APP_URL não é uma URL válida.");
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Informe --email com um e-mail válido.");
  if (name.length < 2) errors.push('Informe --name "Nome Completo".');

  const execute = args.execute === true;
  if (execute && !errors.length && String(args["project-host"] ?? "").toLowerCase() !== supabaseHost.toLowerCase()) {
    errors.push(`--execute exige --project-host ${supabaseHost} (confirma que este é o projeto certo).`);
  }

  return {
    errors,
    mode: execute ? "execute" : args["check-connection"] ? "check-connection" : "dry-run",
    url,
    secret,
    supabaseHost,
    keyKind,
    appUrl,
    appHost,
    email,
    name,
  };
}

export function describePlan(plan) {
  return [
    `Projeto Supabase : ${plan.supabaseHost}`,
    `Tipo da chave    : ${plan.keyKind}`,
    `Link do convite  : ${plan.appUrl}/auth/confirm  (via {{ .RedirectTo }} do modelo de e-mail)`,
    `Administrador    : ${plan.name} <${plan.email}>`,
    `Modo             : ${plan.mode}`,
  ].join("\n");
}

async function main() {
  const plan = buildPlan(process.argv.slice(2), process.env);
  if (plan.errors.length) {
    for (const e of plan.errors) console.error(`Erro: ${e}`);
    process.exit(1);
  }
  console.log(describePlan(plan));

  if (plan.mode === "dry-run") {
    console.log("\nSimulação: nada foi enviado nem alterado. Use --check-connection ou --execute.");
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(plan.url, plan.secret, { auth: { persistSession: false, autoRefreshToken: false } });

  // Leitura: confirma que a chave secreta funciona na API de dados e que as migrations existem.
  const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true });
  if (countError) fail(`Não foi possível consultar profiles (as migrations foram aplicadas? a chave é a secreta?): ${countError.message}`);
  // Leitura: confirma que a chave secreta funciona na API administrativa do Auth.
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (users.error) fail(`A chave não conseguiu usar a API administrativa do Auth: ${users.error.message}`);

  if (plan.mode === "check-connection") {
    console.log(`\nConexão OK. Perfis existentes: ${count ?? 0}. Nada foi alterado.`);
    return;
  }

  if (count && count > 0) fail("Já existem perfis cadastrados. O bootstrap só roda em um banco vazio.");

  let { data: org } = await admin.from("organizations").select("id").eq("slug", "luvi-company").maybeSingle();
  if (!org) {
    const created = await admin.from("organizations").insert({ name: "Luvi Company", slug: "luvi-company" }).select("id").single();
    if (created.error) fail(`Falha ao criar a organização: ${created.error.message}`);
    org = created.data;
  }

  const invited = await admin.auth.admin.inviteUserByEmail(plan.email, {
    redirectTo: `${plan.appUrl}/auth/confirm`,
    data: { full_name: plan.name },
  });
  if (invited.error) fail(`Falha ao convidar o usuário: ${invited.error.message}`);

  const profile = await admin.from("profiles").insert({
    id: invited.data.user.id,
    organization_id: org.id,
    full_name: plan.name,
    email: plan.email,
    role: "admin",
  });
  if (profile.error) {
    await admin.auth.admin.deleteUser(invited.data.user.id); // não deixa conta órfã sem perfil
    fail(`Falha ao criar o perfil: ${profile.error.message}`);
  }

  console.log(`\nAdministrador convidado: ${plan.email}. Peça para abrir o e-mail e criar a senha.`);
}

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
