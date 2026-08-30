import { expect, test } from "@playwright/test";
import { contaNova, criarConta, entrar, esperarEntrar, sair } from "./apoio.js";

// O caminho de entrada, com navegador, worker e banco de verdade. Nenhum teste
// de unidade cobre isto: eles param no componente ou na função.

test.describe("entrar no produto", () => {
  test("cria a conta, entra e continua dentro depois de recarregar", async ({ page }) => {
    const conta = await criarConta(page, contaNova("login"));

    // Recarregar é onde a sessão prova que existe: se o token não persistir, a
    // pessoa volta para a tela de acesso a cada F5.
    await page.reload();
    await esperarEntrar(page);
    expect(await page.evaluate(() => localStorage.getItem("seu-funcionario-auth-token"))).toBeTruthy();
  });

  test("entra de novo com a mesma senha depois de sair", async ({ page }) => {
    const conta = await criarConta(page, contaNova("volta"));
    await sair(page);
    await expect(page.locator(".auth-shell")).toBeVisible();

    await entrar(page, conta);
    await expect(page.locator(".auth-shell")).toHaveCount(0);
  });

  test("senha errada não entra e diz o motivo", async ({ page }) => {
    const conta = await criarConta(page, contaNova("errada"));
    await sair(page);

    await page.getByRole("tab", { name: "Entrar" }).click();
    await page.getByLabel("E-mail", { exact: true }).fill(conta.email);
    await page.getByLabel(/^Senha/).fill("SenhaQueNaoE2026!");
    await page.getByRole("button", { name: /^Entrar$/ }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator(".auth-shell")).toBeVisible();
  });

  test("conta que não existe também não entra", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "Entrar" }).click();
    await page.getByLabel("E-mail", { exact: true }).fill("ninguem-aqui@exemplo.com.br");
    await page.getByLabel(/^Senha/).fill("SenhaForte2026!");
    await page.getByRole("button", { name: /^Entrar$/ }).click();

    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("o olho da senha mostra e esconde o que foi digitado", async ({ page }) => {
    await page.goto("/");
    const senha = page.getByLabel(/^Senha/);
    await senha.fill("MinhaSenha2026!");
    await expect(senha).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Mostrar senha" }).click();
    await expect(senha).toHaveAttribute("type", "text");

    await page.getByRole("button", { name: "Ocultar senha" }).click();
    await expect(senha).toHaveAttribute("type", "password");
  });

  test("sem sessão, a área interna não abre", async ({ page }) => {
    await page.goto("/todogreen/dashboard");
    // Sem token, o que aparece é a porta de entrada — não a vertical.
    await expect(page.locator(".auth-shell")).toBeVisible();
    await expect(page.locator(".tdg-nav-areas")).toHaveCount(0);
  });
});
