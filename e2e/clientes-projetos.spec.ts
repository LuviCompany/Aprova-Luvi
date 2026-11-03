import { expect, test, type Page } from "@playwright/test";

/**
 * Telas REAIS de clientes e projetos (modo real, com sessão), contra o servidor falso de
 * Auth + PostgREST (e2e/support/mock-supabase.mjs). Prova a interface, as Server Actions, os
 * cookies e o comportamento por papel; a RLS de verdade é testada em src/test/db.
 */

const MOCK = "http://127.0.0.1:59998";

// Estado compartilhado no servidor falso: os testes rodam em série e na ordem.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await fetch(`${MOCK}/__reset`);
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // espera a hidratação do formulário
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("qualquer-senha-1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** Erros não tratados da página (por exemplo, um componente lançando ao renderizar). */
function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("admin: o aviso de demonstração fica só nas telas que ainda usam dados fictícios", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await expect(page.getByRole("note")).toContainText("dados de demonstração");

  await page.goto("/admin/clientes");
  await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
  await expect(page.getByText("Nenhum cliente cadastrado ainda.")).toBeVisible();

  await page.goto("/admin/projetos");
  await expect(page.getByRole("heading", { name: "Projetos", level: 1 })).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
});

test("admin cadastra um cliente e ele aparece na lista", async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, "admin@luvi.test");
  await page.goto("/admin/clientes");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Novo cliente" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do cliente").fill("  Casa   Aurora Teste ");
  await expect(dialog.getByText(/usamos CA/)).toBeVisible();
  await dialog.getByLabel(/Segmento/).fill("Varejo de móveis");
  await dialog.getByRole("button", { name: "Cadastrar cliente" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Casa Aurora Teste" })).toBeVisible();
  await expect(page.getByText("Varejo de móveis")).toBeVisible();
  await expect(page.getByText("1 cliente", { exact: true })).toBeVisible();
  await expect(page.getByText("Nenhum aprovador cadastrado.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("nome repetido (sem diferenciar maiúsculas) é recusado na própria janela", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await page.goto("/admin/clientes");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Novo cliente" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do cliente").fill("casa aurora teste");
  await dialog.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(dialog.getByText("Já existe um cliente com esse nome.")).toBeVisible();
  await expect(dialog.getByLabel("Nome do cliente")).toHaveAttribute("aria-invalid", "true");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("1 cliente", { exact: true })).toBeVisible();
});

test("valida o nome no servidor", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await page.goto("/admin/clientes");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Novo cliente" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do cliente").fill("!");
  await dialog.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(dialog.getByText(/mínimo de 2|letras ou números/)).toBeVisible();
});

test("edita, arquiva, encontra nos arquivados e reativa", async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, "admin@luvi.test");
  await page.goto("/admin/clientes");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Editar Casa Aurora Teste" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Nome do cliente")).toHaveValue("Casa Aurora Teste");
  await dialog.getByLabel(/Segmento/).fill("Móveis planejados");
  await dialog.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Móveis planejados")).toBeVisible();

  await page.getByRole("button", { name: "Arquivar Casa Aurora Teste" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/deixa de aparecer no portal/)).toBeVisible();
  await dialog.getByRole("button", { name: "Arquivar cliente" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Casa Aurora Teste" })).toHaveCount(0);

  await page.goto("/admin/clientes?status=arquivados");
  await expect(page.getByRole("heading", { name: "Casa Aurora Teste" })).toBeVisible();
  await expect(page.locator("[data-slot=badge]", { hasText: "Arquivado" })).toBeVisible();

  await page.getByRole("button", { name: "Reativar Casa Aurora Teste" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reativar cliente" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/admin/clientes");
  await expect(page.getByRole("heading", { name: "Casa Aurora Teste" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("busca por nome na URL", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await page.goto("/admin/clientes");
  await page.getByLabel("Buscar por nome").fill("zzz");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/q=zzz/);
  await expect(page.getByText("Nenhum cliente encontrado com esses filtros.")).toBeVisible();
  await page.getByRole("link", { name: "Limpar" }).click();
  await expect(page.getByRole("heading", { name: "Casa Aurora Teste" })).toBeVisible();
});

test("cria e edita um projeto do cliente", async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, "admin@luvi.test");
  await page.goto("/admin/projetos");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Nenhum projeto cadastrado ainda.")).toBeVisible();

  await page.getByRole("button", { name: "Novo projeto" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cliente").selectOption({ label: "Casa Aurora Teste" });
  await dialog.getByLabel("Nome do projeto").fill("Campanha de Verão");
  await dialog.getByLabel(/Descrição/).fill("Peças de feed e stories");
  await dialog.getByLabel(/Data de entrega/).fill("2026-12-15");
  await dialog.getByRole("button", { name: "Cadastrar projeto" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Campanha de Verão" })).toBeVisible();
  await expect(page.locator("p:text-is('Casa Aurora Teste')")).toBeVisible(); // cliente no cartão (não a opção do filtro)
  await expect(page.getByText("0 de 0 aprovados")).toBeVisible();
  await expect(page.locator("[data-slot=badge]", { hasText: "Ativo" })).toBeVisible();

  await page.getByRole("button", { name: "Editar Campanha de Verão" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Cliente")).toHaveCount(0); // o cliente não troca
  await dialog.getByLabel("Status").selectOption("pausado");
  await dialog.getByLabel("Nome do projeto").fill("Campanha de Verão 2027");
  await dialog.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("heading", { name: "Campanha de Verão 2027" })).toBeVisible();
  await expect(page.locator("[data-slot=badge]", { hasText: "Pausado" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0); // espera a animação de fechamento

  // filtros
  await page.locator("#filtro-status").selectOption("concluido");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByText("Nenhum projeto encontrado com esses filtros.")).toBeVisible();
  await page.goto("/admin/projetos?status=pausado");
  await expect(page.getByRole("heading", { name: "Campanha de Verão 2027" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("cliente arquivado não recebe projeto novo", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await page.goto("/admin/clientes");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Arquivar Casa Aurora Teste" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Arquivar cliente" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto("/admin/projetos");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Novo projeto" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Cadastre um cliente ativo/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cadastrar projeto" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancelar" }).click();

  // o projeto antigo continua visível, indicando o cliente arquivado
  await expect(page.getByText(/cliente arquivado/)).toBeVisible();
});

test("designer só consulta clientes, mas cria projetos", async ({ page }) => {
  await login(page, "designer@luvi.test");
  await page.goto("/admin/clientes?status=todos");
  await expect(page.getByRole("heading", { name: "Casa Aurora Teste" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo cliente" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Editar|^Arquivar|^Reativar/ })).toHaveCount(0);
  await expect(page.getByText(/Seu perfil pode consultar os clientes/)).toBeVisible();

  await page.goto("/admin/projetos");
  await expect(page.getByRole("button", { name: "Novo projeto" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Campanha de Verão 2027" })).toBeVisible();
});

test("atendimento cadastra clientes como o admin", async ({ page }) => {
  await login(page, "atendimento@luvi.test");
  await page.goto("/admin/clientes");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Novo cliente" }).click();
  await page.getByRole("dialog").getByLabel("Nome do cliente").fill("Clínica Vida Plena");
  await page.getByRole("dialog").getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(page.getByRole("heading", { name: "Clínica Vida Plena" })).toBeVisible();
});
