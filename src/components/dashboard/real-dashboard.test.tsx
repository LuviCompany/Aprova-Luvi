import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RealDashboard } from "@/components/dashboard/real-dashboard";
import type { DashboardData } from "@/lib/dashboard/queries";

const NOW = new Date("2026-11-04T15:00:00Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const data = (over: Partial<DashboardData> = {}): DashboardData => ({
  materials: [],
  decisions: [],
  activeClients: 0,
  activeProjects: 0,
  truncated: false,
  ...over,
});

describe("RealDashboard", () => {
  it("sem dados: indicadores zerados, orientação para começar e estados vazios (nada fictício)", () => {
    render(<RealDashboard data={data()} now={NOW} />);
    const kpis = screen.getByRole("region", { name: "Indicadores" });
    expect(within(kpis).getAllByTestId("kpi-value").map((el) => el.textContent)).toEqual(["0", "0", "0", "0"]);
    expect(screen.getByRole("status")).toHaveTextContent(/Ainda não há materiais cadastrados/);
    expect(screen.getByRole("link", { name: "clientes" })).toHaveAttribute("href", "/admin/clientes");
    expect(screen.getByText(/Nenhuma decisão registrada ainda/)).toBeInTheDocument();
    expect(screen.getByText(/Nenhum material com prazo/)).toBeInTheDocument();
    expect(screen.queryByText(/Fase 1|demonstração/i)).not.toBeInTheDocument();
  });

  it("com dados: KPIs, vencidos com link, próximos prazos, materiais e atividade recentes", () => {
    render(
      <RealDashboard
        now={NOW}
        data={data({
          activeClients: 2,
          activeProjects: 3,
          materials: [
            { id: U(1), title: "Carrossel de verão", type: "carrossel", status: "aguardando", clientName: "Casa Aurora", dueDate: "2026-11-01", createdAt: "2026-11-01T12:00:00Z" },
            { id: U(2), title: "Vídeo de inverno", type: "video", status: "alteracao", clientName: "Studio Vento", dueDate: "2026-11-20", createdAt: "2026-11-02T12:00:00Z" },
            { id: U(3), title: "Post aprovado", type: "imagem", status: "aprovado", clientName: "Casa Aurora", dueDate: null, createdAt: "2026-11-03T12:00:00Z" },
            { id: U(4), title: "Rascunho novo", type: "pdf", status: "rascunho", clientName: "Casa Aurora", dueDate: null, createdAt: "2026-11-04T12:00:00Z" },
          ],
          decisions: [{ id: U(10), materialId: U(3), decision: "aprovado", by: "Marina Prado", via: "portal", at: "2026-11-03T12:00:00Z", requestedAt: "2026-11-02T12:00:00Z" }],
        })}
      />,
    );
    const kpis = within(screen.getByRole("region", { name: "Indicadores" }));
    expect(kpis.getAllByTestId("kpi-value").map((el) => el.textContent)).toEqual(["1", "1", "1", "1"]);
    expect(kpis.getByText("1 com prazo vencido")).toBeInTheDocument();
    expect(kpis.getByText("Novembro de 2026")).toBeInTheDocument();
    expect(screen.getByText(/2 clientes ativos · 3 projetos ativos · 4 materiais/)).toBeInTheDocument();
    expect(screen.getByText(/tempo médio de aprovação 1,0 dias|tempo médio de aprovação 24,0 h/)).toBeInTheDocument();

    const overdue = within(screen.getByRole("region", { name: "Prazos vencidos" }));
    expect(overdue.getByRole("link", { name: "Carrossel de verão" })).toHaveAttribute("href", `/admin/materiais/${U(1)}`);
    // o material com prazo futuro aparece em "Próximos prazos" e em "Materiais recentes"
    expect(screen.getAllByRole("link", { name: "Vídeo de inverno" })).toHaveLength(2);
    expect(screen.getByText("Marina Prado")).toBeInTheDocument();
    expect(screen.getByText(/aprovou/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver todos" })).toHaveAttribute("href", "/admin/materiais");
    expect(screen.queryByText(/Ainda não há materiais cadastrados/)).not.toBeInTheDocument();
  });

  it("avisa quando só parte dos materiais foi lida", () => {
    render(<RealDashboard data={data({ truncated: true })} now={NOW} />);
    expect(screen.getByText(/mostrando os 1000 mais recentes/)).toBeInTheDocument();
  });
});
