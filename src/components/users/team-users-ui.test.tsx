import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const inviteAction = vi.fn();
const resendAction = vi.fn();
vi.mock("@/app/admin/usuarios/actions", () => ({
  inviteTeamMemberAction: (...a: unknown[]) => inviteAction(...a),
  resendTeamInviteAction: (...a: unknown[]) => resendAction(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ResendTeamInviteButton } from "@/components/users/resend-team-invite-button";
import { TeamInviteDialog } from "@/components/users/team-invite-dialog";

beforeEach(() => {
  vi.clearAllMocks();
  inviteAction.mockResolvedValue({ ok: true });
  resendAction.mockResolvedValue({ ok: true });
});

const open = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Adicionar usuário" }));
  return screen.findByRole("dialog");
};

describe("TeamInviteDialog", () => {
  it("abre com nome, e-mail, confirmação e papel; Administrador vem pré-selecionado e os três papéis existem", async () => {
    render(<TeamInviteDialog />);
    const dialog = await open();
    expect(within(dialog).getByLabelText("Nome completo")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("E-mail")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Confirmar e-mail")).toBeInTheDocument();
    const role = within(dialog).getByLabelText("Papel") as HTMLSelectElement;
    expect(role.value).toBe("admin");
    expect(within(role).getAllByRole("option").map((o) => o.textContent)).toEqual(["Administrador", "Designer", "Atendimento"]);
    expect(within(dialog).queryByLabelText(/senha/i)).toBeNull(); // quem convida nunca define a senha
    expect(within(dialog).getByText(/nunca vê nem define a senha/)).toBeInTheDocument();
  });

  it("envia os valores digitados e fecha a janela quando o convite é aceito", async () => {
    render(<TeamInviteDialog />);
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText("Nome completo"), "Pessoa Nova");
    await userEvent.type(within(dialog).getByLabelText("E-mail"), "nova@luvicompany.com.br");
    await userEvent.type(within(dialog).getByLabelText("Confirmar e-mail"), "nova@luvicompany.com.br");
    await userEvent.selectOptions(within(dialog).getByLabelText("Papel"), "designer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enviar convite" }));
    await waitFor(() => expect(inviteAction).toHaveBeenCalledTimes(1));
    const data = inviteAction.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(data.entries())).toEqual({ name: "Pessoa Nova", email: "nova@luvicompany.com.br", emailConfirm: "nova@luvicompany.com.br", role: "designer" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("mostra os erros de cada campo e os erros gerais, sem fechar a janela", async () => {
    inviteAction.mockResolvedValue({ fieldErrors: { email: "Informe um e-mail válido.", emailConfirm: "Os e-mails não conferem. Digite o mesmo endereço nos dois campos." } });
    render(<TeamInviteDialog />);
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Enviar convite" }));
    expect(await within(dialog).findByText("Informe um e-mail válido.")).toBeInTheDocument();
    expect(within(dialog).getByText(/não conferem/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("E-mail")).toHaveAttribute("aria-invalid", "true");

    inviteAction.mockResolvedValue({ error: "Já existe um usuário com este e-mail." });
    await userEvent.click(within(dialog).getByRole("button", { name: "Enviar convite" }));
    expect(await within(dialog).findByText("Já existe um usuário com este e-mail.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Cancelar fecha a janela sem chamar a ação, e uma nova abertura volta com os campos limpos", async () => {
    render(<TeamInviteDialog />);
    let dialog = await open();
    await userEvent.type(within(dialog).getByLabelText("Nome completo"), "Rascunho");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(inviteAction).not.toHaveBeenCalled();
    dialog = await open();
    expect((within(dialog).getByLabelText("Nome completo") as HTMLInputElement).value).toBe("");
  });
});

describe("ResendTeamInviteButton", () => {
  it("pede confirmação mostrando o e-mail de destino e só então reenvia", async () => {
    render(<ResendTeamInviteButton userId="7c9e6679-7425-40de-944b-e07fc1f90ae7" name="Pessoa Nova" email="nova@luvicompany.com.br" />);
    await userEvent.click(screen.getByRole("button", { name: "Reenviar convite de Pessoa Nova" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/nova@luvicompany\.com\.br/)).toBeInTheDocument();
    expect(resendAction).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Reenviar convite" }));
    await waitFor(() => expect(resendAction).toHaveBeenCalledWith("7c9e6679-7425-40de-944b-e07fc1f90ae7"));
  });

  it("mostra o erro do servidor (por exemplo, o intervalo de 1 minuto) e mantém a janela aberta", async () => {
    resendAction.mockResolvedValue({ error: "Aguarde um minuto antes de reenviar o convite." });
    render(<ResendTeamInviteButton userId="7c9e6679-7425-40de-944b-e07fc1f90ae7" name="Pessoa Nova" email="nova@luvicompany.com.br" />);
    await userEvent.click(screen.getByRole("button", { name: "Reenviar convite de Pessoa Nova" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reenviar convite" }));
    expect(await within(dialog).findByText("Aguarde um minuto antes de reenviar o convite.")).toBeInTheDocument();
  });
});
