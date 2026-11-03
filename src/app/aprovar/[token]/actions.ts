"use server";

import { revalidatePath } from "next/cache";
import { decisionInputSchema } from "@/lib/approval/schema";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { readSessionId, requestFingerprint, writeSessionId } from "@/lib/link-approval/cookie";
import { decideViaLink, issueCode, verifyCode } from "@/lib/link-approval/service";

export interface LinkActionResult {
  ok?: boolean;
  error?: string;
}

const UNAVAILABLE = "A aprovação por link não está disponível neste ambiente.";
const available = () => !isDemoMode() && isSupabaseConfigured();

const PROBLEM: Record<string, string> = {
  invalid: "Link inválido.",
  revoked: "Este link foi cancelado pela equipe da Luvi.",
  expired: "O prazo deste link terminou. Peça um novo link à equipe da Luvi.",
  used: "Este link já foi utilizado.",
  closed: "Este material não está mais aguardando a sua resposta.",
};

/** Envia o código de verificação para o e-mail do aprovador deste link. */
export async function requestCodeAction(token: string): Promise<LinkActionResult> {
  if (!available()) return { error: UNAVAILABLE };
  const { ip } = await requestFingerprint();
  let result;
  try {
    result = await issueCode(token, ip);
  } catch {
    return { error: "Não foi possível enviar o código agora. Tente novamente em instantes." };
  }
  switch (result.status) {
    case "sent":
      return { ok: true };
    case "cooldown":
      return { error: "Aguarde um minuto antes de pedir outro código." };
    case "limit":
      return { error: "Muitos códigos pedidos. Tente novamente mais tarde." };
    case "email_unavailable":
      return { error: "O envio de e-mail não está configurado. Fale com a equipe da Luvi." };
    case "email_failed":
      return { error: "Não foi possível enviar o e-mail agora. Tente novamente em instantes." };
    default:
      return { error: PROBLEM[result.status] ?? "Link indisponível." };
  }
}

/** Confere o código digitado; se estiver certo, abre a sessão do link (cookie httpOnly de 30 min). */
export async function verifyCodeAction(token: string, code: string): Promise<LinkActionResult> {
  if (!available()) return { error: UNAVAILABLE };
  const { ip } = await requestFingerprint();
  let result;
  try {
    result = await verifyCode(token, String(code ?? "").trim(), ip);
  } catch {
    return { error: "Não foi possível conferir o código agora. Tente novamente." };
  }
  switch (result.status) {
    case "ok":
      await writeSessionId(token, result.sessionId);
      revalidatePath("/aprovar/[token]", "page");
      return { ok: true };
    case "invalid_code":
      return { error: `Código incorreto. Restam ${result.remaining} tentativa${result.remaining === 1 ? "" : "s"}.` };
    case "locked":
      return { error: "Muitas tentativas erradas com este código. Peça um novo código." };
    case "no_code":
      return { error: "Este código expirou ou não foi pedido. Peça um novo código." };
    case "bad_format":
      return { error: "O código tem 6 números." };
    case "limit":
      return { error: "Muitas tentativas. Aguarde alguns minutos." };
    default:
      return { error: PROBLEM[result.status] ?? "Link indisponível." };
  }
}

/** Decisão do aprovador pelo link (exige a sessão verificada; o banco revalida tudo). */
export async function linkDecideAction(token: string, decision: "aprovado" | "alteracao", note: string): Promise<LinkActionResult> {
  if (!available()) return { error: UNAVAILABLE };
  const parsed = decisionInputSchema.safeParse({ decision, note });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const { ip, userAgent } = await requestFingerprint();
  let result;
  try {
    result = await decideViaLink(token, await readSessionId(token), parsed.data.decision, parsed.data.note, ip, userAgent);
  } catch {
    return { error: "Não foi possível registrar a decisão agora. Tente novamente." };
  }
  if (!result.ok) return { error: result.error };
  revalidatePath("/aprovar/[token]", "page");
  revalidatePath("/admin/materiais/[id]", "page");
  revalidatePath("/admin");
  return { ok: true };
}
