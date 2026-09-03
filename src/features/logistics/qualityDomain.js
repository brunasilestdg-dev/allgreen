// Qualidade da vertical: não conformidades com causa raiz, plano de ação, dono
// e prazo. O vocabulário fica num lugar só — a tela e o resumo leem daqui, e o
// worker valida contra os mesmos conjuntos — para "gravidade" ou "situação"
// nunca significarem coisas diferentes em pontos diferentes.

export const QUALIDADE_TIPOS = Object.freeze([
  { id: "sla", rotulo: "SLA não cumprido" },
  { id: "avaria", rotulo: "Avaria / dano" },
  { id: "atraso", rotulo: "Atraso" },
  { id: "documento", rotulo: "Documento / fiscal" },
  { id: "processo", rotulo: "Processo interno" },
  { id: "outro", rotulo: "Outro" },
]);

export const QUALIDADE_GRAVIDADES = Object.freeze([
  { id: "baixa", rotulo: "Baixa", peso: 1 },
  { id: "media", rotulo: "Média", peso: 2 },
  { id: "alta", rotulo: "Alta", peso: 3 },
  { id: "critica", rotulo: "Crítica", peso: 4 },
]);

export const QUALIDADE_SITUACOES = Object.freeze([
  { id: "aberta", rotulo: "Aberta", encerrada: false },
  { id: "em_acao", rotulo: "Em ação", encerrada: false },
  { id: "resolvida", rotulo: "Resolvida", encerrada: true },
  { id: "reincidente", rotulo: "Reincidente", encerrada: false },
]);

const idsValidos = (lista) => new Set(lista.map((item) => item.id));
const TIPOS = idsValidos(QUALIDADE_TIPOS);
const GRAVIDADES = idsValidos(QUALIDADE_GRAVIDADES);
const SITUACOES = idsValidos(QUALIDADE_SITUACOES);

export const rotuloTipoQualidade = (id) => QUALIDADE_TIPOS.find((t) => t.id === id)?.rotulo || id || "Não informado";
export const rotuloGravidade = (id) => QUALIDADE_GRAVIDADES.find((g) => g.id === id)?.rotulo || id || "Não informada";
export const rotuloSituacaoQualidade = (id) => QUALIDADE_SITUACOES.find((s) => s.id === id)?.rotulo || id || "Aberta";
export const situacaoEncerrada = (id) => QUALIDADE_SITUACOES.find((s) => s.id === id)?.encerrada === true;

// A validação é a mesma no front (antes de enviar) e no worker (antes de gravar).
// Sem título não há o que rastrear; tipo/gravidade/situação fora da lista viram
// o padrão em vez de gravar lixo que a tela não sabe exibir.
export const validarNaoConformidade = (corpo = {}) => {
  if (!String(corpo.titulo || corpo.title || "").trim())
    return "Descreva a não conformidade no título.";
  return "";
};

export const normalizarTipo = (id) => (TIPOS.has(id) ? id : "processo");
export const normalizarGravidade = (id) => (GRAVIDADES.has(id) ? id : "media");
export const normalizarSituacaoQualidade = (id) => (SITUACOES.has(id) ? id : "aberta");

const soData = (valor) => String(valor || "").slice(0, 10);

// Resumo da carteira de NCs: abertas, críticas abertas, atrasadas (com prazo já
// vencido e ainda não encerradas) e reincidentes. É o que a tela mostra no topo
// e o que Indicadores pode consolidar sem recalcular a regra.
export const resumoQualidade = (registros = [], agora = Date.now()) => {
  const hoje = soData(new Date(agora).toISOString());
  const abertas = registros.filter((r) => !situacaoEncerrada(r.situacao || r.status));
  return {
    total: registros.length,
    abertas: abertas.length,
    criticas: abertas.filter((r) => (r.gravidade || r.severity) === "critica").length,
    atrasadas: abertas.filter((r) => {
      const prazo = soData(r.prazo || r.dueDate);
      return Boolean(prazo) && prazo < hoje;
    }).length,
    reincidentes: registros.filter((r) => (r.situacao || r.status) === "reincidente").length,
    resolvidas: registros.filter((r) => situacaoEncerrada(r.situacao || r.status)).length,
  };
};
