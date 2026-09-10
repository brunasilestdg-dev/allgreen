// ===== Acompanhamento da operação =====
//
// A aba de operações do portal era uma tabela: referência, status, data,
// origem, destino. Sem busca, sem filtro, sem detalhe, sem linha do tempo, sem
// SLA previsto contra realizado, sem ocorrência, sem comprovante, sem
// rastreamento, sem previsão de chegada e sem paginação visível.
//
// As regras ficam aqui porque as duas pontas — o portal do cliente e a tela
// interna — precisam contar a mesma história sobre a mesma carga. Duas
// implementações da mesma pergunta produzem dois "atrasado" diferentes.

const instante = (valor) => {
  if (!valor) return null;
  const t = new Date(valor).getTime();
  return Number.isFinite(t) ? t : null;
};

const semAcento = (valor) =>
  String(valor ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export const SITUACOES_SLA = Object.freeze({
  semPrazo: "sem_prazo",
  emCurso: "em_curso",
  noPrazo: "no_prazo",
  atrasado: "atrasado",
  atrasadoEmCurso: "atrasado_em_curso",
});

export const ROTULO_SLA = Object.freeze({
  [SITUACOES_SLA.semPrazo]: "Sem prazo combinado",
  [SITUACOES_SLA.emCurso]: "Dentro do prazo, em andamento",
  [SITUACOES_SLA.noPrazo]: "Entregue no prazo",
  [SITUACOES_SLA.atrasado]: "Entregue com atraso",
  [SITUACOES_SLA.atrasadoEmCurso]: "Prazo estourado, ainda em andamento",
});

const HORA = 3600 * 1000;

// SLA são dois instantes, não um rótulo. Guardar só "atrasado" perde a conta e
// obriga a confiar em quem escreveu a palavra.
export const slaDaOperacao = (operacao = {}, agora = Date.now()) => {
  const prometido = instante(operacao.prometidoEm);
  const entregue = instante(operacao.entregueEm);
  const momento = instante(agora) ?? Date.now();

  if (!prometido)
    return {
      situacao: SITUACOES_SLA.semPrazo,
      rotulo: ROTULO_SLA[SITUACOES_SLA.semPrazo],
      atrasoHoras: null,
      cumprido: null,
    };

  if (entregue) {
    const atraso = (entregue - prometido) / HORA;
    const dentro = atraso <= 0;
    return {
      situacao: dentro ? SITUACOES_SLA.noPrazo : SITUACOES_SLA.atrasado,
      rotulo: ROTULO_SLA[dentro ? SITUACOES_SLA.noPrazo : SITUACOES_SLA.atrasado],
      atrasoHoras: Math.round(Math.max(0, atraso) * 10) / 10,
      cumprido: dentro,
    };
  }

  const estourou = momento > prometido;
  return {
    situacao: estourou ? SITUACOES_SLA.atrasadoEmCurso : SITUACOES_SLA.emCurso,
    rotulo: ROTULO_SLA[estourou ? SITUACOES_SLA.atrasadoEmCurso : SITUACOES_SLA.emCurso],
    atrasoHoras: estourou ? Math.round(((momento - prometido) / HORA) * 10) / 10 : 0,
    // Ainda em andamento: não dá para dizer que cumpriu nem que descumpriu.
    cumprido: null,
  };
};

// A previsão de chegada muda ao longo da viagem; o combinado não muda. Mostrar
// as duas juntas é o que permite ao cliente ver o problema chegando em vez de
// descobrir depois.
export const previsaoContraCombinado = (operacao = {}) => {
  const prometido = instante(operacao.prometidoEm);
  const previsto = instante(operacao.previsaoEm);
  if (!prometido || !previsto) return { comparavel: false, diferencaHoras: null, vaiAtrasar: null };
  const diferenca = (previsto - prometido) / HORA;
  return {
    comparavel: true,
    diferencaHoras: Math.round(diferenca * 10) / 10,
    vaiAtrasar: diferenca > 0,
  };
};

export const filtrarOperacoes = (operacoes = [], filtros = {}, agora = Date.now()) => {
  const busca = semAcento(filtros.busca).trim();
  const de = instante(filtros.de);
  // O fim do dia, e não a meia-noite: filtrar "até 07/08" tem que incluir o
  // dia 07 inteiro, senão o cliente jura que a entrega sumiu.
  const ate = instante(filtros.ate) === null ? null : instante(filtros.ate) + 24 * HORA - 1;
  const situacao = String(filtros.situacao || "").trim();

  return operacoes.filter((operacao) => {
    if (busca) {
      const alvo = semAcento(
        [operacao.referencia, operacao.origem, operacao.destino, operacao.placa, operacao.motorista]
          .filter(Boolean)
          .join(" "),
      );
      if (!alvo.includes(busca)) return false;
    }
    const data = instante(operacao.dataServico) ?? instante(operacao.prometidoEm);
    if (de !== null && (data === null || data < de)) return false;
    if (ate !== null && (data === null || data > ate)) return false;
    if (situacao && situacao !== "todas") {
      if (situacao === "com_ocorrencia") return Number(operacao.ocorrencias || 0) > 0;
      if (situacao === "atrasadas")
        return [SITUACOES_SLA.atrasado, SITUACOES_SLA.atrasadoEmCurso].includes(
          slaDaOperacao(operacao, agora).situacao,
        );
      if (situacao === "em_andamento") return !operacao.entregueEm;
      if (situacao === "entregues") return Boolean(operacao.entregueEm);
      return operacao.situacao === situacao;
    }
    return true;
  });
};

// Paginação com os números à vista. Uma lista que corta em vinte sem dizer
// quantos existem faz o cliente achar que o resto sumiu.
export const paginar = (lista = [], { pagina = 1, porPagina = 20 } = {}) => {
  const total = lista.length;
  const tamanho = Math.max(1, Number(porPagina) || 20);
  const paginas = Math.max(1, Math.ceil(total / tamanho));
  const atual = Math.min(Math.max(1, Number(pagina) || 1), paginas);
  const inicio = (atual - 1) * tamanho;
  return {
    itens: lista.slice(inicio, inicio + tamanho),
    pagina: atual,
    paginas,
    total,
    primeiro: total === 0 ? 0 : inicio + 1,
    ultimo: Math.min(inicio + tamanho, total),
  };
};

export const resumirOperacoes = (operacoes = [], agora = Date.now()) => {
  const comSla = operacoes.map((o) => ({ ...o, sla: slaDaOperacao(o, agora) }));
  const encerradas = comSla.filter((o) => o.sla.cumprido !== null);
  const noPrazo = encerradas.filter((o) => o.sla.cumprido).length;
  return {
    total: comSla.length,
    emAndamento: comSla.filter((o) => !o.entregueEm).length,
    atrasadas: comSla.filter((o) =>
      [SITUACOES_SLA.atrasado, SITUACOES_SLA.atrasadoEmCurso].includes(o.sla.situacao),
    ).length,
    comOcorrencia: comSla.filter((o) => Number(o.ocorrencias || 0) > 0).length,
    // Sem entrega concluída não existe percentual de pontualidade. Zero diria
    // que tudo atrasou.
    pontualidadePercent: encerradas.length
      ? Math.round((noPrazo / encerradas.length) * 1000) / 10
      : null,
    semPrazoCombinado: comSla.filter((o) => o.sla.situacao === SITUACOES_SLA.semPrazo).length,
    lista: comSla,
  };
};

export const TIPOS_DE_EVENTO = Object.freeze({
  coleta: "Coleta",
  transito: "Em trânsito",
  chegada: "Chegada",
  entrega: "Entrega",
  ocorrencia: "Ocorrência",
  reagendamento: "Reagendamento",
  documento: "Documento",
});

// ===== O contrato do evento de operação (base única) =====
//
// O que é um evento de operação e o que cada tipo dispara vivia copiado em três
// lugares: um `Set` embutido no app do motorista (worker), uma lista na projeção
// do TMS e os rótulos aqui. Três cópias divergem — e o caminho do TMS nem
// aplicava os efeitos, então o MESMO fato (uma "entrega") gerava estado
// diferente conforme a porta de entrada. Aqui fica a única definição: o
// vocabulário canônico e a regra de efeito. Todo caminho de escrita lê daqui.

// A ordem canônica dos tipos — a mesma do `kind` gravado no ledger.
export const TIPOS_EVENTO_VALIDOS = Object.freeze(Object.keys(TIPOS_DE_EVENTO));

// Coage qualquer tipo recebido ao conjunto canônico. Fora da lista vira
// "transito" (o default do ledger) em vez de gravar um `kind` que a linha do
// tempo não sabe desenhar. Nenhum caminho de escrita inventa tipo.
export const normalizarTipoEvento = (tipo) => {
  const t = String(tipo ?? "").trim().toLowerCase();
  return TIPOS_EVENTO_VALIDOS.includes(t) ? t : "transito";
};

// O contrato de efeito: dado um tipo, o que ele muda na operação. "entrega"
// fecha o ciclo (carimba a entrega e gera o comprovante que o faturamento
// exige); "ocorrência" conta um incidente. Uma verdade só, lida pelo app do
// motorista e pela projeção do TMS — para o efeito nunca depender da porta.
export const efeitosDoEvento = (tipo) => {
  const t = normalizarTipoEvento(tipo);
  return {
    tipo: t,
    concluiEntrega: t === "entrega",
    contaOcorrencia: t === "ocorrencia",
  };
};

// A linha do tempo é ordenada por quando ACONTECEU, não por quando foi
// registrada. Um evento lançado com atraso não pode reescrever a ordem da
// viagem.
export const ordenarLinhaDoTempo = (eventos = []) =>
  [...eventos].sort((a, b) => (instante(a.ocorridoEm) ?? 0) - (instante(b.ocorridoEm) ?? 0));

export const ocorrenciasDaLinha = (eventos = []) =>
  ordenarLinhaDoTempo(eventos).filter((evento) => evento.tipo === "ocorrencia");
