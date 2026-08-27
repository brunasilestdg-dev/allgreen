import { describe, expect, it } from "vitest";
import {
  CONSUMO_REFERENCIA,
  VEHICLE_CLASSES,
  aceitaUnidadeDeCobranca,
  cargaCabeNaClasse,
  classeEletrificavel,
  cnhExigida,
  consumoReferencia,
  energiaViavelNaClasse,
  frotaPorClasse,
  inferClassByPayload,
  isVehicleClass,
  normalizeVehicleClass,
  vehicleClass,
  vehicleClassOrder,
  validateVehicleClass,
} from "./vehicleClassDomain.js";

describe("a escala de moto a carreta", () => {
  it("vai da moto ao rodotrem, em ordem de porte", () => {
    expect(VEHICLE_CLASSES[0].id).toBe("moto");
    expect(VEHICLE_CLASSES.at(-1).id).toBe("rodotrem");
    // A ordem é a escala: sem isso a lista sai alfabética e "bitrem, bitruck,
    // carreta, moto" não descreve nada.
    expect(vehicleClassOrder("moto")).toBeLessThan(vehicleClassOrder("van"));
    expect(vehicleClassOrder("van")).toBeLessThan(vehicleClassOrder("carreta"));
    expect(vehicleClassOrder("carreta")).toBeLessThan(vehicleClassOrder("rodotrem"));
  });

  it("as faixas de carga são contínuas e não se sobrepõem", () => {
    // Faixa com buraco deixaria um peso sem classe; faixa sobreposta daria duas
    // classes para o mesmo peso.
    for (let i = 1; i < VEHICLE_CLASSES.length; i += 1) {
      expect(VEHICLE_CLASSES[i].payloadKgMin).toBe(VEHICLE_CLASSES[i - 1].payloadKgMax);
    }
  });

  it("cada classe declara eixos, CNH, porte e energias", () => {
    for (const classe of VEHICLE_CLASSES) {
      expect(classe.axles).toBeGreaterThan(0);
      expect(["A", "B", "C", "D", "E"]).toContain(classe.cnh);
      expect(["leve", "medio", "pesado"]).toContain(classe.porte);
      expect(classe.energias.length).toBeGreaterThan(0);
      expect(classe.billingUnits.length).toBeGreaterThan(0);
    }
  });

  it("a habilitação sobe com o porte", () => {
    expect(cnhExigida("moto")).toBe("A");
    expect(cnhExigida("van")).toBe("B");
    expect(cnhExigida("truck")).toBe("C");
    expect(cnhExigida("carreta")).toBe("E");
    expect(cnhExigida("inexistente")).toBe("");
  });

  it("só o VUC tem restrição urbana declarada", () => {
    // É a razão de o VUC existir como classe: entra em via restrita por
    // dimensão onde caminhão não entra.
    expect(vehicleClass("vuc").urbanRestricted).toBe(true);
    expect(vehicleClass("truck").urbanRestricted).toBe(false);
  });
});

describe("eletrificação não é uniforme na frota", () => {
  it("moto, van e VUC são eletrificáveis; carreta e rodotrem não", () => {
    // Declarar carreta elétrica faria a proposta prometer emissão zero num
    // veículo que não entrega isso hoje no Brasil.
    expect(classeEletrificavel("moto")).toBe(true);
    expect(classeEletrificavel("van")).toBe(true);
    expect(classeEletrificavel("vuc")).toBe(true);
    expect(classeEletrificavel("tres_quartos")).toBe(true);
    expect(classeEletrificavel("carreta")).toBe(false);
    expect(classeEletrificavel("bitrem")).toBe(false);
    expect(classeEletrificavel("rodotrem")).toBe(false);
  });

  it("o pesado aceita biometano, que é o caminho real dele", () => {
    expect(energiaViavelNaClasse("carreta", "biomethane")).toBe(true);
    expect(energiaViavelNaClasse("truck", "biomethane")).toBe(true);
    expect(energiaViavelNaClasse("rodotrem", "biomethane")).toBe(false);
  });

  it("classe desconhecida não aceita energia nenhuma", () => {
    expect(energiaViavelNaClasse("inventada", "electric")).toBe(false);
  });
});

describe("unidade de cobrança por classe", () => {
  it("moto e van cobram pacote; carreta cobra viagem e tonelada", () => {
    // O produto vendido depende da classe: moto não faz line haul.
    expect(aceitaUnidadeDeCobranca("moto", "pacote")).toBe(true);
    expect(aceitaUnidadeDeCobranca("moto", "tonelada")).toBe(false);
    expect(aceitaUnidadeDeCobranca("carreta", "viagem")).toBe(true);
    expect(aceitaUnidadeDeCobranca("carreta", "tonelada")).toBe(true);
    expect(aceitaUnidadeDeCobranca("carreta", "pacote")).toBe(false);
  });
});

describe("normalização do que vem de fora", () => {
  it("aceita o id canônico em qualquer caixa", () => {
    expect(normalizeVehicleClass("MOTO")).toBe("moto");
    expect(normalizeVehicleClass("tres_quartos")).toBe("tres_quartos");
  });

  it("resolve apelidos de planilha e de rastreador", () => {
    expect(normalizeVehicleClass("motoboy")).toBe("moto");
    expect(normalizeVehicleClass("Motocicleta")).toBe("moto");
    expect(normalizeVehicleClass("Sprinter")).toBe("van");
    expect(normalizeVehicleClass("furgão")).toBe("van");
    expect(normalizeVehicleClass("Fiorino")).toBe("utilitario");
    expect(normalizeVehicleClass("Veículo Urbano de Carga")).toBe("vuc");
    expect(normalizeVehicleClass("3/4")).toBe("tres_quartos");
    expect(normalizeVehicleClass("cavalo mecânico")).toBe("carreta");
  });

  it("tolera acento, hífen, underscore e espaço a mais", () => {
    expect(normalizeVehicleClass("  três  quartos ")).toBe("tres_quartos");
    expect(normalizeVehicleClass("bi-truck")).toBe("bitruck");
    expect(normalizeVehicleClass("RODO TREM")).toBe("rodotrem");
  });

  it("bitruck não vira truck, e bitrem não vira trem qualquer", () => {
    // Casar por palavra contida sem ordem faria "bitruck" cair em "truck".
    expect(normalizeVehicleClass("BITRUCK BAU")).toBe("bitruck");
    expect(normalizeVehicleClass("CAMINHAO TRUCK BAU")).toBe("truck");
    expect(normalizeVehicleClass("BITREM GRANELEIRO")).toBe("bitrem");
    expect(normalizeVehicleClass("RODOTREM 9 EIXOS")).toBe("rodotrem");
  });

  it("carreta é reconhecida pelas várias formas de dizer a mesma coisa", () => {
    expect(normalizeVehicleClass("carreta")).toBe("carreta");
    expect(normalizeVehicleClass("CAVALO + CARRETA")).toBe("carreta");
    expect(normalizeVehicleClass("semirreboque")).toBe("carreta");
  });

  it("devolve vazio quando não reconhece, sem chutar", () => {
    // Classificar uma carreta como van erraria custo, cobrança, habilitação e
    // restrição urbana de uma vez.
    expect(normalizeVehicleClass("veículo")).toBe("");
    expect(normalizeVehicleClass("xyz-9000")).toBe("");
    expect(normalizeVehicleClass("")).toBe("");
    expect(normalizeVehicleClass(null)).toBe("");
  });

  it("isVehicleClass e vehicleClass respondem sobre o id", () => {
    expect(isVehicleClass("carreta")).toBe(true);
    expect(isVehicleClass("caminhonete")).toBe(false);
    expect(vehicleClass("carreta").name).toBe("Carreta");
    expect(vehicleClass("nada")).toBeNull();
  });
});

describe("inferência por capacidade", () => {
  it("acha a classe pela faixa de carga", () => {
    expect(inferClassByPayload(40)).toBe("moto");
    expect(inferClassByPayload(1200)).toBe("van");
    expect(inferClassByPayload(3000)).toBe("vuc");
    expect(inferClassByPayload(12000)).toBe("truck");
    expect(inferClassByPayload(28000)).toBe("carreta");
  });

  it("o limite superior pertence à própria classe", () => {
    expect(inferClassByPayload(60)).toBe("moto");
    expect(inferClassByPayload(61)).toBe("utilitario");
  });

  it("devolve null fora de qualquer faixa ou sem dado", () => {
    expect(inferClassByPayload(0)).toBeNull();
    expect(inferClassByPayload(-5)).toBeNull();
    expect(inferClassByPayload(99999)).toBeNull();
    expect(inferClassByPayload("abacaxi")).toBeNull();
  });
});

describe("a carga cabe?", () => {
  it("compara com o teto típico da classe", () => {
    expect(cargaCabeNaClasse("van", 1200)).toBe(true);
    expect(cargaCabeNaClasse("van", 5000)).toBe(false);
    expect(cargaCabeNaClasse("carreta", 25000)).toBe(true);
  });

  it("devolve null sem dado — não false, que leria como não cabe", () => {
    // False recusaria uma viagem possível.
    expect(cargaCabeNaClasse("van", 0)).toBeNull();
    expect(cargaCabeNaClasse("", 1000)).toBeNull();
    expect(cargaCabeNaClasse("inventada", 1000)).toBeNull();
  });
});

describe("retrato da frota por classe", () => {
  const frota = [
    { vehicleClass: "moto", energyType: "electric" },
    { vehicleClass: "moto", energyType: "electric" },
    { vehicleClass: "van", energyType: "electric" },
    { vehicleClass: "van", energyType: "diesel" },
    { vehicleClass: "carreta", energyType: "diesel" },
    { vehicleClass: "carreta", energyType: "biomethane" },
  ];

  it("agrupa por classe na ordem de porte", () => {
    const { linhas } = frotaPorClasse(frota);
    expect(linhas.map((l) => l.classeId)).toEqual(["moto", "van", "carreta"]);
    expect(linhas.find((l) => l.classeId === "moto")).toMatchObject({ total: 2, eletricos: 2 });
    expect(linhas.find((l) => l.classeId === "van")).toMatchObject({ total: 2, eletricos: 1 });
  });

  it("marca o que é eletrificável e o que não é", () => {
    const { linhas, naoEletrificavel } = frotaPorClasse(frota);
    expect(linhas.find((l) => l.classeId === "carreta").eletrificavel).toBe(false);
    expect(naoEletrificavel).toBe(2);
  });

  it("o percentual é sobre o que É eletrificável, não sobre a frota inteira", () => {
    // Medir contra a frota inteira faria a meta parecer inalcançável por causa
    // das carretas, que hoje não têm versão elétrica.
    // Eletrificáveis: 2 motos + 2 vans = 4. Elétricos de fato: 3. → 75%.
    expect(frotaPorClasse(frota).percentualEletrificado).toBe(75);
  });

  it("veículo sem classe fica visível em vez de somado em qualquer grupo", () => {
    // É problema de cadastro e precisa aparecer.
    const { semClasse, total } = frotaPorClasse([...frota, { category: "sei lá" }, {}]);
    expect(semClasse).toBe(2);
    expect(total).toBe(6);
  });

  it("aceita a classe vinda do campo `category` legado", () => {
    const { linhas } = frotaPorClasse([{ category: "Sprinter", energyType: "electric" }]);
    expect(linhas[0]).toMatchObject({ classeId: "van", eletricos: 1 });
  });

  it("frota sem nada eletrificável devolve percentual null, não zero", () => {
    // Zero diria "temos zero de uma meta possível"; null diz "não se aplica".
    expect(frotaPorClasse([{ vehicleClass: "carreta", energyType: "diesel" }]).percentualEletrificado)
      .toBeNull();
    expect(frotaPorClasse([]).percentualEletrificado).toBeNull();
  });
});

describe("consumo de referência por classe", () => {
  it("cada classe do VEHICLE_CLASSES tem entrada no CONSUMO_REFERENCIA", () => {
    for (const classe of VEHICLE_CLASSES) {
      const ref = consumoReferencia(classe.id);
      expect(ref).not.toBeNull();
      expect(ref.convencionalKmPorL).toBeGreaterThan(0);
      expect(ref.convencionalKgCO2ePorL).toBeGreaterThan(0);
      expect(ref.convencionalCombustivel).toBeTruthy();
      expect(ref.fonteConvencional).toBeTruthy();
    }
  });

  it("classes eletrificáveis têm consumo elétrico; as demais têm null", () => {
    for (const classe of VEHICLE_CLASSES) {
      const ref = consumoReferencia(classe.id);
      if (classeEletrificavel(classe.id)) {
        expect(ref.eletricoKwhPorKm).toBeGreaterThan(0);
        expect(ref.fonteEletrico).toBeTruthy();
      } else {
        expect(ref.eletricoKwhPorKm).toBeNull();
      }
    }
  });

  it("o consumo elétrico cresce com o porte: moto < van < vuc", () => {
    const moto = consumoReferencia("moto").eletricoKwhPorKm;
    const utilitario = consumoReferencia("utilitario").eletricoKwhPorKm;
    const van = consumoReferencia("van").eletricoKwhPorKm;
    const vuc = consumoReferencia("vuc").eletricoKwhPorKm;
    expect(moto).toBeLessThan(utilitario);
    expect(utilitario).toBeLessThan(van);
    expect(van).toBeLessThan(vuc);
  });

  it("o consumo convencional cai com o porte: moto > van > carreta em km/L", () => {
    const moto = consumoReferencia("moto").convencionalKmPorL;
    const van = consumoReferencia("van").convencionalKmPorL;
    const carreta = consumoReferencia("carreta").convencionalKmPorL;
    const rodotrem = consumoReferencia("rodotrem").convencionalKmPorL;
    expect(moto).toBeGreaterThan(van);
    expect(van).toBeGreaterThan(carreta);
    expect(carreta).toBeGreaterThan(rodotrem);
  });

  it("moto usa gasolina E27 como referência, não diesel", () => {
    const moto = consumoReferencia("moto");
    expect(moto.convencionalCombustivel).toBe("gasolina_e27");
    expect(moto.convencionalKgCO2ePorL).toBe(2.12);
  });

  it("van e carreta usam diesel B14 como referência", () => {
    expect(consumoReferencia("van").convencionalCombustivel).toBe("diesel_b14");
    expect(consumoReferencia("carreta").convencionalCombustivel).toBe("diesel_b14");
  });

  it("classe inexistente devolve null", () => {
    expect(consumoReferencia("inventada")).toBeNull();
    expect(consumoReferencia("")).toBeNull();
  });
});

describe("validação", () => {
  it("exige a classe e recusa a desconhecida", () => {
    expect(validateVehicleClass({ vehicleClass: "carreta" })).toBe("");
    expect(validateVehicleClass({})).toMatch(/moto a carreta/i);
    expect(validateVehicleClass({ vehicleClass: "caminhonete" })).toMatch(/desconhecida/i);
  });

  it("recusa energia impossível na classe, dizendo quais são possíveis", () => {
    const erro = validateVehicleClass({ vehicleClass: "carreta", energyType: "electric" });
    expect(erro).toMatch(/Carreta não opera com electric/);
    expect(erro).toMatch(/biomethane/);
    expect(validateVehicleClass({ vehicleClass: "van", energyType: "electric" })).toBe("");
  });

  it("classe sem energia declarada passa", () => {
    expect(validateVehicleClass({ vehicleClass: "moto" })).toBe("");
  });
});
