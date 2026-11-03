"use server";

import { revalidatePath } from "next/cache";
import { messageForApprovalError } from "@/lib/approval/errors";
import { commentSchema, decisionSchema } from "@/lib/approval/schema";
import { authorizePortal } from "@/lib/auth/portal-guard";

export interface ReviewActionResult {
  ok?: boolean;
  error?: string;
}

function refresh() {
  revalidatePath("/portal", "layout");
}

/**
 * Decisão do aprovador logado. O banco confere de novo tudo (a solicitação é DELE, está aberta, é a versão
 * mais recente, o cliente está ativo) e serializa decisões concorrentes; aqui só se valida a entrada.
 */
export async function decideAction(requestId: string, decision: "aprovado" | "alteracao", note: string): Promise<ReviewActionResult> {
  const guard = await authorizePortal();
  if (!guard.ok) return { error: guard.error };

  const parsed = decisionSchema.safeParse({ requestId, decision, note });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const { error } = await guard.supabase.rpc("decide_as_approver", {
    p_request_id: parsed.data.requestId,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note,
  });
  if (error) return { error: messageForApprovalError(error) };

  refresh();
  return { ok: true };
}

/** Comentário do aprovador (geral ou por slide) numa versão já enviada. O nome do autor vem do cadastro. */
export async function addCommentAction(
  materialId: string,
  versionId: string,
  slide: number | null,
  body: string,
): Promise<ReviewActionResult> {
  const guard = await authorizePortal();
  if (!guard.ok) return { error: guard.error };

  const parsed = commentSchema.safeParse({ materialId, versionId, slide, body });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const { error } = await guard.supabase.from("comments").insert({
    material_id: parsed.data.materialId,
    version_id: parsed.data.versionId,
    client_id: guard.context.clientId,
    slide: parsed.data.slide,
    author_role: "cliente",
    author_approver_id: guard.context.approverId,
    body: parsed.data.body,
  });
  if (error) return { error: messageForApprovalError(error) };

  refresh();
  return { ok: true };
}
