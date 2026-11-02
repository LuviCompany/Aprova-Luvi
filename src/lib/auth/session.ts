import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { classifyAuthError } from "@/lib/auth/errors";
import { homeForRole, isStaffRole, type AppRole } from "@/lib/auth/roles";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Data Access Layer de autenticação. TODA página, layout e ação protegida chama uma função
 * daqui: o proxy só filtra anônimos, a decisão de acesso é sempre refeita no servidor.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: AppRole;
  organizationId: string;
}

export type SessionState =
  | { kind: "anonymous" }
  | { kind: "unavailable" } // serviço de autenticação/banco inalcançável: não é o mesmo que "sem sessão"
  | { kind: "no-access" } // autenticado, mas sem perfil ativo
  | { kind: "ok"; user: SessionUser };

const profileSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  email: z.string(),
  role: z.enum(["admin", "designer", "atendimento", "cliente"]),
  organization_id: z.uuid(),
  active: z.boolean(),
});

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = [parts[0]?.[0], parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1]];
  return letters.filter(Boolean).join("").toUpperCase() || "?";
}

/** Usuários fictícios do modo demonstração (nunca existem com Supabase configurado). */
const DEMO_STAFF: SessionUser = {
  id: "demo-staff",
  email: "enzo@luvicompany.example",
  name: "Enzo",
  initials: "EN",
  role: "admin",
  organizationId: "demo-org",
};
const DEMO_CLIENT: SessionUser = {
  id: "demo-client",
  email: "marina@casaaurora.example",
  name: "Marina Prado",
  initials: "MP",
  role: "cliente",
  organizationId: "demo-org",
};

/**
 * Estado da sessão, validado no servidor de autenticação (getUser) e cruzado com o perfil.
 * Memoizado por requisição.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  if (!isSupabaseConfigured()) return { kind: "anonymous" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  // Falha de rede não prova que a sessão acabou: avisar "link expirou" a quem acabou de entrar é enganoso.
  if (error && classifyAuthError(error) === "network") return { kind: "unavailable" };
  if (error || !data.user) return { kind: "anonymous" };

  // A leitura passa pela RLS: o usuário só consegue ler o próprio perfil (ou o da organização, se equipe).
  const { data: row, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, organization_id, active")
    .eq("id", data.user.id)
    .maybeSingle();
  // Perfil negado pela RLS vem como linha vazia, sem erro; erro aqui é falha de consulta/rede.
  if (profileError) return { kind: "unavailable" };
  const parsed = profileSchema.safeParse(row);
  if (!parsed.success || !parsed.data.active) return { kind: "no-access" };

  const p = parsed.data;
  return {
    kind: "ok",
    user: {
      id: p.id,
      email: p.email,
      name: p.full_name,
      initials: initialsOf(p.full_name),
      role: p.role,
      organizationId: p.organization_id,
    },
  };
});

export async function getSessionUser(): Promise<SessionUser | null> {
  const state = await getSessionState();
  return state.kind === "ok" ? state.user : null;
}

async function requireUser(): Promise<SessionUser> {
  const state = await getSessionState();
  if (state.kind === "anonymous") redirect("/login");
  // Falha fechada: sem confirmar a identidade nada é exibido, e a tela de erro não finge um logout.
  if (state.kind === "unavailable") throw new Error("Serviço de autenticação indisponível. Tente novamente.");
  if (state.kind === "no-access") redirect("/login?erro=sem-acesso");
  return state.user;
}

/** Exige equipe da Luvi (admin, designer ou atendimento). */
export async function requireStaff(): Promise<SessionUser> {
  // Decisões de autenticação são sempre por requisição: sem isto o Next as pré-renderiza na
  // build e congela o modo (demo/real) e o redirecionamento do momento.
  await connection();
  if (isDemoMode()) return DEMO_STAFF;
  const user = await requireUser();
  if (!isStaffRole(user.role)) redirect(homeForRole(user.role));
  return user;
}

/** Exige aprovador de cliente. */
export async function requireClientUser(): Promise<SessionUser> {
  await connection();
  if (isDemoMode()) return DEMO_CLIENT;
  const user = await requireUser();
  if (user.role !== "cliente") redirect(homeForRole(user.role));
  return user;
}

/** Exige administrador (gestão de usuários, auditoria). */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireStaff();
  if (user.role !== "admin") redirect(homeForRole(user.role));
  return user;
}

/** Exige qualquer usuário autenticado e ativo (ex.: redefinição de senha). */
export async function requireAnyUser(): Promise<SessionUser> {
  await connection();
  return requireUser();
}
