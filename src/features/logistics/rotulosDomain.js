// ===== O último recurso quando não existe rótulo =====
//
// Vinte e quatro telas da vertical resolviam rótulo assim:
//
//   {ROTULO_STATUS[item.status] || item.status}
//
// O `|| item.status` é a parte que vaza. Enquanto o dicionário conhece o
// valor, tudo bem; no dia em que a API devolve um status novo — e ela devolve,
// porque status nasce no banco e no worker, não na tela — o usuário lê
// `em_execucao`, `not_required`, `aguardando_cliente`, `in_transit`.
//
// A titular resumiu melhor do que qualquer descrição de bug: "temos linguagem
// de código no meio do negócio".
//
// Este módulo é a rede embaixo do dicionário, não o substituto dele. Rótulo
// bom continua sendo o que alguém escreveu à mão, com a palavra que a operação
// usa. O que muda é que a falta de rótulo passa a produzir texto em português
// em vez de identificador de programador.
//
// Camada pura: sem banco, sem rede, sem DOM.

// Códigos são escritos sem acento porque vivem em URL, JSON e coluna de banco.
// Traduzi-los de volta é o trabalho principal daqui — "em execucao" vira
// "Em execução", não "Em execucao", que seria trocar um defeito por outro.
const ACENTOS = Object.freeze({
  execucao: "execução", producao: "produção", operacao: "operação",
  aprovacao: "aprovação", devolucao: "devolução", ocorrencia: "ocorrência",
  conferencia: "conferência", referencia: "referência", manutencao: "manutenção",
  transmissao: "transmissão", emissao: "emissão", conclusao: "conclusão",
  revisao: "revisão", analise: "análise", previsao: "previsão",
  simulacao: "simulação", integracao: "integração", validacao: "validação",
  conciliacao: "conciliação", implantacao: "implantação", negociacao: "negociação",
  cancelamento: "cancelamento", credito: "crédito", debito: "débito",
  saida: "saída", entrada: "entrada", transferencia: "transferência",
  disponivel: "disponível", indisponivel: "indisponível", pendencia: "pendência",
  concluida: "concluída", concluido: "concluído", nao: "não",
  invalido: "inválido", invalida: "inválida", valido: "válido", valida: "válida",
  rascunho: "rascunho", ferias: "férias", salario: "salário",
  veiculo: "veículo", usuario: "usuário", proprio: "próprio",
  fisico: "físico", automatico: "automático", periodo: "período",
  minimo: "mínimo", maximo: "máximo", media: "média", numero: "número",
  codigo: "código", titulo: "título", multiplo: "múltiplo",
  necessaria: "necessária", necessario: "necessário", obrigatorio: "obrigatório",
  historico: "histórico", relatorio: "relatório", inicio: "início",
  situacao: "situação", posicao: "posição", vencimento: "vencimento",
});

// Palavras que o inglês deixou no caminho. Status de banco de dados costuma
// nascer em inglês mesmo em produto brasileiro, e o usuário não tem culpa.
const INGLES = Object.freeze({
  draft: "rascunho", pending: "pendente", active: "ativo", inactive: "inativo",
  ready: "pronto", sending: "enviando", sent: "enviado", failed: "falhou",
  issued: "emitido", cancelled: "cancelado", canceled: "cancelado",
  completed: "concluído", complete: "concluído", blocked: "bloqueado",
  checked: "conferido", eligible: "elegível", released: "liberado",
  paid: "pago", partial: "parcial", open: "aberto", closed: "fechado",
  approved: "aprovado", rejected: "recusado", revoked: "revogado",
  expired: "vencido", scheduled: "agendado", delivered: "entregue",
  progress: "andamento", transit: "trânsito", required: "obrigatório",
  started: "iniciado", running: "em curso", done: "concluído",
  archived: "arquivado", error: "erro", success: "sucesso", warning: "aviso",
  track: "meta", not: "não", in: "em", of: "de", on: "em",
});

// Rótulo de status é FRASE, não título: "Em execução", nunca "Em Execução".
// Título em caixa alta no meio da tabela é ruído — o olho lê "Em Trânsito" como
// nome próprio e para para conferir. Só a primeira palavra sobe.

const semAcento = (valor) => String(valor ?? "")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase();

const traduzirPalavra = (palavra) => {
  const chave = semAcento(palavra);
  if (INGLES[chave]) return INGLES[chave];
  if (ACENTOS[chave]) return ACENTOS[chave];
  return palavra.toLowerCase();
};

/**
 * Transforma um código em texto legível, para uso APENAS como último recurso.
 *
 * `em_execucao` → "Em execução" · `not_required` → "Não obrigatório"
 * `in_transit`  → "Em trânsito" · `aguardando_cliente` → "Aguardando cliente"
 *
 * Devolve string vazia para entrada vazia — quem chama decide o que mostrar no
 * lugar, porque "vazio" e "desconhecido" são coisas diferentes na tela.
 */
export const rotuloLegivel = (valor) => {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return "";

  // Já é frase escrita por gente: tem espaço ou acento. Não mexer.
  if (/\s/.test(bruto) || /[À-ÿ]/.test(bruto)) return bruto;

  const partes = bruto
    // separa camelCase antes de separar por _ e -
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\-.\s]+/)
    .filter(Boolean);

  // Sigla que a operação usa em caixa alta continua em caixa alta: CTE, MDFE,
  // POD, SLA, CIOT. Rebaixá-las para "Cte" seria piorar o que já estava certo.
  if (partes.length === 1 && /^[A-Z0-9]{2,6}$/.test(bruto)) return bruto;

  const frase = partes.map(traduzirPalavra).join(" ");
  return frase.charAt(0).toUpperCase() + frase.slice(1);
};

/**
 * O par que as telas usam: consulta o dicionário escrito à mão e, só quando
 * ele não conhece o valor, cai no texto derivado.
 *
 * Substitui o padrão `{MAPA[x] || x}`, que era onde o código vazava.
 */
export const comRotulo = (dicionario, valor, vazio = "—") => {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return vazio;
  return dicionario?.[bruto] || rotuloLegivel(bruto);
};
