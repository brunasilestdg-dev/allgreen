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
import { cleanText, moneyBRL } from "./worker/lib/format.js";
import { allowed, json } from "./worker/lib/http.js";
import { logAudit } from "./worker/lib/audit.js";
import { membershipRole } from "./worker/lib/membership.js";
import {
  pushEnabled,
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
import { webSearchConfiguration } from "./worker/services/web-search.js";
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
  handleClientPortals,
  handlePublicClientPortal,
} from "./worker/services/client-portal.js";
import { handleErrorLog } from "./worker/services/error-log.js";
import {
  handleInboundEmail,
  handleInboundWhatsApp,
} from "./worker/services/inbound-webhooks.js";
import { handleInbox, handleInboxConversations } from "./worker/services/inbox.js";
import { handleOutboxSend } from "./worker/services/outbox.js";
import { handlePersonalInbox } from "./worker/services/personal-inbox.js";
import { handleProductEvents } from "./worker/services/product-events.js";
import { handleForms, handlePublicForm } from "./worker/services/public-forms.js";
import { handlePublicInvite } from "./worker/services/public-invite.js";
import { runScheduledAutomations } from "./worker/services/scheduled-automations.js";
import {
  handleSites,
  sanitizeSiteHtml,
  siteSlug,
} from "./worker/services/sites.js";
import { handleTaskAction } from "./worker/services/task-action.js";
import { handleTaskNotify } from "./worker/services/task-notify.js";
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
import { lerManifestoDeVersao, systemVersionPayload } from "./worker/services/todogreen-system-health.js";



// Uma fonte só para "qual SHA está publicado": o manifesto version.json do
// build. /api/status, /api/system/version e a tela Saúde do sistema leem daqui.
const publishedVersion = (env, origin) => lerManifestoDeVersao(env, origin);

// Movido para ./worker/auth/credenciais.js; reexportado para os testes.
export { createSession, hex, passwordHash, randomHex, sameHash, sha256, unhex };

// Movido para ./worker/services/sites.js; reexportado para
// src/public-sites.test.js.
export { sanitizeSiteHtml, siteSlug };

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


async function handlePush(request, env, user, url) {
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  const action = url.pathname.replace("/api/push/", "");
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  if (action === "subscribe") {
    if (!pushEnabled(env))
      return json(
        { error: "Notificações do navegador não estão configuradas." },
        503,
      );
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const p256dh = body.keys?.p256dh;
    const auth = body.keys?.auth;
    if (
      !endpoint ||
      typeof p256dh !== "string" ||
      !p256dh ||
      typeof auth !== "string" ||
      !auth
    )
      return json({ error: "Assinatura inválida." }, 400);
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id, p256dh = excluded.p256dh,
        auth = excluded.auth, created_at = excluded.created_at`,
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        endpoint,
        p256dh,
        auth,
        new Date().toISOString(),
      )
      .run();
    return json({ ok: true });
  }
  if (action === "unsubscribe") {
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    if (!endpoint) return json({ ok: true });
    await env.DB.prepare(
      "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?",
    )
      .bind(endpoint, user.id)
      .run();
    return json({ ok: true });
  }
  return json({ error: "Ação não encontrada." }, 404);
}


async function handleMedia(request, env, url) {
  if (request.method === "GET") {
    const requestId = url.searchParams.get("request_id") || "";
    if (!/^wan_[a-f0-9]{32}$/.test(requestId))
      return json({ error: "Identificador de vídeo inválido." }, 400);
    if (!env.VIDEO_AI_URL || !env.VIDEO_AI_TOKEN)
      return json(
        { error: "O servidor próprio de vídeo ainda não está conectado." },
        503,
      );
    const response = await fetch(
      `${env.VIDEO_AI_URL.replace(/\/$/, "")}/v1/videos/${requestId}`,
      { headers: { authorization: `Bearer ${env.VIDEO_AI_TOKEN}` } },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      return json(
        {
          error:
            data.detail ||
            data.error?.message ||
            "Não foi possível consultar o vídeo.",
        },
        response.status,
      );
    return json({
      status: data.status,
      progress: data.progress || 0,
      url: data.url || null,
      duration: data.duration || null,
      error: data.error || null,
    });
  }
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitação inválida." }, 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 5 || prompt.length > 3000)
    return json({ error: "Descreva o material em 5 a 3.000 caracteres." }, 400);
  if (body.type === "video") {
    if (!env.VIDEO_AI_URL || !env.VIDEO_AI_TOKEN)
      return json(
        {
          error:
            "O servidor próprio de vídeo ainda não está conectado. A aplicação não recorrerá a créditos de terceiros.",
        },
        503,
      );
    const response = await fetch(
      `${env.VIDEO_AI_URL.replace(/\/$/, "")}/v1/videos`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.VIDEO_AI_TOKEN}`,
        },
        body: JSON.stringify({
          prompt,
          quality: body.quality === "standard" ? "standard" : "advanced",
          aspectRatio: "16:9",
        }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      return json(
        {
          error:
            data.detail ||
            data.error?.message ||
            `Vídeo indisponível (${response.status}).`,
        },
        response.status,
      );
    return json({
      status: data.status || "pending",
      requestId: data.requestId,
      freeTier: false,
    });
  }
  const finalPrompt =
    body.type === "logo"
      ? `Crie um conceito de logo profissional e memorável para uso comercial. ${prompt}. Símbolo original, composição limpa, fundo simples, sem mockup, sem marca d'água, texto somente se solicitado e com grafia exata.`
      : prompt;
  if (env.AI) {
    try {
      const freeResult = await env.AI.run(
        "@cf/black-forest-labs/flux-1-schnell",
        {
          prompt: finalPrompt.slice(0, 2048),
          steps: 4,
          seed: Math.floor(Math.random() * 1_000_000),
        },
      );
      if (freeResult?.image)
        return json({
          status: "done",
          url: `data:image/jpeg;base64,${freeResult.image}`,
          mimeType: "image/jpeg",
          freeTier: true,
        });
    } catch {
      if (body.confirmPaid !== true)
        return json(
          {
            error:
              "A geração integrada está temporariamente indisponível. Tente novamente em alguns minutos.",
          },
          503,
        );
    }
  }
  if (body.confirmPaid !== true)
    return json(
      {
        error:
          "A geração integrada não respondeu. Tente novamente em alguns minutos.",
      },
      503,
    );
  if (!env.XAI_API_KEY)
    return json({ error: "A opção complementar não está disponível." }, 503);
  const response = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "grok-imagine-image",
      prompt: finalPrompt,
      response_format: "url",
      n: 1,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    return json(
      {
        error:
          data.error?.message || `Imagem indisponível (${response.status}).`,
      },
      response.status,
    );
  return json({
    status: "done",
    url: data.data?.[0]?.url || null,
    mimeType: data.data?.[0]?.mime_type || "image/jpeg",
    revisedPrompt: data.data?.[0]?.revised_prompt || "",
    freeTier: false,
  });
}

// Transcreve áudio com Whisper no Workers AI. O áudio é gravado ou escolhido no
// navegador e chega aqui em base64; nada é armazenado no servidor.
export async function handleTranscribe(request, env) {
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  if (!env.AI)
    return json(
      { error: "Transcrição indisponível: Workers AI não está configurado." },
      503,
    );
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Envio inválido." }, 400);
  }
  const base64 = String(body?.audio || "");
  if (!base64) return json({ error: "Nenhum áudio recebido." }, 400);
  // ~8 MB de base64 (aprox. 6 MB de áudio) é o teto por envio.
  if (base64.length > 8_000_000)
    return json(
      { error: "Áudio muito longo. Divida em partes de até 5 minutos." },
      413,
    );
  let bytes;
  try {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } catch {
    return json({ error: "Áudio em formato inválido." }, 400);
  }
  try {
    const result = await env.AI.run("@cf/openai/whisper", {
      audio: [...bytes],
    });
    const text = String(result?.text || "").trim();
    if (!text)
      return json({ error: "Não foi possível entender o áudio." }, 422);
    return json({
      text,
      words: result?.word_count ?? null,
    });
  } catch (error) {
    console.error("Transcribe error", error);
    return json({ error: "Não foi possível transcrever este áudio." }, 502);
  }
}

const apiCorsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, content-type, idempotency-key",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400",
};

function publicApiJson(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...apiCorsHeaders,
      ...extraHeaders,
    },
  });
}

const PUBLIC_API_COLLECTIONS = new Set([
  "tasks",
  "contacts",
  "opportunities",
  "transactions",
]);

function publicApiOpenApi(origin) {
  const paths = {
    "/api/public/v1/me": {
      get: {
        summary: "Identifica o espaço da chave",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Espaço autenticado" } },
      },
    },
  };
  for (const collection of PUBLIC_API_COLLECTIONS) {
    paths[`/api/public/v1/${collection}`] = {
      get: {
        summary: `Lista ${collection}`,
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: "query",
            name: "limit",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
          { in: "query", name: "businessId", schema: { type: "string" } },
        ],
        responses: { 200: { description: "Lista paginada" } },
      },
      ...(collection === "tasks" || collection === "contacts"
        ? {
            post: {
              summary: `Cria um item em ${collection}`,
              security: [{ bearerAuth: [] }],
              parameters: [
                {
                  in: "header",
                  name: "Idempotency-Key",
                  required: true,
                  schema: { type: "string" },
                },
              ],
              responses: {
                201: { description: "Item criado" },
                409: { description: "Conflito de atualização" },
              },
            },
          }
        : {}),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Seu Funcionário Public API",
      version: "1.0.0",
      description:
        "API gratuita e versionada para integrar dados do espaço. Chaves são criadas dentro do aplicativo.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "sf_live" },
      },
    },
    paths,
  };
}

async function publicApiCredentials(request, env) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!token.startsWith("sf_live_")) return null;
  const row = await env.DB.prepare(
    `SELECT id, workspace_owner_id, scope FROM public_api_keys
     WHERE key_hash = ? AND revoked_at IS NULL`,
  )
    .bind(await sha256(token))
    .first();
  if (!row) return null;
  if (!allowed(`public-api:${row.id}`, 120)) return { rateLimited: true };
  await env.DB.prepare(
    "UPDATE public_api_keys SET last_used_at = ? WHERE id = ?",
  )
    .bind(new Date().toISOString(), row.id)
    .run();
  return row;
}

function publicApiRecord(record) {
  if (!record || typeof record !== "object") return null;
  const safe = { ...record };
  for (const field of [
    "ownerId",
    "sharedWith",
    "sharedTeams",
    "editors",
    "sharingPermission",
    "visibility",
  ])
    delete safe[field];
  return safe;
}

const publicWritableFields = {
  tasks: [
    "title",
    "description",
    "status",
    "priority",
    "dueDate",
    "businessId",
    "project",
    "tags",
  ],
  contacts: [
    "name",
    "email",
    "phone",
    "company",
    "role",
    "notes",
    "businessId",
    "tags",
  ],
};

function buildPublicRecord(collection, body, ownerId) {
  const record = {
    id: crypto.randomUUID(),
    ownerId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "public-api",
  };
  for (const field of publicWritableFields[collection] || []) {
    if (body[field] === undefined) continue;
    record[field] = Array.isArray(body[field])
      ? body[field].slice(0, 20).map((value) => cleanText(value, 80))
      : cleanText(
          body[field],
          field === "description" || field === "notes" ? 2_000 : 200,
        );
  }
  if (!record.name && !record.title) return null;
  if (collection === "tasks") {
    record.status = record.status || "pendente";
    record.priority = record.priority || "media";
  }
  return record;
}

async function handlePublicApi(request, env, url) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: apiCorsHeaders });
  if (url.pathname === "/api/public/v1/openapi.json") {
    if (request.method !== "GET")
      return publicApiJson({ error: "Método não permitido." }, 405);
    return publicApiJson(publicApiOpenApi(url.origin));
  }
  const credentials = await publicApiCredentials(request, env);
  if (credentials?.rateLimited)
    return publicApiJson(
      { error: "Limite de 120 chamadas por minuto excedido." },
      429,
      { "retry-after": "60" },
    );
  if (!credentials)
    return publicApiJson({ error: "Chave ausente, inválida ou revogada." }, 401);
  if (url.pathname === "/api/public/v1/me") {
    if (request.method !== "GET")
      return publicApiJson({ error: "Método não permitido." }, 405);
    return publicApiJson({
      workspaceId: credentials.workspace_owner_id,
      scope: credentials.scope,
      version: "v1",
    });
  }
  const collection = url.pathname.split("/").filter(Boolean)[3] || "";
  if (!PUBLIC_API_COLLECTIONS.has(collection))
    return publicApiJson({ error: "Recurso não encontrado." }, 404);
  const workspace = await env.DB.prepare(
    "SELECT data, revision FROM workspaces WHERE user_id = ?",
  )
    .bind(credentials.workspace_owner_id)
    .first();
  let data;
  try {
    data = workspace ? JSON.parse(workspace.data) : {};
  } catch {
    return publicApiJson({ error: "Dados do espaço indisponíveis." }, 503);
  }
  if (request.method === "GET") {
    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50,
      ),
    );
    const businessId = cleanText(url.searchParams.get("businessId"), 80);
    const records = (Array.isArray(data[collection]) ? data[collection] : [])
      .filter((record) => !businessId || record?.businessId === businessId)
      .slice(0, limit)
      .map(publicApiRecord)
      .filter(Boolean);
    return publicApiJson({ data: records, count: records.length, limit });
  }
  if (request.method !== "POST")
    return publicApiJson({ error: "Método não permitido." }, 405);
  if (credentials.scope !== "read-write")
    return publicApiJson({ error: "Esta chave permite somente leitura." }, 403);
  if (!publicWritableFields[collection])
    return publicApiJson({ error: "Este recurso não aceita criação." }, 405);
  const idempotencyKey = cleanText(
    request.headers.get("idempotency-key"),
    100,
  );
  if (!idempotencyKey)
    return publicApiJson(
      { error: "Envie o cabeçalho Idempotency-Key." },
      400,
    );
  const prior = await env.DB.prepare(
    `SELECT response_json FROM public_api_idempotency
     WHERE api_key_id = ? AND request_key = ?`,
  )
    .bind(credentials.id, idempotencyKey)
    .first();
  if (prior) return publicApiJson(JSON.parse(prior.response_json), 200);
  let body;
  try {
    body = await request.json();
  } catch {
    return publicApiJson({ error: "Corpo JSON inválido." }, 400);
  }
  const record = buildPublicRecord(
    collection,
    body && typeof body === "object" ? body : {},
    credentials.workspace_owner_id,
  );
  if (!record)
    return publicApiJson(
      {
        error:
          collection === "tasks" ? "Informe o título." : "Informe o nome.",
      },
      400,
    );
  data[collection] = [
    ...(Array.isArray(data[collection]) ? data[collection] : []),
    record,
  ];
  const updated = JSON.stringify(data);
  if (updated.length > 900_000)
    return publicApiJson({ error: "O espaço de dados está cheio." }, 413);
  const revision = Number.isInteger(workspace?.revision)
    ? workspace.revision
    : 0;
  const result = await env.DB.prepare(
    `UPDATE workspaces SET data = ?, updated_at = ?, revision = revision + 1
     WHERE user_id = ? AND revision = ?`,
  )
    .bind(
      updated,
      new Date().toISOString(),
      credentials.workspace_owner_id,
      revision,
    )
    .run();
  if (!result.meta?.changes)
    return publicApiJson(
      {
        error:
          "Os dados mudaram durante a operação. Repita com a mesma chave de idempotência.",
      },
      409,
    );
  const responseBody = { data: publicApiRecord(record) };
  await env.DB.prepare(
    `INSERT INTO public_api_idempotency
      (id, api_key_id, request_key, response_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      credentials.id,
      idempotencyKey,
      JSON.stringify(responseBody),
      new Date().toISOString(),
    )
    .run();
  return publicApiJson(responseBody, 201);
}

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
    // Público e sem segredo: SHA publicado, hora do build e ambiente. É o que
    // a auditoria compara com `git rev-parse HEAD` para dizer "produção = main".
    if (url.pathname === "/api/system/version") {
      if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
      const manifesto = await publishedVersion(env, url.origin);
      return json(systemVersionPayload(env, manifesto));
    }
    if (url.pathname === "/api/status") {
      let database = "indisponível";
      try {
        if (env.DB) {
          await env.DB.prepare("SELECT 1 AS ok").first();
          database = "operacional";
        }
      } catch {}
      const appVersion = await publishedVersion(env, url.origin);
      const clientVersion = url.searchParams.get("client") || "";
      const search = webSearchConfiguration(env);
      return json({
        status: database === "operacional" ? "operacional" : "degradado",
        database,
        version: appVersion?.version || "local",
        buildTime: appVersion?.buildTime || null,
        clientVersion,
        current: clientVersion
          ? clientVersion === (appVersion?.version || "local")
          : true,
        capabilities: {
          webSearch: {
            configured: search.configured,
            braveConfigured: search.providers.brave,
          },
        },
        roadmap: {
          complete: true,
          completedThrough: 27,
          nextItem: null,
        },
        checkedAt: new Date().toISOString(),
      });
    }
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
    if (url.pathname === "/api/config")
      return json({
        googleClientId: env.GOOGLE_CLIENT_ID || "",
        videoEnabled: !!(env.VIDEO_AI_URL && env.VIDEO_AI_TOKEN),
        vapidPublicKey: pushEnabled(env) ? env.VAPID_PUBLIC_KEY : null,
        supportEmail: env.SUPPORT_EMAIL || env.MAIL_SENDER || "",
      });
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
