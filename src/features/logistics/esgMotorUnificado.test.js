import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENVIRONMENTAL_FACTORS,
  calculateEnvironmentalImpact,
  roundMoney,
} from "./logisticsVerticalDomain.js";
import { consumoReferencia } from "./vehicleClassDomain.js";

// Trava de regressão da unificação dos dois motores de CO₂ (N.3).
//
// O motor do simulador (`calculateEnvironmentalImpact`) passou a delegar a
// FÓRMULA ao motor auditável (`calcularImpactoAmbiental` via núcleo comum), em
// vez de manter uma segunda cópia da conta. Esta trava congela o comportamento
// ANTERIOR (a cópia literal abaixo, `motorLegado`) e prova, numa matriz grande
// de entradas, que o número não muda byte a byte — nenhuma proposta muda.

const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Cópia FIEL do calculateEnvironmentalImpact de antes da unificação. Não
// importar do módulo: é justamente o oráculo contra o qual a nova versão é
// comparada. Se algum dia a régua/consumo mudar de forma, este oráculo é o que
// diz se a mudança foi intencional.
const motorLegado = (inputs = {}, factors = {}) => {
  const f = { ...DEFAULT_ENVIRONMENTAL_FACTORS, ...factors };
  const classRef = inputs.vehicleClass ? consumoReferencia(inputs.vehicleClass) : null;
  const distanceKm = Math.max(0, n(inputs.distanceKm || inputs.kmPerRoute) * Math.max(1, n(inputs.tripsPerMonth || inputs.frequencyPerMonth || inputs.routesPerDay * inputs.daysPerMonth || 1)));
  const refKmPerL = n(inputs.referenceKmPerLiter || (classRef?.convencionalKmPorL) || f.dieselKmPerLiter);
  const refKgCO2ePerL = classRef?.convencionalKgCO2ePorL ?? f.dieselKgCo2ePerLiter;
  const referenceLiters = distanceKm / Math.max(0.1, refKmPerL);
  const referenceKg = referenceLiters * refKgCO2ePerL;
  const evKwhPerKm = classRef?.eletricoKwhPorKm ?? f.electricKwhPerKm;
  const electricKwh = n(inputs.energyKwh) || distanceKm * evKwhPerKm;
  const actualKg = electricKwh * f.electricKgCo2ePerKwh;
  const avoidedKg = Math.max(0, referenceKg - actualKg);
  const packages = Math.max(0, n(inputs.packages || inputs.deliveries));
  const tons = Math.max(0, n(inputs.tons || inputs.weightKg / 1000));
  return {
    methodologyVersion: f.methodologyVersion,
    distanceKm: roundMoney(distanceKm, 1),
    referenceEmissionsKg: roundMoney(referenceKg, 2),
    actualEmissionsKg: roundMoney(actualKg, 2),
    co2AvoidedKg: roundMoney(avoidedKg, 2),
    reductionPercent: referenceKg ? roundMoney((avoidedKg / referenceKg) * 100, 1) : 0,
    dieselAvoidedLiters: roundMoney(referenceLiters, 2),
    lowEmissionKm: roundMoney(distanceKm, 1),
    intensityPerPackageKg: packages ? roundMoney(actualKg / packages, 4) : 0,
    intensityPerDeliveryKg: packages ? roundMoney(actualKg / packages, 4) : 0,
    intensityPerTonKg: tons ? roundMoney(actualKg / tons, 4) : 0,
    intensityPerKmKg: distanceKm ? roundMoney(actualKg / distanceKm, 4) : 0,
    equivalences: {
      treesYear: roundMoney(avoidedKg / f.treeKgCo2eYear, 1),
      carsYear: roundMoney(avoidedKg / f.carKgCo2eYear, 2),
      flights: roundMoney(avoidedKg / f.flightKgCo2e, 1),
      homesMonth: roundMoney((electricKwh || 0) / f.homeKwhMonth, 1),
    },
    formula:
      "(distância / consumo diesel referência * fator diesel) - (kWh elétrico * fator elétrico)",
    units: "kgCO2e, litros, km, kWh",
    factors: f,
    dataQuality: n(inputs.dataQuality || 75),
  };
};

const CLASSES = ["", "moto", "utilitario", "van", "vuc", "tres_quartos", "carreta"];
const KMS = [0, 37.5, 100, 500];
const TRIPS = [1, 3, 10];
const ENERGY = [undefined, 0, 250.7];
const REFKML = [undefined, 3.5];
const FACTORS = [
  {},
  { electricKgCo2ePerKwh: 0.08 },
  { dieselKgCo2ePerLiter: 3.13 },
  { dieselKmPerLiter: 3.0, electricKwhPerKm: 0.47 },
  { treeKgCo2eYear: 15, carKgCo2eYear: 5000, flightKgCo2e: 97, homeKwhMonth: 161 },
];
const EXTRAS = { packages: 123, tons: 4.3, weightKg: 4321, dataQuality: 82 };

const casos = [];
for (const vehicleClass of CLASSES)
  for (const km of KMS)
    for (const trips of TRIPS)
      for (const energyKwh of ENERGY)
        for (const referenceKmPerLiter of REFKML)
          for (const factors of FACTORS)
            casos.push([
              { ...EXTRAS, vehicleClass, distanceKm: km, tripsPerMonth: trips, energyKwh, referenceKmPerLiter },
              factors,
            ]);

describe("unificação dos dois motores de CO₂: nenhum número muda (regressão)", () => {
  it(`bate byte a byte com o motor legado em ${casos.length} combinações`, () => {
    let divergencias = 0;
    const amostras = [];
    for (const [inputs, factors] of casos) {
      const novo = calculateEnvironmentalImpact(inputs, factors);
      const velho = motorLegado(inputs, factors);
      if (JSON.stringify(novo) !== JSON.stringify(velho)) {
        divergencias++;
        if (amostras.length < 5) amostras.push({ inputs, factors, novo, velho });
      }
    }
    if (divergencias) {
      console.error("Divergências:", JSON.stringify(amostras, null, 2));
    }
    expect(divergencias).toBe(0);
  });

  it("um caso representativo continua com os mesmos campos e números", () => {
    const r = calculateEnvironmentalImpact(
      { vehicleClass: "van", distanceKm: 100, tripsPerMonth: 10, packages: 120, tons: 4 },
    );
    expect(r).toEqual(
      motorLegado({ vehicleClass: "van", distanceKm: 100, tripsPerMonth: 10, packages: 120, tons: 4 }),
    );
    expect(r.co2AvoidedKg).toBeGreaterThan(0);
  });
});
