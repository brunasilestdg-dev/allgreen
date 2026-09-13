import { expect, test } from "@playwright/test";
import { contaNova, criarConta, habilitarTodoGreen } from "./apoio.js";

// Navegação entre PORTAIS, no navegador de verdade.
//
// O que estes testes protegem: o app escolhe qual portal montar lendo a rota
// durante o render. Enquanto nada assinava a troca de rota, clicar em "Abrir
// Torre TMS" mudava o endereço e deixava a tela anterior montada — só o F5
// levava ao destino. Teste de unidade não pegava: o bug estava na costura
// entre pushState, o roteador do app e o portal.
test.describe("navegação entre ERP e Torre TMS", () => {
  test("a Torre abre pelo clique, volta ao ERP e sobrevive ao F5", async ({ page }) => {
    test.setTimeout(180_000);
    await criarConta(page, contaNova("tms-nav"));
    await habilitarTodoGreen(page, "owner");

    await page.goto("/todogreen/dashboard");
    await expect(page.locator("main.tdg")).toBeVisible();

    // 1. Pelo CLIQUE (era o caminho quebrado).
    await page.getByRole("button", { name: /Abrir Torre TMS/i }).click();
    await expect(page.locator(".tms-portal")).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe("/portal-tms");
    // E o ERP saiu de cena — antes ficava montado por baixo da URL nova.
    await expect(page.locator("main.tdg")).toHaveCount(0);

    // 2. De volta ao ERP: a Torre não pode ser beco sem saída.
    await page.getByRole("button", { name: /Voltar ao ERP/i }).click();
    await expect(page.locator("main.tdg")).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe("/todogreen");

    // 3. Pela URL direta, com recarga — o outro caminho que precisa funcionar.
    await page.goto("/portal-tms");
    await expect(page.locator(".tms-portal")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.locator(".tms-portal")).toBeVisible({ timeout: 30_000 });
  });

  test("navegar entre os módulos não produz a tela de erro", async ({ page }) => {
    test.setTimeout(240_000);
    await criarConta(page, contaNova("sem-erro"));
    await habilitarTodoGreen(page, "owner");

    // Ida e volta repetida entre as áreas mais pesadas (cada uma é um pedaço
    // carregado sob demanda) — é aqui que o "Algo deu errado" aparecia.
    for (const rota of [
      "/todogreen/dashboard", "/todogreen/clientes", "/todogreen/espaco?ferramenta=tarefas",
      "/todogreen/planner", "/todogreen/oportunidades", "/todogreen/dashboard",
      "/todogreen/clientes", "/todogreen/espaco?ferramenta=tarefas",
    ]) {
      await page.goto(rota);
      await expect(page.locator("main.tdg")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Algo deu errado")).toHaveCount(0);
      await expect(page.getByText("Esta tela não abriu")).toHaveCount(0);
    }
  });

  test("integrações do TMS têm ação de verdade, não só selo", async ({ page }) => {
    test.setTimeout(180_000);
    await criarConta(page, contaNova("tms-integr"));
    await habilitarTodoGreen(page, "owner");

    await page.goto("/portal-tms/integracoes");
    await expect(page.locator(".tms-portal")).toBeVisible({ timeout: 30_000 });
    const lista = page.locator(".tms-integration-list > div");
    await expect(lista).toHaveCount(4);
    // Nenhuma linha pode ser texto decorativo.
    for (let i = 0; i < 4; i += 1)
      await expect(lista.nth(i).getByRole("button")).toBeVisible();
    // E o estado é honesto num espaço recém-criado.
    await expect(page.getByText("Ainda não configurada").first()).toBeVisible();

    // SEFAZ leva à tela real do ERP (dono do cadastro fiscal), não a um campo solto.
    await page.getByRole("button", { name: /Configurar fiscal/i }).click();
    await expect(page.locator("main.tdg")).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe("/todogreen/fiscal");
  });
});
