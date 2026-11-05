/**
 * Content-Security-Policy do Aprova Luvi, montada em TEMPO DE EXECUÇÃO a partir do ambiente (o proxy a aplica), porque o
 * endereço do Supabase muda entre desenvolvimento, teste e produção e não pode ficar "congelado" na build.
 *
 * O que ela impede, mesmo sem nonce (o Next precisa de scripts em linha): carregar recursos de qualquer origem que não seja
 * o próprio app e o projeto Supabase, enviar dados para outro destino (connect-src, form-action), embutir plugins, trocar o
 * <base> e ser colocada em moldura de outro site. Navegador do usuário conecta no Supabase só para o upload/leitura por URL
 * assinada; o resto passa pelo servidor.
 */
export function buildContentSecurityPolicy(env: NodeJS.ProcessEnv = process.env): string {
  const development = env.NODE_ENV !== "production";
  let supabase = "";
  try {
    supabase = new URL(env.SUPABASE_URL ?? "").origin;
  } catch {
    supabase = "";
  }
  const withSupabase = (base: string) => (supabase ? `${base} ${supabase}` : base);
  return [
    "default-src 'self'",
    // Next injeta scripts de hidratação em linha; em desenvolvimento o React ainda usa eval.
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    withSupabase("img-src 'self' data: blob:"),
    withSupabase("media-src 'self' blob:"),
    withSupabase("connect-src 'self'") + (development ? " ws: wss:" : ""),
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Aplica a CSP (e só ela) a uma resposta. */
export function withSecurityHeaders<T extends Response>(response: T, env: NodeJS.ProcessEnv = process.env): T {
  response.headers.set("Content-Security-Policy", buildContentSecurityPolicy(env));
  return response;
}
