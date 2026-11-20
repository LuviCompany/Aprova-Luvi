import { z } from "zod";

/**
 * Convite de membro da EQUIPE (tela Usuários). A validação é do servidor; o navegador só ajuda. O banco valida de novo
 * (public.add_team_member). Aprovadores de clientes (papel `cliente`) NUNCA entram por aqui: têm fluxo próprio.
 */

export const INVITABLE_ROLES = ["admin", "designer", "atendimento"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/** Opções do seletor de papel. Administrador vem pré-selecionado na interface. */
export const INVITABLE_ROLE_OPTIONS: ReadonlyArray<{ value: InvitableRole; label: string; hint: string }> = [
  { value: "admin", label: "Administrador", hint: "Acesso total ao painel, inclusive Usuários e auditoria." },
  { value: "designer", label: "Designer", hint: "Cria e envia materiais; só lê clientes." },
  { value: "atendimento", label: "Atendimento", hint: "Cadastra clientes e aprovadores e envia materiais." },
];
export const DEFAULT_INVITE_ROLE: InvitableRole = "admin";

export const isInvitableRole = (value: unknown): value is InvitableRole =>
  typeof value === "string" && (INVITABLE_ROLES as readonly string[]).includes(value);

export interface TeamInviteData {
  name: string;
  /** Minúsculas e sem espaços nas pontas (o banco exige `email = lower(email)`). */
  email: string;
  role: InvitableRole;
}

export type TeamInviteField = "name" | "email" | "emailConfirm" | "role";
export type TeamInviteFieldErrors = Partial<Record<TeamInviteField, string>>;
export type TeamInviteParse = { ok: true; data: TeamInviteData } | { ok: false; fieldErrors: TeamInviteFieldErrors };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const squash = (value: string) => value.replace(/\s+/g, " ").trim();
export const normalizeTeamEmail = (value: string) => value.trim().toLowerCase();

const nameSchema = z
  .string()
  .transform(squash)
  .pipe(
    z
      .string()
      .min(2, "Informe o nome completo (mínimo de 2 caracteres).")
      .max(120, "O nome pode ter no máximo 120 caracteres.")
      .regex(/[\p{L}\p{N}]/u, "O nome precisa ter letras ou números."),
  );

const emailSchema = z
  .string()
  .transform(normalizeTeamEmail)
  .pipe(z.string().max(254, "O e-mail pode ter no máximo 254 caracteres.").regex(EMAIL, "Informe um e-mail válido."));

export function parseTeamInvite(input: { name?: unknown; email?: unknown; emailConfirm?: unknown; role?: unknown }): TeamInviteParse {
  const fieldErrors: TeamInviteFieldErrors = {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");

  const name = nameSchema.safeParse(text(input.name));
  if (!name.success) fieldErrors.name = name.error.issues[0]?.message ?? "Nome inválido.";

  const email = emailSchema.safeParse(text(input.email));
  if (!email.success) fieldErrors.email = email.error.issues[0]?.message ?? "E-mail inválido.";

  if (email.success && normalizeTeamEmail(text(input.emailConfirm)) !== email.data) {
    fieldErrors.emailConfirm = "Os e-mails não conferem. Digite o mesmo endereço nos dois campos.";
  } else if (!email.success && !text(input.emailConfirm).trim()) {
    fieldErrors.emailConfirm = "Repita o e-mail para confirmar.";
  }

  if (!isInvitableRole(input.role)) fieldErrors.role = "Escolha um papel válido: Administrador, Designer ou Atendimento.";

  if (Object.keys(fieldErrors).length > 0 || !name.success || !email.success || !isInvitableRole(input.role)) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, data: { name: name.data, email: email.data, role: input.role } };
}
