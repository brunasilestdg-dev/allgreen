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
    expect(await screen.findByText(/não foi possível carregar agora/i)).toBeInTheDocument();\n    expect(screen.getByText(/Nada foi estimado no lugar/)).toBeInTheDocument();
    cleanup();
    vi.stubGlobal("fetch", vi.fn(() => resp({ ...LISTA, access: { canResearch: false } })));
    render(<MarketSignalsPanel authHeaders={authHeaders} />);
    await screen.findByText(/score 100\/100/);
    expect(screen.queryByText("Descartar")).not.toBeInTheDocument();
  });
});

describe("MarketSignalsPanel — complementos (prefs por espaço e sinal → oportunidade)", () => {
  it("cria oportunidade a partir do sinal e mostra o estado convertido", async () => {
    const chamadas = [];
    let convertido = false;
    vi.stubGlobal("fetch", vi.fn((url, init = {}) => {
      chamadas.push(`${init.method || "GET"} ${url}`);
      if (String(url).endsWith("/opportunity")) { convertido = true; return resp({ created: true, opportunityId: "opp-1", opportunity: { cliente: "MUNICIPIO X" }, signal: {} }); }
      if (!convertido) return resp(LISTA);
      return resp({ ...LISTA, signals: [{ ...LISTA.signals[0], triage: { status: "converted", opportunityId: "opp-1" } }, LISTA.signals[1]] });
    }));
    const setToast = vi.fn();
    render(<MarketSignalsPanel authHeaders={authHeaders} setToast={setToast} />);
    await screen.findByText(/score 100\/100/);
    fireEvent.click(screen.getAllByRole("button", { name: /Criar oportunidade/ })[0]);
    await waitFor(() => expect(chamadas.some((c) => c === "POST /api/todogreen/market-signals/ms-1/opportunity")).toBe(true));
    await waitFor(() => expect(setToast).toHaveBeenCalledWith(expect.stringContaining("Oportunidade criada")));
    expect(await screen.findByText("Oportunidade criada")).toBeInTheDocument();
  });

  it("edita e salva termos/UFs do espaço em PUT /prefs", async () => {
    const chamadas = [];
    vi.stubGlobal("fetch", vi.fn((url, init = {}) => {
      chamadas.push({ m: init.method || "GET", url: String(url), body: init.body ? JSON.parse(init.body) : null });
      if (String(url).endsWith("/prefs")) return resp({ prefs: { termosPncp: ["transporte escolar"], termosGdelt: [], ufsFoco: ["SP"] } });
      return resp({ ...LISTA, prefs: { termosPncp: [], termosGdelt: [], ufsFoco: [], padrao: { termosPncp: ["frete"], termosGdelt: [] } } });
    }));
    render(<MarketSignalsPanel authHeaders={authHeaders} setToast={vi.fn()} />);
    await screen.findByText(/score 100\/100/);
    fireEvent.click(screen.getByRole("button", { name: /Termos e UFs/ }));
    const form = await screen.findByTestId("tdg-market-prefs");
    expect(form).toHaveTextContent(/padrão: frete/);
    fireEvent.change(screen.getByLabelText(/Termos PNCP/), { target: { value: "transporte escolar" } });
    fireEvent.change(screen.getByLabelText(/UFs de foco/), { target: { value: "SP" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar preferências/ }));
    await waitFor(() => expect(chamadas.some((c) => c.m === "PUT" && c.url.endsWith("/market-signals/prefs") && c.body.termosPncp === "transporte escolar" && c.body.ufsFoco === "SP")).toBe(true));
  });
});
