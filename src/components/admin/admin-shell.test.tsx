import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ADMIN_NAV, AdminShell, visibleNav } from "@/components/admin/admin-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));
vi.mock("@/app/login/actions", () => ({ signOutAction: vi.fn() }));

const user = { name: "Pessoa", email: "pessoa@luvicompany.com.br", initials: "PE", roleLabel: "Designer" };

describe("menu do painel por papel", () => {
  it("o item Usuários existe no menu completo e é marcado como só do administrador", () => {
    const users = ADMIN_NAV.find((item) => item.href === "/admin/usuarios");
    expect(users).toMatchObject({ label: "Usuários", adminOnly: true });
  });

  it("administrador vê todos os itens; os demais papéis não veem Usuários", () => {
    expect(visibleNav(true).map((i) => i.label)).toEqual(["Dashboard", "Clientes", "Projetos", "Materiais", "Histórico", "Usuários"]);
    expect(visibleNav(false).map((i) => i.label)).toEqual(["Dashboard", "Clientes", "Projetos", "Materiais", "Histórico"]);
  });

  it("renderizado para o administrador: link Usuários presente", () => {
    render(
      <AdminShell isAdmin user={{ ...user, roleLabel: "Administrador" }}>
        <p>conteúdo</p>
      </AdminShell>,
    );
    expect(screen.getAllByRole("link", { name: "Usuários" }).length).toBeGreaterThan(0);
  });

  it("renderizado para quem não é administrador (padrão): sem link Usuários, os outros continuam", () => {
    render(
      <AdminShell user={user}>
        <p>conteúdo</p>
      </AdminShell>,
    );
    expect(screen.queryByRole("link", { name: "Usuários" })).toBeNull();
    for (const label of ["Dashboard", "Clientes", "Projetos", "Materiais", "Histórico"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
  });
});
