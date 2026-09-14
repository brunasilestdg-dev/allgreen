import { describe, it, expect } from "vitest";
import {
  CALL, CALLRESULT, CALLERROR,
  ACTIONS_CP_INITIATED, ACTIONS_CSMS_INITIATED,
  OCPP_ERRORS, CONNECTOR_STATUS, STOP_REASONS, AUTH_STATUS,
  encodeCall, encodeCallResult, encodeCallError, parseMessage,
  validateBootNotification, bootAcceptResponse,
  validateAuthorize, buildIdTagInfo,
  validateStartTransaction, validateStopTransaction,
  validateMeterValues, validateStatusNotification,
  energyFromMeterValues, closeTransaction,
  remoteStartPayload, remoteStopPayload, unlockConnectorPayload, changeAvailabilityPayload,
  isValidStatusTransition,
} from "./ocppProtocolDomain.js";

describe("ocppProtocolDomain", () => {
  it("declara as ações CP-initiated e CSMS-initiated do OCPP 1.6", () => {
    expect(ACTIONS_CP_INITIATED).toContain("BootNotification");
    expect(ACTIONS_CP_INITIATED).toContain("StartTransaction");
    expect(ACTIONS_CSMS_INITIATED).toContain("RemoteStartTransaction");
    expect(ACTIONS_CSMS_INITIATED).toContain("UnlockConnector");
    expect(Object.isFrozen(CONNECTOR_STATUS)).toBe(true);
  });

  it("encodeCall/parseMessage é round-trip", () => {
    const chamada = encodeCall("uid-1", "Heartbeat", {});
    expect(chamada[0]).toBe(CALL);
    const parsed = parseMessage(chamada);
    expect(parsed.ok).toBe(true);
    expect(parsed.kind).toBe("call");
    expect(parsed.action).toBe("Heartbeat");
    expect(parsed.uniqueId).toBe("uid-1");
  });

  it("encodeCallResult/parseMessage é round-trip com payload", () => {
    const r = encodeCallResult("uid-2", { currentTime: "2026-01-01T00:00:00Z" });
    expect(r[0]).toBe(CALLRESULT);
    const parsed = parseMessage(r);
    expect(parsed.kind).toBe("result");
    expect(parsed.payload.currentTime).toBe("2026-01-01T00:00:00Z");
  });

  it("encodeCallError recusa errorCode desconhecido; aceita padrão OCPP", () => {
    expect(() => encodeCallError("uid-3", "WeirdError")).toThrow(/errorCode desconhecido/);
    const err = encodeCallError("uid-3", "NotImplemented", "boot faltando", { hint: "" });
    expect(err[0]).toBe(CALLERROR);
    expect(OCPP_ERRORS).toContain(err[2]);
    const parsed = parseMessage(err);
    expect(parsed.kind).toBe("error");
    expect(parsed.errorCode).toBe("NotImplemented");
  });

  it("parseMessage devolve ok:false para JSON inválido e formato errado", () => {
    expect(parseMessage("nope").ok).toBe(false);
    expect(parseMessage([1, "uid", "?"]).ok).toBe(false);   // type inválido
    expect(parseMessage([2, "", "Heartbeat", {}]).ok).toBe(false); // uniqueId vazio
    expect(parseMessage([2, "uid", "NopeAction", {}]).ok).toBe(false); // ação desconhecida
  });

  it("validateBootNotification exige chargePointVendor e chargePointModel", () => {
    expect(validateBootNotification({}).ok).toBe(false);
    expect(validateBootNotification({ chargePointVendor: "TDG" }).ok).toBe(false);
    expect(validateBootNotification({ chargePointVendor: "TDG", chargePointModel: "V1" }).ok).toBe(true);
    const resp = bootAcceptResponse({ interval: 60 });
    expect(resp.status).toBe("Accepted");
    expect(resp.interval).toBe(60);
    expect(resp.currentTime).toBeTruthy();
  });

  it("buildIdTagInfo devolve status válido do OCPP; recusa desconhecido", () => {
    const info = buildIdTagInfo({ status: "Accepted", parentIdTag: "abc" });
    expect(AUTH_STATUS).toContain(info.status);
    expect(info.parentIdTag).toBe("abc");
    expect(() => buildIdTagInfo({ status: "WTF" })).toThrow();
  });

  it("validateStartTransaction e validateStopTransaction rejeitam campos faltando ou incorretos", () => {
    expect(validateStartTransaction({ connectorId: 1 }).ok).toBe(false);
    expect(validateStartTransaction({ connectorId: 1, idTag: "abc", meterStart: 0, timestamp: "2026-01-01T00:00:00Z" }).ok).toBe(true);
    expect(validateStartTransaction({ connectorId: 0, idTag: "abc", meterStart: 0, timestamp: "2026-01-01T00:00:00Z" }).ok).toBe(false);
    const badStop = validateStopTransaction({ transactionId: 1, meterStop: 100, timestamp: "2026-01-01T00:10:00Z", reason: "WTF" });
    expect(badStop.ok).toBe(false);
    const okStop = validateStopTransaction({ transactionId: 1, meterStop: 100, timestamp: "2026-01-01T00:10:00Z", reason: "Local" });
    expect(okStop.ok).toBe(true);
    expect(STOP_REASONS).toContain("Local");
  });

  it("validateStatusNotification aceita todos os status OCPP 1.6", () => {
    for (const st of CONNECTOR_STATUS) {
      const r = validateStatusNotification({ connectorId: 1, status: st, errorCode: "NoError" });
      expect(r.ok).toBe(true);
    }
    expect(validateStatusNotification({ connectorId: 1, status: "Wut", errorCode: "NoError" }).ok).toBe(false);
  });

  it("validateMeterValues exige array não-vazio", () => {
    expect(validateMeterValues({ connectorId: 1 }).ok).toBe(false);
    expect(validateMeterValues({ connectorId: 1, meterValue: [{ timestamp: "x" }] }).ok).toBe(true);
  });

  it("energyFromMeterValues diff da primeira/última leitura, converte kWh→Wh, ignora não-Energy", () => {
    const mvs = [
      { timestamp: "2026-01-01T00:00:00Z", sampledValue: [{ value: "1000", unit: "Wh" }] },
      { timestamp: "2026-01-01T00:05:00Z", sampledValue: [{ value: "10", unit: "kWh" }] },
    ];
    // último - primeiro = 10000 - 1000 = 9000 Wh = 9 kWh
    expect(energyFromMeterValues(mvs)).toBe(9);
    // sem 2 leituras válidas: null
    expect(energyFromMeterValues([mvs[0]])).toBeNull();
    // measurand não-Energy é ignorado
    const outros = [{ timestamp: "x", sampledValue: [{ value: "50", unit: "A", measurand: "Current.Import" }] }];
    expect(energyFromMeterValues(outros)).toBeNull();
  });

  it("closeTransaction devolve kWh e minutos ligados", () => {
    const r = closeTransaction({ meterStart: 1000, meterStop: 11000, startTs: "2026-01-01T00:00:00Z", stopTs: "2026-01-01T00:20:00Z", reason: "Remote" });
    expect(r.kwh).toBe(10);
    expect(r.minutos).toBe(20);
    expect(r.reason).toBe("Remote");
    // dados faltando: null
    expect(closeTransaction({ meterStart: 1000 })).toBeNull();
    // reason desconhecido: cai em "Local"
    expect(closeTransaction({ meterStart: 0, meterStop: 100, reason: "?" }).reason).toBe("Local");
  });

  it("remoteStartPayload/remoteStopPayload/unlockConnector/changeAvailability validam parâmetros", () => {
    expect(remoteStartPayload({ idTag: "abc" })).toEqual({ idTag: "abc" });
    expect(remoteStartPayload({ idTag: "abc", connectorId: 1 })).toEqual({ idTag: "abc", connectorId: 1 });
    expect(() => remoteStartPayload({})).toThrow();
    expect(remoteStopPayload({ transactionId: 42 })).toEqual({ transactionId: 42 });
    expect(() => remoteStopPayload({})).toThrow();
    expect(unlockConnectorPayload({ connectorId: 1 })).toEqual({ connectorId: 1 });
    expect(() => unlockConnectorPayload({ connectorId: 0 })).toThrow();
    expect(changeAvailabilityPayload({ connectorId: 0, type: "Inoperative" })).toEqual({ connectorId: 0, type: "Inoperative" });
    expect(() => changeAvailabilityPayload({ connectorId: 1, type: "WTF" })).toThrow();
  });

  it("isValidStatusTransition segue a máquina de estado do OCPP 1.6", () => {
    expect(isValidStatusTransition("Available", "Preparing")).toBe(true);
    expect(isValidStatusTransition("Charging", "Finishing")).toBe(true);
    // não pode pular direto de Available para Charging — precisa passar por Preparing
    expect(isValidStatusTransition("Available", "Charging")).toBe(false);
    // igual (no-op) é válido — CP pode reenviar o status atual
    expect(isValidStatusTransition("Charging", "Charging")).toBe(true);
    // Faulted permite voltar a Available (o CP pediu reset)
    expect(isValidStatusTransition("Faulted", "Available")).toBe(true);
    // valores fora do enum não passam
    expect(isValidStatusTransition("WTF", "Available")).toBe(false);
  });
});
