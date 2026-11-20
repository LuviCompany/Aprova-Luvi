import "server-only";
import { z } from "zod";
import { DataLoadError } from "@/lib/clients/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Equipe da Luvi (admin, designer e atendimento) da PRÓPRIA organização, para a tela Usuários (somente leitura).
 * Sempre com o cliente Supabase do usuário, sob a RLS (`profiles_select_staff`): nada usa a chave secreta.
 * Aprovadores de clientes (papel `cliente`) nunca entram aqui. O filtro por organização é redundante com a RLS
 * de propósito (defesa em duas camadas). "Último acesso" não é lido: vive em auth.users, fora do alcance do usuário.
 */

export const TEAM_ROLES = ["admin", "designer", "atendimento"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_USERS_SELECT = "id, full_name, email, role, active, created_at";
export const TEAM_USERS_LIMIT = 200;

export interface TeamUserItem {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  active: boolean;
  /** Data de cadastro (profiles.created_at). */
  createdAt: string;
}

const rowSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  email: z.string(),
  role: z.enum(TEAM_ROLES),
  active: z.boolean(),
  created_at: z.string(),
});

const ROLE_ORDER: Record<TeamRole, number> = { admin: 0, designer: 1, atendimento: 2 };

export async function listTeamUsers(organizationId: string): Promise<TeamUserItem[]> {
  if (!z.uuid().safeParse(organizationId).success) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(TEAM_USERS_SELECT)
    .eq("organization_id", organizationId)
    .in("role", [...TEAM_ROLES])
    .order("full_name")
    .limit(TEAM_USERS_LIMIT);
  if (error) throw new DataLoadError("os usuários", error.message);
  const parsed = z.array(rowSchema).safeParse(data);
  if (!parsed.success) throw new DataLoadError("os usuários", "resposta inesperada");

  return parsed.data
    .map((row) => ({ id: row.id, name: row.full_name, email: row.email, role: row.role, active: row.active, createdAt: row.created_at }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name, "pt-BR"));
}
