// ===== O desenho da conta, antes da implantação =====
//
// A tela de implantação tinha doze verificações técnicas — contrato assinado,
// tabela de preço vinculada, portal habilitado, tracking disponível. Todas
// respondem à mesma pergunta: **o sistema está configurado?**
//
// A pergunta que o chefe da titular faz é outra: **esta conta foi desenhada?**
// Quantas cidades, quantas bases, quantos motoristas por dia, qual o modelo
// operacional, quantas pessoas em cada etapa e se são dedicadas, qual a régua
// de SLA ou de BSC, como o sistema conversa (bipagem, etiqueta, roteirização,
// de/para de status, insucesso), como fatura (CT-e ou NF-e, prazo, CONEMB),
// quem atende ocorrência, qual o ticket médio e a margem.
//
// São dois documentos diferentes ocupando o mesmo lugar. Este módulo é o
// segundo. Ele não substitui o gate técnico — os dois convivem, e é de
// propósito: dá para ter a conta perfeitamente desenhada e o contrato ainda
// não assinado, e o contrário também.
//
// Duas decisões que sustentam o resto:
//
// 1) NADA AQUI BLOQUEIA. O briefing mede quanto da conta está desenhada e
//    aponta o que falta; quem decide se entra em operação com lacuna é gente.
//    Um gate que trava a implantação por causa de um campo em branco vira
//    campo preenchido com "n/a", e aí o documento não serve para nada.
//
// 2) "NÃO SE APLICA" É RESPOSTA. Operação sem processamento intermediário
//    existe; cliente sem CONEMB existe. Sem essa opção, a única forma de
//    completar o briefing seria mentir.
//
// Camada pura: sem banco, sem rede, sem DOM.

const texto = (valor) => String(valor ?? "").trim();
const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const NAO_SE_APLICA = "nao-se-aplica";

// Cada campo declara o que é e como se mede. `tipo` diz à tela que controle
// desenhar, e ao domínio o que conta como respondido.
const campo = (id, rotulo, tipo, config = {}) => ({
  id,
  rotulo,
  tipo, // "texto" | "numero" | "lista" | "escolha" | "sim-nao" | "moeda" | "percentual"
  ajuda: config.ajuda || "",
  opcoes: config.opcoes || [],
  // Campo essencial entra na conta de "conta desenhada". Os demais enriquecem
  // sem cobrar — marcar tudo como essencial faria a barra nunca chegar ao fim
  // e o número perderia sentido.
  essencial: config.essencial !== false,
  permiteNaoSeAplica: config.permiteNaoSeAplica === true,
  unidade: config.unidade || "",
});

export const BLOCOS_DO_BRIEFING = Object.freeze([
  {
    id: "abrangencia",
    titulo: "Abrangência",
    descricao: "Onde a operação acontece e em que tamanho.",
    campos: [
      campo("cidades", "Cidades atendidas", "lista", { ajuda: "Uma por linha, ou separadas por vírgula." }),
      campo("bases", "Bases utilizadas", "lista", { ajuda: "CDs, hubs ou pontos de apoio que a operação usa." }),
      campo("volumeDia", "Volume por dia", "numero", { unidade: "entregas/dia" }),
      campo("motoristasDia", "Motoristas por dia", "numero", { unidade: "motoristas" }),
      campo("veiculosDia", "Veículos por dia", "numero", { unidade: "veículos", essencial: false }),
    ],
  },
  {
    id: "modelo-operacional",
    titulo: "Modelo operacional",
    descricao: "As etapas que a To Do Green executa, e em que horário.",
    campos: [
      campo("coleta", "Coleta", "texto", { ajuda: "Como e onde a carga é coletada." }),
      campo("processamento", "Processamento", "texto", {
        ajuda: "Triagem, cross-docking, armazenagem. Marque \"não se aplica\" se a carga vai direto.",
        permiteNaoSeAplica: true,
      }),
      campo("entrega", "Entrega", "texto", { ajuda: "Como a última milha acontece." }),
      campo("horarios", "Horários e janelas", "texto", { ajuda: "Corte, janela de coleta, janela de entrega." }),
    ],
  },
  {
    id: "pessoas",
    titulo: "Pessoas (HC)",
    descricao: "Quantas pessoas cada etapa exige, e se são dedicadas a este cliente.",
    campos: [
      campo("hcColeta", "HC de coleta", "numero", { unidade: "pessoas" }),
      campo("hcProcessamento", "HC de processamento", "numero", { unidade: "pessoas", permiteNaoSeAplica: true }),
      campo("hcEntrega", "HC de entrega", "numero", { unidade: "pessoas" }),
      campo("hcAcompanhamentoColeta", "HC de acompanhamento de coleta", "numero", { unidade: "pessoas" }),
      campo("hcAtendimentoCx", "HC de atendimento ao cliente (CX)", "numero", { unidade: "pessoas" }),
      campo("dedicados", "As equipes são dedicadas a este cliente?", "escolha", {
        opcoes: ["Todas dedicadas", "Parte dedicada", "Nenhuma dedicada"],
      }),
      campo("dedicadosDetalhe", "Quais são dedicadas", "texto", { essencial: false }),
    ],
  },
  {
    id: "contrato",
    titulo: "Contrato e régua de serviço",
    descricao: "O que a To Do Green promete e como isso é medido.",
    campos: [
      campo("reguaTipo", "Régua acordada", "escolha", { opcoes: ["SLA", "BSC", "SLA e BSC"] }),
      campo("reguaIndicadores", "Indicadores e metas", "texto", {
        ajuda: "Ex.: prazo de entrega 98% em D+1; insucesso abaixo de 2%.",
      }),
      campo("penalidades", "Penalidades e bonificações", "texto", { essencial: false, permiteNaoSeAplica: true }),
      campo("formalizacao", "Formalização", "escolha", {
        opcoes: ["Contrato assinado", "Em assinatura", "Minuta em revisão", "Sem contrato"],
      }),
      campo("vigencia", "Vigência", "texto", { essencial: false }),
    ],
  },
  {
    id: "sistema",
    titulo: "Sistema e integração",
    descricao: "Como os dois sistemas conversam.",
    campos: [
      campo("integracao", "Forma de integração", "escolha", {
        opcoes: ["API", "EDI", "Arquivo (CSV/TXT)", "Planilha manual", "Sem integração"],
      }),
      campo("bipagem", "Bipagem via integração", "sim-nao"),
      campo("smartlabel", "Etiqueta (smartlabel)", "escolha", {
        opcoes: ["Cliente gera", "To Do Green gera", "Não usa etiqueta"],
      }),
      campo("roteirizacao", "Roteirização", "escolha", {
        opcoes: ["Cliente roteiriza", "To Do Green roteiriza", "Sem roteirização"],
      }),
      campo("deParaStatus", "De/para de status", "texto", {
        ajuda: "Como os status da To Do Green viram os status do cliente.",
      }),
      campo("envioTracking", "Envio de tracking", "escolha", {
        opcoes: ["Automático por API", "Arquivo periódico", "Portal do cliente", "Não envia"],
      }),
      campo("insucesso", "Tratativa de insucesso na entrega", "texto", {
        ajuda: "Quantas tentativas, o que acontece depois, quem decide devolver.",
      }),
    ],
  },
  {
    id: "faturamento",
    titulo: "Faturamento",
    descricao: "O que é emitido, quanto custa e quando entra.",
    campos: [
      campo("documento", "Documento fiscal", "escolha", { opcoes: ["CT-e", "NF-e", "CT-e e NF-e", "NFS-e"] }),
      campo("modeloPagamento", "Modelo de pagamento", "escolha", {
        opcoes: ["Por entrega", "Por rota", "Por viagem", "Mensalidade", "Misto"],
      }),
      campo("preco", "Preço acordado", "texto", { ajuda: "Valor e a unidade a que ele se refere." }),
      campo("prazoPagamento", "Prazo de pagamento", "texto", { ajuda: "Ex.: 30 dias após o fechamento quinzenal." }),
      campo("conemb", "Precisa de CONEMB?", "sim-nao"),
      campo("ticketMedio", "Ticket médio", "moeda"),
      campo("margem", "Margem", "percentual"),
    ],
  },
  {
    id: "atendimento",
    titulo: "Atendimento e ocorrências",
    descricao: "Quem resolve quando dá errado.",
    campos: [
      campo("canalOcorrencia", "Canal de ocorrência", "escolha", {
        opcoes: ["Portal do cliente", "E-mail", "WhatsApp", "Telefone", "Integração"],
      }),
      campo("prazoResposta", "Prazo de resposta", "texto"),
      campo("portalCliente", "Portal do cliente", "escolha", {
        opcoes: ["Liberado", "Em implantação", "Não usa"],
      }),
      campo("escalonamento", "Escalonamento", "texto", { essencial: false }),
    ],
  },
  {
    id: "responsaveis",
    titulo: "RASCI",
    descricao: "Quem responde por esta conta, por papel.",
    campos: [
      campo("responsavel", "Responsável (R)", "texto"),
      campo("aprovador", "Aprovador (A)", "texto"),
      campo("suporte", "Suporte (S)", "texto", { essencial: false }),
      campo("consultado", "Consultado (C)", "texto", { essencial: false }),
      campo("informado", "Informado (I)", "texto", { essencial: false }),
    ],
  },
]);

export const TODOS_OS_CAMPOS = Object.freeze(
  BLOCOS_DO_BRIEFING.flatMap((bloco) => bloco.campos.map((item) => ({ ...item, bloco: bloco.id }))),
);

const respondido = (definicao, valor) => {
  if (valor === NAO_SE_APLICA) return definicao.permiteNaoSeAplica;
  if (valor === null || valor === undefined) return false;
  if (definicao.tipo === "numero" || definicao.tipo === "moeda" || definicao.tipo === "percentual")
    return numero(valor) !== null && texto(valor) !== "";
  if (definicao.tipo === "sim-nao") return valor === true || valor === false;
  if (definicao.tipo === "lista")
    return Array.isArray(valor) ? valor.filter((item) => texto(item)).length > 0 : texto(valor).length > 0;
  return texto(valor).length > 0;
};

/**
 * Normaliza o que veio da tela para o formato que fica gravado.
 *
 * Só conhece os campos do catálogo: chave que ninguém declarou não entra. Sem
 * isso o `fields_json` vira depósito, e daí a um vazamento no portal do cliente
 * é um passo — foi exatamente esse o caminho que a allowlist de campos do
 * portal precisou fechar depois.
 */
export const normalizarBriefing = (bruto = {}) => {
  const entrada = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {};
  const limpo = {};
  for (const definicao of TODOS_OS_CAMPOS) {
    const valor = entrada[definicao.id];
    if (valor === undefined) continue;
    if (valor === NAO_SE_APLICA) {
      if (definicao.permiteNaoSeAplica) limpo[definicao.id] = NAO_SE_APLICA;
      continue;
    }
    if (definicao.tipo === "sim-nao") {
      if (typeof valor === "boolean") limpo[definicao.id] = valor;
      continue;
    }
    if (definicao.tipo === "numero" || definicao.tipo === "moeda" || definicao.tipo === "percentual") {
      const n = numero(valor);
      if (n !== null) limpo[definicao.id] = n;
      continue;
    }
    if (definicao.tipo === "lista") {
      const itens = (Array.isArray(valor) ? valor : texto(valor).split(/[\n,;]+/))
        .map((item) => texto(item))
        .filter(Boolean)
        .slice(0, 200);
      if (itens.length) limpo[definicao.id] = itens;
      continue;
    }
    if (definicao.tipo === "escolha") {
      // Valor fora da lista é erro de tela ou requisição forjada; nos dois
      // casos, descartar é melhor do que gravar um estado que ninguém sabe ler.
      if (definicao.opcoes.includes(texto(valor))) limpo[definicao.id] = texto(valor);
      continue;
    }
    const t = texto(valor).slice(0, 4000);
    if (t) limpo[definicao.id] = t;
  }
  return limpo;
};

/**
 * Quanto desta conta está desenhada, e o que falta.
 *
 * Devolve por bloco, não só o total: "72% pronto" não diz onde ir, e "faltam
 * quatro campos de Faturamento" diz.
 */
export const avaliarBriefing = (briefing = {}) => {
  const valores = briefing && typeof briefing === "object" ? briefing : {};
  const blocos = BLOCOS_DO_BRIEFING.map((bloco) => {
    const essenciais = bloco.campos.filter((item) => item.essencial);
    const preenchidos = essenciais.filter((item) => respondido(item, valores[item.id]));
    const faltando = essenciais
      .filter((item) => !respondido(item, valores[item.id]))
      .map((item) => ({ id: item.id, rotulo: item.rotulo }));
    return {
      id: bloco.id,
      titulo: bloco.titulo,
      total: essenciais.length,
      preenchidos: preenchidos.length,
      // Bloco sem campo essencial seria 0/0; tratar como 100 evita que uma
      // divisão por zero apareça na tela como "NaN%".
      percentual: essenciais.length
        ? Math.round((preenchidos.length / essenciais.length) * 100)
        : 100,
      completo: faltando.length === 0,
      faltando,
    };
  });

  const total = blocos.reduce((soma, bloco) => soma + bloco.total, 0);
  const preenchidos = blocos.reduce((soma, bloco) => soma + bloco.preenchidos, 0);
  return {
    blocos,
    total,
    preenchidos,
    percentual: total ? Math.round((preenchidos / total) * 100) : 100,
    completo: preenchidos === total,
    // A lista corrida, para quem quer só saber o que falta sem navegar bloco a
    // bloco. Ordem dos blocos, que é a ordem em que a conta é desenhada.
    faltando: blocos.flatMap((bloco) =>
      bloco.faltando.map((item) => ({ ...item, bloco: bloco.id, blocoTitulo: bloco.titulo })),
    ),
  };
};

/**
 * O resumo comercial que o briefing já contém — o que a diretoria pergunta
 * primeiro. Devolve `null` no que não foi preenchido, nunca zero: zero é uma
 * margem possível, e confundi-los faria a tela afirmar o que não sabe.
 */
export const resumoComercialDoBriefing = (briefing = {}) => {
  const valores = briefing && typeof briefing === "object" ? briefing : {};
  const ticket = numero(valores.ticketMedio);
  const margem = numero(valores.margem);
  const volume = numero(valores.volumeDia);
  return {
    ticketMedio: valores.ticketMedio === undefined ? null : ticket,
    margemPercentual: valores.margem === undefined ? null : margem,
    volumeDia: valores.volumeDia === undefined ? null : volume,
    // Receita estimada só existe quando as duas pontas existem. Estimar com
    // uma delas ausente seria inventar número, que é exatamente o que o
    // painel da vertical não pode fazer.
    receitaMensalEstimada: ticket !== null && volume !== null
      ? Math.round(ticket * volume * 22 * 100) / 100
      : null,
    cidades: Array.isArray(valores.cidades) ? valores.cidades.length : 0,
    bases: Array.isArray(valores.bases) ? valores.bases.length : 0,
    motoristasDia: valores.motoristasDia === undefined ? null : numero(valores.motoristasDia),
  };
};
