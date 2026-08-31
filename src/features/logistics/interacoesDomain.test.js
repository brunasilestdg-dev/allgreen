import { describe, expect, it } from "vitest";
import {
  diasSemContato,
  interacoesVisiveis,
  ordenarInteracoes,
  proximosPassos,
  resumoDaInteracao,
  rotuloDoTipo,
  tipoValido,
  ultimaInteracao,
} from "./interacoesDomain.js";

const base = [
  { id: "a", clientId: "cli-1", opportunityId: "", tipo: "reuniao", assunto: "Kick-off", ocorridaEm: "2026-08-20" },
  { id: "b", clientId: "cli-1", opportunityId: "opp-1", tipo: "ligacao", assunto: "Ajuste de preço", ocorridaEm: "2026-08-25" },
  { id: "c", clientId: "cli-1", opportunityId: "opp-2", tipo: "tentativa", assunto: "Sem retorno", ocorridaEm: "2026-08-28" },
  { id: "d", clientId: "cli-2", opportunityId: "", tipo: "visita", assunto: "Visita ao CD", ocorridaEm: "2026-08-29" },
];

describe("alcance da interação", () => {
  it("dentro da oportunidade, vê a dela e a da conta — nunca a de outra oportunidade", () => {
    const vistas = interacoesVisiveis({ interacoes: base, clientId: "cli-1", opportunityId: "opp-1" });
    expect(vistas.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("na conta, vê só o que é da conta", () => {
    const vistas = interacoesVisiveis({ interacoes: base, clientId: "cli-1" });
    expect(vistas.map((item) => item.id)).toEqual(["a"]);
  });

  it("a conta de outro cliente não entra", () => {
    expect(interacoesVisiveis({ interacoes: base, clientId: "cli-2" }).map((i) => i.id)).toEqual(["d"]);
  });

  it("sem vínculo nenhum, não devolve nada", () => {
    expect(interacoesVisiveis({ interacoes: base })).toEqual([]);
  });
});

describe("ordem e leitura", () => {
  it("ordena pela data em que aconteceu, não pela digitação", () => {
    const lancadaDepois = [
      { id: "antiga", ocorridaEm: "2026-07-01", criadoEm: "2026-08-30T10:00:00Z" },
      { id: "nova", ocorridaEm: "2026-08-29", criadoEm: "2026-08-29T10:00:00Z" },
    ];
    expect(ordenarInteracoes(lancadaDepois).map((i) => i.id)).toEqual(["nova", "antiga"]);
  });

  it("a última interação é a mais recente do que aconteceu", () => {
    expect(ultimaInteracao(base).id).toBe("d");
  });

  it("tipo desconhecido cai em reunião e tem rótulo legível", () => {
    expect(tipoValido("nada-disso")).toBe("reuniao");
    expect(tipoValido("tentativa")).toBe("tentativa");
    expect(rotuloDoTipo("tentativa")).toBe("Tentativa de contato");
    expect(rotuloDoTipo("")).toBe("Interação");
  });

  it("resume tipo e assunto numa linha", () => {
    expect(resumoDaInteracao(base[2])).toBe("Tentativa de contato · Sem retorno");
    expect(resumoDaInteracao({ tipo: "email" })).toBe("E-mail");
  });
});

describe("silêncio e compromissos", () => {
  it("conta sem interação nenhuma devolve null, não zero", () => {
    expect(diasSemContato([])).toBeNull();
    expect(diasSemContato([{ id: "x", ocorridaEm: "" }])).toBeNull();
  });

  it("conta os dias desde a última interação", () => {
    const agora = new Date("2026-08-30T12:00:00Z");
    expect(diasSemContato([{ id: "x", ocorridaEm: "2026-08-20" }], agora)).toBe(10);
  });

  it("próximo passo vencido sai da lista; o do futuro fica", () => {
    const agora = new Date("2026-08-30T12:00:00Z");
    const passos = proximosPassos([
      { id: "vencido", proximoPasso: "Cobrar retorno", proximoPassoEm: "2026-08-01", ocorridaEm: "2026-07-30" },
      { id: "futuro", proximoPasso: "Enviar minuta", proximoPassoEm: "2026-09-05", ocorridaEm: "2026-08-30", opportunityId: "opp-1" },
    ], agora);
    expect(passos).toEqual([
      { id: "futuro", passo: "Enviar minuta", quando: "2026-09-05", origem: "oportunidade" },
    ]);
  });
});
