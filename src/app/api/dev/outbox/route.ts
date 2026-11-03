import { connection } from "next/server";
import { readSimulatedOutbox } from "@/lib/email/provider";

/**
 * Caixa de saída do e-mail SIMULADO, para desenvolvimento e testes de ponta a ponta. Só responde
 * quando EMAIL_PROVIDER=simulated fora de produção; em qualquer outro caso é um 404 vazio.
 */
export async function GET() {
  await connection();
  const messages = readSimulatedOutbox();
  if (!messages) return new Response(null, { status: 404 });
  return Response.json({ messages }, { headers: { "cache-control": "no-store" } });
}
