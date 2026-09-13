// ===== Sessão de recarga (bloco 05 Charging/GreenOn · bloco 06 Energy) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// A sessão de recarga é o ÁTOMO que faltava. O cadastro de pontos
// (chargingPointsDomain) diz ONDE se recarrega; a energia (energyDomain) até
// aqui ESTIMAVA o consumo pelo hodômetro (km × kWh/km). A sessão fecha os dois:
// a energia MEDIDA de cada recarga, com ponto, veículo, motorista e horário —
// e, com um cliente vinculado, a base da cobrança por kWh (chargingBilling).
//
// Honestidade (regra da vertical):
//  - o kWh é MEDIDO (lido do medidor ou informado), não estimado — e só a
//    sessão CONCLUÍDA com kWh > 0 conta como medição; uma recarga em andamento
//    ainda não é consumo, e uma cancelada nunca foi;
//  - o custo é DERIVADO da tarifa na hora do início (smartChargingDomain),
//    nunca gravado — tarifa muda, e custo gravado envelhece calado;
//  - OCPP é a fonte AUTOMÁTICA futura, hoje DORMENTE (igual a SysPag e à
//    transmissão fiscal): a sessão nasce "manual" e o campo `fonte` deixa o
//    dado pronto para quando a central OCPP alimentar a medição sozinha.

import {
  TARIFA_BRANCA_PADRAO,
  faixaHoraria,
  tarifaNaHora,
} from "./smartChargingDomain.js";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const texto = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const round = (v, casas = 2) => {
  const f = 10 ** casas;
  return Math.round(num(v) * f) / f;
};

// Tarifa base padrão (R$/kWh) quando o espaço não informou a régua de energia.
// Espelha o default de energyDomain/smartChargingDomain — uma verdade só.
export const TARIFA_BASE_PADRAO = 0.92;

export const STATUS_SESSAO = Object.freeze(["em_andamento", "concluida", "cancelada"]);
// A fonte da medição. "manual" = alguém digitou o kWh; "ocpp" = veio da central
// de recarga (dormente até a integração ser ligada). Nunca inventar "ocpp".
export const FONTES_SESSAO = Object.freeze(["manual", "ocpp"]);

export const statusSessaoValido = (v) =>
  STATUS_SESSAO.includes(texto(v)) ? texto(v) : "em_andamento";

export const fonteSessaoValida = (v) =>
  FONTES_SESSAO.includes(texto(v)) ? texto(v) : "manual";

// A energia MEDIDA da sessão. Prioriza a leitura direta do kWh; se ela não veio
// mas há leitura de medidor (inicial/final), usa a diferença. Medidor que anda
// para trás não é medição — devolve 0, não um número negativo forjado.
export const energiaMedida = ({ energiaKwh, medidorInicial, medidorFinal } = {}) => {
  const direto = num(energiaKwh);
  if (direto > 0) return round(direto, 3);
  const ini = num(medidorInicial);
  const fim = num(medidorFinal);
  if (fim > ini) return round(fim - ini, 3);
  return 0;
};

// Duração em minutos entre início e fim. Sem as duas pontas válidas, ou fim
// antes do início, devolve null — duração negativa é dado torto, não zero.
export const duracaoMinutos = ({ inicioEm, fimEm } = {}) => {
  const ini = new Date(texto(inicioEm)).getTime();
  const fim = new Date(texto(fimEm)).getTime();
  if (!Number.isFinite(ini) || !Number.isFinite(fim)) return null;
  if (fim < ini) return null;
  return Math.round((fim - ini) / 60000);
};

// A hora (0–23) em que a recarga começou, para casar com a curva tarifária.
// Sem início válido, null — e o custo cai para a tarifa base sem faixa.
export const horaDeInicio = (inicioEm) => {
  const t = new Date(texto(inicioEm)).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).getHours();
};

// Corpo da API/tela → forma canônica. Rótulos (ponto, veículo, motorista,
// cliente) viajam junto do id para a tela não precisar cruzar tudo de novo.
export const normalizarSessao = (corpo = {}) => {
  const status = statusSessaoValido(corpo.status);
  const kwh = energiaMedida(corpo);
  return {
    pontoId: texto(corpo.pontoId, 120),
    pontoNome: texto(corpo.pontoNome, 200),
    veiculoId: texto(corpo.veiculoId, 120),
    veiculoRotulo: texto(corpo.veiculoRotulo, 120),
    motoristaId: texto(corpo.motoristaId, 120),
    motoristaNome: texto(corpo.motoristaNome, 160),
    clienteId: texto(corpo.clienteId, 120),
    clienteNome: texto(corpo.clienteNome, 200),
    // Segmento comercial da recarga (b2b/b2c), quando há cliente — decide a
    // tabela de preço na cobrança. Vazio = sem segmento (cai na base ou no
    // preço do próprio cliente).
    segmento: ["b2b", "b2c"].includes(texto(corpo.segmento).toLowerCase())
      ? texto(corpo.segmento).toLowerCase()
      : "",
    inicioEm: texto(corpo.inicioEm, 40),
    fimEm: texto(corpo.fimEm, 40),
    energiaKwh: kwh,
    medidorInicial: Math.max(0, num(corpo.medidorInicial)),
    medidorFinal: Math.max(0, num(corpo.medidorFinal)),
    status,
    fonte: fonteSessaoValida(corpo.fonte),
    observacao: texto(corpo.observacao, 500),
  };
};

// Validação única — a mesma da tela e do servidor, para o botão não liberar o
// que o servidor recusa.
export const validarSessao = (corpo = {}) => {
  if (!texto(corpo.pontoId) && !texto(corpo.pontoNome))
    return "Escolha em qual ponto de recarga a sessão aconteceu.";
  if (!texto(corpo.inicioEm)) return "Informe quando a recarga começou.";
  const status = statusSessaoValido(corpo.status);
  const dur = duracaoMinutos(corpo);
  if (texto(corpo.fimEm) && dur === null)
    return "O fim da recarga não pode ser antes do início.";
  // Concluída sem energia medida não é medição: a recarga real moveu kWh.
  if (status === "concluida" && !(energiaMedida(corpo) > 0))
    return "Uma recarga concluída precisa da energia medida (kWh) — é o que a diferencia da estimativa.";
  if (num(corpo.energiaKwh) < 0) return "A energia medida não pode ser negativa.";
  return "";
};

// Custo DERIVADO da sessão pela tarifa na hora do início. Sem energia medida,
// custo zero — mas o objeto sempre traz a faixa/tarifa para a tela explicar de
// onde sai o número. `base` é a tarifa R$/kWh do espaço (régua de energia).
export const custoDaSessao = (sessao = {}, { base, tarifa = TARIFA_BRANCA_PADRAO } = {}) => {
  const tarifaBase = num(base) > 0 ? num(base) : TARIFA_BASE_PADRAO;
  const kwh = energiaMedida(sessao);
  const hora = horaDeInicio(sessao.inicioEm);
  // Sem hora válida, cai na tarifa base (fora de ponta) — honesto: não finge
  // uma faixa que não sabe.
  const faixa = hora == null ? "fora-ponta" : faixaHoraria(hora, tarifa);
  const tarifaKwh = hora == null
    ? round(tarifaBase, 4)
    : tarifaNaHora(tarifaBase, hora, tarifa);
  return {
    energiaKwh: kwh,
    faixa,
    tarifaKwh,
    custo: round(kwh * tarifaKwh),
  };
};

// A sessão é "medição" (conta como energia medida e pode ser faturada) quando
// está concluída e moveu kWh. Em andamento ou cancelada, não.
export const sessaoMedida = (sessao = {}) =>
  statusSessaoValido(sessao.status) === "concluida" && energiaMedida(sessao) > 0;

// Resumo da operação de recarga — tudo derivado, nada gravado. Custo usa a
// tarifa por faixa de cada sessão (recarga de madrugada custa menos que a de
// fim de tarde), não uma tarifa média chapada.
export const resumoSessoes = (sessoes = [], { base, tarifa = TARIFA_BRANCA_PADRAO } = {}) => {
  const lista = Array.isArray(sessoes) ? sessoes : [];
  let energiaKwh = 0;
  let custoEstimado = 0;
  let medidas = 0;
  const porPonto = {};
  const porVeiculo = {};
  let ultimaEm = "";
  for (const s of lista) {
    if (texto(s.inicioEm) > ultimaEm) ultimaEm = texto(s.inicioEm);
    if (!sessaoMedida(s)) continue;
    const c = custoDaSessao(s, { base, tarifa });
    energiaKwh += c.energiaKwh;
    custoEstimado += c.custo;
    medidas += 1;
    const ponto = texto(s.pontoNome) || texto(s.pontoId) || "Sem ponto";
    porPonto[ponto] = round((porPonto[ponto] || 0) + c.energiaKwh, 3);
    const veic = texto(s.veiculoRotulo) || texto(s.veiculoId);
    if (veic) porVeiculo[veic] = round((porVeiculo[veic] || 0) + c.energiaKwh, 3);
  }
  return {
    total: lista.length,
    concluidas: lista.filter((s) => statusSessaoValido(s.status) === "concluida").length,
    emAndamento: lista.filter((s) => statusSessaoValido(s.status) === "em_andamento").length,
    canceladas: lista.filter((s) => statusSessaoValido(s.status) === "cancelada").length,
    medidas,
    energiaKwh: round(energiaKwh, 1),
    custoEstimado: round(custoEstimado),
    porPonto,
    porVeiculo,
    ultimaEm,
  };
};

// Energia MEDIDA por veículo numa janela de datas — é isto que a Gestão de
// Energia usa para mostrar o consumo real ao lado do estimado. Sem janela,
// considera tudo. Datas comparadas como texto ISO (YYYY-MM-DD...), estável ao
// fuso de quem abre a tela.
export const energiaMedidaPorVeiculo = (sessoes = [], { de = "", ate = "" } = {}) => {
  const lista = Array.isArray(sessoes) ? sessoes : [];
  const dentro = (iso) => {
    const d = texto(iso).slice(0, 10);
    if (!d) return false;
    if (de && d < de) return false;
    if (ate && d > ate) return false;
    return true;
  };
  const mapa = new Map();
  for (const s of lista) {
    if (!sessaoMedida(s)) continue;
    if ((de || ate) && !dentro(s.inicioEm)) continue;
    const id = texto(s.veiculoId) || texto(s.veiculoRotulo);
    if (!id) continue;
    const atual = mapa.get(id) || {
      veiculoId: texto(s.veiculoId),
      rotulo: texto(s.veiculoRotulo) || texto(s.veiculoId),
      energiaKwh: 0,
      sessoes: 0,
    };
    atual.energiaKwh = round(atual.energiaKwh + energiaMedida(s), 3);
    atual.sessoes += 1;
    mapa.set(id, atual);
  }
  return [...mapa.values()].sort((a, b) => b.energiaKwh - a.energiaKwh);
};

// Total de energia medida numa janela (para o painel de energia cruzar com a
// estimativa). Derivado, nunca gravado.
export const totalEnergiaMedida = (sessoes = [], janela = {}) =>
  round(
    energiaMedidaPorVeiculo(sessoes, janela).reduce((soma, v) => soma + v.energiaKwh, 0),
    1,
  );
