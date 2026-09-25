// ===== Ação de uma pessoa sobre uma missão (/api/tasks/action) =====
//
// Contrato
// - Recebe: `request` (POST `{ taskId, action }`, com `action` em
//   `assume` | `interest` | `withdraw-interest`), `env`, `user` e `url`
//   (`?owner=` para espaço compartilhado).
// - Devolve: `{ ok, task, revision, updatedAt }`, ou 4xx explicando por que
//   a ação não vale (sem vaga, exige aprovação, dependência aberta...).
// - Quem chama: a tabela de rotas autenticadas (exige sessão e banco).
// - Autorização: precisa ser membro do espaço; quem não é dono nem `admin`
//   só age sobre tarefa que `canSeeTask` deixa ver (senão 404, sem revelar
//   que ela existe). Gravação atômica por `revision`, até 5 tentativas.

import { json } from "../lib/http.js";
import { membershipRole } from "../lib/membership.js";
import { canSeeTask, resolveViewerContext } from "../lib/visibility.js";
import { notifyNewNotifications } from "../mensageria/envio.js";

export async function handleTaskAction(request, env, user, url) {
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitação inválida." }, 400);
  }
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);
  const taskId = typeof body.taskId === "string" ? body.taskId : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!taskId || !["assume", "interest", "withdraw-interest"].includes(action))
    return json({ error: "Ação de tarefa inválida." }, 400);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await env.DB.prepare(
      "SELECT data, revision FROM workspaces WHERE user_id = ?",
    )
      .bind(ownerId)
      .first();
    if (!row) return json({ error: "Tarefa não encontrada." }, 404);
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      return json({ error: "Não foi possível ler esta tarefa." }, 500);
    }
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const index = tasks.findIndex((item) => item?.id === taskId);
    if (index < 0) return json({ error: "Tarefa não encontrada." }, 404);
    const task = tasks[index];
    const elevated = role === "owner" || role === "admin";
    const ctx = resolveViewerContext(data, user.id);
    if (!elevated && !canSeeTask(task, user.id, ctx))
      return json({ error: "Tarefa não encontrada." }, 404);
    if (!task.isMission || task.distribution !== "disponivel")
      return json({ error: "Esta tarefa não está aberta para participação." }, 409);

    const slots = Math.max(1, Number(task.slots) || 1);
    const assignees = Array.isArray(task.assignees) ? task.assignees : [];
    const interested = Array.isArray(task.interested) ? task.interested : [];
    let nextTask = task;
    let message = "";
    if (action === "assume") {
      if (task.approvalMode === "aprovacao")
        return json(
          { error: "Esta missão exige aprovação. Demonstre interesse primeiro." },
          409,
        );
      if (assignees.some((item) => item?.userId === user.id))
        return json({ ok: true, task, revision: row.revision, unchanged: true });
      if (assignees.length >= slots)
        return json({ error: "A última vaga já foi assumida." }, 409);
      const blocked = (Array.isArray(task.dependsOn) ? task.dependsOn : [])
        .map((id) => tasks.find((item) => item?.id === id))
        .some((dependency) => dependency && dependency.status !== "Concluído");
      if (blocked)
        return json({ error: "Conclua as tarefas anteriores antes de assumir esta missão." }, 409);
      const nextAssignees = [
        ...assignees,
        { userId: user.id, name: user.name, at: new Date().toISOString() },
      ];
      const full = nextAssignees.length >= slots;
      nextTask = {
        ...task,
        assignees: nextAssignees,
        missionStatus: full ? "em_andamento" : "disponivel",
        status: full ? "Em andamento" : task.status,
        updatedAt: new Date().toISOString(),
      };
      message = `Vaga assumida em "${task.title}"`;
    } else if (action === "interest") {
      if (interested.some((item) => item?.userId === user.id))
        return json({ ok: true, task, revision: row.revision, unchanged: true });
      if (assignees.length >= slots)
        return json({ error: "Esta missão não possui mais vagas." }, 409);
      nextTask = {
        ...task,
        interested: [
          ...interested,
          { userId: user.id, name: user.name, at: new Date().toISOString() },
        ],
        updatedAt: new Date().toISOString(),
      };
      message = `Novo interesse em "${task.title}"`;
    } else {
      nextTask = {
        ...task,
        interested: interested.filter((item) => item?.userId !== user.id),
        updatedAt: new Date().toISOString(),
      };
    }

    const nextTasks = tasks.map((item, taskIndex) =>
      taskIndex === index ? nextTask : item,
    );
    const beforeNotifications = Array.isArray(data.notifications)
      ? data.notifications
      : [];
    const nextNotifications = message && task.ownerId && task.ownerId !== user.id
      ? [
          {
            id: crypto.randomUUID(),
            ownerId: user.id,
            assigneeId: task.ownerId,
            visibility: "atribuido",
            message,
            link: "operacao",
            read: false,
            createdBy: user.id,
            createdAt: new Date().toISOString(),
          },
          ...beforeNotifications,
        ]
      : beforeNotifications;
    const nextData = {
      ...data,
      tasks: nextTasks,
      notifications: nextNotifications,
    };
    const updatedAt = new Date().toISOString();
    const updated = await env.DB.prepare(
      `UPDATE workspaces
       SET data = ?, updated_at = ?, revision = revision + 1
       WHERE user_id = ? AND revision = ?
       RETURNING revision, updated_at`,
    )
      .bind(JSON.stringify(nextData), updatedAt, ownerId, row.revision)
      .first();
    if (!updated) continue;
    try {
      await notifyNewNotifications(env, beforeNotifications, nextNotifications);
    } catch (error) {
      console.error("task action push", error);
    }
    return json({
      ok: true,
      task: nextTask,
      revision: updated.revision,
      updatedAt: updated.updated_at,
    });
  }
  return json(
    { error: "A tarefa mudou enquanto você agia. Atualize e tente novamente." },
    409,
  );
}
