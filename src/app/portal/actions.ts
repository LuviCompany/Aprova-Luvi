"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MESSAGES } from "@/lib/auth/errors";
import { listPortalLinks } from "@/lib/auth/portal-context";
import { PORTAL_CLIENT_COOKIE } from "@/lib/auth/portal-cookie";
import { getSessionState } from "@/lib/auth/session";
import { DENIED } from "@/lib/clients/errors";
import { isDemoMode, isProductionEnv, isSupabaseConfigured } from "@/lib/env";

export interface CompanyState {
  ok?: boolean;
  error?: string;
}

const MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

/**
 * Escolhe a empresa do portal para a sessão. A escolha é VALIDADA NO SERVIDOR contra os vínculos
 * ativos do usuário, lidos pela RLS: um clientId que não seja dele é recusado e nada é gravado.
 * O cookie guarda só a preferência; a cada requisição o servidor revalida.
 */
export async function selectCompanyAction(clientId: string): Promise<CompanyState> {
  if (isDemoMode()) return { ok: true }; // a demonstração tem uma única empresa
  if (!isSupabaseConfigured()) return { error: MESSAGES.notConfigured };

  const state = await getSessionState();
  if (state.kind === "unavailable") return { error: MESSAGES.network };
  if (state.kind !== "ok") return { error: "Sua sessão expirou. Entre novamente." };
  if (state.user.role !== "cliente") return { error: DENIED };
  if (typeof clientId !== "string" || !z.uuid().safeParse(clientId).success) return { error: "Empresa inválida." };

  let links;
  try {
    links = await listPortalLinks(state.user);
  } catch {
    return { error: MESSAGES.network };
  }
  if (!links.some((link) => link.clientId === clientId)) return { error: "Você não tem acesso a esta empresa." };

  (await cookies()).set(PORTAL_CLIENT_COOKIE, clientId, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProductionEnv(),
    path: "/portal",
    maxAge: MAX_AGE,
  });
  revalidatePath("/portal", "layout");
  return { ok: true };
}
