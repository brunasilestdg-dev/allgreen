// ===== Worker do app: composição =====
//
// Só compõe. O `fetch` entrega cada pedido ao roteador de worker/http/, onde
// mora a tabela de rotas (a única lista de quem exige sessão e banco); o
// `scheduled` dispara os jobs dos crons. Cada responsabilidade vive no seu
// módulo em worker/services/ — este arquivo não casa caminho nem valida
// sessão. Os reexports abaixo existem para quem já importava daqui.
import {
  createSession,
  hex,
  passwordHash,
  randomHex,
  sameHash,
  sha256,
  unhex,
} from "./worker/auth/credenciais.js";
import { rotear } from "./worker/http/router.js";
import {
  askOpenAICompatible,
  configuredAiProviders,
  publicAiResult,
} from "./worker/services/ai.js";
// Reexportado para quem já importava daqui (src/ai-providers.test.js).
export { askOpenAICompatible, configuredAiProviders, publicAiResult };
import { runScheduledAutomations } from "./worker/services/scheduled-automations.js";
import { sanitizeSiteHtml, siteSlug } from "./worker/services/sites.js";
import { handleTranscribe } from "./worker/services/transcribe.js";
import { sendWeeklySummaries } from "./worker/services/weekly-summary.js";
import { runTodoGreenScheduledWorkAutomations } from "./worker/services/todogreen-work-center.js";
import { runTodoGreenIntelligenceWatches } from "./worker/services/todogreen-client-intelligence.js";
import { runTodoGreenMarketIntelligenceScheduled } from "./worker/services/todogreen-market-intelligence.js";
import { runTodoGreenEnergyReferenceScheduled } from "./worker/services/todogreen-energy-reference.js";
import { runTodoGreenMarketSignalsScheduled } from "./worker/services/todogreen-market-signals.js";
import { runTodoGreenRoadRiskScheduled } from "./worker/services/todogreen-road-risk.js";
import { runTodoGreenTrackerScheduled, expurgarPosicoesAntigasDoTracker } from "./worker/services/todogreen-tracker.js";
import { runTodoGreenPendenciaAvisos } from "./worker/services/todogreen-semente.js";

// Movido para ./worker/auth/credenciais.js; reexportado para os testes.
export { createSession, hex, passwordHash, randomHex, sameHash, sha256, unhex };

// Movido para ./worker/services/sites.js; reexportado para
// src/public-sites.test.js.
export { sanitizeSiteHtml, siteSlug };

// Movido para ./worker/services/transcribe.js; reexportado para
// test/transcribe.worker.test.js.
export { handleTranscribe };

export default {
  async scheduled(controller, env, ctx) {
    const now = new Date(controller?.scheduledTime || Date.now());
    if (controller?.cron === "0 12 * * 1")
      ctx.waitUntil(
        sendWeeklySummaries(env, now).catch((error) =>
          console.error("scheduled weekly summary", error),
        ),
      );
    ctx.waitUntil(
      runScheduledAutomations(env, now).catch((error) =>
        console.error("scheduled automations", error),
      ),
    );
    ctx.waitUntil(
      runTodoGreenScheduledWorkAutomations(env, now).catch((error) =>
        console.error("scheduled To Do Green work automations", error),
      ),
    );
    ctx.waitUntil(
      runTodoGreenIntelligenceWatches(env, now).catch((error) =>
        console.error("scheduled To Do Green intelligence watches", error),
      ),
    );
    ctx.waitUntil(
      runTodoGreenMarketIntelligenceScheduled(env, now).catch((error) =>
        console.error("scheduled To Do Green market intelligence", error),
      ),
    );
    // Referências de energia (ANEEL tarifas, ANP diesel, ONS curva de carga):
    // mantém o cache fresco com data da fonte, auto-limitado (ONS 1×/dia, ANP
    // 1×/semana, ANEEL 1×/semana por par configurado, 3 pares por disparo).
    ctx.waitUntil(
      runTodoGreenEnergyReferenceScheduled(env, now).catch((error) =>
        console.error("scheduled To Do Green energy references", error),
      ),
    );
    // Sinais de mercado (PNCP 6/6 h, Compras.gov 1×/dia, GDELT um termo por hora)
    // e Risk Map (ANTT: um recurso por hora, refresh de 30 dias).
    ctx.waitUntil(
      runTodoGreenMarketSignalsScheduled(env, now).catch((error) =>
        console.error("scheduled To Do Green market signals", error),
      ),
    );
    ctx.waitUntil(
      runTodoGreenRoadRiskScheduled(env, now).catch((error) =>
        console.error("scheduled To Do Green road risk", error),
      ),
    );
    // Rastreador → operação no cron: a posição do veículo (last_position) fica
    // fresca para o cockpit e o portal do cliente sem ninguém clicar "sincronizar".
    // Auto-limitado: só integrações em polling, respeitando o intervalo ≥60min de
    // cada uma, no máximo 10 por disparo — não é uma enxurrada de chamadas externas.
    ctx.waitUntil(
      runTodoGreenTrackerScheduled(env).catch((error) =>
        console.error("scheduled To Do Green tracker", error),
      ),
    );
    // Retenção: expurga posições do rastreador além da janela (padrão 90 dias,
    // configurável por TODOGREEN_TRACKER_RETENTION_DAYS). É a coleção de maior
    // volume da vertical; sem esta limpeza no cron ela cresce sem teto no D1.
    ctx.waitUntil(
      expurgarPosicoesAntigasDoTracker(env, now).catch((error) =>
        console.error("scheduled To Do Green tracker retention", error),
      ),
    );
    // Aviso de pendências novas (push + e-mail), só o que surgiu desde o último
    // disparo. Primeiro disparo de cada espaço só registra o baseline, não envia.
    ctx.waitUntil(
      runTodoGreenPendenciaAvisos(env).catch((error) =>
        console.error("scheduled To Do Green pendências", error),
      ),
    );
  },
  async fetch(request, env, ctx) {
    return rotear(request, env, ctx);
  },
};
