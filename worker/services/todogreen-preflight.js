// ===== Pré-flight operacional PERSISTIDO — gate de publicação da rota (P2) =====
//
// `preflightDomain` decide (PASS / WARNING / BLOCK + sugestões calculadas) e
// já rodava no `POST /routes/electric-plan`, mas o resultado morria na resposta.
// Este módulo fecha o ciclo do produto (seção 18: "esta rota, com ESTE
// motorista e ESTE veículo, pode ser executada AGORA?"):
//
//   • resolve a ENTRADA pelo cadastro — motorista (`todogreen_drivers`), veículo
//     da frota (`todogreen_fleet_vehicles`), pontos de recarga próprios
//     (`todogreen_charging_points`) e veículos alternativos disponíveis — a tela
//     não "afirma" que o motorista está livre ou que a CNH vale;
//   • persiste CADA execução (`todogreen_preflight_results`, só INSERT), com a
//     entrada resolvida, proveniência, checagens, sugestões e energia;
//   • registra a decisão autorizada de um WARNING (justificativa + quem + quando)
//     — a única atualização permitida na linha, em campos próprios;
//   • responde ao gate da coleção `rotas`: "este pré-flight libera ESTA rota?"
//     (mesmo par: assinatura de paradas + motorista + veículo; dentro do prazo;
//     PASS, ou WARNING com justificativa); BLOCK nunca vira rota atribuída;
//   • BLOCK/WARNING viram itens de ação na Torre de Controle (Central de
//     Trabalho) — a fila de ação reutiliza o quadro que já existe (P2.c).
//
// Sem veículo da frota o resultado é WARNING honesto (autonomia e capacidade
// não verificadas), nunca PASS por omissão. Kill switch documentado:
// `TDG_PREFLIGHT_GATE_DISABLED=1` desliga só o gate da coleção (o pré-flight
// continua disponível e registrado) — decisão da titular, padrão LIGADO.

import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import { enfileirarAcoesOperacionais } from "./todogreen-work-center.js";
import { estimateRouteEnergy } from "../../src/features/logistics/energyEstimationDomain.js";
import { MEASUREMENT_TYPES } from "../../src/features/logistics/dataProvenanceDomain.js";
import {
  SEVERITY,
  decisaoDoPreflight,
  routeFingerprint,
  runPreflight,
} from "../../src/features/logistics/preflightDomain.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const texto = (valor, max = 300) => String(valor ?? "").trim().slice(0, max);
const numero = (valor) => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};
const parse = (valor, alternativa) => {
  try {
    return JSON.parse(valor || "");
  } catch {
    return alternativa;
  }
};
const dataIso = (valor) => new Date(valor).toISOString();
const hojeIso = (agora) => dataIso(agora).slice(0, 10);

const PERMISSOES_LEITURA = ["operations:manage", "planning:manage", "tms:manage", "fleet:manage", "audit:read"];
const PERMISSOES_ESCRITA = ["operations:manage", "planning:manage", "tms:manage"];
const podeAlguma = (access, lista) => lista.some((p) => podeNaVertical(access, p));

export const TTL_PADRAO_HORAS = 24;
export const ttlDoPreflightMs = (env) => {
  const horas = Number(env?.TDG_PREFLIGHT_TTL_HOURS);
  return (Number.isFinite(horas) && horas > 0 ? horas : TTL_PADRAO_HORAS) * 60 * 60 * 1000;
};
export const gateDesligado = (env) => String(env?.TDG_PREFLIGHT_GATE_DISABLED || "") === "1";
// Risco viário (Risk Map, 0–100) a partir do qual a rota vira item de ação.
export const LIMIAR_RISCO_ACAO = 60;
const limiarDeRisco = (env) => {
  const n = Number(env?.TDG_RISK_ACTION_THRESHOLD);
  return Number.isFinite(n) && n >= 0 ? n : LIMIAR_RISCO_ACAO;
};

// Chave do veículo na assinatura da rota: placa, ou prefixo quando não há placa
// (a frota exige prefixo; placa é opcional). É o que a rota grava em
// `vehicle_plate`, então o gate recalcula a mesma coisa a partir da rota.
export const chaveDoVeiculo = (veiculo) => texto(veiculo?.plate || veiculo?.placa || veiculo?.prefix || veiculo?.prefixo, 20).toUpperCase();

const paradasDoCorpo = (corpo) =>
  (Array.isArray(corpo?.paradas) ? corpo.paradas : Array.isArray(corpo?.stops) ? corpo.stops : []).slice(0, 200);

export const preflightDaLinha = (row) => ({
  id: row.id,
  routeId: row.route_id || "",
  fingerprint: row.route_fingerprint,
  motoristaId: row.driver_id || "",
  motorista: row.driver_name || "",
  veiculoId: row.vehicle_id || "",
  placa: row.vehicle_plate || "",
  status: row.status,
  blocked: Boolean(row.blocked),
  checks: parse(row.checks_json, []),
  suggestions: parse(row.suggestions_json, []),
  input: parse(row.input_json, {}),
  energyEstimate: row.energy_json ? parse(row.energy_json, null) : null,
  provenance: parse(row.provenance_json, []),
  override: row.override_reason
    ? { reason: row.override_reason, by: row.overridden_by || "", at: row.overridden_at || "" }
    : null,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

// ---- Entrada resolvida pelo cadastro -------------------------------------

const veiculoDoDominio = (row, { socInformado = null, payloadKg = null } = {}) => ({
  id: row.id,
  plate: row.plate || "",
  prefix: row.prefix || "",
  category: row.vehicle_class || row.category || "",
  vehicleClass: row.vehicle_class || "",
  energyType: row.energy_type || "",
  capacityKg: numero(row.payload_kg) || null,
  capacityM3: numero(row.volume_m3) || null,
  palletCapacity: numero(row.pallet_capacity) || null,
  maxPayloadKg: numero(row.payload_kg) || null,
  payloadKg: payloadKg ?? undefined,
  batteryCapacityKwh: numero(row.battery_capacity_kwh) || null,
  sohPercent: numero(row.battery_soh_percent) ?? 100,
  socPercent: socInformado ?? numero(row.last_soc_percent) ?? 100,
  consumptionKwhPerKm: numero(row.reference_consumption_kwh_km) || numero(row.energy_consumption_kwh_per_km) || null,
  nominalRangeKm: numero(row.nominal_range_km) || null,
  maxChargingPowerKw: numero(row.max_charging_power_kw) ?? null,
  connectorType: row.connector_type || "",
});

/**
 * Resolve motorista, veículo, carga, rota, carregadores e alternativas a partir
 * do corpo + cadastro. Devolve também a proveniência de cada bloco (de onde
 * veio, com que natureza) e a assinatura da rota.
 */
export async function montarEntradaDoPreflight(env, access, corpo = {}, { now = new Date() } = {}) {
  const hoje = hojeIso(now);
  const provenance = [];
  const paradas = paradasDoCorpo(corpo);
  const driverId = texto(corpo.motoristaId || corpo.driverId, 120);
  const vehicleId = texto(corpo.veiculoId || corpo.vehicleId, 120);
  const placaInformada = texto(corpo.placa || corpo.vehiclePlate, 20).toUpperCase();

  // ---- Carga e rota: informados pela tela (INFORMED) ----
  const carga = corpo.carga && typeof corpo.carga === "object" ? corpo.carga : corpo.load && typeof corpo.load === "object" ? corpo.load : {};
  const load = {
    weightKg: numero(carga.pesoKg ?? carga.weightKg),
    volumeM3: numero(carga.volumeM3),
    pallets: numero(carga.pallets ?? carga.paletes),
  };
  const rota = corpo.rota && typeof corpo.rota === "object" ? corpo.rota : corpo.route && typeof corpo.route === "object" ? corpo.route : {};
  const route = {
    distanceKm: numero(rota.distanciaKm ?? rota.distanceKm ?? corpo.distanciaKm),
    durationMinutes: numero(rota.duracaoMin ?? rota.durationMinutes ?? corpo.duracaoMin),
    elevationGainM: numero(rota.elevationGainM ?? rota.ganhoElevacaoM),
    elevationLossM: numero(rota.elevationLossM ?? rota.perdaElevacaoM),
    temperatureC: numero(rota.temperaturaC ?? rota.temperatureC),
    windowOk: typeof rota.janelaOk === "boolean" ? rota.janelaOk : typeof rota.windowOk === "boolean" ? rota.windowOk : undefined,
    slaOk: typeof rota.slaOk === "boolean" ? rota.slaOk : undefined,
    stops: paradas.length,
  };
  provenance.push({ id: "route", source: "roteirizacao", measurementType: MEASUREMENT_TYPES.INFORMED, fields: Object.keys(route).filter((k) => route[k] !== null && route[k] !== undefined) });
  if (load.weightKg !== null || load.volumeM3 !== null || load.pallets !== null)
    provenance.push({ id: "load", source: "operador", measurementType: MEASUREMENT_TYPES.INFORMED, fields: Object.keys(load).filter((k) => load[k] !== null) });

  // ---- Motorista: o cadastro decide disponibilidade e CNH ----
  let driver = { id: driverId, available: false, unavailableReason: driverId ? "Motorista não encontrado no cadastro deste espaço." : "Escolha o motorista que vai receber a rota." };
  let driverName = texto(corpo.motorista, 160);
  if (driverId) {
    const row = await env.DB.prepare(
      `SELECT id, full_name, status, availability_status, cnh_expires_at, cnh_category
         FROM todogreen_drivers
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(driverId, TENANT_ID, access.ownerId).first();
    if (row) {
      driverName = row.full_name || driverName;
      const cnh = texto(row.cnh_expires_at, 10);
      const disponivel = row.status === "active" && row.availability_status === "available";
      driver = {
        id: row.id,
        nome: row.full_name || "",
        available: disponivel,
        unavailableReason: disponivel ? "" : `Motorista ${row.full_name || row.id} está "${row.availability_status}" (cadastro "${row.status}").`,
        statusCadastro: row.status,
        disponibilidade: row.availability_status,
        licenseValid: cnh ? cnh >= hoje : undefined,
        licenseUnknown: !cnh,
        cnhExpiresAt: cnh || null,
        cnhCategory: row.cnh_category || "",
      };
      provenance.push({ id: "driver", source: "todogreen_drivers", measurementType: MEASUREMENT_TYPES.IMPORTED, fields: ["available", cnh ? "licenseValid" : "licenseUnknown"] });
    } else {
      provenance.push({ id: "driver", source: "none", measurementType: MEASUREMENT_TYPES.DERIVED, warning: "DRIVER_NOT_FOUND" });
    }
  }

  // ---- Veículo da frota: disponibilidade, documentos, manutenção, capacidade, energia ----
  let vehicle = { unknown: true };
  let veiculoRow = null;
  if (vehicleId || placaInformada) {
    veiculoRow = await env.DB.prepare(
      `SELECT * FROM todogreen_fleet_vehicles
        WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
          AND (id = ? OR (plate <> '' AND UPPER(plate) = ?))
        LIMIT 1`,
    ).bind(TENANT_ID, access.ownerId, vehicleId || "-", placaInformada || "-").first();
    if (veiculoRow) {
      const docs = texto(veiculoRow.next_document_due_at, 10);
      const manut = texto(veiculoRow.next_maintenance_at, 10);
      const socInformado = numero(corpo.veiculo?.socPercent ?? corpo.socPercent);
      const disponivel = veiculoRow.status === "available";
      vehicle = {
        ...veiculoDoDominio(veiculoRow, { socInformado, payloadKg: load.weightKg }),
        available: disponivel,
        unavailableReason: disponivel ? "" : `Veículo ${chaveDoVeiculo(veiculoRow)} está "${veiculoRow.status}" no cadastro da frota.`,
        statusCadastro: veiculoRow.status,
        docsOk: docs ? docs >= hoje : undefined,
        maintenanceOk: manut ? manut >= hoje : undefined,
        nextDocumentDueAt: docs || null,
        nextMaintenanceAt: manut || null,
      };
      provenance.push({
        id: "vehicle",
        source: "todogreen_fleet_vehicles",
        measurementType: MEASUREMENT_TYPES.IMPORTED,
        fields: ["available", docs ? "docsOk" : null, manut ? "maintenanceOk" : null, "capacityKg", "batteryCapacityKwh", "consumptionKwhPerKm"].filter(Boolean),
      });
      if (socInformado !== null) provenance.push({ id: "soc", source: "operador", measurementType: MEASUREMENT_TYPES.INFORMED, fields: ["socPercent"] });
      else if (numero(veiculoRow.last_soc_percent) !== null) provenance.push({ id: "soc", source: "telemetria", measurementType: MEASUREMENT_TYPES.MEASURED, fields: ["socPercent"], at: veiculoRow.last_telemetry_at || null });
      else provenance.push({ id: "soc", source: "none", measurementType: MEASUREMENT_TYPES.ESTIMATED, warning: "SOC_PRESUMIDO_100" });
    } else {
      vehicle = { id: vehicleId, plate: placaInformada, available: false, unavailableReason: "Veículo não encontrado no cadastro da frota deste espaço." };
      provenance.push({ id: "vehicle", source: "none", measurementType: MEASUREMENT_TYPES.DERIVED, warning: "VEHICLE_NOT_FOUND" });
    }
  } else {
    provenance.push({ id: "vehicle", source: "none", measurementType: MEASUREMENT_TYPES.DERIVED, warning: "VEHICLE_NOT_INFORMED" });
  }

  // ---- Energia: o MESMO modelo da viabilidade e do electric-plan ----
  let energyEstimate = null;
  if (veiculoRow && route.distanceKm) {
    energyEstimate = estimateRouteEnergy({ vehicle, route });
    provenance.push({ id: "energy-model", source: "energyEstimationDomain", measurementType: MEASUREMENT_TYPES.ESTIMATED, status: energyEstimate.status, confidence: energyEstimate.confidence || null, reason: energyEstimate.reason || null });
  }

  // ---- Carregadores: pontos próprios ativos + o que a tela viu no mapa ----
  const pontos = await env.DB.prepare(
    `SELECT id, name, power_kw, current_type FROM todogreen_charging_points
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL AND status = 'ativo' AND power_kw > 0
      ORDER BY power_kw DESC LIMIT 50`,
  ).bind(TENANT_ID, access.ownerId).all();
  const chargers = [
    ...(pontos.results || []).map((p) => ({ id: p.id, name: p.name, powerKw: numero(p.power_kw), source: "proprio" })),
    ...(Array.isArray(corpo.carregadores) ? corpo.carregadores : [])
      .slice(0, 50)
      .map((c) => ({ id: texto(c.id, 80), name: texto(c.nome || c.name, 120), powerKw: numero(c.potenciaKw ?? c.powerKw), source: "mapa" }))
      .filter((c) => c.powerKw > 0),
  ];

  // ---- Veículos alternativos: elétricos disponíveis com dado de energia ----
  const outros = await env.DB.prepare(
    `SELECT id, prefix, plate, vehicle_class, category, payload_kg, battery_capacity_kwh, battery_soh_percent,
            last_soc_percent, reference_consumption_kwh_km, energy_consumption_kwh_per_km, nominal_range_km
       FROM todogreen_fleet_vehicles
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL AND status = 'available'
        AND id <> ? AND battery_capacity_kwh > 0
      ORDER BY battery_capacity_kwh DESC LIMIT 20`,
  ).bind(TENANT_ID, access.ownerId, veiculoRow?.id || "-").all();
  const alternativas = (outros.results || [])
    .map((row) => ({ ...veiculoDoDominio(row, { payloadKg: load.weightKg }), id: chaveDoVeiculo(row) || row.id, reservePercent: 15 }))
    .filter((v) => v.consumptionKwhPerKm > 0);

  const vehicleKey = veiculoRow ? chaveDoVeiculo(veiculoRow) : (placaInformada || vehicleId);
  const fingerprint = routeFingerprint({ stops: paradas, driverId, vehicleKey });

  return {
    input: {
      vehicle,
      driver,
      load,
      route,
      charging: { available: chargers.length > 0 },
      alternatives: { chargers, vehicles: alternativas },
    },
    energyEstimate,
    provenance,
    fingerprint,
    driverId,
    driverName,
    vehicleId: veiculoRow?.id || "",
    vehicleKey,
    paradas,
  };
}

// ---- Fila de ação (P2.c): checagens BLOCK/WARNING e risco alto ----------

const rotuloDoPar = ({ driverName, vehicleKey }) =>
  [driverName ? `motorista ${driverName}` : "", vehicleKey ? `veículo ${vehicleKey}` : ""].filter(Boolean).join(" · ");

export function acoesDoPreflight({ resultado, preflightId, fingerprint, routeId = "", driverId = "", driverName = "", vehicleId = "", vehicleKey = "", risco = null, limiarRisco = LIMIAR_RISCO_ACAO }) {
  const relations = [
    { type: "preflight", id: preflightId },
    routeId ? { type: "rota", id: routeId } : null,
    driverId ? { type: "motorista", id: driverId } : null,
    vehicleId ? { type: "veiculo", id: vehicleId } : null,
  ].filter(Boolean);
  const par = rotuloDoPar({ driverName, vehicleKey });
  const sugestoes = (resultado?.suggestions || []).map((s) => `• ${s.text}`).join("\n");
  const acoes = (resultado?.checks || [])
    .filter((c) => c.severity === SEVERITY.BLOCK || c.severity === SEVERITY.WARNING)
    .map((c) => ({
      sourceKey: `preflight:${fingerprint}:${c.id}`,
      type: "plano-de-acao",
      priority: c.severity === SEVERITY.BLOCK ? "alta" : "media",
      title: `${c.severity === SEVERITY.BLOCK ? "Bloqueio" : "Alerta"} de pré-flight — ${c.label}`,
      description: [c.reason || "", par, c.id === "energy" && sugestoes ? `Sugestões calculadas:\n${sugestoes}` : ""].filter(Boolean).join("\n"),
      relations,
      fields: { origem: "preflight", preflightId, severidade: c.severity, checagem: c.id, fingerprint },
    }));
  const score = numero(risco?.riskScore);
  if (score !== null && score >= limiarRisco) {
    acoes.push({
      sourceKey: `risco:${fingerprint}`,
      type: "plano-de-acao",
      priority: "alta",
      title: `Risco viário alto no traçado (score ${score})`,
      description: [
        `Risk Map: ${risco.acidentes ?? "?"} ocorrência(s) e ${risco.mortos ?? "?"} morte(s) nas células que a rota atravessa (UPS/km ${risco.upsPorKm ?? "?"}).`,
        par,
        Array.isArray(risco.trechosCriticos) && risco.trechosCriticos.length
          ? `Trechos críticos: ${risco.trechosCriticos.slice(0, 3).map((t) => (t.rodovias || []).join("/") || t.chave).join(", ")}.`
          : "",
        "Avalie a alternativa de menor risco no ranking da Roteirização antes de liberar.",
      ].filter(Boolean).join("\n"),
      relations,
      fields: { origem: "risco-viario", preflightId, riskScore: score, fingerprint },
    });
  }
  return acoes;
}

// ---- Persistência ----------------------------------------------------------

export async function registrarPreflight(env, access, user, corpo = {}, { now = new Date() } = {}) {
  const entrada = await montarEntradaDoPreflight(env, access, corpo, { now });
  const resultado = runPreflight({ ...entrada.input, energyEstimate: entrada.energyEstimate });
  const id = crypto.randomUUID();
  const agora = dataIso(now);
  const routeId = texto(corpo.rotaId || corpo.routeId, 120);
  const inputGravado = {
    ...entrada.input,
    // Alternativas ficam resumidas: são apoio da sugestão, não a decisão.
    alternatives: {
      chargers: entrada.input.alternatives.chargers.slice(0, 20),
      vehicles: entrada.input.alternatives.vehicles.map((v) => ({ id: v.id, batteryCapacityKwh: v.batteryCapacityKwh, consumptionKwhPerKm: v.consumptionKwhPerKm, socPercent: v.socPercent })),
    },
    paradas: entrada.paradas.map((p) => ({ ordem: p.ordem, rotulo: texto(p.rotulo || p.endereco, 200), lat: numero(p.lat), lng: numero(p.lng ?? p.lon) })),
  };
  await env.DB.prepare(
    `INSERT INTO todogreen_preflight_results
       (id, tenant_id, workspace_owner_id, route_id, route_fingerprint, driver_id, driver_name, vehicle_id, vehicle_plate,
        status, blocked, checks_json, suggestions_json, input_json, energy_json, provenance_json, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, TENANT_ID, access.ownerId, routeId, entrada.fingerprint, entrada.driverId, entrada.driverName, entrada.vehicleId, entrada.vehicleKey,
    resultado.status, resultado.blocked ? 1 : 0, JSON.stringify(resultado.checks), JSON.stringify(resultado.suggestions),
    JSON.stringify(inputGravado), entrada.energyEstimate ? JSON.stringify(entrada.energyEstimate) : null,
    JSON.stringify(entrada.provenance), user.id, agora,
  ).run();

  const contagem = { block: resultado.checks.filter((c) => c.severity === SEVERITY.BLOCK).length, warning: resultado.checks.filter((c) => c.severity === SEVERITY.WARNING).length };
  await registrarAuditoriaTodoGreen(env, {
    access,
    user,
    action: "preflight.executed",
    resourceType: "preflight_result",
    resourceId: id,
    after: { status: resultado.status, blocked: resultado.blocked, routeId, driverId: entrada.driverId, vehicleId: entrada.vehicleId, fingerprint: entrada.fingerprint, ...contagem },
    details: `Pré-flight ${resultado.status} (${contagem.block} bloqueio(s), ${contagem.warning} alerta(s)) — ${rotuloDoPar({ driverName: entrada.driverName, vehicleKey: entrada.vehicleKey }) || "par incompleto"}`,
  });

  // Fila de ação: nunca derruba o pré-flight — a decisão já está gravada.
  let acoes = { criados: [], existentes: [] };
  const lista = acoesDoPreflight({
    resultado, preflightId: id, fingerprint: entrada.fingerprint, routeId,
    driverId: entrada.driverId, driverName: entrada.driverName, vehicleId: entrada.vehicleId, vehicleKey: entrada.vehicleKey,
    risco: corpo.risco && typeof corpo.risco === "object" ? corpo.risco : null, limiarRisco: limiarDeRisco(env),
  });
  if (lista.length) {
    try {
      acoes = await enfileirarAcoesOperacionais(env, { ownerId: access.ownerId, userId: user.id, acoes: lista });
    } catch (error) {
      console.error("To Do Green preflight action queue error", error);
    }
  }

  const row = await env.DB.prepare(`SELECT * FROM todogreen_preflight_results WHERE id = ?`).bind(id).first();
  return { ...preflightDaLinha(row), acoes };
}

async function registrarOverride(env, access, user, row, justificativa, agora) {
  await env.DB.prepare(
    `UPDATE todogreen_preflight_results
        SET override_reason = ?, overridden_by = ?, overridden_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND status = 'WARNING' AND override_reason = ''`,
  ).bind(justificativa, user.id, agora, row.id, TENANT_ID, access.ownerId).run();
  await registrarAuditoriaTodoGreen(env, {
    access,
    user,
    action: "preflight.overridden",
    resourceType: "preflight_result",
    resourceId: row.id,
    before: { status: row.status, overrideReason: "" },
    after: { status: row.status, overrideReason: justificativa },
    details: `WARNING de pré-flight autorizado: ${justificativa}`,
  });
}

/**
 * O pré-flight `preflightId` libera a rota descrita em `corpo`? Regras:
 * mesmo espaço; mesma assinatura (paradas + motorista + veículo); dentro do
 * prazo; PASS, ou WARNING com justificativa (a informada agora ou a já
 * registrada). Devolve { erro } ou { ok, row, precisaOverride }.
 */
export async function validarPreflightParaRota(env, access, { preflightId, corpo, justificativa = "", now = new Date() } = {}) {
  const id = texto(preflightId, 120);
  if (!id) return { erro: decisaoDoPreflight(null).motivo };
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_preflight_results WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(id, TENANT_ID, access.ownerId).first();
  if (!row) return { erro: "Pré-flight não encontrado neste espaço. Rode o pré-flight de novo." };

  const driverId = texto(corpo?.motoristaId || corpo?.driverId, 120);
  const placa = texto(corpo?.placa || corpo?.vehiclePlate, 20).toUpperCase();
  const veiculoId = texto(corpo?.veiculoId || corpo?.vehicleId, 120);
  // O veículo da rota tem que ser o do pré-flight (quando a rota informa algum).
  if (veiculoId && row.vehicle_id && veiculoId !== row.vehicle_id)
    return { erro: "O pré-flight foi feito para outro veículo. Rode o pré-flight de novo com o veículo desta rota." };
  if (placa && row.vehicle_plate && placa !== row.vehicle_plate)
    return { erro: "O pré-flight foi feito para outro veículo. Rode o pré-flight de novo com o veículo desta rota." };
  const fingerprint = routeFingerprint({ stops: paradasDoCorpo(corpo), driverId, vehicleKey: row.vehicle_plate || placa || veiculoId });
  if (fingerprint !== row.route_fingerprint)
    return { erro: "O pré-flight não corresponde a esta rota (paradas, motorista ou veículo mudaram). Rode o pré-flight de novo." };
  if (Date.parse(row.created_at) + ttlDoPreflightMs(env) < new Date(now).getTime())
    return { erro: "Este pré-flight expirou. Rode de novo antes de atribuir a rota." };

  const decisao = decisaoDoPreflight({ status: row.status }, { justificativa: texto(justificativa, 1000) || row.override_reason });
  if (!decisao.podeSalvar) return { erro: decisao.motivo };
  return { ok: true, row, precisaOverride: row.status === SEVERITY.WARNING && !row.override_reason };
}

/**
 * Gate da coleção `rotas` (guardaDeEscrita). Carimba em `corpo` o que a coluna
 * vai gravar — `preflightId` e `preflightStatusVerificado` — SEMPRE a partir do
 * banco, nunca do cliente. Devolve a mensagem de impedimento ou "".
 *
 * Só exige pré-flight quando a escrita muda o PAR (POST; ou PATCH que troca
 * motorista, veículo ou paradas). Editar nome/notas/status não reabre o gate.
 */
export async function gateDePreflightDaRota(env, { access, user, corpo, id = "", now = new Date() } = {}) {
  const limpar = () => {
    corpo.preflightId = "";
    corpo.preflightStatusVerificado = "";
  };

  let atual = null;
  if (id) {
    atual = await env.DB.prepare(
      `SELECT driver_id, vehicle_plate, stops_json, preflight_id, preflight_status FROM todogreen_routes
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(id, TENANT_ID, access.ownerId).first();
    if (atual) {
      const chaveAtual = texto(atual.vehicle_plate, 20).toUpperCase();
      const chaveNova = texto(corpo.placa || corpo.vehiclePlate, 20).toUpperCase();
      const assinaturaAtual = routeFingerprint({ stops: parse(atual.stops_json, []), driverId: atual.driver_id || "", vehicleKey: chaveAtual });
      const assinaturaNova = routeFingerprint({ stops: paradasDoCorpo(corpo), driverId: texto(corpo.motoristaId || corpo.driverId, 120), vehicleKey: chaveNova });
      if (assinaturaAtual === assinaturaNova) {
        // O par não mudou: preserva o pré-flight que liberou a rota.
        corpo.preflightId = atual.preflight_id || "";
        corpo.preflightStatusVerificado = atual.preflight_status || "";
        return "";
      }
    }
  }

  const justificativa = texto(corpo.justificativa || corpo.justificativaPreflight || corpo.overrideReason, 1000);
  const validacao = await validarPreflightParaRota(env, access, { preflightId: corpo.preflightId, corpo, justificativa, now });
  if (validacao.erro) {
    if (gateDesligado(env)) {
      // Kill switch: a rota passa, mas sem fingir que foi verificada.
      limpar();
      return "";
    }
    return validacao.erro;
  }
  if (validacao.precisaOverride) await registrarOverride(env, access, user, validacao.row, justificativa, dataIso(now));
  corpo.preflightId = validacao.row.id;
  corpo.preflightStatusVerificado = validacao.row.status;
  if (!texto(corpo.placa) && validacao.row.vehicle_plate) corpo.placa = validacao.row.vehicle_plate;
  return "";
}

// ---- HTTP -----------------------------------------------------------------

async function listar(env, access, { routeId, driverId, limit }) {
  const filtros = ["tenant_id = ?", "workspace_owner_id = ?"];
  const valores = [TENANT_ID, access.ownerId];
  if (routeId) { filtros.push("route_id = ?"); valores.push(routeId); }
  if (driverId) { filtros.push("driver_id = ?"); valores.push(driverId); }
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_preflight_results WHERE ${filtros.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
  ).bind(...valores, limit).all();
  return (results || []).map(preflightDaLinha);
}

export async function handleTodoGreenPreflight(request, env, access, user, url = new URL(request.url), { now = new Date() } = {}) {
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);
  const partes = url.pathname.split("/").filter(Boolean); // api, todogreen, preflight, [id], [acao]
  const id = texto(partes[3], 120);
  const acao = texto(partes[4], 40);

  if (request.method === "GET") {
    if (!podeAlguma(access, PERMISSOES_LEITURA)) return json({ error: "Seu papel não pode consultar o pré-flight." }, 403);
    if (id) {
      const row = await env.DB.prepare(
        `SELECT * FROM todogreen_preflight_results WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
      ).bind(id, TENANT_ID, access.ownerId).first();
      if (!row) return json({ error: "Pré-flight não encontrado." }, 404);
      return json({ preflight: preflightDaLinha(row) });
    }
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
    const registros = await listar(env, access, {
      routeId: texto(url.searchParams.get("rotaId") || url.searchParams.get("routeId"), 120),
      driverId: texto(url.searchParams.get("motoristaId") || url.searchParams.get("driverId"), 120),
      limit,
    });
    return json({ preflights: registros, gate: { enabled: !gateDesligado(env), ttlHours: ttlDoPreflightMs(env) / 3_600_000 } });
  }

  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!podeAlguma(access, PERMISSOES_ESCRITA)) return json({ error: "Seu papel não pode rodar o pré-flight." }, 403);
  const corpo = await request.json().catch(() => null);
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return json({ error: "Corpo inválido." }, 400);

  // Decisão autorizada de um WARNING: quem, quando e por quê ficam na linha.
  if (id && acao === "override") {
    const justificativa = texto(corpo.justificativa || corpo.reason, 1000);
    const row = await env.DB.prepare(
      `SELECT * FROM todogreen_preflight_results WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(id, TENANT_ID, access.ownerId).first();
    if (!row) return json({ error: "Pré-flight não encontrado." }, 404);
    if (row.status !== SEVERITY.WARNING) return json({ error: row.status === SEVERITY.BLOCK ? "BLOCK não admite autorização: resolva a causa e rode o pré-flight de novo." : "Este pré-flight não tem alerta a autorizar." }, 409);
    const decisao = decisaoDoPreflight({ status: row.status }, { justificativa });
    if (!decisao.podeSalvar) return json({ error: decisao.motivo }, 400);
    if (!row.override_reason) await registrarOverride(env, access, user, row, justificativa, dataIso(now));
    const atualizado = await env.DB.prepare(`SELECT * FROM todogreen_preflight_results WHERE id = ?`).bind(id).first();
    return json({ preflight: preflightDaLinha(atualizado) });
  }
  if (id) return json({ error: "Rota não encontrada." }, 404);

  const paradas = paradasDoCorpo(corpo);
  if (paradas.length < 2) return json({ error: "A rota precisa de pelo menos duas paradas (origem e destino) para o pré-flight." }, 400);
  const registro = await registrarPreflight(env, access, user, corpo, { now });
  return json({ preflight: registro, decisao: decisaoDoPreflight(registro) }, 201);
}
