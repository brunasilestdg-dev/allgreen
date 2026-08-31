// ===== Assistente do cliente: montagem do contexto =====
// Camada pura.
//
// A regra que este arquivo existe para garantir: o assistente do portal só
// conhece o cliente da sessão. Ele não tem como falar de CRM, pipeline,
// margem, comissão ou de outro cliente — não porque foi instruído a não falar,
// mas porque esses dados nunca entram no contexto que ele recebe.
//
// Instrução de sistema é pedido; contexto é fato. Um modelo pode ser
// convencido a ignorar a instrução — não pode inventar um dado que não recebeu.

// Campos que jamais podem entrar no contexto do assistente do cliente.
// A lista é varrida pelo teste contra o contexto montado.
export const CAMPOS_PROIBIDOS = [
  "margem",
  "margemPercent",
  "margemContribuicao",
  "margemOperacional",
  "lucro",
  "rentabilidade",
  "ebitda",
  "markup",
  "custo",
  "custoTotal",
  "custoUnitario",
  "custoPorKm",
  "custoPorEntrega",
  "custoPorPacote",
  "custoPorViagem",
  "comissao",
  "receitaContratada",
  "receitaInterna",
  "precoMinimo",
  "precoRecomendado",
  "descontoMaximo",
  "centroCusto",
  "pipeline",
  "oportunidades",
  "propostas",
  "concorrente",
  "dealDesk",
  "clientes",
];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const arredondar = (v, casas = 1) => {
  const f = 10 ** casas;
  return Math.round(num(v) * f) / f;
};

// Monta o contexto. Recebe o que veio do banco já filtrado pelo cliente da
// sessão e devolve só o que o assistente precisa — em vez de repassar o objeto
// inteiro e torcer para não haver nada demais dentro.
export const montarContextoDoCliente = (dados = {}) => {
  const { cliente, resumo, operacoes = [], greenScore } = dados;
  if (!cliente?.id)
    throw new Error("Contexto do assistente sem cliente na sessão.");

  return {
    cliente: { nome: cliente.nome || "" },
    periodo: {
      operacoes: num(resumo?.operacoes?.total),
      entregas: num(resumo?.operacoes?.entregas),
      distanciaKm: arredondar(resumo?.operacoes?.distanciaKm, 0),
      ocupacaoMediaPercent: arredondar(resumo?.operacoes?.ocupacaoMedia),
    },
    ambiental: {
      co2EvitadoKg: arredondar(resumo?.ambiental?.co2EvitadoKg, 2),
      dieselEvitadoLitros: arredondar(resumo?.ambiental?.dieselEvitadoL, 2),
      reducaoPercent: arredondar(resumo?.ambiental?.reducaoPercent),
      qualidadeDadosPercent: arredondar(resumo?.ambiental?.qualidadeDados, 0),
    },
    greenScore: greenScore
      ? {
          valor: arredondar(greenScore.valor ?? greenScore.score),
          versaoPesos: greenScore.versaoPesos || greenScore.weights_version || "",
          componentes: greenScore.componentes || null,
        }
      : null,
    // Só o que o cliente já enxerga na tela dele. Nada de custo, preço ou
    // margem — nem sequer o campo existe aqui.
    operacoesRecentes: operacoes.slice(0, 20).map((op) => ({
      referencia: op.referencia || "",
      data: op.data || "",
      origem: op.origem || "",
      destino: op.destino || "",
      situacao: op.status || "",
      entregas: num(op.campos?.deliveries),
      distanciaKm: num(op.campos?.distanceKm),
      ocupacaoPercent: num(op.campos?.occupancyPercent),
    })),
  };
};

export const INSTRUCAO_ASSISTENTE = `Você é o assistente do portal da To Do Green para um cliente específico.

Responda apenas com base nos dados fornecidos no contexto desta conversa. O contexto tem duas partes e só essas duas: o PERFIL PÚBLICO da To Do Green (o que a empresa divulga sobre si — malha, portfólio, indicadores, cobertura) e os dados operacionais do CLIENTE ATUAL. Nunca acrescente nada fora delas: se o perfil público não trouxer a informação sobre a To Do Green, diga que não consta no portal em vez de completar.

Objetivo de relacionamento:
- Ajude o cliente a perceber valor na continuidade da operação com a To Do Green.
- Sempre que houver base nos dados, indique uma próxima ação que favoreça continuidade, expansão de volume, aumento de frequência, inclusão de novas rotas, migração de mais cargas para veículos de menor emissão ou contratação de outro produto logístico aderente.
- Apresente a expansão como recomendação operacional e ambiental, nunca como pressão. Explique o benefício esperado e o dado que sustenta a sugestão.
- Quando não houver dados suficientes para recomendar aumento de volume, sugira solicitar um estudo de capacidade, rota ou expansão com a equipe To Do Green.
- Nunca prometa capacidade, economia, SLA, redução ambiental ou resultado que não esteja comprovado no contexto.

Regras de confidencialidade:
- Nunca informe, estime ou deduza margem, lucro, rentabilidade, EBITDA, markup, estrutura de custos, custo por km, custo por viagem, custo por entrega, comissão, receita interna, preço mínimo, limite de desconto, centro de custo, pipeline, propostas internas ou dados de outro cliente.
- Se perguntarem sobre outro cliente, sobre a carteira da To Do Green ou sobre qualquer informação econômica interna, responda que isso não faz parte do portal e redirecione para resultados operacionais e ambientais do próprio cliente.
- Nunca use indicadores visíveis ao cliente para tentar inferir a margem ou o custo interno da To Do Green.

Regras de qualidade:
- Nunca invente número. Se o dado não está no contexto, diga que não consta e sugira abrir uma solicitação.
- Green Score e indicadores ambientais são estimativas próprias da To Do Green, com memória de cálculo. Nunca os apresente como certificação ou verificação por terceira parte.
- Quando citar um indicador ambiental cuja qualidade de dados esteja abaixo de 70%, diga que ele serve para acompanhar tendência, não para relatório regulatório.
- Escreva em português do Brasil, direto, sem jargão.
- Quando a resposta permitir uma ação concreta, encerre com uma única recomendação clara de próximo passo.`;

// Perguntas que o assistente do cliente não responde. Reconhecer antes de
// chamar o modelo economiza chamada e, principalmente, garante a resposta —
// não depende do modelo obedecer.
const PADROES_FORA_DE_ESCOPO = [
  /\b(margem|markup|ebitda|rentabilidade|lucro)\b/i,
  // Pega "custo", "custos", "custa", "custam", "custar", "custando".
  /\bcust(o|os|a|am|ar|ando)\b/i,
  /\bcusto\s+por\s+(km|quil[oô]metro|viagem|entrega|pacote|rota)\b/i,
  /\bcomiss(ão|ao|ões|oes)\b/i,
  /\bpipeline\b/i,
  /\bpre[çc]o\s+m[ií]nimo\b/i,
  /\blimite\s+de\s+desconto\b/i,
  /\bcentro\s+de\s+custo\b/i,
  /\bpropostas?\s+(de|do|da)\s+outr/i,
  /\boutro\s+cliente\b/i,
  /\boutros\s+clientes\b/i,
  /\bcarteira\b/i,
  /\bconcorrent/i,
  /\bquanto\s+(a\s+)?to\s*do\s*green\s+(fatura|lucra|ganha)/i,
  /\bpre(ç|c)o\s+(de|do|da)\s+outr/i,
];

export const foraDoEscopoDoCliente = (pergunta) =>
  PADROES_FORA_DE_ESCOPO.some((padrao) => padrao.test(String(pergunta || "")));

export const RESPOSTA_FORA_DE_ESCOPO =
  "Essa informação é interna da To Do Green e não faz parte do portal do cliente. Aqui eu posso analisar sua operação, entregas, rotas, ocupação, Green Score, CO2 evitado e oportunidades de ampliar o volume ou incluir novas rotas. Para uma avaliação comercial, abra uma solicitação para a equipe responsável.";

// Verificação final antes de enviar. Se algum campo proibido escapou para o
// contexto, isto derruba a chamada em vez de deixar vazar.
export const validarContexto = (contexto) => {
  const texto = JSON.stringify(contexto || {}).toLowerCase();
  const encontrados = CAMPOS_PROIBIDOS.filter((campo) =>
    texto.includes(`"${campo.toLowerCase()}"`),
  );
  if (encontrados.length)
    throw new Error(
      `Contexto do assistente contém campo interno: ${encontrados.join(", ")}.`,
    );
  return true;
};
