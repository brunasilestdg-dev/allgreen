/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarketSignalsPanel from "./MarketSignalsPanel.jsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const resp = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });
const authHeaders = () => ({ authorization: "Bearer t" });

const LISTA = {
  signals: [
    { id: "ms-1", source: "pncp", sources: ["pncp", "compras-gov"], kind: "licitacao", title: "Serviços de transporte de cargas com veículos elétricos", summary: "Serviços de transporte de cargas com veículos elétricos", url: "https://pncp.gov.br/app/editais/1/2026/1", orgao: "MUNICIPIO X", uf: "SP", municipio: "Campinas", modalidade: "Pregão - Eletrônico", prazoProposta: "2026-09-30T08:00:00.000Z", publicadoEm: "2026-09-12T10:00:00.000Z", valorEstimado: 250000, score: 100, scoreReasons: ["fonte estruturada de contratação (PNCP)", "eletrificação, baixa emissão ou descarbonização"], seenCount: 2, triage: { status: "new" } },
    { id: "ms-2", source: "gdelt", sources: ["gdelt"], kind: "noticia", title: "Transportadora adota caminhões elétricos", url: "https://noticia.com.br/x", dominio: "noticia.com.br", publicadoEm: "2026-09-12T14:30:00.000Z", score: 65, scoreReasons: ["notícia de fonte monitorada (GDELT)"], seenCount: 1, triage: { status: "new" } },
  ],
  fontes: { pncp: { status: "ok", lastSuccessAt: "2026-09-13T06:00:00.000Z" }, comprasGov: { status: "never" }, gdelt: { status: "stale", lastSuccessAt: "2026-09-01T06:00:00.000Z" }, sinais: { total: 2 } },
  access: { canResearch: true },
};

describe("MarketSignalsPanel", () => {
  it("lista sinais com fonte, score, motivos, prazo e estado das fontes", async () => {
    vi.stubGlobal("fetch", vi.fn(() => resp(LISTA)));
    render(<MarketSignalsPanel authHeaders={authHeaders} />);
    expect(await screen.findByText(/PNCP \+ Compras\.gov\.br · licitação · score 100\/100 · SP/)).toBeInTheDocument();
    expect(screen.getByText(/propostas até 30\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/R\$ 250\.000/)).toBeInTheDocument();
    expect(screen.getByText(/eletrificação, baixa emissão ou descarbonização/)).toBeInTheDocument();
    expect(screen.getByText(/GDELT · notícia · score 65\/100/)).toBeInTheDocument();
    expect(screen.getByText(/PNCP: atualizada \(13\/09\/2026\) · Compras\.gov\.br: nunca rodou · GDELT: desatualizada/)).toBeInTheDocument();
  });

  it("sincroniza e tria chamando os endpoints certos", async () => {
    const chamadas = [];
    vi.stubGlobal("fetch", vi.fn((url, init = {}) => {
      chamadas.push(`${init.method || "GET"} ${url}`);
      if (String(url).endsWith("/sync")) return resp({ resultado: { ok: true, records: 3, aceitos: 1 } });
      if (init.method === "PATCH") return resp({ signal: {} });
      return resp(LISTA);
    }));
    const setToast = vi.fn();
    render(<MarketSignalsPanel authHeaders={authHeaders} setToast={setToast} />);
    await screen.findByText(/score 100\/100/);
    fireEvent.click(screen.getByRole("button", { name: /PNCP/ }));
    await waitFor(() => expect(chamadas.some((c) => c.startsWith("POST ") && c.includes("/market-signals/sync"))).toBe(true));
    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.stringContaining("3 item(ns) lidos, 1 sinal(is) aceito(s)")));
    fireEvent.click(screen.getAllByText("Descartar")[0]);
    await waitFor(() => expect(chamadas.some((c) => c.startsWith("PATCH ") && c.includes("/market-signals/ms-1"))).toBe(true));
  });

  it("sem endpoint diz que está indisponível; sem permissão não mostra botões", async () => {
    vi.stubGlobal("fetch", vi.fn(() => resp({}, false)));
    render(<MarketSignalsPanel authHeaders={authHeaders} />);
    expect(await screen.findByText(/indisponíveis neste servidor/)).toBeInTheDocument();
    cleanup();
    vi.stubGlobal("fetch", vi.fn(() => resp({ ...LISTA, access: { canResearch: false } })));
    render(<MarketSignalsPanel authHeaders={authHeaders} />);
    await screen.findByText(/score 100\/100/);
    expect(screen.queryByText("Descartar")).not.toBeInTheDocument();
  });
});
