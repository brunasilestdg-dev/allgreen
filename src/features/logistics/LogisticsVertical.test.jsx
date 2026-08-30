/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LogisticsVertical from "./LogisticsVertical.jsx";

const baseDb = {
  user: { id: "u1", name: "Bruna", email: "bruna@example.com" },
  businesses: [],
  tasks: [],
  notifications: [],
  documents: [],
  syncedBlocks: [],
  databases: [],
  publicForms: [],
  projects: [],
};

const jsonOk = (corpo) =>
  Promise.resolve(new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));

// A vertical só abre quando o servidor confirma. Todo teste que precisa da
// tela aberta passa por aqui — é a mesma resposta que o worker devolve.
const respostaDeAcesso = {
  tenant: { slug: "todogreen" },
  role: "admin",
  permissions: ["*"],
  ownerId: "u1",
  source: "vinculo",
};

// A vertical inteira vazia. É o que o servidor devolve num espaço novo.
const REGISTROS = {
  opportunities: [],
  proposals: [],
  operations: [],
  financial: [],
  scenarios: [],
};

// Stub de fetch com um roteador: acesso e registros são sempre atendidos, e
// cada teste acrescenta o que mais precisar. As rotas mais específicas vêm
// primeiro porque a comparação é por prefixo.
const stubDeRede = (rotas = {}) => {
  const chamadas = vi.fn((url, opcoes) => {
    const caminho = String(url);
    if (caminho.startsWith("/api/todogreen/access?")) return jsonOk(respostaDeAcesso);
    for (const [prefixo, resposta] of Object.entries(rotas))
      if (caminho.startsWith(prefixo)) return resposta(caminho, opcoes);
    if (caminho === "/api/todogreen/records") return jsonOk(REGISTROS);
    return jsonOk({});
  });
  vi.stubGlobal("fetch", chamadas);
  return chamadas;
};

const authHeaders = () => ({ authorization: "Bearer teste" });

// Preenche todas as premissas obrigatórias do Middle Mile, mais os dois campos
// que decidem o quanto o resultado vale.
const preencherMiddleMile = () => {
  const digitar = (rotulo, valor) =>
    fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
  digitar(/^Cliente/, "Distribuidora Alfa");
  digitar(/^Origem/, "CD Guarulhos");
  digitar(/^Destino/, "Hub Campinas");
  digitar(/^Distância km/, "120");
  digitar(/^Viagens\/mês/, "40");
  digitar(/^Tipo de veículo/, "VUC elétrico");
  digitar(/^Ocupação/, "78");
  digitar(/^Quanto podemos confiar/, "80");
};

// Renderiza já autorizada e espera a confirmação chegar. Sem a espera, a
// asserção cai no cartão de "Confirmando permissão".
async function renderarAutorizada(props = {}) {
  const resultado = render(
    <LogisticsVertical db={baseDb} update={vi.fn()} setToast={vi.fn()} authHeaders={authHeaders} {...props} />,
  );
  await waitFor(() => expect(screen.queryByText(/Confirmando permissão/)).toBeNull());
  return resultado;
}

describe("LogisticsVertical", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/todogreen");
    stubDeRede();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  // ===== Quem entra =====
  //
  // Os quatro testes abaixo cobrem os quatro caminhos pelos quais a regra
  // antiga liberava a tela sem o servidor ter dito nada.

  it("não abre enquanto o servidor não confirmou o acesso", () => {
    render(<LogisticsVertical db={baseDb} update={vi.fn()} authHeaders={authHeaders} />);
    expect(screen.getByText(/Confirmando permissão/)).toBeTruthy();
    expect(screen.queryByText("Painel de Gerenciamento")).toBeNull();
  });

  it("bloqueia quem conhece a URL mas não tem sessão", () => {
    render(<LogisticsVertical db={baseDb} update={vi.fn()} />);
    expect(screen.getByText("Acesso restrito")).toBeTruthy();
    expect(screen.queryByText("Painel de Gerenciamento")).toBeNull();
  });

  it("e-mail no domínio da empresa não abre a vertical sozinho", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 403 }))));
    render(
      <LogisticsVertical
        db={{ ...baseDb, user: { ...baseDb.user, email: "quemquer@todogreen.com.br" } }}
        update={vi.fn()}
        authHeaders={authHeaders}
      />,
    );
    expect(await screen.findByText("Acesso restrito")).toBeTruthy();
  });

  it("negócio chamado To Do Green no espaço não abre a vertical", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 403 }))));
    render(
      <LogisticsVertical
        db={{ ...baseDb, businesses: [{ id: "b1", name: "To Do Green", tenantSlug: "todogreen" }] }}
        update={vi.fn()}
        authHeaders={authHeaders}
      />,
    );
    expect(await screen.findByText("Acesso restrito")).toBeTruthy();
  });

  it("permissão guardada no estado local não abre a vertical", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 403 }))));
    render(
      <LogisticsVertical
        db={{ ...baseDb, tenantAccess: { todogreen: { role: "admin", active: true } } }}
        update={vi.fn()}
        authHeaders={authHeaders}
      />,
    );
    expect(await screen.findByText("Acesso restrito")).toBeTruthy();
  });

  it("falha de rede fecha a vertical em vez de mantê-la aberta", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("rede fora"))));
    render(<LogisticsVertical db={baseDb} update={vi.fn()} authHeaders={authHeaders} />);
    expect(await screen.findByText("Acesso restrito")).toBeTruthy();
  });

  it("resposta 200 sem papel conhecido também não libera", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonOk({ ownerId: "u1", permissions: ["*"] })));
    render(<LogisticsVertical db={baseDb} update={vi.fn()} authHeaders={authHeaders} />);
    expect(await screen.findByText("Acesso restrito")).toBeTruthy();
  });

  it("renders the private hub for authorized To Do Green users", async () => {
    await renderarAutorizada();
    expect(screen.getByRole("heading", { name: "Principal", level: 1 }).hidden).toBe(false);
    expect(screen.getByRole("navigation", { name: "Navegação To Do Green" }).querySelectorAll("button")).toHaveLength(15);
    expect(screen.getByText("Configurações")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Olá, Bruna" })).toBeTruthy();
    expect(screen.getByText("Novos Negócios e Comercial. Sua entrada reúne o que exige ação na sua rotina, sem misturar o trabalho das outras áreas.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Minha fila" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Configurar meu início/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Projetos e tarefas/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Painel operacional/i)).toBeNull();
    expect(screen.queryByText(/ativas.*planejado/i)).toBeNull();
    expect(screen.queryByText(/Recursos organizados por área/i)).toBeNull();
    expect(screen.getByText("Middle Mile")).toBeTruthy();
    expect(screen.getByText("Operação a granel")).toBeTruthy();
    expect(screen.getAllByText("ESG").length).toBeGreaterThan(0);
  });

  it("alterna entre navegação por área e por funcionalidades sem duplicar a entrada principal", async () => {
    await renderarAutorizada();

    fireEvent.click(screen.getByRole("button", { name: "Funcionalidades" }));

    expect(screen.queryByRole("navigation", { name: "Navegação To Do Green" })).toBeNull();
    const funcionalidades = screen.getByRole("navigation", { name: "Navegação por funcionalidades" });
    expect(within(funcionalidades).getAllByRole("button", { name: /Ocorrências/ })).toHaveLength(1);
    expect(within(funcionalidades).getAllByRole("button", { name: /Precificação/ })).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Buscar funcionalidades"), { target: { value: "ocorrência" } });
    expect(within(funcionalidades).getAllByRole("button", { name: /Ocorrências/ })).toHaveLength(1);
    expect(within(funcionalidades).queryByRole("button", { name: /Precificação/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Por área" }));
    expect(screen.getByRole("navigation", { name: "Navegação To Do Green" })).toBeTruthy();
  });

  it("salva uma configuração de início diferente para cada colaborador", async () => {
    const update = vi.fn();
    await renderarAutorizada({ update });

    fireEvent.click(screen.getByRole("button", { name: /Configurar meu início/ }));
    fireEvent.change(screen.getByLabelText("Minha área principal"), { target: { value: "finance" } });
    fireEvent.change(screen.getByLabelText("Minha função"), { target: { value: "Controladoria" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar meu início" }));

    expect(update).toHaveBeenCalledTimes(1);
    const next = update.mock.calls[0][0](baseDb);
    expect(next.preferences.todoGreenHome).toMatchObject({
      areaId: "finance",
      functionLabel: "Controladoria",
    });
    expect(next.preferences.todoGreenHome.shortcutIds).toContain("billing");
  });

  it("abre o espaço de trabalho conectado dentro da vertical", async () => {
    window.history.pushState({}, "", "/todogreen/central-trabalho");
    await renderarAutorizada();
    expect(await screen.findByRole("heading", { name: "Projetos e tarefas", level: 1 })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "O contexto fica junto do trabalho" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Notas conectadas/ }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /Páginas e documentos/ })[0]);
    expect(await screen.findByRole("heading", { name: "Páginas e documentos", level: 2 })).toBeTruthy();
    expect(document.querySelectorAll("main.tdg h1")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Mala direta" })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: /^Automações/ })[0]);
    expect(await screen.findByRole("heading", { name: "Quando isso acontecer, faça aquilo" })).toBeTruthy();
  });

  it("mantém notícias, contatos, ajuda e rotinas anteriores visíveis no espaço", async () => {
    window.history.pushState({}, "", "/todogreen/espaco");
    stubDeRede({
      "/api/todogreen/clients": () => jsonOk({
        clientes: [{
          id: "cli-1",
          name: "Empresa Alfa",
          crm: {
            contacts: [{ id: "c1", name: "Ana Compras", title: "Gerente de Procurement", email: "ana@alfa.com", source: "Cadastro manual" }],
            intelligence: {
              version: 9,
              checkedAt: "2026-08-14T10:00:00Z",
              companyNews: [{ title: "Empresa Alfa amplia operação elétrica", url: "https://fonte.example/noticia", snippet: "Expansão confirmada pela fonte." }],
              segmentNews: [],
              openRfqs: [{ title: "RFQ de transporte", url: "https://compras.example/rfq" }],
              supplierLinks: [{ title: "Portal oficial de fornecedores", url: "https://alfa.example/fornecedores" }],
            },
          },
        }],
        acesso: { podeGerenciar: true, podeEditar: true },
      }),
    });
    await renderarAutorizada();

    expect(await screen.findByText("O que já existia continua acessível")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Clientes e contatos.*Contas, decisores/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Central de ajuda/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Playbook comercial.*Jornada de venda/ })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: /Notícias e inteligência/ })[0]);
    // O hub virou "campanhas primeiro"; as notícias moram na aba própria.
    expect(await screen.findByRole("heading", { name: "Campanhas, mercado e geração de demanda" })).toBeTruthy();
    const abaNoticias = screen
      .getAllByRole("button", { name: /^Notícias/ })
      .find((botao) => !/intelig[êe]ncia/i.test(botao.textContent || ""));
    fireEvent.click(abaNoticias);
    expect(await screen.findByText("Empresa Alfa amplia operação elétrica")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /^Contatos/ })[0]);
    expect(await screen.findByRole("heading", { name: "Contatos e decisores" })).toBeTruthy();
    expect(screen.getByText("Ana Compras")).toBeTruthy();
  });

  it("mantém o Playbook comercial em Comercial, não no Espaço", async () => {
    window.history.pushState({}, "", "/todogreen/clientes");
    await renderarAutorizada();

    const comercial = screen.getByRole("navigation", { name: /Seções de Comercial/ });
    expect(within(comercial).getByRole("button", { name: "Playbook" })).toBeTruthy();

    fireEvent.click(within(comercial).getByRole("button", { name: "Playbook" }));
    expect(await screen.findByRole("heading", { name: /Playbook comercial/i })).toBeTruthy();
  });

  it("mantém a busca de funções disponível em qualquer página", async () => {
    window.history.pushState({}, "", "/todogreen/precificacao");
    await renderarAutorizada();
    expect(screen.getByRole("heading", { name: "Precificação e aprovação comercial", level: 1 }).hidden).toBe(false);
    expect(screen.getByText(/Calculadoras por produto, margem, custo, target/i).hidden).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Buscar ferramenta" }));
    await waitFor(() => expect(window.location.pathname).toBe("/todogreen/dashboard"));
    expect(window.location.search).toBe("?ferramentas=1");
    expect(screen.getByText("Produtos e modelos de preço").closest("details")?.open).toBe(true);
    expect(screen.getByLabelText("Buscar rotinas To Do Green").closest("details")?.open).toBe(true);
  });

  it("cada página mantém um título principal único e compreensível", async () => {
    window.history.pushState({}, "", "/todogreen/clientes");
    const { container } = await renderarAutorizada();
    expect(screen.getByRole("heading", { name: "Clientes e contatos", level: 1 }).hidden).toBe(false);
    expect(container.querySelectorAll("#tdg-title")).toHaveLength(1);
    expect(container.querySelector("main.tdg")?.getAttribute("aria-labelledby")).toBe("tdg-title");
  });

  it("does not show fake production indicators when no real data exists", async () => {
    await renderarAutorizada();
    expect(screen.getByText("Sem dados operacionais")).toBeTruthy();
    expect(screen.getByText("Cadastre clientes, oportunidades ou simulações para alimentar o painel.")).toBeTruthy();
    expect(screen.getAllByText("Sem cálculo").length).toBeGreaterThan(0);
    expect(screen.queryByText("Cliente enterprise")).toBeNull();
    expect(screen.queryByText("Operação e-commerce")).toBeNull();
    expect(screen.queryByText(/demonstração ativo/i)).toBeNull();
  });

  it("leva margem e ocupação críticas para uma ação específica", async () => {
    stubDeRede({
      "/api/todogreen/records": () => jsonOk({
        ...REGISTROS,
        scenarios: [{
          id: "s-risk", productId: "middle-mile", clientId: "cli-1", clienteNome: "Rede Alfa",
          premissas: { confirmadas: true },
          result: { selectedPrice: 100_000, loadedCost: 94_000, marginPercent: 6, minimumMarginPercent: 18 },
        }],
        operations: [{
          id: "op-risk", produtoId: "middle-mile", viagens: 10, entregas: 30,
          distanciaKm: 500, ocupacaoPercent: 35, campos: { route: "Cajamar → Osasco" },
        }],
      }),
    });
    await renderarAutorizada();
    expect(await screen.findByText(/Rede Alfa está 12 p\.p\. abaixo do piso/)).toBeTruthy();
    expect(await screen.findByText(/Cajamar → Osasco com 35% de ocupação/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Abrir precificação/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Abrir operação/ })).toBeTruthy();
  });

  it("renders product-specific pricing fields instead of one generic form", async () => {
    window.history.pushState({}, "", "/todogreen/precificacao");
    const { container } = await renderarAutorizada();
    expect(screen.getByText("Middle Mile enterprise")).toBeTruthy();
    expect(screen.getByText("Origem *")).toBeTruthy();
    expect(screen.getByText("Pedágio por viagem R$")).toBeTruthy();
    expect(container.querySelectorAll(".tdg-section")).toHaveLength(0);
    expect(screen.queryByText("Produtos e modelos de preço")).toBeNull();
    fireEvent.click(screen.getAllByText("Last Mile")[0]);
    expect(screen.getByText("Last Mile e-commerce")).toBeTruthy();
    expect(screen.getByText("Pacotes *")).toBeTruthy();
    expect(screen.getByText("Sucesso entrega (%)")).toBeTruthy();
  });

  it("shows pricing results in a readable decision layout", async () => {
    window.history.pushState({}, "", "/todogreen/precificacao/dedicated");
    const { container } = await renderarAutorizada();
    expect(screen.getByText("Custo mensal")).toBeTruthy();
    expect(screen.getByText("Piso")).toBeTruthy();
    expect(screen.getByText("Preço recomendado")).toBeTruthy();
    expect(screen.getByText(/RECOMENDAÇÃO:/i)).toBeTruthy();
    expect(container.querySelectorAll(".tdg-price-summary > div")).toHaveLength(5);
    expect(screen.queryByText("Governança")).toBeNull();
  });

  // ===== Premissas =====
  //
  // A calculadora abria com distância, frequência, ocupação, tipo de veículo e
  // confiança no dado preenchidos, e em um segundo mostrava preço, margem e
  // CO₂ que ninguém informou.

  it("a calculadora abre sem premissa nenhuma preenchida", async () => {
    window.history.pushState({}, "", "/todogreen/precificacao");
    await renderarAutorizada();
    expect(screen.getByLabelText(/^Distância km/).value).toBe("");
    expect(screen.getByLabelText(/^Viagens\/mês/).value).toBe("");
    expect(screen.getByLabelText(/^Tipo de veículo/).value).toBe("");
    expect(screen.getByLabelText(/^Ocupação/).value).toBe("");
    expect(screen.getByLabelText(/^Quanto podemos confiar/).value).toBe("");
  });

  it("sem premissas, o resultado é rotulado e não pode ser salvo", async () => {
    window.history.pushState({}, "", "/todogreen/precificacao");
    await renderarAutorizada();
    expect(screen.getByText("Premissas incompletas")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Salvar simulação/ }).disabled).toBe(true);
    expect(screen.getByLabelText(/Resultado provisório/)).toBeTruthy();
  });

  it("campo obrigatório que nenhum grupo desenhou aparece mesmo assim", async () => {
    window.history.pushState({}, "", "/todogreen/precificacao");
    await renderarAutorizada();
    // O middle-mile exige o cliente e não tinha onde informá-lo.
    expect(screen.getByLabelText(/^Cliente/)).toBeTruthy();
  });

  it("preencher tudo ainda deixa como hipótese até alguém confirmar", async () => {
    window.history.pushState({}, "", "/todogreen/precificacao");
    await renderarAutorizada();
    preencherMiddleMile();
    expect(screen.getByText("Hipótese de trabalho")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Salvar simulação/ }).disabled).toBe(true);
  });

  it("confirmar as premissas libera salvar", async () => {
    window.history.pushState({}, "", "/todogreen/precificacao");
    await renderarAutorizada();
    preencherMiddleMile();
    fireEvent.click(screen.getByLabelText(/Confirmo que estas premissas/));
    expect(screen.getByText("Premissas confirmadas")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Salvar simulação/ }).disabled).toBe(false);
  });

  it("mudar uma premissa depois de confirmar derruba a confirmação", async () => {
    window.history.pushState({}, "", "/todogreen/precificacao");
    await renderarAutorizada();
    preencherMiddleMile();
    fireEvent.click(screen.getByLabelText(/Confirmo que estas premissas/));
    fireEvent.change(screen.getByLabelText(/^Distância km/), { target: { value: "300" } });
    // A declaração valia para outro cálculo.
    expect(screen.getByText("Hipótese de trabalho")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Salvar simulação/ }).disabled).toBe(true);
  });

  it("a simulação salva vai para o servidor com quem confirmou as premissas", async () => {
    window.history.pushState({}, "", "/todogreen/precificacao");
    const gravadas = [];
    const fetchMock = stubDeRede({
      "/api/todogreen/records/scenarios": (_caminho, opcoes) => {
        gravadas.push(JSON.parse(opcoes.body));
        return jsonOk({ registro: { id: "s1" } });
      },
    });
    await renderarAutorizada();
    preencherMiddleMile();
    fireEvent.click(screen.getByLabelText(/Confirmo que estas premissas/));
    fireEvent.click(screen.getByRole("button", { name: /Salvar simulação/ }));

    await waitFor(() => expect(gravadas.length).toBe(1));
    expect(gravadas[0].premissas.confirmadas).toBe(true);
    expect(gravadas[0].premissas.confirmadasPor).toBe("u1");
    expect(gravadas[0].premissas.confirmadasEm).toBeTruthy();
    expect(gravadas[0].productId).toBe("middle-mile");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("proposta não é gerada a partir de simulação não confirmada", async () => {
    window.history.pushState({}, "", "/todogreen/propostas");
    stubDeRede({
      "/api/todogreen/records": () =>
        jsonOk({
          ...REGISTROS,
          scenarios: [
            {
              id: "s1",
              premissas: { confirmadas: false },
              result: { productName: "Middle Mile", recommendedPrice: 1, marginPercent: 1, impact: { co2AvoidedKg: 1 } },
            },
          ],
        }),
    });
    await renderarAutorizada();
    expect(await screen.findByText(/ainda estão como hipótese/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Salvar proposta/ }).disabled).toBe(true);
  });

  it("proposta com simulação confirmada é salva no servidor", async () => {
    window.history.pushState({}, "", "/todogreen/propostas");
    const gravadas = [];
    stubDeRede({
      "/api/todogreen/clients": () => jsonOk({ clientes: [{ id: "c1", name: "Cliente Alfa" }] }),
      "/api/todogreen/records/proposals": (_caminho, opcoes) => {
        gravadas.push(JSON.parse(opcoes.body));
        return jsonOk({ registro: { id: "p1" } });
      },
      "/api/todogreen/records": () =>
        jsonOk({
          ...REGISTROS,
          scenarios: [
            {
              id: "s1",
              clientId: "c1",
              opportunityId: "o1",
              premissas: { confirmadas: true },
              result: { productName: "Middle Mile", recommendedPrice: 1000, marginPercent: 22, impact: { co2AvoidedKg: 500 } },
            },
          ],
        }),
    });
    await renderarAutorizada();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Salvar proposta/ }).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /Salvar proposta/ }));
    await waitFor(() => expect(gravadas.length).toBe(1));
    // A proposta carrega a simulação que gerou o preço.
    expect(gravadas[0].cenarioId).toBe("s1");
    expect(gravadas[0]).toEqual(expect.objectContaining({ clientId: "c1", cliente: "Cliente Alfa", oportunidadeId: "o1" }));
  });

  it("gera contrato somente a partir de proposta aceita e preserva os vínculos", async () => {
    window.history.pushState({}, "", "/todogreen/propostas");
    const contracts = [];
    stubDeRede({
      "/api/todogreen/records/contracts": (_path, options) => {
        contracts.push(JSON.parse(options.body));
        return jsonOk({ registro: { id: "ct-1" } });
      },
      "/api/todogreen/records": () => jsonOk({
        ...REGISTROS,
        proposals: [{
          id: "p1", clientId: "c1", cliente: "Cliente Alfa", oportunidadeId: "o1",
          cenarioId: "s1", titulo: "Proposta Alfa", situacao: "accepted", revision: 1,
        }],
      }),
    });
    await renderarAutorizada();
    expect(await screen.findByText("Proposta Alfa")).toBeTruthy();
    const button = await screen.findByRole("button", { name: /Gerar contrato/ });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(contracts).toHaveLength(1));
    expect(contracts[0]).toEqual(expect.objectContaining({
      clientId: "c1", propostaId: "p1", oportunidadeId: "o1", cenarioId: "s1",
    }));
  });

  it("salvar uma simulação não grava nada no estado genérico do espaço", async () => {
    window.history.pushState({}, "", "/todogreen/precificacao");
    const gravadas = [];
    stubDeRede({
      "/api/todogreen/records/scenarios": (_caminho, opcoes) => {
        gravadas.push(JSON.parse(opcoes.body));
        return jsonOk({ registro: { id: "s1" } });
      },
    });
    await renderarAutorizada();
    preencherMiddleMile();
    fireEvent.click(screen.getByLabelText(/Confirmo que estas premissas/));
    fireEvent.click(screen.getByRole("button", { name: /Salvar simulação/ }));

    await waitFor(() => expect(gravadas.length).toBe(1));
    // Era daqui que saía tanto a gravação no JSON do espaço — que sobrescrevia
    // o trabalho de quem estivesse no mesmo espaço — quanto a concessão de
    // acesso a quem salvava.
    expect(JSON.stringify(gravadas[0])).not.toMatch(/tenantAccess/);
  });

  // ===== Fonte única =====

  it("a vertical lê os registros do servidor, não do estado do espaço", async () => {
    const fetchMock = stubDeRede({
      "/api/todogreen/records": () =>
        jsonOk({
          ...REGISTROS,
          financial: [
            { id: "f1", tipo: "revenue", valor: 5000, categoria: "faturamento", situacao: "previsto" },
            { id: "f2", tipo: "commission", valor: 250, categoria: "comissão", situacao: "previsto" },
          ],
        }),
    });
    window.history.pushState({}, "", "/todogreen/comissoes");
    await renderarAutorizada();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/todogreen/records", expect.any(Object)),
    );
    // Comissão deixou de ser exibida como custo.
    expect(await screen.findByText("Comissões da equipe comercial")).toBeTruthy();
    expect(screen.getByText("comissão")).toBeTruthy();
    // E a receita, que é outro tipo, não vaza para esta lista.
    expect(screen.queryByText("faturamento")).toBeNull();
  });

  it("falha ao carregar diz que não sabe, em vez de mostrar zero como se fosse dado", async () => {
    stubDeRede({
      "/api/todogreen/records": () =>
        Promise.resolve(new Response(JSON.stringify({ error: "Banco indisponível." }), { status: 500 })),
    });
    await renderarAutorizada();
    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent).toMatch(/Banco indisponível/);
    expect(aviso.textContent).toMatch(/não porque não existam/);
  });

  it("o lançamento financeiro vai para o servidor com o tipo certo", async () => {
    const gravados = [];
    stubDeRede({
      "/api/todogreen/records/financial": (_caminho, opcoes) => {
        gravados.push(JSON.parse(opcoes.body));
        return jsonOk({ registro: { id: "f1" } });
      },
    });
    window.history.pushState({}, "", "/todogreen/comissoes");
    await renderarAutorizada();
    fireEvent.change(screen.getByLabelText("Valor R$"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar lançamento/ }));
    await waitFor(() => expect(gravados.length).toBe(1));
    expect(gravados[0].tipo).toBe("commission");
    expect(gravados[0].valor).toBe(900);
  });

  // ===== Aprovação comercial =====

  it("proposta com premissa confirmada ainda não sai se a aprovação comercial está pendente", async () => {
    window.history.pushState({}, "", "/todogreen/propostas");
    stubDeRede({
      "/api/todogreen/clients": () => jsonOk({ clientes: [{ id: "c1", name: "Cliente Alfa" }] }),
      "/api/todogreen/deal-desk": () =>
        jsonOk({
          pedidos: [
            {
              id: "dd1",
              cenarioId: "s1",
              alcadaId: "gestao_comercial",
              situacao: "pendente",
              versao: 1,
              gatilhos: [],
              prazoEm: new Date(Date.now() + 86400000).toISOString(),
              criadoEm: new Date().toISOString(),
            },
          ],
        }),
      "/api/todogreen/records": () =>
        jsonOk({
          ...REGISTROS,
          scenarios: [
            {
              id: "s1",
              clientId: "c1",
              premissas: { confirmadas: true },
              result: { productName: "Middle Mile", recommendedPrice: 1000, marginPercent: 15, impact: { co2AvoidedKg: 10 } },
            },
          ],
        }),
    });
    await renderarAutorizada();
    // Antes a aprovação era só um alerta e a proposta saía do mesmo jeito.
    expect(await screen.findByText(/Aguardando decisão comercial/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Salvar proposta/ }).disabled).toBe(true),
    );
  });

  it("com a aprovação comercial concluída, a proposta sai e diz quem aprovou", async () => {
    window.history.pushState({}, "", "/todogreen/propostas");
    stubDeRede({
      "/api/todogreen/clients": () => jsonOk({ clientes: [{ id: "c1", name: "Cliente Alfa" }] }),
      "/api/todogreen/deal-desk": () =>
        jsonOk({
          pedidos: [
            {
              id: "dd1",
              cenarioId: "s1",
              alcadaId: "gestao_comercial",
              situacao: "aprovado",
              versao: 2,
              decisorNome: "Bruna",
              gatilhos: [],
              prazoEm: new Date(Date.now() + 86400000).toISOString(),
              criadoEm: new Date().toISOString(),
            },
          ],
        }),
      "/api/todogreen/records": () =>
        jsonOk({
          ...REGISTROS,
          scenarios: [
            {
              id: "s1",
              clientId: "c1",
              premissas: { confirmadas: true },
              result: { productName: "Middle Mile", recommendedPrice: 1000, marginPercent: 15, impact: { co2AvoidedKg: 10 } },
            },
          ],
        }),
    });
    await renderarAutorizada();
    expect(await screen.findByText(/Aprovado por Bruna na versão 2/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Salvar proposta/ }).disabled).toBe(false),
    );
  });

  it("a aba de aprovações existe e não é apelido da precificação", async () => {
    window.history.pushState({}, "", "/todogreen/precificacao");
    await renderarAutorizada();
    const secoes = screen.getByRole("navigation", { name: /Seções de Comercial/ });
    expect(secoes.textContent).toContain("Aprovações");
  });

  it("loads the independent client page from the real CRM service", async () => {
    window.history.pushState({}, "", "/todogreen/clientes");
    const fetchMock = stubDeRede({
      "/api/todogreen/clients": () => jsonOk({
        clientes: [{ id: "c1", name: "Cliente real", status: "active", vendedores: [] }],
        acesso: { podeGerenciar: true, somenteCarteira: false },
      }),
    });
    await renderarAutorizada();
    expect((await screen.findAllByText("Cliente real")).length).toBeGreaterThan(0);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/todogreen/clients", expect.any(Object)));
  });

  it("expõe a espinha transacional em telas operáveis de planejamento e financeiro", async () => {
    window.history.pushState({}, "", "/todogreen/ordens-servico");
    await renderarAutorizada();
    expect(await screen.findByRole("heading", { name: "Aceite e ordens de serviço", level: 2 })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: /Seções de Operação/ }).textContent).toContain("CIOT");
    fireEvent.click(screen.getByRole("button", { name: "Financeiro" }));
    expect(await screen.findByRole("heading", { name: "Fila de faturamento", level: 2 })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: /Seções de Financeiro/ }).textContent).toContain("Títulos e baixas");
    expect(screen.getByRole("navigation", { name: /Seções de Financeiro/ }).textContent).toContain("Rateio de custos");
  });

  it("filters functions while preserving real workflow navigation", async () => {
    await renderarAutorizada();
    fireEvent.change(screen.getByLabelText("Buscar rotinas To Do Green"), {
      target: { value: "Green Score" },
    });
    expect(screen.getAllByText("Green Score").length).toBeGreaterThan(0);
    expect(screen.getByText("Pipeline")).toBeTruthy();
    expect(screen.queryByText("Remuneração Variável")).toBeNull();
  });

  it("opens a function in a new browser tab", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { container } = await renderarAutorizada();
    const card = [...container.querySelectorAll(".tdg-module-card")].find((item) =>
      item.textContent.includes("Clientes"),
    );
    expect(card.textContent).not.toMatch(/abrir/i);
    fireEvent.click(card);
    expect(open).toHaveBeenCalledWith("/todogreen/clientes", "_blank", "noopener,noreferrer");
  });

  it("shows the access panel for admins", async () => {
    window.history.pushState({}, "", "/todogreen/acessos");
    stubDeRede({
      "/api/todogreen/access-list": () => jsonOk({
        emails: [
          { email: "teste@teste.com.br", role: "admin", status: "active", note: "Conta de teste" },
        ],
      }),
    });
    await renderarAutorizada();
    expect(await screen.findByText("teste@teste.com.br")).toBeTruthy();
    expect(screen.getByText(/Autorize usuários/i)).toBeTruthy();
  });

  it("permite ao administrador selecionar funcionalidades em vez de só um perfil", async () => {
    window.history.pushState({}, "", "/todogreen/acessos");
    const chamadas = stubDeRede({ "/api/todogreen/access-list": () => jsonOk({ emails: [] }) });
    await renderarAutorizada();
    await screen.findByText(/Nenhum e-mail autorizado ainda/);

    fireEvent.change(screen.getByLabelText("E-mail autorizado"), { target: { value: "pesquisa@teste.com.br" } });
    fireEvent.change(screen.getByLabelText("Tipo de acesso"), { target: { value: "custom" } });
    fireEvent.click(screen.getByLabelText("Acessar a vertical"));
    fireEvent.click(screen.getByLabelText("Consultar notícias, RFQs e mercado"));
    fireEvent.click(screen.getByLabelText("Executar pesquisas de mercado e decisores"));
    fireEvent.click(screen.getByRole("button", { name: /Autorizar/ }));

    await waitFor(() => expect(chamadas.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
    const [, options] = chamadas.mock.calls.find(([, requestOptions]) => requestOptions?.method === "POST");
    expect(JSON.parse(options.body).permissions).toEqual(["read", "market:read", "market:research"]);
  });

  it("o painel de acessos não promete liberação automática por domínio", async () => {
    window.history.pushState({}, "", "/todogreen/acessos");
    stubDeRede({ "/api/todogreen/access-list": () => jsonOk({ emails: [] }) });
    const { container } = await renderarAutorizada();
    await screen.findByText(/Nenhum e-mail autorizado ainda/);
    expect(container.textContent).not.toMatch(/continua liberado automaticamente/);
    expect(container.textContent).not.toMatch(/@todogreen\.com\.br/);
  });
});
