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

const contractEnd = (item) =>
  dateValue(item?.endAt ?? item?.endsAt ?? item?.endDate ?? item?.expiresAt ?? item?.validUntil);

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

  const overdueClients = clients.filter((item) => {
    const nextAt = dateValue(item?.crm?.nextActionAt);
    return nextAt !== null && nextAt < nowMs;
  });
  const opportunitiesWithoutAction = opportunities.filter((item) =>
    !String(item?.nextStep ?? item?.proximoPasso ?? item?.nextAction ?? "").trim(),
  );
  const expiringContracts = contracts.filter((item) => {
    const end = contractEnd(item);
    return end !== null && end >= nowMs && end <= nowMs + 90 * DAY;
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
      detail: "Retome o relacionamento ou atualize a próxima ação da conta.",
      action: "Abrir clientes",
      route: "/todogreen/clientes",
    },
    opportunitiesWithoutAction.length && {
      id: "opportunities-without-action",
      tone: "attention",
      title: `${countLabel(opportunitiesWithoutAction.length, "oportunidade", "oportunidades")} sem próxima ação`,
      detail: "O forecast perde confiabilidade quando a negociação não tem próximo passo.",
      action: "Revisar pipeline",
      route: "/todogreen/oportunidades",
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
      title: `${countLabel(expiringContracts.length, "contrato vence", "contratos vencem")} em até 90 dias`,
      detail: "Antecipe a renovação e confirme a estratégia da conta.",
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
      // Central de Implantação vazia por cima da página).
      route: "/todogreen/espaco?ferramenta=tarefas",
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
