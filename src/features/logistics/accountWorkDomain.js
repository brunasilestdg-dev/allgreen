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

// "O que já sabemos": as notas da conta chegam como um bloco só (ex.: o
// pipeline importado do Monday — "Funil: X | Prioridade: Y | Status: Z ...
// Últimos updates: - data (autor): texto"). Despejar tudo num parágrafo vira
// uma parede ilegível. Aqui o bloco é quebrado em campos e em uma lista de
// updates, sem inventar nada — só reorganiza o texto que já existe.
export function estruturarNotasDaConta(notes = "") {
  const texto = String(notes || "").trim();
  if (!texto) return { linhas: [], updates: [] };
  let cabecalho = texto;
  let updatesBruto = "";
  const partes = texto.split(/últimos updates:?/i);
  if (partes.length > 1) {
    cabecalho = partes[0];
    updatesBruto = partes.slice(1).join(" ");
  }
  // Rótulos conhecidos que o texto usa como campos (Monday e cadastro da conta).
  // Lista, não regex genérica de "Palavra:", de propósito: um valor com nome
  // próprio ("Responsável: Ana Lima Silva") não pode ser fatiado no meio. Os
  // rótulos mais longos vêm primeiro para casarem antes dos curtos.
  const ROTULOS = [
    "Faturamento anual esperado", "Faturamento anual", "Faturamento",
    "Próximo passo", "Próxima ação", "Próximo contato",
    "Responsável", "Prioridade", "Status", "Funil", "Segmento", "Prazo",
    "Origem", "Valor", "Etapa", "Estágio", "Contato", "Decisor", "Telefone",
    "Celular", "E-mail", "Email", "Cargo", "Empresa", "CNPJ", "Cidade",
    "Estado", "UF", "Região", "Regional", "Concorrente", "Volume", "Rota",
    "Rotas", "Operação", "Frota", "Cotação", "Tabela", "Contrato", "Início",
    "Interesse", "Necessidade", "Dor", "Observação", "Observações", "Setor",
  ];
  const rotulosRe = new RegExp(`\\s+(${ROTULOS.join("|")})\\s*:`, "gi");
  const comQuebras = cabecalho
    .replace(/\s*[|·•;]\s*/g, "\n")
    .replace(rotulosRe, "\n$1:")
    .replace(/\n{2,}/g, "\n");
  const linhas = comQuebras.split("\n").map((l) => l.trim()).filter(Boolean);
  const updates = updatesBruto
    .split(/\s+-\s+/)
    .map((u) => u.trim().replace(/^-\s*/, ""))
    .filter(Boolean);
  return { linhas, updates };
}
