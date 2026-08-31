/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// O leitor de xlsx é substituído pelas linhas cruas do export: o que se quer
// provar aqui é a conversão e a gravação, não a biblioteca de leitura.
const PROJETOS = [
  ["Projetos em Andamento - Amazon"],
  ["Nome", "Subelementos", "Responsável", "Funil", "Prioridade", "Status", "Faturamento Anual Esperado", "Faturamento Mensal Esperado", "Data Inicio", "Data Proposta", "Data Finalização", "Update Summary"],
  ["AMXL ABC", "", "Claudio", "Negociação", "Alta", "Em andamento", 1480000, 370000, "2026-09-01 00:00:00", "", "", ""],
  [],
  ["Projetos em Andamento - Novos Clientes"],
  ["Nome", "Subelementos", "Responsável", "Funil", "Prioridade", "Status", "Faturamento Anual Esperado", "Faturamento Mensal Esperado", "Data Inicio", "Data Proposta", "Data Finalização", "Update Summary"],
  ["Projeto DHL", "", "Valentin", "Homologação", "Alta", "Em andamento", 3600000, 300000, "2026-04-07 00:00:00", "", "", ""],
];
const UPDATES = [
  ["Item ID", "Item Name", "Content Type", "Content Type", "User", "Created At", "Update Content", "Likes Count", "Asset IDs", "Post ID", "Parent Post ID"],
  ["1", "Projeto DHL", "Update", "", "Valentin Manfrin", "03/March/2026  05:56:21 PM", "Reunião de apresentação dia 18/03", 0, "", "497", ""],
];

vi.mock("read-excel-file", () => ({
  default: (_arquivo, opcoes) => Promise.resolve(opcoes?.sheet === "updates" ? UPDATES : PROJETOS),
  readSheetNames: () => Promise.resolve(["projetos", "updates"]),
}));

const { default: ImportarPipelineModal } = await import("./ImportarPipelineModal.jsx");

const enviarPlanilha = async () => {
  const entrada = screen.getByLabelText("Planilha do quadro");
  const arquivo = new File(["conteudo"], "quadro.xlsx", { type: "application/vnd.ms-excel" });
  fireEvent.change(entrada, { target: { files: [arquivo] } });
  expect(await screen.findByText(/oportunidades que vão entrar/)).toBeInTheDocument();
};

describe("importar o pipeline do quadro", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("mostra a prévia antes de gravar qualquer coisa", async () => {
    const onCriarOportunidade = vi.fn();
    render(<ImportarPipelineModal aberto onClose={vi.fn()} authHeaders={() => ({})} onCriarOportunidade={onCriarOportunidade} onCriarInteracao={vi.fn()} setToast={vi.fn()} />);
    await enviarPlanilha();

    expect(screen.getByText("Contas").closest("article")).toHaveTextContent("2");
    expect(screen.getByText("Interações").closest("article")).toHaveTextContent("1");
    expect(screen.getByText(/670.000/)).toBeInTheDocument();
    // Ler o arquivo não grava nada: a gravação é um segundo passo, explícito.
    expect(onCriarOportunidade).not.toHaveBeenCalled();
  });

  it("grava contas, oportunidades e interações com o vínculo certo", async () => {
    const chamadas = [];
    vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
      chamadas.push({ url, body: JSON.parse(options.body || "{}") });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }));
    const criadas = [];
    const onCriarOportunidade = vi.fn(async (registro) => {
      criadas.push(registro);
      return { id: `opp-${criadas.length}`, ...registro };
    });
    const onCriarInteracao = vi.fn().mockResolvedValue({});

    render(<ImportarPipelineModal aberto onClose={vi.fn()} authHeaders={() => ({ authorization: "Bearer t" })} onCriarOportunidade={onCriarOportunidade} onCriarInteracao={onCriarInteracao} setToast={vi.fn()} />);
    await enviarPlanilha();
    fireEvent.click(screen.getByRole("button", { name: /Importar tudo/ }));

    await waitFor(() => expect(screen.getByText("Importação concluída")).toBeInTheDocument());

    // Contas entram pelo mesmo caminho da importação de CRM, em lote.
    expect(chamadas[0].url).toBe("/api/todogreen/clients/import");
    expect(chamadas[0].body.clientes.map((item) => item.nome)).toEqual(["Amazon", "DHL"]);

    expect(criadas).toHaveLength(2);
    expect(criadas[0]).toMatchObject({ cliente: "Amazon", estagio: "Negociação", valorMensal: 370000 });
    expect(criadas[0].campos).toMatchObject({ nomeDoProjeto: "AMXL ABC", prioridade: "Alta" });
    expect(criadas[0].clientId).toBe(criadas[0].clientId.toLowerCase());
    expect(criadas[0].clientId).toContain("amazon");

    // A interação do update entra na oportunidade do projeto, com autor e data
    // originais preservados.
    expect(onCriarInteracao).toHaveBeenCalledWith(expect.objectContaining({
      opportunityId: "opp-2",
      tipo: "reuniao",
      participantes: "Valentin Manfrin",
      ocorridaEm: "2026-03-03",
    }));
  });

  it("reimportar não duplica o que já está registrado", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))));
    const onCriarOportunidade = vi.fn().mockResolvedValue({ id: "novo" });
    const onCriarInteracao = vi.fn().mockResolvedValue({});

    render(<ImportarPipelineModal
      aberto
      onClose={vi.fn()}
      authHeaders={() => ({})}
      opportunities={[
        { id: "opp-existente", cliente: "DHL", campos: { nomeDoProjeto: "Projeto DHL" } },
        { id: "opp-amxl", cliente: "Amazon", campos: { nomeDoProjeto: "AMXL ABC" } },
      ]}
      interactions={[{ id: "i1", opportunityId: "opp-existente", assunto: "Reunião de apresentação dia 18/03", ocorridaEm: "2026-03-03" }]}
      onCriarOportunidade={onCriarOportunidade}
      onCriarInteracao={onCriarInteracao}
      setToast={vi.fn()}
    />);
    await enviarPlanilha();
    fireEvent.click(screen.getByRole("button", { name: /Importar tudo/ }));

    await waitFor(() => expect(screen.getByText("Importação concluída")).toBeInTheDocument());
    expect(onCriarOportunidade).not.toHaveBeenCalled();
    expect(onCriarInteracao).not.toHaveBeenCalled();
    expect(screen.getByText(/3 registro\(s\) já existiam/)).toBeInTheDocument();
  });
});
