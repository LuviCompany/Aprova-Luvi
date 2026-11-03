import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MESSAGES } from "@/lib/auth/errors";
import { resolvePortalContext, type PortalLink } from "@/lib/auth/portal-context";
import { getSessionState, type SessionUser } from "@/lib/auth/session";
import { DENIED } from "@/lib/clients/errors";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PortalGuardResult =
  | { ok: true; user: SessionUser; supabase: SupabaseClient; context: PortalLink }
  | { ok: false; error: string };

/**
 * Autoriza uma Server Action do PORTAL no servidor: sessão de aprovador ativo, empresa escolhida
 * revalidada contra os vínculos lidos pela RLS. O cliente Supabase devolvido é o do usuário (RLS
 * continua sendo a segunda barreira). Nunca devolve o cliente de chave secreta.
 */
export async function authorizePortal(): Promise<PortalGuardResult> {
  if (isDemoMode()) return { ok: false, error: "Esta ação não está disponível na demonstração." };
  if (!isSupabaseConfigured()) return { ok: false, error: MESSAGES.notConfigured };

  const state = await getSessionState();
  if (state.kind === "unavailable") return { ok: false, error: MESSAGES.network };
  if (state.kind !== "ok") return { ok: false, error: "Sua sessão expirou. Entre novamente." };
  if (state.user.role !== "cliente") return { ok: false, error: DENIED };

  let resolution;
  try {
    resolution = await resolvePortalContext(state.user);
  } catch {
    return { ok: false, error: MESSAGES.network };
  }
  if (resolution.kind !== "ok") return { ok: false, error: "Escolha a empresa para continuar." };
  return { ok: true, user: state.user, supabase: await createSupabaseServerClient(), context: resolution.context };
}
