import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const selectCompanyAction = vi.fn();
vi.mock("@/app/portal/actions", () => ({ selectCompanyAction: (...a: unknown[]) => selectCompanyAction(...a) }));
vi.mock("@/app/login/actions", () => ({ signOutAction: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/portal" }));

import { CompanyPicker } from "@/components/portal/company-picker";
import { PortalShell } from "@/components/portal/portal-shell";
import type { PortalLink } from "@/lib/auth/portal-selection";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const links: PortalLink[] = [
  { approverId: "a1", clientId: A, clientName: "Casa Aurora" },
  { approverId: "a2", clientId: B, clientName: "Vita Nutri" },
];

beforeEach(() => {
  vi.clearAllMocks();
  selectCompanyAction.mockResolvedValue({ ok: true });
});

describe("CompanyPicker (escolha obrigatória)", () => {
  it("lista as empresas, não escolhe nenhuma sozinho e envia a escolhida", async () => {
    render(<CompanyPicker links={links} />);
    expect(screen.getByRole("heading", { name: "Escolha a empresa" })).toBeInTheDocument();
    expect(selectCompanyAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Vita Nutri" }));
    await waitFor(() => expect(selectCompanyAction).toHaveBeenCalledWith(B));
  });

  it("mostra o erro do servidor (ex.: empresa sem acesso) e permite tentar de novo", async () => {
    selectCompanyAction.mockResolvedValue({ error: "Você não tem acesso a esta empresa." });
    render(<CompanyPicker links={links} />);
    await userEvent.click(screen.getByRole("button", { name: "Casa Aurora" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/não tem acesso/);
    // o botão volta a ficar habilitado quando a transição termina (logo depois do erro aparecer)
    await waitFor(() => expect(screen.getByRole("button", { name: "Casa Aurora" })).toBeEnabled());
  });

  it("oferece sair", () => {
    render(<CompanyPicker links={links} />);
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });
});

describe("troca de empresa no cabeçalho", () => {
  const shell = (props: { companies?: PortalLink[]; activeClientId?: string }) => (
    <PortalShell clientName="Casa Aurora" approverName="Marina Prado" approverEmail="m@x.com" {...props}>
      <p>conteúdo</p>
    </PortalShell>
  );

  it("só aparece com mais de um vínculo", () => {
    const { rerender } = render(shell({ companies: [links[0]], activeClientId: A }));
    expect(screen.queryByRole("button", { name: "Trocar empresa" })).not.toBeInTheDocument();
    rerender(shell({}));
    expect(screen.queryByRole("button", { name: "Trocar empresa" })).not.toBeInTheDocument();
    rerender(shell({ companies: links, activeClientId: A }));
    expect(screen.getByRole("button", { name: "Trocar empresa" })).toHaveTextContent("Casa Aurora");
  });

  it("escolher outra empresa chama a ação; a empresa atual não dispara nada", async () => {
    render(shell({ companies: links, activeClientId: A }));
    await userEvent.click(screen.getByRole("button", { name: "Trocar empresa" }));
    const atual = await screen.findByRole("menuitem", { name: "Casa Aurora" });
    await userEvent.click(atual);
    expect(selectCompanyAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Trocar empresa" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Vita Nutri" }));
    await waitFor(() => expect(selectCompanyAction).toHaveBeenCalledWith(B));
  });

  it("não lança o erro do Base UI ao abrir o menu (rótulo dentro de grupo)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(shell({ companies: links, activeClientId: A }));
    await userEvent.click(screen.getByRole("button", { name: "Trocar empresa" }));
    expect(await screen.findByText("Empresa")).toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

});
