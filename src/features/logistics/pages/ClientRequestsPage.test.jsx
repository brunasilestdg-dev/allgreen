/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClientRequestsPage from "./ClientRequestsPage.jsx";

afterEach(cleanup);

const HORA = 3600000;

const pedido = (extra = {}) => ({
  id: "req-1",
  clienteId: "cli-a",
  clienteNome: "Distribuidora Norte",
  tipo: "nova_rota",
  assunto: "Incluir trecho Campinas → Ribeirão",
  descricao: "Precisamos atender a nova filial a partir de abril.",
  urgencia: "normal",
  status: "aberta",
  campos: { origem: "Campinas", destino: "Ribeirão Preto" },
  responsavel: "",
  prazo: { estado: "no-prazo", horasRestantes: 30, emAtraso: false },
  criadaEm: "2026-03-01T10:00:00.000Z",
  ...extra,
});

const caixa = (extra = {}) => ({
  solicitacoes: [pedido()],
  fila: ["req-1"],
  indicadores: { naFila: 1, atrasadas: 0, encerradas: 0, pontualidadePercent: null, semDataDeEncerramento: 0 },
  mensagens: [],
  carteiraCompleta: true,
  ...extra,
});

const montarFetch = (respostas) => {
  const chamadas = [];
  const fetch = vi.fn((url, options = {}) => {
    chamadas.push({ url: String(url), method: options.method || "GET", body: options.body });
    const proxima = respostas.shift();
    return Promise.resolve({
      ok: proxima?.ok !== false,
      json: () => Promise.resolve(proxima?.dados ?? caixa()),
    });
  });
  vi.stubGlobal("fetch", fetch);
  return chamadas;
};

const authHeaders = () => ({ authorization: "Bearer teste" });

describe("fila interna de solicitações", () => {
  it("mostra a fila com prazo em palavras, não em número solto", async () => {
    montarFetch([{ dados: caixa() }]);
    render(<ClientRequestsPage authHeaders={authHeaders} />);
    expect(await screen.findByText(/Incluir trecho Campinas/)).toBeInTheDocument();
    // "30" sozinho não diz nada a quem tem dez pedidos na fila.
    expect(screen.getByText(/vence em 1d/)).toBeInTheDocument();
    expect(screen.getByText(/sem responsável/)).toBeInTheDocument();
  });

  it("marca em vermelho o que já estourou", async () => {
    montarFetch([
      {
        dados: caixa({
          solicitacoes: [
            pedido({ prazo: { estado: "atrasada", horasRestantes: -6, emAtraso: true } }),
          ],
          indicadores: { naFila: 1, atrasadas: 1, encerradas: 0, pontualidadePercent: null, semDataDeEncerramento: 0 },
        }),
      },
    ]);
    render(<ClientRequestsPage authHeaders={authHeaders} />);
    expect(await screen.findByText(/atrasada há 6h/)).toBeInTheDocument();
  });

  it("pontualidade sem histórico aparece como travessão, não como 100%", async () => {
    montarFetch([{ dados: caixa() }]);
    render(<ClientRequestsPage authHeaders={authHeaders} />);
    await screen.findByText(/Incluir trecho Campinas/);
    const cartao = screen.getByText("Pontualidade").closest("article");
    expect(cartao).toHaveTextContent("—");
    expect(cartao).toHaveTextContent(/sem pedido encerrado para medir/);
  });

  it("avisa o vendedor de que a lista é só da carteira dele", async () => {
    montarFetch([{ dados: caixa({ carteiraCompleta: false }) }]);
    render(<ClientRequestsPage authHeaders={authHeaders} />);
    expect(await screen.findByText(/apenas os clientes da sua carteira/)).toBeInTheDocument();
  });

  it("o filtro padrão esconde o que já foi encerrado", async () => {
    montarFetch([
      {
        dados: caixa({
          solicitacoes: [
            pedido(),
            pedido({ id: "req-2", assunto: "Pedido antigo", status: "concluida" }),
          ],
        }),
      },
    ]);
    render(<ClientRequestsPage authHeaders={authHeaders} />);
    await screen.findByText(/Incluir trecho Campinas/);
    expect(screen.queryByText("Pedido antigo")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    expect(screen.getByText("Pedido antigo")).toBeInTheDocument();
  });

  it("caixa vazia diz o que está vazio, sem tela em branco", async () => {
    montarFetch([{ dados: caixa({ solicitacoes: [], fila: [] }) }]);
    render(<ClientRequestsPage authHeaders={authHeaders} />);
    expect(await screen.findByText(/Nenhuma solicitação esperando a equipe/)).toBeInTheDocument();
  });
});

describe("responder", () => {
  it("abre a conversa e distingue nota interna da resposta ao cliente", async () => {
    montarFetch([
      { dados: caixa() },
      {
        dados: caixa({
          mensagens: [
            { id: "m1", lado: "cliente", autor: "Cliente", texto: "pedido original", interna: false, criadaEm: "2026-03-01T10:00:00.000Z" },
            { id: "m2", lado: "equipe", autor: "Time", texto: "margem apertada", interna: true, criadaEm: "2026-03-01T11:00:00.000Z" },
          ],
        }),
      },
    ]);
    render(<ClientRequestsPage authHeaders={authHeaders} />);
    fireEvent.click(await screen.findByRole("button", { name: /Incluir trecho Campinas/ }));

    expect(await screen.findByText("pedido original")).toBeInTheDocument();
    // A nota interna aparece para a equipe, marcada como tal.
    expect(screen.getByText("margem apertada")).toBeInTheDocument();
    expect(screen.getByText(/nota interna/)).toBeInTheDocument();
  });

  it("o marcador de nota interna troca o texto do botão e vai no corpo", async () => {
    const chamadas = montarFetch([
      { dados: caixa() },
      { dados: caixa() },
      { dados: { ok: true } },
      { dados: caixa() },
    ]);
    render(<ClientRequestsPage authHeaders={authHeaders} />);
    fireEvent.click(await screen.findByRole("button", { name: /Incluir trecho Campinas/ }));
    await screen.findByLabelText("Mensagem");

    expect(screen.getByRole("button", { name: /Responder ao cliente/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Nota interna/));
    expect(screen.getByRole("button", { name: /Registrar nota/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "checar com o comercial" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar nota/ }));

    await waitFor(() => {
      const envio = chamadas.find((c) => c.method === "POST");
      expect(envio).toBeTruthy();
      expect(JSON.parse(envio.body)).toMatchObject({ id: "req-1", interna: true });
    });
  });

  it("transforma a solicitação em tarefa vinculada ao cliente", async () => {
    montarFetch([{ dados: caixa() }, { dados: caixa() }]);
    const onCreateTask = vi.fn().mockResolvedValue(undefined);
    render(<ClientRequestsPage authHeaders={authHeaders} onCreateTask={onCreateTask} currentUserId="user-9" />);
    fireEvent.click(await screen.findByRole("button", { name: /Incluir trecho Campinas/ }));
    await screen.findByLabelText("Mensagem");

    fireEvent.click(screen.getByRole("button", { name: /Transformar em tarefa/ }));

    await waitFor(() => expect(onCreateTask).toHaveBeenCalledTimes(1));
    const tarefa = onCreateTask.mock.calls[0][0];
    expect(tarefa).toMatchObject({
      clientId: "cli-a",
      clientName: "Distribuidora Norte",
      source: "todogreen-solicitacao",
      requestId: "req-1",
    });
    expect(tarefa.title).toContain("Incluir trecho Campinas");
    // Depois de criada, o botão trava para não duplicar.
    expect(await screen.findByRole("button", { name: /Tarefa criada/ })).toBeDisabled();
  });

  it("pedido encerrado não oferece caixa de resposta", async () => {
    montarFetch([
      { dados: caixa({ solicitacoes: [pedido({ status: "concluida" })] }) },
      { dados: caixa({ solicitacoes: [pedido({ status: "concluida" })] }) },
    ]);
    render(<ClientRequestsPage authHeaders={authHeaders} />);
    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    fireEvent.click(await screen.findByRole("button", { name: /Incluir trecho Campinas/ }));
    await screen.findByText(/Precisamos atender a nova filial/);
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();
  });

  it("erro do servidor vira aviso na tela, não silêncio", async () => {
    montarFetch([{ ok: false, dados: { error: "Solicitação não encontrada." } }]);
    render(<ClientRequestsPage authHeaders={authHeaders} />);
    expect(await screen.findByText("Solicitação não encontrada.")).toBeInTheDocument();
  });
});

describe("registrar em nome do cliente", () => {
  it("abre o formulário com os campos que o TIPO exige, iguais aos do portal", () => {
    render(
      <ClientRequestsPage
        authHeaders={() => ({})}
        clientes={[{ id: "cli-1", name: "Distribuidora Norte" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Registrar solicitação/ }));
    expect(screen.getByRole("heading", { name: "Registrar solicitação em nome do cliente" })).toBeInTheDocument();
    // Trocar o tipo troca os campos obrigatórios — o pedido falado não entra
    // mais raso do que o digitado no portal.
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "coleta_extra" } });
    expect(screen.getByLabelText("Local da coleta")).toBeInTheDocument();
    expect(screen.getByLabelText("Data desejada")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "nova_rota" } });
    expect(screen.getByLabelText("Origem")).toBeInTheDocument();
    expect(screen.queryByLabelText("Local da coleta")).not.toBeInTheDocument();
  });

  it("manda cliente, canal e campos do tipo no POST", async () => {
    const chamadas = [];
    global.fetch = vi.fn(async (url, opts = {}) => {
      chamadas.push({ url, opts });
      if ((opts.method || "GET") === "POST") return { ok: true, json: async () => ({ ok: true, id: "req-nova" }) };
      return { ok: true, json: async () => ({ solicitacoes: [], indicadores: null, mensagens: [] }) };
    });
    render(
      <ClientRequestsPage
        authHeaders={() => ({})}
        clientes={[{ id: "cli-1", name: "Distribuidora Norte" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Registrar solicitação/ }));
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "cli-1" } });
    fireEvent.change(screen.getByLabelText("Como chegou"), { target: { value: "whatsapp" } });
    fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "Coleta pedida no grupo" } });
    fireEvent.change(screen.getByLabelText("O que o cliente pediu"), {
      target: { value: "Pediu retirada extra amanhã no CD, como escreveu no WhatsApp." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Registrar na fila/ }));
    await waitFor(() => {
      const post = chamadas.find((c) => c.opts.method === "POST");
      expect(post).toBeTruthy();
      const corpo = JSON.parse(post.opts.body);
      expect(corpo.clienteId).toBe("cli-1");
      expect(corpo.canal).toBe("whatsapp");
      expect(corpo.assunto).toBe("Coleta pedida no grupo");
    });
  });
});
