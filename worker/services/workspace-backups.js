// ===== Backups do espaço de trabalho (/api/workspace/backups) =====
//
// Contrato
// - Recebe: `request`, `env`, a pessoa da sessão (`user`) e `url`
//   (`?owner=` escolhe o espaço; sem ele, o da própria pessoa).
// - Devolve: GET → os 20 snapshots mais recentes; POST `{ snapshotId,
//   revision }` → restaura o snapshot e responde a nova `revision`.
// - Quem chama: a tabela de rotas autenticadas (exige sessão e banco).
// - Autorização: só dono ou `admin` do espaço (403 para os demais). Antes de
//   restaurar, guarda o estado atual como snapshot; respeita a `revision`
//   (409 se o espaço mudou no meio).

import { json } from "../lib/http.js";
import { membershipRole } from "../lib/membership.js";
import { ensureWorkspaceSnapshotsSchema } from "../lib/workspaceSchema.js";

export async function handleWorkspaceBackups(request, env, user, url) {
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  if (role !== "owner" && role !== "admin")
    return json(
      { error: "Somente proprietários e administradores podem restaurar dados." },
      403,
    );
  await ensureWorkspaceSnapshotsSchema(env);

  if (request.method === "GET") {
    const result = await env.DB.prepare(
      `SELECT id, revision, created_at, created_by, length(data) AS size
      FROM workspace_snapshots
      WHERE owner_id = ?
      ORDER BY revision DESC
      LIMIT 20`,
    )
      .bind(ownerId)
      .all();
    return json({
      backups: (result.results || []).map((item) => ({
        id: item.id,
        revision: item.revision,
        createdAt: item.created_at,
        createdBy: item.created_by,
        size: item.size,
      })),
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
  const snapshotId =
    typeof body?.snapshotId === "string" ? body.snapshotId.trim() : "";
  const baseRevision = body?.revision;
  if (!snapshotId || !Number.isInteger(baseRevision) || baseRevision < 0)
    return json({ error: "Backup ou revisão inválida." }, 400);

  const snapshot = await env.DB.prepare(
    `SELECT data FROM workspace_snapshots
    WHERE id = ? AND owner_id = ?`,
  )
    .bind(snapshotId, ownerId)
    .first();
  if (!snapshot) return json({ error: "Backup não encontrado." }, 404);
  const current = await env.DB.prepare(
    "SELECT data, revision FROM workspaces WHERE user_id = ?",
  )
    .bind(ownerId)
    .first();
  if (!current) return json({ error: "Espaço não encontrado." }, 404);
  if (current.revision !== baseRevision)
    return json(
      {
        error:
          "Este espaço foi alterado em outra aba ou dispositivo. Atualize antes de restaurar.",
        serverRevision: current.revision,
      },
      409,
    );

  const restoredAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspace_snapshots
      (id, owner_id, revision, data, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      ownerId,
      current.revision,
      current.data,
      restoredAt,
      user.id,
    )
    .run();
  const restored = await env.DB.prepare(
    `UPDATE workspaces
    SET data = ?, updated_at = ?, revision = revision + 1
    WHERE user_id = ? AND revision = ?
    RETURNING revision, updated_at`,
  )
    .bind(snapshot.data, restoredAt, ownerId, baseRevision)
    .first();
  if (!restored)
    return json(
      { error: "O espaço mudou durante a restauração. Tente novamente." },
      409,
    );
  return json({
    ok: true,
    revision: restored.revision,
    updatedAt: restored.updated_at,
  });
}
