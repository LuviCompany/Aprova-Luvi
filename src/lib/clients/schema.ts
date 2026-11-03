import { z } from "zod";

/**
 * Regras de entrada de clientes e projetos (Módulo 3, etapa A). Funções puras, sem acesso ao
 * banco: os limites espelham as CHECKs de `supabase/migrations/…core_schema.sql`, e o banco
 * continua sendo a barreira final.
 */

export const PROJECT_STATUSES = ["ativo", "pausado", "concluido"] as const;
export type ProjectStatusValue = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatusValue, string> = {
  ativo: "Ativo",
  pausado: "Pausado",
  concluido: "Concluído",
};

export type FieldErrors = Record<string, string>;
export type ParseResult<T> = { ok: true; data: T } | { ok: false; fieldErrors: FieldErrors };

export interface ClientInput {
  name: string;
  segment: string;
  initials: string;
}

export interface ProjectInput {
  clientId: string;
  name: string;
  description: string;
  status: ProjectStatusValue;
  /** `YYYY-MM-DD` ou `null` quando não há data. */
  dueDate: string | null;
}

export const squash = (value: string) => value.replace(/\s+/g, " ").trim();
const stripAccents = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "");

/** Partículas que não entram nas iniciais ("Casa de Pedra" => "CP"). */
const PARTICLES = new Set(["de", "da", "do", "das", "dos", "e", "a", "o"]);

/** Iniciais de 1 a 3 letras/números, em maiúsculas e sem acento (formato exigido pelo banco). */
export function normalizeInitials(raw: string): string {
  return stripAccents(raw).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
}

/** Sugere as iniciais a partir do nome: primeira letra das duas primeiras palavras relevantes. */
export function initialsFromName(name: string): string {
  const words = stripAccents(squash(name)).split(" ").filter(Boolean);
  const significant = words.filter((word) => !PARTICLES.has(word.toLowerCase()));
  const pool = significant.length > 0 ? significant : words;
  const firsts = pool.map((word) => word.replace(/[^A-Za-z0-9]/g, "")[0]).filter(Boolean);
  const initials = firsts.slice(0, 2).join("").toUpperCase();
  if (initials.length >= 2) return initials;
  const letters = pool.join("").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
  return letters || "CL";
}

/** Escapa `%`, `_` e `\` para a busca por trecho (ILIKE) tratar o texto digitado literalmente. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const clientSchema = z.object({
  name: z
    .string()
    .transform(squash)
    .pipe(
      z
        .string()
        .min(2, "Informe o nome do cliente (mínimo de 2 caracteres).")
        .max(120, "O nome pode ter no máximo 120 caracteres.")
        .regex(/[\p{L}\p{N}]/u, "O nome precisa ter letras ou números."),
    ),
  segment: z
    .string()
    .transform(squash)
    .pipe(z.string().max(120, "O segmento pode ter no máximo 120 caracteres.")),
  initials: z.string(),
});

const projectBase = z.object({
  name: z
    .string()
    .transform(squash)
    .pipe(
      z
        .string()
        .min(2, "Informe o nome do projeto (mínimo de 2 caracteres).")
        .max(160, "O nome pode ter no máximo 160 caracteres.")
        .regex(/[\p{L}\p{N}]/u, "O nome precisa ter letras ou números."),
    ),
  description: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(2000, "A descrição pode ter no máximo 2000 caracteres.")),
  status: z.enum(PROJECT_STATUSES, "Escolha um status válido."),
  dueDate: z.string(),
});
const projectCreateSchema = projectBase.extend({ clientId: z.uuid("Escolha o cliente.") });

/** Primeira mensagem de cada campo. */
function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function parseClientInput(input: Record<string, unknown>): ParseResult<ClientInput> {
  const parsed = clientSchema.safeParse({
    name: input.name ?? "",
    segment: input.segment ?? "",
    initials: input.initials ?? "",
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const { name, segment, initials } = parsed.data;
  return { ok: true, data: { name, segment, initials: normalizeInitials(initials) || initialsFromName(name) } };
}

/** Confere se `YYYY-MM-DD` é uma data real (rejeita 2026-02-31). */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** `requireClient: false` na edição: o cliente de um projeto não muda (`clientId` volta vazio). */
export function parseProjectInput(
  input: Record<string, unknown>,
  options: { requireClient: boolean } = { requireClient: true },
): ParseResult<ProjectInput> {
  const raw = {
    name: input.name ?? "",
    description: input.description ?? "",
    status: input.status ?? "ativo",
    dueDate: input.dueDate ?? "",
  };
  const parsed = options.requireClient
    ? projectCreateSchema.safeParse({ ...raw, clientId: input.clientId ?? "" })
    : projectBase.safeParse(raw);
  const errors: FieldErrors = parsed.success ? {} : fieldErrorsOf(parsed.error);
  const rawDue = typeof input.dueDate === "string" ? input.dueDate.trim() : "";
  if (rawDue && !isRealDate(rawDue)) errors.dueDate = "Informe uma data válida.";
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  const { name, description, status } = parsed.data;
  const clientId = "clientId" in parsed.data ? String(parsed.data.clientId) : "";
  return { ok: true, data: { clientId, name, description, status, dueDate: rawDue || null } };
}

export type ClientStatusFilter = "ativos" | "arquivados" | "todos";
export type ProjectStatusFilter = ProjectStatusValue | "todos";

export interface ClientFilters {
  q: string;
  status: ClientStatusFilter;
}

export interface ProjectFilters {
  q: string;
  status: ProjectStatusFilter;
  clientId: string | null;
}

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

const parseQuery = (value: string | string[] | undefined) => squash(first(value)).slice(0, 80);

/** Filtros da URL. Valor desconhecido volta ao padrão (nunca vira erro nem consulta estranha). */
export function parseClientFilters(params: Params): ClientFilters {
  const status = first(params.status);
  return {
    q: parseQuery(params.q),
    status: status === "arquivados" || status === "todos" ? status : "ativos",
  };
}

export function parseProjectFilters(params: Params): ProjectFilters {
  const status = first(params.status);
  const clientId = first(params.cliente);
  return {
    q: parseQuery(params.q),
    status: (PROJECT_STATUSES as readonly string[]).includes(status) ? (status as ProjectStatusValue) : "todos",
    // Aceita só um token simples (letras, números, "_" e "-"). A consulta real ainda exige UUID e ignora o resto;
    // a demonstração usa ids como "c1".
    clientId: /^[A-Za-z0-9_-]{1,64}$/.test(clientId) ? clientId : null,
  };
}
