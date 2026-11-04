// @vitest-environment node
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlan, checkApprover, describePlan } from "../../scripts/invite-approver.mjs";

const SECRET = "sb_secret_" + "s".repeat(30);
const PUBLISHABLE = "sb_publishable_" + "p".repeat(30);
const ID = "11111111-1111-4111-8111-111111111111";
const env = { SUPABASE_URL: "https://projeto-dev.supabase.co", SUPABASE_SECRET_KEY: SECRET, APP_URL: "http://localhost:3000" };
const plan = (args: string[] = ["--approver-id", ID], e: Record<string, string> = env) => buildPlan(args, e);

describe("invite-approver: plano e travas de segurança", () => {
  it("o padrão é SIMULAÇÃO; --check-connection é só leitura; --execute exige o host do projeto", () => {
    expect(plan().mode).toBe("dry-run");
    expect(plan(["--approver-id", ID, "--check-connection"]).mode).toBe("check");
    expect(plan(["--approver-id", ID, "--execute"]).errors.join(" ")).toMatch(/--project-host projeto-dev\.supabase\.co/);
    expect(plan(["--approver-id", ID, "--execute", "--project-host", "outro.supabase.co"]).errors.join(" ")).toMatch(/--project-host/);
    const ok = plan(["--approver-id", ID, "--execute", "--project-host", "PROJETO-DEV.supabase.co"]);
    expect(ok.errors).toEqual([]);
    expect(ok.mode).toBe("execute");
  });

  it("recusa chave pública, id que não é uuid, APP_URL de produção e http fora de localhost", () => {
    expect(plan(["--approver-id", ID], { ...env, SUPABASE_SECRET_KEY: PUBLISHABLE }).errors.join(" ")).toMatch(/não é a SECRETA/);
    expect(plan(["--approver-id", "abc"]).errors.join(" ")).toMatch(/--approver-id/);
    expect(plan(["--approver-id", ID], { ...env, APP_URL: "https://aprova.luvicompany.com.br" }).errors.join(" ")).toMatch(/PRODUÇÃO/);
    expect(plan(["--approver-id", ID], { ...env, APP_URL: "http://exemplo.com" }).errors.join(" ")).toMatch(/https/);
    expect(plan(["--approver-id", ID], { ...env, APP_URL: "" }).errors.join(" ")).toMatch(/APP_URL/);
  });

  it("a descrição do plano não vaza a chave e deixa claro que não há e-mail nem senha", () => {
    const text = describePlan(plan());
    expect(text).not.toContain("sssssss");
    expect(text).toMatch(/nenhum e-mail é enviado/);
    expect(text).toMatch(/senha é criada pelo próprio aprovador/);
  });

  it("só age em aprovador ativo, de cliente ativo, sem login, com convite PREPARADO e sem perfil com o mesmo e-mail", () => {
    const approver = { active: true, profile_id: null };
    const client = { active: true };
    const prepared = [{ status: "preparado" }];
    expect(checkApprover(approver, client, prepared, null)).toEqual([]);
    expect(checkApprover(null, client, prepared, null)).toEqual(["Aprovador não encontrado."]);
    expect(checkApprover({ ...approver, active: false }, client, prepared, null).join(" ")).toMatch(/inativo/);
    expect(checkApprover({ ...approver, profile_id: "x" }, client, prepared, null).join(" ")).toMatch(/já tem acesso/);
    expect(checkApprover(approver, { active: false }, prepared, null).join(" ")).toMatch(/arquivado/);
    expect(checkApprover(approver, client, [{ status: "revogado" }], null).join(" ")).toMatch(/PREPARADO/);
    expect(checkApprover(approver, client, [], null).join(" ")).toMatch(/PREPARADO/);
    expect(checkApprover(approver, client, prepared, { id: "p" }).join(" ")).toMatch(/perfil com este e-mail/);
  });

  it("executado de verdade em simulação, não toca na rede e não imprime a chave", () => {
    const run = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(process.cwd(), "scripts", "invite-approver.mjs"), "--approver-id", ID], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/Simulação: nada foi lido nem alterado/);
    expect(run.stdout + run.stderr).not.toContain(SECRET);
  });
});
