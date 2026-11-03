import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // O pacote real lança erro fora do ambiente de servidor do React; nos testes é um no-op.
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // Janelas (Base UI) e Postgres em memória ficam mais lentos com a suíte inteira em paralelo.
    testTimeout: 20_000,
    // Cada arquivo de banco aplica as migrations (8 hoje) num Postgres em memória; com a suíte inteira em paralelo, 60 s não bastava.
    hookTimeout: 180_000,
  },
});
