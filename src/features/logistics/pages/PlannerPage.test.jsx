/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlannerPage from "./PlannerPage.jsx";

const PLANO = {
  id: "plano-1",
  name: "Marketing",
  description: "",
  color: "#1d4f91",
  visibility: "private",
  members: [],
  ownerUserId: "u1",
  revision: 3,
  buckets: [{ id: "a_fazer", nome: "A fazer" }, { id: "em_andamento", nome: "Em andamento" }],
};

const tarefa = (extra) => ({
  id: extra.id,
  title: extra.title,
  status: extra.status || "A fazer",
  priority: extra.priority || "Média",
  due: extra.due || "",
  startDate: extra.startDate || "",
  assignee: extra.assignee || "",
  assigneeId: extra.assigneeId || "",
  plannerPlanId: "plano-1",
  plannerBucketId: extra.bucket || "a_fazer",
  plannerLabels: extra.labels || [],
  plannerChecklist: extra.checklist || [],
});

const TAREFAS = [
  tarefa({ id: "t1", title: "Estudar estratégia da campanha", priority: "Urgente", due: "2026-06-06", labels: ["Social"], assignee: "Bruna Siles", assigneeId: "u1" }),
  tarefa({ id: "t2", title: "Elaboração de artigo", bucket: "em_andamento", status: "Em andamento", labels: ["Blog"] }),
  tarefa({ id: "t3", title: "Organizar as pastas", bucket: "em_andamento", status: "Concluído" }),
];

const jsonOk = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

let fetchMock;
const stubRede = (planos = [PLANO]) => {
  fetchMock = vi.fn(async (url, options = {}) => {
    const alvo = String(url);
    if (alvo.endsWith("/planner/planos") && !options.method) return jsonOk({ registros: planos });
    if (alvo.endsWith("/planner/pessoas")) return jsonOk({ registros: [{ id: "u1", name: "Bruna Siles", email: "bruna@x.com" }] });
    if (alvo.includes("/api/collab")) return jsonOk({ owner: { id: "u1", name: "Bruna Siles" }, members: [] });
    if (options.method === "PATCH" && alvo.includes("/planner/planos/plano-1")) {
      const corpo = JSON.parse(options.body);
      return jsonOk({ ...PLANO, ...corpo, revision: PLANO.revision + 1 });
    }
    return jsonOk({});
  });
  vi.stubGlobal("fetch", fetchMock);
};

// `role` aqui é o papel no espaço (owner/admin/…), não um ARIA role — vai por
// spread para o lint de acessibilidade não o confundir com o atributo HTML.
const PAPEL = { role: "owner" };

const renderizar = (props = {}) => render(
  <PlannerPage
    authHeaders={() => ({})}
    currentUserId="u1"
    {...PAPEL}
    canonicalTasks={TAREFAS}
    onUpsertCanonicalTask={props.onUpsert || vi.fn()}
    onDeleteCanonicalTask={vi.fn()}
    onNavigate={props.onNavigate || vi.fn()}
    setToast={vi.fn()}
  />,
);

describe("Planner no formato Microsoft Planner", () => {
  beforeEach(() => { window.localStorage.clear(); stubRede(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("mostra o rail de planos, a trilha e o quadro com uma coluna por balde", async () => {
    renderizar();
    expect(await screen.findByRole("heading", { name: "Marketing" })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "Planos" });
    expect(within(rail).getByRole("button", { name: /Marketing/ })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: /Minhas tarefas/ })).toBeInTheDocument();

    const quadro = screen.getByLabelText("Quadro de tarefas");
    const colunaAFazer = within(quadro).getByLabelText("A fazer");
    const colunaAndamento = within(quadro).getByLabelText("Em andamento");
    expect(within(colunaAFazer).getByText("Estudar estratégia da campanha")).toBeInTheDocument();
    expect(within(colunaAndamento).getByText("Elaboração de artigo")).toBeInTheDocument();
    // Rótulo colorido e avatar com iniciais, como no Planner.
    expect(within(colunaAFazer).getByText("Social")).toBeInTheDocument();
    expect(within(colunaAFazer).getByRole("img", { name: "Bruna Siles" })).toHaveTextContent("BS");
    // A concluída fica dobrada, não no meio das vivas.
    expect(within(colunaAndamento).queryByText("Organizar as pastas")).not.toBeInTheDocument();
    fireEvent.click(within(colunaAndamento).getByRole("button", { name: /Concluída/ }));
    expect(within(colunaAndamento).getByText("Organizar as pastas")).toBeInTheDocument();
    // Abas das vistas e a coluna para criar balde.
    expect(screen.getByRole("tab", { name: "Quadro" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /Adicionar balde/ })).toBeInTheDocument();
  });

  it("arrastar um cartão para outro balde grava a tarefa canônica com o novo balde", async () => {
    const onUpsert = vi.fn();
    renderizar({ onUpsert });
    await screen.findByRole("heading", { name: "Marketing" });
    const quadro = screen.getByLabelText("Quadro de tarefas");
    const cartao = within(quadro).getByRole("article", { name: "Tarefa Estudar estratégia da campanha" });
    const destino = within(quadro).getByLabelText("Em andamento");
    fireEvent.dragStart(cartao);
    fireEvent.dragOver(destino);
    fireEvent.drop(destino);
    expect(onUpsert).toHaveBeenCalledTimes(1);
    const [gravada, plano] = onUpsert.mock.calls[0];
    expect(gravada).toMatchObject({ id: "t1", bucketId: "em_andamento", planId: "plano-1" });
    expect(plano.id).toBe("plano-1");
  });

  it("'+ Adicionar tarefa' no topo do balde cria a tarefa naquele balde", async () => {
    const onUpsert = vi.fn();
    renderizar({ onUpsert });
    await screen.findByRole("heading", { name: "Marketing" });
    const coluna = within(screen.getByLabelText("Quadro de tarefas")).getByLabelText("Em andamento");
    fireEvent.click(within(coluna).getByRole("button", { name: /Adicionar tarefa/ }));
    const campo = within(coluna).getByLabelText("Nova tarefa em Em andamento");
    fireEvent.change(campo, { target: { value: "Publicar artigo" } });
    fireEvent.submit(campo.closest("form"));
    expect(onUpsert).toHaveBeenCalledWith(expect.objectContaining({ title: "Publicar artigo", bucketId: "em_andamento", progress: "nao_iniciada" }), expect.objectContaining({ id: "plano-1" }));
  });

  it("adicionar e renomear balde fazem PATCH no plano com a revision lida", async () => {
    renderizar();
    await screen.findByRole("heading", { name: "Marketing" });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar balde/ }));
    const campo = screen.getByLabelText("Nome do novo balde");
    fireEvent.change(campo, { target: { value: "Finalizada" } });
    fireEvent.submit(campo.closest("form"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/planner/planos/plano-1"), expect.objectContaining({ method: "PATCH" })));
    const patch = fetchMock.mock.calls.find(([, o]) => o?.method === "PATCH");
    const corpo = JSON.parse(patch[1].body);
    expect(corpo.revision).toBe(3);
    expect(corpo.buckets).toEqual([...PLANO.buckets, { id: "finalizada", nome: "Finalizada" }]);
    // A resposta do servidor vira a coluna nova na hora.
    expect(await within(screen.getByLabelText("Quadro de tarefas")).findByLabelText("Finalizada")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Opções do balde Finalizada" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Renomear/ }));
    const renome = screen.getByLabelText("Nome do balde");
    fireEvent.change(renome, { target: { value: "Entregue" } });
    fireEvent.submit(renome.closest("form"));
    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(([, o]) => o?.method === "PATCH");
      expect(patches).toHaveLength(2);
      const ultimo = JSON.parse(patches[1][1].body);
      expect(ultimo.buckets[2]).toEqual({ id: "finalizada", nome: "Entregue" });
      expect(ultimo.revision).toBe(4);
    });
  });

  it("troca para Tabela, Linha do tempo e Gráficos sem perder as tarefas", async () => {
    renderizar();
    await screen.findByRole("heading", { name: "Marketing" });
    fireEvent.click(screen.getByRole("tab", { name: "Tabela" }));
    expect(screen.getByRole("columnheader", { name: /Nome da tarefa/ })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: /Estudar estratégia/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Progresso de Elaboração de artigo")).toHaveValue("em_andamento");

    fireEvent.click(screen.getByRole("tab", { name: "Linha do tempo" }));
    expect(screen.getByRole("button", { name: "Hoje" })).toBeInTheDocument();
    // Tarefas sem prazo são listadas, não somem.
    expect(screen.getByText(/Sem prazo/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Gráficos" }));
    expect(screen.getByRole("heading", { name: "Faça agora" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tarefas por balde")).toBeInTheDocument();
    // A vista escolhida fica gravada por navegador.
    expect(JSON.parse(window.localStorage.getItem("todogreen-planner-vista"))).toBe("graficos");
  });

  it("os filtros escondem status e contam o que está ativo", async () => {
    renderizar();
    await screen.findByRole("heading", { name: "Marketing" });
    fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    const dialogo = screen.getByRole("dialog", { name: "Filtros" });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Não iniciada" }));
    expect(screen.getByRole("button", { name: /^Filtros/ })).toHaveTextContent("1");
    const quadro = screen.getByLabelText("Quadro de tarefas");
    expect(within(quadro).queryByText("Estudar estratégia da campanha")).not.toBeInTheDocument();
    expect(within(quadro).getByText("Elaboração de artigo")).toBeInTheDocument();
    expect(screen.getByText("2 de 3")).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Limpar/ }));
    expect(within(quadro).getByText("Estudar estratégia da campanha")).toBeInTheDocument();
  });

  it("'Quadro To Do' continua levando ao lugar único de tarefas", async () => {
    const onNavigate = vi.fn();
    renderizar({ onNavigate });
    await screen.findByRole("heading", { name: "Marketing" });
    fireEvent.click(screen.getByRole("button", { name: /Quadro To Do/ }));
    expect(onNavigate).toHaveBeenCalledWith("/todogreen/espaco?ferramenta=tarefas");
  });

  it("sem planos, mostra o convite para criar o primeiro", async () => {
    stubRede([]);
    renderizar();
    expect(await screen.findByRole("heading", { name: "Crie o primeiro plano" })).toBeInTheDocument();
  });
});
