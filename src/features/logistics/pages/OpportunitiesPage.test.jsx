/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OpportunitiesPage from "./OpportunitiesPage.jsx";

// A configuração do projeto não usa `globals`, então o auto-cleanup da
// Testing Library não se registra sozinho: sem isto, cada teste enxerga o DOM
// dos anteriores e as buscas encontram elementos duplicados.
afterEach(cleanup);

const completa = {
  id: "opp-1",
  cliente: "Distribuidora Norte",
  estagio: "Proposta",
  tipoVeiculo: "elétrico",
  distanciaKm: 120,
  viagensMes: 20,
  mesesContrato: 24,
  valorMensal: 10000,
  ocupacaoPrevistaPercent: 78,
  frotaLimpaPercent: 60,
};

// O registro que o CRM já grava hoje: sem nenhum dado operacional.
const crua = {
  id: "opp-2",
  client: "Atacado Sul",
  stage: "Diagnóstico",
  value: 180000,
  probability: 30,
};

const mapeada = {
  ...completa,
  revision: 3,
  origin: "Cajamar",
  destination: "Osasco",
  weightKg: 900,
  sla: "98,5% no prazo",
  deliveryWindows: "08h às 18h",
  trackingSystem: "TMS do cliente",
  primaryObjective: "esg",
};

const abrir = (nome) => fireEvent.click(screen.getByRole("button", { name: new RegExp(nome) }));
// O formulário de criação vive num modal (a página não é mais cortada no
// meio); os testes abrem o modal como uma pessoa abriria.
const abrirNova = () => fireEvent.click(screen.getByRole("button", { name: /Nova oportunidade/ }));

// O kanban simplificado virou a visão padrão (pedido da titular). Estes testes
// exercitam os fluxos da LISTA (cartão aberto, memória de cálculo, edição), então
// pré-gravam a preferência — exatamente o que a pessoa que escolheu Lista teria.
beforeEach(() => {
  localStorage.setItem("todogreen-opp-view", "lista");
});

describe("página de oportunidades", () => {
  it("abre no kanban simplificado por padrão, com total por etapa", () => {
    localStorage.removeItem("todogreen-opp-view");
    render(<OpportunitiesPage opportunities={[completa]} />);
    // Coluna do estágio da oportunidade com contagem e o cartão nome+valor.
    expect(screen.getByRole("tab", { name: "Kanban", selected: true })).toBeInTheDocument();
    expect(screen.getByText(/Apresentação · 1/)).toBeInTheDocument();
    const cartao = screen.getByRole("button", { name: /Distribuidora Norte.*240\.000/ });
    expect(cartao).toBeInTheDocument();
  });

  it("mostra o pipeline separando valor cheio de valor ponderado", () => {
    render(<OpportunitiesPage opportunities={[completa]} />);
    const resumo = screen.getByText("Ponderado pela probabilidade").closest("article");
    // 240.000 × 35% (estágio Apresentação, régua do funil da titular)
    expect(within(resumo).getByText(/84\.000/)).toBeInTheDocument();
    expect(screen.getByText("Valor em contrato").closest("article")).toHaveTextContent(
      /240\.000/,
    );
  });

  it("conta as oportunidades sem dado ambiental como fila de trabalho", () => {
    render(<OpportunitiesPage opportunities={[completa, crua]} />);
    expect(screen.getByText("1 sem dado operacional")).toBeInTheDocument();
  });

  it("abre a oportunidade com potencial ESG, Green Score e próxima ação", () => {
    render(<OpportunitiesPage opportunities={[completa]} />);
    abrir("Distribuidora Norte");
    expect(screen.getByText("Potencial ambiental")).toBeInTheDocument();
    expect(screen.getByText(/Green Score projetado/)).toBeInTheDocument();
    expect(screen.getByText("Ver memória de cálculo")).toBeInTheDocument();
    expect(screen.getByText(/Potencial de expansão/)).toBeInTheDocument();
    expect(screen.getByText(/Mapear → Simular → Rodar → Reportar → Escalar/)).toBeInTheDocument();
  });

  it("leva uma oportunidade mapeada para a calculadora existente", () => {
    const onNavigate = vi.fn();
    render(<OpportunitiesPage opportunities={[mapeada]} onNavigate={onNavigate} />);
    abrir("Distribuidora Norte");
    fireEvent.click(screen.getByRole("button", { name: /Simular agora/ }));
    expect(onNavigate).toHaveBeenCalledWith("/todogreen/precificacao?opportunity=opp-1");
  });

  it("reconhece a simulação vinculada e avança para o piloto", () => {
    render(
      <OpportunitiesPage
        opportunities={[mapeada]}
        scenarios={[{ id: "sc-1", opportunityId: "opp-1" }]}
      />,
    );
    abrir("Distribuidora Norte");
    expect(screen.getByText(/Etapa atual: Rodar/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Simular agora/ })).not.toBeInTheDocument();
  });

  it("atualiza o estudo preservando a revisão concorrente", async () => {
    const onUpdate = vi.fn().mockResolvedValue({});
    render(<OpportunitiesPage opportunities={[mapeada]} onUpdate={onUpdate} />);
    abrir("Distribuidora Norte");
    fireEvent.click(screen.getByRole("button", { name: /Atualizar estudo/ }));
    fireEvent.change(screen.getByLabelText("Cubagem média (m³)"), {
      target: { value: "18" },
    });
    fireEvent.change(screen.getByLabelText("Situação do piloto"), {
      target: { value: "planejado" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Salvar estudo/ }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate.mock.calls[0][0]).toBe("opp-1");
    expect(onUpdate.mock.calls[0][1].volumeM3).toBe(18);
    expect(onUpdate.mock.calls[0][1].pilotStatus).toBe("planejado");
    expect(onUpdate.mock.calls[0][1].revision).toBe(3);
  });

  it("a memória de cálculo fica disponível, não escondida em outra tela", () => {
    render(<OpportunitiesPage opportunities={[completa]} />);
    abrir("Distribuidora Norte");
    fireEvent.click(screen.getByText("Ver memória de cálculo"));
    expect(screen.getByText(/inventário nacional/i)).toBeInTheDocument();
    expect(screen.getByText(/não constitui certificação/i)).toBeInTheDocument();
  });

  it("sem dado operacional, diz o que falta em vez de mostrar zero", () => {
    render(<OpportunitiesPage opportunities={[crua]} />);
    abrir("Atacado Sul");
    // Aparece no lugar dos números ambientais e também na lista de riscos —
    // são duas leituras diferentes da mesma pendência, e o vendedor pode
    // chegar por qualquer uma das duas.
    expect(
      screen.getAllByText(/Informe a distância e a frequência mensal/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Potencial ambiental")).not.toBeInTheDocument();
    // O valor herdado continua sendo o contrato inteiro, não a mensalidade.
    expect(screen.getByText("Valor em contrato").closest("article")).toHaveTextContent(
      /180\.000/,
    );
  });

  it("risco crítico aparece no cabeçalho, antes de abrir o card", () => {
    render(
      <OpportunitiesPage
        opportunities={[{ ...completa, viagensMes: 220, veiculosDisponiveis: 2 }]}
      />,
    );
    const cabecalho = screen.getByRole("button", { name: /Distribuidora Norte/ });
    expect(cabecalho).toHaveTextContent("1");
    fireEvent.click(cabecalho);
    expect(screen.getByText(/Confirmar capacidade de frota/i)).toBeInTheDocument();
  });

  it("grava os números do formulário como número, não como texto", () => {
    const onCreate = vi.fn();
    render(<OpportunitiesPage opportunities={[]} onCreate={onCreate} />);
    abrirNova();
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "Nova Conta" } });
    fireEvent.change(screen.getByLabelText("Distância por viagem (km)"), {
      target: { value: "90" },
    });
    fireEvent.change(screen.getByLabelText("Viagens por mês"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Valor mensal (R$)"), {
      target: { value: "12000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Registrar oportunidade/ }));

    const registro = onCreate.mock.calls[0][0];
    // Guardar "90" como string faria o motor somar texto e produzir um
    // pipeline errado sem erro nenhum.
    expect(registro.distanciaKm).toBe(90);
    expect(registro.viagensMes).toBe(40);
    expect(registro.valorMensal).toBe(12000);
    expect(registro.cliente).toBe("Nova Conta");
  });

  it("vincula a oportunidade ao identificador da conta e navega pelas etapas", () => {
    const onCreate = vi.fn();
    render(<OpportunitiesPage clients={[{ id: "cli-1", name: "Rede Alfa" }]} opportunities={[completa]} onCreate={onCreate} />);
    abrirNova();
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "cli-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Apresentação/ }));
    expect(screen.getByRole("button", { name: /Distribuidora Norte/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Registrar oportunidade/ }));
    expect(onCreate.mock.calls[0][0]).toMatchObject({ clientId: "cli-1", cliente: "Rede Alfa" });
  });

  it("comentário da conta aparece na oportunidade; o novo fica só nela", async () => {
    // Regra da titular (30/08): comentário da CONTA replica em todas as
    // oportunidades dela; comentário de OUTRA oportunidade nunca vaza para cá;
    // e o que se escreve aqui sai carimbado com o id desta oportunidade.
    const onComment = vi.fn().mockResolvedValue({});
    const comments = [
      { id: "c1", clientId: "cli-1", opportunityId: "", comentario: "Nota da conta: piloto aprovado.", autorEmail: "bruna@todogreen.com", criadoEm: "2026-08-29T10:00:00Z" },
      { id: "c2", clientId: "cli-1", opportunityId: "outra-opp", comentario: "Segredo de outra oportunidade", autorEmail: "x@todogreen.com", criadoEm: "2026-08-29T11:00:00Z" },
    ];
    localStorage.setItem("todogreen-opp-view", "kanban");
    render(<OpportunitiesPage opportunities={[{ ...completa, clientId: "cli-1" }]} comments={comments} onComment={onComment} setToast={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Distribuidora Norte/ }));
    expect(await screen.findByText("Nota da conta: piloto aprovado.")).toBeInTheDocument();
    expect(screen.getByText(/comentário da conta/)).toBeInTheDocument();
    expect(screen.queryByText("Segredo de outra oportunidade")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Escreva um comentário desta oportunidade"), { target: { value: "Renegociar prazo" } });
    fireEvent.click(screen.getByRole("button", { name: "Comentar" }));
    await waitFor(() => expect(onComment).toHaveBeenCalledWith({ clientId: "cli-1", opportunityId: "opp-1", comentario: "Renegociar prazo" }));
  });

  it("interação da conta aparece na oportunidade; a nova sai carimbada com ela", async () => {
    // Mesmo alcance dos comentários, agora com ata, participantes e próximo
    // passo: o que é da conta acompanha todas as oportunidades dela.
    const onInteraction = vi.fn().mockResolvedValue({});
    const interactions = [
      { id: "i1", clientId: "cli-1", opportunityId: "", tipo: "reuniao", assunto: "Agenda anual com o board", ocorridaEm: "2026-08-20" },
      { id: "i2", clientId: "cli-1", opportunityId: "outra-opp", tipo: "ligacao", assunto: "Assunto de outra oportunidade", ocorridaEm: "2026-08-21" },
    ];
    localStorage.setItem("todogreen-opp-view", "kanban");
    render(<OpportunitiesPage
      opportunities={[{ ...completa, clientId: "cli-1" }]}
      interactions={interactions}
      onInteraction={onInteraction}
      setToast={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: /Distribuidora Norte/ }));
    expect(await screen.findByText("Agenda anual com o board")).toBeInTheDocument();
    expect(screen.queryByText("Assunto de outra oportunidade")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Registrar interação/ }));
    fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "Reunião de fechamento" } });
    fireEvent.change(screen.getByLabelText("Quando aconteceu"), { target: { value: "2026-08-30" } });
    fireEvent.change(screen.getByLabelText("Ata / o que foi tratado"), { target: { value: "Cliente aceitou o preço com 12 meses." } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar interação/ }));

    await waitFor(() => expect(onInteraction).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "cli-1", opportunityId: "opp-1", assunto: "Reunião de fechamento",
      ata: "Cliente aceitou o preço com 12 meses.",
    })));
  });

  it("avisa que a conta Fria saiu para Morno — e não repete o aviso para conta Quente", async () => {
    // O servidor aquece a conta (Frio/sem classificação → Morno) quando a
    // oportunidade nasce vinculada; o toast espelha a mesma régua.
    const setToast = vi.fn();
    const clients = [
      { id: "cli-fria", name: "Rede Fria", crm: { temperature: "Frio" } },
      { id: "cli-quente", name: "Rede Quente", crm: { temperature: "Quente" } },
    ];
    render(<OpportunitiesPage clients={clients} opportunities={[]} onCreate={vi.fn()} setToast={setToast} />);

    abrirNova();
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "cli-fria" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar oportunidade/ }));
    await waitFor(() => expect(setToast).toHaveBeenCalled());
    expect(setToast.mock.calls.at(-1)[0]).toMatch(/Rede Fria saiu de Frio para Morno/);

    // O modal fecha no sucesso; a segunda oportunidade começa como a pessoa
    // começaria — abrindo de novo.
    abrirNova();
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "cli-quente" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar oportunidade/ }));
    await waitFor(() => expect(setToast).toHaveBeenCalledTimes(2));
    expect(setToast.mock.calls.at(-1)[0]).not.toMatch(/Morno/);
  });

  it("não limpa o formulário nem anuncia sucesso quando a gravação falha", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("Servidor indisponível"));
    const setToast = vi.fn();
    render(<OpportunitiesPage opportunities={[]} onCreate={onCreate} setToast={setToast} />);
    abrirNova();
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "Conta preservada" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar oportunidade/ }));

    await waitFor(() => expect(setToast).toHaveBeenCalledWith("Servidor indisponível"));
    // Em erro o modal continua aberto e nada digitado se perde.
    expect(screen.getByLabelText("Cliente")).toHaveValue("Conta preservada");
  });

  it("carteira vazia convida em vez de mostrar tela em branco", () => {
    render(<OpportunitiesPage opportunities={[]} />);
    expect(screen.getByText(/Nenhuma oportunidade registrada ainda/)).toBeInTheDocument();
  });
});

it("seleciona usuário cadastrado e cria follow-up vinculado à oportunidade", async () => {
  const fetchAnterior = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url) => new Response(JSON.stringify(String(url).startsWith("/api/collab")
    ? { owner: { id: "u1", name: "Ana", email: "ana@example.com" }, members: [] }
    : { records: [] }), { status: 200 }));
  try {
    const onInteraction = vi.fn().mockResolvedValue({});
    const onCreateTask = vi.fn().mockResolvedValue({});
    render(<OpportunitiesPage opportunities={[{ ...mapeada, clientId: "cli1" }]} espacoId="workspace1" currentUserId="u1" onInteraction={onInteraction} onCreateTask={onCreateTask} />);
    abrir("Distribuidora Norte");
    fireEvent.click(screen.getByRole("button", { name: /Atualizar estudo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar interação" }));
    fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "Reunião comercial" } });
    fireEvent.change(screen.getByLabelText("Próximo passo"), { target: { value: "Enviar minuta" } });
    await screen.findByRole("option", { name: "Ana · ana@example.com" });
    fireEvent.change(screen.getByLabelText("Responsável pelo follow-up"), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar interação" }));
    await waitFor(() => expect(onCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "Enviar minuta", assigneeId: "u1", assignee: "Ana", clientId: "cli1", opportunityId: "opp-1",
    })));
    expect(onInteraction).toHaveBeenCalledWith(expect.objectContaining({ clientId: "cli1", opportunityId: "opp-1" }));
  } finally { globalThis.fetch = fetchAnterior; }
});
