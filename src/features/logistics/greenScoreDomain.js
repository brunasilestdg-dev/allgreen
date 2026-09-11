// ===== Green Score =====
// Camada pura.
//
// Indicador proprietário da To Do Green. Nunca certificação — e o código
// devolve essa frase junto do número, porque quem recebe o relatório vai
// tratar como certificação se ninguém disser o contrário.
//
// Três decisões que fazem o indicador servir para contrato:
//
// 1) Peso tem versão. Mudar peso não recalcula o passado; cria versão nova, e
//    todo score guarda com qual versão nasceu. Sem isso, o histórico vira
//    ficção: o número de janeiro muda porque alguém mexeu num peso em julho.
//
// 2) O score sai com os componentes abertos. "78" não diz nada; "78, sendo
//    emissão 32 de 40 e ocupação 12 de 20" diz onde mexer.
//
// 3) A variação vem explicada. Quando cai, o cliente pergunta por quê — e a
//    resposta tem que estar pronta, não depender de analista.

export const PESOS_VERSAO_PADRAO = "v1.2026";

// Cada componente vale de 0 a 100 e entra no total pelo seu peso.
export const PESOS_PADRAO = {
  versao: PESOS_VERSAO_PADRAO,
  vigenciaInicio: "2026-01-01",
  responsavel: "Sustentabilidade To Do Green",
  metodologia:
    "Média ponderada de cinco componentes operacionais e ambientais, cada um normalizado de 0 a 100.",
  pesos: {
    reducaoEmissoes: 40,
    ocupacao: 20,
    eficienciaEnergetica: 15,
    qualidadeDados: 15,
    ocorrencias: 10,
  },
};

// Perfil de projeção: numa simulação de precificação (pré-venda) NÃO existe
// histórico de ocorrências — a operação ainda nem começou. Em vez de manter um
// segundo motor de Green Score, projeta-se pelo MESMO motor canônico com um
// conjunto de pesos que redistribui os 10 pontos de "ocorrências" nos quatro
// componentes que a projeção de fato conhece. Mesma definição, mesma versão de
// método, mesma ressalva — só o perfil de pesos muda, e ele soma 100.
export const PESOS_PROJECAO = {
  versao: PESOS_VERSAO_PADRAO,
  vigenciaInicio: "2026-01-01",
  responsavel: "Sustentabilidade To Do Green",
  metodologia:
    "Projeção pré-venda pelo motor canônico: quatro componentes conhecidos na simulação, com as ocorrências (ainda inexistentes) redistribuídas.",
  pesos: {
    reducaoEmissoes: 44,
    ocupacao: 22,
    eficienciaEnergetica: 17,
    qualidadeDados: 17,
  },
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const limitar = (v, min = 0, max = 100) => Math.min(max, Math.max(min, num(v)));
const arredondar = (v, casas = 1) => {
  const f = 10 ** casas;
  return Math.round(num(v) * f) / f;
};

export const validarPesos = (conjunto) => {
  const pesos = conjunto?.pesos;
  if (!pesos || typeof pesos !== "object")
    throw new Error("Conjunto de pesos inválido.");
  const soma = Object.values(pesos).reduce((a, b) => a + num(b), 0);
  // Sem esta trava, um conjunto somando 90 devolveria score que parece baixo
  // quando na verdade a régua é que estava curta.
  if (Math.round(soma) !== 100)
    throw new Error(`Os pesos devem somar 100. Somam ${arredondar(soma, 2)}.`);
  return true;
};

// Normalização de cada componente. Documentada porque é aqui que mora o
// julgamento — e julgamento escondido é o que torna indicador indefensável.
export const COMPONENTES = {
  reducaoEmissoes: {
    rotulo: "Redução de emissões",
    descricao: "Percentual de CO2e evitado sobre o cenário de referência.",
    normalizar: (e) => limitar(num(e.reducaoPercent)),
  },
  ocupacao: {
    rotulo: "Ocupação",
    descricao: "Aproveitamento da capacidade contratada; viagem vazia polui igual.",
    normalizar: (e) => limitar(num(e.ocupacaoPercent)),
  },
  eficienciaEnergetica: {
    rotulo: "Eficiência energética",
    descricao: "Participação de veículos de baixa emissão na operação.",
    normalizar: (e) => limitar(num(e.frotaLimpaPercent)),
  },
  qualidadeDados: {
    rotulo: "Qualidade dos dados",
    descricao:
      "Quanto do cálculo vem de medição em vez de estimativa. Entra no score porque número mal medido não pode valer o mesmo que número medido.",
    normalizar: (e) => limitar(num(e.qualidadeDados)),
  },
  ocorrencias: {
    rotulo: "Ocorrências",
    descricao: "Operações sem avaria, atraso ou reentrega, sobre o total.",
    normalizar: (e) => {
      const total = num(e.operacoes);
      if (total <= 0) return 0;
      const limpas = Math.max(0, total - num(e.ocorrencias));
      return limitar((limpas / total) * 100);
    },
  },
};

export const calcularGreenScore = (entradas = {}, conjunto = PESOS_PADRAO) => {
  validarPesos(conjunto);

  const componentes = {};
  let total = 0;

  for (const [chave, peso] of Object.entries(conjunto.pesos)) {
    const definicao = COMPONENTES[chave];
    if (!definicao)
      throw new Error(`Peso para componente desconhecido: ${chave}.`);
    const valor = definicao.normalizar(entradas);
    const contribuicao = (valor * num(peso)) / 100;
    total += contribuicao;
    componentes[chave] = {
      rotulo: definicao.rotulo,
      descricao: definicao.descricao,
      valor: arredondar(valor),
      peso: num(peso),
      contribuicao: arredondar(contribuicao),
      maximo: num(peso),
    };
  }

  return {
    score: arredondar(limitar(total)),
    versaoPesos: conjunto.versao,
    metodologia: conjunto.metodologia,
    responsavel: conjunto.responsavel,
    componentes,
    entradas: { ...entradas },
    calculadoEm: entradas.calculadoEm || new Date().toISOString(),
    ressalva:
      "Green Score é indicador proprietário da To Do Green, calculado com pesos versionados e memória aberta. Não é certificação ambiental nem verificação por terceira parte.",
  };
};

// A explicação da variação. É o que responde "por que caiu?" sem analista.
//
// Compara componente a componente e ordena pelo que mais mexeu no total — não
// pelo que mais mudou em si. Um componente que caiu 30 pontos mas pesa 10%
// importa menos que um que caiu 8 pontos e pesa 40%.
export const explicarVariacao = (atual, anterior) => {
  if (!anterior)
    return {
      variacao: 0,
      texto: "Primeiro cálculo deste escopo: não há período anterior para comparar.",
      fatores: [],
      trocaDeVersao: false,
    };

  const variacao = arredondar(num(atual.score) - num(anterior.score));
  const trocaDeVersao = atual.versaoPesos !== anterior.versaoPesos;

  const fatores = Object.entries(atual.componentes || {})
    .map(([chave, comp]) => {
      const antes = anterior.componentes?.[chave];
      if (!antes) return null;
      return {
        chave,
        rotulo: comp.rotulo,
        variacaoComponente: arredondar(num(comp.valor) - num(antes.valor)),
        efeitoNoScore: arredondar(num(comp.contribuicao) - num(antes.contribuicao)),
      };
    })
    .filter(Boolean)
    .filter((f) => Math.abs(f.efeitoNoScore) >= 0.1)
    .sort((a, b) => Math.abs(b.efeitoNoScore) - Math.abs(a.efeitoNoScore));

  const partes = [];
  if (trocaDeVersao)
    partes.push(
      `Atenção: os pesos mudaram de ${anterior.versaoPesos} para ${atual.versaoPesos}, então parte da variação vem da régua, não da operação.`,
    );

  if (variacao === 0 && !fatores.length) partes.push("O score não mudou.");
  else {
    partes.push(
      `O score ${variacao > 0 ? "subiu" : "caiu"} ${Math.abs(variacao)} ponto(s).`,
    );
    for (const fator of fatores.slice(0, 3)) {
      const direcao = fator.efeitoNoScore > 0 ? "puxou para cima" : "puxou para baixo";
      const de = arredondar(num(anterior.componentes[fator.chave].valor));
      const para = arredondar(num(atual.componentes[fator.chave].valor));
      partes.push(
        `${fator.rotulo} ${direcao} ${Math.abs(fator.efeitoNoScore)} ponto(s) (o componente foi de ${de} para ${para}).`,
      );
    }
  }

  return { variacao, texto: partes.join(" "), fatores, trocaDeVersao };
};

// Benchmark: onde este escopo está em relação aos outros do mesmo tenant.
// Devolve posição e mediana, nunca o nome de outro cliente.
export const compararComBase = (score, outrosScores = []) => {
  const valores = outrosScores.map(num).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!valores.length)
    return { posicao: null, total: 0, mediana: null, texto: "Ainda não há base para comparação." };
  const abaixo = valores.filter((v) => v < num(score)).length;
  const percentil = Math.round((abaixo / valores.length) * 100);
  const meio = Math.floor(valores.length / 2);
  const mediana =
    valores.length % 2 ? valores[meio] : (valores[meio - 1] + valores[meio]) / 2;
  return {
    posicao: percentil,
    total: valores.length,
    mediana: arredondar(mediana),
    texto: `Acima de ${percentil}% dos escopos comparáveis. Mediana da base: ${arredondar(mediana)}.`,
  };
};
