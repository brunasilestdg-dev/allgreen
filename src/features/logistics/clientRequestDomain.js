// ===== Solicitações do cliente =====
// Camada pura.
//
// A IA do portal já mandava o cliente "abrir uma solicitação" e a aba dizia
// "em breve". Promessa sem porta é pior que ausência: o cliente tenta, não
// encontra, e conclui que o portal é fachada.
//
// Três decisões fazem esta caixa de entrada servir para operação de verdade:
//
// 1) Cada tipo de pedido exige os campos que o tornam respondível. Um pedido
//    de nova rota sem origem e destino não é um pedido — é uma ida e volta de
//    e-mail que ninguém contabiliza.
//
// 2) O estado muda por transição autorizada, não por escrita livre. Cliente
//    não fecha pedido como "concluído" e equipe não reabre como "aberto" para
//    zerar o relógio do SLA.
//
// 3) O prazo é do tipo do pedido e nasce com ele. Atraso é calculado, não
//    declarado — ninguém precisa lembrar de marcar.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const texto = (v) => String(v ?? "").trim();

// Cada tipo carrega o prazo que a operação assume e os campos sem os quais a
// equipe não consegue responder. O prazo em horas úteis vira data no momento
// da abertura e não muda depois — mudar a régua não pode reescrever a
// pontualidade do passado.
export const TIPOS_SOLICITACAO = {
  nova_rota: {
    id: "nova_rota",
    rotulo: "Nova rota",
    descricao: "Incluir um trecho que ainda não faz parte do contrato.",
    prazoHoras: 48,
    obrigatorios: ["origem", "destino"],
    camposRotulo: { origem: "Origem", destino: "Destino" },
  },
  aumento_volume: {
    id: "aumento_volume",
    rotulo: "Aumento de volume",
    descricao: "Elevar a frequência ou a carga de uma rota existente.",
    prazoHoras: 48,
    obrigatorios: ["referencia", "volumeDesejado"],
    camposRotulo: { referencia: "Rota ou operação", volumeDesejado: "Volume desejado" },
  },
  coleta_extra: {
    id: "coleta_extra",
    rotulo: "Coleta extra",
    descricao: "Uma retirada fora da programação combinada.",
    prazoHoras: 8,
    obrigatorios: ["origem", "dataDesejada"],
    camposRotulo: { origem: "Local da coleta", dataDesejada: "Data desejada" },
  },
  ocorrencia: {
    id: "ocorrencia",
    rotulo: "Ocorrência na entrega",
    descricao: "Avaria, atraso, extravio ou divergência em uma entrega.",
    prazoHoras: 4,
    obrigatorios: ["referencia"],
    camposRotulo: { referencia: "Referência da entrega" },
  },
  documento: {
    id: "documento",
    rotulo: "Documento ou comprovante",
    descricao: "Canhoto, nota, laudo ou evidência de uma operação.",
    prazoHoras: 24,
    obrigatorios: ["referencia"],
    camposRotulo: { referencia: "Referência da operação" },
  },
  relatorio_esg: {
    id: "relatorio_esg",
    rotulo: "Relatório ambiental",
    descricao: "Relatório de CO2 evitado e Green Score para um período.",
    prazoHoras: 72,
    obrigatorios: ["periodoInicio", "periodoFim"],
    camposRotulo: { periodoInicio: "Início do período", periodoFim: "Fim do período" },
  },
  outro: {
    id: "outro",
    rotulo: "Outro assunto",
    descricao: "Qualquer pedido que não se encaixe nos anteriores.",
    prazoHoras: 48,
    obrigatorios: [],
    camposRotulo: {},
  },

  // ---- Solicitações amarradas a UMA encomenda ----
  //
  // `escopo: "encomenda"` marca o pedido que só existe colado a uma operação
  // (o cliente abre a partir da entrega, não do nada). `quando` diz em que fase
  // da encomenda o pedido faz sentido: pedir devolução ou trocar o endereço de
  // algo JÁ entregue não é pedido, é engano; e acareação só cabe depois da
  // entrega. O portal nem oferece o tipo fora da fase — a regra mora aqui, uma
  // vez, e a tela e o servidor a consultam.
  devolucao: {
    id: "devolucao",
    rotulo: "Solicitação de devolução",
    descricao: "Devolver a mercadoria desta encomenda ao remetente.",
    prazoHoras: 24,
    obrigatorios: ["motivo"],
    camposRotulo: { motivo: "Motivo da devolução" },
    escopo: "encomenda",
    quando: "em_transito",
  },
  alteracao_endereco: {
    id: "alteracao_endereco",
    rotulo: "Solicitação de alteração de endereço",
    descricao: "Corrigir ou trocar o endereço de entrega antes da conclusão.",
    // Curto de propósito: endereço só muda enquanto a encomenda não saiu para a
    // última milha — cada hora conta.
    prazoHoras: 8,
    obrigatorios: ["novoEndereco"],
    camposRotulo: { novoEndereco: "Novo endereço de entrega" },
    escopo: "encomenda",
    quando: "em_transito",
  },
  acareacao: {
    id: "acareacao",
    rotulo: "Solicitação de acareação",
    descricao: "Contestar a entrega registrada e pedir apuração do ocorrido.",
    prazoHoras: 72,
    obrigatorios: ["motivo"],
    camposRotulo: { motivo: "Motivo da acareação" },
    escopo: "encomenda",
    quando: "entregue",
  },
};

export const TIPOS_LISTA = Object.values(TIPOS_SOLICITACAO);

// Os tipos que só existem colados a uma encomenda, filtrados pela fase dela.
// `entregue` decide: depois da entrega cabe acareação; antes, devolução e troca
// de endereço. Uma só fonte para o que a tela oferece e o que o servidor aceita.
export const tiposDaEncomenda = (entregue) =>
  TIPOS_LISTA.filter(
    (t) => t.escopo === "encomenda" && t.quando === (entregue ? "entregue" : "em_transito"),
  );

// O tipo pedido é válido PARA esta encomenda nesta fase? Recusa cedo o que a
// tela não deveria nem ter oferecido (cliente que forja o corpo da requisição).
export const tipoDaEncomendaPermitido = (tipo, entregue) =>
  tiposDaEncomenda(entregue).some((t) => t.id === tipoValido(tipo));

// Os tipos da caixa GERAL (não colados a uma encomenda). É o que a aba de
// atendimento oferece: pedir devolução "solta", sem uma entrega, não faz
// sentido — esse pedido nasce da tela da encomenda.
export const tiposGerais = () => TIPOS_LISTA.filter((t) => t.escopo !== "encomenda");

export const tipoValido = (valor) =>
  Object.prototype.hasOwnProperty.call(TIPOS_SOLICITACAO, valor) ? valor : "outro";

export const URGENCIAS = ["baixa", "normal", "alta"];
export const urgenciaValida = (valor) => (URGENCIAS.includes(valor) ? valor : "normal");

export const STATUS_SOLICITACAO = {
  aberta: { id: "aberta", rotulo: "Aberta", lado: "equipe", encerrado: false },
  em_analise: { id: "em_analise", rotulo: "Em análise", lado: "equipe", encerrado: false },
  aguardando_cliente: {
    id: "aguardando_cliente",
    rotulo: "Aguardando você",
    lado: "cliente",
    encerrado: false,
  },
  respondida: { id: "respondida", rotulo: "Respondida", lado: "cliente", encerrado: false },
  concluida: { id: "concluida", rotulo: "Concluída", lado: null, encerrado: true },
  recusada: { id: "recusada", rotulo: "Não atendida", lado: null, encerrado: true },
  cancelada: { id: "cancelada", rotulo: "Cancelada pelo cliente", lado: null, encerrado: true },
};

// A máquina de estados, por quem pode operar. Escrita livre de status é como
// SLA vira ficção: basta reabrir o pedido para o relógio zerar.
const TRANSICOES = {
  equipe: {
    aberta: ["em_analise", "aguardando_cliente", "respondida", "recusada"],
    em_analise: ["aguardando_cliente", "respondida", "concluida", "recusada"],
    aguardando_cliente: ["em_analise", "respondida", "recusada"],
    respondida: ["em_analise", "concluida", "recusada"],
    concluida: [],
    recusada: [],
    cancelada: [],
  },
  cliente: {
    // O cliente encerra o que ele abriu, e confirma o que foi respondido.
    // Não move o pedido para dentro do fluxo da equipe.
    aberta: ["cancelada"],
    em_analise: ["cancelada"],
    aguardando_cliente: ["cancelada"],
    respondida: ["concluida", "cancelada"],
    concluida: [],
    recusada: [],
    cancelada: [],
  },
};

export const transicaoPermitida = (lado, de, para) =>
  Boolean(TRANSICOES[lado]?.[de]?.includes(para));

export const statusValido = (valor) =>
  Object.prototype.hasOwnProperty.call(STATUS_SOLICITACAO, valor) ? valor : "aberta";

// ---- Validação da abertura ----
//
// Recusar cedo é o que evita a ida e volta. A mensagem diz o campo pelo nome
// que o cliente viu na tela, não pela chave do banco.
export const validarSolicitacao = (entrada = {}) => {
  const erros = [];
  const tipo = TIPOS_SOLICITACAO[tipoValido(entrada.tipo)];

  const assunto = texto(entrada.assunto);
  if (assunto.length < 4)
    erros.push("Escreva um assunto com pelo menos 4 caracteres.");
  if (assunto.length > 160) erros.push("O assunto deve ter no máximo 160 caracteres.");

  const descricao = texto(entrada.descricao);
  if (descricao.length < 10)
    erros.push("Descreva o pedido com pelo menos 10 caracteres para a equipe conseguir responder.");
  if (descricao.length > 4000)
    erros.push("A descrição deve ter no máximo 4000 caracteres.");

  const campos = entrada.campos && typeof entrada.campos === "object" ? entrada.campos : {};
  for (const chave of tipo.obrigatorios) {
    if (!texto(campos[chave]))
      erros.push(
        `${tipo.camposRotulo[chave] || chave} é obrigatório para uma solicitação de ${tipo.rotulo.toLowerCase()}.`,
      );
  }

  return {
    valido: erros.length === 0,
    erros,
    // Devolve já normalizado: quem chama não repete o saneamento e não há
    // duas versões da mesma regra.
    limpo: {
      tipo: tipo.id,
      assunto: assunto.slice(0, 160),
      descricao: descricao.slice(0, 4000),
      urgencia: urgenciaValida(entrada.urgencia),
      campos: Object.fromEntries(
        Object.entries(campos)
          .filter(([, valor]) => texto(valor))
          .map(([chave, valor]) => [texto(chave).slice(0, 40), texto(valor).slice(0, 300)]),
      ),
    },
  };
};

// ---- Prazo ----
//
// Nasce com o pedido. Urgência alta corta o prazo pela metade, urgência baixa
// não estica — dar mais prazo porque o cliente foi educado seria premiar a
// paciência com demora.
export const prazoDaSolicitacao = (tipo, urgencia, abertaEm) => {
  const definicao = TIPOS_SOLICITACAO[tipoValido(tipo)];
  const horas =
    urgenciaValida(urgencia) === "alta"
      ? Math.max(1, Math.round(definicao.prazoHoras / 2))
      : definicao.prazoHoras;
  const base = new Date(abertaEm || Date.now()).getTime();
  if (!Number.isFinite(base)) return null;
  return new Date(base + horas * 3600000).toISOString();
};

export const situacaoDoPrazo = (solicitacao = {}, agora = Date.now()) => {
  const status = statusValido(solicitacao.status);
  const definicao = STATUS_SOLICITACAO[status];
  if (definicao.encerrado) return { estado: "encerrado", horasRestantes: null, emAtraso: false };
  // Enquanto a bola está com o cliente, o relógio da equipe não corre. Cobrar
  // a equipe pela demora do cliente destrói a confiança no indicador.
  if (definicao.lado === "cliente" && status === "aguardando_cliente")
    return { estado: "com-o-cliente", horasRestantes: null, emAtraso: false };

  const limite = new Date(solicitacao.prazoEm || solicitacao.due_at || 0).getTime();
  if (!Number.isFinite(limite) || !limite)
    return { estado: "sem-prazo", horasRestantes: null, emAtraso: false };

  const horas = (limite - agora) / 3600000;
  return {
    estado: horas < 0 ? "atrasada" : horas <= 4 ? "vencendo" : "no-prazo",
    horasRestantes: Math.round(horas * 10) / 10,
    emAtraso: horas < 0,
  };
};

// ---- Aplicar uma transição ----
export const aplicarTransicao = (solicitacao = {}, { lado, para, autor } = {}) => {
  const de = statusValido(solicitacao.status);
  if (!transicaoPermitida(lado, de, para))
    return {
      ok: false,
      erro: `Não é possível mover de "${STATUS_SOLICITACAO[de].rotulo}" para "${
        STATUS_SOLICITACAO[statusValido(para)].rotulo
      }".`,
    };
  return {
    ok: true,
    status: para,
    // Guarda quem fechou e quando. Pedido encerrado sem responsável é pedido
    // que ninguém responde por.
    encerradoEm: STATUS_SOLICITACAO[para].encerrado ? new Date().toISOString() : null,
    encerradoPor: STATUS_SOLICITACAO[para].encerrado ? texto(autor) : "",
  };
};

// ---- Visão do cliente ----
//
// O cliente precisa saber de quem é a vez. "Em análise" e "aguardando você"
// são a mesma coisa para o sistema e opostas para quem espera.
export const resumoParaCliente = (solicitacoes = [], agora = Date.now()) => {
  const abertas = solicitacoes.filter((s) => !STATUS_SOLICITACAO[statusValido(s.status)].encerrado);
  const comigo = abertas.filter(
    (s) => STATUS_SOLICITACAO[statusValido(s.status)].lado === "cliente",
  );
  const atrasadas = abertas.filter((s) => situacaoDoPrazo(s, agora).emAtraso);
  return {
    abertas: abertas.length,
    aguardandoVoce: comigo.length,
    atrasadas: atrasadas.length,
    encerradas: solicitacoes.length - abertas.length,
    texto: abertas.length
      ? comigo.length
        ? `${comigo.length} solicitação(ões) esperando uma resposta sua.`
        : `${abertas.length} solicitação(ões) em andamento com a equipe To Do Green.`
      : "Nenhuma solicitação em aberto.",
  };
};

// ---- Fila da equipe ----
//
// Ordena pelo que dói: o que já estourou, depois o que estoura primeiro. Sem
// isso a fila fica por data de abertura e o pedido urgente de ontem espera
// atrás do pedido tranquilo de anteontem.
export const filaDaEquipe = (solicitacoes = [], agora = Date.now()) => {
  const pendentes = solicitacoes
    .map((s) => ({ ...s, prazo: situacaoDoPrazo(s, agora) }))
    .filter((s) => !STATUS_SOLICITACAO[statusValido(s.status)].encerrado)
    .filter((s) => STATUS_SOLICITACAO[statusValido(s.status)].lado === "equipe");

  const peso = { atrasada: 0, vencendo: 1, "no-prazo": 2, "sem-prazo": 3 };
  return pendentes.sort((a, b) => {
    const ordem = peso[a.prazo.estado] - peso[b.prazo.estado];
    if (ordem !== 0) return ordem;
    return num(a.prazo.horasRestantes) - num(b.prazo.horasRestantes);
  });
};

export const indicadoresDaEquipe = (solicitacoes = [], agora = Date.now()) => {
  const fila = filaDaEquipe(solicitacoes, agora);
  const encerradas = solicitacoes.filter(
    (s) => STATUS_SOLICITACAO[statusValido(s.status)].encerrado,
  );

  const instante = (valor) => {
    const t = new Date(valor || 0).getTime();
    return Number.isFinite(t) && t > 0 ? t : null;
  };
  // Só entra no cálculo o pedido que tem as duas datas. Sem data de
  // encerramento não se sabe se foi no prazo — e contar como atraso puniria a
  // equipe por um registro incompleto, não por uma demora real.
  const mensuraveis = encerradas
    .map((s) => ({ fim: instante(s.encerradoEm || s.closed_at), limite: instante(s.prazoEm || s.due_at) }))
    .filter((s) => s.fim && s.limite);
  const noPrazo = mensuraveis.filter((s) => s.fim <= s.limite);

  return {
    naFila: fila.length,
    atrasadas: fila.filter((s) => s.prazo.emAtraso).length,
    encerradas: encerradas.length,
    // Sem pedido encerrado medível, não existe pontualidade — devolver 100%
    // seria inventar um histórico que ninguém construiu.
    pontualidadePercent: mensuraveis.length
      ? Math.round((noPrazo.length / mensuraveis.length) * 100)
      : null,
    semDataDeEncerramento: encerradas.length - mensuraveis.length,
  };
};
