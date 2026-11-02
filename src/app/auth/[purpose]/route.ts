import { NextResponse, type NextRequest } from "next/server";
import { handleAuthLink, isAuthLinkPurpose } from "@/lib/auth/confirm";

/** /auth/confirm, /auth/recovery e /auth/invite: chegada dos links de e-mail do Supabase Auth. */
export async function GET(request: NextRequest, context: { params: Promise<{ purpose: string }> }) {
  const { purpose } = await context.params;
  if (!isAuthLinkPurpose(purpose)) return new NextResponse(null, { status: 404 });
  return handleAuthLink(request, purpose);
}
