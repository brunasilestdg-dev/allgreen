import { diasEntre } from "./workManagementDomain.js";

// ===== Planner (estilo Microsoft Planner) =====
//
// Um plano tem baldes (buckets) e tarefas. Cada tarefa tem responsável, prazo,
// prioridade, um status de progresso (nao_iniciada / em_andamento / concluida) e
// um checklist. O quadro é organizado por balde, por responsável ou por
// progresso — os mesmos três cortes que o MS Planner oferece.
//
// Duas decisões que este arquivo carrega, para o front e o worker concordarem:
//
// 1. **Visibilidade** — um plano é `private` (só quem criou vê) ou `shared`
//    (todo o espaço de trabalho vê). É o "pode ser compartilhado ou não".
//    Um plano privado pode ainda listar PESSOAS ESPECÍFICAS (`members`), que
//    passam a vê-lo e a trabalhar nas tarefas — pedido da titular (30/08).
//    `podeVerPlano` é a regra; o worker a repete no SQL, o front a usa para não
//    mostrar botão que o servidor recusaria.
//
// 2. **Progresso é derivado, nunca digitado** — o número que aparece na barra
//    vem do status e do checklist, na mesma linha do que o resto da vertical faz
//    com estoque e folha (o registro é o fato; o número é uma conta). Marcar
//    "concluída" é 100%; "não iniciada" é 0%; "em andamento" usa a fração do
//    checklist quando existe, senão 50% como sinal de "começou, não terminou".

export const PLANNER_VISIBILITIES = [
  { id: "private", label: "Privado", ajuda: "Só você vê este plano." },
  { id: "shared", label: "Compartilhado", ajuda: "Todo o espaço de trabalho vê." },
];

export const PLANNER_PROGRESS = [
  { id: "nao_iniciada", label: "Não iniciada", rank: 0 },
  { id: "em_andamento", label: "Em andamento", rank: 1 },
  { id: "concluida", label: "Concluída", rank: 2 },
];

export const PLANNER_PRIORITIES = [
  { id: "urgente", label: "Urgente", rank: 0 },
  { id: "alta", label: "Alta", rank: 1 },
  { id: "media", label: "Média", rank: 2 },
  { id: "baixa", label: "Baixa", rank: 3 },
];

const PROGRESS_IDS = PLANNER_PROGRESS.map((p) => p.id);
const PRIORITY_IDS = PLANNER_PRIORITIES.map((p) => p.id);
const VISIBILITY_IDS = PLANNER_VISIBILITIES.map((v) => v.id);

const semAcento = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const lista = (v) => (Array.isArray(v) ? v : []);
const texto = (v) => String(v ?? "").trim();

// Balde padrão de todo plano novo: um plano nunca nasce sem lugar para a
// primeira tarefa cair. O MS Planner chama de "A fazer".
export const DEFAULT_BUCKET = { id: "a_fazer", nome: "A fazer" };

export const normalizarVisibilidade = (v) =>
  VISIBILITY_IDS.includes(texto(v)) ? texto(v) : "private";

// Pessoas específicas de um plano privado. O banco só conhece
// private/shared; a lista estende o alcance do privado sem criar um terceiro
// valor de visibilidade. Teto de 60 para o JSON não crescer sem limite.
export const normalizarMembros = (valor) =>
  [...new Set(lista(valor).map((v) => texto(v)).filter(Boolean))].slice(0, 60);

// O texto que a tela mostra sobre quem alcança o plano — uma frase só, para a
// pílula do plano e o modal de compartilhamento contarem a mesma história.
export const resumoDoCompartilhamento = (plano) => {
  if (normalizarVisibilidade(plano?.visibility || plano?.visibilidade) === "shared")
    return "Todo o espaço de trabalho vê.";
  const n = normalizarMembros(plano?.members || plano?.membros).length;
  return n === 0
    ? "Só quem criou vê."
    : `Quem criou e mais ${n} pessoa(s) escolhida(s).`;
};

export const normalizarProgresso = (v) =>
  PROGRESS_IDS.includes(texto(v)) ? texto(v) : "nao_iniciada";

export const normalizarPrioridade = (v) =>
  PRIORITY_IDS.includes(texto(v)) ? texto(v) : "media";

// Baldes de um plano: sempre uma lista de { id, nome }, sempre com pelo menos o
// balde padrão. Ids repetidos ou vazios são descartados — o id é a âncora que
// liga a tarefa ao balde e precisa ser único e estável.
export const normalizarBaldes = (baldes) => {
  const vistos = new Set();
  const limpos = [];
  for (const b of lista(baldes)) {
    const id = texto(b?.id || b?.nome).slice(0, 60);
    const nome = texto(b?.nome || b?.id).slice(0, 80);
    if (!id || !nome || vistos.has(id)) continue;
    vistos.add(id);
    limpos.push({ id, nome });
  }
  if (!limpos.length) return [{ ...DEFAULT_BUCKET }];
  return limpos;
};

// A regra da visibilidade, uma só. Um plano compartilhado, todo o espaço vê; um
// privado, só quem o criou. `admin`/`owner` enxergam tudo do próprio espaço —
// é o papel de administração, não uma exceção de privacidade.
export const podeVerPlano = (plano, { userId, role } = {}) => {
  if (!plano) return false;
  if (normalizarVisibilidade(plano.visibility || plano.visibilidade) === "shared") return true;
  if (["owner", "admin"].includes(role)) return true;
  // Pessoa listada no plano privado vê o plano — é o compartilhamento com
  // pessoas específicas.
  if (Boolean(userId) && normalizarMembros(plano.members || plano.membros).includes(texto(userId)))
    return true;
  const dono = texto(plano.ownerUserId || plano.owner_user_id);
  return Boolean(userId) && dono === texto(userId);
};

// Editar/arquivar um plano privado é privilégio de quem o criou (e da
// administração). Um plano compartilhado continua sendo do criador para efeito
// de estrutura — mudar baldes, renomear, arquivar — enquanto as tarefas dentro
// dele qualquer pessoa do espaço mexe. Espelha o MS Planner: o dono do plano
// cuida do plano; o time toca as tarefas.
export const podeEditarPlano = (plano, { userId, role } = {}) => {
  if (!plano) return false;
  if (["owner", "admin"].includes(role)) return true;
  const dono = texto(plano.ownerUserId || plano.owner_user_id);
  return Boolean(userId) && dono === texto(userId);
};

// Progresso numérico (0..100) derivado do status e do checklist. Nunca vem
// digitado: é sempre esta conta. "Em andamento" com checklist usa a fração
// concluída; sem checklist, 50% — o suficiente para a barra sair do zero e
// sinalizar que a tarefa começou.
export const progressoNumerico = (tarefa) => {
  const status = normalizarProgresso(tarefa?.progress || tarefa?.progresso);
  if (status === "concluida") return 100;
  if (status === "nao_iniciada") return 0;
  const itens = lista(tarefa?.checklist);
  if (!itens.length) return 50;
  const feitos = itens.filter((i) => i?.feito || i?.done).length;
  return Math.round((feitos / itens.length) * 100);
};

// Quando o checklist inteiro é marcado, a tarefa não "vira" concluída sozinha —
// concluir é um ato explícito de quem executa (regra da jornada de
// eletrificação: avanço não se marca por clique de conveniência). Mas expor o
// sinal ajuda a tela a sugerir. `checklistCompleto` é esse sinal.
export const checklistCompleto = (tarefa) => {
  const itens = lista(tarefa?.checklist);
  return itens.length > 0 && itens.every((i) => i?.feito || i?.done);
};

const RANK_PRIORIDADE = Object.fromEntries(PLANNER_PRIORITIES.map((p) => [p.id, p.rank]));

// Ordenação padrão do quadro: prioridade primeiro (urgente no topo), depois
// prazo (mais próximo primeiro; sem prazo vai para o fim), e por último a ordem
// manual de exibição. Estável: nunca embaralha quem empata.
export const ordenarTarefas = (tarefas) =>
  lista(tarefas)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const pa = RANK_PRIORIDADE[normalizarPrioridade(a.t.priority || a.t.prioridade)] ?? 2;
      const pb = RANK_PRIORIDADE[normalizarPrioridade(b.t.priority || b.t.prioridade)] ?? 2;
      if (pa !== pb) return pa - pb;
      const da = texto(a.t.dueDate || a.t.due_date) || "9999-99-99";
      const db = texto(b.t.dueDate || b.t.due_date) || "9999-99-99";
      if (da !== db) return da < db ? -1 : 1;
      const oa = Number(a.t.displayOrder ?? a.t.display_order ?? 100);
      const ob = Number(b.t.displayOrder ?? b.t.display_order ?? 100);
      if (oa !== ob) return oa - ob;
      return a.i - b.i;
    })
    .map(({ t }) => t);

// O corte do quadro: por balde, por responsável ou por progresso. Devolve uma
// lista de colunas { chave, titulo, tarefas } já ordenadas, para a tela só
// desenhar. Baldes preservam a ordem do plano (inclusive os vazios); os outros
// cortes seguem a ordem natural do seu domínio.
export const agruparTarefas = (tarefas, criterio, { baldes = [] } = {}) => {
  const ordenadas = ordenarTarefas(tarefas);
  if (criterio === "responsavel") {
    const grupos = new Map();
    for (const t of ordenadas) {
      const chave = texto(t.assigneeUserId || t.assignee_user_id) || "__sem__";
      const titulo = texto(t.assigneeLabel || t.assignee_label) || "Sem responsável";
      if (!grupos.has(chave)) grupos.set(chave, { chave, titulo, tarefas: [] });
      grupos.get(chave).tarefas.push(t);
    }
    return [...grupos.values()];
  }
  if (criterio === "progresso") {
    return PLANNER_PROGRESS.map((p) => ({
      chave: p.id,
      titulo: p.label,
      tarefas: ordenadas.filter(
        (t) => normalizarProgresso(t.progress || t.progresso) === p.id,
      ),
    }));
  }
  // Padrão: por balde. Mantém a ordem e os rótulos definidos no plano, e
  // acrescenta uma coluna "Sem balde" só se houver tarefa órfã.
  const colunas = normalizarBaldes(baldes).map((b) => ({
    chave: b.id,
    titulo: b.nome,
    tarefas: ordenadas.filter((t) => texto(t.bucketId || t.bucket_id) === b.id),
  }));
  const idsConhecidos = new Set(colunas.map((c) => c.chave));
  const orfas = ordenadas.filter(
    (t) => !idsConhecidos.has(texto(t.bucketId || t.bucket_id)),
  );
  if (orfas.length) colunas.push({ chave: "__sem__", titulo: "Sem balde", tarefas: orfas });
  return colunas;
};

// "Minhas tarefas": o que está atribuído a esta pessoa, entre todos os planos
// que ela alcança. Ordenado pelo prazo, com as concluídas fora por padrão.
export const minhasTarefas = (tarefas, userId, { incluirConcluidas = false } = {}) =>
  ordenarTarefas(
    lista(tarefas).filter((t) => {
      const meu = texto(t.assigneeUserId || t.assignee_user_id) === texto(userId);
      if (!meu) return false;
      if (!incluirConcluidas && normalizarProgresso(t.progress || t.progresso) === "concluida")
        return false;
      return Boolean(userId);
    }),
  );

// Resumo de um plano para o cabeçalho do quadro e para o cartão na lista de
// planos: quantas tarefas, quantas concluídas, e a média de progresso. Um plano
// sem tarefa nenhuma tem 0% — não 100%, que enganaria.
export const resumoPlano = (tarefas) => {
  const ts = lista(tarefas);
  const total = ts.length;
  const concluidas = ts.filter(
    (t) => normalizarProgresso(t.progress || t.progresso) === "concluida",
  ).length;
  const emAndamento = ts.filter(
    (t) => normalizarProgresso(t.progress || t.progresso) === "em_andamento",
  ).length;
  const atrasadas = (hoje) =>
    ts.filter((t) => {
      const prazo = texto(t.dueDate || t.due_date);
      const status = normalizarProgresso(t.progress || t.progresso);
      return prazo && status !== "concluida" && prazo < texto(hoje);
    }).length;
  const media = total
    ? Math.round(ts.reduce((s, t) => s + progressoNumerico(t), 0) / total)
    : 0;
  return {
    total,
    concluidas,
    emAndamento,
    naoIniciadas: total - concluidas - emAndamento,
    progressoMedio: media,
    atrasadas,
  };
};

// ===== Camada inteligente do Planner =====
//
// O quadro já ordena e conta; o que faltava era o Planner DIZER, olhando os
// dados, o que precisa de atenção agora e por quê — sem ninguém digitar um
// status. Tudo aqui é derivado (prazo, prioridade, responsável, progresso),
// puro e reaproveita `diasEntre` em vez de recalcular data à mão.

const dueDe = (tarefa) => texto(tarefa?.dueDate || tarefa?.due_date);
const concluida = (tarefa) =>
  normalizarProgresso(tarefa?.progress || tarefa?.progresso) === "concluida";
const responsavelDe = (tarefa) => texto(tarefa?.assigneeUserId || tarefa?.assignee_user_id);
const dataDeHoje = (hoje) => texto(hoje) || new Date().toISOString().slice(0, 10);

// Sinais dinâmicos de uma tarefa, do mais grave ao mais leve. Uma tarefa
// concluída não tem sinal — ela saiu da fila. Cada sinal já traz o rótulo
// pronto para a tela e a severidade para a cor (risco > atenção).
export const sinaisDaTarefa = (tarefa, { hoje } = {}) => {
  if (!tarefa || concluida(tarefa)) return [];
  const ref = dataDeHoje(hoje);
  const sinais = [];
  const prazo = dueDe(tarefa);
  if (prazo) {
    const atraso = diasEntre(prazo, ref); // positivo = já passou do prazo
    if (atraso > 0)
      sinais.push({ tipo: "atrasada", severidade: "risco", rotulo: `Atrasada ${atraso} dia${atraso > 1 ? "s" : ""}` });
    else if (atraso === 0)
      sinais.push({ tipo: "vence_hoje", severidade: "atencao", rotulo: "Vence hoje" });
    else if (-atraso <= 2)
      sinais.push({ tipo: "vence_breve", severidade: "atencao", rotulo: `Vence em ${-atraso} dia${-atraso > 1 ? "s" : ""}` });
  }
  const prioridade = normalizarPrioridade(tarefa.priority || tarefa.prioridade);
  const progresso = normalizarProgresso(tarefa.progress || tarefa.progresso);
  if (prioridade === "urgente" && progresso === "nao_iniciada")
    sinais.push({ tipo: "urgente_parada", severidade: "risco", rotulo: "Urgente e não iniciada" });
  if (!responsavelDe(tarefa))
    sinais.push({ tipo: "sem_responsavel", severidade: "atencao", rotulo: "Sem responsável" });
  const ordem = { risco: 0, atencao: 1, info: 2 };
  return sinais.sort((a, b) => (ordem[a.severidade] ?? 3) - (ordem[b.severidade] ?? 3));
};

// Nota de urgência (quanto maior, mais pede ação agora). Serve só para ORDENAR
// a fila de prioridades — não é status nem se grava. Concluída fica fora (−1).
export const urgenciaDaTarefa = (tarefa, { hoje } = {}) => {
  if (!tarefa || concluida(tarefa)) return -1;
  const ref = dataDeHoje(hoje);
  const rank = RANK_PRIORIDADE[normalizarPrioridade(tarefa.priority || tarefa.prioridade)] ?? 2;
  let nota = [30, 18, 8, 2][rank] ?? 8;
  const prazo = dueDe(tarefa);
  if (prazo) {
    const atraso = diasEntre(prazo, ref);
    if (atraso > 0) nota += 50 + Math.min(20, atraso);
    else if (atraso === 0) nota += 40;
    else if (-atraso <= 2) nota += 25;
  }
  if (normalizarProgresso(tarefa.progress || tarefa.progresso) === "em_andamento") nota += 5;
  if (!responsavelDe(tarefa)) nota += 6;
  return nota;
};

// A fila do "faça agora": as tarefas não concluídas que têm algum sinal (prazo
// apertado, urgente parada, sem dono), ordenadas pela urgência, cada uma já com
// seus sinais e o motivo principal escolhido. `userId` opcional recorta para as
// tarefas de uma pessoa; `limite` corta a lista para a tela não virar mural.
export const prioridadesDoPlano = (tarefas, { hoje, userId = "", limite = 6 } = {}) => {
  const ref = dataDeHoje(hoje);
  const alvo = texto(userId);
  return lista(tarefas)
    .filter((t) => !concluida(t))
    .filter((t) => !alvo || responsavelDe(t) === alvo)
    .map((tarefa) => ({
      tarefa,
      urgencia: urgenciaDaTarefa(tarefa, { hoje: ref }),
      sinais: sinaisDaTarefa(tarefa, { hoje: ref }),
    }))
    .filter((item) => item.sinais.length > 0)
    .sort((a, b) => b.urgencia - a.urgencia)
    .slice(0, Math.max(0, Number(limite) || 0))
    .map((item) => ({ ...item, motivo: item.sinais[0]?.rotulo || "" }));
};

// Contadores do resumo inteligente do plano: o que está atrasado, o que vence
// hoje, o que vence em breve, o que está sem responsável e quantas tarefas
// pedem atenção no total. Complementa `resumoPlano`, que conta só o volume.
export const resumoInteligente = (tarefas, { hoje } = {}) => {
  const ref = dataDeHoje(hoje);
  const abertas = lista(tarefas).filter((t) => !concluida(t));
  const sinaisPorTarefa = abertas.map((t) => sinaisDaTarefa(t, { hoje: ref }));
  const conta = (tipo) => sinaisPorTarefa.filter((s) => s.some((x) => x.tipo === tipo)).length;
  return {
    atrasadas: conta("atrasada"),
    venceHoje: conta("vence_hoje"),
    venceEmBreve: conta("vence_breve"),
    semResponsavel: conta("sem_responsavel"),
    emRisco: sinaisPorTarefa.filter((s) => s.length > 0).length,
  };
};

// Filtro de busca de uma tarefa por texto livre: título, notas, rótulos e nome
// do responsável. Acento e caixa não atrapalham.
export const tarefaAtendeBusca = (tarefa, termo) => {
  const t = semAcento(termo);
  if (!t) return true;
  const campos = [
    tarefa?.title || tarefa?.titulo,
    tarefa?.notes || tarefa?.notas,
    tarefa?.assigneeLabel || tarefa?.assignee_label,
    ...lista(tarefa?.labels || tarefa?.rotulos),
  ];
  return campos.some((c) => semAcento(c).includes(t));
};

export const validarPlano = (plano) => {
  const erros = [];
  if (!texto(plano?.name || plano?.nome)) erros.push("Dê um nome ao plano.");
  if (texto(plano?.name || plano?.nome).length > 120)
    erros.push("O nome do plano é longo demais.");
  return erros;
};

export const validarTarefa = (tarefa) => {
  const erros = [];
  if (!texto(tarefa?.title || tarefa?.titulo)) erros.push("Dê um título à tarefa.");
  if (texto(tarefa?.title || tarefa?.titulo).length > 200)
    erros.push("O título da tarefa é longo demais.");
  const inicio = texto(tarefa?.startDate || tarefa?.start_date);
  const fim = texto(tarefa?.dueDate || tarefa?.due_date);
  if (inicio && fim && inicio > fim)
    erros.push("A data de início não pode ser depois do prazo.");
  return erros;
};
