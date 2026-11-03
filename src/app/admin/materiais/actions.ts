"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeStaff } from "@/lib/auth/action-guard";
import { messageForDbError } from "@/lib/clients/errors";
import type { FieldErrors } from "@/lib/clients/schema";
import { isContentLocked, parseMaterialInput } from "@/lib/materials/schema";
import type { MaterialStatus } from "@/lib/types";

export interface MaterialFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
}

export interface MaterialActionResult {
  ok?: boolean;
  error?: string;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

function refresh() {
  revalidatePath("/admin/materiais");
  revalidatePath("/admin/materiais/[id]", "page");
  revalidatePath("/admin/projetos");
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/clientes/[id]", "page");
}

/**
 * Cria (sem `id`) ou edita (com `id`) um material. Qualquer equipe ativa pode (designer inclusive);
 * a RLS e as travas do banco conferem de novo. Cliente, projeto e tipo não mudam depois de criado
 * (colunas sem permissão de UPDATE). Material fora de "rascunho" só aceita mudar as datas.
 *
 * Regra de projeto concluído: bloqueada AQUI (servidor). O banco ainda não a reforça; se mudar,
 * vira uma trava de banco numa migration futura (docs/MODULO-3.md, seção 12).
 */
export async function saveMaterialAction(_prev: MaterialFormState, formData: FormData): Promise<MaterialFormState> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { error: guard.error };
  const { supabase, user } = guard;

  const rawId = text(formData, "id");
  const id = rawId ? (z.uuid().safeParse(rawId).success ? rawId : null) : undefined;
  if (id === null) return { error: "Material inválido." };

  const parsed = parseMaterialInput(
    {
      clientId: text(formData, "clientId"),
      projectId: text(formData, "projectId"),
      type: text(formData, "type"),
      title: text(formData, "title"),
      description: text(formData, "description"),
      caption: text(formData, "caption"),
      aspectRatio: text(formData, "aspectRatio"),
      channel: text(formData, "channel"),
      publishDate: text(formData, "publishDate"),
      dueDate: text(formData, "dueDate"),
    },
    { mode: id === undefined ? "create" : "edit" },
  );
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors };
  const input = parsed.data;

  if (id === undefined) {
    const client = await supabase.from("clients").select("id, active").eq("id", input.clientId).maybeSingle();
    if (client.error) return { error: messageForDbError(client.error, "material") };
    if (!client.data) return { fieldErrors: { clientId: "Cliente não encontrado." } };
    if (!client.data.active) {
      return { fieldErrors: { clientId: "Este cliente está arquivado. Reative-o antes de criar materiais." } };
    }

    const project = await supabase.from("projects").select("id, client_id, status").eq("id", input.projectId).maybeSingle();
    if (project.error) return { error: messageForDbError(project.error, "material") };
    if (!project.data || project.data.client_id !== input.clientId) {
      return { fieldErrors: { projectId: "Projeto não encontrado neste cliente." } };
    }
    if (project.data.status === "concluido") {
      return { fieldErrors: { projectId: "Este projeto está concluído. Reabra-o antes de criar materiais." } };
    }

    const { error } = await supabase.from("materials").insert({
      client_id: input.clientId,
      project_id: input.projectId,
      title: input.title,
      description: input.description,
      caption: input.caption,
      type: input.type,
      aspect_ratio: input.aspectRatio,
      channel: input.channel,
      publish_date: input.publishDate,
      due_date: input.dueDate,
      created_by: user.id,
    });
    if (error) return { error: messageForDbError(error, "material") };
  } else {
    const current = await supabase
      .from("materials")
      .select("status, title, description, caption, channel, aspect_ratio")
      .eq("id", id)
      .maybeSingle();
    if (current.error) return { error: messageForDbError(current.error, "material") };
    if (!current.data) return { error: "Material não encontrado." };
    const row = current.data;

    const dates = { publish_date: input.publishDate, due_date: input.dueDate };
    let changes: Record<string, string | null> = dates;
    if (!isContentLocked(row.status as MaterialStatus)) {
      changes = {
        title: input.title,
        description: input.description,
        caption: input.caption,
        channel: input.channel,
        aspect_ratio: input.aspectRatio,
        ...dates,
      };
    } else if (
      row.title !== input.title ||
      row.description !== input.description ||
      row.caption !== input.caption ||
      row.channel !== input.channel ||
      (row.aspect_ratio ?? null) !== input.aspectRatio
    ) {
      return { error: messageForDbError({ message: "material já enviado para aprovação" }, "material") };
    }

    const { data, error } = await supabase.from("materials").update(changes).eq("id", id).select("id");
    if (error) return { error: messageForDbError(error, "material") };
    if (!data || data.length === 0) return { error: "Material não encontrado." };
  }

  refresh();
  return { ok: true };
}

/**
 * Exclui um rascunho VAZIO (sem versões). A RLS só deixa apagar rascunho não enviado e a chave
 * estrangeira impede apagar quem já tem versão; o gatilho de auditoria registra `material.deleted`.
 */
export async function deleteMaterialAction(materialId: string): Promise<MaterialActionResult> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { error: guard.error };
  const { supabase } = guard;

  if (!z.uuid().safeParse(materialId).success) return { error: "Material inválido." };

  const current = await supabase.from("materials").select("id, status").eq("id", materialId).maybeSingle();
  if (current.error) return { error: messageForDbError(current.error, "material") };
  if (!current.data) return { error: "Material não encontrado." };
  if (current.data.status !== "rascunho") {
    return { error: "Só rascunhos podem ser excluídos. Material enviado para aprovação fica no histórico." };
  }

  const { data, error } = await supabase.from("materials").delete().eq("id", materialId).select("id");
  if (error) {
    if (error.code === "23503") return { error: "Este material já tem versões e não pode ser excluído." };
    return { error: messageForDbError(error, "material") };
  }
  if (!data || data.length === 0) return { error: "Não foi possível excluir: só rascunhos vazios podem ser excluídos." };

  refresh();
  return { ok: true };
}
