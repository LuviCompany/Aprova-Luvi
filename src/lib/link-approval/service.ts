import "server-only";
import { z } from "zod";
import { loadReview, type ReviewData } from "@/lib/approval/review";
import { hashToken, isPlausibleToken } from "@/lib/approval/token";
import { requireLinkSecret } from "@/lib/env";
import { sendEmail } from "@/lib/email/provider";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CODE_PATTERN, SESSION_ID_PATTERN, codeHash, generateCode, generateSessionId, ipHash, sessionHash } from "./crypto";
import { allow } from "./rate-limit";

/**
 * Aprovação por link rápido (sem login). ÚNICA área do app, junto com a página /aprovar, que usa a chave
 * secreta (service_role) — porque, por natureza, não existe usuário logado. Por isso:
 *  - o banco só entrega o que o servidor pede através de funções que revalidam TUDO (link ativo, solicitação
 *    aberta, última versão, sessão verificada); o navegador nunca fala com o banco;
 *  - toda leitura de dados do material é escopada pelos ids que a função de contexto devolveu;
 *  - tokens, códigos e identificadores de sessão nunca são registrados em log.
 */

export type LinkProblem = "invalid" | "revoked" | "expired" | "used" | "closed";
const PROBLEMS = ["invalid", "revoked", "expired", "used", "closed"] as const;

const problemSchema = z.object({ status: z.enum(PROBLEMS) });
const resolveSchema = z.union([
  z.object({ status: z.literal("ok"), client_name: z.string(), email_hint: z.string() }),
  problemSchema,
]);

export type ResolveResult = { status: "ok"; clientName: string; emailHint: string } | { status: LinkProblem };

function admin() {
  return createSupabaseAdminClient();
}

const fail = (): never => {
  throw new Error("Falha ao consultar o link.");
};

export async function resolveLink(token: string): Promise<ResolveResult> {
  if (!isPlausibleToken(token)) return { status: "invalid" };
  const { data, error } = await admin().rpc("link_resolve", { p_token_hash: hashToken(token) });
  if (error) fail();
  const parsed = resolveSchema.safeParse(data);
  if (!parsed.success) return fail();
  return parsed.data.status === "ok"
    ? { status: "ok", clientName: parsed.data.client_name, emailHint: parsed.data.email_hint }
    : { status: parsed.data.status };
}

export type IssueCodeResult =
  | { status: "sent" }
  | { status: "cooldown" | "limit" | "email_failed" | "email_unavailable" }
  | { status: LinkProblem };

const issueSchema = z.union([
  z.object({ status: z.literal("ok"), email: z.string(), approver_name: z.string() }),
  z.object({ status: z.enum(["cooldown", "limit"]) }),
  problemSchema,
]);

/** Gera e envia por e-mail o código de verificação deste link (6 dígitos; só o HMAC fica no banco). */
export async function issueCode(token: string, clientIp: string): Promise<IssueCodeResult> {
  if (!isPlausibleToken(token)) return { status: "invalid" };
  const secret = requireLinkSecret();
  if (!allow(`issue:${ipHash(secret, clientIp)}`, 10, 60 * 60 * 1000)) return { status: "limit" };

  const tokenHash = hashToken(token);
  const code = generateCode();
  const { data, error } = await admin().rpc("link_issue_code", {
    p_token_hash: tokenHash,
    p_code_hash: codeHash(secret, tokenHash, code),
  });
  if (error) fail();
  const parsed = issueSchema.safeParse(data);
  if (!parsed.success) return fail();
  if (parsed.data.status !== "ok") return { status: parsed.data.status };

  const sent = await sendEmail({
    to: parsed.data.email,
    subject: "Seu código de verificação · Aprova Luvi",
    text: `Olá, ${parsed.data.approver_name}!\n\nSeu código de verificação é: ${code}\n\nEle vale por 10 minutos. Se você não pediu este código, ignore esta mensagem.`,
  });
  if (!sent.ok) return { status: sent.reason === "not_configured" ? "email_unavailable" : "email_failed" };
  return { status: "sent" };
}

export type VerifyResult =
  | { status: "ok"; sessionId: string }
  | { status: "invalid_code"; remaining: number }
  | { status: "locked" | "no_code" | "limit" | "bad_format" }
  | { status: LinkProblem };

const verifySchema = z.union([
  z.object({ status: z.literal("ok") }),
  z.object({ status: z.literal("invalid_code"), remaining: z.number() }),
  z.object({ status: z.enum(["locked", "no_code"]) }),
  problemSchema,
]);

/** Confere o código. Em caso de acerto cria a sessão do link (o identificador vai num cookie httpOnly). */
export async function verifyCode(token: string, code: string, clientIp: string): Promise<VerifyResult> {
  if (!isPlausibleToken(token)) return { status: "invalid" };
  if (!CODE_PATTERN.test(code)) return { status: "bad_format" };
  const secret = requireLinkSecret();
  if (!allow(`verify:${ipHash(secret, clientIp)}`, 30, 10 * 60 * 1000)) return { status: "limit" };

  const tokenHash = hashToken(token);
  const sessionId = generateSessionId();
  const { data, error } = await admin().rpc("link_verify_code", {
    p_token_hash: tokenHash,
    p_code_hash: codeHash(secret, tokenHash, code),
    p_session_hash: sessionHash(secret, sessionId),
  });
  if (error) fail();
  const parsed = verifySchema.safeParse(data);
  if (!parsed.success) return fail();
  if (parsed.data.status === "ok") return { status: "ok", sessionId };
  return parsed.data;
}

export interface LinkContext {
  linkId: string;
  requestId: string;
  materialId: string;
  versionId: string;
  clientId: string;
  approverId: string;
  approverName: string;
  dueAt: string | null;
}

const contextSchema = z.union([
  z.object({
    status: z.literal("ok"),
    link_id: z.uuid(),
    request_id: z.uuid(),
    material_id: z.uuid(),
    version_id: z.uuid(),
    client_id: z.uuid(),
    approver_id: z.uuid(),
    approver_name: z.string(),
    due_at: z.string().nullable(),
  }),
  z.object({ status: z.literal("no_session") }),
  problemSchema,
]);

export type ContextResult = { status: "ok"; context: LinkContext } | { status: "no_session" } | { status: LinkProblem };

/** Token + sessão verificada => identidade e escopo do link. É a porta de entrada de TODA leitura/decisão. */
export async function getLinkContext(token: string, sessionId: string | undefined): Promise<ContextResult> {
  if (!isPlausibleToken(token)) return { status: "invalid" };
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
    const resolved = await resolveLink(token);
    return resolved.status === "ok" ? { status: "no_session" } : { status: resolved.status };
  }
  const secret = requireLinkSecret();
  const { data, error } = await admin().rpc("link_session_context", {
    p_token_hash: hashToken(token),
    p_session_hash: sessionHash(secret, sessionId),
  });
  if (error) fail();
  const parsed = contextSchema.safeParse(data);
  if (!parsed.success) return fail();
  const row = parsed.data;
  if (row.status !== "ok") return { status: row.status };
  return {
    status: "ok",
    context: {
      linkId: row.link_id,
      requestId: row.request_id,
      materialId: row.material_id,
      versionId: row.version_id,
      clientId: row.client_id,
      approverId: row.approver_id,
      approverName: row.approver_name,
      dueAt: row.due_at,
    },
  };
}

export interface LinkReview {
  review: ReviewData;
  status: "rascunho" | "aguardando" | "alteracao" | "aprovado";
}

export async function loadLinkReview(context: LinkContext): Promise<LinkReview> {
  const db = admin();
  const review = await loadReview(db, {
    materialId: context.materialId,
    versionId: context.versionId,
    clientId: context.clientId,
    approverId: context.approverId,
  });
  const material = await db.from("materials").select("status").eq("id", context.materialId).eq("client_id", context.clientId).maybeSingle();
  const status = z.enum(["rascunho", "aguardando", "alteracao", "aprovado"]).safeParse(material.data?.status);
  if (material.error || !status.success) fail();
  return { review, status: status.data! };
}

export type DecideResult = { ok: true } | { ok: false; error: string };

/** Decisão por link: o banco revalida link, solicitação, versão e sessão sob bloqueio e grava a decisão imutável. */
export async function decideViaLink(
  token: string,
  sessionId: string | undefined,
  decision: "aprovado" | "alteracao",
  note: string,
  clientIp: string,
  userAgent: string,
): Promise<DecideResult> {
  if (!isPlausibleToken(token) || !sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
    return { ok: false, error: "Sua verificação expirou. Peça um novo código." };
  }
  const secret = requireLinkSecret();
  const { error } = await admin().rpc("decide_with_link_session", {
    p_token_hash: hashToken(token),
    p_session_hash: sessionHash(secret, sessionId),
    p_decision: decision,
    p_note: note,
    p_ip_hash: ipHash(secret, clientIp),
    p_user_agent: userAgent.slice(0, 300),
  });
  if (!error) return { ok: true };
  const text = error.message ?? "";
  if (/sessão/i.test(text)) return { ok: false, error: "Sua verificação expirou. Peça um novo código." };
  if (/link indisponível/i.test(text)) return { ok: false, error: "Este link não está mais disponível. Fale com a equipe da Luvi." };
  if (/encerrada|não está mais em aprovação/i.test(text)) return { ok: false, error: "Esta solicitação já foi respondida ou encerrada." };
  return { ok: false, error: "Não foi possível registrar a decisão. Tente novamente." };
}

/** URL assinada (60 s) de um arquivo, SÓ se ele pertence à versão do link verificado. */
export async function signedFileUrl(token: string, sessionId: string | undefined, fileId: string): Promise<string | null> {
  if (!z.uuid().safeParse(fileId).success) return null;
  const result = await getLinkContext(token, sessionId);
  if (result.status !== "ok") return null;
  const db = admin();
  const { data, error } = await db
    .from("material_files")
    .select("storage_path")
    .eq("id", fileId)
    .eq("version_id", result.context.versionId)
    .eq("client_id", result.context.clientId)
    .maybeSingle();
  if (error || !data) return null;
  const signed = await db.storage.from("materials").createSignedUrl(String(data.storage_path), 60);
  return signed.error || !signed.data?.signedUrl ? null : signed.data.signedUrl;
}
