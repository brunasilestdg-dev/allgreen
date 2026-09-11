// ===== Fechamento mensal de ESG — moldura GLEC / ISO 14083 =====
// Camada pura.
//
// O relatório sob demanda já existe (esgReportDomain). O que faltava é o
// FECHAMENTO: consolidar o mês inteiro num retrato só, na linguagem que o
// mercado reconhece — o GLEC Framework / ISO 14083, que contabiliza emissão de
// transporte por ATIVIDADE (tonelada-quilômetro), well-to-wheel.
//
// A métrica-título do GLEC é a INTENSIDADE: gramas de CO₂e por tonelada-km.
// Ela exige atividade (peso × distância). Sem peso da carga não dá para
// calcular — e aqui isso vira `null` com um aviso, nunca um zero que fingiria
// precisão. É o mesmo princípio do motor auditável: o número diz o que ele não é.

const num = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const round = (valor, casas = 2) => {
  const f = 10 ** casas;
  return Math.round(num(valor) * f) / f;
};

export const METODOLOGIA_GLEC =
  "GLEC Framework / ISO 14083 — contabilização well-to-wheel por atividade (tonelada-quilômetro), com fatores de emissão versionados. Estimativa própria reproduzível pela memória de cálculo; não constitui verificação por terceira parte.";

// Recebe os cálculos ambientais do mês (cada um com `.impact` do motor
// auditável) e as operações (com peso e distância, para a atividade GLEC).
export const fechamentoMensalEsg = (calculos = [], operacoes = [], mes = "") => {
  const listaCalc = Array.isArray(calculos) ? calculos : [];
  const listaOp = Array.isArray(operacoes) ? operacoes : [];

  const co2Evitado = listaCalc.reduce((a, c) => a + num(c?.impact?.co2AvoidedKg), 0);
  const co2Emitido = listaCalc.reduce((a, c) => a + num(c?.impact?.co2ExecutadoKg), 0);
  const co2Referencia = listaCalc.reduce((a, c) => a + num(c?.impact?.co2ReferenciaKg), 0);
  const energiaKwh = listaCalc.reduce((a, c) => a + num(c?.impact?.energiaKwh), 0);
  const qualidadeMedia = listaCalc.length
    ? Math.round(listaCalc.reduce((a, c) => a + num(c?.qualidadeDados), 0) / listaCalc.length)
    : 0;

  // Atividade GLEC: tonelada-km = Σ(peso_t × distância_km). O peso pode vir
  // solto (`pesoKg`) ou dentro de `campos.weightKg` (projeção do TMS).
  let toneladasKm = 0;
  let operacoesComPeso = 0;
  for (const op of listaOp) {
    const pesoKg = num(op?.pesoKg ?? op?.campos?.weightKg);
    const distanciaKm = num(op?.distanciaKm);
    if (pesoKg > 0 && distanciaKm > 0) {
      toneladasKm += (pesoKg / 1000) * distanciaKm;
      operacoesComPeso += 1;
    }
  }

  // Intensidade em gCO2e/tkm (o número que o GLEC cobra). null sem atividade.
  const intensidade = toneladasKm > 0 ? (co2Emitido * 1000) / toneladasKm : null;

  return {
    mes: String(mes || ""),
    metodologia: METODOLOGIA_GLEC,
    versaoFatores: listaCalc[0]?.versaoFatores || "",
    resumo: {
      operacoes: listaOp.length,
      calculos: listaCalc.length,
      co2EvitadoKg: round(co2Evitado),
      co2EmitidoKg: round(co2Emitido),
      co2ReferenciaKg: round(co2Referencia),
      energiaKwh: round(energiaKwh),
      toneladasKm: round(toneladasKm),
      intensidadeGCo2ePorTkm: intensidade != null ? round(intensidade, 2) : null,
      qualidadeMedia,
    },
    atividade: {
      operacoesComPeso,
      operacoesSemPeso: listaOp.length - operacoesComPeso,
      intensidadeDisponivel: intensidade != null,
      aviso:
        intensidade != null
          ? "Intensidade por tonelada-quilômetro calculada sobre as operações do período com peso informado."
          : "Sem peso de carga nas operações do período: a intensidade GLEC por tonelada-quilômetro fica indisponível. Informe o peso para o fechamento GLEC completo.",
    },
  };
};
