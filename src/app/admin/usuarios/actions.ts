"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdmin } from "@/lib/auth/action-guard";
import { inviteTeamMember, resendTeamInvite } from "@/lib/invites/team";
import { parseTeamInvite, type TeamInviteFieldErrors } from "@/lib/users/schema";

export interface TeamInviteState {
  ok?: boolean;
  error?: string;
  fieldErrors?: TeamInviteFieldErrors;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");
const isUuid = (value: unknown): value is string => typeof value === "string" && z.uuid().safeParse(value).success;

/**
 * Convida um membro da equipe (Administrador, Designer ou Atendimento). SÓ administrador ativo: a sessão é conferida de novo no
 * servidor a cada chamada (authorizeAdmin) e o banco confere outra vez (public.add_team_member). A organização vem da sessão
 * do administrador, nunca do formulário. O link do convite vai só no e-mail: não volta à tela nem vai para log.
 */
export async function inviteTeamMemberAction(_prev: TeamInviteState, formData: FormData): Promise<TeamInviteState> {
  const guard = await authorizeAdmin();
  if (!guard.ok) return { error: guard.error };

  const parsed = parseTeamInvite({
    name: text(formData, "name"),
    email: text(formData, "email"),
    emailConfirm: text(formData, "emailConfirm"),
    role: text(formData, "role"),
  });
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors };

  let result;
  try {
    result = await inviteTeamMember({ supabase: guard.supabase, invite: parsed.data });
  } catch {
    return { error: "Não foi possível enviar o convite agora. Tente novamente. Nada foi alterado." };
  }
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/usuarios");
  return { ok: true };
}

/** Reenvia o convite de quem ainda não aceitou (no máximo 1 por minuto). Só administrador ativo. */
export async function resendTeamInviteAction(userId: string): Promise<{ ok?: boolean; error?: string }> {
  const guard = await authorizeAdmin();
  if (!guard.ok) return { error: guard.error };
  if (!isUuid(userId)) return { error: "Usuário inválido." };

  let result;
  try {
    result = await resendTeamInvite({ supabase: guard.supabase, userId });
  } catch {
    return { error: "Não foi possível reenviar o convite agora. Tente novamente." };
  }
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/usuarios");
  return { ok: true };
}
