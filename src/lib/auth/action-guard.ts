import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MESSAGES } from "@/lib/auth/errors";
import { canManageClients, isStaffRole } from "@/lib/auth/roles";
import { getSessionState, type SessionUser } from "@/lib/auth/session";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type GuardResult =
  | { ok: true; user: SessionUser; supabase: SupabaseClient }
  | { ok: false; error: string };

export const DENIED = "Você não tem permissão para esta ação.";

/**
 * Autoriza uma Server Action do painel NO SERVIDOR: a sessão é conferida de novo a cada chamada
 * (esconder um botão não é controle de acesso) e o cliente Supabase devolvido é o do usuário, ou
 * seja, a RLS continua valendo como segunda barreira. Nunca devolve o cliente de chave secreta.
 *
 * `manageClients` exige o papel que cadastra clientes (admin/atendimento).
 */
export async function authorizeStaff(options: { manageClients?: boolean } = {}): Promise<GuardResult> {
  if (isDemoMode()) return { ok: false, error: "Esta ação não está disponível na demonstração." };
  if (!isSupabaseConfigured()) return { ok: false, error: MESSAGES.notConfigured };

  const state = await getSessionState();
  if (state.kind === "unavailable") return { ok: false, error: MESSAGES.network };
  if (state.kind !== "ok") return { ok: false, error: "Sua sessão expirou. Entre novamente." };

  const { user } = state;
  if (!isStaffRole(user.role)) return { ok: false, error: DENIED };
  if (options.manageClients && !canManageClients(user.role)) return { ok: false, error: DENIED };

  return { ok: true, user, supabase: await createSupabaseServerClient() };
}
