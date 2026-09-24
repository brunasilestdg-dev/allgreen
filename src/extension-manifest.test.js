import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Trava de regressão da extensão do navegador. O manifest declarava
// `default_locale` sem a pasta `_locales/`, e o Chrome recusava carregar a
// extensão inteira ("Default locale was specified, but _locales subtree is
// missing") — sem nenhum teste reclamar, porque nada lia o manifest.
const raiz = new URL("../extension/", import.meta.url);
const ler = (caminho) => readFileSync(fileURLToPath(new URL(caminho, raiz)), "utf8");
const existe = (caminho) => existsSync(fileURLToPath(new URL(caminho, raiz)));
const manifest = JSON.parse(ler("manifest.json"));

// O Chrome casa as chaves __MSG_x__ sem diferenciar maiúsculas.
const mensagens = () => {
  const bruto = JSON.parse(ler(`_locales/${manifest.default_locale}/messages.json`));
  return Object.fromEntries(Object.entries(bruto).map(([chave, valor]) => [chave.toLowerCase(), valor]));
};
const resolver = (texto) =>
  String(texto).replace(/__MSG_(\w+)__/g, (_, chave) => mensagens()[chave.toLowerCase()]?.message ?? `<<${chave}>>`);

describe("extensão do navegador — manifest", () => {
  it("tem a pasta de idioma que o default_locale exige", () => {
    expect(manifest.default_locale).toBeTruthy();
    expect(existe(`_locales/${manifest.default_locale}/messages.json`)).toBe(true);
  });

  it("toda mensagem tem texto e toda chave __MSG__ do manifest existe", () => {
    for (const [chave, valor] of Object.entries(mensagens())) {
      expect(String(valor?.message || "").trim(), chave).not.toBe("");
    }
    const usadas = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((m) => m[1].toLowerCase());
    expect(usadas.length).toBeGreaterThan(0);
    for (const chave of usadas) expect(mensagens()[chave], chave).toBeDefined();
  });

  it("respeita os limites da Chrome Web Store depois de traduzido", () => {
    expect([...resolver(manifest.name)].length).toBeLessThanOrEqual(75);
    expect([...resolver(manifest.description)].length).toBeLessThanOrEqual(132);
  });

  it("aponta só para arquivos que existem", () => {
    expect(existe(manifest.action.default_popup)).toBe(true);
    expect(existe(manifest.background.service_worker)).toBe(true);
    const popup = ler(manifest.action.default_popup);
    const referencias = [...popup.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
    expect(referencias.length).toBeGreaterThan(0);
    for (const arquivo of referencias) expect(existe(arquivo), arquivo).toBe(true);
  });

  it("tem permissão de rede para o endereço padrão que o popup usa", () => {
    const base = ler("popup.js").match(/DEFAULT_BASE = "([^"]+)"/)?.[1];
    expect(base).toBeTruthy();
    expect(manifest.host_permissions).toContain(`${base}/*`);
  });
});
