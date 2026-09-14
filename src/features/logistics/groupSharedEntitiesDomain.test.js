import { describe, it, expect } from "vitest";
import {
  BUSINESS_UNITS,
  ENTITY_TYPES,
  createSharedEntity,
  exposeToBusiness,
  closeExposure,
  isExposedTo,
  listForBusiness,
  projectFor,
  consolidatedUsage,
  findDuplicates,
  groupMetrics,
  requireGroupId,
} from "./groupSharedEntitiesDomain.js";

describe("groupSharedEntitiesDomain", () => {
  it("BUSINESS_UNITS declara os três negócios do grupo, congelado", () => {
    expect(BUSINESS_UNITS).toEqual(["todogreen", "greenon", "greenmob"]);
    expect(Object.isFrozen(BUSINESS_UNITS)).toBe(true);
  });

  it("createSharedEntity exige tipo e ownerBu válidos", () => {
    expect(() => createSharedEntity({})).toThrow(/Tipo/);
    expect(() => createSharedEntity({ type: "vehicle" })).toThrow(/ownerBu/);
    const e = createSharedEntity({ type: "vehicle", ownerBu: "todogreen", data: { placa: "AAA1B23" } });
    expect(e.type).toBe("vehicle");
    expect(e.groupId).toBe("grupo-all-green");
    expect(e.exposures).toEqual([]);
    expect(ENTITY_TYPES).toContain(e.type);
  });

  it("requireGroupId trava a leitura de registro sem grupo", () => {
    expect(() => requireGroupId({})).toThrow();
    expect(requireGroupId({ groupId: "g1" })).toBe("g1");
  });

  it("exposeToBusiness NÃO duplica a entidade — só acrescenta uma exposição", () => {
    let e = createSharedEntity({ type: "vehicle", ownerBu: "todogreen", data: { placa: "XYZ1A22" } });
    e = exposeToBusiness(e, { bu: "greenmob", scope: "rent", startYmd: "2026-01-01" });
    e = exposeToBusiness(e, { bu: "greenon", scope: "consume", startYmd: "2026-01-01" });
    expect(e.exposures).toHaveLength(2);
    expect(e.id).toBeDefined();
  });

  it("exposeToBusiness recusa bu ou scope inválidos", () => {
    const e = createSharedEntity({ type: "vehicle", ownerBu: "todogreen" });
    expect(() => exposeToBusiness(e, { bu: "wtf", scope: "rent" })).toThrow(/bu inválido/);
    expect(() => exposeToBusiness(e, { bu: "greenmob", scope: "wtf" })).toThrow(/scope inválido/);
  });

  it("isExposedTo respeita janela e escopo; exposição vencida NÃO conta", () => {
    let e = createSharedEntity({ type: "vehicle", ownerBu: "todogreen" });
    e = exposeToBusiness(e, { bu: "greenmob", scope: "rent", startYmd: "2026-01-01", endYmd: "2026-01-31" });
    expect(isExposedTo(e, "greenmob", "rent", "2026-01-15")).toBe(true);
    expect(isExposedTo(e, "greenmob", "rent", "2025-12-31")).toBe(false);
    expect(isExposedTo(e, "greenmob", "rent", "2026-02-01")).toBe(false);
    expect(isExposedTo(e, "greenmob", "operate", "2026-01-15")).toBe(false);
    expect(isExposedTo(e, "todogreen", "rent", "2026-01-15")).toBe(false);
  });

  it("closeExposure fecha só a exposição aberta daquela bu, mantém histórico", () => {
    let e = createSharedEntity({ type: "driver", ownerBu: "todogreen" });
    e = exposeToBusiness(e, { bu: "greenmob", scope: "operate", startYmd: "2026-01-01" });
    e = exposeToBusiness(e, { bu: "greenmob", scope: "operate", startYmd: "2025-06-01", endYmd: "2025-12-31" });
    e = closeExposure(e, "greenmob", { endYmd: "2026-06-30" });
    // A que estava aberta foi fechada; a antiga continua com o endYmd original
    const fechadaAgora = e.exposures.find((x) => x.startYmd === "2026-01-01");
    const jaFechada = e.exposures.find((x) => x.startYmd === "2025-06-01");
    expect(fechadaAgora.endYmd).toBe("2026-06-30");
    expect(jaFechada.endYmd).toBe("2025-12-31");
  });

  it("listForBusiness devolve SÓ o que aquela bu enxerga hoje", () => {
    const v1 = exposeToBusiness(createSharedEntity({ type: "vehicle", ownerBu: "todogreen", id: "v1" }), { bu: "greenmob", scope: "rent", startYmd: "2026-01-01" });
    const v2 = createSharedEntity({ type: "vehicle", ownerBu: "todogreen", id: "v2" });
    const v3 = exposeToBusiness(createSharedEntity({ type: "vehicle", ownerBu: "todogreen", id: "v3" }), { bu: "greenmob", scope: "rent", startYmd: "2025-01-01", endYmd: "2025-12-31" });
    const lista = listForBusiness([v1, v2, v3], "greenmob", "rent", "2026-02-15");
    expect(lista.map((x) => x.id)).toEqual(["v1"]);
  });

  it("projectFor RETIRA campos proibidos e devolve null para bu sem exposição", () => {
    let motorista = createSharedEntity({
      type: "driver",
      ownerBu: "todogreen",
      data: { nome: "Ana", cpf: "12345678901", telefone: "11987654321", custoInternoReais: 4500 },
    });
    motorista = exposeToBusiness(motorista, {
      bu: "greenmob",
      scope: "operate",
      restrictions: ["cpf", "telefone", "custoInternoReais"],
    });
    const proj = projectFor(motorista, "greenmob");
    expect(proj.data.nome).toBe("Ana");
    expect(proj.data.cpf).toBeUndefined();
    expect(proj.data.telefone).toBeUndefined();
    expect(proj.data.custoInternoReais).toBeUndefined();
    expect(projectFor(motorista, "greenon")).toBeNull();
  });

  it("consolidatedUsage agrega km/kWh/receita por BU e ordena por lucro", () => {
    const v = createSharedEntity({ type: "vehicle", ownerBu: "todogreen", id: "v1" });
    const movimentos = [
      { entityId: "v1", bu: "todogreen", km: 4200, receitaReais: 12000, custoReais: 6000 },
      { entityId: "v1", bu: "greenmob", dias: 15, receitaReais: 8000, custoReais: 500 },
      { entityId: "v1", bu: "greenon", sessoes: 12, kwh: 320, receitaReais: 1000, custoReais: 200 },
      { entityId: "outro", bu: "todogreen", km: 999999 }, // ignorado
    ];
    const uso = consolidatedUsage(v, movimentos);
    expect(uso).toHaveLength(3);
    // Greenmob: 8000-500=7500; TDG: 12000-6000=6000; GreenOn: 1000-200=800
    expect(uso.map((x) => x.bu)).toEqual(["greenmob", "todogreen", "greenon"]);
  });

  it("findDuplicates detecta veículos com a mesma placa e motoristas com o mesmo CPF", () => {
    const v1 = createSharedEntity({ type: "vehicle", ownerBu: "todogreen", data: { placa: "aaa1b23" } });
    const v2 = createSharedEntity({ type: "vehicle", ownerBu: "greenmob", data: { placa: "AAA 1B23" } });
    const v3 = createSharedEntity({ type: "vehicle", ownerBu: "todogreen", data: { placa: "OUTRA99" } });
    const d1 = createSharedEntity({ type: "driver", ownerBu: "todogreen", data: { cpf: "123.456.789-01" } });
    const d2 = createSharedEntity({ type: "driver", ownerBu: "greenmob", data: { cpf: "12345678901" } });
    const dupes = findDuplicates([v1, v2, v3, d1, d2]);
    expect(dupes).toHaveLength(2);
    const chaves = dupes.map((d) => d.key).sort();
    expect(chaves).toEqual(["driver:12345678901", "vehicle:AAA1B23"]);
  });

  it("groupMetrics conta compartilhados (exposto a 2+ BUs vivas) e exposições vencidas", () => {
    let v1 = createSharedEntity({ type: "vehicle", ownerBu: "todogreen" });
    v1 = exposeToBusiness(v1, { bu: "greenmob", scope: "rent", startYmd: "2026-01-01" });
    v1 = exposeToBusiness(v1, { bu: "greenon", scope: "consume", startYmd: "2026-01-01" });
    const v2 = createSharedEntity({ type: "vehicle", ownerBu: "todogreen" });
    let v3 = createSharedEntity({ type: "driver", ownerBu: "todogreen" });
    v3 = exposeToBusiness(v3, { bu: "greenmob", scope: "operate", startYmd: "2025-01-01", endYmd: "2025-12-31" });

    const m = groupMetrics([v1, v2, v3], "2026-02-15");
    const veh = m.tipos.find((t) => t.type === "vehicle");
    const drv = m.tipos.find((t) => t.type === "driver");
    expect(veh.total).toBe(2);
    expect(veh.compartilhados).toBe(1); // só v1
    expect(drv.total).toBe(1);
    expect(drv.compartilhados).toBe(0); // exposição vencida
    expect(m.expostosVencidos).toBe(1);
  });
});
