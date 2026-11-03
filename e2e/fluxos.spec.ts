import { expect, test } from "@playwright/test";

test.describe("login", () => {
  test("equipe Luvi entra no painel e navega pelo menu", async ({ page, isMobile }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle"); // espera a hidratação do formulário
    await page.getByLabel("E-mail").fill("enzo@luvicompany.com.br");
    await page.getByLabel("Senha").fill("senha-demo");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(page.getByTestId("kpi-value")).toHaveCount(4);

    if (isMobile) await page.getByRole("button", { name: "Abrir menu" }).click();
    await page.getByRole("link", { name: "Clientes" }).first().click();
    await expect(page).toHaveURL(/\/admin\/clientes$/);
    await expect(page.getByRole("heading", { name: "Casa Aurora Móveis" })).toBeVisible();
  });

  test("mostra erros de validação e não navega", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle"); // espera a hidratação do formulário
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("Informe um e-mail válido.")).toBeVisible();
    await expect(page.getByText("A senha deve ter ao menos 6 caracteres.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("cliente entra no portal", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle"); // espera a hidratação do formulário
    await page.getByRole("tab", { name: "Sou cliente" }).click();
    await page.getByLabel("E-mail").fill("marina@casaaurora.com.br");
    await page.getByLabel("Senha").fill("senha-demo");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole("heading", { name: /Olá, Marina/ })).toBeVisible();
  });
});

test.describe("dashboard", () => {
  test("filtra materiais por status", async ({ page }) => {
    await page.goto("/admin");
    const total = page.getByText(/^\d+ materiais?$/);
    await expect(total).toHaveText("13 materiais");
    await page.getByLabel("Status").selectOption("aprovado");
    await expect(total).toHaveText("5 materiais");
  });
});

test.describe("clientes e projetos (demonstração, somente leitura)", () => {
  test("clientes: busca por nome e filtro de status, sem botões de escrita", async ({ page }) => {
    await page.goto("/admin/clientes");
    await expect(page.getByRole("heading", { name: "Casa Aurora Móveis" })).toBeVisible();
    await expect(page.getByText("4 clientes", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Novo cliente" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Editar|^Arquivar/ })).toHaveCount(0);

    await page.getByLabel("Buscar por nome").fill("vita");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page).toHaveURL(/q=vita/);
    await expect(page.getByRole("heading", { name: "Vita Nutri" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Casa Aurora Móveis" })).toHaveCount(0);
    await expect(page.getByText("1 cliente", { exact: true })).toBeVisible();

    await page.goto("/admin/clientes?status=arquivados");
    await expect(page.getByText("Nenhum cliente encontrado com esses filtros.")).toBeVisible();
  });

  test("projetos: filtros por status e por cliente, sem botões de escrita", async ({ page }) => {
    await page.goto("/admin/projetos");
    await expect(page.getByText("6 projetos", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Novo projeto" })).toHaveCount(0);

    await page.getByLabel("Status").selectOption("pausado");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page.getByRole("heading", { name: "Promoções de Novembro" })).toBeVisible();
    await expect(page.getByText("1 projeto", { exact: true })).toBeVisible();

    await page.goto("/admin/projetos?cliente=c1");
    await expect(page.getByText("2 projetos", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Campanha Black Friday" })).toBeVisible();
  });

  test("parâmetros inválidos na URL não quebram a página", async ({ page }) => {
    await page.goto("/admin/projetos?status=%27%3B%20drop%20table&cliente=1%20or%201%3D1&q=%25");
    await expect(page.getByRole("heading", { name: "Projetos", level: 1 })).toBeVisible();
  });
});

test.describe("portal do cliente", () => {
  test("aprova um material pendente", async ({ page }) => {
    await page.goto("/portal/materiais/m2");
    await page.getByRole("button", { name: "Aprovar", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar aprovação" }).click();
    await expect(page.getByRole("status")).toContainText("Aprovado");
  });

  test("não revela materiais de outro cliente", async ({ page }) => {
    // m5 pertence a outro cliente: a resposta é idêntica à de um material que não existe.
    await page.goto("/portal/materiais/m5");
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
    await expect(page.getByText("5 mitos sobre detox")).toHaveCount(0);
  });
});

test.describe("aprovação rápida por link", () => {
  test("exige o código e conclui a aprovação", async ({ page }) => {
    await page.goto("/aprovar/demo");
    await expect(page.getByRole("link", { name: "Voltar ao início" })).toHaveAttribute("href", "/");
    await expect(page.getByText("ma***@casaaurora.example")).toBeVisible();

    await page.getByLabel("Código de verificação").fill("000000");
    await page.getByRole("button", { name: "Abrir material" }).click();
    await expect(page.getByText("Código incorreto")).toBeVisible();

    await page.getByLabel("Código de verificação").fill("123456");
    await page.getByRole("button", { name: "Abrir material" }).click();
    await page.getByRole("button", { name: "Aprovar", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar aprovação" }).click();
    await expect(page.getByTestId("quick-approval-done")).toContainText("Material aprovado");
  });

  for (const [token, titulo] of [
    ["expirado", "Link expirado"],
    ["revogado", "Link revogado"],
    ["utilizado", "Link já utilizado"],
    ["inexistente", "Link inválido"],
  ] as const) {
    test(`bloqueia link ${token}`, async ({ page }) => {
      await page.goto(`/aprovar/${token}`);
      await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
      await expect(page.getByLabel("Código de verificação")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Voltar ao início" })).toBeVisible();
    });
  }
});

test("não há overflow horizontal nas telas principais", async ({ page }) => {
  for (const path of ["/login", "/admin", "/admin/clientes", "/admin/projetos", "/admin/materiais/m1", "/portal", "/aprovar/demo"]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `overflow em ${path}`).toBeLessThanOrEqual(0);
  }
});
