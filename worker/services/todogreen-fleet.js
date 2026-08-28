import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
// A classe do veículo, de moto a carreta. Até aqui a frota só tinha `category`
// em texto livre, e texto livre faz custo por km, unidade de cobrança,
// habilitação exigida e restrição urbana caírem no mesmo balde.
import {
  isVehicleClass,
  normalizeVehicleClass,
  validateVehicleClass,
  vehicleClass,
} from "../../src/features/logistics/vehicleClassDomain.js";
import { consolidarEconomiaFrota, normalizePlate } from "../../src/features/logistics/todoGreenFleetDomain.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clean = (value, max = 500) => String(value || "").trim().slice(0, max);
const parse = (value, fallback) => { try { return JSON.parse(value || ""); } catch { return fallback; } };

const canWrite = (access) => ["fleet:manage", "operations:manage", "operation:manage", "planning:manage"]
  .some((permission) => podeNaVertical(access, permission));

const mapVehicle = (row) => ({
  id: row.id, prefix: row.prefix, plate: row.plate, manufacturer: row.manufacturer, model: row.model, modelYear: row.model_year,
  category: row.category,
  // A classe canônica, de moto a carreta. Quando o cadastro antigo só tem
  // `category` em texto livre, deriva dela — assim a frota herdada aparece
  // classificada sem ninguém redigitar. `vehicleClassLabel` é vazio quando não
  // dá para reconhecer, e a tela pede a escolha em vez de chutar.
  vehicleClass: row.vehicle_class || normalizeVehicleClass(row.category),
  vehicleClassLabel: vehicleClass(row.vehicle_class || normalizeVehicleClass(row.category))?.name || "",
  energyType: row.energy_type, status: row.status, operationalUnit: row.operational_unit, costCenter: row.cost_center,
  payloadKg: row.payload_kg, volumeM3: row.volume_m3, palletCapacity: row.pallet_capacity, odometerKm: row.odometer_km,
  acquisitionValue: row.acquisition_value, monthlyFixedCost: row.monthly_fixed_cost, revenueAccumulated: row.revenue_accumulated,
  costAccumulated: row.cost_accumulated, energyConsumptionKwhPerKm: row.energy_consumption_kwh_per_km,
  emissionFactorKgCo2ePerKwh: row.emission_factor_kgco2e_per_kwh, batteryCapacityKwh: row.battery_capacity_kwh,
  batterySohPercent: row.battery_soh_percent, nominalRangeKm: row.nominal_range_km, realRangeKm: row.real_range_km,
  nextMaintenanceAt: row.next_maintenance_at || "", nextDocumentDueAt: row.next_document_due_at || "",
  fields: parse(row.fields_json, {}), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
});
const num = (value) => Math.max(0, Number(value) || 0);
const FIELD_KEYS = [
  "currentDriver", "lastAddress", "speedKmh", "hourmeter", "batteryVoltage", "currentRoute",
  "referencePoint", "geofence", "lastEvent", "movementState", "driverRfid", "journeyStatus",
];
const vehicleFields = (body = {}, previous = {}) => {
  const fields = { ...(previous && typeof previous === "object" ? previous : {}), ...(body.fields && typeof body.fields === "object" ? body.fields : {}) };
  for (const key of FIELD_KEYS) {
    if (!(key in body)) continue;
    fields[key] = ["speedKmh", "hourmeter", "batteryVoltage"].includes(key)
      ? num(body[key])
      : clean(body[key], key === "lastEvent" ? 500 : 160);
  }
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== "" && value !== null && value !== undefined));
};

export async function handleTodoGreenFleet(request, env, access, user) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/todogreen/fleet")) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const vehicleId = parts[3] || "";
  const subresource = parts[4] || "";
  const subresourceId = parts[5] || "";

  if (request.method === "GET" && !vehicleId) {
    const rows = await env.DB.prepare(`SELECT * FROM todogreen_fleet_vehicles WHERE workspace_owner_id = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 500`)
      .bind(access.ownerId).all();
    const vehicles = (rows.results || []).map(mapVehicle);
    return json({ vehicles, access: { role: access.role, canWrite: canWrite(access) } });
  }

  // Economia real da frota: custo de manutenção somado por veículo (hoje preso
  // em cada ordem) cruzado com o km e as viagens que a operação de fato rodou,
  // por placa. Leitura — liberada a quem já vê a frota, antes da trava de escrita.
  if (request.method === "GET" && vehicleId === "economics") {
    const [vehiclesRows, manRows, opsRows] = await Promise.all([
      env.DB.prepare(`SELECT * FROM todogreen_fleet_vehicles WHERE workspace_owner_id = ? AND archived_at IS NULL LIMIT 500`)
        .bind(access.ownerId).all(),
      env.DB.prepare(
        `SELECT vehicle_id,
                SUM(CASE WHEN status != 'canceled' THEN parts_cost + labor_cost + other_cost ELSE 0 END) AS total,
                SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS abertas,
                COUNT(*) AS ordens,
                COALESCE(SUM(downtime_hours), 0) AS downtime
           FROM todogreen_fleet_maintenance_orders
          WHERE workspace_owner_id = ? AND archived_at IS NULL
          GROUP BY vehicle_id`,
      ).bind(access.ownerId).all(),
      env.DB.prepare(
        `SELECT vehicle_plate,
                COUNT(*) AS operacoes,
                COALESCE(SUM(distance_km), 0) AS km_total,
                SUM(CASE WHEN delivered_at IS NOT NULL AND delivered_at != '' THEN 1 ELSE 0 END) AS entregues,
                SUM(CASE WHEN (delivered_at IS NULL OR delivered_at = '')
                          AND status NOT IN ('entregue','cancelada','concluida') THEN 1 ELSE 0 END) AS ativas
           FROM todogreen_client_operations
          WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL AND vehicle_plate != ''
          GROUP BY vehicle_plate`,
      ).bind(TENANT_ID, access.ownerId).all(),
    ]);
    const vehicles = (vehiclesRows.results || []).map(mapVehicle);
    const manutencaoPorVeiculo = {};
    for (const r of manRows.results || []) {
      manutencaoPorVeiculo[r.vehicle_id] = {
        total: num(r.total), abertas: num(r.abertas), ordens: num(r.ordens), downtimeHoras: num(r.downtime),
      };
    }
    const operacoesPorPlaca = {};
    for (const r of opsRows.results || []) {
      operacoesPorPlaca[normalizePlate(r.vehicle_plate)] = {
        operacoes: num(r.operacoes), kmTotal: num(r.km_total), entregues: num(r.entregues), ativas: num(r.ativas),
      };
    }
    return json({ economics: consolidarEconomiaFrota(vehicles, manutencaoPorVeiculo, operacoesPorPlaca) });
  }

  if (request.method === "GET" && vehicleId && subresource === "maintenance") {
    const rows = await env.DB.prepare(`SELECT * FROM todogreen_fleet_maintenance_orders WHERE workspace_owner_id = ? AND vehicle_id = ? AND archived_at IS NULL ORDER BY created_at DESC LIMIT 200`)
      .bind(access.ownerId, vehicleId).all();
    return json({ orders: rows.results || [] });
  }

  if (!canWrite(access)) return json({ error: "Você não pode alterar a Frota." }, 403);

  if (request.method === "POST" && !vehicleId) {
    const body = await request.json().catch(() => ({}));
    if (!clean(body.prefix, 50)) return json({ error: "Informe o prefixo do veículo." }, 400);
    // A classe vem declarada ou é derivada de `category`. Quando nenhuma das
    // duas dá uma classe conhecida, fica vazia — e a tela pede a escolha, em vez
    // de chutar: classificar carreta como van erraria custo, cobrança,
    // habilitação e restrição urbana de uma vez.
    const classeNova = isVehicleClass(body.vehicleClass)
      ? clean(body.vehicleClass, 40).toLowerCase()
      : normalizeVehicleClass(body.category);
    // Energia impossível na classe é recusada com a lista do que é possível —
    // é o que impede a proposta de prometer emissão zero numa carreta.
    if (classeNova) {
      const erroClasse = validateVehicleClass({ vehicleClass: classeNova, energyType: body.energyType });
      if (erroClasse) return json({ error: erroClasse }, 400);
    }
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO todogreen_fleet_vehicles
      (id, tenant_id, workspace_owner_id, prefix, plate, manufacturer, model, model_year, category, vehicle_class, energy_type, status,
       operational_unit, cost_center, payload_kg, volume_m3, pallet_capacity, odometer_km, acquisition_value, monthly_fixed_cost,
       revenue_accumulated, cost_accumulated, energy_consumption_kwh_per_km, emission_factor_kgco2e_per_kwh, battery_capacity_kwh,
       battery_soh_percent, nominal_range_km, real_range_km, next_maintenance_at, next_document_due_at, fields_json, revision,
       created_by, updated_by, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`)
      .bind(id, TENANT_ID, access.ownerId, clean(body.prefix, 50), clean(body.plate, 20).toUpperCase(), clean(body.manufacturer, 100), clean(body.model, 100), Number(body.modelYear) || null,
        clean(body.category, 80), classeNova, clean(body.energyType, 40) || "electric", clean(body.status, 40) || "available", clean(body.operationalUnit, 120), clean(body.costCenter, 120),
        num(body.payloadKg), num(body.volumeM3), num(body.palletCapacity), num(body.odometerKm), num(body.acquisitionValue), num(body.monthlyFixedCost), num(body.revenueAccumulated),
        num(body.costAccumulated), num(body.energyConsumptionKwhPerKm), num(body.emissionFactorKgCo2ePerKwh), num(body.batteryCapacityKwh), Math.min(100, num(body.batterySohPercent || 100)),
        num(body.nominalRangeKm), num(body.realRangeKm), clean(body.nextMaintenanceAt, 20) || null, clean(body.nextDocumentDueAt, 20) || null, JSON.stringify(vehicleFields(body)), user.id, user.id, now, now).run();
    const row = await env.DB.prepare("SELECT * FROM todogreen_fleet_vehicles WHERE id = ?").bind(id).first();
    return json({ vehicle: mapVehicle(row) }, 201);
  }

  if (request.method === "PATCH" && vehicleId && !subresource) {
    const body = await request.json().catch(() => ({}));
    const current = await env.DB.prepare("SELECT * FROM todogreen_fleet_vehicles WHERE id = ? AND workspace_owner_id = ? AND archived_at IS NULL").bind(vehicleId, access.ownerId).first();
    if (!current) return json({ error: "Veículo não encontrado." }, 404);
    if (body.revision && Number(body.revision) !== Number(current.revision)) return json({ error: "Veículo alterado por outra pessoa. Recarregue.", code: "revision_conflict", current: mapVehicle(current) }, 409);
    // União: o merge de campos do `vehicleFields` (que preserva o que já estava
    // gravado) com a classe de veículo. A classe pode ser corrigida à mão; na
    // falta dela, é derivada de `category`. Trocar a classe sem conferir a
    // energia deixaria uma carreta marcada como elétrica.
    const before = mapVehicle(current); const next = { ...before, ...body, fields: vehicleFields(body, before.fields) }; const now = new Date().toISOString();
    const classeNext = isVehicleClass(next.vehicleClass)
      ? clean(next.vehicleClass, 40).toLowerCase()
      : normalizeVehicleClass(next.category);
    if (classeNext) {
      const erroClasse = validateVehicleClass({ vehicleClass: classeNext, energyType: next.energyType });
      if (erroClasse) return json({ error: erroClasse }, 400);
    }
    await env.DB.prepare(`UPDATE todogreen_fleet_vehicles SET prefix=?, plate=?, manufacturer=?, model=?, model_year=?, category=?, vehicle_class=?, energy_type=?, status=?, operational_unit=?, cost_center=?, payload_kg=?, volume_m3=?, pallet_capacity=?, odometer_km=?, acquisition_value=?, monthly_fixed_cost=?, revenue_accumulated=?, cost_accumulated=?, energy_consumption_kwh_per_km=?, emission_factor_kgco2e_per_kwh=?, battery_capacity_kwh=?, battery_soh_percent=?, nominal_range_km=?, real_range_km=?, next_maintenance_at=?, next_document_due_at=?, fields_json=?, revision=revision+1, updated_by=?, updated_at=? WHERE id=? AND workspace_owner_id=? AND revision=?`)
      .bind(clean(next.prefix,50), clean(next.plate,20).toUpperCase(), clean(next.manufacturer,100), clean(next.model,100), Number(next.modelYear)||null, clean(next.category,80), classeNext, clean(next.energyType,40), clean(next.status,40), clean(next.operationalUnit,120), clean(next.costCenter,120), num(next.payloadKg), num(next.volumeM3), num(next.palletCapacity), num(next.odometerKm), num(next.acquisitionValue), num(next.monthlyFixedCost), num(next.revenueAccumulated), num(next.costAccumulated), num(next.energyConsumptionKwhPerKm), num(next.emissionFactorKgCo2ePerKwh), num(next.batteryCapacityKwh), Math.min(100,num(next.batterySohPercent)), num(next.nominalRangeKm), num(next.realRangeKm), clean(next.nextMaintenanceAt,20)||null, clean(next.nextDocumentDueAt,20)||null, JSON.stringify(next.fields||{}), user.id, now, vehicleId, access.ownerId, current.revision).run();
    const row = await env.DB.prepare("SELECT * FROM todogreen_fleet_vehicles WHERE id = ?").bind(vehicleId).first();
    return json({ vehicle: mapVehicle(row) });
  }

  if (request.method === "POST" && vehicleId && subresource === "maintenance") {
    const body = await request.json().catch(() => ({}));
    if (!clean(body.title, 200)) return json({ error: "Informe o título da manutenção." }, 400);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO todogreen_fleet_maintenance_orders (id, workspace_owner_id, vehicle_id, maintenance_type, status, title, description, supplier, scheduled_at, downtime_hours, parts_cost, labor_cost, other_cost, fields_json, revision, created_by, updated_by, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, 0, 0, 0, 0, '{}', 1, ?, ?, ?, ?, NULL)`)
      .bind(id, access.ownerId, vehicleId, clean(body.maintenanceType,60)||"preventive", clean(body.title,200), clean(body.description,2000), clean(body.supplier,160), clean(body.scheduledAt,30)||null, user.id, user.id, now, now).run();
    return json({ ok: true, id }, 201);
  }

  // Atualizar/fechar uma ordem de manutenção. Sem isto uma OS aberta ficava
  // aberta para sempre: dava para criar, nunca para concluir ou corrigir.
  if (request.method === "PATCH" && vehicleId && subresource === "maintenance" && subresourceId) {
    const body = await request.json().catch(() => ({}));
    const current = await env.DB.prepare("SELECT * FROM todogreen_fleet_maintenance_orders WHERE id=? AND workspace_owner_id=? AND vehicle_id=? AND archived_at IS NULL")
      .bind(subresourceId, access.ownerId, vehicleId).first();
    if (!current) return json({ error: "Ordem de manutenção não encontrada." }, 404);
    if (body.revision && Number(body.revision) !== Number(current.revision))
      return json({ error: "Ordem alterada por outra pessoa. Recarregue.", code: "revision_conflict" }, 409);
    const status = ["open", "in_progress", "done", "canceled"].includes(clean(body.status, 20)) ? clean(body.status, 20) : current.status;
    const now = new Date().toISOString();
    // Fechar carimba a conclusão; reabrir a limpa — derivado do status, não
    // enviado solto.
    const completedAt = status === "done" ? (clean(body.completedAt, 30) || now) : null;
    await env.DB.prepare(`UPDATE todogreen_fleet_maintenance_orders SET maintenance_type=?, status=?, title=?, description=?, supplier=?, scheduled_at=?, completed_at=?, downtime_hours=?, parts_cost=?, labor_cost=?, other_cost=?, revision=revision+1, updated_by=?, updated_at=? WHERE id=? AND workspace_owner_id=? AND revision=?`)
      .bind(
        clean(body.maintenanceType, 60) || current.maintenance_type, status,
        clean(body.title, 200) || current.title, clean(body.description, 2000),
        clean(body.supplier, 160), clean(body.scheduledAt, 30) || current.scheduled_at || null, completedAt,
        num(body.downtimeHours ?? current.downtime_hours), num(body.partsCost ?? current.parts_cost),
        num(body.laborCost ?? current.labor_cost), num(body.otherCost ?? current.other_cost),
        user.id, now, subresourceId, access.ownerId, current.revision,
      ).run();
    const row = await env.DB.prepare("SELECT * FROM todogreen_fleet_maintenance_orders WHERE id=?").bind(subresourceId).first();
    return json({ order: row });
  }

  if (request.method === "DELETE" && vehicleId && subresource === "maintenance" && subresourceId) {
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE todogreen_fleet_maintenance_orders SET archived_at=?, updated_at=?, updated_by=?, revision=revision+1 WHERE id=? AND workspace_owner_id=? AND vehicle_id=?")
      .bind(now, now, user.id, subresourceId, access.ownerId, vehicleId).run();
    return json({ ok: true });
  }

  if (request.method === "DELETE" && vehicleId) {
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE todogreen_fleet_vehicles SET archived_at=?, updated_at=?, updated_by=?, revision=revision+1 WHERE id=? AND workspace_owner_id=?").bind(now, now, user.id, vehicleId, access.ownerId).run();
    return json({ ok: true });
  }
  return json({ error: "Método não permitido." }, 405);
}
