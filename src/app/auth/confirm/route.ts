import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { safeNextPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Destino dos links de e-mail do Supabase Auth (recuperação de senha e convite).
 * Aceita o fluxo por token_hash (modelo de e-mail do projeto) e o fluxo por code (PKCE).
 * Convites e recuperações SEMPRE terminam em /redefinir-senha.
 */
const OTP_TYPES = ["recovery", "invite", "email"] as const;
type OtpType = (typeof OTP_TYPES)[number];

const isOtpType = (value: string | null): value is OtpType =>
  !!value && (OTP_TYPES as readonly string[]).includes(value);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const fail = (reason: string) => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?erro=${reason}`;
    return NextResponse.redirect(url);
  };

  if (!isSupabaseConfigured()) return fail("config");

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  const supabase = await createSupabaseServerClient();

  let ok = false;
  let destination = safeNextPath(searchParams.get("next"), "/login");

  if (tokenHash && isOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
    if (type === "recovery" || type === "invite") destination = "/redefinir-senha";
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  if (!ok) return fail("link-invalido");

  const url = request.nextUrl.clone();
  const target = new URL(destination, request.url);
  url.pathname = target.pathname;
  url.search = target.search;
  return NextResponse.redirect(url);
}
