// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
// Anexos deixaram de morar em App.jsx. O teste aponta para onde o código está —
// importar do agregador esconderia justamente o que a extração arrumou.
import {
  addAttachmentsFromFiles,
  buildAttachment,
} from "./components/Anexos.jsx";

class FakeImage {
  constructor() {
    this.width = 800;
    this.height = 600;
    this.naturalWidth = 800;
    this.naturalHeight = 600;
  }
  set src(value) {
    this._src = value;
    queueMicrotask(() => this.onload && this.onload());
  }
  get src() {
    return this._src;
  }
}

const stubCanvas = () => {
  vi.stubGlobal("Image", FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,QUFBQQ==",
  );
};

describe("buildAttachment / addAttachmentsFromFiles (funções puras)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("gera um anexo do tipo documento extraindo o texto, sem guardar o binário", async () => {
    const bytes = new TextEncoder().encode("Relatório do trabalho concluído.");
    const file = {
      name: "relatorio.md",
      type: "text/markdown",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    };
    const attachment = await buildAttachment(file);
    expect(attachment.kind).toBe("document");
    expect(attachment.name).toBe("relatorio.md");
    expect(attachment.content).toBe("Relatório do trabalho concluído.");
    expect(attachment.dataUrl).toBeUndefined();
  });

  it("gera um anexo do tipo imagem comprimindo o arquivo", async () => {
    stubCanvas();
    const file = new File([new Uint8Array([1, 2, 3, 4])], "foto.jpg", {
      type: "image/jpeg",
    });
    const attachment = await buildAttachment(file);
    expect(attachment.kind).toBe("image");
    expect(attachment.name).toBe("foto.jpg");
    expect(attachment.dataUrl).toBe("data:image/jpeg;base64,QUFBQQ==");
  });

  it("recusa uma imagem grande demais mesmo após tentar comprimir", async () => {
    vi.stubGlobal("Image", FakeImage);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      `data:image/jpeg;base64,${"A".repeat(600_000)}`,
    );
    const file = new File([new Uint8Array([1, 2, 3, 4])], "gigante.jpg", {
      type: "image/jpeg",
    });
    await expect(buildAttachment(file)).rejects.toThrow(/grande demais/);
  });

  it("limita a 5 anexos por item, ignorando o restante da seleção", async () => {
    const okBytes = new TextEncoder().encode("ok");
    const files = Array.from({ length: 6 }, (_, i) => ({
      name: `doc-${i}.txt`,
      type: "text/plain",
      size: okBytes.byteLength,
      arrayBuffer: async () => okBytes.buffer,
    }));
    const results = await addAttachmentsFromFiles(files, []);
    expect(results).toHaveLength(5);
  });

  it("reporta erro do arquivo que falhar, sem descartar os que deram certo", async () => {
    const okBytes = new TextEncoder().encode("ok");
    const goodFile = {
      name: "bom.txt",
      type: "text/plain",
      size: okBytes.byteLength,
      arrayBuffer: async () => okBytes.buffer,
    };
    const badFile = {
      name: "invalido.zip",
      type: "application/zip",
      size: okBytes.byteLength,
      arrayBuffer: async () => okBytes.buffer,
    };
    const errors = [];
    const results = await addAttachmentsFromFiles(
      [goodFile, badFile],
      [],
      (msg) => errors.push(msg),
    );
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("bom.txt");
    expect(errors).toEqual([
      expect.stringContaining("Formato não aceito"),
    ]);
  });
});

const user = {
  id: "user-attach",
  name: "Renata Silva",
  email: "renata@example.com",
};
const business = {
  id: "business-attach-1",
  name: "Negócio Teste",
  stage: "Estou estruturando o negócio",
  segment: "Serviços",
};

const businessDb = (overrides = {}) => ({
  user,
  onboarding: false,
  selectedBusinessId: business.id,
  businesses: [business],
  tasks: [],
  leads: [],
  appointments: [],
  products: [],
  orders: [],
  contacts: [],
  deliveryZones: [],
  vehicles: [],
  trips: [],
  developmentPlans: [],
  notifications: [],
  teams: [],
  projects: [],
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
  preferences: {
    theme: "light",
    specialist: "Diretor",
    mode: "business",
    modeChosen: true,
  },
  ...overrides,
});

const response = (data) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

const seedLoggedIn = (db) => {
  localStorage.setItem("seu-funcionario-auth-token", "token-attach");
  localStorage.setItem("seu-funcionario-active-user", user.id);
  localStorage.setItem(`seu-funcionario-v2:${user.id}`, JSON.stringify(db));
};

const stubFetch = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options = {}) => {
      if (url === "/api/auth/session") return response({ user });
      if (String(url).startsWith("/api/workspace"))
        return options.method === "PUT"
          ? response({ ok: true })
          : response({});
      if (url === "/api/config") return response({ videoEnabled: false });
      if (url === "/api/collab")
        return response({ members: [], invites: [], spaces: [] });
      return response({});
    }),
  );

describe("anexos em tarefas e entregas (fluxo na interface)", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("anexa um documento a uma tarefa e mostra o indicador de anexo no cartão", async () => {
    stubFetch();
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    const dialog = await screen.findByRole("dialog", { name: "Criar tarefa" });
    fireEvent.change(within(dialog).getByLabelText("Título"), {
      target: { value: "Entregar relatório" },
    });

    const bytes = new TextEncoder().encode("Conteúdo do relatório.");
    const file = new File([bytes], "relatorio.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => bytes.buffer,
    });
    const input = within(dialog).getByLabelText("Anexar arquivo à tarefa");
    fireEvent.change(input, { target: { files: [file] } });

    await within(dialog).findByText("relatorio.txt");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Criar tarefa" }),
    );

    await screen.findByText("Entregar relatório");
    expect(screen.getByTitle("1 anexo(s)")).toBeInTheDocument();
  });

  it("anexa uma imagem a uma entrega e o gestor vê o anexo ao revisar", async () => {
    stubCanvas();
    stubFetch();
    seedLoggedIn(
      businessDb({
        tasks: [
          {
            id: "task-attach-1",
            title: "Fazer a vitrine",
            status: "A fazer",
            priority: "Média",
            due: "",
            area: "Operação",
            businessId: business.id,
            ownerId: user.id,
            assigneeId: user.id,
            isMission: true,
            missionStatus: "em_andamento",
            deliveries: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Editar tarefa" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Editar tarefa" });

    fireEvent.change(
      within(dialog).getByLabelText("Comentário da entrega"),
      { target: { value: "Vitrine montada, foto em anexo." } },
    );
    const imageFile = new File([new Uint8Array([1, 2, 3])], "vitrine.jpg", {
      type: "image/jpeg",
    });
    const imageInput = within(dialog).getByLabelText("Anexar arquivo à entrega");
    fireEvent.change(imageInput, { target: { files: [imageFile] } });
    await within(dialog).findByText("vitrine.jpg");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Enviar entrega" }),
    );

    const reviewDialog = await screen.findByRole("dialog", {
      name: "Editar tarefa",
    });
    await within(reviewDialog).findByText("vitrine.jpg");
    expect(
      within(reviewDialog).getByAltText("vitrine.jpg"),
    ).toBeInTheDocument();
  });

  it("amplia a imagem do anexo ao clicar na miniatura e fecha com Escape", async () => {
    stubCanvas();
    stubFetch();
    seedLoggedIn(businessDb());
    render(<App />);
    await screen.findByRole("heading", { name: /Vamos fazer acontecer/ });
    fireEvent.click(screen.getByRole("button", { name: "Operação" }));
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    const dialog = await screen.findByRole("dialog", { name: "Criar tarefa" });
    fireEvent.change(within(dialog).getByLabelText("Título"), {
      target: { value: "Ver anexo" },
    });

    const imageFile = new File([new Uint8Array([1, 2, 3])], "foto.jpg", {
      type: "image/jpeg",
    });
    const input = within(dialog).getByLabelText("Anexar arquivo à tarefa");
    fireEvent.change(input, { target: { files: [imageFile] } });
    await within(dialog).findByText("foto.jpg");

    expect(
      screen.queryByRole("dialog", { name: "Imagem ampliada: foto.jpg" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Ver imagem ampliada de foto.jpg",
      }),
    );

    const lightbox = await screen.findByRole("dialog", {
      name: "Imagem ampliada: foto.jpg",
    });
    expect(within(lightbox).getByAltText("foto.jpg")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Imagem ampliada: foto.jpg" }),
      ).not.toBeInTheDocument(),
    );
  });
});
