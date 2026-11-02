import { expect, test } from "@playwright/test";

/**
 * Servidor em modo real (sem modo demonstração) apontando para um Supabase inalcançável.
 * Nenhum desses testes usa credenciais.
 */

test.describe("proteção de rotas", () => {
  for (const path of ["/admin", "/admin/materiais", "/admin/materiais/m1", "/admin/usuarios", "/portal", "/portal/materiais/m1", "/portal/historico"]) {
    test(`anônimo em ${path} é enviado ao login, com o destino guardado`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(path);
      await expect(page.getByRole("heading", { name: "Bem-vindo de volta" })).toBeVisible();
    });
  }

  test("não vaza conteúdo das áreas protegidas antes do redirecionamento", async ({ request }) => {
    const res = await request.get("/admin", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const body = await res.text();
    expect(body).not.toContain("Dashboard");
    expect(body).not.toContain("Casa Aurora");
  });

  test("redefinir senha exige sessão", async ({ page }) => {
    await page.goto("/redefinir-senha");
    await expect(page).toHaveURL(/\/login\?next=%2Fredefinir-senha/);
  });
});

test.describe("login real", () => {
  test("não oferece o login de demonstração", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("tab", { name: "Sou cliente" })).toHaveCount(0);
    await expect(page.getByText(/ambiente de demonstração/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /demonstração da aprovação rápida/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Esqueci minha senha" })).toBeVisible();
  });

  test("falha com elegância quando o serviço de autenticação está fora do ar", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("E-mail").fill("ana@empresa.com");
    await page.getByLabel("Senha").fill("qualquer-senha-1");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator("p[role=alert]")).toContainText(/serviço de autenticação|incorretos/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("um login inválido nunca navega para as áreas protegidas", async ({ page }) => {
    await page.goto("/login?next=/admin");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("E-mail").fill("ana@empresa.com");
    await page.getByLabel("Senha").fill("qualquer-senha-1");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator("p[role=alert]")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("ignora destinos externos no parâmetro next", async ({ page }) => {
    await page.goto("/login?next=https://evil.example.com");
    // O formulário não deve carregar o destino malicioso.
    await expect(page.locator('input[name="next"]')).toHaveCount(0);
  });

  test("mostra aviso para links de recuperação inválidos", async ({ page }) => {
    await page.goto("/login?erro=link-invalido");
    await expect(page.locator("p[role=alert]")).toContainText(/expirou|já foi usado/i);
  });
});

test.describe("recuperação de senha", () => {
  test("a tela de pedido de link abre sem login e valida o e-mail", async ({ page }) => {
    await page.goto("/esqueci-senha");
    await expect(page.getByRole("heading", { name: "Recuperar senha" })).toBeVisible();
    await page.getByLabel("E-mail").fill("isto-nao-e-email");
    await page.getByRole("button", { name: "Enviar link de redefinição" }).click();
    // Validação nativa do navegador (type=email) impede o envio.
    await expect(page).toHaveURL(/\/esqueci-senha/);
  });

  test("/auth/confirm sem token válido volta ao login com erro", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=invalido&type=recovery");
    await expect(page).toHaveURL(/\/login\?erro=/);
  });

  for (const purpose of ["recovery", "invite"]) {
    test(`/auth/${purpose} sem código válido volta ao login com aviso`, async ({ page }) => {
      await page.goto(`/auth/${purpose}`);
      await expect(page).toHaveURL(/\/login\?erro=link-invalido/);
      await page.goto(`/auth/${purpose}?code=codigo-invalido`);
      await expect(page).toHaveURL(/\/login\?erro=link-invalido/);
    });
  }

  test("finalidade desconhecida em /auth responde 404", async ({ request }) => {
    const res = await request.get("/auth/qualquer-coisa", { maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });

  test("/auth/confirm ignora tipos não permitidos", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=x&type=magiclink&next=/admin");
    await expect(page).toHaveURL(/\/login\?erro=link-invalido/);
  });
});

test.describe("aprovação rápida sem modo demonstração", () => {
  test("tokens fictícios não valem: falha fechado", async ({ page }) => {
    for (const token of ["demo", "expirado", "utilizado", "qualquer"]) {
      await page.goto(`/aprovar/${token}`);
      await expect(page.getByRole("heading", { name: "Link inválido" })).toBeVisible();
      await expect(page.getByLabel("Código de verificação")).toHaveCount(0);
      await expect(page.getByText("Carrossel — Ofertas da Semana")).toHaveCount(0);
    }
  });
});

test.describe("cabeçalhos de segurança", () => {
  test("respostas trazem os cabeçalhos básicos", async ({ request }) => {
    const res = await request.get("/login");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});
