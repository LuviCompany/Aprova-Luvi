#!/usr/bin/env node
/**
 * Envia UM e-mail de teste pelo Resend, com assunto e conteúdo FIXOS (sem link, token ou código), para validar
 * o domínio, a chave e o remetente (EMAIL_FROM) no ambiente de DESENVOLVIMENTO. Usa a mesma `sendEmail` do app.
 *
 *   # 1) simulação (padrão): valida a configuração e mostra o plano, SEM abrir conexão e SEM enviar
 *   npm run email:test -- --to voce@seu-dominio.com.br
 *   # 2) envio real: UM e-mail (exige o host do projeto de desenvolvimento, igual ao SUPABASE_URL)
 *   npm run email:test -- --to voce@seu-dominio.com.br --execute --project-host xxxx.supabase.co
 *
 * Regras de segurança:
 *  - o padrão é simulação; só `--execute` envia, e `--execute` exige `--project-host` igual ao host de SUPABASE_URL;
 *  - recusa NODE_ENV=production e provedor que não seja `resend` (o simulado não prova nada);
 *  - um destinatário por execução, sem repetição automática; o conteúdo é fixo e não leva link, token nem código;
 *  - nunca imprime a chave de API nem o corpo da mensagem: só o remetente, o destinatário e o resultado.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getEmailProviderConfig } from "../src/lib/env.ts";
import { parseArgs } from "./bootstrap-admin.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const TEST_SUBJECT = "Aprova Luvi: teste de envio de e-mail";
export const TEST_TEXT =
  "Este é um e-mail de teste do Aprova Luvi, enviado para confirmar que o envio de e-mails está configurado.\n\n" +
  "Nenhuma ação é necessária. Pode ignorar esta mensagem.\n\nLuvi Company";
export const TEST_HTML =
  '<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#111">' +
  "<p>Este é um e-mail de teste do <strong>Aprova Luvi</strong>, enviado para confirmar que o envio de e-mails está configurado.</p>" +
  "<p>Nenhuma ação é necessária. Pode ignorar esta mensagem.</p><p>Luvi Company</p></body></html>";

const EMAIL_RE = /^[^\s@<>,;"'()[\]]+@[^\s@<>,;"'()[\]]+\.[^\s@<>,;"'()[\]]+$/;
const UNDELIVERABLE_TLD = /\.(invalid|test|example|localhost)$/i;

const FAILURE_HINT = {
  not_configured: "provedor não configurado (confira EMAIL_PROVIDER, RESEND_API_KEY e EMAIL_FROM).",
  rate_limited: "limite do Resend atingido; aguarde e tente de novo.",
  rejected: "o Resend recusou o pedido: confira a chave (permissão de envio), o domínio verificado e o EMAIL_FROM.",
  failed: "falha de rede ou erro temporário do Resend; tente de novo.",
};

/** Valida argumentos e ambiente e devolve o plano. Função pura: não toca em rede nem em disco. */
export function buildPlan(argv, env) {
  const args = parseArgs(argv);
  const errors = [];

  const to = String(args.to ?? "").trim().toLowerCase();
  if (!to) errors.push("Informe o destinatário com --to <e-mail> (um único endereço, que você controla).");
  else if (!EMAIL_RE.test(to)) errors.push("--to precisa ser um único e-mail válido.");
  else if (UNDELIVERABLE_TLD.test(to)) errors.push("--to usa um domínio que não recebe e-mail (.invalid, .test, .example, .localhost); use um endereço real seu.");

  if (env.NODE_ENV === "production") errors.push("Este script é só para desenvolvimento (NODE_ENV=production).");

  const config = getEmailProviderConfig(env);
  let from = "";
  if (config.kind === "resend") from = config.from;
  else if (config.kind === "simulated") errors.push("EMAIL_PROVIDER=simulated não envia e-mail de verdade; use EMAIL_PROVIDER=resend.");
  else errors.push(config.reason);

  let supabaseHost = "";
  try {
    supabaseHost = new URL(env.SUPABASE_URL?.trim() ?? "").host;
  } catch {
    supabaseHost = "";
  }

  const execute = args.execute === true;
  if (execute && !errors.length) {
    if (!supabaseHost) errors.push("Defina SUPABASE_URL (projeto de desenvolvimento) para confirmar o ambiente.");
    else if (String(args["project-host"] ?? "").toLowerCase() !== supabaseHost.toLowerCase()) {
      errors.push(`--execute exige --project-host ${supabaseHost} (confirma que este é o projeto de desenvolvimento).`);
    }
  }
  return { errors, mode: execute ? "execute" : "simulate", to, from, supabaseHost };
}

/** Envia o e-mail de teste com a função informada (a `sendEmail` do app, ou uma falsa nos testes). Um único envio. */
export async function sendTestEmail(plan, send, env = process.env) {
  const result = await send({ to: plan.to, subject: TEST_SUBJECT, text: TEST_TEXT, html: TEST_HTML }, env);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason, hint: FAILURE_HINT[result.reason] ?? FAILURE_HINT.failed };
}

/**
 * Carrega a `sendEmail` real do app. O código do app usa o alias `@/` e `server-only` (resolvidos pelo Next/Vitest);
 * aqui, fora deles, dois ganchos de resolução do Node fazem o mesmo, sem alterar o código do app.
 */
export async function loadSendEmail() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
      if (specifier.startsWith("@/")) {
        const base = resolve(ROOT, "src", specifier.slice(2));
        const file = [`${base}.ts`, resolve(base, "index.ts")].find((candidate) => existsSync(candidate));
        if (file) return nextResolve(pathToFileURL(file).href, context);
      }
      return nextResolve(specifier, context);
    },
  });
  const provider = await import("../src/lib/email/provider.ts");
  return provider.sendEmail;
}

async function main() {
  const plan = buildPlan(process.argv.slice(2), process.env);
  if (plan.errors.length) {
    for (const e of plan.errors) console.error(`Erro: ${e}`);
    process.exit(1);
  }
  console.log(`Projeto Supabase : ${plan.supabaseHost || "(não definido)"}\nRemetente        : ${plan.from}\nDestinatário     : ${plan.to}\nAssunto          : ${TEST_SUBJECT}\nModo             : ${plan.mode}\n`);

  if (plan.mode === "simulate") {
    console.log("Simulação: configuração válida, NADA foi enviado. Para enviar UM e-mail de teste, acrescente:");
    console.log(`  --execute --project-host ${plan.supabaseHost || "<host do projeto de desenvolvimento>"}`);
    return;
  }

  const send = await loadSendEmail();
  const result = await sendTestEmail(plan, send);
  if (!result.ok) {
    console.error(`Falhou (${result.reason}): ${result.hint}`);
    process.exit(2);
  }
  console.log("Aceito pelo Resend: 1 e-mail enviado. Confira a caixa de entrada, o spam e o painel do Resend (Emails).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Erro inesperado ao enviar o e-mail de teste.");
    process.exit(1);
  });
}
