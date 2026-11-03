// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Decisão e comentário no portal, com Supabase FALSO. O servidor valida a entrada, usa o cliente DO USUÁRIO (RLS)
 * e tira empresa e aprovador do CONTEXTO validado, nunca do que o navegador mandou.
 */

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
let rpcError: { code?: string; message?: string } | null = null;
let insertError: { code?: string; message?: string } | null = null;

const supabase = {
  rpc(fn: string, args: Record<string, unknown>) {
    rpcCalls.push({ fn, args });
    return Promise.resolve({ data: null, error: rpcError });
  },
  from: (table: string) => ({
    insert: (payload: Record<string, unknown>) => {
      inserts.push({ table, payload });
      return Promise.resolve({ error: insertError });
    },
  }),
};

const authorizePortal = vi.fn();
vi.mock("@/lib/auth/portal-guard", () => ({ authorizePortal: () => authorizePortal() }));
vi.mock("@/lib/supabase/admin", () => {
  throw new Error("o portal não pode usar o cliente de chave secreta");
});
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { addCommentAction, decideAction } from "@/app/portal/review-actions";

const REQ = "33333333-3333-4333-8333-333333333333";
const MATERIAL = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const VERSION = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const CLIENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const APPROVER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  rpcCalls.length = 0;
  inserts.length = 0;
  rpcError = null;
  insertError = null;
  vi.clearAllMocks();
  authorizePortal.mockResolvedValue({ ok: true, supabase, user: { id: "u1" }, context: { clientId: CLIENT, approverId: APPROVER, clientName: "Casa" } });
});

describe("decideAction", () => {
  it("aprovar chama decide_as_approver como o usuário, com a nota limpa, e atualiza as telas", async () => {
    expect(await decideAction(REQ, "aprovado", "  ")).toEqual({ ok: true });
    expect(rpcCalls).toEqual([{ fn: "decide_as_approver", args: { p_request_id: REQ, p_decision: "aprovado", p_note: "" } }]);
    expect(revalidatePath).toHaveBeenCalledWith("/portal", "layout");
  });

  it("pedir alteração exige descrição de 10+ caracteres ANTES de chamar o banco", async () => {
    expect((await decideAction(REQ, "alteracao", "curto")).error).toMatch(/mínimo de 10/);
    expect(rpcCalls).toHaveLength(0);
    expect(await decideAction(REQ, "alteracao", "  Trocar a imagem do slide 2  ")).toEqual({ ok: true });
    expect(rpcCalls[0].args.p_note).toBe("Trocar a imagem do slide 2");
  });

  it("entrada inválida (id, decisão) nunca chega ao banco", async () => {
    expect((await decideAction("x", "aprovado", "")).error).toBeTruthy();
    expect((await decideAction(REQ, "talvez" as never, "")).error).toBeTruthy();
    expect(rpcCalls).toHaveLength(0);
  });

  it("decisão repetida/encerrada e falta de permissão viram mensagens claras, sem texto interno", async () => {
    rpcError = { message: "esta solicitação já foi encerrada" };
    expect((await decideAction(REQ, "aprovado", "")).error).toMatch(/já foi respondida/);
    rpcError = { message: "sem permissão para decidir esta solicitação" };
    expect((await decideAction(REQ, "aprovado", "")).error).toMatch(/não pode decidir/);
    rpcError = { code: "42501", message: "permission denied for function decide_as_approver" };
    const result = await decideAction(REQ, "aprovado", "");
    expect(result.error).not.toMatch(/function|decide_as_approver/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sem autorização do portal nada acontece", async () => {
    authorizePortal.mockResolvedValue({ ok: false, error: "Sua sessão expirou. Entre novamente." });
    expect((await decideAction(REQ, "aprovado", "")).error).toMatch(/sessão expirou/);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("addCommentAction", () => {
  it("grava como CLIENTE, com a empresa e o aprovador do contexto (não do navegador)", async () => {
    expect(await addCommentAction(MATERIAL, VERSION, 2, "  Ficou ótimo  ")).toEqual({ ok: true });
    expect(inserts).toEqual([
      {
        table: "comments",
        payload: {
          material_id: MATERIAL,
          version_id: VERSION,
          client_id: CLIENT,
          slide: 2,
          author_role: "cliente",
          author_approver_id: APPROVER,
          body: "Ficou ótimo",
        },
      },
    ]);
  });

  it("valida slide e texto; erro do banco vira mensagem amigável", async () => {
    expect((await addCommentAction(MATERIAL, VERSION, 0, "x")).error).toBeTruthy();
    expect((await addCommentAction(MATERIAL, VERSION, null, "   ")).error).toBeTruthy();
    expect((await addCommentAction("x", VERSION, null, "oi")).error).toBeTruthy();
    expect(inserts).toHaveLength(0);
    insertError = { code: "42501", message: "new row violates row-level security policy for table \"comments\"" };
    const result = await addCommentAction(MATERIAL, VERSION, null, "oi");
    expect(result.error).toMatch(/permissão/);
    expect(result.error).not.toMatch(/comments|row-level/);
  });
});
