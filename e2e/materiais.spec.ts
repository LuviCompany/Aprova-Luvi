import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Telas REAIS de materiais (etapa B do Módulo 3): modo real com sessão, contra o servidor falso de
 * Auth + PostgREST (e2e/support/mock-supabase.mjs). Prova a interface, as Server Actions, os
 * cookies e o comportamento por papel; a RLS e as travas de verdade estão em src/test/db.
 */

const MOCK = "http://127.0.0.1:59998";

const CLIENT_A = "7c9e6679-7425-40de-944b-e07fc1f90ae7"; // Casa Aurora Teste (ativo)
const CLIENT_B = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f"; // Studio Vento Teste (ativo)
const CLIENT_OLD = "6f708192-3c4d-4e5f-9fa1-2c3d4e5f6071"; // Marca Antiga Teste (arquivado)
const PROJECT_A = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11"; // Campanha de verão (ativo, cliente A)
const PROJECT_A_DONE = "8a1b5e59-2e0d-4b42-9c46-59b4bf0e6f00"; // Projeto antigo (concluído, cliente A)
const PROJECT_B = "5e6f7081-2b3c-4d4e-8f90-1b2c3d4e5f60"; // Lançamento de inverno (ativo, cliente B)
const LOCKED = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"; // enviado para aprovação
const WITH_VERSION = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"; // rascunho que já tem versão

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await fetch(`${MOCK}/__reset`);
});

async function seed() {
  await fetch(`${MOCK}/__seed`, {
    method: "POST",
    body: JSON.stringify({
      clients: [
        { id: CLIENT_A, name: "Casa Aurora Teste" },
        { id: CLIENT_B, name: "Studio Vento Teste" },
        { id: CLIENT_OLD, name: "Marca Antiga Teste", active: false },
      ],
      projects: [
        { id: PROJECT_A, client_id: CLIENT_A, name: "Campanha de verão" },
        { id: PROJECT_A_DONE, client_id: CLIENT_A, name: "Projeto antigo", status: "concluido" },
        { id: PROJECT_B, client_id: CLIENT_B, name: "Lançamento de inverno" },
      ],
      materials: [
        // 22 rascunhos de preenchimento, para a paginação (20 por página).
        ...Array.from({ length: 22 }, (_, i) => ({
          id: `c3d4e5f6-a7b8-4c9d-8e0f-${String(i + 1).padStart(12, "0")}`,
          client_id: CLIENT_B,
          project_id: PROJECT_B,
          title: `Peça de enchimento ${String(i + 1).padStart(2, "0")}`,
          type: "imagem",
        })),
        {
          id: WITH_VERSION,
          client_id: CLIENT_A,
          project_id: PROJECT_A,
          title: "Rascunho com versão",
          type: "pdf",
        },
        {
          id: LOCKED,
          client_id: CLIENT_A,
          project_id: PROJECT_A,
          title: "Arte enviada ao cliente",
          type: "carrossel",
          status: "aguardando",
          caption: "Legenda que o cliente está vendo",
          channel: "Instagram Feed",
          aspect_ratio: "4:5",
          due_date: "2026-11-20",
          publish_date: "2026-12-01",
        },
      ],
      versions: [{ material_id: WITH_VERSION }, { material_id: LOCKED }],
    }),
  });
}

async function login(page: Page, email: string, landing: RegExp = /\/admin$/) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("qualquer-senha-1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(landing);
}

const shown = (locator: Locator) => locator.filter({ visible: true });

function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openMaterials(page: Page, path = "/admin/materiais") {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test("sem materiais: a tela é real (sem aviso de demonstração) e orienta o primeiro cadastro", async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, "admin@luvi.test");
  await openMaterials(page);
  await expect(page.getByRole("heading", { name: "Materiais", level: 1 })).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
  await expect(page.getByText("Nenhum material cadastrado ainda.")).toBeVisible();
  await expect(page.getByText("0 materiais", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo material" })).toBeVisible();
  expect(errors).toEqual([]);

  // o dashboard ainda usa dados fictícios: o aviso continua lá
  await page.goto("/admin");
  await expect(page.getByRole("note")).toContainText("dados de demonstração");
  await seed();
});

test("paginação: 20 por página, com anterior e próxima mantendo os filtros", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await openMaterials(page);
  await expect(page.getByText("24 materiais", { exact: true })).toBeVisible();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(20);
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  await page.getByRole("link", { name: /Próxima/ }).click();
  await expect(page).toHaveURL(/pagina=2/);
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  await expect(rows).toHaveCount(4);
  await page.getByRole("link", { name: /Anterior/ }).click();
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
});

test("cadastra um material: cliente, projeto em cascata, legenda com quebras e avisos de data", async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, "admin@luvi.test");
  await openMaterials(page);

  await page.getByRole("button", { name: "Novo material" }).click();
  const dialog = page.getByRole("dialog");
  // cliente arquivado e projeto concluído não são oferecidos
  await expect(dialog.getByLabel("Cliente").locator("option", { hasText: "Marca Antiga Teste" })).toHaveCount(0);
  await expect(dialog.getByLabel("Projeto")).toBeDisabled();
  await dialog.getByLabel("Cliente").selectOption({ label: "Casa Aurora Teste" });
  await expect(dialog.getByLabel("Projeto").locator("option", { hasText: "Projeto antigo" })).toHaveCount(0);
  await dialog.getByLabel("Projeto").selectOption({ label: "Campanha de verão" });

  await dialog.getByLabel("Título").fill("  Carrossel   de  lançamento ");
  await dialog.getByLabel("Tipo").selectOption("carrossel");
  await dialog.getByLabel(/Proporção/).selectOption("4:5");
  await dialog.getByLabel(/Canal/).fill("Instagram Feed");
  await dialog.getByLabel(/Legenda/).fill("Primeira linha\n\nSegunda linha #verão");
  await expect(dialog.getByText("36 / 2200 caracteres")).toBeVisible();
  await dialog.getByLabel(/Descrição interna/).fill("Usar a paleta quente");
  await dialog.getByLabel(/Prazo de aprovação/).fill("2026-11-20");
  await dialog.getByLabel(/Publicação prevista/).fill("2026-11-10");
  await expect(dialog.getByText(/antes do prazo de aprovação/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cadastrar material" }).click(); // o aviso não impede salvar

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Carrossel de lançamento" })).toBeVisible();
  await expect(page.getByText("25 materiais", { exact: true })).toBeVisible();
  const row = page.locator("tbody tr", { hasText: "Carrossel de lançamento" });
  await expect(row).toContainText("Casa Aurora Teste");
  await expect(row).toContainText("Campanha de verão");
  await expect(row).toContainText("Instagram Feed · 4:5");
  await expect(row.locator("[data-slot=badge]", { hasText: "Rascunho" })).toBeVisible();
  await expect(row.locator("[data-slot=badge]", { hasText: "Carrossel" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("envio recusado mantém o que foi digitado e mostra o erro no campo", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await openMaterials(page);
  await page.getByRole("button", { name: "Novo material" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cliente").selectOption({ label: "Casa Aurora Teste" });
  await dialog.getByLabel("Projeto").selectOption({ label: "Campanha de verão" });
  await dialog.getByLabel("Título").fill("!!");
  await dialog.getByLabel("Tipo").selectOption("imagem");
  await dialog.getByLabel(/Legenda/).fill("Legenda longa que não pode ser perdida");
  await dialog.getByRole("button", { name: "Cadastrar material" }).click();
  await expect(dialog.getByText(/letras ou números/)).toBeVisible();
  await expect(dialog.getByLabel("Título")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByLabel("Título")).toHaveValue("!!");
  await expect(dialog.getByLabel(/Legenda/)).toHaveValue("Legenda longa que não pode ser perdida");
  await expect(dialog.getByLabel("Projeto")).toHaveValue(PROJECT_A);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("detalhe mostra legenda com quebras, dados e a nota sobre arquivos; edita e a lista reflete", async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, "admin@luvi.test");
  await openMaterials(page);
  await page.getByRole("link", { name: "Carrossel de lançamento" }).click();
  await expect(page.getByRole("heading", { name: "Carrossel de lançamento", level: 1 })).toBeVisible();
  await expect(page.getByText("Casa Aurora Teste · Campanha de verão")).toBeVisible();
  await expect(page.getByText(/Primeira linha/)).toBeVisible();
  await expect(shown(page.locator("dd", { hasText: "4:5 (retrato)" }))).toBeVisible();
  await expect(page.getByText("Usar a paleta quente")).toBeVisible();
  await expect(page.getByText(/Nenhum arquivo ainda/)).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);

  await page.getByRole("button", { name: "Editar Carrossel de lançamento" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Cliente")).toHaveCount(0);
  await expect(dialog.getByLabel("Tipo")).toHaveAttribute("readonly", "");
  await dialog.getByLabel("Título").fill("Carrossel de lançamento v2");
  await dialog.getByLabel(/Proporção/).selectOption("9:16");
  await dialog.getByLabel(/Publicação prevista/).fill("2026-12-05");
  await dialog.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Carrossel de lançamento v2", level: 1 })).toBeVisible();
  await expect(shown(page.locator("dd", { hasText: "9:16 (vertical)" }))).toBeVisible();

  await page.getByRole("link", { name: "Materiais", exact: true }).first().click();
  await expect(page.getByRole("link", { name: "Carrossel de lançamento v2" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("material enviado para aprovação: conteúdo travado, datas editáveis, sem exclusão", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await openMaterials(page, `/admin/materiais/${LOCKED}`);
  await expect(page.getByRole("heading", { name: "Arte enviada ao cliente", level: 1 })).toBeVisible();
  await expect(page.getByText(/Conteúdo travado/)).toBeVisible();
  await expect(page.getByText("Legenda que o cliente está vendo")).toBeVisible();
  await expect(page.getByRole("button", { name: /Excluir/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Editar Arte enviada ao cliente" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/só mudam numa nova revisão/)).toBeVisible();
  for (const label of ["Título", /Proporção/, /Canal/, /Legenda/, /Descrição interna/]) {
    await expect(dialog.getByLabel(label)).toBeDisabled();
  }
  await dialog.getByLabel(/Publicação prevista/).fill("2026-12-20");
  await dialog.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(shown(page.locator("dd", { hasText: /20 de dez/ }))).toBeVisible();
  await expect(page.getByText("Legenda que o cliente está vendo")).toBeVisible(); // o conteúdo não mudou
});

test("rascunho com versão não tem botão de excluir; rascunho vazio exclui com confirmação e some", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await openMaterials(page, `/admin/materiais/${WITH_VERSION}`);
  await expect(page.getByRole("heading", { name: "Rascunho com versão", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /Excluir/ })).toHaveCount(0);

  await openMaterials(page);
  await page.getByRole("link", { name: "Carrossel de lançamento v2" }).click();
  await page.getByRole("button", { name: "Excluir Carrossel de lançamento v2" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Só rascunhos sem versões/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Excluir Carrossel de lançamento v2" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir rascunho" }).click();
  await expect(page).toHaveURL(/\/admin\/materiais$/);
  await expect(page.getByRole("link", { name: "Carrossel de lançamento v2" })).toHaveCount(0);
  await expect(page.getByText("24 materiais", { exact: true })).toBeVisible();
});

test("filtros pela URL: status, tipo, cliente, projeto em cascata e busca; limpar volta ao todo", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await openMaterials(page);

  await page.locator("#filtro-status").selectOption("aguardando");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/status=aguardando/);
  await expect(page.getByText("1 material", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Arte enviada ao cliente" })).toBeVisible();

  await page.getByRole("link", { name: "Limpar" }).click();
  await expect(page).toHaveURL(/\/admin\/materiais$/);
  await expect(page.getByText("24 materiais", { exact: true })).toBeVisible();
  await page.locator("#filtro-tipo").selectOption("pdf");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByText("1 material", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Rascunho com versão" })).toBeVisible();

  await page.goto(`/admin/materiais?cliente=${CLIENT_B}`);
  await expect(page.getByText("22 materiais", { exact: true })).toBeVisible();
  await expect(page.locator("#filtro-projeto option", { hasText: "Campanha de verão" })).toHaveCount(0); // projeto de outro cliente
  await page.goto(`/admin/materiais?projeto=${PROJECT_A}`);
  await expect(page.getByText("2 materiais", { exact: true })).toBeVisible();

  await page.goto("/admin/materiais");
  await page.getByLabel("Buscar por título").fill("enchimento 07");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByText("1 material", { exact: true })).toBeVisible();
  await page.getByLabel("Buscar por título").fill("zzz");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByText("Nenhum material encontrado com esses filtros.")).toBeVisible();

  // valores estranhos na URL não quebram a tela
  await page.goto("/admin/materiais?status=x&tipo=y&cliente=%27%3Bdrop&pagina=-4");
  await expect(page.getByRole("heading", { name: "Materiais", level: 1 })).toBeVisible();
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
});

test("material inexistente ou id malformado mostra 'não encontrado'", async ({ page }) => {
  await login(page, "admin@luvi.test");
  await page.goto("/admin/materiais/00000000-0000-4000-8000-00000000dead");
  await expect(page.getByText(/não encontrad|não existe/i).first()).toBeVisible();
  await page.goto("/admin/materiais/nao-e-um-uuid");
  await expect(page.getByText(/não encontrad|não existe/i).first()).toBeVisible();
});

test("designer cadastra, edita e exclui o próprio rascunho (a equipe toda pode)", async ({ page }) => {
  await login(page, "designer@luvi.test");
  await openMaterials(page);
  await page.getByRole("button", { name: "Novo material" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cliente").selectOption({ label: "Studio Vento Teste" });
  await dialog.getByLabel("Projeto").selectOption({ label: "Lançamento de inverno" });
  await dialog.getByLabel("Título").fill("Arte do designer");
  await dialog.getByLabel("Tipo").selectOption("video");
  await dialog.getByRole("button", { name: "Cadastrar material" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Arte do designer" }).click();
  await page.getByRole("button", { name: "Excluir Arte do designer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir rascunho" }).click();
  await expect(page).toHaveURL(/\/admin\/materiais$/);
  await expect(page.getByRole("link", { name: "Arte do designer" })).toHaveCount(0);
});

test("aprovador (papel cliente) não entra no painel de materiais", async ({ page }) => {
  await login(page, "cliente1@luvi.test", /\/portal/);
  // O redirecionamento interrompe o carregamento: espera só o início da resposta e confere o destino.
  for (const path of ["/admin/materiais", `/admin/materiais/${LOCKED}`]) {
    await page.goto(path, { waitUntil: "commit" }).catch(() => undefined); // o redirecionamento pode abortar a navegação
    await expect(page).toHaveURL(/\/portal/);
    await expect(page.getByText("Arte enviada ao cliente")).toHaveCount(0);
  }
});

test("celular: sem rolagem horizontal e o formulário cabe na tela, rolando por dentro", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await login(page, "admin@luvi.test");
  await openMaterials(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Novo material" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(700);
  // o rodapé com o botão de salvar alcança-se rolando dentro do diálogo
  await dialog.getByRole("button", { name: "Cadastrar material" }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Cadastrar material" })).toBeInViewport();
  expect(await overflow()).toBeLessThanOrEqual(0);
});
