import { z } from "zod";
import { authorizeStaff } from "@/lib/auth/action-guard";

/**
 * Visualização protegida de um arquivo de material. O HTML nunca carrega o endereço do storage: ele aponta
 * para esta rota, que confere a sessão da equipe, lê o registro do arquivo SOB A RLS (arquivo de outro
 * cliente ou inexistente respondem igual: 404) e só então redireciona para uma URL assinada que vale 60 s.
 * Cada abertura gera uma URL nova; nada é guardado em cache.
 */
const NO_STORE = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };

export async function GET(_request: Request, ctx: RouteContext<"/admin/arquivos/[fileId]">) {
  const { fileId } = await ctx.params;
  if (!z.uuid().safeParse(fileId).success) return new Response(null, { status: 404, headers: NO_STORE });

  const guard = await authorizeStaff();
  if (!guard.ok) return new Response(null, { status: 401, headers: NO_STORE });

  const { data, error } = await guard.supabase.from("material_files").select("storage_path").eq("id", fileId).maybeSingle();
  if (error || !data) return new Response(null, { status: 404, headers: NO_STORE });

  const signed = await guard.supabase.storage.from("materials").createSignedUrl(String(data.storage_path), 60);
  if (signed.error || !signed.data?.signedUrl) return new Response(null, { status: 404, headers: NO_STORE });

  return new Response(null, { status: 302, headers: { ...NO_STORE, location: signed.data.signedUrl } });
}
