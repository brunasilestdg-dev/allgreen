import { describe, it, expect } from "vitest";
import {
  MODULOS,
  METRICAS,
  normalizarPlano,
  hasModulo,
  faturarCiclo,
  criarTenant,
  trocarPlano,
  analisarDowngrade,
} from "./saasBillingDomain.js";

describe("saasBillingDomain", () => {
  it("normalizarPlano descarta módulos e métricas desconhecidos", () => {
    const p = normalizarPlano({
      id: "p1", nome: "Básico", ciclo: "mensal", precoBaseReais: 990,
      modulos: ["frota", "wtf", "esg"],
      porUnidade: { veiculo: { precoReais: 30, franquia: 5 }, invalido: { precoReais: 10 } },
    });
    expect(p.modulos).toEqual(["frota", "esg"]);
    expect(p.porUnidade.veiculo).toEqual({ precoReais: 30, franquia: 5 });
    expect(p.porUnidade.invalido).toBeUndefined();
    expect(p.descontoAnualPct).toBe(0); // ciclo mensal ignora desconto anual
  });

  it("MODULOS/METRICAS existem e são congeladas", () => {
    expect(MODULOS.length).toBeGreaterThan(5);
    expect(METRICAS).toContain("veiculo");
    expect(Object.isFrozen(MODULOS)).toBe(true);
  });

  it("hasModulo é o predicado único de contratação", () => {
    const assinatura = { plano: { modulos: ["frota", "esg"] } };
    expect(hasModulo(assinatura, "frota")).toBe(true);
    expect(hasModulo(assinatura, "ai")).toBe(false);
    expect(hasModulo(null, "frota")).toBe(false);
  });

  it("faturarCiclo cobra base + excedente sobre franquia", () => {
    const assinatura = {
      plano: {
        id: "p1", ciclo: "mensal", precoBaseReais: 1000,
        modulos: ["frota"], porUnidade: { veiculo: { precoReais: 30, franquia: 10 } },
      },
    };
    const f = faturarCiclo(assinatura, { veiculo: 25 });
    // (25-10) × 30 = 450 + base 1000 = 1450
    expect(f.baseReais).toBe(1000);
    expect(f.usoReais).toBe(450);
    expect(f.totalReais).toBe(1450);
    expect(f.usoDetalhe.veiculo).toEqual({ consumido: 25, franquia: 10, excedente: 15, valorReais: 450 });
  });

  it("faturarCiclo avisa quando há consumo de métrica sem preço", () => {
    const assinatura = {
      plano: { ciclo: "mensal", precoBaseReais: 500, modulos: [], porUnidade: {} },
    };
    const f = faturarCiclo(assinatura, { veiculo: 5 });
    expect(f.usoReais).toBe(0);
    expect(f.avisos).toEqual([{ metrica: "veiculo", motivo: "sem-preco-configurado", consumido: 5 }]);
  });

  it("faturarCiclo aplica desconto anual só quando o plano é anual", () => {
    const anual = {
      plano: { ciclo: "anual", precoBaseReais: 12000, descontoAnualPct: 10, modulos: [], porUnidade: {} },
    };
    const f = faturarCiclo(anual, {});
    expect(f.descontoAnualReais).toBe(1200);
    expect(f.totalReais).toBe(10800);
  });

  it("criarTenant limpa CNPJ (só dígitos) e status padrão 'ativo'", () => {
    const t = criarTenant({ razaoSocial: "TDG", cnpj: "12.345.678/0001-90" });
    expect(t.cnpj).toBe("12345678000190");
    expect(t.status).toBe("ativo");
    expect(t.plano.id).toBe("plano");
  });

  it("trocarPlano preserva histórico do plano anterior", () => {
    const t = criarTenant({ razaoSocial: "X", plano: { id: "p1", modulos: ["frota"] } });
    const t2 = trocarPlano(t, { id: "p2", modulos: ["frota", "esg"] });
    expect(t2.plano.id).toBe("p2");
    expect(t2.planoHistorico).toHaveLength(1);
    expect(t2.planoHistorico[0].planoAnterior.id).toBe("p1");
  });

  it("analisarDowngrade sinaliza módulos perdidos com uso ativo", () => {
    const t = criarTenant({ plano: { modulos: ["frota", "motorista", "esg"] } });
    const r = analisarDowngrade(t, { modulos: ["frota"] }, { motorista: 40, veiculo: 12 });
    expect(r.perdendo.sort()).toEqual(["esg", "motorista"]);
    const motoristaImp = r.impacto.find((i) => i.modulo === "motorista");
    expect(motoristaImp.consumido).toBe(40);
    const esgImp = r.impacto.find((i) => i.modulo === "esg");
    expect(esgImp.consumido).toBe(0);
  });
});
