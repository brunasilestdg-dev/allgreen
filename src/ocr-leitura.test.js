import { beforeEach, describe, expect, it, vi } from "vitest";

// O motor de OCR de verdade roda no navegador e baixa o idioma da CDN; aqui ele
// é simulado para verificar o que o leitor FAZ com o resultado. O caminho real
// foi conferido em Chromium (foto e PDF digitalizado).
const ocr = vi.hoisted(() => {
  const state = { options: null };
  const recognize = vi.fn();
  const terminate = vi.fn(async () => {});
  const createWorker = vi.fn(async (_lang, _oem, options) => {
    state.options = options;
    return { recognize, terminate };
  });
  return { state, recognize, terminate, createWorker };
});
vi.mock("tesseract.js", () => ({ createWorker: ocr.createWorker }));

import {
  OCR_PAGE_LIMIT,
  cleanOcrText,
  documentFileKind,
  extractDocumentText,
} from "./components/leituraDeArquivo.js";

const imagem = (nome = "recibo.jpg", tipo = "image/jpeg") =>
  new File([new Uint8Array([1, 2, 3, 4])], nome, { type: tipo });

const pdfSemTexto = async (paginas) => {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF();
  pdf.rect(10, 10, 50, 50);
  for (let i = 1; i < paginas; i += 1) {
    pdf.addPage();
    pdf.rect(10, 10, 50, 50);
  }
  const buffer = pdf.output("arraybuffer");
  return {
    name: "contrato-escaneado.pdf",
    type: "application/pdf",
    size: buffer.byteLength,
    arrayBuffer: async () => buffer,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  ocr.state.options = null;
});

describe("leitura de arquivos com OCR", () => {
  it("aceita as imagens que o OCR lê e continua recusando SVG", () => {
    for (const nome of ["a.png", "b.jpg", "c.JPEG", "d.webp", "e.bmp"])
      expect(documentFileKind({ name: nome })?.id, nome).toBe("image");
    expect(documentFileKind({ name: "logo.svg" })).toBeNull();
    expect(documentFileKind({ name: "arquivo.zip" })).toBeNull();
  });

  it("lê o texto de uma foto em português, no aparelho", async () => {
    ocr.recognize.mockResolvedValueOnce({
      data: { text: "Recibo   \nValor R$ 150,00\n\n\n\nObrigado" },
    });
    const lido = await extractDocumentText(imagem());
    expect(ocr.createWorker).toHaveBeenCalledWith("por", 1, expect.any(Object));
    expect(lido.content).toBe("Recibo\nValor R$ 150,00\n\nObrigado");
    expect(lido.kind.id).toBe("image");
    expect(lido.ocr).toEqual({ pages: 1, totalPages: 1 });
    expect(lido.truncated).toBe(false);
    expect(ocr.terminate).toHaveBeenCalled();
  });

  it("informa o andamento da leitura", async () => {
    ocr.recognize.mockImplementationOnce(async () => {
      ocr.state.options.logger({ status: "recognizing text", progress: 0.5 });
      return { data: { text: "Nota fiscal" } };
    });
    const andamento = vi.fn();
    await extractDocumentText(imagem("nota.png", "image/png"), { onProgress: andamento });
    expect(andamento).toHaveBeenCalledWith({ page: 1, pages: 1, progress: 50 });
  });

  it("explica quando a foto não tem texto legível", async () => {
    ocr.recognize.mockResolvedValueOnce({ data: { text: "  \n " } });
    await expect(extractDocumentText(imagem())).rejects.toThrow(/texto legível na imagem/);
    expect(ocr.terminate).toHaveBeenCalled();
  });

  it("separa falha de rede ao preparar o leitor de falha ao ler o arquivo", async () => {
    ocr.createWorker.mockRejectedValueOnce(new Error("Failed to fetch"));
    await expect(extractDocumentText(imagem())).rejects.toThrow(/preparar o leitor de texto/);

    ocr.recognize.mockRejectedValueOnce(new Error("Error attempting to read image."));
    await expect(extractDocumentText(imagem())).rejects.toThrow(/Não consegui ler o texto deste arquivo/);
    expect(ocr.terminate).toHaveBeenCalled();
  });

  it("lê PDF digitalizado página a página, até o limite, e marca como truncado", async () => {
    const arquivo = await pdfSemTexto(OCR_PAGE_LIMIT + 2);
    const renderPage = vi.fn(async (_pdf, indice) => ({ pagina: indice }));
    ocr.recognize.mockImplementation(async (imagemDaPagina) => ({
      data: { text: `Cláusula da página ${imagemDaPagina.pagina}` },
    }));
    const lido = await extractDocumentText(arquivo, { renderPage });
    expect(renderPage).toHaveBeenCalledTimes(OCR_PAGE_LIMIT);
    expect(lido.content).toContain("Cláusula da página 1");
    expect(lido.content).toContain(`Cláusula da página ${OCR_PAGE_LIMIT}`);
    expect(lido.content).not.toContain(`Cláusula da página ${OCR_PAGE_LIMIT + 1}`);
    expect(lido.ocr).toEqual({ pages: OCR_PAGE_LIMIT, totalPages: OCR_PAGE_LIMIT + 2 });
    expect(lido.truncated).toBe(true);
    // Um leitor só para todas as páginas, e ele é encerrado no fim.
    expect(ocr.createWorker).toHaveBeenCalledTimes(1);
    expect(ocr.terminate).toHaveBeenCalledTimes(1);
  });

  it("PDF com texto selecionável não passa pelo OCR", async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF();
    pdf.text("Relatorio financeiro mensal", 20, 20);
    const buffer = pdf.output("arraybuffer");
    const lido = await extractDocumentText({
      name: "relatorio.pdf",
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    });
    expect(lido.content).toContain("Relatorio financeiro mensal");
    expect(lido.ocr).toBeNull();
    expect(ocr.createWorker).not.toHaveBeenCalled();
  });

  it("limpa espaços no fim da linha e buracos de linhas em branco", () => {
    expect(cleanOcrText("a  \n\n\n\nb\t\n")).toBe("a\n\nb");
    expect(cleanOcrText(undefined)).toBe("");
  });
});
