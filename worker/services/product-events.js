// ===== Métricas de uso do produto (/api/events) =====
//
// Contrato
// - Recebe: `request`, `env`, `user` e `url` (`?owner=`, `?days=`).
// - Devolve: POST → grava um evento do catálogo fechado
//   (`PRODUCT_EVENT_NAMES`) com metadados filtrados
//   (`PRODUCT_METADATA_KEYS`); GET → contagem por evento e pessoas ativas
//   no período (7 a 90 dias).
// - Quem chama: a tabela de rotas autenticadas (exige sessão e banco).
// - Autorização: qualquer membro do espaço registra; só dono ou `admin` lê
//   o agregado. Nunca grava conteúdo de documento, chat ou cadastro.

import { allowed, json } from "../lib/http.js";
import { membershipRole } from "../lib/membership.js";

const PRODUCT_EVENT_NAMES = new Set([
  "session_started",
  "onboarding_completed",
  "navigation",
  "ai_completed",
  "record_created",
  "action_completed",
  "import_completed",
  "export_completed",
  "weekly_goal_saved",
  "task_claimed",
]);
const PRODUCT_METADATA_KEYS = new Set([
  "module",
  "source",
  "kind",
  "mode",
  "success",
  "count",
  "elapsedBucket",
]);

export async function handleProductEvents(request, env, user, url) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  if (request.method === "POST") {
    if (!allowed(`events:${user.id}`, 120))
      return json({ error: "Muitos eventos em pouco tempo." }, 429);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Evento inválido." }, 400);
    }
    if (!PRODUCT_EVENT_NAMES.has(body.event))
      return json({ error: "Evento inválido." }, 400);
    const metadata = {};
    if (body.metadata && typeof body.metadata === "object") {
      for (const [key, value] of Object.entries(body.metadata)) {
        if (!PRODUCT_METADATA_KEYS.has(key)) continue;
        if (["string", "number", "boolean"].includes(typeof value))
          metadata[key] = typeof value === "string" ? value.slice(0, 80) : value;
      }
    }
    await env.DB.prepare(
      `INSERT INTO product_events
        (id, user_id, workspace_owner_id, event_name, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        ownerId,
        body.event,
        JSON.stringify(metadata),
        new Date().toISOString(),
      )
      .run();
    return json({ ok: true });
  }
  if (request.method !== "GET")
    return json({ error: "Método não permitido." }, 405);
  if (role !== "owner" && role !== "admin")
    return json({ error: "Acesso restrito à administração do espaço." }, 403);
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const grouped = await env.DB.prepare(
    `SELECT event_name AS event, COUNT(*) AS total,
            COUNT(DISTINCT user_id) AS users
       FROM product_events
      WHERE workspace_owner_id = ? AND created_at >= ?
      GROUP BY event_name
      ORDER BY total DESC`,
  )
    .bind(ownerId, since)
    .all();
  const active = await env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) AS users
       FROM product_events
      WHERE workspace_owner_id = ? AND created_at >= ?`,
  )
    .bind(ownerId, since)
    .first();
  return json({
    days,
    activeUsers: Number(active?.users || 0),
    events: grouped.results || [],
  });
}
