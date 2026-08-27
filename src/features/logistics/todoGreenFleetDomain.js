export const FLEET_STATUS = [
  "available",
  "in-operation",
  "maintenance",
  "reserved",
  "blocked",
  "inactive",
];

export const FLEET_ENERGY_TYPES = ["electric", "biomethane", "hybrid", "diesel"];

export const normalizeFleetVehicle = (input = {}) => ({
  id: String(input.id || crypto.randomUUID()),
  prefix: String(input.prefix || "").trim(),
  plate: String(input.plate || "").trim().toUpperCase(),
  manufacturer: String(input.manufacturer || "").trim(),
  model: String(input.model || "").trim(),
  modelYear: Number(input.modelYear) || null,
  category: String(input.category || "").trim(),
  energyType: FLEET_ENERGY_TYPES.includes(input.energyType) ? input.energyType : "electric",
  status: FLEET_STATUS.includes(input.status) ? input.status : "available",
  operationalUnit: String(input.operationalUnit || "").trim(),
  costCenter: String(input.costCenter || "").trim(),
  payloadKg: Math.max(0, Number(input.payloadKg) || 0),
  volumeM3: Math.max(0, Number(input.volumeM3) || 0),
  palletCapacity: Math.max(0, Number(input.palletCapacity) || 0),
  odometerKm: Math.max(0, Number(input.odometerKm) || 0),
  acquisitionValue: Math.max(0, Number(input.acquisitionValue) || 0),
  monthlyFixedCost: Math.max(0, Number(input.monthlyFixedCost) || 0),
  revenueAccumulated: Math.max(0, Number(input.revenueAccumulated) || 0),
  costAccumulated: Math.max(0, Number(input.costAccumulated) || 0),
  energyConsumptionKwhPerKm: Math.max(0, Number(input.energyConsumptionKwhPerKm) || 0),
  emissionFactorKgCo2ePerKwh: Math.max(0, Number(input.emissionFactorKgCo2ePerKwh) || 0),
  batteryCapacityKwh: Math.max(0, Number(input.batteryCapacityKwh) || 0),
  batterySohPercent: Math.min(100, Math.max(0, Number(input.batterySohPercent) || 100)),
  nominalRangeKm: Math.max(0, Number(input.nominalRangeKm) || 0),
  realRangeKm: Math.max(0, Number(input.realRangeKm) || 0),
  nextMaintenanceAt: input.nextMaintenanceAt || "",
  nextDocumentDueAt: input.nextDocumentDueAt || "",
  fields: input.fields && typeof input.fields === "object" ? input.fields : {},
});

// Tarifas de referência quando a régua de precificação não informa a sua. Sem
// elas o custo por km ficava estruturalmente zerado (dependia de `costAccumulated`,
// que nada alimenta), e o alerta de economia negativa nunca disparava.
export const FLEET_ENERGY_DEFAULTS = { energyCostPerKwh: 0.92, maintenancePerKm: 0.42 };

export const fleetVehicleMetrics = (vehicleInput = {}, assumptions = {}) => {
  const vehicle = normalizeFleetVehicle(vehicleInput);
  const energyCostPerKwh = Number(assumptions.energyCostPerKwh) > 0
    ? Number(assumptions.energyCostPerKwh) : FLEET_ENERGY_DEFAULTS.energyCostPerKwh;
  const maintenancePerKm = Number.isFinite(Number(assumptions.maintenancePerKm)) && Number(assumptions.maintenancePerKm) > 0
    ? Number(assumptions.maintenancePerKm) : FLEET_ENERGY_DEFAULTS.maintenancePerKm;

  const margin = vehicle.revenueAccumulated - vehicle.costAccumulated;
  const marginPercent = vehicle.revenueAccumulated > 0 ? (margin / vehicle.revenueAccumulated) * 100 : 0;
  // Custo realizado: só existe quando há custo acumulado lançado sobre o hodômetro.
  const realizedCostPerKm = vehicle.odometerKm > 0 ? vehicle.costAccumulated / vehicle.odometerKm : 0;
  // Custo projetado: energia (consumo físico × tarifa) + manutenção variável por km.
  const energyCostPerKm = vehicle.energyConsumptionKwhPerKm * energyCostPerKwh;
  const projectedCostPerKm = energyCostPerKm + maintenancePerKm;
  // O número que a operação usa: o realizado quando existe, senão o projetado.
  const costPerKm = realizedCostPerKm > 0 ? realizedCostPerKm : projectedCostPerKm;
  const revenuePerKm = vehicle.odometerKm > 0 ? vehicle.revenueAccumulated / vehicle.odometerKm : 0;
  const rangeEfficiencyPercent = vehicle.nominalRangeKm > 0 ? (vehicle.realRangeKm / vehicle.nominalRangeKm) * 100 : 0;
  const estimatedEnergyKwh = vehicle.odometerKm * vehicle.energyConsumptionKwhPerKm;
  const operationalEmissionsKgCo2e = estimatedEnergyKwh * vehicle.emissionFactorKgCo2ePerKwh;
  const roiPercent = vehicle.acquisitionValue > 0 ? (margin / vehicle.acquisitionValue) * 100 : 0;

  return {
    margin,
    marginPercent,
    costPerKm,
    realizedCostPerKm,
    projectedCostPerKm,
    energyCostPerKm,
    revenuePerKm,
    rangeEfficiencyPercent,
    estimatedEnergyKwh,
    operationalEmissionsKgCo2e,
    roiPercent,
    batteryRisk: vehicle.energyType === "electric" && vehicle.batterySohPercent < 80,
    autonomyRisk: vehicle.nominalRangeKm > 0 && rangeEfficiencyPercent < 70,
  };
};

export const summarizeFleet = (vehicles = [], assumptions = {}) => {
  const normalized = vehicles.map(normalizeFleetVehicle);
  const metrics = normalized.map((vehicle) => fleetVehicleMetrics(vehicle, assumptions));
  const total = normalized.length;
  const statusCount = (status) => normalized.filter((vehicle) => vehicle.status === status).length;
  const available = statusCount("available");
  const inOperation = statusCount("in-operation");
  const maintenance = statusCount("maintenance");
  const blocked = statusCount("blocked");
  const activeBase = normalized.filter((vehicle) => !["inactive"].includes(vehicle.status)).length;
  const utilizationPercent = activeBase > 0 ? (inOperation / activeBase) * 100 : 0;
  const availabilityPercent = activeBase > 0 ? (available / activeBase) * 100 : 0;

  return {
    total,
    available,
    inOperation,
    maintenance,
    blocked,
    utilizationPercent,
    availabilityPercent,
    revenue: normalized.reduce((sum, vehicle) => sum + vehicle.revenueAccumulated, 0),
    cost: normalized.reduce((sum, vehicle) => sum + vehicle.costAccumulated, 0),
    margin: metrics.reduce((sum, item) => sum + item.margin, 0),
    energyKwh: metrics.reduce((sum, item) => sum + item.estimatedEnergyKwh, 0),
    emissionsKgCo2e: metrics.reduce((sum, item) => sum + item.operationalEmissionsKgCo2e, 0),
    batteryRisks: metrics.filter((item) => item.batteryRisk).length,
    autonomyRisks: metrics.filter((item) => item.autonomyRisk).length,
  };
};

export const fleetAlerts = (vehicleInput = {}, today = new Date().toISOString().slice(0, 10), assumptions = {}) => {
  const vehicle = normalizeFleetVehicle(vehicleInput);
  const metrics = fleetVehicleMetrics(vehicle, assumptions);
  const alerts = [];
  if (metrics.batteryRisk) alerts.push({ level: "critical", code: "battery-soh", message: "Saúde da bateria abaixo de 80%." });
  if (metrics.autonomyRisk) alerts.push({ level: "high", code: "range-efficiency", message: "Autonomia real abaixo de 70% da nominal." });
  if (vehicle.nextMaintenanceAt && vehicle.nextMaintenanceAt <= today) alerts.push({ level: "high", code: "maintenance-due", message: "Manutenção vencida ou prevista para hoje." });
  if (vehicle.nextDocumentDueAt && vehicle.nextDocumentDueAt <= today) alerts.push({ level: "critical", code: "document-due", message: "Documento vencido ou com vencimento hoje." });
  if (metrics.costPerKm > 0 && metrics.revenuePerKm > 0 && metrics.costPerKm >= metrics.revenuePerKm) alerts.push({ level: "high", code: "negative-unit-economics", message: "Custo por km igual ou superior à receita por km." });
  return alerts;
};

export const buildFleetAiPrompt = ({ vehicles = [], question = "" } = {}) => {
  const summary = summarizeFleet(vehicles);
  return [
    "Atue como especialista sênior em gestão de frota sustentável da To Do Green.",
    "Analise disponibilidade, utilização, custo por km, receita por km, margem, autonomia, bateria, manutenção e impacto ambiental.",
    `Resumo da frota: ${JSON.stringify(summary)}`,
    `Veículos: ${JSON.stringify(vehicles.slice(0, 100))}`,
    `Pergunta: ${String(question || "Identifique riscos, desperdícios e as cinco ações mais importantes.")}`,
    "Não invente telemetria nem valores ausentes. Diferencie fatos, estimativas e dados faltantes.",
  ].join("\n\n");
};
