import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/redefinir-senha/actions", () => ({ updatePasswordAction: vi.fn() }));
vi.mock("@/app/login/actions", () => ({ signInAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { PasswordInput } from "@/components/auth/password-input";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { LoginForm } from "@/components/login-form";

describe("PasswordInput", () => {
  it("começa oculto, com botão rotulado e sem apertar o formulário", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <label htmlFor="s">Senha</label>
        <PasswordInput id="s" name="password" />
      </form>,
    );
    const field = screen.getByLabelText("Senha");
    expect(field).toHaveAttribute("type", "password");
    const button = screen.getByRole("button", { name: "Mostrar senha" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("alterna mostrar/ocultar sem apagar o que foi digitado", async () => {
    render(
      <>
        <label htmlFor="s">Senha</label>
        <PasswordInput id="s" />
      </>,
    );
    const field = screen.getByLabelText("Senha");
    await userEvent.type(field, "Segredo123456");

    await userEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveValue("Segredo123456");
    expect(screen.getByRole("button", { name: "Ocultar senha" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Ocultar senha" }));
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue("Segredo123456");
  });

  it("funciona pelo teclado (Tab até o botão e Enter/Espaço)", async () => {
    render(
      <>
        <label htmlFor="s">Senha</label>
        <PasswordInput id="s" />
      </>,
    );
    const field = screen.getByLabelText("Senha");
    await userEvent.click(field);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Mostrar senha" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(field).toHaveAttribute("type", "text");
    await userEvent.keyboard(" ");
    expect(field).toHaveAttribute("type", "password");
  });

  it("não perde atributos do campo nem a altura/estilo informados", () => {
    render(<PasswordInput aria-label="Senha" name="password" autoComplete="current-password" required className="h-11" />);
    const field = screen.getByLabelText("Senha");
    expect(field).toHaveAttribute("name", "password");
    expect(field).toHaveAttribute("autocomplete", "current-password");
    expect(field).toBeRequired();
    expect(field).toHaveClass("h-11");
  });
});

describe("telas de autenticação", () => {
  it("redefinição/convite: dois campos, cada um com o próprio botão e estado", async () => {
    render(<ResetPasswordForm />);
    const nova = screen.getByLabelText("Nova senha");
    const confirma = screen.getByLabelText("Confirme a nova senha");
    expect(nova).toHaveAttribute("type", "password");
    expect(confirma).toHaveAttribute("type", "password");

    await userEvent.type(nova, "Segredo123456");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar nova senha" }));
    expect(nova).toHaveAttribute("type", "text");
    expect(nova).toHaveValue("Segredo123456");
    expect(confirma).toHaveAttribute("type", "password");

    await userEvent.click(screen.getByRole("button", { name: "Mostrar confirmação da nova senha" }));
    expect(confirma).toHaveAttribute("type", "text");
  });

  it("login real e login de demonstração têm o botão de mostrar senha", async () => {
    const { unmount } = render(<LoginForm mode="real" />);
    expect(screen.getByLabelText("Senha")).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(screen.getByLabelText("Senha")).toHaveAttribute("type", "text");
    unmount();

    render(<LoginForm mode="demo" />);
    expect(screen.getByLabelText("Senha")).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(screen.getByLabelText("Senha")).toHaveAttribute("type", "text");
  });
});
