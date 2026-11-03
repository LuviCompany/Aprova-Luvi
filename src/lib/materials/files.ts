import type { MaterialType } from "@/lib/types";

/**
 * Regras de arquivos de materiais (Módulo 3, etapas C e D). Funções puras, sem rede nem banco: os
 * limites espelham as CHECKs de `material_files`, o bucket `materials` e a trava `material_files_validate`
 * (supabase/migrations). O banco continua sendo a barreira final.
 */

export type FileKind = "imagem" | "video" | "pdf";

export const MAX_SLIDES = 10;
const MB = 1024 * 1024;

/** Tamanho máximo por arquivo, por tipo (igual à CHECK de `material_files`). */
export const FILE_LIMITS: Record<FileKind, number> = { imagem: 20 * MB, video: 50 * MB, pdf: 50 * MB };

export const ALLOWED_MIME: Record<string, FileKind> = {
  "image/jpeg": "imagem",
  "image/png": "imagem",
  "image/webp": "imagem",
  "video/mp4": "video",
  "video/quicktime": "video",
  "application/pdf": "pdf",
};

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
};

export const KIND_LABEL: Record<FileKind, string> = { imagem: "imagem", video: "vídeo", pdf: "PDF" };

export const formatBytes = (bytes: number): string =>
  bytes >= MB ? `${(bytes / MB).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const kindOfMime = (mime: string): FileKind | null => ALLOWED_MIME[mime] ?? null;
export const extensionFor = (mime: string): string => EXTENSION[mime] ?? "bin";

/** Tipos de arquivo aceitos por tipo de material. */
export function allowedKinds(type: MaterialType): FileKind[] {
  switch (type) {
    case "imagem":
      return ["imagem"];
    case "video":
      return ["video"];
    case "pdf":
      return ["pdf"];
    case "carrossel":
      return ["imagem", "video"];
  }
}

/** Atributo `accept` do campo de arquivo. */
export function acceptFor(type: MaterialType): string {
  return Object.entries(ALLOWED_MIME)
    .filter(([, kind]) => allowedKinds(type).includes(kind))
    .map(([mime]) => mime)
    .join(",");
}

/** Só carrossel tem vários slides; os demais têm um arquivo, que é SUBSTITUÍDO por um novo envio. */
export const isMultiSlide = (type: MaterialType) => type === "carrossel";
export const maxFilesFor = (type: MaterialType) => (isMultiSlide(type) ? MAX_SLIDES : 1);

export interface FileMeta {
  name: string;
  type: string;
  size: number;
}

export type PlanResult = { ok: true } | { ok: false; error: string; perFile: Record<number, string> };

/** Valida um lote de envio ANTES de enviar qualquer byte (a tela) e DE NOVO no servidor. */
export function validateUploadPlan(type: MaterialType, existingCount: number, files: FileMeta[]): PlanResult {
  const perFile: Record<number, string> = {};
  if (files.length === 0) return { ok: false, error: "Escolha ao menos um arquivo.", perFile };
  const kinds = allowedKinds(type);
  files.forEach((file, index) => {
    const kind = kindOfMime(file.type);
    if (!kind) perFile[index] = "Formato não aceito. Use JPG, PNG, WebP, MP4, MOV ou PDF.";
    else if (!kinds.includes(kind)) {
      perFile[index] = `Este material é ${type === "carrossel" ? "um carrossel (imagens ou vídeos)" : `do tipo ${KIND_LABEL[kinds[0]]}`}: ${KIND_LABEL[kind]} não serve.`;
    } else if (!Number.isFinite(file.size) || file.size <= 0) perFile[index] = "O arquivo está vazio.";
    else if (file.size > FILE_LIMITS[kind]) {
      perFile[index] = `Arquivo grande demais (${formatBytes(file.size)}). O limite para ${KIND_LABEL[kind]} é ${formatBytes(FILE_LIMITS[kind])}.`;
    }
  });
  if (Object.keys(perFile).length > 0) return { ok: false, error: "Corrija os arquivos indicados.", perFile };
  if (!isMultiSlide(type)) {
    if (files.length > 1) return { ok: false, error: "Este material tem um único arquivo. Envie um por vez.", perFile };
  } else if (existingCount + files.length > MAX_SLIDES) {
    return {
      ok: false,
      error: `O carrossel aceita no máximo ${MAX_SLIDES} slides (já há ${existingCount}).`,
      perFile,
    };
  }
  return { ok: true };
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);
const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));

/**
 * Tipo real pela ASSINATURA do arquivo (primeiros bytes), independente do que o navegador declarou.
 * Devolve o MIME ou `null` se não reconhecer.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 8 && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    return ascii(bytes, 8, 12) === "qt  " ? "video/quicktime" : "video/mp4";
  }
  // QuickTime antigo, sem "ftyp": começa por um átomo conhecido.
  if (bytes.length >= 8 && ["moov", "mdat", "wide", "free", "skip"].includes(ascii(bytes, 4, 8))) return "video/quicktime";
  return null;
}

/** O conteúdo confere com o tipo declarado? (MP4 e MOV compartilham a família ISO "ftyp".) */
export function contentMatchesDeclared(declared: string, bytes: Uint8Array): boolean {
  const real = sniffMime(bytes);
  if (!real) return false;
  if (real === declared) return true;
  return kindOfMime(real) === "video" && kindOfMime(declared) === "video";
}

/** Nome para exibição: sem caminho nem caracteres de controle, no máximo 255 caracteres. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "arquivo").slice(0, 255);
}

const PATH_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|mp4|mov|pdf)$/;

/** Caminho no storage: `{cliente}/{material}/{uuid}.{ext}` (a versão não entra: o arquivo pode ser anexado depois). */
export const storagePathFor = (clientId: string, materialId: string, fileUuid: string, mime: string) =>
  `${clientId}/${materialId}/${fileUuid}.${extensionFor(mime)}`;

/** O caminho enviado pelo navegador é exatamente da pasta deste material e do formato que o servidor gera? */
export function isOwnPath(path: string, clientId: string, materialId: string): boolean {
  const prefix = `${clientId}/${materialId}/`;
  return path.startsWith(prefix) && PATH_FILE.test(path.slice(prefix.length));
}
