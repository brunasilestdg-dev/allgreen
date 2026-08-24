// ===== Aprovação comercial =====
//
// Hoje a aprovação comercial é um aviso: a tela mostra "esta condição precisa de
// aprovação comercial" e a simulação é salva do mesmo jeito. Um alerta que não
// impede nada não é controle — é decoração. Quem quer o desconto lê o aviso,
// salva, e a proposta sai.
//
// O que falta para virar aprovação de verdade, e o que este módulo define:
//
//   pedido        alguém pede, com justificativa, e o pedido tem dono;
//   alçada        quanto maior o desvio e o valor, mais alto tem que ser quem
//                 decide — e ninguém decide acima da própria alçada;
//   prazo         pedido sem data de resposta apodrece na fila;
//   versões       a condição original e a revisada convivem, e a decisão
//                 aponta para a versão exata que foi decidida;
//   comentários   a conversa fica junto do pedido, não no WhatsApp;
//   histórico     imutável: eventos são acrescentados, nunca reescritos;
//   bloqueio      enquanto pende, a proposta daquela simulação não sai.
//
// Duas regras que valem explicação:
//
// 1) QUEM PEDE NÃO DECIDE. Mesmo que a pessoa tenha alçada de sobra, aprovar o
//    próprio pedido esvazia o controle inteiro. É a regra que mais tenta ser
//    contornada e a mais barata de manter.
//
// 2) DECISÃO É SOBRE UMA VERSÃO. Aprovar "o pedido" e depois deixar alguém
//    revisar a condição faria a aprovação valer para um número que o aprovador
//    nunca viu. Revisar reabre.

const num = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const texto = (valor, max = 2000) => String(valor ?? "").trim().slice(0, max);

export const SITUACOES = Object.freeze({
  pendente: "pendente",
  aprovado: "aprovado",
  recusado: "recusado",
  cancelado: "cancelado",
  expirado: "expirado",
});

export const SITUACOES_ENCERRADAS = Object.freeze([
  SITUACOES.aprovado,
  SITUACOES.recusado,
  SITUACOES.cancelado,
  SITUACOES.expirado,
]);

// A escada de alçada. O desvio é em pontos percentuais abaixo da margem mínima
// da régua — não em porcentagem do desconto, que é a confusão clássica: 2%
// abaixo de uma margem de 18% é um desvio de 2 pontos, não de 2% do preço.
export const ALCADAS = Object.freeze([
  {
    id: "gestao_comercial",
    nome: "Gestão comercial",
    papeis: ["lideranca_comercial", "admin", "owner"],
    desvioMaximoPontos: 3,
    valorMaximoContrato: 500000,
    prazoHoras: 24,
  },
  {
    id: "diretoria",
    nome: "Diretoria",
    papeis: ["admin", "owner"],
    desvioMaximoPontos: 8,
    valorMaximoContrato: 2000000,
    prazoHoras: 48,
  },
  {
    id: "conselho",
    nome: "Conselho",
    papeis: ["owner"],
    desvioMaximoPontos: Infinity,
    valorMaximoContrato: Infinity,
    prazoHoras: 72,
  },
]);

export const alcadaPorId = (id) => ALCADAS.find((item) => item.id === id) || null;

// Quanto a condição está abaixo do piso, em pontos percentuais. Acima do piso
// dá zero — margem boa não gera desvio negativo, gera desvio nenhum.
export const desvioEmPontos = (margemPercent, margemMinimaPercent) =>
  Math.max(0, num(margemMinimaPercent) - num(margemPercent));

export const alcadaNecessaria = ({
  margemPercent,
  margemMinimaPercent,
  valorContrato = 0,
} = {}) => {
  const desvio = desvioEmPontos(margemPercent, margemMinimaPercent);
  const valor = num(valorContrato);
  const escolhida =
    ALCADAS.find(
      (nivel) => desvio <= nivel.desvioMaximoPontos && valor <= nivel.valorMaximoContrato,
    ) || ALCADAS[ALCADAS.length - 1];
  return {
    ...escolhida,
    desvioPontos: Math.round(desvio * 100) / 100,
    // O motivo fica gravado no pedido: seis meses depois, "por que isso foi
    // para a diretoria?" precisa ter resposta sem reconstituir a conta.
    motivo:
      desvio > 0
        ? `Margem ${num(margemPercent).toFixed(1)}% está ${desvio.toFixed(1)} ponto(s) abaixo do piso de ${num(margemMinimaPercent).toFixed(1)}%.`
        : `Valor de contrato de ${valor.toFixed(2)} exige alçada de ${escolhida.nome}.`,
  };
};

// Quem pode decidir este pedido. Três perguntas, e todas precisam responder
// sim.
export const podeDecidir = (pedido, quem = {}) => {
  if (!pedido) return { pode: false, motivo: "Pedido inexistente." };
  if (pedido.situacao !== SITUACOES.pendente)
    return { pode: false, motivo: "Este pedido já foi encerrado." };
  // Quem pede não decide, por mais alçada que tenha.
  if (quem.userId && quem.userId === pedido.solicitanteId)
    return { pode: false, motivo: "Quem pede não decide o próprio pedido." };
  const nivel = alcadaPorId(pedido.alcadaId);
  if (!nivel) return { pode: false, motivo: "Alçada desconhecida." };

  // Duas perguntas separadas, e as duas precisam responder sim.
  //
  // A permissão diz se a pessoa participa da aprovação comercial. A alçada diz até onde
  // ela vai. Tratar `deal:approve` como se fosse alçada — que é a confusão
  // fácil — daria a qualquer aprovador o poder de liberar qualquer desvio, e a
  // escada inteira deixaria de existir.
  const concedidas = Array.isArray(quem.permissions) ? quem.permissions : [];
  const participa = concedidas.includes("*") || concedidas.includes("deal:approve");
  if (!participa)
    return { pode: false, motivo: "Você não tem permissão para decidir esta aprovação comercial." };

  const papel = texto(quem.role, 60);
  if (!nivel.papeis.includes(papel))
    return { pode: false, motivo: `Este pedido exige alçada de ${nivel.nome}.` };
  return { pode: true, motivo: "" };
};

export const prazoDoPedido = (alcadaId, aberturaEm) => {
  const nivel = alcadaPorId(alcadaId) || ALCADAS[0];
  const inicio = new Date(aberturaEm || Date.now()).getTime();
  const base = Number.isFinite(inicio) ? inicio : Date.now();
  return new Date(base + nivel.prazoHoras * 3600 * 1000).toISOString();
};

// Vencido é diferente de recusado. Um pedido que estourou o prazo não virou
// "não" — virou "ninguém olhou", e essa distinção é o que permite cobrar a
// fila em vez de culpar o vendedor.
export const estaVencido = (pedido, agora = Date.now()) => {
  if (!pedido || pedido.situacao !== SITUACOES.pendente) return false;
  const limite = new Date(pedido.prazoEm || 0).getTime();
  return Number.isFinite(limite) && limite > 0 && limite < new Date(agora).getTime();
};

export const situacaoVisivel = (pedido, agora = Date.now()) =>
  estaVencido(pedido, agora) ? SITUACOES.expirado : pedido?.situacao || SITUACOES.pendente;

// A proposta daquela simulação sai ou não sai.
//
// Sem pedido nenhum, sai — nem toda condição precisa de aprovação comercial. Com pedido
// pendente ou vencido, não sai. Com pedido recusado, não sai enquanto ninguém
// abrir e aprovar um novo. Aprovado, sai — e aponta para a versão aprovada.
export const liberacaoDaProposta = (cenarioId, pedidos = [], agora = Date.now()) => {
  const doCenario = pedidos
    .filter((p) => p && p.cenarioId === cenarioId)
    .sort((a, b) => new Date(b.criadoEm || 0) - new Date(a.criadoEm || 0));
  if (!doCenario.length) return { liberada: true, motivo: "", pedido: null };

  const ultimo = doCenario[0];
  const situacao = situacaoVisivel(ultimo, agora);

  if (situacao === SITUACOES.aprovado)
    return {
      liberada: true,
      motivo: `Aprovado por ${ultimo.decisorNome || ultimo.decisorId || "—"} na versão ${ultimo.versao}.`,
      pedido: ultimo,
    };
  if (situacao === SITUACOES.expirado)
    return {
      liberada: false,
      motivo: `A aprovação comercial venceu em ${ultimo.prazoEm} sem resposta. Cobre a decisão ou abra um novo pedido.`,
      pedido: ultimo,
    };
  if (situacao === SITUACOES.recusado)
    return {
      liberada: false,
      motivo: `Condição recusada na aprovação comercial: ${ultimo.decisaoJustificativa || "sem justificativa registrada"}. Revise a condição e abra um novo pedido.`,
      pedido: ultimo,
    };
  if (situacao === SITUACOES.cancelado)
    return {
      liberada: false,
      motivo: "O pedido de aprovação comercial foi cancelado. Abra um novo para seguir.",
      pedido: ultimo,
    };
  return {
    liberada: false,
    motivo: `Aguardando decisão comercial (${alcadaPorId(ultimo.alcadaId)?.nome || "alçada"}), prazo até ${ultimo.prazoEm}.`,
    pedido: ultimo,
  };
};

// Um pedido que sai da tela pronto para o servidor. Aqui é onde o desvio, a
// alçada e o prazo são derivados — não digitados por quem pede, que é como o
// controle vira autoatendimento.
export const montarPedido = ({
  cenarioId,
  resultado = {},
  regua = {},
  justificativa,
  solicitanteId,
  agora = new Date().toISOString(),
} = {}) => {
  const problemas = [];
  if (!texto(cenarioId)) problemas.push("A simulação precisa estar salva antes de pedir aprovação.");
  if (texto(justificativa).length < 20)
    problemas.push("Escreva a justificativa comercial com pelo menos 20 caracteres.");
  if (problemas.length) return { valido: false, problemas, pedido: null };

  const nivel = alcadaNecessaria({
    margemPercent: resultado.marginPercent,
    margemMinimaPercent: regua.minimumMarginPercent,
    valorContrato: resultado.recommendedPrice,
  });

  return {
    valido: true,
    problemas: [],
    pedido: {
      cenarioId: texto(cenarioId, 120),
      alcadaId: nivel.id,
      desvioPontos: nivel.desvioPontos,
      motivoDaAlcada: nivel.motivo,
      gatilhos: Array.isArray(resultado.approval?.triggers) ? resultado.approval.triggers : [],
      justificativa: texto(justificativa),
      solicitanteId: texto(solicitanteId, 120),
      situacao: SITUACOES.pendente,
      versao: 1,
      criadoEm: agora,
      prazoEm: prazoDoPedido(nivel.id, agora),
    },
  };
};

// Revisar não é editar: cria a versão seguinte, reabre o pedido e zera o prazo.
// Uma aprovação dada na versão 1 não pode continuar valendo para a versão 2 —
// seria aprovar um número que o aprovador nunca viu.
export const revisarPedido = (pedido, { resultado = {}, regua = {}, justificativa, agora = new Date().toISOString() } = {}) => {
  if (!pedido) return { valido: false, problemas: ["Pedido inexistente."], pedido: null };
  if (texto(justificativa).length < 20)
    return { valido: false, problemas: ["Explique o que mudou na condição revisada."], pedido: null };

  const nivel = alcadaNecessaria({
    margemPercent: resultado.marginPercent,
    margemMinimaPercent: regua.minimumMarginPercent,
    valorContrato: resultado.recommendedPrice,
  });
  return {
    valido: true,
    problemas: [],
    pedido: {
      ...pedido,
      alcadaId: nivel.id,
      desvioPontos: nivel.desvioPontos,
      motivoDaAlcada: nivel.motivo,
      justificativa: texto(justificativa),
      situacao: SITUACOES.pendente,
      versao: num(pedido.versao) + 1,
      // A decisão anterior sai do registro corrente e fica no histórico: manter
      // o nome do decisor num pedido reaberto faria a tela dizer que alguém
      // decidiu algo que ainda está pendente.
      decisorId: "",
      decisorNome: "",
      decisaoJustificativa: "",
      decididoEm: "",
      prazoEm: prazoDoPedido(nivel.id, agora),
      atualizadoEm: agora,
    },
  };
};

export const resumirFila = (pedidos = [], agora = Date.now()) => {
  const comSituacao = pedidos.map((p) => ({ ...p, situacaoVisivel: situacaoVisivel(p, agora) }));
  const pendentes = comSituacao.filter((p) => p.situacaoVisivel === SITUACOES.pendente);
  const vencidos = comSituacao.filter((p) => p.situacaoVisivel === SITUACOES.expirado);
  const decididos = comSituacao.filter((p) =>
    [SITUACOES.aprovado, SITUACOES.recusado].includes(p.situacaoVisivel),
  );
  const aprovados = decididos.filter((p) => p.situacaoVisivel === SITUACOES.aprovado);
  return {
    total: comSituacao.length,
    pendentes: pendentes.length,
    vencidos: vencidos.length,
    aprovados: aprovados.length,
    recusados: decididos.length - aprovados.length,
    // Sem decisão nenhuma, a taxa não existe — e zero por cento diria que tudo
    // foi recusado.
    taxaAprovacaoPercent: decididos.length
      ? Math.round((aprovados.length / decididos.length) * 1000) / 10
      : null,
    lista: comSituacao,
  };
};
