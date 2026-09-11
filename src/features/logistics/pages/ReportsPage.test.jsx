/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReportsPage from "./ReportsPage.jsx";

afterEach(cleanup);

const dashboard = {
  receitaPrevista: 480000,
  margemOperacionalPercent: 22.4,
  co2Evitado: 8400,
  aprovacoesPendentes: 2,
};

const dados = { clients: [{ id: "c1" }, { id: "c2" }], opportunities: [{ id: "o1" }] };

const authHeaders = () => ({ authorization: "Bearer teste" });

const montarFetch = (mapa) => {
  const chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url) => {
      const texto = String(url);
      chamadas.push(texto);
      const chave = Object.keys(mapa).find((k) => texto.includes(k));
      const resposta = chave ? mapa[chave] : null;
      return Promise.resolve({
        ok: resposta?.ok !== false,
        json: () => Promise.resolve(resposta?.dados ?? { error: "não encontrado" }),
      });
    }),
  );
  return chamadas;
};

const carteira = {
  dados: {
    clientes: [
      { id: "cli-a", nome: "Distribuidora Norte", documento: "" },
      { id: "cli-b", nome: "Atacado Sul", documento: "" },
    ],
    carteiraCompleta: true,
  },
};

describe("relatórios do lado interno", () => {
  it("oferece os mesmos formatos que o cliente recebe, não um textarea", async () => {
    montarFetch({ "clientes-relatorio": carteira });
    render(<ReportsPage dashboard={dashboard} data={dados} authHeaders={authHeaders} />);

    await screen.findByRole("option", { name: "Distribuidora Norte" });
    for (const rotulo of ["PDF", "Planilha", "CSV", "Apresentação", "HTML"]) {
      expect(screen.getByRole("button", { name: new RegExp(rotulo) })).toBeInTheDocument();
    }
  });

  it("sem cliente escolhido, não deixa gerar", async () => {
    montarFetch({ "clientes-relatorio": carteira });
    render(<ReportsPage dashboard={dashboard} data={dados} authHeaders={authHeaders} />);
    await screen.findByRole("option", { name: "Distribuidora Norte" });

    // Número sem dono não se defende em auditoria.
    expect(screen.getByRole("button", { name: /PDF/ })).toBeDisabled();
    expect(screen.getByText(/Escolha o cliente/)).toBeInTheDocument();
  });

  it("com cliente escolhido, libera e pede o material daquele cliente e período", async () => {
    const chamadas = montarFetch({
      "clientes-relatorio": carteira,
      "esg/relatorio": {
        dados: {
          cliente: { nome: "Distribuidora Norte", documento: "" },
          periodo: { inicio: "2026-03-01", fim: "2026-03-31" },
          operacoes: [],
          calculos: [],
          greenScore: null,
          geradoPor: "gestor@todogreen.com.br",
        },
      },
    });
    render(<ReportsPage dashboard={dashboard} data={dados} authHeaders={authHeaders} />);
    await screen.findByRole("option", { name: "Distribuidora Norte" });

    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "cli-a" } });
    expect(screen.getByRole("button", { name: /PDF/ })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() => {
      const pedido = chamadas.find((c) => c.includes("esg/relatorio"));
      expect(pedido).toContain("cliente=cli-a");
      expect(pedido).toMatch(/inicio=\d{4}-\d{2}-\d{2}/);
      expect(pedido).toMatch(/fim=\d{4}-\d{2}-\d{2}/);
    });
  });

  it("período invertido é barrado antes de chamar o servidor", async () => {
    const chamadas = montarFetch({ "clientes-relatorio": carteira });
    render(<ReportsPage dashboard={dashboard} data={dados} authHeaders={authHeaders} />);
    await screen.findByRole("option", { name: "Distribuidora Norte" });

    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "cli-a" } });
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "2026-05-01" } });
    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "2026-04-01" } });

    expect(screen.getByText(/início do período está depois do fim/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /PDF/ })).toBeDisabled();
    expect(chamadas.some((c) => c.includes("esg/relatorio"))).toBe(false);
  });

  it("avisa o vendedor de que o alcance é a carteira dele", async () => {
    montarFetch({
      "clientes-relatorio": { dados: { ...carteira.dados, carteiraCompleta: false } },
    });
    render(<ReportsPage dashboard={dashboard} data={dados} authHeaders={authHeaders} />);
    expect(await screen.findByText(/clientes da sua carteira/)).toBeInTheDocument();
  });

  it("sem cliente cadastrado, explica em vez de mostrar botão morto", async () => {
    montarFetch({ "clientes-relatorio": { dados: { clientes: [], carteiraCompleta: true } } });
    render(<ReportsPage dashboard={dashboard} data={dados} authHeaders={authHeaders} />);
    expect(await screen.findByText(/Nenhum cliente disponível/)).toBeInTheDocument();
  });

  it("erro do servidor aparece na tela", async () => {
    montarFetch({
      "clientes-relatorio": { ok: false, dados: { error: "Sem permissão para gerar relatórios." } },
    });
    render(<ReportsPage dashboard={dashboard} data={dados} authHeaders={authHeaders} />);
    expect(await screen.findByText("Sem permissão para gerar relatórios.")).toBeInTheDocument();
  });

  it("a posição consolidada não se apresenta como o relatório auditável", async () => {
    montarFetch({ "clientes-relatorio": carteira });
    render(<ReportsPage dashboard={dashboard} data={dados} authHeaders={authHeaders} />);
    await screen.findByRole("option", { name: "Distribuidora Norte" });

    expect(screen.getByText(/R\$\s?480\.000/)).toBeInTheDocument();
    expect(screen.getByText(/22,4%/)).toBeInTheDocument();
    // A leitura rápida não pode ser confundida com o documento que tem memória
    // de cálculo.
    expect(screen.getByText(/Não substitui o relatório por cliente/)).toBeInTheDocument();
  });
});

// O mock por URL não enxerga o corpo do POST; este registra método e corpo para
// provar que o fechamento vai com o cliente e o mês certos. A ordem das chaves
// importa: a URL da listagem (`fechamentos?cliente`) também contém a do POST
// (`esg/fechamento`), então a chave mais específica precisa vir primeiro.
const montarFetchComCorpo = (mapa) => {
  const chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url, opts) => {
      const texto = String(url);
      const corpo = opts?.body ? JSON.parse(opts.body) : null;
      chamadas.push({ url: texto, method: opts?.method || "GET", corpo });
      const chave = Object.keys(mapa).find((k) => texto.includes(k));
      const resposta = chave ? mapa[chave] : null;
      return Promise.resolve({
        ok: resposta?.ok !== false,
        json: () => Promise.resolve(resposta?.dados ?? { error: "não encontrado" }),
      });
    }),
  );
  return chamadas;
};

const fechamentoComIntensidade = {
  dados: {
    cliente: { nome: "Distribuidora Norte" },
    fechamentos: [
      {
        mes: "2026-08",
        versaoFatores: "2026.2",
        qualidade: 82,
        status: "fechado",
        revisao: 1,
        resumo: {
          co2EmitidoKg: 120.5,
          co2EvitadoKg: 340,
          toneladasKm: 250,
          intensidadeGCo2ePorTkm: 482,
        },
        atividade: { intensidadeDisponivel: true },
      },
    ],
  },
};

describe("fechamento mensal (GLEC) na tela", () => {
  it("sem cliente, a listagem não é pedida e o convite aparece", async () => {
    const chamadas = montarFetchComCorpo({ "clientes-relatorio": carteira });
    render(<ReportsPage dashboard={dashboard} data={dados} authHeaders={authHeaders} />);
    await screen.findByRole("option", { name: "Distribuidora Norte" });

    expect(
      screen.getByRole("heading", { name: /Fechamento mensal \(GLEC/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Selecione o cliente acima para fechar/)).toBeInTheDocument();
    expect(chamadas.some((c) => c.url.includes("esg/fechamentos"))).toBe(false);
    expect(screen.getByRole("button", { name: /Fechar mês/ })).toBeDisabled();
  });

  it("com cliente, lista os meses fechados com a intensidade GLEC", async () => {
    montarFetchComCorpo({
      // mais específica primeiro
      "esg/fechamentos": fechamentoComIntensidade,
      "clientes-relatorio": carteira,
    });
    render(<ReportsPage dashboard={dashboard} data={dados} authHeaders={authHeaders} />);
    await screen.findByRole("option", { name: "Distribuidora Norte" });

    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "cli-a" } });

    expect(await screen.findByText("2026-08")).toBeInTheDocument();
    expect(screen.getByText(/482\s?g\/t·km/)).toBeInTheDocument();
    expect(screen.getByText(/250\s?t·km/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fechar mês/ })).toBeEnabled();
  });

  it("sem peso da carga, a intensidade fica indisponível e avisa — não finge zero", async () => {
    montarFetchComCorpo({
      "esg/fechamentos": {
        dados: {
          cliente: { nome: "Distribuidora Norte" },
          fechamentos: [
            {
              mes: "2026-07",
              versaoFatores: "2026.2",
              qualidade: 40,
              status: "fechado",
              revisao: 1,
              resumo: {
                co2EmitidoKg: 90,
                co2EvitadoKg: 200,
                toneladasKm: 0,
                intensidadeGCo2ePorTkm: null,
              },
              atividade: {
                intensidadeDisponivel: false,
                aviso: "Sem peso de carga nas operações do período: a intensidade GLEC fica indisponível.",
              },
            },
          ],
        },
      },
      "clientes-relatorio": carteira,
    });
    render(<ReportsPage dashboard={dashboard} data={dados} authHeaders={authHeaders} />);
    await screen.findByRole("option", { name: "Distribuidora Norte" });

    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "cli-a" } });

    await screen.findByText("2026-07");
    expect(screen.getByText("indisponível")).toBeInTheDocument();
    expect(screen.getByText(/Sem peso de carga/)).toBeInTheDocument();
  });

  it("fechar o mês manda o cliente e o mês escolhidos ao servidor", async () => {
    const chamadas = montarFetchComCorpo({
      "esg/fechamentos": { dados: { cliente: { nome: "Distribuidora Norte" }, fechamentos: [] } },
      "clientes-relatorio": carteira,
    });
    render(<ReportsPage dashboard={dashboard} data={dados} authHeaders={authHeaders} />);
    await screen.findByRole("option", { name: "Distribuidora Norte" });

    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "cli-a" } });
    fireEvent.change(screen.getByLabelText("Mês"), { target: { value: "2026-06" } });
    fireEvent.click(screen.getByRole("button", { name: /Fechar mês/ }));

    await waitFor(() => {
      const post = chamadas.find(
        (c) => c.method === "POST" && c.url.endsWith("esg/fechamento"),
      );
      expect(post).toBeTruthy();
      expect(post.corpo).toEqual({ clienteId: "cli-a", mes: "2026-06" });
    });
  });
});
