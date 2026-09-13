import { describe, expect, it } from "vitest";
import {
  eventKey, singletonKey, dedupeQueue, collapseSingletons, orderForSync,
  assignMissingIds, removeProcessed, removeProcessedByKey, pendingCount, prepareDrainBatch,
} from "./driverOfflineQueueDomain.js";

const evt = (over = {}) => ({
  id: over.id,
  viagemId: over.viagemId ?? "V1",
  referencia: over.referencia ?? "R1",
  tipo: over.tipo ?? "entrega",
  criadoEm: over.criadoEm,
  payload: { idempotencyKey: over.key, ocorridoEm: over.criadoEm, ...(over.payload || {}) },
});

describe("chaves", () => {
  it("eventKey prefere idempotencyKey do payload, senão o id", () => {
    expect(eventKey(evt({ key: "K", id: "I" }))).toBe("K");
    expect(eventKey(evt({ id: "I" }))).toBe("I");
    expect(eventKey({})).toBe("");
  });
  it("singletonKey é determinística por viagem+entidade+tipo", () => {
    const a = singletonKey({ viagemId: "V1", entityId: "P3", eventType: "entrega" });
    const b = singletonKey({ eventType: "entrega", entityId: "P3", viagemId: "V1" });
    expect(a).toBe("V1:P3:entrega");
    expect(a).toBe(b);
  });
});

describe("dedupe por chave de idempotência", () => {
  it("um clique repetido (mesma chave) colapsa num só, preservando o primeiro", () => {
    const fila = [evt({ key: "K1", criadoEm: "2026-01-01T10:00:00Z" }), evt({ key: "K1", criadoEm: "2026-01-01T10:00:01Z" }), evt({ key: "K2" })];
    const r = dedupeQueue(fila);
    expect(r).toHaveLength(2);
    expect(r[0].payload.ocorridoEm).toBe("2026-01-01T10:00:00Z");
  });
  it("itens sem chave são mantidos (não dá para afirmar duplicidade)", () => {
    expect(dedupeQueue([{}, {}])).toHaveLength(2);
  });
});

describe("colapso de singletons", () => {
  it("duas entregas da mesma viagem+parada colapsam; ocorrências não", () => {
    const fila = [
      evt({ tipo: "entrega", key: "a", payload: { entityId: "P1" } }),
      evt({ tipo: "entrega", key: "b", payload: { entityId: "P1" } }),
      evt({ tipo: "ocorrencia", key: "c", payload: { entityId: "P1" } }),
      evt({ tipo: "ocorrencia", key: "d", payload: { entityId: "P1" } }),
    ];
    const r = collapseSingletons(fila, ["entrega"]);
    expect(r.filter((e) => e.tipo === "entrega")).toHaveLength(1);
    expect(r.filter((e) => e.tipo === "ocorrencia")).toHaveLength(2);
  });
});

describe("ordenação para sync", () => {
  it("mais antigo primeiro; sem data vai para o fim de forma estável", () => {
    const fila = [
      evt({ id: "b", criadoEm: "2026-01-02T00:00:00Z" }),
      evt({ id: "a", criadoEm: "2026-01-01T00:00:00Z" }),
      evt({ id: "z" }),
    ];
    expect(orderForSync(fila).map((e) => e.id)).toEqual(["a", "b", "z"]);
  });
});

describe("ids legados e remoção de processados", () => {
  it("assignMissingIds atribui só a quem não tem, sinalizando mudança", () => {
    let n = 0;
    const { list, changed } = assignMissingIds([{ id: "x" }, {}], () => `g${(n += 1)}`);
    expect(changed).toBe(true);
    expect(list[0].id).toBe("x");
    expect(list[1].id).toBe("g1");
  });
  it("assignMissingIds não muda nada quando todos têm id", () => {
    const { changed } = assignMissingIds([{ id: "x" }], () => "g");
    expect(changed).toBe(false);
  });
  it("removeProcessed tira só os ids processados (Set ou array)", () => {
    const fila = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(removeProcessed(fila, new Set(["b"])).map((e) => e.id)).toEqual(["a", "c"]);
    expect(removeProcessed(fila, ["a", "c"]).map((e) => e.id)).toEqual(["b"]);
  });
  it("removeProcessedByKey tira também a duplicata colapsada (mesma chave, id diferente)", () => {
    const fila = [
      evt({ id: "1", key: "K1" }),
      evt({ id: "2", key: "K1" }), // duplicata que o dreno colapsou e não enviou
      evt({ id: "3", key: "K2" }),
    ];
    const restante = removeProcessedByKey(fila, new Set(["K1"]));
    expect(restante.map((e) => e.id)).toEqual(["3"]);
  });
});

describe("prepareDrainBatch (dedupe + singleton + ordem)", () => {
  it("prepara o lote sem duplicar e em ordem cronológica", () => {
    const fila = [
      evt({ key: "K1", tipo: "entrega", criadoEm: "2026-01-02T00:00:00Z", payload: { entityId: "P1" } }),
      evt({ key: "K1", tipo: "entrega", criadoEm: "2026-01-02T00:00:00Z", payload: { entityId: "P1" } }),
      evt({ key: "K0", tipo: "ocorrencia", criadoEm: "2026-01-01T00:00:00Z", payload: { entityId: "P1" } }),
    ];
    const r = prepareDrainBatch(fila);
    expect(r).toHaveLength(2);
    expect(r[0].payload.idempotencyKey).toBe("K0"); // mais antigo primeiro
  });
  it("pendingCount conta os itens", () => {
    expect(pendingCount([1, 2, 3])).toBe(3);
    expect(pendingCount(null)).toBe(0);
  });
});
