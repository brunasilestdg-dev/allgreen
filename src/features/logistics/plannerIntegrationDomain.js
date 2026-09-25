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

const lista = (valor) => (Array.isArray(valor) ? valor : []);
const idsUnicos = (...listas) =>
  [...new Set(listas.flat().map((v) => String(v ?? "").trim()).filter(Boolean))];

// ===== Partilha do plano → visibilidade das tarefas =====
//
// O plano vive na vertical (todogreen_planner_plans) e diz quem o vê; as
// tarefas vivem em `db.tasks`, no workspace do app, e quem as vê é decidido por
// `canSeeTask` (ownerId, assigneeId, sharedWith, visibility === "espaco_todo").
// São duas regras diferentes — e sem esta ponte uma pessoa "com quem
// compartilhei" abria o plano e via um quadro vazio (só a tarefa atribuída a
// ela). A partilha do plano desce para as tarefas dele:
//   • pessoas específicas → `sharedWith` ganha os membros, com permissão de
//     editar (o combinado do Planner é que quem participa TRABALHA nas tarefas);
//   • todo o espaço → `visibility: "espaco_todo"`;
//   • privado → o que o Planner tinha adicionado é retirado.
// O que a pessoa compartilhou à mão continua: guardamos em `plannerSharedWith`
// e `plannerVisibility` só o que veio do plano, para saber o que é nosso na
// hora de desfazer. Sem nada a compartilhar nem a desfazer, a tarefa volta
// intacta (mesma referência) — o sync roda sobre a coleção inteira.
export const partilhaDoPlanoNaTarefa = (tarefa = {}, plano = {}) => {
  const donoDaTarefa = String(tarefa.ownerId || "");
  const membros = idsUnicos(plano.members || plano.membros).filter((id) => id !== donoDaTarefa);
  const compartilhadoComEspaco = String(plano.visibility || plano.visibilidade || "") === "shared";
  const anteriores = idsUnicos(tarefa.plannerSharedWith);
  const visibilidadeAnterior = String(tarefa.plannerVisibility || "");
  if (!membros.length && !compartilhadoComEspaco && !anteriores.length && !visibilidadeAnterior) return tarefa;

  const manuais = idsUnicos(tarefa.sharedWith).filter((id) => !anteriores.includes(id));
  const sharedWith = idsUnicos(manuais, membros);
  const resultado = { ...tarefa, sharedWith, plannerSharedWith: membros };

  if (compartilhadoComEspaco) {
    resultado.visibility = "espaco_todo";
    resultado.plannerVisibility = "espaco_todo";
  } else {
    // Só desfaz o "todo o espaço" que o próprio Planner tinha ligado.
    if (visibilidadeAnterior === "espaco_todo" && tarefa.visibility === "espaco_todo") resultado.visibility = "privado";
    resultado.plannerVisibility = "";
  }
  if (sharedWith.length || compartilhadoComEspaco) resultado.sharingPermission = "editar";
  return resultado;
};

// Versão para varrer `db.tasks`: só toca as tarefas DESTE plano.
export const aplicarPartilhaDoPlanoNaTarefa = (tarefa = {}, plano = {}) => {
  if (!plano?.id || tarefa?.plannerPlanId !== plano.id) return tarefa;
  const proxima = partilhaDoPlanoNaTarefa(tarefa, plano);
  return proxima === tarefa ? tarefa : { ...proxima, updatedAt: new Date().toISOString() };
};

export const contextoComercialDaTarefa = (tarefa = {}) => ({
  clientId: String(tarefa.campos?.clientId || ""),
  opportunityId: String(tarefa.campos?.opportunityId || ""),
});

// O Planner legado tem 3 status; a task canônica tem 4 ("Aguardando" não existe
// no formato antigo). Na importação do legado, se o valor antigo representa o
// mesmo estado amplo, preservamos o status mais fino já presente na task canônica.
const mesmoStatusNoPlanner = (statusTarefa, progressoPlanner) =>
  Boolean(statusTarefa) && STATUS_TAREFA_PARA_PLANNER[statusTarefa] === progressoPlanner;

export const statusTarefaAoEspelhar = (progressoPlanner, statusExistente) =>
  mesmoStatusNoPlanner(statusExistente, progressoPlanner)
    ? statusExistente
    : STATUS_PLANNER_PARA_TAREFA[progressoPlanner] || "A fazer";

export const importarTarefaLegadaPlanner = (tarefa, plano, existente = {}, rotulos = {}) => {
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
    plannerBucketId: tarefa.bucketId || existente.plannerBucketId || "",
    plannerChecklist: Array.isArray(tarefa.checklist) ? tarefa.checklist : (existente.plannerChecklist || []),
    plannerLabels: Array.isArray(tarefa.labels) ? tarefa.labels : (existente.plannerLabels || []),
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


export const tarefaTodoParaPlanner = (tarefa = {}) => ({
  id: tarefa.id || "",
  rawTaskId: tarefa.id || "",
  canonicalTaskId: tarefa.canonicalTaskId || tarefa.id || "",
  planId: tarefa.plannerPlanId || "",
  revision: tarefa.plannerRevision || 0,
  title: tarefa.title || "",
  notes: tarefa.description || "",
  bucketId: tarefa.plannerBucketId || "",
  assigneeUserId: tarefa.assigneeId || "",
  assigneeLabel: tarefa.assignee || "",
  priority: String(tarefa.priority || "Média").toLocaleLowerCase("pt-BR")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  progress: STATUS_TAREFA_PARA_PLANNER[tarefa.status] || "nao_iniciada",
  startDate: tarefa.startDate || "",
  dueDate: tarefa.due || "",
  checklist: Array.isArray(tarefa.plannerChecklist) ? tarefa.plannerChecklist : [],
  labels: Array.isArray(tarefa.plannerLabels) ? tarefa.plannerLabels : [],
  campos: {
    clientId: tarefa.clientId || "",
    opportunityId: tarefa.opportunityId || "",
  },
});

export const desvincularTarefaDoPlanner = (tarefa = {}, planId = "") => {
  if (!planId || tarefa?.plannerPlanId !== planId) return tarefa;
  const sourceLinks = { ...(tarefa.sourceLinks || {}) };
  delete sourceLinks.planner;
  return {
    // Sem plano, a partilha que veio do plano também vai embora; a manual fica.
    ...partilhaDoPlanoNaTarefa(tarefa, { members: [], visibility: "private" }),
    plannerPlanId: "",
    plannerTaskId: "",
    plannerRevision: 0,
    plannerBucketId: "",
    plannerChecklist: [],
    plannerLabels: [],
    sourceLinks,
    updatedAt: new Date().toISOString(),
  };
};

export const tarefaCanonicaPertenceAoPlano = (tarefa = {}, planId = "") =>
  Boolean(planId && tarefa?.plannerPlanId === planId && tarefa?.archived !== true && tarefa?.deleted !== true);

export const aplicarEdicaoPlannerNaTarefa = (tarefaPlanner = {}, plano = {}, existente = {}, rotulos = {}) => {
  const contexto = contextoComercialDaTarefa(tarefaPlanner);
  const rawTaskId = existente.id || tarefaPlanner.rawTaskId || tarefaPlanner.id;
  const canonicalTaskId = existente.canonicalTaskId || tarefaPlanner.canonicalTaskId || rawTaskId;
  const plannerPlanId = tarefaPlanner.planId || plano?.id || existente.plannerPlanId || "";
  const now = new Date().toISOString();
  return partilhaDoPlanoNaTarefa({
    ...existente,
    id: rawTaskId,
    canonicalTaskId,
    canonicalSource: "task",
    title: tarefaPlanner.title || existente.title || "",
    description: tarefaPlanner.notes || "",
    status: statusTarefaAoEspelhar(tarefaPlanner.progress, existente.status),
    priority: PRIORIDADE_PLANNER_PARA_TAREFA[tarefaPlanner.priority] || existente.priority || "Média",
    startDate: tarefaPlanner.startDate || "",
    due: tarefaPlanner.dueDate || "",
    assignee: tarefaPlanner.assigneeLabel || "",
    assigneeId: tarefaPlanner.assigneeUserId || "",
    project: plano?.name || existente.project || "",
    businessId: existente.businessId || "todogreen",
    source: existente.source || "todogreen-planner",
    plannerPlanId,
    plannerTaskId: existente.plannerTaskId || tarefaPlanner.legacyTaskId || "",
    plannerRevision: existente.plannerRevision || 0,
    plannerBucketId: tarefaPlanner.bucketId || "",
    plannerChecklist: Array.isArray(tarefaPlanner.checklist) ? tarefaPlanner.checklist : [],
    plannerLabels: Array.isArray(tarefaPlanner.labels) ? tarefaPlanner.labels : [],
    clientId: contexto.clientId,
    opportunityId: contexto.opportunityId,
    clientLabel: String(rotulos.clientLabel || existente.clientLabel || "").trim(),
    sourceLinks: {
      ...(existente.sourceLinks || {}),
      todo: { taskId: rawTaskId },
      planner: { planId: plannerPlanId, taskId: rawTaskId },
      ...(contexto.clientId || contexto.opportunityId ? {
        crm: { clientId: contexto.clientId, opportunityId: contexto.opportunityId },
      } : {}),
    },
    updatedAt: now,
    createdAt: existente.createdAt || now,
  }, plano);
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

