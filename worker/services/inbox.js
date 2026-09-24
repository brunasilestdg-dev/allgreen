// ===== Caixa de entrada compartilhada do espaço (/api/inbox) =====
//
// Contrato
// - Recebe: `request`, `env`, `user` e `url` (`?owner=` escolhe o espaço;
//   `?conversation=` abre uma conversa).
// - Devolve: `handleInbox` — GET lista as 500 interações mais recentes,
//   POST registra uma, PATCH marca como lidas; `handleInboxConversations`
//   — GET lista as conversas ou devolve uma com as mensagens.
// - Quem chama: a tabela de rotas autenticadas (exige sessão e banco).
// - Autorização: qualquer membro ativo do espaço (`membershipRole`) vê a
//   caixa compartilhada; toda consulta filtra por `workspace_owner_id`.

import { allowed, json } from "../lib/http.js";
import { membershipRole } from "../lib/membership.js";
import { safeParseJson } from "../lib/safe-json.js";
import { ensureInteractionsMigrated, insertInteraction } from "./omnichannel.js";

export async function handleInbox(request, env, user, url) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);

  if (request.method === "GET") {
    await ensureInteractionsMigrated(env, ownerId);
    const rows = await env.DB.prepare(
      `SELECT i.id, i.author_id, i.contact_id, i.contact_name, i.contact_handle,
              i.channel, i.direction, i.subject, i.body, i.meta_json,
              i.created_at, i.read_at, m.conversation_id, m.id AS message_id
         FROM interactions i
         LEFT JOIN conversation_messages m ON m.interaction_id = i.id
        WHERE i.workspace_owner_id = ?
        ORDER BY i.created_at DESC
        LIMIT 500`,
    )
      .bind(ownerId)
      .all();
    const items = (rows.results || []).map((r) => ({
      id: r.id,
      authorId: r.author_id,
      contactId: r.contact_id || "",
      contactName: r.contact_name || "",
      contactHandle: r.contact_handle || "",
      channel: r.channel,
      direction: r.direction,
      subject: r.subject || "",
      body: r.body || "",
      meta: safeParseJson(r.meta_json),
      createdAt: r.created_at,
      readAt: r.read_at || null,
      conversationId: r.conversation_id || "",
      messageId: r.message_id || "",
    }));
    return json({ items });
  }

  if (request.method === "POST") {
    if (!allowed(`inbox:${user.id}`, 120))
      return json({ error: "Muitos registros em pouco tempo." }, 429);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Registro inválido." }, 400);
    }
    try {
      const record = await insertInteraction(env, ownerId, user.id, body);
      return json({ ok: true, ...record });
    } catch (error) {
      return json({ error: error.message || "Registro inválido." }, 400);
    }
  }

  if (request.method === "PATCH") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Requisição inválida." }, 400);
    }
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((v) => typeof v === "string").slice(0, 500)
      : [];
    if (!ids.length) return json({ ok: true, updated: 0 });
    const now = new Date().toISOString();
    const placeholders = ids.map(() => "?").join(", ");
    const result = await env.DB.prepare(
      `UPDATE interactions SET read_at = ?
        WHERE workspace_owner_id = ? AND read_at IS NULL
          AND id IN (${placeholders})`,
    )
      .bind(now, ownerId, ...ids)
      .run();
    const messages = await env.DB.prepare(
      `SELECT DISTINCT conversation_id FROM conversation_messages
        WHERE workspace_owner_id = ? AND interaction_id IN (${placeholders})`,
    )
      .bind(ownerId, ...ids)
      .all();
    await env.DB.prepare(
      `UPDATE conversation_messages SET read_at = ?
        WHERE workspace_owner_id = ? AND read_at IS NULL
          AND interaction_id IN (${placeholders})`,
    )
      .bind(now, ownerId, ...ids)
      .run();
    for (const row of messages.results || []) {
      await env.DB.prepare(
        `UPDATE conversations
            SET unread_count = (
                  SELECT COUNT(*) FROM conversation_messages
                   WHERE conversation_id = ? AND direction = 'in' AND read_at IS NULL
                ),
                updated_at = ?
          WHERE id = ? AND workspace_owner_id = ?`,
      )
        .bind(row.conversation_id, now, row.conversation_id, ownerId)
        .run();
    }
    return json({ ok: true, updated: result.meta?.changes || 0 });
  }

  return json({ error: "Método não permitido." }, 405);
}

export async function handleInboxConversations(request, env, user, url) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  if (request.method !== "GET")
    return json({ error: "Método não permitido." }, 405);
  await ensureInteractionsMigrated(env, ownerId);
  const conversationId = url.searchParams.get("conversation") || "";
  if (conversationId) {
    const row = await env.DB.prepare(
      `SELECT c.id, c.workspace_owner_id, c.contact_id, c.channel, c.subject,
              c.status, c.priority, c.assigned_to, c.last_message_at,
              c.last_message_preview, c.unread_count, c.created_at, c.updated_at,
              ct.display_name, ct.normalized_handle, ct.email, ct.phone
         FROM conversations c
         LEFT JOIN contacts ct ON ct.id = c.contact_id
        WHERE c.workspace_owner_id = ? AND c.id = ?
        LIMIT 1`,
    )
      .bind(ownerId, conversationId)
      .first();
    if (!row) return json({ error: "Conversa não encontrada." }, 404);
    const messages = await env.DB.prepare(
      `SELECT id, interaction_id, author_id, channel, direction, subject, body,
              meta_json, created_at, read_at
         FROM conversation_messages
        WHERE workspace_owner_id = ? AND conversation_id = ?
        ORDER BY created_at ASC
        LIMIT 500`,
    )
      .bind(ownerId, conversationId)
      .all();
    return json({
      conversation: {
        id: row.id,
        contactId: row.contact_id || "",
        contactName: row.display_name || "",
        contactHandle: row.email || row.phone || row.normalized_handle || "",
        channel: row.channel,
        subject: row.subject || "",
        status: row.status,
        priority: row.priority,
        assignedTo: row.assigned_to || "",
        lastMessageAt: row.last_message_at,
        lastMessagePreview: row.last_message_preview || "",
        unreadCount: Number(row.unread_count) || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      messages: (messages.results || []).map((message) => ({
        id: message.id,
        interactionId: message.interaction_id || "",
        authorId: message.author_id,
        channel: message.channel,
        direction: message.direction,
        subject: message.subject || "",
        body: message.body || "",
        meta: safeParseJson(message.meta_json),
        createdAt: message.created_at,
        readAt: message.read_at || null,
      })),
    });
  }
  const rows = await env.DB.prepare(
    `SELECT c.id, c.contact_id, c.channel, c.subject, c.status, c.priority,
            c.assigned_to, c.last_message_at, c.last_message_preview,
            c.unread_count, c.created_at, c.updated_at,
            ct.display_name, ct.normalized_handle, ct.email, ct.phone
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.workspace_owner_id = ?
      ORDER BY c.last_message_at DESC
      LIMIT 200`,
  )
    .bind(ownerId)
    .all();
  return json({
    conversations: (rows.results || []).map((row) => ({
      id: row.id,
      contactId: row.contact_id || "",
      contactName: row.display_name || "",
      contactHandle: row.email || row.phone || row.normalized_handle || "",
      channel: row.channel,
      subject: row.subject || "",
      status: row.status,
      priority: row.priority,
      assignedTo: row.assigned_to || "",
      lastMessageAt: row.last_message_at,
      lastMessagePreview: row.last_message_preview || "",
      unreadCount: Number(row.unread_count) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
}
