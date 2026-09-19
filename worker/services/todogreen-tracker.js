import {
  authenticatedUser,
} from "./todogreen-work-center.js";
import { resolveTodoGreenAccess } from "./todogreen-access.js";
import {
  atualizacaoDeTelemetria,
  atualizacoesDePosicao,
  leituraDeTelemetriaEletrica,
  normalizePlate,
} from "../../src/features/logistics/todoGreenFleetDomain.js";
import { isBlockedHost } from "../lib/net.js";

const TENANT_ID = "todogreen";
const MAX_PROVIDER_ITEMS = 1000;
const MAX_PROVIDER_BODY_BYTES = 5_000_000;

const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const clean = (value, max = 500) => String(value || "").trim().slice(0, max);
const parse = (value, fallback) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
};
const clamp = (value, min, max, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};
const sha256 = async (value) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value || "")),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const canManage = (access) =>
  ["owner", "admin"].includes(access.role) ||
  access.permissions.includes("*") ||
  access.permissions.includes("fleet:manage") ||
  access.permissions.includes("integration:manage");

const DEFAULT_FIELD_MAP = {
  id: "id",
  imei: "imei",
  plate: "plate",
  name: "name",
  latitude: "latitude",
  longitude: "longitude",
  speed: "speed",
  heading: "heading",
  ignition: "ignition",
  odometer: "odometer",
  // Telemetria elétrica — prepared-and-off: só vira snapshot quando o feed
  // mandar. Aponte para o campo do rastreador que traz carga (%) e autonomia.
  soc: "soc",
  range: "range",
  address: "address",
  recordedAt: "recordedAt",
  eventId: "eventId",
  eventType: "eventType",
  severity: "severity",
  title: "title",
};

const valueAt = (source, path, fallback = undefined) => {
  if (!path) return source;
  const value = String(path)
    .split(".")
    .filter(Boolean)
    .reduce((current, key) =>
      current && Object.prototype.hasOwnProperty.call(current, key)
        ? current[key]
        : undefined, source);
  return value === undefined ? fallback : value;
};

const boolValue = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value || "").trim().toLowerCase();
  if (["1", "true", "on", "ligado", "yes", "sim"].includes(normalized)) return true;
  if (["0", "false", "off", "desligado", "no", "nao", "não"].includes(normalized)) return false;
  return null;
};

const dateValue = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const normalizeProviderConfig = (input = {}) => {
  const fieldMap = {};
  for (const key of Object.keys(DEFAULT_FIELD_MAP)) {
    fieldMap[key] = clean(input.fieldMap?.[key] || DEFAULT_FIELD_MAP[key], 120);
  }
  const webhookFieldMap = {};
  for (const key of Object.keys(DEFAULT_FIELD_MAP)) {
    webhookFieldMap[key] = clean(
      input.webhookFieldMap?.[key] || fieldMap[key],
      120,
    );
  }
  return {
    vehiclesPath: clean(input.vehiclesPath, 500),
    collectionPath: clean(input.collectionPath, 160),
    webhookCollectionPath: clean(input.webhookCollectionPath, 160),
    authHeaderName: clean(input.authHeaderName, 80) || "x-api-key",
    fieldMap,
    webhookFieldMap,
  };
};

const containsCredential = (value) => {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    if (/token|secret|password|credential|api.?key/i.test(key)) return true;
    return child && typeof child === "object" && containsCredential(child);
  });
};

const safeExternalUrl = (baseUrl, path) => {
  let base;
  try {
    base = new URL(clean(baseUrl, 1000));
  } catch {
    throw new Error("Informe uma URL base válida para a API da rastreadora.");
  }
  if (base.protocol !== "https:" || isBlockedHost(base.hostname)) {
    throw new Error("A API externa deve usar HTTPS e um endereço público.");
  }
  const relative = clean(path, 500);
  if (!relative) throw new Error("Informe o caminho do endpoint de veículos ou posições.");
  if (/^https?:\/\//i.test(relative)) throw new Error("Use um caminho relativo no endpoint da integração.");
  const root = `${base.origin}${base.pathname.replace(/\/*$/, "/")}`;
  const url = new URL(relative.replace(/^\/+/, ""), root);
  if (url.origin !== base.origin) throw new Error("O endpoint precisa pertencer à URL base configurada.");
  return url;
};

const providerHeaders = (integration, env) => {
  const config = normalizeProviderConfig(parse(integration.provider_config_json, {}));
  const token = clean(env[integration.token_env_key], 5000);
  if (!token) {
    throw new Error(`Cadastre o segredo ${integration.token_env_key} no cofre do Cloudflare Worker.`);
  }
  const headers = { accept: "application/json", "user-agent": "SeuFuncionario-ToDoGreen/1.0" };
  if (integration.auth_mode === "api_key") {
    headers[config.authHeaderName || "x-api-key"] = token;
  } else if (integration.auth_mode === "basic") {
    headers.authorization = `Basic ${btoa(`${integration.external_account_id || ""}:${token}`)}`;
  } else {
    headers.authorization = `Bearer ${token}`;
  }
  if (integration.external_account_id && integration.auth_mode !== "basic") {
    headers["x-account-id"] = integration.external_account_id;
  }
  return headers;
};

async function fetchProvider(integration, env) {
  const config = normalizeProviderConfig(parse(integration.provider_config_json, {}));
  const url = safeExternalUrl(integration.base_url, config.vehiclesPath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const external = await fetch(url, {
      method: "GET",
      headers: providerHeaders(integration, env),
      signal: controller.signal,
    });
    const contentLength = Number(external.headers.get("content-length") || 0);
    if (contentLength > MAX_PROVIDER_BODY_BYTES) throw new Error("A resposta da rastreadora excedeu o limite seguro.");
    const text = await external.text();
    if (text.length > MAX_PROVIDER_BODY_BYTES) throw new Error("A resposta da rastreadora excedeu o limite seguro.");
    if (!external.ok) throw new Error(`A rastreadora respondeu HTTP ${external.status}.`);
    const payload = parse(text, null);
    if (payload === null) throw new Error("A rastreadora não devolveu JSON válido.");
    const collection = config.collectionPath
      ? valueAt(payload, config.collectionPath, [])
      : Array.isArray(payload)
        ? payload
        : payload.vehicles || payload.data || payload.items || [];
    if (!Array.isArray(collection)) {
      throw new Error("Não foi possível localizar a lista de veículos na resposta. Ajuste o caminho da lista.");
    }
    return { payload, collection: collection.slice(0, MAX_PROVIDER_ITEMS), status: external.status };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("A rastreadora não respondeu dentro do tempo limite.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const normalizeVehicle = (raw, config, source = "api") => {
  const map = source === "webhook" ? config.webhookFieldMap : config.fieldMap;
  const plate = clean(valueAt(raw, map.plate), 20).toUpperCase();
  const imei = clean(valueAt(raw, map.imei), 80);
  const externalId = clean(valueAt(raw, map.id) || imei || plate, 160);
  const latitude = Number(valueAt(raw, map.latitude));
  const longitude = Number(valueAt(raw, map.longitude));
  const odometer = Number(valueAt(raw, map.odometer));
  return {
    externalId,
    imei,
    plate,
    name: clean(valueAt(raw, map.name), 160) || plate || externalId,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    speed: clamp(valueAt(raw, map.speed), 0, 400, 0),
    heading: clamp(valueAt(raw, map.heading), 0, 360, 0),
    ignition: boolValue(valueAt(raw, map.ignition)),
    odometer: Number.isFinite(odometer) && odometer >= 0 ? odometer : null,
    // Telemetria elétrica ao vivo (crua; a validação/coação é do domínio).
    soc: valueAt(raw, map.soc),
    rangeKm: valueAt(raw, map.range),
    address: clean(valueAt(raw, map.address), 500),
    recordedAt: dateValue(valueAt(raw, map.recordedAt)),
    eventId: clean(valueAt(raw, map.eventId), 180),
    eventType: clean(valueAt(raw, map.eventType), 100) || "position",
    severity: clean(valueAt(raw, map.severity), 30) || "info",
    title: clean(valueAt(raw, map.title), 240),
    raw,
  };
};

async function integrationForOwner(env, ownerId) {
  return env.DB.prepare(
    `SELECT * FROM todogreen_tracker_integrations
      WHERE workspace_owner_id = ? AND provider = 'sistemas_tracker' AND archived_at IS NULL
      LIMIT 1`,
  ).bind(ownerId).first();
}

async function upsertVehicleLink(env, integration, item) {
  if (!item.externalId) return null;
  const now = new Date().toISOString();
  let localVehicleId = null;
  if (item.plate) {
    const vehicle = await env.DB.prepare(
      `SELECT id FROM todogreen_fleet_vehicles
        WHERE workspace_owner_id = ? AND upper(plate) = ? AND archived_at IS NULL
        LIMIT 1`,
    ).bind(integration.workspace_owner_id, item.plate).first();
    localVehicleId = vehicle?.id || null;
  }
  const current = await env.DB.prepare(
    `SELECT * FROM todogreen_tracker_vehicle_links
      WHERE integration_id = ? AND external_vehicle_id = ? LIMIT 1`,
  ).bind(integration.id, item.externalId).first();
  if (current) {
    await env.DB.prepare(
      `UPDATE todogreen_tracker_vehicle_links
          SET vehicle_id = COALESCE(?, vehicle_id), imei = ?, plate = ?, display_name = ?,
              active = 1, metadata_json = ?, last_seen_at = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      localVehicleId,
      item.imei,
      item.plate,
      item.name,
      JSON.stringify({ source: "tracker", externalId: item.externalId }),
      item.recordedAt,
      now,
      current.id,
    ).run();
    return env.DB.prepare("SELECT * FROM todogreen_tracker_vehicle_links WHERE id = ?")
      .bind(current.id).first();
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO todogreen_tracker_vehicle_links
      (id, integration_id, workspace_owner_id, vehicle_id, external_vehicle_id, imei, plate,
       display_name, active, metadata_json, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  ).bind(
    id,
    integration.id,
    integration.workspace_owner_id,
    localVehicleId,
    item.externalId,
    item.imei,
    item.plate,
    item.name,
    JSON.stringify({ source: "tracker", externalId: item.externalId }),
    item.recordedAt,
    now,
    now,
  ).run();
  return env.DB.prepare("SELECT * FROM todogreen_tracker_vehicle_links WHERE id = ?")
    .bind(id).first();
}

// Snapshot de telemetria elétrica (SOC/autonomia) no veículo da frota. Só age
// quando o feed trouxe SOC ou autonomia (prepared-and-off) E o veículo do
// tracker está casado com um da frota E a leitura é mais nova. Enriquecimento de
// sistema: não incrementa revision nem carimba updated_at (telemetria é
// frequente e não pode reordenar a lista da frota a cada ping).
async function refletirTelemetriaEletrica(env, integration, link, item, source) {
  const vehicleId = link?.vehicle_id;
  if (!vehicleId) return false;
  const leitura = leituraDeTelemetriaEletrica(item);
  if (!leitura) return false;
  const veiculo = await env.DB.prepare(
    `SELECT last_telemetry_at FROM todogreen_fleet_vehicles
      WHERE id = ? AND workspace_owner_id = ? AND archived_at IS NULL LIMIT 1`,
  ).bind(vehicleId, integration.workspace_owner_id).first();
  if (!veiculo) return false;
  const upd = atualizacaoDeTelemetria({ lastTelemetryAt: veiculo.last_telemetry_at || "" }, leitura);
  if (!upd) return false;
  await env.DB.prepare(
    `UPDATE todogreen_fleet_vehicles
        SET last_soc_percent = ?, last_range_km = ?, last_telemetry_at = ?, last_telemetry_source = ?
      WHERE id = ? AND workspace_owner_id = ?`,
  ).bind(
    upd.socPercent, upd.rangeKm, upd.telemetriaEm, `sistemas_tracker:${source}`,
    vehicleId, integration.workspace_owner_id,
  ).run();
  return true;
}

async function storePosition(env, integration, link, item, source) {
  if (!link || item.latitude === null || item.longitude === null) return false;
  if (Math.abs(item.latitude) > 90 || Math.abs(item.longitude) > 180) return false;
  const fingerprint = await sha256(JSON.stringify([
    integration.id,
    item.externalId,
    item.recordedAt,
    item.latitude,
    item.longitude,
    item.speed,
    item.ignition,
  ]));
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_tracker_positions
      (id, integration_id, workspace_owner_id, vehicle_link_id, vehicle_id, external_vehicle_id,
       latitude, longitude, speed_kmh, heading_degrees, ignition, odometer_km, address,
       recorded_at, received_at, source, raw_hash, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    integration.id,
    integration.workspace_owner_id,
    link.id,
    link.vehicle_id || null,
    item.externalId,
    item.latitude,
    item.longitude,
    item.speed,
    item.heading,
    item.ignition === null ? null : item.ignition ? 1 : 0,
    item.odometer,
    item.address,
    item.recordedAt,
    new Date().toISOString(),
    source,
    fingerprint,
    JSON.stringify(item.raw || {}),
  ).run();
  return Number(result.meta?.changes || 0) > 0;
}

async function storeEvent(env, integration, link, item) {
  if (!item.eventType || item.eventType === "position") return false;
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_tracker_events
      (id, integration_id, workspace_owner_id, vehicle_link_id, vehicle_id, external_vehicle_id,
       provider_event_id, event_type, severity, title, latitude, longitude, occurred_at,
       payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    integration.id,
    integration.workspace_owner_id,
    link?.id || null,
    link?.vehicle_id || null,
    item.externalId,
    item.eventId,
    item.eventType,
    item.severity,
    item.title || item.eventType,
    item.latitude,
    item.longitude,
    item.recordedAt,
    JSON.stringify(item.raw || {}),
    now,
  ).run();
  return Number(result.meta?.changes || 0) > 0;
}

async function syncIntegration(env, integration, triggerType = "manual") {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_tracker_sync_runs
      (id, integration_id, workspace_owner_id, trigger_type, status, started_at)
     VALUES (?, ?, ?, ?, 'running', ?)`,
  ).bind(runId, integration.id, integration.workspace_owner_id, triggerType, startedAt).run();
  try {
    const config = normalizeProviderConfig(parse(integration.provider_config_json, {}));
    const external = await fetchProvider(integration, env);
    let imported = 0;
    let updated = 0;
    let ignored = 0;
    let errors = 0;
    for (const raw of external.collection) {
      try {
        const item = normalizeVehicle(raw, config, "api");
        if (!item.externalId) {
          ignored += 1;
          continue;
        }
        const link = await upsertVehicleLink(env, integration, item);
        updated += link ? 1 : 0;
        if (await storePosition(env, integration, link, item, "api")) imported += 1;
        else ignored += 1;
        if (await storeEvent(env, integration, link, item)) imported += 1;
        await refletirTelemetriaEletrica(env, integration, link, item, "api");
      } catch {
        errors += 1;
      }
    }
    const finishedAt = new Date().toISOString();
    const status = errors && !imported && !updated ? "failed" : errors ? "partial" : "success";
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE todogreen_tracker_sync_runs
            SET status = ?, imported_count = ?, updated_count = ?, ignored_count = ?,
                error_count = ?, finished_at = ?
          WHERE id = ?`,
      ).bind(status, imported, updated, ignored, errors, finishedAt, runId),
      env.DB.prepare(
        `UPDATE todogreen_tracker_integrations
            SET status = ?, last_sync_at = ?, last_success_at = ?, last_error = '', updated_at = ?
          WHERE id = ?`,
      ).bind(status === "failed" ? "error" : "active", finishedAt, finishedAt, finishedAt, integration.id),
    ]);
    // Depois de gravar as posições, propaga a última leitura às operações em
    // curso. Best-effort: uma falha aqui não derruba a sincronização do tracker.
    let operacoesAtualizadas = 0;
    try { operacoesAtualizadas = await sincronizarPosicoesOperacoes(env, integration.workspace_owner_id); } catch { /* enriquecimento */ }
    return { runId, status, imported, updated, ignored, errors, total: external.collection.length, operacoesAtualizadas };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = clean(error?.message || "Falha na sincronização.", 1000);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE todogreen_tracker_sync_runs
            SET status = 'failed', error_count = 1, error_message = ?, finished_at = ?
          WHERE id = ?`,
      ).bind(message, finishedAt, runId),
      env.DB.prepare(
        `UPDATE todogreen_tracker_integrations
            SET status = 'error', last_sync_at = ?, last_error = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(finishedAt, message, finishedAt, integration.id),
    ]);
    throw new Error(message);
  }
}

// Ponte rastreador → operação: pega a última posição do tracker por placa e
// carimba as operações em curso da mesma placa (last_position_*). É a leitura
// que faltava para o cockpit e o portal do cliente mostrarem "onde está" sem
// digitação. Só avança o horário — nunca regride —, e não toca em operação
// entregue. O `revision` da operação NÃO é incrementado: é enriquecimento de
// sistema, não pode conflitar com quem edita a operação ao mesmo tempo.
async function sincronizarPosicoesOperacoes(env, ownerId) {
  const [posRows, opRows] = await Promise.all([
    env.DB.prepare(
      `SELECT l.plate AS plate, p.latitude, p.longitude, p.recorded_at
         FROM todogreen_tracker_vehicle_links l
         JOIN todogreen_tracker_positions p ON p.id = (
           SELECT p2.id FROM todogreen_tracker_positions p2
            WHERE p2.vehicle_link_id = l.id
            ORDER BY p2.recorded_at DESC LIMIT 1
         )
        WHERE l.workspace_owner_id = ? AND l.plate != ''`,
    ).bind(ownerId).all(),
    env.DB.prepare(
      `SELECT id, vehicle_plate, last_position_at
         FROM todogreen_client_operations
        WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
          AND (delivered_at IS NULL OR delivered_at = '') AND vehicle_plate != ''`,
    ).bind(TENANT_ID, ownerId).all(),
  ]);

  const posicoesPorPlaca = {};
  for (const r of posRows.results || []) {
    // Se duas placas iguais vierem de links diferentes, fica com a leitura mais nova.
    const chave = normalizePlate(r.plate);
    const nova = String(r.recorded_at || "");
    if (!posicoesPorPlaca[chave] || nova > String(posicoesPorPlaca[chave].recordedAt || "")) {
      posicoesPorPlaca[chave] = { latitude: r.latitude, longitude: r.longitude, recordedAt: nova };
    }
  }
  const operacoes = (opRows.results || []).map((r) => ({
    id: r.id, vehiclePlate: r.vehicle_plate, lastPositionAt: r.last_position_at || "",
  }));
  const updates = atualizacoesDePosicao(operacoes, posicoesPorPlaca);
  if (!updates.length) return 0;

  const agora = new Date().toISOString();
  await env.DB.batch(updates.map((u) => env.DB.prepare(
    `UPDATE todogreen_client_operations
        SET last_position_lat = ?, last_position_lng = ?, last_position_at = ?, updated_at = ?
      WHERE id = ? AND workspace_owner_id = ?`,
  ).bind(u.latitude, u.longitude, u.recordedAt, agora, u.operationId, ownerId)));
  return updates.length;
}

const mapIntegration = (row, env) => {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    baseUrl: row.base_url,
    externalAccountId: row.external_account_id,
    authMode: row.auth_mode,
    tokenEnvKey: row.token_env_key,
    webhookSecretEnvKey: row.webhook_secret_env_key,
    tokenConfigured: Boolean(env[row.token_env_key]),
    webhookConfigured: Boolean(env[row.webhook_secret_env_key]),
    status: row.status,
    syncMode: row.sync_mode,
    pollingIntervalMinutes: row.polling_interval_minutes,
    readOnly: Boolean(row.read_only),
    providerConfig: normalizeProviderConfig(parse(row.provider_config_json, {})),
    lastTestAt: row.last_test_at || "",
    lastSyncAt: row.last_sync_at || "",
    lastSuccessAt: row.last_success_at || "",
    lastError: row.last_error || "",
    revision: row.revision,
    updatedAt: row.updated_at,
  };
};

async function summary(env, ownerId, integrationId) {
  if (!integrationId) return { linkedVehicles: 0, positions: 0, events: 0, latestPositionAt: "" };
  const [links, positions, events, latest] = await Promise.all([
    env.DB.prepare(
      `SELECT count(*) AS total FROM todogreen_tracker_vehicle_links
        WHERE workspace_owner_id = ? AND integration_id = ? AND active = 1`,
    ).bind(ownerId, integrationId).first(),
    env.DB.prepare(
      `SELECT count(*) AS total FROM todogreen_tracker_positions
        WHERE workspace_owner_id = ? AND integration_id = ?`,
    ).bind(ownerId, integrationId).first(),
    env.DB.prepare(
      `SELECT count(*) AS total FROM todogreen_tracker_events
        WHERE workspace_owner_id = ? AND integration_id = ?`,
    ).bind(ownerId, integrationId).first(),
    env.DB.prepare(
      `SELECT recorded_at FROM todogreen_tracker_positions
        WHERE workspace_owner_id = ? AND integration_id = ?
        ORDER BY recorded_at DESC LIMIT 1`,
    ).bind(ownerId, integrationId).first(),
  ]);
  return {
    linkedVehicles: Number(links?.total || 0),
    positions: Number(positions?.total || 0),
    events: Number(events?.total || 0),
    latestPositionAt: latest?.recorded_at || "",
  };
}

async function listVehicles(env, ownerId, integrationId) {
  if (!integrationId) return [];
  const rows = await env.DB.prepare(
    `SELECT l.id, l.vehicle_id, l.external_vehicle_id, l.imei, l.plate, l.display_name,
            l.active, l.last_seen_at, v.prefix, v.manufacturer, v.model,
            p.latitude, p.longitude, p.speed_kmh, p.heading_degrees, p.ignition,
            p.odometer_km, p.address, p.recorded_at
       FROM todogreen_tracker_vehicle_links l
       LEFT JOIN todogreen_fleet_vehicles v ON v.id = l.vehicle_id
       LEFT JOIN todogreen_tracker_positions p
         ON p.id = (
           SELECT p2.id FROM todogreen_tracker_positions p2
            WHERE p2.vehicle_link_id = l.id
            ORDER BY p2.recorded_at DESC LIMIT 1
         )
      WHERE l.workspace_owner_id = ? AND l.integration_id = ? AND l.active = 1
      ORDER BY coalesce(v.prefix, l.display_name, l.plate), l.external_vehicle_id
      LIMIT 500`,
  ).bind(ownerId, integrationId).all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    vehicleId: row.vehicle_id || "",
    externalVehicleId: row.external_vehicle_id,
    imei: row.imei,
    plate: row.plate,
    name: row.display_name,
    prefix: row.prefix || "",
    vehicle: [row.manufacturer, row.model].filter(Boolean).join(" "),
    linked: Boolean(row.vehicle_id),
    lastSeenAt: row.last_seen_at || "",
    position: row.recorded_at ? {
      latitude: row.latitude,
      longitude: row.longitude,
      speedKmh: row.speed_kmh,
      headingDegrees: row.heading_degrees,
      ignition: row.ignition === null ? null : Boolean(row.ignition),
      odometerKm: row.odometer_km,
      address: row.address,
      recordedAt: row.recorded_at,
    } : null,
  }));
}

async function saveConfig(request, env, access, user, current) {
  if (!canManage(access)) return response({ error: "Você não pode configurar integrações." }, 403);
  const body = await request.json().catch(() => ({}));
  if (body.token || body.apiKey || body.password || body.secret || body.webhookSecret) {
    return response({ error: "Credenciais não são salvas no banco. Cadastre-as como segredo do Cloudflare Worker." }, 400);
  }
  if (containsCredential(body.providerConfig)) {
    return response({ error: "A configuração avançada não pode conter credenciais." }, 400);
  }
  const baseUrl = clean(body.baseUrl, 1000);
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== "https:" || isBlockedHost(parsed.hostname)) throw new Error();
    } catch {
      return response({ error: "Informe uma URL HTTPS pública e válida." }, 400);
    }
  }
  const authMode = ["bearer", "api_key", "basic"].includes(body.authMode)
    ? body.authMode
    : "bearer";
  const syncMode = ["manual", "polling", "webhook"].includes(body.syncMode)
    ? body.syncMode
    : "manual";
  const tokenEnvKey = clean(body.tokenEnvKey, 120) || "TODOGREEN_TRACKER_API_TOKEN";
  const webhookSecretEnvKey = clean(body.webhookSecretEnvKey, 120) || "TODOGREEN_TRACKER_WEBHOOK_SECRET";
  if (!/^[A-Z][A-Z0-9_]{2,119}$/.test(tokenEnvKey) || !/^[A-Z][A-Z0-9_]{2,119}$/.test(webhookSecretEnvKey)) {
    return response({ error: "Os nomes dos segredos devem usar letras maiúsculas, números e sublinhado." }, 400);
  }
  const now = new Date().toISOString();
  const config = normalizeProviderConfig(body.providerConfig || {});
  const ready = Boolean(baseUrl && config.vehiclesPath);
  if (current) {
    if (body.revision && Number(body.revision) !== Number(current.revision)) {
      return response({ error: "A integração foi alterada por outra pessoa. Recarregue.", code: "revision_conflict" }, 409);
    }
    await env.DB.prepare(
      `UPDATE todogreen_tracker_integrations
          SET name = ?, base_url = ?, external_account_id = ?, auth_mode = ?, token_env_key = ?,
              webhook_secret_env_key = ?, status = ?, sync_mode = ?, polling_interval_minutes = ?,
              read_only = 1, provider_config_json = ?, revision = revision + 1,
              updated_by = ?, updated_at = ?
        WHERE id = ? AND workspace_owner_id = ?`,
    ).bind(
      clean(body.name, 120) || "Sistemas Tracker",
      baseUrl,
      clean(body.externalAccountId, 180),
      authMode,
      tokenEnvKey,
      webhookSecretEnvKey,
      ready ? "ready" : "draft",
      syncMode,
      Math.round(clamp(body.pollingIntervalMinutes, 60, 1440, 60)),
      JSON.stringify(config),
      user.id,
      now,
      current.id,
      access.ownerId,
    ).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO todogreen_tracker_integrations
        (id, tenant_id, workspace_owner_id, provider, name, base_url, external_account_id,
         auth_mode, token_env_key, webhook_secret_env_key, status, sync_mode,
         polling_interval_minutes, read_only, provider_config_json, revision,
         created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, 'sistemas_tracker', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      TENANT_ID,
      access.ownerId,
      clean(body.name, 120) || "Sistemas Tracker",
      baseUrl,
      clean(body.externalAccountId, 180),
      authMode,
      tokenEnvKey,
      webhookSecretEnvKey,
      ready ? "ready" : "draft",
      syncMode,
      Math.round(clamp(body.pollingIntervalMinutes, 60, 1440, 60)),
      JSON.stringify(config),
      user.id,
      user.id,
      now,
      now,
    ).run();
  }
  const saved = await integrationForOwner(env, access.ownerId);
  return response({ integration: mapIntegration(saved, env) }, current ? 200 : 201);
}

const secureEquals = (left, right) => {
  const a = new TextEncoder().encode(String(left || ""));
  const b = new TextEncoder().encode(String(right || ""));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
};

async function verifyWebhook(rawBody, request, integration, env) {
  const secret = clean(env[integration.webhook_secret_env_key], 5000);
  if (!secret) return { ok: false, status: 503, error: `Cadastre o segredo ${integration.webhook_secret_env_key}.` };
  const provided = clean(request.headers.get("x-tracker-signature"), 500)
    .replace(/^sha256=/i, "")
    .toLowerCase();
  if (!provided) return { ok: false, status: 401, error: "Assinatura do webhook ausente." };
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(signed)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return secureEquals(provided, expected)
    ? { ok: true }
    : { ok: false, status: 401, error: "Assinatura do webhook inválida." };
}

async function receiveWebhook(request, env, integrationId) {
  const integration = await env.DB.prepare(
    `SELECT * FROM todogreen_tracker_integrations
      WHERE id = ? AND archived_at IS NULL LIMIT 1`,
  ).bind(integrationId).first();
  if (!integration) return response({ error: "Integração não encontrada." }, 404);
  const rawBody = await request.text();
  if (rawBody.length > MAX_PROVIDER_BODY_BYTES) return response({ error: "Payload excede o limite seguro." }, 413);
  const verified = await verifyWebhook(rawBody, request, integration, env);
  if (!verified.ok) return response({ error: verified.error }, verified.status);
  const payload = parse(rawBody, null);
  if (payload === null) return response({ error: "JSON inválido." }, 400);
  const config = normalizeProviderConfig(parse(integration.provider_config_json, {}));
  const collection = config.webhookCollectionPath
    ? valueAt(payload, config.webhookCollectionPath, [])
    : Array.isArray(payload)
      ? payload
      : payload.events || payload.positions || payload.items || [payload];
  if (!Array.isArray(collection)) return response({ error: "Não foi possível localizar os eventos do webhook." }, 400);
  let accepted = 0;
  let ignored = 0;
  for (const raw of collection.slice(0, MAX_PROVIDER_ITEMS)) {
    const item = normalizeVehicle(raw, config, "webhook");
    if (!item.externalId) {
      ignored += 1;
      continue;
    }
    const link = await upsertVehicleLink(env, integration, item);
    const position = await storePosition(env, integration, link, item, "webhook");
    const event = await storeEvent(env, integration, link, item);
    await refletirTelemetriaEletrica(env, integration, link, item, "webhook");
    if (position || event) accepted += 1;
    else ignored += 1;
  }
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_tracker_integrations
        SET status = 'active', last_success_at = ?, last_error = '', updated_at = ?
      WHERE id = ?`,
  ).bind(now, now, integration.id).run();
  return response({ ok: true, accepted, ignored }, 202);
}

export async function handleTodoGreenTracker(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/todogreen/tracker")) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const action = parts[3] || "";

  if (request.method === "POST" && action === "webhook") {
    return receiveWebhook(request, env, clean(parts[4], 100));
  }

  const user = await authenticatedUser(request, env);
  if (!user) return response({ error: "Sua sessão expirou. Entre novamente." }, 401);
  const { access, motivo } = await resolveTodoGreenAccess(env, user, url.searchParams.get("owner"));
  if (!access && motivo === "espaco-nao-autorizado")
    return response({ error: "Este espaço de trabalho não pertence à sua conta." }, 404);
  if (!access) return response({ error: "Você não tem acesso à To Do Green." }, 403);
  const integration = await integrationForOwner(env, access.ownerId);

  if (request.method === "GET" && !action) {
    return response({
      integration: mapIntegration(integration, env),
      summary: await summary(env, access.ownerId, integration?.id),
      access: { role: access.role, canManage: canManage(access) },
      requirements: {
        apiDocumentation: !integration?.base_url,
        apiSecret: integration ? !env[integration.token_env_key] : true,
        webhookSecret: integration ? !env[integration.webhook_secret_env_key] : true,
      },
    });
  }

  if (request.method === "GET" && action === "vehicles") {
    return response({ vehicles: await listVehicles(env, access.ownerId, integration?.id) });
  }

  if (request.method === "PUT" && action === "config") {
    return saveConfig(request, env, access, user, integration);
  }

  if (request.method === "POST" && action === "test") {
    if (!canManage(access)) return response({ error: "Você não pode testar integrações." }, 403);
    if (!integration) return response({ error: "Salve a configuração antes de testar." }, 409);
    try {
      const external = await fetchProvider(integration, env);
      const now = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE todogreen_tracker_integrations
            SET status = 'ready', last_test_at = ?, last_error = '', updated_at = ?
          WHERE id = ?`,
      ).bind(now, now, integration.id).run();
      return response({ ok: true, httpStatus: external.status, itemsFound: external.collection.length, testedAt: now });
    } catch (error) {
      const now = new Date().toISOString();
      const message = clean(error?.message, 1000);
      await env.DB.prepare(
        `UPDATE todogreen_tracker_integrations
            SET status = 'error', last_test_at = ?, last_error = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(now, message, now, integration.id).run();
      return response({ error: message }, 422);
    }
  }

  if (request.method === "POST" && action === "sync") {
    if (!canManage(access)) return response({ error: "Você não pode sincronizar integrações." }, 403);
    if (!integration) return response({ error: "Salve a configuração antes de sincronizar." }, 409);
    try {
      return response(await syncIntegration(env, integration, "manual"), 202);
    } catch (error) {
      return response({ error: clean(error?.message, 1000) }, 422);
    }
  }

  // Propaga, sob demanda, a última posição do tracker às operações em curso —
  // útil quando as posições chegam por webhook (sem passar por syncIntegration)
  // ou para forçar o carimbo sem uma sincronização completa.
  if (request.method === "POST" && action === "sync-operations") {
    if (!canManage(access)) return response({ error: "Você não pode sincronizar posições." }, 403);
    const operacoesAtualizadas = await sincronizarPosicoesOperacoes(env, access.ownerId);
    return response({ ok: true, operacoesAtualizadas });
  }

  return response({ error: "Método não permitido." }, 405);
}

export async function runTodoGreenTrackerScheduled(env) {
  if (!env.DB) return;
  const rows = await env.DB.prepare(
    `SELECT * FROM todogreen_tracker_integrations
      WHERE status IN ('ready', 'active', 'error')
        AND sync_mode = 'polling'
        AND archived_at IS NULL
      ORDER BY coalesce(last_sync_at, created_at)
      LIMIT 10`,
  ).all();
  const now = Date.now();
  for (const integration of rows.results || []) {
    const last = new Date(integration.last_sync_at || integration.created_at).getTime();
    const interval = Math.max(60, Number(integration.polling_interval_minutes) || 60) * 60_000;
    if (Number.isFinite(last) && now - last < interval) continue;
    try {
      await syncIntegration(env, integration, "scheduled");
    } catch (error) {
      console.error("To Do Green Tracker scheduled sync error", integration.id, error);
    }
  }
}

// Retenção de posições do rastreador. `todogreen_tracker_positions` recebe uma
// linha a cada polling de cada veículo — é a coleção de maior volume da vertical
// e, sem teto, cresce indefinidamente no D1. O portal do cliente só lê a janela
// de 6h e o cockpit usa a posição mais recente, então posição além da janela de
// retenção é histórico puro que só ocupa espaço.
//
// Apaga em LOTE limitado por disparo, para que um backlog grande drene ao longo
// de vários crons sem estourar o orçamento de CPU/subrequests do Worker — um
// DELETE sem teto sobre uma tabela de milhões de linhas é a limpeza que derruba
// justamente quando é mais necessária. A limpeza corre em todos os espaços de
// uma vez (filtro por `recorded_at`, sem `workspace_owner_id`): é manutenção da
// plataforma, não uma operação de negócio de um espaço.
//
// Piso de 7 dias: um env var mal configurado não pode apagar dado quase vivo.
export const TRACKER_RETENCAO_DIAS_PADRAO = 90;
const MAX_EXPURGO_POR_DISPARO = 5000;

export async function expurgarPosicoesAntigasDoTracker(env, now = new Date()) {
  if (!env.DB) return { removidas: 0 };
  // Sem valor (ou não numérico) usa o padrão; com valor, o piso de 7 dias age
  // sobre ele — um `|| padrão` faria "0" cair no padrão em vez de bater no piso.
  const bruto = String(env.TODOGREEN_TRACKER_RETENTION_DAYS ?? "").trim();
  const configurado = bruto && Number.isFinite(Number(bruto)) ? Number(bruto) : TRACKER_RETENCAO_DIAS_PADRAO;
  const dias = Math.max(7, Math.trunc(configurado));
  const limite = new Date(now.getTime() - dias * 86_400_000).toISOString();
  const resultado = await env.DB.prepare(
    `DELETE FROM todogreen_tracker_positions
      WHERE id IN (
        SELECT id FROM todogreen_tracker_positions
         WHERE recorded_at < ?
         ORDER BY recorded_at ASC
         LIMIT ?
      )`,
  ).bind(limite, MAX_EXPURGO_POR_DISPARO).run();
  return { removidas: resultado?.meta?.changes || 0, limite, dias };
}
