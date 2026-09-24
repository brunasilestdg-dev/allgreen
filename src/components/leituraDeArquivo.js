// ===== Ler o conteúdo de um arquivo escolhido no navegador =====
//
// PDF, planilha, texto, imagem. Usado por anexos, documentos, bases e pela IA —
// quatro telas diferentes, o que é exatamente o motivo de não morar dentro de
// nenhuma delas.
//
// Tudo roda no aparelho: foto e PDF escaneado passam por OCR com o
// tesseract.js (o mesmo que a Roteirização já usava para etiqueta) e a planilha
// .xlsx pelo read-excel-file — nada sai do navegador, o que importa para
// contrato, nota e documento com CPF. As duas libs entram por import dinâmico:
// só baixa quem usa.

export const DOCUMENT_UPLOAD_LIMIT = 10 * 1024 * 1024;
const DOCUMENT_TEXT_LIMIT = 300_000;
// OCR de PDF escaneado é página a página no aparelho: acima disso a espera
// fica longa demais no celular. O resultado diz quantas páginas foram lidas.
export const OCR_PDF_MAX_PAGES = 10;
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "bmp"];

// Uma lista só para o seletor de arquivo e o leitor não divergirem.
export const DOCUMENT_ACCEPT = [
  ".pdf,.docx,.txt,.md,.markdown,.csv,.xlsx,.jpg,.jpeg,.png,.webp,.bmp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain,text/markdown,text/csv",
  "image/jpeg,image/png,image/webp,image/bmp",
].join(",");

export function documentFileKind(file) {
  const extension = String(file?.name || "")
    .toLowerCase()
    .split(".")
    .pop();
  if (extension === "pdf") return { id: "pdf", label: "PDF importado" };
  if (extension === "docx") return { id: "docx", label: "Documento Word" };
  if (extension === "xlsx") return { id: "xlsx", label: "Planilha Excel" };
  if (IMAGE_EXTENSIONS.includes(extension))
    return { id: "image", label: "Imagem (texto lido por OCR)" };
  if (["txt", "md", "markdown", "csv"].includes(extension))
    return {
      id: "text",
      label: extension === "csv" ? "Planilha CSV" : "Documento importado",
    };
  return null;
}

// OCR no aparelho. Português é a língua do produto; um único worker lê todas
// as páginas e é encerrado no fim, para não deixar memória presa no celular.
async function lerTextoPorOcr(imagens, onProgress) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("por");
  try {
    const partes = [];
    for (let indice = 0; indice < imagens.length; indice += 1) {
      onProgress?.({ etapa: "ocr", atual: indice + 1, total: imagens.length });
      const { data } = await worker.recognize(imagens[indice]);
      partes.push(String(data?.text || "").trim());
    }
    return partes;
  } finally {
    await worker.terminate();
  }
}

// Só há canvas no navegador de verdade (o jsdom dos testes não desenha).
const podeDesenhar = () => {
  try {
    return (
      typeof document !== "undefined" &&
      Boolean(document.createElement("canvas").getContext("2d"))
    );
  } catch {
    return false;
  }
};

async function paginasComoImagem(pdf, limite) {
  const imagens = [];
  for (let indice = 1; indice <= Math.min(pdf.numPages, limite); indice += 1) {
    const page = await pdf.getPage(indice);
    // Escala 2: letra de documento escaneado fica pequena demais para o OCR
    // na resolução de tela.
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    imagens.push(canvas);
    page.cleanup();
  }
  return imagens;
}

const celulaComoTexto = (valor) => {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date)
    return Number.isNaN(valor.getTime()) ? "" : valor.toLocaleDateString("pt-BR");
  return String(valor).replace(/[\r\n\t]+/g, " ").trim();
};

// Cada aba vira um bloco com o nome dela e as linhas separadas por "; " — o
// mesmo separador do CSV em português, legível pela pessoa e pela IA.
async function lerPlanilhaXlsx(file) {
  const { default: readXlsxFile, readSheetNames } = await import("read-excel-file");
  const abas = await readSheetNames(file);
  const blocos = [];
  for (const aba of abas) {
    const linhas = await readXlsxFile(file, { sheet: aba });
    const texto = linhas
      .map((linha) => linha.map(celulaComoTexto))
      .filter((linha) => linha.some(Boolean))
      .map((linha) => linha.join("; "))
      .join("\n");
    if (texto) blocos.push(abas.length > 1 ? `## ${aba}\n${texto}` : texto);
  }
  return blocos.join("\n\n");
}

export const documentTitleFromFilename = (name) =>
  String(name || "Documento importado")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Documento importado";

export async function extractDocumentText(file, { onProgress } = {}) {
  const kind = documentFileKind(file);
  if (!kind)
    throw new Error(
      "Formato não aceito. Use PDF, DOCX, XLSX, TXT, Markdown, CSV ou imagem (JPG, PNG, WebP).",
    );
  if (!file?.size) throw new Error("O arquivo está vazio.");
  if (file.size > DOCUMENT_UPLOAD_LIMIT)
    throw new Error("O arquivo ultrapassa o limite de 10 MB.");
  let ocr = null;
  if (kind.id === "image") {
    const [lido] = await lerTextoPorOcr([file], onProgress);
    const text = String(lido || "").replace(/\u0000/g, "").trim();
    if (!text)
      throw new Error(
        "Não consegui ler texto nesta imagem. Tente uma foto mais nítida, reta e com boa luz.",
      );
    return {
      content: text.slice(0, DOCUMENT_TEXT_LIMIT),
      truncated: text.length > DOCUMENT_TEXT_LIMIT,
      kind,
      ocr: { paginas: 1, totalPaginas: 1 },
    };
  }
  if (kind.id === "xlsx") {
    const text = (await lerPlanilhaXlsx(file)).trim();
    if (!text) throw new Error("A planilha está vazia.");
    return {
      content: text.slice(0, DOCUMENT_TEXT_LIMIT),
      truncated: text.length > DOCUMENT_TEXT_LIMIT,
      kind,
    };
  }
  const arrayBuffer = await file.arrayBuffer();
  let text = "";
  if (kind.id === "text") {
    text = new TextDecoder("utf-8").decode(arrayBuffer);
  } else if (kind.id === "docx") {
    const module = await import("mammoth");
    const mammoth = module.default || module;
    const result = await mammoth.extractRawText(
      typeof globalThis.Buffer !== "undefined"
        ? { buffer: globalThis.Buffer.from(arrayBuffer) }
        : { arrayBuffer },
    );
    text = result.value || "";
  } else {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (typeof globalThis.Worker === "undefined") {
      globalThis.pdfjsWorker =
        await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    } else {
      const worker =
        await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    }
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(arrayBuffer),
    });
    const pdf = await loadingTask.promise;
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .trim(),
      );
      page.cleanup();
    }
    text = pages.filter(Boolean).join("\n\n");
    // PDF sem texto selecionável é, quase sempre, papel escaneado. Antes a
    // leitura parava aqui com "precisa de OCR"; agora o OCR é feito no próprio
    // aparelho, página a página, até o limite.
    if (!text.replace(/\u0000/g, "").trim() && podeDesenhar()) {
      try {
        const imagens = await paginasComoImagem(pdf, OCR_PDF_MAX_PAGES);
        const lidas = await lerTextoPorOcr(imagens, onProgress);
        text = lidas.filter(Boolean).join("\n\n");
        ocr = { paginas: imagens.length, totalPaginas: pdf.numPages };
      } catch {
        text = "";
      }
    }
    if (typeof pdf.cleanup === "function") await pdf.cleanup();
    if (typeof loadingTask.destroy === "function") await loadingTask.destroy();
  }
  text = String(text)
    .replace(/\u0000/g, "")
    .trim();
  if (!text)
    throw new Error(
      kind.id === "pdf"
        ? "Não consegui ler texto neste PDF. Se for digitalizado, tente uma cópia mais nítida ou envie as páginas como imagem."
        : "Não foi possível encontrar texto nesse arquivo.",
    );
  return {
    content: text.slice(0, DOCUMENT_TEXT_LIMIT),
    // Página escaneada além do limite de OCR também é conteúdo que ficou de fora.
    truncated:
      text.length > DOCUMENT_TEXT_LIMIT ||
      Boolean(ocr && ocr.totalPaginas > ocr.paginas),
    kind,
    ...(ocr ? { ocr } : {}),
  };
}

// Frase de andamento do OCR, igual em todas as telas que leem arquivo. Recebe
// o que `extractDocumentText` passa ao `onProgress`.
export const describeOcrProgress = (fileName, { atual = 1, total = 1 } = {}) =>
  `Lendo o texto de ${fileName || "arquivo"}${total > 1 ? ` — página ${atual} de ${total}` : ""}…`;
