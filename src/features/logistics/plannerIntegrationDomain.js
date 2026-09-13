const STATUS_PLANNER_PARA_TAREFA = {
  nao_iniciada: "A fazer",
  em_andamento: "Em andamento",
  concluida: "Concluído",
};

const STATUS_TAREFA_PARA_PLANNER = {
  "A fazer": "nao_iniciada",
  "Em andamento": "em_andamento",
  Aguardando: "em_andamento",
  "Concluído": "concluida",
};

const PRIORIDADE_PLANNER_PARA_TAREFA = {
  urgente: "Urgente",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const contextoComercialDaTarefa = (tarefa = {}) => ({
  clientId: String(tarefa.campos?.clientId || ""),
  opportunityId: String(tarefa.campos?.opportunityId || ""),
});

// O Planner tem 3 status; a To-Do tem 4 ("Aguardando" não existe no Planner e
// colapsa em "em_andamento"). Ao RE-espelhar do Planner para a To-Do, se o
// status que a To-Do já tinha mapeia para o MESMO status do Planner, o Planner
// não mudou de verdade — então preserva o status mais fino da To-Do. Sem isto,
// "Aguardando" virava "Em andamento" a cada sincronização (perda no round-trip).
const mesmoStatusNoPlanner = (statusTarefa, progressoPlanner) =>
  Boolean(statusTarefa) && STATUS_TAREFA_PARA_PLANNER[statusTarefa] === progressoPlanner;

export const statusTarefaAoEspelhar = (progressoPlanner, statusExistente) =>
  mesmoStatusNoPlanner(statusExistente, progressoPlanner)
    ? statusExistente
    : STATUS_PLANNER_PARA_TAREFA[progressoPlanner] || "A fazer";

export const tarefaPlannerParaTodo = (tarefa, plano, existente = {}, rotulos = {}) => {
  const contexto = contextoComercialDaTarefa(tarefa);
  const plannerPlanId = tarefa.planId || plano?.id || "";
  const plannerTaskId = tarefa.id;
  const canonicalTaskId = existente.canonicalTaskId || `planner:${plannerPlanId || "sem-plano"}:${plannerTaskId}`;
  return {
    ...existente,
    id: existente.id || `planner-${tarefa.id}`,
    canonicalTaskId,
    canonicalSource: existente.canonicalSource || "planner",
    title: tarefa.title,
    description: tarefa.notes || "",
    status: statusTarefaAoEspelhar(tarefa.progress, existente.status),
    priority: PRIORIDADE_PLANNER_PARA_TAREFA[tarefa.priority] || "Média",
    startDate: tarefa.startDate || "",
    due: tarefa.dueDate || "",
    assignee: tarefa.assigneeLabel || "",
    assigneeId: tarefa.assigneeUserId || "",
    project: plano?.name || existente.project || "",
    businessId: "todogreen",
    source: "todogreen-planner",
    plannerPlanId,
    plannerTaskId,
    plannerRevision: tarefa.revision,
    clientId: contexto.clientId,
    opportunityId: contexto.opportunityId,
    // O nome do cliente viaja com a tarefa espelhada (#142): o "Projeto" é o
    // nome do PLANO ("To do List"), que não distingue a "Precificação" da DHL da
    // da Vivara. Sem este rótulo, duas dependências ficam idênticas na tela.
    clientLabel: String(rotulos.clientLabel || existente.clientLabel || "").trim(),
    sourceLinks: {
      ...(existente.sourceLinks || {}),
      todo: { taskId: existente.id || `planner-${tarefa.id}` },
      planner: { planId: plannerPlanId, taskId: plannerTaskId },
      ...(contexto.clientId || contexto.opportunityId ? {
        crm: { clientId: contexto.clientId, opportunityId: contexto.opportunityId },
      } : {}),
    },
    updatedAt: tarefa.atualizadoEm || new Date().toISOString(),
    createdAt: existente.createdAt || tarefa.criadoEm || new Date().toISOString(),
  };
};

// ===== Rótulo da lista "Depende de" (#142) =====
//
// O bug: duas "Precificação (Concluído)" — uma da DHL, outra da Vivara —
// apareciam idênticas, e marcar a dependência errada atribuía a tarefa ao
// cliente errado. O distintivo é o cliente (rótulo humano), com o projeto como
// reserva. E quando ainda assim dois rótulos coincidem (tarefa antiga sem
// cliente resolvido), um sufixo curto e estável do id garante que NUNCA fiquem
// visualmente iguais — o operador sempre consegue separar uma da outra.
const distintivoDaTarefa = (tarefa = {}) =>
  String(tarefa.clientLabel || tarefa.project || "").trim();

export const rotuloBaseDependencia = (tarefa = {}) => {
  const distintivo = distintivoDaTarefa(tarefa);
  return `${tarefa.title || "Tarefa sem título"}${distintivo ? ` · ${distintivo}` : ""}`;
};

export const listaDependenciasComRotulo = (tarefas = []) => {
  const contagem = new Map();
  for (const tarefa of tarefas) {
    const base = rotuloBaseDependencia(tarefa);
    contagem.set(base, (contagem.get(base) || 0) + 1);
  }
  return tarefas.map((tarefa) => {
    const base = rotuloBaseDependencia(tarefa);
    const ambiguo = (contagem.get(base) || 0) > 1;
    const sufixoId = ambiguo && tarefa.id ? ` #${String(tarefa.id).slice(-4)}` : "";
    const status = tarefa.status ? ` (${tarefa.status})` : "";
    return { id: tarefa.id, rotulo: `${base}${sufixoId}${status}` };
  });
};

export const patchPlannerDaTarefa = (tarefa, alteracoes = {}) => {
  const proxima = { ...tarefa, ...alteracoes };
  return {
    revision: tarefa.plannerRevision,
    title: proxima.title,
    notes: proxima.description || "",
    progress: STATUS_TAREFA_PARA_PLANNER[proxima.status] || "nao_iniciada",
    priority: String(proxima.priority || "Média").toLocaleLowerCase("pt-BR")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
    startDate: proxima.startDate || "",
    dueDate: proxima.due || "",
    assigneeUserId: proxima.assigneeId || "",
    assigneeLabel: proxima.assignee || "",
    campos: {
      clientId: proxima.clientId || "",
      opportunityId: proxima.opportunityId || "",
    },
  };
};

export const tarefaVinculadaAoPlanner = (tarefa) =>
  Boolean(tarefa?.plannerPlanId && tarefa?.plannerTaskId);
