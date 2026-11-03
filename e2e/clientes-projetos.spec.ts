import { expect, test, type Locator, type Page } from "@playwright/test";

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

/** Só elementos visíveis: o Next mantém a página anterior montada e oculta depois de navegar. */
const shown = (locator: Locator) => locator.filter({ visible: true });

/** Erros não tratados da página (por exemplo, um componente lançando ao renderizar). */
function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("admin: o aviso de demonstração fica só nas telas que ainda usam dados fictícios", async ({ page }) => {
  await login(page, "admin@luvi.test");
  // O dashboard agora lê o banco real: sem aviso. Histórico e usuários ainda usam dados fictícios.
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
  await page.goto("/admin/historico");
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
  await expect(shown(page.getByText("Nenhum aprovador cadastrado."))).toBeVisible();
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
  await expect(shown(page.locator("[data-slot=badge]", { hasText: "Arquivado" }))).toBeVisible();

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
  await expect(shown(page.locator("[data-slot=badge]", { hasText: "Ativo" }))).toBeVisible();

  await page.getByRole("button", { name: "Editar Campanha de Verão" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Cliente")).toHaveCount(0); // o cliente não troca
  await dialog.getByLabel("Status").selectOption("pausado");
  await dialog.getByLabel("Nome do projeto").fill("Campanha de Verão 2027");
  await dialog.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("heading", { name: "Campanha de Verão 2027" })).toBeVisible();
  await expect(shown(page.locator("[data-slot=badge]", { hasText: "Pausado" }))).toBeVisible();
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

// ---------------------------------------------------------------------------------------------
// Etapa A.2: aprovadores, vínculo a vários clientes, convites preparados e escolha de empresa no portal.
// Recomeça com dados novos no servidor falso (a ordem serial garante que os testes acima já terminaram).
// ---------------------------------------------------------------------------------------------

const C = {
  aurora: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  vita: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  brisa: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const PORTAL_USER = "44444444-4444-4444-8444-444444444444"; // cliente@luvi.test
const PORTAL_USER_ONE = "55555555-5555-4555-8555-555555555555"; // cliente1@luvi.test

async function seed(data: unknown) {
  await fetch(`${MOCK}/__seed`, { method: "POST", body: JSON.stringify(data) });
}

test.describe("etapa A.2", () => {
  test.beforeAll(async () => {
    await fetch(`${MOCK}/__reset`);
    await seed({
      clients: [
        { id: C.aurora, name: "Casa Aurora", initials: "CA" },
        { id: C.vita, name: "Vita Nutri", initials: "VN" },
        { id: C.brisa, name: "Brisa Modas", initials: "BM" },
      ],
    });
  });

  test("detalhe do cliente abre pelo cartão; cliente inexistente é 'não encontrado'", async ({ page }) => {
    await login(page, "admin@luvi.test");
    await page.goto("/admin/clientes");
    await page.getByRole("link", { name: "Casa Aurora" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/clientes/${C.aurora}$`));
    await expect(page.getByRole("heading", { name: "Casa Aurora", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Aprovadores", level: 2 })).toBeVisible();
    await expect(shown(page.getByText("Nenhum aprovador cadastrado."))).toBeVisible();
    await expect(shown(page.getByText("Nenhum projeto cadastrado para este cliente."))).toBeVisible();

    await page.goto("/admin/clientes/dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
    await page.goto("/admin/clientes/nao-e-um-uuid");
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
  });

  test("cadastra um aprovador com o e-mail normalizado", async ({ page }) => {
    const errors = trackPageErrors(page);
    await login(page, "admin@luvi.test");
    await page.goto(`/admin/clientes/${C.aurora}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Novo aprovador" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Não pode ser alterado depois/)).toBeVisible();
    await dialog.getByLabel("Nome").fill("  Marina   Prado ");
    await dialog.getByLabel("E-mail").fill("  Marina@CasaAurora.test ");
    await dialog.getByLabel(/Cargo/).fill("Marketing");
    await dialog.getByRole("button", { name: "Cadastrar aprovador" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Marina Prado", level: 3 })).toBeVisible();
    await expect(shown(page.getByText("Marketing · marina@casaaurora.test"))).toBeVisible();
    await expect(shown(page.locator("[data-slot=badge]", { hasText: "Ativo" }))).toBeVisible();
    await expect(shown(page.locator("[data-slot=badge]", { hasText: "Só por link (sem login)" }))).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("e-mail repetido no mesmo cliente é recusado no campo", async ({ page }) => {
    await login(page, "admin@luvi.test");
    await page.goto(`/admin/clientes/${C.aurora}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Novo aprovador" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nome").fill("Outra Marina");
    await dialog.getByLabel("E-mail").fill("MARINA@casaaurora.test");
    await dialog.getByRole("button", { name: "Cadastrar aprovador" }).click();
    await expect(dialog.getByText("Este e-mail já está cadastrado neste cliente.")).toBeVisible();
    await expect(dialog.getByLabel("E-mail")).toHaveAttribute("aria-invalid", "true");
  });

  test("edita nome e cargo, mas o e-mail não é editável", async ({ page }) => {
    await login(page, "atendimento@luvi.test");
    await page.goto(`/admin/clientes/${C.aurora}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Editar Marina Prado" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("E-mail")).toHaveCount(0);
    await expect(dialog.getByText("marina@casaaurora.test")).toBeVisible();
    await dialog.getByLabel(/Cargo/).fill("Diretora de marketing");
    await dialog.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(shown(page.getByText("Diretora de marketing · marina@casaaurora.test"))).toBeVisible();
  });

  test("vincula a mesma pessoa a outro cliente; cada tela mostra 'também aprova para'", async ({ page }) => {
    const errors = trackPageErrors(page);
    await login(page, "admin@luvi.test");
    await page.goto(`/admin/clientes/${C.vita}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Vincular pessoa existente" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("option", { name: /Marina Prado · marina@casaaurora.test \(Casa Aurora\)/ })).toHaveCount(1);
    await dialog.getByLabel("Pessoa").selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Vincular a este cliente" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Marina Prado", level: 3 })).toBeVisible();
    await expect(shown(page.getByText(/Também aprova para:/))).toContainText("Casa Aurora");

    await page.goto(`/admin/clientes/${C.aurora}`);
    await expect(shown(page.getByText(/Também aprova para:/))).toContainText("Vita Nutri");
    expect(errors).toEqual([]);
  });

  test("a pessoa já vinculada não é mais oferecida como candidata", async ({ page }) => {
    await login(page, "admin@luvi.test");
    await page.goto(`/admin/clientes/${C.vita}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Vincular pessoa existente" }).click();
    await expect(page.getByRole("dialog").getByText(/Não há pessoas de outros clientes/)).toBeVisible();
  });

  test("convite: prepara e cancela, sem enviar nada", async ({ page }) => {
    await login(page, "admin@luvi.test");
    await page.goto(`/admin/clientes/${C.aurora}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Preparar convite de Marina Prado" }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Nenhum e-mail é enviado/)).toBeVisible();
    await dialog.getByRole("button", { name: "Preparar convite" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(shown(page.locator("[data-slot=badge]", { hasText: "Convite preparado (não enviado)" }))).toBeVisible();

    await page.getByRole("button", { name: "Cancelar convite de Marina Prado" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cancelar convite" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(shown(page.locator("[data-slot=badge]", { hasText: "Só por link (sem login)" }))).toBeVisible();
  });

  test("desativar num cliente não afeta o mesmo aprovador em outro, e o convite aberto cai junto", async ({ page }) => {
    await login(page, "admin@luvi.test");
    await page.goto(`/admin/clientes/${C.aurora}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Preparar convite de Marina Prado" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Preparar convite" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(shown(page.locator("[data-slot=badge]", { hasText: "Convite preparado (não enviado)" }))).toBeVisible();

    await page.getByRole("button", { name: "Desativar Marina Prado" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/links de aprovação ainda abertos são revogados/)).toBeVisible();
    await dialog.getByRole("button", { name: "Desativar aprovador" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(shown(page.locator("[data-slot=badge]", { hasText: "Inativo" }))).toBeVisible();
    await expect(shown(page.locator("[data-slot=badge]", { hasText: "Convite preparado" }))).toHaveCount(0);
    await expect(page.getByRole("button", { name: /convite/i })).toHaveCount(0);

    // Vita Nutri continua com a pessoa ativa
    await page.goto(`/admin/clientes/${C.vita}`);
    await expect(shown(page.locator("[data-slot=badge]", { hasText: "Ativo" }))).toBeVisible();
    await expect(shown(page.locator("[data-slot=badge]", { hasText: "Inativo" }))).toHaveCount(0);

    // reativar
    await page.goto(`/admin/clientes/${C.aurora}`);
    await page.getByRole("button", { name: "Reativar Marina Prado" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reativar aprovador" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(shown(page.locator("[data-slot=badge]", { hasText: "Ativo" }))).toBeVisible();
  });

  test("cliente arquivado: o painel não oferece aprovador, vínculo nem projeto novos", async ({ page }) => {
    await login(page, "admin@luvi.test");
    await page.goto(`/admin/clientes/${C.brisa}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Novo aprovador" })).toBeVisible();
    await page.getByRole("button", { name: "Arquivar Brisa Modas" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Arquivar cliente" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expect(page.getByRole("note")).toContainText(/arquivado/);
    await expect(page.getByRole("button", { name: "Novo aprovador" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Vincular pessoa existente" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Novo projeto" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reativar Brisa Modas" })).toBeVisible();
  });

  test("designer só consulta aprovadores", async ({ page }) => {
    await login(page, "designer@luvi.test");
    await page.goto(`/admin/clientes/${C.aurora}`);
    await expect(page.getByRole("heading", { name: "Marina Prado", level: 3 })).toBeVisible();
    await expect(page.getByRole("button", { name: /Novo aprovador|Editar|Desativar|Reativar|convite|Vincular|Arquivar/i })).toHaveCount(0);
    await expect(shown(page.getByText(/Seu perfil pode consultar os aprovadores/))).toBeVisible();
  });
});

test.describe("etapa A.2: escolha da empresa no portal", () => {
  test.beforeAll(async () => {
    await fetch(`${MOCK}/__reset`);
    await seed({
      clients: [
        { id: C.aurora, name: "Casa Aurora", initials: "CA" },
        { id: C.vita, name: "Vita Nutri", initials: "VN" },
      ],
      approvers: [
        { id: "a0000000-0000-4000-8000-000000000001", client_id: C.aurora, profile_id: PORTAL_USER, name: "Marina Prado", email: "cliente@luvi.test" },
        { id: "a0000000-0000-4000-8000-000000000002", client_id: C.vita, profile_id: PORTAL_USER, name: "Marina Prado", email: "cliente@luvi.test" },
        { id: "a0000000-0000-4000-8000-000000000003", client_id: C.aurora, profile_id: PORTAL_USER_ONE, name: "Paulo Aurora", email: "cliente1@luvi.test" },
      ],
    });
  });

  async function loginPortal(page: Page, email: string) {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill("qualquer-senha-1");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/portal$/);
  }

  test("com vários vínculos o sistema NÃO escolhe sozinho: pede a empresa", async ({ page }) => {
    const errors = trackPageErrors(page);
    await loginPortal(page, "cliente@luvi.test");
    await expect(page.getByRole("heading", { name: "Escolha a empresa" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Casa Aurora" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Vita Nutri" })).toBeVisible();
    // nenhuma tela do portal abre antes da escolha
    await expect(page.getByRole("link", { name: "Materiais" })).toHaveCount(0);
    await page.goto("/portal/materiais");
    await expect(page.getByRole("heading", { name: "Escolha a empresa" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("escolhe, troca pelo cabeçalho, a escolha persiste e o cookie adulterado é ignorado", async ({ page, context }) => {
    await loginPortal(page, "cliente@luvi.test");
    await page.getByRole("button", { name: "Vita Nutri" }).click();
    const switcher = page.getByRole("button", { name: "Trocar empresa" });
    await expect(switcher).toHaveText(/Vita Nutri/);
    await expect(page.getByRole("heading", { name: "Escolha a empresa" })).toHaveCount(0);

    await switcher.click();
    await page.getByRole("menuitem", { name: "Casa Aurora" }).click();
    await expect(page.getByRole("button", { name: "Trocar empresa" })).toHaveText(/Casa Aurora/);

    await page.reload();
    await expect(page.getByRole("button", { name: "Trocar empresa" })).toHaveText(/Casa Aurora/);

    // o cookie é só preferência: um valor que não é vínculo do usuário é ignorado e o servidor pede a escolha
    await context.addCookies([{ name: "aprova_portal_cliente", value: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", domain: "localhost", path: "/portal" }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Escolha a empresa" })).toBeVisible();
  });

  test("sair limpa a escolha: no próximo login pede a empresa de novo", async ({ page }) => {
    await loginPortal(page, "cliente@luvi.test");
    await page.getByRole("button", { name: "Casa Aurora" }).click();
    await expect(page.getByRole("button", { name: "Trocar empresa" })).toBeVisible();
    await page.getByRole("button", { name: "Menu do usuário" }).click();
    await page.getByRole("menuitem", { name: /Sair/ }).click();
    await expect(page).toHaveURL(/\/login/);
    await loginPortal(page, "cliente@luvi.test");
    await expect(page.getByRole("heading", { name: "Escolha a empresa" })).toBeVisible();
  });

  test("com um único vínculo entra direto, sem seletor", async ({ page }) => {
    await loginPortal(page, "cliente1@luvi.test");
    await expect(page.getByRole("heading", { name: "Escolha a empresa" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Materiais" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Trocar empresa" })).toHaveCount(0);
  });
});
