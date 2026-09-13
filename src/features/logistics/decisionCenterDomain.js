const DAY = 86_400_000;

const dateValue = (value) => {
  const parsed = new Date(value || "").getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const money = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const opportunityValue = (item) =>
  money(item?.value ?? item?.valorContrato ?? item?.amount ?? item?.estimatedValue);

const opportunityProbability = (item) => {
  const parsed = Number(item?.probability ?? item?.probabilidade ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed));
};

const isOpenOpportunity = (item) =>
  !/(ganh|perdid|cancel|encerr|closed|won|lost)/i.test(String(item?.stage ?? item?.estagio ?? item?.status ?? ""));

const countLabel = (total, singular, plural) => `${total} ${total === 1 ? singular : plural}`;

// Dia de calendário (AAAA-MM-DD) de uma data solta. Data pura fica como está —
// converter para fuso transformaria "hoje" em "ontem" para quem está a oeste de
// Greenwich, que é o caso do Brasil inteiro.
export const diaDaData = (valor) => {
  if (valor instanceof Date) return Number.isFinite(valor.getTime()) ? valor.toLocaleDateString("sv-SE") : "";
  const texto = String(valor ?? "").trim();
  if (!texto) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const parsed = new Date(texto);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString("sv-SE") : "";
};

// "Ação atrasada" é DIA anterior a hoje, não instante anterior a agora. Comparar
// por timestamp fazia a ação marcada para HOJE já nascer atrasada (`new Date("2026-09-13")`
// é meia-noite UTC, sempre atrás do agora no Brasil) e, pior, divergia do filtro
// "Ações atrasadas" do CRM, que sempre comparou dia: o aviso contava 2 contas e a
// lista abria vazia. Agora é UMA definição, importada pelo CRM e pelo Meu Dia.
export const contaComAcaoAtrasada = (cliente, hoje = diaDaData(new Date())) => {
  const dia = diaDaData(cliente?.crm?.nextActionAt ?? cliente?.nextActionAt);
  return Boolean(dia) && Boolean(hoje) && dia < hoje;
};

export const contasComAcaoAtrasada = (clientes = [], agora = new Date()) => {
  const hoje = diaDaData(agora) || diaDaData(new Date());
  return (Array.isArray(clientes) ? clientes : []).filter((item) => contaComAcaoAtrasada(item, hoje));
};

export const oportunidadeSemProximaAcao = (item) =>
  !String(item?.nextStep ?? item?.proximoPasso ?? item?.nextAction ?? "").trim();

const nomeDoRegistro = (item) =>
  String(item?.name ?? item?.nome ?? item?.cliente ?? item?.client ?? item?.titulo ?? item?.title ?? "").trim();

// "2 clientes com ação atrasada" sem dizer QUAIS obriga a caçar na lista — e foi
// exatamente a reclamação da titular. O aviso passa a nomear até três contas.
const nomesDoAlerta = (registros, limite = 3) => {
  const nomes = registros.map(nomeDoRegistro).filter(Boolean);
  if (!nomes.length) return "";
  const restantes = nomes.length - limite;
  return restantes > 0 ? `${nomes.slice(0, limite).join(", ")} e mais ${restantes}` : nomes.join(", ");
};

// Cada pendência abre a tela FILTRADA nos registros que a acenderam. Sem o
// filtro na rota, clicar no aviso caía na lista inteira do CRM e a pessoa tinha
// de adivinhar quem estava atrasado.
const comDetalhe = (nomes, texto) => (nomes ? `${nomes}. ${texto}` : texto);

// O contrato da vertical expõe o fim como `fimEm`; os aliases em inglês ficam
// por compatibilidade com fixtures e chamadores antigos. Sem `fimEm` aqui, o
// alerta de renovação nunca acendia para contrato real nenhum.
const contractEnd = (item) =>
  dateValue(item?.endAt ?? item?.endsAt ?? item?.endDate ?? item?.expiresAt ?? item?.validUntil ?? item?.fimEm);

const renewalType = (item) =>
  String(item?.renewalType ?? item?.renovacao ?? item?.renewal_type ?? "").trim().toLowerCase();

const renewalNoticeDays = (item) => {
  const parsed = Number(item?.noticeDays ?? item?.antecedenciaAvisoDias ?? item?.notice_days);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// Quando começa a janela de renovação: a data de aviso combolada no contrato
// manda; sem ela, `fim − antecedência`; sem antecedência, 90 dias antes do fim
// (o padrão histórico). Assim um contrato que exige aviso de 120 dias avisa aos
// 120, não aos 90 — que já seria tarde.
const renewalNoticeMs = (item, end) => {
  const explicit = dateValue(item?.renewalNoticeDate ?? item?.avisoRenovacaoEm ?? item?.renewal_notice_date);
  if (explicit !== null) return explicit;
  if (end === null) return null;
  return end - (renewalNoticeDays(item) ?? 90) * DAY;
};

const scenarioMargin = (item) => {
  const result = item?.result || item?.resultado || {};
  const parsed = Number(
    item?.marginPercent ?? item?.margemPercentual ?? result?.marginPercent ?? result?.margemPercentual,
  );
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildTodoGreenDecisionCenter = ({ data = {}, dashboard = {}, tasks = [], now = new Date() } = {}) => {
  const nowMs = dateValue(now) ?? Date.now();
  const clients = Array.isArray(data.clients) ? data.clients : [];
  const opportunities = (Array.isArray(data.opportunities) ? data.opportunities : []).filter(isOpenOpportunity);
  const contracts = Array.isArray(data.contracts) ? data.contracts : [];
  const scenarios = Array.isArray(data.pricingScenarios) ? data.pricingScenarios : [];
  const operations = Array.isArray(data.operations) ? data.operations : [];
  const financial = Array.isArray(data.financial) ? data.financial : [];
  const costEntries = Array.isArray(data.costEntries) ? data.costEntries : [];
  const openTasks = (Array.isArray(tasks) ? tasks : []).filter((item) =>
    !/(conclu|feito|done|finaliz|cancel)/i.test(String(item?.status || "")),
  );

  const pipeline = opportunities.reduce((total, item) => total + opportunityValue(item), 0);
  const forecast = opportunities.reduce(
    (total, item) => total + opportunityValue(item) * opportunityProbability(item) / 100,
    0,
  );

  const overdueClients = contasComAcaoAtrasada(clients, now);
  const opportunitiesWithoutAction = opportunities.filter(oportunidadeSemProximaAcao);
  const expiringContracts = contracts.filter((item) => {
    // Contrato sem renovação não gera aviso de renovação — acender aqui seria
    // ruído. Já vencido também sai: é outro problema, não "antecipe".
    if (renewalType(item) === "none") return false;
    const end = contractEnd(item);
    if (end === null || end < nowMs) return false;
    const notice = renewalNoticeMs(item, end);
    return notice !== null && notice <= nowMs;
  });
  const lowMarginScenarios = scenarios.filter((item) => {
    const margin = scenarioMargin(item);
    const floor = Number(item?.minimumMarginPercent ?? item?.margemMinimaPercentual);
    return margin !== null && Number.isFinite(floor) && margin < floor;
  });
  const criticalOperations = operations.filter((item) =>
    money(item?.incidents ?? item?.occurrences ?? item?.ocorrencias) > 0,
  );
  const overdueTasks = openTasks.filter((item) => {
    const due = dateValue(item?.due ?? item?.dueAt ?? item?.deadline);
    return due !== null && due < nowMs;
  });

  const alerts = [
    overdueClients.length && {
      id: "clients-overdue",
      tone: "attention",
      title: `${countLabel(overdueClients.length, "cliente", "clientes")} com ação atrasada`,
      detail: comDetalhe(nomesDoAlerta(overdueClients), "Retome o relacionamento ou atualize a próxima ação da conta."),
      action: "Abrir clientes",
      // Uma conta atrasada abre direto na ficha dela; várias abrem o CRM já
      // filtrado em "Ações atrasadas" — nunca mais a carteira inteira.
      route: overdueClients.length === 1 && overdueClients[0]?.id
        ? `/todogreen/clientes?client=${encodeURIComponent(overdueClients[0].id)}`
        : "/todogreen/clientes?filtro=acao-atrasada",
      ids: overdueClients.map((item) => item.id).filter(Boolean),
    },
    opportunitiesWithoutAction.length && {
      id: "opportunities-without-action",
      tone: "attention",
      title: `${countLabel(opportunitiesWithoutAction.length, "oportunidade", "oportunidades")} sem próxima ação`,
      detail: comDetalhe(
        nomesDoAlerta(opportunitiesWithoutAction),
        "O forecast perde confiabilidade quando a negociação não tem próximo passo.",
      ),
      action: "Revisar pipeline",
      route: "/todogreen/oportunidades?filtro=sem-proxima-acao",
      ids: opportunitiesWithoutAction.map((item) => item.id).filter(Boolean),
    },
    Number(dashboard.aprovacoesPendentes || 0) > 0 && {
      id: "approvals-pending",
      tone: "risk",
      title: `${countLabel(Number(dashboard.aprovacoesPendentes), "aprovação comercial pendente", "aprovações comerciais pendentes")}`,
      detail: "Há propostas aguardando decisão de alçada.",
      action: "Abrir aprovações",
      route: "/todogreen/deal-desk",
    },
    lowMarginScenarios.length && {
      id: "pricing-below-floor",
      tone: "risk",
      title: `${countLabel(lowMarginScenarios.length, "cenário", "cenários")} abaixo da margem mínima`,
      detail: "Revise custo, capacidade e justificativa antes de avançar.",
      action: "Revisar preço",
      route: "/todogreen/precificacao",
    },
    expiringContracts.length && {
      id: "contracts-expiring",
      tone: "attention",
      title: `${countLabel(expiringContracts.length, "contrato na janela de renovação", "contratos na janela de renovação")}`,
      detail: "Antecipe a renovação: reveja preço, reajuste e estratégia da conta antes do vencimento.",
      action: "Abrir contratos",
      route: "/todogreen/propostas",
    },
    criticalOperations.length && {
      id: "operations-critical",
      tone: "risk",
      title: `${countLabel(criticalOperations.length, "operação", "operações")} com ocorrência registrada`,
      detail: "Consulte a operação e defina o responsável pela tratativa.",
      action: "Abrir operações",
      route: "/todogreen/operacoes",
    },
    overdueTasks.length && {
      id: "tasks-overdue",
      tone: "attention",
      title: `${countLabel(overdueTasks.length, "tarefa prioritária atrasada", "tarefas prioritárias atrasadas")}`,
      detail: "Replaneje o prazo ou conclua o próximo passo.",
      action: "Abrir tarefas",
      // A ferramenta de tarefas do Espaço, não /central-trabalho (que abre a
      // Central de Implantação vazia por cima da página). Quando há UMA única
      // atrasada, abre direto nela (?task=<id>) — sem obrigar a caçar na lista.
      route: overdueTasks.length === 1 && overdueTasks[0]?.id
        ? `/todogreen/espaco?ferramenta=tarefas&task=${encodeURIComponent(overdueTasks[0].id)}`
        : "/todogreen/espaco?ferramenta=tarefas",
    },
  ].filter(Boolean);

  return {
    hasData: clients.length + opportunities.length + contracts.length + scenarios.length + operations.length + financial.length > 0,
    hasRevenueData: financial.length > 0 || contracts.length > 0,
    hasMarginData: scenarios.length > 0 || operations.length > 0 || costEntries.length > 0,
    hasImpactData: scenarios.length > 0 || operations.length > 0,
    pipeline,
    forecast,
    alerts,
    counts: {
      clients: clients.length,
      openOpportunities: opportunities.length,
      overdueClients: overdueClients.length,
      opportunitiesWithoutAction: opportunitiesWithoutAction.length,
      expiringContracts: expiringContracts.length,
      lowMarginScenarios: lowMarginScenarios.length,
      criticalOperations: criticalOperations.length,
      overdueTasks: overdueTasks.length,
    },
  };
};
