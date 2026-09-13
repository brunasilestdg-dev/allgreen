/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EnergyReferenceSection from "./EnergyReferenceSection.jsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const resp = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });
const authHeaders = () => ({ authorization: "Bearer t" });

const PLANO = {
  perfil: { configurado: true, distribuidora: "CPFL-PAULISTA", subgrupo: "A4", modalidade: "Verde" },
  tarifa: { tier: "aneel", tarifaKwhBase: 0.43698, stale: false, fallbackDoMotor: false, detalhe: { distribuidora: "CPFL-PAULISTA", subgrupo: "A4", modalidade: "Verde", vigenciaInicio: "2026-04-08", vigenciaFim: "2027-04-07" }, provenance: { capturedAt: "2026-09-12", measurementType: "EXTERNAL" }, curva: [] },
  janelas: {
    horasNecessarias: 3, saidaHora: 6,
    financeira: { rotulo: "22:00–01:00", criterio: "menor tarifa média (R$/kWh)", tarifaMedia: 0.43698, horas: 3, inicio: 22, fim: 1 },
    energetica: { rotulo: "02:00–05:00", criterio: "menor carga média do SIN (ONS, perfil dos últimos dias)", confidence: "HIGH", horas: 3, inicio: 2, fim: 5 },
    recomendada: { rotulo: "02:00–05:00", criterio: "60% tarifa + 40% carga do SIN (normalizados)", tarifaMedia: 0.43698, horas: 3, inicio: 2, fim: 5 },
    avisos: [], assumptions: ["disponibilidade_12h_antes_da_saida"], metodologia: ["Financeira: ...", "Energética: ...", "Recomendada: ..."],
  },
  plano: {
    demandaContratadaKw: 150,
    veiculos: [
      { id: "a", rotulo: "EV-2", energiaKwh: 210, alocadaKwh: 210, completo: true, custo: 91.77, sessoes: [{ pontoNome: "Carregador DC 1", inicio: "22:00", fim: "00:00", potenciaKw: 120, kwh: 210 }], motivo: "recarga completa nas horas mais baratas em que o veículo está parado" },
      { id: "b", rotulo: "EV-9", energiaKwh: 80, alocadaKwh: 0, completo: false, custo: 0, sessoes: [], motivo: "sem ponto compatível com o conector CHADEMO" },
    ],
    naoPlanejados: [{ id: "c", rotulo: "EV-3", motivo: "sem energia necessária informada (bateria/SOC)" }],
    totais: { veiculos: 2, completos: 1, alocadaKwh: 210, custo: 91.77, economia: 249.35, picoKw: 120, pontosAtivos: 2 },
    avisos: ["VEICULOS_INCOMPLETOS"], assumptions: [], veiculosNaFrota: 4,
  },
  diesel: { resolved: true, tier: "anp_municipal", priceRs: 6.29, produto: "diesel_s10", stale: false, provenance: { capturedAt: "2026-09-02" } },
  referencias: {
    aneel: { status: "ok", lastSuccessAt: "2026-09-13T06:00:00.000Z", sourceUpdatedAt: "2026-09-12", records: 3 },
    ons: { status: "stale", lastSuccessAt: "2026-09-01T06:00:00.000Z", sourceUpdatedAt: "2026-08-31T23:00:00.000Z", records: 672 },
    anp: { status: "never" },
  },
};
const PERFIL = { perfil: { configurado: true, distribuidora: "CPFL-PAULISTA", subgrupo: "A4", modalidade: "Verde", subsistemaOns: "SE", dieselProduto: "diesel_s10", demandaContratadaKw: 150, saidaHora: 6 }, opcoes: { subgrupos: ["A4", "B3"], modalidades: ["Verde", "Azul"], subsistemas: { SE: "Sudeste/Centro-Oeste" }, produtosDiesel: ["diesel_s10", "diesel"] }, access: { canWrite: true } };

describe("EnergyReferenceSection", () => {
  it("mostra a tarifa com origem/vigência, as três janelas, o diesel ANP, o plano por veículo e o estado das fontes", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => {
      const u = String(url);
      if (u.includes("/energy/plan")) return resp(PLANO);
      if (u.includes("/energy/profile")) return resp(PERFIL);
      return resp({});
    }));
    render(<EnergyReferenceSection authHeaders={authHeaders} />);
    expect(await screen.findByText("R$ 0,4370/kWh")).toBeInTheDocument();
    expect(screen.getByText(/ANEEL — tarifa homologada · CPFL-PAULISTA A4 Verde · vigência 08\/04\/2026–07\/04\/2027 · fonte de 12\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText("22:00–01:00")).toBeInTheDocument();
    expect(screen.getAllByText("02:00–05:00")).toHaveLength(2);
    expect(screen.getByText("R$ 6,29/L")).toBeInTheDocument();
    expect(screen.getByText(/ANP — município · diesel S10 · coleta 02\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText("EV-2")).toBeInTheDocument();
    expect(screen.getByText(/Carregador DC 1 · 22:00–00:00 · 120 kW · 210 kWh/)).toBeInTheDocument();
    expect(screen.getByText(/Incompleta — sem ponto compatível com o conector CHADEMO/)).toBeInTheDocument();
    expect(screen.getByText(/Fora do plano: EV-3/)).toBeInTheDocument();
    expect(screen.getByText(/economia de R\$ 249,35/)).toBeInTheDocument();
    expect(screen.getByText("Atualizada")).toBeInTheDocument();
    expect(screen.getByText("Desatualizada")).toBeInTheDocument();
    expect(screen.getByText("Nunca sincronizada")).toBeInTheDocument();
    expect(screen.getByText(/Há veículos que não fecham a energia/)).toBeInTheDocument();
  });

  it("salva o perfil com PUT e recarrega o plano; sincronizar chama POST /energy/sync", async () => {
    const chamadas = [];
    vi.stubGlobal("fetch", vi.fn((url, init = {}) => {
      const u = String(url);
      chamadas.push(`${init.method || "GET"} ${u}`);
      if (u.includes("/energy/plan")) return resp(PLANO);
      if (u.includes("/energy/profile")) return resp(init.method === "PUT" ? { perfil: PERFIL.perfil } : PERFIL);
      if (u.includes("/energy/sync")) return resp({ resultado: { ok: true, records: 3 } });
      return resp({});
    }));
    render(<EnergyReferenceSection authHeaders={authHeaders} />);
    await screen.findByText("R$ 0,4370/kWh");
    fireEvent.click(screen.getByText("Salvar perfil"));
    await waitFor(() => expect(chamadas.some((c) => c.startsWith("PUT ") && c.includes("/energy/profile"))).toBe(true));
    expect(await screen.findByText(/Perfil de energia salvo/)).toBeInTheDocument();
    const enviado = JSON.parse(fetch.mock.calls.find(([, init]) => init?.method === "PUT")[1].body);
    expect(enviado).toMatchObject({ distribuidora: "CPFL-PAULISTA", subgrupo: "A4", demandaContratadaKw: "150", saidaHora: "6", chegadaHora: null });

    fireEvent.click(screen.getAllByText("Sincronizar")[0]);
    await waitFor(() => expect(chamadas.some((c) => c.startsWith("POST ") && c.includes("/energy/sync"))).toBe(true));
    expect(await screen.findByText(/ANEEL sincronizada: 3 registro/)).toBeInTheDocument();
  });

  it("sem endpoint (resposta vazia) diz que está indisponível em vez de estimar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => resp({})));
    render(<EnergyReferenceSection authHeaders={authHeaders} />);
    expect(await screen.findByText(/Não foi possível carregar o plano de energia agora/i)).toBeInTheDocument();
    expect(screen.getByText(/Nada foi estimado no lugar/)).toBeInTheDocument();
  });
});
