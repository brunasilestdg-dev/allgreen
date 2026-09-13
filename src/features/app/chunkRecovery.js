// Por que o "Algo deu errado" aparecia sem bug de tela nenhum
// ------------------------------------------------------------------
// O app é carregado em pedaços (cada área vem por `import()` sob demanda), e
// cada pedaço tem um hash no nome. Quando um deploy entra, os arquivos do build
// anterior deixam de existir no servidor. Uma aba que já estava aberta continua
// com o índice ANTIGO na memória: ao abrir uma área que ainda não tinha sido
// carregada, ela pede um arquivo que não existe mais, recebe 404, o `import()`
// falha e a tela inteira cai no aviso genérico.
//
// Não é um erro de estado, de dado nem de permissão: é a versão trocada debaixo
// da aba. A ÚNICA recuperação possível é carregar a versão nova — por isso aqui
// recarregar não é "esconder o problema", é a cura dele. O que não pode é virar
// laço: a trava por versão garante UMA tentativa por versão publicada. Se o erro
// voltar depois disso, ele é real e deve aparecer.
const PADRAO_VERSAO_TROCADA = new RegExp([
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
  "Unable to preload CSS",
  "ChunkLoadError",
  // Safari/Firefox quando o servidor devolve HTML no lugar do módulo que sumiu.
  "expected a JavaScript(?:-or-Wasm)? module script",
  "'text/html' is not a valid JavaScript MIME type",
].join("|"), "i");

export const ehErroDeVersaoTrocada = (erro) => {
  const texto = typeof erro === "string" ? erro : `${erro?.message || ""} ${erro?.name || ""}`;
  return PADRAO_VERSAO_TROCADA.test(texto);
};

export const chaveDeRecuperacao = (versao) => `sf-chunk-reload:${versao || "local"}`;

// Decide se esta falha merece uma recarga. Puro de propósito: quem chama é que
// mexe em sessionStorage e em location, e o teste consegue cobrir o laço.
export const deveRecarregarPorVersaoTrocada = ({ erro, jaTentouNestaVersao = false } = {}) =>
  ehErroDeVersaoTrocada(erro) && !jaTentouNestaVersao;
