// ===== Ler o conteúdo de um arquivo escolhido no navegador =====
//
// PDF, planilha, texto, imagem. Usado por anexos, documentos, bases e pela IA —
// quatro telas diferentes, o que é exatamente o motivo de não morar dentro de
// nenhuma delas.
//
// Imagem e PDF digitalizado passam por OCR (tesseract.js), no próprio aparelho
// e sem custo — o mesmo leitor que a Roteirização já usava para a foto da
// etiqueta. O arquivo não sai do navegador: só o motor e o idioma são baixados
// da CDN na primeira leitura. Antes, este arquivo recusava a foto de um recibo
// e o PDF escaneado de um contrato dizendo que "precisam de OCR", enquanto o
// OCR estava instalado a uma tela de distância.

export const DOCUMENT_UPLOAD_LIMIT = 10 * 1024 * 1024;
const DOCUMENT_TEXT_LIMIT = 300_000;
// Cada página leva segundos no celular; um contrato de 80 páginas travaria a
// tela. As primeiras páginas entram e o resultado sai marcado como truncado.
export const OCR_PAGE_LIMIT = 10;
// SVG fica de fora de propósito: é código e pode carregar script.
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp"];

// Um lugar só para o que os seletores de arquivo aceitam e para o texto de
// ajuda — antes cada tela tinha a sua lista, e a imagem teria de ser lembrada
// em quatro lugares.
export const DOCUMENT_ACCEPT = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ...IMAGE_EXTENSIONS.map((extensao) => `.${extensao}`),
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/bmp",
].join(",");
export const DOCUMENT_FORMATS_HINT =
  "PDF (inclusive escaneado), DOCX, TXT, Markdown, CSV ou foto (PNG, JPG, WEBP)";

// Frase de andamento do OCR, igual em todas as telas que leem arquivo.
export const describeOcrProgress = (fileName, { page = 1, pages = 1, progress = 0 } = {}) =>
  `Lendo o texto de ${fileName || "arquivo"}${pages > 1 ? ` — página ${page} de ${pages}` : ""} (${progress}%)`;

export function documentFileKind(file) {
  const extension = String(file?.name || "")
    .toLowerCase()
    .split(".")
    .pop();
  if (extension === "pdf") return { id: "pdf", label: "PDF importado" };
  if (extension === "docx") return { id: "docx", label: "Documento Word" };
  if (["txt", "md", "markdown", "csv"].includes(extension))
    return {
      id: "text",
      label: extension === "csv" ? "Planilha CSV" : "Documento importado",
    };
  if (IMAGE_EXTENSIONS.includes(extension))
    return { id: "image", label: "Imagem (texto lido por OCR)" };
  return null;
}

export const documentTitleFromFilename = (name) =>
  String(name || "Documento importado")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Documento importado";

// O OCR devolve espaço sobrando no fim das linhas e buracos de várias linhas
// em branco; limpa sem mexer no conteúdo.
export const cleanOcrText = (texto) =>
  String(texto || "")
    .split("\n")
    .map((linha) => linha.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Página de PDF → canvas. A escala mira ~2000 px no lado maior: nitidez
// suficiente para o OCR sem estourar a memória do celular.
async function renderPdfPageForOcr(pdf, index) {
  const page = await pdf.getPage(index);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, 2000 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const canvasContext = canvas.getContext("2d");
  await page.render({ canvas, canvasContext, viewport }).promise;
  page.cleanup();
  return canvas;
}

async function readTextWithOcr(images, onProgress) {
  let worker;
  let current = 0;
  // Preparar o leitor é o passo que depende da rede (motor + idioma vêm da
  // CDN na primeira vez); ler a imagem não. Mensagens separadas para a pessoa
  // não ir conferir o Wi-Fi quando o problema é o arquivo.
  try {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("por", 1, {
      logger: (message) => {
        if (message?.status === "recognizing text")
          onProgress?.({
            page: current + 1,
            pages: images.length,
            progress: Math.round((message.progress || 0) * 100),
          });
      },
    });
  } catch {
    await worker?.terminate?.();
    throw new Error(
      "Não foi possível preparar o leitor de texto. Na primeira leitura o app baixa o leitor — confira a conexão e tente de novo.",
    );
  }
  try {
    const texts = [];
    for (const [index, image] of images.entries()) {
      current = index;
      const { data } = await worker.recognize(image);
      texts.push(cleanOcrText(data?.text));
    }
    return texts;
  } catch {
    throw new Error(
      "Não consegui ler o texto deste arquivo. Confira se ele abre normalmente e tente de novo.",
    );
  } finally {
    await worker?.terminate?.();
  }
}

export async function extractDocumentText(file, options = {}) {
  const { onProgress, renderPage = renderPdfPageForOcr } = options;
  const kind = documentFileKind(file);
  if (!kind)
    throw new Error(
      "Formato não aceito. Use PDF, DOCX, TXT, Markdown, CSV ou imagem (PNG, JPG, WEBP).",
    );
  if (!file?.size) throw new Error("O arquivo está vazio.");
  if (file.size > DOCUMENT_UPLOAD_LIMIT)
    throw new Error("O arquivo ultrapassa o limite de 10 MB.");
  let text = "";
  let ocr = null;
  if (kind.id === "image") {
    text = (await readTextWithOcr([file], onProgress)).join("\n\n");
    ocr = { pages: 1, totalPages: 1 };
  } else {
    const arrayBuffer = await file.arrayBuffer();
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
      try {
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
        // Sem texto selecionável, cada página é uma foto: PDF digitalizado.
        if (!text.replace(/\u0000/g, "").trim() && pdf.numPages > 0) {
          const pagesToRead = Math.min(pdf.numPages, OCR_PAGE_LIMIT);
          const images = [];
          for (let index = 1; index <= pagesToRead; index += 1)
            images.push(await renderPage(pdf, index));
          text = (await readTextWithOcr(images, onProgress))
            .filter(Boolean)
            .join("\n\n");
          ocr = { pages: pagesToRead, totalPages: pdf.numPages };
        }
      } finally {
        if (typeof pdf.cleanup === "function") await pdf.cleanup();
        if (typeof loadingTask.destroy === "function")
          await loadingTask.destroy();
      }
    }
  }
  text = String(text)
    .replace(/\u0000/g, "")
    .trim();
  if (!text)
    throw new Error(
      kind.id === "image"
        ? "Não encontrei texto legível na imagem. Tente uma foto mais nítida, reta e bem iluminada."
        : ocr
          ? "Não encontrei texto legível neste PDF digitalizado. Tente uma cópia com mais resolução."
          : "Não foi possível encontrar texto nesse arquivo.",
    );
  return {
    content: text.slice(0, DOCUMENT_TEXT_LIMIT),
    truncated:
      text.length > DOCUMENT_TEXT_LIMIT ||
      Boolean(ocr && ocr.pages < ocr.totalPages),
    kind,
    ocr,
  };
}
