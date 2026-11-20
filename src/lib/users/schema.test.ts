// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_INVITE_ROLE, INVITABLE_ROLES, INVITABLE_ROLE_OPTIONS, isInvitableRole, parseTeamInvite } from "./schema";

const valid = { name: "Pessoa Nova", email: "nova@luvicompany.com.br", emailConfirm: "nova@luvicompany.com.br", role: "admin" };

describe("parseTeamInvite", () => {
  it("aceita dados válidos e normaliza nome (espaços) e e-mail (minúsculas, sem espaços nas pontas)", () => {
    const result = parseTeamInvite({ name: "  Pessoa   Nova  ", email: "  Nova@LuviCompany.com.br ", emailConfirm: "nova@luvicompany.com.br", role: "designer" });
    expect(result).toEqual({ ok: true, data: { name: "Pessoa Nova", email: "nova@luvicompany.com.br", role: "designer" } });
  });

  it("os três papéis da equipe passam; Administrador é o padrão da interface", () => {
    for (const role of INVITABLE_ROLES) expect(parseTeamInvite({ ...valid, role }).ok, role).toBe(true);
    expect(DEFAULT_INVITE_ROLE).toBe("admin");
    expect(INVITABLE_ROLE_OPTIONS.map((o) => o.label)).toEqual(["Administrador", "Designer", "Atendimento"]);
  });

  it("recusa papel fora da lista, inclusive 'cliente' (aprovador tem fluxo próprio) e valores vazios ou forjados", () => {
    for (const role of ["cliente", "superadmin", "", "ADMIN", "admin ", undefined, null, 1, ["admin"]]) {
      const result = parseTeamInvite({ ...valid, role });
      expect(result.ok, String(role)).toBe(false);
      if (!result.ok) expect(result.fieldErrors.role).toBeDefined();
    }
    expect(isInvitableRole("cliente")).toBe(false);
  });

  it("nome: mínimo de 2, máximo de 120 e precisa de letra ou número", () => {
    for (const name of ["", " ", "A", "x".repeat(121), "!!!", undefined]) {
      const result = parseTeamInvite({ ...valid, name });
      expect(result.ok, String(name)).toBe(false);
      if (!result.ok) expect(result.fieldErrors.name).toBeDefined();
    }
    expect(parseTeamInvite({ ...valid, name: "x".repeat(120) }).ok).toBe(true);
  });

  it("e-mail inválido ou longo demais é recusado", () => {
    for (const email of ["", "sem-arroba", "a@b", "a b@c.com", "@x.com", `${"a".repeat(250)}@x.com`]) {
      const result = parseTeamInvite({ ...valid, email, emailConfirm: email });
      expect(result.ok, email).toBe(false);
      if (!result.ok) expect(result.fieldErrors.email).toBeDefined();
    }
  });

  it("a confirmação do e-mail precisa ser igual (sem diferenciar maiúsculas)", () => {
    expect(parseTeamInvite({ ...valid, emailConfirm: "NOVA@luvicompany.com.br" }).ok).toBe(true);
    const diff = parseTeamInvite({ ...valid, emailConfirm: "nova@luvicompany.com" });
    expect(diff.ok).toBe(false);
    if (!diff.ok) expect(diff.fieldErrors.emailConfirm).toMatch(/não conferem/);
    const empty = parseTeamInvite({ ...valid, emailConfirm: "" });
    expect(empty.ok).toBe(false);
  });

  it("devolve TODOS os erros de campo de uma vez e ignora campos extras (a organização nunca vem do formulário)", () => {
    const result = parseTeamInvite({ name: "", email: "x", emailConfirm: "y", role: "cliente", organizationId: "outra", organization_id: "outra" } as never);
    expect(result.ok).toBe(false);
    // e-mail inválido: a confirmação só é cobrada quando está vazia ou quando o e-mail é válido e diferente
    if (!result.ok) expect(Object.keys(result.fieldErrors).sort()).toEqual(["email", "name", "role"]);
    const ok = parseTeamInvite({ ...valid, organizationId: "outra", active: false } as never);
    expect(ok.ok && Object.keys(ok.data).sort()).toEqual(["email", "name", "role"]);
  });
});
