import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../worker.js";
import fonteDoWorker from "../worker.js?raw";
import fonteDoRoteador from "../worker/http/router.js?raw";
import wrangler from "../wrangler.jsonc?raw";
import {
  PREFIXOS_PUBLICOS_DE_PAGINA,
  ROTAS_AUTENTICADAS,
  ROTAS_PUBLICAS,
  ROTAS_QUE_EXIGEM_BANCO,
  casaRota,
  needsAuth,
} from "../worker/http/routes.js";

// Trava da tabela de rotas (worker/http/routes.js). A autorização do app
// deixou de depender de duas listas mantidas à mão: quem exige sessão e quem
// exige banco sai das entradas da tabela. Estes testes quebram se:
// - alguma rota autenticada responder sem sessão;
// - a lista das que exigem D1 mudar sem alguém atualizar a lista abaixo;
// - alguém casar caminho ou validar sessão por fora da tabela (no worker.js
//   ou num segundo ponto do roteador).
// A vertical To Do Green tem o próprio roteador (worker-entry.js e
// worker/services/todogreen-router.js), que roda antes e fica fora daqui.

// Rota nova entra na tabela E aqui. Numa pública, a revisão precisa
// responder por que ela não exige sessão.
const PUBLICAS = [
  "/agenda/*",
  "/atendimento/*",
  "/api/public-scheduling/*",
  "/api/public-support/*",
  "/api/public-analytics/*",
  "/api/public/v1/*",
  "/api/system/version",
  "/api/status",
  "/api/inbound/whatsapp",
  "/api/inbound/email",
  "/orcamento/*",
  "/api/public-quotes/*",
  "/f/*",
  "/api/public-forms/*",
  "/portal/*",
  "/api/portal/*",
  "/s/*",
  "/loja/*",
  "/api/public-sites/*",
  "/api/config",
  "/api/errors",
  "/api/auth/*",
  "/api/test-support/*",
  "/api/collab/invite-info",
  "/api/collab/invite/accept",
  "/api/todogreen/access-invite",
];

const AUTENTICADAS = [
  "/api/ai-keys*",
  "/api/search-keys*",
  "/api/workspace",
  "/api/webhooks",
  "/api/workspace/backups",
  "/api/tasks/action",
  "/api/transcribe",
  "/api/events",
  "/api/outbox/send",
  "/api/inbox/personal",
  "/api/inbox/conversations",
  "/api/inbox",
  "/api/quotes/*",
  "/api/forms/*",
  "/api/client-portals/*",
  "/api/tasks/notify",
  "/api/collab*",
  "/api/sites/*",
  "/api/free-suite/*",
  "/api/platform/*",
  "/api/todogreen/*",
  "/api/push/*",
  "/api/plan",
  "/api/ai/stream",
  "/api/ai",
  "/api/media",
];

const EXIGEM_BANCO = [
  "/api/ai-keys*",
  "/api/search-keys*",
  "/api/workspace",
  "/api/webhooks",
  "/api/workspace/backups",
  "/api/tasks/action",
  "/api/events",
  "/api/outbox/send",
  "/api/inbox/personal",
  "/api/inbox/conversations",
  "/api/inbox",
  "/api/forms/*",
  "/api/client-portals/*",
  "/api/collab*",
  "/api/sites/*",
  "/api/free-suite/*",
  "/api/platform/*",
  "/api/todogreen/*",
  "/api/push/*",
  "/api/plan",
];

// Um caminho concreto para cada padrão: o próprio, se exato; o prefixo mais
// um trecho, se terminar em "*".
const amostra = (padrao) => (padrao.endsWith("*") ? `${padrao.slice(0, -1)}teste` : padrao);

const pedir = (caminho, { method = "POST", body = "{}", ambiente = env } = {}) =>
  worker.fetch(
    new Request(`https://app.test${caminho}`, {
      method,
      headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.10" },
      body,
    }),
    ambiente,
    { waitUntil() {}, passThroughOnException() {} },
  );

const padroesAutenticados = ROTAS_AUTENTICADAS.flatMap((rota) => rota.caminhos);

describe("tabela de rotas", () => {
  it("toda entrada declara caminhos, handler, rótulo e resposta de falha", () => {
    for (const rota of [...ROTAS_PUBLICAS, ...ROTAS_AUTENTICADAS]) {
      expect(rota.caminhos.length).toBeGreaterThan(0);
      for (const padrao of rota.caminhos) expect(padrao).toMatch(/^\/[a-z]/);
      expect(typeof rota.executar).toBe("function");
      expect(typeof rota.rotulo).toBe("string");
      expect(typeof rota.falha).toBe("function");
      if (rota.exigeBanco && ROTAS_PUBLICAS.includes(rota))
        expect(typeof rota.semBanco).toBe("function");
    }
  });

  it("as rotas públicas e as autenticadas são as esperadas, na ordem", () => {
    expect(ROTAS_PUBLICAS.flatMap((rota) => rota.caminhos)).toEqual(PUBLICAS);
    expect(padroesAutenticados).toEqual(AUTENTICADAS);
  });

  it("nenhum padrão aparece duas vezes", () => {
    const todos = [...ROTAS_PUBLICAS, ...ROTAS_AUTENTICADAS].flatMap((rota) => rota.caminhos);
    expect(new Set(todos).size).toBe(todos.length);
  });

  for (const padrao of padroesAutenticados)
    it(`${padrao} exige sessão: 401 sem ela`, async () => {
      const caminho = amostra(padrao);
      // A amostra precisa chegar à portaria: nenhuma rota pública a atende antes.
      expect(ROTAS_PUBLICAS.some((rota) => casaRota(rota, caminho))).toBe(false);
      expect(needsAuth(caminho)).toBe(true);
      const resposta = await pedir(caminho);
      expect(resposta.status).toBe(401);
      expect(await resposta.json()).toEqual({ error: "Sua sessão expirou. Entre novamente." });
    });

  it("a lista das rotas que exigem D1 é a esperada", () => {
    expect([...ROTAS_QUE_EXIGEM_BANCO].sort()).toEqual([...EXIGEM_BANCO].sort());
  });

  for (const padrao of padroesAutenticados)
    it(`${padrao} sem D1: ${EXIGEM_BANCO.includes(padrao) ? "503 antes da sessão" : "segue como usuário local"}`, async () => {
      const resposta = await pedir(amostra(padrao), { ambiente: { ...env, DB: undefined } });
      const corpo = await resposta.json();
      if (EXIGEM_BANCO.includes(padrao)) {
        expect(resposta.status).toBe(503);
        expect(corpo).toEqual({ error: "O serviço de contas ainda não está configurado." });
      } else {
        // O sessionUser devolve { id: "local" } sem banco: a rota chega ao
        // handler, que responde por conta própria.
        expect(resposta.status).not.toBe(401);
        expect(corpo.error).not.toBe("O serviço de contas ainda não está configurado.");
      }
    });

  it("rotas públicas não passam pela portaria", () => {
    for (const caminho of ["/api/status", "/api/config", "/api/auth/login", "/api/errors", "/f/formulario"])
      expect(needsAuth(caminho)).toBe(false);
  });

  it("worker.js não casa caminho nem valida sessão", () => {
    // Toda rota mora na tabela; worker.js só compõe. Um `if (url.pathname...)`
    // com sessionUser aqui seria uma rota autenticada fora da tabela.
    expect(fonteDoWorker).not.toMatch(/pathname|sessionUser|startsWith\(/);
  });

  it("o roteador valida sessão num ponto só e não conhece caminho específico", () => {
    expect(fonteDoRoteador.match(/sessionUser\(/g)).toHaveLength(1);
    // O único literal de caminho é o "/api/" do 404 genérico.
    expect(fonteDoRoteador.match(/["'`]\/[a-z][^"'`]*["'`]/gi)).toEqual(['"/api/"']);
  });

  it("os prefixos públicos de página saem das entradas da tabela", () => {
    expect([...PREFIXOS_PUBLICOS_DE_PAGINA].sort()).toEqual(
      ["/agenda/", "/atendimento/", "/f/", "/loja/", "/orcamento/", "/portal/", "/s/"],
    );
    for (const prefixo of PREFIXOS_PUBLICOS_DE_PAGINA)
      expect(ROTAS_PUBLICAS.some((rota) => rota.caminhos.includes(`${prefixo}*`))).toBe(true);
    expect(Object.isFrozen(PREFIXOS_PUBLICOS_DE_PAGINA)).toBe(true);
  });

  // Em produção o Cloudflare serve o index.html do SPA para todo caminho fora
  // de `assets.run_worker_first` sem chamar o Worker. Até 24/09/2026 o `/f/*`
  // não estava lá: o formulário público respondia 200 com o SPA e nunca
  // chegava a `handlePublicForm` — e nenhum teste via, porque aqui o Worker
  // recebe todo caminho.
  it("toda página pública chega ao Worker em produção (run_worker_first)", () => {
    const bloco = wrangler.match(/"run_worker_first"\s*:\s*(\[[^\]]*\])/);
    expect(bloco).toBeTruthy();
    const padroes = JSON.parse(bloco[1]);
    expect(padroes).toContain("/api/*");
    expect(padroes.filter((padrao) => padrao !== "/api/*").sort())
      .toEqual(PREFIXOS_PUBLICOS_DE_PAGINA.map((prefixo) => `${prefixo}*`).sort());
  });
});
