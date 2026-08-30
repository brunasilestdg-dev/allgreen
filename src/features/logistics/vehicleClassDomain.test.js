import { describe, expect, it } from "vitest";
import {
  MARKET_VEHICLE_CLASSES,
  VEHICLE_CLASSES,
  aceitaUnidadeDeCobranca,
  cargaCabeNaClasse,
  classeEletrificavel,
  cnhExigida,
  consumoReferencia,
  energiaViavelNaClasse,
  frotaPorClasse,
  inferClassByPayload,
  isTodoGreenFleetCompatible,
  isVehicleClass,
  marketVehicleClass,
  normalizeMarketVehicleClass,
  normalizeVehicleClass,
  validateVehicleClass,
  vehicleClass,
  vehicleClassOrder,
} from "./vehicleClassDomain.js";

describe("frota operacional To Do Green", () => {
  it("vai de moto a carreta e não oferece bitrem/rodotrem", () => {
    expect(VEHICLE_CLASSES[0].id).toBe("moto");
    expect(VEHICLE_CLASSES.at(-1).id).toBe("carreta");
    expect(VEHICLE_CLASSES.some((item) => item.id === "bitrem")).toBe(false);
    expect(VEHICLE_CLASSES.some((item) => item.id === "rodotrem")).toBe(false);
    expect(vehicleClassOrder("moto")).toBeLessThan(vehicleClassOrder("carreta"));
  });

  it("mantém bitrem e rodotrem apenas no catálogo de mercado", () => {
    expect(MARKET_VEHICLE_CLASSES.some((item) => item.id === "bitrem")).toBe(true);
    expect(MARKET_VEHICLE_CLASSES.some((item) => item.id === "rodotrem")).toBe(true);
    expect(marketVehicleClass("bitrem")?.name).toBe("Bitrem");
    expect(isTodoGreenFleetCompatible("bitrem")).toBe(false);
  });

  it("toda classe cadastrável aceita elétrico e rejeita energia não elétrica", () => {
    for (const classe of VEHICLE_CLASSES) {
      expect(classeEletrificavel(classe.id)).toBe(true);
      expect(energiaViavelNaClasse(classe.id, "electric")).toBe(true);
      expect(energiaViavelNaClasse(classe.id, "diesel")).toBe(false);
    }
    expect(classeEletrificavel("carreta")).toBe(true);
    expect(validateVehicleClass({ vehicleClass: "carreta", energyType: "electric" })).toBe("");
    expect(validateVehicleClass({ vehicleClass: "carreta", energyType: "diesel" })).toMatch(/elétrica/i);
  });

  it("recusa bitrem/rodotrem no cadastro com mensagem explícita", () => {
    expect(validateVehicleClass({ vehicleClass: "bitrem", energyType: "electric" })).toMatch(/não faz parte/i);
    expect(validateVehicleClass({ vehicleClass: "rodotrem", energyType: "electric" })).toMatch(/não faz parte/i);
  });
});

describe("normalização", () => {
  it("normaliza apenas classes operacionais no cadastro", () => {
    expect(normalizeVehicleClass("motoboy")).toBe("moto");
    expect(normalizeVehicleClass("Sprinter")).toBe("van");
    expect(normalizeVehicleClass("Fiorino")).toBe("utilitario");
    expect(normalizeVehicleClass("Veículo Urbano de Carga")).toBe("vuc");
    expect(normalizeVehicleClass("3/4")).toBe("tres_quartos");
    expect(normalizeVehicleClass("CAVALO + CARRETA")).toBe("carreta");
    expect(normalizeVehicleClass("BITREM GRANELEIRO")).toBe("");
    expect(normalizeVehicleClass("RODOTREM 9 EIXOS")).toBe("");
  });

  it("reconhece equipamentos externos no normalizador de mercado", () => {
    expect(normalizeMarketVehicleClass("BITREM GRANELEIRO")).toBe("bitrem");
    expect(normalizeMarketVehicleClass("RODOTREM 9 EIXOS")).toBe("rodotrem");
    expect(normalizeMarketVehicleClass("Sprinter")).toBe("van");
  });

  it("não chuta classe desconhecida", () => {
    expect(normalizeVehicleClass("xyz-9000")).toBe("");
    expect(isVehicleClass("carreta")).toBe(true);
    expect(isVehicleClass("bitrem")).toBe(false);
    expect(vehicleClass("nada")).toBeNull();
  });
});

describe("capacidade e cobrança", () => {
  it("mantém faixas de carga contínuas até carreta", () => {
    for (let i = 1; i < VEHICLE_CLASSES.length; i += 1)
      expect(VEHICLE_CLASSES[i].payloadKgMin).toBe(VEHICLE_CLASSES[i - 1].payloadKgMax);
    expect(inferClassByPayload(40)).toBe("moto");
    expect(inferClassByPayload(1200)).toBe("van");
    expect(inferClassByPayload(12000)).toBe("truck");
    expect(inferClassByPayload(28000)).toBe("carreta");
    expect(inferClassByPayload(36000)).toBeNull();
  });

  it("responde habilitação, capacidade e unidade de cobrança", () => {
    expect(cnhExigida("moto")).toBe("A");
    expect(cnhExigida("carreta")).toBe("E");
    expect(cargaCabeNaClasse("van", 1200)).toBe(true);
    expect(cargaCabeNaClasse("van", 5000)).toBe(false);
    expect(aceitaUnidadeDeCobranca("moto", "pacote")).toBe(true);
    expect(aceitaUnidadeDeCobranca("carreta", "tonelada")).toBe(true);
  });
});

describe("retrato elétrico", () => {
  it("calcula eletrificação sobre a frota cadastrada e expõe desvios", () => {
    const resumo = frotaPorClasse([
      { vehicleClass: "moto", energyType: "electric" },
      { vehicleClass: "van", energyType: "electric" },
      // legado inválido permanece visível como outra energia, sem ser aceito em novo cadastro
      { vehicleClass: "carreta", energyType: "diesel" },
      { vehicleClass: "bitrem", energyType: "diesel" },
    ]);
    expect(resumo.total).toBe(3);
    expect(resumo.eletricos).toBe(2);
    expect(resumo.percentualEletrificado).toBeCloseTo(66.7, 1);
    expect(resumo.semClasse).toBe(1);
    expect(resumo.naoEletrificavel).toBe(0);
  });

  it("não inventa referência elétrica para pesado sem fator auditável", () => {
    expect(consumoReferencia("carreta")?.eletricoKwhPorKm).toBeNull();
    expect(consumoReferencia("toco")?.eletricoKwhPorKm).toBeNull();
    expect(consumoReferencia("van")?.eletricoKwhPorKm).toBeGreaterThan(0);
  });
});
