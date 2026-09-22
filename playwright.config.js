import { defineConfig } from "@playwright/test";

// ===== Testes de ponta a ponta =====
//
// Os testes de unidade e de worker cobrem regra de negócio e isolamento. O que
// nenhum deles cobre é o caminho inteiro: navegador de verdade, sessão de
// verdade, worker de verdade e banco de verdade, na ordem em que a pessoa usa.
//
// É por isso que estes existem antes dos dois refactors grandes que vêm a
// seguir — ligar as entidades por ID e separar os arquivos monolíticos. Um
// refactor de 52 mil linhas sem esta rede é aposta.
//
// O servidor é o `wrangler dev`, não o `vite preview`: preview serve só o
// estático, e sem a API não existe login para testar.

const PORTA = Number(process.env.E2E_PORT || 8788);

export default defineConfig({
  testDir: "./e2e",
  // Os testes compartilham o mesmo banco local; rodar em paralelo faria um
  // apagar o estado do outro.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://localhost:${PORTA}`,
    // Rastro só do que falhou: guardar tudo enche o disco do runner.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Sem caminho fixo: num runner de CI o Playwright resolve o próprio
    // navegador depois do `playwright install`. Fixar o caminho de uma máquina
    // faria a suíte só rodar nela.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
      : {},
  },
  webServer: {
    // As migrações rodam antes de o servidor subir: o schema vem delas, não da
    // requisição, e o E2E precisa refletir essa regra.
    command: `npx wrangler d1 migrations apply allgreen-db --local && npx wrangler dev --local --port ${PORTA}`,
    url: `http://localhost:${PORTA}/api/status`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
