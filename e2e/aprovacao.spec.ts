import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Motor de aprovação (Módulo 4), modo real com sessão, contra o servidor falso (e2e/support/mock-supabase.mjs +
 * mock-approval.mjs) e o app em :3103 (chave secreta, segredo do link e e-mail SIMULADO). Cobre o ciclo completo
 * (envio -> portal -> pedido de alteração -> nova versão -> reenvio -> aprovação por portal e por link) e os caminhos
 * de segurança do link (revogado, código inválido, limite de tentativas, código e link expirados).
 * A RLS, a concorrência e os limites de verdade estão em src/test/db (Postgres em memória com as migrations D1/D2).
 */

const MOCK = "http://127.0.0.1:59998";
const APP = "http://localhost:3103";

const CLIENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PROJECT = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const A_MARINA = "a0000000-0000-4000-8000-000000000001"; // com login (cliente@luvi.test)
const A_REVISOR = "a0000000-0000-4000-8000-000000000002"; // só link
const MARINA_PROFILE = "44444444-4444-4444-8444-444444444444";
const M_CYCLE = "b0000000-0000-4000-8000-000000000001";
const M_REVOKE = "b0000000-0000-4000-8000-000000000002";
const M_LIMIT = "b0000000-0000-4000-8000-000000000003";
const M_EXPIRE = "b0000000-0000-4000-8000-000000000004";

test.describe.configure({ mode: "serial" });

const seedDraft = (id: string, title: string) => ({
  material: { id, client_id: CLIENT, project_id: PROJECT, title, type: "imagem", caption: `Legenda de ${title}` },
  version: { id: id.replace("b0", "c0"), material_id: id, client_id: CLIENT, note: "v1" },
  file: {
    id: id.replace("b0", "d0"),
    version_id: id.replace("b0", "c0"),
    material_id: id,
    client_id: CLIENT,
    slide_position: 1,
    kind: "imagem",
    mime_type: "image/jpeg",
    original_name: `${title}.jpg`,
    storage_path: `${CLIENT}/${id}/${title}.jpg`,
  },
});

test.beforeAll(async () => {
  await fetch(`${MOCK}/__reset`);
  const extra = [seedDraft(M_REVOKE, "Peça revogada"), seedDraft(M_LIMIT, "Peça limite"), seedDraft(M_EXPIRE, "Peça expira")];
  await fetch(`${MOCK}/__seed`, {
    method: "POST",
    body: JSON.stringify({
      clients: [{ id: CLIENT, name: "Casa Aurora Teste" }],
      projects: [{ id: PROJECT, client_id: CLIENT, name: "Campanha de verão" }],
      approvers: [
        { id: A_MARINA, client_id: CLIENT, name: "Marina Prado", email: "cliente@luvi.test", profile_id: MARINA_PROFILE },
        { id: A_REVISOR, client_id: CLIENT, name: "Revisor Casa", email: "revisor@casa.test" },
      ],
      materials: [{ id: M_CYCLE, client_id: CLIENT, project_id: PROJECT, title: "Post de lançamento", type: "imagem", caption: "Legenda do lançamento" }, ...extra.map((e) => e.material)],
      versions: extra.map((e) => e.version),
      files: extra.map((e) => e.file),
    }),
  });
});

async function login(page: Page, email: string, landing: RegExp) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("qualquer-senha-1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(landing);
}
const asAdmin = (page: Page) => login(page, "admin@luvi.test", /\/admin$/);
const asMarina = (page: Page) => login(page, "cliente@luvi.test", /\/portal$/);

const JPEG = (extra = 200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra, 7)]);
const jpg = (name: string, extra?: number) => ({ name, mimeType: "image/jpeg", buffer: JPEG(extra) });
const request = (page: Page, name: string) => page.getByTestId("approval-request").filter({ hasText: name });

async function openAdmin(page: Page, id: string) {
  await page.goto(`/admin/materiais/${id}`);
  await page.waitForLoadState("networkidle");
}

async function sendToApprovers(page: Page, names: string[]) {
  await page.getByRole("button", { name: "Enviar para aprovação" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/todos os aprovadores escolhidos aprovarem/)).toBeVisible();
  for (const name of names) await dialog.getByRole("checkbox", { name: new RegExp(name) }).check();
  await dialog.getByRole("button", { name: /^Enviar para \d+ aprovador/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

// ---- API direta ao servidor falso, como a equipe (para preparar cenários sem repetir a interface)
async function adminToken(): Promise<string> {
  const response = await fetch(`${MOCK}/auth/v1/token`, { method: "POST", body: JSON.stringify({ email: "admin@luvi.test", password: "x" }) });
  return ((await response.json()) as { access_token: string }).access_token;
}
async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${MOCK}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await adminToken()}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${fn}: ${JSON.stringify(body)}`);
  return body;
}
const versionOf = (materialId: string) => materialId.replace("b0", "c0");
/** Envia o material ao Revisor e cria um link com token conhecido (o banco recebe só o hash, como no app). */
async function linkFor(materialId: string): Promise<string> {
  await rpc("submit_for_approval", { p_version_id: versionOf(materialId), p_approver_ids: [A_REVISOR], p_due_at: null, p_message: "" });
  const requests = await listRequests(materialId);
  const token = randomBytes(32).toString("base64url");
  await rpc("create_approval_link", {
    p_request_id: requests[0],
    p_approver_id: A_REVISOR,
    p_token_hash: createHash("sha256").update(token).digest("hex"),
    p_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  return token;
}
async function listRequests(materialId: string): Promise<string[]> {
  const response = await fetch(`${MOCK}/rest/v1/approval_requests?material_id=eq.${materialId}`, { headers: { authorization: `Bearer ${await adminToken()}` } });
  return ((await response.json()) as Array<{ id: string }>).map((r) => r.id);
}
const hook = (name: string) => fetch(`${MOCK}/__approval/${name}`);

async function latestCode(to: string): Promise<string> {
  const { messages } = (await (await fetch(`${APP}/api/dev/outbox`)).json()) as { messages: Array<{ to: string; subject: string; text: string }> };
  const mail = [...messages].reverse().find((m) => m.to === to && m.subject.startsWith("Seu código"));
  const code = mail?.text.match(/é: (\d{6})/)?.[1];
  if (!code) throw new Error("código não encontrado na caixa de saída simulada");
  return code;
}

async function anonymous(browser: Browser) {
  const context = await browser.newContext({ baseURL: APP });
  return { context, page: await context.newPage() };
}
const requestCode = async (page: Page) => {
  await page.getByRole("button", { name: "Enviar código por e-mail" }).click();
  await expect(page.getByText(/Código enviado/)).toBeVisible();
};
const typeCode = async (page: Page, code: string) => {
  await page.getByLabel("Código de 6 números").fill(code);
  await page.getByRole("button", { name: "Confirmar e abrir o material" }).click();
};
const wrongCode = (real: string) => (real === "000000" ? "111111" : "000000");

// ---------------------------------------------------------------------------------------------------------------
test("a caixa de saída simulada só existe com o provedor simulado", async ({ request: api }) => {
  const response = await api.get(`${APP}/api/dev/outbox`);
  expect(response.status()).toBe(200);
  expect((await response.json()).messages).toBeInstanceOf(Array);
});

test("envio: a equipe sobe o arquivo, escolhe os dois aprovadores e acompanha quem falta; o dashboard também", async ({ page }) => {
  await asAdmin(page);
  await openAdmin(page, M_CYCLE);
  await expect(page.getByRole("button", { name: "Enviar para aprovação" }).first()).toBeDisabled(); // sem arquivo ainda
  await page.locator("input[type=file]").setInputFiles(jpg("lancamento.jpg"));
  await expect(page.getByText("Arquivo enviado com sucesso.")).toBeVisible();
  await page.reload();
  await page.waitForLoadState("networkidle");

  await sendToApprovers(page, ["Marina Prado", "Revisor Casa"]);
  const panel = page.getByRole("region", { name: "Envio da versão 1" });
  await expect(panel).toContainText("Em andamento");
  await expect(panel).toContainText("0 de 2 responderam");
  await expect(request(page, "Marina Prado")).toContainText("Pendente");
  await expect(request(page, "Revisor Casa")).toContainText("Pendente");
  await expect(page.locator("[data-slot=badge]", { hasText: "Aguardando aprovação" }).first()).toBeVisible();

  await page.goto("/admin");
  const waiting = page.getByTestId("waiting-list");
  await expect(waiting).toContainText("Post de lançamento");
  await expect(waiting).toContainText("falta responder: Marina Prado, Revisor Casa");
});

test("portal: o aprovador vê o material pendente com o arquivo protegido, comenta e pede alteração (nota obrigatória)", async ({ page }) => {
  await asMarina(page);
  await expect(page.getByRole("heading", { name: /Aguardando sua aprovação/ })).toBeVisible();
  await page.getByRole("link", { name: /Post de lançamento/ }).click();
  await expect(page.getByRole("heading", { name: "Post de lançamento", level: 1 })).toBeVisible();
  await expect(page.getByText(/Conteúdo exatamente como foi enviado/)).toBeVisible();

  // arquivo só pela rota protegida do portal, com URL assinada curta
  const img = page.getByAltText("lancamento.jpg");
  const src = (await img.getAttribute("src"))!;
  expect(src).toMatch(/^\/portal\/arquivos\/[0-9a-f-]{36}$/);
  const redirect = await page.request.get(src, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers()["cache-control"]).toBe("private, no-store");
  expect((await page.request.get(redirect.headers()["location"])).status()).toBe(200);

  await page.getByLabel("Novo comentário").fill("O logo ficou pequeno no canto.");
  await page.getByRole("button", { name: "Comentar" }).click();
  await expect(page.getByTestId("comment-list")).toContainText("O logo ficou pequeno no canto.");

  await page.getByRole("button", { name: "Solicitar alteração" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("O que precisa mudar?").fill("curto");
  await expect(dialog.getByRole("button", { name: "Enviar solicitação" })).toBeDisabled();
  await dialog.getByLabel("O que precisa mudar?").fill("Aumentar o logo e trocar a cor do fundo.");
  await dialog.getByRole("button", { name: "Enviar solicitação" }).click();

  await expect(page.getByText("Este material está em ajustes")).toBeVisible();
  await expect(page.getByTestId("decision-history")).toContainText("Você pediu alteração · versão 1");
  await page.goto("/portal/historico");
  await expect(page.getByTestId("portal-history")).toContainText("Alteração solicitada");
});

test("outro login sem vínculo com a empresa e anônimo não abrem o arquivo do portal", async ({ browser }) => {
  const { context, page } = await anonymous(browser);
  const files = (await (await fetch(`${MOCK}/rest/v1/material_files?client_id=eq.${CLIENT}`, { headers: { authorization: `Bearer ${await adminToken()}` } })).json()) as Array<{ id: string }>;
  const anon = await page.request.get(`/portal/arquivos/${files[0].id}`, { maxRedirects: 0 });
  expect([307, 308, 401]).toContain(anon.status());
  expect(anon.headers()["location"] ?? "").not.toContain("/storage/");
  await login(page, "cliente1@luvi.test", /\/(login|portal)/);
  const other = await page.request.get(`/portal/arquivos/${files[0].id}`, { maxRedirects: 0 });
  expect(other.status()).not.toBe(302);
  await context.close();
});

test("ajustes: o restante do envio foi cancelado, a equipe cria a nova versão e reenvia; a versão 1 fica no histórico", async ({ page }) => {
  await asAdmin(page);
  await openAdmin(page, M_CYCLE);
  await expect(page.getByRole("region", { name: "Envio da versão 1" })).toContainText("Alteração solicitada");
  await expect(request(page, "Marina Prado")).toContainText("Pediu alteração");
  await expect(request(page, "Marina Prado")).toContainText("Aumentar o logo e trocar a cor do fundo.");
  await expect(request(page, "Revisor Casa")).toContainText("Cancelada");

  await page.getByRole("button", { name: "Iniciar revisão" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motivo da revisão").fill("Aplicar as alterações pedidas pelo cliente");
  await dialog.getByRole("button", { name: "Iniciar revisão" }).click();
  await expect(page.getByRole("heading", { name: /Arquivos · versão 2/ })).toBeVisible();
  await page.locator("input[type=file]").setInputFiles(jpg("lancamento-v2.jpg", 150));
  await expect(page.getByText("Arquivo enviado com sucesso.")).toBeVisible();
  await page.reload();
  await page.waitForLoadState("networkidle");

  await sendToApprovers(page, ["Marina Prado", "Revisor Casa"]);
  await expect(page.getByRole("region", { name: "Envio da versão 2" })).toContainText("Em andamento");
  await expect(page.getByRole("region", { name: "Envio da versão 1" })).toContainText("Alteração solicitada"); // histórico preservado
  const history = page.getByRole("list", { name: "Versões do material" });
  await expect(history).toContainText("Versão 2");
  await expect(history).toContainText("Versão 1");
});

test("portal: a v2 aparece como pendente; a aprovação é registrada e o material espera o outro aprovador", async ({ page }) => {
  await asMarina(page);
  await expect(page.getByRole("heading", { name: /Aguardando sua aprovação/ })).toBeVisible();
  await page.getByRole("link", { name: /Post de lançamento/ }).click();
  await expect(page.getByText("Versão 2").first()).toBeVisible();
  await expect(page.getByAltText("lancamento-v2.jpg")).toBeVisible();
  await page.getByRole("button", { name: "Aprovar", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar aprovação" }).click();
  await expect(page.getByText(/Você já respondeu. Aguardando os outros aprovadores/)).toBeVisible();
  await expect(page.getByTestId("decision-history")).toContainText("Você aprovou · versão 2");
  await expect(page.getByTestId("decision-history")).toContainText("Você pediu alteração · versão 1"); // histórico completo
  await page.goto("/portal/materiais?filtro=aguardando_outros");
  await expect(page.getByRole("link", { name: /Post de lançamento/ })).toBeVisible();
});

test("link rápido: a equipe gera o link; o aprovador confirma com código (errado e depois certo), revisa e aprova; o link não vale de novo", async ({ page, browser }) => {
  await asAdmin(page);
  await openAdmin(page, M_CYCLE);
  const v2 = page.getByRole("region", { name: "Envio da versão 2" });
  await v2.getByTestId("approval-request").filter({ hasText: "Revisor Casa" }).getByRole("button", { name: "Gerar link rápido" }).click();
  const created = page.getByRole("status").filter({ hasText: "Link criado." });
  await expect(created).toContainText("Este endereço aparece só agora.");
  await expect(created).toContainText("Enviamos por e-mail ao aprovador.");
  const url = (await created.locator("code").textContent())!.trim();
  expect(url).toMatch(/\/aprovar\/[A-Za-z0-9_-]{43}$/);

  const { context, page: guest } = await anonymous(browser);
  await guest.goto(url);
  await expect(guest.getByRole("heading", { name: "Confirme que é você" })).toBeVisible();
  await expect(guest.getByText("r***@casa.test")).toBeVisible();
  await expect(guest.getByText("Post de lançamento")).toHaveCount(0); // nada do material antes da verificação
  await requestCode(guest);

  const code = await latestCode("revisor@casa.test");
  await typeCode(guest, wrongCode(code));
  await expect(guest.locator("p[role=alert]")).toContainText("Código incorreto. Restam 4 tentativas.");
  await typeCode(guest, code);

  await expect(guest.getByRole("heading", { name: "Post de lançamento" })).toBeVisible();
  const src = (await guest.getByAltText("lancamento-v2.jpg").getAttribute("src"))!;
  expect(src).toMatch(/^\/aprovar\/[A-Za-z0-9_-]{43}\/arquivos\/[0-9a-f-]{36}$/);
  const redirect = await guest.request.get(src, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers()["location"]).toContain("/storage/v1/object/sign/materials/");
  // outro navegador, sem a sessão do link, não abre o arquivo
  const stranger = await browser.newContext({ baseURL: APP });
  expect((await stranger.request.get(src, { maxRedirects: 0 })).status()).toBe(404);
  await stranger.close();

  await guest.getByRole("button", { name: "Aprovar", exact: true }).click();
  await guest.getByRole("dialog").getByRole("button", { name: "Confirmar aprovação" }).click();
  await expect(guest.getByRole("heading", { name: "Link já utilizado" })).toBeVisible();
  await guest.goto(url);
  await expect(guest.getByRole("heading", { name: "Link já utilizado" })).toBeVisible();
  expect((await guest.request.get(src, { maxRedirects: 0 })).status()).toBe(404);
  await context.close();

  // os dois aprovaram: o material está aprovado e a equipe vê as duas decisões (portal e link)
  await openAdmin(page, M_CYCLE);
  await expect(page.getByRole("region", { name: "Envio da versão 2" })).toContainText("Aprovada por todos");
  const final = page.getByRole("region", { name: "Envio da versão 2" });
  await expect(final.getByTestId("approval-request").filter({ hasText: "Marina Prado" })).toContainText("portal");
  await expect(final.getByTestId("approval-request").filter({ hasText: "Revisor Casa" })).toContainText("link rápido");
  await expect(page.locator("[data-slot=badge]", { hasText: "Aprovado" }).first()).toBeVisible();
});

test("link revogado pela equipe deixa de abrir (mesmo com o token certo)", async ({ page, browser }) => {
  const token = await linkFor(M_REVOKE);
  const { context, page: guest } = await anonymous(browser);
  await guest.goto(`/aprovar/${token}`);
  await expect(guest.getByRole("heading", { name: "Confirme que é você" })).toBeVisible();

  await asAdmin(page);
  await openAdmin(page, M_REVOKE);
  await expect(request(page, "Revisor Casa")).toContainText("link ativo");
  await request(page, "Revisor Casa").getByRole("button", { name: "Revogar link" }).click();
  await expect(request(page, "Revisor Casa")).toContainText("link revogado");

  await guest.goto(`/aprovar/${token}`);
  await expect(guest.getByRole("heading", { name: "Link revogado" })).toBeVisible();
  // o desconhecido responde como inválido, sem revelar nada
  await guest.goto(`/aprovar/${randomBytes(32).toString("base64url")}`);
  await expect(guest.getByRole("heading", { name: "Link inválido" })).toBeVisible();
  await context.close();
});

test("código inválido: 5 tentativas e o código é bloqueado, até o certo; novo código só depois do intervalo", async ({ browser }) => {
  const token = await linkFor(M_LIMIT);
  const { context, page: guest } = await anonymous(browser);
  await guest.goto(`/aprovar/${token}`);
  await requestCode(guest);
  const code = await latestCode("revisor@casa.test");
  const bad = wrongCode(code);
  for (const left of [4, 3, 2, 1, 0]) {
    await typeCode(guest, bad);
    await expect(guest.locator("p[role=alert]")).toContainText(`Restam ${left} tentativa`);
  }
  await typeCode(guest, code); // o código certo já não vale: está bloqueado
  await expect(guest.locator("p[role=alert]")).toContainText("Muitas tentativas erradas com este código");

  // pedir outro código logo em seguida é barrado pelo intervalo de 1 minuto
  await guest.getByRole("button", { name: "Enviar outro código" }).click();
  await expect(guest.locator("p[role=alert]")).toContainText("Aguarde um minuto");
  await hook("expire-cooldown");
  await guest.getByRole("button", { name: "Enviar outro código" }).click();
  await expect(guest.locator("p[role=alert]")).toHaveCount(0);
  const fresh = await latestCode("revisor@casa.test");
  await typeCode(guest, fresh);
  await expect(guest.getByRole("heading", { name: "Peça limite" })).toBeVisible();
  await context.close();
});

test("código expirado e link expirado são recusados com mensagem clara", async ({ browser }) => {
  const token = await linkFor(M_EXPIRE);
  const { context, page: guest } = await anonymous(browser);
  await guest.goto(`/aprovar/${token}`);
  await requestCode(guest);
  const code = await latestCode("revisor@casa.test");
  await hook("expire-code");
  await typeCode(guest, code);
  await expect(guest.locator("p[role=alert]")).toContainText("Este código expirou ou não foi pedido");

  await hook("expire-link");
  await guest.goto(`/aprovar/${token}`);
  await expect(guest.getByRole("heading", { name: "Link expirado" })).toBeVisible();
  await context.close();
});

test("o token nunca aparece no HTML de outras páginas nem no dashboard (só na URL enviada)", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/admin");
  await expect(page.getByTestId("waiting-list")).toBeVisible();
  const html = await page.content();
  expect(html).not.toMatch(/\/aprovar\/[A-Za-z0-9_-]{43}/);
  expect(html).not.toMatch(/token_hash/);
});
