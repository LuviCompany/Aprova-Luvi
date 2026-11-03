"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeStaff } from "@/lib/auth/action-guard";
import { messageForDbError } from "@/lib/clients/errors";
import { escapeLike, parseClientInput, type FieldErrors } from "@/lib/clients/schema";

export interface ClientFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

const DUPLICATE = "Já existe um cliente com esse nome.";

function refresh() {
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/projetos");
}

/** Cria (sem `id`) ou edita (com `id`) um cliente. Só admin e atendimento; a RLS confere de novo. */
export async function saveClientAction(_prev: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const guard = await authorizeStaff({ manageClients: true });
  if (!guard.ok) return { error: guard.error };
  const { supabase, user } = guard;

  const rawId = text(formData, "id");
  const id = rawId ? (z.uuid().safeParse(rawId).success ? rawId : null) : undefined;
  if (id === null) return { error: "Cliente inválido." };

  const parsed = parseClientInput({
    name: text(formData, "name"),
    segment: text(formData, "segment"),
    initials: text(formData, "initials"),
  });
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors };
  const { name, segment, initials } = parsed.data;

  // O banco só barra nomes idênticos; aqui "casa aurora" e "Casa Aurora" contam como o mesmo cliente.
  const same = await supabase.from("clients").select("id").ilike("name", escapeLike(name)).limit(2);
  if (same.error) return { error: messageForDbError(same.error, "cliente") };
  if (same.data.some((row) => row.id !== id)) return { fieldErrors: { name: DUPLICATE } };

  if (id === undefined) {
    const { error } = await supabase
      .from("clients")
      .insert({ organization_id: user.organizationId, name, segment, initials, active: true });
    if (error) {
      return error.code === "23505"
        ? { fieldErrors: { name: DUPLICATE } }
        : { error: messageForDbError(error, "cliente") };
    }
  } else {
    const { data, error } = await supabase
      .from("clients")
      .update({ name, segment, initials })
      .eq("id", id)
      .select("id");
    if (error) {
      return error.code === "23505"
        ? { fieldErrors: { name: DUPLICATE } }
        : { error: messageForDbError(error, "cliente") };
    }
    if (!data || data.length === 0) return { error: "Cliente não encontrado." };
  }

  refresh();
  return { ok: true };
}

/** Arquiva ou reativa um cliente (nada é apagado). */
export async function setClientActiveAction(clientId: string, active: boolean): Promise<ClientFormState> {
  const guard = await authorizeStaff({ manageClients: true });
  if (!guard.ok) return { error: guard.error };
  if (!z.uuid().safeParse(clientId).success || typeof active !== "boolean") return { error: "Cliente inválido." };

  const { data, error } = await guard.supabase.from("clients").update({ active }).eq("id", clientId).select("id");
  if (error) return { error: messageForDbError(error, "cliente") };
  if (!data || data.length === 0) return { error: "Cliente não encontrado." };

  refresh();
  return { ok: true };
}
