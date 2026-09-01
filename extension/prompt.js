// Núcleo puro da extensão: monta o prompt enviado à IA a partir do modo e do
// contexto da página. Sem dependências do navegador — testável em Node/vitest.
// popup.js importa esta função; o teste em src/extension-prompt.test.js valida.

const MAX = 6000;
const clip = (s) => String(s || "").replace(/\s+\n/g, "\n").trim().slice(0, MAX);

export function buildExtensionPrompt(mode, ctx = {}) {
  const url = String(ctx.url || "").trim();
  const title = String(ctx.title || "").trim();
  const selection = clip(ctx.selection);
  const pageText = clip(ctx.pageText);
  const question = String(ctx.question || "").trim();
  const target = selection || pageText;
  const source = [
    title ? `Título: ${title}` : "",
    url ? `URL: ${url}` : "",
    target ? `Conteúdo:\n${target}` : "",
  ].filter(Boolean).join("\n\n");
  const pageSource = [
    title ? `Título: ${title}` : "",
    url ? `URL: ${url}` : "",
    pageText ? `Conteúdo:\n${pageText}` : "",
  ].filter(Boolean).join("\n\n");

  switch (mode) {
    case "summary":
      return `Estou usando a extensão do navegador do ERP To Do Green. Resuma esta página para uso interno: diga o que importa para cliente, operação, contrato, compras, marketing, RFQ, risco ou tarefa. Não invente dado que não esteja no texto.\n\n${pageSource}`;
    case "translate":
      return `Detecte o idioma do texto abaixo e traduza para o português do Brasil, mantendo o sentido e o tom. Responda somente com a tradução.\n\n${target}`;
    case "task":
      return `Estou vendo esta página fora do ERP To Do Green. Se houver pendência real, proponha uma ação do tipo criar_tarefa para a Central de Implantação ou para a área responsável. Use título, descrição, prioridade e cliente quando aparecer no conteúdo. Se não houver tarefa clara, explique o que falta.\n\n${source}`;
    case "next-action":
      return `Estou vendo esta página fora do ERP To Do Green. Se ela trouxer sinal útil sobre um cliente da carteira, proponha definir_proxima_acao no CRM. Use o nome do cliente apenas se aparecer no conteúdo. Se não houver cliente claro, diga que precisa selecionar ou informar o cliente no ERP.\n\n${source}`;
    case "reply":
      return `Escreva uma resposta profissional e cordial, em português do Brasil, para a mensagem/e-mail abaixo, considerando que a resposta sai pela To Do Green. Seja objetivo, não prometa prazo, preço, SLA ou integração sem evidência.${
        question ? `\nInstrução adicional: ${question}` : ""
      }\n\nMensagem recebida:\n${target}`;
    case "explain":
      return `Explique de forma simples e clara, em português do Brasil, o trecho abaixo. Se houver termos difíceis, defina-os.\n\n${target}`;
    case "ask":
    default:
      return `${question || "Sobre o conteúdo abaixo:"}\n\nResponda como Plantû dentro do ERP To Do Green, em português do Brasil, usando apenas o conteúdo da página a seguir${
        url ? ` (${url})` : ""
      } — se a resposta não estiver nele, diga que não consta.\n\n${target}`;
  }
}

// Também exposto para ambientes CommonJS (não quebra a importação ESM acima).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildExtensionPrompt };
}
