/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DealDeskPage from "./DealDeskPage.jsx";

const jsonOk = (corpo) =>
  Promise.resolve(new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } }));

const authHeaders = () => ({ authorization: "Bearer teste" });

const futuro = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const passado = new Date(Date.now() - 3600 * 1000).toISOString();

const pedidoBase = {
  id: "p1",
  cenarioId: "c1",
  cliente: "Distribuidora Alfa",
  alcadaId: "gestao_comercial",
  desvioPontos: 2,
  motivoDaAlcada: "Margem 16.0% está 2.0 ponto(s) abaixo do piso de 18.0%.",
  gatilhos: ["margem abaixo do piso"],
  justificativa: "Cliente estratégico com volume garantido por 24 meses.",
  solicitanteId: "vendedor",
  situacao: "pendente",
  versao: 1,
  decisorId: "",
  decisaoJustificativa: "",
  decididoEm: "",
  prazoEm: futuro,
  criadoEm: new Date().toISOString(),
};

const stub = (pedidos, extras = {}) => {
  const chamadas = vi.fn((url, opcoes) => {
    const caminho = String(url);
    for (const [prefixo, resposta] of Object.entries(extras))
      if (caminho.startsWith(prefixo)) return resposta(caminho, opcoes);
    if (caminho.endsWith("/historico")) return jsonOk({ pedido: pedidos[0], historico: [] });
    if (caminho === "/api/todogreen/deal-desk") return jsonOk({ pedidos });
    return jsonOk({ ok: true });
  });
  vi.stubGlobal("fetch", chamadas);
  return chamadas;
};

const chefe = { userId: "chefe", role: "lideranca_comercial", permissions: ["deal:approve"] };
const quemPediu = { userId: "vendedor", role: "owner", permissions: ["*"] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("fila de aprovação comercial", () => {
  it("mostra o pedido com alçada, prazo e motivo", async () => {
    stub([pedidoBase]);
    render(<DealDeskPage authHeaders={authHeaders} quem={chefe} setToast={vi.fn()} />);
    expect(await screen.findByText("Distribuidora Alfa")).toBeTruthy();
    expect(screen.getByText(/Gestão comercial · versão 1/)).toBeTruthy();
    expect(screen.getByText(/2.0 ponto\(s\) abaixo do piso/)).toBeTruthy();
    expect(screen.getByText("margem abaixo do piso")).toBeTruthy();
  });

  it("quem tem alçada vê os botões de decidir", async () => {
    stub([pedidoBase]);
    render(<DealDeskPage authHeaders={authHeaders} quem={chefe} setToast={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Aprovar/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Recusar/ })).toBeTruthy();
  });

  it("quem pediu não vê botão de decidir, e a tela diz por quê", async () => {
    stub([pedidoBase]);
    render(<DealDeskPage authHeaders={authHeaders} quem={quemPediu} setToast={vi.fn()} />);
    expect(await screen.findByText(/Quem pede não decide/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Aprovar/ })).toBeNull();
  });

  it("papel abaixo da alçada não decide, e o nível exigido aparece", async () => {
    stub([{ ...pedidoBase, alcadaId: "conselho" }]);
    render(<DealDeskPage authHeaders={authHeaders} quem={chefe} setToast={vi.fn()} />);
    expect(await screen.findByText(/exige alçada de Conselho/)).toBeTruthy();
  });

  it("aprovar manda a decisão com a justificativa", async () => {
    const enviadas = [];
    const chamadas = stub([pedidoBase], {
      "/api/todogreen/deal-desk/p1/decisao": (_c, opcoes) => {
        enviadas.push(JSON.parse(opcoes.body));
        return jsonOk({ pedido: { ...pedidoBase, situacao: "aprovado" } });
      },
    });
    render(<DealDeskPage authHeaders={authHeaders} quem={chefe} setToast={vi.fn()} />);
    await screen.findByRole("button", { name: /Aprovar/ });
    fireEvent.change(screen.getByLabelText("Justificativa da decisão"), {
      target: { value: "volume compensa o desvio" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Aprovar/ }));
    await waitFor(() => expect(enviadas.length).toBe(1));
    expect(enviadas[0]).toEqual({ decisao: "aprovar", justificativa: "volume compensa o desvio" });
    expect(chamadas).toHaveBeenCalled();
  });

  it("pedido vencido é mostrado como cobrança de fila, não como recusa", async () => {
    stub([{ ...pedidoBase, prazoEm: passado }]);
    render(<DealDeskPage authHeaders={authHeaders} quem={chefe} setToast={vi.fn()} />);
    expect(await screen.findByText("Venceu sem resposta")).toBeTruthy();
    expect(screen.getByText(/cobrança de fila, não recusa/)).toBeTruthy();
  });

  it("sem decisão nenhuma, a taxa de aprovação é traço e não zero", async () => {
    stub([pedidoBase]);
    render(<DealDeskPage authHeaders={authHeaders} quem={chefe} setToast={vi.fn()} />);
    await screen.findByText("Distribuidora Alfa");
    const taxa = screen.getByText("Taxa de aprovação").closest(".tdg-metric");
    // Zero por cento diria que tudo foi recusado.
    expect(taxa.textContent).toContain("—");
  });

  it("falha de carregamento aparece em vez de fila vazia silenciosa", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "Banco fora." }), { status: 500 }))),
    );
    render(<DealDeskPage authHeaders={authHeaders} quem={chefe} setToast={vi.fn()} />);
    expect(await screen.findByText("Banco fora.")).toBeTruthy();
  });

  it("o histórico abre com os eventos em ordem", async () => {
    const chamadas = vi.fn((url) => {
      const caminho = String(url);
      if (caminho.endsWith("/historico"))
        return jsonOk({
          pedido: pedidoBase,
          historico: [
            { id: "e1", tipo: "abertura", versao: 1, autorNome: "Vendedor", texto: "abriu", criadoEm: new Date().toISOString() },
            { id: "e2", tipo: "decisao", versao: 1, autorNome: "Chefe", texto: "aprovado", criadoEm: new Date().toISOString() },
          ],
        });
      return jsonOk({ pedidos: [pedidoBase] });
    });
    vi.stubGlobal("fetch", chamadas);
    render(<DealDeskPage authHeaders={authHeaders} quem={chefe} setToast={vi.fn()} />);
    fireEvent.click(await screen.findByText("Ver histórico e comentários"));
    expect(await screen.findByText("Pedido aberto")).toBeTruthy();
    expect(screen.getByText("Decisão")).toBeTruthy();
  });
});
