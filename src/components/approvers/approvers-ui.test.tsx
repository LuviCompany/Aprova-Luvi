import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const saveApproverAction = vi.fn();
const setApproverActiveAction = vi.fn();
const linkApproverAction = vi.fn();
const prepareInviteAction = vi.fn();
const cancelInviteAction = vi.fn();
vi.mock("@/app/admin/clientes/[id]/actions", () => ({
  saveApproverAction: (...a: unknown[]) => saveApproverAction(...a),
  setApproverActiveAction: (...a: unknown[]) => setApproverActiveAction(...a),
  linkApproverAction: (...a: unknown[]) => linkApproverAction(...a),
  prepareInviteAction: (...a: unknown[]) => prepareInviteAction(...a),
  cancelInviteAction: (...a: unknown[]) => cancelInviteAction(...a),
}));

import { ApproverCard } from "@/components/approvers/approver-card";
import { ApproverFormDialog } from "@/components/approvers/approver-form-dialog";
import { LinkApproverDialog } from "@/components/approvers/link-approver-dialog";
import type { ApproverItem } from "@/lib/approvers/queries";

const CLIENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const APPROVER = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [saveApproverAction, setApproverActiveAction, linkApproverAction, prepareInviteAction, cancelInviteAction]) {
    fn.mockResolvedValue({ ok: true });
  }
});

describe("ApproverFormDialog", () => {
  it("cadastra: envia nome, e-mail, cargo e o cliente; fecha ao salvar", async () => {
    render(<ApproverFormDialog mode="create" clientId={CLIENT} />);
    await userEvent.click(screen.getByRole("button", { name: "Novo aprovador" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Marina Prado");
    await userEvent.type(within(dialog).getByLabelText("E-mail"), "marina@x.com");
    await userEvent.type(within(dialog).getByLabelText(/Cargo/), "Marketing");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cadastrar aprovador" }));

    await waitFor(() => expect(saveApproverAction).toHaveBeenCalledTimes(1));
    const formData = saveApproverAction.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(formData.entries())).toMatchObject({ clientId: CLIENT, name: "Marina Prado", email: "marina@x.com", jobTitle: "Marketing" });
    expect(formData.get("id")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("explica que o e-mail não muda depois e mostra o erro do campo, ligado por aria-describedby", async () => {
    saveApproverAction.mockResolvedValue({ fieldErrors: { email: "Este e-mail já está cadastrado neste cliente." } });
    render(<ApproverFormDialog mode="create" clientId={CLIENT} />);
    await userEvent.click(screen.getByRole("button", { name: "Novo aprovador" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Não pode ser alterado depois/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Marina");
    await userEvent.type(within(dialog).getByLabelText("E-mail"), "marina@x.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cadastrar aprovador" }));
    const message = await within(dialog).findByText("Este e-mail já está cadastrado neste cliente.");
    const input = within(dialog).getByLabelText("E-mail");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("edição mostra o e-mail só como texto (não editável) e envia o id", async () => {
    render(<ApproverFormDialog mode="edit" approver={{ id: APPROVER, name: "Marina Prado", email: "marina@x.com", jobTitle: "Marketing" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Editar Marina Prado" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("E-mail")).not.toBeInTheDocument();
    expect(within(dialog).getByText("marina@x.com")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Nome")).toHaveValue("Marina Prado");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(saveApproverAction).toHaveBeenCalled());
    const formData = saveApproverAction.mock.calls[0][1] as FormData;
    expect(formData.get("id")).toBe(APPROVER);
    expect(formData.get("email")).toBeNull();
  });
});

describe("LinkApproverDialog", () => {
  const candidates = [
    { sourceApproverId: APPROVER, name: "Bia Souza", email: "bia@x.com", jobTitle: "", hasLogin: false, clientNames: ["Vita Nutri", "Brisa Modas"] },
  ];

  it("lista as pessoas com os clientes em que já aprovam e vincula ao cliente atual", async () => {
    render(<LinkApproverDialog clientId={CLIENT} candidates={candidates} />);
    await userEvent.click(screen.getByRole("button", { name: "Vincular pessoa existente" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Vincular a este cliente" });
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText("Pessoa"), APPROVER);
    expect(within(dialog).getByRole("option", { name: /Bia Souza · bia@x.com \(Vita Nutri, Brisa Modas\)/ })).toBeInTheDocument();
    await userEvent.click(submit);
    await waitFor(() => expect(linkApproverAction).toHaveBeenCalledWith(APPROVER, CLIENT));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sem candidatos, orienta e não deixa enviar; erro do servidor aparece sem fechar", async () => {
    const { unmount } = render(<LinkApproverDialog clientId={CLIENT} candidates={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Vincular pessoa existente" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Não há pessoas de outros clientes/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Pessoa")).toBeDisabled();
    unmount();

    linkApproverAction.mockResolvedValue({ error: "Esta pessoa já está vinculada a este cliente." });
    render(<LinkApproverDialog clientId={CLIENT} candidates={candidates} />);
    await userEvent.click(screen.getByRole("button", { name: "Vincular pessoa existente" }));
    const second = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(second).getByLabelText("Pessoa"), APPROVER);
    await userEvent.click(within(second).getByRole("button", { name: "Vincular a este cliente" }));
    expect(await within(second).findByRole("alert")).toHaveTextContent(/já está vinculada/);
  });
});

describe("ApproverCard", () => {
  const approver: ApproverItem = {
    id: APPROVER,
    name: "Marina Prado",
    email: "marina@x.com",
    jobTitle: "Marketing",
    active: true,
    hasLogin: false,
    access: "so_link",
    inviteId: null,
    alsoApprovesFor: ["Vita Nutri", "Brisa Modas"],
  };

  it("mostra status, acesso e 'também aprova para'; designer não vê botões", () => {
    render(<ApproverCard approver={approver} canManage={false} clientActive />);
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.getByText("Só por link (sem login)")).toBeInTheDocument();
    expect(screen.getByText(/Também aprova para:/)).toHaveTextContent("Vita Nutri, Brisa Modas");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("quem gerencia vê editar, preparar convite e desativar", () => {
    render(<ApproverCard approver={approver} canManage clientActive />);
    expect(screen.getByRole("button", { name: "Editar Marina Prado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preparar convite de Marina Prado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desativar Marina Prado" })).toBeInTheDocument();
  });

  it("com login não oferece convite; inativo oferece reativar e esconde o status de acesso", () => {
    const { rerender } = render(<ApproverCard approver={{ ...approver, hasLogin: true, access: "login" }} canManage clientActive />);
    expect(screen.getByText("Com acesso ao portal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /convite/i })).not.toBeInTheDocument();
    rerender(<ApproverCard approver={{ ...approver, active: false }} canManage clientActive />);
    expect(screen.getByText("Inativo")).toBeInTheDocument();
    expect(screen.queryByText("Só por link (sem login)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reativar Marina Prado" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /convite/i })).not.toBeInTheDocument();
  });

  it("convite preparado oferece cancelar; cliente arquivado não oferece preparar", () => {
    const { rerender } = render(
      <ApproverCard approver={{ ...approver, access: "convite_preparado", inviteId: "i1" }} canManage clientActive />,
    );
    expect(screen.getByText("Convite preparado (não enviado)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar convite de Marina Prado" })).toBeInTheDocument();
    rerender(<ApproverCard approver={approver} canManage clientActive={false} />);
    expect(screen.queryByRole("button", { name: /Preparar convite/ })).not.toBeInTheDocument();
  });

  it("desativar pede confirmação e avisa que os links abertos serão revogados", async () => {
    render(<ApproverCard approver={approver} canManage clientActive />);
    await userEvent.click(screen.getByRole("button", { name: "Desativar Marina Prado" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/links de aprovação ainda abertos são revogados/)).toBeInTheDocument();
    expect(setApproverActiveAction).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Desativar aprovador" }));
    await waitFor(() => expect(setApproverActiveAction).toHaveBeenCalledWith(APPROVER, false));
  });

  it("preparar convite avisa que NADA é enviado; cancelar chama a ação do convite", async () => {
    const { unmount } = render(<ApproverCard approver={approver} canManage clientActive />);
    await userEvent.click(screen.getByRole("button", { name: "Preparar convite de Marina Prado" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Nenhum e-mail é enviado/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Preparar convite" }));
    await waitFor(() => expect(prepareInviteAction).toHaveBeenCalledWith(APPROVER));
    unmount();

    render(<ApproverCard approver={{ ...approver, access: "convite_preparado", inviteId: "i1" }} canManage clientActive />);
    await userEvent.click(screen.getByRole("button", { name: "Cancelar convite de Marina Prado" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar convite" }));
    await waitFor(() => expect(cancelInviteAction).toHaveBeenCalledWith("i1"));
  });

  it("erro da ação aparece na janela e ela não fecha", async () => {
    setApproverActiveAction.mockResolvedValue({ error: "Você não tem permissão para esta ação." });
    render(<ApproverCard approver={approver} canManage clientActive />);
    await userEvent.click(screen.getByRole("button", { name: "Desativar Marina Prado" }));
    await userEvent.click(await screen.findByRole("button", { name: "Desativar aprovador" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/permissão/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
