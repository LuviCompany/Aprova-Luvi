import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath } from "@/lib/auth/roles";
import { isDemoMode } from "@/lib/env";
import { refreshSession } from "@/lib/supabase/proxy";

/**
 * Primeira barreira de autenticação. Anônimos que pedem áreas protegidas vão para /login.
 * Não decide papéis: isso é da DAL (src/lib/auth/session.ts) e da RLS.
 */
export async function proxy(request: NextRequest) {
  if (isDemoMode()) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const { response, authenticated } = await refreshSession(request);

  if (isProtectedPath(pathname) && !authenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(url);
    // Preserva cookies/cabeçalhos de renovação de sessão eventualmente definidos.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: [
    // Tudo, exceto assets estáticos e imagens.
    "/((?!_next/static|_next/image|brand/|icon.png|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
