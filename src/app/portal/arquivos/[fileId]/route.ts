import { z } from "zod";
import { authorizePortal } from "@/lib/auth/portal-guard";

/**
 * Visualização protegida de um arquivo no portal. A página nunca carrega o endereço do storage: ela aponta
 * para esta rota, que confere a sessão do aprovador e a empresa escolhida, lê o registro do arquivo SOB A RLS
 * (arquivo de outra empresa, de versão ainda não enviada ou inexistente respondem igual: 404) e só então
 * redireciona para uma URL assinada que vale 60 s. Cada abertura gera uma URL nova; nada fica em cache.
 */
const NO_STORE = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };

export async function GET(_request: Request, ctx: RouteContext<"/portal/arquivos/[fileId]">) {
  const { fileId } = await ctx.params;
  if (!z.uuid().safeParse(fileId).success) return new Response(null, { status: 404, headers: NO_STORE });

  const guard = await authorizePortal();
  if (!guard.ok) return new Response(null, { status: 401, headers: NO_STORE });

  const { data, error } = await guard.supabase
    .from("material_files")
    .select("storage_path")
    .eq("id", fileId)
    .eq("client_id", guard.context.clientId)
    .maybeSingle();
  if (error || !data) return new Response(null, { status: 404, headers: NO_STORE });

  const signed = await guard.supabase.storage.from("materials").createSignedUrl(String(data.storage_path), 60);
  if (signed.error || !signed.data?.signedUrl) return new Response(null, { status: 404, headers: NO_STORE });

  return new Response(null, { status: 302, headers: { ...NO_STORE, location: signed.data.signedUrl } });
}
