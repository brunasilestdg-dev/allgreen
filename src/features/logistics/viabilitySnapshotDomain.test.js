import { describe, expect, it } from "vitest";
import {
  createViabilitySnapshot,
  nextViabilitySnapshot,
  buildViabilitySnapshotContent,
  viabilitySnapshotHash,
  viabilitySnapshotBlockers,
  VIABILITY_SNAPSHOT_SCHEMA_VERSION,
  __test__,
} from "./viabilitySnapshotDomain.js";
import { estimateRouteEnergy } from "./energyEstimationDomain.js";

const baseInput = {
  opportunityId: "OPP-1",
  scenarioId: "SC-1",
  route: "CD São Paulo → Zona Leste",
  origin: "CD SP",
  destination: "Zona Leste",
  stops: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
  vehicleClass: "van",
  referenceVehicle: "VAN-082",
  vehicleQuantity: 1,
  capacityKg: 1500,
  distanceKm: 120,
  cost: 480,
  costPerDelivery: 160,
};

describe("snapshot de viabilidade — criação e contrato", () => {
  it("cria a versão 1 congelada, com hash de conteúdo e schemaVersion", () => {
    const snap = createViabilitySnapshot(baseInput, { createdBy: "user-1", createdAt: "2026-01-01T00:00:00Z" });
    expect(snap.version).toBe(1);
    expect(snap.schemaVersion).toBe(VIABILITY_SNAPSHOT_SCHEMA_VERSION);
    expect(snap.contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(snap.createdBy).toBe("user-1");
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it("integra o resultado do modelo de energia (SOC, elevação, energia, confiança)", () => {
    const energyEstimate = estimateRouteEnergy({
      vehicle: { category: "van", consumptionKwhPerKm: 0.42, batteryCapacityKwh: 100, socPercent: 80, reservePercent: 15 },
      route: { distanceKm: 120, elevationGainM: 300, elevationLossM: 300, temperatureC: 18 },
    });
    const snap = createViabilitySnapshot({ ...baseInput, energyEstimate });
    expect(snap.energyKwh).toBeGreaterThan(0);
    expect(snap.arrivalSoc).toBeCloseTo(energyEstimate.estimatedArrivalSoc, 5);
    expect(snap.elevationGain).toBe(300);
    expect(snap.chargingRequired).toBe(energyEstimate.chargingRequired);
    expect(snap.energyModelVersion).toBe(energyEstimate.calculationVersion);
    expect(snap.confidence).toBe(energyEstimate.confidence);
  });
});

describe("snapshot de viabilidade — versionamento imutável", () => {
  it("conteúdo idêntico NÃO cria versão nova (idempotente)", () => {
    const v1 = createViabilitySnapshot(baseInput);
    const r = nextViabilitySnapshot(v1, baseInput);
    expect(r.changed).toBe(false);
    expect(r.snapshot).toBe(v1);
    expect(r.snapshot.version).toBe(1);
  });

  it("mudança real de premissa sobe a versão e NÃO sobrescreve a anterior", () => {
    const v1 = createViabilitySnapshot(baseInput);
    const r = nextViabilitySnapshot(v1, { ...baseInput, cost: 520 });
    expect(r.changed).toBe(true);
    expect(r.snapshot.version).toBe(2);
    expect(r.snapshot.previousContentHash).toBe(v1.contentHash);
    expect(r.snapshot.contentHash).not.toBe(v1.contentHash);
    // A v1 continua intacta.
    expect(v1.version).toBe(1);
    expect(v1.cost).toBe(480);
  });

  it("hash é estável à ordem das chaves do input", () => {
    const a = buildViabilitySnapshotContent({ opportunityId: "X", distanceKm: 10, cost: 5 });
    const b = buildViabilitySnapshotContent({ cost: 5, distanceKm: 10, opportunityId: "X" });
    expect(viabilitySnapshotHash(a)).toBe(viabilitySnapshotHash(b));
  });

  it("createdAt/createdBy NÃO afetam o hash (são metadados, não conteúdo)", () => {
    const s1 = createViabilitySnapshot(baseInput, { createdBy: "a", createdAt: "2026-01-01T00:00:00Z" });
    const s2 = createViabilitySnapshot(baseInput, { createdBy: "b", createdAt: "2026-02-02T00:00:00Z" });
    expect(s1.contentHash).toBe(s2.contentHash);
  });
});

describe("snapshot de viabilidade — bloqueio de avanço da proposta", () => {
  it("aponta faltas quando o snapshot está incompleto", () => {
    const faltas = viabilitySnapshotBlockers(createViabilitySnapshot({ opportunityId: "OPP-2" }));
    expect(faltas).toContain("distanceKm");
    expect(faltas).toContain("veiculo");
    expect(faltas).toContain("energyKwh");
    expect(faltas).toContain("cost");
  });

  it("snapshot completo libera o avanço (sem faltas)", () => {
    const snap = createViabilitySnapshot({ ...baseInput, energyKwh: 50 });
    expect(viabilitySnapshotBlockers(snap)).toEqual([]);
  });

  it("snapshot ausente é bloqueio explícito", () => {
    expect(viabilitySnapshotBlockers(null)).toEqual(["snapshot_ausente"]);
  });
});

describe("helpers internos", () => {
  it("stableStringify ordena chaves recursivamente", () => {
    expect(__test__.stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it("fnv1a devolve hex de 8 dígitos determinístico", () => {
    expect(__test__.fnv1a("abc")).toBe(__test__.fnv1a("abc"));
    expect(__test__.fnv1a("abc")).toMatch(/^[0-9a-f]{8}$/);
  });
});
