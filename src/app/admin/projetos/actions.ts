"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeStaff } from "@/lib/auth/action-guard";
import { messageForDbError } from "@/lib/clients/errors";
import { parseProjectInput, type FieldErrors } from "@/lib/clients/schema";

export interface ProjectFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

function refresh() {
  revalidatePath("/admin/projetos");
  revalidatePath("/admin/clientes");
}

/**
 * Cria (sem `id`) ou edita (com `id`) um projeto. Qualquer equipe ativa pode; a RLS confere de novo.
 * O cliente de um projeto não muda depois de criado (a coluna nem tem permissão de UPDATE).
 */
export async function saveProjectAction(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { error: guard.error };
  const { supabase, user } = guard;

  const rawId = text(formData, "id");
  const id = rawId ? (z.uuid().safeParse(rawId).success ? rawId : null) : undefined;
  if (id === null) return { error: "Projeto inválido." };

  const parsed = parseProjectInput(
    {
      clientId: text(formData, "clientId"),
      name: text(formData, "name"),
      description: text(formData, "description"),
      status: text(formData, "status"),
      dueDate: text(formData, "dueDate"),
    },
    { requireClient: id === undefined },
  );
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors };
  const { clientId, name, description, status, dueDate } = parsed.data;

  if (id === undefined) {
    // A policy de projetos não olha `clients.active`: a regra "sem projeto novo em cliente arquivado" é daqui.
    const client = await supabase.from("clients").select("id, active").eq("id", clientId).maybeSingle();
    if (client.error) return { error: messageForDbError(client.error, "projeto") };
    if (!client.data) return { fieldErrors: { clientId: "Cliente não encontrado." } };
    if (!client.data.active) {
      return { fieldErrors: { clientId: "Este cliente está arquivado. Reative-o antes de criar projetos." } };
    }

    const { error } = await supabase.from("projects").insert({
      client_id: clientId,
      name,
      description,
      status,
      due_date: dueDate,
      created_by: user.id,
    });
    if (error) return { error: messageForDbError(error, "projeto") };
  } else {
    const { data, error } = await supabase
      .from("projects")
      .update({ name, description, status, due_date: dueDate })
      .eq("id", id)
      .select("id");
    if (error) return { error: messageForDbError(error, "projeto") };
    if (!data || data.length === 0) return { error: "Projeto não encontrado." };
  }

  refresh();
  return { ok: true };
}
