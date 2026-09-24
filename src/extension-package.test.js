import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  buildExtensionZip,
  extensionPackagePlugin,
  listExtensionFiles,
} from "../scripts/extension-package.js";
import {
  EXTENSION_INSTALL_STEPS,
  EXTENSION_TOKEN_TTL_HOURS,
  EXTENSION_ZIP_FILE,
  EXTENSION_ZIP_FOLDER,
  EXTENSION_ZIP_URL,
  maskToken,
} from "./features/extension/extensionAccess.js";
import { SESSION_TTL_SECONDS } from "../worker/auth/credenciais.js";

describe("pacote da extensão do navegador", () => {
  it("leva a pasta inteira, com o manifest e a pasta de idioma", async () => {
    const zip = await JSZip.loadAsync(await buildExtensionZip());
    const nomes = Object.keys(zip.files).filter((nome) => !zip.files[nome].dir);
    expect(nomes).toContain(`${EXTENSION_ZIP_FOLDER}/manifest.json`);
    expect(nomes).toContain(`${EXTENSION_ZIP_FOLDER}/_locales/pt_BR/messages.json`);
    expect(nomes).toContain(`${EXTENSION_ZIP_FOLDER}/popup.js`);
    expect(nomes).toContain(`${EXTENSION_ZIP_FOLDER}/background.js`);
    expect(nomes).toHaveLength(listExtensionFiles().length);
    const manifest = JSON.parse(await zip.file(`${EXTENSION_ZIP_FOLDER}/manifest.json`).async("string"));
    expect(manifest.manifest_version).toBe(3);
  });

  it("gera o mesmo arquivo byte a byte para o mesmo código", async () => {
    const [a, b] = await Promise.all([buildExtensionZip(), buildExtensionZip()]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("o build publica o pacote no endereço que a tela usa", async () => {
    const emitidos = [];
    await extensionPackagePlugin().generateBundle.call({ emitFile: (arquivo) => emitidos.push(arquivo) });
    expect(emitidos).toHaveLength(1);
    expect(emitidos[0].fileName).toBe(EXTENSION_ZIP_FILE);
    expect(EXTENSION_ZIP_URL).toBe(`/${emitidos[0].fileName}`);
    expect(emitidos[0].source.byteLength).toBeGreaterThan(0);
  });

  it("a validade do token dita na tela é a mesma da sessão no servidor", () => {
    expect(EXTENSION_TOKEN_TTL_HOURS * 3600).toBe(SESSION_TTL_SECONDS);
    expect(EXTENSION_INSTALL_STEPS.join(" ")).toContain(`${EXTENSION_TOKEN_TTL_HOURS} horas`);
  });

  it("mascara o token sem revelar o final", () => {
    expect(maskToken("abcdef123456789")).toBe(`abcdef${"•".repeat(12)}`);
    expect(maskToken("")).toBe("");
  });
});
