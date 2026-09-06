/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomerPortal from "./CustomerPortal.jsx";

// A tela do portal nunca decide o que mostrar: ela pergunta ao servidor de quem
// é a sessão e desenha o que voltou. Estes testes garantem que ela não inventa
// nada por conta própria — nem cliente, nem número, nem item de menu.

const resposta = (dados, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(dados) });

const sessaoPadrao = {
  cliente: { id: "cli-a", nome: "Cliente A" },
  papel: "cliente_gestor",
  permissoes: ["portal:read", "portal:report:export"],
  menu: [
    { id: "inicio", label: "Início" },
    { id: "operacoes", label: "Operações" },
    { id: "relatorios", label: "Relatórios" },
  ],
  usuario: { nome: "Pessoa A", email: "pessoa@clientea.com.br" },
};

const resumoComDados = {
  resumo: {
    operacoes: { total: 3, entregas: 300, distanciaKm: 900, ocupacaoMedia: 80 },
    ambiental: { co2EvitadoKg: 4200, dieselEvitadoL: 1600, reducaoPercent: 22, qualidadeDados: 85, calculos: 2 },
    greenScore: { valor: 78.5, versaoPesos: "v1", calculadoEm: "2026-08-01" },
    semDados: false,
  },
};

const montarFetch = (mapa) =>
  vi.fn((url) => {
    const chave = String(url).split("/portal/")[1]?.split("?")[0];
    if (chave in mapa) return resposta(mapa[chave], mapa[chave] !== null);
    return resposta({ error: "não encontrado" }, false);
  });

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => "token-de-teste",
    setItem: () => {},
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Sala do Cliente", () => {
  it("mostra o cliente que o servidor devolveu", async () => {
    vi.stubGlobal("fetch", montarFetch({ sessao: sessaoPadrao, resumo: resumoComDados }));
    render(<CustomerPortal />);
    expect(await screen.findByText("Cliente A")).toBeTruthy();
    expect(screen.getByText(/Pessoa A/)).toBeTruthy();
  });

  it("desenha só os itens de menu que vieram do servidor", async () => {
    vi.stubGlobal("fetch", montarFetch({ sessao: sessaoPadrao, resumo: resumoComDados }));
    render(<CustomerPortal />);
    await screen.findByText("Cliente A");
    expect(screen.getByRole("button", { name: /Operações/ })).toBeTruthy();
    // Nada interno aparece, porque o servidor não mandou.
    expect(screen.queryByRole("button", { name: /Precificação/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Comissões/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Oportunidades/ })).toBeNull();
  });

  it("recupera de uma empresa antiga presa no navegador em vez de travar o portal", async () => {
    // O navegador tem uma empresa guardada que a sessão não enxerga mais.
    const store = {
      "seu-funcionario-auth-token": "token-de-teste",
      "tdg-portal-empresa": "cli-fantasma",
    };
    vi.stubGlobal("localStorage", {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    });
    // Com a empresa presa (empresa=), o servidor nega; sem ela (padrão), responde.
    vi.stubGlobal("fetch", vi.fn((url) => {
      const s = String(url);
      if (s.includes("empresa=")) return resposta({ error: "Sem acesso a esta empresa." }, false);
      const chave = s.split("/portal/")[1]?.split("?")[0];
      if (chave === "sessao") return resposta(sessaoPadrao);
      if (chave === "resumo") return resposta(resumoComDados);
      return resposta({ titulos: [], totais: {} });
    }));

    render(<CustomerPortal />);

    // Não trava: limpa a empresa presa, refaz com a padrão e mostra o cliente.
    expect(await screen.findByText("Cliente A")).toBeTruthy();
    expect(store["tdg-portal-empresa"]).toBeUndefined();
    expect(screen.queryByText("Portal indisponível")).toBeNull();
  });

  it("sem dado, convida a esperar o registro em vez de inventar número", async () => {
    vi.stubGlobal(
      "fetch",
      montarFetch({
        sessao: sessaoPadrao,
        resumo: {
          resumo: {
            operacoes: { total: 0, entregas: 0, distanciaKm: 0, ocupacaoMedia: 0 },
            ambiental: { co2EvitadoKg: 0, dieselEvitadoL: 0, reducaoPercent: 0, qualidadeDados: 0, calculos: 0 },
            greenScore: null,
            semDados: true,
          },
        },
      }),
    );
    const { container } = render(<CustomerPortal />);
    expect(await screen.findByText(/Ainda não há operação registrada/)).toBeTruthy();
    // Nenhum indicador é desenhado: sem registro, não há número para mostrar.
    // (O rodapé cita Green Score no aviso legal, por isso a checagem é pelo
    // bloco de indicadores, não pelo texto.)
    expect(container.querySelectorAll(".cp-indicador")).toHaveLength(0);
  });

  it("avisa quando a qualidade dos dados é baixa demais para relatório regulatório", async () => {
    vi.stubGlobal(
      "fetch",
      montarFetch({
        sessao: sessaoPadrao,
        resumo: {
          resumo: {
            ...resumoComDados.resumo,
            ambiental: { ...resumoComDados.resumo.ambiental, qualidadeDados: 40 },
          },
        },
      }),
    );
    render(<CustomerPortal />);
    expect(await screen.findByText(/qualidade dos dados/i)).toBeTruthy();
  });

  it("deixa claro que Green Score não é certificação", async () => {
    vi.stubGlobal("fetch", montarFetch({ sessao: sessaoPadrao, resumo: resumoComDados }));
    render(<CustomerPortal />);
    await screen.findByText("Cliente A");
    expect(screen.getByText(/não constituem certificação/i)).toBeTruthy();
  });

  it("conta sem vínculo vê o motivo, não uma tela quebrada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          json: () =>
            Promise.resolve({
              error: "Esta conta não está vinculada a nenhum cliente da To Do Green.",
            }),
        }),
      ),
    );
    render(<CustomerPortal />);
    await waitFor(() =>
      expect(screen.getByText(/não está vinculada a nenhum cliente/i)).toBeTruthy(),
    );
  });
});

describe("erro de ação não derruba o portal", () => {
  it("falha ao listar documentos vira aviso, não tela de bloqueio", async () => {
    let chamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        chamadas += 1;
        const chave = String(url).split("/portal/")[1]?.split("?")[0];
        if (chave === "sessao")
          return resposta({
            ...sessaoPadrao,
            menu: [...sessaoPadrao.menu, { id: "documentos", label: "Documentos" }],
          });
        if (chave === "resumo") return resposta(resumoComDados);
        return resposta({ error: "Cofre indisponível." }, false);
      }),
    );
    render(<CustomerPortal />);
    await screen.findByText("Cliente A");

    screen.getByRole("button", { name: /Documentos/ }).click();

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    // O portal continua de pé: cabeçalho e menu seguem visíveis.
    expect(screen.getByText("Cliente A")).toBeTruthy();
    expect(screen.queryByText(/Portal indisponível/)).toBeNull();
    expect(chamadas).toBeGreaterThan(2);
  });
});

describe("Solicitações do cliente", () => {
  const sessaoComSolicitacoes = {
    ...sessaoPadrao,
    permissoes: ["portal:read", "portal:request:create"],
    menu: [...sessaoPadrao.menu, { id: "solicitacoes", label: "Solicitações" }],
  };

  const tipos = [
    {
      id: "nova_rota",
      rotulo: "Nova rota",
      descricao: "Incluir um trecho que ainda não faz parte do contrato.",
      prazoHoras: 48,
      obrigatorios: ["origem", "destino"],
      camposRotulo: { origem: "Origem", destino: "Destino" },
    },
    {
      id: "ocorrencia",
      rotulo: "Ocorrência na entrega",
      descricao: "Avaria, atraso, extravio ou divergência.",
      prazoHoras: 4,
      obrigatorios: ["referencia"],
      camposRotulo: { referencia: "Referência da entrega" },
    },
  ];

  const caixaVazia = { solicitacoes: [], mensagens: [], tipos, resumo: { abertas: 0, aguardandoVoce: 0, atrasadas: 0, encerradas: 0, texto: "Nenhuma solicitação em aberto." } };

  const irParaSolicitacoes = async () => {
    render(<CustomerPortal />);
    await screen.findByText("Cliente A");
    fireEvent.click(screen.getByRole("button", { name: /Solicitações/ }));
  };

  it("a aba não diz mais 'em breve': mostra a caixa do cliente", async () => {
    vi.stubGlobal("fetch", montarFetch({ sessao: sessaoComSolicitacoes, resumo: resumoComDados, solicitacoes: caixaVazia }));
    await irParaSolicitacoes();
    expect(await screen.findByText(/Nenhuma solicitação ainda/)).toBeTruthy();
    // A promessa que a IA do portal já fazia agora tem porta.
    expect(screen.queryByText(/está sendo liberada/)).toBeNull();
  });

  it("os campos obrigatórios vêm do tipo escolhido, não da tela", async () => {
    vi.stubGlobal("fetch", montarFetch({ sessao: sessaoComSolicitacoes, resumo: resumoComDados, solicitacoes: caixaVazia }));
    await irParaSolicitacoes();
    fireEvent.click(await screen.findByRole("button", { name: "Nova solicitação" }));

    expect(screen.getByText("Origem")).toBeTruthy();
    expect(screen.getByText("Destino")).toBeTruthy();
    expect(screen.getByText(/Resposta em até 48h/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Tipo de pedido/), { target: { value: "ocorrencia" } });
    expect(screen.getByText("Referência da entrega")).toBeTruthy();
    expect(screen.queryByText("Origem")).toBeNull();
    expect(screen.getByText(/Resposta em até 4h/)).toBeTruthy();
  });

  it("quem só lê não vê o botão de abrir solicitação", async () => {
    vi.stubGlobal("fetch", montarFetch({
      sessao: { ...sessaoComSolicitacoes, permissoes: ["portal:read"] },
      resumo: resumoComDados,
      solicitacoes: caixaVazia,
    }));
    await irParaSolicitacoes();
    expect(await screen.findByText(/Seu acesso é de leitura/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nova solicitação" })).toBeNull();
  });

  it("mostra o estado em português e de quem é a vez", async () => {
    vi.stubGlobal("fetch", montarFetch({
      sessao: sessaoComSolicitacoes,
      resumo: resumoComDados,
      solicitacoes: {
        tipos,
        mensagens: [],
        resumo: { abertas: 1, aguardandoVoce: 1, atrasadas: 0, encerradas: 0, texto: "1 solicitação(ões) esperando uma resposta sua." },
        solicitacoes: [{
          id: "req-1",
          tipo: "nova_rota",
          assunto: "Incluir trecho Campinas → Ribeirão",
          status: "aguardando_cliente",
          campos: { origem: "Campinas" },
          criadaEm: "2026-03-01T10:00:00.000Z",
        }],
      },
    }));
    await irParaSolicitacoes();
    expect(await screen.findByText("Aguardando você")).toBeTruthy();
    expect(screen.getByText(/esperando uma resposta sua/)).toBeTruthy();
    // O cliente lê "Nova rota", não "nova_rota".
    expect(screen.getByText(/Nova rota ·/)).toBeTruthy();
  });

  it("um erro ao carregar a caixa não derruba o portal inteiro", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => {
      const chave = String(url).split("/portal/")[1]?.split("?")[0];
      if (chave === "sessao") return resposta(sessaoComSolicitacoes);
      if (chave === "resumo") return resposta(resumoComDados);
      return resposta({ error: "Caixa indisponível." }, false);
    }));
    await irParaSolicitacoes();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("Cliente A")).toBeTruthy();
    expect(screen.queryByText(/Portal indisponível/)).toBeNull();
  });
});
