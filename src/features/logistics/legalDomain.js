// Jurídico da vertical: minutas, contratos, aditivos e afins com risco,
// vigência, responsável e situação. Antes a área só tinha página de orientação
// apontando para Propostas e Documentos — não havia onde registrar e conduzir
// o próprio documento jurídico. O vocabulário fica num lugar só: a tela e o
// resumo leem daqui, e o worker valida contra os mesmos conjuntos, para "risco"
// e "situação" nunca significarem coisas diferentes em pontos diferentes.

export const JURIDICO_TIPOS = Object.freeze([
  { id: "contrato", rotulo: "Contrato" },
  { id: "aditivo", rotulo: "Aditivo" },
  { id: "minuta", rotulo: "Minuta" },
  { id: "nda", rotulo: "NDA / confidencialidade" },
  { id: "procuracao", rotulo: "Procuração" },
  { id: "notificacao", rotulo: "Notificação" },
  { id: "parecer", rotulo: "Parecer" },
  { id: "outro", rotulo: "Outro" },
]);

export const JURIDICO_RISCOS = Object.freeze([
  { id: "baixo", rotulo: "Baixo", peso: 1 },
  { id: "medio", rotulo: "Médio", peso: 2 },
  { id: "alto", rotulo: "Alto", peso: 3 },
]);

// Situação do documento. "encerrada" = não exige mais tratativa do Jurídico.
export const JURIDICO_SITUACOES = Object.freeze([
  { id: "rascunho", rotulo: "Rascunho", encerrada: false },
  { id: "em_analise", rotulo: "Em análise no Jurídico", encerrada: false },
  { id: "ajuste_solicitado", rotulo: "Ajustes solicitados", encerrada: false },
  { id: "aprovado", rotulo: "Aprovado, aguardando assinatura", encerrada: false },
  { id: "assinado", rotulo: "Assinado", encerrada: true },
  { id: "arquivado", rotulo: "Arquivado", encerrada: true },
  { id: "recusado", rotulo: "Recusado", encerrada: true },
]);

const idsValidos = (lista) => new Set(lista.map((item) => item.id));
const TIPOS = idsValidos(JURIDICO_TIPOS);
const RISCOS = idsValidos(JURIDICO_RISCOS);
const SITUACOES = idsValidos(JURIDICO_SITUACOES);

export const rotuloTipoJuridico = (id) => JURIDICO_TIPOS.find((t) => t.id === id)?.rotulo || id || "Não informado";
export const rotuloRisco = (id) => JURIDICO_RISCOS.find((r) => r.id === id)?.rotulo || id || "Não informado";
export const rotuloSituacaoJuridica = (id) => JURIDICO_SITUACOES.find((s) => s.id === id)?.rotulo || id || "Rascunho";
export const situacaoJuridicaEncerrada = (id) => JURIDICO_SITUACOES.find((s) => s.id === id)?.encerrada === true;

// A validação é a mesma no front (antes de enviar) e no worker (antes de gravar).
// Sem título não há o que rastrear; tipo/risco/situação fora da lista viram o
// padrão em vez de gravar lixo que a tela não sabe exibir.
export const validarDocumentoJuridico = (corpo = {}) => {
  if (!String(corpo.titulo || corpo.title || "").trim())
    return "Descreva o documento no título.";
  return "";
};

export const normalizarTipoJuridico = (id) => (TIPOS.has(id) ? id : "minuta");
export const normalizarRisco = (id) => (RISCOS.has(id) ? id : "medio");
export const normalizarSituacaoJuridica = (id) => (SITUACOES.has(id) ? id : "rascunho");

// ===== O vai-e-volta do Jurídico como máquina de estados =====
//
// Alguém envia o documento (arquivo ou solicitação redigida) → o Jurídico
// valida, reprova ou pede ajustes → volta ao solicitante, que reenvia →
// quantas vezes forem precisas, até concluir. Cada ação diz de quais situações
// parte, para qual leva e o que exige. `juridico: true` = só o Jurídico faz
// (validar/reprovar/pedir ajuste); as demais são do solicitante. A tela oferece
// só o que `acoesJuridicasDisponiveis` devolve, e o servidor valida de novo com
// `resolverAcaoJuridica` — nunca confia no botão que veio do cliente.
export const ACOES_JURIDICAS = Object.freeze({
  submeter: { de: ["rascunho", "ajuste_solicitado"], para: "em_analise", rotulo: "Enviar ao Jurídico", exigeConteudo: true },
  solicitar_ajuste: { de: ["em_analise"], para: "ajuste_solicitado", rotulo: "Solicitar ajustes", exigeMensagem: true, juridico: true },
  aprovar: { de: ["em_analise"], para: "aprovado", rotulo: "Validar / aprovar", juridico: true },
  reprovar: { de: ["em_analise"], para: "recusado", rotulo: "Reprovar", exigeMensagem: true, juridico: true },
  comentar: { de: ["rascunho", "em_analise", "ajuste_solicitado", "aprovado"], para: null, rotulo: "Comentar", exigeMensagem: true },
});

const KIND_POR_ACAO = { submeter: "submissao", solicitar_ajuste: "ajuste_solicitado", aprovar: "validado", reprovar: "reprovado", comentar: "comentario" };

export function acoesJuridicasDisponiveis(situacao, { juridico = false } = {}) {
  return Object.entries(ACOES_JURIDICAS)
    .filter(([, acao]) => acao.de.includes(situacao) && (!acao.juridico || juridico))
    .map(([id, acao]) => ({ id, rotulo: acao.rotulo, exigeMensagem: !!acao.exigeMensagem, exigeConteudo: !!acao.exigeConteudo, juridico: !!acao.juridico }));
}

// Resolve uma ação: valida permissão, transição e conteúdo, e devolve o próximo
// estado + o tipo de evento a gravar. `para: null` (comentar) mantém a situação.
export function resolverAcaoJuridica(situacao, acaoId, { juridico = false, temTexto = false, temAnexo = false } = {}) {
  const acao = ACOES_JURIDICAS[acaoId];
  if (!acao) return { ok: false, erro: "Ação jurídica desconhecida." };
  if (acao.juridico && !juridico) return { ok: false, erro: "Só o Jurídico pode validar, reprovar ou pedir ajuste." };
  if (!acao.de.includes(situacao)) return { ok: false, erro: `Ação indisponível na situação atual (${rotuloSituacaoJuridica(situacao)}).` };
  if (acao.exigeMensagem && !temTexto) return { ok: false, erro: "Escreva a mensagem desta ação." };
  if (acao.exigeConteudo && !temTexto && !temAnexo) return { ok: false, erro: "Envie o documento (arquivo/link) ou uma solicitação redigida." };
  const kind = acaoId === "submeter" && situacao === "ajuste_solicitado" ? "reenvio" : KIND_POR_ACAO[acaoId];
  return { ok: true, para: acao.para, kind };
}

const soData = (valor) => String(valor || "").slice(0, 10);

// Resumo da carteira jurídica: em análise, aguardando assinatura (aprovados que
// ainda não foram assinados), risco alto em aberto, vencidos (vigência já
// terminada e documento ainda não encerrado) e assinados. É o que a tela mostra
// no topo e o que outra área pode consolidar sem recalcular a regra.
export const resumoJuridico = (registros = [], agora = Date.now()) => {
  const hoje = soData(new Date(agora).toISOString());
  const abertos = registros.filter((r) => !situacaoJuridicaEncerrada(r.situacao || r.status));
  return {
    total: registros.length,
    emAnalise: registros.filter((r) => (r.situacao || r.status) === "em_analise").length,
    aguardandoAssinatura: registros.filter((r) => (r.situacao || r.status) === "aprovado").length,
    riscoAlto: abertos.filter((r) => (r.risco || r.risk) === "alto").length,
    vencidos: abertos.filter((r) => {
      const fim = soData(r.fimVigencia || r.effectiveEnd);
      return Boolean(fim) && fim < hoje;
    }).length,
    assinados: registros.filter((r) => (r.situacao || r.status) === "assinado").length,
  };
};
