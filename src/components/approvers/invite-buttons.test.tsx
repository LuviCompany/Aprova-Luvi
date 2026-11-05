import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const sendInviteAction = vi.fn();
vi.mock("@/app/admin/clientes/[id]/actions", () => ({
  cancelInviteAction: vi.fn(),
  prepareInviteAction: vi.fn(),
  setApproverActiveAction: vi.fn(),
  linkApproverAction: vi.fn(),
  saveApproverAction: vi.fn(),
  sendInviteAction: (...a: unknown[]) => sendInviteAction(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ApproverCard } from "@/components/approvers/approver-card";
import type { ApproverItem } from "@/lib/approvers/queries";

const APPROVER = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const base: ApproverItem = {
  id: APPROVER,
  name: "Marina Prado",
  email: "marina@x.com",
  jobTitle: "",
  active: true,
  hasLogin: false,
  access: "so_link",
  inviteId: null,
  inviteStatus: null,
  alsoApprovesFor: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  sendInviteAction.mockResolvedValue({ ok: true });
});

describe("convite: enviar e reenviar pelo painel (sem terminal)", () => {
  it("convite preparado: 'Enviar convite' diz para quem vai, avisa que a pessoa cria a própria senha e chama a ação", async () => {
    render(<ApproverCard approver={{ ...base, access: "convite_preparado", inviteId: "i1", inviteStatus: "preparado" }} canManage clientActive />);
    await userEvent.click(screen.getByRole("button", { name: "Enviar convite de Marina Prado" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/marina@x\.com/)).toBeInTheDocument();
    expect(within(dialog).getByText(/criar a própria senha/)).toBeInTheDocument();
    expect(sendInviteAction).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Enviar convite" }));
    await waitFor(() => expect(sendInviteAction).toHaveBeenCalledWith(APPROVER));
  });

  it("convite enviado (acesso criado, senha ainda não definida): mostra 'Convite enviado' e oferece só reenviar", async () => {
    render(<ApproverCard approver={{ ...base, hasLogin: true, access: "convite_enviado", inviteId: "i1", inviteStatus: "enviado" }} canManage clientActive />);
    expect(screen.getByText("Convite enviado")).toBeInTheDocument();
    expect(screen.queryByText("Com acesso ao portal")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelar convite/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reenviar convite de Marina Prado" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/O link anterior deixa de valer/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Reenviar convite" }));
    await waitFor(() => expect(sendInviteAction).toHaveBeenCalledWith(APPROVER));
  });

  it("acesso já ativo (convite aceito) não oferece nenhum botão de convite; o erro do envio aparece na janela", async () => {
    const { unmount } = render(<ApproverCard approver={{ ...base, hasLogin: true, access: "login" }} canManage clientActive />);
    expect(screen.getByText("Com acesso ao portal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /convite/i })).not.toBeInTheDocument();
    unmount();

    sendInviteAction.mockResolvedValue({ error: "O envio de e-mail não está configurado neste ambiente." });
    render(<ApproverCard approver={{ ...base, access: "convite_preparado", inviteId: "i1", inviteStatus: "preparado" }} canManage clientActive />);
    await userEvent.click(screen.getByRole("button", { name: "Enviar convite de Marina Prado" }));
    await userEvent.click(await screen.findByRole("button", { name: "Enviar convite" }));
    expect(await screen.findByText(/e-mail não está configurado/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
