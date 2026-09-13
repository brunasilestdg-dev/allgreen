// Apoio da regressão visual: tudo que torna o screenshot DETERMINÍSTICO.
//
// A suíte funcional já sabe criar conta e habilitar a vertical pela mesma API do
// produto (../apoio.js). Aqui só acrescentamos o que uma comparação pixel a
// pixel exige: relógio congelado, animações desligadas e uma conta de estado
// conhecido, para o mesmo teste tirar a mesma foto toda vez.

import { expect } from "@playwright/test";

export { contaNova, criarConta, entrar, habilitarTodoGreen, sair } from "../apoio.js";

// Um instante fixo para TODOS os screenshots. Sem isto, "hoje", "há 2 minutos" e
// saudações por período do dia mudam a cada execução e o diff acusa diferença
// onde não houve mudança de código.
export const INSTANTE_FIXO = new Date("2026-03-02T12:00:00-03:00");

// CSS que desliga movimento e o cursor piscando. O reducedMotion e o
// animations:"disabled" do toHaveScreenshot já ajudam, mas transições de CSS
// disparadas por estado (menu abrindo, hover) escapam — este é o cinto de
// segurança.
const CSS_SEM_MOVIMENTO = `
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
    scroll-behavior: auto !important;
    caret-color: transparent !important;
  }
`;

// Prepara a página ANTES de qualquer navegação: relógio fixo e estilo sem
// movimento injetados para valerem já no primeiro render.
export async function prepararDeterminismo(page) {
  await page.clock.install({ time: INSTANTE_FIXO });
  await page.addInitScript((css) => {
    const aplicar = () => {
      if (document.getElementById("vr-sem-movimento")) return;
      const tag = document.createElement("style");
      tag.id = "vr-sem-movimento";
      tag.textContent = css;
      document.head.appendChild(tag);
    };
    if (document.head) aplicar();
    else document.addEventListener("DOMContentLoaded", aplicar);
  }, CSS_SEM_MOVIMENTO);
}

// O tema da To Do Green é `:root[data-theme="dark"]`, alimentado por
// preferences.theme. O botão do cabeçalho é o caminho que o produto usa para
// alternar — clicá-lo persiste a preferência e o efeito do app mantém o dark.
export async function definirTema(page, tema) {
  const atual = await page.evaluate(() => document.documentElement.dataset.theme || "light");
  const alvo = tema === "dark" ? "dark" : "light";
  if (atual === alvo) return;
  const botao = page.locator(".tdg-shell-theme");
  if (await botao.count()) {
    await botao.first().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme || "light"))
      .toBe(alvo);
  }
}

// Deixa a tela pronta para a foto: aguarda o contêiner âncora, espera a fonte
// carregar e dá um respiro curto para o layout assentar (determinístico porque
// o relógio está congelado — o timeout vira nanoposição de layout, não tempo
// real percebido pelo app).
export async function estabilizar(page, ancora = "main.tdg") {
  await expect(page.locator(ancora)).toBeVisible();
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(200);
}
