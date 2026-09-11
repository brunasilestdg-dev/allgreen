import { describe, expect, it } from "vitest";
import { METODOLOGIA_GLEC, fechamentoMensalEsg } from "./esgFechamentoDomain.js";

const calc = (avoided, emitido, referencia, energia, qualidade, versao = "2026.2") => ({
  impact: {
    co2AvoidedKg: avoided,
    co2ExecutadoKg: emitido,
    co2ReferenciaKg: referencia,
    energiaKwh: energia,
  },
  qualidadeDados: qualidade,
  versaoFatores: versao,
});

describe("fechamento mensal ESG na moldura GLEC / ISO 14083", () => {
  it("consolida o mês somando o que o motor auditável gravou", () => {
    const f = fechamentoMensalEsg(
      [calc(100, 12, 112, 300, 90), calc(50, 8, 58, 150, 70)],
      [],
      "2026-09",
    );
    expect(f.mes).toBe("2026-09");
    expect(f.metodologia).toBe(METODOLOGIA_GLEC);
    expect(f.versaoFatores).toBe("2026.2");
    expect(f.resumo.co2EvitadoKg).toBe(150);
    expect(f.resumo.co2EmitidoKg).toBe(20);
    expect(f.resumo.co2ReferenciaKg).toBe(170);
    expect(f.resumo.energiaKwh).toBe(450);
    expect(f.resumo.calculos).toBe(2);
    expect(f.resumo.qualidadeMedia).toBe(80);
  });

  it("intensidade GLEC (gCO2e/tkm) sai da atividade peso × distância", () => {
    // 2 t × 100 km = 200 tkm; + 1 t × 50 km = 50 tkm → 250 tkm.
    // Emitido total = 25 kg = 25000 g → 25000 / 250 = 100 gCO2e/tkm.
    const f = fechamentoMensalEsg(
      [calc(0, 25, 25, 0, 100)],
      [
        { pesoKg: 2000, distanciaKm: 100 },
        { campos: { weightKg: 1000 }, distanciaKm: 50 },
      ],
      "2026-09",
    );
    expect(f.resumo.toneladasKm).toBe(250);
    expect(f.resumo.intensidadeGCo2ePorTkm).toBe(100);
    expect(f.atividade.operacoesComPeso).toBe(2);
    expect(f.atividade.intensidadeDisponivel).toBe(true);
  });

  it("sem peso da carga, a intensidade fica null (não zero) e avisa", () => {
    const f = fechamentoMensalEsg(
      [calc(10, 5, 15, 0, 60)],
      [{ distanciaKm: 100 }, { pesoKg: 0, distanciaKm: 40 }],
      "2026-09",
    );
    expect(f.resumo.toneladasKm).toBe(0);
    expect(f.resumo.intensidadeGCo2ePorTkm).toBeNull();
    expect(f.atividade.intensidadeDisponivel).toBe(false);
    expect(f.atividade.operacoesSemPeso).toBe(2);
    expect(f.atividade.aviso).toMatch(/sem peso/i);
  });

  it("mês vazio não mente: tudo zero e intensidade indisponível", () => {
    const f = fechamentoMensalEsg([], [], "2026-09");
    expect(f.resumo.co2EvitadoKg).toBe(0);
    expect(f.resumo.qualidadeMedia).toBe(0);
    expect(f.resumo.intensidadeGCo2ePorTkm).toBeNull();
    expect(f.atividade.intensidadeDisponivel).toBe(false);
  });

  it("operação com peso mas sem distância não entra na atividade", () => {
    const f = fechamentoMensalEsg(
      [calc(0, 10, 10, 0, 100)],
      [{ pesoKg: 3000, distanciaKm: 0 }],
      "2026-09",
    );
    expect(f.resumo.toneladasKm).toBe(0);
    expect(f.atividade.operacoesComPeso).toBe(0);
    expect(f.resumo.intensidadeGCo2ePorTkm).toBeNull();
  });
});
