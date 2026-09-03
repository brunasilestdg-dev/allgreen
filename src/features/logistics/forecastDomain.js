// ===== Forecast comercial =====
//
// A vertical tinha "forecast ponderado" como um número no painel: pipeline
// vezes probabilidade. Isso não é previsão, é uma média — e nenhum comitê
// comercial decide com ela, porque ela não separa o que ESTÁ FECHANDO do que
// PODE fechar.
//
// Previsão de verdade tem três linhas, e a distância entre elas é a
// informação:
//
//   Commit     o que o time se compromete a entregar. Estágio avançado E
//              probabilidade alta E data prevista dentro do período.
//   Ponderado  pipeline × probabilidade. A média estatística.
//   Best case  tudo que ainda pode fechar no período, no melhor cenário.
//
// Commit alto e best case perto dele é mês previsível. Commit baixo com best
// case enorme é mês de torcida. O número único escondia essa diferença.
//
// E a regra que atravessa tudo: o que não tem dado não entra na conta e é
// DITO. Oportunidade sem data prevista não vira previsão de fechamento de
// nenhum mês — ela vira alerta. Assumir que fecha no mês corrente é como o
// forecast infla sozinho.

const numero = (valor) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);
const texto = (valor) => String(valor ?? "").trim();
const arredondar = (valor) => Math.round(numero(valor) * 100) / 100;

export const ESTAGIOS_FECHADOS = Object.freeze(["fechada ganha", "fechada perdida", "ganho", "perdido"]);
export const ESTAGIOS_GANHOS = Object.freeze(["fechada ganha", "ganho"]);

// Estágio avançado: a partir daqui existe proposta na mesa. Antes disso o
// número é intenção, não previsão.
export const ESTAGIOS_DE_COMMIT = Object.freeze(["proposta", "negociação", "negociacao"]);

export const PROBABILIDADE_DE_COMMIT = 70;

const minusculo = (valor) => texto(valor).toLowerCase();
const fechada = (item) => ESTAGIOS_FECHADOS.includes(minusculo(item.estagio));
const ganha = (item) => ESTAGIOS_GANHOS.includes(minusculo(item.estagio));

const valorDa = (item) =>
  numero(item.valorContrato) || numero(item.valorMensal) * (numero(item.mesesContrato) || 12);

const mes = (valor) => (/^\d{4}-\d{2}/.test(texto(valor)) ? texto(valor).slice(0, 7) : "");
const dataDeFechamento = (item) =>
  item.dataPrevistaFechamento || item.expectedCloseAt || item.previsaoFechamento;

/**
 * O forecast do período.
 *
 * `periodo` é AAAA-MM. Sem período, considera tudo que está aberto — útil
 * para "pipeline total", inútil para "vou bater o mês", e a leitura diz isso.
 */
export function montarForecast({ oportunidades = [], meta = 0, periodo = "" } = {}) {
  const todas = (Array.isArray(oportunidades) ? oportunidades : []).filter(Boolean);
  const abertas = todas.filter((item) => !fechada(item));
  const doPeriodo = periodo
    ? abertas.filter((item) => mes(dataDeFechamento(item)) === periodo)
    : abertas;

  const semData = abertas.filter((item) => !mes(dataDeFechamento(item)));
  const semProbabilidade = doPeriodo.filter(
    (item) => item.probabilidade === null || item.probabilidade === undefined || item.probabilidade === "",
  );

  const pipeline = doPeriodo.reduce((soma, item) => soma + valorDa(item), 0);
  const ponderado = doPeriodo.reduce((soma, item) => soma + valorDa(item) * (numero(item.probabilidade) / 100), 0);

  const noCommit = doPeriodo.filter(
    (item) =>
      ESTAGIOS_DE_COMMIT.includes(minusculo(item.estagio)) &&
      numero(item.probabilidade) >= PROBABILIDADE_DE_COMMIT,
  );
  const commit = noCommit.reduce((soma, item) => soma + valorDa(item), 0);

  const ganho = todas
    .filter((item) => ganha(item) && (!periodo || mes(dataDeFechamento(item)) === periodo))
    .reduce((soma, item) => soma + valorDa(item), 0);

  const alvo = numero(meta);
  const previsto = ganho + commit;

  return {
    periodo: periodo || null,
    // Ganho já é dinheiro; o resto é previsão. Somar os dois num número só
    // esconde quanto do mês ainda depende de fechar alguma coisa.
    ganho: arredondar(ganho),
    commit: arredondar(commit),
    ponderado: arredondar(ponderado),
    bestCase: arredondar(ganho + pipeline),
    pipeline: arredondar(pipeline),
    meta: alvo || null,
    gap: alvo ? arredondar(Math.max(0, alvo - previsto)) : null,
    // Cobertura: quantas vezes o pipeline aberto cobre o que falta para a
    // meta. Abaixo de 3× o mês costuma não fechar, e é um alerta, não um
    // veredito — por isso vem o número, não um rótulo.
    cobertura: alvo && alvo > ganho ? arredondar(pipeline / (alvo - ganho)) : null,
    quantidade: doPeriodo.length,
    noCommit: noCommit.length,
    lacunas: {
      semDataPrevista: semData.length,
      semProbabilidade: semProbabilidade.length,
    },
    leitura: !todas.length
      ? "Nenhuma oportunidade registrada."
      : !doPeriodo.length
        ? periodo
          ? `Nenhuma oportunidade aberta com fechamento previsto para ${periodo}.`
          : "Nenhuma oportunidade aberta."
        : !alvo
          ? "Meta do período não informada — sem ela não dá para calcular gap nem cobertura."
          : previsto >= alvo
            ? `Commit e ganho já cobrem a meta de ${alvo}.`
            : `Faltam ${arredondar(alvo - previsto)} para a meta, com ${arredondar(pipeline)} em pipeline aberto.`,
  };
}

/**
 * Risco de concentração.
 *
 * Um forecast em que três negócios são metade do commit não é um forecast
 * confiável, é uma aposta. O número sozinho não mostra isso — a distribuição
 * mostra.
 */
export function riscoDeConcentracao({ oportunidades = [], limite = 50 } = {}) {
  const abertas = (Array.isArray(oportunidades) ? oportunidades : [])
    .filter((item) => item && !fechada(item))
    .map((item) => ({ nome: texto(item.cliente) || texto(item.titulo) || "sem nome", valor: valorDa(item) }))
    .filter((item) => item.valor > 0)
    .sort((a, b) => b.valor - a.valor);

  const total = abertas.reduce((soma, item) => soma + item.valor, 0);
  if (!total) return { concentrado: false, participacao: null, maiores: [], leitura: "Sem valor aberto para avaliar concentração." };

  const maiores = abertas.slice(0, 3);
  const participacao = arredondar((maiores.reduce((soma, item) => soma + item.valor, 0) / total) * 100);
  return {
    concentrado: participacao >= limite && abertas.length > 3,
    participacao,
    maiores: maiores.map((item) => ({ ...item, valor: arredondar(item.valor) })),
    leitura:
      abertas.length <= 3
        ? `Só ${abertas.length} oportunidade(s) aberta(s) — o forecast inteiro depende delas.`
        : participacao >= limite
          ? `${maiores.length} negócios são ${participacao}% do valor aberto: perder um muda o mês.`
          : `Os 3 maiores são ${participacao}% do valor aberto — distribuição saudável.`,
  };
}

/** O mesmo forecast recortado por uma dimensão: vendedor, produto, cliente, estágio. */
export function forecastPor(dimensao, { oportunidades = [], periodo = "" } = {}) {
  const grupos = new Map();
  for (const item of Array.isArray(oportunidades) ? oportunidades : []) {
    if (!item) continue;
    const chave = texto(item[dimensao]) || "Não informado";
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(item);
  }
  return [...grupos.entries()]
    .map(([chave, itens]) => ({ chave, ...montarForecast({ oportunidades: itens, periodo }) }))
    .sort((a, b) => b.commit - a.commit || b.pipeline - a.pipeline);
}

/**
 * O que trava o forecast: oportunidade sem data, sem probabilidade, sem
 * próximo passo, ou parada há tempo demais. Cada uma com o nome junto —
 * "12 oportunidades incompletas" não faz ninguém arrumar nenhuma.
 */
export function pendenciasDoForecast({ oportunidades = [], diasParados = 21, hoje = new Date().toISOString() } = {}) {
  const abertas = (Array.isArray(oportunidades) ? oportunidades : []).filter((item) => item && !fechada(item));
  const nome = (item) => texto(item.cliente) || texto(item.titulo) || "sem nome";
  const idade = (item) => {
    const marca = Date.parse(texto(item.atualizadoEm || item.updatedAt) || texto(item.criadoEm || item.createdAt) || "");
    return Number.isFinite(marca) ? Math.floor((Date.parse(hoje) - marca) / 86400000) : null;
  };

  const oid = (item) => item.id || item.opportunityId || "";
  return [
    { id: "sem-data", rotulo: "Sem data prevista de fechamento", itens: abertas.filter((item) => !mes(dataDeFechamento(item))) },
    { id: "sem-probabilidade", rotulo: "Sem probabilidade informada", itens: abertas.filter((item) => !numero(item.probabilidade)) },
    { id: "sem-proximo-passo", rotulo: "Sem próximo passo definido", itens: abertas.filter((item) => !texto(item.proximoPasso || item.nextStep)) },
    { id: "parada", rotulo: `Sem movimento há mais de ${diasParados} dias`, itens: abertas.filter((item) => { const dias = idade(item); return dias !== null && dias > diasParados; }) },
  ]
    .filter((item) => item.itens.length)
    // `ids` alimenta o clique no cartão (leva ao filtro exato dessas oportunidades);
    // `contas` continua sendo os até 6 nomes mostrados no cartão.
    .map((item) => ({ id: item.id, rotulo: item.rotulo, quantidade: item.itens.length, ids: item.itens.map(oid).filter(Boolean), contas: item.itens.map(nome).slice(0, 6), restantes: Math.max(0, item.itens.length - 6) }));
}
