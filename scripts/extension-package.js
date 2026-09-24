// ===== Pacote da extensão do navegador =====
//
// O build grava a pasta extension/ inteira num .zip em dist/, servido como
// arquivo estático em /extensao-todogreen.zip. Sem isso a única instrução
// possível era "carregue a pasta extension/ do projeto" — que nenhuma pessoa
// usuária tem. Mesmo desenho do version.json em vite.config.js: um plugin que
// emite um arquivo no fim do build.
//
// Só roda no Node (build e testes). A interface importa apenas as constantes
// de src/features/extension/extensionAccess.js.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import JSZip from "jszip";
import {
  EXTENSION_ZIP_FILE,
  EXTENSION_ZIP_FOLDER,
} from "../src/features/extension/extensionAccess.js";

export const EXTENSION_SOURCE_DIR = "extension";

// Data fixa nas entradas: o mesmo código gera o mesmo .zip, byte a byte.
const DATA_FIXA = new Date("2026-01-01T00:00:00Z");

// Arquivos ocultos (.DS_Store e afins) não vão para o pacote.
export const listExtensionFiles = (dir = EXTENSION_SOURCE_DIR) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entrada) => !entrada.name.startsWith("."))
    .flatMap((entrada) => {
      const caminho = join(dir, entrada.name);
      return entrada.isDirectory() ? listExtensionFiles(caminho) : [caminho];
    })
    .sort();

export async function buildExtensionZip(dir = EXTENSION_SOURCE_DIR) {
  const zip = new JSZip();
  const pasta = zip.folder(EXTENSION_ZIP_FOLDER);
  for (const arquivo of listExtensionFiles(dir)) {
    const nome = relative(dir, arquivo).split(sep).join("/");
    pasta.file(nome, readFileSync(arquivo), { date: DATA_FIXA });
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export const extensionPackagePlugin = (dir = EXTENSION_SOURCE_DIR) => ({
  name: "extension-package",
  // No `vite dev` não há build: o mesmo endereço é servido na hora, para o
  // botão "Baixar a extensão" funcionar também no ambiente local.
  configureServer(server) {
    server.middlewares.use(`/${EXTENSION_ZIP_FILE}`, async (_req, res, next) => {
      try {
        const pacote = await buildExtensionZip(dir);
        res.setHeader("content-type", "application/zip");
        res.setHeader("content-disposition", `attachment; filename="${EXTENSION_ZIP_FILE}"`);
        res.end(Buffer.from(pacote));
      } catch (erro) {
        next(erro);
      }
    });
  },
  async generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: EXTENSION_ZIP_FILE,
      source: await buildExtensionZip(dir),
    });
  },
});
