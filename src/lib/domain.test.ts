import { describe, expect, it } from "vitest";
import {
  computeKpis,
  decisionsByWeek,
  filterMaterials,
  isOverdue,
  maskEmail,
  resolveLinkState,
} from "@/lib/domain";
import { NOW, approvalLinks, decisions, materials } from "@/lib/mock/data";
import { formatDuration } from "@/lib/format";

describe("resolveLinkState", () => {
  const link = (token: string) => approvalLinks.find((l) => l.token === token);

  it("aceita link dentro do prazo, sem revogação e sem uso", () => {
    expect(resolveLinkState(link("demo"), NOW)).toBe("valido");
  });

  it("marca link vencido como expirado", () => {
    expect(resolveLinkState(link("expirado"), NOW)).toBe("expirado");
  });

  it("marca link revogado, mesmo que ainda esteja no prazo", () => {
    expect(resolveLinkState(link("revogado"), NOW)).toBe("revogado");
  });

  it("marca link já usado como utilizado", () => {
    expect(resolveLinkState(link("utilizado"), NOW)).toBe("utilizado");
  });

  it("trata token inexistente como revogado, sem revelar que nunca existiu", () => {
    expect(resolveLinkState(undefined, NOW)).toBe("revogado");
  });

  it("revogação vence expiração e uso", () => {
    const l = { ...link("demo")!, revokedAt: NOW, usedAt: NOW, expiresAt: "2000-01-01T00:00:00Z" };
    expect(resolveLinkState(l, NOW)).toBe("revogado");
  });

  it("expira exatamente no instante de expiresAt", () => {
    const l = link("demo")!;
    expect(resolveLinkState(l, l.expiresAt)).toBe("expirado");
  });
});

describe("maskEmail", () => {
  it("mantém só o início do usuário e o domínio", () => {
    expect(maskEmail("marina@casaaurora.example")).toBe("ma***@casaaurora.example");
  });

  it("não vaza nada quando o e-mail é inválido", () => {
    expect(maskEmail("sem-arroba")).toBe("***");
  });
});

describe("isOverdue", () => {
  const byId = (id: string) => materials.find((m) => m.id === id)!;

  it("é verdadeiro para material pendente com prazo vencido", () => {
    expect(isOverdue(byId("m11"), NOW)).toBe(true);
  });

  it("é falso no próprio dia do prazo", () => {
    expect(isOverdue(byId("m8"), NOW)).toBe(false);
  });

  it("é falso para material já aprovado, mesmo com prazo antigo", () => {
    expect(isOverdue(byId("m13"), NOW)).toBe(false);
  });
});

describe("filterMaterials", () => {
  it("combina cliente, status e tipo", () => {
    const result = filterMaterials(materials, { clientId: "c1", status: "aguardando", type: "carrossel" });
    expect(result.map((m) => m.id)).toEqual(["m1"]);
  });

  it("ignora o valor 'todos'", () => {
    expect(filterMaterials(materials, { clientId: "todos", status: "todos", type: "todos" })).toHaveLength(
      materials.length,
    );
  });

  it("busca por título sem diferenciar maiúsculas e espaços nas pontas", () => {
    const result = filterMaterials(materials, { search: "  BLACK friday " });
    expect(result.map((m) => m.id)).toEqual(["m3"]);
  });
});

describe("computeKpis", () => {
  const kpis = computeKpis(materials, decisions, NOW);

  it("conta materiais por status", () => {
    expect(kpis.aguardando).toBe(materials.filter((m) => m.status === "aguardando").length);
    expect(kpis.alteracao).toBe(materials.filter((m) => m.status === "alteracao").length);
  });

  it("conta só aprovações do mês de referência", () => {
    // d1, d2, d6, d7 em outubro/2026; d8 é de fevereiro e não entra.
    expect(kpis.aprovadosNoMes).toBe(4);
  });

  it("conta materiais atrasados", () => {
    expect(kpis.atrasados).toBe(1);
  });

  it("calcula tempo médio positivo entre versão e aprovação", () => {
    expect(kpis.tempoMedioAprovacaoHoras).not.toBeNull();
    expect(kpis.tempoMedioAprovacaoHoras!).toBeGreaterThan(0);
  });

  it("retorna null sem aprovações", () => {
    expect(computeKpis(materials, [], NOW).tempoMedioAprovacaoHoras).toBeNull();
  });
});

describe("decisionsByWeek", () => {
  const points = decisionsByWeek(decisions, NOW, 6);

  it("devolve a quantidade de semanas pedida, a mais recente por último", () => {
    expect(points).toHaveLength(6);
    expect(points[5].label).toBe("Esta semana");
  });

  it("soma todas as decisões dentro da janela", () => {
    const total = points.reduce((acc, p) => acc + p.aprovados + p.alteracoes, 0);
    // d8 (fevereiro) fica fora da janela de 6 semanas.
    expect(total).toBe(decisions.length - 1);
  });

  it("ignora decisões no futuro", () => {
    const future = [{ ...decisions[0], at: "2027-01-01T00:00:00Z" }];
    const result = decisionsByWeek(future, NOW, 6);
    expect(result.every((p) => p.aprovados === 0 && p.alteracoes === 0)).toBe(true);
  });
});

describe("formatDuration", () => {
  it("formata minutos, horas e dias", () => {
    expect(formatDuration(0.5)).toBe("30 min");
    expect(formatDuration(5)).toBe("5,0 h");
    expect(formatDuration(72)).toBe("3,0 dias");
    expect(formatDuration(null)).toBe("—");
  });
});
