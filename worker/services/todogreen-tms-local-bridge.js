import { TENANT_ID } from "./todogreen-access.js";
import { sameHash } from "../auth/credenciais.js";
import { allowed as limitarTaxa, edgeIp } from "../lib/http.js";
import {
  casarEmbarcador,
  hashDoDocumento,
  normalizarDocumento,
  validarDocumento,
} from "../../src/features/logistics/track3rDomain.js";

const MAX_BODY_BYTES = 5_000_000;
const MAX_ROWS = 300;
const SECRET_ENV_KEY = "TODOGREEN_TRACK3R_LOCAL_BRIDGE_SECRET";

const texto = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const parse = (value, fallback) => {
  try { return JSON.parse(value || ""); }
  catch { return fallback; }
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

const unauthorized = () => json({ error: "Credencial inválida." }, 401);

const bearer = (request) => {
  const authorization = String(request.headers.get("authorization") || "").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return texto(match?.[1] || request.headers.get("x-bridge-token"), 5000);
};

const integrationById = async (env, id) => {
  if (!id) return null;
  return env.DB.prepare(
    `SELECT * FROM todogreen_tms_integrations
      WHERE id = ? AND tenant_id = ? AND provider = 'track3r' AND archived_at IS NULL
      LIMIT 1`,
  ).bind(id, TENANT_ID).first();
};

const withBridgeMetadata = (row, metadata) => ({
  ...(row && typeof row === "object" && !Array.isArray(row) ? row : {}),
  _localBridge: metadata,
});

async function ingestRows(env, integration, rows, metadata) {
  const ownerId = integration.workspace_owner_id;
  const userId = integration.updated_by || integration.created_by;
  if (!userId) throw new Error("A integração não possui usuário de auditoria.");

  const fieldMap = parse(integration.field_map_json, {});
  const { results: clients } = await env.DB.prepare(
    `SELECT id, name, legal_name AS legalName, document FROM todogreen_clients
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(TENANT_ID, ownerId).all();

  const startedAt = new Date().toISOString();
  const errors = [];
  const prepared = [];

  for (const [index, raw] of rows.entries()) {
    const enriched = withBridgeMetadata(raw, metadata);
    const doc = normalizarDocumento(enriched, fieldMap);
    const validationError = validarDocumento(doc);
    if (validationError) {
      errors.push({ linha: index + 1, motivo: validationError });
      continue;
    }
    const matched = casarEmbarcador(doc, clients || []);
    prepared.push({ doc, hash: hashDoDocumento(doc), clientId: matched?.clientId || "" });
  }

  const now = new Date().toISOString();
  const statements = prepared.map(({ doc, hash, clientId }) => env.DB.prepare(
    `INSERT INTO todogreen_tms_documents
       (id, tenant_id, workspace_owner_id, integration_id, origem, external_id, kind,
        shipper_name, shipper_group, shipper_document, client_id, origin_unit, current_unit,
        service, product, status, occurrence, invoice_number, invoice_key,
        vehicle_plate, vehicle_class, driver_name, packages, weight_kg, distance_km,
        promised_at, occurred_at, payload_json, import_hash, order_ref, occurrence_code, operation_id,
        revision, created_by, updated_by, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, 'arquivo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 1, ?, ?, ?, ?, NULL)
     ON CONFLICT(workspace_owner_id, import_hash) DO UPDATE SET
       status = excluded.status,
       occurrence = excluded.occurrence,
       current_unit = excluded.current_unit,
       vehicle_plate = CASE WHEN excluded.vehicle_plate <> '' THEN excluded.vehicle_plate
                            ELSE todogreen_tms_documents.vehicle_plate END,
       vehicle_class = CASE WHEN excluded.vehicle_class <> '' THEN excluded.vehicle_class
                            ELSE todogreen_tms_documents.vehicle_class END,
       driver_name = CASE WHEN excluded.driver_name <> '' THEN excluded.driver_name
                          ELSE todogreen_tms_documents.driver_name END,
       occurred_at = excluded.occurred_at,
       promised_at = COALESCE(excluded.promised_at, todogreen_tms_documents.promised_at),
       payload_json = excluded.payload_json,
       client_id = CASE WHEN todogreen_tms_documents.client_id <> ''
                        THEN todogreen_tms_documents.client_id ELSE excluded.client_id END,
       revision = todogreen_tms_documents.revision + 1,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), TENANT_ID, ownerId, integration.id,
    doc.externalId, doc.kind || "coleta", doc.shipperName, doc.shipperGroup,
    doc.shipperDocument, clientId, doc.originUnit, doc.currentUnit, doc.service,
    doc.product, doc.status, doc.occurrence, doc.invoiceNumber, doc.invoiceKey,
    doc.vehiclePlate, doc.vehicleClass, doc.driverName, doc.packages, doc.weightKg,
    doc.distanceKm, doc.promisedAt || null, doc.occurredAt || null,
    JSON.stringify(doc.payload || {}), hash, texto(doc.orderId, 120),
    userId, userId, now, now,
  ));

  const results = statements.length ? await env.DB.batch(statements) : [];
  const stored = results.reduce((sum, item) => sum + Number(item?.meta?.changes || 0), 0);
  const finishedAt = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO todogreen_tms_sync_runs
         (id, tenant_id, workspace_owner_id, integration_id, origem, status,
          recebidos, importados, repetidos, atualizados, ignorados, erros_json,
          started_at, finished_at, created_by, created_at)
       VALUES (?, ?, ?, ?, 'arquivo', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, ownerId, integration.id,
      errors.length ? (stored ? "parcial" : "erro") : "ok",
      rows.length, stored, errors.length, JSON.stringify(errors.slice(0, 50)),
      startedAt, finishedAt, userId, finishedAt,
    ),
    env.DB.prepare(
      `UPDATE todogreen_tms_integrations
          SET status = 'ativa', last_sync_at = ?, last_error = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(
      finishedAt,
      errors.length ? `${errors.length} linha(s) ignorada(s) pelo agente local.` : "",
      finishedAt, integration.id, TENANT_ID, ownerId,
    ),
  ]);

  return {
    recebidos: rows.length,
    gravados: stored,
    ignorados: errors.length,
    erros: errors.slice(0, 50),
    origem: "agente_local",
    machineId: metadata.machineId,
    datasetHash: metadata.datasetHash,
    syncedAt: finishedAt,
  };
}

export async function handleTodoGreenTmsLocalBridge(request, env) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  // api / todogreen / tms / local-bridge / [integrationId]
  const integrationId = texto(parts[4], 120);

  if (!limitarTaxa(`tms-local-bridge:${integrationId}`, 120))
    return json({ error: "Muitas chamadas em sequência." }, 429);
  const ip = edgeIp(request);
  if (ip && !limitarTaxa(`tms-local-bridge-ip:${ip}`, 240))
    return json({ error: "Muitas chamadas em sequência." }, 429);

  const integration = await integrationById(env, integrationId);
  const expected = String(env[SECRET_ENV_KEY] || "");
  const received = bearer(request);
  // Integração inexistente, segredo ausente e token errado não revelam detalhes.
  if (!integration || !expected || !received || !sameHash(received, expected)) return unauthorized();

  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Lote maior do que o limite aceito." }, 413);

  let body;
  try { body = JSON.parse(raw || "{}"); }
  catch { return json({ error: "JSON inválido." }, 400); }

  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (!rows.length) return json({ error: "Nenhuma linha recebida." }, 400);
  if (rows.length > MAX_ROWS)
    return json({ error: `Envie no máximo ${MAX_ROWS} linhas por lote.` }, 400);

  const metadata = {
    machineId: texto(body.machineId, 120) || "track3r-local",
    sourceFile: texto(body.sourceFile, 240),
    exportedAt: texto(body.exportedAt, 60),
    datasetHash: texto(body.datasetHash, 128),
    batch: Math.max(1, Number(body.batch) || 1),
    totalBatches: Math.max(1, Number(body.totalBatches) || 1),
    receivedAt: new Date().toISOString(),
  };

  try {
    const result = await ingestRows(env, integration, rows, metadata);
    return json(result, 202);
  } catch (error) {
    console.error("Track3r local bridge ingest error", integrationId, error);
    return json({ error: "Não foi possível importar o lote do agente local." }, 500);
  }
}
