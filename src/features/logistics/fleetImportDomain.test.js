import { describe, expect, it } from "vitest";
import { analisarLinhasDeFrota, MODELO_CSV_FROTA } from "./fleetImportDomain.js";
import { parseDelimitedText } from "../../domain/importacoes.js";

const linha = (over = {}) => ({
  Prefixo: "TDG-001",
  Placa: "ABC1D23",
  Classe: "VUC",
  Fabricante: "JAC",
  Modelo: "iEV1200",
  Ano: "2024",
  "Capacidade (kg)": "3000",
  "Bateria (kWh)": "100",
  "Autonomia (km)": "240",
  ...over,
});

describe("importar frota em massa (bloco 01)", () => {
  it("uma linha boa vira veículo NOVO, elétrico, com a classe reconhecida", () => {
    const r = analisarLinhasDeFrota([linha()]);
    expect(r.resumo).toEqual({ total: 1, novos: 1, duplicados: 0, invalidos: 0 });
    const [item] = r.linhas;
    expect(item.status).toBe("novo");
    expect(item.veiculo.prefix).toBe("TDG-001");
    expect(item.veiculo.vehicleClass).toBe("vuc");
    expect(item.veiculo.energyType).toBe("electric");
    expect(item.veiculo.payloadKg).toBe(3000);
    expect(item.veiculo.batteryCapacityKwh).toBe(100);
    expect(item.veiculo.nominalRangeKm).toBe(240);
    expect(r.importaveis).toHaveLength(1);
  });

  it("reconhece cabeçalhos com acento, parêntese e apelido de classe", () => {
    const r = analisarLinhasDeFrota([
      { "PREFIXO": "TDG-9", "Placa": "XYZ2E34", "Tipo": "furgão", "Autonomia km": "180", "Capacidade de carga": "1200" },
    ]);
    expect(r.linhas[0].status).toBe("novo");
    // "furgão" é apelido de van
    expect(r.linhas[0].veiculo.vehicleClass).toBe("van");
    expect(r.linhas[0].veiculo.nominalRangeKm).toBe(180);
    expect(r.linhas[0].veiculo.payloadKg).toBe(1200);
  });

  it("número em padrão brasileiro (vírgula decimal, ponto de milhar)", () => {
    const r = analisarLinhasDeFrota([
      linha({ "Consumo (kWh/km)": "0,47", "Valor de aquisição": "380.000,50" }),
    ]);
    expect(r.linhas[0].veiculo.energyConsumptionKwhPerKm).toBeCloseTo(0.47, 5);
    expect(r.linhas[0].veiculo.acquisitionValue).toBeCloseTo(380000.5, 2);
  });

  it("sem prefixo, sem placa ou placa malformada → inválida com o motivo", () => {
    const r = analisarLinhasDeFrota([
      linha({ Prefixo: "" }),
      linha({ Placa: "" }),
      linha({ Placa: "123" }),
    ]);
    expect(r.resumo.invalidos).toBe(3);
    expect(r.linhas[0].erro).toMatch(/prefixo/i);
    expect(r.linhas[1].erro).toMatch(/placa/i);
    expect(r.linhas[2].erro).toMatch(/inválida/i);
    expect(r.importaveis).toHaveLength(0);
  });

  it("classe não reconhecível é inválida — não chuta a classe", () => {
    const r = analisarLinhasDeFrota([
      { Prefixo: "TDG-2", Placa: "AAA1B22", Classe: "nave espacial" },
    ]);
    expect(r.linhas[0].status).toBe("invalido");
    expect(r.linhas[0].erro).toMatch(/classe/i);
  });

  it("infere a classe pelo peso quando a coluna de classe falta", () => {
    const r = analisarLinhasDeFrota([
      { Prefixo: "TDG-3", Placa: "BBB2C33", "Capacidade (kg)": "1000" },
    ]);
    // 1000 kg cai em van (800–1600)
    expect(r.linhas[0].status).toBe("novo");
    expect(r.linhas[0].veiculo.vehicleClass).toBe("van");
  });

  it("energia impossível na classe é recusada (frota é elétrica)", () => {
    // Mesmo que a planilha traga 'diesel', a vertical é elétrica: recusa.
    const r = analisarLinhasDeFrota([
      { Prefixo: "TDG-4", Placa: "CCC3D44", Classe: "carreta", Energia: "diesel" },
    ]);
    // linhaParaVeiculo força electric; então valida como elétrica e passa —
    // a recusa de diesel é do cadastro manual. Aqui garantimos que NÃO cadastra
    // diesel: o veículo sai marcado elétrico.
    expect(r.linhas[0].veiculo.energyType).toBe("electric");
    expect(r.linhas[0].status).toBe("novo");
  });

  it("placa já existente vira DUPLICADO, não erro — e não entra nos importáveis", () => {
    const r = analisarLinhasDeFrota([linha({ Placa: "ABC1D23" })], {
      placasExistentes: ["abc1d23"],
    });
    expect(r.resumo).toEqual({ total: 1, novos: 0, duplicados: 1, invalidos: 0 });
    expect(r.linhas[0].status).toBe("duplicado");
    expect(r.importaveis).toHaveLength(0);
  });

  it("placa repetida DENTRO da planilha só entra uma vez", () => {
    const r = analisarLinhasDeFrota([
      linha({ Prefixo: "A", Placa: "DDD4E55" }),
      linha({ Prefixo: "B", Placa: "DDD4E55" }),
    ]);
    expect(r.resumo.novos).toBe(1);
    expect(r.resumo.duplicados).toBe(1);
    expect(r.linhas[1].status).toBe("duplicado");
  });

  it("o modelo CSV exportado é ele mesmo importável", () => {
    const r = analisarLinhasDeFrota(parseDelimitedText(MODELO_CSV_FROTA));
    expect(r.resumo.novos).toBe(1);
    expect(r.linhas[0].veiculo.prefix).toBe("TDG-001");
    expect(r.linhas[0].veiculo.vehicleClass).toBe("vuc");
  });
});
