export interface AuthErrorLike {
  name?: string;
  status?: number;
  code?: string;
}

export type AuthFailure = "network" | "rate-limit" | "same-password" | "weak-password" | "other";

/** Traduz o erro do Supabase Auth numa categoria; as mensagens ao usuário ficam nas ações. */
export function classifyAuthError(error: AuthErrorLike | null | undefined): AuthFailure {
  if (!error) return "other";
  if (error.status === 429 || error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit") {
    return "rate-limit";
  }
  if (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    (typeof error.status === "number" && error.status >= 500)
  ) {
    return "network";
  }
  if (error.code === "same_password") return "same-password";
  if (error.code === "weak_password") return "weak-password";
  return "other";
}

export const MESSAGES = {
  invalidCredentials: "E-mail ou senha incorretos.",
  invalidInput: "Informe um e-mail válido e a senha.",
  network: "Não foi possível falar com o serviço de autenticação. Tente novamente em instantes.",
  rateLimit: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.",
  notConfigured: "O ambiente ainda não foi configurado. Fale com a equipe da Luvi.",
  noAccess: "Sua conta não tem acesso ativo. Fale com a equipe da Luvi.",
  expiredLink: "Este link expirou ou já foi usado. Peça um novo.",
} as const;
