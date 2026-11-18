// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlan, describePlan, PRODUCTION_PROJECT_HOSTS } from "../../scripts/bootstrap-admin.mjs";

const PROD_URL = `https://${PRODUCTION_PROJECT_HOSTS[0]}`;
// projeto "DB Aprova Luvi" (desenvolvimento); montado em partes para o texto completo da URL do .env.local nunca entrar num commit
const DEV_URL = ["https://", "kswnwootbdzlhdvbhhpk", ".supabase.co"].join("");

const SECRET = "sb_secret_" + "s".repeat(30);
const PUBLISHABLE = "sb_publishable_" + "p".repeat(30);
const jwt = (role: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.assinatura-de-teste`;

const baseEnv = {
  SUPABASE_URL: "https://projeto-dev.supabase.co",
  SUPABASE_SECRET_KEY: SECRET,
  APP_URL: "http://localhost:3000",
};
const baseArgs = ["--email", "Admin@LuviCompany.com.br", "--name", "Admin Teste"];
const plan = (args = baseArgs, env: Record<string, string> = baseEnv) => buildPlan(args, env);

describe("bootstrap-admin: plano e travas de segurança", () => {
  it("o padrão é SIMULAÇÃO e normaliza o e-mail", () => {
    const p = plan();
    expect(p.errors).toEqual([]);
    expect(p.mode).toBe("dry-run");
    expect(p.email).toBe("admin@luvicompany.com.br");
    expect(p.supabaseHost).toBe("projeto-dev.supabase.co");
    expect(p.keyKind).toBe("secret");
  });

  it("aceita a chave secreta nova e a service_role legada (com a variável legada)", () => {
    expect(plan(baseArgs, { ...baseEnv, SUPABASE_SECRET_KEY: jwt("service_role") }).errors).toEqual([]);
    const { SUPABASE_SECRET_KEY: _omit, ...semNova } = baseEnv;
    void _omit;
    expect(plan(baseArgs, { ...semNova, SUPABASE_SERVICE_ROLE_KEY: SECRET }).errors).toEqual([]);
  });

  it("RECUSA chave pública (publishable ou anon) no lugar da secreta", () => {
    for (const key of [PUBLISHABLE, jwt("anon")]) {
      const p = plan(baseArgs, { ...baseEnv, SUPABASE_SECRET_KEY: key });
      expect(p.errors.join(" ")).toMatch(/PÚBLICA/);
    }
  });

  it("recusa chave ausente ou sem formato de chave do Supabase", () => {
    expect(plan(baseArgs, { ...baseEnv, SUPABASE_SECRET_KEY: "" }).errors.join(" ")).toMatch(/Defina SUPABASE_SECRET_KEY/);
    expect(plan(baseArgs, { ...baseEnv, SUPABASE_SECRET_KEY: "qualquer-coisa" }).errors.join(" ")).toMatch(/não parece/);
  });

  it("exige APP_URL: não há valor padrão que pudesse apontar o convite para o lugar errado", () => {
    const { APP_URL: _omit, ...semUrl } = baseEnv;
    void _omit;
    expect(plan(baseArgs, semUrl).errors.join(" ")).toMatch(/Defina APP_URL/);
  });

  it("recusa APP_URL http fora de localhost e URL inválida", () => {
    expect(plan(baseArgs, { ...baseEnv, APP_URL: "http://dev.example.com" }).errors.join(" ")).toMatch(/https/);
    expect(plan(baseArgs, { ...baseEnv, APP_URL: "lixo" }).errors.join(" ")).toMatch(/não é uma URL/);
  });

  it("recusa a URL de PRODUÇÃO sem --allow-production", () => {
    const prod = { ...baseEnv, SUPABASE_URL: PROD_URL, APP_URL: "https://aprova.luvicompany.com.br" };
    expect(plan(baseArgs, prod).errors.join(" ")).toMatch(/PRODUÇÃO/);
    expect(plan([...baseArgs, "--allow-production"], prod).errors).toEqual([]);
  });

  it("TRAVA DE PROJETO: a APP_URL de produção só vale com o projeto Supabase de produção", () => {
    // projeto de desenvolvimento (qualquer outro host) com a URL de produção: recusado, mesmo com todas as flags
    for (const url of ["https://projeto-dev.supabase.co", DEV_URL]) {
      const p = plan([...baseArgs, "--allow-production", "--execute", "--project-host", new URL(url).host], {
        ...baseEnv,
        SUPABASE_URL: url,
        APP_URL: "https://aprova.luvicompany.com.br",
      });
      expect(p.errors.join(" "), url).toMatch(/só pode ser usada com o projeto Supabase de produção/);
    }
  });

  it("TRAVA DE PROJETO: o projeto de produção só vale com a APP_URL de produção (e a simulação já acusa)", () => {
    const p = plan(baseArgs, { ...baseEnv, SUPABASE_URL: PROD_URL, APP_URL: "http://localhost:3000" });
    expect(p.mode).toBe("dry-run");
    expect(p.errors.join(" ")).toMatch(/só pode ser usado com APP_URL=https:\/\/aprova.luvicompany.com.br/);
  });

  it("par correto de produção: aceita só com --allow-production e --project-host igual ao do projeto", () => {
    const env = { ...baseEnv, SUPABASE_URL: PROD_URL, APP_URL: "https://aprova.luvicompany.com.br" };
    const host = new URL(PROD_URL).host;
    expect(plan([...baseArgs, "--execute", "--project-host", host], env).errors.join(" ")).toMatch(/PRODUÇÃO/);
    expect(plan([...baseArgs, "--allow-production", "--execute"], env).errors.join(" ")).toMatch(/--project-host/);
    expect(plan([...baseArgs, "--allow-production", "--execute", "--project-host", host.toUpperCase()], env).errors).toEqual([]);
    const ok = plan([...baseArgs, "--allow-production", "--execute", "--project-host", host], env);
    expect(describePlan(ok)).toContain("(PRODUÇÃO)");
    expect(describePlan(ok)).not.toContain(SECRET);
  });

  it("--execute exige --project-host igual ao host do SUPABASE_URL", () => {
    expect(plan([...baseArgs, "--execute"]).errors.join(" ")).toMatch(/--project-host projeto-dev.supabase.co/);
    expect(plan([...baseArgs, "--execute", "--project-host", "outro-projeto.supabase.co"]).errors.join(" ")).toMatch(/--project-host/);
    const ok = plan([...baseArgs, "--execute", "--project-host", "PROJETO-DEV.supabase.co"]);
    expect(ok.errors).toEqual([]);
    expect(ok.mode).toBe("execute");
  });

  it("por padrão NÃO envia e-mail (gera o link no terminal); --send-email muda isso", () => {
    const padrao = plan([...baseArgs, "--execute", "--project-host", "projeto-dev.supabase.co"]);
    expect(padrao.sendEmail).toBe(false);
    expect(describePlan(padrao)).toContain("nenhum e-mail é enviado");
    const comEmail = plan([...baseArgs, "--execute", "--send-email", "--project-host", "projeto-dev.supabase.co"]);
    expect(comEmail.sendEmail).toBe(true);
    expect(describePlan(comEmail)).toContain("exige SMTP");
  });

  it("o convite chega em /auth/invite do ambiente informado", () => {
    expect(describePlan(plan())).toContain("http://localhost:3000/auth/invite");
  });

  it("--check-connection é o modo somente leitura", () => {
    expect(plan([...baseArgs, "--check-connection"]).mode).toBe("check-connection");
  });

  it("valida e-mail e nome", () => {
    expect(plan(["--email", "invalido", "--name", "Admin"]).errors.join(" ")).toMatch(/e-mail válido/);
    expect(plan(["--email", "a@b.com", "--name", "A"]).errors.join(" ")).toMatch(/--name/);
  });

  it("a descrição do plano nunca contém a chave", () => {
    const text = describePlan(plan());
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("sss");
    expect(text).toContain("projeto-dev.supabase.co");
  });
});

describe("bootstrap-admin: execução como processo", () => {
  const script = join(process.cwd(), "scripts", "bootstrap-admin.mjs");
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...args], {
      env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });

  it("a simulação termina com sucesso SEM abrir conexão (o host nem existe) e sem imprimir a chave", () => {
    const r = run(baseArgs, { ...baseEnv, SUPABASE_URL: "https://host-que-nao-existe.invalid" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Simulação: nada foi enviado");
    expect(r.stdout + r.stderr).not.toContain(SECRET);
  });

  it("falha com erro claro e código 1 quando falta configuração", () => {
    const r = run(baseArgs, {});
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/SUPABASE_URL/);
  });

  it("não executa com chave pública, mesmo com --execute e --project-host corretos", () => {
    const r = run([...baseArgs, "--execute", "--project-host", "projeto-dev.supabase.co"], {
      ...baseEnv,
      SUPABASE_SECRET_KEY: PUBLISHABLE,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/PÚBLICA/);
  });
});

describe("check-env: executa sem rede e sem vazar chaves", () => {
  it("imprime o resumo e falha (código 1) com a chave secreta na variável pública", () => {
    const script = join(process.cwd(), "scripts", "check-env.mjs");
    let out = "";
    let status = 0;
    try {
      out = execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script], {
        env: { PATH: process.env.PATH ?? "", SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: SECRET } as unknown as NodeJS.ProcessEnv,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const e = error as { status: number; stdout: string; stderr: string };
      status = e.status;
      out = `${e.stdout}${e.stderr}`;
    }
    expect(status).toBe(1);
    expect(out).toMatch(/chave SECRETA/);
    expect(out).not.toContain(SECRET);
  });
});
