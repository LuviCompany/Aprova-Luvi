import { createHmac, randomBytes, randomInt } from "node:crypto";

/**
 * Primitivas do fluxo de aprovação por link. Tudo que vai para o banco é HMAC-SHA256 com o segredo do
 * servidor (APPROVAL_LINK_SECRET): mesmo com o banco vazado, um código de 6 dígitos não pode ser
 * descoberto por força bruta offline, e um identificador de sessão não pode ser forjado.
 * Nada daqui é registrado em log.
 */

const hmac = (secret: string, label: string, value: string) =>
  createHmac("sha256", secret).update(`${label}:${value}`, "utf8").digest("hex");

/** Código de 6 dígitos, gerado com fonte criptográfica. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Identificador de sessão do link (vai no cookie; o banco guarda só o HMAC). */
export function generateSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/** O código é amarrado ao link: o mesmo código em outro link gera outro hash. */
export function codeHash(secret: string, tokenHash: string, code: string): string {
  return hmac(secret, "code", `${tokenHash}:${code}`);
}

export function sessionHash(secret: string, sessionId: string): string {
  return hmac(secret, "session", sessionId);
}

/** IP guardado só como HMAC (auditoria sem dado pessoal em claro). */
export function ipHash(secret: string, ip: string): string {
  return hmac(secret, "ip", ip);
}

export const CODE_PATTERN = /^\d{6}$/;
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
