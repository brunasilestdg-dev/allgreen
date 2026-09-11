/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DriverPortalPage from "./DriverPortalPage.jsx";
import { ITENS_CHECKLIST } from "../driverChecklistDomain.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  try { localStorage.clear(); } catch { /* ignore */ }
});

const sessao = {
  vinculado: true,
  motorista: { id: "d1", nome: "João da Estrada", cnhCategoria: "E", cnhValidade: "2030-01-01", cnhAlerta: "", cnhImagemUrl: "", disponibilidade: "available" },
};

const montarFetch = (over = {}) => {
  const chamadas = [];
  vi.stubGlobal("fetch", vi.fn((url, options) => {
    const u = String(url);
    chamadas.push({ url: u, method: options?.method || "GET", body: options?.body });
    const resp = (dados, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(dados) });
    if (u.includes("/driver-portal/checklist") && options?.method === "POST") return resp({ checklist: { id: "c1", status: "aprovado" }, veredito: { status: "aprovado" } }, 201);
    if (u.includes("/driver-portal/checklist")) return resp(over.checklist || { checklists: [], itens: ITENS_CHECKLIST });
    if (u.includes("/driver-portal/jornada/inicio")) return resp(over.aposInicio || { turnos: [{ id: "t1", status: "aberto", iniciadoEm: new Date().toISOString(), encerradoEm: "", dataServico: new Date().toISOString().slice(0, 10) }] }, 201);
    if (u.includes("/driver-portal/jornada/fim")) return resp({ turnos: [{ id: "t1", status: "fechado", iniciadoEm: "2020-01-01T08:00:00Z", encerradoEm: "2020-01-01T12:00:00Z", dataServico: "2020-01-01" }] });
    if (u.includes("/driver-portal/jornada")) return resp(over.jornada || { turnos: [] });
    if (u.includes("/driver-portal/viagens")) return resp({ viagens: [] });
    if (u.includes("/driver-portal/rotas")) return resp({ rotas: [] });
    if (u.includes("/driver-portal/sessao") || u.endsWith("/driver-portal") || u.includes("/driver-portal?")) return resp(sessao);
    if (u.includes("/driver-portal")) return resp(sessao);
    return resp({}); // /api/auth/session, /api/auth/profile
  }));
  return chamadas;
};

describe("app do motorista — vistoria de pré-viagem", () => {
  it("mostra os itens da vistoria e só libera registrar quando está completa", async () => {
    localStorage.setItem("seu-funcionario-auth-token", "tok-joao");
    const chamadas = montarFetch();
    render(<DriverPortalPage />);

    await screen.findByText(/Olá, João/);
    fireEvent.click(screen.getByRole("button", { name: /Vistoria/ }));

    // Item conhecido aparece.
    expect(await screen.findByText("Freios respondem bem")).toBeInTheDocument();

    // Antes de responder, o botão de registrar está desabilitado.
    const registrar = screen.getByRole("button", { name: /Registrar vistoria/ });
    expect(registrar).toBeDisabled();

    // Responde todos os itens com "OK".
    const oks = screen.getAllByRole("button", { name: "OK" });
    expect(oks.length).toBe(ITENS_CHECKLIST.length);
    oks.forEach((botao) => fireEvent.click(botao));

    expect(registrar).toBeEnabled();
    fireEvent.click(registrar);

    await waitFor(() => {
      const post = chamadas.find((c) => c.method === "POST" && c.url.includes("/driver-portal/checklist"));
      expect(post).toBeTruthy();
      const enviado = JSON.parse(post.body);
      expect(Object.keys(enviado.respostas)).toHaveLength(ITENS_CHECKLIST.length);
      expect(enviado.respostas.freios).toBe("ok");
    });
  });

  it("um item crítico com problema mostra o veredito reprovado", async () => {
    localStorage.setItem("seu-funcionario-auth-token", "tok-joao");
    montarFetch();
    render(<DriverPortalPage />);
    await screen.findByText(/Olá, João/);
    fireEvent.click(screen.getByRole("button", { name: /Vistoria/ }));
    await screen.findByText("Freios respondem bem");

    // Responde tudo OK e depois marca Freios (crítico) como Problema.
    screen.getAllByRole("button", { name: "OK" }).forEach((b) => fireEvent.click(b));
    const itemFreios = screen.getByText("Freios respondem bem").closest(".tdg-vistoria-item");
    fireEvent.click(within(itemFreios).getByRole("button", { name: "Problema" }));

    expect(screen.getByText(/Não apto/i)).toBeInTheDocument();
  });

  it("mostra o selo da vistoria de hoje quando já registrada", async () => {
    localStorage.setItem("seu-funcionario-auth-token", "tok-joao");
    const hoje = new Date().toISOString().slice(0, 10);
    montarFetch({ checklist: { checklists: [{ id: "c1", status: "reprovado", dataServico: hoje, placa: "ABC1D23", observacao: "" }], itens: ITENS_CHECKLIST } });
    render(<DriverPortalPage />);
    await screen.findByText(/Olá, João/);
    fireEvent.click(screen.getByRole("button", { name: /Vistoria/ }));

    expect(await screen.findByText(/Vistoria de hoje: Reprovada/)).toBeInTheDocument();
  });
});

describe("app do motorista — jornada (turno)", () => {
  it("fora de turno mostra iniciar; ao iniciar, passa a mostrar em turno", async () => {
    localStorage.setItem("seu-funcionario-auth-token", "tok-joao");
    const chamadas = montarFetch();
    render(<DriverPortalPage />);
    await screen.findByText(/Olá, João/);

    // Começa fora de turno.
    expect(await screen.findByText("Fora de turno")).toBeInTheDocument();
    const iniciar = screen.getByRole("button", { name: /Iniciar turno/ });
    fireEvent.click(iniciar);

    // Depois de iniciar (mock devolve um turno aberto), mostra "Em turno".
    expect(await screen.findByText("Em turno")).toBeInTheDocument();
    expect(chamadas.some((c) => c.method === "POST" && c.url.includes("/jornada/inicio"))).toBe(true);
  });

  it("com um turno aberto vindo do servidor, mostra o botão de encerrar", async () => {
    localStorage.setItem("seu-funcionario-auth-token", "tok-joao");
    montarFetch({ jornada: { turnos: [{ id: "t1", status: "aberto", iniciadoEm: new Date().toISOString(), encerradoEm: "", dataServico: new Date().toISOString().slice(0, 10) }] } });
    render(<DriverPortalPage />);
    await screen.findByText(/Olá, João/);

    expect(await screen.findByText("Em turno")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Encerrar turno/ })).toBeInTheDocument();
  });
});
