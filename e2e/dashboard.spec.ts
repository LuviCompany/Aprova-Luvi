import { expect, test, type Page } from "@playwright/test";

/**
 * Dashboard com dados REAIS (etapa E do Módulo 3): modo real com sessão, contra o servidor falso de Auth + PostgREST.
 * Os números saem das mesmas tabelas que as telas de materiais usam; nada fictício aparece.
 */

const MOCK = "http://127.0.0.1:59998";
const CLIENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CLIENT_B = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const PROJECT = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const PROJECT_B = "5e6f7081-2b3c-4d4e-8f90-1b2c3d4e5f60";
const M = (n: number) => `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c0${n}`;

test.describe.configure({ mode: "serial" });

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const when = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

async function login(page: Page, email = "admin@luvi.test", landing: RegExp = /\/admin$/) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("qualquer-senha-1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(landing);
}

test("sem dados: dashboard real vazio, com orientação, sem aviso de demonstração e sem números inventados", async ({ page }) => {
  await fetch(`${MOCK}/__reset`);
  await login(page);
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
  await expect(page.getByText(/Ainda não há materiais cadastrados/)).toBeVisible();
  await expect(page.getByText("0 clientes ativos · 0 projetos ativos · 0 materiais")).toBeVisible();
  await expect(page.getByText(/Nenhuma decisão registrada ainda/)).toBeVisible();
  const values = await page.getByTestId("kpi-value").allTextContents();
  expect(values).toEqual(["0", "0", "0", "0"]);
  // nenhum dado da demonstração
  await expect(page.getByText(/Casa Aurora|Outubro de 2026|Fase 1/)).toHaveCount(0);
});

test("com dados: indicadores, vencidos, próximos prazos, materiais e atividade vêm do banco", async ({ page }) => {
  await fetch(`${MOCK}/__seed`, {
    method: "POST",
    body: JSON.stringify({
      clients: [
        { id: CLIENT, name: "Casa Aurora Teste" },
        { id: CLIENT_B, name: "Studio Vento Teste", active: false },
      ],
      projects: [
        { id: PROJECT, client_id: CLIENT, name: "Campanha de verão" },
        { id: PROJECT_B, client_id: CLIENT, name: "Projeto pausado", status: "pausado" },
      ],
      materials: [
        { id: M(1), client_id: CLIENT, project_id: PROJECT, title: "Carrossel atrasado", type: "carrossel", status: "aguardando", due_date: day(-3) },
        { id: M(2), client_id: CLIENT, project_id: PROJECT, title: "Vídeo no prazo", type: "video", status: "aguardando", due_date: day(5) },
        { id: M(3), client_id: CLIENT, project_id: PROJECT, title: "Peça com alteração", type: "imagem", status: "alteracao", due_date: day(9) },
        { id: M(4), client_id: CLIENT, project_id: PROJECT, title: "Post aprovado", type: "imagem", status: "aprovado" },
        { id: M(5), client_id: CLIENT, project_id: PROJECT, title: "Rascunho em andamento", type: "pdf" },
      ],
      decisions: [
        { material_id: M(4), decision: "aprovado", created_at: when(2), requested_at: when(26), approver_name: "Marina Prado" },
        { material_id: M(3), decision: "alteracao", created_at: when(30), requested_at: when(40), approver_name: "Paulo Aurora", via: "link" },
      ],
    }),
  });
  await login(page);
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByTestId("kpi-value")).toHaveText(["2", "1", "1", "1"]); // aguardando, alteração, aprovados no mês, rascunhos
  await expect(page.getByText("1 com prazo vencido")).toBeVisible();
  await expect(page.getByText(/1 cliente ativo · 1 projeto ativo · 5 materiais/)).toBeVisible();
  await expect(page.getByText(/tempo médio de aprovação 1,0 dias|24,0 h/)).toBeVisible();

  const overdue = page.getByRole("region", { name: "Prazos vencidos" });
  await expect(overdue).toContainText("1 material está com o prazo de aprovação vencido");
  await expect(overdue.getByRole("link", { name: "Carrossel atrasado" })).toBeVisible();

  await expect(page.getByText("Marina Prado")).toBeVisible();
  await expect(page.getByText(/aprovou/)).toBeVisible();
  await expect(page.getByText(/pediu alteração em/)).toBeVisible();
  await expect(page.getByText(/via link seguro/)).toBeVisible();

  // os materiais recentes levam ao detalhe real
  await page.getByRole("link", { name: "Rascunho em andamento" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/materiais/${M(5)}$`));
  await expect(page.getByRole("heading", { name: "Rascunho em andamento", level: 1 })).toBeVisible();
});

test("designer vê o painel; o aprovador (papel cliente) é levado ao portal", async ({ page }) => {
  await login(page, "designer@luvi.test");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByTestId("kpi-value")).toHaveCount(4);
  await page.context().clearCookies();
  await login(page, "cliente1@luvi.test", /\/portal/);
  await page.goto("/admin", { waitUntil: "commit" }).catch(() => undefined);
  await expect(page).toHaveURL(/\/portal/);
});

test("celular: sem rolagem horizontal no dashboard", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page);
  await expect(page.getByTestId("kpi-value").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
