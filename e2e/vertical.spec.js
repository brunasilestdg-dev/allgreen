import { expect, test } from "@playwright/test";
import { contaNova, criarConta, habilitarTodoGreen } from "./apoio.js";

// A vertical inteira, do login à tela que calcula. É o caminho que os dois
// refactors seguintes — ligar entidades por ID e separar os arquivos
// monolíticos — mais têm chance de quebrar sem ninguém perceber.
//
// ESTADO: ativa. Ficou pendente por muito tempo porque a suíte era instável —
// e suíte que fica vermelha sem motivo ensina a ignorar vermelho, que é o pior
// estrago que uma rede de proteção pode causar. As duas causas foram
// encontradas e corrigidas. Ficam registradas porque as duas eram do
// FERRAMENTAL: nenhuma era defeito do produto.
//
//   1. `wrangler dev` carimba `cf-connecting-ip: 127.0.0.1` em toda requisição
//      local — não deixa o cabeçalho ausente, como a suíte de
//      vitest-pool-workers simulava. O limite de tentativas de `/api/auth/*`
//      lia esse loopback como IP de borda de produção e cortava em 8 por
//      minuto. Resolvido em `edgeIp()` (worker/lib/http.js).
//
//   2. `sair()` (apoio.js) limpava o `localStorage` inteiro, e junto ia a
//      preferência de modo: o app passava a abrir o onboarding em vez da tela
//      de acesso, e o teste esperava 45 segundos por um `.auth-shell` que não
//      viria. Apagar só a sessão também não bastava — uma sincronização em voo
//      REGRAVAVA o usuário ativo depois da limpeza, e a aba recarregava já
//      logada. Era essa corrida que fazia a falha ir e vir.
//
// Com as duas resolvidas, `e2e/` inteiro passa de ponta a ponta de forma
// repetida. Se voltar a piscar, investigue com
// `npx playwright test e2e/vertical.spec.js --grep <nome>` — e prefira achar a
// causa a marcar como pendente de novo.
//
// Os testes de CONTROLE DE ACESSO ficam em `vertical-acesso.spec.js`: poucos,
// sem formulário de produto, e sempre foram gate de publicação. Regra de
// isolamento quebrada não podia esperar o resto da suíte ficar estável.

test.describe("vertical To Do Green", () => {
  test("nenhuma área do menu aparece com rótulo quebrado", async ({ page }) => {
    await criarConta(page, contaNova("abas"));
    await habilitarTodoGreen(page);
    await page.goto("/todogreen/dashboard");
    await expect(page.locator(".tdg-nav-areas")).toBeVisible();

    // O menu virou um acordeão de áreas; o rótulo visível de cada área é o
    // botão da cabeça (a seta de abrir/recolher não carrega texto).
    const rotulos = await page
      .locator(".tdg-nav-areas .tdg-nav-area-cabeca > button:not(.tdg-nav-area-seta)")
      .allInnerTexts();
    expect(rotulos.length).toBeGreaterThan(5);
    // Era exatamente isto que aparecia: "ESG,", "Receita,", "Custos,".
    for (const rotulo of rotulos) {
      expect(rotulo.trim()).not.toMatch(/[,;:.]$/);
      expect(rotulo.trim()).not.toBe("");
    }
    // E nenhum nome repetido, que faria duas áreas parecerem funções diferentes.
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });

  test("a tela de custo e margem calcula e recomenda de ponta a ponta", async ({ page }) => {
    await criarConta(page, contaNova("margem"));
    await habilitarTodoGreen(page);
    await page.goto("/todogreen/custos");

    await expect(page.getByRole("heading", { name: "Aceito esta viagem?" })).toBeVisible();
    // Sem custo, não arrisca recomendação.
    await expect(page.getByText("Faltam dados")).toBeVisible();

    await page.getByLabel("Frete oferecido por viagem (R$)").fill("2200");
    await page.getByLabel("Km com carga (ida)").fill("400");
    await page.getByLabel("Valor de Combustível ou energia").fill("1.8");
    await page.getByLabel("Valor de Motorista").fill("320");

    await expect(page.getByText("Aceitar", { exact: true })).toBeVisible();
    await expect(page.getByText("Como a margem foi calculada")).toBeVisible();
  });

  test("a tela de oportunidades abre e aceita um registro", async ({ page }) => {
    await criarConta(page, contaNova("oportunidade"));
    await habilitarTodoGreen(page);
    await page.goto("/todogreen/oportunidades");

    await expect(page.getByRole("heading", { name: "Oportunidades" })).toBeVisible();
    await expect(page.getByText(/Nenhuma oportunidade registrada ainda/)).toBeVisible();

    await page.getByLabel("Cliente", { exact: true }).fill("Distribuidora E2E");
    await page.getByLabel("Km com carga (ida)").or(page.getByLabel("Distância por viagem (km)")).first().fill("120");
    await page.getByLabel("Viagens por mês").fill("20");
    await page.getByLabel("Valor mensal (R$)").fill("10000");
    await page.getByRole("button", { name: /Registrar oportunidade/ }).click();

    await expect(page.getByText("Distribuidora E2E")).toBeVisible();
  });
});
