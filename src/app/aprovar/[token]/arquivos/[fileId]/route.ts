import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { readSessionId } from "@/lib/link-approval/cookie";
import { signedFileUrl } from "@/lib/link-approval/service";

/**
 * Arquivo de um material no link rápido. Só responde com a sessão verificada DESTE link, e só para arquivos da
 * versão em aprovação desse link (qualquer outro arquivo, link ou sessão inválida: 404 vazio). Redireciona para
 * uma URL assinada de 60 s; nada fica em cache.
 */
const NO_STORE = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };

export async function GET(_request: Request, ctx: RouteContext<"/aprovar/[token]/arquivos/[fileId]">) {
  const { token, fileId } = await ctx.params;
  if (isDemoMode() || !isSupabaseConfigured() || !process.env.APPROVAL_LINK_SECRET) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }
  try {
    const url = await signedFileUrl(token, await readSessionId(token), fileId);
    if (!url) return new Response(null, { status: 404, headers: NO_STORE });
    return new Response(null, { status: 302, headers: { ...NO_STORE, location: url } });
  } catch {
    return new Response(null, { status: 404, headers: NO_STORE });
  }
}
