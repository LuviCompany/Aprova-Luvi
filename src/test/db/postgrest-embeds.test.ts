// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DASHBOARD_DECISIONS_SELECT, DASHBOARD_MATERIALS_SELECT, DASHBOARD_PENDING_SELECT } from "@/lib/dashboard/queries";
import { PORTAL_DETAIL_SELECT, PORTAL_HISTORY_SELECT, PORTAL_LIST_SELECT } from "@/lib/approval/portal-queries";
import { REQUEST_SELECT } from "@/lib/approval/staff-queries";
import { STAFF_HISTORY_SELECT } from "@/lib/approval/staff-history";
import { TEAM_USERS_SELECT } from "@/lib/users/queries";
import { MATERIAL_DETAIL_SELECT, MATERIAL_LIST_SELECT } from "@/lib/materials/selects";
import { VERSIONS_SELECT } from "@/lib/materials/versions";
import { createTestDb, type TestDb } from "./harness";

/**
 * O PostgREST só consegue aninhar tabelas (`pai(filha)`) quando existe uma chave estrangeira entre elas, em qualquer
 * sentido. Um aninhamento sem chave estrangeira só falha contra o Supabase de verdade (PGRST200) e passa batido nos
 * mocks: foi o que derrubou o portal (materials -> approval_requests, que só se liga pela VERSÃO).
 * Este teste lê o catálogo das migrations reais e confere TODOS os aninhamentos dos selects do app.
 */

interface Embed {
  table: string;
  children: Embed[];
}

/** Lê `a, b(c, d(e)), alias:tabela!dica(x)` e devolve as tabelas aninhadas (ignora colunas e `count`). */
export function parseEmbeds(select: string): Embed[] {
  let i = 0;
  const parseList = (): Embed[] => {
    const out: Embed[] = [];
    while (i < select.length) {
      while (select[i] === " " || select[i] === ",") i++;
      if (i >= select.length || select[i] === ")") break;
      let j = i;
      while (j < select.length && !",()".includes(select[j])) j++;
      const raw = select.slice(i, j).trim();
      i = j;
      if (select[i] === "(") {
        i++;
        const children = parseList();
        i++; // ")"
        const afterAlias = raw.includes(":") ? raw.split(":")[1] : raw;
        const table = afterAlias.split("!")[0].trim();
        out.push({ table, children });
      }
    }
    return out;
  };
  return parseList();
}

const pairs = (parent: string, embeds: Embed[]): Array<[string, string]> =>
  embeds.flatMap((e) => [[parent, e.table] as [string, string], ...pairs(e.table, e.children)]);

let db: TestDb;
let foreignKeys: Set<string>;

beforeAll(async () => {
  db = await createTestDb();
  const { rows } = await db.query<{ a: string; b: string }>(
    `select c.conrelid::regclass::text as a, c.confrelid::regclass::text as b
     from pg_constraint c where c.contype = 'f'`,
  );
  foreignKeys = new Set(rows.flatMap((r) => [`${r.a}>${r.b}`, `${r.b}>${r.a}`]));
}, 180_000);

afterAll(async () => {
  await db.close();
});

const QUERIES: Array<[string, string, string]> = [
  ["equipe: histórico de decisões", "decisions", STAFF_HISTORY_SELECT],
  ["equipe: usuários", "profiles", TEAM_USERS_SELECT],
  ["portal: lista de materiais", "materials", PORTAL_LIST_SELECT],
  ["portal: detalhe do material", "materials", PORTAL_DETAIL_SELECT],
  ["portal: histórico de decisões", "decisions", PORTAL_HISTORY_SELECT],
  ["painel: solicitações do material", "approval_requests", REQUEST_SELECT],
  ["painel: dashboard (materiais)", "materials", DASHBOARD_MATERIALS_SELECT],
  ["painel: dashboard (decisões)", "decisions", DASHBOARD_DECISIONS_SELECT],
  ["painel: dashboard (pendentes)", "approval_requests", DASHBOARD_PENDING_SELECT],
  ["painel: lista de materiais", "materials", MATERIAL_LIST_SELECT],
  ["painel: detalhe de material", "materials", MATERIAL_DETAIL_SELECT],
  ["painel: versões do material", "material_versions", VERSIONS_SELECT],
];

describe("aninhamentos do PostgREST existem como chave estrangeira", () => {
  it.each(QUERIES)("%s", (_nome, table, select) => {
    const missing = pairs(table, parseEmbeds(select))
      .filter(([a, b]) => !foreignKeys.has(`${a}>${b}`) && !foreignKeys.has(`public.${a}>public.${b}`))
      .map(([a, b]) => `${a} -> ${b}`);
    expect(missing).toEqual([]);
  });

  it("o teste enxerga o defeito que quebrou o portal (materials -> approval_requests não tem chave direta)", () => {
    const bad = pairs("materials", parseEmbeds("id, approval_requests(id, status)"));
    expect(bad).toEqual([["materials", "approval_requests"]]);
    expect(foreignKeys.has("materials>approval_requests")).toBe(false);
    // o caminho correto existe: materials -> material_versions -> approval_requests
    expect(foreignKeys.has("material_versions>approval_requests") || foreignKeys.has("approval_requests>material_versions")).toBe(true);
  });

  it("o parser lê alias, dica e aninhamento profundo", () => {
    expect(parseEmbeds("id, versions:material_versions(count), a!fk(x, b(y))")).toEqual([
      { table: "material_versions", children: [] },
      { table: "a", children: [{ table: "b", children: [] }] },
    ]);
  });
});
