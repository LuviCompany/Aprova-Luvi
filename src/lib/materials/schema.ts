import { z } from "zod";
import { isRealDate, squash, type FieldErrors, type ParseResult } from "@/lib/clients/schema";
import type { MaterialStatus, MaterialType } from "@/lib/types";

/**
 * Regras de entrada de materiais (Módulo 3, etapa B). Funções puras, sem acesso ao banco: os
 * limites espelham as CHECKs de `supabase/migrations/…` e o banco continua sendo a barreira final.
 */

export const MATERIAL_TYPES = ["imagem", "carrossel", "video", "pdf"] as const satisfies readonly MaterialType[];
export const MATERIAL_STATUSES = ["rascunho", "aguardando", "alteracao", "aprovado"] as const satisfies readonly MaterialStatus[];

export const ASPECT_RATIOS = ["1:1", "4:5", "9:16", "outro"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const ASPECT_RATIO_LABEL: Record<AspectRatio, string> = {
  "1:1": "1:1 (quadrado)",
  "4:5": "4:5 (retrato)",
  "9:16": "9:16 (vertical)",
  outro: "Outro / não se aplica",
};

/** Sugestões do campo "canal" (texto livre de até 120 caracteres; não é uma lista fechada). */
export const CHANNEL_SUGGESTIONS = [
  "Instagram Feed",
  "Instagram Stories",
  "Instagram Reels",
  "TikTok",
  "Facebook",
  "LinkedIn",
  "YouTube",
  "E-mail marketing",
  "Site",
] as const;

export const LIMITS = { title: 200, description: 2000, caption: 2200, channel: 120 } as const;

/**
 * Campos que a trava do banco (`materials_guard_content`) impede de mudar depois que o material
 * sai de "rascunho". Se esta lista mudar, a trava do banco muda junto (há teste de banco).
 */
export const LOCKED_CONTENT_FIELDS = ["title", "description", "caption", "channel", "aspect_ratio"] as const;

/**
 * Tudo o que o cliente enxerga ao aprovar. A etapa D grava uma cópia IMUTÁVEL destes campos
 * quando a versão é enviada para aprovação (ver docs/MODULO-3.md, seção 12). Os de data não
 * travam (reagendar é legítimo), por isso a cópia por versão é que preserva o que foi aprovado.
 */
export const PRESENTED_FIELDS = [
  "title",
  "description",
  "caption",
  "type",
  "aspect_ratio",
  "channel",
  "publish_date",
  "due_date",
] as const;

export interface MaterialInput {
  /** Só no cadastro; na edição o cliente do material não muda. */
  clientId: string;
  /** Só no cadastro; o projeto do material não muda. */
  projectId: string;
  /** Só no cadastro; o tipo do material não muda (excluir o rascunho vazio e recriar é a correção). */
  type: MaterialType;
  title: string;
  description: string;
  caption: string;
  aspectRatio: AspectRatio | null;
  channel: string;
  /** Data prevista de publicação, `YYYY-MM-DD` ou `null`. */
  publishDate: string | null;
  /** Prazo de aprovação, `YYYY-MM-DD` ou `null`. */
  dueDate: string | null;
}

/** Conta como o Postgres (`char_length`): por caractere, não por unidade UTF-16 (emoji = 1). */
export const charCount = (value: string) => [...value].length;

const normalizeBreaks = (value: string) => value.replace(/\r\n?/g, "\n");

const messageSchema = z.object({
  title: z
    .string()
    .transform(squash)
    .pipe(
      z
        .string()
        .min(2, "Informe o título do material (mínimo de 2 caracteres).")
        .refine((v) => charCount(v) <= LIMITS.title, `O título pode ter no máximo ${LIMITS.title} caracteres.`)
        .regex(/[\p{L}\p{N}]/u, "O título precisa ter letras ou números."),
    ),
  description: z
    .string()
    .transform((v) => normalizeBreaks(v).trim())
    .pipe(z.string().refine((v) => charCount(v) <= LIMITS.description, `A descrição pode ter no máximo ${LIMITS.description} caracteres.`)),
  // A legenda preserva quebras de linha e espaços internos (parágrafos, hashtags); só as pontas são aparadas.
  caption: z
    .string()
    .transform((v) => normalizeBreaks(v).trim())
    .pipe(z.string().refine((v) => charCount(v) <= LIMITS.caption, `A legenda pode ter no máximo ${LIMITS.caption} caracteres.`)),
  channel: z
    .string()
    .transform(squash)
    .pipe(z.string().refine((v) => charCount(v) <= LIMITS.channel, `O canal pode ter no máximo ${LIMITS.channel} caracteres.`)),
});

const createIds = z.object({
  clientId: z.uuid("Escolha o cliente."),
  projectId: z.uuid("Escolha o projeto."),
  type: z.enum(MATERIAL_TYPES, "Escolha o tipo do material."),
});

function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

const asText = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Valida o formulário. No cadastro (`mode: "create"`) exige cliente, projeto e tipo; na edição
 * esses três voltam vazios (não mudam). A data de publicação anterior ao prazo NÃO é erro: é um
 * aviso da tela (`publishBeforeApproval`).
 */
export function parseMaterialInput(
  input: Record<string, unknown>,
  options: { mode: "create" | "edit" } = { mode: "create" },
): ParseResult<MaterialInput> {
  const errors: FieldErrors = {};
  const content = messageSchema.safeParse({
    title: asText(input.title),
    description: asText(input.description),
    caption: asText(input.caption),
    channel: asText(input.channel),
  });
  if (!content.success) Object.assign(errors, fieldErrorsOf(content.error));

  let ids: { clientId: string; projectId: string; type: MaterialType } = { clientId: "", projectId: "", type: "imagem" };
  if (options.mode === "create") {
    const parsed = createIds.safeParse({
      clientId: asText(input.clientId),
      projectId: asText(input.projectId),
      type: asText(input.type),
    });
    if (parsed.success) ids = parsed.data;
    else Object.assign(errors, fieldErrorsOf(parsed.error));
  }

  const rawRatio = asText(input.aspectRatio).trim();
  let aspectRatio: AspectRatio | null = null;
  if (rawRatio) {
    if ((ASPECT_RATIOS as readonly string[]).includes(rawRatio)) aspectRatio = rawRatio as AspectRatio;
    else errors.aspectRatio = "Escolha uma proporção válida.";
  }

  const publishRaw = asText(input.publishDate).trim();
  const dueRaw = asText(input.dueDate).trim();
  if (publishRaw && !isRealDate(publishRaw)) errors.publishDate = "Informe uma data válida.";
  if (dueRaw && !isRealDate(dueRaw)) errors.dueDate = "Informe uma data válida.";

  if (!content.success || Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    data: {
      ...ids,
      ...content.data,
      aspectRatio,
      publishDate: publishRaw || null,
      dueDate: dueRaw || null,
    },
  };
}

/** Aviso (não bloqueio): a publicação está marcada antes do prazo de aprovação. */
export function publishBeforeApproval(publishDate: string | null | undefined, dueDate: string | null | undefined): boolean {
  if (!publishDate || !dueDate) return false;
  if (!isRealDate(publishDate) || !isRealDate(dueDate)) return false;
  return publishDate < dueDate;
}

/** Só rascunho aceita edição de conteúdo; as datas sempre podem mudar. */
export function isContentLocked(status: MaterialStatus): boolean {
  return status !== "rascunho";
}

export const PAGE_SIZE = 20;

export type MaterialStatusFilter = MaterialStatus | "todos";
export type MaterialTypeFilter = MaterialType | "todos";

export interface MaterialFilters {
  q: string;
  status: MaterialStatusFilter;
  type: MaterialTypeFilter;
  clientId: string | null;
  projectId: string | null;
  /** Página, a partir de 1. */
  page: number;
}

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const token = (value: string) => (/^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null);

/** Filtros da URL. Valor desconhecido volta ao padrão (nunca vira erro nem consulta estranha). */
export function parseMaterialFilters(params: Params): MaterialFilters {
  const status = first(params.status);
  const type = first(params.tipo);
  const page = Number.parseInt(first(params.pagina), 10);
  return {
    q: squash(first(params.q)).slice(0, 80),
    status: (MATERIAL_STATUSES as readonly string[]).includes(status) ? (status as MaterialStatus) : "todos",
    type: (MATERIAL_TYPES as readonly string[]).includes(type) ? (type as MaterialType) : "todos",
    clientId: token(first(params.cliente)),
    projectId: token(first(params.projeto)),
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}
