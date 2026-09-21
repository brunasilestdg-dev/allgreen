import { defineConfig } from "@playwright/test";

// ===== Regressão visual (screenshot regression) =====
//
// Separada da suíte E2E funcional (`playwright.config.js`): aqui o objetivo não
// é "o fluxo funciona", é "a tela continua com a MESMA cara". Cada teste tira um
// screenshot e compara com um baseline versionado; qualquer mudança de layout,
// cor, espaçamento ou componente aparece no diff.
//
// Determinismo é regra (pedido da titular: "fixtures determinísticas, não gerar
// screenshots aleatórios"):
//   - conta de teste fixa (mesmo nome, mesmo estado) criada pela mesma API do
//     produto — ver e2e/visual/apoioVisual.js;
//   - relógio congelado (page.clock) para não haver "hoje"/"há 2 min" mudando;
//   - animações e transições desligadas (reducedMotion + CSS injetado + a opção
//     animations:"disabled" do toHaveScreenshot);
//   - locale pt-BR e fuso America/Sao_Paulo fixos, para data/número não variarem
//     com o ambiente.
//
// BASELINES: são gerados na IMAGEM DOCKER FIXA (mcr.microsoft.com/playwright),
// não na máquina de quem roda — fonte e render do Chromium mudam entre sistemas
// e fariam o diff acusar diferença onde não há. Ver docs/VISUAL_REGRESSION.md e
// scripts/visual-regression.sh. Por isso os baselines não são gerados aqui e sim
// com `npm run test:visual:docker:update`.
//
// NÃO depende do GitHub Actions (sem franquia): roda local ou no container.

const PORTA = Number(process.env.E2E_PORT || 8788);

export default defineConfig({
  testDir: "./e2e/visual",
  // Estado compartilhado no mesmo banco local: serial, como a suíte E2E.
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // Tolerância mínima para antialiasing entre execuções na MESMA imagem;
      // não serve para mascarar mudança real de layout.
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  reporter: process.env.CI ? "line" : "list",
  // Baselines agrupados por arquivo de spec; o nome do screenshot já carrega
  // tema/viewport (ver o spec), então não duplicamos por "project".
  snapshotPathTemplate: "e2e/visual/__baselines__/{testFileName}/{arg}{ext}",
  use: {
    baseURL: `http://localhost:${PORTA}`,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    reducedMotion: "reduce",
    colorScheme: "light",
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
      : {},
  },
  webServer: {
    command: `npx wrangler d1 migrations apply allgreen-db --local && npx wrangler dev --local --port ${PORTA}`,
    url: `http://localhost:${PORTA}/api/status`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
