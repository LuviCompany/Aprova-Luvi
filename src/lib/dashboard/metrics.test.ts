import { describe, expect, it } from "vitest";
import {
  computeDashboardKpis,
  isOverdueMaterial,
  monthLabel,
  overdueMaterials,
  upcomingDeadlines,
  weeklyDecisions,
  type DashboardDecision,
  type DashboardMaterial,
} from "./metrics";

const NOW = new Date("2026-11-04T15:00:00Z"); // 12h em Brasília

const m = (id: string, status: DashboardMaterial["status"], dueDate: string | null, over: Partial<DashboardMaterial> = {}): DashboardMaterial => ({
  id,
  title: `Material ${id}`,
  type: "imagem",
  status,
  clientName: "Casa Aurora",
  dueDate,
  createdAt: "2026-11-01T12:00:00Z",
  ...over,
});
const d = (id: string, decision: DashboardDecision["decision"], at: string, requestedAt: string | null = null): DashboardDecision => ({
  id,
  materialId: "m1",
  decision,
  by: "Marina",
  via: "portal",
  at,
  requestedAt,
});

describe("isOverdueMaterial", () => {
  it("só vence quem espera decisão ou alteração, e só depois do fim do dia do prazo (Brasília)", () => {
    expect(isOverdueMaterial(m("1", "aguardando", "2026-11-03"), NOW)).toBe(true);
    expect(isOverdueMaterial(m("2", "alteracao", "2026-11-03"), NOW)).toBe(true);
    expect(isOverdueMaterial(m("3", "aguardando", "2026-11-04"), NOW)).toBe(false); // hoje ainda vale até 23:59:59
    expect(isOverdueMaterial(m("4", "aguardando", "2026-11-04"), new Date("2026-11-05T02:59:59Z"))).toBe(false);
    expect(isOverdueMaterial(m("5", "aguardando", "2026-11-04"), new Date("2026-11-05T03:00:01Z"))).toBe(true);
    for (const status of ["rascunho", "aprovado"] as const) expect(isOverdueMaterial(m("6", status, "2020-01-01"), NOW)).toBe(false);
    expect(isOverdueMaterial(m("7", "aguardando", null), NOW)).toBe(false);
  });
});

describe("computeDashboardKpis", () => {
  it("sem dados, tudo zero e sem tempo médio", () => {
    expect(computeDashboardKpis([], [], NOW)).toEqual({
      aguardando: 0, alteracao: 0, rascunhos: 0, aprovados: 0, atrasados: 0, aprovadosNoMes: 0, tempoMedioAprovacaoHoras: null,
    });
  });

  it("conta por status, atrasados, aprovados do mês e tempo médio só das aprovações com solicitação", () => {
    const materials = [m("1", "aguardando", "2026-11-01"), m("2", "aguardando", "2026-12-01"), m("3", "alteracao", null), m("4", "rascunho", null), m("5", "rascunho", null), m("6", "aprovado", null)];
    const decisions = [
      d("a", "aprovado", "2026-11-02T12:00:00Z", "2026-11-02T00:00:00Z"), // 12 h
      d("b", "aprovado", "2026-11-03T12:00:00Z", "2026-11-02T12:00:00Z"), // 24 h
      d("c", "aprovado", "2026-10-30T12:00:00Z", null), // mês anterior, sem solicitação
      d("e", "alteracao", "2026-11-03T12:00:00Z", "2026-11-03T00:00:00Z"),
    ];
    expect(computeDashboardKpis(materials, decisions, NOW)).toEqual({
      aguardando: 2, alteracao: 1, rascunhos: 2, aprovados: 1, atrasados: 1, aprovadosNoMes: 2, tempoMedioAprovacaoHoras: 18,
    });
  });

  it("a virada do mês usa Brasília: 31/10 22h (BRT) ainda é outubro mesmo já sendo 01/11 em UTC", () => {
    const approval = d("a", "aprovado", "2026-11-01T01:00:00Z"); // 31/10 22h em Brasília
    expect(computeDashboardKpis([], [approval], new Date("2026-10-31T23:00:00Z")).aprovadosNoMes).toBe(1);
    expect(computeDashboardKpis([], [approval], new Date("2026-11-04T15:00:00Z")).aprovadosNoMes).toBe(0);
  });

  it("tempos negativos (dados inconsistentes) são ignorados", () => {
    expect(computeDashboardKpis([], [d("a", "aprovado", "2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z")], NOW).tempoMedioAprovacaoHoras).toBeNull();
  });
});

describe("weeklyDecisions", () => {
  it("agrupa em 6 semanas, a mais recente por último, ignorando futuro e muito antigo", () => {
    const points = weeklyDecisions(
      [d("1", "aprovado", "2026-11-03T12:00:00Z"), d("2", "alteracao", "2026-11-03T12:00:00Z"), d("3", "aprovado", "2026-10-25T12:00:00Z"), d("4", "aprovado", "2026-01-01T12:00:00Z"), d("5", "aprovado", "2026-11-10T12:00:00Z")],
      NOW,
    );
    expect(points).toHaveLength(6);
    expect(points[5]).toEqual({ label: "Esta semana", aprovados: 1, alteracoes: 1 });
    expect(points[4]).toEqual({ label: "-1 sem", aprovados: 1, alteracoes: 0 });
    expect(points.reduce((sum, p) => sum + p.aprovados + p.alteracoes, 0)).toBe(3);
  });
});

describe("prazos", () => {
  const items = [
    m("a", "aguardando", "2026-11-10", { title: "B" }),
    m("b", "rascunho", "2026-11-04", { title: "A" }), // hoje
    m("c", "alteracao", "2026-11-02"), // vencido
    m("d", "aprovado", "2026-11-20"), // aprovado não entra
    m("e", "rascunho", null),
    m("f", "aguardando", "2026-11-10", { title: "A" }),
  ];

  it("próximos prazos: de hoje em diante, ordenados por data e título, sem aprovados nem vencidos", () => {
    expect(upcomingDeadlines(items, NOW).map((x) => x.id)).toEqual(["b", "f", "a"]);
    expect(upcomingDeadlines(items, NOW, 2)).toHaveLength(2);
  });

  it("vencidos: do mais atrasado ao menos", () => {
    const more = [...items, m("g", "aguardando", "2026-10-20")];
    expect(overdueMaterials(more, NOW).map((x) => x.id)).toEqual(["g", "c"]);
  });
});

describe("monthLabel", () => {
  it("mês e ano em português, no fuso de Brasília", () => {
    expect(monthLabel(new Date("2026-11-04T15:00:00Z"))).toBe("Novembro de 2026");
    expect(monthLabel(new Date("2026-12-01T01:00:00Z"))).toBe("Novembro de 2026"); // 30/11 22h em Brasília
  });
});
