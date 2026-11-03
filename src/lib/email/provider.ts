import "server-only";
import { getEmailProviderConfig } from "@/lib/env";

/**
 * Envio de e-mail (links de aprovação e códigos de verificação).
 *
 * Provedores (EMAIL_PROVIDER):
 *  - `resend`: envio real pela API HTTP do Resend (RESEND_API_KEY + EMAIL_FROM).
 *  - `simulated`: NÃO envia nada; guarda a mensagem só na memória do servidor, para desenvolvimento e
 *    testes. É recusado em produção (getEmailProviderConfig devolve "none").
 *  - sem configuração: devolve `not_configured`; nada é fingido.
 *
 * Regras: o corpo da mensagem (que contém link ou código) NUNCA vai para log; só o tipo e o resultado.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

export type SendResult =
  | { ok: true; provider: "simulated" | "resend" }
  | { ok: false; reason: "not_configured" | "failed" };

interface Outbox {
  messages: Array<OutboundEmail & { at: string }>;
}

const OUTBOX = Symbol.for("aprova-luvi.email.outbox");
const MAX_MESSAGES = 50;

function outbox(): Outbox {
  const store = globalThis as unknown as Record<symbol, Outbox | undefined>;
  return (store[OUTBOX] ??= { messages: [] });
}

export async function sendEmail(message: OutboundEmail, env: NodeJS.ProcessEnv = process.env): Promise<SendResult> {
  const config = getEmailProviderConfig(env);
  if (config.kind === "none") return { ok: false, reason: "not_configured" };

  if (config.kind === "simulated") {
    const box = outbox();
    box.messages.push({ ...message, at: new Date().toISOString() });
    if (box.messages.length > MAX_MESSAGES) box.messages.splice(0, box.messages.length - MAX_MESSAGES);
    return { ok: true, provider: "simulated" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { ok: true, provider: "resend" } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Caixa de saída simulada (só existe em desenvolvimento/testes). `null` se o provedor não é o simulado. */
export function readSimulatedOutbox(env: NodeJS.ProcessEnv = process.env): Array<OutboundEmail & { at: string }> | null {
  if (getEmailProviderConfig(env).kind !== "simulated") return null;
  return [...outbox().messages];
}

/** Só para testes. */
export function clearSimulatedOutbox(): void {
  outbox().messages.length = 0;
}
