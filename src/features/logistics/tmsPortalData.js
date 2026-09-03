const headers = () => {
  try {
    const token = localStorage.getItem("seu-funcionario-auth-token") || "";
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

async function fetchJson(path, { optional = false, method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...headers(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (optional && [403, 404].includes(response.status)) return null;
    const error = new Error(data?.error || "Não foi possível carregar os dados do TMS.");
    error.status = response.status;
    error.code = data?.code || "";
    throw error;
  }
  return data;
}

export const listTmsApiKeys = () => fetchJson("/api/todogreen/tms-api-keys");
export const createTmsApiKey = (input) => fetchJson("/api/todogreen/tms-api-keys", { method: "POST", body: input });
export const revokeTmsApiKey = (id) => fetchJson(`/api/todogreen/tms-api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });

// Cadastro manual de carga/pedido — a mesma regra de negócio da API pública
// (/api/tms/v1/shipments), só que pela sessão de quem está no painel, sem
// precisar de chave.
export const listTmsManualClients = () => fetchJson("/api/todogreen/tms-manual/clients");
export const listTmsManualContracts = (clientId) =>
  fetchJson(`/api/todogreen/tms-manual/contracts?clientId=${encodeURIComponent(clientId)}`);
export const createTmsShipmentManual = (input) =>
  fetchJson("/api/todogreen/tms-manual/shipments", { method: "POST", body: input });
export const listTmsFleetPositions = () => fetchJson("/api/todogreen/tms-manual/positions");
export const registerTmsPodManual = (shipmentId, input) =>
  fetchJson(`/api/todogreen/tms-manual/shipments/${encodeURIComponent(shipmentId)}/pod`, { method: "POST", body: input });

// Bipagem: leitor físico (digita o código + Enter, como um teclado), câmera
// do celular ou digitação manual — os três chamam esta mesma função.
export const scanTmsTrackId = (input) => fetchJson("/api/todogreen/tms-manual/scan", { method: "POST", body: input });

const openStatus = (status) => ![
  "completed", "concluida", "delivered", "entregue", "cancelled", "canceled", "cancelado",
].includes(String(status || "").toLowerCase());

const pendingFiscal = (status) => !["autorizado", "cancelado"].includes(String(status || "").toLowerCase());
const pendingCiot = (status) => !["issued", "closed", "cancelled", "canceled"].includes(String(status || "").toLowerCase());

const order = (row) => ({
  id: row.id,
  number: row.number,
  status: row.status,
  clientId: row.clientId,
  operationId: row.operationId,
  scheduledStartAt: row.scheduledStartAt || "",
  scheduledEndAt: row.scheduledEndAt || "",
  quantity: Number(row.quantity || 0),
  chargeUnit: row.chargeUnit || "",
  netAmount: Number(row.netAmount || 0),
  origin: row.origin || {},
  destination: row.destination || {},
});

const operationFromTmsDocument = (row) => ({
  id: row.id,
  reference: row.externalId || row.invoiceNumber || row.id,
  status: row.status,
  serviceDate: row.occurredAt || row.promisedAt || "",
  origin: row.originUnit || "",
  destination: row.currentUnit || "",
  vehiclePlate: row.vehiclePlate || "",
  driverName: row.driverName || "",
  distanceKm: Number(row.distanceKm || 0),
  promisedAt: row.promisedAt || "",
  deliveredAt: ["completed", "delivered", "entregue", "concluida"].includes(String(row.status || "").toLowerCase())
    ? row.occurredAt || ""
    : "",
});

const fiscal = (row) => ({
  id: row.id,
  docType: row.docType,
  number: row.numero,
  series: row.serie,
  status: row.status,
  accessKey: row.chaveAcesso || "",
  serviceValue: Number(row.valorServico || 0),
  operationId: row.operationId || "",
  clientId: row.clientId || "",
  issuedAt: row.dataEmissao || "",
});

const ciot = (row) => ({
  id: row.id,
  number: row.number,
  status: row.status,
  ciotCode: row.ciotCode || "",
  serviceOrderId: row.serviceOrderId || "",
  operationId: row.operationId || "",
  vehiclePlate: row.vehiclePlate || "",
  driverDocument: row.driverDocument || "",
  origin: [row.originCity, row.originState].filter(Boolean).join("/"),
  destination: [row.destinationCity, row.destinationState].filter(Boolean).join("/"),
  freightAmount: Number(row.freightAmount || 0),
});

export async function loadTmsPortalData() {
  const access = await fetchJson("/api/todogreen/access");
  const grants = Array.isArray(access?.permissions) ? access.permissions : [];
  const allowed = ["owner", "admin"].includes(access?.role) || grants.includes("*") || grants.includes("tms:manage");
  if (!allowed) {
    const error = new Error("Seu acesso à Vertical To Do Green não inclui o Portal TMS.");
    error.code = "tms_access_required";
    error.status = 403;
    throw error;
  }

  const [ordersData, tmsData, fiscalData, ciotData, billingData, tmsConfig, ciotConfig, fiscalProfile, apiKeysData] = await Promise.all([
    fetchJson("/api/todogreen/transactions/service-orders?limit=100"),
    fetchJson("/api/todogreen/tms/documentos?limit=100"),
    fetchJson("/api/todogreen/fiscal/documentos?limit=100", { optional: true }),
    fetchJson("/api/todogreen/transactions/ciot", { optional: true }),
    fetchJson("/api/todogreen/transactions/billing-items?status=eligible", { optional: true }),
    fetchJson("/api/todogreen/tms/configuracao", { optional: true }),
    fetchJson("/api/todogreen/transactions/ciot-integration", { optional: true }),
    fetchJson("/api/todogreen/fiscal/perfil", { optional: true }),
    fetchJson("/api/todogreen/tms-api-keys", { optional: true }),
  ]);

  const orders = (ordersData?.records || []).map(order);
  const externalDocuments = tmsData?.registros || [];
  const operations = externalDocuments.map(operationFromTmsDocument);
  const fiscalDocuments = (fiscalData?.registros || []).map(fiscal);
  const ciots = (ciotData?.records || []).map(ciot);
  const billingItems = billingData?.records || [];
  const apiKeys = apiKeysData?.keys || [];
  const activeApiKeys = apiKeys.filter((item) => !item.revokedAt);

  return {
    generatedAt: new Date().toISOString(),
    access,
    indicators: {
      ordersOpen: orders.filter((item) => openStatus(item.status)).length,
      operationsInTransit: operations.filter((item) => openStatus(item.status)).length,
      unlinkedExternalDocs: externalDocuments.filter((item) => !item.clientId || !item.operationId).length,
      billingPending: billingItems.length,
      ctePending: fiscalDocuments.filter((item) => item.docType === "cte" && pendingFiscal(item.status)).length,
      mdfePending: fiscalDocuments.filter((item) => item.docType === "mdfe" && pendingFiscal(item.status)).length,
      ciotPending: ciots.filter((item) => pendingCiot(item.status)).length,
    },
    readiness: {
      routing: true,
      api: true,
      billing: Boolean(billingData),
      cte: Boolean(fiscalData),
      mdfe: Boolean(fiscalData),
      ciot: Boolean(ciotConfig?.integration?.configured || ciotConfig?.integration?.status === "ready"),
      track3r: Boolean(tmsConfig?.integracao),
      fiscalProfile: Boolean(fiscalProfile),
    },
    integrations: {
      track3r: tmsConfig?.integracao ? {
        status: tmsConfig.integracao.status,
        syncMode: tmsConfig.integracao.syncMode,
        lastSyncAt: tmsConfig.integracao.lastSyncAt || "",
        lastError: tmsConfig.integracao.lastError || "",
      } : null,
      ciot: ciotConfig?.integration || null,
      fiscal: fiscalProfile ? {
        status: fiscalProfile.certificadoStatus === "ativo" ? "ativa" : "configurar",
        document: fiscalProfile.cnpj || "",
        rntrc: fiscalProfile.rntrc || "",
        certificateStatus: fiscalProfile.certificadoStatus || "",
      } : null,
      api: {
        status: "ativa",
        basePath: "/api/tms/v1",
        documentationPath: "/api/tms/v1/openapi.json",
        activeKeys: activeApiKeys.length,
        keys: apiKeys,
        availableScopes: apiKeysData?.availableScopes || [],
      },
    },
    recent: {
      orders: orders.slice(0, 8),
      operations: operations.slice(0, 8),
      fiscal: fiscalDocuments.slice(0, 8),
      ciots: ciots.slice(0, 8),
    },
  };
}
