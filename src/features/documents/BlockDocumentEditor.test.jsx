// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BlockDocumentEditor from "./BlockDocumentEditor.jsx";
import {
  createDocumentBlock,
  normalizeSyncedBlock,
} from "./blockDocumentDomain.js";

const business = { id: "business-doc", name: "Empresa" };
const baseDb = {
  user: { id: "user-doc", name: "Renata" },
  documents: [{ id: "document-1", title: "Contrato", type: "Documento" }],
  databases: [
    {
      id: "database-1",
      name: "Clientes",
      fields: [{ id: "name", name: "Nome" }],
      rows: [{ id: "row-1", cells: { name: "Cliente Alfa" } }],
    },
  ],
  projects: [{ id: "project-1", name: "Implantação" }],
  tasks: [
    {
      id: "task-1",
      title: "Validar entrega",
      projectId: "project-1",
      status: "Em andamento",
    },
  ],
  publicForms: [
    {
      id: "form-1",
      name: "Solicitação",
      slug: "solicitacao",
      description: "Envie sua solicitação.",
      fields: [{ id: "field-1", label: "Assunto", required: true }],
    },
  ],
};

function Harness({
  initial = [createDocumentBlock("paragraph", { text: "Introdução" })],
  initialSynced = [],
  onBlocks = () => {},
}) {
  const [blocks, setBlocks] = useState(initial);
  const [syncedBlocks, setSyncedBlocks] = useState(initialSynced);
  const change = (next) => {
    setBlocks(next);
    onBlocks(next);
  };
  const createSynced = () => {
    const item = normalizeSyncedBlock(
      { id: "sync-created", name: "Novo conteúdo", content: "" },
      { ownerId: "user-doc", businessId: "business-doc" },
    );
    setSyncedBlocks((current) => [item, ...current]);
    return item.id;
  };
  const updateSynced = (id, patch) =>
    setSyncedBlocks((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  return (
    <BlockDocumentEditor
      blocks={blocks}
      onChange={change}
      db={baseDb}
      business={business}
      syncedBlocks={syncedBlocks}
      onCreateSyncedBlock={createSynced}
      onUpdateSyncedBlock={updateSynced}
    />
  );
}

describe("interface do editor universal em blocos", () => {
  afterEach(cleanup);

  it("adiciona, edita, move, duplica e remove blocos", () => {
    const onBlocks = vi.fn();
    render(<Harness onBlocks={onBlocks} />);

    fireEvent.change(screen.getByLabelText("Novo bloco"), {
      target: { value: "heading" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar bloco" }));
    fireEvent.change(screen.getByLabelText("Texto"), {
      target: { value: "Resumo executivo" },
    });

    expect(screen.getByText("2 bloco(s)")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("Mover para cima")[1]);
    fireEvent.click(screen.getAllByTitle("Duplicar bloco")[0]);
    expect(screen.getByText("3 bloco(s)")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("Excluir bloco")[0]);
    expect(screen.getByText("2 bloco(s)")).toBeInTheDocument();
    expect(onBlocks).toHaveBeenCalled();
  });

  it("edita checklist, tabela, gráfico e colunas", () => {
    render(
      <Harness
        initial={[
          createDocumentBlock("checklist"),
          createDocumentBlock("table"),
          createDocumentBlock("chart"),
          createDocumentBlock("columns"),
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Texto do item"), {
      target: { value: "Publicar relatório" },
    });
    fireEvent.click(screen.getByLabelText("Concluir Publicar relatório"));
    fireEvent.change(screen.getByLabelText("Colunas separadas por |"), {
      target: { value: "Indicador | Resultado" },
    });
    fireEvent.change(screen.getByLabelText("Categorias, uma por linha"), {
      target: { value: "Receita\nMargem" },
    });
    fireEvent.change(screen.getByLabelText("Conteúdo da coluna 1"), {
      target: { value: "Resumo da primeira coluna" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Visualizar" }));

    expect(screen.getByText("Publicar relatório")).toBeInTheDocument();
    expect(screen.getByText("Indicador")).toBeInTheDocument();
    expect(screen.getByText("Receita")).toBeInTheDocument();
    expect(screen.getByText("Resumo da primeira coluna")).toBeInTheDocument();
  });

  it("incorpora base, tarefas e formulário usando dados reais", () => {
    render(
      <Harness
        initial={[
          createDocumentBlock("database", { databaseId: "database-1" }),
          createDocumentBlock("tasks", {
            projectId: "project-1",
            filter: "all",
          }),
          createDocumentBlock("form", { formId: "form-1" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Visualizar" }));

    expect(screen.getByText("Clientes")).toBeInTheDocument();
    expect(screen.getByText("Cliente Alfa")).toBeInTheDocument();
    expect(screen.getByText("Validar entrega")).toBeInTheDocument();
    expect(screen.getByText("Solicitação")).toBeInTheDocument();
    expect(screen.getByText("Assunto *")).toBeInTheDocument();
  });

  it("cria e atualiza conteúdo sincronizado refletido na visualização", async () => {
    render(<Harness initial={[createDocumentBlock("synced")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Novo conteúdo" }));

    const content = await screen.findByLabelText("Conteúdo compartilhado");
    fireEvent.change(screen.getByLabelText("Nome do componente"), {
      target: { value: "Política vigente" },
    });
    fireEvent.change(content, {
      target: { value: "Esta regra aparece em todos os documentos." },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Visualizar" }));

    await waitFor(() =>
      expect(screen.getByText("Política vigente")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Esta regra aparece em todos os documentos."),
    ).toBeInTheDocument();
    expect(screen.getByText("Sincronizado")).toBeInTheDocument();
  });

  it("preserva a digitação de uma URL até a validação no salvamento", () => {
    const onBlocks = vi.fn();
    render(
      <Harness
        initial={[createDocumentBlock("image")]}
        onBlocks={onBlocks}
      />,
    );
    const input = screen.getByLabelText("URL HTTPS");
    fireEvent.change(input, { target: { value: "https://" } });

    expect(input).toHaveValue("https://");
    expect(onBlocks.mock.calls.at(-1)[0][0].url).toBe("https://");
  });

  it("mantém componente compartilhado de consulta em modo somente leitura", () => {
    const synced = normalizeSyncedBlock(
      {
        id: "sync-readonly",
        name: "Política protegida",
        content: "Somente consulta",
        ownerId: "another-user",
        visibility: "espaco_todo",
        sharingPermission: "visualizar",
      },
      { businessId: "business-doc" },
    );
    render(
      <BlockDocumentEditor
        blocks={[
          createDocumentBlock("synced", {
            syncedBlockId: "sync-readonly",
          }),
        ]}
        onChange={vi.fn()}
        db={baseDb}
        business={business}
        syncedBlocks={[synced]}
        onUpdateSyncedBlock={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Nome do componente")).toBeDisabled();
    expect(screen.getByLabelText("Conteúdo compartilhado")).toBeDisabled();
    expect(screen.getByText(/somente o proprietário/)).toBeInTheDocument();
  });
});
