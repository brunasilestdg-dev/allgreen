// ===== Inteligência da oportunidade =====
// Camada pura.
//
// O que faltava para o comercial ser profissional: a oportunidade era um
// registro com valor e etapa, e nada mais. Quem vendia tinha que adivinhar o
// argumento ambiental, o risco e o próximo passo — ou abrir três telas.
//
// Este motor responde, para cada oportunidade, o que o vendedor precisa saber
// ANTES da reunião:
//
//   - quanto de CO2 a operação proposta evita, e com que qualidade de dado
//   - qual Green Score o cliente passaria a ter
//   - o que isso significa em dinheiro e em operação
//   - onde há espaço para crescer dentro da própria conta
//   - o que está travando o negócio, e qual o próximo passo
//
// Nada aqui inventa número: reusa o motor ambiental, o Green Score e a régua
// comercial que já existem, versionados. Quando falta dado, a saída DIZ que
// falta em vez de estimar por baixo do pano — vendedor que descobre na reunião
// que o número era chute perde a conta e a credibilidade junto.

import { calcularImpactoAmbiental } from "./esgEngineDomain.js";
import { calcularGreenScore } from "./greenScoreDomain.js";

// O funil é o da titular (30/08, mockup aprovado): Prospecção → Apresentação
// → Negociação → Homologação → Fechamento. "Fechada ganha"/"Fechada perdida"
// são DESFECHOS, não colunas do funil — o handoff operacional continua
// disparando na ganha, e a perdida sai do pipeline.
export const ESTAGIOS_FUNIL = [
  "Prospecção",
  "Apresentação",
  "Negociação",
  "Homologação",
  "Fechamento",
];

export const ESTAGIOS_OPORTUNIDADE = [
  ...ESTAGIOS_FUNIL,
  "Fechada ganha",
  "Fechada perdida",
];

// Peso de cada estágio na probabilidade padrão. Não é chute: é a régua que a
// própria equipe pode sobrescrever por oportunidade, mas que dá um ponto de
// partida honesto para o forecast em vez de deixar o campo vazio.
export const PROBABILIDADE_POR_ESTAGIO = {
  Prospecção: 10,
  Apresentação: 35,
  Negociação: 60,
  Homologação: 80,
  Fechamento: 90,
  "Fechada ganha": 100,
  "Fechada perdida": 0,
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const arredondar = (v, casas = 1) => {
  const f = 10 ** casas;
  return Math.round(num(v) * f) / f;
};

const texto = (v) => String(v ?? "").trim();

// Os nomes de estágio que já existem no CRM e nos registros antigos. Sem esta
// tabela, uma oportunidade "Ganho" cadastrada mês passado voltaria para
// "Mapeamento" e reapareceria no pipeline como se estivesse aberta.
const APELIDOS_ESTAGIO = {
  ganho: "Fechada ganha",
  ganha: "Fechada ganha",
  ganhou: "Fechada ganha",
  fechado: "Fechada ganha",
  fechada: "Fechada ganha",
  perdido: "Fechada perdida",
  perdida: "Fechada perdida",
  perdeu: "Fechada perdida",
  // Os nomes antigos do sistema caem no funil da titular: mapeamento e
  // diagnóstico ainda são prospecção; construir solução e apresentar a
  // proposta são a etapa de apresentação. Nenhuma oportunidade antiga volta
  // para o início nem some.
  mapeamento: "Prospecção",
  diagnostico: "Prospecção",
  qualificacao: "Prospecção",
  "construcao de solucao": "Apresentação",
  solucao: "Apresentação",
  proposta: "Apresentação",
  implantacao: "Fechada ganha",
  "cliente ativo": "Fechada ganha",
};

const semAcento = (valor) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export const estagioValido = (valor) => {
  if (ESTAGIOS_OPORTUNIDADE.includes(valor)) return valor;
  const chave = semAcento(valor);
  if (!chave) return "Prospecção";
  const canonico = ESTAGIOS_OPORTUNIDADE.find((e) => semAcento(e) === chave);
  if (canonico) return canonico;
  return APELIDOS_ESTAGIO[chave] || "Prospecção";
};

// Resolve um estágio pedido em linguagem livre para um estágio do FUNIL (aberto).
// Existe para o Todô poder avançar a oportunidade sem dois perigos:
//   1) fechar negócio pelo chat — marcar "Fechada ganha" dispara o handoff
//      operacional, cria implantação e vira receita; isso é ato deliberado da
//      tela do CRM, não de um clique numa proposta de uma linha.
//   2) mover a oportunidade para trás sem querer — `estagioValido` derruba o
//      que não reconhece em "Prospecção"; aqui, o não reconhecido é ERRO, não
//      um retrocesso silencioso.
export const resolverEstagioDeAvanco = (valor) => {
  const bruto = texto(valor);
  if (!bruto) return { erro: `Informe o estágio do funil: ${ESTAGIOS_FUNIL.join(", ")}.` };
  const chave = semAcento(bruto);
  const canonico =
    ESTAGIOS_OPORTUNIDADE.find((e) => semAcento(e) === chave) || APELIDOS_ESTAGIO[chave] || null;
  if (!canonico)
    return { erro: `Estágio não reconhecido. Use um destes: ${ESTAGIOS_FUNIL.join(", ")}.` };
  if (!ESTAGIOS_FUNIL.includes(canonico))
    return { erro: "Fechar como ganha ou perdida é feito na tela do CRM, não pelo Todô." };
  return { estagio: canonico };
};

export const probabilidadeDoEstagio = (estagio, informada) => {
  const n = Number(informada);
  // Probabilidade informada pela pessoa vence a do estágio — ela conhece o
  // negócio. Mas só se for um número plausível.
  if (Number.isFinite(n) && n >= 0 && n <= 100) return arredondar(n, 0);
  return PROBABILIDADE_POR_ESTAGIO[estagioValido(estagio)] ?? 10;
};

// ---- Potencial ambiental da oportunidade ----
//
// Calcula o impacto da operação PROPOSTA, com o mesmo motor que apura a
// operação executada. Assim a promessa da proposta e o número do relatório
// nascem da mesma fórmula — e o cliente pode cobrar depois.
export const potencialAmbiental = (oportunidade = {}) => {
  const distanciaKm = num(oportunidade.distanciaKm);
  const viagensMes = num(oportunidade.viagensMes);

  if (distanciaKm <= 0 || viagensMes <= 0)
    return {
      disponivel: false,
      // Dizer o que falta é mais útil que devolver zero: o vendedor sabe qual
      // pergunta fazer ao cliente.
      motivo:
        "Informe a distância e a frequência mensal para calcular o potencial ambiental desta oportunidade.",
      camposFaltando: [
        ...(distanciaKm <= 0 ? ["distanciaKm"] : []),
        ...(viagensMes <= 0 ? ["viagensMes"] : []),
      ],
    };

  // Sem tipo de veículo informado, o cálculo assume a frota elétrica que é o
  // produto da casa — mas essa premissa é a que mais infla o número, então ela
  // sai declarada no resultado em vez de ficar escondida no código.
  const veiculoInformado = texto(oportunidade.tipoVeiculo);
  const resultado = calcularImpactoAmbiental({
    distanciaKm,
    viagens: viagensMes,
    tipoVeiculo: veiculoInformado || "elétrico",
    origens: oportunidade.origens || { distancia: "estimado" },
    calculadoEm: oportunidade.calculadoEm,
  });

  const co2MensalKg = num(resultado.impacto.co2AvoidedKg);
  const meses = Math.max(1, num(oportunidade.mesesContrato) || 12);

  return {
    disponivel: true,
    co2MensalKg: arredondar(co2MensalKg, 2),
    co2ContratoKg: arredondar(co2MensalKg * meses, 2),
    co2ContratoToneladas: arredondar((co2MensalKg * meses) / 1000, 2),
    reducaoPercent: arredondar(resultado.impacto.reductionPercent),
    dieselEvitadoLitrosMes: arredondar(resultado.impacto.dieselAvoidedLiters, 2),
    qualidadeDados: resultado.qualidadeDados,
    versaoFatores: resultado.versaoFatores,
    mesesContrato: meses,
    tipoVeiculoPresumido: !veiculoInformado,
    // A memória vai junto: se a proposta cita o número, a conta tem que estar
    // anexada. É o que separa argumento de alegação.
    memoria: resultado.memoria,
    // Qualidade baixa não impede o cálculo, mas muda o que se pode afirmar.
    usoPermitido:
      resultado.qualidadeDados >= 70
        ? "Pode ser usado em proposta comercial, com a memória de cálculo anexada."
        : "Qualidade do dado abaixo de 70%: use como estimativa preliminar e confirme os dados antes de formalizar em proposta.",
  };
};

// ---- Green Score esperado ----
//
// O que o cliente passaria a ter se fechasse. Usa o mesmo motor do score
// realizado, então a promessa é comparável ao que será medido depois.
export const greenScoreEsperado = (oportunidade = {}, ambiental = null, pesos = undefined) => {
  const impacto = ambiental ?? potencialAmbiental(oportunidade);
  if (!impacto.disponivel)
    return { disponivel: false, motivo: impacto.motivo };

  const score = calcularGreenScore(
    {
      reducaoPercent: impacto.reducaoPercent,
      ocupacaoPercent: num(oportunidade.ocupacaoPrevistaPercent),
      frotaLimpaPercent: num(oportunidade.frotaLimpaPercent),
      qualidadeDados: impacto.qualidadeDados,
      // Sem histórico de ocorrências numa operação que ainda não começou, o
      // componente entra pela expectativa contratual — e o texto diz isso.
      operacoes: Math.max(1, num(oportunidade.viagensMes)),
      ocorrencias: num(oportunidade.ocorrenciasEsperadas),
      calculadoEm: oportunidade.calculadoEm,
    },
    pesos,
  );

  return {
    disponivel: true,
    valor: score.score,
    versaoPesos: score.versaoPesos,
    componentes: score.componentes,
    ressalva:
      "Score projetado a partir das premissas desta oportunidade. O score real é apurado sobre a operação executada e pode divergir.",
  };
};

// ---- Impacto financeiro ----
//
// Valor ponderado pela probabilidade é o que entra em forecast. Valor cheio é
// o que entra em comemoração — e confundir os dois é como pipeline vira
// ficção.
export const impactoFinanceiro = (oportunidade = {}) => {
  const meses = Math.max(1, num(oportunidade.mesesContrato) || 12);
  // Duas formas de informar o mesmo negócio: mensalidade (como o comercial
  // negocia) ou valor cheio do contrato (como o registro antigo guardava).
  // A mensalidade manda quando as duas vêm, porque é o dado que a pessoa
  // digitou por último.
  const mensalInformado = num(oportunidade.valorMensal);
  const contratoInformado = num(oportunidade.valorContrato);
  const mensal =
    mensalInformado > 0 ? mensalInformado : contratoInformado / meses;
  const contrato = mensalInformado > 0 ? mensalInformado * meses : contratoInformado;
  const probabilidade = probabilidadeDoEstagio(
    oportunidade.estagio,
    oportunidade.probabilidade,
  );
  return {
    valorMensal: arredondar(mensal, 2),
    valorContrato: arredondar(contrato, 2),
    // Diz de onde veio o número, para a tela não afirmar "mensalidade" sobre um
    // valor que a pessoa digitou como total do contrato.
    baseDoValor: mensalInformado > 0 ? "mensal" : contratoInformado > 0 ? "contrato" : "ausente",
    mesesContrato: meses,
    probabilidade,
    valorPonderado: arredondar((contrato * probabilidade) / 100, 2),
    // Receita que entra este ano se fechar agora — o número que o financeiro
    // pergunta e que ninguém sabe responder de cabeça.
    valorNoAnoCorrente: arredondar(mensal * Math.min(12, meses), 2),
  };
};

// ---- Impacto operacional ----
export const impactoOperacional = (oportunidade = {}) => {
  const viagensMes = num(oportunidade.viagensMes);
  const distanciaKm = num(oportunidade.distanciaKm);
  const veiculosNecessarios = Math.ceil(
    viagensMes / Math.max(1, num(oportunidade.viagensPorVeiculoMes) || 22),
  );
  return {
    viagensMes,
    kmMes: arredondar(distanciaKm * viagensMes, 0),
    veiculosNecessarios,
    motoristasNecessarios: veiculosNecessarios,
    // Sinaliza quando a operação proposta exige mais frota do que a disponível
    // informada. Descobrir isso na implantação custa contrato.
    exigeFrotaAdicional:
      num(oportunidade.veiculosDisponiveis) > 0 &&
      veiculosNecessarios > num(oportunidade.veiculosDisponiveis),
  };
};

// ---- Potencial de expansão ----
//
// Onde há espaço para crescer dentro da conta. Só aponta caminho sustentado
// por dado presente; sem dado, não sugere — sugestão sem base vira promessa
// que a operação não cumpre.
export const potencialExpansao = (oportunidade = {}, conta = {}) => {
  const caminhos = [];

  const frotaLimpa = num(oportunidade.frotaLimpaPercent);
  if (frotaLimpa > 0 && frotaLimpa < 100)
    caminhos.push({
      tipo: "eletrificacao",
      titulo: "Migrar mais carga para veículos de baixa emissão",
      base: `${arredondar(frotaLimpa)}% da operação proposta usa frota limpa.`,
      ganhoEstimado: "Aumenta a redução de CO2 e o Green Score do cliente.",
    });

  const ocupacao = num(oportunidade.ocupacaoPrevistaPercent);
  if (ocupacao > 0 && ocupacao < 85)
    caminhos.push({
      tipo: "ocupacao",
      titulo: "Consolidar cargas para elevar a ocupação",
      base: `Ocupação prevista de ${arredondar(ocupacao)}%.`,
      ganhoEstimado:
        "Menos viagens para o mesmo volume: reduz custo por entrega e emissão.",
    });

  const rotasAtivas = num(conta.rotasAtivas);
  const rotasMapeadas = num(conta.rotasMapeadas);
  if (rotasMapeadas > rotasAtivas && rotasAtivas >= 0)
    caminhos.push({
      tipo: "novas-rotas",
      titulo: "Incluir rotas já mapeadas e ainda não contratadas",
      base: `${rotasMapeadas - rotasAtivas} rota(s) mapeada(s) fora do contrato atual.`,
      ganhoEstimado: "Expande volume sem novo processo de qualificação.",
    });

  return {
    caminhos,
    // Sem caminho identificado, dizer isso é melhor que devolver lista vazia e
    // deixar a tela em branco sem explicação.
    resumo: caminhos.length
      ? `${caminhos.length} caminho(s) de expansão sustentado(s) pelos dados desta oportunidade.`
      : "Nenhum caminho de expansão identificável com os dados atuais. Registre ocupação, composição da frota e rotas mapeadas para habilitar a análise.",
  };
};

// ---- Risco ----
//
// O que trava o negócio. Ordenado por gravidade, porque vendedor lê o primeiro
// item e age.
export const riscosDaOportunidade = (oportunidade = {}, ambiental = null) => {
  const riscos = [];
  const impacto = ambiental ?? potencialAmbiental(oportunidade);

  if (!impacto.disponivel)
    riscos.push({
      gravidade: "alta",
      tipo: "dado-faltando",
      texto: impacto.motivo,
    });
  else if (impacto.qualidadeDados < 70)
    riscos.push({
      gravidade: "media",
      tipo: "qualidade-dado",
      texto: `Qualidade dos dados em ${impacto.qualidadeDados}%. O número ambiental serve para conversa, não para compromisso contratual.`,
    });

  const alvo = num(oportunidade.precoAlvoCliente);
  const minimo = num(oportunidade.precoMinimo);
  if (alvo > 0 && minimo > 0 && alvo < minimo)
    riscos.push({
      gravidade: "alta",
      tipo: "preco-abaixo-do-piso",
      texto: `O alvo do cliente está abaixo do preço mínimo da régua. Fechar assim exige aprovação e justificativa.`,
    });

  const operacional = impactoOperacional(oportunidade);
  if (operacional.exigeFrotaAdicional)
    riscos.push({
      gravidade: "alta",
      tipo: "capacidade",
      texto: `A operação exige ${operacional.veiculosNecessarios} veículo(s) e há ${num(oportunidade.veiculosDisponiveis)} disponível(is). Confirme a capacidade antes de assumir prazo.`,
    });

  const diasParado = num(oportunidade.diasSemInteracao);
  if (diasParado >= 21)
    riscos.push({
      gravidade: diasParado >= 45 ? "alta" : "media",
      tipo: "esfriando",
      texto: `${diasParado} dias sem interação registrada nesta oportunidade.`,
    });

  const ordem = { alta: 0, media: 1, baixa: 2 };
  return riscos.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
};

// ---- Próxima ação ----
//
// Uma só. Lista de cinco recomendações é lista que ninguém executa.
export const proximaAcao = (oportunidade = {}, riscos = null) => {
  const lista = riscos ?? riscosDaOportunidade(oportunidade);
  const critico = lista.find((r) => r.gravidade === "alta");

  if (critico?.tipo === "dado-faltando")
    return {
      acao: "Levantar os dados da operação com o cliente",
      porque: "Sem distância e frequência não há proposta defensável.",
      urgencia: "alta",
    };
  if (critico?.tipo === "preco-abaixo-do-piso")
    return {
      acao: "Levar para aprovação comercial antes de responder ao cliente",
      porque: "O alvo está abaixo do piso da régua comercial em vigor.",
      urgencia: "alta",
    };
  if (critico?.tipo === "capacidade")
    return {
      acao: "Confirmar capacidade de frota com a operação",
      porque: "Prometer prazo sem frota confirmada custa o contrato depois.",
      urgencia: "alta",
    };

  const estagio = estagioValido(oportunidade.estagio);
  if (estagio === "Prospecção")
    return {
      acao: "Agendar diagnóstico operacional com quem opera a logística",
      porque: "O número ambiental só convence com dado do cliente.",
      urgencia: "media",
    };
  if (estagio === "Apresentação")
    return {
      acao: "Apresentar a proposta com a memória de cálculo ambiental anexada",
      porque: "É o que diferencia da concorrência que só manda preço.",
      urgencia: "media",
    };
  if (estagio === "Negociação")
    return {
      acao: "Definir data de início e condições de implantação",
      porque: "Negociação sem data de início escorrega de mês.",
      urgencia: "alta",
    };
  if (estagio === "Homologação")
    return {
      acao: "Acompanhar os requisitos da homologação e destravar pendências",
      porque: "Homologação parada é contrato pronto esfriando na mesa.",
      urgencia: "alta",
    };
  if (estagio === "Fechamento")
    return {
      acao: "Formalizar contrato e data de início com o jurídico",
      porque: "Fechamento sem assinatura ainda não é receita.",
      urgencia: "alta",
    };
  return {
    acao: "Registrar o desfecho e o aprendizado da oportunidade",
    porque: "Oportunidade fechada sem registro não ensina nada ao time.",
    urgencia: "baixa",
  };
};

// ---- O nome do negócio ----
//
// A oportunidade nasceu sem nome: a tela mostrava o CLIENTE como se fosse o
// negócio, e uma conta com três frentes abertas virava três cartões idênticos.
// A importação do quadro de Novos Negócios tornou isso impossível de ignorar —
// 67 projetos entraram com nome próprio ("AMXL ABC", "Same Day", "Projeto
// DHL") e nenhum aparecia.
//
// A ordem de queda é deliberada: o nome que a pessoa escreveu, depois o nome
// que veio do quadro, e por último um rótulo DERIVADO do que existe. "Sem
// título" nunca sai daqui — negócio sem nome ainda é o negócio de alguém numa
// etapa, e é isso que a pessoa precisa ler no cartão.
export const tituloDaOportunidade = (registro = {}) => {
  const proprio = texto(registro.titulo || registro.title);
  if (proprio) return proprio;
  const doQuadro = texto(registro.campos?.nomeDoProjeto || registro.nomeDoProjeto);
  if (doQuadro) return doQuadro;
  const cliente = texto(registro.cliente || registro.client || registro.accountName);
  const estagio = texto(registro.estagio || registro.stage);
  if (cliente && estagio) return `${cliente} · ${estagio}`;
  if (cliente) return cliente;
  return "Negócio sem conta";
};

// O subtítulo só repete o cliente quando o título NÃO é o cliente. Sem isso o
// cartão exibiria "Amazon" duas vezes, uma embaixo da outra.
export const subtituloDaOportunidade = (registro = {}) => {
  const titulo = tituloDaOportunidade(registro);
  const cliente = texto(registro.cliente || registro.client || registro.accountName);
  return cliente && !titulo.startsWith(cliente) ? cliente : "";
};

// ---- Adaptador do registro guardado ----
//
// O CRM guarda a oportunidade com nomes em inglês e herdados de versões
// anteriores (stage, value, probability). O motor fala a língua do domínio.
// Traduzir aqui, uma vez e testado, evita que cada tela invente sua própria
// conversão — e é o que permite ler registro antigo sem migração destrutiva.
export const normalizarOportunidade = (registro = {}, agora = Date.now()) => {
  const ultima = registro.lastInteractionAt || registro.ultimaInteracaoEm;
  let diasSemInteracao = num(registro.diasSemInteracao);
  if (!diasSemInteracao && ultima) {
    const t = new Date(ultima).getTime();
    // Data ilegível não vira "0 dias parado": vira ausência de informação.
    if (Number.isFinite(t))
      diasSemInteracao = Math.max(0, Math.floor((agora - t) / 86400000));
  }

  return {
    ...registro,
    id: registro.id,
    titulo: texto(registro.titulo || registro.title),
    cliente: texto(registro.cliente || registro.client || registro.accountName),
    estagio: estagioValido(registro.estagio ?? registro.stage),
    probabilidade: registro.probabilidade ?? registro.probability,
    valorMensal: num(registro.valorMensal),
    // `value` no registro antigo é o valor cheio estimado do negócio, não a
    // mensalidade — tratá-lo como mensal multiplicaria o pipeline por 12.
    valorContrato: num(registro.valorContrato) || num(registro.value),
    mesesContrato: num(registro.mesesContrato) || num(registro.contractMonths),
    distanciaKm: num(registro.distanciaKm) || num(registro.distanceKm),
    viagensMes: num(registro.viagensMes) || num(registro.monthlyTrips),
    tipoVeiculo: texto(registro.tipoVeiculo || registro.vehicleType),
    ocupacaoPrevistaPercent: num(registro.ocupacaoPrevistaPercent),
    frotaLimpaPercent: num(registro.frotaLimpaPercent),
    veiculosDisponiveis: num(registro.veiculosDisponiveis),
    precoAlvoCliente: num(registro.precoAlvoCliente),
    precoMinimo: num(registro.precoMinimo),
    diasSemInteracao,
  };
};

// ---- Visão completa ----
//
// O que a tela da oportunidade mostra. Uma chamada, tudo calculado com os
// mesmos motores do resto do produto.
export const analisarOportunidade = (oportunidade = {}, contexto = {}) => {
  const ambiental = potencialAmbiental(oportunidade);
  const riscos = riscosDaOportunidade(oportunidade, ambiental);
  return {
    estagio: estagioValido(oportunidade.estagio),
    ambiental,
    greenScore: greenScoreEsperado(oportunidade, ambiental, contexto.pesos),
    financeiro: impactoFinanceiro(oportunidade),
    operacional: impactoOperacional(oportunidade),
    expansao: potencialExpansao(oportunidade, contexto.conta || {}),
    riscos,
    proximaAcao: proximaAcao(oportunidade, riscos),
  };
};

// Consolida o pipeline. Separa o valor cheio do ponderado porque são perguntas
// diferentes: "quanto vale a carteira" e "quanto devo prometer ao conselho".
export const resumirPipeline = (oportunidades = []) => {
  const abertas = oportunidades.filter(
    (o) => !["Fechada ganha", "Fechada perdida"].includes(estagioValido(o.estagio)),
  );
  const financeiros = abertas.map((o) => impactoFinanceiro(o));
  const ambientais = abertas
    .map((o) => potencialAmbiental(o))
    .filter((a) => a.disponivel);

  return {
    total: abertas.length,
    valorTotal: arredondar(
      financeiros.reduce((a, f) => a + f.valorContrato, 0),
      2,
    ),
    valorPonderado: arredondar(
      financeiros.reduce((a, f) => a + f.valorPonderado, 0),
      2,
    ),
    co2PotencialToneladas: arredondar(
      ambientais.reduce((a, x) => a + x.co2ContratoToneladas, 0),
      2,
    ),
    // Quantas oportunidades ainda não têm dado ambiental — a fila de trabalho
    // do time, não um número decorativo.
    semDadoAmbiental: abertas.length - ambientais.length,
    porEstagio: ESTAGIOS_OPORTUNIDADE.reduce((acc, estagio) => {
      const doEstagio = abertas.filter((o) => estagioValido(o.estagio) === estagio);
      if (doEstagio.length) acc[estagio] = doEstagio.length;
      return acc;
    }, {}),
  };
};
