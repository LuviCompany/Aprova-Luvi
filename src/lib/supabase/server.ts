import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/lib/env";

/**
 * Cliente Supabase do usuário logado (chave anon + cookies de sessão). Toda consulta passa
 * pela RLS com a identidade dele. Crie um cliente novo por requisição; nunca compartilhe.
 */
export async function createSupabaseServerClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase não está configurado (SUPABASE_URL / SUPABASE_ANON_KEY).");
  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Chamado de um Server Component (cookies somente leitura): o proxy já renova a sessão.
        }
      },
    },
  });
}
