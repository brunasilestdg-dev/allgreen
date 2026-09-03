const PRIORITIES = ["Baixa", "Média", "Alta"];

const AREAS = [
  "Operação",
  "Estratégia",
  "Vendas",
  "Marketing",
  "Atendimento",
  "Financeiro",
  "Jurídico",
  "RH / Pessoas",
  "TI / Tecnologia",
  "Logística",
  "Compras",
  "Administrativo",
  "Outra",
];

const cleanText = (value, max = 4_000) =>
  String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);

const cleanList = (value, maxItems = 8, maxChars = 240) =>
  (Array.isArray(value) ? value : [])
    .map((item) => cleanText(typeof item === "string" ? item : item?.title || item?.text, maxChars))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, maxItems);

const normalizePriority = (value, fallback = "Média") => {
  const normalized = cleanText(value, 30).toLocaleLowerCase("pt-BR");
  return PRIORITIES.find(
    (item) => item.toLocaleLowerCase("pt-BR") === normalized,
  ) || fallback;
};

const normalizeArea = (value, fallback = "Operação") => {
  const normalized = cleanText(value, 50).toLocaleLowerCase("pt-BR");
  return (
    AREAS.find((item) => item.toLocaleLowerCase("pt-BR") === normalized) ||
    fallback
  );
};

const parseJsonObject = (content) => {
  const source = cleanText(content, 40_000);
  if (!source) return null;
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  for (const candidate of [fenced, source]) {
    if (!candidate) continue;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
};

export function parseTaskStructure(content, current = {}) {
  const raw = parseJsonObject(content);
  if (!raw) return null;
  const data = raw.task && typeof raw.task === "object" ? raw.task : raw;
  const title = cleanText(data.title || data.titulo || current.title, 160);
  const description = cleanText(
    data.description || data.descricao || data.contexto || current.description,
    4_000,
  );
  if (!title && !description) return null;
  const daysValue = Number(
    data.estimatedDays || data.diasEstimados || data.duracaoDias || current.estimatedDays,
  );
  return {
    title,
    description,
    priority: normalizePriority(
      data.priority || data.prioridade,
      current.priority || "Média",
    ),
    area: normalizeArea(data.area, current.area || "Operação"),
    estimatedDays: Number.isFinite(daysValue)
      ? String(Math.max(1, Math.min(90, Math.round(daysValue))))
      : String(current.estimatedDays || "1"),
    subtasks: cleanList(data.subtasks || data.etapas || data.passos, 10),
    acceptanceCriteria: cleanList(
      data.acceptanceCriteria || data.criterios || data.definitionOfDone,
      10,
    ),
    risks: cleanList(data.risks || data.riscos, 6),
    questions: cleanList(data.questions || data.perguntas || data.duvidas, 6),
    suggestedSpecialist: cleanText(
      data.suggestedSpecialist || data.especialistaSugerido,
      80,
    ),
  };
}

export function buildTaskStructurePrompt({
  task = {},
  business = null,
  projects = [],
  specialists = [],
} = {}) {
  return `Transforme o rascunho abaixo em uma tarefa executável. Preserve fatos e intenção; não invente cliente, número, prazo, responsável ou requisito. Se faltar algo essencial, registre em "questions" e ainda estruture o que for possível.

NEGÓCIO
- Nome: ${cleanText(business?.name, 120) || "não informado"}
- Atividade: ${cleanText(business?.industryActivity || business?.segment, 160) || "não informada"}

RASCUNHO
- Título: ${cleanText(task.title, 300) || "não informado"}
- Descrição: ${cleanText(task.description, 5_000) || "não informada"}
- Prazo informado: ${cleanText(task.due, 30) || "não informado"}
- Projeto informado: ${cleanText(task.project, 160) || "não informado"}
- Projetos disponíveis: ${cleanList(projects, 20, 100).join(", ") || "nenhum"}
- Colaboradores digitais disponíveis: ${cleanList(specialists, 60, 80).join(", ") || "nenhum"}

Responda SOMENTE com JSON válido neste formato:
{
  "title": "verbo + resultado claro",
  "description": "contexto suficiente para executar",
  "priority": "Baixa|Média|Alta",
  "area": "${AREAS.join("|")}",
  "estimatedDays": 1,
  "subtasks": ["até 10 etapas concretas e em ordem"],
  "acceptanceCriteria": ["até 10 critérios observáveis que provam que terminou"],
  "risks": ["riscos comprováveis pelo rascunho; vazio se não houver"],
  "questions": ["somente lacunas que realmente impedem uma execução melhor"],
  "suggestedSpecialist": "nome exato da lista disponível ou vazio"
}`;
}

export function localTaskStructure(task = {}) {
  const title = cleanText(task.title || task.description?.split(/[.!?\n]/)[0], 160);
  const description = cleanText(task.description, 4_000);
  return {
    title: title || "Definir e executar a próxima entrega",
    description,
    priority: normalizePriority(task.priority),
    area: normalizeArea(task.area),
    estimatedDays: String(task.estimatedDays || "1"),
    subtasks: [
      "Confirmar o resultado esperado e as informações necessárias",
      "Executar a entrega principal",
      "Revisar o resultado e registrar evidências",
    ],
    acceptanceCriteria: [
      "O resultado solicitado está disponível para conferência",
      "Os requisitos informados no rascunho foram revisados",
    ],
    risks: description ? [] : ["A descrição ainda não informa contexto suficiente"],
    questions: description ? [] : ["Qual contexto ou requisito não pode faltar?"],
    suggestedSpecialist: "",
  };
}

export function taskCompletionGaps(task = {}) {
  const gaps = [];
  const pendingSteps = (Array.isArray(task.subtasks) ? task.subtasks : []).filter(
    (item) => !item?.done,
  );
  const pendingCriteria = (
    Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : []
  ).filter((item) => !(typeof item === "object" && item?.done));
  if (pendingSteps.length)
    gaps.push(`${pendingSteps.length} etapa(s) ainda não concluída(s)`);
  if (pendingCriteria.length)
    gaps.push(`${pendingCriteria.length} critério(s) ainda não confirmado(s)`);
  return gaps;
}

const ymd = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

const dayDiff = (from, to) => {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.round((end - start) / 86_400_000)
    : null;
};

export function prioritizeTaskBacklog(tasks = [], { now = new Date().toISOString().slice(0, 10) } = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  const byId = new Map(list.map((task) => [task.id, task]));
  return list
    .filter((task) => task && !task.archived && task.status !== "Concluído")
    .map((task) => {
      let score = task.status === "Em andamento" ? 12 : 0;
      const reasons = [];
      if (task.priority === "Alta") {
        score += 24;
        reasons.push("prioridade alta");
      } else if (task.priority === "Média") score += 10;
      const days = ymd(task.due) && ymd(now) ? dayDiff(now, task.due) : null;
      if (days !== null && days < 0) {
        score += 45 + Math.min(20, Math.abs(days));
        reasons.push(`${Math.abs(days)} dia(s) atrasada`);
      } else if (days === 0) {
        score += 38;
        reasons.push("vence hoje");
      } else if (days !== null && days <= 3) {
        score += 26 - days * 3;
        reasons.push(`vence em ${days} dia(s)`);
      } else if (!task.due) {
        score += 3;
        reasons.push("sem prazo");
      }
      const blockers = (task.dependsOn || [])
        .map((id) => byId.get(id))
        .filter((item) => item && item.status !== "Concluído");
      if (blockers.length) {
        score += 8;
        reasons.push(`aguarda ${blockers.length} dependência(s)`);
      }
      if (!task.assignee && !(task.assignees || []).length) {
        score += 4;
        reasons.push("sem responsável");
      }
      if (!(task.acceptanceCriteria || []).length) reasons.push("sem critério de conclusão");
      return { task, score, reasons, blockers, days };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.task.due || "9999-99-99").localeCompare(b.task.due || "9999-99-99") ||
        String(a.task.title || "").localeCompare(String(b.task.title || ""), "pt-BR"),
    );
}

// A próxima ação sugerida de uma tarefa priorizada. `prioritizeTaskBacklog` já
// diz POR QUE a tarefa pede atenção (reasons); esta função diz O QUE FAZER a
// respeito — a primeira regra que casa, do mais destravante ao mais leve. Recebe
// um item já analisado ({ task, blockers, days }) para não recalcular nada.
export function proximaAcaoDaTarefa(item = {}) {
  const task = item.task || {};
  if ((item.blockers || []).length)
    return `Destrave: conclua ${item.blockers.length} dependência(s) antes`;
  if (item.days !== null && item.days !== undefined && item.days < 0)
    return "Atrasada — reprograme o prazo ou conclua agora";
  if (item.days === 0) return "Vence hoje — conclua ainda hoje";
  if (!task.assignee && !(task.assignees || []).length) return "Defina um responsável";
  const gaps = taskCompletionGaps(task);
  if (gaps.length) return `Feche o que falta: ${gaps.join(" e ")}`;
  if (!(task.acceptanceCriteria || []).length) return "Defina o critério de conclusão";
  if (task.status !== "Em andamento") return "Comece esta tarefa";
  return "Siga para o próximo passo";
}

export function buildDigitalTaskPrompt(
  task = {},
  { specialist = "Diretor", business = null, dependencies = [] } = {},
) {
  const criteria = cleanList(task.acceptanceCriteria, 12);
  const steps = cleanList(task.subtasks, 15);
  const attachmentContext = (Array.isArray(task.attachments) ? task.attachments : [])
    .map((item) => {
      const content = cleanText(item?.content || item?.text, 3_000);
      return content ? `--- ${cleanText(item?.name, 120) || "Anexo"} ---\n${content}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 9_000);
  return `Execute a tarefa abaixo como ${cleanText(specialist, 80) || "Diretor"}. Entregue o trabalho utilizável agora; não responda apenas com um plano quando já for possível produzir o material final.

TAREFA
- Título: ${cleanText(task.title, 200)}
- Descrição: ${cleanText(task.description || task.instructions, 5_000) || "sem contexto adicional"}
- Negócio: ${cleanText(business?.name, 120) || "não informado"}
- Atividade: ${cleanText(business?.industryActivity || business?.segment, 160) || "não informada"}
- Projeto: ${cleanText(task.project, 160) || "não informado"}
- Prazo: ${cleanText(task.due, 30) || "não informado"}
- Prioridade: ${cleanText(task.priority, 30) || "não informada"}

ETAPAS
${steps.length ? steps.map((item, index) => `${index + 1}. ${item}`).join("\n") : "Nenhuma etapa cadastrada."}

CRITÉRIOS DE CONCLUSÃO
${criteria.length ? criteria.map((item) => `- ${item}`).join("\n") : "Nenhum critério cadastrado; declare como você validou a entrega."}

DEPENDÊNCIAS JÁ INFORMADAS
${cleanList(dependencies.map((item) => item?.title || item), 12).map((item) => `- ${item}`).join("\n") || "Nenhuma."}
${attachmentContext ? `\nANEXOS EXTRAÍDOS\n${attachmentContext}\n` : ""}
REGRAS DE EXECUÇÃO
1. Não invente dados, fontes, resultados ou ações externas.
2. Se uma informação indispensável faltar, identifique a lacuna e entregue a melhor versão possível com campos marcados para completar.
3. Se citar fato atual, legislação, preço ou mercado, use busca web e inclua links verificáveis.
4. Não diga que enviou, publicou, assinou ou alterou algo fora do app se apenas preparou o conteúdo.
5. Termine com: Entrega; Evidências/fontes; Limitações; Próximos passos.
6. Confira explicitamente cada critério de conclusão antes de finalizar.`;
}

