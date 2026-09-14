// ===== OCPP 1.6 · Camada de protocolo (P0 Green On + OCPP) =====
// Camada pura — codifica e valida mensagens OCPP 1.6-J (JSON, over WebSocket).
// Não abre WS, não fala com carregador — deixa isso para a integração
// (WebSocket próprio, Cloudflare Durable Object ou fila externa) que
// consome as funções `encodeXxx` / `parseXxx` deste módulo.
//
// Princípio central: OCPP tem TRÊS shapes de mensagem — CALL (2, uniqueId,
// action, payload), CALLRESULT (3, uniqueId, payload) e CALLERROR
// (4, uniqueId, errorCode, description, details). Este módulo faz a
// verificação estrita: aceitar mensagem malformada é o que trava CP no
// operador, e é caro consertar depois.
//
// Escopo desta primeira fatia: as 8 mensagens que a titular pediu no
// material (bloco 11 · gestão de carregador e bloco 09 · torre de controle).

// Tipos de mensagem OCPP JSON.
export const CALL = 2;
export const CALLRESULT = 3;
export const CALLERROR = 4;

// Ações CP-initiated (do carregador para o back-office).
export const ACTIONS_CP_INITIATED = Object.freeze([
  "BootNotification",
  "Authorize",
  "StartTransaction",
  "StopTransaction",
  "MeterValues",
  "StatusNotification",
  "Heartbeat",
]);
// Ações CSMS-initiated (back-office para o carregador).
export const ACTIONS_CSMS_INITIATED = Object.freeze([
  "RemoteStartTransaction",
  "RemoteStopTransaction",
  "UnlockConnector",
  "ChangeAvailability",
]);
export const ALL_ACTIONS = Object.freeze([...ACTIONS_CP_INITIATED, ...ACTIONS_CSMS_INITIATED]);

// Códigos de erro OCPP mais comuns — usados em CALLERROR e no retorno de
// autorizações.
export const OCPP_ERRORS = Object.freeze([
  "NotImplemented",
  "NotSupported",
  "InternalError",
  "ProtocolError",
  "SecurityError",
  "FormationViolation",
  "PropertyConstraintViolation",
  "OccurenceConstraintViolation",
  "TypeConstraintViolation",
  "GenericError",
]);

// Status de conector (OCPP 1.6 StatusNotification).
export const CONNECTOR_STATUS = Object.freeze([
  "Available",
  "Preparing",
  "Charging",
  "SuspendedEVSE",
  "SuspendedEV",
  "Finishing",
  "Reserved",
  "Unavailable",
  "Faulted",
]);

// Motivo de encerramento (OCPP 1.6 Reason).
export const STOP_REASONS = Object.freeze([
  "EmergencyStop",
  "EVDisconnected",
  "HardReset",
  "Local",
  "Other",
  "PowerLoss",
  "Reboot",
  "Remote",
  "SoftReset",
  "UnlockCommand",
  "DeAuthorized",
]);

// idTagInfo.status devolvido por Authorize/StartTransaction.
export const AUTH_STATUS = Object.freeze([
  "Accepted", "Blocked", "Expired", "Invalid", "ConcurrentTx",
]);

const isString = (v) => typeof v === "string" && v.length > 0;
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

// Faz o CALL enviável pelo WS. `uniqueId` deve ser único por conexão; o
// operador pode gerar com `crypto.randomUUID().slice(0, 12)` no borda.
export const encodeCall = (uniqueId, action, payload = {}) => {
  if (!isString(uniqueId)) throw new Error("uniqueId obrigatório.");
  if (!ALL_ACTIONS.includes(action)) throw new Error(`action desconhecida: ${action}`);
  return [CALL, uniqueId, action, payload];
};

export const encodeCallResult = (uniqueId, payload = {}) => {
  if (!isString(uniqueId)) throw new Error("uniqueId obrigatório.");
  return [CALLRESULT, uniqueId, payload];
};

export const encodeCallError = (uniqueId, errorCode, description = "", details = {}) => {
  if (!isString(uniqueId)) throw new Error("uniqueId obrigatório.");
  if (!OCPP_ERRORS.includes(errorCode)) throw new Error(`errorCode desconhecido: ${errorCode}`);
  return [CALLERROR, uniqueId, errorCode, String(description || ""), details];
};

// Parse tolerante — devolve `{ ok, kind, uniqueId, action?, payload?,
// errorCode?, description?, details? }`. Malformada devolve `{ ok:false,
// reason }` em vez de estourar.
export const parseMessage = (raw) => {
  let arr = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return { ok: false, reason: "JSON inválido." }; }
  }
  if (!Array.isArray(arr) || arr.length < 3) return { ok: false, reason: "Formato OCPP esperado é array." };
  const [type, uniqueId, third, fourth, fifth] = arr;
  if (![CALL, CALLRESULT, CALLERROR].includes(type)) return { ok: false, reason: `MessageTypeId inválido: ${type}` };
  if (!isString(uniqueId)) return { ok: false, reason: "uniqueId ausente." };
  if (type === CALL) {
    if (!ALL_ACTIONS.includes(third)) return { ok: false, reason: `action desconhecida: ${third}` };
    return { ok: true, kind: "call", uniqueId, action: third, payload: fourth || {} };
  }
  if (type === CALLRESULT) {
    return { ok: true, kind: "result", uniqueId, payload: third || {} };
  }
  // CALLERROR
  if (!OCPP_ERRORS.includes(third)) return { ok: false, reason: `errorCode desconhecido: ${third}` };
  return { ok: true, kind: "error", uniqueId, errorCode: third, description: fourth || "", details: fifth || {} };
};

// ---------- Validadores por ação (payload) ----------

export const validateBootNotification = (p = {}) => {
  const problemas = [];
  if (!isString(p.chargePointVendor)) problemas.push("chargePointVendor obrigatório.");
  if (!isString(p.chargePointModel)) problemas.push("chargePointModel obrigatório.");
  return problemas.length ? { ok: false, problemas } : { ok: true };
};

export const bootAcceptResponse = ({ interval = 300, currentTime = new Date().toISOString() } = {}) => ({
  status: "Accepted", currentTime, interval,
});

export const validateAuthorize = (p = {}) => {
  const problemas = [];
  if (!isString(p.idTag)) problemas.push("idTag obrigatório.");
  return problemas.length ? { ok: false, problemas } : { ok: true };
};

export const buildIdTagInfo = ({ status = "Accepted", expiryDate, parentIdTag } = {}) => {
  if (!AUTH_STATUS.includes(status)) throw new Error(`AUTH status inválido: ${status}`);
  const out = { status };
  if (expiryDate) out.expiryDate = expiryDate;
  if (parentIdTag) out.parentIdTag = parentIdTag;
  return out;
};

export const validateStartTransaction = (p = {}) => {
  const problemas = [];
  if (!isInt(p.connectorId) || p.connectorId <= 0) problemas.push("connectorId inteiro > 0.");
  if (!isString(p.idTag)) problemas.push("idTag obrigatório.");
  if (!isInt(p.meterStart)) problemas.push("meterStart inteiro (Wh).");
  if (!isString(p.timestamp)) problemas.push("timestamp ISO obrigatório.");
  return problemas.length ? { ok: false, problemas } : { ok: true };
};

export const validateStopTransaction = (p = {}) => {
  const problemas = [];
  if (!isInt(p.transactionId)) problemas.push("transactionId inteiro.");
  if (!isInt(p.meterStop)) problemas.push("meterStop inteiro (Wh).");
  if (!isString(p.timestamp)) problemas.push("timestamp ISO obrigatório.");
  if (p.reason && !STOP_REASONS.includes(p.reason)) problemas.push(`reason inválido: ${p.reason}`);
  return problemas.length ? { ok: false, problemas } : { ok: true };
};

export const validateMeterValues = (p = {}) => {
  const problemas = [];
  if (!isInt(p.connectorId)) problemas.push("connectorId inteiro.");
  if (!Array.isArray(p.meterValue) || p.meterValue.length === 0) problemas.push("meterValue array não-vazio.");
  return problemas.length ? { ok: false, problemas } : { ok: true };
};

export const validateStatusNotification = (p = {}) => {
  const problemas = [];
  if (!isInt(p.connectorId)) problemas.push("connectorId inteiro (0 = ponto todo).");
  if (!CONNECTOR_STATUS.includes(p.status)) problemas.push(`status inválido: ${p.status}`);
  if (!isString(p.errorCode)) problemas.push("errorCode obrigatório (use NoError).");
  return problemas.length ? { ok: false, problemas } : { ok: true };
};

// ---------- Uso pelo CSMS ----------

// Consumo energético da sessão a partir de MeterValues acumulados. Cada
// MeterValue tem `sampledValue[]` — pegamos o que mede "Energy.Active.Import.Register"
// em Wh. Devolve kWh já convertido, sem inventar se não houver leitura.
export const energyFromMeterValues = (meterValues = []) => {
  const leituras = [];
  for (const mv of Array.isArray(meterValues) ? meterValues : []) {
    for (const s of (mv?.sampledValue || [])) {
      const measurand = s.measurand || "Energy.Active.Import.Register";
      if (measurand !== "Energy.Active.Import.Register") continue;
      const unit = s.unit || "Wh";
      const val = Number(s.value);
      if (!Number.isFinite(val)) continue;
      const wh = unit === "kWh" ? val * 1000 : val;
      leituras.push({ ts: mv.timestamp || null, wh });
    }
  }
  if (leituras.length < 2) return null;
  leituras.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const primeira = leituras[0].wh;
  const ultima = leituras[leituras.length - 1].wh;
  const kwh = Math.max(0, (ultima - primeira) / 1000);
  return Math.round(kwh * 1000) / 1000;
};

// Fecha a sessão a partir de StopTransaction. `startTs`/`stopTs` são ISO;
// `meterStart`/`meterStop` são Wh. Devolve kWh entregues e minutos ligados.
export const closeTransaction = ({ meterStart, meterStop, startTs, stopTs, reason } = {}) => {
  if (!isInt(meterStart) || !isInt(meterStop)) return null;
  const wh = Math.max(0, meterStop - meterStart);
  const inicio = Date.parse(startTs || "");
  const fim = Date.parse(stopTs || "");
  const minutos = Number.isFinite(inicio) && Number.isFinite(fim) && fim > inicio
    ? Math.round((fim - inicio) / 60000)
    : null;
  return {
    kwh: Math.round((wh / 1000) * 1000) / 1000,
    minutos,
    reason: STOP_REASONS.includes(reason) ? reason : "Local",
  };
};

// Comandos CSMS-initiated prontos para encodeCall.
export const remoteStartPayload = ({ connectorId, idTag, chargingProfile }) => {
  if (!isString(idTag)) throw new Error("idTag obrigatório.");
  const out = { idTag };
  if (isInt(connectorId)) out.connectorId = connectorId;
  if (chargingProfile) out.chargingProfile = chargingProfile;
  return out;
};

export const remoteStopPayload = ({ transactionId }) => {
  if (!isInt(transactionId)) throw new Error("transactionId inteiro.");
  return { transactionId };
};

export const unlockConnectorPayload = ({ connectorId }) => {
  if (!isInt(connectorId) || connectorId <= 0) throw new Error("connectorId > 0.");
  return { connectorId };
};

export const changeAvailabilityPayload = ({ connectorId, type }) => {
  if (!isInt(connectorId)) throw new Error("connectorId inteiro (0 = ponto todo).");
  if (!["Operative", "Inoperative"].includes(type)) throw new Error("type Operative|Inoperative.");
  return { connectorId, type };
};

// Máquina de estado do conector: transições válidas segundo OCPP 1.6.
// Recebe estado atual e novo e diz se é aceitável (para o painel avisar
// quando o CP contradiz — indício de firmware ruim).
const TRANSICOES_VALIDAS = Object.freeze({
  Available: ["Preparing", "Reserved", "Unavailable", "Faulted"],
  Preparing: ["Charging", "SuspendedEV", "SuspendedEVSE", "Finishing", "Available", "Faulted"],
  Charging: ["SuspendedEV", "SuspendedEVSE", "Finishing", "Faulted"],
  SuspendedEV: ["Charging", "SuspendedEVSE", "Finishing", "Faulted"],
  SuspendedEVSE: ["Charging", "SuspendedEV", "Finishing", "Faulted"],
  Finishing: ["Available", "Faulted"],
  Reserved: ["Preparing", "Available", "Faulted"],
  Unavailable: ["Available", "Faulted"],
  Faulted: ["Available", "Unavailable"],
});

export const isValidStatusTransition = (from, to) => {
  if (!CONNECTOR_STATUS.includes(from) || !CONNECTOR_STATUS.includes(to)) return false;
  if (from === to) return true;
  return (TRANSICOES_VALIDAS[from] || []).includes(to);
};
