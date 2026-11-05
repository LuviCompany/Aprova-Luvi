"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { messageForApprovalError } from "@/lib/approval/errors";
import { dueDateToTimestamp, submitSchema } from "@/lib/approval/schema";
import { LINK_VALIDITY_DAYS, approvalLinkUrl, generateToken, hashToken } from "@/lib/approval/token";
import { authorizeStaff } from "@/lib/auth/action-guard";
import { sendEmail } from "@/lib/email/provider";
import { approvalLinkEmail } from "@/lib/email/templates";

export interface ApprovalActionResult {
  ok?: boolean;
  error?: string;
  /** Link recém-criado: aparece UMA vez, só para a equipe copiar. Nunca é registrado nem guardado. */
  link?: { url: string | null; emailSent: boolean };
}

function refresh() {
  revalidatePath("/admin/materiais");
  revalidatePath("/admin/materiais/[id]", "page");
  revalidatePath("/admin");
  revalidatePath("/admin/historico");
}

/**
 * Envia a versão para aprovação: uma solicitação individual por aprovador, todas numa só rodada, criadas
 * de uma vez pela função `submit_for_approval` (tudo ou nada). O conteúdo apresentado é congelado no envio.
 */
export async function submitForApprovalAction(input: unknown): Promise<ApprovalActionResult> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { error: guard.error };

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { versionId, approverIds, dueDate, message } = parsed.data;

  const { error } = await guard.supabase.rpc("submit_for_approval", {
    p_version_id: versionId,
    p_approver_ids: approverIds,
    p_due_at: dueDate ? dueDateToTimestamp(dueDate) : null,
    p_message: message,
  });
  if (error) return { error: messageForApprovalError(error) };

  refresh();
  return { ok: true };
}

/** Cancela o envio inteiro (todas as solicitações abertas da rodada) e devolve o material a rascunho. */
export async function cancelSubmissionAction(requestId: string): Promise<ApprovalActionResult> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { error: guard.error };
  if (!z.uuid().safeParse(requestId).success) return { error: "Solicitação inválida." };

  const { error } = await guard.supabase.rpc("cancel_approval_request", { p_request_id: requestId });
  if (error) return { error: messageForApprovalError(error) };

  refresh();
  return { ok: true };
}

/**
 * Cria o link rápido de UM aprovador (reemitir revoga o anterior) e tenta enviá-lo por e-mail. O banco guarda
 * só o hash do token; o endereço completo volta à tela uma única vez.
 */
export async function createApprovalLinkAction(requestId: string, approverId: string): Promise<ApprovalActionResult> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { error: guard.error };
  if (!z.uuid().safeParse(requestId).success || !z.uuid().safeParse(approverId).success) return { error: "Solicitação inválida." };

  const found = await guard.supabase
    .from("approval_requests")
    .select("id, approver_id, status, approvers(name, email)")
    .eq("id", requestId)
    .maybeSingle();
  if (found.error) return { error: messageForApprovalError(found.error) };
  if (!found.data) return { error: "Solicitação não encontrada." };
  const approver = Array.isArray(found.data.approvers) ? found.data.approvers[0] : found.data.approvers;

  const token = generateToken();
  const expiresAt = new Date(Date.now() + LINK_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await guard.supabase.rpc("create_approval_link", {
    p_request_id: requestId,
    p_approver_id: approverId,
    p_token_hash: hashToken(token),
    p_expires_at: expiresAt,
  });
  if (error) return { error: messageForApprovalError(error) };

  const url = approvalLinkUrl(token);
  let emailSent = false;
  if (url && approver?.email) {
    const result = await sendEmail({
      to: approver.email,
      ...approvalLinkEmail({ name: approver.name, url, validityDays: LINK_VALIDITY_DAYS }),
    });
    emailSent = result.ok;
  }

  refresh();
  return { ok: true, link: { url, emailSent } };
}

export async function revokeApprovalLinkAction(linkId: string): Promise<ApprovalActionResult> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { error: guard.error };
  if (!z.uuid().safeParse(linkId).success) return { error: "Link inválido." };

  const { error } = await guard.supabase.rpc("revoke_approval_link", { p_link_id: linkId });
  if (error) return { error: messageForApprovalError(error) };

  refresh();
  return { ok: true };
}
