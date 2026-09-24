import { expect, test } from "@playwright/test";
import { contaNova, criarConta, habilitarTodoGreen } from "./apoio.js";

const rotaDaJornada = async (page, rota) => {
  await page.goto(rota);
  await expect(page.locator("main.tdg")).toBeVisible();
  // Algumas telas (ex.: implantação) têm o título do shell + um título próprio
  // do componente lazy; a asserção quer só confirmar que a página carregou com
  // um título visível, então pega o primeiro (evita violação de strict mode
  // conforme a hora em que o chunk lazy monta o segundo h1).
  await expect(page.locator("main.tdg h1").first()).toBeVisible();
};

test.describe("jornadas críticas da To Do Green", () => {
  test("a entrada da vertical não apresenta Seu Funcionário", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/todogreen");
    // A entrada da vertical tem layout próprio (`tdg-auth-entry`): logo da To
    // Do Green e o cartão de login privado. O painel antigo com "TRANSPORTADORA
    // 100% ELÉTRICA" não é mais desenhado nesta rota — o teste procurava por ele
    // e falhava também na main.
    await expect(page.getByRole("region", { name: "Entre no ambiente To Do Green" })).toBeVisible();
    await expect(page.getByRole("img", { name: "To Do Green" })).toBeVisible();
    await expect(page.getByText("LOGIN PRIVADO")).toBeVisible();
    await expect(page.getByText("Tenha o funcionário que sua empresa precisa")).toHaveCount(0);
  });

  test("login e navegação percorrem a jornada comercial, operacional e de integrações", async ({ page }) => {
    test.setTimeout(180_000);
    await criarConta(page, contaNova("jornada"));
    await habilitarTodoGreen(page, "owner");

    for (const rota of [
      "/todogreen/dashboard",
      "/todogreen/clientes",
      "/todogreen/oportunidades",
      "/todogreen/precificacao",
      "/todogreen/propostas",
      "/todogreen/implantacao",
      "/todogreen/operacoes",
      "/todogreen/faturamento",
      "/todogreen/espaco",
      "/todogreen/integracoes",
    ]) await test.step(rota, () => rotaDaJornada(page, rota));

    // A URL legada é resolvida para a única tela dona do trabalho.
    await rotaDaJornada(page, "/todogreen/central-trabalho");
    await expect(page.getByRole("heading", { name: /Espaço de trabalho/i })).toBeVisible();

    // A URL antiga de rastreamento continua compatível, mas não expõe mais
    // a tela do fornecedor: cai na experiência própria de frota.
    await rotaDaJornada(page, "/todogreen/rastreamento");
    await expect(page.getByText("Integração com o TMS Tracker")).toHaveCount(0);
  });
});
