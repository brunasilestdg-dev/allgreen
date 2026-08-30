import { paginacao, podeNaVertical, TENANT_ID } from "./todogreen-access.js";
import {
  canTransitionServiceOrder,
  precoUnitarioDaOs,
  serviceOrderAmounts,
  settlementState,
  validateAllocation,
} from "../../src/features/logistics/transactionalSpineDomain.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const allowed = (access, permission) =>
  podeNaVertical(access, permission) || podeNaVertical(access, "*");
const allowedAny = (access, permissions) => permissions.some((permission) => allowed(access, permission));
const canPlanOrder = (access) => allowedAny(access, ["planning:manage", "product:manage"]);
const canOperateOrder = (access) => allowedAny(access, ["operations:manage", "operation:manage"]);
const canManageCiot = (access) => allowedAny(access, ["ciot:manage", "planning:manage", "fiscal:manage", "finance:manage", "operations:manage"]);

// ===== Quem aponta o conector, e para onde =====
//
// Preparar e registrar CIOT é rotina de cinco papéis. Dizer PARA QUAL SERVIDOR
// o certificado digital vai, não é.
//
// A cada emissão o corpo enviado ao conector leva `pfxBase64` e a senha do
// certificado A1 — precisa levar, porque é o conector que assina. A validação
// da URL era só "começa com https://". Qualquer um dos cinco papéis podia
// apontar o conector para um servidor próprio e receber o certificado digital
// da empresa com a senha, em texto, na primeira emissão. Isso é a assinatura
// jurídica da To Do Green mudando de dono por um campo de formulário.
//
// Duas travas: só `ciot:manage` (ou owner/admin) escolhe o destino, e o destino
// precisa estar na lista de hosts que a titular cadastrou no cofre.
const canPointConnector = (access) => allowedAny(access, ["ciot:manage"]);

const connectorAllowedHosts = (env) => String(env.TODOGREEN_ANTT_CIOT_ALLOWED_HOSTS || "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

// Devolve a mensagem de recusa, ou "" quando a URL pode ser usada.
const connectorUrlRejection = (env, value) => {
  let url;
  try { url = new URL(String(value || "").trim()); }
  catch { return "Informe a URL HTTPS do conector CIOT."; }
  if (url.protocol !== "https:") return "A URL do conector CIOT precisa ser HTTPS.";
  const permitidos = connectorAllowedHosts(env);
  // Sem lista cadastrada o destino não é confiável, e o certificado não sai.
  // Falhar fechado aqui é a diferença entre "ainda não configuramos" e
  // "qualquer endereço serve".
  if (!permitidos.length)
    return "Nenhum host de conector foi autorizado. Cadastre TODOGREEN_ANTT_CIOT_ALLOWED_HOSTS no cofre antes de apontar o conector.";
  const host = url.hostname.toLowerCase();
  const liberado = permitidos.some((item) => host === item || host.endsWith(`.${item}`));
  return liberado ? "" : `O host ${host} não está entre os conectores autorizados.`;
};
// Um CIOT tem 12 dígitos — mas "12 dígitos" sozinho aceita coisas que a ANTT
// nunca emitiria. O conector, em modo de ensaio (`Connector:DryRun`), devolvia
// doze zeros; isso passava nesta validação e o ERP gravava `issued`, deixando um
// CIOT de teste indistinguível de um real no registro que a fiscalização olha.
// Sequência repetida não é código de CIOT: é carimbo de simulação ou de campo
// preenchido no automático.
const CIOT_RESERVADOS = new Set(["000000000000", "111111111111", "999999999999"]);
const ciotDirectCode = (value) => {
  const codigo = String(value || "").trim();
  return /^\d{12}$/.test(codigo) && !CIOT_RESERVADOS.has(codigo);
};

// O conector avisa quando respondeu sem falar com a ANTT. Aceitamos as duas
// grafias porque a resposta atravessa um processo externo que não controlamos.
const respostaSimulada = (payload) => {
  const fonte = object(payload);
  return fonte.simulated === true || fonte.dryRun === true
    || String(fonte.protocol || fonte.protocolo || "").toUpperCase().startsWith("DRYRUN");
};
const digitsOnly = (value) => String(value ?? "").replace(/\D/g, "");
const parseJson = (value) => {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
};
const envValue = (env, key) => key ? env[key] : "";
const TODO_GREEN_REGULATORY_PROFILE = Object.freeze({
  legalName: "TO DO TECNOLOGIA E SERVICOS LTDA",
  tradeName: "TO DO GREEN",
  document: "41.385.427/0001-32",
  rntrc: "054901444",
  rntrcCategory: "ETC",
  rntrcStatus: "ATIVO",
  rntrcCheckedAt: "2026-03-12",
  address: "Rua Quatá, 157 - Vila Olímpia - São Paulo/SP - CEP 04546-041",
  vehicles: ["STE-2B24", "SUH-7C24", "SWS-6I38", "TJA-1B60", "TJR-7D58", "TKU-7E76", "TLC-7I74", "TLK-9D50", "TAR-3I91", "TAR-5E78", "TAR-5E98", "TAS-0B35", "TAU-2I61"],
  insurance: [
    { type: "RCTR-C", policy: "10654660040013250000", limit: 1000000, validUntil: "2027-02-13" },
    { type: "RC-DC", policy: "10655660040009710000", limit: 1000000, validUntil: "2027-02-13" },
    { type: "RC-V", policy: "10654660040013250000", limit: 470000, validUntil: "2027-02-13" },
  ],
});
const bytesToBase64 = (bytes) => { let value = ""; for (let i = 0; i < bytes.length; i += 0x8000) value += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(value); };
const base64ToBytes = (value) => Uint8Array.from(atob(String(value || "")), (char) => char.charCodeAt(0));
async function ciotVaultKey(env) {
  const secret = String(env.TODOGREEN_CIOT_VAULT_KEY || env.SESSION_SECRET || "");
  if (secret.length < 32) throw new Error("Cofre CIOT indisponível: configure TODOGREEN_CIOT_VAULT_KEY.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptCiotCredential(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await ciotVaultKey(env), new TextEncoder().encode(JSON.stringify(value)));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}
async function decryptCiotCredential(env, row) {
  if (!row?.credential_ciphertext || !row?.credential_iv) return null;
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(row.credential_iv) }, await ciotVaultKey(env), base64ToBytes(row.credential_ciphertext));
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function ciotCodeFromResponse(payload) {
  const source = object(payload);
  const candidates = [
    source.ciotCode, source.ciot, source.codigoCiot, source.codigoCIOT, source.codigo,
    source.code, source.numeroCiot, source.numeroCIOT,
    object(source.data).ciotCode, object(source.data).codigoCiot, object(source.data).codigo,
    object(source.result).ciotCode, object(source.result).codigoCiot, object(source.result).codigo,
  ];
  return candidates.map(digitsOnly).find((value) => value.length === 12) || "";
}

function ciotProtocolFromResponse(payload) {
  const source = object(payload);
  return text(source.protocol || source.protocolo || object(source.data).protocol || object(source.data).protocolo || object(source.result).protocol || object(source.result).protocolo, 120);
}

async function reserveNumber(env, ownerId, docType, prefix, now) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_document_series
       (id,tenant_id,workspace_owner_id,doc_type,series,prefix,next_number,padding,created_at,updated_at)
     VALUES (?,?,?,?, '1',?,1,6,?,?)`,
  ).bind(crypto.randomUUID(), TENANT_ID, ownerId, docType, prefix, now, now).run();
  const row = await env.DB.prepare(
    `UPDATE todogreen_document_series SET next_number=next_number+1,updated_at=?
      WHERE tenant_id=? AND workspace_owner_id=? AND doc_type=? AND series='1'
      RETURNING prefix,next_number-1 AS value,padding`,
  ).bind(now, TENANT_ID, ownerId, docType).first();
  return `${row?.prefix || prefix}${String(row?.value || 1).padStart(row?.padding || 6, "0")}`;
}

const orderView = (row) => ({
  id: row.id, number: row.number, clientId: row.client_id, contractId: row.contract_id,
  operationId: row.operation_id, serviceId: row.service_id, priceTableId: row.price_table_id,
  status: row.status, requestedAt: row.requested_at, scheduledStartAt: row.scheduled_start_at,
  scheduledEndAt: row.scheduled_end_at, completedAt: row.completed_at,
  quantity: row.quantity, chargeUnit: row.charge_unit, unitPrice: row.unit_price,
  grossAmount: row.gross_amount, discountAmount: row.discount_amount, taxAmount: row.tax_amount,
  netAmount: row.net_amount, precoOrigem: parseJson(row.fields_json).precoOrigem || "",
  revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
});

const ciotView = (row) => ({
  id: row.id, number: row.number, serviceOrderId: row.service_order_id, operationId: row.operation_id,
  status: row.status, integrationMode: row.integration_mode, integrationEnvironment: row.integration_environment,
  ciotCode: row.ciot_code, protocol: row.protocol, operationType: row.operation_type,
  responsibleType: row.responsible_type, contractorDocument: row.contractor_document,
  carrierDocument: row.carrier_document, driverDocument: row.driver_document, vehiclePlate: row.vehicle_plate,
  originCity: row.origin_city, originState: row.origin_state, destinationCity: row.destination_city,
  destinationState: row.destination_state, cargoDescription: row.cargo_description,
  freightAmount: row.freight_amount, floorAmount: row.floor_amount, startsAt: row.starts_at,
  endsAt: row.ends_at, contingencyReason: row.contingency_reason,
  payload: parseJson(row.payload_json), response: parseJson(row.response_json), lastError: row.last_error,
  revision: row.revision, issuedAt: row.issued_at, closedAt: row.closed_at,
  serviceOrderNumber: row.service_order_number, createdAt: row.created_at, updatedAt: row.updated_at,
});

const ciotIntegrationView = (row, env = {}) => {
  if (!row) {
    const certificateEnvKey = "TODOGREEN_ANTT_CIOT_CERTIFICATE_PFX";
    const passwordEnvKey = "TODOGREEN_ANTT_CIOT_CERTIFICATE_PASSWORD";
    const connectorUrlEnvKey = "TODOGREEN_ANTT_CIOT_CONNECTOR_URL";
    const connectorTokenEnvKey = "TODOGREEN_ANTT_CIOT_CONNECTOR_TOKEN";
    return {
      mode: "direct_api",
      environment: "homologation",
      certificateType: "A1",
      certificateEnvKey,
      certificatePasswordEnvKey: passwordEnvKey,
      a3ConnectorEnvKey: "TODOGREEN_ANTT_CIOT_A3_CONNECTOR_URL",
      connectorUrlEnvKey,
      connectorTokenEnvKey,
      baseUrl: "",
      status: "draft",
      configured: false,
      requiresIpef: false,
      certificateConfigured: Boolean(env[certificateEnvKey] && env[passwordEnvKey]),
      connectorConfigured: Boolean(env[connectorUrlEnvKey]),
      a3ConnectorConfigured: false,
      revision: 0,
    };
  }
  const storedCredential = Boolean(row.credential_ciphertext && row.credential_iv);
  const config = parseJson(row.config_json);
  const connectorConfigured = Boolean(storedCredential || env[row.connector_url_env_key] || config.connectorUrl || (row.certificate_type === "A3" && (env[row.a3_connector_env_key] || config.a3ConnectorUrl)));
  const certificateConfigured = storedCredential || (row.certificate_type === "A1"
    ? Boolean(env[row.certificate_env_key] && env[row.certificate_password_env_key])
    : Boolean(env[row.a3_connector_env_key]));
  const configured = row.mode === "direct_api" && Boolean(row.base_url) && connectorConfigured && certificateConfigured;
  return {
    id: row.id,
    mode: row.mode,
    environment: row.environment,
    certificateType: row.certificate_type,
    certificateEnvKey: row.certificate_env_key,
    certificatePasswordEnvKey: row.certificate_password_env_key,
    a3ConnectorEnvKey: row.a3_connector_env_key,
    connectorUrlEnvKey: row.connector_url_env_key,
    connectorTokenEnvKey: row.connector_token_env_key,
    baseUrl: row.base_url,
    status: configured ? "ready" : row.status,
    configured,
    requiresIpef: false,
    certificateConfigured,
    connectorConfigured,
    a3ConnectorConfigured: row.certificate_type === "A3" && Boolean(storedCredential || env[row.a3_connector_env_key]),
    credentialFilename: row.credential_filename || "",
    credentialUploadedAt: row.credential_uploaded_at || "",
    lastTestAt: row.last_test_at,
    lastError: row.last_error,
    revision: row.revision,
  };
};

// Fechamento de período (todogreen_financial_periods): a trava já valia para
// os lançamentos do razão, mas faturamento e baixa passavam por fora — um mês
// "fechado" cujo faturamento ainda mudava não estava fechado.
async function competenciaFechada(env, ownerId, dataOuCompetencia) {
  const mes = String(dataOuCompetencia || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) return "";
  const row = await env.DB.prepare(
    `SELECT reference_month FROM todogreen_financial_periods
      WHERE tenant_id=? AND workspace_owner_id=? AND reference_month=? AND status='fechado'`,
  ).bind(TENANT_ID, ownerId, mes).first();
  return row ? mes : "";
}

async function contractInScope(env, ownerId, contractId, clientId) {
  return env.DB.prepare(
    `SELECT * FROM todogreen_contracts WHERE id=? AND tenant_id=? AND workspace_owner_id=?
      AND client_id=? AND archived_at IS NULL AND status NOT IN ('cancelled','draft')`,
  ).bind(contractId, TENANT_ID, ownerId, clientId).first();
}

async function serviceOrderInScope(env, ownerId, serviceOrderId) {
  if (!serviceOrderId) return null;
  return env.DB.prepare(
    "SELECT * FROM todogreen_service_orders WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL",
  ).bind(serviceOrderId, TENANT_ID, ownerId).first();
}

async function listOrders(env, access, url) {
  const { limit, offset } = paginacao(url);
  const status = text(url.searchParams.get("status"), 30);
  const contractId = text(url.searchParams.get("contractId"), 120);
  const filters = `${status ? "AND status=?" : ""} ${contractId ? "AND contract_id=?" : ""}`;
  const params = [TENANT_ID, access.ownerId, ...(status ? [status] : []), ...(contractId ? [contractId] : [])];
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_service_orders WHERE tenant_id=? AND workspace_owner_id=?
      AND archived_at IS NULL ${filters} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...params, limit, offset).all();
  return json({ records: (results || []).map(orderView), limit, offset });
}

async function createOrder(env, access, user, body) {
  if (!canPlanOrder(access)) return json({ error: "Somente Planejamento/Produtos pode criar ordem de serviço para aceite." }, 403);
  const clientId = text(body.clientId, 120);
  const contractId = text(body.contractId, 120);
  if (!clientId || !contractId) return json({ error: "Cliente e contrato são obrigatórios." }, 400);
  const contract = await contractInScope(env, access.ownerId, contractId, clientId);
  if (!contract) return json({ error: "Contrato ativo não encontrado neste espaço." }, 409);
  if (contract.approval_status !== "approved" || contract.signature_status !== "signed")
    return json({ error: "A ordem exige contrato aprovado e assinado." }, 409);

  // Preço herdado do aceite: quando não vem digitado, o contrato (valor
  // negociado) manda; na falta dele, o preço da simulação que gerou o contrato.
  // Assim a OS nasce do aceite sem redigitar o número que a régua já calculou.
  let simulacaoResult = null;
  if (!(Number(body.unitPrice) > 0) && contract.scenario_id) {
    const cenario = await env.DB.prepare(
      "SELECT result_json FROM pricing_scenarios WHERE id=? AND tenant_id=? AND workspace_owner_id=?",
    ).bind(contract.scenario_id, TENANT_ID, access.ownerId).first().catch(() => null);
    simulacaoResult = cenario ? parseJson(cenario.result_json) : null;
  }
  // O contrato marca no fields_json se o valor negociado é mensal (operação
  // dedicada) ou por unidade; a OS respeita isso para não multiplicar uma
  // mensalidade pela quantidade de viagens. Sem marca vale "mensal", a
  // semântica do próprio campo `monthly_value`.
  const contractFields = parseJson(contract.fields_json) || {};
  const { preco: precoHerdado, origem: origemPreco, modo: modoPreco } = precoUnitarioDaOs({
    unitPrice: body.unitPrice, contractValue: contract.monthly_value,
    contractPricingMode: contractFields.pricingMode, simulacaoResult,
  });

  const amounts = serviceOrderAmounts({ ...body, unitPrice: precoHerdado ?? 0, mode: modoPreco });
  if (!amounts.quantity) return json({ error: "Informe a quantidade da ordem de serviço." }, 400);
  if (!amounts.unitPrice) return json({ error: "Sem preço: informe o preço unitário ou gere a OS de um contrato com valor negociado ou simulação." }, 400);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const number = await reserveNumber(env, access.ownerId, "ordem_servico", "OS-", now);
  await env.DB.prepare(
    `INSERT INTO todogreen_service_orders
      (id,tenant_id,workspace_owner_id,number,client_id,contract_id,operation_id,service_id,
       price_table_id,status,requested_at,scheduled_start_at,scheduled_end_at,origin_json,
       destination_json,quantity,charge_unit,unit_price,gross_amount,discount_amount,tax_amount,
       net_amount,sla_json,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`,
  ).bind(
    id, TENANT_ID, access.ownerId, number, clientId, contractId, text(body.operationId, 120),
    text(body.serviceId || contract.service_id, 120), text(body.priceTableId || contract.price_table_id, 120),
    text(body.requestedAt, 40) || now, text(body.scheduledStartAt, 40) || null,
    text(body.scheduledEndAt, 40) || null, JSON.stringify(object(body.origin)),
    JSON.stringify(object(body.destination)), amounts.quantity, text(body.chargeUnit, 30),
    amounts.unitPrice, amounts.grossAmount, amounts.discountAmount, amounts.taxAmount, amounts.netAmount,
    JSON.stringify(object(body.sla || JSON.parse(contract.sla_json || "{}"))),
    JSON.stringify({ ...object(body.fields), precoOrigem: origemPreco, precoModo: modoPreco }), user.id, user.id, now, now,
  ).run();
  const row = await env.DB.prepare("SELECT * FROM todogreen_service_orders WHERE id=?").bind(id).first();
  return json({ record: orderView(row) }, 201);
}

async function transitionOrder(env, access, user, id, body) {
  const row = await env.DB.prepare(
    "SELECT * FROM todogreen_service_orders WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL",
  ).bind(id, TENANT_ID, access.ownerId).first();
  if (!row) return json({ error: "Ordem de serviço não encontrada." }, 404);
  const next = text(body.status, 30);
  if (!canTransitionServiceOrder(row.status, next))
    return json({ error: `Transição inválida de ${row.status} para ${next}.` }, 409);
  if (row.status === "draft" && next === "released" && !canPlanOrder(access))
    return json({ error: "Somente Planejamento/Produtos pode aceitar ou liberar a OS." }, 403);
  if (row.status !== "draft" && !canOperateOrder(access))
    return json({ error: "Somente Operação pode iniciar ou concluir a execução." }, 403);
  const revision = Number(body.revision);
  if (!Number.isFinite(revision) || revision !== row.revision) return json({ error: "A ordem mudou. Recarregue antes de salvar." }, 409);
  const now = new Date().toISOString();
  const completedAt = next === "completed" ? text(body.completedAt, 40) || now : row.completed_at;
  const statements = [env.DB.prepare(
    `UPDATE todogreen_service_orders SET status=?,completed_at=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`,
  ).bind(next, completedAt, user.id, now, id, TENANT_ID, access.ownerId, revision)];
  if (next === "completed") statements.push(env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_billing_items
      (id,tenant_id,workspace_owner_id,service_order_id,client_id,contract_id,status,amount,
       competence_date,created_by,updated_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'eligible',?,?,?,?,?,?)`,
  ).bind(crypto.randomUUID(), TENANT_ID, access.ownerId, id, row.client_id, row.contract_id,
    row.net_amount, completedAt.slice(0, 10), user.id, user.id, now, now));
  let results;
  try {
    results = await env.DB.batch(statements);
  } catch (error) {
    // O trigger da 0062 aborta o item faturável sem POD. Sem este catch o
    // usuário recebia um 500 opaco e a OS ficava presa sem explicação.
    if (String(error?.message || error).includes("POD_REQUIRED"))
      return json({
        error: "Registre o comprovante de entrega (POD) antes de concluir: sem ele a OS não vira item faturável. Use \"Registrar comprovante\" nesta tela ou o evento de entrega na operação.",
        code: "pod_required",
      }, 409);
    throw error;
  }
  // A checagem de `revision` acima não basta sob concorrência: dois PATCH que
  // leram a mesma revisão passam os dois, mas só o primeiro UPDATE casa a
  // linha. Sem conferir o `changes` do UPDATE, o segundo recebia 200 para uma
  // transição que não aplicou. A tesouraria já faz esta conferência.
  if (!results?.[0]?.meta?.changes)
    return json({ error: "A ordem mudou. Recarregue antes de salvar." }, 409);
  const updated = await env.DB.prepare("SELECT * FROM todogreen_service_orders WHERE id=?").bind(id).first();
  return json({ record: orderView(updated), billingEligible: next === "completed" });
}

// ---------------------------------------------------------------------------
// Comprovante de entrega (POD). É o dado que a régua de faturamento exige
// (trigger da 0062) e, até aqui, não tinha NENHUM caminho de escrita no
// produto: a tabela existia, o gate bloqueava, e a OS nunca faturava.
// ---------------------------------------------------------------------------

const podView = (row) => ({
  id: row.id, serviceOrderId: row.service_order_id, kind: row.kind,
  occurredAt: row.occurred_at, recipientName: row.recipient_name,
  documentUrl: row.document_url, documentHash: row.document_hash,
  latitude: row.latitude, longitude: row.longitude, createdAt: row.created_at,
});

async function listPods(env, access, serviceOrderId) {
  const order = await serviceOrderInScope(env, access.ownerId, serviceOrderId);
  if (!order) return json({ error: "Ordem de serviço não encontrada." }, 404);
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_proofs_of_delivery
      WHERE tenant_id=? AND workspace_owner_id=? AND service_order_id=?
      ORDER BY occurred_at DESC LIMIT 100`,
  ).bind(TENANT_ID, access.ownerId, serviceOrderId).all();
  return json({ records: (results || []).map(podView) });
}

async function createPod(env, access, user, serviceOrderId, body) {
  if (!canOperateOrder(access) && !canPlanOrder(access))
    return json({ error: "Somente Operação ou Planejamento registra comprovante de entrega." }, 403);
  const order = await serviceOrderInScope(env, access.ownerId, serviceOrderId);
  if (!order) return json({ error: "Ordem de serviço não encontrada." }, 404);
  const recipientName = text(body.recipientName ?? body.recebedor, 200);
  const documentUrl = text(body.documentUrl ?? body.comprovanteUrl, 800);
  if (!recipientName && !documentUrl)
    return json({ error: "Informe quem recebeu ou o link do comprovante — um dos dois é obrigatório." }, 400);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const statements = [env.DB.prepare(
    `INSERT INTO todogreen_proofs_of_delivery
       (id, tenant_id, workspace_owner_id, service_order_id, kind, occurred_at,
        recipient_name, document_url, document_hash, latitude, longitude,
        fields_json, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, TENANT_ID, access.ownerId, serviceOrderId, text(body.kind, 30) || "delivery",
    text(body.occurredAt, 40) || now, recipientName, documentUrl,
    text(body.documentHash ?? body.comprovanteHash, 200),
    Number.isFinite(latitude) ? latitude : null, Number.isFinite(longitude) ? longitude : null,
    JSON.stringify(object(body.fields)), user.id, now,
  )];
  // Espelha o comprovante na operação vinculada: é de lá que o portal do
  // cliente baixa o arquivo. Um comprovante em dois lugares seria dívida; um
  // comprovante que o cliente não encontra é pior.
  if (order.operation_id && documentUrl) statements.push(env.DB.prepare(
    `UPDATE todogreen_client_operations
        SET proof_url=?, proof_hash=?, delivered_at=COALESCE(delivered_at, ?),
            updated_at=?, updated_by=?, revision=revision+1
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
        AND COALESCE(proof_url,'')=''`,
  ).bind(documentUrl, text(body.documentHash ?? body.comprovanteHash, 200),
    text(body.occurredAt, 40) || now, now, user.id,
    order.operation_id, TENANT_ID, access.ownerId));
  await env.DB.batch(statements);
  const row = await env.DB.prepare("SELECT * FROM todogreen_proofs_of_delivery WHERE id=?").bind(id).first();
  return json({ record: podView(row) }, 201);
}

function ciotPayload(row, body, serviceOrder) {
  return {
    source: "todogreen-erp",
    integrationMode: "direct_api",
    requiresIpef: false,
    expectedGovernmentCode: "12_digits",
    certificate: {
      standard: "ICP-Brasil",
      type: body.certificateType || "A1/A3",
    },
    serviceOrderNumber: serviceOrder?.number || "",
    operationType: row.operationType,
    responsibleType: row.responsibleType,
    contractorDocument: row.contractorDocument,
    carrierDocument: row.carrierDocument,
    driverDocument: row.driverDocument,
    vehiclePlate: row.vehiclePlate,
    origin: { city: row.originCity, state: row.originState },
    destination: { city: row.destinationCity, state: row.destinationState },
    cargoDescription: row.cargoDescription,
    freightAmount: row.freightAmount,
    floorAmount: row.floorAmount,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    contingencyReason: row.contingencyReason,
    extra: object(body.fields),
  };
}

async function listCiot(env, access, url) {
  const status = text(url.searchParams.get("status"), 30);
  const params = [TENANT_ID, access.ownerId, ...(status ? [status] : [])];
  const { results } = await env.DB.prepare(
    `SELECT c.*,s.number AS service_order_number FROM todogreen_ciot_records c
      LEFT JOIN todogreen_service_orders s ON s.id=c.service_order_id
      WHERE c.tenant_id=? AND c.workspace_owner_id=? AND c.archived_at IS NULL
      ${status ? "AND c.status=?" : ""} ORDER BY c.created_at DESC`,
  ).bind(...params).all();
  return json({ records: (results || []).map(ciotView) });
}

async function getCiotIntegration(env, access) {
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_ciot_integrations
      WHERE tenant_id=? AND workspace_owner_id=? AND mode='direct_api' AND archived_at IS NULL
      ORDER BY updated_at DESC LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId).first();
  return json({ integration: ciotIntegrationView(row, env), regulatoryProfile: TODO_GREEN_REGULATORY_PROFILE });
}

async function saveCiotIntegration(env, access, user, body) {
  if (!canManageCiot(access)) return json({ error: "Sem permissão para configurar integração CIOT." }, 403);
  const current = await env.DB.prepare(
    `SELECT * FROM todogreen_ciot_integrations
      WHERE tenant_id=? AND workspace_owner_id=? AND mode='direct_api' AND archived_at IS NULL
      ORDER BY updated_at DESC LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId).first();
  const certificateType = ["A1", "A3"].includes(text(body.certificateType, 2).toUpperCase())
    ? text(body.certificateType, 2).toUpperCase()
    : "A1";
  const environment = ["production", "homologation"].includes(text(body.environment, 20))
    ? text(body.environment, 20)
    : "homologation";
  const baseUrl = text(body.baseUrl, 300);
  const certificateEnvKey = text(body.certificateEnvKey, 100) || "TODOGREEN_ANTT_CIOT_CERTIFICATE_PFX";
  const certificatePasswordEnvKey = text(body.certificatePasswordEnvKey, 100) || "TODOGREEN_ANTT_CIOT_CERTIFICATE_PASSWORD";
  const a3ConnectorEnvKey = text(body.a3ConnectorEnvKey, 100) || "TODOGREEN_ANTT_CIOT_A3_CONNECTOR_URL";
  const connectorUrlEnvKey = text(body.connectorUrlEnvKey, 100) || "TODOGREEN_ANTT_CIOT_CONNECTOR_URL";
  const connectorTokenEnvKey = text(body.connectorTokenEnvKey, 100) || "TODOGREEN_ANTT_CIOT_CONNECTOR_TOKEN";
  const now = new Date().toISOString();
  const connectorConfigured = Boolean(env[connectorUrlEnvKey] || (certificateType === "A3" && env[a3ConnectorEnvKey]));
  const certificateConfigured = certificateType === "A1"
    ? Boolean(env[certificateEnvKey] && env[certificatePasswordEnvKey])
    : Boolean(env[a3ConnectorEnvKey]);
  const status = baseUrl && connectorConfigured && certificateConfigured ? "ready" : "draft";
  if (current) {
    const revision = Number(body.revision);
    if (Number.isFinite(revision) && revision !== current.revision)
      return json({ error: "A configuração de CIOT mudou. Recarregue antes de salvar." }, 409);
    await env.DB.prepare(
      `UPDATE todogreen_ciot_integrations
        SET environment=?,certificate_type=?,certificate_env_key=?,certificate_password_env_key=?,
            a3_connector_env_key=?,connector_url_env_key=?,connector_token_env_key=?,
            base_url=?,status=?,config_json=?,revision=revision+1,updated_by=?,updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
    ).bind(
      environment, certificateType, certificateEnvKey, certificatePasswordEnvKey, a3ConnectorEnvKey,
      connectorUrlEnvKey, connectorTokenEnvKey, baseUrl, status, JSON.stringify(object(body.config)),
      user.id, now, current.id, TENANT_ID, access.ownerId,
    ).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO todogreen_ciot_integrations
        (id,tenant_id,workspace_owner_id,mode,environment,certificate_type,certificate_env_key,
         certificate_password_env_key,a3_connector_env_key,connector_url_env_key,connector_token_env_key,
         base_url,status,config_json,revision,created_by,updated_by,created_at,updated_at)
       VALUES (?,?,?,'direct_api',?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, access.ownerId, environment, certificateType, certificateEnvKey,
      certificatePasswordEnvKey, a3ConnectorEnvKey, connectorUrlEnvKey, connectorTokenEnvKey, baseUrl, status,
      JSON.stringify(object(body.config)), user.id, user.id, now, now,
    ).run();
  }
  const saved = await env.DB.prepare(
    `SELECT * FROM todogreen_ciot_integrations
      WHERE tenant_id=? AND workspace_owner_id=? AND mode='direct_api' AND archived_at IS NULL
      ORDER BY updated_at DESC LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId).first();
  return json({ integration: ciotIntegrationView(saved, env) }, current ? 200 : 201);
}

async function saveCiotCredential(env, access, user, body) {
  // Guardar o certificado E dizer para onde ele vai é a operação mais sensível
  // da vertical — não cabe nos cinco papéis do `canManageCiot`.
  if (!canPointConnector(access))
    return json({ error: "Só quem tem a permissão ciot:manage pode cadastrar o certificado e apontar o conector." }, 403);
  const row = await env.DB.prepare(`SELECT * FROM todogreen_ciot_integrations WHERE tenant_id=? AND workspace_owner_id=? AND mode='direct_api' AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1`).bind(TENANT_ID, access.ownerId).first();
  if (!row) return json({ error: "Salve primeiro a configuração da integração CIOT." }, 409);
  const certificateType = text(body.certificateType, 2).toUpperCase();
  const connectorUrl = text(body.connectorUrl, 500);
  const recusa = connectorUrlRejection(env, connectorUrl);
  if (recusa) return json({ error: recusa }, 400);
  let credential;
  let filename = "";
  if (certificateType === "A1") {
    const pfxBase64 = String(body.pfxBase64 || "").replace(/^data:.*;base64,/, "");
    if (!pfxBase64 || !body.password) return json({ error: "Selecione o arquivo A1 e informe a senha." }, 400);
    if (pfxBase64.length > 2_800_000) return json({ error: "O certificado excede o limite de 2 MB." }, 413);
    filename = text(body.filename, 180);
    if (!/\.(pfx|p12)$/i.test(filename)) return json({ error: "Envie um certificado .pfx ou .p12." }, 400);
    credential = { type: "A1", pfxBase64, password: String(body.password), connectorUrl, connectorToken: String(body.connectorToken || "") };
  } else if (certificateType === "A3") {
    credential = { type: "A3", connectorUrl, connectorToken: String(body.connectorToken || "") };
    filename = "Dispositivo A3";
  } else return json({ error: "Tipo de certificado inválido." }, 400);
  const encrypted = await encryptCiotCredential(env, credential);
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE todogreen_ciot_integrations SET certificate_type=?,credential_ciphertext=?,credential_iv=?,credential_filename=?,credential_uploaded_at=?,status='ready',revision=revision+1,updated_by=?,updated_at=? WHERE id=?`).bind(certificateType, encrypted.ciphertext, encrypted.iv, filename, now, user.id, now, row.id).run();
  const saved = await env.DB.prepare("SELECT * FROM todogreen_ciot_integrations WHERE id=?").bind(row.id).first();
  return json({ integration: ciotIntegrationView(saved, env) });
}

async function testCiotCredential(env, access) {
  if (!canManageCiot(access)) return json({ error: "Sem permissão para testar certificado CIOT." }, 403);
  const row = await env.DB.prepare(`SELECT * FROM todogreen_ciot_integrations WHERE tenant_id=? AND workspace_owner_id=? AND mode='direct_api' AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1`).bind(TENANT_ID, access.ownerId).first();
  const credential = await decryptCiotCredential(env, row).catch(() => null);
  if (!credential) return json({ error: "Credencial não encontrada ou não pôde ser aberta." }, 409);
  return json({ ok: true, certificateType: credential.type, filename: row.credential_filename, message: credential.type === "A1" ? "Certificado A1 armazenado e legível pelo cofre." : "Conector A3 configurado; a disponibilidade será validada na emissão." });
}

async function createCiot(env, access, user, body) {
  if (!canManageCiot(access)) return json({ error: "Sem permissão para preparar CIOT." }, 403);
  const serviceOrderId = text(body.serviceOrderId, 120);
  const serviceOrder = await serviceOrderInScope(env, access.ownerId, serviceOrderId);
  if (serviceOrderId && !serviceOrder) return json({ error: "OS não encontrada neste espaço." }, 404);
  const freightAmount = num(body.freightAmount || serviceOrder?.net_amount);
  const floorAmount = num(body.floorAmount);
  if (floorAmount > 0 && freightAmount < floorAmount)
    return json({ error: "CIOT bloqueado: valor do frete abaixo do piso mínimo informado." }, 409);
  const now = new Date().toISOString();
  const ciotCode = text(body.ciotCode, 80);
  if (ciotCode && !ciotDirectCode(ciotCode))
    return json({ error: "O código CIOT da integração direta deve ter 12 dígitos." }, 400);
  const contingencyReason = text(body.contingencyReason, 500);
  const status = ciotCode ? "issued" : contingencyReason ? "contingency" : "ready";
  const id = crypto.randomUUID();
  const number = `CIOT-PREP-${now.slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const row = {
    serviceOrderId, operationId: text(body.operationId || serviceOrder?.operation_id, 120),
    operationType: text(body.operationType, 50) || "carga_lotacao",
    responsibleType: text(body.responsibleType, 50) || "etc",
    contractorDocument: text(body.contractorDocument, 30),
    carrierDocument: text(body.carrierDocument, 30),
    driverDocument: text(body.driverDocument, 30),
    vehiclePlate: text(body.vehiclePlate, 10).toUpperCase(),
    originCity: text(body.originCity, 80),
    originState: text(body.originState, 2).toUpperCase(),
    destinationCity: text(body.destinationCity, 80),
    destinationState: text(body.destinationState, 2).toUpperCase(),
    cargoDescription: text(body.cargoDescription, 300),
    freightAmount, floorAmount,
    startsAt: text(body.startsAt || serviceOrder?.scheduled_start_at, 40),
    endsAt: text(body.endsAt || serviceOrder?.scheduled_end_at, 40),
    contingencyReason,
  };
  const payload = ciotPayload(row, body, serviceOrder);
  await env.DB.prepare(
    `INSERT INTO todogreen_ciot_records
      (id,tenant_id,workspace_owner_id,number,service_order_id,operation_id,status,integration_mode,integration_environment,ciot_code,protocol,
       operation_type,responsible_type,contractor_document,carrier_document,driver_document,vehicle_plate,
       origin_city,origin_state,destination_city,destination_state,cargo_description,freight_amount,floor_amount,
       starts_at,ends_at,contingency_reason,payload_json,response_json,last_error,revision,issued_at,created_by,updated_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`,
  ).bind(
    id, TENANT_ID, access.ownerId, number, serviceOrderId, row.operationId, status, "direct_api",
    text(body.environment, 20) || "homologation", ciotCode,
    text(body.protocol, 120), row.operationType, row.responsibleType, row.contractorDocument, row.carrierDocument,
    row.driverDocument, row.vehiclePlate, row.originCity, row.originState, row.destinationCity, row.destinationState,
    row.cargoDescription, freightAmount, floorAmount, row.startsAt, row.endsAt, row.contingencyReason,
    JSON.stringify(payload), JSON.stringify(object(body.response)), "", ciotCode ? now : null, user.id, user.id, now, now,
  ).run();
  const saved = await env.DB.prepare("SELECT * FROM todogreen_ciot_records WHERE id=?").bind(id).first();
  return json({ record: ciotView(saved) }, 201);
}

async function submitCiot(env, access, user, id, body) {
  if (!canManageCiot(access)) return json({ error: "Sem permissão para enviar CIOT." }, 403);
  const row = await env.DB.prepare(
    `SELECT c.*,s.number AS service_order_number FROM todogreen_ciot_records c
      LEFT JOIN todogreen_service_orders s ON s.id=c.service_order_id
      WHERE c.id=? AND c.tenant_id=? AND c.workspace_owner_id=? AND c.archived_at IS NULL`,
  ).bind(id, TENANT_ID, access.ownerId).first();
  if (!row) return json({ error: "CIOT não encontrado." }, 404);
  if (["issued", "cancelled"].includes(row.status)) return json({ error: "Este CIOT não pode ser reenviado." }, 409);
  const revision = Number(body.revision);
  if (!Number.isFinite(revision) || revision !== row.revision) return json({ error: "O CIOT mudou. Recarregue antes de enviar." }, 409);

  const integrationRow = await env.DB.prepare(
    `SELECT * FROM todogreen_ciot_integrations
      WHERE tenant_id=? AND workspace_owner_id=? AND mode='direct_api' AND archived_at IS NULL
      ORDER BY updated_at DESC LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId).first();
  const integration = ciotIntegrationView(integrationRow, env);
  if (!integrationRow || integration.mode !== "direct_api")
    return json({ error: "Configure a integração direta ANTT antes de enviar." }, 409);
  if (!integration.baseUrl)
    return json({ error: "Informe a Base URL ANTT da DCS antes de enviar." }, 409);

  const credential = await decryptCiotCredential(env, integrationRow).catch(() => null);
  const connectorUrl = text(credential?.connectorUrl || envValue(env, integration.connectorUrlEnvKey), 500) ||
    (integration.certificateType === "A3" ? text(envValue(env, integration.a3ConnectorEnvKey), 500) : "");
  if (!connectorUrl)
    return json({ error: `Configure ${integration.connectorUrlEnvKey || "TODOGREEN_ANTT_CIOT_CONNECTOR_URL"} no ambiente para acionar o conector direto.` }, 409);
  // Conferido de novo na hora do envio, e não só na hora de salvar: a URL pode
  // ter vindo de uma variável de ambiente trocada depois, e é agora que o
  // certificado sai daqui.
  const destinoRecusado = connectorUrlRejection(env, connectorUrl);
  if (destinoRecusado)
    return json({ error: `Envio bloqueado. ${destinoRecusado}` }, 409);
  if (!integration.certificateConfigured)
    return json({ error: "Configure o certificado ICP-Brasil A1/A3 no ambiente antes de enviar." }, 409);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_ciot_records SET status='sending',last_error='',revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`,
  ).bind(user.id, now, id, TENANT_ID, access.ownerId, revision).run();

  const connectorPayload = {
    mode: "direct_api",
    requiresIpef: false,
    environment: integration.environment,
    baseUrl: integration.baseUrl,
    certificate: {
      standard: "ICP-Brasil",
      type: integration.certificateType,
      certificateEnvKey: integration.certificateEnvKey,
      certificatePasswordEnvKey: integration.certificatePasswordEnvKey,
      a3ConnectorEnvKey: integration.a3ConnectorEnvKey,
      ...(credential?.type === "A1" ? { pfxBase64: credential.pfxBase64, password: credential.password } : {}),
    },
    ciot: parseJson(row.payload_json),
  };
  const headers = { "content-type": "application/json" };
  const token = text(credential?.connectorToken || envValue(env, integration.connectorTokenEnvKey), 500);
  if (token) headers.authorization = `Bearer ${token}`;

  let responsePayload = {};
  let responseOk = false;
  let responseStatus = 0;
  try {
    const response = await fetch(connectorUrl, { method: "POST", headers, body: JSON.stringify(connectorPayload) });
    responseStatus = response.status;
    const responseText = await response.text().catch(() => "");
    responsePayload = responseText ? parseJson(responseText) : {};
    if (responseText && !Object.keys(responsePayload).length) responsePayload = { text: responseText };
    responseOk = response.ok;
  } catch (error) {
    responsePayload = { error: error?.message || "Falha ao chamar o conector direto." };
  }

  const ciotCode = ciotCodeFromResponse(responsePayload);
  const protocol = ciotProtocolFromResponse(responsePayload);
  // Ensaio nunca vira emissão. `simulado` é status próprio justamente para
  // aparecer diferente na tela e no relatório — um CIOT de teste registrado
  // como emitido é o tipo de coisa que só se descobre numa fiscalização.
  const simulado = respostaSimulada(responsePayload);
  const finalStatus = simulado ? "simulado" : (responseOk && ciotCode ? "issued" : "failed");
  const error = finalStatus === "issued" || finalStatus === "simulado"
    ? ""
    : text(responsePayload.error || responsePayload.message || "Conector direto não retornou CIOT válido de 12 dígitos.", 500);
  const issuedAt = finalStatus === "issued" ? new Date().toISOString() : null;
  await env.DB.prepare(
    `UPDATE todogreen_ciot_records
      SET status=?,ciot_code=?,protocol=?,response_json=?,last_error=?,revision=revision+1,
          issued_at=COALESCE(?,issued_at),updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(
    finalStatus,
    // Código de ensaio não entra no campo do CIOT. Guardá-lo ali faria a tela,
    // o relatório e a exportação tratarem simulação como emissão.
    finalStatus === "simulado" ? row.ciot_code : (ciotCode || row.ciot_code),
    protocol || row.protocol,
    JSON.stringify({ status: responseStatus, ...object(responsePayload) }), error,
    issuedAt, user.id, new Date().toISOString(), id, TENANT_ID, access.ownerId,
  ).run();
  const updated = await env.DB.prepare(
    `SELECT c.*,s.number AS service_order_number FROM todogreen_ciot_records c
      LEFT JOIN todogreen_service_orders s ON s.id=c.service_order_id WHERE c.id=?`,
  ).bind(id).first();
  if (finalStatus === "simulado")
    return json({
      record: ciotView(updated),
      simulado: true,
      aviso: "O conector respondeu em modo de ensaio: nenhum CIOT foi emitido na ANTT. Desligue o modo de ensaio no servidor do conector antes de operar.",
    });
  return finalStatus === "issued"
    ? json({ record: ciotView(updated) })
    : json({ error, record: ciotView(updated) }, 502);
}

async function issueCiot(env, access, user, id, body) {
  if (!canManageCiot(access)) return json({ error: "Sem permissão para registrar CIOT." }, 403);
  const ciotCode = text(body.ciotCode, 80);
  if (!ciotCode) return json({ error: "Informe o código CIOT emitido." }, 400);
  if (!ciotDirectCode(ciotCode)) return json({ error: "O código CIOT da integração direta deve ter 12 dígitos." }, 400);
  const revision = Number(body.revision);
  const now = new Date().toISOString();
  const meta = await env.DB.prepare(
    `UPDATE todogreen_ciot_records SET status='issued',ciot_code=?,protocol=?,response_json=?,
      last_error='',revision=revision+1,issued_at=?,updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL AND revision=?`,
  ).bind(ciotCode, text(body.protocol, 120), JSON.stringify(object(body.response)), now, user.id, now, id, TENANT_ID, access.ownerId, revision).run();
  if (!meta?.meta?.changes) return json({ error: "CIOT não encontrado ou alterado por outra pessoa." }, 409);
  const updated = await env.DB.prepare("SELECT * FROM todogreen_ciot_records WHERE id=?").bind(id).first();
  return json({ record: ciotView(updated) });
}

async function listBilling(env, access, url) {
  const status = text(url.searchParams.get("status"), 30) || "eligible";
  const { results } = await env.DB.prepare(
    `SELECT b.*,s.number AS service_order_number FROM todogreen_billing_items b
      JOIN todogreen_service_orders s ON s.id=b.service_order_id
      WHERE b.tenant_id=? AND b.workspace_owner_id=? AND b.status=? ORDER BY b.competence_date,b.created_at`,
  ).bind(TENANT_ID, access.ownerId, status).all();
  return json({ records: results || [] });
}

async function checkBilling(env, access, user, id, body) {
  if (!allowed(access, "finance:manage")) return json({ error: "Sem permissão financeira." }, 403);
  const next = body.approved === false ? "blocked" : "checked";
  const meta = await env.DB.prepare(
    `UPDATE todogreen_billing_items SET status=?,block_reason=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND status IN ('eligible','blocked') AND revision=?`,
  ).bind(next, text(body.reason, 500), user.id, new Date().toISOString(), id, TENANT_ID, access.ownerId, Number(body.revision)).run();
  if (!meta?.meta?.changes) return json({ error: "Item não encontrado ou alterado por outra pessoa." }, 409);
  return json({ ok: true, status: next });
}

async function closeBilling(env, access, user, body) {
  if (!allowed(access, "finance:manage")) return json({ error: "Sem permissão financeira." }, 403);
  const ids = [...new Set((Array.isArray(body.itemIds) ? body.itemIds : []).map((id) => text(id, 120)).filter(Boolean))];
  if (!ids.length) return json({ error: "Selecione itens conferidos." }, 400);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_billing_items WHERE tenant_id=? AND workspace_owner_id=?
      AND id IN (${placeholders}) AND status='checked'`,
  ).bind(TENANT_ID, access.ownerId, ...ids).all();
  const items = results || [];
  if (items.length !== ids.length) return json({ error: "Todos os itens precisam estar conferidos e no mesmo espaço." }, 409);
  const clients = new Set(items.map((item) => item.client_id));
  if (clients.size !== 1) return json({ error: "Um fechamento pode conter apenas um cliente." }, 400);
  const amount = items.reduce((sum, item) => sum + num(item.amount), 0);
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const invoiceId = crypto.randomUUID();
  const titleId = crypto.randomUUID();
  const runNumber = `FAT-${now.slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const documentType = ["cte", "nfse", "nfe"].includes(text(body.documentType, 20)) ? text(body.documentType, 20) : "cte";
  const documentPrefix = { cte: "CTE-", nfse: "NFSE-", nfe: "NFE-" }[documentType];
  const invoiceNumber = await reserveNumber(env, access.ownerId, documentType, documentPrefix, now);
  const titleNumber = await reserveNumber(env, access.ownerId, "titulo", "REC-", now);
  const dueDate = text(body.dueDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return json({ error: "Informe o vencimento do título." }, 400);
  const competence = text(body.competenceDate, 10) || items[0].competence_date;
  const mesFechado = await competenciaFechada(env, access.ownerId, competence);
  if (mesFechado)
    return json({ error: `O período ${mesFechado} está fechado na Tesouraria. Fature em competência aberta ou reabra o período com justificativa.` }, 409);
  const contractId = new Set(items.map((item) => item.contract_id)).size === 1 ? items[0].contract_id : "";
  const statements = [
    env.DB.prepare(`INSERT INTO todogreen_billing_runs
      (id,tenant_id,workspace_owner_id,number,client_id,contract_id,status,competence_date,gross_amount,net_amount,closed_by,closed_at)
      VALUES (?,?,?,?,?,?,'closed',?,?,?,?,?)`).bind(runId,TENANT_ID,access.ownerId,runNumber,items[0].client_id,contractId,competence,amount,amount,user.id,now),
    env.DB.prepare(`INSERT INTO todogreen_invoices
      (id,tenant_id,workspace_owner_id,billing_run_id,number,series,document_type,status,issued_at,amount,created_by,created_at)
      VALUES (?,?,?,?,?,'1',?,'issued',?,?,?,?)`).bind(invoiceId,TENANT_ID,access.ownerId,runId,invoiceNumber,documentType,now,amount,user.id,now),
    env.DB.prepare(`INSERT INTO todogreen_financial_titles
      (id,tenant_id,workspace_owner_id,number,kind,client_id,contract_id,billing_run_id,invoice_id,
       competence_date,issue_date,due_date,original_amount,open_amount,status,created_by,updated_by,created_at,updated_at)
      VALUES (?,?,?,?,'receivable',?,?,?,?,?,?,?,?,?,'open',?,?,?,?)`).bind(titleId,TENANT_ID,access.ownerId,titleNumber,items[0].client_id,contractId,runId,invoiceId,competence,now.slice(0,10),dueDate,amount,amount,user.id,user.id,now,now),
    env.DB.prepare(`UPDATE todogreen_billing_items SET status='billed',billing_run_id=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE tenant_id=? AND workspace_owner_id=? AND id IN (${placeholders}) AND status='checked'`).bind(runId,user.id,now,TENANT_ID,access.ownerId,...ids),
  ];
  await env.DB.batch(statements);
  return json({ billingRunId: runId, invoiceId, invoiceNumber, documentType, titleId, titleNumber, amount }, 201);
}

async function listTitles(env, access, url) {
  const kind = text(url.searchParams.get("kind"), 20);
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_titles WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
      ${kind ? "AND kind=?" : ""} ORDER BY due_date,created_at`,
  ).bind(TENANT_ID, access.ownerId, ...(kind ? [kind] : [])).all();
  return json({ records: results || [] });
}

async function settleTitle(env, access, user, id, body) {
  if (!allowed(access, "finance:manage")) return json({ error: "Sem permissão financeira." }, 403);
  const row = await env.DB.prepare(
    "SELECT * FROM todogreen_financial_titles WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL",
  ).bind(id,TENANT_ID,access.ownerId).first();
  if (!row) return json({ error: "Título não encontrado." }, 404);
  if (!["open","partial","overdue"].includes(row.status)) return json({ error: "Este título não aceita baixa." }, 409);
  // Baixa move o caixa do razão pela ponte: não pode furar um mês já fechado.
  const mesFechado = await competenciaFechada(env, access.ownerId, row.competence_date);
  if (mesFechado)
    return json({ error: `O período ${mesFechado} está fechado na Tesouraria. Reabra o período com justificativa para dar baixa.` }, 409);
  const state = settlementState(row.open_amount, body.amount);
  if (!state.valid) return json({ error: state.error }, 400);
  const now = new Date().toISOString();
  const settlementId = crypto.randomUUID();
  // Trava otimista: o UPDATE só passa se o saldo em aberto ainda for o que
  // lemos. Duas baixas simultâneas (ou uma baixa pela tela transacional e outra
  // pelo razão) leem o mesmo open_amount; a segunda encontra 0 linhas afetadas
  // e é recusada, em vez de somar pagamento em dobro (lost update).
  const upd = await env.DB.prepare(
    `UPDATE todogreen_financial_titles SET open_amount=?,status=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND open_amount=? AND status IN ('open','partial','overdue')`,
  ).bind(state.remaining,state.status,user.id,now,id,TENANT_ID,access.ownerId,row.open_amount).run();
  if (!upd.meta?.changes)
    return json({ error: "O título mudou desde que a tela carregou (baixa concorrente). Recarregue e tente de novo." }, 409);
  await env.DB.prepare(`INSERT INTO todogreen_settlements
    (id,tenant_id,workspace_owner_id,title_id,amount,settled_at,method,bank_account_id,reference,notes,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(settlementId,TENANT_ID,access.ownerId,id,num(body.amount),text(body.settledAt,40)||now,text(body.method,50),text(body.bankAccountId,120),text(body.reference,120),text(body.notes,500),user.id,now).run();
  return json({ settlementId, openAmount: state.remaining, status: state.status }, 201);
}

async function createCost(env, access, user, body) {
  if (!allowed(access, "finance:manage")) return json({ error: "Sem permissão financeira." }, 403);
  const amount = Math.max(0, num(body.amount));
  const validation = validateAllocation(amount, body.allocations);
  if (!validation.valid) return json({ error: validation.error }, 400);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const allocations = body.allocations.map((item) => ({ ...item, id: crypto.randomUUID() }));
  const statements = [env.DB.prepare(`INSERT INTO todogreen_cost_entries
    (id,tenant_id,workspace_owner_id,description,amount,competence_date,supplier_id,purchase_order_id,
     financial_title_id,document_number,fields_json,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,TENANT_ID,access.ownerId,text(body.description,300),amount,text(body.competenceDate,10),text(body.supplierId,120),text(body.purchaseOrderId,120),text(body.financialTitleId,120),text(body.documentNumber,80),JSON.stringify(object(body.fields)),user.id,now)];
  for (const item of allocations) statements.push(env.DB.prepare(`INSERT INTO todogreen_cost_allocations
    (id,tenant_id,workspace_owner_id,cost_entry_id,service_order_id,operation_id,client_id,contract_id,
     vehicle_id,supplier_id,cost_center_id,amount,percentage,rule,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(item.id,TENANT_ID,access.ownerId,id,text(item.serviceOrderId,120),text(item.operationId,120),text(item.clientId,120),text(item.contractId,120),text(item.vehicleId,120),text(item.supplierId||body.supplierId,120),text(item.costCenterId,120),num(item.amount),amount ? num(item.amount)/amount*100 : 0,text(item.rule,50)||"manual",user.id,now));
  await env.DB.batch(statements);
  return json({ costEntryId: id, amount, allocations: allocations.map((item) => item.id) }, 201);
}

async function listCosts(env, access, url) {
  const { limit, offset } = paginacao(url);
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_cost_entries WHERE tenant_id=? AND workspace_owner_id=?
      ORDER BY competence_date DESC,created_at DESC LIMIT ? OFFSET ?`,
  ).bind(TENANT_ID, access.ownerId, limit, offset).all();
  const records = [];
  for (const row of results || []) {
    const allocationRows = await env.DB.prepare(
      `SELECT * FROM todogreen_cost_allocations WHERE tenant_id=? AND workspace_owner_id=?
        AND cost_entry_id=? ORDER BY created_at,id`,
    ).bind(TENANT_ID, access.ownerId, row.id).all();
    records.push({ ...row, allocations: allocationRows.results || [] });
  }
  return json({ records, limit, offset });
}

export async function handleTodoGreenTransactions(request, env, access, user) {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/todogreen\/transactions\/?/, "").split("/").filter(Boolean);
  const [resource, id, action] = parts;
  let body = {};
  if (!["GET","HEAD"].includes(request.method)) body = await request.json().catch(() => ({}));

  if (resource === "service-orders" && request.method === "GET" && !id) return listOrders(env, access, url);
  if (resource === "service-orders" && request.method === "POST" && !id) return createOrder(env, access, user, body);
  if (resource === "service-orders" && request.method === "POST" && id && action === "transition") return transitionOrder(env, access, user, id, body);
  if (resource === "service-orders" && request.method === "GET" && id && action === "pod") return listPods(env, access, id);
  if (resource === "service-orders" && request.method === "POST" && id && action === "pod") return createPod(env, access, user, id, body);
  if (resource === "ciot-integration" && request.method === "GET" && !id) return getCiotIntegration(env, access);
  if (resource === "ciot-integration" && request.method === "POST" && !id) return saveCiotIntegration(env, access, user, body);
  if (resource === "ciot-certificate" && request.method === "POST" && !id) return saveCiotCredential(env, access, user, body);
  if (resource === "ciot-certificate" && request.method === "POST" && id === "test") return testCiotCredential(env, access);
  if (resource === "ciot" && request.method === "GET" && !id) return listCiot(env, access, url);
  if (resource === "ciot" && request.method === "POST" && !id) return createCiot(env, access, user, body);
  if (resource === "ciot" && request.method === "POST" && id && action === "submit") return submitCiot(env, access, user, id, body);
  if (resource === "ciot" && request.method === "POST" && id && action === "issue") return issueCiot(env, access, user, id, body);
  if (resource === "billing-items" && request.method === "GET") return listBilling(env, access, url);
  if (resource === "billing-items" && request.method === "POST" && id && action === "check") return checkBilling(env, access, user, id, body);
  if (resource === "billing-runs" && request.method === "POST" && !id) return closeBilling(env, access, user, body);
  if (resource === "titles" && request.method === "GET" && !id) return listTitles(env, access, url);
  if (resource === "titles" && request.method === "POST" && id && action === "settle") return settleTitle(env, access, user, id, body);
  if (resource === "costs" && request.method === "GET" && !id) return listCosts(env, access, url);
  if (resource === "costs" && request.method === "POST" && !id) return createCost(env, access, user, body);
  return json({ error: "Rota transacional não encontrada." }, 404);
}
