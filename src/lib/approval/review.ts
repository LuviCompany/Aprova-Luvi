import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { FileKind } from "@/lib/materials/files";
import type { MaterialType } from "@/lib/types";

/**
 * Dados de uma revisão (o que o aprovador vê de uma versão enviada): o CONTEÚDO CONGELADO no envio
 * (nunca o material "vivo"), os arquivos, comentários e o histórico de decisões. Serve ao portal
 * autenticado (cliente Supabase do usuário, sob RLS) e ao link rápido (servidor, escopado por ids);
 * por isso recebe o cliente como parâmetro e filtra SEMPRE por cliente + material.
 *
 * Privacidade: a descrição INTERNA, as notas das versões e os nomes de outros aprovadores não saem daqui.
 */

export class ReviewLoadError extends Error {
  constructor(what: string) {
    super(`Não foi possível carregar ${what}.`);
    this.name = "ReviewLoadError";
  }
}

export interface ReviewScope {
  materialId: string;
  versionId: string;
  clientId: string;
  /** Aprovador que está vendo: só o nome DELE aparece nas decisões ("você"). */
  approverId: string;
}

export interface ReviewFile {
  id: string;
  position: number;
  kind: FileKind;
  originalName: string;
}

export interface ReviewContent {
  title: string;
  caption: string;
  type: MaterialType;
  aspectRatio: string | null;
  channel: string;
  publishDate: string | null;
  dueDate: string | null;
}

export interface ReviewComment {
  id: string;
  slide: number | null;
  authorName: string;
  authorRole: "luvi" | "cliente";
  body: string;
  createdAt: string;
}

export interface ReviewDecision {
  id: string;
  versionNumber: number;
  decision: "aprovado" | "alteracao";
  /** Foi o aprovador que está vendo? Outros aprovadores aparecem sem nome. */
  mine: boolean;
  via: "portal" | "link";
  at: string;
  note: string;
}

export interface ReviewVersion {
  number: number;
  createdAt: string;
  current: boolean;
}

export interface ReviewData {
  versionNumber: number;
  frozenAt: string;
  content: ReviewContent;
  files: ReviewFile[];
  comments: ReviewComment[];
  decisions: ReviewDecision[];
  versions: ReviewVersion[];
}

const MATERIAL_TYPES = ["imagem", "carrossel", "video", "pdf"] as const;

const versionSchema = z.object({ number: z.number() });
const contentRowSchema = z.object({
  frozen_at: z.string(),
  content: z
    .object({
      title: z.string(),
      caption: z.string(),
      type: z.enum(MATERIAL_TYPES),
      aspect_ratio: z.string().nullable(),
      channel: z.string(),
      publish_date: z.string().nullable(),
      due_date: z.string().nullable(),
    })
    .loose(),
});
const fileSchema = z.object({
  id: z.uuid(),
  slide_position: z.number(),
  kind: z.enum(["imagem", "video", "pdf"]),
  original_name: z.string(),
});
const versionListSchema = z.object({ id: z.uuid(), number: z.number(), created_at: z.string() });
const commentSchema = z.object({
  id: z.uuid(),
  slide: z.number().nullable(),
  author_name: z.string(),
  author_role: z.enum(["luvi", "cliente"]),
  body: z.string(),
  created_at: z.string(),
});
const decisionSchema = z.object({
  id: z.uuid(),
  version_id: z.uuid(),
  decision: z.enum(["aprovado", "alteracao"]),
  approver_id: z.uuid(),
  via: z.enum(["portal", "link"]),
  created_at: z.string(),
  note: z.string(),
});

export async function loadReview(db: SupabaseClient, scope: ReviewScope): Promise<ReviewData> {
  const { materialId, versionId, clientId, approverId } = scope;
  const [version, frozen, files, versions, comments, decisions] = await Promise.all([
    db.from("material_versions").select("number").eq("id", versionId).eq("material_id", materialId).eq("client_id", clientId).maybeSingle(),
    db.from("material_version_contents").select("frozen_at, content").eq("version_id", versionId).eq("client_id", clientId).maybeSingle(),
    db.from("material_files").select("id, slide_position, kind, original_name").eq("version_id", versionId).eq("client_id", clientId).order("slide_position"),
    db.from("material_versions").select("id, number, created_at").eq("material_id", materialId).eq("client_id", clientId).order("number", { ascending: false }).limit(100),
    db.from("comments").select("id, slide, author_name, author_role, body, created_at").eq("material_id", materialId).eq("client_id", clientId).order("created_at").limit(500),
    db.from("decisions").select("id, version_id, decision, approver_id, via, created_at, note").eq("material_id", materialId).eq("client_id", clientId).order("created_at", { ascending: false }).limit(200),
  ]);
  if (version.error || frozen.error || files.error || versions.error || comments.error || decisions.error) {
    throw new ReviewLoadError("o material");
  }

  const v = versionSchema.safeParse(version.data);
  const c = contentRowSchema.safeParse(frozen.data);
  const f = z.array(fileSchema).safeParse(files.data);
  const vs = z.array(versionListSchema).safeParse(versions.data);
  const cm = z.array(commentSchema).safeParse(comments.data);
  const d = z.array(decisionSchema).safeParse(decisions.data);
  if (!v.success || !c.success || !f.success || !vs.success || !cm.success || !d.success) throw new ReviewLoadError("o material");

  const numberOf = new Map(vs.data.map((row) => [row.id, row.number]));
  return {
    versionNumber: v.data.number,
    frozenAt: c.data.frozen_at,
    content: {
      title: c.data.content.title,
      caption: c.data.content.caption,
      type: c.data.content.type,
      aspectRatio: c.data.content.aspect_ratio,
      channel: c.data.content.channel,
      publishDate: c.data.content.publish_date,
      dueDate: c.data.content.due_date,
    },
    files: f.data.map((row) => ({ id: row.id, position: row.slide_position, kind: row.kind, originalName: row.original_name })),
    comments: cm.data.map((row) => ({
      id: row.id,
      slide: row.slide,
      authorName: row.author_name,
      authorRole: row.author_role,
      body: row.body,
      createdAt: row.created_at,
    })),
    decisions: d.data.map((row) => ({
      id: row.id,
      versionNumber: numberOf.get(row.version_id) ?? 0,
      decision: row.decision,
      mine: row.approver_id === approverId,
      via: row.via,
      at: row.created_at,
      note: row.note,
    })),
    versions: vs.data.map((row) => ({ number: row.number, createdAt: row.created_at, current: row.id === versionId })),
  };
}
