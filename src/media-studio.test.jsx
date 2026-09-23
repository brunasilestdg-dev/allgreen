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
import MediaStudio from "./features/media/MediaStudio.jsx";

const business = { id: "b1", name: "Doces da Ana" };

const baseDb = (media = []) => ({
  user: { id: "u1", name: "Renata" },
  media,
  preferences: {},
});

const foto = (extra = {}) => ({
  id: "m1",
  type: "image",
  name: "Bolo de cenoura",
  url: "data:image/png;base64,AAAA",
  businessId: "b1",
  tags: [],
  createdAt: "2026-08-01T10:00:00.000Z",
  ...extra,
});

// `update` no app recebe uma função e devolve o banco novo. Aqui guardamos o
// resultado para poder afirmar sobre o que seria gravado.
const montar = (media = []) => {
  let db = baseDb(media);
  const update = vi.fn((fn) => {
    db = typeof fn === "function" ? fn(db) : fn;
    return db;
  });
  const setToast = vi.fn();
  const tela = render(
    <MediaStudio
      db={db}
      update={update}
      business={business}
      setToast={setToast}
    />,
  );
  return { update, setToast, atual: () => db, tela };
};

const abrirAba = (nome) =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp(nome, "i") }));

describe("Tela de mídia", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(cleanup);

  it("abre no editor de imagem e diz que nada sai do aparelho", () => {
    montar();
    expect(screen.getByText(/Escolher imagem/)).toBeInTheDocument();
    expect(
      screen.getByText(/não é enviada para lugar nenhum/i),
    ).toBeInTheDocument();
  });

  it("as três abas existem e trocam de conteúdo", async () => {
    montar();
    abrirAba("Áudio");
    expect(await screen.findByText("Recado de voz")).toBeInTheDocument();
    abrirAba("Biblioteca");
    expect(
      await screen.findByPlaceholderText(/Buscar por nome/),
    ).toBeInTheDocument();
  });

  it("recusa arquivo que não é imagem, explicando o motivo", async () => {
    montar();
    const entrada = document.querySelector('input[type="file"]');
    const arquivo = new File(["x"], "planilha.pdf", { type: "application/pdf" });
    fireEvent.change(entrada, { target: { files: [arquivo] } });
    expect(await screen.findByText(/Formato não aceito/)).toBeInTheDocument();
  });

  it("recusa SVG, porque SVG é código e pode carregar script", async () => {
    montar();
    const entrada = document.querySelector('input[type="file"]');
    const arquivo = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    fireEvent.change(entrada, { target: { files: [arquivo] } });
    expect(await screen.findByText(/Formato não aceito/)).toBeInTheDocument();
  });

  it("biblioteca vazia convida em vez de mostrar tela em branco", async () => {
    montar();
    abrirAba("Biblioteca");
    expect(
      await screen.findByText(/Ainda não há arquivos/),
    ).toBeInTheDocument();
  });

  it("mostra o que já existe e quanto ocupa", async () => {
    montar([foto()]);
    abrirAba("Biblioteca");
    expect(await screen.findByDisplayValue("Bolo de cenoura")).toBeInTheDocument();
    expect(screen.getByText(/1 arquivo\(s\)/)).toBeInTheDocument();
  });

  it("busca acha pelo nome e some com o resto", async () => {
    montar([foto(), foto({ id: "m2", name: "Logo azul", type: "logo" })]);
    abrirAba("Biblioteca");
    fireEvent.change(await screen.findByPlaceholderText(/Buscar por nome/), {
      target: { value: "logo" },
    });
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Bolo de cenoura")).not.toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("Logo azul")).toBeInTheDocument();
  });

  it("busca acha pelo que foi dito no áudio", async () => {
    montar([
      foto(),
      foto({
        id: "m3",
        name: "Recado",
        type: "audio",
        transcript: "confirmar entrega na quinta",
      }),
    ]);
    abrirAba("Biblioteca");
    fireEvent.change(await screen.findByPlaceholderText(/Buscar por nome/), {
      target: { value: "entrega" },
    });
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Bolo de cenoura")).not.toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("Recado")).toBeInTheDocument();
  });

  it("renomear guarda no espaço de trabalho", async () => {
    const { update, atual } = montar([foto()]);
    abrirAba("Biblioteca");
    fireEvent.change(await screen.findByDisplayValue("Bolo de cenoura"), {
      target: { value: "Bolo de fubá" },
    });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(atual().media[0].name).toBe("Bolo de fubá");
  });

  it("etiqueta entra ao teclar Enter", async () => {
    const { atual } = montar([foto()]);
    abrirAba("Biblioteca");
    const campo = await screen.findByLabelText(/Nova etiqueta/);
    fireEvent.change(campo, { target: { value: "produto" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(atual().media[0].tags).toEqual(["produto"]));
  });

  it("apagar tira o arquivo da biblioteca", async () => {
    const { atual } = montar([foto()]);
    abrirAba("Biblioteca");
    fireEvent.click(await screen.findByRole("button", { name: /Apagar/ }));
    await waitFor(() => expect(atual().media).toHaveLength(0));
  });

  it("apagar no negócio aberto não apaga a mídia do outro negócio", async () => {
    const { atual } = montar([foto(), foto({ id: "outro", businessId: "b2" })]);
    abrirAba("Biblioteca");
    fireEvent.click(await screen.findByRole("button", { name: /Apagar/ }));
    await waitFor(() =>
      expect(atual().media.map((m) => m.id)).toEqual(["outro"]),
    );
  });

  it("só mostra a mídia do negócio aberto", async () => {
    montar([foto(), foto({ id: "outro", name: "De outro negócio", businessId: "b2" })]);
    abrirAba("Biblioteca");
    expect(await screen.findByDisplayValue("Bolo de cenoura")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("De outro negócio")).not.toBeInTheDocument();
  });

  it("filtra por tipo", async () => {
    montar([foto(), foto({ id: "m2", name: "Logo azul", type: "logo" })]);
    abrirAba("Biblioteca");
    fireEvent.change(await screen.findByLabelText("Tipo de arquivo"), {
      target: { value: "logo" },
    });
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Bolo de cenoura")).not.toBeInTheDocument(),
    );
  });

  it("avisa quando a biblioteca está pesando no app", async () => {
    montar([foto({ bytes: 20 * 1024 * 1024 })]);
    abrirAba("Biblioteca");
    expect(await screen.findByText(/Baixe e apague/)).toBeInTheDocument();
  });

  it("o texto de áudio conta palavras e estima a locução", async () => {
    montar();
    abrirAba("Áudio");
    const campo = await screen.findByPlaceholderText(/Dite ou escreva/);
    fireEvent.change(campo, { target: { value: "uma duas três" } });
    expect(await screen.findByText(/3 palavras/)).toBeInTheDocument();
  });

  it("arrumar pontuação corrige o texto ditado", async () => {
    montar();
    abrirAba("Áudio");
    const campo = await screen.findByPlaceholderText(/Dite ou escreva/);
    fireEvent.change(campo, { target: { value: "bom dia , tudo bem ?" } });
    fireEvent.click(screen.getByRole("button", { name: /Arrumar pontuação/ }));
    await waitFor(() =>
      expect(screen.getByDisplayValue("Bom dia, tudo bem?")).toBeInTheDocument(),
    );
  });

  it("aparelho sem microfone não trava a tela: avisa e o resto funciona", async () => {
    montar();
    abrirAba("Áudio");
    // jsdom não tem MediaRecorder nem getUserMedia.
    expect(
      await screen.findByText(/não permite gravar áudio/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Gravar/ })).toBeDisabled();
    expect(screen.getByPlaceholderText(/Dite ou escreva/)).toBeEnabled();
  });

  it("ouvir só fica disponível quando há texto", async () => {
    montar();
    abrirAba("Áudio");
    const ouvir = await screen.findByRole("button", { name: /Ouvir/ });
    expect(ouvir).toBeDisabled();
  });

  it("o cartão mostra o resumo da edição, para diferenciar as versões", async () => {
    montar([foto({ note: "800×800 · recortada · WebP" })]);
    abrirAba("Biblioteca");
    const cartao = (await screen.findByDisplayValue("Bolo de cenoura")).closest(
      ".me-card",
    );
    expect(within(cartao).getByText(/800×800 · recortada · WebP/)).toBeInTheDocument();
  });
});
