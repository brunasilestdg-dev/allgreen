// ===== Viabilidade operacional persistida (snapshot IMUTÁVEL e VERSIONADO) =====
//
// Fluxo do produto (seções 47–50): OPORTUNIDADE → PLANEJAMENTO → VIABILIDADE
// OPERACIONAL → PRECIFICAÇÃO → DEAL DESK → PROPOSTA. A regra de conteúdo,
// hash e versão mora em src/features/logistics/viabilitySnapshotDomain.js —
// o MESMO módulo que a tela usa; a energia vem de energyEstimationDomain (a
// mesma fonte do electric-plan e do pré-flight). Aqui só persistência,
// permissão, auditoria e o gate que a tela não consegue garantir:
//
//   • o histórico só recebe INSERT — nenhum caminho atualiza ou apaga snapshot;
//   • conteúdo idêntico NÃO gera versão nova (o hash decide, não o clique);
//   • a proposta ligada a uma oportunidade só é LIBERADA (sent/approved/
//     accepted) com um snapshot sem faltas — checado no servidor, no POST e
//     na transição de status do PATCH.

import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import {
  ENERGY_MODEL_VERSION,
  estimateRouteEnergy,
} from "../../src/features/logistics/energyEstimationDomain.js";
import {
  MEASUREMENT_TYPES,
} from "../../src/features/logistics/dataProvenanceDomain.js";
import {
  createViabilitySnapshot,
  nextViabilitySnapshot,
  viabilitySnapshotBlockers,
} from "../../src/features/logistics/viabilitySnapshotDomain.js";

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
const parse = (valor, alternativa) => {
  try {
    return JSON.parse(valor || "");
  } catch {
    return alternativa;
  }
};

const PERMISSOES_LEITURA = ["pricing:simulate", "pricing:manage", "proposal:create", "proposal:manage", "planning:manage", "deal:review", "deal:approve", "audit:read"];
const PERMISSOES_ESCRITA = ["pricing:simulate", "pricing:manage", "planning:manage", "proposal:create"];
const podeAlguma = (access, lista) => lista.some((p) => podeNaVertical(access, p));

// Status de proposta que significam "liberada para o cliente/decisão" — é a
// transição para um deles que exige viabilidade (rascunho continua livre).
export const STATUS_DE_LIBERACAO = new Set(["sent", "enviada", "approved", "aprovada", "accepted", "aceita"]);

export const snapshotDaLinha = (row) => ({
  id: row.id,
  opportunityId: row.opportunity_id,
  scenarioId: row.scenario_id || "",
  version: Number(row.version),
  contentHash: row.content_hash,
  previousContentHash: row.previous_content_hash || null,
  schemaVersion: row.schema_version,
  blockers: parse(row.blockers_json, []),
  snapshot: parse(row.snapshot_json, {}),
  createdBy: row.created_by,
  createdAt: row.created_at,
});

// Último snapshot da cadeia: prefere a cadeia do cenário informado; sem ela,
// a cadeia da oportunidade (scenario_id vazio). Por isso o ORDER BY começa
// pelo casamento exato do cenário.
export async function ultimoSnapshotDeViabilidade(env, access, { opportunityId, scenarioId = "" } = {}) {
  const opp = texto(opportunityId, 120);
  if (!env?.DB || !access?.ownerId || !opp) return null;
  const cen = texto(scenarioId, 120);
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_viability_snapshots
      WHERE tenant_id = ? AND workspace_owner_id = ? AND opportunity_id = ?
        AND (scenario_id = ? OR scenario_id = '')
      ORDER BY (scenario_id = ?) DESC, version DESC, created_at DESC
      LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId, opp, cen, cen).first().catch(() => null);
  return row ? snapshotDaLinha(row) : null;
}

/**
 * O gate da proposta. `exigida` = a proposta está ligada a uma oportunidade
 * (é "relevante"); `liberada` = há snapshot e ele não tem faltas.
 */
export async function viabilidadeDaProposta(env, access, { opportunityId, scenarioId = "" } = {}) {
  const opp = texto(opportunityId, 120);
  if (!opp) return { exigida: false, liberada: true, motivo: "", snapshot: null };
  const ultimo = await ultimoSnapshotDeViabilidade(env, access, { opportunityId: opp, scenarioId });
  if (!ultimo) {
    return {
      exigida: true,
      liberada: false,
      motivo: "Registre a viabilidade operacional desta oportunidade (rota, veículo, energia e custo) antes de liberar a proposta.",
      snapshot: null,
    };
  }
  const faltas = Array.isArray(ultimo.blockers) && ultimo.blockers.length
    ? ultimo.blockers
    : viabilitySnapshotBlockers(ultimo.snapshot);
  if (faltas.length) {
    return {
      exigida: true,
      liberada: false,
      motivo: `Viabilidade incompleta (v${ultimo.version}): faltam ${faltas.join(", ")}. Recalcule antes de liberar a proposta.`,
      snapshot: ultimo,
      blockers: faltas,
    };
  }
  return { exigida: true, liberada: true, motivo: "", snapshot: ultimo, blockers: [] };
}

// Monta a entrada do snapshot a partir do corpo: números informados entram
// como INFORMED; se vierem veículo + rota, a energia é ESTIMADA AQUI pelo
// mesmo modelo do electric-plan (o cliente não "inventa" kWh). A proveniência
// de cada fonte fica registrada em dataSources — SEM carimbo de hora: o
// conteúdo é o que decide a versão (hash); a hora mora em createdAt.
function montarEntrada(corpo = {}) {
  const energiaInput = corpo.energy && typeof corpo.energy === "object" ? corpo.energy : null;
  let energyEstimate = null;
  const dataSources = Array.isArray(corpo.dataSources) ? corpo.dataSources.slice(0, 20) : [];
  if (energiaInput) {
    energyEstimate = estimateRouteEnergy({
      vehicle: energiaInput.vehicle || {},
      route: energiaInput.route || {},
      assumptions: energiaInput.assumptions || {},
    });
    if (energyEstimate.status === "ok") {
      dataSources.push({
        id: "energy-model",
        source: "energyEstimationDomain",
        measurementType: MEASUREMENT_TYPES.ESTIMATED,
        confidence: energyEstimate.confidence,
        calculationVersion: energyEstimate.calculationVersion || ENERGY_MODEL_VERSION,
      });
    }
  }
  const informados = ["distanceKm", "durationMinutes", "cost", "costPerDelivery", "co2", "avoidedCo2", "riskScore", "capacityKg", "capacityM3", "palletCapacity", "payload"]
    .filter((k) => corpo[k] !== undefined && corpo[k] !== null && corpo[k] !== "");
  if (informados.length) {
    dataSources.push({
      id: "informed",
      source: texto(corpo.informedBy || "operador", 80),
      measurementType: MEASUREMENT_TYPES.INFORMED,
      fields: informados,
    });
  }
  if (texto(corpo.scenarioId)) {
    dataSources.push({ id: "pricing-scenario", source: texto(corpo.scenarioId, 120), measurementType: MEASUREMENT_TYPES.DERIVED });
  }
  const vehicle = energiaInput?.vehicle || {};
  return {
    input: {
      ...corpo,
      opportunityId: texto(corpo.opportunityId, 120),
      scenarioId: texto(corpo.scenarioId, 120),
      vehicleClass: texto(corpo.vehicleClass || vehicle.vehicleClass || vehicle.class, 60),
      referenceVehicle: texto(corpo.referenceVehicle || vehicle.id || vehicle.plate || vehicle.model, 120),
      capacityKg: corpo.capacityKg ?? vehicle.capacityKg ?? vehicle.maxPayloadKg,
      payload: corpo.payload ?? vehicle.payloadKg,
      autonomy: corpo.autonomy ?? vehicle.nominalRangeKm,
      energyEstimate,
      dataSources,
      routingEngine: texto(corpo.routingEngine, 40),
      routingEngineVersion: texto(corpo.routingEngineVersion, 40),
    },
    energyEstimate,
  };
}

async function listar(env, access, { opportunityId, scenarioId }) {
  const opp = texto(opportunityId, 120);
  const cen = texto(scenarioId, 120);
  const sqlCenario = cen ? " AND (scenario_id = ? OR scenario_id = '')" : "";
  const params = [TENANT_ID, access.ownerId, opp, ...(cen ? [cen] : [])];
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_viability_snapshots
      WHERE tenant_id = ? AND workspace_owner_id = ? AND opportunity_id = ?${sqlCenario}
      ORDER BY scenario_id DESC, version DESC, created_at DESC
      LIMIT 50`,
  ).bind(...params).all();
  return (results || []).map(snapshotDaLinha);
}

export async function handleTodoGreenViability(request, env, access, user, url) {
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);

  if (request.method === "GET") {
    if (!podeAlguma(access, PERMISSOES_LEITURA))
      return json({ error: "Seu papel não pode consultar a viabilidade." }, 403);
    const opportunityId = texto(url.searchParams.get("opportunityId") || url.searchParams.get("oportunidadeId"), 120);
    const scenarioId = texto(url.searchParams.get("scenarioId") || url.searchParams.get("cenarioId"), 120);
    if (!opportunityId) return json({ error: "Informe a oportunidade (opportunityId)." }, 400);
    const versoes = await listar(env, access, { opportunityId, scenarioId });
    const gate = await viabilidadeDaProposta(env, access, { opportunityId, scenarioId });
    return json({
      opportunityId,
      scenarioId,
      latest: gate.snapshot,
      versions: versoes,
      blockers: gate.blockers || (gate.snapshot ? viabilitySnapshotBlockers(gate.snapshot.snapshot) : ["snapshot_ausente"]),
      liberada: gate.liberada,
      motivo: gate.motivo,
    });
  }

  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!podeAlguma(access, PERMISSOES_ESCRITA))
    return json({ error: "Seu papel não pode registrar viabilidade." }, 403);

  const corpo = await request.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") return json({ error: "Corpo inválido." }, 400);
  const opportunityId = texto(corpo.opportunityId || corpo.oportunidadeId, 120);
  if (!opportunityId) return json({ error: "Informe a oportunidade (opportunityId)." }, 400);
  const scenarioId = texto(corpo.scenarioId || corpo.cenarioId, 120);

  const agora = new Date().toISOString();
  const { input, energyEstimate } = montarEntrada({ ...corpo, opportunityId, scenarioId });
  if (energyEstimate && energyEstimate.status !== "ok") {
    return json({
      error: `Não foi possível estimar a energia: ${energyEstimate.reason || "entrada inválida"}. Informe distância, capacidade da bateria e consumo do veículo.`,
      energyEstimate,
    }, 400);
  }

  // Cadeia exata (oportunidade + cenário): a versão avança só nela.
  const anteriorRow = await env.DB.prepare(
    `SELECT * FROM todogreen_viability_snapshots
      WHERE tenant_id = ? AND workspace_owner_id = ? AND opportunity_id = ? AND scenario_id = ?
      ORDER BY version DESC LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId, opportunityId, scenarioId).first();
  const anterior = anteriorRow ? snapshotDaLinha(anteriorRow) : null;

  const meta = { createdAt: agora, createdBy: user.id };
  const resultado = anterior
    ? nextViabilitySnapshot(anterior.snapshot, input, meta)
    : { changed: true, snapshot: createViabilitySnapshot(input, meta) };

  if (!resultado.changed) {
    return json({ changed: false, snapshot: anterior, blockers: anterior.blockers, energyEstimate }, 200);
  }

  const snapshot = resultado.snapshot;
  const blockers = viabilitySnapshotBlockers(snapshot);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO todogreen_viability_snapshots
       (id, tenant_id, workspace_owner_id, opportunity_id, scenario_id, version, content_hash,
        previous_content_hash, schema_version, snapshot_json, blockers_json, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, TENANT_ID, access.ownerId, opportunityId, scenarioId, snapshot.version, snapshot.contentHash,
    snapshot.previousContentHash || null, snapshot.schemaVersion, JSON.stringify(snapshot),
    JSON.stringify(blockers), user.id, agora,
  ).run();

  await registrarAuditoriaTodoGreen(env, {
    access,
    user,
    action: "viability.calculated",
    resourceType: "viability_snapshot",
    resourceId: id,
    after: { opportunityId, scenarioId, version: snapshot.version, contentHash: snapshot.contentHash, blockers },
    details: blockers.length
      ? `Snapshot v${snapshot.version} registrado com faltas: ${blockers.join(", ")}`
      : `Snapshot v${snapshot.version} registrado sem faltas (${snapshot.energyKwh ?? "?"} kWh, confiança ${snapshot.confidence})`,
  });

  const gravado = {
    id, opportunityId, scenarioId, version: snapshot.version, contentHash: snapshot.contentHash,
    previousContentHash: snapshot.previousContentHash || null, schemaVersion: snapshot.schemaVersion,
    blockers, snapshot, createdBy: user.id, createdAt: agora,
  };
  return json({ changed: true, snapshot: gravado, blockers, energyEstimate }, 201);
}
