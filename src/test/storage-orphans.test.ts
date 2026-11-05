// @vitest-environment node
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlan } from "../../scripts/cleanup-storage-orphans.mjs";
import { DEFAULT_GRACE_HOURS, deletionBlockers, isAppPath, planOrphans, type StorageObject } from "@/lib/storage/orphans";

const C = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const M = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const NOW = Date.parse("2026-11-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const obj = (name: string, h: number | null): StorageObject => ({ name, createdAt: h === null ? null : hoursAgo(h), size: 10 });
const path = (file: string) => `${C}/${M}/${file}`;

describe("planOrphans", () => {
  it("separa o que fica (tem registro), o apagável (antigo e sem registro) e o recente (pode ser envio em andamento)", () => {
    const plan = planOrphans({
      objects: [obj(path("a.png"), 100), obj(path("velho.png"), 72), obj(path("novo.png"), 2), obj(path("sem-data.png"), null)],
      filePaths: [path("a.png")],
      now: NOW,
    });
    expect(plan.kept).toBe(1);
    expect(plan.deletable.map((o) => o.name)).toEqual([path("velho.png")]);
    expect(plan.recent.map((o) => o.name).sort()).toEqual([path("novo.png"), path("sem-data.png")].sort());
    expect(plan.unexpected).toEqual([]);
  });

  it("objeto fora do padrão <cliente>/<material>/… nunca é apagável, por mais antigo que seja", () => {
    const fora = ["lixo.txt", "pasta/arquivo.png", `${C}/arquivo.png`, `${C}/nao-uuid/arquivo.png`, `../${C}/${M}/a.png`, `${C}/${M}/`];
    const plan = planOrphans({ objects: fora.map((n) => obj(n, 9999)), filePaths: [], now: NOW });
    expect(plan.deletable).toEqual([]);
    expect(plan.unexpected.map((o) => o.name).sort()).toEqual([...fora].sort());
    expect(isAppPath(path("a.png"))).toBe(true);
    expect(isAppPath(`${C}/${M}/${C}/f.png`)).toBe(true); // subpastas (versão) valem
    expect(isAppPath(`${C.toUpperCase()}/${M}/a.png`)).toBe(true);
  });

  it("a carência nunca é menor que 1 hora, mesmo que se peça zero ou negativo; o padrão é 24 h", () => {
    const o = [obj(path("x.png"), 0.5), obj(path("y.png"), 1.5)];
    for (const graceHours of [0, -5, 0.1]) {
      expect(planOrphans({ objects: o, filePaths: [], now: NOW, graceHours }).deletable.map((x) => x.name)).toEqual([path("y.png")]);
    }
    expect(planOrphans({ objects: [obj(path("z.png"), 23)], filePaths: [], now: NOW }).deletable).toEqual([]);
    expect(planOrphans({ objects: [obj(path("z.png"), 25)], filePaths: [], now: NOW }).deletable).toHaveLength(1);
    expect(DEFAULT_GRACE_HOURS).toBe(24);
  });

  it("registros sem objeto são só relatados (o histórico é imutável)", () => {
    const plan = planOrphans({ objects: [obj(path("a.png"), 100)], filePaths: [path("a.png"), path("sumiu.png")], now: NOW });
    expect(plan.missing).toEqual([path("sumiu.png")]);
    expect(plan.deletable).toEqual([]);
  });
});

describe("deletionBlockers", () => {
  const empty = planOrphans({ objects: [], filePaths: [], now: NOW });
  it("recusa quando o banco não tem arquivo nenhum mas o storage tem (projeto errado ou consulta falha)", () => {
    expect(deletionBlockers({ plan: empty, fileRowCount: 0, objectCount: 5, maxDelete: 200 }).join(" ")).toMatch(/projeto errado/);
    expect(deletionBlockers({ plan: empty, fileRowCount: 0, objectCount: 0, maxDelete: 200 })).toEqual([]);
    expect(deletionBlockers({ plan: empty, fileRowCount: 0, objectCount: 5, maxDelete: 200, allowEmptyDatabase: true })).toEqual([]);
  });

  it("recusa planos acima do limite de segurança", () => {
    const many = planOrphans({ objects: Array.from({ length: 11 }, (_, i) => obj(path(`o${i}.png`), 100)), filePaths: ["x"], now: NOW });
    expect(deletionBlockers({ plan: many, fileRowCount: 1, objectCount: 11, maxDelete: 10 }).join(" ")).toMatch(/acima do limite de 10/);
    expect(deletionBlockers({ plan: many, fileRowCount: 1, objectCount: 11, maxDelete: 11 })).toEqual([]);
  });
});

describe("script cleanup-storage-orphans: argumentos e travas", () => {
  const env = { SUPABASE_URL: "https://projeto-dev.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_" + "s".repeat(30) };

  it("o padrão é RELATÓRIO; --execute exige o host do projeto; chave pública é recusada", () => {
    expect(buildPlan([], env).mode).toBe("report");
    expect(buildPlan(["--execute"], env).errors.join(" ")).toMatch(/--project-host projeto-dev\.supabase\.co/);
    expect(buildPlan(["--execute", "--project-host", "outro.supabase.co"], env).errors.join(" ")).toMatch(/--project-host/);
    expect(buildPlan(["--execute", "--project-host", "projeto-dev.supabase.co"], env)).toMatchObject({ errors: [], mode: "execute", graceHours: 24, maxDelete: 200 });
    expect(buildPlan([], { ...env, SUPABASE_SECRET_KEY: "sb_publishable_" + "p".repeat(30) }).errors.join(" ")).toMatch(/não é a SECRETA/);
  });

  it("valida carência (>= 1 h) e limite de exclusão", () => {
    expect(buildPlan(["--older-than-hours", "0"], env).errors.join(" ")).toMatch(/older-than-hours/);
    expect(buildPlan(["--older-than-hours", "abc"], env).errors.join(" ")).toMatch(/older-than-hours/);
    expect(buildPlan(["--max-delete", "0"], env).errors.join(" ")).toMatch(/max-delete/);
    expect(buildPlan(["--older-than-hours", "48", "--max-delete", "5"], env)).toMatchObject({ errors: [], graceHours: 48, maxDelete: 5 });
  });

  it("sem credenciais ou em modo de simulação com chave inválida não toca na rede e não imprime a chave", () => {
    const run = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(process.cwd(), "scripts", "cleanup-storage-orphans.mjs")], {
      env: { PATH: process.env.PATH ?? "", SUPABASE_URL: "https://projeto-dev.supabase.co", SUPABASE_SECRET_KEY: "sb_publishable_" + "p".repeat(30) } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/não é a SECRETA/);
    expect(run.stdout + run.stderr).not.toContain("ppppppp");
  });
});
