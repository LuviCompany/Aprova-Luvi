// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TEST_HTML, TEST_SUBJECT, TEST_TEXT, buildPlan, sendTestEmail } from "../../scripts/send-test-email.mjs";

const KEY = "re_" + "k".repeat(30);
const env = {
  SUPABASE_URL: "https://projeto-dev.supabase.co",
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: KEY,
  EMAIL_FROM: "Aprova Luvi <remetente@dominio-exemplo.com.br>",
};
const SCRIPT = join(process.cwd(), "scripts", "send-test-email.mjs");
const NODE_ARGS = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SCRIPT];
const run = (args: string[], childEnv: Record<string, string>) =>
  spawnSync(process.execPath, [...NODE_ARGS, ...args], { env: { PATH: process.env.PATH ?? "", ...childEnv } as unknown as NodeJS.ProcessEnv, encoding: "utf8" });

describe("send-test-email: plano", () => {
  it("o padrão é SIMULAÇÃO e aceita a configuração completa", () => {
    expect(buildPlan(["--to", "Eu@Exemplo.com.br"], env)).toMatchObject({
      errors: [],
      mode: "simulate",
      to: "eu@exemplo.com.br",
      from: "Aprova Luvi <remetente@dominio-exemplo.com.br>",
    });
  });

  it("--execute exige o host do projeto de desenvolvimento, igual ao SUPABASE_URL", () => {
    expect(buildPlan(["--to", "eu@exemplo.com.br", "--execute"], env).errors.join(" ")).toMatch(/--project-host projeto-dev\.supabase\.co/);
    expect(buildPlan(["--to", "eu@exemplo.com.br", "--execute", "--project-host", "outro.supabase.co"], env).errors.join(" ")).toMatch(/--project-host/);
    expect(buildPlan(["--to", "eu@exemplo.com.br", "--execute", "--project-host", "PROJETO-dev.supabase.co"], env)).toMatchObject({ errors: [], mode: "execute" });
    expect(buildPlan(["--to", "eu@exemplo.com.br", "--execute", "--project-host", "x"], { ...env, SUPABASE_URL: "" }).errors.join(" ")).toMatch(/SUPABASE_URL/);
  });

  it("exige um único destinatário válido e que receba e-mail", () => {
    expect(buildPlan([], env).errors.join(" ")).toMatch(/--to/);
    for (const to of ["sem-arroba", "a@b", "a@b.com, c@d.com", "a@b.com;c@d.com", "Nome <a@b.com>", "a b@c.com"]) {
      expect(buildPlan(["--to", to], env).errors.join(" ")).toMatch(/--to/);
    }
    for (const to of ["a@teste.invalid", "a@x.test", "a@x.example", "a@x.localhost"]) {
      expect(buildPlan(["--to", to], env).errors.join(" ")).toMatch(/não recebe e-mail/);
    }
  });

  it("recusa provedor simulado, provedor ausente, resend incompleto e produção", () => {
    const to = ["--to", "eu@exemplo.com.br"];
    expect(buildPlan(to, { ...env, EMAIL_PROVIDER: "simulated" }).errors.join(" ")).toMatch(/simulated/);
    expect(buildPlan(to, { ...env, EMAIL_PROVIDER: "" }).errors.join(" ")).toMatch(/EMAIL_PROVIDER/);
    expect(buildPlan(to, { ...env, EMAIL_FROM: "" }).errors.join(" ")).toMatch(/EMAIL_FROM/);
    expect(buildPlan(to, { ...env, RESEND_API_KEY: "" }).errors.join(" ")).toMatch(/RESEND_API_KEY/);
    expect(buildPlan(to, { ...env, NODE_ENV: "production" }).errors.join(" ")).toMatch(/só para desenvolvimento/);
  });

  it("nenhuma mensagem de erro contém a chave", () => {
    const all = [buildPlan([], { ...env, EMAIL_FROM: "" }), buildPlan(["--execute"], env), buildPlan(["--to", "x"], env)].flatMap((p) => p.errors).join(" ");
    expect(all).not.toContain(KEY);
  });
});

describe("send-test-email: conteúdo e envio", () => {
  it("o conteúdo é fixo e sem link, token, código ou dado variável", () => {
    for (const part of [TEST_SUBJECT, TEST_TEXT, TEST_HTML]) {
      expect(part).not.toMatch(/https?:|www\.|href|token|\d{4,}|@/i);
    }
  });

  it("envia exatamente UM e-mail, com o conteúdo fixo, pela função recebida", async () => {
    const send = vi.fn(async () => ({ ok: true as const, provider: "resend" as const }));
    const plan = buildPlan(["--to", "eu@exemplo.com.br"], env);
    expect(await sendTestEmail(plan, send, env as unknown as NodeJS.ProcessEnv)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ to: "eu@exemplo.com.br", subject: TEST_SUBJECT, text: TEST_TEXT, html: TEST_HTML }, env);
  });

  it("traduz cada falha em uma orientação, sem repetir o envio", async () => {
    const plan = buildPlan(["--to", "eu@exemplo.com.br"], env);
    for (const reason of ["rate_limited", "rejected", "failed", "not_configured"] as const) {
      const send = vi.fn(async () => ({ ok: false as const, reason }));
      const result = await sendTestEmail(plan, send, env as unknown as NodeJS.ProcessEnv);
      expect(result).toMatchObject({ ok: false, reason });
      expect(result.ok ? "" : result.hint).toMatch(/\S/);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it("reutiliza a sendEmail do app (provider.ts), sem chamar a API por conta própria", () => {
    const source = readFileSync(SCRIPT, "utf8");
    expect(source).toContain("../src/lib/email/provider.ts");
    expect(source).not.toMatch(/api\.resend\.com|fetch\(/);
  });
});

describe("send-test-email: execução do script", () => {
  it("simulação não abre conexão, não envia e não imprime a chave", () => {
    const r = run(["--to", "eu@exemplo.com.br"], env);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/NADA foi enviado/);
    expect(r.stdout).toMatch(/--execute --project-host projeto-dev\.supabase\.co/);
    expect(r.stdout + r.stderr).not.toContain(KEY);
    expect(r.stdout + r.stderr).not.toContain(TEST_TEXT.slice(0, 30));
  });

  it("--execute sem --project-host é recusado antes de qualquer envio", () => {
    const r = run(["--to", "eu@exemplo.com.br", "--execute"], env);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--project-host/);
    expect(r.stdout).not.toMatch(/Aceito pelo Resend/);
  });

  it("configuração incompleta sai com erro e sem a chave", () => {
    const r = run(["--to", "eu@exemplo.com.br"], { ...env, EMAIL_FROM: "" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/EMAIL_FROM/);
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });

  it("a sendEmail real é carregável fora do Next e sem configuração não envia nada (sem rede)", () => {
    const code = `import { loadSendEmail } from ${JSON.stringify(new URL("file:///" + SCRIPT.replace(/\\/g, "/")).href)};
      const send = await loadSendEmail();
      console.log(JSON.stringify(await send({ to: "a@b.com", subject: "s", text: "t" }, {})));`;
    const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e", code], {
      env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual({ ok: false, reason: "not_configured" });
  });
});
