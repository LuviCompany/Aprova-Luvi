// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatFullDate } from "./format";

describe("formatFullDate", () => {
  it("mostra dia/mês/ano, que é o que uma data de cadastro precisa (sem ambiguidade entre anos)", () => {
    expect(formatFullDate("2026-02-10T12:00:00Z")).toBe("10/02/2026");
    expect(formatFullDate("2025-12-31T12:00:00Z")).toBe("31/12/2025");
  });

  it("usa o fuso de São Paulo: 01h UTC ainda é o dia anterior", () => {
    expect(formatFullDate("2026-03-05T01:00:00Z")).toBe("04/03/2026");
  });
});
