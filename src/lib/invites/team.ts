import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { teamInviteEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/provider";
import { getEmailProviderConfig, getSiteUrl } from "@/lib/env";
import { emailFailureMessage, INVITE_VALIDITY_HOURS } from "@/lib/invites/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isInvitableRole, type TeamInviteData } from "@/lib/users/schema";

/**
 * Convite de membros da EQUIPE (Administrador, Designer, Atendimento) PELO APP. Junto com o convite de aprovadores e o
 * fluxo do link, é um dos únicos lugares que usam a chave secreta, e só para o que só ela faz: criar e apagar o usuário
 * no Auth e gerar o link. O PERFIL não é criado com a chave secreta: entra por `public.add_team_member`, chamada com a
 * SESSÃO DO ADMINISTRADOR (`supabase`, o cliente do usuário), e o banco confere de novo quem chama, a organização, o papel
 * e se o id e o e-mail são do mesmo usuário do Auth. Assim a auditoria registra QUEM convidou.
 *
 * Quem chama (Server Action) já autorizou um administrador ativo (authorizeAdmin). Aqui:
 *  - envio: e-mail único (perfil e Auth), cria o usuário SEM senha, cria o perfil pelo banco, manda o e-mail com o link para
 *    a pessoa CRIAR A PRÓPRIA SENHA. Se qualquer passo falhar, desfaz tudo (sem conta ou perfil órfãos);
 *  - reenvio: só para quem ainda não aceitou (sem e-mail confirmado e sem login), no máximo 1 por minuto (o banco reserva);
 *  - o link só vai no e-mail: nunca é devolvido à tela, guardado, auditado nem registrado em log. Nenhuma senha passa por aqui.
 */

export type TeamInviteResult = { ok: true; mode: "sent" | "resent" } | { ok: false; error: string };

const fail = (error: string): TeamInviteResult => ({ ok: false, error });
const GENERIC = "Não foi possível enviar o convite agora. Tente novamente. Nada foi alterado.";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

function readyToSend(): { site: string } | { error: string } {
  const email = getEmailProviderConfig();
  if (email.kind === "none") return { error: "O envio de e-mail não está configurado neste ambiente. Configure o provedor antes de enviar convites." };
  const site = getSiteUrl();
  if (!site) return { error: "APP_URL não está configurada: o link do convite não pode ser montado." };
  return { site };
}

function messageForRpcError(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case "42501":
      return "Só administradores ativos podem convidar pessoas da equipe.";
    case "23505":
      return "Já existe um usuário com este e-mail.";
    case "22023":
      return "Não foi possível validar os dados do convite. Confira nome, e-mail e papel e tente novamente.";
    default:
      return GENERIC;
  }
}

/** Desfaz um convite que não chegou ao fim: perfil (se criado) e usuário do Auth. Melhor esforço, em ordem segura. */
async function undo(admin: AdminClient, userId: string, profileCreated: boolean) {
  if (profileCreated) await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
}

export async function inviteTeamMember(input: { supabase: SupabaseClient; invite: TeamInviteData }): Promise<TeamInviteResult> {
  const { supabase, invite } = input;
  // Defesa em profundidade: nem uma chamada interna indevida cria cliente ou papel inexistente.
  if (!isInvitableRole(invite.role)) return fail("Escolha um papel válido.");

  // Falha cedo, ANTES de criar qualquer coisa: sem e-mail configurado não há como entregar o convite.
  const ready = readyToSend();
  if ("error" in ready) return fail(ready.error);
  const { site } = ready;

  const admin = createSupabaseAdminClient();

  // E-mail único: perfil existente (de qualquer papel, inclusive aprovador) é recusado antes de tocar no Auth.
  const existing = await admin.from("profiles").select("id").eq("email", invite.email).maybeSingle();
  if (existing.error) return fail(GENERIC);
  if (existing.data) return fail("Já existe um usuário com este e-mail.");

  // Cria o usuário no Auth SEM senha e SEM enviar e-mail: o link só sai no e-mail abaixo. Conta já ativada é recusada pelo Auth.
  const generated = await admin.auth.admin.generateLink({
    type: "invite",
    email: invite.email,
    options: { redirectTo: `${site}/auth/invite`, data: { full_name: invite.name } },
  });
  if (generated.error || !generated.data?.user || !generated.data.properties?.hashed_token) {
    const taken = generated.error && /already|registered|exists/i.test(generated.error.message ?? "");
    return fail(taken ? "Este e-mail já tem uma conta ativa. Use outro endereço." : GENERIC);
  }
  const userId = generated.data.user.id;
  const url = `${site}/auth/invite?token_hash=${encodeURIComponent(generated.data.properties.hashed_token)}&type=invite`;

  // O banco decide: administrador ativo, mesma organização, papel permitido, id e e-mail do mesmo usuário do Auth.
  const added = await supabase.rpc("add_team_member", {
    p_user_id: userId,
    p_full_name: invite.name,
    p_email: invite.email,
    p_role: invite.role,
  });
  if (added.error) {
    await undo(admin, userId, false);
    return fail(messageForRpcError(added.error));
  }

  const sent = await sendEmail({
    to: invite.email,
    ...teamInviteEmail({ name: invite.name, roleLabel: ROLE_LABEL[invite.role], url, validityHours: INVITE_VALIDITY_HOURS }),
    idempotencyKey: `team-invite-${userId}`,
  });
  if (!sent.ok) {
    await undo(admin, userId, true);
    return fail(emailFailureMessage(sent.reason));
  }
  return { ok: true, mode: "sent" };
}

/** Reenvia o convite a quem AINDA NÃO ACEITOU, no máximo 1 por minuto por pessoa. */
export async function resendTeamInvite(input: { supabase: SupabaseClient; userId: string }): Promise<TeamInviteResult> {
  const { supabase, userId } = input;
  const ready = readyToSend();
  if ("error" in ready) return fail(ready.error);
  const { site } = ready;

  // A RLS do administrador decide se a pessoa existe e é da equipe da MESMA organização.
  const profile = await supabase.from("profiles").select("id, role").eq("id", userId).maybeSingle();
  if (profile.error) return fail(GENERIC);
  if (!profile.data || !isInvitableRole(profile.data.role)) return fail("Usuário não encontrado.");

  // Só enquanto a conta não foi ativada: depois de aceitar, a pessoa usa "Esqueci minha senha".
  const admin = createSupabaseAdminClient();
  const account = await admin.auth.admin.getUserById(userId);
  if (account.error || !account.data?.user) return fail("Não foi possível conferir o acesso agora. Tente novamente.");
  if (account.data.user.email_confirmed_at || account.data.user.last_sign_in_at) {
    return fail("Esta pessoa já aceitou o convite. Se ela esqueceu a senha, peça para usar “Esqueci minha senha” na tela de entrada.");
  }

  // O banco confere administrador e organização, impõe o intervalo de 1 minuto e audita o reenvio.
  const reserved = await supabase.rpc("reserve_team_invite_resend", { p_user_id: userId });
  if (reserved.error) {
    if (/aguarde/i.test(reserved.error.message ?? "")) return fail("Aguarde um minuto antes de reenviar o convite.");
    if (reserved.error.code === "P0002") return fail("Usuário não encontrado.");
    return fail(messageForRpcError(reserved.error));
  }
  const row = (Array.isArray(reserved.data) ? reserved.data[0] : reserved.data) as { r_full_name?: string; r_email?: string; r_role?: string } | null;
  if (!row?.r_email || !row.r_full_name || !isInvitableRole(row.r_role)) return fail(GENERIC);

  const generated = await admin.auth.admin.generateLink({ type: "recovery", email: row.r_email, options: { redirectTo: `${site}/auth/recovery` } });
  if (generated.error || !generated.data?.properties?.hashed_token) return fail("Não foi possível gerar o novo link agora. Tente novamente em um minuto.");
  const url = `${site}/auth/recovery?token_hash=${encodeURIComponent(generated.data.properties.hashed_token)}&type=recovery`;

  const bucket = Math.floor(Date.now() / 60_000);
  const sent = await sendEmail({
    to: row.r_email,
    ...teamInviteEmail({ name: row.r_full_name, roleLabel: ROLE_LABEL[row.r_role], url, validityHours: INVITE_VALIDITY_HOURS, resend: true }),
    idempotencyKey: `team-invite-${userId}-${bucket}`,
  });
  if (!sent.ok) return fail(`${emailFailureMessage(sent.reason)} O próximo reenvio fica liberado em 1 minuto.`);
  return { ok: true, mode: "resent" };
}

/**
 * Quais dos usuários da equipe AINDA NÃO aceitaram o convite (sem e-mail confirmado e sem login). Só leitura no Auth, para
 * a tela Usuários mostrar "Convite pendente" e o botão de reenvio. Qualquer falha de consulta devolve "ninguém pendente":
 * a lista continua funcionando e o reenvio só ofereceria o que o servidor também revalida.
 */
export async function listPendingTeamInvites(userIds: string[]): Promise<Set<string>> {
  const pending = new Set<string>();
  if (userIds.length === 0) return pending;
  try {
    const admin = createSupabaseAdminClient();
    const results = await Promise.all(userIds.map((id) => admin.auth.admin.getUserById(id)));
    results.forEach((result, index) => {
      const user = result.data?.user;
      if (!result.error && user && !user.email_confirmed_at && !user.last_sign_in_at) pending.add(userIds[index]);
    });
  } catch {
    return new Set();
  }
  return pending;
}
