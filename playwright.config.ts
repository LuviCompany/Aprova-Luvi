import { defineConfig, devices } from "@playwright/test";

/**
 * Servidores de produção (mesma build, ambientes diferentes):
 *  - 3100: modo demonstração (APROVA_DEMO_MODE=true), cobre os fluxos da Fase 1.
 *  - 3101: modo real, com um Supabase inalcançável de propósito. Prova a proteção de rotas,
 *          o falha-fechado e a resiliência do login sem depender de credenciais.
 *  - 3102: modo real contra um servidor FALSO de Auth + PostgREST local (porta 59998), para
 *          exercitar as telas de clientes e projetos com sessão sem usar credenciais reais.
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
const CRUD_PORT = 3102; // modo real + servidor falso de Auth/PostgREST (e2e/support/mock-supabase.mjs)
const MOCK_PORT = 59998;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  // A primeira renderização de cada rota dinâmica leva de 5 a 10 s com vários workers nesta máquina.
  expect: { timeout: 10_000 },
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
    {
      // Estado compartilhado no servidor falso: um único projeto, testes em série.
      name: "crud-real",
      testMatch: /clientes-projetos\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${CRUD_PORT}` },
    },
    {
      // Mesmo servidor falso (estado compartilhado): roda DEPOIS do crud-real, nunca em paralelo com ele.
      name: "materiais-real",
      testMatch: /materiais.spec.ts/,
      dependencies: ["crud-real"],
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${CRUD_PORT}` },
    },
    {
      // Mesmo servidor falso: roda DEPOIS dos outros dois (estado compartilhado).
      name: "arquivos-real",
      testMatch: /arquivos.spec.ts/,
      dependencies: ["materiais-real"],
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${CRUD_PORT}` },
    },
  ],
  webServer: [
    {
      command: "node e2e/support/mock-supabase.mjs",
      url: `http://127.0.0.1:${MOCK_PORT}/__health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `npx next start -p ${CRUD_PORT}`,
      url: `http://localhost:${CRUD_PORT}/login`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        ...CLEAN_ENV,
        SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "x".repeat(30),
        APP_URL: `http://localhost:${CRUD_PORT}`,
      },
    },
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
