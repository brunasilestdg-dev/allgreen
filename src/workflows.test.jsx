// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, {
  addBusinessDays,
  addDaysYmd,
  businessDaysBetween,
  contactLinks,
  createGoogleCalendarEventReal,
  googleCalendarUrl,
  makeSite,
  makeSitePages,
  mergeSiteBrief,
  sendGmailReal,
  upsertContact,
} from "./App";
import {
  documentFileKind,
  documentTitleFromFilename,
  extractDocumentText,
} from "./components/leituraDeArquivo.js";

const user = {
  id: "user-flow",
  name: "Bruna Silva",
  email: "bruna@example.com",
};
const business = {
  id: "business-1",
  name: "Negócio Teste",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const initialDb = () => ({
  user,
  onboarding: false,
  selectedBusinessId: business.id,
  businesses: [business],
  tasks: [],
  leads: [],
  appointments: [],
  products: [],
  orders: [],
  timeEntries: [],
  transactions: [],
  financeSettings: {},
  documents: [],
  sites: [],
  history: [],
  certificates: [],
  conversations: [],
  media: [],
  emailDrafts: [],
  customSpecialists: [],
  pluggedTools: [],
  selectedConversationId: null,
  journeys: {},
  preferences: { theme: "light", specialist: "Diretor" },
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

describe("fluxos de trabalho", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    localStorage.setItem("seu-funcionario-auth-token", "token-flow");
    localStorage.setItem("seu-funcionario-active-user", user.id);
    localStorage.setItem(
      `seu-funcionario-v2:${user.id}`,
      JSON.stringify(initialDb()),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/auth/session") return response({ user });
        if (String(url).startsWith("/api/workspace"))
          return options.method === "PUT"
            ? response({ ok: true })
            : response({});
        if (url === "/api/config") return response({ videoEnabled: false });
        return response({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("avisa quando uma nova versão do aplicativo está disponível", () => {
    render(<App />);
    fireEvent(window, new Event("sf-app-update-available"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Uma nova versão está pronta",
    );
    expect(
      screen.getByRole("button", { name: "Atualizar agora" }),
    ).toBeInTheDocument();
  });

  it("cria, edita, vincula e arquiva uma tarefa", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    expect(
      screen.getByRole("heading", { name: "Tarefas e projetos" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Preparar lançamento" },
    });
    fireEvent.change(screen.getByLabelText("Nome do responsável"), {
      target: { value: "Bruna" },
    });
    fireEvent.change(screen.getByLabelText("Projeto"), {
      target: { value: "Campanha de julho" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Criar tarefa" })).getByRole(
        "button",
        { name: "Criar tarefa" },
      ),
    );

    expect(screen.getByText("Preparar lançamento")).toBeInTheDocument();
    expect(screen.getAllByText(/Campanha de julho/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Editar tarefa" }));
    expect(
      screen.getByRole("dialog", { name: "Editar tarefa" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Preparar lançamento final" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(screen.getByText("Preparar lançamento final")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }));
    expect(
      screen.queryByText("Preparar lançamento final"),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar arquivamento"), {
      target: { value: "Arquivadas" },
    });
    expect(screen.getByText("Preparar lançamento final")).toBeInTheDocument();
  });

  it("calcula o prazo em dias úteis dentro do formulário de tarefa", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    const dialog = screen.getByRole("dialog", { name: "Criar tarefa" });
    fireEvent.change(within(dialog).getByLabelText("Título"), {
      target: { value: "Protocolar contestação" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Calcular em dias úteis" }),
    );
    fireEvent.change(within(dialog).getByLabelText("Data base do prazo"), {
      target: { value: "2024-01-01" },
    });
    fireEvent.change(within(dialog).getByLabelText("Dias úteis"), {
      target: { value: "5" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Usar como prazo" }),
    );
    expect(within(dialog).getByLabelText("Prazo")).toHaveValue("2024-01-08");
  });

  it("delega uma tarefa a um colaborador digital e abre a execução no chat", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Criar campanha de lançamento" },
    });
    fireEvent.change(screen.getByLabelText("Responsável"), {
      target: { value: "digital" },
    });
    fireEvent.change(screen.getByLabelText("Colaborador digital"), {
      target: { value: "Marketing" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Criar tarefa" })).getByRole(
        "button",
        { name: "Criar tarefa" },
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Iniciar tarefa com Marketing" }),
    );
    expect(
      screen.getByRole("heading", {
        name: "A habilidade certa para cada desafio",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Funcionário")).toHaveValue("Marketing");
    expect(screen.getByLabelText("Mensagem para a IA").value).toContain(
      "Criar campanha de lançamento",
    );
  });

  it("mostra todas as ferramentas relacionadas dentro de cada área", () => {
    render(<App />);
    const openToolkit = (labelRegex) => {
      const toggle = screen.getByRole("button", { name: labelRegex });
      if (toggle.getAttribute("aria-expanded") !== "true") {
        fireEvent.click(toggle);
      }
      return toggle.closest("section");
    };

    fireEvent.click(screen.getByRole("button", { name: "Financeiro" }));
    const financeHub = openToolkit(/Tudo de Financeiro em um só lugar/);
    expect(within(financeHub).getByText("Fluxo de caixa")).toBeInTheDocument();
    expect(
      within(financeHub).getByText("Metas e ponto de equilíbrio"),
    ).toBeInTheDocument();
    expect(
      within(financeHub).getByText("Calculadora de preço"),
    ).toBeInTheDocument();
    expect(within(financeHub).getByText("NFS-e Nacional")).toBeInTheDocument();
    expect(
      within(financeHub).getByText("Emissor NF-e Sebrae"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Marca e Marketing" }));
    const marketingHub = openToolkit(/Tudo de Marca e Marketing em um só lugar/);
    expect(
      within(marketingHub).getByText("Gerador de posts"),
    ).toBeInTheDocument();
    expect(
      within(marketingHub).getByText("Estúdio de logos e imagens"),
    ).toBeInTheDocument();
    expect(within(marketingHub).getByText("Canva")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Vendas e Clientes" }));
    const salesHub = openToolkit(/Tudo de Vendas e Clientes em um só lugar/);
    expect(
      within(salesHub).getByText("CRM e funil de vendas"),
    ).toBeInTheDocument();
    expect(
      within(salesHub).getByText("Roteiro e follow-up"),
    ).toBeInTheDocument();
    expect(within(salesHub).getByText("WhatsApp Web")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    const operationHub = openToolkit(/Tudo de Operação em um só lugar/);
    expect(
      within(operationHub).getByText("Passo a passo (POP)"),
    ).toBeInTheDocument();
    expect(
      within(operationHub).getByText("Roteirizador de entregas"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sites e Materiais" }));
    expect(
      openToolkit(/Tudo de Sites e Materiais em um só lugar/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Documentos" }));
    expect(
      openToolkit(/Tudo de Documentos em um só lugar/),
    ).toBeInTheDocument();
  });

  it("só conclui um marco de jornada quando existe um entregável", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Começar do zero" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Começar jornada" })[0],
    );

    const validate = screen.getAllByRole("button", {
      name: "Validar marco",
    })[0];
    expect(validate).toBeDisabled();
    fireEvent.change(
      screen.getAllByPlaceholderText(
        "Descreva o entregável, decisão ou evidência produzida nesta etapa.",
      )[0],
      {
        target: { value: "Briefing da ideia registrado no documento inicial." },
      },
    );
    const enabledValidate = screen.getAllByRole("button", {
      name: "Validar marco",
    })[0];
    expect(enabledValidate).toBeEnabled();
    fireEvent.click(enabledValidate);

    await waitFor(() =>
      expect(
        screen.getByText("Briefing da ideia registrado no documento inicial."),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Reabrir marco" }),
    ).toBeInTheDocument();
  });

  it("edita um lead e preserva o histórico de interações", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Vendas e Clientes" }));
    fireEvent.click(screen.getByRole("button", { name: "Novo lead" }));
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Cliente Exemplo" },
    });
    fireEvent.change(screen.getByLabelText("Empresa"), {
      target: { value: "Empresa Exemplo" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Adicionar lead" })).getByRole(
        "button",
        { name: "Salvar lead" },
      ),
    );

    expect(screen.getByText("Cliente Exemplo")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Editar lead e ver interacoes" }),
    );
    fireEvent.change(
      screen.getByPlaceholderText("O que aconteceu e qual foi o combinado?"),
      { target: { value: "Reunião realizada; enviar proposta na sexta." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(
      screen.getByText("Reunião realizada; enviar proposta na sexta."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Editar lead e ver interacoes" }),
    );
    expect(
      screen.getByText("Reunião realizada; enviar proposta na sexta."),
    ).toBeInTheDocument();
  });

  it("CRM e Agendamentos alimentam a mesma agenda de contatos, sem duplicar", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Vendas e Clientes" }));
    fireEvent.click(screen.getByRole("button", { name: "Novo lead" }));
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Ana Souza" },
    });
    fireEvent.change(screen.getByLabelText("E-mail ou telefone"), {
      target: { value: "(11) 98888-7777" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Adicionar lead" })).getByRole(
        "button",
        { name: "Salvar lead" },
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Contatos" }));
    expect(await screen.findByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Agendamentos" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Novo agendamento" })[0],
    );
    let dialog = await screen.findByRole("dialog", { name: "Novo agendamento" });
    fireEvent.change(within(dialog).getByLabelText("Serviço ou motivo"), {
      target: { value: "Retorno" },
    });
    fireEvent.change(within(dialog).getByLabelText("Cliente"), {
      target: { value: "Ana S." },
    });
    fireEvent.change(within(dialog).getByLabelText("WhatsApp ou e-mail"), {
      target: { value: "(11) 98888-7777" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar agendamento" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Contatos" }));
    expect(await screen.findByText("Ana S.")).toBeInTheDocument();
    expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("importa um arquivo de texto para a biblioteca de documentos", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Documentos" }));
    const bytes = new TextEncoder().encode(
      "Proposta comercial importada com escopo e prazo.",
    );
    const file = {
      name: "proposta_cliente.txt",
      type: "text/plain",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    };
    fireEvent.change(
      screen.getByLabelText("Selecionar documentos para enviar"),
      { target: { files: [file] } },
    );

    await waitFor(() =>
      expect(screen.getByText("proposta cliente")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Proposta comercial importada com escopo/),
    ).toBeInTheDocument();
  });

  it("anexa um documento diretamente à conversa", async () => {
    render(<App />);
    // A conversa saiu da tela inicial e ganhou tela própria: a entrada agora é
    // a caixa de pedido, e o chat completo abre em "Falar com seu Funcionário".
    fireEvent.click(
      await screen.findByRole("button", { name: "Falar com seu Funcionário" }),
    );
    await screen.findByLabelText("Anexar documentos ao chat");

    const bytes = new TextEncoder().encode(
      "Dados do contrato que precisam ser analisados.",
    );
    const file = {
      name: "contrato_cliente.txt",
      type: "text/plain",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    };
    fireEvent.change(screen.getByLabelText("Anexar documentos ao chat"), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(screen.getByText("contrato_cliente.txt")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Remover contrato_cliente.txt" }),
    ).toBeInTheDocument();
  });

  it('abre o modal de criação ao clicar em "Criar meu primeiro site"', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Sites e Materiais" }));
    expect(await screen.findByText("Nenhum site criado")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Criar meu primeiro site" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Criar um site" }),
    ).toBeInTheDocument();
  });

  it("cria um agendamento e mostra a ação de confirmar por WhatsApp", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Agendamentos" }));
    expect(
      await screen.findByText("Nenhum agendamento aqui"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Novo agendamento" })[0],
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Novo agendamento",
    });
    fireEvent.change(within(dialog).getByLabelText("Serviço ou motivo"), {
      target: { value: "Banho e tosa" },
    });
    fireEvent.change(within(dialog).getByLabelText("Cliente"), {
      target: { value: "Ana" },
    });
    fireEvent.change(within(dialog).getByLabelText("WhatsApp ou e-mail"), {
      target: { value: "(11) 98888-7777" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar agendamento" }),
    );

    expect(await screen.findByText("Banho e tosa")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirmar por WhatsApp com Ana" }),
    ).toBeInTheDocument();
  });

  it("cadastra um produto, monta um pedido e dá baixa automática no estoque", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Produtos e Pedidos" }));
    expect(
      await screen.findByText("Nenhum produto cadastrado"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Novo produto" })[0],
    );
    let dialog = await screen.findByRole("dialog", { name: "Novo produto" });
    fireEvent.change(within(dialog).getByLabelText("Nome do produto"), {
      target: { value: "Ração 10kg" },
    });
    fireEvent.change(within(dialog).getByLabelText("Preço de venda"), {
      target: { value: "150" },
    });
    fireEvent.change(within(dialog).getByLabelText("Estoque atual"), {
      target: { value: "10" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar produto" }),
    );

    expect(await screen.findByText("Ração 10kg")).toBeInTheDocument();
    expect(screen.getByText(/10 un em estoque/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pedidos" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Novo pedido" })[0]);
    dialog = await screen.findByRole("dialog", { name: "Novo pedido" });
    fireEvent.change(within(dialog).getByLabelText("Cliente"), {
      target: { value: "Carlos" },
    });
    fireEvent.change(within(dialog).getByLabelText("WhatsApp ou e-mail"), {
      target: { value: "(11) 97777-6666" },
    });
    fireEvent.change(within(dialog).getByLabelText("Escolher produto"), {
      target: { value: within(dialog).getByText(/Ração 10kg/).closest("option").value },
    });
    fireEvent.change(within(dialog).getByLabelText("Quantidade"), {
      target: { value: "3" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    expect(within(dialog).getByText("3x Ração 10kg")).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar pedido" }),
    );

    expect(await screen.findByText(/Carlos/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Avisar Carlos por WhatsApp" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Catálogo" }));
    expect(await screen.findByText(/7 un em estoque/)).toBeInTheDocument();
  });

  it("calcula o total do pedido de delivery somando a taxa da zona de entrega", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Produtos e Pedidos" }));
    await screen.findByText("Nenhum produto cadastrado");

    fireEvent.click(
      screen.getAllByRole("button", { name: "Novo produto" })[0],
    );
    let dialog = await screen.findByRole("dialog", { name: "Novo produto" });
    fireEvent.change(within(dialog).getByLabelText("Nome do produto"), {
      target: { value: "Marmita" },
    });
    fireEvent.change(within(dialog).getByLabelText("Preço de venda"), {
      target: { value: "20" },
    });
    fireEvent.change(within(dialog).getByLabelText("Estoque atual"), {
      target: { value: "10" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar produto" }),
    );
    expect(await screen.findByText("Marmita")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pedidos" }));
    fireEvent.click(screen.getByRole("button", { name: "Zonas de entrega" }));
    dialog = await screen.findByRole("dialog", { name: "Zonas de entrega" });
    fireEvent.change(within(dialog).getByLabelText("Nome da zona"), {
      target: { value: "Centro" },
    });
    fireEvent.change(within(dialog).getByLabelText("Taxa de entrega"), {
      target: { value: "8" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Adicionar zona" }),
    );
    expect(within(dialog).getByText("Centro")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Novo pedido" })[0]);
    dialog = await screen.findByRole("dialog", { name: "Novo pedido" });
    fireEvent.change(within(dialog).getByLabelText("Cliente"), {
      target: { value: "Marina" },
    });
    fireEvent.change(within(dialog).getByLabelText("Canal"), {
      target: { value: "Delivery" },
    });
    fireEvent.change(within(dialog).getByLabelText("Zona de entrega"), {
      target: {
        value: within(dialog).getByText(/Centro/).closest("option").value,
      },
    });
    fireEvent.change(within(dialog).getByLabelText("Escolher produto"), {
      target: {
        value: within(dialog).getByText(/Marmita/).closest("option").value,
      },
    });
    fireEvent.change(within(dialog).getByLabelText("Quantidade"), {
      target: { value: "2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    expect(within(dialog).getByText("Taxa de entrega")).toBeInTheDocument();
    expect(within(dialog).getByText("R$ 8,00")).toBeInTheDocument();
    expect(within(dialog).getByText("R$ 48,00")).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar pedido" }),
    );

    expect(await screen.findByText(/Marina · R\$ 48,00/)).toBeInTheDocument();
  });

  it("pedido de material com cliente pede WhatsApp, aparece na lista e vira contato", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Produtos e Pedidos" }));
    await screen.findByText("Nenhum produto cadastrado");

    fireEvent.click(
      screen.getAllByRole("button", { name: "Novo produto" })[0],
    );
    let dialog = await screen.findByRole("dialog", { name: "Novo produto" });
    fireEvent.change(within(dialog).getByLabelText("Nome do produto"), {
      target: { value: "Pneu 22.5" },
    });
    fireEvent.change(within(dialog).getByLabelText("Preço de venda"), {
      target: { value: "10" },
    });
    fireEvent.change(within(dialog).getByLabelText("Estoque atual"), {
      target: { value: "50" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar produto" }),
    );
    expect(await screen.findByText("Pneu 22.5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pedidos" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Novo pedido" })[0]);
    dialog = await screen.findByRole("dialog", { name: "Novo pedido" });
    // Sem o canal "Mesa" (removido): o pedido é sempre de um cliente, com o
    // campo de WhatsApp/e-mail sempre presente.
    expect(within(dialog).getByText("Cliente")).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText("WhatsApp ou e-mail"),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Cliente"), {
      target: { value: "Cliente Alfa" },
    });
    fireEvent.change(within(dialog).getByLabelText("Escolher produto"), {
      target: {
        value: within(dialog).getByText(/Pneu 22\.5/).closest("option").value,
      },
    });
    fireEvent.change(within(dialog).getByLabelText("Quantidade"), {
      target: { value: "3" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar pedido" }),
    );

    expect(await screen.findByText(/Cliente Alfa · R\$ 30,00/)).toBeInTheDocument();

    // O pedido de um cliente vira contato — ao contrário da antiga comanda.
    fireEvent.click(screen.getByRole("button", { name: "Contatos" }));
    expect(await screen.findByText("Cliente Alfa")).toBeInTheDocument();
  });

  it("produto com variações calcula preço/estoque agregados e dá baixa na variação certa", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Produtos e Pedidos" }));
    await screen.findByText("Nenhum produto cadastrado");

    fireEvent.click(
      screen.getAllByRole("button", { name: "Novo produto" })[0],
    );
    let dialog = await screen.findByRole("dialog", { name: "Novo produto" });
    fireEvent.change(within(dialog).getByLabelText("Nome do produto"), {
      target: { value: "Camiseta" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Adicionar variação" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Adicionar variação" }),
    );
    const nameInputs = within(dialog).getAllByLabelText("Nome da variação");
    fireEvent.change(nameInputs[0], { target: { value: "P" } });
    fireEvent.change(nameInputs[1], { target: { value: "M" } });
    fireEvent.change(within(dialog).getByLabelText("Preço da variação P"), {
      target: { value: "50" },
    });
    fireEvent.change(within(dialog).getByLabelText("Estoque da variação P"), {
      target: { value: "5" },
    });
    fireEvent.change(within(dialog).getByLabelText("Preço da variação M"), {
      target: { value: "55" },
    });
    fireEvent.change(within(dialog).getByLabelText("Estoque da variação M"), {
      target: { value: "3" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar produto" }),
    );

    expect(await screen.findByText("Camiseta")).toBeInTheDocument();
    expect(screen.getByText(/A partir de R\$ 50,00/)).toBeInTheDocument();
    expect(screen.getByText(/8 un em estoque/)).toBeInTheDocument();
    expect(screen.getByText(/2 variações/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pedidos" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Novo pedido" })[0]);
    dialog = await screen.findByRole("dialog", { name: "Novo pedido" });
    fireEvent.change(within(dialog).getByLabelText("Cliente"), {
      target: { value: "Joana" },
    });
    fireEvent.change(within(dialog).getByLabelText("Escolher produto"), {
      target: {
        value: within(dialog).getByText(/Camiseta/).closest("option").value,
      },
    });
    fireEvent.change(within(dialog).getByLabelText("Escolha a variação"), {
      target: {
        value: within(dialog).getByText(/M · R\$ 55,00/).closest("option")
          .value,
      },
    });
    fireEvent.change(within(dialog).getByLabelText("Quantidade"), {
      target: { value: "2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    expect(
      within(dialog).getByText("2x Camiseta - M"),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText("R$ 110,00")).toHaveLength(2);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar pedido" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Catálogo" }));
    expect(await screen.findByText(/6 un em estoque/)).toBeInTheDocument();
  });

  it("cadastra veículo, registra frete com CT-e e atualiza o status", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Frota e Fretes" }));
    expect(
      await screen.findByText("Nenhum veículo cadastrado"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Novo veículo" })[0]);
    let dialog = await screen.findByRole("dialog", { name: "Novo veículo" });
    fireEvent.change(within(dialog).getByLabelText("Placa"), {
      target: { value: "abc1d23" },
    });
    fireEvent.change(within(dialog).getByLabelText("Modelo"), {
      target: { value: "Volvo FH" },
    });
    fireEvent.change(within(dialog).getByLabelText("Motorista"), {
      target: { value: "Carlos" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar veículo" }),
    );
    expect(await screen.findByText(/ABC1D23 · Volvo FH/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fretes" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Novo frete" })[0]);
    dialog = await screen.findByRole("dialog", { name: "Novo frete" });
    fireEvent.change(within(dialog).getByLabelText("Veículo"), {
      target: {
        value: within(dialog).getByText(/ABC1D23/).closest("option").value,
      },
    });
    fireEvent.change(within(dialog).getByLabelText("Origem"), {
      target: { value: "São Paulo" },
    });
    fireEvent.change(within(dialog).getByLabelText("Destino"), {
      target: { value: "Curitiba" },
    });
    fireEvent.change(
      within(dialog).getByLabelText("Número do CT-e (registro manual)"),
      { target: { value: "12345" } },
    );
    fireEvent.change(within(dialog).getByLabelText("Valor do CT-e"), {
      target: { value: "500" },
    });
    expect(
      within(dialog).getByText(
        /A emissão oficial do CT-e é feita no seu emissor fiscal homologado/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar frete" }),
    );

    expect(
      await screen.findByText(/São Paulo → Curitiba/),
    ).toBeInTheDocument();
    expect(screen.getByText(/CT-e 12345/)).toBeInTheDocument();

    const statusSelect = screen.getByDisplayValue("Agendado");
    fireEvent.change(statusSelect, { target: { value: "Entregue" } });
    expect(screen.getByDisplayValue("Entregue")).toBeInTheDocument();
  });

  it("registra horas trabalhadas e fatura lançando a receita no Financeiro", async () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Horas e Faturamento" }),
    );
    expect(
      await screen.findByText("Nenhum apontamento aqui"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Novo apontamento" })[0],
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Novo apontamento",
    });
    fireEvent.change(within(dialog).getByLabelText("Cliente"), {
      target: { value: "Escritório Almeida" },
    });
    fireEvent.change(within(dialog).getByLabelText("Horas"), {
      target: { value: "4" },
    });
    fireEvent.change(within(dialog).getByLabelText("Valor por hora"), {
      target: { value: "200" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar apontamento" }),
    );

    expect(await screen.findByText(/Escritório Almeida/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Faturar horas de Escritório Almeida",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    expect(await screen.findByText(/Faturado/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Financeiro" }));
    expect(
      await screen.findByText(/Escritório Almeida — 4h/),
    ).toBeInTheDocument();
  });
});

describe("construtor de sites", () => {
  it("nunca publica o briefing interno como texto para o visitante", () => {
    const brief = {
      name: "Seu Funcionário",
      segment: "Inteligência artificial",
      instructions:
        "Crie uma landing page premium e explique claramente tudo o que a plataforma faz.",
      description: "",
      services: "Planejamento\nConteúdo",
      color: "#0b9f8f",
    };
    const html = makeSite(brief, "", "seu-funcionario");
    expect(html).not.toContain(brief.instructions);
    expect(html).toContain("Seu Funcionário oferece soluções");
  });

  it("gera páginas independentes e preserva campos não pedidos numa edição", () => {
    const brief = {
      name: "Estúdio Aurora",
      segment: "Design",
      headline: "Design que aproxima",
      description: "Identidades claras para marcas em crescimento.",
      services: "Marca\nSite",
      cta: "Conversar",
      color: "#0b9f8f",
    };
    const pages = makeSitePages(brief, "estudio-aurora");
    expect(pages.map((page) => page.slug)).toEqual([
      "",
      "sobre",
      "servicos",
      "contato",
    ]);
    expect(pages[1].html).toContain("/s/estudio-aurora/servicos");
    const edited = mergeSiteBrief(brief, { headline: "Sua marca, mais viva" });
    expect(edited.headline).toBe("Sua marca, mais viva");
    expect(edited.description).toBe(brief.description);
    expect(edited.services).toBe(brief.services);
  });

  it("aplica o tema escolhido, imagem de capa, galeria, depoimentos e FAQ", () => {
    const brief = {
      name: "Estúdio Aurora",
      segment: "Design",
      headline: "Design que aproxima",
      description: "Identidades claras para marcas em crescimento.",
      services: "Marca\nSite",
      color: "#0b9f8f",
      theme: "escuro",
      heroImage: "https://exemplo.com/capa.jpg",
      gallery: [{ url: "https://exemplo.com/foto1.jpg", caption: "Projeto 1" }],
      testimonials: [
        { name: "Cliente Feliz", role: "CEO", quote: "Trabalho excelente!" },
      ],
      faq: [{ question: "Como funciona?", answer: "Conversamos e planejamos juntos." }],
    };
    const home = makeSite(brief, "", "estudio-aurora");
    expect(home).toContain("#100e1c");
    expect(home).toContain("https://exemplo.com/capa.jpg");
    expect(home).toContain("https://exemplo.com/foto1.jpg");
    expect(home).toContain("Projeto 1");
    const about = makeSite(brief, "sobre", "estudio-aurora");
    expect(about).toContain("Cliente Feliz");
    expect(about).toContain("Trabalho excelente!");
    const services = makeSite(brief, "servicos", "estudio-aurora");
    expect(services).toContain("Como funciona?");
    expect(services).toContain("Conversamos e planejamos juntos.");
  });

  it("ignora imagens com URL insegura e não deixa a edição por IA alterar fotos ou depoimentos", () => {
    const brief = {
      name: "Estúdio Aurora",
      heroImage: "javascript:alert(1)",
      gallery: [{ url: "javascript:alert(1)", caption: "malicioso" }],
      testimonials: [],
    };
    const home = makeSite(brief, "", "estudio-aurora");
    expect(home).not.toContain("javascript:alert");
    expect(home).not.toContain("<img");
    const edited = mergeSiteBrief(brief, {
      heroImage: "https://outro.com/fake.jpg",
      gallery: [{ url: "https://outro.com/fake.jpg" }],
    });
    expect(edited.heroImage).toBe(brief.heroImage);
    expect(edited.gallery).toBe(brief.gallery);
  });

  it("compõe a página inicial com os blocos e o estilo de topo escolhidos", () => {
    const brief = {
      name: "Estúdio Aurora",
      color: "#0b9f8f",
      heroStyle: "impacto",
      features: [
        { title: "Atendimento rápido", description: "Resposta no mesmo dia." },
        { title: "Equipe especializada" },
      ],
      homeBlocks: ["cta", "features"],
      gallery: [{ url: "https://exemplo.com/foto.jpg", caption: "Foto" }],
    };
    const home = makeSite(brief, "", "estudio-aurora");
    expect(home).toContain("style-impacto");
    expect(home).toContain("Atendimento rápido");
    const ctaIndex = home.indexOf("cta-banner");
    const featuresIndex = home.indexOf("O que nos diferencia");
    expect(ctaIndex).toBeGreaterThan(-1);
    expect(ctaIndex).toBeLessThan(featuresIndex);
    // galeria tem conteúdo real e deve aparecer mesmo fora da lista escolhida
    expect(home).toContain("https://exemplo.com/foto.jpg");
  });

  it("usa um destaque decorativo no hero dividido quando não há imagem de capa", () => {
    const brief = { name: "Estúdio Aurora", heroStyle: "dividido" };
    const home = makeSite(brief, "", "estudio-aurora");
    expect(home).toContain("hero-decor");
    expect(home).not.toContain("<img");
  });
});

describe("integrações reais com ferramentas externas", () => {
  it("reconhece telefone e e-mail no campo de contato do lead", () => {
    expect(contactLinks("(11) 98888-7777")).toEqual({
      phone: "5511988887777",
      email: "",
    });
    expect(contactLinks("cliente@empresa.com")).toEqual({
      phone: "",
      email: "cliente@empresa.com",
    });
    expect(contactLinks("55 11 98888-7777")).toEqual({
      phone: "5511988887777",
      email: "",
    });
    expect(contactLinks("")).toEqual({ phone: "", email: "" });
    expect(contactLinks("abc")).toEqual({ phone: "", email: "" });
  });

  it("monta o link do Google Agenda a partir do prazo da tarefa", () => {
    const url = googleCalendarUrl({
      title: "Enviar proposta",
      due: "2026-03-10",
      project: "Campanha de março",
      assignee: "Bruna",
    });
    expect(url).toContain("calendar.google.com/calendar/render?action=TEMPLATE");
    expect(url).toContain("text=Enviar%20proposta");
    expect(url).toContain("dates=20260310/20260311");
    expect(url).toContain(encodeURIComponent("Campanha de março"));
    expect(googleCalendarUrl({ title: "Sem prazo" })).toBe("");
  });

  it("monta o link com horário quando o compromisso tem hora marcada", () => {
    const url = googleCalendarUrl({
      title: "Banho e tosa - Rex",
      due: "2026-05-01",
      time: "23:45",
      durationMinutes: 30,
    });
    expect(url).toContain("dates=20260501T234500/20260502T001500");
  });

  it("soma dias preservando o fuso (sem pular dia)", () => {
    expect(addDaysYmd("2026-01-31", 1)).toBe("20260201");
    expect(addDaysYmd("2026-12-31", 1)).toBe("20270101");
  });

  it("calcula prazo em dias úteis pulando sábado e domingo", () => {
    // 2024-01-01 é uma segunda-feira (referência conhecida)
    expect(addBusinessDays("2024-01-05", 1)).toBe("2024-01-08"); // sexta + 1 dia útil = segunda
    expect(addBusinessDays("2024-01-01", 5)).toBe("2024-01-08"); // segunda + 5 dias úteis = próxima segunda
  });

  it("conta dias úteis entre duas datas sem contar fim de semana", () => {
    expect(businessDaysBetween("2024-01-01", "2024-01-08")).toBe(5);
    expect(businessDaysBetween("2024-01-05", "2024-01-08")).toBe(1);
    expect(businessDaysBetween("2024-01-08", "2024-01-01")).toBe(-5);
    expect(businessDaysBetween("2024-01-05", "2024-01-05")).toBe(0);
  });

  describe("com permissão do Google concedida", () => {
    beforeEach(() => {
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient: ({ callback }) => ({
              requestAccessToken: () => callback({ access_token: "token-123" }),
            }),
          },
        },
      };
    });

    afterEach(() => {
      delete window.google;
      vi.unstubAllGlobals();
    });

    it("envia e-mail de verdade pela Gmail API com o token obtido", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ id: "msg1" }) });
      vi.stubGlobal("fetch", fetchMock);

      const result = await sendGmailReal("client-id", {
        to: "cliente@empresa.com",
        subject: "Proposta",
        body: "Segue a proposta combinada.",
      });

      expect(result).toEqual({ id: "msg1" });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      );
      expect(options.headers.authorization).toBe("Bearer token-123");
      expect(JSON.parse(options.body).raw).toBeTruthy();
    });

    it("cria evento de verdade na Google Agenda com datas no formato esperado", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ id: "evt1" }) });
      vi.stubGlobal("fetch", fetchMock);

      await createGoogleCalendarEventReal("client-id", {
        title: "Reunião com cliente",
        due: "2026-05-01",
      });

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.summary).toBe("Reunião com cliente");
      expect(body.start).toEqual({ date: "2026-05-01" });
      expect(body.end).toEqual({ date: "2026-05-02" });
    });

    it("cria evento de horário marcado (agendamento) com dateTime e fuso de São Paulo", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ id: "evt2" }) });
      vi.stubGlobal("fetch", fetchMock);

      await createGoogleCalendarEventReal("client-id", {
        title: "Banho e tosa - Rex",
        due: "2026-05-01",
        time: "23:45",
        durationMinutes: 30,
      });

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.start).toEqual({
        dateTime: "2026-05-01T23:45:00",
        timeZone: "America/Sao_Paulo",
      });
      // 23:45 + 30min cruza a meia-noite para o dia seguinte
      expect(body.end).toEqual({
        dateTime: "2026-05-02T00:15:00",
        timeZone: "America/Sao_Paulo",
      });
    });
  });

  it("recusa enviar e-mail real quando o Google não está configurado", async () => {
    await expect(
      sendGmailReal("", { to: "cliente@empresa.com" }),
    ).rejects.toThrow(/configurada/i);
  });
});

describe("agenda de contatos unificada", () => {
  it("cria um contato novo quando não há nenhum correspondente", () => {
    const result = upsertContact([], {
      name: "Ana Souza",
      contact: "(11) 98888-7777",
      company: "Ateliê Ana",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "Ana Souza",
      phone: "5511988887777",
      email: "",
      company: "Ateliê Ana",
    });
  });

  it("atualiza (não duplica) um contato já existente pelo telefone", () => {
    const existing = [
      {
        id: "c1",
        name: "Ana",
        phone: "5511988887777",
        email: "",
        rawContact: "(11) 98888-7777",
        company: "",
        notes: "Cliente antiga",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const result = upsertContact(existing, {
      name: "Ana Souza",
      contact: "(11) 98888-7777",
      company: "Ateliê Ana",
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Ana Souza");
    expect(result[0].company).toBe("Ateliê Ana");
    expect(result[0].notes).toBe("Cliente antiga"); // não apaga o que já existia
  });

  it("ignora quando não há nome nem contato", () => {
    const existing = [];
    expect(upsertContact(existing, { name: "", contact: "" })).toBe(existing);
  });
});

describe("importação de documentos", () => {
  it("identifica formatos e extrai texto sem armazenar o binário", async () => {
    const bytes = new TextEncoder().encode("Conteúdo útil do documento.");
    const file = {
      name: "plano_de_acao.md",
      type: "text/markdown",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    };
    expect(documentFileKind(file)).toEqual({
      id: "text",
      label: "Documento importado",
    });
    expect(documentTitleFromFilename(file.name)).toBe("plano de acao");
    await expect(extractDocumentText(file)).resolves.toMatchObject({
      content: "Conteúdo útil do documento.",
      truncated: false,
    });
  });

  it("extrai conteúdo de um arquivo DOCX real", async () => {
    const { Document, Packer, Paragraph } = await import("docx");
    const doc = new Document({
      sections: [
        {
          children: [new Paragraph("Contrato de prestação de serviços")],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    const file = {
      name: "contrato.docx",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: buffer.byteLength,
      arrayBuffer: async () =>
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ),
    };
    await expect(extractDocumentText(file)).resolves.toMatchObject({
      content: "Contrato de prestação de serviços",
    });
  });

  it("extrai texto selecionável de um arquivo PDF real", async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF();
    pdf.text("Relatorio financeiro mensal", 20, 20);
    const arrayBuffer = pdf.output("arraybuffer");
    const file = {
      name: "relatorio.pdf",
      type: "application/pdf",
      size: arrayBuffer.byteLength,
      arrayBuffer: async () => arrayBuffer,
    };
    await expect(extractDocumentText(file)).resolves.toMatchObject({
      content: expect.stringContaining("Relatorio financeiro mensal"),
    });
  });
});
