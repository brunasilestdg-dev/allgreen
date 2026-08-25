import { expect, test } from "@playwright/test";
import { criarConta, habilitarTodoGreen } from "./apoio.js";

// ===== Nenhum texto da vertical pode ficar ilegível =====
//
// Isto nasceu de uma frase: "a cor do chat e da letra torna quase ilegível".
// A medição encontrou 93 textos abaixo do mínimo de contraste, espalhados por
// todas as telas — não era impressão, e não era um ponto só:
//
//   - o rótulo que abre quase toda seção (`.tdg-kicker`) era lima puro sobre
//     branco: 2:1, com 11px, em maiúsculas e espaçado;
//   - as siglas dos serviços (MM, LM, DED...) davam 1,8:1;
//   - `--tdg-muted`, usada por quase todo texto secundário do produto, ficava
//     em 4,3:1 sobre os próprios fundos claros da vertical.
//
// Contraste é a única parte de "está feio" que se mede em número em vez de
// discutir em reunião. Por isso virou teste: revisão de código não pega
// 4,3:1, e a próxima cor escolhida no olho volta a quebrar isto.
//
// O critério é o WCAG AA: 4,5:1 para texto normal, 3:1 para texto grande
// (>=24px, ou >=18,66px em negrito).

const TELAS = [
  ["Visão Geral", "/todogreen/dashboard"],
  ["Espaço", "/todogreen/espaco"],
  ["Oportunidades", "/todogreen/oportunidades"],
  ["Precificação", "/todogreen/precificacao"],
  ["Operação", "/todogreen/operacoes"],
  ["ESG", "/todogreen/central-esg"],
  ["Clientes", "/todogreen/clientes"],
  ["Relatórios", "/todogreen/relatorios"],
  ["Dashboards", "/todogreen/dashboards"],
  ["Frota", "/todogreen/frota"],
  ["Cadastros do ERP", "/todogreen/cadastros"],
  ["Estoque", "/todogreen/estoque"],
  ["Compras", "/todogreen/compras"],
  ["Implementação", "/todogreen/central-trabalho"],
  ["Acessos", "/todogreen/acessos"],
];

const AUDITAR = () => {
  const lum = (cor) => {
    const m = String(cor).match(/[\d.]+/g);
    if (!m) return null;
    const [r, g, b, a] = m.map(Number);
    if (a === 0) return null;
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  // Sobe até achar um fundo OPACO. Se no caminho houver um gradiente, a
  // medição é abandonada: `backgroundColor` não expõe a cor de um
  // `background-image`, e seguir subindo compararia o texto com um fundo que
  // não é o que aparece na tela. Foi assim que o botão da Semente (branco
  // sobre gradiente verde) apareceu como 1,1:1 numa primeira versão disto.
  const fundoOpaco = (el) => {
    let n = el;
    while (n) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== "none") return null;
      if (lum(s.backgroundColor) !== null) return s.backgroundColor;
      n = n.parentElement;
    }
    return "rgb(255, 255, 255)";
  };

  const raiz = document.querySelector("main.tdg");
  if (!raiz) return null;

  const ruins = [];
  raiz.querySelectorAll("*").forEach((el) => {
    // Só o texto do próprio elemento: herdado seria contado no filho também.
    const texto = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    if (!texto) return;

    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return;
    const caixa = el.getBoundingClientRect();
    if (caixa.width === 0 || caixa.height === 0) return;

    const fundo = fundoOpaco(el);
    if (fundo === null) return;
    const lFrente = lum(s.color);
    const lFundo = lum(fundo);
    if (lFrente === null || lFundo === null) return;

    const razao = (Math.max(lFrente, lFundo) + 0.05) / (Math.min(lFrente, lFundo) + 0.05);
    const px = parseFloat(s.fontSize);
    const grande = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
    const minimo = grande ? 3 : 4.5;

    if (razao < minimo)
      ruins.push(
        `${razao.toFixed(1)}:1 (mínimo ${minimo}) — ${s.color} sobre ${fundo} — "${texto.slice(0, 40)}"`,
      );
  });
  return ruins;
};

test.describe("legibilidade da vertical To Do Green", () => {
  test("nenhum texto fica abaixo do contraste mínimo em nenhuma tela", async ({ page }) => {
    test.setTimeout(180_000);
    await criarConta(page);
    await habilitarTodoGreen(page, "owner");

    const problemas = [];
    for (const [nome, rota] of TELAS) {
      await page.goto(rota);
      await page.waitForSelector("main.tdg", { timeout: 20_000 });
      // A vertical monta em etapas; medir antes de assentar mede o esqueleto.
      await page.waitForTimeout(600);

      const ruins = await page.evaluate(AUDITAR);
      expect(ruins, `${nome}: a vertical não montou`).not.toBeNull();
      for (const r of ruins) problemas.push(`[${nome}] ${r}`);
    }

    expect(problemas, "texto abaixo do contraste mínimo (WCAG AA)").toEqual([]);
  });
});
