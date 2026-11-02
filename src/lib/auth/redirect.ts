/**
 * Valida o destino pós-login (parâmetro "next"). Só aceita caminho interno do próprio app;
 * qualquer outra coisa vira o destino padrão. Evita open redirect e redirecionamento para
 * rotas de autenticação (loop).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  // Tem que ser caminho absoluto interno: começa com "/" e não com "//" ou "/\" (protocol-relative).
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Caracteres de controle e barras invertidas permitem truques em alguns navegadores.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  // Só as áreas autenticadas são destinos válidos.
  if (!/^\/(admin|portal|redefinir-senha)(\/|$|\?|#)/.test(next)) return fallback;
  return next;
}
