import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CheckCheck } from "lucide-react";
import { EmptyState, LoadErrorState } from "@/components/admin/data-states";
import { DecisionsTable, type DecisionRow } from "@/components/admin/decisions-table";

const row = (over: Partial<DecisionRow> = {}): DecisionRow => ({
  id: "d1",
  materialId: "m1",
  materialTitle: "Carrossel de verão",
  clientName: "Casa Aurora Teste",
  versionNumber: 2,
  decision: "aprovado",
  via: "portal",
  by: "Marina Prado",
  at: "2026-11-03T15:00:00-03:00",
  note: "",
  ...over,
});

describe("DecisionsTable", () => {
  it("mantém as colunas do histórico", () => {
    render(<DecisionsTable rows={[row()]} />);
    for (const name of ["Data", "Material", "Cliente", "Versão", "Decisão", "Por", "Canal"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
  });

  it("mostra material com link, cliente, versão, decisão, autor e canal", () => {
    render(<DecisionsTable rows={[row(), row({ id: "d2", decision: "alteracao", via: "link", note: "Trocar o título", by: "Paulo Aurora" })]} />);
    const [first, second] = screen.getAllByRole("row").slice(1);
    expect(within(first).getByRole("link", { name: "Carrossel de verão" })).toHaveAttribute("href", "/admin/materiais/m1");
    expect(within(first).getByText("Casa Aurora Teste")).toBeInTheDocument();
    expect(within(first).getByText("v2")).toBeInTheDocument();
    expect(within(first).getByText("Aprovado")).toBeInTheDocument();
    expect(within(first).getByText("Portal")).toBeInTheDocument();
    expect(within(second).getByText("Alteração")).toBeInTheDocument();
    expect(within(second).getByText("Link seguro")).toBeInTheDocument();
    expect(within(second).getByText(/Trocar o título/)).toBeInTheDocument();
    expect(within(second).getByText("Paulo Aurora")).toBeInTheDocument();
  });
});

describe("estados vazio e de erro", () => {
  it("estado vazio é um aviso de status, com título e orientação", () => {
    render(
      <EmptyState icon={CheckCheck} title="Nenhuma decisão registrada ainda">
        Quando um aprovador decidir, aparece aqui.
      </EmptyState>,
    );
    const status = screen.getByRole("status");
    expect(within(status).getByText("Nenhuma decisão registrada ainda")).toBeInTheDocument();
    expect(within(status).getByText("Quando um aprovador decidir, aparece aqui.")).toBeInTheDocument();
  });

  it("estado de erro é um alerta que diz o que não carregou e que nada foi alterado, sem detalhes técnicos", () => {
    render(<LoadErrorState what="o histórico de aprovações" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível carregar o histórico de aprovações agora.");
    expect(alert).toHaveTextContent("nada foi alterado");
    expect(alert).not.toHaveTextContent(/permission|42501|supabase|HTTP/i);
  });
});
