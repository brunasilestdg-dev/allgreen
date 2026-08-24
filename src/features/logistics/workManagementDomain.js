// Gestão de trabalho: o núcleo puro que as telas (Gantt, Timeline, Calendário,
// Workload) e o handler consomem. Sem efeito colateral, todo resultado
// reproduzível a partir das entradas — datas de "hoje" entram por parâmetro,
// nunca de um relógio escondido, para o teste ser determinístico.
//
// Estende o modelo que já existe em todoGreenWorkCenterDomain.js (tipos de
// campo e de view). Aqui fica a LÓGICA: dependência, recorrência, rollup de
// subitem, carga. O que já era do Work Center não é reescrito.

const texto = (v) => String(v ?? "").trim();
const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const STATUS_CONCLUIDO = Object.freeze(["concluido", "concluído", "done", "feito", "entregue"]);

export const isConcluido = (status) => STATUS_CONCLUIDO.includes(texto(status).toLowerCase());

// ─── Aritmética de datas (UTC, sem horário) ─────────────────
// Trabalhamos com "YYYY-MM-DD". Uso de Date é local ao cálculo e sempre a
// partir de uma string explícita — nunca de new Date() sem argumento.

const soData = (valor) => texto(valor).slice(0, 10);

export function diasEntre(inicio, fim) {
  const a = soData(inicio);
  const b = soData(fim);
  if (!a || !b) return 0;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  return Math.round(ms / 86400000);
}

export function adicionarDias(data, n) {
  const base = soData(data);
  if (!base) return "";
  const ms = Date.parse(`${base}T00:00:00Z`) + numero(n) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function adicionarMeses(data, n) {
  const base = soData(data);
  if (!base) return "";
  const [y, m, d] = base.split("-").map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + numero(n), 1));
  // Preserva o dia, mas nunca estoura o fim do mês (31 de janeiro + 1 mês = 28/29 fev).
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

// ─── Recorrência ─────────────────────────────────────────────
// Uma regra vira uma lista de datas. Isso NÃO grava nada — a recorrência é
// expandida na hora de mostrar/gerar, para mudar a regra não reescrever o
// passado. Frequências: diaria, semanal, mensal, anual.

export const FREQUENCIAS = Object.freeze(["diaria", "semanal", "mensal", "anual"]);

export function expandirRecorrencia(recorrencia = {}, { inicio, ate, maximo = 366 } = {}) {
  const freq = texto(recorrencia.frequencia).toLowerCase();
  if (!FREQUENCIAS.includes(freq)) return [];
  const intervalo = Math.max(1, Math.trunc(numero(recorrencia.intervalo) || 1));
  const primeira = soData(recorrencia.inicio || inicio);
  if (!primeira) return [];
  const limite = soData(recorrencia.ate || ate);
  const contagem = recorrencia.contagem ? Math.max(1, Math.trunc(numero(recorrencia.contagem))) : null;

  // A próxima data é sempre calculada a partir da PRIMEIRA (a âncora), não da
  // anterior. Senão a recorrência mensal iniciada em 31/jan derivaria para o
  // dia 28 depois de fevereiro e nunca mais voltaria ao 31 — o erro clássico de
  // "drift". Diária e semanal não driftam, mas o mesmo cálculo serve às duas.
  const ocorrencia = (i) => {
    if (freq === "diaria") return adicionarDias(primeira, intervalo * i);
    if (freq === "semanal") return adicionarDias(primeira, 7 * intervalo * i);
    if (freq === "mensal") return adicionarMeses(primeira, intervalo * i);
    return adicionarMeses(primeira, 12 * intervalo * i);
  };

  const datas = [];
  for (let i = 0; i < maximo; i++) {
    const atual = ocorrencia(i);
    if (limite && atual > limite) break;
    datas.push(atual);
    if (contagem && datas.length >= contagem) break;
  }
  return datas;
}

// ─── Checklist ───────────────────────────────────────────────

export function progressoChecklist(checklist = []) {
  const itens = Array.isArray(checklist) ? checklist : [];
  const total = itens.length;
  const feitos = itens.filter((c) => c && c.feito).length;
  return { total, feitos, percentual: total ? Math.round((feitos / total) * 100) : 0 };
}

// ─── Subitens: o avanço do pai é derivado, nunca digitado ────
// O progresso do item pai vem dos filhos — por conclusão, se não houver
// progresso numérico; senão pela média do progresso informado. Espelha a regra
// da jornada de eletrificação: avanço marcado no clique mente.

export function rollupDeSubitens(subitens = []) {
  const filhos = (Array.isArray(subitens) ? subitens : []).filter(Boolean);
  if (!filhos.length) return { progresso: 0, concluidos: 0, total: 0, prazo: "", statusDerivado: "" };

  const total = filhos.length;
  const concluidos = filhos.filter((f) => isConcluido(f.status)).length;
  const temProgresso = filhos.some((f) => Number.isFinite(Number(f.progresso)));
  const progresso = temProgresso
    ? Math.round(filhos.reduce((s, f) => s + numero(f.progresso), 0) / total)
    : Math.round((concluidos / total) * 100);

  // O prazo do pai é o do filho que termina por último.
  const prazo = filhos
    .map((f) => soData(f.dueDate || f.prazo))
    .filter(Boolean)
    .sort()
    .pop() || "";

  const statusDerivado = concluidos === total
    ? "concluido"
    : filhos.some((f) => !isConcluido(f.status) && texto(f.status)) ? "em_execucao" : "novo";

  return { progresso, concluidos, total, prazo, statusDerivado };
}

// ─── Dependências: ordem, ciclo e caminho crítico ───────────
// Cada item traz `dependencies` = [ids dos que precisam terminar antes]. A
// ordenação topológica dá a sequência; um ciclo é erro explícito, não laço
// infinito.

const indexarPorId = (itens) => {
  const mapa = new Map();
  for (const item of itens) if (item && item.id) mapa.set(item.id, item);
  return mapa;
};

const depsDe = (item) => (Array.isArray(item?.dependencies) ? item.dependencies : []).filter(Boolean);

export function detectarCiclo(itens = []) {
  const mapa = indexarPorId(itens);
  const estado = new Map(); // 0=nao visto, 1=na pilha, 2=fechado
  const caminho = [];

  const visitar = (id) => {
    if (estado.get(id) === 2) return null;
    if (estado.get(id) === 1) {
      const inicio = caminho.indexOf(id);
      return caminho.slice(inicio).concat(id);
    }
    if (!mapa.has(id)) return null;
    estado.set(id, 1);
    caminho.push(id);
    for (const dep of depsDe(mapa.get(id))) {
      const ciclo = visitar(dep);
      if (ciclo) return ciclo;
    }
    caminho.pop();
    estado.set(id, 2);
    return null;
  };

  for (const item of itens) {
    if (!item?.id) continue;
    const ciclo = visitar(item.id);
    if (ciclo) return ciclo;
  }
  return null;
}

export function ordenarPorDependencia(itens = []) {
  if (detectarCiclo(itens)) throw new Error("Há um ciclo de dependências entre os itens.");
  const mapa = indexarPorId(itens);
  const visitado = new Set();
  const ordem = [];
  const visitar = (id) => {
    if (visitado.has(id) || !mapa.has(id)) return;
    visitado.add(id);
    for (const dep of depsDe(mapa.get(id))) visitar(dep);
    ordem.push(id);
  };
  for (const item of itens) if (item?.id) visitar(item.id);
  return ordem;
}

// Duração de um item em dias: do start_date ao due_date (mínimo 1). Marco tem
// duração 0.
export function duracaoDoItem(item) {
  if (item?.isMilestone || item?.is_milestone) return 0;
  const inicio = soData(item?.startDate || item?.start_date);
  const fim = soData(item?.dueDate || item?.due_date);
  if (inicio && fim) return Math.max(1, diasEntre(inicio, fim) + 1);
  if (fim || inicio) return 1;
  return 1;
}

// Caminho crítico: a maior cadeia de dependências por duração acumulada. Os
// itens no caminho não têm folga — atrasá-los atrasa o projeto.
export function caminhoCritico(itens = []) {
  const ordem = ordenarPorDependencia(itens);
  const mapa = indexarPorId(itens);
  const acumulado = new Map(); // id -> {custo, anterior}
  for (const id of ordem) {
    const item = mapa.get(id);
    const dur = duracaoDoItem(item);
    let melhor = { custo: dur, anterior: null };
    for (const dep of depsDe(item)) {
      const prev = acumulado.get(dep);
      if (prev && prev.custo + dur > melhor.custo) {
        melhor = { custo: prev.custo + dur, anterior: dep };
      }
    }
    acumulado.set(id, melhor);
  }
  // Recompõe a cadeia mais cara.
  let fimId = null;
  let maior = -1;
  for (const [id, info] of acumulado) {
    if (info.custo > maior) { maior = info.custo; fimId = id; }
  }
  const cadeia = [];
  let cursor = fimId;
  while (cursor) {
    cadeia.unshift(cursor);
    cursor = acumulado.get(cursor)?.anterior || null;
  }
  return { duracaoTotal: Math.max(0, maior), itensCriticos: cadeia };
}

// ─── Gantt: barras a partir de uma data-base ────────────────
// Cada barra é um deslocamento (em dias, a partir da menor data do conjunto) e
// uma duração. Os itens do caminho crítico vêm marcados.

export function montarGantt(itens = []) {
  const comData = itens.filter((i) => soData(i?.startDate || i?.start_date) || soData(i?.dueDate || i?.due_date));
  if (!comData.length) return { inicio: "", fim: "", totalDias: 0, barras: [] };

  const inicios = comData.map((i) => soData(i.startDate || i.start_date) || soData(i.dueDate || i.due_date));
  const fins = comData.map((i) => soData(i.dueDate || i.due_date) || soData(i.startDate || i.start_date));
  const inicio = inicios.sort()[0];
  const fim = fins.sort().pop();
  const totalDias = Math.max(1, diasEntre(inicio, fim) + 1);

  let criticosSet = new Set();
  try { criticosSet = new Set(caminhoCritico(itens).itensCriticos); } catch { criticosSet = new Set(); }

  const barras = comData.map((item) => {
    const ini = soData(item.startDate || item.start_date) || soData(item.dueDate || item.due_date);
    const dur = duracaoDoItem(item);
    return {
      id: item.id,
      titulo: item.title || item.titulo || "",
      offsetDias: Math.max(0, diasEntre(inicio, ini)),
      duracaoDias: dur,
      marco: !!(item.isMilestone || item.is_milestone),
      critico: criticosSet.has(item.id),
      status: item.status || "",
      responsavel: item.responsible || item.responsavel || "",
    };
  });
  return { inicio, fim, totalDias, barras };
}

// ─── Calendário: itens agrupados por dia de vencimento ──────

export function itensNoCalendario(itens = [], { de, ate } = {}) {
  const inicio = soData(de);
  const fim = soData(ate);
  const porDia = {};
  for (const item of itens) {
    const dia = soData(item?.dueDate || item?.due_date);
    if (!dia) continue;
    if (inicio && dia < inicio) continue;
    if (fim && dia > fim) continue;
    (porDia[dia] = porDia[dia] || []).push(item);
  }
  return porDia;
}

// ─── Workload: carga por responsável ────────────────────────
// Conta itens abertos e horas estimadas por pessoa, e compara com a capacidade
// (quando fornecida, no formato de resourceProfiles do capacityDomain:
// weeklyHours). Sobrecarga é sinalizada, não corrigida sozinha.

export function cargaPorResponsavel(itens = [], { capacidades = {}, horasPorItemPadrao = 4 } = {}) {
  const porPessoa = new Map();
  for (const item of itens) {
    if (isConcluido(item?.status)) continue;
    const chave = texto(item?.responsibleUserId || item?.responsible_user_id || item?.responsible || item?.responsavel) || "sem-responsavel";
    const nome = texto(item?.responsible || item?.responsavel) || "Sem responsável";
    if (!porPessoa.has(chave)) porPessoa.set(chave, { chave, nome, itens: 0, horas: 0 });
    const registro = porPessoa.get(chave);
    registro.itens += 1;
    const horas = numero(item?.estimatedHours ?? item?.horasEstimadas ?? (item?.fields && item.fields.horasEstimadas));
    registro.horas += horas > 0 ? horas : horasPorItemPadrao;
  }
  return [...porPessoa.values()]
    .map((r) => {
      const capacidade = numero(capacidades[r.chave]);
      const utilizacao = capacidade > 0 ? Math.round((r.horas / capacidade) * 100) : null;
      return { ...r, capacidade, utilizacao, sobrecarregado: capacidade > 0 && r.horas > capacidade };
    })
    .sort((a, b) => b.horas - a.horas);
}

// ─── Agrupamento por grupo do board ─────────────────────────

export function agruparPorGrupo(itens = [], grupos = []) {
  const ordemGrupos = [...grupos].sort((a, b) => (a.displayOrder ?? a.display_order ?? 100) - (b.displayOrder ?? b.display_order ?? 100));
  const porGrupo = new Map(ordemGrupos.map((g) => [g.id, { grupo: g, itens: [] }]));
  const semGrupo = [];
  for (const item of itens) {
    const gid = texto(item?.groupId || item?.group_id);
    if (gid && porGrupo.has(gid)) porGrupo.get(gid).itens.push(item);
    else semGrupo.push(item);
  }
  const blocos = [...porGrupo.values()];
  if (semGrupo.length) blocos.push({ grupo: { id: "", name: "Sem grupo", color: "#6a7a74" }, itens: semGrupo });
  return blocos;
}

// ─── Validação ───────────────────────────────────────────────

export function validarItemDeTrabalho(item = {}) {
  const erros = [];
  const inicio = soData(item.startDate || item.start_date);
  const fim = soData(item.dueDate || item.due_date);
  if (inicio && fim && inicio > fim) erros.push("A data de início não pode ser depois do prazo.");
  const rec = item.recurrence || item.recorrencia;
  if (rec && texto(rec.frequencia) && !FREQUENCIAS.includes(texto(rec.frequencia).toLowerCase())) {
    erros.push("Frequência de recorrência inválida.");
  }
  if ((item.isMilestone || item.is_milestone) && !fim) {
    erros.push("Um marco precisa de uma data.");
  }
  return erros;
}

// ─── Resumo para dashboards de trabalho ─────────────────────

export function resumoDoTrabalho(itens = []) {
  const abertos = itens.filter((i) => !isConcluido(i?.status) && !i?.archivedAt && !i?.archived_at);
  const hoje = abertos.filter((i) => soData(i?.dueDate || i?.due_date));
  return {
    total: itens.length,
    abertos: abertos.length,
    concluidos: itens.filter((i) => isConcluido(i?.status)).length,
    marcos: itens.filter((i) => i?.isMilestone || i?.is_milestone).length,
    comPrazo: hoje.length,
  };
}
