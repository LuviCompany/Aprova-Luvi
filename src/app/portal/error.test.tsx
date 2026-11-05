import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PortalError from "@/app/portal/error";

describe("PortalError", () => {
  it("avisa com clareza, mostra o código de referência e permite tentar de novo", () => {
    const reset = vi.fn();
    render(<PortalError error={Object.assign(new Error("detalhe interno que não pode aparecer"), { digest: "abc123" })} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar esta tela.");
    expect(screen.getByTestId("error-digest")).toHaveTextContent("abc123");
    expect(screen.queryByText(/detalhe interno/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("sem código de referência não inventa um", () => {
    render(<PortalError error={new Error("x")} reset={() => {}} />);
    expect(screen.queryByTestId("error-digest")).not.toBeInTheDocument();
  });
});
