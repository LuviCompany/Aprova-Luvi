import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DecisionPanel } from "@/components/decision-panel";

describe("DecisionPanel", () => {
  it("só mostra os botões de decisão quando está aguardando aprovação", () => {
    const { rerender } = render(<DecisionPanel status="aguardando" version={2} onDecide={vi.fn()} />);
    expect(screen.getByRole("button", { name: /aprovar/i })).toBeInTheDocument();

    rerender(<DecisionPanel status="aprovado" version={2} onDecide={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /aprovar/i })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Aprovado");
  });

  it("exige confirmação antes de registrar a aprovação", async () => {
    const onDecide = vi.fn();
    render(<DecisionPanel status="aguardando" version={2} onDecide={onDecide} />);

    await userEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    expect(onDecide).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole("button", { name: /confirmar aprovação/i }));
    expect(onDecide).toHaveBeenCalledWith("aprovado", undefined);
  });

  it("bloqueia o pedido de alteração sem descrição suficiente", async () => {
    const onDecide = vi.fn();
    render(<DecisionPanel status="aguardando" version={1} onDecide={onDecide} />);

    await userEvent.click(screen.getByRole("button", { name: /solicitar alteração/i }));
    const send = await screen.findByRole("button", { name: /enviar solicitação/i });
    expect(send).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/o que precisa mudar/i), "curto");
    expect(send).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/o que precisa mudar/i), " demais para enviar");
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(onDecide).toHaveBeenCalledWith("alteracao", "curto demais para enviar");
  });
});
