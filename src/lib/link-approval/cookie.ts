import "server-only";
import { cookies, headers } from "next/headers";
import { hashToken, isPlausibleToken } from "@/lib/approval/token";
import { isProductionEnv } from "@/lib/env";

/**
 * Cookie da sessão do link: um por link (o nome leva o início do hash do token), httpOnly, restrito a /aprovar
 * e curto (30 min, igual à sessão no banco). O valor é um identificador aleatório; o banco só guarda o HMAC dele.
 */
export const SESSION_MAX_AGE = 30 * 60;

const nameFor = (token: string) => `aprova_lnk_${hashToken(token).slice(0, 16)}`;

export async function readSessionId(token: string): Promise<string | undefined> {
  if (!isPlausibleToken(token)) return undefined;
  return (await cookies()).get(nameFor(token))?.value;
}

export async function writeSessionId(token: string, sessionId: string): Promise<void> {
  (await cookies()).set(nameFor(token), sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProductionEnv(),
    path: "/aprovar",
    maxAge: SESSION_MAX_AGE,
  });
}

/** IP do cliente (primeiro endereço de x-forwarded-for) e user-agent, para auditoria e limites. */
export async function requestFingerprint(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "desconhecido";
  return { ip, userAgent: h.get("user-agent") ?? "" };
}
