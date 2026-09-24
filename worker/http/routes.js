// ===== Tabela de rotas do app: a fonte única de verdade =====
//
// Contrato
// - Exporta ROTAS_PUBLICAS e ROTAS_AUTENTICADAS, listas ORDENADAS (a primeira
//   entrada que casa o caminho responde), e o que deriva delas: `needsAuth`,
//   `ROTAS_QUE_EXIGEM_BANCO` e `PREFIXOS_PUBLICOS_DE_PAGINA`.
// - Quem usa: worker/http/router.js, que despacha, e os testes que travam a
//   tabela.
// - Autorização: toda entrada de ROTAS_AUTENTICADAS só roda depois que o
//   roteador validou a sessão (401 sem ela). Rota nova de dados entra AQUI,
//   e só aqui: é a própria entrada que liga a checagem de sessão e a de banco,
//   em vez de duas listas mantidas à mão. As de ROTAS_PUBLICAS respondem sem
//   sessão e se autenticam sozinhas quando precisam (token no link, segredo
//   do webhook, chave da API pública).
//
// Formato de cada entrada
// - caminhos: padrões no formato do run_worker_first do wrangler.jsonc —
//   "/api/x" casa só aquele caminho; terminado em "*" casa o prefixo
//   ("/api/x/*", "/api/collab*"). Prefixo fora de /api/ é PÁGINA: quando o
//   handler falha, a resposta sai em texto, não em JSON.
// - executar({ request, env, ctx, url, user, pagina }): chama o handler.
// - rotulo e falha({ pagina }): o que o guarda único do roteador registra no
//   console.error e responde quando o handler lança.
// - exigeBanco: sem env.DB, responde antes do handler — nas autenticadas com
//   503 "O serviço de contas ainda não está configurado."; nas públicas, com
//   o que a entrada declarar em `semBanco`.
// - opcional (só públicas): se o handler devolver null, a cadeia segue para
//   as entradas seguintes.
// - metodo (só autenticadas): o único método aceito, conferido antes do banco
//   e da sessão — hoje só /api/ai, que responde 405 aos demais.

import { randomHex } from "../auth/credenciais.js";
import { logAudit } from "../lib/audit.js";
import { moneyBRL } from "../lib/format.js";
import { allowed, json } from "../lib/http.js";
import { membershipRole } from "../lib/membership.js";
import { escMail } from "../mensageria/envio.js";
import { handleAi, handleAiStream } from "../services/ai.js";
import {
  handleConfig,
  handleStatus,
  handleSystemVersion,
} from "../services/app-info.js";
import { handleAuth } from "../services/auth.js";
import {
  handleClientPortals,
  handlePublicClientPortal,
} from "../services/client-portal.js";
import { handleCollab } from "../services/collab.js";
import { handleErrorLog } from "../services/error-log.js";
import { freeSuiteOwner, handleFreeSuite } from "../services/free-suite.js";
import {
  handleInboundEmail,
  handleInboundWhatsApp,
} from "../services/inbound-webhooks.js";
import { handleInbox, handleInboxConversations } from "../services/inbox.js";
import { handleMedia } from "../services/media.js";
import { handleOutboxSend } from "../services/outbox.js";
import { handlePersonalInbox } from "../services/personal-inbox.js";
import { planSnapshot } from "../services/plan-usage.js";
import {
  handlePlatformSuite,
  handlePublicPlatformSuite,
} from "../services/platform-suite.js";
import { handleProductEvents } from "../services/product-events.js";
import { handlePublicApi, publicApiJson } from "../services/public-api.js";
import { handleForms, handlePublicForm } from "../services/public-forms.js";
import { handlePublicInvite } from "../services/public-invite.js";
import { handlePublicSite } from "../services/public-site.js";
import { handlePush } from "../services/push-subscriptions.js";
import { createQuoteHandlers } from "../services/quotes.js";
import { handleSites } from "../services/sites.js";
import { handleTaskAction } from "../services/task-action.js";
import { handleTaskNotify } from "../services/task-notify.js";
import { handleTestSupport } from "../services/test-support.js";
import { handleTodoGreenCore } from "../services/todogreen-core.js";
import { handleTranscribe } from "../services/transcribe.js";
import { createWebhookHandlers } from "../services/webhooks.js";
import { handleWorkspace } from "../services/workspace.js";
import { handleWorkspaceBackups } from "../services/workspace-backups.js";

// Instanciados uma vez por isolate, como faziam no topo do worker.js: o de
// webhooks guarda o cache do esquema, e o notifyWorkspaceChange que ele
// devolve vai para o handleWorkspace.
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

// ── Casamento de caminho ────────────────────────────────────────────────
export const casaCaminho = (padrao, pathname) =>
  padrao.endsWith("*")
    ? pathname.startsWith(padrao.slice(0, -1))
    : pathname === padrao;

export const casaRota = (rota, pathname) =>
  rota.caminhos.some((padrao) => casaCaminho(padrao, pathname));

// Página pública: prefixo que o Worker renderiza como HTML, fora de /api/.
export const ehPrefixoDePagina = (padrao) =>
  padrao.endsWith("*") && !padrao.startsWith("/api/");

export const casaPagina = (rota, pathname) =>
  rota.caminhos.some(
    (padrao) => ehPrefixoDePagina(padrao) && casaCaminho(padrao, pathname),
  );

// ── Respostas de falha ──────────────────────────────────────────────────
const erro = (mensagem, status = 500) => () => json({ error: mensagem }, status);

// Texto simples das páginas públicas. O da agenda e do atendimento nunca
// levou cache-control; o das demais leva no-store.
const TEXTO = { "content-type": "text/plain; charset=utf-8" };
const TEXTO_SEM_CACHE = { ...TEXTO, "cache-control": "no-store" };
const texto = (mensagem, status, headers) => () =>
  new Response(mensagem, { status, headers });

// Página em texto, API em JSON — escolhido pelo padrão que casou o caminho.
const paginaOuApi = (naPagina, naApi) => (contexto) =>
  contexto.pagina ? naPagina(contexto) : naApi(contexto);

// ── Handlers que a tabela compõe ────────────────────────────────────────
// Chaves de IA do espaço de trabalho ("traga sua própria chave").
// Exige owner/admin: uma chave de API é credencial que gera cobrança na
// conta de quem a trouxe, e não é coisa que qualquer membro cadastre ou
// apague pelos outros.
async function chavesDeIa({ request, env, url, user }) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  if (role !== "owner" && role !== "admin")
    return json(
      { error: "Somente o dono ou um administrador do espaço cadastra chaves de IA." },
      403,
    );
  const { handleAiKeys } = await import("../services/ai-keys.js");
  return await handleAiKeys(request, env, { ownerId, userId: user.id });
}

// Configuração de busca do espaço ("traga sua própria busca"): a URL do
// SearXNG e as chaves de provedores de pesquisa. Mesma exigência de
// owner/admin das chaves de IA — é a credencial que decide de onde a
// pesquisa da empresa inteira sai.
async function configuracaoDeBusca({ request, env, url, user }) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  if (role !== "owner" && role !== "admin")
    return json(
      { error: "Somente o dono ou um administrador do espaço configura a busca." },
      403,
    );
  const { handleSearchKeys } = await import("../services/search-keys.js");
  return await handleSearchKeys(request, env, { ownerId, userId: user.id });
}

// ── Rotas públicas, na ordem em que são consultadas ─────────────────────
export const ROTAS_PUBLICAS = Object.freeze([
  {
    caminhos: [
      "/agenda/*",
      "/atendimento/*",
      "/api/public-scheduling/*",
      "/api/public-support/*",
      "/api/public-analytics/*",
    ],
    exigeBanco: true,
    semBanco: paginaOuApi(
      texto("Este serviço ainda não está disponível.", 503, TEXTO),
      erro("Banco de dados indisponível.", 503),
    ),
    opcional: true,
    rotulo: "Public platform suite error",
    falha: paginaOuApi(
      texto("Este serviço não está disponível agora.", 500, TEXTO),
      erro("Não foi possível concluir a solicitação."),
    ),
    executar: ({ request, env, url }) =>
      handlePublicPlatformSuite(request, env, url, { json, allowed }),
  },
  {
    caminhos: ["/api/public/v1/*"],
    exigeBanco: true,
    semBanco: () =>
      publicApiJson({ error: "Banco de dados indisponível." }, 503),
    rotulo: "Public API error",
    falha: () =>
      publicApiJson({ error: "Não foi possível concluir a chamada." }, 500),
    executar: ({ request, env, url }) => handlePublicApi(request, env, url),
  },
  {
    caminhos: ["/api/system/version"],
    rotulo: "System version error",
    falha: erro("Não foi possível ler a versão publicada."),
    executar: ({ request, env, url }) => handleSystemVersion(request, env, url),
  },
  {
    caminhos: ["/api/status"],
    rotulo: "Status error",
    falha: erro("Não foi possível verificar o status agora."),
    executar: ({ env, url }) => handleStatus(env, url),
  },
  {
    caminhos: ["/api/inbound/whatsapp"],
    rotulo: "Inbound WhatsApp error",
    falha: erro("Não foi possível receber o WhatsApp."),
    executar: ({ request, env, url }) =>
      handleInboundWhatsApp(request, env, url),
  },
  {
    caminhos: ["/api/inbound/email"],
    rotulo: "Inbound email error",
    falha: erro("Não foi possível receber o e-mail."),
    executar: ({ request, env }) => handleInboundEmail(request, env),
  },
  {
    caminhos: ["/orcamento/*", "/api/public-quotes/*"],
    opcional: true,
    rotulo: "Public quote error",
    falha: paginaOuApi(
      texto("Este orçamento não está disponível.", 500, TEXTO_SEM_CACHE),
      erro("Não foi possível registrar a resposta."),
    ),
    executar: ({ request, env, url }) => handlePublicQuote(request, env, url),
  },
  {
    caminhos: ["/f/*", "/api/public-forms/*"],
    opcional: true,
    rotulo: "Public form error",
    falha: paginaOuApi(
      texto("Este formulário não está disponível.", 500, TEXTO_SEM_CACHE),
      erro("Não foi possível concluir o envio."),
    ),
    executar: ({ request, env, url }) => handlePublicForm(request, env, url),
  },
  {
    caminhos: ["/portal/*", "/api/portal/*"],
    opcional: true,
    rotulo: "Public client portal error",
    falha: paginaOuApi(
      texto("Este portal não está disponível.", 500, TEXTO_SEM_CACHE),
      erro("Não foi possível concluir a ação no portal."),
    ),
    executar: ({ request, env, url }) =>
      handlePublicClientPortal(request, env, url),
  },
  {
    caminhos: ["/s/*", "/loja/*", "/api/public-sites/*"],
    opcional: true,
    rotulo: "Public site error",
    falha: paginaOuApi(
      texto("Esta página não está disponível.", 500, TEXTO_SEM_CACHE),
      erro("Não foi possível concluir o envio."),
    ),
    executar: ({ request, env, url }) => handlePublicSite(request, env, url),
  },
  {
    caminhos: ["/api/config"],
    rotulo: "Config error",
    falha: erro("Não foi possível ler a configuração agora."),
    executar: ({ env }) => handleConfig(env),
  },
  {
    caminhos: ["/api/errors"],
    rotulo: "Error log failure",
    falha: () => json({ ok: true }),
    executar: ({ request, env }) => handleErrorLog(request, env),
  },
  {
    caminhos: ["/api/auth/*"],
    rotulo: "Auth error",
    falha: erro("Não foi possível concluir o acesso."),
    executar: ({ request, env, url }) => handleAuth(request, env, url),
  },
  {
    caminhos: ["/api/test-support/*"],
    rotulo: "Test support error",
    falha: erro("Não foi possível concluir a ação de teste."),
    executar: ({ request, env, url }) => handleTestSupport(request, env, url),
  },
  {
    caminhos: ["/api/collab/invite-info", "/api/collab/invite/accept"],
    opcional: true,
    rotulo: "Public invite error",
    falha: erro("Não foi possível concluir a ação."),
    executar: ({ request, env, url }) => handlePublicInvite(request, env, url),
  },
  // Convite individual: o token opaco do e-mail é a credencial desta única
  // etapa. Ele não usa nem aceita a sessão de quem fez o convite.
  {
    caminhos: ["/api/todogreen/access-invite"],
    rotulo: "To Do Green public invite error",
    falha: erro("Não foi possível abrir este convite."),
    executar: ({ request, env, url }) =>
      handleTodoGreenCore(request, env, null, url, { audit: logAudit }),
  },
]);

// ── Rotas que exigem sessão, na ordem em que são consultadas ────────────
export const ROTAS_AUTENTICADAS = Object.freeze([
  {
    caminhos: ["/api/ai-keys*"],
    exigeBanco: true,
    rotulo: "AI keys error",
    falha: erro("Não foi possível salvar a chave de IA."),
    executar: chavesDeIa,
  },
  {
    caminhos: ["/api/search-keys*"],
    exigeBanco: true,
    rotulo: "Search keys error",
    falha: erro("Não foi possível salvar a configuração de busca."),
    executar: configuracaoDeBusca,
  },
  {
    caminhos: ["/api/workspace"],
    exigeBanco: true,
    rotulo: "Workspace error",
    falha: erro("Não foi possível sincronizar seus dados."),
    executar: ({ request, env, user, url, ctx }) =>
      handleWorkspace(request, env, user, url, ctx, notifyWorkspaceChange),
  },
  {
    caminhos: ["/api/webhooks"],
    exigeBanco: true,
    rotulo: "Webhook error",
    falha: erro("Não foi possível configurar o envio automático."),
    executar: ({ request, env, user, url }) =>
      handleWebhooks(request, env, user, url),
  },
  {
    caminhos: ["/api/workspace/backups"],
    exigeBanco: true,
    rotulo: "Workspace backup error",
    falha: erro("Não foi possível acessar os backups deste espaço."),
    executar: ({ request, env, user, url }) =>
      handleWorkspaceBackups(request, env, user, url),
  },
  {
    caminhos: ["/api/tasks/action"],
    exigeBanco: true,
    rotulo: "Task action error",
    falha: erro("Não foi possível atualizar esta tarefa."),
    executar: ({ request, env, user, url }) =>
      handleTaskAction(request, env, user, url),
  },
  {
    caminhos: ["/api/transcribe"],
    rotulo: null,
    falha: null,
    executar: ({ request, env }) => handleTranscribe(request, env),
  },
  {
    caminhos: ["/api/events"],
    exigeBanco: true,
    rotulo: "Product event error",
    falha: erro("Não foi possível registrar este evento."),
    executar: ({ request, env, user, url }) =>
      handleProductEvents(request, env, user, url),
  },
  {
    caminhos: ["/api/outbox/send"],
    exigeBanco: true,
    rotulo: "Outbox send error",
    falha: erro("Não foi possível enviar a mensagem."),
    executar: ({ request, env, user, url }) =>
      handleOutboxSend(request, env, user, url),
  },
  {
    caminhos: ["/api/inbox/personal"],
    exigeBanco: true,
    rotulo: "Personal inbox error",
    falha: erro("Não foi possível acessar sua caixa de entrada pessoal."),
    executar: ({ request, env, user, url }) =>
      handlePersonalInbox(request, env, user, url),
  },
  {
    caminhos: ["/api/inbox/conversations"],
    exigeBanco: true,
    rotulo: "Inbox conversations error",
    falha: erro("Não foi possível acessar as conversas da caixa."),
    executar: ({ request, env, user, url }) =>
      handleInboxConversations(request, env, user, url),
  },
  {
    caminhos: ["/api/inbox"],
    exigeBanco: true,
    rotulo: "Inbox error",
    falha: erro("Não foi possível acessar a caixa de entrada."),
    executar: ({ request, env, user, url }) =>
      handleInbox(request, env, user, url),
  },
  {
    caminhos: ["/api/quotes/*"],
    rotulo: "Quotes error",
    falha: erro("Não foi possível compartilhar o orçamento."),
    executar: ({ request, env, user, url }) =>
      handleQuotes(request, env, user, url),
  },
  {
    caminhos: ["/api/forms/*"],
    exigeBanco: true,
    rotulo: "Forms error",
    falha: erro("Não foi possível gerenciar este formulário."),
    executar: ({ request, env, user, url }) =>
      handleForms(request, env, user, url),
  },
  {
    caminhos: ["/api/client-portals/*"],
    exigeBanco: true,
    rotulo: "Client portals error",
    falha: erro("Não foi possível gerenciar este portal."),
    executar: ({ request, env, user, url }) =>
      handleClientPortals(request, env, user, url),
  },
  {
    caminhos: ["/api/tasks/notify"],
    rotulo: "Notify error",
    falha: erro("Não foi possível enviar o aviso."),
    executar: ({ request, env, user }) => handleTaskNotify(request, env, user),
  },
  {
    caminhos: ["/api/collab*"],
    exigeBanco: true,
    rotulo: "Collab error",
    falha: erro("Não foi possível concluir a ação de colaboração."),
    executar: ({ request, env, user, url }) =>
      handleCollab(request, env, user, url),
  },
  {
    caminhos: ["/api/sites/*"],
    exigeBanco: true,
    rotulo: "Sites error",
    falha: erro("Não foi possível concluir a publicação."),
    executar: ({ request, env, user, url }) =>
      handleSites(request, env, user, url),
  },
  {
    caminhos: ["/api/free-suite/*"],
    exigeBanco: true,
    rotulo: "Free suite error",
    falha: erro("Não foi possível concluir a ação no laboratório."),
    executar: ({ request, env, user, url }) =>
      handleFreeSuite(request, env, user, url),
  },
  {
    caminhos: ["/api/platform/*"],
    exigeBanco: true,
    rotulo: "Platform suite error",
    falha: erro("Não foi possível concluir a ação nesta central."),
    executar: ({ request, env, user, url }) =>
      handlePlatformSuite(request, env, user, url, {
        json,
        ownerAccess: freeSuiteOwner,
      }),
  },
  {
    caminhos: ["/api/todogreen/*"],
    exigeBanco: true,
    rotulo: "To Do Green error",
    falha: erro("Não foi possível concluir a ação da To Do Green."),
    executar: ({ request, env, user, url }) =>
      handleTodoGreenCore(request, env, user, url, { audit: logAudit }),
  },
  {
    caminhos: ["/api/push/*"],
    exigeBanco: true,
    rotulo: "Push error",
    falha: erro("Não foi possível concluir a ação de notificação."),
    executar: ({ request, env, user, url }) =>
      handlePush(request, env, user, url),
  },
  {
    caminhos: ["/api/plan"],
    exigeBanco: true,
    rotulo: "Plan error",
    falha: erro("Não foi possível ler o seu plano agora."),
    executar: async ({ env, user }) => json(await planSnapshot(env, user.id)),
  },
  {
    caminhos: ["/api/ai/stream"],
    rotulo: "Stream error",
    falha: () => json({ error: "Streaming indisponível.", fallback: true }, 500),
    executar: ({ request, env, user }) => handleAiStream(request, env, user),
  },
  {
    caminhos: ["/api/ai"],
    metodo: "POST",
    rotulo: null,
    falha: null,
    executar: ({ request, env, user }) => handleAi(request, env, user),
  },
  {
    caminhos: ["/api/media"],
    rotulo: null,
    falha: null,
    executar: ({ request, env, url }) => handleMedia(request, env, url),
  },
  // Legado: o needsAuth antigo casava o prefixo /api/inbox inteiro, e o que
  // não era uma das três rotas da caixa caía no handleMedia.
  {
    caminhos: ["/api/inbox*"],
    exigeBanco: true,
    rotulo: null,
    falha: null,
    executar: ({ request, env, url }) => handleMedia(request, env, url),
  },
]);

// ── O que deriva da tabela ──────────────────────────────────────────────
// Se o caminho chegar à portaria das rotas autenticadas, exige sessão. (As
// públicas são consultadas antes: /api/collab/invite-info responde sem
// sessão mesmo casando /api/collab*.)
export const needsAuth = (pathname) =>
  ROTAS_AUTENTICADAS.some((rota) => casaRota(rota, pathname));

// As rotas autenticadas que respondem 503 quando falta o D1. As demais
// seguem funcionando sem banco: o sessionUser devolve { id: "local" }.
export const ROTAS_QUE_EXIGEM_BANCO = Object.freeze(
  ROTAS_AUTENTICADAS.filter((rota) => rota.exigeBanco).flatMap(
    (rota) => rota.caminhos,
  ),
);

// Os prefixos públicos que o Worker renderiza como página (fora de /api/),
// tirados das próprias entradas acima. Cada um precisa constar em
// assets.run_worker_first do wrangler.jsonc: fora dele, o Cloudflare serve
// o index.html do SPA sem chegar ao Worker.
export const PREFIXOS_PUBLICOS_DE_PAGINA = Object.freeze(
  ROTAS_PUBLICAS.flatMap((rota) => rota.caminhos)
    .filter(ehPrefixoDePagina)
    .map((padrao) => padrao.slice(0, -1)),
);
