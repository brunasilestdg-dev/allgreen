import { describe, expect, it } from "vitest";
import { resumoTelemetriaVeiculo, minutosDesde, frescorDaLeitura } from "./driverVehicleDomain.js";

const agora = "2026-09-11T12:00:00Z";

describe("telemetria do veículo — nunca mostra 0% sem leitura", () => {
  it("sem carimbo de leitura, é 'sem leitura' — não zero", () => {
    const r = resumoTelemetriaVeiculo({ placa: "ABC1D23", socPercent: null, autonomiaKm: null, lidoEm: "" }, agora);
    expect(r.temLeitura).toBe(false);
    expect(r.socPercent).toBeNull();
    expect(r.frescor).toBe("sem-leitura");
  });

  it("bateria realmente em 0% COM leitura é diferente de sem leitura", () => {
    const r = resumoTelemetriaVeiculo({ placa: "ABC1D23", socPercent: 0, autonomiaKm: 0, lidoEm: "2026-09-11T11:50:00Z" }, agora);
    expect(r.temLeitura).toBe(true);
    expect(r.socPercent).toBe(0);
    expect(r.minutosAtras).toBe(10);
  });

  it("leitura fresca traz SOC, autonomia e a idade em minutos", () => {
    const r = resumoTelemetriaVeiculo({ placa: "XYZ", prefixo: "V-01", socPercent: 62, autonomiaKm: 140, lidoEm: "2026-09-11T11:52:00Z", fonte: "tracker" }, agora);
    expect(r.socPercent).toBe(62);
    expect(r.autonomiaKm).toBe(140);
    expect(r.minutosAtras).toBe(8);
    expect(r.frescor).toBe("recente");
    expect(r.prefixo).toBe("V-01");
  });

  it("SOC fora de 0–100 é coado; autonomia negativa vira null", () => {
    const r = resumoTelemetriaVeiculo({ placa: "P", socPercent: 130, autonomiaKm: -5, lidoEm: "2026-09-11T11:00:00Z" }, agora);
    expect(r.socPercent).toBe(100);
    expect(r.autonomiaKm).toBeNull();
  });

  it("sem veículo, avisa que não há veículo", () => {
    expect(resumoTelemetriaVeiculo(null, agora).temVeiculo).toBe(false);
    expect(resumoTelemetriaVeiculo({ placa: "" }, agora).temVeiculo).toBe(false);
  });
});

describe("frescor e idade da leitura", () => {
  it("classifica por idade", () => {
    expect(frescorDaLeitura(10)).toBe("recente");
    expect(frescorDaLeitura(120)).toBe("do-dia");
    expect(frescorDaLeitura(2000)).toBe("antiga");
    expect(frescorDaLeitura(null)).toBe("sem-leitura");
  });
  it("leitura no futuro (relógio torto) não vira idade negativa", () => {
    expect(minutosDesde("2026-09-11T13:00:00Z", agora)).toBeNull();
  });
});
