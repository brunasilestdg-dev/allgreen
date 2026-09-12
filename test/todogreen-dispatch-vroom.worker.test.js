import { describe, expect, it } from "vitest";
import {
  capacidadeDoVeiculo,
  demandaDaOperacao,
  habilidadesDoVeiculo,
  habilidadesExigidas,
  interpretarDespachoVroom,
  janelaDeEntrega,
  montarProblemaVroomDespacho,
} from "../worker/services/todogreen-dispatch-vroom.js";

describe("To Do Green dispatch VROOM adapter", () => {
  it("usa peso, volume, pallets e pacotes como capacidade multidimensional", () => {
    expect(demandaDaOperacao({
      fields_json: JSON.stringify({ weightKg: 12.5, volumeM3: 0.4, pallets: 2, packages: 8 }),
    })).toEqual([12500, 400, 2, 8]);

    expect(capacidadeDoVeiculo({
      payload_kg: 1500,
      volume_m3: 12.5,
      pallet_capacity: 8,
    })).toEqual([1500000, 12500, 8, 1000000000]);
  });

  it("não bloqueia capacidade sem cadastro e mantém ao menos um pacote por operação", () => {
    expect(demandaDaOperacao({ fields_json: "{}" })).toEqual([0, 0, 0, 1]);
    expect(capacidadeDoVeiculo({})).toEqual([
      1000000000, 1000000000, 1000000000, 1000000000,
    ]);
  });

  it("monta jobs e shipments com ids numéricos e coordenadas lon/lat", () => {
    const built = montarProblemaVroomDespacho({
      operacoes: [
        {
          id: "op-entrega",
          delivery_lat: -23.55,
          delivery_lng: -46.63,
          fields_json: JSON.stringify({ weightKg: 20 }),
        },
        {
          id: "op-coleta",
          pickup_lat: -23.60,
          pickup_lng: -46.70,
          delivery_lat: -23.50,
          delivery_lng: -46.80,
          fields_json: JSON.stringify({ pallets: 1 }),
        },
      ],
      veiculos: [{ id: "v1", plate: "ABC1D23", payload_kg: 1000 }],
      depot: { lat: -23.52, lng: -46.65 },
      agora: new Date("2026-09-10T12:00:00Z"),
    });

    expect(built.ok).toBe(true);
    expect(built.payload.vehicles[0].start).toEqual([-46.65, -23.52]);
    expect(built.payload.jobs).toHaveLength(1);
    expect(built.payload.shipments).toHaveLength(1);
    expect(built.payload.jobs[0].location).toEqual([-46.63, -23.55]);
    expect(built.payload.shipments[0].pickup.location).toEqual([-46.70, -23.60]);
    expect(built.payload.vehicles[0].time_window[1] - built.payload.vehicles[0].time_window[0])
      .toBe(8 * 3600);
  });

  it("interpreta vários veículos, preserva a ordem e deduplica pickup/delivery", () => {
    const built = montarProblemaVroomDespacho({
      operacoes: [
        { id: "op1", delivery_lat: -23.55, delivery_lng: -46.63, fields_json: "{}" },
        {
          id: "op2",
          pickup_lat: -23.60, pickup_lng: -46.70,
          delivery_lat: -23.50, delivery_lng: -46.80,
          fields_json: "{}",
        },
      ],
      veiculos: [
        { id: "v-real-1", prefix: "V01", plate: "AAA1A11" },
        { id: "v-real-2", prefix: "V02", plate: "BBB2B22" },
      ],
      depot: { lat: -23.52, lng: -46.65 },
      agora: new Date("2026-09-10T12:00:00Z"),
    });

    const jobId = built.payload.jobs[0].id;
    const pickupId = built.payload.shipments[0].pickup.id;
    const deliveryId = built.payload.shipments[0].delivery.id;

    const parsed = interpretarDespachoVroom({
      contexto: built.contexto,
      motoristas: [
        { id: "d1", full_name: "Motorista 1" },
        { id: "d2", full_name: "Motorista 2" },
      ],
      resposta: {
        code: 0,
        summary: { routes: 2, unassigned: 0, cost: 5000 },
        unassigned: [],
        routes: [
          {
            vehicle: 2, distance: 12000, duration: 1800, cost: 1800,
            steps: [{ type: "start" }, { type: "job", id: jobId }, { type: "end" }],
          },
          {
            vehicle: 1, distance: 24000, duration: 3600, cost: 3200,
            steps: [
              { type: "start" },
              { type: "pickup", id: pickupId },
              { type: "delivery", id: deliveryId },
              { type: "end" },
            ],
          },
        ],
      },
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.motor).toBe("vroom");
    expect(parsed.tours[0]).toMatchObject({
      veiculoId: "v-real-2",
      motoristaId: "d1",
      operacoes: ["op1"],
      distanciaKm: 12,
      duracaoMin: 30,
      paradas: [{ operationId: "op1", tipo: "entrega" }],
    });
    expect(parsed.tours[1].operacoes).toEqual(["op2"]);
    expect(parsed.tours[1].paradas).toEqual([
      { operationId: "op2", tipo: "coleta" },
      { operationId: "op2", tipo: "entrega" },
    ]);
  });

  it("leva o prazo de entrega (promised_at) como janela de tempo por parada", () => {
    const agora = new Date("2026-09-10T12:00:00Z");
    const inicio = Math.floor(agora.getTime() / 1000);
    const fim = inicio + 8 * 3600;

    // Prazo dentro do turno → janela [início, prazo]. Sem prazo → sem janela.
    const built = montarProblemaVroomDespacho({
      operacoes: [
        { id: "com-prazo", delivery_lat: -23.55, delivery_lng: -46.63, fields_json: "{}", promised_at: "2026-09-10T14:00:00Z" },
        { id: "sem-prazo", delivery_lat: -23.50, delivery_lng: -46.60, fields_json: "{}" },
      ],
      veiculos: [{ id: "v1" }],
      depot: { lat: -23.52, lng: -46.65 },
      agora,
    });
    const comPrazo = built.payload.jobs.find((j) => j.description === "com-prazo");
    const semPrazo = built.payload.jobs.find((j) => j.description === "sem-prazo");
    expect(comPrazo.time_windows).toEqual([[inicio, Math.floor(new Date("2026-09-10T14:00:00Z").getTime() / 1000)]]);
    expect(semPrazo.time_windows).toBeUndefined();

    // Unitário do helper: prazo além do turno é limitado ao fim; prazo vencido não restringe.
    expect(janelaDeEntrega({ promised_at: "2026-09-11T00:00:00Z" }, inicio, fim)).toEqual([[inicio, fim]]);
    expect(janelaDeEntrega({ promised_at: "2026-09-10T10:00:00Z" }, inicio, fim)).toBeNull();
    expect(janelaDeEntrega({}, inicio, fim)).toBeNull();
  });

  it("extrai habilidades exigidas da carga e capacidades do veículo, sem acento e normalizadas", () => {
    expect(habilidadesExigidas({ fields_json: JSON.stringify({ requiredVehicleClass: "Refrigerado" }) }))
      .toEqual(["refrigerado"]);
    expect(habilidadesExigidas({ fields_json: JSON.stringify({ requiredSkills: ["Baú", "Munck"] }) }))
      .toEqual(["bau", "munck"]);
    expect(habilidadesExigidas({ fields_json: JSON.stringify({ refrigerado: true }) }))
      .toEqual(["refrigerado"]);
    // Sem exigência declarada ⇒ nenhuma habilidade (dormente).
    expect(habilidadesExigidas({ fields_json: "{}" })).toEqual([]);

    expect(habilidadesDoVeiculo({ category: "Refrigerado" })).toEqual(["refrigerado"]);
    expect(habilidadesDoVeiculo({ fields_json: JSON.stringify({ skills: ["Baú", "Munck"] }), category: "" }))
      .toEqual(["bau", "munck"]);
  });

  it("dormente: sem exigência declarada, nenhum job/veículo recebe skills (zero regressão)", () => {
    const built = montarProblemaVroomDespacho({
      operacoes: [{ id: "op1", delivery_lat: -23.55, delivery_lng: -46.63, fields_json: "{}" }],
      veiculos: [{ id: "v1", plate: "ABC1D23" }],
      depot: { lat: -23.52, lng: -46.65 },
      agora: new Date("2026-09-10T12:00:00Z"),
    });
    expect(built.ok).toBe(true);
    expect(built.payload.jobs[0].skills).toBeUndefined();
    expect(built.payload.vehicles[0].skills).toBeUndefined();
  });

  it("casa carga↔veículo: a parada e o veículo apto compartilham o mesmo id de skill; o inapto não o tem", () => {
    const built = montarProblemaVroomDespacho({
      operacoes: [{
        id: "op-frio",
        delivery_lat: -23.55, delivery_lng: -46.63,
        fields_json: JSON.stringify({ requiredVehicleClass: "refrigerado" }),
      }],
      veiculos: [
        { id: "v-seco", plate: "SEC0A00", category: "baú" },
        { id: "v-frio", plate: "FRI0A00", category: "Refrigerado" },
      ],
      depot: { lat: -23.52, lng: -46.65 },
      agora: new Date("2026-09-10T12:00:00Z"),
    });
    expect(built.ok).toBe(true);
    const skillFrio = built.payload.jobs[0].skills;
    expect(Array.isArray(skillFrio) && skillFrio.length).toBe(1);
    const veiculoFrio = built.payload.vehicles.find((v) => v.description === "v-frio");
    const veiculoSeco = built.payload.vehicles.find((v) => v.description === "v-seco");
    // O apto contém a skill exigida; o inapto não — é isso que faz o VROOM só
    // atribuir carga refrigerada a veículo refrigerado.
    expect(veiculoFrio.skills).toContain(skillFrio[0]);
    expect(veiculoSeco.skills || []).not.toContain(skillFrio[0]);
  });

  it("aplica a exigência de skill também a shipments (coleta+entrega) no nível do envio", () => {
    const built = montarProblemaVroomDespacho({
      operacoes: [{
        id: "op-munck",
        pickup_lat: -23.60, pickup_lng: -46.70,
        delivery_lat: -23.50, delivery_lng: -46.80,
        fields_json: JSON.stringify({ requiredSkills: ["munck"] }),
      }],
      veiculos: [{ id: "v-munck", plate: "MNK0A00", fields_json: JSON.stringify({ skills: ["munck"] }) }],
      depot: { lat: -23.52, lng: -46.65 },
      agora: new Date("2026-09-10T12:00:00Z"),
    });
    expect(built.ok).toBe(true);
    const skills = built.payload.shipments[0].skills;
    expect(Array.isArray(skills) && skills.length).toBe(1);
    expect(built.payload.vehicles[0].skills).toContain(skills[0]);
  });

  it("converte tarefas não atribuídas de volta para operação", () => {
    const built = montarProblemaVroomDespacho({
      operacoes: [{ id: "op1", delivery_lat: -23.55, delivery_lng: -46.63, fields_json: "{}" }],
      veiculos: [{ id: "v1" }],
      depot: { lat: -23.52, lng: -46.65 },
      agora: new Date("2026-09-10T12:00:00Z"),
    });
    const jobId = built.payload.jobs[0].id;
    const parsed = interpretarDespachoVroom({
      contexto: built.contexto,
      resposta: { code: 0, summary: { unassigned: 1 }, routes: [], unassigned: [{ id: jobId }] },
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.naoAtribuidas).toEqual(["op1"]);
  });
});
