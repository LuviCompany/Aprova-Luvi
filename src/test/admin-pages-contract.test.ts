// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrato das telas Usuários e Histórico: autorização no servidor ANTES de ler qualquer dado, leitura só com o
 * cliente do usuário (RLS), e dados fictícios só dentro do ramo da demonstração. É uma conferência do código-fonte:
 * o comportamento por papel é provado em session.test.ts (requireAdmin) e no E2E.
 */
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const users = read("src/app/admin/usuarios/page.tsx");
const history = read("src/app/admin/historico/page.tsx");
const index = (source: string, text: string) => source.indexOf(text);
const between = (source: string, from: string, to: string) => source.slice(index(source, from), index(source, to));

describe("página Usuários", () => {
  it("exige administrador (requireAdmin) antes de ler qualquer dado, e nunca só requireStaff", () => {
    expect(users).toContain('import { requireAdmin } from "@/lib/auth/session"');
    expect(users).not.toMatch(/requireStaff\(/);
    const guard = index(users, "await requireAdmin()");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(index(users, "listTeamUsers(user.organizationId)"));
    expect(guard).toBeLessThan(index(users, "isDemoMode()"));
  });

  it("lê pela consulta da equipe (RLS, organização da sessão) e não usa a chave secreta", () => {
    expect(users).toContain("listTeamUsers(user.organizationId)");
    expect(users).not.toMatch(/supabase\/admin|createSupabaseAdminClient|SUPABASE_SECRET_KEY/);
  });

  it("os dados fictícios ficam só na função da demonstração e depois da checagem do modo", () => {
    expect(index(users, "if (isDemoMode()) return <UsersDemo />")).toBeLessThan(index(users, "listTeamUsers(user.organizationId)"));
    expect(between(users, "async function UsersContent", "function UsersDemo")).not.toContain("teamUsers");
    expect(users).not.toContain("MockDataNotice");
  });

  it("mostra Cadastrado em e não 'Último acesso' na versão real", () => {
    const real = between(users, "async function UsersContent", "function UsersDemo");
    expect(real).toContain("Cadastrado em");
    expect(real).not.toContain("Último acesso");
  });
});

describe("página Histórico", () => {
  it("exige a equipe, lê pelas decisões reais (RLS) e não usa a chave secreta", () => {
    expect(index(history, "await requireStaff()")).toBeLessThan(index(history, "listStaffDecisions()"));
    expect(history).not.toMatch(/supabase\/admin|createSupabaseAdminClient|SUPABASE_SECRET_KEY/);
  });

  it("os dados fictícios ficam só na função da demonstração e depois da checagem do modo", () => {
    expect(index(history, "if (isDemoMode()) return <HistoryDemo />")).toBeLessThan(index(history, "listStaffDecisions()"));
    const real = between(history, "async function HistoryContent", "function HistoryDemo");
    expect(real).not.toMatch(/clientById\(|materials\.find|\[\.\.\.decisions\]/);
    expect(history).not.toContain("MockDataNotice");
  });

  it("tem estado vazio e estado de erro", () => {
    expect(history).toContain("Nenhuma decisão registrada ainda");
    expect(history).toContain("LoadErrorState");
  });
});

describe("componentes de cliente não puxam os dados fictícios", () => {
  it("material-review e materials-table importam NOW do módulo neutro, não de lib/mock", () => {
    for (const file of ["src/components/material-review.tsx", "src/components/materials-table.tsx"]) {
      const source = read(file);
      expect(source, file).toContain('from "@/lib/demo-now"');
      expect(source, file).not.toMatch(/from "@\/lib\/mock/);
    }
  });

  it("o módulo neutro não importa nada (nem dados fictícios)", () => {
    expect(read("src/lib/demo-now.ts")).not.toMatch(/^import /m);
  });
});

describe("cadastro de membros da equipe (Usuários)", () => {
  const actions = read("src/app/admin/usuarios/actions.ts");

  it("só a versão real da página oferece o cadastro; a demonstração não grava nada", () => {
    const real = between(users, "async function UsersContent", "function UsersDemo");
    expect(real).toContain("<TeamInviteDialog />");
    expect(real).toContain("ResendTeamInviteButton");
    expect(users.slice(users.indexOf("function UsersDemo"))).not.toMatch(/TeamInviteDialog|ResendTeamInviteButton/);
  });

  it("a consulta de convites pendentes só roda depois de exigir administrador", () => {
    expect(index(users, "await requireAdmin()")).toBeLessThan(index(users, "listPendingTeamInvites("));
  });

  it("as ações exigem administrador (authorizeAdmin) ANTES de ler o formulário e não importam o cliente de chave secreta", () => {
    expect(actions).toContain("authorizeAdmin");
    expect(actions).not.toMatch(/authorizeStaff/);
    expect(actions).not.toMatch(/supabase\/admin|createSupabaseAdminClient|SUPABASE_SECRET_KEY/);
    const invite = actions.slice(index(actions, "export async function inviteTeamMemberAction"));
    expect(index(invite, "await authorizeAdmin()")).toBeLessThan(index(invite, "text(formData"));
    const resend = actions.slice(index(actions, "export async function resendTeamInviteAction"));
    expect(index(resend, "await authorizeAdmin()")).toBeLessThan(index(resend, "isUuid(userId)"));
  });

  it("a organização e o papel de quem convida nunca vêm do formulário: só nome, e-mail, confirmação e papel do convidado", () => {
    const code = actions.replace(/\/\*[\s\S]*?\*\//g, ""); // sem os comentários
    expect(code).not.toMatch(/organization/i);
    for (const field of ["name", "email", "emailConfirm", "role"]) expect(code).toContain(`text(formData, "${field}")`);
  });

  it("o serviço usa o cliente DO USUÁRIO para gravar o perfil (função do banco) e a chave secreta só para o Auth", () => {
    const service = read("src/lib/invites/team.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(service).toContain('supabase.rpc("add_team_member"');
    expect(service).toContain('supabase.rpc("reserve_team_invite_resend"');
    expect(service).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/); // nenhuma gravação direta em tabelas com a chave secreta
    expect(service).not.toMatch(/app_metadata|user_metadata/); // o papel nunca vai em metadados do usuário
  });
});
