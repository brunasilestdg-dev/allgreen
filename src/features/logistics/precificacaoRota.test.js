import { describe, expect, it } from "vitest";
import { produtoDaRota, todoGreenRouteToPage } from "./LogisticsVertical.jsx";
import { LOGISTICS_PRODUCTS } from "./logisticsVerticalDomain.js";

// A precificação passou a ser dirigida pela ROTA: o produto vem de
// /todogreen/precificacao/<produto>, não de estado só do React. Isto é o que
// faz voltar, avançar, atualizar a página e compartilhar o link levarem ao
// mesmo produto — antes, quem fazia esse elo era um módulo imperativo com
// MutationObserver global e clique sintético, hoje removido por ser código
// morto (o React parou de renderizar o DOM que ele procurava).

describe("produto vem da rota", () => {
  it("extrai o produto do segmento de detalhe", () => {
    expect(produtoDaRota("/todogreen/precificacao/middle-mile")).toBe("middle-mile");
    expect(produtoDaRota("/todogreen/precificacao/last-mile")).toBe("last-mile");
  });

  it("aceita todos os produtos reais do catálogo", () => {
    for (const produto of LOGISTICS_PRODUCTS)
      expect(produtoDaRota(`/todogreen/precificacao/${produto.id}`)).toBe(produto.id);
  });

  it("preserva o produto quando há query string (ex.: oportunidade)", () => {
    expect(produtoDaRota("/todogreen/precificacao/dedicated?opportunity=op-1")).toBe("dedicated");
  });

  it("produto inventado na URL não passa — cai no padrão de quem chama", () => {
    // Devolver vazio deixa o painel escolher o padrão em vez de tentar
    // precificar um produto que não existe.
    expect(produtoDaRota("/todogreen/precificacao/foguete")).toBe("");
  });

  it("precificação sem produto no caminho devolve vazio", () => {
    expect(produtoDaRota("/todogreen/precificacao")).toBe("");
    expect(produtoDaRota("/todogreen/precificacao/")).toBe("");
  });

  it("outra seção nunca é confundida com produto", () => {
    expect(produtoDaRota("/todogreen/clientes")).toBe("");
    expect(produtoDaRota("/todogreen/dashboard")).toBe("");
    expect(produtoDaRota("")).toBe("");
  });

  it("a rota de precificação continua resolvendo para a página de precificação", () => {
    // O detalhe do produto não muda a página; só o produto dentro dela.
    expect(todoGreenRouteToPage("/todogreen/precificacao/middle-mile")).toBe("precificacao");
    expect(todoGreenRouteToPage("/todogreen/precificacao")).toBe("precificacao");
  });
});
