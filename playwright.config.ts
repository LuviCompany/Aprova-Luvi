import { defineConfig, devices } from "@playwright/test";

/**
 * Dois servidores de produção (mesma build, ambientes diferentes):
 *  - 3100: modo demonstração (APROVA_DEMO_MODE=true), cobre os fluxos da Fase 1.
 *  - 3101: modo real, com um Supabase inalcançável de propósito. Prova a proteção de rotas,
 *          o falha-fechado e a resiliência do login sem depender de credenciais.
 * A build vem antes: `npm run test:e2e` executa `next build && playwright test`.
 */
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
      env: { APROVA_DEMO_MODE: "true" },
    },
    {
      command: `npx next start -p ${REAL_PORT}`,
      url: `http://localhost:${REAL_PORT}/login`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        SUPABASE_URL: "http://127.0.0.1:59999",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "x".repeat(30),
        APP_URL: `http://localhost:${REAL_PORT}`,
      },
    },
  ],
});
