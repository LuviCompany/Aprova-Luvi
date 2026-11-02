"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { classifyAuthError, MESSAGES } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/redirect";
import { canAccessPath, homeForRole } from "@/lib/auth/roles";
import { getSessionState } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface LoginState {
  error?: string;
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!isSupabaseConfigured()) return { error: MESSAGES.notConfigured };

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: MESSAGES.invalidInput };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    const kind = classifyAuthError(error);
    if (kind === "network") return { error: MESSAGES.network };
    if (kind === "rate-limit") return { error: MESSAGES.rateLimit };
    // Mesma resposta para e-mail inexistente e senha errada: não permite enumerar contas.
    return { error: MESSAGES.invalidCredentials };
  }

  const state = await getSessionState();
  if (state.kind === "unavailable") return { error: MESSAGES.network };
  if (state.kind !== "ok") {
    await supabase.auth.signOut();
    return { error: MESSAGES.noAccess };
  }

  // O papel real decide o destino; a aba escolhida na tela é só uma dica visual.
  const home = homeForRole(state.user.role);
  const next = safeNextPath(String(formData.get("next") ?? ""), home);
  redirect(canAccessPath(state.user.role, next) ? next : home);
}

export async function signOutAction(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
