import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminShell } from "@/components/admin/admin-shell";
import { PortalShell } from "@/components/portal/portal-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/app/login/actions", () => ({ signOutAction: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

// O Base UI lança "MenuGroupContext is missing" quando um rótulo de menu fica fora de um grupo.
// O erro só aparece ao renderizar o menu aberto, por isso o teste abre os dois menus de verdade.
async function openUserMenu() {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  await userEvent.click(screen.getByRole("button", { name: "Menu do usuário" }));
  return errors;
}

describe("menu do usuário", () => {
  it("painel administrativo: abre com e-mail, papel e Sair", async () => {
    render(
      <AdminShell user={{ name: "Admin", email: "admin@luvicompany.com.br", initials: "AD", roleLabel: "Administrador" }}>
        <p>conteúdo</p>
      </AdminShell>,
    );
    const errors = await openUserMenu();
    expect(await screen.findByText("admin@luvicompany.com.br")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Sair/ })).toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
  });

  it("portal do cliente: abre com cliente, e-mail e Sair", async () => {
    render(
      <PortalShell clientName="Casa Aurora" approverName="Marina Prado" approverEmail="marina@casaaurora.example">
        <p>conteúdo</p>
      </PortalShell>,
    );
    const errors = await openUserMenu();
    expect(await screen.findByText("Casa Aurora")).toBeInTheDocument();
    expect(screen.getByText("marina@casaaurora.example")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Sair/ })).toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
  });
});
