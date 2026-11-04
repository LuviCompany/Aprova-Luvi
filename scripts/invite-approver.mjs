#!/usr/bin/env node
/**
 * Cria o LOGIN de um aprovador de cliente já cadastrado no painel (com o convite "preparado"), por link de convite.
 * O próprio aprovador cria a senha ao abrir o link: este script NUNCA cria, define, recebe nem imprime senha.
 *
 * O padrão é SIMULAÇÃO: valida tudo e mostra o plano SEM tocar na rede.
 *
 *   # 1) simulação (nenhuma chamada de rede)
 *   node --env-file=.env.local scripts/invite-approver.mjs --approver-id <uuid>
 *   # 2) conferência, SOMENTE LEITURA (confere aprovador, cliente e convite preparado; não altera nada)
 *   node --env-file=.env.local scripts/invite-approver.mjs --approver-id <uuid> --check-connection
 *   # 3) execução real: cria o usuário no Auth, o perfil (papel "cliente"), liga o perfil ao aprovador, marca o convite
 *   #    como enviado e IMPRIME o link no seu terminal (NENHUM e-mail é enviado; não precisa de SMTP)
 *   node --env-file=.env.local scripts/invite-approver.mjs --approver-id <uuid> --execute --project-host xxxx.supabase.co
 *
 * Variáveis (do ambiente do terminal, nunca de argumento nem de arquivo versionado): SUPABASE_URL, SUPABASE_SECRET_KEY
 * (\`sb_secret_…\`) e APP_URL (para onde o link do convite aponta).
 *
 * Travas: exige a chave SECRETA; --execute exige --project-host igual ao host de SUPABASE_URL; recusa APP_URL de
 * produção sem --allow-production e http fora de localhost; só age em aprovador ATIVO, de cliente ATIVO, SEM login e com
 * convite PREPARADO; o e-mail do login é o do aprovador (a regra do banco exige que sejam iguais); se algo falha depois
 * de criar o usuário, ele é removido (nada de conta órfã). O link impresso vale como senha: abra você mesmo e nunca cole
 * em chat, e-mail ou ticket.
 */
import { pathToFileURL } from "node:url";
import { classifyKey } from "../src/lib/env.ts";
import { PRODUCTION_HOSTS, parseArgs } from "./bootstrap-admin.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Valida argumentos e ambiente e devolve o plano. Função pura: não toca em rede nem em disco. */
export function buildPlan(argv, env) {
  const args = parseArgs(argv);
  const errors = [];
  const url = env.SUPABASE_URL?.trim();
  const secret = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const appUrlRaw = env.APP_URL?.trim();
  const approverId = String(args["approver-id"] ?? "").trim();

  let supabaseHost = "";
  try {
    const parsed = new URL(url ?? "");
    supabaseHost = parsed.host;
    if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) errors.push("SUPABASE_URL deve usar https.");
  } catch {
    errors.push("Defina SUPABASE_URL com a URL do projeto.");
  }

  const keyKind = classifyKey(secret);
  if (!secret) errors.push("Defina SUPABASE_SECRET_KEY (chave `sb_secret_…`) no ambiente.");
  else if (keyKind !== "secret" && keyKind !== "legacy-service-role") errors.push("A chave informada não é a SECRETA (`sb_secret_…`).");

  let appUrl = "";
  if (!appUrlRaw) errors.push("Defina APP_URL (para onde o link do convite aponta).");
  else {
    try {
      const parsed = new URL(appUrlRaw);
      appUrl = parsed.origin;
      const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
      if (parsed.protocol !== "https:" && !local) errors.push("APP_URL deve usar https (ou ser localhost).");
      if (PRODUCTION_HOSTS.includes(parsed.hostname) && !args["allow-production"]) {
        errors.push(`APP_URL aponta para a PRODUÇÃO (${parsed.hostname}). Use --allow-production só se for intencional.`);
      }
    } catch {
      errors.push("APP_URL não é uma URL válida.");
    }
  }

  if (!UUID.test(approverId)) errors.push("Informe --approver-id com o id (uuid) do aprovador cadastrado no painel.");

  const execute = args.execute === true;
  if (execute && !errors.length && String(args["project-host"] ?? "").toLowerCase() !== supabaseHost.toLowerCase()) {
    errors.push(`--execute exige --project-host ${supabaseHost} (confirma que este é o projeto certo).`);
  }

  return {
    errors,
    mode: execute ? "execute" : args["check-connection"] === true ? "check" : "dry-run",
    url,
    secret,
    supabaseHost,
    keyKind,
    appUrl,
    approverId,
  };
}

export function describePlan(plan) {
  return [
    `Projeto Supabase : ${plan.supabaseHost}`,
    `Tipo da chave    : ${plan.keyKind}`,
    `Chegada do convite: ${plan.appUrl}/auth/invite`,
    `Entrega do convite: link impresso no terminal (nenhum e-mail é enviado; a senha é criada pelo próprio aprovador)`,
    `Aprovador (id)   : ${plan.approverId}`,
    `Modo             : ${plan.mode}`,
  ].join("\n");
}

/** Confere se o aprovador pode receber o login. Devolve a lista de problemas (vazia = pode). */
export function checkApprover(approver, client, invites, profileWithEmail) {
  const problems = [];
  if (!approver) return ["Aprovador não encontrado."];
  if (!approver.active) problems.push("O aprovador está inativo.");
  if (approver.profile_id) problems.push("O aprovador já tem acesso ao portal.");
  if (!client?.active) problems.push("O cliente está arquivado.");
  if (!invites.some((i) => i.status === "preparado")) problems.push('Não há convite PREPARADO: use "Preparar convite" no painel antes.');
  if (profileWithEmail) problems.push("Já existe um perfil com este e-mail.");
  return problems;
}

async function main() {
  const plan = buildPlan(process.argv.slice(2), process.env);
  if (plan.errors.length) {
    for (const e of plan.errors) console.error(`Erro: ${e}`);
    process.exit(1);
  }
  console.log(describePlan(plan));
  if (plan.mode === "dry-run") {
    console.log("\nSimulação: nada foi lido nem alterado. Use --check-connection (leitura) ou --execute.");
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(plan.url, plan.secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const approver = (await admin.from("approvers").select("id, client_id, name, email, active, profile_id").eq("id", plan.approverId).maybeSingle()).data;
  const client = approver ? (await admin.from("clients").select("id, name, active, organization_id").eq("id", approver.client_id).maybeSingle()).data : null;
  const invites = approver ? ((await admin.from("approver_invites").select("id, status").eq("approver_id", approver.id)).data ?? []) : [];
  const existing = approver ? (await admin.from("profiles").select("id").eq("email", approver.email).maybeSingle()).data : null;

  const problems = checkApprover(approver, client, invites, existing);
  if (problems.length) {
    for (const p of problems) console.error(`Erro: ${p}`);
    process.exit(1);
  }
  // Não imprime o e-mail inteiro no log da execução: só uma máscara.
  const masked = `${approver.email.slice(0, 2)}***@${approver.email.split("@")[1]}`;
  console.log(`\nAprovador: ${approver.name} <${masked}> · cliente: ${client.name}`);

  if (plan.mode === "check") {
    console.log("Conferência OK (somente leitura). Nada foi alterado.");
    return;
  }

  const redirectTo = `${plan.appUrl}/auth/invite`;
  const generated = await admin.auth.admin.generateLink({ type: "invite", email: approver.email, options: { redirectTo, data: { full_name: approver.name } } });
  if (generated.error) fail(`Falha ao gerar o convite: ${generated.error.message}`);
  const userId = generated.data.user.id;
  const inviteUrl = `${plan.appUrl}/auth/invite?token_hash=${encodeURIComponent(generated.data.properties.hashed_token)}&type=invite`;

  const rollback = async (message) => {
    await admin.from("approvers").update({ profile_id: null }).eq("id", approver.id);
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId); // não deixa conta órfã
    fail(message);
  };

  const profile = await admin.from("profiles").insert({ id: userId, organization_id: client.organization_id, full_name: approver.name, email: approver.email, role: "cliente" });
  if (profile.error) await rollback(`Falha ao criar o perfil: ${profile.error.message}`);
  const link = await admin.from("approvers").update({ profile_id: userId }).eq("id", approver.id);
  if (link.error) await rollback(`Falha ao ligar o perfil ao aprovador: ${link.error.message}`);
  const invite = invites.find((i) => i.status === "preparado");
  const marked = await admin
    .from("approver_invites")
    .update({ status: "enviado", sent_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString() })
    .eq("id", invite.id);
  if (marked.error) await rollback(`Falha ao marcar o convite: ${marked.error.message}`);

  console.log("\nLogin criado e ligado ao aprovador. Abra este link no navegador para CRIAR A SUA SENHA.");
  console.log("ATENÇÃO: é de uso único, expira (1 hora) e vale como senha. Não cole em chat, e-mail ou ticket.\n");
  console.log(inviteUrl);
}

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
