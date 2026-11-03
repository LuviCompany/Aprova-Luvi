"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeStaff } from "@/lib/auth/action-guard";
import { parseApproverInput } from "@/lib/approvers/schema";
import { messageForDbError } from "@/lib/clients/errors";
import type { FieldErrors } from "@/lib/clients/schema";

export interface ApproverFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");
const isUuid = (value: unknown): value is string => typeof value === "string" && z.uuid().safeParse(value).success;

function refresh() {
  // Rota dinâmica: "page" invalida todas as páginas /admin/clientes/[id].
  revalidatePath("/admin/clientes/[id]", "page");
  revalidatePath("/admin/clientes");
}

/**
 * Cria (com `clientId`) ou edita (com `id`) um aprovador. Só admin e atendimento; a RLS confere de novo.
 * O e-mail não muda depois de criado: a edição só envia nome e cargo (o banco nem dá permissão de UPDATE na coluna).
 * `profile_id` (login) é do servidor e nunca sai deste formulário.
 */
export async function saveApproverAction(_prev: ApproverFormState, formData: FormData): Promise<ApproverFormState> {
  const guard = await authorizeStaff({ manageClients: true });
  if (!guard.ok) return { error: guard.error };
  const { supabase } = guard;

  const rawId = text(formData, "id");
  const rawClient = text(formData, "clientId");
  const id = rawId ? (isUuid(rawId) ? rawId : null) : undefined;
  if (id === null) return { error: "Aprovador inválido." };
  if (id === undefined && !isUuid(rawClient)) return { error: "Cliente inválido." };

  const parsed = parseApproverInput(
    { name: text(formData, "name"), email: text(formData, "email"), jobTitle: text(formData, "jobTitle") },
    { requireEmail: id === undefined },
  );
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors };
  const { name, email, jobTitle } = parsed.data;

  if (id === undefined) {
    // O gatilho do banco também recusa; a checagem prévia dá a mensagem no lugar certo.
    const client = await supabase.from("clients").select("id, active").eq("id", rawClient).maybeSingle();
    if (client.error) return { error: messageForDbError(client.error, "aprovador") };
    if (!client.data) return { error: "Cliente não encontrado." };
    if (!client.data.active) return { error: "Este cliente está arquivado. Reative-o antes de cadastrar aprovadores." };

    const { error } = await supabase
      .from("approvers")
      .insert({ client_id: rawClient, name, email, job_title: jobTitle, active: true });
    if (error) {
      return error.code === "23505"
        ? { fieldErrors: { email: messageForDbError(error, "aprovador") } }
        : { error: messageForDbError(error, "aprovador") };
    }
  } else {
    const { data, error } = await supabase
      .from("approvers")
      .update({ name, job_title: jobTitle })
      .eq("id", id)
      .select("id");
    if (error) return { error: messageForDbError(error, "aprovador") };
    if (!data || data.length === 0) return { error: "Aprovador não encontrado." };
  }

  refresh();
  return { ok: true };
}

/** Ativa ou desativa o aprovador NESTE cliente. Desativar revoga os links pendentes e cancela convites abertos (no banco). */
export async function setApproverActiveAction(approverId: string, active: boolean): Promise<ApproverFormState> {
  const guard = await authorizeStaff({ manageClients: true });
  if (!guard.ok) return { error: guard.error };
  if (!isUuid(approverId) || typeof active !== "boolean") return { error: "Aprovador inválido." };

  const { data, error } = await guard.supabase.from("approvers").update({ active }).eq("id", approverId).select("id");
  if (error) return { error: messageForDbError(error, "aprovador") };
  if (!data || data.length === 0) return { error: "Aprovador não encontrado." };

  refresh();
  return { ok: true };
}

/** Vincula uma pessoa já cadastrada (de outro cliente) a este cliente. A cópia, com o login, é feita por função do banco. */
export async function linkApproverAction(sourceApproverId: string, clientId: string): Promise<ApproverFormState> {
  const guard = await authorizeStaff({ manageClients: true });
  if (!guard.ok) return { error: guard.error };
  if (!isUuid(sourceApproverId) || !isUuid(clientId)) return { error: "Dados inválidos." };

  const { error } = await guard.supabase.rpc("link_approver_to_client", {
    p_source_approver_id: sourceApproverId,
    p_client_id: clientId,
  });
  if (error) return { error: messageForDbError(error, "vinculo") };

  refresh();
  return { ok: true };
}

/** Registra a intenção de convidar o aprovador para o portal. NÃO envia e-mail e NÃO emite token. */
export async function prepareInviteAction(approverId: string): Promise<ApproverFormState> {
  const guard = await authorizeStaff({ manageClients: true });
  if (!guard.ok) return { error: guard.error };
  if (!isUuid(approverId)) return { error: "Aprovador inválido." };

  const { error } = await guard.supabase.rpc("prepare_approver_invite", { p_approver_id: approverId });
  if (error) return { error: messageForDbError(error, "convite") };

  refresh();
  return { ok: true };
}

/** Cancela um convite ainda aberto. */
export async function cancelInviteAction(inviteId: string): Promise<ApproverFormState> {
  const guard = await authorizeStaff({ manageClients: true });
  if (!guard.ok) return { error: guard.error };
  if (!isUuid(inviteId)) return { error: "Convite inválido." };

  const { error } = await guard.supabase.rpc("revoke_approver_invite", { p_invite_id: inviteId });
  if (error) return { error: messageForDbError(error, "convite") };

  refresh();
  return { ok: true };
}
