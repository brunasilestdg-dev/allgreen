import { expect, test } from "@playwright/test";
import { api, contaNova, criarConta, habilitarTodoGreen } from "./apoio.js";

// ===== E2E de acesso da vertical To Do Green =====
//
// Separado de `vertical.spec.js` de propósito: aquele arquivo cobre a
// vertical inteira (telas, formulários, cálculo) e é instável por um motivo
// já conhecido; este cobre só CONTROLE DE ACESSO — a parte que, se quebrar,
// não pode chegar a produção — com a menor superfície possível: poucos
// testes, sem preencher formulário de produto.
//
// ESTADO: promovido — `.fixme` removido, e o passo entrou em
// `.github/workflows/ci.yml`. Duas causas reais de instabilidade, as duas
// corrigidas:
//
// 1) `habilitarTodoGreen()` escrevia um negócio chamado "To Do Green" no
//    espaço de trabalho — a forma antiga de ganhar acesso à vertical, que o
//    worker não confere mais desde que o acesso passou a exigir e-mail
//    autorizado (`todogreen_access_emails`) ou `TODOGREEN_ADMIN_EMAILS`.
//    Uma conta de teste, com e-mail aleatório, nunca bateria com nenhum dos
//    dois — o segundo teste em diante falhava de verdade, não por timing.
//    Corrigido com um endpoint só-de-teste (`worker/services/test-support.js`,
//    trancado fora de produção) que faz o mesmo INSERT que a tela de
//    "acessos por e-mail" já faz, para o e-mail da própria sessão.
//
// 2) O sintoma que travava a suíte inteira nos 45s de `esperarEntrar`: o
//    limite geral de `/api/auth/*` (`ip ? 8 : 200` por minuto) achava que
//    tinha IP de borda de produção porque `wrangler dev` carimba
//    `cf-connecting-ip: 127.0.0.1` em toda requisição local — não deixa o
//    cabeçalho ausente, como a suíte de vitest-pool-workers simulava. Depois
//    de ~8 registros na sequência (poucos testes bastam), `/api/auth/register`
//    passava a devolver 429 e `criarConta` travava esperando uma tela que
//    nunca chegava. Corrigido em `edgeIp()` (worker/lib/http.js), que trata
//    loopback como "sem IP de borda" — Cloudflare nunca reporta 127.0.0.1
//    como IP de um cliente externo de verdade.
//
// Os quatro testes deste arquivo passam em sequência, inclusive dentro da
// suíte `e2e/` inteira. `vertical.spec.js` continua `fixme`: tem outra
// instabilidade, não relacionada a estas duas — ver o comentário lá.

const abas = (page) => page.getByRole("navigation", { name: /Navegação To Do Green/ });

test.describe("acesso à vertical To Do Green", () => {
  test("quem não tem o negócio no espaço não entra na vertical", async ({ page }) => {
    await criarConta(page, contaNova("sem-vertical"));

    const acesso = await api(page, "/api/todogreen/access");
    expect(acesso.status).toBe(403);

    await page.goto("/todogreen/dashboard");
    await expect(page.locator(".tdg-tabs")).toHaveCount(0);
  });

  test("com o negócio no espaço, a vertical abre com as abas", async ({ page }) => {
    await criarConta(page, contaNova("com-vertical"));
    await habilitarTodoGreen(page);

    await page.goto("/todogreen/dashboard");
    await expect(page.locator(".tdg-tabs")).toBeVisible();
    await expect(abas(page).getByRole("button").first()).toBeVisible();
  });

  test("a aba de Acessos não aparece para quem não gerencia acessos", async ({ page }) => {
    await criarConta(page, contaNova("acessos"));
    await habilitarTodoGreen(page);
    await page.goto("/todogreen/dashboard");
    await expect(page.locator(".tdg-tabs")).toBeVisible();

    const acesso = await api(page, "/api/todogreen/access");
    const papel = acesso.corpo?.role;
    const aba = abas(page).getByRole("button", { name: /Acessos$/ });
    // A visibilidade segue o papel do vínculo, não a presença da palavra
    // "admin" em algum canto da tela.
    if (["admin", "owner"].includes(papel)) await expect(aba).toBeVisible();
    else await expect(aba).toHaveCount(0);
  });

  test("trocar o parâmetro na URL não dá acesso ao espaço alheio", async ({ page, browser }) => {
    // Uma conta cria o próprio espaço.
    const outra = await browser.newContext();
    const paginaOutra = await outra.newPage();
    await criarConta(paginaOutra, contaNova("alvo"));
    await habilitarTodoGreen(paginaOutra);
    const idAlvo = (await api(paginaOutra, "/api/todogreen/access")).corpo?.ownerId;
    await outra.close();

    // A minha sessão tenta operar o espaço dela pela query string.
    await criarConta(page, contaNova("curioso"));
    await habilitarTodoGreen(page);

    if (idAlvo) {
      const r = await api(page, `/api/todogreen/pricing-parameters?owner=${idAlvo}`);
      // 404: não confirmamos a existência de um espaço que não é da conta.
      expect(r.status).toBe(404);
      expect(String(r.corpo?.error)).toMatch(/não pertence à sua conta/i);
    }
  });
});
