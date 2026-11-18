import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const saveMaterialAction = vi.fn();
const deleteMaterialAction = vi.fn();
vi.mock("@/app/admin/materiais/actions", () => ({
  saveMaterialAction: (...args: unknown[]) => saveMaterialAction(...args),
  deleteMaterialAction: (...args: unknown[]) => deleteMaterialAction(...args),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DeleteMaterialButton } from "@/components/materials/delete-material-button";
import { MaterialFilters } from "@/components/materials/material-filters";
import { MaterialFormDialog, type EditableMaterial } from "@/components/materials/material-form-dialog";
import { MaterialsList, MaterialsPagination, pageHref } from "@/components/materials/materials-list";
import type { MaterialListItem } from "@/lib/materials/queries";
import type { MaterialFilters as Filters } from "@/lib/materials/schema";

const CLIENT_A = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CLIENT_B = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const PROJECT_A = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const PROJECT_B = "5e6f7081-2b3c-4d4e-8f90-1b2c3d4e5f60";
const MATERIAL_ID = "6f708192-3c4d-4e5f-9fa1-2c3d4e5f6071";

const clients = [
  { id: CLIENT_A, name: "Casa Aurora" },
  { id: CLIENT_B, name: "Studio Vento" },
];
const projects = [
  { id: PROJECT_A, clientId: CLIENT_A, name: "Campanha de verão" },
  { id: PROJECT_B, clientId: CLIENT_B, name: "Lançamento de inverno" },
];

const draft: EditableMaterial = {
  id: MATERIAL_ID,
  clientName: "Casa Aurora",
  projectName: "Campanha de verão",
  status: "rascunho",
  type: "imagem",
  title: "Arte principal",
  description: "Notas",
  caption: "Legenda original",
  aspectRatio: "4:5",
  channel: "Instagram Feed",
  publishDate: "2026-12-01",
  dueDate: "2026-11-20",
};

const FILTERS: Filters = { q: "", status: "todos", type: "todos", clientId: null, projectId: null, page: 1 };

const item = (overrides: Partial<MaterialListItem> = {}): MaterialListItem => ({
  id: MATERIAL_ID,
  clientId: CLIENT_A,
  clientName: "Casa Aurora",
  projectId: PROJECT_A,
  projectName: "Campanha de verão",
  title: "Arte principal",
  type: "carrossel",
  aspectRatio: "4:5",
  channel: "Instagram Feed",
  status: "rascunho",
  publishDate: "2026-12-01",
  dueDate: null,
  versionCount: 0,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  saveMaterialAction.mockResolvedValue({ ok: true });
  deleteMaterialAction.mockResolvedValue({ ok: true });
});

const openCreate = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Novo material" }));
  return screen.findByRole("dialog");
};

describe("MaterialFormDialog (cadastro)", () => {
  it("o projeto só aparece depois do cliente e mostra só os projetos dele", async () => {
    render(<MaterialFormDialog mode="create" clients={clients} projects={projects} />);
    const dialog = await openCreate();
    const project = within(dialog).getByLabelText("Projeto");
    expect(project).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText("Cliente"), CLIENT_A);
    expect(project).toBeEnabled();
    expect(within(project).getAllByRole("option").map((o) => o.textContent)).toEqual(["Escolha o projeto", "Campanha de verão"]);
    await userEvent.selectOptions(within(dialog).getByLabelText("Cliente"), CLIENT_B);
    expect(within(project).getAllByRole("option").map((o) => o.textContent)).toEqual(["Escolha o projeto", "Lançamento de inverno"]);
    expect(project).toHaveValue(""); // trocar de cliente limpa o projeto
  });

  it("envia todos os campos e fecha ao salvar", async () => {
    render(<MaterialFormDialog mode="create" clients={clients} projects={projects} />);
    const dialog = await openCreate();
    await userEvent.selectOptions(within(dialog).getByLabelText("Cliente"), CLIENT_A);
    await userEvent.selectOptions(within(dialog).getByLabelText("Projeto"), PROJECT_A);
    await userEvent.type(within(dialog).getByLabelText("Título"), "Carrossel de verão");
    await userEvent.selectOptions(within(dialog).getByLabelText("Tipo"), "carrossel");
    await userEvent.selectOptions(within(dialog).getByLabelText(/Proporção/), "9:16");
    await userEvent.type(within(dialog).getByLabelText(/Canal/), "Instagram Stories");
    await userEvent.type(within(dialog).getByLabelText(/Legenda/), "Primeira linha{Enter}Segunda linha");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cadastrar material" }));

    await waitFor(() => expect(saveMaterialAction).toHaveBeenCalledTimes(1));
    const data = saveMaterialAction.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(data.entries())).toMatchObject({
      clientId: CLIENT_A,
      projectId: PROJECT_A,
      type: "carrossel",
      title: "Carrossel de verão",
      aspectRatio: "9:16",
      channel: "Instagram Stories",
      caption: "Primeira linha\nSegunda linha",
      description: "",
      publishDate: "",
      dueDate: "",
    });
    expect(data.get("id")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("um envio recusado NÃO apaga o que foi digitado (legenda longa) e mostra o erro ligado ao campo", async () => {
    saveMaterialAction.mockResolvedValue({ fieldErrors: { title: "O título precisa ter letras ou números." } });
    render(<MaterialFormDialog mode="create" clients={clients} projects={projects} defaultClientId={CLIENT_A} defaultProjectId={PROJECT_A} />);
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText("Título"), "!!!");
    await userEvent.selectOptions(within(dialog).getByLabelText("Tipo"), "imagem");
    await userEvent.type(within(dialog).getByLabelText(/Legenda/), "Texto longo que não pode sumir");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cadastrar material" }));

    const message = await within(dialog).findByText("O título precisa ter letras ou números.");
    const title = within(dialog).getByLabelText("Título");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title.getAttribute("aria-describedby")).toBe(message.id);
    expect(title).toHaveValue("!!!");
    expect(within(dialog).getByLabelText(/Legenda/)).toHaveValue("Texto longo que não pode sumir");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("erro geral aparece como alerta", async () => {
    saveMaterialAction.mockResolvedValue({ error: "Você não tem permissão para esta ação." });
    render(<MaterialFormDialog mode="create" clients={clients} projects={projects} defaultClientId={CLIENT_A} defaultProjectId={PROJECT_A} />);
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText("Título"), "Arte");
    await userEvent.selectOptions(within(dialog).getByLabelText("Tipo"), "pdf");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cadastrar material" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/permissão/);
  });

  it("contador da legenda é anunciado e bloqueia o envio acima de 2200 caracteres", async () => {
    render(<MaterialFormDialog mode="create" clients={clients} projects={projects} defaultClientId={CLIENT_A} defaultProjectId={PROJECT_A} />);
    const dialog = await openCreate();
    const caption = within(dialog).getByLabelText(/Legenda/);
    const counter = within(dialog).getByText(/\/ 2200 caracteres/);
    expect(counter).toHaveAttribute("aria-live", "polite");
    expect(counter).toHaveTextContent("0 / 2200");
    await userEvent.type(caption, "abc");
    expect(counter).toHaveTextContent("3 / 2200");
    expect(caption.getAttribute("aria-describedby")).toContain(counter.id);

    await userEvent.clear(caption);
    await userEvent.click(caption);
    await userEvent.paste("😀".repeat(2201));
    expect(counter).toHaveTextContent("2201 / 2200");
    expect(within(dialog).getByText("A legenda pode ter no máximo 2200 caracteres.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cadastrar material" })).toBeDisabled();
  });

  it("avisa, sem bloquear, quando a publicação é anterior ao prazo de aprovação", async () => {
    render(<MaterialFormDialog mode="create" clients={clients} projects={projects} defaultClientId={CLIENT_A} defaultProjectId={PROJECT_A} />);
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText("Título"), "Arte");
    await userEvent.selectOptions(within(dialog).getByLabelText("Tipo"), "imagem");
    await userEvent.type(within(dialog).getByLabelText(/Prazo de aprovação/), "2026-11-20");
    expect(within(dialog).queryByText(/antes do prazo de aprovação/)).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Publicação prevista/), "2026-11-10");
    expect(within(dialog).getByText(/antes do prazo de aprovação/)).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Cadastrar material" });
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(saveMaterialAction).toHaveBeenCalledTimes(1));
  });

  it("sem cliente ativo ou sem projeto, explica o que fazer e não deixa enviar", async () => {
    const { unmount } = render(<MaterialFormDialog mode="create" clients={[]} projects={[]} />);
    let dialog = await openCreate();
    expect(within(dialog).getByText(/Cadastre um cliente ativo/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cadastrar material" })).toBeDisabled();
    unmount();

    render(<MaterialFormDialog mode="create" clients={clients} projects={[]} defaultClientId={CLIENT_A} />);
    dialog = await openCreate();
    expect(within(dialog).getByText(/não tem projeto em andamento/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cadastrar material" })).toBeDisabled();
  });

  it("o diálogo rola por dentro (cabe no celular) e cada abertura começa limpa", async () => {
    saveMaterialAction.mockResolvedValue({ error: "Falhou." });
    render(<MaterialFormDialog mode="create" clients={clients} projects={projects} defaultClientId={CLIENT_A} defaultProjectId={PROJECT_A} />);
    let dialog = await openCreate();
    expect(dialog.className).toMatch(/overflow-y-auto/);
    expect(dialog.className).toMatch(/max-h-/);
    await userEvent.type(within(dialog).getByLabelText("Título"), "Arte");
    await userEvent.selectOptions(within(dialog).getByLabelText("Tipo"), "pdf");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cadastrar material" }));
    await within(dialog).findByText("Falhou.");
    // "Cancelar" fica desabilitado enquanto o envio está pendente; com a suíte inteira em paralelo o clique chegava antes
    // de o botão reabilitar e o diálogo nunca fechava (falha intermitente). Espera o botão voltar a ficar ativo.
    const cancel = within(dialog).getByRole("button", { name: "Cancelar" });
    await waitFor(() => expect(cancel).toBeEnabled(), { timeout: 8000 });
    await userEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });
    dialog = await openCreate();
    expect(within(dialog).queryByText("Falhou.")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Título")).toHaveValue("");
  });
});

describe("MaterialFormDialog (edição)", () => {
  const openEdit = async (material: EditableMaterial) => {
    render(<MaterialFormDialog mode="edit" material={material} />);
    await userEvent.click(screen.getByRole("button", { name: `Editar ${material.title}` }));
    return screen.findByRole("dialog");
  };

  it("vem preenchida, sem escolher cliente nem projeto, com o tipo só para leitura, e envia o id", async () => {
    const dialog = await openEdit(draft);
    expect(within(dialog).queryByLabelText("Cliente")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Projeto")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Título")).toHaveValue("Arte principal");
    expect(within(dialog).getByLabelText(/Legenda/)).toHaveValue("Legenda original");
    expect(within(dialog).getByLabelText(/Proporção/)).toHaveValue("4:5");
    expect(within(dialog).getByLabelText("Tipo")).toHaveAttribute("readonly");
    expect(within(dialog).getByLabelText("Tipo")).toHaveValue("Imagem");
    await userEvent.clear(within(dialog).getByLabelText("Título"));
    await userEvent.type(within(dialog).getByLabelText("Título"), "Arte revisada");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(saveMaterialAction).toHaveBeenCalledTimes(1));
    const data = saveMaterialAction.mock.calls[0][1] as FormData;
    expect(data.get("id")).toBe(MATERIAL_ID);
    expect(data.get("title")).toBe("Arte revisada");
  });

  it("material enviado para aprovação: conteúdo desabilitado, datas editáveis, e o conteúdo atual continua no envio", async () => {
    const dialog = await openEdit({ ...draft, status: "aguardando" });
    expect(within(dialog).getByText(/só mudam numa nova revisão/)).toBeInTheDocument();
    for (const label of ["Título", /Proporção/, /Canal/, /Legenda/, /Descrição interna/]) {
      expect(within(dialog).getByLabelText(label)).toBeDisabled();
    }
    expect(within(dialog).getByLabelText(/Prazo de aprovação/)).toBeEnabled();
    expect(within(dialog).getByLabelText(/Publicação prevista/)).toBeEnabled();
    await userEvent.clear(within(dialog).getByLabelText(/Publicação prevista/));
    await userEvent.type(within(dialog).getByLabelText(/Publicação prevista/), "2026-12-15");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(saveMaterialAction).toHaveBeenCalledTimes(1));
    const data = saveMaterialAction.mock.calls[0][1] as FormData;
    expect(data.get("title")).toBe("Arte principal"); // campo desabilitado não some do envio
    expect(data.get("publishDate")).toBe("2026-12-15");
  });

  it.each(["alteracao", "aprovado"] as const)("status %s também trava o conteúdo", async (status) => {
    const dialog = await openEdit({ ...draft, status });
    expect(within(dialog).getByLabelText("Título")).toBeDisabled();
  });
});

describe("DeleteMaterialButton", () => {
  it("pede confirmação, explica a regra e a auditoria, e só então exclui e volta à lista", async () => {
    render(<DeleteMaterialButton materialId={MATERIAL_ID} title="Arte principal" redirectTo="/admin/materiais" />);
    await userEvent.click(screen.getByRole("button", { name: "Excluir Arte principal" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Só rascunhos sem versões/)).toBeInTheDocument();
    expect(within(dialog).getByText(/registrada na auditoria/)).toBeInTheDocument();
    expect(deleteMaterialAction).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Excluir rascunho" }));
    await waitFor(() => expect(deleteMaterialAction).toHaveBeenCalledWith(MATERIAL_ID));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/materiais"));
  });

  it("cancelar não exclui; erro do servidor aparece e não redireciona", async () => {
    render(<DeleteMaterialButton materialId={MATERIAL_ID} title="Arte principal" redirectTo="/admin/materiais" />);
    await userEvent.click(screen.getByRole("button", { name: "Excluir Arte principal" }));
    let dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteMaterialAction).not.toHaveBeenCalled();

    deleteMaterialAction.mockResolvedValue({ error: "Este material já tem versões e não pode ser excluído." });
    await userEvent.click(screen.getByRole("button", { name: "Excluir Arte principal" }));
    dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Excluir rascunho" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/já tem versões/);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("MaterialFilters", () => {
  it("é um formulário GET de busca com rótulos e mostra o total", () => {
    render(<MaterialFilters filters={FILTERS} clients={[{ id: CLIENT_A, name: "Casa Aurora", active: true }]} projects={projects} summary="3 materiais" />);
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/admin/materiais");
    for (const label of ["Buscar por título", "Cliente", "Projeto", "Status", "Tipo"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByText("3 materiais")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText("Limpar")).not.toBeInTheDocument();
  });

  it("com filtro ativo mostra Limpar; o filtro de projeto só lista os do cliente escolhido; arquivados são sinalizados", () => {
    render(
      <MaterialFilters
        filters={{ ...FILTERS, clientId: CLIENT_A, q: "verão" }}
        clients={[
          { id: CLIENT_A, name: "Casa Aurora", active: false },
          { id: CLIENT_B, name: "Studio Vento", active: true },
        ]}
        projects={projects}
        summary="1 material"
      />,
    );
    expect(screen.getByText("Limpar")).toHaveAttribute("href", "/admin/materiais");
    expect(screen.getByRole("option", { name: "Casa Aurora (arquivado)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Campanha de verão" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Lançamento de inverno" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Buscar por título")).toHaveValue("verão");
  });
});

describe("MaterialFilters após Limpar", () => {
  it("os campos acompanham os filtros da URL: ao limpar, o select e a busca voltam ao padrão", () => {
    const options = { clients: [{ id: CLIENT_A, name: "Casa Aurora", active: true }], projects, summary: "1 material" };
    const { rerender } = render(<MaterialFilters filters={{ ...FILTERS, q: "verão", status: "aguardando", type: "pdf" }} {...options} />);
    expect(screen.getByLabelText("Status")).toHaveValue("aguardando");
    expect(screen.getByLabelText("Tipo")).toHaveValue("pdf");
    expect(screen.getByLabelText("Buscar por título")).toHaveValue("verão");
    rerender(<MaterialFilters filters={FILTERS} {...options} />);
    expect(screen.getByLabelText("Status")).toHaveValue("todos");
    expect(screen.getByLabelText("Tipo")).toHaveValue("todos");
    expect(screen.getByLabelText("Buscar por título")).toHaveValue("");
  });
});

describe("MaterialsList e paginação", () => {
  it("mostra título (link para o detalhe), cliente, projeto, canal, proporção, tipo, status e datas", () => {
    render(<MaterialsList items={[item({ dueDate: "2026-11-20" })]} filtered={false} />);
    expect(screen.getByRole("link", { name: "Arte principal" })).toHaveAttribute("href", `/admin/materiais/${MATERIAL_ID}`);
    expect(screen.getByText("Casa Aurora")).toBeInTheDocument();
    expect(screen.getByText("Campanha de verão")).toBeInTheDocument();
    expect(screen.getByText(/Instagram Feed · 4:5/)).toBeInTheDocument();
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
    expect(screen.getByText("Carrossel")).toBeInTheDocument();
  });

  it("estado vazio muda de texto com e sem filtros", () => {
    const { rerender } = render(<MaterialsList items={[]} filtered={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Use “Novo material”/);
    rerender(<MaterialsList items={[]} filtered />);
    expect(screen.getByRole("status")).toHaveTextContent(/Nenhum material encontrado com esses filtros/);
  });

  it("pageHref preserva os filtros e omite os vazios", () => {
    expect(pageHref(FILTERS, 1)).toBe("/admin/materiais");
    expect(pageHref({ ...FILTERS, q: "verão", status: "aprovado", type: "pdf", clientId: CLIENT_A, projectId: PROJECT_A }, 2)).toBe(
      `/admin/materiais?q=ver%C3%A3o&cliente=${CLIENT_A}&projeto=${PROJECT_A}&status=aprovado&tipo=pdf&pagina=2`,
    );
  });

  it("paginação: some com 1 página; no meio tem anterior e próxima; nas pontas só uma", () => {
    const { rerender, container } = render(<MaterialsPagination filters={FILTERS} page={1} pageCount={1} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MaterialsPagination filters={{ ...FILTERS, q: "a" }} page={2} pageCount={3} />);
    expect(screen.getByRole("link", { name: /Anterior/ })).toHaveAttribute("href", "/admin/materiais?q=a");
    expect(screen.getByRole("link", { name: /Próxima/ })).toHaveAttribute("href", "/admin/materiais?q=a&pagina=3");
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
    rerender(<MaterialsPagination filters={FILTERS} page={3} pageCount={3} />);
    expect(screen.queryByRole("link", { name: /Próxima/ })).not.toBeInTheDocument();
  });
});
