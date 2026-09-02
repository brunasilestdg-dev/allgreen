const finite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));

const connectorAlias = {
  TYPE2: "TYPE_2",
  "TYPE 2": "TYPE_2",
  MENNEKES: "TYPE_2",
  CCS: "CCS2",
  CCS_2: "CCS2",
  "CCS 2": "CCS2",
  COMBO2: "CCS2",
  "COMBO 2": "CCS2",
  CHADEMO: "CHADEMO",
  GB_T: "GB_T",
  "GB/T": "GB_T",
};

export const normalizeConnector = (value) => {
  const normalized = String(value || "").trim().toUpperCase().replaceAll("-", "_");
  return connectorAlias[normalized] || normalized;
};

const normalizedList = (value) => (Array.isArray(value) ? value : [])
  .map(normalizeConnector)
  .filter(Boolean);

function consumptionFor(vehicle) {
  const base = Math.max(0.1, finite(
    vehicle.consumptionKwhPer100Km ?? vehicle.consumptionKwh100Km,
    0,
  ));
  const payload = Math.max(0, finite(vehicle.payloadKg, 0));
  const maxPayload = Math.max(0, finite(vehicle.maxPayloadKg, 0));
  const loadRatio = maxPayload ? Math.min(1.5, payload / maxPayload) : 0;
  const penaltyAtFullLoad = clamp(vehicle.loadPenaltyPercent, 0, 100);
  return base * (1 + loadRatio * penaltyAtFullLoad / 100);
}

function vehicleProfile(input = {}) {
  const batteryCapacityKwh = Math.max(0, finite(input.batteryCapacityKwh, 0));
  const socPercent = clamp(input.socPercent, 0, 100);
  const reservePercent = clamp(input.reservePercent ?? input.minReservePercent ?? 15, 0, 95);
  return {
    id: input.id || input.vehicleId || "",
    model: String(input.model || "").trim(),
    category: String(input.category || "car").trim().toLowerCase(),
    batteryCapacityKwh,
    socPercent,
    reservePercent,
    consumptionKwhPer100Km: consumptionFor(input),
    connectors: normalizedList(input.connectors),
    maxAcKw: Math.max(0, finite(input.maxAcKw, 0)),
    maxDcKw: Math.max(0, finite(input.maxDcKw, 0)),
  };
}

function stationConnectors(station = {}) {
  return (Array.isArray(station.connectors) ? station.connectors : [])
    .map((connector) => {
      if (typeof connector === "string") {
        return { type: normalizeConnector(connector), powerKw: 0, status: "unknown" };
      }
      return {
        type: normalizeConnector(connector?.type),
        powerKw: Math.max(0, finite(connector?.powerKw ?? connector?.kw, 0)),
        status: String(connector?.status || "unknown").toLowerCase(),
      };
    })
    .filter((connector) => connector.type);
}

const dcConnectors = new Set(["CCS1", "CCS2", "CHADEMO", "GB_T_DC", "MCS"]);

function maximumVehiclePower(vehicle, type) {
  return dcConnectors.has(type) ? vehicle.maxDcKw : vehicle.maxAcKw;
}

function accessReason(vehicle, station) {
  if (station.operational === false) return "station_offline";
  if (station.openNow === false) return "station_closed";
  if (station.publicAccess === false && station.authorized === false) return "access_not_authorized";

  const categories = (station.vehicleCategories || station.categories || [])
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
  if (categories.length && !categories.includes(vehicle.category)) return "vehicle_category_not_supported";

  const heavy = ["truck", "caminhao", "caminhão", "carreta", "semi", "tractor"].includes(vehicle.category);
  if (heavy && station.heavyVehicleAccess === false) return "no_heavy_vehicle_access";

  const models = (station.supportedModels || []).map((value) => String(value).trim().toLowerCase());
  if (models.length && vehicle.model && !models.includes(vehicle.model.toLowerCase()))
    return "vehicle_model_not_supported";

  return "";
}

function compatibleOptions(vehicle, station) {
  const reason = accessReason(vehicle, station);
  if (reason) return { reason, options: [] };

  const options = stationConnectors(station)
    .filter((connector) => vehicle.connectors.includes(connector.type))
    .filter((connector) => !["offline", "out_of_service", "faulted", "unavailable"].includes(connector.status))
    .map((connector) => {
      const vehicleLimit = maximumVehiclePower(vehicle, connector.type);
      const effectivePowerKw = vehicleLimit && connector.powerKw
        ? Math.min(vehicleLimit, connector.powerKw)
        : Math.max(vehicleLimit, connector.powerKw);
      return { ...connector, effectivePowerKw };
    })
    .filter((connector) => connector.effectivePowerKw > 0)
    .sort((a, b) => b.effectivePowerKw - a.effectivePowerKw);

  return {
    reason: options.length ? "" : "no_compatible_connector",
    options,
  };
}

export function planElectricRoute(input = {}) {
  const vehicle = vehicleProfile(input.vehicle || {});
  const route = input.route || {};
  const distanceKm = Math.max(0, finite(route.distanceKm, 0));
  const averageSpeedKmh = Math.max(10, finite(route.averageSpeedKmh, 45));
  const stations = Array.isArray(input.chargingStations) ? input.chargingStations : [];

  if (!vehicle.batteryCapacityKwh)
    return { status: "invalid", reason: "battery_capacity_required" };
  if (!vehicle.consumptionKwhPer100Km)
    return { status: "invalid", reason: "consumption_required" };
  if (!vehicle.connectors.length)
    return { status: "invalid", reason: "vehicle_connectors_required" };
  if (!distanceKm)
    return { status: "invalid", reason: "route_distance_required" };
  if (vehicle.socPercent <= vehicle.reservePercent)
    return { status: "infeasible", reason: "soc_at_or_below_reserve" };

  const currentEnergyKwh = vehicle.batteryCapacityKwh * vehicle.socPercent / 100;
  const reserveEnergyKwh = vehicle.batteryCapacityKwh * vehicle.reservePercent / 100;
  const usableEnergyKwh = currentEnergyKwh - reserveEnergyKwh;
  const estimatedRangeKm = usableEnergyKwh / vehicle.consumptionKwhPer100Km * 100;
  const routeEnergyKwh = distanceKm * vehicle.consumptionKwhPer100Km / 100;

  const base = {
    vehicleId: vehicle.id,
    vehicleModel: vehicle.model,
    routeDistanceKm: Number(distanceKm.toFixed(1)),
    adjustedConsumptionKwhPer100Km: Number(vehicle.consumptionKwhPer100Km.toFixed(2)),
    estimatedRangeKm: Number(estimatedRangeKm.toFixed(1)),
    startSocPercent: vehicle.socPercent,
    reservePercent: vehicle.reservePercent,
  };

  if (routeEnergyKwh + reserveEnergyKwh <= currentEnergyKwh) {
    const finalEnergy = currentEnergyKwh - routeEnergyKwh;
    return {
      ...base,
      status: "feasible_without_charge",
      chargingStops: [],
      estimatedFinalSocPercent: Number((finalEnergy / vehicle.batteryCapacityKwh * 100).toFixed(1)),
      addedMinutes: 0,
    };
  }

  const discarded = {};
  const candidates = [];

  for (const station of stations) {
    const rawStationKm = finite(
      station.distanceFromStartKm ?? station.alongRouteKm,
      -1,
    );
    const stationKm = Math.max(0, rawStationKm);
    const detourKm = Math.max(0, finite(station.detourKm, 0));
    if (rawStationKm < 0 || stationKm > distanceKm) {
      discarded.station_position_invalid = (discarded.station_position_invalid || 0) + 1;
      continue;
    }

    const compatibility = compatibleOptions(vehicle, station);
    if (compatibility.reason) {
      discarded[compatibility.reason] = (discarded[compatibility.reason] || 0) + 1;
      continue;
    }

    const distanceToStationKm = stationKm + detourKm;
    const energyAtStation = currentEnergyKwh
      - distanceToStationKm * vehicle.consumptionKwhPer100Km / 100;
    if (energyAtStation < reserveEnergyKwh) {
      discarded.station_out_of_reach = (discarded.station_out_of_reach || 0) + 1;
      continue;
    }

    const remainingKm = Math.max(0, distanceKm - stationKm) + detourKm;
    const energyNeededAfterStation = remainingKm * vehicle.consumptionKwhPer100Km / 100
      + reserveEnergyKwh;
    if (energyNeededAfterStation > vehicle.batteryCapacityKwh) {
      discarded.single_charge_insufficient = (discarded.single_charge_insufficient || 0) + 1;
      continue;
    }

    const connector = compatibility.options[0];
    const chargeKwh = Math.max(0, energyNeededAfterStation - energyAtStation);
    const chargingMinutes = chargeKwh / (connector.effectivePowerKw * 0.9) * 60;
    const detourMinutes = (detourKm * 2 / averageSpeedKmh) * 60;
    const reliability = clamp(station.reliabilityScore ?? 1, 0.1, 1);
    const reliabilityPenaltyMinutes = (1 - reliability) * 20;
    const addedMinutes = chargingMinutes + detourMinutes + reliabilityPenaltyMinutes;

    candidates.push({
      stationId: station.id || "",
      stationName: station.name || "Eletroposto",
      operator: station.operator || "",
      connector: connector.type,
      stationPowerKw: connector.powerKw,
      effectivePowerKw: Number(connector.effectivePowerKw.toFixed(1)),
      distanceFromStartKm: Number(stationKm.toFixed(1)),
      detourKm: Number(detourKm.toFixed(1)),
      chargeKwh: Number(chargeKwh.toFixed(2)),
      chargingMinutes: Number(chargingMinutes.toFixed(1)),
      addedMinutes: Number(addedMinutes.toFixed(1)),
      heavyVehicleAccess: station.heavyVehicleAccess !== false,
      source: station.source || "",
      score: addedMinutes,
    });
  }

  candidates.sort((a, b) => a.score - b.score);
  const selected = candidates[0];

  if (!selected) {
    return {
      ...base,
      status: "infeasible",
      reason: "no_feasible_charging_station",
      chargingStops: [],
      compatibleCandidates: 0,
      discarded,
    };
  }

  return {
    ...base,
    status: "feasible_with_charge",
    chargingStops: [{ ...selected, score: undefined }],
    compatibleCandidates: candidates.length,
    discarded,
    addedMinutes: selected.addedMinutes,
    recommendation: `Inserir recarga de ${selected.chargingMinutes} min em ${selected.stationName} (${selected.connector}).`,
  };
}
