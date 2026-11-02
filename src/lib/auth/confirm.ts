import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Chegada dos links de e-mail do Supabase Auth (recuperação de senha e convite).
 *
 * Funciona nos DOIS formatos de e-mail, então o app não depende de o modelo ter sido editado:
 *  - modelo padrão do Supabase ({{ .ConfirmationURL }}): o Supabase valida o link e devolve o
 *    usuário aqui com `?code=` (fluxo PKCE), que trocamos por sessão;
 *  - modelo do projeto (supabase/templates, {{ .RedirectTo }}?token_hash=…&type=…): validamos o
 *    `token_hash` com verifyOtp.
 *
 * O endereço de chegada diz a finalidade (/auth/recovery, /auth/invite), por isso não é preciso
 * levar `next` na URL: recuperação e convite SEMPRE terminam em /redefinir-senha.
 */
export const AUTH_LINK_PURPOSES = ["confirm", "recovery", "invite"] as const;
export type AuthLinkPurpose = (typeof AUTH_LINK_PURPOSES)[number];

export const isAuthLinkPurpose = (value: string): value is AuthLinkPurpose =>
  (AUTH_LINK_PURPOSES as readonly string[]).includes(value);

const OTP_TYPES = ["recovery", "invite", "email"] as const;
type OtpType = (typeof OTP_TYPES)[number];
const isOtpType = (value: string | null): value is OtpType =>
  !!value && (OTP_TYPES as readonly string[]).includes(value);

export async function handleAuthLink(request: NextRequest, purpose: AuthLinkPurpose): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const redirectTo = (path: string) => {
    const target = new URL(path, request.url);
    const url = request.nextUrl.clone();
    url.pathname = target.pathname;
    url.search = target.search;
    return NextResponse.redirect(url);
  };
  const fail = (reason: string) => redirectTo(`/login?erro=${reason}`);

  if (!isSupabaseConfigured()) return fail("config");

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  const supabase = await createSupabaseServerClient();

  let ok = false;
  let passwordFlow = purpose !== "confirm";

  if (tokenHash && isOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
    if (type === "recovery" || type === "invite") passwordFlow = true;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  if (!ok) return fail("link-invalido");
  return redirectTo(passwordFlow ? "/redefinir-senha" : safeNextPath(searchParams.get("next"), "/login"));
}
