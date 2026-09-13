import { expect, test } from "@playwright/test";
import {
  contaNova,
  criarConta,
  definirTema,
  estabilizar,
  habilitarTodoGreen,
  prepararDeterminismo,
  sair,
} from "./apoioVisual.js";

// Telas do ERP cobertas pela regressão visual (pedido da titular). Cada uma é
// uma rota navegável direta; Pré-flight e a ficha de Conta vivem DENTRO de
// fluxos (TMS/cliente) que exigem dado semeado e interação — ficam como próximo
// degrau, anotado em docs/VISUAL_REGRESSION.md.
//
// `mobile`: a tela entra também no viewport 390x844 (390 só onde faz sentido —
// painel e listas de uso em campo; não em telas densas de mesa).
// `tdg`: usa o shell da vertical (tem o botão de tema) — só essas entram no
// passo escuro.
const PAGINAS_ERP = [
  { nome: "dashboard", rota: "/todogreen/dashboard", ancora: "main.tdg", mobile: true, tdg: true },
  { nome: "clientes", rota: "/todogreen/clientes", ancora: "main.tdg", tdg: true },
  { nome: "oportunidades", rota: "/todogreen/oportunidades", ancora: "main.tdg", tdg: true },
  { nome: "viabilidade", rota: "/todogreen/aceite-viagens", ancora: "main.tdg", tdg: true },
  { nome: "precificacao", rota: "/todogreen/precificacao", ancora: "main.tdg", tdg: true },
  { nome: "propostas", rota: "/todogreen/propostas", ancora: "main.tdg", tdg: true },
  { nome: "operacoes", rota: "/todogreen/operacoes", ancora: "main.tdg", tdg: true },
  { nome: "roteirizacao", rota: "/todogreen/roteirizacao", ancora: "main.tdg", tdg: true },
  { nome: "frota", rota: "/todogreen/motorista-frota", ancora: "main.tdg", mobile: true, tdg: true },
  { nome: "energia", rota: "/todogreen/energia", ancora: "main.tdg", tdg: true },
  { nome: "to-do", rota: "/todogreen/espaco?ferramenta=tarefas", ancora: "main.tdg", mobile: true, tdg: true },
  { nome: "financeiro", rota: "/todogreen/faturamento", ancora: "main.tdg", tdg: true },
  { nome: "esg", rota: "/todogreen/central-esg", ancora: "main.tdg", tdg: true },
  // TMS é portal interno (mesma sessão — SSO): abre sem novo login. Shell
  // próprio, sem alternador de tema, então só claro + mobile.
  { nome: "tms", rota: "/portal-tms", ancora: "body", mobile: true, tdg: false },
];

const DESKTOP = { width: 1440, height: 960 };
const MOBILE = { width: 390, height: 844 };

// Regiões voláteis que não devem entrar na comparação (mesmo com conta fixa e
// relógio congelado): o e-mail único da conta no perfil e o assistente Semente,
// que monta conforme a página. Mascarar > baseline instável.
const mascaras = (page) => [page.locator(".tdg-semente"), page.locator(".tdg-profile")];

async function fotografar(page, nome, sufixo) {
  await expect(page).toHaveScreenshot(`${nome}__${sufixo}.png`, {
    mask: mascaras(page),
    fullPage: false,
  });
}

test.describe("regressão visual — To Do Green", () => {
  test("ERP em desktop (1440x960), tema claro", async ({ page }) => {
    await prepararDeterminismo(page);
    await page.setViewportSize(DESKTOP);
    await criarConta(page, contaNova("visual"));
    await habilitarTodoGreen(page, "owner");

    for (const tela of PAGINAS_ERP) {
      await test.step(tela.nome, async () => {
        await page.goto(tela.rota);
        await estabilizar(page, tela.ancora);
        await fotografar(page, tela.nome, "desktop-light");
      });
    }
  });

  test("ERP em desktop (1440x960), tema escuro", async ({ page }) => {
    await prepararDeterminismo(page);
    await page.setViewportSize(DESKTOP);
    await criarConta(page, contaNova("visual-dark"));
    await habilitarTodoGreen(page, "owner");
    await page.goto("/todogreen/dashboard");
    await estabilizar(page, "main.tdg");
    await definirTema(page, "dark");

    for (const tela of PAGINAS_ERP.filter((t) => t.tdg)) {
      await test.step(tela.nome, async () => {
        await page.goto(tela.rota);
        await estabilizar(page, tela.ancora);
        await definirTema(page, "dark");
        await fotografar(page, tela.nome, "desktop-dark");
      });
    }
  });

  test("ERP em mobile (390x844), onde se aplica", async ({ page }) => {
    await prepararDeterminismo(page);
    await page.setViewportSize(MOBILE);
    await criarConta(page, contaNova("visual-mobile"));
    await habilitarTodoGreen(page, "owner");

    for (const tela of PAGINAS_ERP.filter((t) => t.mobile)) {
      await test.step(tela.nome, async () => {
        await page.goto(tela.rota);
        await estabilizar(page, tela.ancora);
        await fotografar(page, tela.nome, "mobile");
      });
    }
  });

  // Portais externos: a ENTRADA (login) é pública e determinística (sem dado de
  // conta). O conteúdo autenticado do portal exige cliente/motorista semeado e
  // fica como próximo degrau (docs/VISUAL_REGRESSION.md).
  test("portais externos — tela de entrada", async ({ page }) => {
    await prepararDeterminismo(page);
    for (const { nome, rota } of [
      { nome: "portal-cliente", rota: "/portal-cliente" },
      { nome: "portal-motorista", rota: "/portal-motorista" },
    ]) {
      await test.step(`${nome} desktop`, async () => {
        await page.setViewportSize(DESKTOP);
        await page.goto(rota);
        await estabilizar(page, ".auth-shell");
        await fotografar(page, nome, "desktop-light");
      });
      await test.step(`${nome} mobile`, async () => {
        await page.setViewportSize(MOBILE);
        await page.goto(rota);
        await estabilizar(page, ".auth-shell");
        await fotografar(page, nome, "mobile");
      });
    }
    // Garante que o próximo teste (se reusar contexto) não herde sessão.
    await sair(page).catch(() => {});
  });
});
