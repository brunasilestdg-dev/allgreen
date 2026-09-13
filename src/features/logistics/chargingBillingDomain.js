// ===== Cobrança de recarga por kWh — B2B/B2C (bloco 05 Charging/GreenOn) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// Recarregar é serviço: quem recarrega na rede da To Do Green pode ser cobrado
// pela energia que consumiu. A cobrança nasce da SESSÃO MEDIDA (chargingSession)
// — kWh real × preço por kWh — nunca de um valor digitado à mão.
//
// O preço tem três escopos, do mais específico ao mais geral:
//   cliente (contrato B2B) > segmento (b2b/b2c) > base (tabela pública).
// Um cliente B2B com preço próprio vence o preço do segmento, que vence a base.
//
// Honestidade:
//  - só a sessão CONCLUÍDA e MEDIDA (kWh > 0) é faturável — em andamento não;
//  - sessão sem cliente é USO INTERNO (a própria frota): não gera cobrança, é
//    custo (esse lado é a Gestão de Energia). Faturar é para terceiro;
//  - sem NENHUMA regra de preço configurada, nada é faturável — a tela diz
//    "configure o preço por kWh", jamais cobra R$ 0 como se fosse de graça.

import { energiaMedida, sessaoMedida } from "./chargingSessionDomain.js";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const texto = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const round = (v, casas = 2) => {
  const f = 10 ** casas;
  return Math.round(num(v) * f) / f;
};

export const ESCOPOS_PRECO = Object.freeze(["base", "segmento", "cliente"]);
export const SEGMENTOS = Object.freeze(["b2b", "b2c"]);

export const escopoValido = (v) => (ESCOPOS_PRECO.includes(texto(v)) ? texto(v) : "base");
export const segmentoValido = (v) => (SEGMENTOS.includes(texto(v).toLowerCase()) ? texto(v).toLowerCase() : "");

export const normalizarRegraPreco = (corpo = {}) => {
  const escopo = escopoValido(corpo.escopo);
  return {
    escopo,
    // Segmento só faz sentido nos escopos segmento e cliente; na base fica vazio.
    segmento: escopo === "base" ? "" : segmentoValido(corpo.segmento),
    clienteId: escopo === "cliente" ? texto(corpo.clienteId, 120) : "",
    clienteNome: escopo === "cliente" ? texto(corpo.clienteNome, 200) : "",
    precoPorKwh: Math.max(0, round(corpo.precoPorKwh, 4)),
    observacao: texto(corpo.observacao, 500),
  };
};

export const validarRegraPreco = (corpo = {}) => {
  const escopo = escopoValido(corpo.escopo);
  if (!(num(corpo.precoPorKwh) > 0)) return "Informe um preço por kWh maior que zero.";
  if (escopo === "segmento" && !segmentoValido(corpo.segmento))
    return "Escolha o segmento (B2B ou B2C) da regra.";
  if (escopo === "cliente" && !texto(corpo.clienteId) && !texto(corpo.clienteNome))
    return "Escolha o cliente do preço de contrato.";
  return "";
};

// Uma régua está "configurada" quando tem ao menos uma regra com preço > 0.
export const precoConfigurado = (regras = []) =>
  (Array.isArray(regras) ? regras : []).some((r) => num(r.precoPorKwh) > 0);

// Resolve o preço por kWh de uma recarga: cliente > segmento > base. Devolve a
// ORIGEM junto, para o cliente ver por que pagou aquele preço (contrato dele,
// tabela do segmento ou tabela pública). Sem regra aplicável, origem "sem-preco".
export const resolverPrecoKwh = (regras = [], { clienteId = "", segmento = "" } = {}) => {
  const lista = (Array.isArray(regras) ? regras : []).filter((r) => num(r.precoPorKwh) > 0);
  const cli = texto(clienteId);
  const seg = segmentoValido(segmento);

  const doCliente = cli && lista.find((r) => escopoValido(r.escopo) === "cliente" && texto(r.clienteId) === cli);
  if (doCliente) return { precoPorKwh: round(doCliente.precoPorKwh, 4), origem: "cliente" };

  const doSegmento = seg && lista.find((r) => escopoValido(r.escopo) === "segmento" && segmentoValido(r.segmento) === seg);
  if (doSegmento) return { precoPorKwh: round(doSegmento.precoPorKwh, 4), origem: "segmento" };

  const daBase = lista.find((r) => escopoValido(r.escopo) === "base");
  if (daBase) return { precoPorKwh: round(daBase.precoPorKwh, 4), origem: "base" };

  return { precoPorKwh: 0, origem: "sem-preco" };
};

// Cobrança de UMA sessão: kWh medido × preço resolvido. Sessão não faturável
// (em andamento, sem kWh ou sem cliente) devolve faturavel:false com o motivo —
// dizer "não cobra e por quê" é entrega, não erro.
export const cobrarSessao = (sessao = {}, regras = [], { segmentoPadrao = "" } = {}) => {
  const kwh = energiaMedida(sessao);
  if (!sessaoMedida(sessao))
    return { faturavel: false, motivo: "nao-medida", energiaKwh: kwh, valor: 0 };
  const clienteId = texto(sessao.clienteId);
  if (!clienteId && !texto(sessao.clienteNome))
    return { faturavel: false, motivo: "uso-interno", energiaKwh: kwh, valor: 0 };

  const seg = segmentoValido(sessao.segmento) || segmentoValido(segmentoPadrao);
  const { precoPorKwh, origem } = resolverPrecoKwh(regras, { clienteId, segmento: seg });
  if (!(precoPorKwh > 0))
    return { faturavel: false, motivo: "sem-preco", energiaKwh: kwh, valor: 0 };

  return {
    faturavel: true,
    energiaKwh: kwh,
    precoPorKwh,
    origem,
    valor: round(kwh * precoPorKwh),
    memoria: { base: "energia medida × preço por kWh", kwh, precoPorKwh, origem },
  };
};

// Faturamento agrupado por cliente numa janela de datas. Cada fatura soma as
// sessões faturáveis do cliente. Sessões não faturáveis entram num balde à
// parte (sem cobrar), para a tela mostrar o que ficou de fora e por quê.
export const faturamentoPorCliente = (sessoes = [], regras = [], { de = "", ate = "", segmentoPadrao = "" } = {}) => {
  const lista = Array.isArray(sessoes) ? sessoes : [];
  const dentro = (iso) => {
    const d = texto(iso).slice(0, 10);
    if (!d) return false;
    if (de && d < de) return false;
    if (ate && d > ate) return false;
    return true;
  };
  const faturas = new Map();
  let usoInterno = 0;
  let semPreco = 0;
  let totalGeral = 0;
  let energiaGeral = 0;

  for (const s of lista) {
    if ((de || ate) && !dentro(s.inicioEm)) continue;
    const cobranca = cobrarSessao(s, regras, { segmentoPadrao });
    if (!cobranca.faturavel) {
      if (cobranca.motivo === "uso-interno") usoInterno += 1;
      if (cobranca.motivo === "sem-preco") semPreco += 1;
      continue;
    }
    const chave = texto(s.clienteId) || texto(s.clienteNome);
    const atual = faturas.get(chave) || {
      clienteId: texto(s.clienteId),
      clienteNome: texto(s.clienteNome) || texto(s.clienteId),
      sessoes: 0,
      energiaKwh: 0,
      valor: 0,
    };
    atual.sessoes += 1;
    atual.energiaKwh = round(atual.energiaKwh + cobranca.energiaKwh, 3);
    atual.valor = round(atual.valor + cobranca.valor);
    faturas.set(chave, atual);
    totalGeral = round(totalGeral + cobranca.valor);
    energiaGeral = round(energiaGeral + cobranca.energiaKwh, 3);
  }

  return {
    faturas: [...faturas.values()].sort((a, b) => b.valor - a.valor),
    totalGeral: round(totalGeral),
    energiaGeral: round(energiaGeral, 1),
    usoInterno,
    semPreco,
    configurado: precoConfigurado(regras),
  };
};
