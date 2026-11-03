import "server-only";
import { z } from "zod";
import { DataLoadError } from "@/lib/clients/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FileKind } from "./files";

/**
 * Versões de um material, com arquivos e o conteúdo congelado (leitura sob RLS: cliente Supabase do
 * usuário). A versão mais recente é a de trabalho; as anteriores são histórico imutável.
 */

export const VERSIONS_SELECT =
  "id, number, note, created_at, profiles(full_name), material_files(id, slide_position, kind, mime_type, original_name, size_bytes, checksum_sha256), material_version_contents(content, frozen_at), approval_requests(count)";

export interface VersionFile {
  id: string;
  position: number;
  kind: FileKind;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  checksum: string | null;
}

export interface FrozenContent {
  title: string;
  description: string;
  caption: string;
  type: string;
  aspect_ratio: string | null;
  channel: string;
  publish_date: string | null;
  due_date: string | null;
}

export interface MaterialVersionItem {
  id: string;
  number: number;
  note: string;
  createdAt: string;
  author: string | null;
  files: VersionFile[];
  /** Cópia imutável do que foi apresentado ao cliente; `null` enquanto a versão é só rascunho. */
  frozen: { frozenAt: string; content: FrozenContent } | null;
  /** Já houve solicitação de aprovação desta versão? Então os arquivos não mudam mais. */
  sent: boolean;
}

const countSchema = z.array(z.object({ count: z.number() })).transform((rows) => rows[0]?.count ?? 0);
const contentSchema = z.object({
  title: z.string(),
  description: z.string(),
  caption: z.string(),
  type: z.string(),
  aspect_ratio: z.string().nullable(),
  channel: z.string(),
  publish_date: z.string().nullable(),
  due_date: z.string().nullable(),
});
const contentRowSchema = z.object({ content: contentSchema.loose(), frozen_at: z.string() });

const versionRowSchema = z.object({
  id: z.uuid(),
  number: z.number(),
  note: z.string(),
  created_at: z.string(),
  profiles: z.object({ full_name: z.string() }).nullable(),
  material_files: z.array(
    z.object({
      id: z.uuid(),
      slide_position: z.number(),
      kind: z.enum(["imagem", "video", "pdf"]),
      mime_type: z.string(),
      original_name: z.string(),
      size_bytes: z.number(),
      checksum_sha256: z.string().nullable(),
    }),
  ),
  // Um-para-um: o PostgREST devolve objeto ou nulo; aceita lista por segurança.
  material_version_contents: z.union([contentRowSchema, z.array(contentRowSchema).transform((rows) => rows[0] ?? null), z.null()]),
  approval_requests: countSchema,
});

/** Versões do material, da mais recente para a mais antiga. */
export async function listMaterialVersions(materialId: string): Promise<MaterialVersionItem[]> {
  if (!z.uuid().safeParse(materialId).success) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("material_versions")
    .select(VERSIONS_SELECT)
    .eq("material_id", materialId)
    .order("number", { ascending: false });
  if (error) throw new DataLoadError("as versões", error.message);
  const parsed = z.array(versionRowSchema).safeParse(data);
  if (!parsed.success) throw new DataLoadError("as versões", "resposta inesperada");
  return parsed.data.map((row) => ({
    id: row.id,
    number: row.number,
    note: row.note,
    createdAt: row.created_at,
    author: row.profiles?.full_name ?? null,
    files: row.material_files
      .map((f) => ({
        id: f.id,
        position: f.slide_position,
        kind: f.kind,
        mimeType: f.mime_type,
        originalName: f.original_name,
        sizeBytes: f.size_bytes,
        checksum: f.checksum_sha256,
      }))
      .sort((a, b) => a.position - b.position),
    frozen: row.material_version_contents
      ? { frozenAt: row.material_version_contents.frozen_at, content: row.material_version_contents.content as FrozenContent }
      : null,
    sent: row.approval_requests > 0,
  }));
}
