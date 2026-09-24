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
    // A entrada do ERP é a tela limpa — a mesma que o teste de unidade
    // `src/loginToDoGreen.test.jsx` descreve: marca da To Do Green, "LOGIN
    // PRIVADO" e só e-mail e senha. O desenho antigo ("TRANSPORTADORA 100%
    // ELÉTRICA", "Ambiente corporativo To Do Green") não aparece desde a
    // entrada limpa; estas asserções pediam por ele e deixavam o gate crítico
    // vermelho sem nenhuma regressão.
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await expect(page.getByText("LOGIN PRIVADO")).toBeVisible();
    await expect(page.getByAltText("To Do Green")).toBeVisible();
    // O título vira "All Green" pelo observador do index.html; o que importa
    // aqui é que a aba nunca diga Seu Funcionário.
    await expect(page).not.toHaveTitle(/Seu Funcionário/);
    await expect(page.getByText("Tenha o funcionário que sua empresa precisa")).toHaveCount(0);
    await expect(page.getByAltText("Seu Funcionário")).toHaveCount(0);
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
