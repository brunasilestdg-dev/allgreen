import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ===== A matriz de prontidão só afirma o que o repositório prova =====
//
// `docs/TODOGREEN_ERP_READINESS_MATRIX.md` responde três perguntas
// independentes por processo: Implementado, Testado e Homologado em produção.
// A versão de 30/08 misturava as três ("REAL", "testado em produção") e citava
// testes por apelido ("transactions", "vertical-records (estorno)") ou pelo
// nome de um `describe` em vez do caso — ninguém conseguia conferir, e ela
// envelheceu calada. Este teste trava o que dá para provar daqui:
//   • cada coluna só usa o vocabulário definido no topo da matriz;
//   • "Homologado" diferente de "Não registrado" cita um código do registro de
//     homologação, e o código existe;
//   • "Testado: Sim/Parcial" cita pelo menos um teste que roda no gate;
//   • todo caso citado entre aspas depois de um arquivo de teste existe,
//     literalmente, naquele arquivo;
//   • toda migração citada (`0032`, `0135–0138`…) existe em migrations/.

const raiz = fileURLToPath(new URL("..", import.meta.url));
const MATRIZ = readFileSync(join(raiz, "docs/TODOGREEN_ERP_READINESS_MATRIX.md"), "utf8");
const LINHAS = MATRIZ.split("\n");

const IGNORADOS = new Set(["node_modules", ".git", ".claude", ".wrangler", "dist", "test-results", "playwright-report"]);
const listar = (pasta, lista = []) => {
  for (const nome of readdirSync(join(raiz, pasta))) {
    if (IGNORADOS.has(nome)) continue;
    const caminho = join(pasta, nome);
    if (statSync(join(raiz, caminho)).isDirectory()) listar(caminho, lista);
    else if (/\.(test|spec)\.jsx?$/.test(nome)) lista.push(caminho);
  }
  return lista;
};
const TESTES = [...listar("src"), ...listar("test"), ...listar("e2e")];

// O gate: unidade (src/**/*.test.*), worker (test/**/*.worker.test.js) e os
// e2e do `test:e2e:critical`. Outro e2e existe, mas não barra a publicação.
const pacote = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
const E2E_CRITICOS = new Set((pacote.scripts["test:e2e:critical"].match(/e2e\/[\w.-]+\.spec\.js/g) || []));
const noGate = (caminho) =>
  (caminho.startsWith("src/") && /\.test\.jsx?$/.test(caminho))
  || (caminho.startsWith("test/") && caminho.endsWith(".worker.test.js"))
  || E2E_CRITICOS.has(caminho);

const resolverTeste = (citacao) => {
  const limpo = citacao.replace(/^\.\//, "");
  return TESTES.filter((caminho) => caminho === limpo || caminho.endsWith(`/${limpo}`));
};

const CITACAO_DE_TESTE = /`([^`\s]+\.(?:test|spec)\.jsx?)`((?:\s*\(\s*"[^"]*"(?:\s*,\s*"[^"]*")*\s*\))?)/g;
const CASOS = /"([^"]*)"/g;

const citacoesDe = (texto) =>
  [...texto.matchAll(CITACAO_DE_TESTE)].map((achado) => ({
    arquivo: achado[1],
    casos: [...(achado[2] || "").matchAll(CASOS)].map((caso) => caso[1]),
  }));

// Tabelas de processo: as que têm as três colunas.
const tabelasDeProcesso = () => {
  const linhas = [];
  let colunas = null;
  LINHAS.forEach((linha, indice) => {
    if (!linha.startsWith("|")) {
      colunas = null;
      return;
    }
    const celulas = linha.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((celula) => celula.trim());
    if (!colunas) {
      if (celulas.includes("Implementado") && celulas.includes("Testado") && celulas.includes("Homologado")) colunas = celulas;
      return;
    }
    if (/^-+$/.test(celulas[0].replace(/\s/g, ""))) return;
    const registro = Object.fromEntries(colunas.map((nome, posicao) => [nome, celulas[posicao] ?? ""]));
    linhas.push({ numero: indice + 1, nome: celulas[0], registro, texto: linha });
  });
  return linhas;
};

const CODIGOS_DE_HOMOLOGACAO = new Set(
  [...MATRIZ.matchAll(/^\| \*\*(H\d+)\*\* \|/gm)].map((achado) => achado[1]),
);

describe("matriz de prontidão", () => {
  const processos = tabelasDeProcesso();

  it("encontra as tabelas de processo e o registro de homologação (o varredor não pode quebrar calado)", () => {
    expect(processos.length).toBeGreaterThan(80);
    expect(CODIGOS_DE_HOMOLOGACAO.size).toBeGreaterThan(0);
    expect(E2E_CRITICOS.size).toBeGreaterThan(0);
  });

  it("cada coluna usa só o vocabulário definido no topo", () => {
    const fora = [];
    for (const { numero, nome, registro } of processos) {
      if (!/^(Sim|Parcial|Preparado|Não)\b/.test(registro.Implementado)) fora.push(`${numero} ${nome}: Implementado "${registro.Implementado}"`);
      if (!/^(Sim|Parcial|Não|n\/a)\b/.test(registro.Testado)) fora.push(`${numero} ${nome}: Testado "${registro.Testado}"`);
      if (!/^(Registrado \(H\d+(, H\d+)*\)|Parcial \(H\d+(, H\d+)*\)|Não registrado|n\/a)$/.test(registro.Homologado))
        fora.push(`${numero} ${nome}: Homologado "${registro.Homologado}"`);
    }
    expect(fora).toEqual([]);
  });

  it("homologação só com código que existe no registro", () => {
    const soltos = [];
    for (const { numero, nome, registro } of processos)
      for (const [codigo] of registro.Homologado.matchAll(/H\d+/g))
        if (!CODIGOS_DE_HOMOLOGACAO.has(codigo)) soltos.push(`${numero} ${nome}: ${codigo}`);
    expect(soltos).toEqual([]);
  });

  it("Testado: Sim ou Parcial cita pelo menos um teste que roda no gate", () => {
    const semTeste = [];
    for (const { numero, nome, registro, texto } of processos) {
      if (!/^(Sim|Parcial)\b/.test(registro.Testado)) continue;
      const doGate = citacoesDe(texto).flatMap(({ arquivo }) => resolverTeste(arquivo)).filter(noGate);
      if (!doGate.length) semTeste.push(`${numero} ${nome}`);
    }
    expect(semTeste).toEqual([]);
  });

  it("toda migração citada existe em migrations/", () => {
    const existentes = new Set(readdirSync(join(raiz, "migrations")).map((nome) => nome.slice(0, 4)));
    const citadas = [...new Set(MATRIZ.match(/\b0\d{3}\b/g) || [])];
    expect(citadas.length).toBeGreaterThan(50);
    expect(citadas.filter((numero) => !existentes.has(numero))).toEqual([]);
  });

  it("todo teste citado existe, e cada caso entre aspas está nele", () => {
    const quebradas = [];
    LINHAS.forEach((linha, indice) => {
      for (const { arquivo, casos } of citacoesDe(linha)) {
        const caminhos = resolverTeste(arquivo);
        if (caminhos.length !== 1) {
          quebradas.push(`${indice + 1}: ${arquivo} → ${caminhos.length ? "ambíguo" : "não existe"}`);
          continue;
        }
        const fonte = readFileSync(join(raiz, caminhos[0]), "utf8");
        for (const caso of casos) {
          // "…" no fim abrevia um nome longo: vale como prefixo.
          const trecho = caso.replace(/…$/, "");
          if (!trecho || !fonte.includes(trecho)) quebradas.push(`${indice + 1}: ${arquivo} → caso "${caso}" não encontrado`);
        }
      }
    });
    expect(quebradas).toEqual([]);
  });
});
