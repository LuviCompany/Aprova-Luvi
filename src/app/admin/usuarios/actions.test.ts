// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Actions de equipe: a decisão do SERVIDOR (quem pode, o que é validado, o que chega ao serviço). A função SQL de verdade
 * é testada em src/test/db/team-members.test.ts e o serviço em src/lib/invites/team.test.ts.
 */

const getSessionState = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionState: () => getSessionState() }));
const supabaseForUser = { __cliente: "do-usuario" };
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => supabaseForUser }));
vi.mock("@/lib/supabase/admin", () => {
  throw new Error("as ações do painel não podem usar o cliente de chave secreta");
});
const inviteTeamMember = vi.fn();
const resendTeamInvite = vi.fn();
vi.mock("@/lib/invites/team", () => ({
  inviteTeamMember: (...a: unknown[]) => inviteTeamMember(...a),
  resendTeamInvite: (...a: unknown[]) => resendTeamInvite(...a),
}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { inviteTeamMemberAction, resendTeamInviteAction } from "@/app/admin/usuarios/actions";

const USER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const session = (role: string) => ({
  kind: "ok",
  user: { id: USER, email: "pessoa@luvicompany.com.br", name: "Pessoa", initials: "PE", role, organizationId: "0b8f2a6e-5d8c-4a3e-9f57-2f1a3c4d5e6f" },
});
const form = (over: Record<string, string> = {}) => {
  const data = new FormData();
  const fields = { name: "Pessoa Nova", email: "nova@luvicompany.com.br", emailConfirm: "nova@luvicompany.com.br", role: "admin", ...over };
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://projeto-de-teste.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
  delete process.env.APROVA_DEMO_MODE;
  getSessionState.mockResolvedValue(session("admin"));
  inviteTeamMember.mockResolvedValue({ ok: true, mode: "sent" });
  resendTeamInvite.mockResolvedValue({ ok: true, mode: "resent" });
});

describe("inviteTeamMemberAction — autorização (no servidor, mesmo chamando a ação direto)", () => {
  it("administrador ativo convida: o serviço recebe o cliente DO USUÁRIO e os dados já validados", async () => {
    expect(await inviteTeamMemberAction({}, form({ name: "  Pessoa   Nova ", email: "Nova@LuviCompany.com.br", emailConfirm: "nova@luvicompany.com.br", role: "designer" }))).toEqual({ ok: true });
    expect(inviteTeamMember).toHaveBeenCalledWith({
      supabase: supabaseForUser,
      invite: { name: "Pessoa Nova", email: "nova@luvicompany.com.br", role: "designer" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/usuarios");
  });

  it("designer, atendimento e cliente são recusados e o serviço NUNCA é chamado", async () => {
    for (const role of ["designer", "atendimento", "cliente"]) {
      getSessionState.mockResolvedValue(session(role));
      const result = await inviteTeamMemberAction({}, form());
      expect(result.ok, role).toBeUndefined();
      expect(result.error, role).toBeTruthy();
      expect((await resendTeamInviteAction(USER)).error, role).toBeTruthy();
    }
    expect(inviteTeamMember).not.toHaveBeenCalled();
    expect(resendTeamInvite).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sem sessão, sessão expirada, perfil inativo ('sem acesso'), serviço de login fora do ar e demonstração: recusado", async () => {
    for (const state of [{ kind: "anonymous" }, { kind: "no-access" }, { kind: "unavailable" }]) {
      getSessionState.mockResolvedValue(state);
      const result = await inviteTeamMemberAction({}, form());
      expect(result.error, state.kind).toBeTruthy();
    }
    getSessionState.mockResolvedValue(session("admin"));
    process.env.APROVA_DEMO_MODE = "true";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    expect((await inviteTeamMemberAction({}, form())).error).toMatch(/demonstração/);
    expect(inviteTeamMember).not.toHaveBeenCalled();
  });
});

describe("inviteTeamMemberAction — validação no servidor", () => {
  it("nome, e-mail, confirmação e papel inválidos voltam como erro de campo e o serviço não é chamado", async () => {
    const bad = await inviteTeamMemberAction({}, form({ name: "A", email: "x", emailConfirm: "y", role: "cliente" }));
    expect(Object.keys(bad.fieldErrors ?? {}).sort()).toEqual(["email", "name", "role"]);
    const mismatch = await inviteTeamMemberAction({}, form({ emailConfirm: "outra@luvicompany.com.br" }));
    expect(mismatch.fieldErrors?.emailConfirm).toMatch(/não conferem/);
    expect(inviteTeamMember).not.toHaveBeenCalled();
  });

  it("campos forjados (organização, situação) são ignorados: o serviço só recebe nome, e-mail e papel", async () => {
    const data = form();
    data.set("organizationId", "11111111-1111-4111-8111-111111111111");
    data.set("organization_id", "11111111-1111-4111-8111-111111111111");
    data.set("active", "false");
    await inviteTeamMemberAction({}, data);
    const call = inviteTeamMember.mock.calls[0][0] as { invite: Record<string, unknown> };
    expect(Object.keys(call.invite).sort()).toEqual(["email", "name", "role"]);
  });

  it("erro do serviço volta como mensagem; exceção inesperada vira mensagem genérica sem detalhe", async () => {
    inviteTeamMember.mockResolvedValue({ ok: false, error: "Já existe um usuário com este e-mail." });
    expect(await inviteTeamMemberAction({}, form())).toEqual({ error: "Já existe um usuário com este e-mail." });
    inviteTeamMember.mockRejectedValue(new Error("connection refused 10.0.0.1 SECRET"));
    const result = await inviteTeamMemberAction({}, form());
    expect(result.error).toMatch(/Nada foi alterado/);
    expect(JSON.stringify(result)).not.toMatch(/10\.0\.0\.1|SECRET/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("resendTeamInviteAction", () => {
  it("administrador reenvia; id que não é UUID é recusado antes do serviço", async () => {
    expect(await resendTeamInviteAction(USER)).toEqual({ ok: true });
    expect(resendTeamInvite).toHaveBeenCalledWith({ supabase: supabaseForUser, userId: USER });
    expect((await resendTeamInviteAction("não-é-uuid")).error).toBe("Usuário inválido.");
    expect((await resendTeamInviteAction("' or 1=1 --")).error).toBe("Usuário inválido.");
    expect(resendTeamInvite).toHaveBeenCalledTimes(1);
  });

  it("erro do serviço e exceção viram mensagem sem vazar detalhe", async () => {
    resendTeamInvite.mockResolvedValue({ ok: false, error: "Aguarde um minuto antes de reenviar o convite." });
    expect(await resendTeamInviteAction(USER)).toEqual({ error: "Aguarde um minuto antes de reenviar o convite." });
    resendTeamInvite.mockRejectedValue(new Error("boom"));
    expect((await resendTeamInviteAction(USER)).error).toMatch(/Tente novamente/);
  });
});
