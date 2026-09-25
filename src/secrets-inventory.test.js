import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ===== O inventário de segredos não pode divergir do código =====
//
// `docs/SECRETS.md` listava 30 e poucos nomes enquanto o Worker lia mais de
// 130 — entre eles as chaves de cifragem dos cofres (`WORKSPACE_AI_VAULT_KEY`,
// `TODOGREEN_CIOT_VAULT_KEY`, `MONDAY_TOKEN_ENCRYPTION_KEY`) e o segredo que
// assina o webhook de entrada do WhatsApp. Quem montasse um ambiente novo pela
// documentação subia um produto com cofres fechados e webhook sem assinatura.
// Este teste lê o código como texto e reprova variável nova sem documentação.

const raiz = fileURLToPath(new URL("..", import.meta.url));
const ler = (relativo) => readFileSync(join(raiz, relativo), "utf8");

const arquivosDoWorker = () => {
  const lista = ["worker.js", "worker-entry.js"];
  const andar = (pasta) => {
    for (const nome of readdirSync(join(raiz, pasta))) {
      const relativo = `${pasta}/${nome}`;
      if (statSync(join(raiz, relativo)).isDirectory()) andar(relativo);
      else if (nome.endsWith(".js")) lista.push(relativo);
    }
  };
  andar("worker");
  return lista;
};

// Só a leitura direta (`env.NOME`, `env?.NOME`, `env["NOME"]`). Nomes que o
// código monta em tempo de execução (segredo por integração) são documentados
// à mão na seção de cada integração.
const LEITURA_DIRETA = /\benv\??\.([A-Z][A-Z0-9_]+)\b|\benv\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g;

const doc = ler("docs/SECRETS.md");
const lidas = new Map();
for (const arquivo of arquivosDoWorker())
  for (const achado of ler(arquivo).matchAll(LEITURA_DIRETA)) {
    const nome = achado[1] || achado[2];
    if (!lidas.has(nome)) lidas.set(nome, arquivo);
  }

describe("inventário de segredos, variáveis e bindings", () => {
  it("o varredor encontra as leituras do código (não pode quebrar calado)", () => {
    expect(lidas.size).toBeGreaterThan(60);
    for (const nome of ["DB", "AI", "ASSETS", "GEMINI_API_KEY", "WORKSPACE_AI_VAULT_KEY"])
      expect(lidas.has(nome), nome).toBe(true);
  });

  it("todo env.NOME lido pelo Worker está em docs/SECRETS.md", () => {
    const faltando = [...lidas]
      .filter(([nome]) => !new RegExp(`\\b${nome}\\b`).test(doc))
      .map(([nome, arquivo]) => `${nome} (${arquivo})`);
    expect(faltando).toEqual([]);
  });

  it("as vars públicas do wrangler.jsonc aparecem na seção de variáveis públicas", () => {
    const wrangler = ler("wrangler.jsonc");
    const blocoVars = wrangler.slice(wrangler.indexOf('"vars"'));
    const vars = [...blocoVars.matchAll(/^\s*"([A-Z][A-Z0-9_]+)"\s*:/gm)].map((m) => m[1]);
    expect(vars.length).toBeGreaterThan(3);
    const inicio = doc.indexOf("## Variáveis públicas");
    const secao = doc.slice(inicio, doc.indexOf("\n## ", inicio + 1));
    for (const nome of vars) expect(secao, nome).toContain(`\`${nome}\``);
  });
});
