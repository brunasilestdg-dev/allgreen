import { describe, expect, it } from "vitest";
import { resumoDeProdutividade } from "./driverProductivityDomain.js";

const AGORA = "2026-09-11T18:00:00Z";
const entrega = (dia, km) => ({ entregueEm: `${dia}T12:00:00Z`, distanciaKm: km });

describe("produtividade do motorista", () => {
  it("conta entregas e km de hoje e da semana", () => {
    const r = resumoDeProdutividade(
      [
        entrega("2026-09-11", 30), // hoje
        entrega("2026-09-11", 20), // hoje
        entrega("2026-09-08", 40), // semana (dentro de 7 dias)
        entrega("2026-09-01", 99), // fora da semana
        { entregueEm: "" }, // não entregue
      ],
      { minutosHoje: 300, agora: AGORA },
    );
    expect(r.entregasHoje).toBe(2);
    expect(r.kmHoje).toBe(50);
    expect(r.entregasSemana).toBe(3); // as duas de hoje + a de 08/09
    expect(r.kmSemana).toBe(90);
  });

  it("entregas por hora cruza a jornada com as entregas", () => {
    // 2 entregas hoje em 5h (300 min) → 0,4 entrega/hora.
    const r = resumoDeProdutividade(
      [entrega("2026-09-11", 10), entrega("2026-09-11", 10)],
      { minutosHoje: 300, agora: AGORA },
    );
    expect(r.horasHoje).toBe(5);
    expect(r.entregasPorHora).toBe(0.4);
  });

  it("sem horas de turno, entregas por hora fica null — não divide por zero", () => {
    const r = resumoDeProdutividade([entrega("2026-09-11", 10)], { minutosHoje: 0, agora: AGORA });
    expect(r.entregasHoje).toBe(1);
    expect(r.entregasPorHora).toBeNull();
  });

  it("dia vazio: tudo zero, produtividade indisponível", () => {
    const r = resumoDeProdutividade([], { minutosHoje: 0, agora: AGORA });
    expect(r.entregasHoje).toBe(0);
    expect(r.kmHoje).toBe(0);
    expect(r.entregasPorHora).toBeNull();
  });
});
