import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const saveClientAction = vi.fn();
const setClientActiveAction = vi.fn();
const saveProjectAction = vi.fn();
vi.mock("@/app/admin/clientes/actions", () => ({
  saveClientAction: (...args: unknown[]) => saveClientAction(...args),
  setClientActiveAction: (...args: unknown[]) => setClientActiveAction(...args),
}));
vi.mock("@/app/admin/projetos/actions", () => ({
  saveProjectAction: (...args: unknown[]) => saveProjectAction(...args),
}));

import { ArchiveClientButton } from "@/components/clients/archive-client-button";
import { ClientCard } from "@/components/clients/client-card";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ListFilters } from "@/components/clients/list-filters";
import { ProjectCard } from "@/components/clients/project-card";
import { ProjectFormDialog } from "@/components/clients/project-form-dialog";
import type { ClientListItem, ProjectListItem } from "@/lib/clients/queries";

const CLIENT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

beforeEach(() => {
  vi.clearAllMocks();
  saveClientAction.mockResolvedValue({ ok: true });
  setClientActiveAction.mockResolvedValue({ ok: true });
  saveProjectAction.mockResolvedValue({ ok: true });
});

describe("ClientFormDialog", () => {
  it("abre vazio, sugere as iniciais enquanto se digita o nome e fecha ao salvar", async () => {
    render(<ClientFormDialog mode="create" />);
    await userEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nome do cliente"), "Casa Aurora Móveis");
    expect(within(dialog).getByText(/usamos CA/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Segmento/), "Varejo");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cadastrar cliente" }));

    await waitFor(() => expect(saveClientAction).toHaveBeenCalledTimes(1));
    const formData = saveClientAction.mock.calls[0][1] as FormData;
    expect(formData.get("name")).toBe("Casa Aurora Móveis");
    expect(formData.get("segment")).toBe("Varejo");
    expect(formData.get("id")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("mostra o erro do campo, mantém a janela aberta e liga o texto ao campo (acessibilidade)", async () => {
    saveClientAction.mockResolvedValue({ fieldErrors: { name: "Já existe um cliente com esse nome." } });
    render(<ClientFormDialog mode="create" />);
    await userEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nome do cliente"), "Casa Aurora");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cadastrar cliente" }));

    const message = await within(dialog).findByText("Já existe um cliente com esse nome.");
    const input = within(dialog).getByLabelText("Nome do cliente");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("erro geral aparece como alerta (ex.: sem permissão)", async () => {
    saveClientAction.mockResolvedValue({ error: "Você não tem permissão para esta ação." });
    render(<ClientFormDialog mode="create" />);
    await userEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nome do cliente"), "Casa Aurora");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cadastrar cliente" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/permissão/);
  });

  it("edição vem preenchida e envia o id", async () => {
    render(<ClientFormDialog mode="edit" client={{ id: CLIENT_ID, name: "Casa Aurora", segment: "Varejo", initials: "CA" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Editar Casa Aurora" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Nome do cliente")).toHaveValue("Casa Aurora");
    expect(within(dialog).getByLabelText(/Iniciais/)).toHaveValue("CA");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(saveClientAction).toHaveBeenCalled());
    expect((saveClientAction.mock.calls[0][1] as FormData).get("id")).toBe(CLIENT_ID);
  });

  it("cada abertura começa limpa (o erro anterior não fica)", async () => {
    saveClientAction.mockResolvedValue({ error: "Falhou." });
    render(<ClientFormDialog mode="create" />);
    await userEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    let dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nome do cliente"), "Casa Aurora");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cadastrar cliente" }));
    await within(dialog).findByText("Falhou.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Falhou.")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Nome do cliente")).toHaveValue("");
  });
});

describe("ArchiveClientButton", () => {
  it("pede confirmação antes de arquivar e explica o que acontece", async () => {
    render(<ArchiveClientButton id={CLIENT_ID} name="Casa Aurora" active />);
    await userEvent.click(screen.getByRole("button", { name: "Arquivar Casa Aurora" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/deixa de aparecer no portal/)).toBeInTheDocument();
    expect(setClientActiveAction).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Arquivar cliente" }));
    await waitFor(() => expect(setClientActiveAction).toHaveBeenCalledWith(CLIENT_ID, false));
  });

  it("cliente arquivado oferece reativar", async () => {
    render(<ArchiveClientButton id={CLIENT_ID} name="Casa Aurora" active={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Reativar Casa Aurora" }));
    await userEvent.click(await screen.findByRole("button", { name: "Reativar cliente" }));
    await waitFor(() => expect(setClientActiveAction).toHaveBeenCalledWith(CLIENT_ID, true));
  });

  it("mostra o erro e não fecha quando a ação falha", async () => {
    setClientActiveAction.mockResolvedValue({ error: "Você não tem permissão para esta ação." });
    render(<ArchiveClientButton id={CLIENT_ID} name="Casa Aurora" active />);
    await userEvent.click(screen.getByRole("button", { name: "Arquivar Casa Aurora" }));
    await userEvent.click(await screen.findByRole("button", { name: "Arquivar cliente" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/permissão/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ProjectFormDialog", () => {
  const clients = [
    { id: CLIENT_ID, name: "Casa Aurora" },
    { id: "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f", name: "Clínica Vida" },
  ];

  it("cria com cliente, nome, status e data", async () => {
    render(<ProjectFormDialog mode="create" clients={clients} />);
    await userEvent.click(screen.getByRole("button", { name: "Novo projeto" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("Cliente"), CLIENT_ID);
    await userEvent.type(within(dialog).getByLabelText("Nome do projeto"), "Campanha de Verão");
    await userEvent.selectOptions(within(dialog).getByLabelText("Status"), "pausado");
    await userEvent.type(within(dialog).getByLabelText(/Data de entrega/), "2026-12-15");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cadastrar projeto" }));

    await waitFor(() => expect(saveProjectAction).toHaveBeenCalledTimes(1));
    const formData = saveProjectAction.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(formData.entries())).toMatchObject({
      clientId: CLIENT_ID,
      name: "Campanha de Verão",
      status: "pausado",
      dueDate: "2026-12-15",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sem clientes ativos não deixa cadastrar e orienta o usuário", async () => {
    render(<ProjectFormDialog mode="create" clients={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Novo projeto" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Cadastre um cliente ativo/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cadastrar projeto" })).toBeDisabled();
  });

  it("edição não oferece trocar o cliente e vem preenchida", async () => {
    render(
      <ProjectFormDialog
        mode="edit"
        project={{ id: "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11", clientName: "Casa Aurora", name: "Campanha", description: "d", status: "pausado", dueDate: "2026-12-15" }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Editar Campanha" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Cliente")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Projeto de Casa Aurora/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Status")).toHaveValue("pausado");
    expect(within(dialog).getByLabelText(/Data de entrega/)).toHaveValue("2026-12-15");
  });

  it("mostra o erro de cliente arquivado devolvido pelo servidor", async () => {
    saveProjectAction.mockResolvedValue({ fieldErrors: { clientId: "Este cliente está arquivado. Reative-o antes de criar projetos." } });
    render(<ProjectFormDialog mode="create" clients={clients} />);
    await userEvent.click(screen.getByRole("button", { name: "Novo projeto" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("Cliente"), CLIENT_ID);
    await userEvent.type(within(dialog).getByLabelText("Nome do projeto"), "Campanha");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cadastrar projeto" }));
    expect(await within(dialog).findByText(/está arquivado/)).toBeInTheDocument();
  });
});

describe("cartões", () => {
  const client: ClientListItem = {
    id: CLIENT_ID,
    name: "Casa Aurora",
    segment: "",
    initials: "CA",
    active: false,
    projectCount: 2,
    pendingCount: 1,
    approvers: [
      { id: "a1", name: "Marina", email: "marina@casaaurora.test", jobTitle: "Marketing", active: true },
      { id: "a2", name: "Inativo", email: "x@y.test", jobTitle: "", active: false },
    ],
  };

  it("cliente: mostra arquivado, sem segmento, só aprovadores ativos; ações só para quem gerencia", () => {
    const { rerender } = render(<ClientCard client={client} canManage={false} />);
    expect(screen.getByText("Arquivado")).toBeInTheDocument();
    expect(screen.getByText("Segmento não informado")).toBeInTheDocument();
    expect(screen.getByText("Marina")).toBeInTheDocument();
    expect(screen.queryByText("Inativo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar|Reativar/ })).not.toBeInTheDocument();
    rerender(<ClientCard client={client} canManage />);
    expect(screen.getByRole("button", { name: "Editar Casa Aurora" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reativar Casa Aurora" })).toBeInTheDocument();
  });

  it("cliente sem aprovadores diz isso, em vez de lista vazia", () => {
    render(<ClientCard client={{ ...client, approvers: [] }} canManage={false} />);
    expect(screen.getByText("Nenhum aprovador cadastrado.")).toBeInTheDocument();
  });

  const project: ProjectListItem = {
    id: "p1",
    clientId: CLIENT_ID,
    clientName: "Casa Aurora",
    clientActive: false,
    name: "Campanha",
    description: "",
    status: "concluido",
    dueDate: null,
    materialCount: 4,
    approvedCount: 1,
  };

  it("projeto: progresso, status, sem data e cliente arquivado", () => {
    render(<ProjectCard project={project} canEdit={false} />);
    expect(screen.getByText("1 de 4 aprovados")).toBeInTheDocument();
    expect(screen.getByText("Concluído")).toBeInTheDocument();
    expect(screen.getByText("Sem data de entrega")).toBeInTheDocument();
    expect(screen.getByText(/cliente arquivado/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /25%/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
  });

  it("projeto sem materiais não divide por zero", () => {
    render(<ProjectCard project={{ ...project, materialCount: 0, approvedCount: 0 }} canEdit />);
    expect(screen.getByRole("progressbar", { name: /0%/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar Campanha" })).toBeInTheDocument();
  });
});

describe("ListFilters", () => {
  const status = { value: "ativos", options: [{ value: "ativos", label: "Ativos" }, { value: "todos", label: "Todos" }] };

  it("é um formulário GET (filtros na URL) e só oferece Limpar quando há filtro", () => {
    const { rerender } = render(<ListFilters action="/admin/clientes" q="" status={status} summary="3 clientes" />);
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/admin/clientes");
    expect(screen.queryByRole("link", { name: "Limpar" })).not.toBeInTheDocument();
    expect(screen.getByText("3 clientes")).toBeInTheDocument();

    rerender(<ListFilters action="/admin/clientes" q="casa" status={status} summary="1 cliente" />);
    expect(screen.getByRole("link", { name: "Limpar" })).toHaveAttribute("href", "/admin/clientes");
    expect(screen.getByLabelText("Buscar por nome")).toHaveValue("casa");
  });

  it("filtro por cliente aparece quando informado", () => {
    render(
      <ListFilters
        action="/admin/projetos"
        q=""
        status={status}
        client={{ value: "", options: [{ value: "", label: "Todos os clientes" }, { value: CLIENT_ID, label: "Casa Aurora" }] }}
        summary="2 projetos"
      />,
    );
    expect(screen.getByLabelText("Cliente")).toHaveAttribute("name", "cliente");
  });
});
