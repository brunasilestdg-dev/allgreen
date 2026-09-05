/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClientsPage from "./ClientsPage.jsx";

describe("página de clientes", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); window.history.replaceState({}, "", "/"); });

  it("explica e exibe somente a carteira devolvida para o vendedor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      clientes: [{ id: "client-1", name: "Cliente atribuído", document: "", segment: "Varejo", status: "active", vendedores: [{ email: "vendedor@empresa.com" }] }],
      acesso: { podeGerenciar: false, somenteCarteira: true },
    }), { status: 200 })));

    render(<ClientsPage authHeaders={() => ({ authorization: "Bearer teste" })} />);

    expect(await screen.findByRole("heading", { name: "CRM e carteira 360º" })).toBeInTheDocument();
    expect(screen.getAllByText("Cliente atribuído").length).toBeGreaterThan(0);
    expect(screen.getByText("Contas na carteira")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cartões" })).toHaveClass("active");
    expect(screen.queryByText("Definir responsável comercial")).not.toBeInTheDocument();
  });

  it("conecta conta, forecast e próxima melhor ação", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      clientes: [{
        id: "client-1", accountCode: "TDG-000001", name: "Rede Alfa", segment: "Varejo", status: "ativo", revision: 2,
        vendedores: [], crm: { stage: "Diagnóstico", nextAction: "Validar rota", nextActionAt: "2999-01-01", dataQuality: 80, customerAnnualLogisticsSpend: 5_000_000, contacts: [] },
      }],
      acesso: { podeGerenciar: true, podeEditar: true, somenteCarteira: false },
    }), { status: 200 })));

    render(<ClientsPage authHeaders={() => ({})} opportunities={[{
      id: "opp-1", clientId: "client-1", cliente: "Rede Alfa", estagio: "Proposta",
      valorContrato: 1_000_000, probabilidade: 60, nextStep: "Reunião com compras",
    }]} />);

    expect(await screen.findByText("Forecast ponderado")).toBeInTheDocument();
    // findAll: o forecast chega depois do fetch; em runner lento a leitura
    // síncrona via a tela ainda com R$ 0 (flake real visto na main em 30/08).
    expect((await screen.findAllByText(/600\.000/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Rede Alfa/ }));
    expect(await screen.findByRole("heading", { name: "Rede Alfa" })).toBeInTheDocument();
    expect(screen.getAllByText("TDG-000001").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Pesquisar empresa/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Ver como cliente/ })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Visões da conta" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Resumo" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Receita anual da To Do Green ainda não informada/)).toBeInTheDocument();
    expect(screen.queryByText(/^Gasto logístico anual do cliente não informado/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Validar rota/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Marcar feita e ver próxima" })).toBeEnabled();
    expect(screen.getByText("Reunião com compras")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Oportunidades" }));
    expect(screen.getByRole("tab", { name: "Oportunidades" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("White Space")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Conversas realizadas" }));
    expect(await screen.findByText("Nenhuma mensagem ou reunião registrada")).toBeInTheDocument();
  });

  it("oferece kanban por cliente e agrupa a carteira por etapa", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      clientes: [
        {
          id: "client-1", accountCode: "TDG-000001", name: "Rede Alfa", segment: "Varejo", status: "ativo", revision: 2,
          vendedores: [], crm: { stage: "Implantação", temperature: "Quente", contacts: [] },
        },
        {
          id: "client-2", accountCode: "TDG-000002", name: "Rede Beta", segment: "Indústria", status: "ativo", revision: 1,
          vendedores: [], crm: { stage: "Diagnóstico", temperature: "Morno", contacts: [] },
        },
      ],
      acesso: { podeGerenciar: true, podeEditar: true, somenteCarteira: false },
    }), { status: 200 })));

    render(<ClientsPage authHeaders={() => ({})} opportunities={[{
      id: "opp-1", clientId: "client-1", cliente: "Rede Alfa", estagio: "Proposta",
      valorContrato: 750_000, probabilidade: 80, nextStep: "Kickoff de implantação",
    }]} />);

    expect(await screen.findByRole("heading", { name: "CRM e carteira 360º" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(screen.getByRole("button", { name: "Kanban" })).toHaveClass("active");

    // O kanban abre no formato SIMPLIFICADO aprovado pela titular: as etapas
    // do FUNIL DE OPORTUNIDADES (Prospecção → Fechamento + desfechos), coluna
    // com total em R$ e cartão só com cliente e valor. A oportunidade da
    // fixture está em "Proposta" (nome antigo), que cai em Apresentação.
    const simples = screen.getByLabelText("Kanban simplificado — oportunidades por etapa do funil");
    const colunaApresentacao = within(simples).getByRole("region", { name: /Apresentação/ });
    expect(within(colunaApresentacao).getByText("Apresentação · 1")).toBeInTheDocument();
    expect(within(colunaApresentacao).getByRole("button", { name: /Rede Alfa.*750 mil/ })).toBeInTheDocument();
    // As duas colunas de desfecho existem, vazias.
    expect(within(simples).getByRole("region", { name: /Fechada ganha/ })).toBeInTheDocument();
    expect(within(simples).getByRole("region", { name: /Fechada perdida/ })).toBeInTheDocument();

    // O detalhado (por etapa da conta) continua a um clique.
    fireEvent.click(screen.getByRole("button", { name: "Detalhado" }));
    const board = screen.getByLabelText("Kanban de clientes por etapa");
    const implantacao = within(board).getByRole("region", { name: /Implantação/ });
    expect(within(implantacao).getByRole("button", { name: /Rede Alfa/ })).toBeInTheDocument();
    expect(within(implantacao).getByText("1 conta(s)")).toBeInTheDocument();
    expect(within(board).getByRole("button", { name: /Rede Beta/ })).toBeInTheDocument();
    expect(window.localStorage.getItem("todogreen-crm-view")).toBe("kanban");
  });

  it("novo contato pela lista sugere as contas cadastradas e grava na conta escolhida", async () => {
    const chamadas = [];
    const payload = {
      clientes: [
        { id: "client-1", name: "Rede Alfa", segment: "Varejo", status: "ativo", revision: 4, vendedores: [], crm: { stage: "Diagnóstico", contacts: [] } },
        { id: "client-2", name: "Rede Beta", segment: "Indústria", status: "ativo", revision: 1, vendedores: [], crm: { contacts: [] } },
      ],
      acesso: { podeGerenciar: false, podeEditar: true, somenteCarteira: true },
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url, options = {}) => {
      chamadas.push({ url: String(url), method: options.method || "GET", body: options.body });
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    }));
    const setToast = vi.fn();

    render(<ClientsPage authHeaders={() => ({})} setToast={setToast} />);
    expect(await screen.findByRole("heading", { name: "CRM e carteira 360º" })).toBeInTheDocument();

    // Vendedor sem podeGerenciar também registra contato — só não cria conta.
    expect(screen.queryByRole("button", { name: /Nova conta/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Novo contato" }));

    // O campo Conta sugere as contas cadastradas (datalist), e o contato vai
    // para a conta pelo id resolvido — nunca por nome solto.
    expect(document.querySelectorAll("#tdg-crm-contas option")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "Rede Beta" } });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Carla Souza" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "Carla@REDEBETA.com.br" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar contato/ }));

    await waitFor(() => expect(chamadas.some((c) => c.method === "PATCH")).toBe(true));
    const patch = chamadas.find((c) => c.method === "PATCH");
    expect(patch.url).toContain("clients/client-2");
    const corpo = JSON.parse(patch.body);
    expect(corpo.revision).toBe(1);
    expect(corpo.crm.contacts).toHaveLength(1);
    expect(corpo.crm.contacts[0]).toMatchObject({
      name: "Carla Souza",
      email: "carla@redebeta.com.br",
      source: "Cadastro manual",
      active: true,
    });
    expect(setToast.mock.calls.at(-1)[0]).toBe("Contato registrado em Rede Beta.");
  });

  it("comentário na conta é registrado sem oportunidade — é ele que replica", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      clientes: [{ id: "client-1", name: "Rede Alfa", status: "ativo", revision: 1, vendedores: [], crm: { contacts: [] } }],
      acesso: { podeGerenciar: false, podeEditar: true, somenteCarteira: true },
    }), { status: 200 }))));
    const onComment = vi.fn().mockResolvedValue({});

    render(<ClientsPage
      authHeaders={() => ({})}
      setToast={vi.fn()}
      onComment={onComment}
      comments={[{ id: "c1", clientId: "client-1", opportunityId: "", comentario: "Conta estratégica para o Q4.", autorEmail: "bruna@todogreen.com", criadoEm: "2026-08-29T09:00:00Z" }]}
    />);
    fireEvent.click(await screen.findByRole("button", { name: /Rede Alfa/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Conversas realizadas" }));

    expect(screen.getByText("Conta estratégica para o Q4.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Escreva um comentário desta conta"), { target: { value: "Piloto em SP fechado" } });
    fireEvent.click(screen.getByRole("button", { name: "Comentar" }));
    // Sem opportunityId no corpo: comentário de conta replica em todas as
    // oportunidades da conta — regra da titular (30/08).
    await waitFor(() => expect(onComment).toHaveBeenCalledWith({ clientId: "client-1", comentario: "Piloto em SP fechado" }));
  });

  it("registra a ata da reunião na conta, com alcance de conta", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      clientes: [{ id: "client-1", name: "Rede Alfa", status: "ativo", revision: 1, vendedores: [], crm: { contacts: [] } }],
      acesso: { podeGerenciar: false, podeEditar: true, somenteCarteira: true },
    }), { status: 200 }))));
    const onInteraction = vi.fn().mockResolvedValue({});

    render(<ClientsPage
      authHeaders={() => ({})}
      setToast={vi.fn()}
      onInteraction={onInteraction}
      interactions={[
        { id: "i1", clientId: "client-1", opportunityId: "", tipo: "reuniao", assunto: "Kick-off da malha", ata: "Cliente quer piloto em SP.", ocorridaEm: "2026-08-25" },
        { id: "i2", clientId: "client-1", opportunityId: "opp-9", tipo: "ligacao", assunto: "Detalhe da oportunidade", ocorridaEm: "2026-08-28" },
      ]}
    />);
    fireEvent.click(await screen.findByRole("button", { name: /Rede Alfa/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Conversas realizadas" }));

    // Na conta só entra o que é da conta: a interação da oportunidade fica nela.
    expect(screen.getByText("Kick-off da malha")).toBeInTheDocument();
    expect(screen.queryByText("Detalhe da oportunidade")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Registrar interação/ }));
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "tentativa" } });
    fireEvent.change(screen.getByLabelText("Quando aconteceu"), { target: { value: "2026-08-30" } });
    fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "Liguei, sem retorno" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar interação/ }));

    await waitFor(() => expect(onInteraction).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "client-1", tipo: "tentativa", assunto: "Liguei, sem retorno", ocorridaEm: "2026-08-30",
    })));
    // Sem opportunityId: é interação da conta, aparece em todas as dela.
    expect(onInteraction.mock.calls[0][0].opportunityId).toBe("");
  });

  it("mostra a régua da saúde e salva as notas no próprio painel", async () => {
    const chamadas = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url, options = {}) => {
      if (options.method === "PATCH") chamadas.push(JSON.parse(options.body));
      return Promise.resolve(new Response(JSON.stringify({
        clientes: [{
          id: "client-1", name: "Rede Alfa", status: "ativo", revision: 4, vendedores: [],
          crm: { contacts: [], strategicPotential: 80, relationshipStrength: 40, nextAction: "Visitar o CD" },
        }],
        acesso: { podeGerenciar: true, podeEditar: true, somenteCarteira: false },
      }), { status: 200 }));
    }));

    render(<ClientsPage authHeaders={() => ({})} setToast={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Rede Alfa/ }));

    // A regra deixou de ser segredo do código: peso, fórmula e classificação.
    expect(screen.getByText(/70% da média ponderada das seis notas/)).toBeInTheDocument();
    expect(screen.getByText(/Potencial estratégico/)).toBeInTheDocument();
    expect(screen.getByText(/Por que está assim:/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Avaliar esta conta" }));
    fireEvent.change(screen.getByLabelText("Aderência ESG (0 a 100)"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar avaliação/ }));

    await waitFor(() => expect(chamadas.length).toBe(1));
    expect(chamadas[0].revision).toBe(4);
    expect(chamadas[0].crm.esgFit).toBe(70);
    // Editar a nota não pode apagar o resto do CRM da conta.
    expect(chamadas[0].crm.strategicPotential).toBe(80);
    expect(chamadas[0].crm.nextAction).toBe("Visitar o CD");
  });

  it("novo contato sem conta da lista não grava em lugar nenhum", async () => {
    const chamadas = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url, options = {}) => {
      chamadas.push({ method: options.method || "GET" });
      return Promise.resolve(new Response(JSON.stringify({
        clientes: [{ id: "client-1", name: "Rede Alfa", status: "ativo", revision: 1, vendedores: [], crm: { contacts: [] } }],
        acesso: { podeGerenciar: false, podeEditar: true, somenteCarteira: true },
      }), { status: 200 }));
    }));
    const setToast = vi.fn();

    render(<ClientsPage authHeaders={() => ({})} setToast={setToast} />);
    await screen.findByRole("heading", { name: "CRM e carteira 360º" });
    fireEvent.click(screen.getByRole("button", { name: "Novo contato" }));
    fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "Conta que não existe" } });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Contato Perdido" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar contato/ }));

    await waitFor(() => expect(setToast).toHaveBeenCalled());
    expect(setToast.mock.calls.at(-1)[0]).toMatch(/Escolha uma conta da lista/);
    expect(chamadas.every((c) => c.method === "GET")).toBe(true);
  });

  it("conecta operação e financeiro da conta na aba dedicada", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      clientes: [{
        id: "client-1", accountCode: "TDG-000001", name: "Rede Alfa", segment: "Varejo", status: "ativo", revision: 2,
        vendedores: [], crm: { stage: "Implantação", contacts: [] },
      }],
      acesso: { podeGerenciar: true, podeEditar: true, somenteCarteira: false },
    }), { status: 200 })));

    render(<ClientsPage
      authHeaders={() => ({})}
      operations={[
        { id: "op-1", clientId: "client-1", referencia: "OP-1", situacao: "in_transit", prometidoEm: "2000-01-01", ocorrencias: 2 },
        { id: "op-2", clientId: "client-1", referencia: "OP-2", situacao: "delivered", entregueEm: "2026-08-01" },
      ]}
      financial={[
        { id: "fin-1", clientId: "client-1", tipo: "revenue", valor: 12000, vencimentoEm: "2000-02-01", descricao: "NF 001" },
        { id: "fin-2", clientId: "client-1", tipo: "revenue", valor: 8000, vencimentoEm: "2999-01-01", pagoEm: null, descricao: "NF 002" },
      ]}
    />);

    fireEvent.click(await screen.findByRole("button", { name: /Rede Alfa/ }));
    expect(await screen.findByRole("heading", { name: "Rede Alfa" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Operação e financeiro" }));
    expect(screen.getByRole("tab", { name: "Operação e financeiro" })).toHaveAttribute("aria-selected", "true");

    // O painel dedicado lê a mesma fonte das telas de Operação e Financeiro.
    const painel = screen.getByText("Operação e financeiro ao vivo").closest("section");
    // OP-1 aparece em andamento e também na coluna de ocorrências (tem 2).
    expect(within(painel).getAllByText("OP-1").length).toBeGreaterThan(0);
    // A entregue não conta como em andamento.
    expect(within(painel).queryByText("OP-2")).not.toBeInTheDocument();
    expect(within(painel).getByText("2 ocorrência(s)")).toBeInTheDocument();
    expect(within(painel).getByText("NF 001")).toBeInTheDocument();
    expect(within(painel).getByText("NF 002")).toBeInTheDocument();
    expect(within(painel).getByRole("button", { name: /Abrir contas a receber/ })).toBeInTheDocument();
  });

  it("reconhece os contatos salvos sem fingir que são procurement logístico", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      clientes: [{
        id: "adidas", name: "Adidas", segment: "Varejo", status: "ativo", revision: 2,
        vendedores: [], crm: {
          contacts: [{ id: "1", name: "Thiago Souza", department: "Operações", email: "fernanda.pereira@adidas.com", phone: "+5519982414440" }],
          intelligence: {
            version: 9,
            checkedAt: "2026-08-11T00:00:00.000Z", esg: { relevance: "Alta", signals: [] },
            companyNews: [{ title: "adidas records strong start to the year", url: "https://www.adidas-group.com/news", snippet: "Continued operating working capital investments and strong business growth across the company." }],
            segmentNews: [], procurementPeople: [], supplierLinks: [], openRfqs: [], nextActions: [],
          },
        },
      }],
      acesso: { podeGerenciar: true, podeEditar: true, somenteCarteira: false },
    }), { status: 200 })));

    render(<ClientsPage authHeaders={() => ({})} />);
    fireEvent.click(await screen.findByRole("button", { name: /Adidas/ }));
    expect(await screen.findByText("1 contato(s) cadastrado(s); nenhum de Procurement logístico confirmado.")).toBeInTheDocument();
    expect(screen.getAllByText(/Pedir a Thiago Souza a indicação/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Thiago Souza").length).toBeGreaterThan(0);
    expect(screen.queryByText("Contato ainda não mapeado")).not.toBeInTheDocument();
    expect(screen.getByText(/Fonte pública · adidas-group.com/)).toBeInTheDocument();
    expect(screen.queryByText(/Continued operating working capital/)).not.toBeInTheDocument();
  });

  it("não reapresenta pesquisa antiga nem contatos web sem comprovação brasileira", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      clientes: [{
        id: "adidas", name: "Adidas", segment: "Varejo", status: "ativo", revision: 3,
        vendedores: [], crm: {
          contacts: [
            { id: "historico", name: "Contato salvo", department: "Operações", email: "salvo@adidas.com" },
            { id: "web-contact-1", name: "Ian Aranjo", source: "Pesquisa web", linkedinUrl: "https://ca.linkedin.com/in/ian-aranjo" },
          ],
          intelligence: {
            version: 1, checkedAt: "2026-08-10T00:00:00.000Z", esg: { relevance: "Alta", signals: [] },
            procurementPeople: [{ title: "Ian Aranjo", url: "https://ca.linkedin.com/in/ian-aranjo" }],
            rfqWatchlist: [{ title: "O que é RFQ", url: "https://example.com/o-que-e-rfq" }],
          },
        },
      }],
      acesso: { podeGerenciar: true, podeEditar: true, somenteCarteira: false },
    }), { status: 200 })));

    render(<ClientsPage authHeaders={() => ({})} />);
    fireEvent.click(await screen.findByRole("button", { name: /Adidas/ }));
    expect((await screen.findAllByText("Contato salvo")).length).toBeGreaterThan(0);
    // O contato web sem comprovação brasileira NÃO entra no mapa ativo de
    // decisores — mas também não some da tela: fica listado, rotulado, na
    // seção "Fora do mapa ativo". Sumiço silencioso era o bug reclamado.
    const foraDoMapa = screen.getByText(/Fora do mapa ativo \(1\)/).closest("details");
    expect(foraDoMapa).toContainElement(screen.getByText("Ian Aranjo"));
    expect(screen.queryByText("O que é RFQ")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Pesquisar empresa/ }).length).toBeGreaterThan(0);
  });

  it("marca a sugestão como feita e apresenta a próxima ação", async () => {
    const firstClient = {
      id: "conta-1", name: "Conta Um", segment: "Varejo", status: "ativo", revision: 2,
      vendedores: [], crm: { contacts: [{ id: "1", name: "Marina", department: "Operações", email: "marina@empresa.com" }] },
    };
    const nextClient = {
      ...firstClient,
      revision: 3,
      crm: { ...firstClient.crm, completedSuggestedActions: ["request-procurement-referral"] },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ clientes: [firstClient], acesso: { podeEditar: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, id: "conta-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ clientes: [nextClient], acesso: { podeEditar: true } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ClientsPage authHeaders={() => ({})} />);
    fireEvent.click(await screen.findByRole("button", { name: /Conta Um/ }));
    expect(await screen.findAllByText(/Pedir a Marina a indicação/i)).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Marcar feita e ver próxima" }));

    expect(await screen.findAllByText(/Não há próxima ação confiável/i)).not.toHaveLength(0);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const patchRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(patchRequest.crm.completedSuggestedActions).toContain("request-procurement-referral");
  });
});

// ===== O cache da pesquisa 360 precisa poder valer =====
//
// `force` existe para ignorar o cache de 24 horas, e a tela o mandava em TODA
// pesquisa. Resultado: o cache nunca valia pelo botão, e cada clique disparava
// a rodada inteira de consultas ao provedor de busca — mesmo tendo pesquisado
// a mesma conta minutos antes. Numa cota gratuita isso se gasta rápido, e
// provedor sem crédito se parece exatamente com "a pesquisa parou de
// funcionar", que foi como o problema chegou.
describe("consumo da pesquisa 360", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  const abrirFicha = async (fetchMock) => {
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientsPage authHeaders={() => ({})} />);
    expect(await screen.findByRole("heading", { name: "CRM e carteira 360º" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Rede Alfa/ }));
    expect(await screen.findByRole("heading", { name: "Rede Alfa" })).toBeInTheDocument();
  };

  const respostaPadrao = () => new Response(JSON.stringify({
    clientes: [{ id: "client-1", name: "Rede Alfa", segment: "Varejo", status: "ativo", revision: 1, vendedores: [], crm: { contacts: [] } }],
    acesso: { podeGerenciar: true, podeEditar: true, somenteCarteira: false },
    intelligence: {},
  }), { status: 200 });

  const corpoDaPesquisa = (fetchMock) => {
    const chamada = fetchMock.mock.calls.find(([url]) => String(url).includes("client-intelligence"));
    return chamada ? JSON.parse(chamada[1].body) : null;
  };

  it("'Pesquisar empresa' não força: deixa o cache de 24h valer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaPadrao());
    await abrirFicha(fetchMock);

    fireEvent.click(screen.getAllByRole("button", { name: /Pesquisar empresa/ })[0]);
    await waitFor(() => expect(corpoDaPesquisa(fetchMock)).not.toBeNull());

    const corpo = corpoDaPesquisa(fetchMock);
    expect(corpo.focus).toBe("company");
    // `force: true` aqui gasta cota do provedor a cada clique, sem necessidade.
    expect(corpo.force).toBeUndefined();
  });

  it("'Atualizar contatos' continua indo à web, pelo foco e não pelo force", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaPadrao());
    await abrirFicha(fetchMock);

    fireEvent.click(screen.getAllByRole("button", { name: /Atualizar contatos/ })[0]);
    await waitFor(() => expect(corpoDaPesquisa(fetchMock)).not.toBeNull());

    // É `focus: "contacts"` que faz o servidor ignorar o cache — por desenho.
    expect(corpoDaPesquisa(fetchMock).focus).toBe("contacts");
  });
});
