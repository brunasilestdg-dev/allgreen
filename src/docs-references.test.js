import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ===== Documentação não pode apontar para arquivo que não existe =====
//
// Em 24/09/2026 os documentos citavam `.github/workflows/ci.yml` (nunca
// existiu neste repositório), `PENDENCIAS_DA_TITULAR.md` e
// `AUDITORIA_CONSOLIDACAO_TDG.md` (removidos em 22/09) — e quem seguia o
// runbook procurava um workflow de qualidade que não roda. Este teste lê todo
// caminho entre crases dos `.md` e reprova o que não existe no repositório.

const raiz = fileURLToPath(new URL("..", import.meta.url));

// Fora do índice: dependências, saídas de build/teste e cópias de trabalho
// (worktrees de sessões paralelas ficam em `.claude/`).
const IGNORADOS = new Set([".git", ".claude", ".wrangler", "node_modules", "dist", "test-results", "playwright-report"]);

const listar = (pasta, filtro, lista = []) => {
  for (const nome of readdirSync(join(raiz, pasta))) {
    if (IGNORADOS.has(nome)) continue;
    const caminho = join(pasta, nome);
    if (statSync(join(raiz, caminho)).isDirectory()) listar(caminho, filtro, lista);
    else if (filtro(nome)) lista.push(caminho);
  }
  return lista;
};

const DOCUMENTOS = [
  "AGENTS.md",
  "README.md",
  "SECURITY.md",
  ...listar("docs", (nome) => nome.endsWith(".md")),
  ...listar("connectors", (nome) => nome.endsWith(".md")),
  ...listar("infra", (nome) => nome.endsWith(".md")),
  ...listar("extension", (nome) => nome.endsWith(".md")),
].filter((arquivo) => existsSync(join(raiz, arquivo)));

// Todo arquivo do repositório, para resolver citações relativas ("pages/X.jsx",
// "design-system/tokens.css") e nomes soltos ("SECRETS.md").
const TODOS = listar(".", () => true).map((caminho) => caminho.replace(/^\.\//, ""));
const PELO_NOME = new Map();
for (const caminho of TODOS) {
  const nome = caminho.split("/").pop();
  if (!PELO_NOME.has(nome)) PELO_NOME.set(nome, []);
  PELO_NOME.get(nome).push(caminho);
}

const CITACAO = /`([^`\s]+\.(?:md|js|jsx|mjs|yml|yaml|json|jsonc|sql|css|sh|ps1|cmd|html))`/g;

// Citações que, de propósito, não são arquivos do repositório: gerados na
// máquina de quem roda o conector/ponte, ou menções históricas explícitas.
const FORA_DO_REPOSITORIO = new Set([
  "config.local.json", // ponte local do TRACK3R: criado a partir do config.example.json
  ".track3r-network-candidates.json", // gerado pela sondagem da ponte local
  "appsettings.Production.json", // conector CIOT no servidor Windows
  "config.sh", // instalador do runner do GitHub
  "run.sh", // idem
  "e2e/todogreen-screenshots.spec.js", // VISUAL_REGRESSION.md conta que foi removido
  ".github/workflows/qualidade-selfhosted.yml", // exemplo de workflow A CRIAR
]);

const existeNoRepositorio = (citacao, documento) => {
  // Placeholders (`<nome>Domain.js`) e caminhos de Windows (`C:\...`) não são
  // do repositório.
  if (/[<>\\]/.test(citacao)) return true;
  const limpo = citacao.replace(/^\.\//, "").split("#")[0].split(":")[0];
  if (FORA_DO_REPOSITORIO.has(limpo)) return true;
  if (existsSync(join(raiz, limpo))) return true;
  if (existsSync(join(raiz, dirname(documento), limpo))) return true;
  const candidatos = PELO_NOME.get(limpo.split("/").pop()) || [];
  if (!limpo.includes("/")) return candidatos.length > 0;
  // Caminho relativo a uma pasta de feature: basta terminar igual.
  return candidatos.some((caminho) => caminho.endsWith(`/${limpo}`));
};

describe("referências da documentação", () => {
  it("encontra os documentos e as citações (o varredor não pode quebrar calado)", () => {
    expect(DOCUMENTOS).toContain("docs/TODOGREEN_ERP_READINESS_MATRIX.md");
    expect(DOCUMENTOS).toContain("AGENTS.md");
    const total = DOCUMENTOS.reduce(
      (soma, documento) => soma + [...readFileSync(join(raiz, documento), "utf8").matchAll(CITACAO)].length,
      0,
    );
    expect(total).toBeGreaterThan(300);
  });

  it("todo arquivo citado entre crases existe no repositório", () => {
    const quebradas = [];
    for (const documento of DOCUMENTOS) {
      const linhas = readFileSync(join(raiz, documento), "utf8").split("\n");
      linhas.forEach((linha, indice) => {
        for (const achado of linha.matchAll(CITACAO))
          if (!existeNoRepositorio(achado[1], documento))
            quebradas.push(`${relative(raiz, join(raiz, documento))}:${indice + 1} → ${achado[1]}`);
      });
    }
    expect(quebradas).toEqual([]);
  });
});
