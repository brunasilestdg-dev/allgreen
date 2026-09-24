import { buildPushPayload } from "@block65/webcrypto-web-push";
import {
  createSession,
  hex,
  passwordHash,
  randomHex,
  sameHash,
  sessionUser,
  sha256,
  unhex,
} from "./worker/auth/credenciais.js";
import { moneyBRL } from "./worker/lib/format.js";
import { allowed, json } from "./worker/lib/http.js";
import { logAudit } from "./worker/lib/audit.js";
import { membershipRole } from "./worker/lib/membership.js";
import {
  escMail,
  whatsappEnabled,
} from "./worker/mensageria/envio.js";
import { planSnapshot } from "./worker/services/plan-usage.js";
import {
  askOpenAICompatible,
  configuredAiProviders,
  handleAi,
  handleAiStream,
  publicAiResult,
} from "./worker/services/ai.js";
// Reexportado para quem já importava daqui (src/ai-providers.test.js).
export { askOpenAICompatible, configuredAiProviders, publicAiResult };
import { handleAuth } from "./worker/services/auth.js";
import { handleTestSupport } from "./worker/services/test-support.js";
import { handleCollab } from "./worker/services/collab.js";
import { handleWorkspace } from "./worker/services/workspace.js";
import { freeSuiteOwner, handleFreeSuite } from "./worker/services/free-suite.js";
import { handlePublicSite } from "./worker/services/public-site.js";
import { handleTodoGreenCore } from "./worker/services/todogreen-core.js";
import {
  handlePlatformSuite,
  handlePublicPlatformSuite,
} from "./worker/services/platform-suite.js";
import { createQuoteHandlers } from "./worker/services/quotes.js";
import { createWebhookHandlers } from "./worker/services/webhooks.js";
import {
  handleConfig,
  handleStatus,
  handleSystemVersion,
} from "./worker/services/app-info.js";
import {
  handleClientPortals,
  handlePublicClientPortal,
} from "./worker/services/client-portal.js";
import { handleErrorLog } from "./worker/services/error-log.js";
import {
  handleInboundEmail,
  handleInboundWhatsApp,
} from "./worker/services/inbound-webhooks.js";
import { handleInbox, handleInboxConversations } from "./worker/services/inbox.js";
import { handleMedia } from "./worker/services/media.js";
import { handleOutboxSend } from "./worker/services/outbox.js";
import { handlePersonalInbox } from "./worker/services/personal-inbox.js";
import { handleProductEvents } from "./worker/services/product-events.js";
import { handlePublicApi, publicApiJson } from "./worker/services/public-api.js";
import { handleForms, handlePublicForm } from "./worker/services/public-forms.js";
import { handlePublicInvite } from "./worker/services/public-invite.js";
import { handlePush } from "./worker/services/push-subscriptions.js";
import { runScheduledAutomations } from "./worker/services/scheduled-automations.js";
import {
  handleSites,
  sanitizeSiteHtml,
  siteSlug,
} from "./worker/services/sites.js";
import { handleTaskAction } from "./worker/services/task-action.js";
import { handleTaskNotify } from "./worker/services/task-notify.js";
import { handleTranscribe } from "./worker/services/transcribe.js";
import { sendWeeklySummaries } from "./worker/services/weekly-summary.js";
import { handleWorkspaceBackups } from "./worker/services/workspace-backups.js";
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

// Movido para ./worker/mensageria/envio.js.

const { handlePublicQuote, handleQuotes } = createQuoteHandlers({
  json,
  allowed,
  randomHex,
  escMail,
  moneyBRL,
});

const { handleWebhooks, notifyWorkspaceChange } = createWebhookHandlers({
  json,
  allowed,
  randomHex,
});

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
    const url = new URL(request.url);
    if (
      url.pathname.startsWith("/agenda/") ||
      url.pathname.startsWith("/atendimento/") ||
      url.pathname.startsWith("/api/public-scheduling/") ||
      url.pathname.startsWith("/api/public-support/") ||
      url.pathname.startsWith("/api/public-analytics/")
    ) {
      if (!env.DB)
        return url.pathname.startsWith("/api/")
          ? json({ error: "Banco de dados indisponível." }, 503)
          : new Response("Este serviço ainda não está disponível.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            });
      try {
        const response = await handlePublicPlatformSuite(request, env, url, {
          json,
          allowed,
        });
        if (response) return response;
      } catch (error) {
        console.error("Public platform suite error", error);
        return url.pathname.startsWith("/api/")
          ? json({ error: "Não foi possível concluir a solicitação." }, 500)
          : new Response("Este serviço não está disponível agora.", {
              status: 500,
              headers: { "content-type": "text/plain; charset=utf-8" },
            });
      }
    }
    if (url.pathname.startsWith("/api/public/v1/")) {
      if (!env.DB)
        return publicApiJson({ error: "Banco de dados indisponível." }, 503);
      try {
        return await handlePublicApi(request, env, url);
      } catch (error) {
        console.error("Public API error", error);
        return publicApiJson(
          { error: "Não foi possível concluir a chamada." },
          500,
        );
      }
    }
    if (url.pathname === "/api/system/version")
      return handleSystemVersion(request, env, url);
    if (url.pathname === "/api/status") return handleStatus(env, url);
    if (url.pathname === "/api/inbound/whatsapp") {
      try {
        return await handleInboundWhatsApp(request, env, url);
      } catch (error) {
        console.error("Inbound WhatsApp error", error);
        return json({ error: "Não foi possível receber o WhatsApp." }, 500);
      }
    }
    if (url.pathname === "/api/inbound/email") {
      try {
        return await handleInboundEmail(request, env);
      } catch (error) {
        console.error("Inbound email error", error);
        return json({ error: "Não foi possível receber o e-mail." }, 500);
      }
    }
    if (
      url.pathname.startsWith("/orcamento/") ||
      url.pathname.startsWith("/api/public-quotes/")
    ) {
      try {
        const response = await handlePublicQuote(request, env, url);
        if (response) return response;
      } catch (error) {
        console.error("Public quote error", error);
        return url.pathname.startsWith("/orcamento/")
          ? new Response("Este orçamento não está disponível.", {
              status: 500,
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "cache-control": "no-store",
              },
            })
          : json({ error: "Não foi possível registrar a resposta." }, 500);
      }
    }
    if (
      url.pathname.startsWith("/f/") ||
      url.pathname.startsWith("/api/public-forms/")
    ) {
      try {
        const response = await handlePublicForm(request, env, url);
        if (response) return response;
      } catch (error) {
        console.error("Public form error", error);
        return url.pathname.startsWith("/f/")
          ? new Response("Este formulário não está disponível.", {
              status: 500,
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "cache-control": "no-store",
              },
            })
          : json({ error: "Não foi possível concluir o envio." }, 500);
      }
    }
    if (
      url.pathname.startsWith("/portal/") ||
      url.pathname.startsWith("/api/portal/")
    ) {
      try {
        const response = await handlePublicClientPortal(request, env, url);
        if (response) return response;
      } catch (error) {
        console.error("Public client portal error", error);
        return url.pathname.startsWith("/portal/")
          ? new Response("Este portal não está disponível.", {
              status: 500,
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "cache-control": "no-store",
              },
            })
          : json({ error: "Não foi possível concluir a ação no portal." }, 500);
      }
    }
    if (
      url.pathname.startsWith("/s/") ||
      url.pathname.startsWith("/loja/") ||
      url.pathname.startsWith("/api/public-sites/")
    ) {
      try {
        const response = await handlePublicSite(request, env, url);
        if (response) return response;
      } catch (error) {
        console.error("Public site error", error);
        return url.pathname.startsWith("/s/") || url.pathname.startsWith("/loja/")
          ? new Response("Esta página não está disponível.", {
              status: 500,
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "cache-control": "no-store",
              },
            })
          : json({ error: "Não foi possível concluir o envio." }, 500);
      }
    }
    if (url.pathname === "/api/config") return handleConfig(env);
    if (url.pathname === "/api/errors") {
      try {
        return await handleErrorLog(request, env);
      } catch (error) {
        console.error("Error log failure", error);
        return json({ ok: true });
      }
    }
    if (url.pathname.startsWith("/api/auth/")) {
      try {
        return await handleAuth(request, env, url);
      } catch (error) {
        console.error("Auth error", error);
        return json({ error: "Não foi possível concluir o acesso." }, 500);
      }
    }
    if (url.pathname.startsWith("/api/test-support/")) {
      try {
        return await handleTestSupport(request, env, url);
      } catch (error) {
        console.error("Test support error", error);
        return json({ error: "Não foi possível concluir a ação de teste." }, 500);
      }
    }
    if (
      url.pathname === "/api/collab/invite-info" ||
      url.pathname === "/api/collab/invite/accept"
    ) {
      try {
        const response = await handlePublicInvite(request, env, url);
        if (response) return response;
      } catch (error) {
        console.error("Public invite error", error);
        return json({ error: "Não foi possível concluir a ação." }, 500);
      }
    }
    // Convite individual: o token opaco do e-mail é a credencial desta única
    // etapa. Ele não usa nem aceita a sessão de quem fez o convite.
    if (url.pathname === "/api/todogreen/access-invite") {
      try {
        return await handleTodoGreenCore(request, env, null, url, { audit: logAudit });
      } catch (error) {
        console.error("To Do Green public invite error", error);
        return json({ error: "Não foi possível abrir este convite." }, 500);
      }
    }
    const needsAuth =
      url.pathname === "/api/ai" ||
      url.pathname === "/api/plan" ||
      url.pathname === "/api/ai/stream" ||
      url.pathname === "/api/transcribe" ||
      url.pathname === "/api/media" ||
      url.pathname === "/api/workspace" ||
      url.pathname === "/api/workspace/backups" ||
      url.pathname === "/api/webhooks" ||
      url.pathname === "/api/tasks/action" ||
      url.pathname === "/api/events" ||
      url.pathname === "/api/outbox/send" ||
      url.pathname.startsWith("/api/inbox") ||
      url.pathname.startsWith("/api/quotes/") ||
      url.pathname.startsWith("/api/forms/") ||
      url.pathname.startsWith("/api/client-portals/") ||
      url.pathname.startsWith("/api/collab") ||
      url.pathname === "/api/tasks/notify" ||
      url.pathname.startsWith("/api/sites/") ||
      url.pathname.startsWith("/api/free-suite/") ||
      url.pathname.startsWith("/api/platform/") ||
      url.pathname.startsWith("/api/todogreen/") ||
      url.pathname.startsWith("/api/ai-keys") ||
      url.pathname.startsWith("/api/search-keys") ||
      url.pathname.startsWith("/api/push/");
    if (needsAuth) {
      if (url.pathname === "/api/ai" && request.method !== "POST")
        return json({ error: "Método não permitido." }, 405);
      if (
        (url.pathname === "/api/workspace" ||
          url.pathname === "/api/workspace/backups" ||
          url.pathname === "/api/tasks/action" ||
          url.pathname === "/api/events" ||
          url.pathname === "/api/outbox/send" ||
          url.pathname.startsWith("/api/inbox") ||
          url.pathname.startsWith("/api/forms/") ||
          url.pathname.startsWith("/api/client-portals/") ||
          url.pathname.startsWith("/api/collab") ||
          url.pathname.startsWith("/api/sites/") ||
          url.pathname.startsWith("/api/free-suite/") ||
          url.pathname.startsWith("/api/platform/") ||
          url.pathname.startsWith("/api/todogreen/") ||
          url.pathname.startsWith("/api/ai-keys") ||
          url.pathname.startsWith("/api/search-keys") ||
          url.pathname === "/api/plan" ||
          url.pathname === "/api/webhooks" ||
          url.pathname.startsWith("/api/push/")) &&
        !env.DB
      )
        return json(
          { error: "O serviço de contas ainda não está configurado." },
          503,
        );
      let user;
      try {
        user = await sessionUser(request, env);
        if (!user)
          return json({ error: "Sua sessão expirou. Entre novamente." }, 401);
      } catch (error) {
        console.error("Session check error", error);
        return json({ error: "Não foi possível validar sua sessão." }, 500);
      }
      // Chaves de IA do espaço de trabalho ("traga sua própria chave").
      // Exige owner/admin: uma chave de API é credencial que gera cobrança na
      // conta de quem a trouxe, e não é coisa que qualquer membro cadastre ou
      // apague pelos outros.
      if (url.pathname.startsWith("/api/ai-keys")) {
        try {
          const ownerId = url.searchParams.get("owner") || user.id;
          const role = await membershipRole(env, user.id, ownerId);
          if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
          if (role !== "owner" && role !== "admin")
            return json(
              { error: "Somente o dono ou um administrador do espaço cadastra chaves de IA." },
              403,
            );
          const { handleAiKeys } = await import("./worker/services/ai-keys.js");
          return await handleAiKeys(request, env, { ownerId, userId: user.id });
        } catch (error) {
          console.error("AI keys error", error);
          return json({ error: "Não foi possível salvar a chave de IA." }, 500);
        }
      }
      // Configuração de busca do espaço ("traga sua própria busca"): a URL do
      // SearXNG e as chaves de provedores de pesquisa. Mesma exigência de
      // owner/admin das chaves de IA — é a credencial que decide de onde a
      // pesquisa da empresa inteira sai.
      if (url.pathname.startsWith("/api/search-keys")) {
        try {
          const ownerId = url.searchParams.get("owner") || user.id;
          const role = await membershipRole(env, user.id, ownerId);
          if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
          if (role !== "owner" && role !== "admin")
            return json(
              { error: "Somente o dono ou um administrador do espaço configura a busca." },
              403,
            );
          const { handleSearchKeys } = await import("./worker/services/search-keys.js");
          return await handleSearchKeys(request, env, { ownerId, userId: user.id });
        } catch (error) {
          console.error("Search keys error", error);
          return json({ error: "Não foi possível salvar a configuração de busca." }, 500);
        }
      }
      if (url.pathname === "/api/workspace") {
        try {
          return await handleWorkspace(request, env, user, url, ctx, notifyWorkspaceChange);
        } catch (error) {
          console.error("Workspace error", error);
          return json(
            { error: "Não foi possível sincronizar seus dados." },
            500,
          );
        }
      }
      if (url.pathname === "/api/webhooks") {
        try {
          return await handleWebhooks(request, env, user, url);
        } catch (error) {
          console.error("Webhook error", error);
          return json(
            { error: "Não foi possível configurar o envio automático." },
            500,
          );
        }
      }
      if (url.pathname === "/api/workspace/backups") {
        try {
          return await handleWorkspaceBackups(request, env, user, url);
        } catch (error) {
          console.error("Workspace backup error", error);
          return json(
            { error: "Não foi possível acessar os backups deste espaço." },
            500,
          );
        }
      }
      if (url.pathname === "/api/tasks/action") {
        try {
          return await handleTaskAction(request, env, user, url);
        } catch (error) {
          console.error("Task action error", error);
          return json({ error: "Não foi possível atualizar esta tarefa." }, 500);
        }
      }
      if (url.pathname === "/api/transcribe") {
        return await handleTranscribe(request, env);
      }
      if (url.pathname === "/api/events") {
        try {
          return await handleProductEvents(request, env, user, url);
        } catch (error) {
          console.error("Product event error", error);
          return json({ error: "Não foi possível registrar este evento." }, 500);
        }
      }
      if (url.pathname === "/api/outbox/send") {
        try {
          return await handleOutboxSend(request, env, user, url);
        } catch (error) {
          console.error("Outbox send error", error);
          return json({ error: "Não foi possível enviar a mensagem." }, 500);
        }
      }
      if (url.pathname === "/api/inbox/personal") {
        try {
          return await handlePersonalInbox(request, env, user, url);
        } catch (error) {
          console.error("Personal inbox error", error);
          return json(
            { error: "Não foi possível acessar sua caixa de entrada pessoal." },
            500,
          );
        }
      }
      if (url.pathname === "/api/inbox/conversations") {
        try {
          return await handleInboxConversations(request, env, user, url);
        } catch (error) {
          console.error("Inbox conversations error", error);
          return json(
            { error: "Não foi possível acessar as conversas da caixa." },
            500,
          );
        }
      }
      if (url.pathname === "/api/inbox") {
        try {
          return await handleInbox(request, env, user, url);
        } catch (error) {
          console.error("Inbox error", error);
          return json(
            { error: "Não foi possível acessar a caixa de entrada." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/quotes/")) {
        try {
          return await handleQuotes(request, env, user, url);
        } catch (error) {
          console.error("Quotes error", error);
          return json(
            { error: "Não foi possível compartilhar o orçamento." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/forms/")) {
        try {
          return await handleForms(request, env, user, url);
        } catch (error) {
          console.error("Forms error", error);
          return json(
            { error: "Não foi possível gerenciar este formulário." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/client-portals/")) {
        try {
          return await handleClientPortals(request, env, user, url);
        } catch (error) {
          console.error("Client portals error", error);
          return json(
            { error: "Não foi possível gerenciar este portal." },
            500,
          );
        }
      }
      if (url.pathname === "/api/tasks/notify") {
        try {
          return await handleTaskNotify(request, env, user);
        } catch (error) {
          console.error("Notify error", error);
          return json({ error: "Não foi possível enviar o aviso." }, 500);
        }
      }
      if (url.pathname.startsWith("/api/collab")) {
        try {
          return await handleCollab(request, env, user, url);
        } catch (error) {
          console.error("Collab error", error);
          return json(
            { error: "Não foi possível concluir a ação de colaboração." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/sites/")) {
        try {
          return await handleSites(request, env, user, url);
        } catch (error) {
          console.error("Sites error", error);
          return json(
            { error: "Não foi possível concluir a publicação." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/free-suite/")) {
        try {
          return await handleFreeSuite(request, env, user, url);
        } catch (error) {
          console.error("Free suite error", error);
          return json(
            { error: "Não foi possível concluir a ação no laboratório." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/platform/")) {
        try {
          return await handlePlatformSuite(request, env, user, url, {
            json,
            ownerAccess: freeSuiteOwner,
          });
        } catch (error) {
          console.error("Platform suite error", error);
          return json(
            { error: "Não foi possível concluir a ação nesta central." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/todogreen/")) {
        try {
          return await handleTodoGreenCore(request, env, user, url, {
            audit: logAudit,
          });
        } catch (error) {
          console.error("To Do Green error", error);
          return json(
            { error: "Não foi possível concluir a ação da To Do Green." },
            500,
          );
        }
      }
      if (url.pathname.startsWith("/api/push/")) {
        try {
          return await handlePush(request, env, user, url);
        } catch (error) {
          console.error("Push error", error);
          return json(
            { error: "Não foi possível concluir a ação de notificação." },
            500,
          );
        }
      }
      if (url.pathname === "/api/plan") {
        try {
          return json(await planSnapshot(env, user.id));
        } catch (error) {
          console.error("Plan error", error);
          return json(
            { error: "Não foi possível ler o seu plano agora." },
            500,
          );
        }
      }
      if (url.pathname === "/api/ai/stream") {
        try {
          return await handleAiStream(request, env, user);
        } catch (error) {
          console.error("Stream error", error);
          return json({ error: "Streaming indisponível.", fallback: true }, 500);
        }
      }
      return url.pathname === "/api/ai"
        ? handleAi(request, env, user)
        : handleMedia(request, env, url);
    }
    // Fallback: serve o SPA. Envelopa o HTML com cabeçalhos de segurança —
    // os portais externos (cliente/motorista/colaborador) e a entrada da
    // vertical são rotas React DENTRO deste shell, então precisam de
    // anti-clickjacking (sempre) e noindex nas superfícies privadas. Sites e
    // formulários públicos têm handlers próprios e não passam por aqui.
    const assetResp = await env.ASSETS.fetch(request);
    const contentType = assetResp.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return assetResp;
    const headers = new Headers(assetResp.headers);
    headers.set("x-frame-options", "DENY");
    if (/^\/(portal-cliente|portal-motorista|portal-colaborador|todogreen)(\/|$)/.test(url.pathname)) {
      headers.set("x-robots-tag", "noindex, nofollow");
    }
    return new Response(assetResp.body, {
      status: assetResp.status,
      statusText: assetResp.statusText,
      headers,
    });
  },
};
