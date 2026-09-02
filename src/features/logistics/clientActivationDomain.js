const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const hasKeys = (value) => Object.keys(asObject(value)).length > 0;
const asText = (value) => String(value || "").trim();

export const CLIENT_ACTIVATION_CHECKS = Object.freeze([
  { id: "contract", label: "Contrato vigente, aprovado e assinado" },
  { id: "priceTable", label: "Tabela de preço vinculada" },
  { id: "billing", label: "Regras de faturamento definidas" },
  { id: "costCenter", label: "Centro de custo do cliente" },
  { id: "operation", label: "Operação operacional cadastrada" },
  { id: "sla", label: "SLA contratual estruturado" },
  { id: "responsibles", label: "Responsáveis definidos" },
  { id: "portal", label: "Acesso ao portal do cliente" },
  { id: "integrations", label: "Integrações necessárias validadas" },
  { id: "tracking", label: "Tracking disponível ou dispensado" },
  { id: "esg", label: "Parâmetros ESG habilitados" },
  { id: "dashboard", label: "Dashboard do cliente provisionado" },
]);

const contractIsCurrent = (contract, today) => {
  if (!contract?.id) return false;
  if (["draft", "cancelled", "canceled", "expired"].includes(asText(contract.status).toLowerCase()))
    return false;
  if (asText(contract.signatureStatus).toLowerCase() !== "signed") return false;
  if (asText(contract.approvalStatus).toLowerCase() !== "approved") return false;
  const start = asText(contract.startDate).slice(0, 10);
  const end = asText(contract.endDate).slice(0, 10);
  if (start && start > today) return false;
  if (end && end < today) return false;
  return true;
};

const makeCheck = (id, ready, detail, source = "automatic") => {
  const definition = CLIENT_ACTIVATION_CHECKS.find((item) => item.id === id);
  return {
    id,
    label: definition?.label || id,
    ready: Boolean(ready),
    status: ready ? "ready" : "blocked",
    detail: asText(detail),
    source,
  };
};

export function buildClientActivationReadiness(snapshot = {}, today = new Date().toISOString().slice(0, 10)) {
  const client = asObject(snapshot.client);
  const contract = asObject(snapshot.contract);
  const activation = asObject(client.activation);
  const tracker = asObject(snapshot.trackerIntegration);
  const priceTable = asObject(snapshot.priceTable);
  const contractReady = contractIsCurrent(contract, today);
  const trackerReady = ["ready", "active"].includes(asText(tracker.status).toLowerCase()) &&
    Boolean(tracker.lastSuccessAt || tracker.lastTestAt);
  const integrationStatus = asText(activation.integrationStatus).toLowerCase();
  const integrationsReady = ["ready", "not_required"].includes(integrationStatus) || trackerReady;
  const trackingRequired = activation.trackingRequired !== false;
  const trackingReady = !trackingRequired || trackerReady;
  const portalReady = client.portalEnabled === true && Number(snapshot.portalUsers || 0) > 0;
  const responsibleReady = Boolean(contract.responsibleUserId) && Number(snapshot.assignments || 0) > 0;
  const billingReady = Boolean(contract.billingDay) && hasKeys(contract.billingRules);
  const esgReady = activation.esgEnabled === true && Boolean(snapshot.activeScoreWeights);

  const checks = [
    makeCheck(
      "contract",
      contractReady,
      contractReady
        ? `Contrato ${contract.title || contract.id} vigente.`
        : "É necessário um contrato vigente, aprovado e assinado.",
    ),
    makeCheck(
      "priceTable",
      contractReady && Boolean(contract.priceTableId) &&
        priceTable.exists === true && priceTable.active === true && priceTable.belongsToClient === true,
      !contract.priceTableId
        ? "Vincule a tabela de preço ao contrato."
        : !priceTable.exists
          ? `A tabela de preço ${contract.priceTableId} do contrato não existe (ou foi arquivada).`
          : !priceTable.active
            ? `A tabela de preço ${contract.priceTableId} não está ativa.`
            : !priceTable.belongsToClient
              ? `A tabela de preço ${contract.priceTableId} não pertence a este cliente.`
              : `Tabela ${contract.priceTableId} ativa e vinculada.`,
    ),
    makeCheck(
      "billing",
      contractReady && billingReady,
      billingReady ? `Faturamento configurado para o dia ${contract.billingDay}.` : "Defina dia e regras de faturamento no contrato.",
    ),
    makeCheck(
      "costCenter",
      Boolean(snapshot.costCenter?.id),
      snapshot.costCenter?.id ? `Centro de custo ${snapshot.costCenter.code || snapshot.costCenter.name || snapshot.costCenter.id}.` : "O centro de custo pode ser criado automaticamente.",
    ),
    makeCheck(
      "operation",
      Boolean(snapshot.operation?.id),
      snapshot.operation?.id ? `Operação ${snapshot.operation.reference || snapshot.operation.id} vinculada.` : "Cadastre a operação real do cliente; o gate não cria operação fictícia.",
    ),
    makeCheck(
      "sla",
      contractReady && hasKeys(contract.sla),
      hasKeys(contract.sla) ? "SLA estruturado no contrato." : "Estruture SLA, janelas e critérios de medição no contrato.",
    ),
    makeCheck(
      "responsibles",
      responsibleReady,
      responsibleReady ? "Responsável contratual e carteira comercial definidos." : "Defina responsável do contrato e ao menos um responsável pela conta.",
    ),
    makeCheck(
      "portal",
      portalReady,
      portalReady ? `${Number(snapshot.portalUsers || 0)} acesso(s) ativo(s) no portal.` : "Habilite o portal e vincule ao menos um usuário externo ativo.",
    ),
    makeCheck(
      "integrations",
      integrationsReady,
      integrationStatus === "not_required"
        ? "Integração marcada como não necessária para esta implantação."
        : integrationsReady
          ? "Integração disponível para a implantação."
          : "Valide a integração necessária ou marque justificadamente como não necessária.",
      integrationStatus ? "configuration" : "automatic",
    ),
    makeCheck(
      "tracking",
      trackingReady,
      !trackingRequired
        ? "Tracking dispensado para esta implantação."
        : trackerReady
          ? "Tracker com teste/sincronização válida."
          : "Tracking obrigatório e ainda indisponível.",
      trackingRequired ? "automatic" : "configuration",
    ),
    makeCheck(
      "esg",
      esgReady,
      esgReady
        ? "Metodologia ESG ativa para a conta."
        : snapshot.activeScoreWeights
          ? "A metodologia existe e pode ser habilitada automaticamente para a conta."
          : "Cadastre uma versão ativa da metodologia/Green Score.",
    ),
    makeCheck(
      "dashboard",
      Boolean(snapshot.dashboard?.id),
      snapshot.dashboard?.id ? `Dashboard ${snapshot.dashboard.name || snapshot.dashboard.id} disponível.` : "O dashboard do cliente pode ser provisionado automaticamente.",
    ),
  ];

  const missing = checks.filter((item) => !item.ready);
  return {
    clientId: client.id || "",
    clientName: client.name || "",
    ready: missing.length === 0,
    completed: checks.length - missing.length,
    total: checks.length,
    percentage: Math.round(((checks.length - missing.length) / checks.length) * 100),
    checks,
    missing: missing.map((item) => item.id),
    activationStatus: asText(activation.status) || "implantation",
  };
}
