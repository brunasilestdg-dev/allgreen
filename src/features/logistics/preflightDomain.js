// ===== Pré-flight operacional (PASS / WARNING / BLOCK) =====
// Camada PURA e DETERMINÍSTICA. Sem banco, sem rede, sem DOM, sem IA.
//
// Fluxo do produto (seção 18): a ROTEIRIZAÇÃO vem antes. A rota concreta já
// existe; o pré-flight pergunta "esta rota, com ESTE motorista e ESTE veículo,
// pode ser executada AGORA?". Resultado por checagem: PASS, WARNING ou BLOCK.
// BLOCK impede publicar; WARNING permite decisão autorizada (com auditoria).
//
// Seção 20: não basta dizer "erro de autonomia". Quando falha, o pré-flight
// SUGERE solução CALCULADA — trocar veículo (avaliado pelo mesmo modelo de
// energia), inserir recarga (minutos calculados pelo déficit e pela potência),
// reduzir carga ou dividir a viagem. Nada de sugestão vaga.
//
// Consome o resultado de estimateRouteEnergy (SOC de chegada, energia,
// necessidade de recarga, confiança) — a mesma fonte da viabilidade.

import { estimateRouteEnergy } from "./energyEstimationDomain.js";

export const SEVERITY = Object.freeze({ PASS: "PASS", WARNING: "WARNING", BLOCK: "BLOCK" });
// Rótulo humano do status, para a tela não mostrar o código cru.
export const ROTULO_STATUS_PREFLIGHT = Object.freeze({ PASS: "liberado", WARNING: "com alertas", BLOCK: "bloqueado" });
const RANK = { PASS: 0, WARNING: 1, BLOCK: 2 };

const num = (v, fb = null) => {
  if (v === null || v === undefined || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};
const round = (v, c = 1) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** c;
  return Math.round(n * f) / f;
};

const check = (id, label, severity, reason = "", extra = {}) => ({ id, label, severity, reason, ...extra });

// Energia disponível (start→reserva) e déficit para concluir a rota.
function energyBudget(vehicle, energy) {
  const capacity = num(vehicle.batteryCapacityKwh, 0) || 0;
  const soh = num(vehicle.sohPercent ?? vehicle.batterySohPercent, 100) || 100;
  const soc = num(vehicle.socPercent, 100) || 100;
  const reserve = num(vehicle.reservePercent ?? vehicle.minReservePercent, 15) || 15;
  const usable = capacity * (soh / 100);
  const startKwh = usable * (soc / 100);
  const reserveKwh = usable * (reserve / 100);
  const needKwh = num(energy?.estimatedEnergyKwh, 0) || 0;
  const availableKwh = startKwh - reserveKwh;
  return { usable, startKwh, reserveKwh, needKwh, availableKwh, deficitKwh: Math.max(0, needKwh - availableKwh) };
}

// Sugestões CALCULADAS quando a autonomia não fecha.
function autonomySuggestions({ vehicle, energy, route, alternatives = {} }) {
  const suggestions = [];
  const budget = energyBudget(vehicle, energy);

  // A) Inserir recarga: minutos calculados pelo déficit e pela melhor potência.
  const chargers = Array.isArray(alternatives.chargers) ? alternatives.chargers : [];
  const bestPowerKw = chargers.reduce((m, c) => Math.max(m, num(c.powerKw ?? c.effectivePowerKw, 0) || 0), 0);
  if (budget.deficitKwh > 0 && bestPowerKw > 0) {
    const minutes = (budget.deficitKwh / (bestPowerKw * 0.9)) * 60;
    suggestions.push({
      type: "insert_charge",
      chargeKwh: round(budget.deficitKwh, 2),
      powerKw: round(bestPowerKw, 0),
      minutes: round(minutes, 0),
      text: `Inserir recarga de ~${round(minutes, 0)} min (${round(budget.deficitKwh, 1)} kWh a ${round(bestPowerKw, 0)} kW) para manter a reserva.`,
    });
  }

  // B) Trocar veículo: cada alternativa é avaliada pelo MESMO modelo de energia
  // na MESMA rota; sugere a que chega mantendo a reserva, com maior folga.
  const altVehicles = Array.isArray(alternatives.vehicles) ? alternatives.vehicles : [];
  const viable = altVehicles
    .map((alt) => {
      const est = estimateRouteEnergy({ vehicle: alt, route });
      return { alt, est };
    })
    .filter(({ est }) => est.status === "ok" && !est.chargingRequired)
    .sort((a, b) => b.est.estimatedArrivalSoc - a.est.estimatedArrivalSoc);
  if (viable.length) {
    const best = viable[0];
    suggestions.push({
      type: "swap_vehicle",
      vehicleId: best.alt.id || best.alt.plate || "",
      arrivalSoc: best.est.estimatedArrivalSoc,
      text: `Usar ${best.alt.id || best.alt.plate || "outro veículo"} — conclui a rota com ~${best.est.estimatedArrivalSoc}% de SOC, acima da reserva.`,
    });
  }

  // C) Reduzir carga: só quando há penalidade de carga configurada (senão a
  // carga não muda o consumo neste modelo). Estima a redução de kWh por kg.
  const maxPayload = num(vehicle.maxPayloadKg, 0) || 0;
  const payload = num(vehicle.payloadKg, 0) || 0;
  const penalty = num(vehicle.loadPenaltyPercent, 0) || 0;
  if (budget.deficitKwh > 0 && maxPayload > 0 && penalty > 0 && payload > 0) {
    suggestions.push({
      type: "reduce_load",
      text: `Reduzir a carga diminui o consumo (penalidade de ${penalty}% na carga máxima) — reavaliar com menos ${Math.min(payload, round(payload * 0.2, 0))} kg.`,
    });
  }

  // D) Dividir a viagem sempre é uma saída operacional quando nada acima fecha.
  if (budget.deficitKwh > 0) {
    suggestions.push({
      type: "split_trip",
      text: "Dividir a viagem em dois trechos com recarga entre eles.",
    });
  }
  return suggestions;
}

// Motivos do estimateRouteEnergy em linguagem de operação.
const MOTIVO_ENERGIA = Object.freeze({
  route_distance_required: "a rota não tem distância",
  consumption_required: "o veículo não tem consumo (kWh/km) cadastrado",
  battery_capacity_required: "o veículo não tem capacidade de bateria cadastrada",
});

/**
 * Roda o pré-flight. Devolve { status, blocked, checks[], suggestions[] }.
 * status = pior severidade das checagens. blocked = há algum BLOCK.
 */
export function runPreflight(input = {}) {
  const checks = [];
  const vehicle = input.vehicle || {};
  const driver = input.driver || {};
  const load = input.load || {};
  const route = input.route || {};
  const charging = input.charging || {};
  const energy = input.energyEstimate && input.energyEstimate.status === "ok" ? input.energyEstimate : null;

  // ---- Motorista ----
  // `unavailableReason` deixa o cadastro explicar (alocado, afastado, não
  // encontrado) em vez do genérico. `licenseUnknown` é o caso honesto de CNH
  // sem validade cadastrada: não bloqueia, mas não passa em silêncio.
  if (driver.available === false) checks.push(check("driver_available", "Motorista disponível", SEVERITY.BLOCK, driver.unavailableReason || "Motorista indisponível."));
  else if (driver.licenseValid === false) checks.push(check("driver_license", "Habilitação do motorista", SEVERITY.BLOCK, "CNH inválida ou vencida."));
  else if (driver.journeyOk === false) checks.push(check("driver_journey", "Jornada do motorista", SEVERITY.BLOCK, "Jornada estouraria os limites."));
  else if (driver.licenseUnknown === true) checks.push(check("driver_license_unknown", "Habilitação do motorista", SEVERITY.WARNING, "Validade da CNH não cadastrada — confirme antes de liberar."));
  else if (driver.trainingOk === false) checks.push(check("driver_training", "Treinamento do motorista", SEVERITY.WARNING, "Treinamento pendente."));
  else checks.push(check("driver", "Motorista", SEVERITY.PASS));

  // ---- Veículo ----
  // Sem veículo da frota não há como verificar capacidade nem autonomia: é
  // alerta explícito, não PASS por omissão.
  if (vehicle.unknown === true) checks.push(check("vehicle_unknown", "Veículo da frota", SEVERITY.WARNING, "Sem veículo da frota informado — capacidade e autonomia não verificadas."));
  else if (vehicle.available === false) checks.push(check("vehicle_available", "Veículo disponível", SEVERITY.BLOCK, vehicle.unavailableReason || "Veículo indisponível."));
  else if (vehicle.docsOk === false) checks.push(check("vehicle_docs", "Documentação do veículo", SEVERITY.BLOCK, "Documentação do veículo irregular."));
  else if (vehicle.maintenanceOk === false) checks.push(check("vehicle_maintenance", "Manutenção do veículo", SEVERITY.WARNING, "Manutenção pendente."));
  else checks.push(check("vehicle", "Veículo", SEVERITY.PASS));

  // ---- Capacidade ----
  const capChecks = [
    ["weight", "Peso", num(load.weightKg), num(vehicle.capacityKg)],
    ["volume", "Volume", num(load.volumeM3), num(vehicle.capacityM3)],
    ["pallet", "Pallets", num(load.pallets), num(vehicle.palletCapacity)],
  ];
  let capBlocked = false;
  for (const [id, label, need, cap] of capChecks) {
    if (need !== null && cap !== null && need > cap) {
      capBlocked = true;
      checks.push(check(`capacity_${id}`, `Capacidade — ${label}`, SEVERITY.BLOCK, `${label} da carga (${need}) excede a do veículo (${cap}).`));
    }
  }
  if (!capBlocked) checks.push(check("capacity", "Capacidade", SEVERITY.PASS));

  // ---- Energia / autonomia ----
  let autonomySugs = [];
  if (energy) {
    const chargerAvailable = charging.available !== false
      && (Array.isArray(input.alternatives?.chargers) ? input.alternatives.chargers.length > 0 : false);
    if (energy.chargingRequired && !chargerAvailable) {
      autonomySugs = autonomySuggestions({ vehicle, energy, route, alternatives: input.alternatives });
      checks.push(check("energy", "Autonomia / energia", SEVERITY.BLOCK,
        `Veículo não conclui a rota mantendo a reserva de ${energy.reserveSoc}% (chegada ~${energy.estimatedArrivalSoc}%).`,
        { arrivalSoc: energy.estimatedArrivalSoc, reserveSoc: energy.reserveSoc }));
    } else if (energy.chargingRequired && chargerAvailable) {
      autonomySugs = autonomySuggestions({ vehicle, energy, route, alternatives: input.alternatives });
      checks.push(check("energy", "Autonomia / energia", SEVERITY.WARNING,
        `Rota exige recarga no trajeto (chegada ~${energy.estimatedArrivalSoc}% sem recarregar).`,
        { arrivalSoc: energy.estimatedArrivalSoc, reserveSoc: energy.reserveSoc }));
    } else {
      checks.push(check("energy", "Autonomia / energia", SEVERITY.PASS, "",
        { arrivalSoc: energy.estimatedArrivalSoc, reserveSoc: energy.reserveSoc }));
    }
    // Confiança baixa da estimativa é um alerta, não bloqueio.
    if (energy.confidence === "LOW" || energy.confidence === "UNKNOWN") {
      checks.push(check("energy_confidence", "Confiança da estimativa de energia", SEVERITY.WARNING,
        `Estimativa de energia com confiança ${energy.confidence} — dados de apoio insuficientes.`));
    }
  } else if (input.energyEstimate && input.energyEstimate.status === "invalid" && vehicle.unknown !== true) {
    // Havia veículo e rota, mas faltou dado (bateria, consumo, distância): a
    // autonomia NÃO foi verificada — alerta com o motivo, nunca PASS implícito.
    checks.push(check("energy_unknown", "Autonomia / energia", SEVERITY.WARNING,
      `Autonomia não verificada: ${MOTIVO_ENERGIA[input.energyEstimate.reason] || input.energyEstimate.reason || "dados insuficientes"}.`));
  }

  // ---- SLA / janela ----
  if (route.windowOk === false) checks.push(check("window", "Janela de entrega", SEVERITY.WARNING, "Janela apertada para o tempo estimado."));
  if (route.slaOk === false) checks.push(check("sla", "SLA", SEVERITY.WARNING, "Risco de estouro de SLA."));

  const status = checks.reduce((worst, c) => (RANK[c.severity] > RANK[worst] ? c.severity : worst), SEVERITY.PASS);
  return {
    status,
    blocked: status === SEVERITY.BLOCK,
    checks,
    suggestions: autonomySugs,
  };
}

// ===== Assinatura da rota (paradas + motorista + veículo) =====
// Amarra um resultado de pré-flight ao par EXATO que ele avaliou. Coordenada
// arredondada a 4 casas (~11 m); sem coordenada, vale o rótulo normalizado.
// Reordenar/trocar parada, motorista ou veículo muda a assinatura; um clique a
// mais na mesma tela, não. Puro e determinístico: a tela e o servidor calculam
// a mesma coisa e o servidor não confia na assinatura enviada.
const fnv1a = (texto) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};
const chaveDaParada = (parada) => {
  const lat = Number(parada?.lat);
  const lng = Number(parada?.lng ?? parada?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat.toFixed(4)},${lng.toFixed(4)}`;
  return String(parada?.rotulo || parada?.endereco || parada?.label || "").trim().toLowerCase().replace(/\s+/g, " ");
};
export function routeFingerprint({ stops = [], driverId = "", vehicleKey = "" } = {}) {
  const partes = [
    String(driverId || "").trim(),
    String(vehicleKey || "").trim().toUpperCase(),
    ...(Array.isArray(stops) ? stops : []).map(chaveDaParada).filter(Boolean),
  ];
  const base = partes.join("|");
  const reverso = base.split("").reverse().join("");
  return `pf1-${fnv1a(base)}${fnv1a(reverso)}-${partes.length}`;
}

// ===== Decisão de publicação — a MESMA régua na tela e no servidor =====
// BLOCK nunca publica. WARNING publica só com justificativa (decisão autorizada,
// com auditoria de quem e por quê). PASS publica. Sem resultado, não publica.
export const JUSTIFICATIVA_MINIMA = 10;
export function decisaoDoPreflight(resultado, { justificativa = "" } = {}) {
  const status = resultado?.status;
  const texto = String(justificativa || "").trim();
  if (!status) return { podeSalvar: false, precisaJustificativa: false, motivo: "Rode o pré-flight desta rota antes de atribuí-la ao motorista." };
  if (status === SEVERITY.BLOCK) {
    return { podeSalvar: false, precisaJustificativa: false, motivo: "O pré-flight bloqueou esta rota. Resolva as checagens em BLOCK (ou siga uma sugestão) e rode de novo." };
  }
  if (status === SEVERITY.WARNING) {
    if (texto.length < JUSTIFICATIVA_MINIMA) {
      return { podeSalvar: false, precisaJustificativa: true, motivo: `O pré-flight tem alertas: para atribuir mesmo assim, registre uma justificativa (mínimo ${JUSTIFICATIVA_MINIMA} caracteres).` };
    }
    return { podeSalvar: true, precisaJustificativa: true, motivo: "" };
  }
  return { podeSalvar: true, precisaJustificativa: false, motivo: "" };
}

export const __test__ = { energyBudget, autonomySuggestions };
