import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_ACCEPT,
  documentFileKind,
  extractDocumentText,
} from "./components/leituraDeArquivo.js";

// OCR e planilha rodam no aparelho com libs pesadas (tesseract.js e
// read-excel-file); aqui elas são simuladas para exercitar o que o leitor faz
// com o resultado.
const recognize = vi.fn();
const terminate = vi.fn(async () => {});
vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async () => ({ recognize, terminate })),
}));
const readXlsxFile = vi.fn();
const readSheetNames = vi.fn();
vi.mock("read-excel-file", () => ({ default: readXlsxFile, readSheetNames }));

const arquivo = (name, conteudo = "x") => {
  const bytes = new TextEncoder().encode(conteudo);
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
};

describe("leitor comum de arquivos", () => {
  afterEach(() => {
    recognize.mockReset();
    terminate.mockClear();
    readXlsxFile.mockReset();
    readSheetNames.mockReset();
  });

  it("reconhece planilha .xlsx e fotos, além dos formatos de antes", () => {
    expect(documentFileKind({ name: "Clientes.XLSX" })).toEqual({ id: "xlsx", label: "Planilha Excel" });
    for (const nome of ["nota.jpg", "recibo.JPEG", "print.png", "scan.webp", "fax.bmp"])
      expect(documentFileKind({ name: nome })?.id).toBe("image");
    expect(documentFileKind({ name: "contrato.pdf" })?.id).toBe("pdf");
    expect(documentFileKind({ name: "arquivo.zip" })).toBeNull();
    expect(DOCUMENT_ACCEPT).toContain(".xlsx");
    expect(DOCUMENT_ACCEPT).toContain("image/jpeg");
  });

  it("lê o texto de uma foto por OCR em português e encerra o worker", async () => {
    recognize.mockResolvedValue({ data: { text: "  NOTA FISCAL\nTotal R$ 120,00  " } });
    const progresso = [];
    const lido = await extractDocumentText(arquivo("nota.jpg"), {
      onProgress: (p) => progresso.push(p),
    });
    expect(lido.content).toBe("NOTA FISCAL\nTotal R$ 120,00");
    expect(lido.kind.id).toBe("image");
    expect(lido.ocr).toEqual({ paginas: 1, totalPaginas: 1 });
    expect(progresso).toEqual([{ etapa: "ocr", atual: 1, total: 1 }]);
    const { createWorker } = await import("tesseract.js");
    expect(createWorker).toHaveBeenCalledWith("por");
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("explica quando a foto não tem texto legível", async () => {
    recognize.mockResolvedValue({ data: { text: "   " } });
    await expect(extractDocumentText(arquivo("borrada.png"))).rejects.toThrow(/foto mais nítida/);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("converte cada aba da planilha em texto com o nome da aba", async () => {
    readSheetNames.mockResolvedValue(["Clientes", "Pedidos"]);
    readXlsxFile.mockImplementation(async (_file, { sheet }) =>
      sheet === "Clientes"
        ? [["Nome", "Pedidos"], ["Ana", 10], [null, null], ["Bia\nSilva", 3]]
        : [["Data", "Valor"], [new Date(2026, 8, 1), 99.5]],
    );
    const lido = await extractDocumentText(arquivo("vendas.xlsx"));
    expect(lido.kind.id).toBe("xlsx");
    expect(lido.content).toBe(
      "## Clientes\nNome; Pedidos\nAna; 10\nBia Silva; 3\n\n## Pedidos\nData; Valor\n01/09/2026; 99.5",
    );
  });

  it("recusa planilha sem nenhuma célula preenchida", async () => {
    readSheetNames.mockResolvedValue(["Plan1"]);
    readXlsxFile.mockResolvedValue([[null, ""]]);
    await expect(extractDocumentText(arquivo("vazia.xlsx"))).rejects.toThrow("A planilha está vazia.");
  });
});
