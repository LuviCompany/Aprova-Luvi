"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeStaff } from "@/lib/auth/action-guard";
import { messageForDbError } from "@/lib/clients/errors";
import {
  cleanFileName,
  contentMatchesDeclared,
  extensionFor,
  isOwnPath,
  kindOfMime,
  isMultiSlide,
  storagePathFor,
  validateUploadPlan,
  type FileMeta,
} from "@/lib/materials/files";
import type { MaterialType } from "@/lib/types";

/**
 * Upload privado de arquivos de material, em três passos (nenhum byte de arquivo passa pelo servidor do app):
 *  1. prepareUploadsAction: valida o lote e devolve URLs de envio ASSINADAS e de uso único, uma por arquivo;
 *  2. o navegador envia cada arquivo direto ao bucket privado `materials`;
 *  3. finalizeUploadsAction: confere cada objeto no storage (tamanho e ASSINATURA do arquivo), cria a versão se
 *     preciso e grava as linhas de `material_files`; se qualquer coisa falhar, apaga os objetos enviados.
 * Tudo com o cliente Supabase DO USUÁRIO (RLS e políticas do storage); a chave secreta nunca é usada.
 */

const BUCKET = "materials";

export interface UploadSlot {
  index: number;
  path: string;
  /** URL de envio assinada (uso único); o navegador faz PUT nela. */
  url: string;
}
export type PrepareResult =
  | { ok: true; uploads: UploadSlot[] }
  | { ok: false; error: string; perFile?: Record<number, string> };

export interface UploadedItem {
  path: string;
  name: string;
  type: string;
  size: number;
  /** SHA-256 em hexadecimal calculado no navegador (informativo; o servidor não relê o arquivo inteiro). */
  checksum?: string;
}
export type FinalizeResult = { ok: true; versionId: string } | { ok: false; error: string; perFile?: Record<number, string> };
export interface ActionResult {
  ok?: boolean;
  error?: string;
}

const uuid = z.uuid();

function refresh() {
  revalidatePath("/admin/materiais");
  revalidatePath("/admin/materiais/[id]", "page");
}

interface MaterialRow {
  id: string;
  client_id: string;
  type: MaterialType;
  status: string;
}
interface WorkingVersion {
  id: string;
  number: number;
  fileCount: number;
  sent: boolean;
}

async function loadMaterial(supabase: SupabaseClient, id: string): Promise<MaterialRow | { error: string }> {
  const { data, error } = await supabase.from("materials").select("id, client_id, type, status").eq("id", id).maybeSingle();
  if (error) return { error: messageForDbError(error, "material") };
  if (!data) return { error: "Material não encontrado." };
  return data as MaterialRow;
}

async function latestVersion(supabase: SupabaseClient, materialId: string): Promise<WorkingVersion | null | { error: string }> {
  const { data, error } = await supabase
    .from("material_versions")
    .select("id, number, material_files(count), approval_requests(count)")
    .eq("material_id", materialId)
    .order("number", { ascending: false })
    .limit(1);
  if (error) return { error: messageForDbError(error, "material") };
  const row = (data as Array<{ id: string; number: number; material_files: Array<{ count: number }>; approval_requests: Array<{ count: number }> }> | null)?.[0];
  if (!row) return null;
  return { id: row.id, number: row.number, fileCount: row.material_files?.[0]?.count ?? 0, sent: (row.approval_requests?.[0]?.count ?? 0) > 0 };
}

const isError = <T extends object>(value: T | { error: string } | null): value is { error: string } =>
  !!value && typeof value === "object" && "error" in value;

/** Passo 1: valida o lote e devolve as URLs de envio assinadas. */
export async function prepareUploadsAction(materialId: string, files: FileMeta[]): Promise<PrepareResult> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { supabase } = guard;
  if (!uuid.safeParse(materialId).success) return { ok: false, error: "Material inválido." };
  if (!Array.isArray(files) || files.length > 20) return { ok: false, error: "Lote de arquivos inválido." };

  const material = await loadMaterial(supabase, materialId);
  if (isError(material)) return { ok: false, error: material.error };
  if (material.status !== "rascunho") return { ok: false, error: messageForDbError({ message: "fora de rascunho" }, "material") };

  const version = await latestVersion(supabase, materialId);
  if (isError(version)) return { ok: false, error: version.error };
  const existing = version && !version.sent ? version.fileCount : 0;

  const metas: FileMeta[] = files.map((f) => ({ name: cleanFileName(String(f?.name ?? "")), type: String(f?.type ?? ""), size: Number(f?.size) }));
  const plan = validateUploadPlan(material.type, existing, metas);
  if (!plan.ok) return plan;

  const uploads: UploadSlot[] = [];
  for (const [index, meta] of metas.entries()) {
    const path = storagePathFor(material.client_id, material.id, randomUUID(), meta.type);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      return { ok: false, error: "Não foi possível preparar o envio. Tente novamente." };
    }
    uploads.push({ index, path, url: data.signedUrl });
  }
  return { ok: true, uploads };
}

/** Confere um objeto já enviado: existe, tem o tamanho declarado e a assinatura bate com o tipo. */
async function inspectUpload(supabase: SupabaseClient, item: UploadedItem): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(item.path, 60);
  if (error || !data?.signedUrl) return "O arquivo não chegou ao armazenamento. Envie de novo.";
  // Só os primeiros bytes interessam: o AbortController encerra a leitura (e dá um limite de tempo) sem baixar o arquivo todo.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(data.signedUrl, { headers: { Range: "bytes=0-63" }, cache: "no-store", signal: controller.signal });
  } catch {
    clearTimeout(timer);
    return "Não foi possível conferir o arquivo enviado. Tente de novo.";
  }
  if (!response.ok) {
    clearTimeout(timer);
    controller.abort();
    return "O arquivo não chegou ao armazenamento. Envie de novo.";
  }
  const range = /\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  const total = range ? Number(range[1]) : Number(response.headers.get("content-length"));
  const reader = response.body?.getReader();
  const head = new Uint8Array(64);
  let filled = 0;
  try {
    if (reader) {
      while (filled < head.length) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        const take = Math.min(value.length, head.length - filled);
        head.set(value.subarray(0, take), filled);
        filled += take;
      }
    }
  } catch {
    clearTimeout(timer);
    return "Não foi possível conferir o arquivo enviado. Tente de novo.";
  }
  clearTimeout(timer);
  controller.abort(); // encerra a leitura (se o storage ignorasse o intervalo, não baixa o arquivo inteiro)
  if (!Number.isFinite(total) || total !== item.size) return "O tamanho do arquivo enviado não confere. Envie de novo.";
  if (!contentMatchesDeclared(item.type, head.subarray(0, filled))) {
    return "O conteúdo não corresponde ao formato do arquivo (pode estar corrompido ou ter outra extensão).";
  }
  return null;
}

async function removeObjects(supabase: SupabaseClient, paths: string[]) {
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths).catch(() => undefined);
}

/** Passo 3: confere os objetos e grava versão (se preciso) e arquivos; desfaz o envio se algo falhar. */
export async function finalizeUploadsAction(materialId: string, items: UploadedItem[]): Promise<FinalizeResult> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { supabase, user } = guard;
  if (!uuid.safeParse(materialId).success) return { ok: false, error: "Material inválido." };
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) return { ok: false, error: "Lote de arquivos inválido." };

  const paths = items.map((i) => String(i?.path ?? ""));
  const material = await loadMaterial(supabase, materialId);
  if (isError(material)) {
    // O caminho veio do navegador: só apaga o que está na pasta do material (nunca de outro).
    return { ok: false, error: material.error };
  }
  const cleanup = (list: string[]) => removeObjects(supabase, list.filter((p) => isOwnPath(p, material.client_id, material.id)));

  if (paths.some((p) => !isOwnPath(p, material.client_id, material.id)) || new Set(paths).size !== paths.length) {
    await cleanup(paths);
    return { ok: false, error: "Caminho de arquivo inválido." };
  }
  if (material.status !== "rascunho") {
    await cleanup(paths);
    return { ok: false, error: messageForDbError({ message: "fora de rascunho" }, "material") };
  }

  const normalized: UploadedItem[] = items.map((i) => ({
    path: i.path,
    name: cleanFileName(String(i.name ?? "")),
    type: String(i.type ?? ""),
    size: Number(i.size),
    checksum: typeof i.checksum === "string" && /^[0-9a-f]{64}$/.test(i.checksum) ? i.checksum : undefined,
  }));
  // O tipo MIME declarado precisa combinar com a extensão do caminho gerado pelo servidor.
  if (normalized.some((i) => !kindOfMime(i.type) || extensionFor(i.type) !== i.path.split(".").pop())) {
    await cleanup(paths);
    return { ok: false, error: "Tipo de arquivo inválido." };
  }

  const version = await latestVersion(supabase, materialId);
  if (isError(version)) {
    await cleanup(paths);
    return { ok: false, error: version.error };
  }
  const target = version && !version.sent ? version : null;
  const existing = target?.fileCount ?? 0;
  const plan = validateUploadPlan(material.type, isMultiSlide(material.type) ? existing : 0, normalized);
  if (!plan.ok) {
    await cleanup(paths);
    return plan;
  }

  const perFile: Record<number, string> = {};
  for (const [index, item] of normalized.entries()) {
    const problem = await inspectUpload(supabase, item);
    if (problem) perFile[index] = problem;
  }
  if (Object.keys(perFile).length > 0) {
    await cleanup(paths);
    return { ok: false, error: "Alguns arquivos não passaram na conferência.", perFile };
  }

  // Versão de trabalho: a mais recente que ainda não foi enviada; senão, uma nova.
  let versionId = target?.id;
  if (!versionId) {
    const note = version ? "Nova versão" : "Versão inicial";
    const created = await supabase
      .from("material_versions")
      .insert({ material_id: material.id, client_id: material.client_id, note, created_by: user.id })
      .select("id");
    const row = (created.data as Array<{ id: string }> | null)?.[0];
    if (created.error || !row) {
      await cleanup(paths);
      return { ok: false, error: messageForDbError(created.error, "material") };
    }
    versionId = row.id;
  }

  // Material de arquivo único: o novo arquivo SUBSTITUI o anterior (a linha antiga sai antes, pela unicidade da posição).
  let replaced: { row: Record<string, unknown>; path: string } | null = null;
  if (!isMultiSlide(material.type) && existing > 0) {
    const old = await supabase.from("material_files").select("*").eq("version_id", versionId).eq("slide_position", 1).maybeSingle();
    const oldRow = old.data as Record<string, unknown> | null;
    if (oldRow) {
      const removed = await supabase.from("material_files").delete().eq("id", oldRow.id as string).select("id");
      if (removed.error || !removed.data?.length) {
        await cleanup(paths);
        return { ok: false, error: messageForDbError(removed.error, "material") };
      }
      replaced = { row: oldRow, path: String(oldRow.storage_path) };
    }
  }

  const rows = normalized.map((item, i) => ({
    version_id: versionId,
    material_id: material.id,
    client_id: material.client_id,
    slide_position: (isMultiSlide(material.type) ? existing : 0) + i + 1,
    kind: kindOfMime(item.type),
    storage_path: item.path,
    original_name: item.name,
    mime_type: item.type,
    size_bytes: item.size,
    checksum_sha256: item.checksum ?? null,
    created_by: user.id,
  }));
  const inserted = await supabase.from("material_files").insert(rows);
  if (inserted.error) {
    if (replaced) {
      const { id, created_at, ...restorable } = replaced.row;
      void id;
      void created_at;
      await supabase.from("material_files").insert(restorable);
    }
    await cleanup(paths);
    return { ok: false, error: messageForDbError(inserted.error, "material") };
  }
  if (replaced) await removeObjects(supabase, [replaced.path]);

  refresh();
  return { ok: true, versionId };
}

/** Remove um slide/arquivo da versão de trabalho e compacta as posições. */
export async function removeFileAction(fileId: string): Promise<ActionResult> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { error: guard.error };
  const { supabase } = guard;
  if (!uuid.safeParse(fileId).success) return { error: "Arquivo inválido." };

  const file = await supabase.from("material_files").select("id, version_id, storage_path").eq("id", fileId).maybeSingle();
  if (file.error) return { error: messageForDbError(file.error, "material") };
  const row = file.data as { id: string; version_id: string; storage_path: string } | null;
  if (!row) return { error: "Arquivo não encontrado." };

  const removed = await supabase.from("material_files").delete().eq("id", fileId).select("id");
  if (removed.error) return { error: messageForDbError(removed.error, "material") };
  if (!removed.data?.length) return { error: "Este arquivo já foi enviado para aprovação e não pode ser removido." };
  await removeObjects(supabase, [row.storage_path]);

  const rest = await supabase.from("material_files").select("id").eq("version_id", row.version_id).order("slide_position");
  const ids = ((rest.data ?? []) as Array<{ id: string }>).map((f) => f.id);
  if (ids.length > 0) await supabase.rpc("reorder_version_files", { p_version_id: row.version_id, p_order: ids });

  refresh();
  return { ok: true };
}

/** Reordena os slides da versão (lista completa dos ids, na nova ordem). */
export async function reorderFilesAction(versionId: string, order: string[]): Promise<ActionResult> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuid.safeParse(versionId).success || !Array.isArray(order) || !order.every((id) => uuid.safeParse(id).success)) {
    return { error: "Ordem inválida." };
  }
  const { error } = await guard.supabase.rpc("reorder_version_files", { p_version_id: versionId, p_order: order });
  if (error) return { error: messageForDbError(error, "material") };
  refresh();
  return { ok: true };
}

/** Operação explícita de revisão: nova versão de material aprovado ou com alteração pedida. */
export async function startRevisionAction(materialId: string, reason: string): Promise<ActionResult & { versionId?: string }> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuid.safeParse(materialId).success) return { error: "Material inválido." };
  const trimmed = String(reason ?? "").trim();
  if ([...trimmed].length < 10 || [...trimmed].length > 500) {
    return { error: "Informe o motivo da revisão (de 10 a 500 caracteres)." };
  }
  const { data, error } = await guard.supabase.rpc("start_material_revision", { p_material_id: materialId, p_reason: trimmed });
  if (error) return { error: messageForDbError(error, "material") };
  refresh();
  return { ok: true, versionId: typeof data === "string" ? data : undefined };
}
