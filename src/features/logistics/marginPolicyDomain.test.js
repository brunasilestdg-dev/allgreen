import { describe, expect, it } from "vitest";
import { LOGISTICS_PRODUCTS, dealDeskTriggers } from "./logisticsVerticalDomain.js";

// A política de margem foi ditada pela titular, produto a produto:
//  • Piso 18% (line-haul/B2B): Middle Mile, Middle Mile Spot, Transferência,
//    Coleta em fornecedores (first mile), Abastecimento de lojas, Granel.
//  • Piso 26% (os "demais"): Last Mile, Distribuição fracionada (NÃO é B2B),
//    Operação dedicada, Projeto personalizado.
//  • Abaixo do piso → Deal Desk: aprovação de Precificação OU Head Comercial.
// Se um número aqui mudar sem a titular pedir, o simulador está deixando
// vender abaixo do que ela autorizou sem passar por ninguém.

const PISO_ESPERADO = {
  "middle-mile": 18,
  "middle-mile-spot": 18,
  transfer: 18,
  "supplier-pickup": 18,
  "store-replenishment": 18,
  bulk: 18,
  "last-mile": 26,
  dedicated: 26,
  "fractional-distribution": 26,
  "custom-project": 26,
};

const acharProduto = (id) => LOGISTICS_PRODUCTS.find((p) => p.id === id);

describe("piso de margem por produto (regra da titular)", () => {
  it("todo produto do catálogo tem um piso declarado no teste — sem produto órfão", () => {
    const idsCatalogo = LOGISTICS_PRODUCTS.map((p) => p.id).sort();
    expect(idsCatalogo).toEqual(Object.keys(PISO_ESPERADO).sort());
  });

  for (const [id, piso] of Object.entries(PISO_ESPERADO)) {
    it(`${id} tem piso de aprovação em ${piso}%`, () => {
      const produto = acharProduto(id);
      expect(produto).toBeTruthy();
      expect(produto.approvalRules.minimumMarginPercent).toBe(piso);
    });
  }

  it("os quatro 'demais' carregam marginRules em 26 (protegem a régua no motor)", () => {
    for (const id of ["last-mile", "dedicated", "fractional-distribution", "custom-project"]) {
      expect(acharProduto(id).marginRules.minimumMarginPercent).toBe(26);
    }
  });

  it("os produtos de piso 18 NÃO travam marginRules — a régua global (18) prevalece", () => {
    for (const id of ["middle-mile", "middle-mile-spot", "transfer", "supplier-pickup", "store-replenishment", "bulk"]) {
      expect(acharProduto(id).marginRules.minimumMarginPercent ?? undefined).toBeUndefined();
    }
  });

  it("distribuição fracionada NÃO é B2B: fica em 26, não em 18", () => {
    expect(acharProduto("fractional-distribution").approvalRules.minimumMarginPercent).toBe(26);
  });

  it("coleta em fornecedores (first mile) fica em 18", () => {
    expect(acharProduto("supplier-pickup").approvalRules.minimumMarginPercent).toBe(18);
  });
});

describe("Deal Desk aciona Precificação ou Head Comercial abaixo do piso", () => {
  it("24% num produto de piso 26 aciona o Deal Desk", () => {
    const dedicated = acharProduto("dedicated");
    const r = dealDeskTriggers(
      { marginPercent: 24, minimumMarginPercent: 26, selectedPrice: 10000 },
      dedicated,
    );
    expect(r.required).toBe(true);
    expect(r.triggers).toContain("Margem abaixo do mínimo");
    expect(r.marginFloorApprover).toBe("Precificação ou Head Comercial");
    expect(r.flow).toContain("Precificação ou Head Comercial");
  });

  it("24% num produto de piso 18 NÃO aciona por margem (o comercial pode)", () => {
    const middle = acharProduto("middle-mile");
    const r = dealDeskTriggers(
      { marginPercent: 24, minimumMarginPercent: 18, selectedPrice: 10000 },
      middle,
    );
    expect(r.triggers).not.toContain("Margem abaixo do mínimo");
    expect(r.marginFloorApprover).toBeNull();
  });

  it("17,9% num produto de piso 18 aciona o Deal Desk (abaixo do piso B2B)", () => {
    const bulk = acharProduto("bulk");
    const r = dealDeskTriggers(
      { marginPercent: 17.9, minimumMarginPercent: 18, selectedPrice: 10000 },
      bulk,
    );
    expect(r.required).toBe(true);
    expect(r.triggers).toContain("Margem abaixo do mínimo");
    expect(r.marginFloorApprover).toBe("Precificação ou Head Comercial");
  });

  it("exatamente no piso NÃO aciona por margem — o piso é permitido", () => {
    const lastMile = acharProduto("last-mile");
    const r = dealDeskTriggers(
      { marginPercent: 26, minimumMarginPercent: 26, selectedPrice: 10000 },
      lastMile,
    );
    expect(r.triggers).not.toContain("Margem abaixo do mínimo");
  });
});
