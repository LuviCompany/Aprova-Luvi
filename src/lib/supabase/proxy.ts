import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/env";

export interface SessionRefresh {
  /** Resposta que carrega os cookies renovados; use-a (ou copie os cookies) ao responder. */
  response: NextResponse;
  /** Claims do JWT já verificado, ou null se não há sessão válida. */
  authenticated: boolean;
}

/**
 * Renova a sessão do Supabase a cada requisição e informa se há usuário autenticado.
 * É só a primeira barreira (redireciona anônimos); a autorização real é feita no servidor
 * por cada página/ação (DAL) e pela RLS no banco.
 */
export async function refreshSession(request: NextRequest): Promise<SessionRefresh> {
  const config = getSupabaseConfig();
  let response = NextResponse.next({ request });
  if (!config) return { response, authenticated: false };

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Respostas com cookies de sessão não podem ser cacheadas por CDN/proxy.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // getClaims valida a assinatura do JWT; nunca confie em getSession() no servidor.
  const { data, error } = await supabase.auth.getClaims();
  return { response, authenticated: !error && !!data?.claims };
}
