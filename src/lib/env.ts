/**
 * Leitura central das variáveis de ambiente.
 *
 * As chaves do Supabase ficam em variáveis SEM prefixo NEXT_PUBLIC_: o navegador nunca fala
 * com o Supabase diretamente (toda autenticação passa por Server Actions e rotas do servidor),
 * então nada precisa ir ao bundle do cliente. Isso também permite trocar a configuração sem
 * rebuild.
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function getSupabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig | null {
  const url = env.SUPABASE_URL?.trim();
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      return null;
    }
  } catch {
    return null;
  }
  return { url, anonKey };
}

export function isSupabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getSupabaseConfig(env) !== null;
}

/**
 * Modo demonstração (Fase 1): login fictício e dados de exemplo. Exige opt-in explícito E a
 * ausência de configuração do Supabase. Configurar o Supabase desliga a demonstração
 * automaticamente, então o login fictício nunca convive com usuários reais.
 */
export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APROVA_DEMO_MODE === "true" && !isSupabaseConfigured(env);
}

/** URL pública do app, usada em e-mails e redirecionamentos de autenticação. */
export function getSiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Variável de ambiente ausente: ${name}`);
    this.name = "MissingEnvError";
  }
}

/** Chave de serviço: somente servidor. Falha alto se faltar. */
export function requireServiceRoleKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new MissingEnvError("SUPABASE_SERVICE_ROLE_KEY");
  return key;
}
