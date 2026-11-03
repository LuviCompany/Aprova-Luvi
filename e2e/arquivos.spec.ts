import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Arquivos, slides, versões e revisão de materiais (etapas C e D), no modo real com sessão, contra o servidor falso de
 * Auth + PostgREST + Storage (e2e/support/mock-supabase.mjs). O upload é REAL do ponto de vista do navegador: URL
 * assinada, PUT multipart com progresso, conferência no servidor de tamanho e assinatura, limpeza em falha.
 * A RLS e as travas de verdade estão em src/test/db.
 */

const MOCK = "http://127.0.0.1:59998";

const CLIENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PROJECT = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const IMG = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"; // imagem em rascunho, sem versão
const CAR = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"; // carrossel em rascunho, sem versão
const PDF = "c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f"; // pdf em rascunho
const APR = "d4e5f6a7-b8c9-4d0e-8f1a-3b4c5d6e7f80"; // aprovado, com versão 1 enviada e congelada
const ALT = "e5f6a7b8-c9d0-4e1f-8a2b-4c5d6e7f8091"; // alteração pedida
const APR_FILE = "f6a7b8c9-d0e1-4f2a-8b3c-5d6e7f809102";
const APR_VERSION = "07b8c9d0-e1f2-4a3b-8c4d-6e7f80910213";
const ALT_VERSION = "18c9d0e1-f2a3-4b4c-9d5e-7f8091021324";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await fetch(`${MOCK}/__reset`);
  const material = (id: string, title: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    client_id: CLIENT,
    project_id: PROJECT,
    title,
    type,
    ...extra,
  });
  await fetch(`${MOCK}/__seed`, {
    method: "POST",
    body: JSON.stringify({
      clients: [{ id: CLIENT, name: "Casa Aurora Teste" }],
      projects: [{ id: PROJECT, client_id: CLIENT, name: "Campanha de verão" }],
      materials: [
        material(IMG, "Imagem de teste", "imagem"),
        material(CAR, "Carrossel de teste", "carrossel"),
        material(PDF, "PDF de teste", "pdf"),
        material(APR, "Peça aprovada", "imagem", { status: "aprovado", caption: "Legenda aprovada pelo cliente", channel: "Instagram Feed" }),
        material(ALT, "Peça com alteração", "imagem", { status: "alteracao", caption: "Legenda original" }),
      ],
      versions: [
        { id: APR_VERSION, material_id: APR, client_id: CLIENT, note: "Versão inicial" },
        { id: ALT_VERSION, material_id: ALT, client_id: CLIENT, note: "Versão inicial" },
      ],
      files: [
        {
          id: APR_FILE,
          version_id: APR_VERSION,
          material_id: APR,
          client_id: CLIENT,
          slide_position: 1,
          kind: "imagem",
          mime_type: "image/jpeg",
          original_name: "arte-aprovada.jpg",
          storage_path: `${CLIENT}/${APR}/arte-aprovada.jpg`,
        },
      ],
      requests: [{ version_id: APR_VERSION }, { version_id: ALT_VERSION }],
      contents: [
        {
          version_id: APR_VERSION,
          material_id: APR,
          content: { title: "Peça aprovada", description: "", caption: "Legenda aprovada pelo cliente", type: "imagem", aspect_ratio: null, channel: "Instagram Feed", publish_date: null, due_date: null, files: [] },
        },
      ],
    }),
  });
});

async function login(page: Page, email = "admin@luvi.test") {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("qualquer-senha-1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/(admin|portal)/);
}

const shown = (locator: Locator) => locator.filter({ visible: true });
const open = async (page: Page, id: string) => {
  await page.goto(`/admin/materiais/${id}`);
  await page.waitForLoadState("networkidle");
};
const objects = async (): Promise<string[]> => (await fetch(`${MOCK}/__objects`)).json();
const input = (page: Page) => page.locator("input[type=file]");

const JPEG = (extra = 200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra, 7)]);
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 3)]);
const PDFBYTES = () => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(300, 0x20)]);
const jpg = (name: string, extra?: number) => ({ name, mimeType: "image/jpeg", buffer: JPEG(extra) });

function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("imagem: o primeiro envio cria a versão 1 e mostra o arquivo pela rota protegida", async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page);
  await open(page, IMG);
  await expect(page.getByText(/Nenhum arquivo ainda/)).toBeVisible();
  await expect(page.getByText(/Nenhuma versão ainda/)).toBeVisible();

  await input(page).setInputFiles(jpg("arte-principal.jpg"));
  await expect(page.getByText("Arquivo enviado com sucesso.")).toBeVisible();
  await expect(shown(page.getByText("arte-principal.jpg").first())).toBeVisible();

  // arquivo na lista de slides e a versão 1 no histórico
  const img = shown(page.getByAltText("arte-principal.jpg")).first();
  await expect(img).toHaveAttribute("src", /^\/admin\/arquivos\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Arquivos · versão 1/ })).toBeVisible();
  const history = page.getByRole("list", { name: "Versões do material" });
  await expect(history).toContainText("Versão 1");
  await expect(history).toContainText("Em edição");

  // a rota protegida redireciona para uma URL assinada de curta duração, sem cache
  const src = (await img.getAttribute("src"))!;
  const redirect = await page.request.get(src, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers()["cache-control"]).toBe("private, no-store");
  const location = redirect.headers()["location"];
  expect(location).toContain("/storage/v1/object/sign/materials/");
  const served = await page.request.get(location);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/jpeg");
  expect(errors).toEqual([]);
});

test("conteúdo que não bate com o formato é recusado e o objeto enviado é apagado", async ({ page }) => {
  await login(page);
  await open(page, IMG);
  const before = await objects();
  await input(page).setInputFiles({ name: "falso.jpg", mimeType: "image/jpeg", buffer: Buffer.from("MZ\x90\x00 isto é um executável, não uma imagem".padEnd(300, " ")) });
  await expect(page.getByText(/O conteúdo não corresponde ao formato/)).toBeVisible();
  await expect(page.getByText("Falhou")).toBeVisible();
  expect(await objects()).toEqual(before); // nada ficou no storage
  await expect(shown(page.getByAltText("falso.jpg"))).toHaveCount(0);
});

test("formato não aceito e arquivo grande demais são recusados na tela, antes de qualquer envio", async ({ page }) => {
  await login(page);
  await open(page, IMG);
  const before = await objects();
  await input(page).setInputFiles({ name: "anim.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await expect(page.getByText(/Formato não aceito/)).toBeVisible();
  await input(page).setInputFiles({ name: "enorme.jpg", mimeType: "image/jpeg", buffer: Buffer.concat([JPEG(), Buffer.alloc(21 * 1024 * 1024)]) });
  await expect(page.getByText(/Arquivo grande demais/)).toBeVisible();
  expect(await objects()).toEqual(before);
});

test("imagem tem arquivo único: um novo envio SUBSTITUI o anterior e apaga o objeto antigo", async ({ page }) => {
  await login(page);
  await open(page, IMG);
  await expect(page.getByRole("button", { name: "Substituir arquivo" })).toBeVisible();
  const before = (await objects()).filter((p) => p.includes(`/${IMG}/`));
  expect(before).toHaveLength(1);
  await input(page).setInputFiles({ name: "arte-nova.png", mimeType: "image/png", buffer: PNG() });
  await expect(page.getByText("Arquivo enviado com sucesso.")).toBeVisible();
  await expect(shown(page.getByAltText("arte-nova.png")).first()).toBeVisible();
  await expect(shown(page.getByAltText("arte-principal.jpg"))).toHaveCount(0);
  const after = (await objects()).filter((p) => p.includes(`/${IMG}/`));
  expect(after).toHaveLength(1);
  expect(after[0]).not.toBe(before[0]);
});

test("PDF: aceita só PDF de verdade e oferece abrir em nova aba", async ({ page }) => {
  await login(page);
  await open(page, PDF);
  await input(page).setInputFiles({ name: "proposta.pdf", mimeType: "application/pdf", buffer: PDFBYTES() });
  await expect(page.getByText("Arquivo enviado com sucesso.")).toBeVisible();
  const link = shown(page.getByRole("link", { name: /Abrir PDF/ })).first();
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
});

test("carrossel: vários slides em ordem, reordenar, remover com confirmação e limite de 10", async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page);
  await open(page, CAR);
  await input(page).setInputFiles([jpg("slide-a.jpg", 100), jpg("slide-b.jpg", 110), { name: "slide-c.png", mimeType: "image/png", buffer: PNG() }]);
  await expect(page.getByText("3 arquivos enviados com sucesso.")).toBeVisible();

  const names = () => shown(page.locator("ol[aria-label='Slides do carrossel'] li p.truncate")).allTextContents();
  await expect.poll(names).toEqual(["slide-a.jpg", "slide-b.jpg", "slide-c.png"]);

  await page.getByRole("button", { name: "Mover o slide 1 para baixo" }).click();
  await expect.poll(names).toEqual(["slide-b.jpg", "slide-a.jpg", "slide-c.png"]);
  await page.reload();
  await expect.poll(names).toEqual(["slide-b.jpg", "slide-a.jpg", "slide-c.png"]); // persistiu

  await page.getByRole("button", { name: "Remover o slide 2" }).click();
  await expect(page.getByRole("dialog").getByText(/apagado do armazenamento/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Remover" }).click();
  await expect.poll(names).toEqual(["slide-b.jpg", "slide-c.png"]);
  await expect(page.getByText("Slide 2")).toBeVisible();
  expect((await objects()).filter((p) => p.includes(`/${CAR}/`))).toHaveLength(2);

  // limite de 10: 2 existentes + 9 novos = 11
  await input(page).setInputFiles(Array.from({ length: 9 }, (_, i) => jpg(`extra-${i}.jpg`, 50 + i)));
  await expect(page.getByText(/no máximo 10 slides/)).toBeVisible();
  expect((await objects()).filter((p) => p.includes(`/${CAR}/`))).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("falha de rede (um dos PUTs aborta): 1 de 2 enviados e 'Tentar de novo' envia só o que falhou", async ({ page }) => {
  await login(page);
  await open(page, CAR);
  const before = (await objects()).filter((p) => p.includes(`/${CAR}/`)).length;
  let puts = 0;
  let fail = true;
  await page.route("**/storage/v1/object/upload/sign/**", (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    puts += 1;
    if (fail && puts === 2) return route.abort("failed");
    return route.continue();
  });
  await input(page).setInputFiles([jpg("ok-1.jpg", 70), jpg("cai-2.jpg", 71)]);
  await expect(page.getByText(/1 de 2 arquivos enviados/)).toBeVisible();
  await expect(page.getByText(/Sem conexão com o armazenamento/)).toBeVisible();
  const retry = page.getByRole("button", { name: /Tentar de novo \(1\)/ });
  await expect(retry).toBeVisible();
  fail = false;
  await retry.click();
  await expect(page.getByText("Arquivo enviado com sucesso.")).toBeVisible();
  await expect.poll(async () => (await objects()).filter((p) => p.includes(`/${CAR}/`)).length).toBe(before + 2);
});

test("material aprovado: arquivos travados, histórico com o conteúdo congelado e 'Iniciar revisão' preserva a versão 1", async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page);
  await open(page, APR);
  await expect(page.getByText(/estão travados porque o material já foi enviado/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Substituir arquivo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Remover/ })).toHaveCount(0);
  await expect(shown(page.getByAltText("arte-aprovada.jpg")).first()).toBeVisible();

  const history = page.getByRole("list", { name: "Versões do material" });
  await expect(history).toContainText("Enviada");
  // com uma única versão o histórico já vem aberto
  await expect(history.getByText("Legenda aprovada pelo cliente")).toBeVisible();
  await expect(history.getByText(/Cópia imutável registrada/)).toBeVisible();

  // revisão explícita, com motivo
  await page.getByRole("button", { name: "Iniciar revisão" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/preservados no histórico/)).toBeVisible();
  const submit = dialog.getByRole("button", { name: "Iniciar revisão" });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("Motivo da revisão").fill("Trocar o preço do slide");
  await submit.click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Arquivos · versão 2/ })).toBeVisible();
  await expect(shown(page.locator("[data-slot=badge]", { hasText: "Rascunho" })).first()).toBeVisible();
  await expect(history).toContainText("Versão 2");
  await expect(history).toContainText("Trocar o preço do slide");
  // a versão 1 continua lá, com o arquivo e a cópia do conteúdo
  await history.getByText("Versão 1").click();
  await expect(history.getByText("arte-aprovada.jpg").first()).toBeVisible();
  await expect(history.getByText("Legenda aprovada pelo cliente")).toBeVisible();

  // a v2 aceita arquivos; a v1 não mudou
  await input(page).setInputFiles(jpg("arte-v2.jpg", 150));
  await expect(page.getByText("Arquivo enviado com sucesso.")).toBeVisible();
  await expect(shown(page.getByAltText("arte-v2.jpg")).first()).toBeVisible();
  await expect(history.getByText("arte-aprovada.jpg").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("alteração pedida também entra em revisão; motivo curto não é aceito", async ({ page }) => {
  await login(page);
  await open(page, ALT);
  await page.getByRole("button", { name: "Iniciar revisão" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motivo da revisão").fill("curto");
  await expect(dialog.getByRole("button", { name: "Iniciar revisão" })).toBeDisabled();
  await dialog.getByLabel("Motivo da revisão").fill("Aplicar as alterações pedidas pelo cliente");
  await dialog.getByRole("button", { name: "Iniciar revisão" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Arquivos · versão 2/ })).toBeVisible();
});

test("a rota protegida de arquivos: anônimo e aprovador não abrem; inexistente é 404", async ({ page, browser }) => {
  const anon = await browser.newContext({ baseURL: "http://localhost:3102" });
  const anonymous = await anon.request.get(`/admin/arquivos/${APR_FILE}`, { maxRedirects: 0 });
  expect([307, 308, 401]).toContain(anonymous.status());
  expect(anonymous.headers()["location"] ?? "").not.toContain("/storage/");
  await anon.close();

  await login(page, "cliente1@luvi.test");
  const asClient = await page.request.get(`/admin/arquivos/${APR_FILE}`, { maxRedirects: 0 });
  expect(asClient.status()).not.toBe(302);
  expect(asClient.headers()["location"] ?? "").not.toContain("/storage/");

  await page.context().clearCookies();
  await login(page);
  expect((await page.request.get(`/admin/arquivos/00000000-0000-4000-8000-00000000dead`, { maxRedirects: 0 })).status()).toBe(404);
  expect((await page.request.get(`/admin/arquivos/nao-e-uuid`, { maxRedirects: 0 })).status()).toBe(404);
  expect((await page.request.get(`/admin/arquivos/${APR_FILE}`, { maxRedirects: 0 })).status()).toBe(302);
});

test("celular: a página do material com slides não gera rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page);
  await open(page, CAR);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole("button", { name: "Adicionar slides" })).toBeVisible();
});
