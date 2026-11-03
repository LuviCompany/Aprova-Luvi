import { createHash, randomBytes } from "node:crypto";
import { getSiteUrl } from "@/lib/env";

/**
 * Token do link de aprovação: 32 bytes aleatórios (256 bits) em base64url. O banco guarda só o
 * SHA-256 (hex) dele; o token em si existe apenas na URL enviada ao aprovador e nunca é registrado.
 */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const LINK_VALIDITY_DAYS = 7;

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isPlausibleToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** Endereço completo do link, ou `null` se o APP_URL deste ambiente não for válido. */
export function approvalLinkUrl(token: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const site = getSiteUrl(env);
  return site ? `${site}/aprovar/${token}` : null;
}
