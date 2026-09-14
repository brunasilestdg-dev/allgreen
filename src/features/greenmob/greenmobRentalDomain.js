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

// ===== API pt-BR (fluxo operacional dentro do TDG) =====
// A API acima é a do CRM/frota da vertical /greenmob. Aqui embaixo mora o
// fluxo OPERACIONAL: contrato com avaria por momento (pré-existente vs.
// durante-locação), cobrança final derivada (mensalidade + km + avarias),
// devolução, isolamento por locatário e histórico do veículo dentro do
// contrato. Convive lado-a-lado porque cada consumidor usa uma; se um dia
// convergirem, faremos a fusão num só namespace — mas hoje as chamadas
// estão espalhadas por pontos distintos do produto.

export const arredondarReais = (v) => Math.round((asNumber(v) + Number.EPSILON) * 100) / 100;
const ymd = (v) => String(v || "").slice(0, 10);

export const ESTADO_CONTRATO = Object.freeze(["ativo", "em-devolucao", "devolvido", "cancelado"]);
export const AVARIA_MOMENTO = Object.freeze(["pre-existente", "durante-locacao"]);
export const AVARIA_STATUS = Object.freeze(["registrada", "aprovada-cobranca", "isenta", "reparada"]);

export const criarContrato = (bruto = {}) => ({
  id: String(bruto.id || `rental-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
  locatarioId: bruto.locatarioId || null,
  tenantId: bruto.tenantId || null,
  veiculoId: bruto.veiculoId || null,
  motoristaId: bruto.motoristaId || null,
  inicioYmd: ymd(bruto.inicioYmd),
  fimContratadoYmd: ymd(bruto.fimContratadoYmd),
  devolvidoEmYmd: ymd(bruto.devolvidoEmYmd),
  franquiaKmMes: Math.max(0, asNumber(bruto.franquiaKmMes)),
  precoMensalReais: Math.max(0, arredondarReais(bruto.precoMensalReais)),
  precoKmExcedenteReais: Math.max(0, arredondarReais(bruto.precoKmExcedenteReais)),
  kmSaida: Math.max(0, asNumber(bruto.kmSaida)),
  kmDevolucao: bruto.kmDevolucao != null ? Math.max(0, asNumber(bruto.kmDevolucao)) : null,
  socSaidaPct: bruto.socSaidaPct != null ? clamp(asNumber(bruto.socSaidaPct), 0, 100) : null,
  socDevolucaoPct: bruto.socDevolucaoPct != null ? clamp(asNumber(bruto.socDevolucaoPct), 0, 100) : null,
  estado: ESTADO_CONTRATO.includes(bruto.estado) ? bruto.estado : "ativo",
  avarias: Array.isArray(bruto.avarias) ? bruto.avarias : [],
  historico: Array.isArray(bruto.historico) ? bruto.historico : [],
});

export const registrarAvaria = (contrato, avaria = {}) => {
  const item = {
    id: String(avaria.id || `av-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    descricao: asText(avaria.descricao),
    momento: AVARIA_MOMENTO.includes(avaria.momento) ? avaria.momento : "durante-locacao",
    valorReparoReais: Math.max(0, arredondarReais(avaria.valorReparoReais)),
    status: AVARIA_STATUS.includes(avaria.status) ? avaria.status : "registrada",
    registradoEm: avaria.registradoEm || new Date().toISOString(),
    autor: asText(avaria.autor) || "operacao",
    evidencia: avaria.evidencia || null,
  };
  return { ...contrato, avarias: [...(contrato.avarias || []), item] };
};

const mesesEntre = (inicioYmd, fimYmd) => {
  const a = new Date(`${ymd(inicioYmd)}T00:00:00Z`);
  const b = new Date(`${ymd(fimYmd)}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  if (b < a) return 0;
  const dias = Math.ceil((b - a) / (24 * 3600000));
  // Um mês contratual = 30 dias corridos; frações arredondam PARA CIMA.
  return Math.max(1, Math.ceil(dias / 30));
};

export const kmRodados = (contrato) => {
  if (!contrato) return 0;
  const saida = asNumber(contrato.kmSaida);
  const dev = contrato.kmDevolucao != null ? asNumber(contrato.kmDevolucao) : null;
  if (dev == null) return 0;
  return Math.max(0, dev - saida);
};

// Cobrança consolidada ao devolver: mensalidade + km excedente + avarias
// registradas COMO "durante-locacao" (pré-existente NÃO cobra). Sem preço
// mensal configurado a mensalidade fica null (não invento).
export const cobrancaFinal = (contrato) => {
  if (!contrato) return null;
  const fim = contrato.devolvidoEmYmd || contrato.fimContratadoYmd || null;
  const meses = fim ? mesesEntre(contrato.inicioYmd, fim) : null;
  const mensalidade = contrato.precoMensalReais > 0 && meses
    ? arredondarReais(contrato.precoMensalReais * meses)
    : null;

  const km = kmRodados(contrato);
  const franquiaTotal = asNumber(contrato.franquiaKmMes) * (meses || 0);
  const excedenteKm = Math.max(0, km - franquiaTotal);
  const excedenteReais = contrato.precoKmExcedenteReais > 0
    ? arredondarReais(excedenteKm * contrato.precoKmExcedenteReais)
    : 0;

  const avariasCobradas = (contrato.avarias || []).filter(
    (a) => a.momento === "durante-locacao" && a.status !== "isenta",
  );
  const avariasReais = arredondarReais(
    avariasCobradas.reduce((s, a) => s + asNumber(a.valorReparoReais), 0),
  );

  const total = arredondarReais(asNumber(mensalidade) + excedenteReais + avariasReais);
  return {
    mesesCobrados: meses,
    mensalidadeReais: mensalidade,
    kmRodados: km,
    franquiaTotalKm: franquiaTotal,
    excedenteKm,
    excedenteReais,
    avariasCobradas: avariasCobradas.length,
    avariasReais,
    totalReais: mensalidade == null && excedenteReais === 0 && avariasReais === 0 ? null : total,
  };
};

export const registrarDevolucao = (contrato, dados = {}) => {
  if (!contrato) return contrato;
  const devolvidoEmYmd = ymd(dados.devolvidoEmYmd) || ymd(new Date().toISOString());
  return {
    ...contrato,
    devolvidoEmYmd,
    kmDevolucao: dados.kmDevolucao != null ? Math.max(0, asNumber(dados.kmDevolucao)) : contrato.kmDevolucao,
    socDevolucaoPct: dados.socDevolucaoPct != null ? clamp(asNumber(dados.socDevolucaoPct), 0, 100) : contrato.socDevolucaoPct,
    estado: "devolvido",
    historico: [
      ...(contrato.historico || []),
      {
        quando: dados.quando || new Date().toISOString(),
        acao: "devolucao",
        autor: asText(dados.autor) || "operacao",
      },
    ],
  };
};

// Isolamento: SÓ contratos daquele locatário (ou do tenant, se admin de
// plataforma). Nunca leia contratos sem passar por aqui — proteção contra
// vazamento entre locatários.
export const scopeContratosDoLocatario = (contratos = [], sessao) => {
  if (!sessao) return [];
  if (sessao.role === "plataforma_admin") return contratos;
  const arr = Array.isArray(contratos) ? contratos : [];
  return arr.filter((c) => {
    if (sessao.tenantId && c.tenantId && c.tenantId !== sessao.tenantId) return false;
    if (sessao.tenantAccountId && c.locatarioId && c.locatarioId !== sessao.tenantAccountId) return false;
    return true;
  });
};

export const historicoNaLocacao = (contrato, eventos = []) => {
  const ini = ymd(contrato?.inicioYmd);
  const fim = ymd(contrato?.devolvidoEmYmd || contrato?.fimContratadoYmd || new Date().toISOString());
  if (!ini) return [];
  return (Array.isArray(eventos) ? eventos : []).filter((e) => {
    if (!e?.veiculoId || e.veiculoId !== contrato.veiculoId) return false;
    const d = ymd(e.dataYmd);
    if (!d) return false;
    if (d < ini) return false;
    if (fim && d > fim) return false;
    return true;
  });
};
