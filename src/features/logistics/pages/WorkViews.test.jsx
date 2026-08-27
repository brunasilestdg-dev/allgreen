/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkViews from "./WorkViews.jsx";

const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
}));

const ITENS = [
  { id: "i1", title: "Kickoff", status: "novo", responsible: "Ana", startDate: "2026-03-01", dueDate: "2026-03-05", dependencies: [], groupId: "g1", isMilestone: false },
  { id: "i2", title: "Go-live", status: "em_execucao", responsible: "Beto", startDate: "2026-03-06", dueDate: "2026-03-20", dependencies: ["i1"], groupId: "g1", isMilestone: false },
  { id: "i3", title: "Marco de aceite", status: "novo", responsible: "Ana", dueDate: "2026-03-21", dependencies: ["i2"], isMilestone: true },
];

describe("Espaço · Visualizações", () => {
  beforeEach(() => { localStorage.setItem("seu-funcionario-auth-token", "teste"); });
  afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

  const montarFetch = () => vi.fn((url) => {
    if (String(url).includes("/groups")) {
      return json({ groups: [{ id: "g1", name: "Implantação", color: "#34b78f", displayOrder: 1 }] });
    }
    return json({ boards: [{ id: "board-1", name: "Comercial" }], items: ITENS });
  });

  it("mostra o resumo e desenha o Gantt com caminho crítico por padrão", async () => {
    vi.stubGlobal("fetch", montarFetch());
    render(<WorkViews setToast={() => {}} />);

    // Métrica de caminho crítico: i1(5d)+i2(15d)+marco(0) = 20 dias.
    await waitFor(() => expect(screen.getByText("20d")).toBeTruthy());
    // As barras do Gantt trazem os títulos dos itens.
    expect(screen.getByText("Kickoff")).toBeTruthy();
    expect(screen.getByText("Go-live")).toBeTruthy();
  });

  it("troca para Workload e soma a carga por responsável", async () => {
    vi.stubGlobal("fetch", montarFetch());
    render(<WorkViews setToast={() => {}} />);
    await waitFor(() => expect(screen.getByText("20d")).toBeTruthy());

    fireEvent.click(screen.getByRole("tab", { name: /Workload/ }));
    // Ana tem 2 itens abertos, Beto tem 1.
    await waitFor(() => expect(screen.getByText(/Ana/)).toBeTruthy());
    // O número combina "2 itens · 8h" (React quebra em nós, então casamos pelo textContent).
    expect(screen.getByText((_, el) => el?.className === "tdg-workload-num" && /2 itens/.test(el.textContent))).toBeTruthy();
  });

  it("usa a capacidade real dos perfis para medir a carga", async () => {
    vi.stubGlobal("fetch", montarFetch());
    // Ana: 2 itens × 4h = 8h; capacidade semanal 6h → sobrecarga.
    render(<WorkViews setToast={() => {}} profiles={[{ userId: "", name: "Ana", weeklyHours: 6 }]} />);
    await waitFor(() => expect(screen.getByText("20d")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /Workload/ }));
    await waitFor(() => expect(
      screen.getByText((_, el) => el?.className === "tdg-workload-num" && /8h \/ 6h ⚠/.test(el.textContent)),
    ).toBeTruthy());
  });

  it("troca para Calendário e agrupa por dia de vencimento", async () => {
    vi.stubGlobal("fetch", montarFetch());
    render(<WorkViews setToast={() => {}} />);
    await waitFor(() => expect(screen.getByText("20d")).toBeTruthy());

    fireEvent.click(screen.getByRole("tab", { name: /Calendário/ }));
    await waitFor(() => expect(screen.getByText("21/mar")).toBeTruthy());
  });
});
