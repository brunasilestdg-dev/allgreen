import { describe, expect, it } from "vitest";
import {
  deriveIntegrationStatus, summarizeIntegrations, integrationStateLabel, INTEGRATION_STATES,
} from "./integrationStatusDomain.js";

const now = Date.parse("2026-09-13T12:00:00Z");

describe("estado canônico de integração", () => {
  it("sem configuração → NOT_CONFIGURED", () => {
    expect(deriveIntegrationStatus({ configured: false }, { now }).state).toBe(INTEGRATION_STATES.NOT_CONFIGURED);
  });
  it("configurado, autenticado e online recente → CONNECTED", () => {
    const s = deriveIntegrationStatus({ configured: true, authenticated: true, online: true, checkedAt: "2026-09-13T11:59:00Z" }, { now, staleMs: 3600000 });
    expect(s.state).toBe(INTEGRATION_STATES.CONNECTED);
    expect(s.stale).toBe(false);
  });
  it("configurado mas sem autenticar (sem erro) → EXTERNAL_DEPENDENCY", () => {
    expect(deriveIntegrationStatus({ configured: true, authenticated: false }, { now }).state).toBe(INTEGRATION_STATES.EXTERNAL_DEPENDENCY);
  });
  it("configurado com erro e offline → ERROR", () => {
    expect(deriveIntegrationStatus({ configured: true, authenticated: true, online: false, error: "timeout" }, { now }).state).toBe(INTEGRATION_STATES.ERROR);
  });
  it("fallback ativo → FALLBACK (mesmo autenticado)", () => {
    expect(deriveIntegrationStatus({ configured: true, authenticated: true, online: true, fallbackActive: true }, { now }).state).toBe(INTEGRATION_STATES.FALLBACK);
  });
  it("autenticado mas offline agora → DEGRADED", () => {
    expect(deriveIntegrationStatus({ configured: true, authenticated: true, online: false }, { now }).state).toBe(INTEGRATION_STATES.DEGRADED);
  });
  it("online porém dado velho → DEGRADED + stale", () => {
    const s = deriveIntegrationStatus({ configured: true, authenticated: true, online: true, lastSuccessAt: "2026-09-10T00:00:00Z" }, { now, staleMs: 3600000 });
    expect(s.state).toBe(INTEGRATION_STATES.DEGRADED);
    expect(s.stale).toBe(true);
    expect(s.ageMs).toBeGreaterThan(3600000);
  });
});

describe("panorama de integrações", () => {
  it("conta por estado e classifica saudável/atenção/quebrado", () => {
    const r = summarizeIntegrations([
      { integrationId: "a", configured: true, authenticated: true, online: true, checkedAt: "2026-09-13T11:59:00Z" },
      { integrationId: "b", configured: false },
      { integrationId: "c", configured: true, authenticated: true, online: false, error: "500" },
      { integrationId: "d", configured: true, authenticated: true, online: true, fallbackActive: true },
    ], { now, staleMs: 3600000 });
    expect(r.total).toBe(4);
    expect(r.healthy).toBe(1);
    expect(r.notConfigured).toBe(1);
    expect(r.broken).toBe(1);
    expect(r.attention).toBe(1); // fallback
  });
});

describe("rótulos", () => {
  it("traduz para pt-BR", () => {
    expect(integrationStateLabel("CONNECTED")).toBe("Conectado");
    expect(integrationStateLabel("NOT_CONFIGURED")).toBe("Não configurado");
  });
});
