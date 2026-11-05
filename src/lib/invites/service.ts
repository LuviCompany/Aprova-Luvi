import "server-only";
import { inviteEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/provider";
import { getEmailProviderConfig, getSiteUrl } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Convite e ativação de aprovadores PELO APP (sem terminal). Junto com o fluxo do link, é um dos únicos lugares que
 * usam a chave secreta: criar um usuário no Auth e o perfil `cliente` só o servidor pode fazer.
 *
 * Quem chama (Server Action) já autorizou a equipe (admin/atendimento) e conferiu, sob a RLS do usuário, que o aprovador é
 * visível. Aqui o servidor revalida tudo no banco:
 *  - envio: aprovador ATIVO, de cliente ATIVO, SEM login e com convite PREPARADO; cria o usuário, o perfil `cliente`
 *    (e-mail do login = e-mail do aprovador, exigência do banco), liga o perfil, marca o convite como `enviado` e manda o
 *    e-mail com o link para o aprovador CRIAR A PRÓPRIA SENHA. Se o e-mail falhar, desfaz tudo (sem conta órfã);
 *  - reenvio: convite `enviado` e o aprovador ainda não ativou o acesso: novo link (recuperação), no máximo 1 por minuto;
 *  - aceite: quando o aprovador define a senha, o convite vira `aceito`.
 * O link só é impresso no e-mail: nunca é guardado, devolvido à tela nem registrado em log. Nenhuma senha passa por aqui.
 */

export const INVITE_VALIDITY_HOURS = 24;
const RESEND_COOLDOWN_MS = 60_000;

export type InviteResult = { ok: true; mode: "sent" | "resent" } | { ok: false; error: string };

const fail = (error: string): InviteResult => ({ ok: false, error });

export async function sendApproverInvite(approverId: string, now: number = Date.now()): Promise<InviteResult> {
  // Falha cedo, ANTES de criar qualquer coisa: sem e-mail configurado não há como entregar o convite.
  const email = getEmailProviderConfig();
  if (email.kind === "none") return fail("O envio de e-mail não está configurado neste ambiente. Configure o provedor antes de enviar convites.");
  const site = getSiteUrl();
  if (!site) return fail("APP_URL não está configurada: o link do convite não pode ser montado.");

  const admin = createSupabaseAdminClient();

  const approver = (
    await admin.from("approvers").select("id, client_id, name, email, active, profile_id").eq("id", approverId).maybeSingle()
  ).data;
  if (!approver) return fail("Aprovador não encontrado.");
  if (!approver.active) return fail("O aprovador está inativo.");
  const client = (await admin.from("clients").select("id, name, active, organization_id").eq("id", approver.client_id).maybeSingle()).data;
  if (!client?.active) return fail("O cliente está arquivado.");
  const invites = (await admin.from("approver_invites").select("id, status, sent_at").eq("approver_id", approver.id).in("status", ["preparado", "enviado"])).data ?? [];
  const invite = invites[0];
  if (!invite) return fail('Prepare o convite antes de enviar ("Preparar convite").');

  if (invite.status === "enviado") return resend(admin, approver, client, invite, site, now);
  if (approver.profile_id) return fail("Este aprovador já tem acesso ao portal.");

  const existingProfile = (await admin.from("profiles").select("id").eq("email", approver.email).maybeSingle()).data;
  if (existingProfile) return fail("Já existe um login com este e-mail. Use “Vincular pessoa existente”.");

  const generated = await admin.auth.admin.generateLink({
    type: "invite",
    email: approver.email,
    options: { redirectTo: `${site}/auth/invite`, data: { full_name: approver.name } },
  });
  if (generated.error || !generated.data?.user) return fail("Não foi possível gerar o convite agora. Tente novamente.");
  const userId = generated.data.user.id;
  const url = `${site}/auth/invite?token_hash=${encodeURIComponent(generated.data.properties.hashed_token)}&type=invite`;

  const undo = async (message: string): Promise<InviteResult> => {
    await admin.from("approver_invites").update({ status: "preparado", sent_at: null, expires_at: null }).eq("id", invite.id);
    await admin.from("approvers").update({ profile_id: null }).eq("id", approver.id);
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
    return fail(message);
  };

  const profile = await admin
    .from("profiles")
    .insert({ id: userId, organization_id: client.organization_id, full_name: approver.name, email: approver.email, role: "cliente" });
  if (profile.error) return undo("Não foi possível criar o acesso. Nada foi alterado.");
  const linked = await admin.from("approvers").update({ profile_id: userId }).eq("id", approver.id);
  if (linked.error) return undo("Não foi possível ligar o acesso ao aprovador. Nada foi alterado.");
  const marked = await admin
    .from("approver_invites")
    .update({ status: "enviado", sent_at: new Date(now).toISOString(), expires_at: new Date(now + INVITE_VALIDITY_HOURS * 3_600_000).toISOString() })
    .eq("id", invite.id);
  if (marked.error) return undo("Não foi possível registrar o convite. Nada foi alterado.");

  const sent = await sendEmail({
    to: approver.email,
    ...inviteEmail({ name: approver.name, clientName: client.name, url, validityHours: INVITE_VALIDITY_HOURS }),
    idempotencyKey: `invite-${invite.id}`,
  });
  if (!sent.ok) return undo(emailFailureMessage(sent.reason));
  return { ok: true, mode: "sent" };
}

async function resend(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  approver: { id: string; name: string; email: string; profile_id: string | null },
  client: { name: string },
  invite: { id: string; sent_at: string | null },
  site: string,
  now: number,
): Promise<InviteResult> {
  if (!approver.profile_id) return fail("Convite em estado inconsistente. Cancele-o e prepare outro.");
  if (invite.sent_at && now - Date.parse(invite.sent_at) < RESEND_COOLDOWN_MS) return fail("Aguarde um minuto antes de reenviar o convite.");

  const user = await admin.auth.admin.getUserById(approver.profile_id);
  if (user.error || !user.data?.user) return fail("Não foi possível conferir o acesso agora. Tente novamente.");
  if (user.data.user.last_sign_in_at) return fail("Este aprovador já abriu o convite. Se ele não conseguiu definir a senha, peça para usar “Esqueci a senha” na tela de entrada.");

  const generated = await admin.auth.admin.generateLink({ type: "recovery", email: approver.email, options: { redirectTo: `${site}/auth/recovery` } });
  if (generated.error || !generated.data?.properties) return fail("Não foi possível gerar o novo link agora. Tente novamente.");
  const url = `${site}/auth/recovery?token_hash=${encodeURIComponent(generated.data.properties.hashed_token)}&type=recovery`;

  const sentAt = new Date(now).toISOString();
  const marked = await admin
    .from("approver_invites")
    .update({ sent_at: sentAt, expires_at: new Date(now + INVITE_VALIDITY_HOURS * 3_600_000).toISOString() })
    .eq("id", invite.id);
  if (marked.error) return fail("Não foi possível registrar o reenvio. Tente novamente.");

  const sent = await sendEmail({
    to: approver.email,
    ...inviteEmail({ name: approver.name, clientName: client.name, url, validityHours: INVITE_VALIDITY_HOURS, resend: true }),
    idempotencyKey: `invite-${invite.id}-${sentAt}`,
  });
  if (!sent.ok) {
    // Devolve o relógio do reenvio: o aviso falhou, a equipe pode tentar de novo já.
    await admin.from("approver_invites").update({ sent_at: invite.sent_at }).eq("id", invite.id);
    return fail(emailFailureMessage(sent.reason));
  }
  return { ok: true, mode: "resent" };
}

function emailFailureMessage(reason: "not_configured" | "rate_limited" | "rejected" | "failed"): string {
  switch (reason) {
    case "not_configured":
      return "O envio de e-mail não está configurado neste ambiente.";
    case "rate_limited":
      return "O provedor de e-mail pediu para aguardar. Tente de novo em alguns minutos. Nada foi alterado.";
    case "rejected":
      return "O provedor de e-mail recusou a mensagem (confira o domínio e o remetente verificados). Nada foi alterado.";
    default:
      return "Não foi possível enviar o e-mail agora. Tente novamente. Nada foi alterado.";
  }
}

/** Chamado quando o aprovador cria a senha: o convite enviado vira `aceito`. Nunca quebra a troca de senha. */
export async function markInviteAccepted(userId: string): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const approvers = (await admin.from("approvers").select("id").eq("profile_id", userId)).data ?? [];
    if (approvers.length === 0) return;
    await admin
      .from("approver_invites")
      .update({ status: "aceito", accepted_at: new Date().toISOString() })
      .in("approver_id", approvers.map((a) => a.id))
      .eq("status", "enviado");
  } catch {
    /* melhor esforço: a senha já foi trocada */
  }
}
