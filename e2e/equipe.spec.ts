import { expect, test, type Page } from "@playwright/test";

/**
 * Cadastro de membros da equipe (tela Usuários), modo real com sessão, contra o servidor falso de Auth + PostgREST
 * (e2e/support/mock-supabase.mjs) e o app em :3103 (chave secreta e e-mail SIMULADO). Prova a interface, as Server Actions,
 * o papel de cada usuário e que o link do convite sai SÓ no e-mail. As regras do banco (administrador ativo, organização,
 * papel, id/e-mail do Auth, auditoria) estão em src/test/db/team-members.test.ts.
 */

const MOCK = "http://127.0.0.1:59998";
const APP = "http://localhost:3103";
const NOVO = "nova.pessoa@luvicompany.com.br";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await fetch(`${MOCK}/__reset`);
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("qualquer-senha-1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

type Message = { to: string; subject: string; text: string };
// A caixa de saída simulada é do app inteiro (outros testes também enviam): aqui só interessam as mensagens destes endereços.
const ADDRESSES = [NOVO, "designer@luvi.test", "cliente@luvi.test"];
const outbox = async (): Promise<Message[]> =>
  ((await (await fetch(`${APP}/api/dev/outbox`)).json()) as { messages: Message[] }).messages.filter((m) => ADDRESSES.includes(m.to));

async function fillInvite(page: Page, values: { name: string; email: string; emailConfirm: string; role?: string }) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome completo").fill(values.name);
  await dialog.getByLabel("E-mail", { exact: true }).fill(values.email);
  await dialog.getByLabel("Confirmar e-mail").fill(values.emailConfirm);
  if (values.role) await dialog.getByLabel("Papel").selectOption(values.role);
  return dialog;
}

test("administrador vê o botão 'Adicionar usuário' e a janela abre com Administrador pré-selecionado", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await page.goto("/admin/usuarios");
  await expect(page.getByRole("heading", { name: "Usuários", level: 1 })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "Adicionar usuário" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Papel")).toHaveValue("admin");
  await expect(dialog.getByLabel("Papel").locator("option")).toHaveText(["Administrador", "Designer", "Atendimento"]);
  await expect(dialog.getByLabel(/senha/i)).toHaveCount(0);
});

test("validação no servidor: e-mails diferentes e dados inválidos mostram erro e não enviam nada", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await page.goto("/admin/usuarios");
  await page.getByRole("button", { name: "Adicionar usuário" }).click();
  const dialog = await fillInvite(page, { name: "Nova Pessoa", email: NOVO, emailConfirm: "outra.pessoa@luvicompany.com.br" });
  await dialog.getByRole("button", { name: "Enviar convite" }).click();
  await expect(dialog.getByText(/Os e-mails não conferem/)).toBeVisible();
  await dialog.getByLabel("Nome completo").fill("A");
  await dialog.getByLabel("Confirmar e-mail").fill(NOVO);
  await dialog.getByRole("button", { name: "Enviar convite" }).click();
  await expect(dialog.getByText(/mínimo de 2 caracteres/)).toBeVisible();
  expect(await outbox()).toEqual([]);
  await expect(page.locator("tbody tr")).toHaveCount(3);
});

test("convite enviado: a pessoa aparece como 'Convite pendente' e o link vai SÓ no e-mail", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await page.goto("/admin/usuarios");
  await page.getByRole("button", { name: "Adicionar usuário" }).click();
  const dialog = await fillInvite(page, { name: "  Nova   Pessoa ", email: NOVO.toUpperCase(), emailConfirm: NOVO, role: "atendimento" });
  await dialog.getByRole("button", { name: "Enviar convite" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const row = page.locator("tbody tr", { hasText: NOVO });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Nova Pessoa");
  await expect(row).toContainText("Atendimento");
  await expect(row).toContainText("Convite pendente");
  await expect(row.getByRole("button", { name: "Reenviar convite de Nova Pessoa" })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(4);

  const messages = await outbox();
  expect(messages).toHaveLength(1);
  expect(messages[0].to).toBe(NOVO);
  expect(messages[0].subject).toBe("Seu acesso ao painel Aprova Luvi");
  expect(messages[0].text).toMatch(/http:\/\/localhost:3103\/auth\/invite\?token_hash=[^&\s]+&type=invite/);
  expect(messages[0].text).toContain("Atendimento");
  // o link nunca aparece na tela
  expect(await page.content()).not.toMatch(/token_hash|auth\/invite/);
});

test("e-mail duplicado (equipe, aprovador ou o próprio convidado) é recusado e nada novo é criado", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await page.goto("/admin/usuarios");
  for (const email of [NOVO, "designer@luvi.test", "cliente@luvi.test"]) {
    await page.getByRole("button", { name: "Adicionar usuário" }).click();
    const dialog = await fillInvite(page, { name: "Pessoa Duplicada", email, emailConfirm: email });
    await dialog.getByRole("button", { name: "Enviar convite" }).click();
    await expect(dialog.getByText("Já existe um usuário com este e-mail.")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await expect(page.locator("tbody tr")).toHaveCount(4);
  expect(await outbox()).toHaveLength(1);
});

test("reenvio: logo depois do convite espera 1 minuto; passado o intervalo, manda um novo e-mail", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await page.goto("/admin/usuarios");
  const open = async () => {
    await page.getByRole("button", { name: "Reenviar convite de Nova Pessoa" }).click();
    return page.getByRole("dialog");
  };
  let dialog = await open();
  await expect(dialog.getByText(new RegExp(NOVO.replace(/\./g, "\\.")))).toBeVisible();
  await dialog.getByRole("button", { name: "Reenviar convite", exact: true }).click();
  await expect(dialog.getByText("Aguarde um minuto antes de reenviar o convite.")).toBeVisible();
  expect(await outbox()).toHaveLength(1);
  await dialog.getByRole("button", { name: "Cancelar" }).click();

  await fetch(`${MOCK}/__team_age`, { method: "POST" }); // recua o relógio do convite em 2 minutos
  dialog = await open();
  await dialog.getByRole("button", { name: "Reenviar convite", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const messages = await outbox();
  expect(messages).toHaveLength(2);
  expect(messages[1].to).toBe(NOVO);
  expect(messages[1].subject).toBe("Novo link de acesso ao painel Aprova Luvi");
  expect(messages[1].text).toMatch(/\/auth\/recovery\?token_hash=[^&\s]+&type=recovery/);
});

test("quem já aceitou o convite não recebe reenvio (sem botão na linha)", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await page.goto("/admin/usuarios");
  const designer = page.locator("tbody tr", { hasText: "Designer Teste" });
  await expect(designer).toContainText("Ativo");
  await expect(designer.getByRole("button", { name: /Reenviar convite/ })).toHaveCount(0);
});

for (const [email, label] of [
  ["designer@luvi.test", "designer"],
  ["atendimento@luvi.test", "atendimento"],
] as const) {
  test(`${label} não vê o item Usuários nem o botão e, digitando a URL, volta ao painel`, async ({ page }) => {
    await login(page, email);
    await expect(page.getByRole("link", { name: "Usuários" })).toHaveCount(0);
    await page.goto("/admin/usuarios");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("button", { name: "Adicionar usuário" })).toHaveCount(0);
    await expect(page.getByText(NOVO)).toHaveCount(0);
  });
}
