// ===== Greenmob — Domínio de locação (contratos, frota, cobrança) =====
//
// Camada pura. Modela o ciclo de vida de um contrato de locação de veículo
// elétrico: veículo disponível → reservado → entregue/em locação → devolvido.
// A cobrança tem mensalidade + franquia de km + excedente + eventuais
// avarias. Regra-chave: nunca inventar km — se não houver leitura, o excedente
// não é calculado (retorna null com motivo), para o portal do locatário poder
// exibir "sem leitura" em vez de zero.

const asText = (value) => String(value ?? "").trim();

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

export const VEHICLE_STATUS = Object.freeze([
  "disponivel",
  "reservado",
  "em-preparacao",
  "locado",
  "manutencao",
  "avaria",
  "inativo",
]);

export const CONTRACT_STATUS = Object.freeze([
  "rascunho",
  "assinado",
  "reservado",
  "entregue",
  "ativo",
  "renovado",
  "devolvido",
  "cancelado",
]);

export const createRentalVehicle = (input = {}) => ({
  id: input.id || crypto.randomUUID(),
  plate: asText(input.plate).toUpperCase(),
  brand: asText(input.brand),
  model: asText(input.model),
  year: Math.max(0, Math.round(asNumber(input.year))) || null,
  color: asText(input.color),
  status: VEHICLE_STATUS.includes(input.status) ? input.status : "disponivel",
  batteryCapacityKwh: Math.max(0, asNumber(input.batteryCapacityKwh)),
  rangeKm: Math.max(0, asNumber(input.rangeKm)),
  odometerKm: Math.max(0, asNumber(input.odometerKm)),
  monthlyBaselineBRL: Math.max(0, asNumber(input.monthlyBaselineBRL)),
  createdAt: input.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  active: input.active !== false,
});

export const createRentalContract = (input = {}) => {
  const start = asText(input.startDate);
  const end = asText(input.endDate);
  return {
    id: input.id || crypto.randomUUID(),
    number: asText(input.number),
    clientName: asText(input.clientName),
    clientDocument: asText(input.clientDocument),
    vehicleId: asText(input.vehicleId),
    status: CONTRACT_STATUS.includes(input.status) ? input.status : "rascunho",
    startDate: start,
    endDate: end,
    // Mensalidade em BRL. Vem da cotação; sem valor definido não se calcula
    // fatura (o portal mostra "aguardando cotação").
    monthlyBRL: Math.max(0, asNumber(input.monthlyBRL)),
    // Franquia mensal de quilometragem incluída na mensalidade.
    monthlyKmAllowance: Math.max(0, Math.round(asNumber(input.monthlyKmAllowance))),
    // Preço por km excedente da franquia; sem valor não se cobra excedente.
    excessKmPriceBRL: Math.max(0, asNumber(input.excessKmPriceBRL)),
    // Km na entrega e na devolução — origem manual (vistoria) ou telemetria.
    handoverOdometerKm: input.handoverOdometerKm != null ? Math.max(0, asNumber(input.handoverOdometerKm)) : null,
    returnOdometerKm: input.returnOdometerKm != null ? Math.max(0, asNumber(input.returnOdometerKm)) : null,
    lastReadingSource: asText(input.lastReadingSource) || "manual",
    depositBRL: Math.max(0, asNumber(input.depositBRL)),
    notes: asText(input.notes),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

// Um contrato ocupa um veículo do momento em que é reservado até a devolução.
export const contractOccupiesVehicle = (contract) =>
  ["assinado", "reservado", "entregue", "ativo", "renovado"].includes(contract?.status);

export const isContractActive = (contract) =>
  ["entregue", "ativo", "renovado"].includes(contract?.status);

// Faturamento mensal de referência: soma da mensalidade dos contratos ativos.
// Excedente é cobrança extra (não previsível), não entra no MRR.
export const monthlyRecurringRevenue = (contracts = []) =>
  contracts.filter(isContractActive).reduce((total, c) => total + asNumber(c.monthlyBRL), 0);

// Status agregado da frota. Um veículo com contrato ocupando conta como
// ocupado mesmo que o cadastro diga "disponivel" — o contrato é a verdade.
export const fleetStatusSummary = (vehicles = [], contracts = []) => {
  const ativos = vehicles.filter((v) => v.active !== false);
  const ocupadosPorContrato = new Set(
    contracts.filter(contractOccupiesVehicle).map((c) => c.vehicleId),
  );
  const contarPorStatus = (predicate) =>
    ativos.filter(predicate).length;

  const disponiveis = ativos.filter(
    (v) => !ocupadosPorContrato.has(v.id) && v.status === "disponivel",
  ).length;
  const reservados = contracts.filter((c) => c.status === "reservado" || c.status === "assinado").length;
  const locados = contracts.filter((c) => c.status === "entregue" || c.status === "ativo" || c.status === "renovado").length;
  const manutencao = contarPorStatus((v) => v.status === "manutencao");
  const avaria = contarPorStatus((v) => v.status === "avaria");
  return {
    total: ativos.length,
    disponiveis,
    reservados,
    locados,
    manutencao,
    avaria,
    ocupacaoPercent: ativos.length > 0
      ? Math.round((locados / ativos.length) * 100)
      : 0,
  };
};

// Cálculo do excedente de km. Retorna sempre um objeto com origem do dado; se
// faltar leitura, `reason` explica e `excessKm` é null — para o app não fingir
// que "0 km" é a mesma coisa que "sem leitura" (item 43/11 do produto).
export const excessKmCharge = (contract, currentOdometerKm) => {
  const handover = contract?.handoverOdometerKm;
  const allowance = asNumber(contract?.monthlyKmAllowance);
  const price = asNumber(contract?.excessKmPriceBRL);

  if (handover == null || currentOdometerKm == null) {
    return {
      excessKm: null,
      chargeBRL: null,
      reason: "Sem leitura de odômetro",
      source: contract?.lastReadingSource || "manual",
    };
  }
  if (!(price > 0)) {
    return {
      excessKm: 0,
      chargeBRL: 0,
      reason: "Preço por km excedente não definido no contrato",
      source: contract?.lastReadingSource || "manual",
    };
  }
  const start = new Date(contract?.startDate || "").getTime();
  if (!Number.isFinite(start)) {
    return {
      excessKm: null,
      chargeBRL: null,
      reason: "Data de início do contrato inválida",
      source: contract?.lastReadingSource || "manual",
    };
  }
  const now = Date.now();
  const meses = Math.max(1, (now - start) / (1000 * 60 * 60 * 24 * 30));
  const franquiaTotal = allowance * meses;
  const rodados = Math.max(0, asNumber(currentOdometerKm) - asNumber(handover));
  const excedente = Math.max(0, Math.round(rodados - franquiaTotal));
  return {
    excessKm: excedente,
    chargeBRL: round2(excedente * price),
    reason: excedente > 0 ? "Quilometragem acima da franquia acumulada" : "Dentro da franquia",
    source: contract?.lastReadingSource || "manual",
  };
};

// Devolução: registra o odômetro final, muda o status do contrato e libera
// o veículo (deixa a decisão de reativar o veículo para o admin — pode voltar
// para manutenção antes de "disponivel").
export const registerReturn = (contract, { returnOdometerKm, source = "manual" } = {}) => ({
  ...contract,
  status: "devolvido",
  returnOdometerKm: returnOdometerKm != null ? Math.max(0, asNumber(returnOdometerKm)) : contract.returnOdometerKm,
  lastReadingSource: asText(source) || "manual",
  updatedAt: new Date().toISOString(),
});

// Utilização em % (locados/total ativos) já limitada a 0-100 para dashboard.
export const utilizationPercent = (fleetStatus) =>
  clamp(asNumber(fleetStatus?.ocupacaoPercent), 0, 100);
