// ===== Estimativa de energia e autonomia da rota (ELÉTRICO) =====
// Camada PURA, DETERMINÍSTICA e AUDITÁVEL. Sem banco, sem rede, sem DOM, sem IA.
//
// Por que este arquivo existe:
//
// O `planElectricRoute` (worker/services/todogreen-electric-routing.js) já
// decide ONDE recarregar, mas o cálculo de energia dele é plano: km × consumo,
// sem elevação, sem temperatura, sem estado de saúde da bateria (SoH), e sem
// devolver um resultado ESTRUTURADO que diga de onde veio cada número e com
// que confiança. A viabilidade comercial (snapshot), o pré-flight e o Smart
// Charging precisam justamente disso: um resultado versionado, com proveniência
// e confiança, que NUNCA se apresente como medição quando é estimativa.
//
// Regras que este arquivo respeita (do guia do projeto):
//  - Não inventar dado: elevação/temperatura ausentes viram `null` + premissa
//    registrada e confiança menor — não viram 0 silencioso nem chute.
//  - Diferenciar MEDIDO de ESTIMADO: este módulo SEMPRE devolve ESTIMATED; o
//    consumo pode nascer de histórico medido do veículo (marcado nas premissas),
//    mas a projeção da rota é estimativa por definição.
//  - Determinístico e explicável: cada kWh tem uma rubrica em `breakdown` e cada
//    suposição uma linha em `assumptions`.
//
// O formato de saída segue o contrato pedido para o snapshot de viabilidade:
// distanceKm, durationMinutes, elevationGainM, elevationLossM,
// estimatedEnergyKwh, initialSoc, estimatedArrivalSoc, minimumSoc, reserveSoc,
// chargingRequired, estimatedConsumptionKwhKm, confidence, assumptions, source,
// calculationVersion.

export const ENERGY_MODEL_VERSION = "energy-model@1.0.0";

// Constantes físicas/operacionais. Valores conservadores e documentados.
const GRAVITY = 9.80665; // m/s²
const DRIVETRAIN_EFFICIENCY = 0.9; // motor+inversor+transmissão na subida
const DEFAULT_REGEN_EFFICIENCY = 0.6; // fração da energia potencial recuperada na descida (quando há regen)
// Massa (curb weight) padrão por classe quando o veículo não informa a sua.
// Só entra como PREMISSA registrada — nunca sobrescreve peso informado.
const DEFAULT_CURB_WEIGHT_KG = {
  moto: 180,
  motorcycle: 180,
  car: 1600,
  carro: 1600,
  van: 2800,
  vuc: 3500,
  truck: 9000,
  caminhao: 9000,
  "caminhão": 9000,
  toco: 9000,
  truck34: 6500,
  carreta: 17000,
  semi: 17000,
};
const FALLBACK_CURB_WEIGHT_KG = 2000;

// Temperatura: fora da faixa de conforto o consumo sobe (HVAC + química da
// bateria). Curva linear conservadora, teto em +35%.
const COMFORT_MIN_C = 15;
const COMFORT_MAX_C = 30;
const COLD_PENALTY_PER_C = 0.015; // +1,5% de consumo por °C abaixo de 15
const HEAT_PENALTY_PER_C = 0.008; // +0,8% de consumo por °C acima de 30
const MAX_TEMPERATURE_PENALTY = 0.35;

const finite = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, casas = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
};

// Consumo base em kWh/km, aceitando kWh/km OU kWh/100km (o resto do domínio
// usa as duas convenções).
function baseConsumptionKwhPerKm(vehicle) {
  const perKm = finite(vehicle.consumptionKwhPerKm ?? vehicle.energyConsumptionKwhPerKm);
  if (perKm && perKm > 0) return { value: perKm, measured: !!vehicle.consumptionMeasured };
  const per100 = finite(vehicle.consumptionKwhPer100Km ?? vehicle.consumptionKwh100Km);
  if (per100 && per100 > 0) return { value: per100 / 100, measured: !!vehicle.consumptionMeasured };
  return { value: null, measured: false };
}

/**
 * Estima energia e autonomia de UMA rota concreta para UM veículo elétrico.
 * Determinístico. Devolve um resultado versionado com proveniência e confiança.
 *
 * @returns {{status:"ok"|"invalid", ...}}
 */
export function estimateRouteEnergy(input = {}) {
  const vehicle = input.vehicle || {};
  const route = input.route || {};
  const assumptionOverrides = input.assumptions || {};
  const assumptions = [];

  const distanceKm = finite(route.distanceKm);
  if (!distanceKm || distanceKm <= 0)
    return invalid("route_distance_required");

  const base = baseConsumptionKwhPerKm(vehicle);
  if (!base.value)
    return invalid("consumption_required");

  const batteryCapacityKwh = finite(vehicle.batteryCapacityKwh);
  if (!batteryCapacityKwh || batteryCapacityKwh <= 0)
    return invalid("battery_capacity_required");

  // ---- Capacidade utilizável: SoH degrada a bateria ----
  let sohPercent = finite(vehicle.sohPercent ?? vehicle.batterySohPercent);
  if (sohPercent === null) {
    sohPercent = 100;
    assumptions.push("soh_presumido_100pct");
  }
  sohPercent = clamp(sohPercent, 1, 100);
  const usableCapacityKwh = batteryCapacityKwh * sohPercent / 100;

  const initialSoc = clamp(finite(vehicle.socPercent, 100), 0, 100);
  let reservePercent = finite(vehicle.reservePercent ?? vehicle.minReservePercent);
  if (reservePercent === null) {
    reservePercent = 15;
    assumptions.push("reserva_operacional_presumida_15pct");
  }
  reservePercent = clamp(reservePercent, 0, 95);

  // ---- Penalidade de carga (payload) ----
  const payloadKg = Math.max(0, finite(vehicle.payloadKg, 0));
  const maxPayloadKg = Math.max(0, finite(vehicle.maxPayloadKg, 0));
  const loadPenaltyPercent = clamp(finite(vehicle.loadPenaltyPercent, 0), 0, 100);
  const loadRatio = maxPayloadKg ? clamp(payloadKg / maxPayloadKg, 0, 1.5) : 0;
  if (payloadKg > 0 && !maxPayloadKg) assumptions.push("carga_util_maxima_desconhecida_sem_penalidade_de_carga");
  const payloadFactor = 1 + (loadRatio * loadPenaltyPercent) / 100;

  // ---- Penalidade de temperatura ----
  const temperatureC = finite(route.temperatureC ?? route.temperaturaC);
  let temperatureFactor = 1;
  if (temperatureC === null) {
    assumptions.push("temperatura_nao_informada_sem_penalidade_termica");
  } else if (temperatureC < COMFORT_MIN_C) {
    temperatureFactor = 1 + Math.min(MAX_TEMPERATURE_PENALTY, (COMFORT_MIN_C - temperatureC) * COLD_PENALTY_PER_C);
  } else if (temperatureC > COMFORT_MAX_C) {
    temperatureFactor = 1 + Math.min(MAX_TEMPERATURE_PENALTY, (temperatureC - COMFORT_MAX_C) * HEAT_PENALTY_PER_C);
  }

  // ---- Trânsito (opcional, multiplicador direto e explícito) ----
  const trafficFactor = clamp(finite(route.trafficFactor, 1), 1, 3);
  if (finite(route.trafficFactor) === null) assumptions.push("transito_nao_informado_fator_neutro");

  // Consumo ajustado (rodagem, sem elevação): base × carga × temperatura × trânsito
  const adjustedConsumptionKwhPerKm = base.value * payloadFactor * temperatureFactor * trafficFactor;
  const rollingEnergyKwh = distanceKm * adjustedConsumptionKwhPerKm;
  const baseEnergyKwh = distanceKm * base.value;

  // ---- Elevação: energia potencial na subida, regeneração na descida ----
  const elevationGainM = finite(route.elevationGainM ?? route.elevationGainMeters);
  const elevationLossM = finite(route.elevationLossM ?? route.elevationLossMeters);
  const hasElevation = elevationGainM !== null || elevationLossM !== null;
  if (!hasElevation) assumptions.push("elevacao_nao_informada_perfil_plano_assumido");

  let massKg = finite(vehicle.curbWeightKg ?? vehicle.grossWeightKg);
  if (massKg === null) {
    const cat = String(vehicle.category || vehicle.classe || "").trim().toLowerCase();
    massKg = DEFAULT_CURB_WEIGHT_KG[cat] || FALLBACK_CURB_WEIGHT_KG;
    assumptions.push(`massa_do_veiculo_presumida_${massKg}kg`);
  }
  massKg += payloadKg; // a carga sobe o morro junto

  const gainM = Math.max(0, elevationGainM ?? 0);
  const lossM = Math.max(0, elevationLossM ?? 0);
  // PE = m·g·h [J]; ÷3,6e6 → kWh; ÷ eficiência do trem de força na subida.
  const climbEnergyKwh = (massKg * GRAVITY * gainM) / 3.6e6 / DRIVETRAIN_EFFICIENCY;
  const regenEnabled = vehicle.regenEnabled !== false; // elétricos regeneram por padrão
  const regenEfficiency = regenEnabled
    ? clamp(finite(vehicle.regenEfficiency, DEFAULT_REGEN_EFFICIENCY), 0, 0.9)
    : 0;
  if (!regenEnabled) assumptions.push("regeneracao_desativada_para_este_veiculo");
  const regenRecoveredKwh = (massKg * GRAVITY * lossM) / 3.6e6 * regenEfficiency;

  // Energia total: rodagem + subida − regeneração. Piso de segurança: nunca
  // menos que metade da energia de rodagem (regen não cria energia do nada).
  const rawEnergyKwh = rollingEnergyKwh + climbEnergyKwh - regenRecoveredKwh;
  const estimatedEnergyKwh = Math.max(rollingEnergyKwh * 0.5, rawEnergyKwh);
  const estimatedConsumptionKwhKm = estimatedEnergyKwh / distanceKm;

  // ---- Duração ----
  let durationMinutes = finite(route.durationMinutes);
  if (durationMinutes === null) {
    const avgSpeed = finite(route.averageSpeedKmh, 45) || 45;
    durationMinutes = (distanceKm / avgSpeed) * 60;
    assumptions.push(`duracao_estimada_por_velocidade_media_${round(avgSpeed, 0)}kmh`);
  }

  // ---- SOC ----
  const initialEnergyKwh = usableCapacityKwh * initialSoc / 100;
  const arrivalEnergyKwh = initialEnergyKwh - estimatedEnergyKwh;
  const estimatedArrivalSoc = usableCapacityKwh > 0 ? (arrivalEnergyKwh / usableCapacityKwh) * 100 : 0;
  // Sem perfil segmentado, o menor SOC da viagem é o de chegada (descida
  // monotônica). Registramos a premissa para não passar precisão que não temos.
  const minimumSoc = estimatedArrivalSoc;
  assumptions.push("soc_minimo_igual_ao_de_chegada_sem_perfil_segmentado");
  const chargingRequired = estimatedArrivalSoc < reservePercent;

  // ---- Confiança ----
  const confidence = scoreConfidence({
    consumptionMeasured: base.measured,
    hasElevation,
    hasTemperature: temperatureC !== null,
    hasSoh: finite(vehicle.sohPercent ?? vehicle.batterySohPercent) !== null,
    hasDuration: finite(route.durationMinutes) !== null,
  });

  const measurementType = "ESTIMATED";
  const source = String(assumptionOverrides.source || "energy-model");

  return {
    status: "ok",
    distanceKm: round(distanceKm, 1),
    durationMinutes: round(durationMinutes, 0),
    elevationGainM: elevationGainM === null ? null : round(gainM, 0),
    elevationLossM: elevationLossM === null ? null : round(lossM, 0),
    estimatedEnergyKwh: round(estimatedEnergyKwh, 2),
    initialSoc: round(initialSoc, 1),
    estimatedArrivalSoc: round(estimatedArrivalSoc, 1),
    minimumSoc: round(minimumSoc, 1),
    reserveSoc: round(reservePercent, 1),
    chargingRequired,
    estimatedConsumptionKwhKm: round(estimatedConsumptionKwhKm, 3),
    confidence,
    measurementType,
    assumptions,
    source,
    calculationVersion: ENERGY_MODEL_VERSION,
    breakdown: {
      baseEnergyKwh: round(baseEnergyKwh, 2),
      rollingEnergyKwh: round(rollingEnergyKwh, 2),
      climbEnergyKwh: round(climbEnergyKwh, 2),
      regenRecoveredKwh: round(regenRecoveredKwh, 2),
      payloadFactor: round(payloadFactor, 3),
      temperatureFactor: round(temperatureFactor, 3),
      trafficFactor: round(trafficFactor, 3),
      usableCapacityKwh: round(usableCapacityKwh, 2),
      massKg: round(massKg, 0),
    },
  };
}

function invalid(reason) {
  return {
    status: "invalid",
    reason,
    source: "energy-model",
    calculationVersion: ENERGY_MODEL_VERSION,
    measurementType: "ESTIMATED",
  };
}

// Confiança da estimativa. Começa em MEDIUM (temos consumo + bateria + distância)
// e sobe/desce conforme os dados que sustentam a projeção.
function scoreConfidence({ consumptionMeasured, hasElevation, hasTemperature, hasSoh, hasDuration }) {
  let score = 0;
  if (consumptionMeasured) score += 2; else score += 1; // consumo estimado ainda conta, medido conta mais
  if (hasElevation) score += 1;
  if (hasTemperature) score += 1;
  if (hasSoh) score += 1;
  if (hasDuration) score += 1;
  if (score >= 5) return "HIGH";
  if (score >= 3) return "MEDIUM";
  if (score >= 1) return "LOW";
  return "UNKNOWN";
}

export const __test__ = { scoreConfidence, baseConsumptionKwhPerKm, DEFAULT_CURB_WEIGHT_KG };
