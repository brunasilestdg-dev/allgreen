import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./worker.js",
      miniflare: {
        compatibilityDate: "2026-07-14",
        d1Databases: ["DB"],
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            path.resolve("./migrations"),
          ),
          // Chave VAPID exclusiva de teste (não é usada em produção) — só
          // existe para exercitar o fluxo de Web Push nos testes.
          VAPID_PUBLIC_KEY:
            "BEa6RPkBtRlZB3zsc7CJpieeD8RLYLSjWQbfWX69nASq9GcrzQNRHwKgO3T2wYgq8GRi6baoREH4uVvGPxsZC9Y",
          VAPID_PRIVATE_KEY: "WnT6_QQd2c5yTC8ClemX9Djsgtc3Bvs8zgAToy4siGA",
          OUTBOX_TEST_DELIVERY: "mock",
          WHATSAPP_VERIFY_TOKEN: "verify-test-token",
          INBOUND_EMAIL_SECRET: "email-inbound-secret",
          // Nenhum teste depende de rede: os crons que saem para a internet
          // (ANEEL/ANP/ONS, PNCP/Compras.gov/GDELT, ANTT) ficam desligados no
          // handler `scheduled`. Os testes desses crons religam explicitamente
          // com `{ ...env, TDG_CRON_EXTERNAL_DISABLED: "" }` e rede injetada.
          TDG_CRON_EXTERNAL_DISABLED: "1",
        },
      },
    })),
  ],
  test: {
    include: ["test/**/*.worker.test.js"],
    setupFiles: ["./test/apply-migrations.js"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
