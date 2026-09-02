import { sha256 } from "../auth/credenciais.js";
import { allowed } from "../lib/http.js";
import { TENANT_ID } from "./todogreen-access.js";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, idempotency-key",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400",
};

const apiJson = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...cors,
    ...extra,
  },
});

const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const parse = (value, fallback = {}) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const shortId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();

const scopesOf = (credential) => parse(credential?.scopes_json, []);
const hasScope = (credential, scope) => scopesOf(credential).includes(scope);
const keyCanWrite = (credential, scope) => hasScope(credential, scope);

async function credentials(request, env) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!token.startsWith("tdg_live_")) return null;
  const row = await env.DB.prepare(
    `SELECT id,tenant_id,workspace_owner_id,client_id,name,scopes_json,rate_limit_per_minute
       FROM todogreen_tms_api_keys
      WHERE key_hash=? AND tenant_id=? AND revoked_at IS NULL`,
  ).bind(await sha256(token), TENANT_ID).first();
  if (!row) return null;
  const ceiling = Math.min(600, Math.max(30, Number(row.rate_limit_per_minute || 120)));
  if (!allowed(`tdg-tms-api:${row.id}`, ceiling)) return { rateLimited: true, id: row.id };
  await env.DB.prepare("UPDATE todogreen_tms_api_keys SET last_used_at=? WHERE id=?")
    .bind(new Date().toISOString(), row.id).run().catch(() => null);
  return row;
}

const scopeError = (scope) => apiJson({
  error: "forbidden",
  message: `A chave não possui o escopo ${scope}.`,
}, 403);

const shipmentView = (row, extras = {}) => {
  const fields = parse(row.fields_json, {});
  return {
    id: row.id,
    shipmentNumber: row.number,
    externalReference: fields.externalReference || "",
    clientId: row.client_id,
    contractId: row.contract_id,
    operationId: row.operation_id || "",
    serviceId: row.service_id || "",
    status: row.status,
    requestedAt: row.requested_at,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    completedAt: row.completed_at,
    origin: parse(row.origin_json, {}),
    destination: parse(row.destination_json, {}),
    quantity: Number(row.quantity || 0),
    chargeUnit: row.charge_unit || "",
    amount: Number(row.net_amount || 0),
    metadata: fields.metadata || {},
    notes: fields.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras,
  };
};

const packageView = (row) => ({
  id: row.id,
  trackId: row.track_id,
  sku: row.sku,
  barcode: row.barcode,
  description: row.description,
  quantity: Number(row.quantity || 0),
  weightKg: Number(row.weight_kg || 0),
  dimensionsCm: {
    length: Number(row.length_cm || 0),
    width: Number(row.width_cm || 0),
    height: Number(row.height_cm || 0),
  },
  declaredValue: Number(row.declared_value || 0),
  invoiceNumber: row.invoice_number || "",
  invoiceKey: row.invoice_key || "",
  handlingUnit: row.handling_unit || "volume",
  status: row.status,
});

const trackingView = (row) => ({
  id: row.id,
  eventType: row.event_type,
  status: row.status || "",
  location: row.location || "",
  city: row.city || "",
  state: row.state || "",
  latitude: row.latitude,
  longitude: row.longitude,
  notes: row.notes || "",
  occurredAt: row.occurred_at,
  source: row.source,
  externalEventId: row.external_event_id || "",
});

const podView = (row) => ({
  id: row.id,
  kind: row.kind,
  occurredAt: row.occurred_at,
  recipientName: row.recipient_name || "",
  documentUrl: row.document_url || "",
  documentHash: row.document_hash || "",
  latitude: row.latitude,
  longitude: row.longitude,
});

async function findShipment(env, credential, identifier) {
  const clientFilter = credential.client_id ? "AND client_id=?" : "";
  return env.DB.prepare(
    `SELECT * FROM todogreen_service_orders
      WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
        AND (id=? OR number=?) ${clientFilter}
      LIMIT 1`,
  ).bind(TENANT_ID, credential.workspace_owner_id, identifier, identifier, ...(credential.client_id ? [credential.client_id] : [])).first();
}

async function idempotentResult(request, env, credential) {
  const key = text(request.headers.get("idempotency-key"), 160);
  if (!key) return { error: apiJson({ error: "idempotency_key_required", message: "Envie o header Idempotency-Key nas operações de escrita." }, 400) };
  const existing = await env.DB.prepare(
    `SELECT response_status,response_json FROM todogreen_tms_api_idempotency
      WHERE api_key_id=? AND request_key=?`,
  ).bind(credential.id, key).first();
  if (!existing) return { key };
  return {
    key,
    response: apiJson(parse(existing.response_json, {}), Number(existing.response_status || 200), { "idempotent-replayed": "true" }),
  };
}

async function rememberIdempotency(env, credential, request, requestKey, status, payload) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_tms_api_idempotency
      (id,api_key_id,request_key,method,path,response_status,response_json,created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(
    crypto.randomUUID(), credential.id, requestKey, request.method,
    new URL(request.url).pathname, status, JSON.stringify(payload), new Date().toISOString(),
  ).run();
}

async function activeContract(env, credential, clientId, requestedContractId = "") {
  const params = [TENANT_ID, credential.workspace_owner_id, clientId];
  const requested = requestedContractId ? "AND id=?" : "";
  if (requestedContractId) params.push(requestedContractId);
  return env.DB.prepare(
    `SELECT * FROM todogreen_contracts
      WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND archived_at IS NULL
        ${requested}
        AND status NOT IN ('cancelled','draft')
        AND approval_status='approved' AND signature_status='signed'
      ORDER BY updated_at DESC LIMIT 1`,
  ).bind(...params).first().catch(() => null);
}

function apiContractPrice(contract, quantity) {
  const fields = parse(contract?.fields_json, {});
  const unitPrice = Number(contract?.monthly_value || 0);
  const pricingMode = fields.pricingMode === "per_unit" ? "per_unit" : "monthly";
  return {
    unitPrice,
    grossAmount: pricingMode === "per_unit" ? unitPrice * quantity : unitPrice,
    pricingMode,
  };
}

async function listShipments(env, credential, url) {
  if (!hasScope(credential, "shipments:read")) return scopeError("shipments:read");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const offset = (page - 1) * limit;
  const status = text(url.searchParams.get("status"), 30);
  const clientId = credential.client_id || text(url.searchParams.get("clientId"), 120);
  const filters = [status ? "AND status=?" : "", clientId ? "AND client_id=?" : ""].filter(Boolean).join(" ");
  const params = [TENANT_ID, credential.workspace_owner_id, ...(status ? [status] : []), ...(clientId ? [clientId] : [])];
  const [rows, total] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM todogreen_service_orders
        WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL ${filters}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...params, limit, offset).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total FROM todogreen_service_orders
        WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL ${filters}`,
    ).bind(...params).first(),
  ]);
  return apiJson({ data: (rows.results || []).map((row) => shipmentView(row)), total: Number(total?.total || 0), page, limit });
}

async function shipmentDetail(env, credential, identifier) {
  if (!hasScope(credential, "shipments:read")) return scopeError("shipments:read");
  const shipment = await findShipment(env, credential, identifier);
  if (!shipment) return apiJson({ error: "not_found", message: "Shipment não encontrado." }, 404);
  const [packages, tracking, pods, trips, deliveries] = await Promise.all([
    env.DB.prepare(`SELECT * FROM todogreen_tms_packages WHERE tenant_id=? AND workspace_owner_id=? AND service_order_id=? ORDER BY created_at`).bind(TENANT_ID, credential.workspace_owner_id, shipment.id).all(),
    env.DB.prepare(`SELECT * FROM todogreen_tms_tracking_events WHERE tenant_id=? AND workspace_owner_id=? AND service_order_id=? ORDER BY occurred_at DESC`).bind(TENANT_ID, credential.workspace_owner_id, shipment.id).all(),
    env.DB.prepare(`SELECT * FROM todogreen_proofs_of_delivery WHERE tenant_id=? AND workspace_owner_id=? AND service_order_id=? ORDER BY occurred_at DESC`).bind(TENANT_ID, credential.workspace_owner_id, shipment.id).all(),
    env.DB.prepare(`SELECT id,vehicle_id,driver_id,status,started_at,finished_at,distance_km,fields_json FROM todogreen_trips WHERE tenant_id=? AND workspace_owner_id=? AND service_order_id=? ORDER BY created_at`).bind(TENANT_ID, credential.workspace_owner_id, shipment.id).all(),
    env.DB.prepare(`SELECT id,trip_id,reference,sequence,status,promised_at,delivered_at,address_json,recipient_json,fields_json FROM todogreen_deliveries WHERE tenant_id=? AND workspace_owner_id=? AND service_order_id=? ORDER BY sequence,created_at`).bind(TENANT_ID, credential.workspace_owner_id, shipment.id).all(),
  ]);
  return apiJson(shipmentView(shipment, {
    packages: (packages.results || []).map(packageView),
    tracking: (tracking.results || []).map(trackingView),
    pods: (pods.results || []).map(podView),
    trips: (trips.results || []).map((row) => ({ id: row.id, vehicleId: row.vehicle_id, driverId: row.driver_id, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at, distanceKm: Number(row.distance_km || 0), metadata: parse(row.fields_json, {}) })),
    deliveries: (deliveries.results || []).map((row) => ({ id: row.id, tripId: row.trip_id, reference: row.reference, sequence: row.sequence, status: row.status, promisedAt: row.promised_at, deliveredAt: row.delivered_at, address: parse(row.address_json, {}), recipient: parse(row.recipient_json, {}), metadata: parse(row.fields_json, {}) })),
  }));
}

async function createShipment(request, env, credential) {
  if (!keyCanWrite(credential, "shipments:write")) return scopeError("shipments:write");
  const idem = await idempotentResult(request, env, credential);
  if (idem.error) return idem.error;
  if (idem.response) return idem.response;

  const body = await request.json().catch(() => null);
  if (!body) return apiJson({ error: "invalid_json", message: "Corpo JSON inválido." }, 400);
  const clientId = credential.client_id || text(body.clientId, 120);
  if (!clientId) return apiJson({ error: "client_required", message: "Informe clientId ou use uma chave vinculada a um cliente." }, 400);
  if (credential.client_id && body.clientId && text(body.clientId, 120) !== credential.client_id)
    return apiJson({ error: "client_scope_violation", message: "Esta chave só pode criar shipments para o cliente vinculado." }, 403);

  const contract = await activeContract(env, credential, clientId, text(body.contractId, 120));
  if (!contract) return apiJson({ error: "contract_not_ready", message: "Não há contrato aprovado e assinado para este cliente." }, 409);

  const origin = object(body.origin);
  const destination = object(body.destination);
  if (!Object.keys(origin).length || !Object.keys(destination).length)
    return apiJson({ error: "route_required", message: "Origin e destination são obrigatórios." }, 400);

  const packages = Array.isArray(body.packages) ? body.packages.slice(0, 1000) : [];
  const quantity = Math.max(1, num(body.quantity) || packages.reduce((sum, item) => sum + Math.max(1, num(item?.quantity)), 0) || 1);
  const price = apiContractPrice(contract, quantity);
  if (!(price.unitPrice > 0))
    return apiJson({ error: "contract_without_price", message: "O contrato está aprovado, mas não possui valor negociado para gerar a ordem." }, 409);

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const number = `OS-API-${now.slice(0, 10).replaceAll("-", "")}-${shortId().slice(0, 6)}`;
  const fields = {
    source: "external_tms_api",
    externalReference: text(body.externalReference, 160),
    serviceType: text(body.serviceType, 80),
    notes: text(body.notes, 1000),
    metadata: object(body.metadata),
    precoOrigem: "contrato_api",
    precoModo: price.pricingMode,
  };

  const statements = [env.DB.prepare(
    `INSERT INTO todogreen_service_orders
      (id,tenant_id,workspace_owner_id,number,client_id,contract_id,operation_id,service_id,
       price_table_id,status,requested_at,scheduled_start_at,scheduled_end_at,origin_json,
       destination_json,quantity,charge_unit,unit_price,gross_amount,discount_amount,tax_amount,
       net_amount,sla_json,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'released',?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`,
  ).bind(
    id, TENANT_ID, credential.workspace_owner_id, number, clientId, contract.id, "",
    text(body.serviceId || contract.service_id, 120), text(body.priceTableId || contract.price_table_id, 120),
    text(body.requestedAt, 40) || now, text(body.scheduledStartAt, 40) || null,
    text(body.scheduledEndAt, 40) || null, JSON.stringify(origin), JSON.stringify(destination),
    quantity, text(body.chargeUnit, 30) || (packages.length ? "volume" : "delivery"),
    price.unitPrice, price.grossAmount, 0, 0, price.grossAmount,
    contract.sla_json || "{}", JSON.stringify(fields), `api:${credential.id}`, `api:${credential.id}`, now, now,
  )];

  for (const input of packages) {
    const trackId = text(input?.trackId, 120) || `TDG-${shortId()}`;
    const dimensions = object(input?.dimensionsCm);
    statements.push(env.DB.prepare(
      `INSERT INTO todogreen_tms_packages
        (id,tenant_id,workspace_owner_id,service_order_id,client_id,track_id,sku,barcode,description,
         quantity,weight_kg,length_cm,width_cm,height_cm,declared_value,invoice_number,invoice_key,
         handling_unit,status,fields_json,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'created',?,?,?)`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, credential.workspace_owner_id, id, clientId, trackId,
      text(input?.sku, 120), text(input?.barcode, 160), text(input?.description, 300),
      Math.max(1, num(input?.quantity) || 1), Math.max(0, num(input?.weightKg)),
      Math.max(0, num(dimensions.length)), Math.max(0, num(dimensions.width)), Math.max(0, num(dimensions.height)),
      Math.max(0, num(input?.declaredValue)), text(input?.invoiceNumber, 80), text(input?.invoiceKey, 80),
      text(input?.handlingUnit, 40) || "volume", JSON.stringify(object(input?.metadata)), now, now,
    ));
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error?.message || error).toLowerCase().includes("unique"))
      return apiJson({ error: "duplicate_track_id", message: "Um dos Track IDs já existe neste TMS." }, 409);
    throw error;
  }
  const row = await env.DB.prepare("SELECT * FROM todogreen_service_orders WHERE id=?").bind(id).first();
  const payload = shipmentView(row, {
    packages: packages.length ? (await env.DB.prepare("SELECT * FROM todogreen_tms_packages WHERE service_order_id=? ORDER BY created_at").bind(id).all()).results.map(packageView) : [],
  });
  await rememberIdempotency(env, credential, request, idem.key, 201, payload);
  return apiJson(payload, 201);
}

const EVENT_TYPES = new Set([
  "CREATED", "PICKED_UP", "DEPARTED", "IN_TRANSIT", "REACHED_CHECKPOINT",
  "ARRIVED_AT_HUB", "DEPARTED_FROM_HUB", "REACHED_DESTINATION", "DELIVERED",
  "DELIVERY_ATTEMPT", "EXCEPTION", "CANCELLED",
]);

async function addTracking(request, env, credential, identifier) {
  if (!keyCanWrite(credential, "tracking:write")) return scopeError("tracking:write");
  const idem = await idempotentResult(request, env, credential);
  if (idem.error) return idem.error;
  if (idem.response) return idem.response;
  const shipment = await findShipment(env, credential, identifier);
  if (!shipment) return apiJson({ error: "not_found", message: "Shipment não encontrado." }, 404);
  const body = await request.json().catch(() => null);
  if (!body) return apiJson({ error: "invalid_json", message: "Corpo JSON inválido." }, 400);
  const eventType = text(body.eventType, 40).toUpperCase();
  if (!EVENT_TYPES.has(eventType)) return apiJson({ error: "invalid_event", message: "eventType inválido." }, 400);
  const now = new Date().toISOString();
  const occurredAt = text(body.occurredAt, 40) || now;
  if (!Number.isFinite(Date.parse(occurredAt))) return apiJson({ error: "invalid_date", message: "occurredAt inválido." }, 400);
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  const eventId = crypto.randomUUID();
  const nextStatus = eventType === "CANCELLED" ? "cancelled"
    : eventType === "CREATED" ? shipment.status
      : "in_progress";
  const externalEventId = text(body.externalEventId, 160);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO todogreen_tms_tracking_events
          (id,tenant_id,workspace_owner_id,service_order_id,client_id,event_type,status,location,city,state,
           latitude,longitude,notes,occurred_at,source,external_event_id,created_by,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        eventId, TENANT_ID, credential.workspace_owner_id, shipment.id, shipment.client_id, eventType,
        nextStatus, text(body.location, 240), text(body.city, 100), text(body.state, 2).toUpperCase(),
        Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null, text(body.notes, 1000),
        occurredAt, "external_api", externalEventId, `api:${credential.id}`, now,
      ),
      env.DB.prepare(
        `UPDATE todogreen_service_orders SET status=?,revision=revision+1,updated_by=?,updated_at=?
          WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND status NOT IN ('completed','cancelled')`,
      ).bind(nextStatus, `api:${credential.id}`, now, shipment.id, TENANT_ID, credential.workspace_owner_id),
    ]);
  } catch (error) {
    if (externalEventId && String(error?.message || error).toLowerCase().includes("unique"))
      return apiJson({ error: "duplicate_external_event", message: "externalEventId já registrado." }, 409);
    throw error;
  }
  const row = await env.DB.prepare("SELECT * FROM todogreen_tms_tracking_events WHERE id=?").bind(eventId).first();
  const payload = { event: trackingView(row), shipmentStatus: nextStatus, requiresPodToComplete: eventType === "DELIVERED" };
  await rememberIdempotency(env, credential, request, idem.key, 201, payload);
  return apiJson(payload, 201);
}

async function listTracking(env, credential, identifier) {
  if (!hasScope(credential, "shipments:read")) return scopeError("shipments:read");
  const shipment = await findShipment(env, credential, identifier);
  if (!shipment) return apiJson({ error: "not_found", message: "Shipment não encontrado." }, 404);
  const rows = await env.DB.prepare(
    `SELECT * FROM todogreen_tms_tracking_events
      WHERE tenant_id=? AND workspace_owner_id=? AND service_order_id=? ORDER BY occurred_at DESC LIMIT 500`,
  ).bind(TENANT_ID, credential.workspace_owner_id, shipment.id).all();
  return apiJson({ data: (rows.results || []).map(trackingView) });
}

async function addPod(request, env, credential, identifier) {
  if (!keyCanWrite(credential, "pod:write")) return scopeError("pod:write");
  const idem = await idempotentResult(request, env, credential);
  if (idem.error) return idem.error;
  if (idem.response) return idem.response;
  const shipment = await findShipment(env, credential, identifier);
  if (!shipment) return apiJson({ error: "not_found", message: "Shipment não encontrado." }, 404);
  const body = await request.json().catch(() => null);
  if (!body) return apiJson({ error: "invalid_json", message: "Corpo JSON inválido." }, 400);
  const recipientName = text(body.recipientName, 200);
  const documentUrl = text(body.documentUrl, 800);
  if (!recipientName && !documentUrl)
    return apiJson({ error: "pod_required", message: "Informe recipientName ou documentUrl." }, 400);
  const now = new Date().toISOString();
  const occurredAt = text(body.occurredAt, 40) || now;
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  const podId = crypto.randomUUID();
  const complete = body.completeShipment !== false;
  const statements = [env.DB.prepare(
    `INSERT INTO todogreen_proofs_of_delivery
      (id,tenant_id,workspace_owner_id,service_order_id,delivery_id,kind,occurred_at,recipient_name,
       document_url,document_hash,latitude,longitude,fields_json,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    podId, TENANT_ID, credential.workspace_owner_id, shipment.id, text(body.deliveryId, 120),
    text(body.kind, 30) || "delivery", occurredAt, recipientName, documentUrl, text(body.documentHash, 200),
    Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null,
    JSON.stringify(object(body.metadata)), `api:${credential.id}`, now,
  )];
  if (complete && !["completed", "cancelled"].includes(shipment.status)) {
    statements.push(env.DB.prepare(
      `UPDATE todogreen_service_orders SET status='completed',completed_at=?,revision=revision+1,updated_by=?,updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND status NOT IN ('completed','cancelled')`,
    ).bind(occurredAt, `api:${credential.id}`, now, shipment.id, TENANT_ID, credential.workspace_owner_id));
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO todogreen_billing_items
        (id,tenant_id,workspace_owner_id,service_order_id,client_id,contract_id,status,amount,
         competence_date,created_by,updated_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'eligible',?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, credential.workspace_owner_id, shipment.id, shipment.client_id,
      shipment.contract_id, shipment.net_amount, occurredAt.slice(0, 10),
      `api:${credential.id}`, `api:${credential.id}`, now, now,
    ));
  }
  await env.DB.batch(statements);
  const row = await env.DB.prepare("SELECT * FROM todogreen_proofs_of_delivery WHERE id=?").bind(podId).first();
  const payload = { pod: podView(row), shipmentStatus: complete ? "completed" : shipment.status, billingEligible: complete };
  await rememberIdempotency(env, credential, request, idem.key, 201, payload);
  return apiJson(payload, 201);
}

async function listPods(env, credential, identifier) {
  if (!hasScope(credential, "shipments:read")) return scopeError("shipments:read");
  const shipment = await findShipment(env, credential, identifier);
  if (!shipment) return apiJson({ error: "not_found", message: "Shipment não encontrado." }, 404);
  const rows = await env.DB.prepare(
    `SELECT * FROM todogreen_proofs_of_delivery
      WHERE tenant_id=? AND workspace_owner_id=? AND service_order_id=? ORDER BY occurred_at DESC LIMIT 100`,
  ).bind(TENANT_ID, credential.workspace_owner_id, shipment.id).all();
  return apiJson({ data: (rows.results || []).map(podView) });
}

async function listFiscal(env, credential, url) {
  if (!hasScope(credential, "fiscal:read")) return scopeError("fiscal:read");
  const type = text(url.searchParams.get("type"), 20).toLowerCase();
  const serviceOrderId = text(url.searchParams.get("shipmentId"), 120);
  let operationId = "";
  if (serviceOrderId) {
    const order = await findShipment(env, credential, serviceOrderId);
    if (!order) return apiJson({ error: "not_found", message: "Shipment não encontrado." }, 404);
    operationId = order.operation_id || "";
  }
  const clientId = credential.client_id || text(url.searchParams.get("clientId"), 120);
  const filters = [type ? "AND doc_type=?" : "", operationId ? "AND operation_id=?" : "", clientId ? "AND client_id=?" : ""].filter(Boolean).join(" ");
  const params = [TENANT_ID, credential.workspace_owner_id, ...(type ? [type] : []), ...(operationId ? [operationId] : []), ...(clientId ? [clientId] : [])];
  const rows = await env.DB.prepare(
    `SELECT id,doc_type,numero,serie,chave_acesso,status,status_sefaz,motivo_sefaz,protocolo_autorizacao,
            data_emissao,valor_servico,valor_total,operation_id,client_id,created_at,updated_at
       FROM todogreen_fiscal_documents
      WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL ${filters}
      ORDER BY updated_at DESC LIMIT 200`,
  ).bind(...params).all();
  return apiJson({ data: (rows.results || []).map((row) => ({
    id: row.id, type: row.doc_type, number: row.numero, series: row.serie, accessKey: row.chave_acesso || "",
    status: row.status, sefazStatus: row.status_sefaz || "", sefazMessage: row.motivo_sefaz || "",
    authorizationProtocol: row.protocolo_autorizacao || "", issuedAt: row.data_emissao,
    serviceAmount: Number(row.valor_servico || 0), totalAmount: Number(row.valor_total || 0),
    operationId: row.operation_id || "", clientId: row.client_id || "",
  })) });
}

async function listCiot(env, credential) {
  if (!hasScope(credential, "ciot:read")) return scopeError("ciot:read");
  const clientFilter = credential.client_id ? "AND s.client_id=?" : "";
  const rows = await env.DB.prepare(
    `SELECT c.id,c.number,c.status,c.ciot_code,c.protocol,c.service_order_id,c.operation_id,c.vehicle_plate,
            c.driver_document,c.origin_city,c.origin_state,c.destination_city,c.destination_state,
            c.freight_amount,c.issued_at,c.last_error,s.client_id
       FROM todogreen_ciot_records c
       LEFT JOIN todogreen_service_orders s ON s.id=c.service_order_id
      WHERE c.tenant_id=? AND c.workspace_owner_id=? AND c.archived_at IS NULL ${clientFilter}
      ORDER BY c.created_at DESC LIMIT 200`,
  ).bind(TENANT_ID, credential.workspace_owner_id, ...(credential.client_id ? [credential.client_id] : [])).all();
  return apiJson({ data: (rows.results || []).map((row) => ({
    id: row.id, number: row.number, status: row.status, ciotCode: row.ciot_code || "", protocol: row.protocol || "",
    shipmentId: row.service_order_id || "", operationId: row.operation_id || "", clientId: row.client_id || "",
    vehiclePlate: row.vehicle_plate || "", driverDocument: row.driver_document || "",
    origin: { city: row.origin_city || "", state: row.origin_state || "" },
    destination: { city: row.destination_city || "", state: row.destination_state || "" },
    freightAmount: Number(row.freight_amount || 0), issuedAt: row.issued_at, error: row.last_error || "",
  })) });
}

async function listInvoices(env, credential) {
  if (!hasScope(credential, "billing:read")) return scopeError("billing:read");
  const clientFilter = credential.client_id ? "AND r.client_id=?" : "";
  const rows = await env.DB.prepare(
    `SELECT i.id,i.number,i.series,i.document_type,i.status,i.issued_at,i.amount,i.external_key,i.document_url,
            r.id AS billing_run_id,r.client_id,r.contract_id,r.competence_date
       FROM todogreen_invoices i
       JOIN todogreen_billing_runs r ON r.id=i.billing_run_id
      WHERE i.tenant_id=? AND i.workspace_owner_id=? ${clientFilter}
      ORDER BY i.issued_at DESC LIMIT 200`,
  ).bind(TENANT_ID, credential.workspace_owner_id, ...(credential.client_id ? [credential.client_id] : [])).all();
  return apiJson({ data: (rows.results || []).map((row) => ({
    id: row.id, number: row.number, series: row.series, documentType: row.document_type,
    status: row.status, issuedAt: row.issued_at, amount: Number(row.amount || 0), externalKey: row.external_key || "",
    documentUrl: row.document_url || "", billingRunId: row.billing_run_id, clientId: row.client_id,
    contractId: row.contract_id || "", competenceDate: row.competence_date,
  })) });
}

function openApi(origin) {
  const bearer = [{ tmsApiKey: [] }];
  return {
    openapi: "3.1.0",
    info: {
      title: "To Do Green TMS API",
      version: "1.0.0",
      description: "API externa gratuita do TMS To Do Green para criação e acompanhamento de shipments, tracking, POD, documentos fiscais, CIOT e faturamento.",
    },
    servers: [{ url: `${origin}/api/tms/v1` }],
    components: {
      securitySchemes: { tmsApiKey: { type: "http", scheme: "bearer", bearerFormat: "tdg_live" } },
    },
    paths: {
      "/me": { get: { security: bearer, summary: "Identifica a chave e seus escopos", responses: { 200: { description: "Chave válida" } } } },
      "/shipments": {
        get: { security: bearer, summary: "Lista shipments", responses: { 200: { description: "Lista paginada" } } },
        post: { security: bearer, summary: "Cria shipment/ordem de serviço", parameters: [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string" } }], responses: { 201: { description: "Shipment criado" }, 409: { description: "Contrato ainda não apto" } } },
      },
      "/shipments/{id}": { get: { security: bearer, summary: "Detalha shipment, volumes, viagens, entregas, tracking e POD", parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { 200: { description: "Shipment" } } } },
      "/shipments/{id}/tracking": {
        get: { security: bearer, summary: "Linha do tempo do shipment", responses: { 200: { description: "Eventos" } } },
        post: { security: bearer, summary: "Registra evento de tracking", parameters: [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string" } }], responses: { 201: { description: "Evento registrado" } } },
      },
      "/shipments/{id}/pod": {
        get: { security: bearer, summary: "Lista comprovantes de entrega", responses: { 200: { description: "PODs" } } },
        post: { security: bearer, summary: "Registra POD e pode concluir o shipment", parameters: [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string" } }], responses: { 201: { description: "POD registrado" } } },
      },
      "/fiscal": { get: { security: bearer, summary: "Consulta CT-e e MDF-e", responses: { 200: { description: "Documentos fiscais" } } } },
      "/ciot": { get: { security: bearer, summary: "Consulta CIOT", responses: { 200: { description: "CIOTs" } } } },
      "/invoices": { get: { security: bearer, summary: "Consulta faturamento", responses: { 200: { description: "Faturas" } } } },
    },
  };
}

export async function handlePublicTodoGreenTmsApi(request, env, url) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (url.pathname === "/api/tms/v1/openapi.json") return apiJson(openApi(url.origin));
  if (!env.DB) return apiJson({ error: "service_unavailable", message: "Banco de dados indisponível." }, 503);

  const credential = await credentials(request, env);
  if (!credential) return apiJson({ error: "unauthorized", message: "Chave TMS ausente, inválida ou revogada." }, 401);
  if (credential.rateLimited) return apiJson({ error: "rate_limited", message: "Limite de chamadas por minuto atingido." }, 429, { "retry-after": "60" });

  const rest = url.pathname.replace(/^\/api\/tms\/v1\/?/, "");
  const parts = rest.split("/").filter(Boolean);
  const resource = parts[0] || "me";
  const id = parts[1] || "";
  const action = parts[2] || "";

  if (resource === "me" && request.method === "GET")
    return apiJson({ keyId: credential.id, name: credential.name, clientId: credential.client_id || null, scopes: scopesOf(credential), apiVersion: "v1" });

  if (resource === "shipments" && !id) {
    if (request.method === "GET") return listShipments(env, credential, url);
    if (request.method === "POST") return createShipment(request, env, credential);
  }
  if (resource === "shipments" && id && !action && request.method === "GET") return shipmentDetail(env, credential, id);
  if (resource === "shipments" && id && action === "tracking") {
    if (request.method === "GET") return listTracking(env, credential, id);
    if (request.method === "POST") return addTracking(request, env, credential, id);
  }
  if (resource === "shipments" && id && action === "pod") {
    if (request.method === "GET") return listPods(env, credential, id);
    if (request.method === "POST") return addPod(request, env, credential, id);
  }
  if (resource === "fiscal" && request.method === "GET") return listFiscal(env, credential, url);
  if (resource === "ciot" && request.method === "GET") return listCiot(env, credential);
  if (resource === "invoices" && request.method === "GET") return listInvoices(env, credential);

  return apiJson({ error: "not_found", message: "Rota TMS API não encontrada." }, 404);
}
