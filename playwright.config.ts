import { defineConfig, devices } from "@playwright/test";

/**
 * Dois servidores de produção (mesma build, ambientes diferentes):
 *  - 3100: modo demonstração (APROVA_DEMO_MODE=true), cobre os fluxos da Fase 1.
 *  - 3101: modo real, com um Supabase inalcançável de propósito. Prova a proteção de rotas,
 *          o falha-fechado e a resiliência do login sem depender de credenciais.
 * A build vem antes: `npm run test:e2e` executa `next build && playwright test`.
 */
// O Next carrega o .env.local sozinho (inclusive em `next start`). Para os testes serem herméticos,
// toda variável de ambiente relevante é definida explicitamente (em branco = ausente), e assim o
// arquivo local do desenvolvedor, com chaves reais, nunca vaza para os servidores de teste.
const CLEAN_ENV = {
  SUPABASE_URL: "",
  SUPABASE_PUBLISHABLE_KEY: "",
  SUPABASE_SECRET_KEY: "",
  SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  APP_URL: "",
  NEXT_PUBLIC_APP_URL: "",
  APROVA_DEMO_MODE: "",
};

const DEMO_PORT = 3100;
const REAL_PORT = 3101;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      testMatch: /fluxos\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${DEMO_PORT}` },
    },
    {
      name: "mobile",
      testMatch: /fluxos\.spec\.ts/,
      use: { ...devices["Pixel 7"], baseURL: `http://localhost:${DEMO_PORT}` },
    },
    {
      name: "auth-real",
      testMatch: /auth\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${REAL_PORT}` },
    },
  ],
  webServer: [
    {
      command: `npx next start -p ${DEMO_PORT}`,
      url: `http://localhost:${DEMO_PORT}/login`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { ...CLEAN_ENV, APROVA_DEMO_MODE: "true" },
    },
    {
      command: `npx next start -p ${REAL_PORT}`,
      url: `http://localhost:${REAL_PORT}/login`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        ...CLEAN_ENV,
        SUPABASE_URL: "http://127.0.0.1:59999",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "x".repeat(30),
        APP_URL: `http://localhost:${REAL_PORT}`,
      },
    },
  ],
});
