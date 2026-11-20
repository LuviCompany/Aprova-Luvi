// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Convite de membros da equipe com banco/Auth e e-mail FALSOS: a ordem (e-mail por último), o desfazer de falhas parciais,
 * o duplicado, o reenvio só para quem não aceitou, e a garantia de que o link só vai no e-mail e a chave nunca sai do servidor.
 * As regras do banco (administrador, organização, papel, id/e-mail do Auth, auditoria) estão em src/test/db/team-members.test.ts.
 */

type Rpc = { fn: string; args: Record<string, unknown> };
const authCalls: Array<{ fn: string; args: unknown }> = [];
const dbWrites: string[] = [];
const rpcs: Rpc[] = [];
let existingProfile: { id: string } | null = null;
let existingLookupError = false;
let generateResult: { data: unknown; error: { message: string } | null };
let authUser: { email_confirmed_at: string | null; last_sign_in_at: string | null } | null;
let authLookupError = false;
let rpcResult: Record<string, { data: unknown; error: { code?: string; message?: string } | null }>;
let visibleProfile: { id: string; role: string } | null;

const USER = "12b162d2-1d66-4ae9-a98b-170edd476397";

const fakeAdmin = {
  from: (table: string) => {
    const filters: unknown[] = [];
    const b: Record<string, unknown> = {
      select: () => b,
      delete: () => {
        dbWrites.push(`${table}.delete`);
        return b;
      },
      eq: (_c: string, v: unknown) => {
        filters.push(v);
        return b;
      },
      maybeSingle: () => Promise.resolve(existingLookupError ? { data: null, error: { message: "falha" } } : { data: existingProfile, error: null }),
      then: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };
    return b;
  },
  auth: {
    admin: {
      generateLink: async (args: { type: string }) => {
        authCalls.push({ fn: "generateLink", args });
        return generateResult;
      },
      deleteUser: async (id: string) => {
        authCalls.push({ fn: "deleteUser", args: id });
        return { error: null };
      },
      getUserById: async (id: string) => {
        authCalls.push({ fn: "getUserById", args: id });
        return authLookupError ? { data: { user: null }, error: { message: "x" } } : { data: { user: authUser }, error: null };
      },
    },
  },
};
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fakeAdmin }));
const sendEmail = vi.fn();
vi.mock("@/lib/email/provider", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

/** Cliente DO USUÁRIO (administrador): chama as funções do banco e lê perfis sob a RLS. */
const userClient = {
  rpc: async (fn: string, args: Record<string, unknown>) => {
    rpcs.push({ fn, args });
    return rpcResult[fn] ?? { data: null, error: null };
  },
  from: () => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      maybeSingle: () => Promise.resolve({ data: visibleProfile, error: null }),
    };
    return b;
  },
};

import { inviteTeamMember, listPendingTeamInvites, resendTeamInvite } from "@/lib/invites/team";

const SAVED = { ...process.env };
const INVITE = { name: "Pessoa Nova", email: "nova@luvicompany.com.br", role: "admin" as const };
const supabase = userClient as never;

beforeEach(() => {
  vi.clearAllMocks();
  authCalls.length = 0;
  dbWrites.length = 0;
  rpcs.length = 0;
  existingProfile = null;
  existingLookupError = false;
  authLookupError = false;
  authUser = { email_confirmed_at: null, last_sign_in_at: null };
  visibleProfile = { id: USER, role: "designer" };
  generateResult = { data: { user: { id: USER }, properties: { hashed_token: "hash-do-token-de-teste" } }, error: null };
  rpcResult = {
    add_team_member: { data: USER, error: null },
    reserve_team_invite_resend: { data: [{ r_full_name: "Pessoa Nova", r_email: "nova@luvicompany.com.br", r_role: "designer" }], error: null },
  };
  process.env.EMAIL_PROVIDER = "simulated";
  process.env.APP_URL = "http://localhost:3000";
  sendEmail.mockResolvedValue({ ok: true, provider: "simulated" });
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("inviteTeamMember — envio", () => {
  it("cria o usuário no Auth, o perfil PELO BANCO com a sessão do administrador e manda o e-mail UMA vez", async () => {
    expect(await inviteTeamMember({ supabase, invite: INVITE })).toEqual({ ok: true, mode: "sent" });
    expect(authCalls.map((c) => c.fn)).toEqual(["generateLink"]);
    expect((authCalls[0].args as { type: string; email: string }).type).toBe("invite");
    expect(rpcs).toEqual([{ fn: "add_team_member", args: { p_user_id: USER, p_full_name: "Pessoa Nova", p_email: "nova@luvicompany.com.br", p_role: "admin" } }]);
    expect(dbWrites).toEqual([]); // com a chave secreta nada é gravado em tabelas: o perfil entra pela função do banco
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0] as { to: string; subject: string; text: string; html: string; idempotencyKey: string };
    expect(mail.to).toBe("nova@luvicompany.com.br");
    expect(mail.idempotencyKey).toBe(`team-invite-${USER}`);
    expect(mail.text).toContain("/auth/invite?token_hash=hash-do-token-de-teste&type=invite");
    expect(mail.text).toContain("Administrador");
  });

  it("o redirecionamento do convite é o /auth/invite do site e o nome vai nos metadados do usuário", async () => {
    await inviteTeamMember({ supabase, invite: INVITE });
    const args = authCalls[0].args as { options: { redirectTo: string; data: Record<string, unknown> } };
    expect(args.options.redirectTo).toBe("http://localhost:3000/auth/invite");
    expect(args.options.data).toEqual({ full_name: "Pessoa Nova" });
    expect(JSON.stringify(args)).not.toMatch(/role|password|senha/i); // o papel nunca vai em metadados do usuário (o usuário poderia editá-los)
  });

  it("o link só aparece no e-mail: nunca no retorno nem em console", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    logs.forEach((l) => l.mockImplementation(() => {}));
    const result = await inviteTeamMember({ supabase, invite: INVITE });
    expect(JSON.stringify(result)).not.toMatch(/token|http|auth\/invite/);
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/hash-do-token|token_hash/);
    logs.forEach((l) => l.mockRestore());
  });

  it("aceita Designer e Atendimento; recusa papel fora da lista (inclusive cliente) ANTES de qualquer chamada", async () => {
    for (const role of ["designer", "atendimento"] as const) expect((await inviteTeamMember({ supabase, invite: { ...INVITE, role } })).ok).toBe(true);
    authCalls.length = 0;
    rpcs.length = 0;
    for (const role of ["cliente", "superadmin", ""]) {
      const result = await inviteTeamMember({ supabase, invite: { ...INVITE, role: role as never } });
      expect(result.ok).toBe(false);
    }
    expect(authCalls).toEqual([]);
    expect(rpcs).toEqual([]);
  });

  it("e-mail que já tem perfil (equipe ou aprovador) é recusado sem tocar no Auth", async () => {
    existingProfile = { id: "outro" };
    expect(await inviteTeamMember({ supabase, invite: INVITE })).toEqual({ ok: false, error: "Já existe um usuário com este e-mail." });
    expect(authCalls).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("conta do Auth já ativada é recusada pelo Auth e nada é criado nem apagado", async () => {
    generateResult = { data: null, error: { message: "A user with this email address has already been registered" } };
    const result = await inviteTeamMember({ supabase, invite: INVITE });
    expect(result).toEqual({ ok: false, error: "Este e-mail já tem uma conta ativa. Use outro endereço." });
    expect(authCalls.map((c) => c.fn)).toEqual(["generateLink"]); // sem deleteUser: não apaga conta que não é nossa
    expect(rpcs).toEqual([]);
  });

  it("sem e-mail configurado ou sem APP_URL: falha ANTES de criar qualquer coisa", async () => {
    process.env.EMAIL_PROVIDER = "";
    expect((await inviteTeamMember({ supabase, invite: INVITE })).ok).toBe(false);
    // Produção com e-mail configurado, mas sem APP_URL: o link não pode ser montado (em desenvolvimento há um padrão local).
    vi.stubEnv("NODE_ENV", "production");
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_chave_de_teste_" + "x".repeat(20);
    process.env.EMAIL_FROM = "Aprova Luvi <aprova@exemplo.test>";
    process.env.APP_URL = "";
    const noSite = await inviteTeamMember({ supabase, invite: INVITE });
    expect(noSite).toEqual({ ok: false, error: "APP_URL não está configurada: o link do convite não pode ser montado." });
    vi.unstubAllEnvs();
    expect(authCalls).toEqual([]);
    expect(rpcs).toEqual([]);
  });

  describe("falhas parciais (desfaz tudo, sem conta nem perfil órfãos)", () => {
    it("o banco recusa o perfil (não é administrador): apaga só o usuário do Auth que acabou de ser criado", async () => {
      rpcResult.add_team_member = { data: null, error: { code: "42501", message: "sem permissão" } };
      const result = await inviteTeamMember({ supabase, invite: INVITE });
      expect(result).toEqual({ ok: false, error: "Só administradores ativos podem convidar pessoas da equipe." });
      expect(authCalls.map((c) => c.fn)).toEqual(["generateLink", "deleteUser"]);
      expect(dbWrites).toEqual([]); // o perfil nunca existiu
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("duplicado detectado pelo banco (corrida): mensagem clara e o usuário do Auth é desfeito", async () => {
      rpcResult.add_team_member = { data: null, error: { code: "23505", message: "duplicate key" } };
      expect(await inviteTeamMember({ supabase, invite: INVITE })).toEqual({ ok: false, error: "Já existe um usuário com este e-mail." });
      expect(authCalls.map((c) => c.fn)).toEqual(["generateLink", "deleteUser"]);
    });

    it("o e-mail falha: apaga o perfil e o usuário do Auth, nessa ordem", async () => {
      sendEmail.mockResolvedValue({ ok: false, reason: "rejected" });
      const result = await inviteTeamMember({ supabase, invite: INVITE });
      expect(result.ok).toBe(false);
      expect(dbWrites).toEqual(["profiles.delete"]);
      expect(authCalls.map((c) => c.fn)).toEqual(["generateLink", "deleteUser"]);
      expect(rpcs).toHaveLength(1);
    });

    it("erro inesperado do banco nunca vaza detalhe técnico", async () => {
      rpcResult.add_team_member = { data: null, error: { code: "XX000", message: "relation public.profiles ... SECRET detail" } };
      const result = await inviteTeamMember({ supabase, invite: INVITE });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/relation|SECRET|XX000/);
    });
  });
});

describe("resendTeamInvite — reenvio", () => {
  it("só para quem não aceitou: reserva no banco (administrador, organização, 1 por minuto), gera o novo link e manda o e-mail", async () => {
    expect(await resendTeamInvite({ supabase, userId: USER })).toEqual({ ok: true, mode: "resent" });
    expect(rpcs).toEqual([{ fn: "reserve_team_invite_resend", args: { p_user_id: USER } }]);
    expect(authCalls.map((c) => c.fn)).toEqual(["getUserById", "generateLink"]);
    expect((authCalls[1].args as { type: string }).type).toBe("recovery");
    const mail = sendEmail.mock.calls[0][0] as { to: string; text: string; subject: string };
    expect(mail.to).toBe("nova@luvicompany.com.br");
    expect(mail.text).toContain("/auth/recovery?token_hash=hash-do-token-de-teste&type=recovery");
    expect(mail.subject).toMatch(/Novo link/);
  });

  it("quem já aceitou (e-mail confirmado ou já entrou) NÃO recebe reenvio e nada é reservado", async () => {
    for (const user of [
      { email_confirmed_at: "2026-11-20T12:00:00Z", last_sign_in_at: null },
      { email_confirmed_at: null, last_sign_in_at: "2026-11-20T12:00:00Z" },
    ]) {
      authUser = user;
      const result = await resendTeamInvite({ supabase, userId: USER });
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toMatch(/já aceitou o convite/);
    }
    expect(rpcs).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("dentro do intervalo de 1 minuto o banco recusa e nenhum e-mail sai", async () => {
    rpcResult.reserve_team_invite_resend = { data: null, error: { code: "P0001", message: "aguarde um minuto antes de reenviar o convite" } };
    expect(await resendTeamInvite({ supabase, userId: USER })).toEqual({ ok: false, error: "Aguarde um minuto antes de reenviar o convite." });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(authCalls.map((c) => c.fn)).toEqual(["getUserById"]); // nenhum link novo é gerado
  });

  it("pessoa fora da equipe, de outra organização ou aprovador de cliente: 'não encontrado' sem consultar o Auth", async () => {
    visibleProfile = null;
    expect(await resendTeamInvite({ supabase, userId: USER })).toEqual({ ok: false, error: "Usuário não encontrado." });
    visibleProfile = { id: USER, role: "cliente" };
    expect(await resendTeamInvite({ supabase, userId: USER })).toEqual({ ok: false, error: "Usuário não encontrado." });
    expect(authCalls).toEqual([]);
    expect(rpcs).toEqual([]);
  });

  it("não administrador chamando direto: o banco recusa (42501) e nada é enviado", async () => {
    rpcResult.reserve_team_invite_resend = { data: null, error: { code: "42501", message: "sem permissão" } };
    expect((await resendTeamInvite({ supabase, userId: USER })).ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("falha ao consultar o Auth ou ao enviar o e-mail: erro claro, link nunca devolvido", async () => {
    authLookupError = true;
    expect((await resendTeamInvite({ supabase, userId: USER })).ok).toBe(false);
    authLookupError = false;
    sendEmail.mockResolvedValue({ ok: false, reason: "failed" });
    const result = await resendTeamInvite({ supabase, userId: USER });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/token|auth\/recovery/);
  });
});

describe("listPendingTeamInvites", () => {
  it("devolve só quem nunca confirmou o e-mail nem entrou", async () => {
    authUser = { email_confirmed_at: null, last_sign_in_at: null };
    expect([...(await listPendingTeamInvites([USER]))]).toEqual([USER]);
    authUser = { email_confirmed_at: "2026-11-20T12:00:00Z", last_sign_in_at: null };
    expect((await listPendingTeamInvites([USER])).size).toBe(0);
  });

  it("falha na consulta não derruba a tela: ninguém aparece como pendente", async () => {
    authLookupError = true;
    expect((await listPendingTeamInvites([USER])).size).toBe(0);
    expect((await listPendingTeamInvites([])).size).toBe(0);
  });
});
