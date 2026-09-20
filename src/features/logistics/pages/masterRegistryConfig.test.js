import { describe, expect, it } from "vitest";
import { FORMS, initialFromRecord, payloadFor } from "./masterRegistryConfig.js";

// initialFromRecord é o INVERSO de payloadFor: dado um registro salvo, devolve o
// `form` para pré-preencher o modal de edição. Os testes travam o round-trip nos
// casos com transformação (papeis, razaoSocial, endereço, numéricos, isDefault) e
// a leitura das formas reais que o servidor devolve.

// form -> payloadFor -> (parece um registro salvo) -> initialFromRecord -> form
const roundTrip = (tab, form) => initialFromRecord(tab, payloadFor(tab, form));

describe("initialFromRecord (inverso de payloadFor)", () => {
  it("parties: desfaz papeis (array) e razaoSocial", () => {
    const form = { nome: "ACME LTDA", documento: "12345678000199", papeis: "fornecedor", email: "a@b.com", telefone: "1199999" };
    expect(roundTrip("parties", form)).toEqual(form);
  });

  it("parties: lê razaoSocial e o primeiro papel de um registro do servidor", () => {
    const record = { id: "p1", razaoSocial: "ACME LTDA", papeis: ["fornecedor", "transportador"], documento: "123", email: "a@b.com", telefone: "999", revision: 3 };
    expect(initialFromRecord("parties", record)).toEqual({
      nome: "ACME LTDA", documento: "123", papeis: "fornecedor", email: "a@b.com", telefone: "999",
    });
  });

  it("items: numéricos voltam a string", () => {
    const form = { codigo: "C1", nome: "Cimento", unidade: "SC", categoria: "Insumos", estoqueMinimo: "10", custoReferencia: "25.5" };
    expect(roundTrip("items", form)).toEqual(form);
  });

  it("operationalUnits: reconstrói addressText e cep a partir de address", () => {
    const form = { code: "B1", name: "Base Sul", kind: "base", document: "12345678000199", cep: "01001000", addressText: "Rua X, 100", status: "active" };
    expect(roundTrip("operationalUnits", form)).toEqual(form);
  });

  it("companyProfiles: reconstrói addressText e cep a partir de address", () => {
    const form = {
      legalName: "Todo Green LTDA", tradeName: "Todo Green", document: "12345678000199", stateRegistration: "ISENTO",
      cityRegistration: "", rntrc: "123", rntrcCategory: "ETC", rntrcStatus: "ATIVO", rntrcCheckedAt: "2024-01-10",
      cep: "01001000", addressText: "Av. Central, 200", status: "active",
    };
    expect(roundTrip("companyProfiles", form)).toEqual(form);
  });

  it("bankAccounts: isDefault volta ao valor do select (true/false)", () => {
    const base = { ownerType: "company", ownerId: "", bankCode: "001", bankName: "Banco do Brasil", branch: "1234", account: "5678", accountDigit: "9", accountType: "checking", pixKeyType: "cnpj", pixKey: "12345678000199", status: "active" };
    expect(roundTrip("bankAccounts", { ...base, isDefault: "true" })).toEqual({ ...base, isDefault: "true" });
    expect(roundTrip("bankAccounts", { ...base, isDefault: "false" })).toEqual({ ...base, isDefault: "false" });
  });

  it("bankAccounts: converte o boolean isDefault do servidor", () => {
    expect(initialFromRecord("bankAccounts", { id: "b1", ownerType: "company", bankName: "Itaú", isDefault: true, status: "active", revision: 1 }).isDefault).toBe("true");
    expect(initialFromRecord("bankAccounts", { id: "b2", ownerType: "company", bankName: "Itaú", isDefault: false, status: "active", revision: 1 }).isDefault).toBe("false");
  });

  it("vehicles: numéricos (ano, capacidade, autonomia) voltam a string", () => {
    const form = { prefix: "V1", plate: "ABC1D23", manufacturer: "VW", model: "eDelivery", modelYear: "2023", category: "van", operationalUnit: "Base Sul", payloadKg: "1000", batteryCapacityKwh: "80", realRangeKm: "200", status: "available" };
    expect(roundTrip("vehicles", form)).toEqual(form);
  });

  it("routes: numéricos (distância, duração, pedágio) voltam a string", () => {
    const form = { code: "R1", name: "Rota Centro", productId: "", originUnitId: "u1", destinationUnitId: "u2", distanceKm: "120", estimatedDurationMin: "90", vehicleCategory: "van", tollAmount: "35.5", status: "active" };
    expect(roundTrip("routes", form)).toEqual(form);
  });

  it("accounts: lê a natureza que o servidor de records devolve", () => {
    const record = { id: "acc1", codigo: "1.1", nome: "Caixa", natureza: "ativo", revision: 2 };
    expect(initialFromRecord("accounts", record)).toEqual({ codigo: "1.1", nome: "Caixa", tipo: "ativo" });
  });

  it("cobre todas as abas: devolve exatamente as chaves de FORMS[tab].fields", () => {
    for (const tab of Object.keys(FORMS)) {
      const chavesEsperadas = FORMS[tab].fields.map(([field]) => field).sort();
      const form = initialFromRecord(tab, {});
      expect(Object.keys(form).sort()).toEqual(chavesEsperadas);
    }
  });
});
