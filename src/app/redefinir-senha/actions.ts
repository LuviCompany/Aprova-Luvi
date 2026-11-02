"use server";

import { redirect } from "next/navigation";
import { classifyAuthError, MESSAGES } from "@/lib/auth/errors";
import { validateNewPassword } from "@/lib/auth/password";
import { getSessionState } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ResetPasswordState {
  error?: string;
}

export async function updatePasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  if (!isSupabaseConfigured()) return { error: MESSAGES.notConfigured };

  // Só quem chegou por um link válido (sessão de recuperação/convite) pode trocar a senha.
  const state = await getSessionState();
  if (state.kind !== "ok") return { error: MESSAGES.expiredLink };

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const rule = validateNewPassword(password);
  if (rule) return { error: rule };
  if (password !== confirm) return { error: "As senhas não conferem." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    switch (classifyAuthError(error)) {
      case "network":
        return { error: MESSAGES.network };
      case "rate-limit":
        return { error: MESSAGES.rateLimit };
      case "same-password":
        return { error: "A nova senha deve ser diferente da atual." };
      case "weak-password":
        return { error: "Essa senha é considerada fraca. Escolha outra." };
      default:
        return { error: "Não foi possível alterar a senha. Peça um novo link." };
    }
  }

  // Encerra todas as sessões (inclusive de outros dispositivos) e pede novo login.
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login?msg=senha-redefinida");
}
