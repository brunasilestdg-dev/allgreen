// ===== Caixa de entrada pessoal (/api/inbox/personal) =====
//
// Contrato
// - Recebe: `request`, `env`, `user` e `url` (`?owner=`).
// - Devolve: GET → os itens que pedem a atenção desta pessoa, derivados do
//   JSON do espaço, com o estado de lido/adiado aplicado e um resumo;
//   PATCH `{ action, ids, until? }` → marca lido/não lido ou adia/reativa.
// - Quem chama: a tabela de rotas autenticadas (exige sessão e banco).
// - Autorização: membro do espaço. Quem não é dono nem `admin` só recebe o
//   que `filterRecordsForViewer` deixa ver; o estado é sempre da própria
//   pessoa (`personal_inbox_state` por espaço + usuário).

import { json } from "../lib/http.js";
import { membershipRole } from "../lib/membership.js";
import {
  filterRecordsForViewer,
  resolveViewerContext,
} from "../lib/visibility.js";
import {
  applyPersonalInboxState,
  buildPersonalInboxItems,
  personalInboxSummary,
} from "../../src/features/inbox/personalInboxDomain.js";

export async function handlePersonalInbox(request, env, user, url) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);

  if (request.method === "GET") {
    const workspaceRow = await env.DB.prepare(
      "SELECT data FROM workspaces WHERE user_id = ?",
    )
      .bind(ownerId)
      .first();
    let data = {};
    try {
      data = workspaceRow?.data ? JSON.parse(workspaceRow.data) : {};
    } catch {
      data = {};
    }
    const restricted = role !== "owner" && role !== "admin";
    if (restricted) {
      const ctx = resolveViewerContext(data, user.id);
      data = {
        ...data,
        tasks: filterRecordsForViewer(data.tasks, user.id, ctx),
        notifications: filterRecordsForViewer(
          data.notifications,
          user.id,
          ctx,
        ),
        databases: filterRecordsForViewer(data.databases, user.id, ctx),
        processes: filterRecordsForViewer(data.processes, user.id, ctx),
        processCases: filterRecordsForViewer(
          data.processCases,
          user.id,
          ctx,
        ),
        projects: filterRecordsForViewer(data.projects, user.id, ctx),
      };
    }
    const stateRows = await env.DB.prepare(
      `SELECT item_key AS itemKey, read_at AS readAt,
              snoozed_until AS snoozedUntil
         FROM personal_inbox_state
        WHERE workspace_owner_id = ? AND user_id = ?
        ORDER BY updated_at DESC
        LIMIT 1000`,
    )
      .bind(ownerId, user.id)
      .all();
    const now = new Date().toISOString();
    const derived = buildPersonalInboxItems(
      data,
      {
        ...user,
        isWorkspaceOwner: ownerId === user.id,
      },
      now,
    );
    const items = applyPersonalInboxState(
      derived,
      stateRows.results || [],
      now,
    );
    return json({
      items,
      summary: personalInboxSummary(items, now),
      generatedAt: now,
    });
  }

  if (request.method !== "PATCH")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requisição inválida." }, 400);
  }
  const action = String(body.action || "");
  if (!["read", "unread", "snooze", "unsnooze"].includes(action))
    return json({ error: "Ação inválida." }, 400);
  const ids = [
    ...new Set(
      (Array.isArray(body.ids) ? body.ids : [])
        .filter(
          (value) =>
            typeof value === "string" &&
            value.length > 0 &&
            value.length <= 240,
        )
        .slice(0, 500),
    ),
  ];
  if (!ids.length) return json({ ok: true, updated: 0 });
  const now = new Date().toISOString();
  let until = null;
  if (action === "snooze") {
    const untilMs = Date.parse(body.until);
    const maxMs = Date.now() + 366 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(untilMs) || untilMs <= Date.now() || untilMs > maxMs)
      return json(
        { error: "Escolha uma data futura de até um ano para adiar." },
        400,
      );
    until = new Date(untilMs).toISOString();
  }

  const statements = ids.map((itemKey) => {
    if (action === "read" || action === "unread")
      return env.DB.prepare(
        `INSERT INTO personal_inbox_state
          (workspace_owner_id, user_id, item_key, read_at, snoozed_until,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(workspace_owner_id, user_id, item_key) DO UPDATE SET
           read_at = excluded.read_at,
           updated_at = excluded.updated_at`,
      ).bind(
        ownerId,
        user.id,
        itemKey,
        action === "read" ? now : null,
        now,
        now,
      );
    return env.DB.prepare(
      `INSERT INTO personal_inbox_state
        (workspace_owner_id, user_id, item_key, read_at, snoozed_until,
         created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(workspace_owner_id, user_id, item_key) DO UPDATE SET
         snoozed_until = excluded.snoozed_until,
         updated_at = excluded.updated_at`,
    ).bind(
      ownerId,
      user.id,
      itemKey,
      action === "snooze" ? until : null,
      now,
      now,
    );
  });
  await env.DB.batch(statements);
  return json({ ok: true, updated: ids.length });
}
