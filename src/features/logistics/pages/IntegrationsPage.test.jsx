/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import IntegrationsPage from "./IntegrationsPage.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// A tela de integrações da vertical mostrava só o STATUS dos provedores. O
// pedido era o oposto: um lugar, para o usuário, onde ele conecta a própria
// conta de Claude, GPT ou Google. Este teste prende o painel de chaves (BYOK)
// dentro da tela — não basta ver que a IA está ligada, tem de dar para ligar.

const respostaPorUrl = (url) => {
  if (String(url).includes("/api/ai-keys")) {
    return { cofreDisponivel: true, provedores: [
      { id: "anthropic", nome: "Claude", configurado: false },
      { id: "openai", nome: "ChatGPT", configurado: false },
      { id: "google", nome: "Google", configurado: false },
    ] };
  }
  // /api/todogreen/integrations
  return { ai: [], search: { configured: false, providers: [] }, messaging: [], communication: [], dataExchange: [], automation: [] };
};

const stubFetch = () => vi.stubGlobal("fetch", vi.fn((url) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(respostaPorUrl(url)) })));

describe("integrações da vertical", () => {
  it("deixa o usuário conectar a própria IA, não só ver o status", async () => {
    stubFetch();
    render(<IntegrationsPage authHeaders={() => ({})} setToast={() => {}} />);

    expect(await screen.findByRole("heading", { name: /Conectar sua própria inteligência artificial/i })).toBeInTheDocument();
    // O status continua existindo, agora rotulado como status.
    expect(await screen.findByRole("heading", { name: /Cascata de IA \(status\)/i })).toBeInTheDocument();
  });
});
