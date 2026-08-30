// ===== Espaço de trabalho: leitura, gravação e mesclagem =====
//
// O maior handler que ainda restava solto em worker.js: lê e grava o blob
// único de JSON do espaço, filtra o que cada visitante pode ver, mescla
// edição concorrente campo a campo (tarefa, chat, membro) e aplica os campos
// que só o dono pode mudar.
//
// notifyWorkspaceChange chega por parâmetro, não por import: nasce de
// createWebhookHandlers(), chamado uma vez em worker.js, e passar a
// referência evita um import circular entre este arquivo e aquele.

import { membershipRole } from "../lib/membership.js";
import { allowed, json } from "../lib/http.js";
import {
  canEditRecord,
  canSeeTask,
  filterRecordsForViewer,
  resolveViewerContext,
} from "../lib/visibility.js";
import { ensureWorkspaceSnapshotsSchema } from "../lib/workspaceSchema.js";
import { notifyNewNotifications } from "../mensageria/envio.js";

const RESTRICTED_FIELDS = [
  "tasks",
  "leads",
  "documents",
  "syncedBlocks",
  "sites",
  "developmentPlans",
  "notifications",
  "transactions",
  "bills",
  "appointments",
  "products",
  "orders",
  "quotes",
  "opportunities",
  "objectives",
  "supplierRfqs",
  "recurring",
  "vehicles",
  "trips",
  "conversations",
  "emailDrafts",
  "contacts",
  "timeEntries",
  "history",
  "certificates",
  "media",
  "processes",
  "processCases",
  "formResponses",
  "publicForms",
  "clientPortals",
  "resourceProfiles",
  "resourceAbsences",
  "resourceAllocations",
  "pricingModels",
  "pricingScenarios",
  "impactFactors",
  "impactEntries",
  "workNodes",
  "dashboardConfigs",
  "chatChannels",
  "chatMessages",
  "chatReadStates",
];

const CHAT_FIELDS = ["chatChannels", "chatMessages", "chatReadStates"];

const OWNER_ONLY_TOP_LEVEL_FIELDS = [
  "businesses",
  "selectedBusinessId",
  "financeSettings",
  "taxProfile",
  "deliveryZones",
  "levels",
  "preferences",
  "journeys",
  "pluggedTools",
  "waTemplates",
  "teams",
  "projects",
];

const OWNER_LOCKED_FIELDS = new Set([
  "ownerId",
  "businessId",
  "visibility",
  "sharedWith",
  "sharedTeams",
  "points",
  "reward",
  "slots",
  "approvalMode",
  "distribution",
  "rewardStatus",
  "sharingPermission",
  "editors",
]);

function sanitizeMemberEdit(existing, incoming) {
  const safe = { ...existing };
  for (const key of Object.keys(incoming)) {
    if (OWNER_LOCKED_FIELDS.has(key)) continue;
    // Only the owner/reviewer may approve a mission — approving is what
    // unlocks points and reward payout, so this is the one non-owner-writable
    // field that still needs a value-level (not just field-level) guard.
    if (key === "missionStatus" && incoming[key] === "aprovada") continue;
    safe[key] = incoming[key];
  }
  return safe;
}

function sanitizeTaskParticipation(existing, incoming, memberId) {
  const safe = { ...existing };
  const beforeDeliveries = Array.isArray(existing.deliveries)
    ? existing.deliveries
    : [];
  const requestedDeliveries = Array.isArray(incoming.deliveries)
    ? incoming.deliveries
    : beforeDeliveries;
  const previousIds = new Set(beforeDeliveries.map((item) => item?.id));
  const appended = requestedDeliveries.filter(
    (item) =>
      item &&
      item.id &&
      !previousIds.has(item.id) &&
      item.authorId === memberId,
  );
  if (appended.length) {
    safe.deliveries = [
      ...beforeDeliveries,
      ...appended.map((item) => ({
        ...item,
        status: "enviada",
        feedback: undefined,
      })),
    ];
    safe.missionStatus = "enviada_para_revisao";
    safe.updatedAt = incoming.updatedAt || new Date().toISOString();
  }

  if (Array.isArray(existing.checklist) && Array.isArray(incoming.checklist)) {
    const requested = new Map(
      incoming.checklist
        .filter((item) => item?.id)
        .map((item) => [item.id, item]),
    );
    safe.checklist = existing.checklist.map((item) =>
      requested.has(item.id)
        ? { ...item, done: !!requested.get(item.id).done }
        : item,
    );
  }

  const beforeInterested = Array.isArray(existing.interested)
    ? existing.interested
    : [];
  const requestedInterested = Array.isArray(incoming.interested)
    ? incoming.interested
    : beforeInterested;
  const otherPeople = beforeInterested.filter(
    (item) => item?.userId !== memberId,
  );
  const ownInterest = requestedInterested.find(
    (item) => item?.userId === memberId,
  );
  safe.interested = ownInterest ? [...otherPeople, ownInterest] : otherPeople;
  return safe;
}

const CHAT_MESSAGE_LOCKED_FIELDS = new Set([
  "id",
  "channelId",
  "parentMessageId",
  "authorId",
  "authorName",
  "ownerId",
  "businessId",
  "visibility",
  "sharedWith",
  "sharedTeams",
  "sharingPermission",
  "createdAt",
]);

function sanitizeChatOwnerEdit(existing, incoming) {
  const safe = { ...incoming };
  for (const field of CHAT_MESSAGE_LOCKED_FIELDS) safe[field] = existing[field];
  return safe;
}

function sanitizeChatParticipation(existing, incoming, memberId) {
  const safe = { ...existing };
  const before = existing.reactions || {};
  const requested = incoming.reactions || {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(requested)])]
    .filter((emoji) => emoji.length <= 12)
    .slice(0, 16);
  const reactions = {};
  for (const emoji of keys) {
    const people = new Set(
      (Array.isArray(before[emoji]) ? before[emoji] : []).filter(
        (userId) => userId !== memberId,
      ),
    );
    if (
      Array.isArray(requested[emoji]) &&
      requested[emoji].includes(memberId)
    )
      people.add(memberId);
    if (people.size) reactions[emoji] = [...people];
  }
  safe.reactions = reactions;
  if (
    incoming.pinnedAt === null &&
    incoming.pinnedBy === null
  ) {
    safe.pinnedAt = null;
    safe.pinnedBy = null;
  } else if (incoming.pinnedBy === memberId && incoming.pinnedAt) {
    safe.pinnedAt = String(incoming.pinnedAt);
    safe.pinnedBy = memberId;
  }
  safe.updatedAt = incoming.updatedAt || existing.updatedAt;
  return safe;
}

function messageWithChannelAccess(message, channel, memberId) {
  const visibility =
    channel.visibility ||
    (channel.type === "channel" ? "espaco_todo" : "compartilhado");
  return {
    ...message,
    ownerId: memberId,
    authorId: memberId,
    channelId: channel.id,
    businessId: channel.businessId || message.businessId || null,
    visibility,
    sharedWith:
      visibility === "espaco_todo"
        ? []
        : Array.isArray(channel.sharedWith)
          ? channel.sharedWith
          : channel.memberIds || [],
    sharedTeams: Array.isArray(channel.sharedTeams)
      ? channel.sharedTeams
      : [],
    sharingPermission: "visualizar",
  };
}

function sanitizeChatReadState(record, memberId) {
  return {
    ...record,
    ownerId: memberId,
    userId: memberId,
    visibility: "privado",
    sharedWith: [],
    sharedTeams: [],
    sharingPermission: "visualizar",
  };
}

function mergeRecordsFromMember(
  currentRecords,
  incomingRecords,
  memberId,
  ctx,
  field,
) {
  const current = Array.isArray(currentRecords) ? currentRecords : [];
  const incoming = Array.isArray(incomingRecords) ? incomingRecords : [];
  const incomingById = new Map(
    incoming.filter((r) => r && r.id).map((r) => [r.id, r]),
  );
  const visibleIds = new Set(
    current.filter((r) => canSeeTask(r, memberId, ctx)).map((r) => r.id),
  );
  const result = [];
  const seen = new Set();
  for (const existing of current) {
    seen.add(existing.id);
    if (!visibleIds.has(existing.id)) {
      result.push(existing);
      continue;
    }
    const isOwner = existing.ownerId === memberId;
    const incomingVersion = incomingById.get(existing.id);
    if (!incomingVersion) {
      // Member's payload dropped this record: only the owner (or a legacy
      // no-owner record treated as ownerless) can actually delete it —
      // a non-owner who merely sees a shared record can't erase it by
      // omission.
      if (isOwner) continue;
      result.push(existing);
      continue;
    }
    if (isOwner)
      result.push(
        field === "chatMessages"
          ? sanitizeChatOwnerEdit(existing, incomingVersion)
          : field === "chatReadStates"
            ? sanitizeChatReadState(incomingVersion, memberId)
            : incomingVersion,
      );
    else if (field === "chatMessages")
      result.push(sanitizeChatParticipation(existing, incomingVersion, memberId));
    else if (canEditRecord(existing, memberId, ctx))
      result.push(sanitizeMemberEdit(existing, incomingVersion));
    else if (field === "tasks")
      result.push(sanitizeTaskParticipation(existing, incomingVersion, memberId));
    else result.push(existing);
  }
  for (const r of incoming) {
    if (!r || !r.id || seen.has(r.id)) continue;
    if (field === "chatMessages") {
      const channel = ctx.chatChannels?.get(r.channelId);
      if (channel && canSeeTask(channel, memberId, ctx))
        result.push(messageWithChannelAccess(r, channel, memberId));
      continue;
    }
    if (field === "chatReadStates") {
      result.push(sanitizeChatReadState(r, memberId));
      continue;
    }
    if (r.ownerId === memberId) result.push(r);
    else if (r.ownerId == null)
      result.push({
        ...r,
        ownerId: memberId,
        visibility: r.visibility || "privado",
      });
  }
  return result;
}

export async function handleWorkspace(request, env, user, url, ctx, notifyWorkspaceChange) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  const restricted = role === "colaborador" || role === "gestor";
  if (request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT data, updated_at, revision FROM workspaces WHERE user_id = ?",
    )
      .bind(ownerId)
      .first();
    let data = null;
    try {
      data = row ? JSON.parse(row.data) : null;
    } catch {
      data = null;
    }
    // Conversas diretas e grupos continuam privados inclusive para o dono do
    // workspace. Canais abertos permanecem visíveis a todos os participantes.
    if (
      data &&
      CHAT_FIELDS.some((field) =>
        Object.prototype.hasOwnProperty.call(data, field),
      )
    ) {
      const chatCtx = resolveViewerContext(data, user.id);
      const visibleChannels = filterRecordsForViewer(
        data.chatChannels,
        user.id,
        chatCtx,
      );
      const visibleChannelIds = new Set(
        visibleChannels.map((channel) => channel.id),
      );
      data = {
        ...data,
        chatChannels: visibleChannels,
        chatMessages: filterRecordsForViewer(
          data.chatMessages,
          user.id,
          chatCtx,
        ).filter((message) => visibleChannelIds.has(message.channelId)),
        chatReadStates: (Array.isArray(data.chatReadStates)
          ? data.chatReadStates
          : []
        ).filter((state) => state.ownerId === user.id),
      };
    }
    if (data && restricted) {
      const ctx = resolveViewerContext(data, user.id);
      const filtered = { ...data };
      for (const field of RESTRICTED_FIELDS)
        filtered[field] = filterRecordsForViewer(data[field], user.id, ctx);
      filtered.financeSettings = {};
      filtered.taxProfile = {
        isMEI: false,
        dueDay: 20,
        cnpj: "",
        dasHistory: {},
      };
      data = filtered;
    }
    return json({
      data,
      updatedAt: row?.updated_at || null,
      revision: Number.isInteger(row?.revision) ? row.revision : 0,
    });
  }
  if (request.method !== "PUT")
    return json({ error: "Método não permitido." }, 405);
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (!allowed(`ws:${ip}`, 40))
    return json(
      { error: "Muitas sincronizações em pouco tempo. Aguarde um instante." },
      429,
    );
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitação inválida." }, 400);
  }
  let data =
    body && body.data && typeof body.data === "object" ? body.data : null;
  if (!data) return json({ error: "Dados inválidos." }, 400);
  const baseRevision = body.revision ?? 0;
  if (!Number.isInteger(baseRevision) || baseRevision < 0)
    return json({ error: "Revisão de workspace inválida." }, 400);
  const priorRow = await env.DB.prepare(
    "SELECT data FROM workspaces WHERE user_id = ?",
  )
    .bind(ownerId)
    .first();
  let currentData = null;
  try {
    currentData = priorRow ? JSON.parse(priorRow.data) : null;
  } catch {
    currentData = null;
  }
  if (restricted) {
    let ctx = resolveViewerContext(currentData, user.id);
    const merged = { ...data };
    for (const field of RESTRICTED_FIELDS) {
      merged[field] = mergeRecordsFromMember(
        currentData?.[field],
        data[field],
        user.id,
        ctx,
        field,
      );
      if (field === "chatChannels")
        ctx = resolveViewerContext(
          { ...currentData, chatChannels: merged.chatChannels },
          user.id,
        );
    }
    for (const field of OWNER_ONLY_TOP_LEVEL_FIELDS)
      merged[field] = currentData?.[field];
    data = merged;
  } else if (currentData) {
    // O dono também recebe apenas os chats dos quais participa. Preserve
    // conversas privadas de outras pessoas quando ele salvar o restante do
    // workspace, em vez de apagá-las por omissão.
    let ctx = resolveViewerContext(currentData, user.id);
    const merged = { ...data };
    for (const field of CHAT_FIELDS) {
      if (
        !Object.prototype.hasOwnProperty.call(currentData, field) &&
        !Object.prototype.hasOwnProperty.call(data, field)
      )
        continue;
      merged[field] = mergeRecordsFromMember(
        currentData?.[field],
        data[field],
        user.id,
        ctx,
        field,
      );
      if (field === "chatChannels")
        ctx = resolveViewerContext(
          { ...currentData, chatChannels: merged.chatChannels },
          user.id,
        );
    }
    data = merged;
  }
  const text = JSON.stringify(data);
  if (text.length > 900_000)
    return json(
      {
        error:
          "O espaço de sincronização foi excedido. Exporte ou remova itens grandes do histórico.",
      },
      413,
    );
  const updatedAt = new Date().toISOString();
  if (priorRow) {
    await ensureWorkspaceSnapshotsSchema(env);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO workspace_snapshots
        (id, owner_id, revision, data, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        ownerId,
        baseRevision,
        priorRow.data,
        updatedAt,
        user.id,
      )
      .run();
  }
  const updated = await env.DB.prepare(
    `INSERT INTO workspaces (user_id, data, updated_at, revision)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(user_id) DO UPDATE SET
      data = excluded.data,
      updated_at = excluded.updated_at,
      revision = workspaces.revision + 1
    WHERE workspaces.revision = ?
    RETURNING revision, updated_at`,
  )
    .bind(ownerId, text, updatedAt, baseRevision)
    .first();
  if (!updated) {
    const current = await env.DB.prepare(
      "SELECT revision, updated_at FROM workspaces WHERE user_id = ?",
    )
      .bind(ownerId)
      .first();
    return json(
      {
        error:
          "Este espaço foi alterado em outra aba ou dispositivo. Sua versão local não foi enviada.",
        serverRevision: Number.isInteger(current?.revision)
          ? current.revision
          : 0,
        serverUpdatedAt: current?.updated_at || null,
      },
      409,
    );
  }
  await env.DB.prepare(
    `DELETE FROM workspace_snapshots
    WHERE owner_id = ? AND id NOT IN (
      SELECT id FROM workspace_snapshots
      WHERE owner_id = ?
      ORDER BY revision DESC
      LIMIT 20
    )`,
  )
    .bind(ownerId, ownerId)
    .run();
  try {
    await notifyNewNotifications(env, currentData?.notifications, data.notifications);
  } catch (error) {
    console.error("push notify", error);
  }
  // Envio automático para outro sistema. Comparar aqui o espaço anterior com o
  // novo é o que permite avisar sem mexer em cada tela do app: funciona venha o
  // registro de onde vier. Nunca derruba a gravação — falhar em avisar um
  // sistema externo não pode custar os dados de quem está usando.
  // Depois da resposta, e não antes: um destino lento seguraria a gravação por
  // segundos e a pessoa acharia que o app travou. E nunca propaga erro — falhar
  // em avisar um sistema externo não pode custar os dados de quem usa.
  const avisar = notifyWorkspaceChange(
    env,
    ownerId,
    currentData,
    data,
    (data?.businesses || []).find((b) => b?.id === data?.selectedBusinessId)
      ?.name || null,
  ).catch((error) => console.error("webhook notify", error));
  if (ctx?.waitUntil) ctx.waitUntil(avisar);
  else await avisar;
  return json({
    ok: true,
    updatedAt: updated.updated_at,
    revision: updated.revision,
  });
}
