"use server";

import { z } from "zod";
import { classifyAuthError, MESSAGES } from "@/lib/auth/errors";
import { getSiteUrl, isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ForgotPasswordState {
  error?: string;
  sent?: boolean;
}

const schema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) });

export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  if (!isSupabaseConfigured()) return { error: MESSAGES.notConfigured };

  // Sem URL pública válida (produção sem APP_URL https) não se envia link: melhor falhar do que
  // mandar um link para o lugar errado.
  const siteUrl = getSiteUrl();
  if (!siteUrl) return { error: MESSAGES.notConfigured };

  const parsed = schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Informe um e-mail válido." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    // O modelo de e-mail monta o link a partir de {{ .RedirectTo }} (e não do Site URL do projeto),
    // então cada ambiente só envia links para o próprio endereço.
    redirectTo: `${siteUrl}/auth/confirm`,
  });

  if (error) {
    const kind = classifyAuthError(error);
    if (kind === "network") return { error: MESSAGES.network };
    if (kind === "rate-limit") return { error: MESSAGES.rateLimit };
  }
  // Resposta idêntica exista a conta ou não: não revela quais e-mails estão cadastrados.
  return { sent: true };
}
