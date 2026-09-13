import { expect, test } from "@playwright/test";
import { contaNova, criarConta, habilitarTodoGreen } from "./apoio.js";

// ===== Regressão visual por screenshot (P1.4) =====
//
// `todogreen-visual.spec.js` mede estouro de layout; `legibilidade.spec.js`
// mede contraste. Nenhum dos dois pega "a tela ficou diferente": um token que
// muda de valor, um cartão que perde a borda, um espaçamento que dobra. Isto
// compara cada tela-chave com a imagem de referência versionada ao lado deste
// arquivo (`todogreen-screenshots.spec.js-snapshots/`).
//
// Regras para a comparação ser honesta e estável:
//   - conta nova a cada execução (dados vazios → sem números que mudam);
//   - animações desligadas, cursor escondido, viewport fixo;
//   - o que é inerentemente variável (relógios, versões, ids) fica mascarado;
//   - tolerância pequena (0,5% dos pixels) só para anti-aliasing de fonte.
// Para atualizar as referências depois de uma mudança visual INTENCIONAL:
//   npx playwright test e2e/todogreen-screenshots.spec.js --update-snapshots
// e revisar as imagens no PR como qualquer outra mudança.

const VIEWPORTS = [
  { nome: "desktop", width: 1440, height: 960 },
  { nome: "mobile", width: 390, height: 844 },
];

const TELAS = [
  ["dashboard", "/todogreen/dashboard"],
  ["oportunidades", "/todogreen/oportunidades"],
  ["roteirizacao", "/todogreen/roteirizacao"],
  ["energia", "/todogreen/energia"],
  ["saude-sistema", "/todogreen/saude-sistema"],
  ["inteligencia", "/todogreen/inteligencia"],
];

// Conteúdo legitimamente variável: horas/datas/versões/latências — e o mapa,
// cujos tiles vêm de servidor externo (carregam ou não conforme a rede do
// runner; a comparação é da INTERFACE, não do OpenStreetMap).
const MASCARAS = [
  "time",
  ".leaflet-container",
  "[data-visual-dinamico]",
  ".tdg-health-version",
  ".tdg-health-meta",
  ".tdg-health-checked",
  ".tdg-shell-clock",
];

test.describe("regressão visual das telas-chave", () => {
  test("cada tela bate com a imagem de referência", async ({ page }) => {
    test.setTimeout(300_000);
    await criarConta(page, contaNova("shot"));
    await habilitarTodoGreen(page, "owner");

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const [nome, rota] of TELAS) {
        await test.step(`${nome} @ ${viewport.nome}`, async () => {
          await page.goto(rota);
          await expect(page.locator("main.tdg")).toBeVisible();
          // Dá tempo para os carregamentos iniciais (fetches de records) assentarem.
          await page.waitForLoadState("domcontentloaded");
          await page.waitForTimeout(1200);
          await expect(page).toHaveScreenshot(`${nome}-${viewport.nome}.png`, {
            fullPage: true,
            animations: "disabled",
            caret: "hide",
            maxDiffPixelRatio: 0.005,
            mask: MASCARAS.map((seletor) => page.locator(seletor)),
          });
        });
      }
    }
  });
});
