// Leituras do mesmo cadastro e das tarefas já autorizadas no espaço.
export const taskWorkRoute = (task) =>
  `/todogreen/espaco?ferramenta=tarefas&task=${encodeURIComponent(task.id)}`;

export function accountWorkTasks(tasks = [], clientId) {
  if (!clientId) return [];
  return tasks
    .filter((task) => task.clientId === clientId && !task.archived)
    .sort((a, b) =>
      Number(a.status === "Concluído") - Number(b.status === "Concluído") ||
      String(a.due || "9999").localeCompare(String(b.due || "9999")));
}

export function suggestionContext(key = "") {
  if (key.startsWith("interaction-next-step:"))
    return "Próximo passo registrado em uma conversa desta conta.";
  if (key.startsWith("crm-next-action:"))
    return "Próxima ação informada pela equipe na ficha desta conta.";
  if (key.startsWith("opportunity-next-step:"))
    return "Próximo passo registrado em uma oportunidade aberta desta conta.";
  if (key.startsWith("resume-stalled-opportunity:"))
    return "Oportunidade sem atualização há pelo menos 21 dias. Confira se houve contato fora do sistema.";
  if (key)
    return "Sugestão baseada em uma lacuna do cadastro. Ela não comprova uma necessidade do cliente; valide antes de agir.";
  return "Os registros atuais não sustentam uma próxima ação. Registre uma pista ou defina seu próprio passo.";
}
