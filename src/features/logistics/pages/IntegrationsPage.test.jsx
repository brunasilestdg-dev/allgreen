/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import IntegrationsPage from "./IntegrationsPage.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const respostaPorUrl = (url) => {
  if (String(url).includes("/api/ai-keys")) {
    return { cofreDisponivel: true, provedores: [
      { id: "anthropic", nome: "Claude", configurado: false },
      { id: "openai", nome: "ChatGPT", configurado: false },
      { id: "google", nome: "Google", configurado: false },
    ] };
  }
  return {
    ai: [],
    search: { configured: false, providers: [] },
    market: [
      { id: "web-search", name: "Pesquisa web pública", configured: false, status: "requires_setup", canTest: true },
      { id: "linkedin", name: "LinkedIn · decisores e prospecção", configured: false, status: "external_dependency" },
    ],
    messaging: [],
    communication: [
      { id: "microsoft-365", name: "Microsoft 365 · Outlook e Agenda", configured: false, status: "external_dependency" },
    ],
    operational: [
      { id: "track3r", name: "Track3r / Sistemas Tracker", configured: false, status: "requires_setup" },
      { id: "sefaz-fiscal", name: "SEFAZ · CT-e e MDF-e", configured: false, status: "external_dependency" },
      { id: "antt-ciot-direct", name: "ANTT · CIOT direto", configured: false, status: "external_dependency" },
    ],
    management: [
      { id: "monday", name: "monday.com", configured: false, status: "external_dependency" },
      { id: "power-bi", name: "Power BI", configured: false, status: "external_dependency" },
    ],
    dataExchange: [],
    automation: [],
  };
};

const stubFetch = () => vi.stubGlobal("fetch", vi.fn((url) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(respostaPorUrl(url)) })));

describe("integrações da vertical", () => {
  it("deixa o usuário conectar a própria IA e mostra o hub operacional completo", async () => {
    stubFetch();
    render(<IntegrationsPage authHeaders={() => ({})} setToast={() => {}} />);

    expect(await screen.findByRole("heading", { name: /Conectar sua própria inteligência artificial/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /Cascata de IA \(status\)/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /Mercado e prospecção/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /Operação e fiscal/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /Dados e gestão/i })).toBeInTheDocument();

    expect(screen.getByText(/LinkedIn · decisores e prospecção/i)).toBeInTheDocument();
    expect(screen.getByText(/Track3r \/ Sistemas Tracker/i)).toBeInTheDocument();
    expect(screen.getByText(/SEFAZ · CT-e e MDF-e/i)).toBeInTheDocument();
    expect(screen.getByText(/ANTT · CIOT direto/i)).toBeInTheDocument();
    expect(screen.getByText(/monday.com/i)).toBeInTheDocument();
    expect(screen.getByText(/Power BI/i)).toBeInTheDocument();
    expect(screen.getByText(/Microsoft 365 · Outlook e Agenda/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Depende de serviço externo/i).length).toBeGreaterThan(0);
  });
});
