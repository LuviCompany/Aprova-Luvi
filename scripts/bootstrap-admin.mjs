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
 *   # 3) execução real: cria a organização e o administrador e GERA o link de convite, que é
 *   #    impresso no seu terminal (NENHUM e-mail é enviado; não precisa de SMTP)
 *   node scripts/bootstrap-admin.mjs --email ... --name ... --execute --project-host xxxx.supabase.co
 *   # 3b) o mesmo, mas ENVIANDO o convite por e-mail pelo Supabase (exige SMTP configurado)
 *   node scripts/bootstrap-admin.mjs --email ... --name ... --execute --send-email --project-host xxxx.supabase.co
 *
 * Variáveis (do ambiente do terminal, nunca de argumento nem de arquivo versionado):
 *   SUPABASE_URL, SUPABASE_SECRET_KEY (`sb_secret_…`; legado aceito: SUPABASE_SERVICE_ROLE_KEY),
 *   APP_URL (obrigatória: é para onde o link do convite aponta; sem valor padrão de propósito).
 *
 * Travas de segurança:
 *  - exige a chave SECRETA (recusa `sb_publishable_…` e a chave anon legada);
 *  - --execute exige --project-host igual ao host de SUPABASE_URL (evita rodar no projeto errado);
 *  - recusa APP_URL de produção sem --allow-production, e http fora de localhost;
 *  - TRAVA DE PROJETO: APP_URL de produção (aprova.luvicompany.com.br) só com o projeto Supabase de
 *    produção, e o projeto de produção só com essa APP_URL (vale até na simulação);
 *  - só roda em banco sem perfis; a única exceção é RETOMAR o mesmo administrador (um único perfil, mesmo
 *    e-mail, papel admin, conta do Auth nunca ativada), caso em que só um NOVO convite é emitido;
 *  - nenhuma senha é criada ou exibida (você a define na página do convite); a chave nunca é impressa;
 *  - o link de convite impresso é de uso único e expira (padrão do Auth): trate como senha, abra
 *    você mesmo e nunca cole em chat, e-mail ou ticket.
 */
import { pathToFileURL } from "node:url";
import { PRODUCTION_SUPABASE_HOST, classifyKey } from "../src/lib/env.ts";

export const PRODUCTION_HOSTS = ["aprova.luvicompany.com.br"];
/**
 * Trava de projeto: o site de produção só pode ser ligado ao projeto Supabase de produção, e vice-versa.
 * O ID do projeto não é segredo. Sem esse par, o script recusa mesmo com --allow-production e --project-host.
 * Fonte única: a mesma constante que o env:check:prod e o backup do Storage usam (src/lib/env.ts), para os
 * travamentos nunca divergirem entre si. "Aprova Luvi - Produção".
 */
export const PRODUCTION_PROJECT_HOSTS = [PRODUCTION_SUPABASE_HOST];

const FLAGS = new Set(["execute", "check-connection", "allow-production", "send-email"]);

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

  // Trava de projeto (vale em todos os modos, inclusive na simulação): produção com produção, resto com resto.
  const appIsProduction = PRODUCTION_HOSTS.includes(appHost);
  const dbIsProduction = PRODUCTION_PROJECT_HOSTS.includes(supabaseHost.toLowerCase());
  if (appHost && supabaseHost) {
    if (appIsProduction && !dbIsProduction) {
      errors.push(`APP_URL de produção só pode ser usada com o projeto Supabase de produção (${PRODUCTION_PROJECT_HOSTS[0]}); SUPABASE_URL aponta para ${supabaseHost}.`);
    }
    if (dbIsProduction && !appIsProduction) {
      errors.push(`O projeto Supabase de PRODUÇÃO (${supabaseHost}) só pode ser usado com APP_URL=https://${PRODUCTION_HOSTS[0]}.`);
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
    sendEmail: args["send-email"] === true,
  };
}

export function describePlan(plan) {
  return [
    `Projeto Supabase : ${plan.supabaseHost}${PRODUCTION_PROJECT_HOSTS.includes(plan.supabaseHost.toLowerCase()) ? "  (PRODUÇÃO)" : ""}`,
    `Tipo da chave    : ${plan.keyKind}`,
    `Chegada do convite: ${plan.appUrl}/auth/invite`,
    `Entrega do convite: ${plan.sendEmail ? "e-mail enviado pelo Supabase (exige SMTP)" : "link impresso no terminal (nenhum e-mail é enviado)"}`,
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
  await runBootstrap(plan, admin);
}

class BootstrapError extends Error {}
const stop = (message) => {
  throw new BootstrapError(message);
};

/**
 * Procura o administrador de uma execução anterior que parou no meio (perfil criado, convite não entregue).
 * Só aceita o caso inequívoco: UM único perfil, o mesmo e-mail, papel admin e conta do Auth que NUNCA foi
 * ativada (sem confirmação e sem login). Qualquer outra coisa continua sendo recusada.
 */
async function findResumableAdmin(admin, plan, count) {
  const refuse = () => stop("Já existem perfis cadastrados. O bootstrap só roda em um banco vazio (ou para retomar o MESMO administrador que ainda não ativou a conta).");
  if (count !== 1) refuse();
  const { data: profile, error } = await admin.from("profiles").select("id, email, role").eq("email", plan.email).maybeSingle();
  if (error || !profile || profile.role !== "admin") refuse();
  const found = await admin.auth.admin.getUserById(profile.id);
  const user = found.data?.user;
  if (found.error || !user) stop("O perfil existe, mas a conta correspondente não foi encontrada no Auth. Não repita o bootstrap: traga este erro ao responsável.");
  if (user.email_confirmed_at || user.last_sign_in_at) {
    stop("O administrador já ativou a conta. Não repita o bootstrap: use \"Esqueci minha senha\" na tela de login.");
  }
  return user.id;
}

/**
 * Núcleo do bootstrap (recebe o cliente Supabase administrativo, então é testável sem rede).
 * Reexecução segura: a organização é reaproveitada pelo slug; um usuário do Auth sem perfil é reaproveitado
 * (o convite é refeito); se o perfil falhar, a conta recém-criada é desfeita; e se o perfil já existir e a conta
 * nunca foi ativada, só um NOVO convite é emitido (retomada).
 */
export async function runBootstrap(plan, admin, log = console.log) {
  // Leitura: confirma que a chave secreta funciona na API de dados e que as migrations existem.
  const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true });
  if (countError) stop(`Não foi possível consultar profiles (as migrations foram aplicadas? a chave é a secreta?): ${countError.message}`);
  // Leitura: confirma que a chave secreta funciona na API administrativa do Auth.
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (users.error) stop(`A chave não conseguiu usar a API administrativa do Auth: ${users.error.message}`);

  if (plan.mode === "check-connection") {
    log(`\nConexão OK. Perfis existentes: ${count ?? 0}. Nada foi alterado.`);
    return { status: "checked" };
  }

  const resumeUserId = count && count > 0 ? await findResumableAdmin(admin, plan, count) : null;

  let orgId = null;
  if (!resumeUserId) {
    let { data: org } = await admin.from("organizations").select("id").eq("slug", "luvi-company").maybeSingle();
    if (!org) {
      const created = await admin.from("organizations").insert({ name: "Luvi Company", slug: "luvi-company" }).select("id").single();
      if (created.error) stop(`Falha ao criar a organização: ${created.error.message}`);
      org = created.data;
    }
    orgId = org.id;
  }

  const redirectTo = `${plan.appUrl}/auth/invite`;
  const data = { full_name: plan.name };
  let userId;
  let inviteUrl = null;
  if (plan.sendEmail) {
    const invited = await admin.auth.admin.inviteUserByEmail(plan.email, { redirectTo, data });
    if (invited.error) stop(`Falha ao convidar o usuário: ${invited.error.message}`);
    userId = invited.data.user.id;
  } else {
    // Gera o convite SEM enviar e-mail. O link usa o token_hash e termina no nosso /auth/invite,
    // que o valida no servidor (verifyOtp): não depende de modelo de e-mail nem de SMTP.
    let generated = await admin.auth.admin.generateLink({ type: "invite", email: plan.email, options: { redirectTo, data } });
    let type = "invite";
    if (generated.error && resumeUserId) {
      // Retomada: se o convite não puder ser refeito para uma conta já criada, usa o link de recuperação (mesmo destino).
      generated = await admin.auth.admin.generateLink({ type: "recovery", email: plan.email, options: { redirectTo: `${plan.appUrl}/auth/recovery` } });
      type = "recovery";
    }
    if (generated.error) stop(`Falha ao gerar o convite: ${generated.error.message}`);
    userId = generated.data.user.id;
    inviteUrl = `${plan.appUrl}/auth/${type}?token_hash=${encodeURIComponent(generated.data.properties.hashed_token)}&type=${type}`;
  }

  if (resumeUserId) {
    if (userId !== resumeUserId) stop("O convite foi emitido para outra conta do Auth. Não repita o bootstrap: traga este erro ao responsável.");
  } else {
    const profile = await admin.from("profiles").insert({
      id: userId,
      organization_id: orgId,
      full_name: plan.name,
      email: plan.email,
      role: "admin",
    });
    if (profile.error) {
      await admin.auth.admin.deleteUser(userId); // não deixa conta órfã sem perfil
      stop(`Falha ao criar o perfil: ${profile.error.message}`);
    }
  }

  const verbo = resumeUserId ? "retomado (novo convite)" : "criado";
  if (inviteUrl) {
    log(`\nAdministrador ${verbo}: ${plan.email}. Abra este link no navegador para criar a senha.`);
    log("ATENÇÃO: é de uso único, expira e vale como senha. Não cole em chat, e-mail ou ticket.\n");
    log(inviteUrl);
  } else {
    log(`\nAdministrador ${verbo}: ${plan.email}. Abra o e-mail do convite e crie a senha.`);
  }
  return { status: resumeUserId ? "resumed" : "created", userId, inviteUrl };
}

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
