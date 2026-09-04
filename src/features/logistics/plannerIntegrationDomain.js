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

export const tarefaPlannerParaTodo = (tarefa, plano, existente = {}) => {
  const contexto = contextoComercialDaTarefa(tarefa);
  return {
    ...existente,
    id: existente.id || `planner-${tarefa.id}`,
    title: tarefa.title,
    description: tarefa.notes || "",
    status: STATUS_PLANNER_PARA_TAREFA[tarefa.progress] || "A fazer",
    priority: PRIORIDADE_PLANNER_PARA_TAREFA[tarefa.priority] || "Média",
    startDate: tarefa.startDate || "",
    due: tarefa.dueDate || "",
    assignee: tarefa.assigneeLabel || "",
    assigneeId: tarefa.assigneeUserId || "",
    project: plano?.name || existente.project || "",
    businessId: "todogreen",
    source: "todogreen-planner",
    plannerPlanId: tarefa.planId || plano?.id || "",
    plannerTaskId: tarefa.id,
    plannerRevision: tarefa.revision,
    clientId: contexto.clientId,
    opportunityId: contexto.opportunityId,
    updatedAt: tarefa.atualizadoEm || new Date().toISOString(),
    createdAt: existente.createdAt || tarefa.criadoEm || new Date().toISOString(),
  };
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
