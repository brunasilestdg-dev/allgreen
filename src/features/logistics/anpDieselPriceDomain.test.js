import { describe, expect, it } from "vitest";
import { resolveDieselPrice, dieselVsElectricPerKm, DIESEL_PRICE_TIERS } from "./anpDieselPriceDomain.js";

describe("hierarquia de preço do diesel", () => {
  it("escolhe o contratual quando existe (mais forte)", () => {
    const r = resolveDieselPrice({
      contractual: { price: 5.8, date: "2026-09-01" },
      anp_municipal: { price: 6.1, date: "2026-09-10" },
      anp_national: { price: 6.3, date: "2026-09-10" },
    });
    expect(r.tier).toBe("contractual");
    expect(r.priceRs).toBe(5.8);
    expect(r.provenance.measurementType).toBe("INFORMED");
  });

  it("cai para ANP municipal quando não há contratual/frota", () => {
    const r = resolveDieselPrice({
      anp_municipal: { price: 6.1, date: "2026-09-10" },
      anp_state: { price: 6.0 },
    });
    expect(r.tier).toBe("anp_municipal");
    expect(r.provenance.source).toBe("ANP município");
    expect(r.provenance.provider).toBe("ANP");
  });

  it("desce a hierarquia até o fallback quando só ele existe", () => {
    const r = resolveDieselPrice({ fallback: 6.5 });
    expect(r.tier).toBe("fallback");
    expect(r.provenance.measurementType).toBe("DERIVED");
  });

  it("nenhum preço disponível → não resolve, com motivo", () => {
    const r = resolveDieselPrice({});
    expect(r.resolved).toBe(false);
    expect(r.reason).toBe("sem_preco_disponivel");
  });

  it("marca stale quando o preço escolhido é velho", () => {
    const now = Date.parse("2026-09-13T00:00:00Z");
    const r = resolveDieselPrice(
      { anp_municipal: { price: 6.1, date: "2026-08-01" } },
      { staleMs: 7 * 24 * 3600 * 1000, now },
    );
    expect(r.stale).toBe(true);
  });

  it("valores zero/negativos são ignorados como ausência", () => {
    const r = resolveDieselPrice({ contractual: { price: 0 }, fleet: { price: 5.5 } });
    expect(r.tier).toBe("fleet");
  });

  it("a ordem da hierarquia está completa e correta", () => {
    expect(DIESEL_PRICE_TIERS[0]).toBe("contractual");
    expect(DIESEL_PRICE_TIERS[DIESEL_PRICE_TIERS.length - 1]).toBe("fallback");
  });
});

describe("comparação diesel x elétrico por km (TCO)", () => {
  it("calcula economia e % quando há os dois custos", () => {
    const r = dieselVsElectricPerKm({ dieselPrice: 6, dieselConsumptionLPerKm: 0.35, energyPricePerKwh: 0.92, energyConsumptionKwhPerKm: 0.42 });
    // diesel 2,10/km; elétrico ~0,3864/km → elétrico bem mais barato
    expect(r.comparable).toBe(true);
    expect(r.dieselPerKm).toBeCloseTo(2.1, 2);
    expect(r.electricCheaper).toBe(true);
    expect(r.savingPercent).toBeGreaterThan(0);
  });

  it("não compara sem os dados (não inventa), listando o que falta", () => {
    const r = dieselVsElectricPerKm({ dieselPrice: 6 });
    expect(r.comparable).toBe(false);
    expect(r.faltando).toContain("energyPricePerKwh");
  });
});
