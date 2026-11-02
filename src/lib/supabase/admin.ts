import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, requireSecretKey } from "@/lib/env";

/**
 * Cliente com a chave secreta (`sb_secret_…`): IGNORA a RLS. Use somente em código de servidor de
 * confiança (criação de usuários, fluxo de aprovação por link, geração de URLs assinadas),
 * sempre depois de autorizar a operação no próprio código. Nunca importe em componente
 * cliente e nunca repasse o resultado bruto ao navegador.
 */
export function createSupabaseAdminClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase não está configurado (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY).");
  return createClient(config.url, requireSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
