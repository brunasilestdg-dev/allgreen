// ===== Séries dos painéis =====
//
// Os painéis deixavam o usuário escolher "Barras", "Evolução", "Distribuição" e
// "Tabela", mas desenhavam sempre o mesmo número — porque não havia série, só um
// escalar. Aqui a série sai dos registros reais (financeiro, oportunidades,
// operações, propostas): receita por mês, pipeline por estágio, e assim por
// diante. Puro e testável; o desenho fica na tela.
//
// Cada indicador devolve o mesmo formato para a tela não precisar saber de onde
// veio o dado:
//   { valor, unidade, serie:[{rotulo,valor}], distribuicao:[{rotulo,valor}] }
// A `serie` é a leitura temporal (barras/evolução); a `distribuicao` é a
// categórica (rosca). Quando um indicador só tem uma das duas, a outra recebe a
// mesma lista — assim qualquer tipo de gráfico funciona para qualquer indicador,
// sem tela quebrada.

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const lista = (v) => (Array.isArray(v) ? v : []);
const mesCurto = (aaaaMm) => {
  const m = String(aaaaMm || "").slice(5, 7);
  return ({ "01": "jan", "02": "fev", "03": "mar", "04": "abr", "05": "mai", "06": "jun",
    "07": "jul", "08": "ago", "09": "set", "10": "out", "11": "nov", "12": "dez" }[m]) || (aaaaMm || "—");
};

// Soma um campo por mês (`mesReferencia`, AAAA-MM), devolvendo os últimos N meses
// em ordem cronológica. Mês vazio é ignorado — não vira uma barra "sem data".
const somarPorMes = (entradas, valorDe, { meses = 6 } = {}) => {
  const mapa = new Map();
  for (const item of lista(entradas)) {
    const mes = String(item?.mesReferencia || item?.competenciaEm || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) continue;
    mapa.set(mes, (mapa.get(mes) || 0) + n(valorDe(item)));
  }
  return [...mapa.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-meses)
    .map(([mes, valor]) => ({ rotulo: mesCurto(mes), valor: Math.round(valor * 100) / 100, chave: mes }));
};

// Conta (ou soma um valor) por categoria, da maior para a menor, com um teto de
// fatias — o excedente vira "Outros" para a rosca não virar confete.
const agruparPorCategoria = (entradas, categoriaDe, valorDe, { max = 6 } = {}) => {
  const mapa = new Map();
  for (const item of lista(entradas)) {
    const cat = String(categoriaDe(item) || "").trim() || "Sem classificação";
    mapa.set(cat, (mapa.get(cat) || 0) + (valorDe ? n(valorDe(item)) : 1));
  }
  const ordenado = [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  if (ordenado.length <= max) return ordenado.map(([rotulo, valor]) => ({ rotulo, valor }));
  const principais = ordenado.slice(0, max - 1);
  const resto = ordenado.slice(max - 1).reduce((s, [, v]) => s + v, 0);
  return [...principais.map(([rotulo, valor]) => ({ rotulo, valor })), { rotulo: "Outros", valor: resto }];
};

const financeiroPorTipo = (data, tipo) => lista(data.financial).filter((f) => f.tipo === tipo);

// Uma tabela de indicadores → como cada um vira série. O que não tem série
// própria (Green Score, ocupação, produtividade — são índices, não somas) cai no
// caso escalar, e a tela mostra número ou um único traço.
const EXTRATORES = {
  receita: (data) => ({
    unidade: "R$",
    serie: somarPorMes(financeiroPorTipo(data, "revenue"), (f) => f.valor),
  }),
  custo: (data) => ({
    unidade: "R$",
    serie: somarPorMes(financeiroPorTipo(data, "cost"), (f) => f.valor),
  }),
  margem: (data) => {
    const receita = somarPorMes(financeiroPorTipo(data, "revenue"), (f) => f.valor);
    const custoMapa = new Map(somarPorMes(financeiroPorTipo(data, "cost"), (f) => f.valor).map((m) => [m.chave, m.valor]));
    return {
      unidade: "R$",
      serie: receita.map((m) => ({ rotulo: m.rotulo, chave: m.chave, valor: Math.round((m.valor - (custoMapa.get(m.chave) || 0)) * 100) / 100 })),
    };
  },
  pipeline: (data) => ({
    // Contagem de oportunidades por estágio — a leitura sempre disponível. (O
    // valor estimado nem sempre está preenchido; contar nunca mente.)
    distribuicao: agruparPorCategoria(data.opportunities, (o) => o.estagio || o.stage),
  }),
  propostas: (data) => ({
    distribuicao: agruparPorCategoria(data.proposals, (p) => p.situacao || p.status),
  }),
  operacoes: (data) => ({
    serie: somarPorMes(data.operations, (o) => o.entregas || 1),
  }),
  clientes: (data) => {
    // Clientes distintos que aparecem no financeiro, por mês.
    const porMes = new Map();
    for (const f of lista(data.financial)) {
      const mes = String(f.mesReferencia || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(mes) || !f.clientId) continue;
      if (!porMes.has(mes)) porMes.set(mes, new Set());
      porMes.get(mes).add(f.clientId);
    }
    return {
      serie: [...porMes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-6)
        .map(([mes, set]) => ({ rotulo: mesCurto(mes), chave: mes, valor: set.size })),
    };
  },
};

export const UNIDADE_PADRAO = {
  receita: "R$", custo: "R$", margem: "%", "co2-evitado": "kg", "green-score": "", ocupacao: "%", produtividade: "%",
};

// O contrato único que a tela consome. Sempre devolve `valor` (do resumo), e
// preenche série/distribuição a partir dos registros quando o indicador tem uma
// leitura natural. Nunca lança: dado faltando vira lista vazia, e a tela mostra
// "sem dados ainda" em vez de quebrar.
export const serieDoIndicador = (metric, data = {}, valorEscalar = 0) => {
  const extrator = EXTRATORES[metric];
  const bruto = extrator ? extrator(data) : {};
  const serie = lista(bruto.serie);
  const distribuicao = lista(bruto.distribuicao);
  return {
    valor: n(valorEscalar),
    unidade: bruto.unidade ?? UNIDADE_PADRAO[metric] ?? "",
    // Qualquer tipo de gráfico funciona para qualquer indicador: se falta a
    // leitura pedida, cai na outra.
    serie: serie.length ? serie : distribuicao,
    distribuicao: distribuicao.length ? distribuicao : serie,
  };
};

// Máximo de uma lista de {valor}, com piso 1 para a barra nunca dividir por zero.
export const maiorValor = (itens) => Math.max(1, ...lista(itens).map((i) => Math.abs(n(i.valor))));

// Pontos de uma polilinha (0..100 em x e y, y invertido para SVG) a partir de
// uma série. Série vazia → lista vazia (a tela mostra o estado vazio).
export const pontosDaLinha = (serie, { largura = 100, altura = 100 } = {}) => {
  const itens = lista(serie);
  if (!itens.length) return [];
  const max = maiorValor(itens);
  const min = Math.min(0, ...itens.map((i) => n(i.valor)));
  const faixa = max - min || 1;
  const passo = itens.length > 1 ? largura / (itens.length - 1) : 0;
  return itens.map((item, i) => ({
    x: Math.round((itens.length > 1 ? i * passo : largura / 2) * 100) / 100,
    y: Math.round((altura - ((n(item.valor) - min) / faixa) * altura) * 100) / 100,
    valor: n(item.valor),
    rotulo: item.rotulo,
  }));
};

// Fatias de rosca em porcentagem acumulada (0..100), para o conic-gradient.
export const fatiasDaRosca = (distribuicao) => {
  const itens = lista(distribuicao).filter((i) => n(i.valor) > 0);
  const total = itens.reduce((s, i) => s + n(i.valor), 0);
  if (!total) return [];
  let acumulado = 0;
  return itens.map((item) => {
    const inicio = (acumulado / total) * 100;
    acumulado += n(item.valor);
    return {
      rotulo: item.rotulo,
      valor: n(item.valor),
      percentual: Math.round((n(item.valor) / total) * 1000) / 10,
      inicio: Math.round(inicio * 100) / 100,
      fim: Math.round((acumulado / total) * 100 * 100) / 100,
    };
  });
};
