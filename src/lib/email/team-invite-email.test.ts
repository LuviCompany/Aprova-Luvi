// @vitest-environment node
import { describe, expect, it } from "vitest";
import { teamInviteEmail } from "./templates";

const URL = "https://aprova.luvicompany.com.br/auth/invite?token_hash=abc123&type=invite";

describe("teamInviteEmail", () => {
  it("convite: assunto, papel, link, validade e botão para criar a senha", () => {
    const mail = teamInviteEmail({ name: "Pessoa Nova", roleLabel: "Administrador", url: URL, validityHours: 24 });
    expect(mail.subject).toBe("Seu acesso ao painel Aprova Luvi");
    expect(mail.text).toContain("Olá, Pessoa Nova!");
    expect(mail.text).toContain("como Administrador");
    expect(mail.text).toContain(URL);
    expect(mail.text).toContain("24 horas");
    expect(mail.html).toContain("Criar minha senha");
    expect(mail.html).toContain(URL.replace(/&/g, "&amp;"));
  });

  it("reenvio: assunto e texto próprios", () => {
    const mail = teamInviteEmail({ name: "Pessoa Nova", roleLabel: "Designer", url: URL, validityHours: 24, resend: true });
    expect(mail.subject).toBe("Novo link de acesso ao painel Aprova Luvi");
    expect(mail.text).toContain("Aqui está um novo link");
  });

  it("escapa HTML do nome e do papel (nada injetado no e-mail) e nunca pede nem inclui senha", () => {
    const mail = teamInviteEmail({ name: '<img src=x onerror=alert(1)>', roleLabel: "<b>Admin</b>", url: URL, validityHours: 24 });
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).not.toContain("<b>Admin</b>");
    expect(mail.html).toContain("&lt;img");
    expect(`${mail.text} ${mail.html}`).not.toMatch(/sua senha é|senha temporária/i);
  });
});
