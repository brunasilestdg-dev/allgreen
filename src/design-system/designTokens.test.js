import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ===== Guarda dos tokens de design (item 14: "token de design duplicado") =====
//
// Regras que o CSS da vertical passa a obedecer:
//   1. Um token (`--tdg-*`, `--ds-*`) não é declarado duas vezes no mesmo
//      arquivo + seletor (fora de @media/@supports) — era o caso de
//      `--tdg-bg/card/muted/line/shadow` em dois blocos `.tdg`, onde o segundo
//      silenciosamente vencia o primeiro.
//   2. Tokens de ESCOPO BASE (`:root`, `.tdg`) só nascem em um arquivo:
//      `--tdg-*` em LogisticsVertical.css, `--tdg-x-*` na experiência comercial,
//      `--ds-*` em design-system/tokens.css. Aliases de componente (qualquer outro
//      seletor) são permitidos — é assim que um formulário herda o tema da base.
//   3. Todo `var(--tdg-…)`/`var(--ds-…)` usado no código tem definição em algum
//      lugar: sem isso a tela vale só pelo fallback, e no escuro fica presa ao claro.

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const arquivos = [];
const varrer = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) varrer(p);
    else if (/\.(css|jsx|js)$/.test(p) && !/\.test\.(js|jsx)$/.test(p)) arquivos.push(p);
  }
};
varrer(RAIZ);
const css = arquivos.filter((p) => p.endsWith(".css"));
// Caminho relativo sempre com barra "/", inclusive no Windows (onde `join`
// devolve "\"): as asserções abaixo comparam com literais como
// "design-system/tokens.css".
const relativo = (p) => p.slice(RAIZ.length).replace(/\\/g, "/");

// Declarações com o seletor que as envolve. O parser é propositalmente
// simples (pilha de chaves): serve para CSS escrito à mão, não para minificado.
function declaracoes(texto) {
  const saida = [];
  const pilha = [];
  let buf = "";
  for (const ch of texto.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") { pilha.push(buf.trim().split("\n").pop().trim()); buf = ""; continue; }
    if (ch === "}") { pilha.pop(); buf = ""; continue; }
    buf += ch;
    if (ch === ";") {
      const m = /(--(?:tdg|ds)-[a-z0-9-]+)\s*:/.exec(buf);
      if (m) saida.push({ token: m[1], seletor: pilha[pilha.length - 1] || "", condicional: pilha.some((s) => s.startsWith("@")) });
      buf = "";
    }
  }
  return saida;
}

const porArquivo = css.map((p) => ({ arquivo: relativo(p), decls: declaracoes(readFileSync(p, "utf8")) }));
const BASE = (seletor) => /^:root$|^\.tdg$/.test(seletor);
const ESCURO = (seletor) => /dark|prefers-color-scheme/.test(seletor);

describe("tokens de design", () => {
  it("nenhum token é declarado duas vezes no mesmo arquivo e seletor", () => {
    const duplicatas = [];
    for (const { arquivo, decls } of porArquivo) {
      const vistos = new Map();
      for (const d of decls.filter((x) => !x.condicional)) {
        const chave = `${d.seletor} › ${d.token}`;
        if (vistos.has(chave)) duplicatas.push(`${arquivo}: ${chave}`);
        vistos.set(chave, true);
      }
    }
    expect(duplicatas).toEqual([]);
  });

  it("tokens de escopo base nascem em um arquivo só (claro)", () => {
    const origem = new Map();
    for (const { arquivo, decls } of porArquivo) {
      for (const d of decls) {
        if (!BASE(d.seletor) || ESCURO(d.seletor) || d.condicional) continue;
        if (!origem.has(d.token)) origem.set(d.token, new Set());
        origem.get(d.token).add(arquivo);
      }
    }
    const espalhados = [...origem].filter(([, arqs]) => arqs.size > 1).map(([t, arqs]) => `${t}: ${[...arqs].join(", ")}`);
    expect(espalhados).toEqual([]);
    // Donos declarados dos prefixos.
    for (const [token, arqs] of origem) {
      const [arquivo] = [...arqs];
      if (token.startsWith("--tdg-x-")) expect(arquivo, token).toBe("features/logistics/TodoGreenCommercialExperience.css");
      else if (token.startsWith("--tdg-")) expect(arquivo, token).toBe("features/logistics/LogisticsVertical.css");
      else if (token.startsWith("--ds-")) expect(arquivo, token).toBe("design-system/tokens.css");
    }
  });

  it("todo token usado tem definição (nada vale só pelo fallback)", () => {
    const definidos = new Set(porArquivo.flatMap(({ decls }) => decls.map((d) => d.token)));
    const usados = new Map();
    for (const p of arquivos) {
      const texto = readFileSync(p, "utf8");
      for (const m of texto.matchAll(/var\((--(?:tdg|ds)-[a-z0-9-]+)/g)) {
        if (!usados.has(m[1])) usados.set(m[1], new Set());
        usados.get(m[1]).add(relativo(p));
      }
    }
    const semDefinicao = [...usados].filter(([t]) => !definidos.has(t)).map(([t, arqs]) => `${t} (${[...arqs].slice(0, 3).join(", ")})`);
    expect(semDefinicao).toEqual([]);
  });

  it("o bloco canônico da vertical existe e cobre o escuro", () => {
    const vertical = porArquivo.find((a) => a.arquivo === "features/logistics/LogisticsVertical.css");
    const claro = new Set(vertical.decls.filter((d) => d.seletor === ".tdg").map((d) => d.token));
    const escuro = new Set(vertical.decls.filter((d) => ESCURO(d.seletor) && d.seletor.endsWith(".tdg")).map((d) => d.token));
    for (const t of ["--tdg-bg", "--tdg-card", "--tdg-soft", "--tdg-ink", "--tdg-muted", "--tdg-line", "--tdg-green", "--tdg-lime", "--tdg-shadow"]) {
      expect(claro.has(t), `${t} no claro`).toBe(true);
      expect(escuro.has(t), `${t} no escuro`).toBe(true);
    }
  });
});
