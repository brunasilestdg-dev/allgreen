// ===== TRACK3R: receptor dos webhooks documentados =====
//
// A documentação do fornecedor define um endpoint nosso por evento, header
// `Token`, POST e JSON. O receptor antigo de ocorrências continua sendo o
// caminho canônico para tracking/POD. Os demais eventos entram primeiro numa
// inbox idempotente para que nenhum payload seja perdido enquanto cada projetor
// de domínio é ligado com segurança.

import { TENANT_ID } from "./todogreen-access.js";
import { autenticarTokenWebhookTrack3r } from "./todogreen-track3r-webhook-auth.js";
import { allowed as limitarTaxa, edgeIp } from "../lib/http.js";
import { receberOcorrenciaTrack3r } from "./todogreen-tms.js";
import { projetarWebhookTrack3r } from "./todogreen-track3r-projectors.js";

const jsonFornecedor = (ok, descricao, status) =>
  new Response(JSON.stringify({ status: ok, descricao }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const TOKEN_INVALIDO = () => jsonFornecedor(false, "O Token informado é inválido!", 401);
const MAX_CORPO = 1_000_000;

const aliases = new Map([
  ["ocorrencia", "ocorrencias"],
  ["ocorrencias", "ocorrencias"],
  ["encomenda", "encomendas"],
  ["encomendas", "encomendas"],
  ["valor-encomenda", "valores-encomendas"],
  ["valores-encomenda", "valores-encomendas"],
  ["valores-encomendas", "valores-encomendas"],
  ["embarcador", "embarcadores"],
  ["embarcadores", "embarcadores"],
  ["tomador", "tomadores"],
  ["tomadores", "tomadores"],
  ["cte", "ctes"],
  ["ctes", "ctes"],
  ["unidade", "unidades"],
  ["unidades", "unidades"],
  ["averbacao", "averbacoes"],
  ["averbacoes", "averbacoes"],
  ["cotacao", "cotacoes"],
  ["cotacoes", "cotacoes"],
  ["fatura", "faturas"],
  ["faturas", "faturas"],
  ["fatura-motorista", "faturas-motorista"],
  ["faturas-motorista", "faturas-motorista"],
  ["fatura-rede-terceira", "faturas-rede-terceira"],
  ["faturas-rede-terceira", "faturas-rede-terceira"],
  ["lista", "listas"],
  ["listas", "listas"],
]);

export const TRACK3R_WEBHOOK_EVENT_TYPES = Object.freeze([
  "ocorrencias",
  "encomendas",
  "valores-encomendas",
  "embarcadores",
  "tomadores",
  "ctes",
  "unidades",
  "averbacoes",
  "cotacoes",
  "faturas",
  "faturas-motorista",
  "faturas-rede-terceira",
  "listas",
]);

const texto = (valor, max = 500) => String(valor ?? "").trim().slice(0, max);

function tipoDoPath(pathname) {
  const partes = pathname.split("/").filter(Boolean);
  const bruto = texto(partes[5] || "ocorrencias", 80)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return aliases.get(bruto) || "";
}

function referenciaExterna(tipo, corpo) {
  const porTipo = {
    encomendas: corpo?.codigo_encomenda,
    "valores-encomendas": corpo?.codigo_encomenda,
    embarcadores: corpo?.codigo_embarcador,
    tomadores: corpo?.codigo_tomador,
    ctes: corpo?.cte?.chave || corpo?.codigo_encomenda,
    unidades: corpo?.codigo_unidade,
    averbacoes: corpo?.averbacao?.protocolo || corpo?.codigo_encomenda,
    cotacoes: corpo?.codigo_cotacao,
    faturas: corpo?.codigo_fatura,
    "faturas-motorista": corpo?.codigo_fatura,
    "faturas-rede-terceira": corpo?.codigo_fatura,
    listas: corpo?.codigo_lista,
  };
  return texto(porTipo[tipo], 240);
}

function stableStringify(valor) {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(stableStringify).join(",")}]`;
  return `{${Object.keys(valor).sort().map((chave) =>
    `${JSON.stringify(chave)}:${stableStringify(valor[chave])}`
  ).join(",")}}`;
}

async function sha256Hex(valor) {
  const bytes = new TextEncoder().encode(valor);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function integracaoDoWebhook(env, integracaoId) {
  if (!integracaoId) return null;
  return env.DB.prepare(
    `SELECT * FROM todogreen_tms_integrations
      WHERE id = ? AND tenant_id = ? AND provider = 'track3r' AND archived_at IS NULL`,
  ).bind(integracaoId, TENANT_ID).first();
}

// Registra uma tentativa RECUSADA (401/503) para diagnóstico. Responde a
// "o evento não chega porque não é enviado, ou porque é enviado e recusado?".
// NUNCA grava o valor do token — só se um cabeçalho Token veio (booleano),
// o endpoint, o status, o motivo, o IP e a contagem. Falha do log nunca derruba
// o webhook.
async function registrarRecusaWebhook(env, { integracaoId, tipo, status, reason, ip, tokenPresent }) {
  const agora = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO todogreen_tms_webhook_rejections
         (id, tenant_id, integration_id, event_type, http_status, reason, token_present, ip,
          attempt_count, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(tenant_id, integration_id, event_type, http_status, reason, token_present)
       DO UPDATE SET
         attempt_count = todogreen_tms_webhook_rejections.attempt_count + 1,
         ip = excluded.ip,
         last_seen_at = excluded.last_seen_at`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, texto(integracaoId, 120), texto(tipo, 40),
      status, texto(reason, 200), tokenPresent ? 1 : 0, texto(ip, 60), agora, agora,
    ).run();
  } catch {
    // Log de diagnóstico é best-effort: nunca pode falhar o recebimento.
  }
}

async function validarAcesso(request, env, integracaoId, tipo) {
  if (!limitarTaxa(`tms-webhook:${integracaoId}`, 600))
    return { response: jsonFornecedor(false, "Muitas chamadas em sequência. Tente novamente em instantes.", 429) };

  const ip = edgeIp(request);
  if (ip && !limitarTaxa(`tms-webhook-ip:${ip}`, 600))
    return { response: jsonFornecedor(false, "Muitas chamadas em sequência. Tente novamente em instantes.", 429) };

  const recebido = String(request.headers.get("Token") || "").trim().slice(0, 500);
  const tokenPresent = recebido.length > 0;

  const integracao = await integracaoDoWebhook(env, integracaoId);
  if (!integracao) {
    await registrarRecusaWebhook(env, { integracaoId, tipo, status: 401, reason: "integracao_nao_encontrada", ip, tokenPresent });
    return { response: TOKEN_INVALIDO() };
  }

  const token = autenticarTokenWebhookTrack3r(env, integracao, tipo, recebido);
  if (!token.configurado) {
    await registrarRecusaWebhook(env, { integracaoId, tipo, status: 503, reason: "sem_token_configurado", ip, tokenPresent });
    return { response: jsonFornecedor(false, `Integração sem token configurado para ${tipo} (${token.nome}).`, 503) };
  }
  if (!token.autorizado) {
    await registrarRecusaWebhook(env, { integracaoId, tipo, status: 401, reason: "token_incorreto", ip, tokenPresent });
    return { response: TOKEN_INVALIDO() };
  }

  return { integracao };
}

async function gravarNaInbox(env, integracao, tipo, corpo) {
  const agora = new Date().toISOString();
  const canonico = stableStringify(corpo);
  const payloadHash = await sha256Hex(`${tipo}:${canonico}`);
  const externalRef = referenciaExterna(tipo, corpo);
  const sourceSentAt = texto(corpo?.data_hora_envio, 80);
  const ator = texto(integracao.updated_by || integracao.created_by, 120);

  await env.DB.prepare(
    `INSERT INTO todogreen_tms_webhook_events
       (id, tenant_id, workspace_owner_id, integration_id, event_type, external_ref,
        source_sent_at, payload_hash, payload_json, status, processing_error,
        receive_count, first_received_at, last_received_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', '', 1, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_owner_id, integration_id, event_type, payload_hash)
     DO UPDATE SET
       external_ref = excluded.external_ref,
       source_sent_at = excluded.source_sent_at,
       payload_json = excluded.payload_json,
       receive_count = todogreen_tms_webhook_events.receive_count + 1,
       last_received_at = excluded.last_received_at,
       updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), TENANT_ID, integracao.workspace_owner_id, integracao.id,
    tipo, externalRef, sourceSentAt, payloadHash, JSON.stringify(corpo),
    agora, agora, ator, agora, agora,
  ).run();

  await env.DB.prepare(
    `UPDATE todogreen_tms_integrations
        SET status = 'ativa', last_sync_at = ?, last_error = '', updated_at = ?
      WHERE id = ? AND tenant_id = ?`,
  ).bind(agora, agora, integracao.id, TENANT_ID).run();

  return { payloadHash, externalRef };
}

// Dreno de reprocessamento (chamado pelo cron). Eventos cuja projeção para o
// domínio canônico falhou ('error') ou que nunca projetaram ('received')
// ficariam presos na inbox sem retry — o receptor responde 200 ao fornecedor e
// só marca a falha. O payload é durável e a projeção é idempotente (mesma dedupe
// por conteúdo do recebimento), então retentar é seguro. Limitado por lote e por
// idade (acima do corte vira caso manual, para não retentar poison eternamente).
export async function reprocessarWebhooksTrack3r(env, { limite = 50, corteDias = 7 } = {}) {
  if (!env?.DB) return { tentados: 0, processados: 0, falhas: 0 };
  const corte = new Date(Date.now() - corteDias * 24 * 3600 * 1000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id, integration_id, event_type, payload_json
       FROM todogreen_tms_webhook_events
      WHERE tenant_id=? AND status IN ('received','error') AND updated_at > ?
      ORDER BY updated_at ASC
      LIMIT ?`,
  ).bind(TENANT_ID, corte, limite).all().catch(() => ({ results: [] }));
  const eventos = results || [];
  let processados = 0;
  let falhas = 0;
  for (const ev of eventos) {
    const integracao = await integracaoDoWebhook(env, ev.integration_id);
    if (!integracao) continue;
    let corpo;
    try { corpo = JSON.parse(ev.payload_json || "{}"); } catch { corpo = null; }
    if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) continue;
    const agora = new Date().toISOString();
    try {
      const projecao = await projetarWebhookTrack3r(env, integracao, ev.event_type, corpo);
      await env.DB.prepare(
        `UPDATE todogreen_tms_webhook_events
            SET status=?, processing_error='', updated_at=?
          WHERE id=?`,
      ).bind(projecao.processed ? "processed" : "received", agora, ev.id).run();
      if (projecao.processed) processados += 1;
    } catch (error) {
      falhas += 1;
      await env.DB.prepare(
        `UPDATE todogreen_tms_webhook_events
            SET status='error', processing_error=?, updated_at=?
          WHERE id=?`,
      ).bind(texto(error?.message || error, 500), agora, ev.id).run().catch(() => {});
    }
  }
  return { tentados: eventos.length, processados, falhas };
}

/**
 * URLs:
 *   POST /api/todogreen/tms/webhook/:integrationId
 *     -> legado: ocorrências
 *   POST /api/todogreen/tms/webhook/:integrationId/:eventType
 *     -> demais webhooks documentados
 */
export async function receberWebhookTrack3r(request, env) {
  if (!env?.DB) return jsonFornecedor(false, "Banco indisponível.", 503);
  if (request.method !== "POST") return jsonFornecedor(false, "Método não permitido.", 405);

  const url = new URL(request.url);
  const partes = url.pathname.split("/").filter(Boolean);
  const integracaoId = texto(partes[4], 120);
  const tipo = tipoDoPath(url.pathname);

  if (!tipo)
    return jsonFornecedor(false, "Tipo de evento do TRACK3R não reconhecido.", 400);

  // Mantém o receptor já endurecido de ocorrências exatamente como está:
  // normalização, casamento por CNPJ, idempotência e projeção em operação/POD.
  if (tipo === "ocorrencias") return receberOcorrenciaTrack3r(request, env);

  const acesso = await validarAcesso(request, env, integracaoId, tipo);
  if (acesso.response) return acesso.response;

  const declarado = Number(request.headers.get("content-length") || 0);
  if (declarado > MAX_CORPO) return jsonFornecedor(false, "Corpo maior do que o aceito.", 413);

  const bruto = await request.text().catch(() => "");
  if (bruto.length > MAX_CORPO) return jsonFornecedor(false, "Corpo maior do que o aceito.", 413);

  let corpo;
  try { corpo = JSON.parse(bruto || "{}"); } catch { corpo = null; }
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo))
    return jsonFornecedor(false, "Não foi possível ler o JSON enviado.", 400);

  let inbox;
  try {
    inbox = await gravarNaInbox(env, acesso.integracao, tipo, corpo);
  } catch (error) {
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE todogreen_tms_integrations
          SET status = 'erro', last_error = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?`,
    ).bind(texto(error?.message || error, 500), agora, acesso.integracao.id, TENANT_ID).run().catch(() => {});
    return jsonFornecedor(false, "Não foi possível registrar o evento.", 500);
  }

  // O evento já está durável na inbox. A projeção para o domínio canônico vem
  // depois: se ela falhar, registramos o erro para reprocessamento, mas
  // respondemos 200 ao fornecedor para evitar tempestade de reenvios. O payload
  // não se perde e a falha fica visível no ERP.
  try {
    const projecao = await projetarWebhookTrack3r(env, acesso.integracao, tipo, corpo);
    if (projecao.processed) {
      const agora = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE todogreen_tms_webhook_events
            SET status='processed',processing_error='',updated_at=?
          WHERE workspace_owner_id=? AND integration_id=? AND event_type=? AND payload_hash=?`,
      ).bind(
        agora, acesso.integracao.workspace_owner_id, acesso.integracao.id, tipo, inbox.payloadHash,
      ).run();
    }
  } catch (error) {
    const agora = new Date().toISOString();
    const mensagem = texto(error?.message || error, 500);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE todogreen_tms_webhook_events
            SET status='error',processing_error=?,updated_at=?
          WHERE workspace_owner_id=? AND integration_id=? AND event_type=? AND payload_hash=?`,
      ).bind(
        mensagem, agora, acesso.integracao.workspace_owner_id, acesso.integracao.id, tipo, inbox.payloadHash,
      ),
      env.DB.prepare(
        `UPDATE todogreen_tms_integrations
            SET last_error=?,updated_at=?
          WHERE id=? AND tenant_id=?`,
      ).bind(`Projeção ${tipo}: ${mensagem}`, agora, acesso.integracao.id, TENANT_ID),
    ]).catch(() => {});
  }

  return jsonFornecedor(true, "Recebido com sucesso!", 200);
}
