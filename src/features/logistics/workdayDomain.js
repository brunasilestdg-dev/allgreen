// Apresentação do "Meu dia": deriva filtros e atalhos a partir dos dados já existentes.
// Não cria tarefa, cliente, operação nem outra fonte de verdade.
export const WORKDAY_ROUTES = Object.freeze([
  { id: "commercial", title: "Clientes e negociações", description: "Acompanhe clientes, conversas, oportunidades e próximos passos.", route: "/todogreen/clientes" },
  { id: "projects", title: "Projetos e tarefas", description: "Abra o quadro de tarefas e organize entregas da sua rotina.", route: "/todogreen/espaco?ferramenta=tarefas" },
  { id: "operations", title: "Operação e transporte", description: "Acompanhe execução, viagens, SLA e ocorrências no TMS.", route: "/portal-tms" },
]);

// A fila do dia é organizada pelo PRAZO da tarefa, na ordem em que a pessoa
// precisa olhar: o que venceu, o que vence hoje, o que ainda cabe nesta semana,
// o que vem depois e o que nunca ganhou data. Antes só existiam três recortes
// (hoje, atrasadas, sem prazo) e tudo que tinha prazo futuro sumia da leitura —
// a tarefa de quinta não aparecia em lugar nenhum até virar "hoje".
export const WORKDAY_FILTERS = Object.freeze([
  { id: "all", label: "Todas" },
  { id: "overdue", label: "Atrasadas" },
  { id: "today", label: "Hoje" },
  { id: "week", label: "Esta semana" },
  { id: "next", label: "Próximas" },
  { id: "undated", label: "Sem prazo" },
]);

const taskDay = (task) => {
  const value = String(task?.due || task?.dueDate || task?.deadline || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? value : "";
};

const emUtc = (dia) => {
  const [ano, mes, data] = String(dia).split("-").map(Number);
  return Date.UTC(ano, mes - 1, data);
};

// Fim da semana corrente no calendário brasileiro (domingo a sábado). O cálculo
// é em UTC de propósito: são dias de calendário, não instantes — somar fuso aqui
// moveria a tarefa de sábado para a semana seguinte dependendo do relógio.
export function fimDaSemana(hoje) {
  const base = emUtc(hoje);
  if (!Number.isFinite(base)) return "";
  const diaDaSemana = new Date(base).getUTCDay();
  return new Date(base + (6 - diaDaSemana) * 86_400_000).toISOString().slice(0, 10);
}

export function workdayTasks(tasks = [], filter = "all", today = new Date().toLocaleDateString("sv-SE")) {
  const fim = fimDaSemana(today);
  return tasks.filter((task) => {
    const day = taskDay(task);
    if (filter === "today") return day === today;
    if (filter === "overdue") return Boolean(day) && day < today;
    if (filter === "week") return Boolean(day) && day > today && day <= fim;
    if (filter === "next") return Boolean(day) && day > fim;
    if (filter === "undated") return !day;
    return true;
  });
}

// De onde a tarefa veio, para a fila do dia dizer isso sem criar outra
// entidade: os campos já existem na tarefa canônica (`clientLabel`, `project`,
// `opportunityId`, `plannerPlanId`). Sem isso, "Enviar proposta" aparecia solta
// e a pessoa tinha de abrir para lembrar de que conta se tratava.
export function origemDaTarefa(task = {}) {
  const cliente = String(task.clientLabel || "").trim();
  const plano = String(task.project || "").trim();
  if (cliente && plano) return `Cliente · ${cliente} · ${plano}`;
  if (cliente) return `Cliente · ${cliente}`;
  if (task.opportunityId) return "CRM · oportunidade";
  if (plano) return `Planner · ${plano}`;
  return "To Do";
}
