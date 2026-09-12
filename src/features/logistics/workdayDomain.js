// Apresentação do "Meu dia": deriva filtros e atalhos a partir dos dados já existentes.
// Não cria tarefa, cliente, operação nem outra fonte de verdade.
export const WORKDAY_ROUTES = Object.freeze([
  { id: "commercial", title: "Clientes e negociações", description: "Acompanhe clientes, conversas, oportunidades e próximos passos.", route: "/todogreen/clientes" },
  { id: "projects", title: "Projetos e tarefas", description: "Abra o quadro de tarefas e organize entregas da sua rotina.", route: "/todogreen/espaco?ferramenta=tarefas" },
  { id: "operations", title: "Operação e transporte", description: "Acompanhe execução, viagens, SLA e ocorrências no TMS.", route: "/portal-tms" },
]);

export const WORKDAY_FILTERS = Object.freeze([
  { id: "all", label: "Todas" },
  { id: "today", label: "Hoje" },
  { id: "overdue", label: "Atrasadas" },
  { id: "undated", label: "Sem prazo" },
]);

const taskDay = (task) => {
  const value = String(task?.due || task?.dueDate || task?.deadline || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? value : "";
};

export function workdayTasks(tasks = [], filter = "all", today = new Date().toLocaleDateString("sv-SE")) {
  return tasks.filter((task) => {
    const day = taskDay(task);
    if (filter === "today") return day === today;
    if (filter === "overdue") return Boolean(day) && day < today;
    if (filter === "undated") return !day;
    return true;
  });
}
