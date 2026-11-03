import { z } from "zod";
import type { FieldErrors, ParseResult } from "@/lib/clients/schema";

/**
 * Regras de entrada de aprovadores (Módulo 3, etapa A.2). Funções puras: os limites espelham as
 * CHECKs de `approvers` no banco, que continua sendo a barreira final.
 */

export interface ApproverInput {
  name: string;
  /** Sempre minúsculas e sem espaços nas pontas (o banco exige `email = lower(email)`). */
  email: string;
  jobTitle: string;
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

/** Mesma regra da CHECK do banco: `^[^@\s]+@[^@\s]+\.[^@\s]+$`. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

const nameSchema = z
  .string()
  .transform(squash)
  .pipe(
    z
      .string()
      .min(2, "Informe o nome do aprovador (mínimo de 2 caracteres).")
      .max(120, "O nome pode ter no máximo 120 caracteres.")
      .regex(/[\p{L}\p{N}]/u, "O nome precisa ter letras ou números."),
  );

const jobTitleSchema = z
  .string()
  .transform(squash)
  .pipe(z.string().max(120, "O cargo pode ter no máximo 120 caracteres."));

const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(
    z
      .string()
      .max(254, "O e-mail pode ter no máximo 254 caracteres.")
      .regex(EMAIL, "Informe um e-mail válido."),
  );

function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/**
 * `requireEmail: false` na edição: o e-mail de um aprovador não muda depois de criado (as decisões
 * e o login dependem dele); o campo nem é enviado e volta vazio.
 */
export function parseApproverInput(
  input: Record<string, unknown>,
  options: { requireEmail: boolean } = { requireEmail: true },
): ParseResult<ApproverInput> {
  const base = z.object({ name: nameSchema, jobTitle: jobTitleSchema });
  const schema = options.requireEmail ? base.extend({ email: emailSchema }) : base;
  const parsed = schema.safeParse({
    name: input.name ?? "",
    jobTitle: input.jobTitle ?? "",
    email: input.email ?? "",
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const data = parsed.data as { name: string; jobTitle: string; email?: string };
  return { ok: true, data: { name: data.name, jobTitle: data.jobTitle, email: data.email ?? "" } };
}

export type AccessStatus = "login" | "convite_preparado" | "convite_enviado" | "so_link";

export const ACCESS_LABEL: Record<AccessStatus, string> = {
  login: "Com acesso ao portal",
  convite_preparado: "Convite preparado (não enviado)",
  convite_enviado: "Convite enviado",
  so_link: "Só por link (sem login)",
};

export type InviteStatusValue = "preparado" | "enviado" | "aceito" | "revogado" | "expirado";

/** Estado de acesso de um aprovador, a partir do login ligado e do convite em aberto (se houver). */
export function accessStatus(hasLogin: boolean, openInvite: InviteStatusValue | null): AccessStatus {
  if (hasLogin) return "login";
  if (openInvite === "enviado") return "convite_enviado";
  if (openInvite === "preparado") return "convite_preparado";
  return "so_link";
}
