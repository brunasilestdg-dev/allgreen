import { describe, expect, it } from "vitest";
import {
  IMPLEMENTATION,
  SYSTEM_STATES,
  ambienteLabel,
  compararVersoes,
  deriveComponentState,
  derivarAmbiente,
  estadoGeral,
  montarRelatorioDeSaude,
  normalizarComponente,
  normalizarIntegracao,
  resumirEstados,
  systemStateLabel,
} from "./systemHealthDomain.js";

const DIA = 24 * 60 * 60 * 1000;

describe("estado de componente da plataforma", () => {
  it("binding ausente é NOT_CONFIGURED, nunca erro", () => {
    expect(deriveComponentState({ configured: false })).toBe(SYSTEM_STATES.NOT_CONFIGURED);
    expect(deriveComponentState({ configured: false, error: "x" })).toBe(SYSTEM_STATES.NOT_CONFIGURED);
  });

  it("falha no teste é ERROR (com ou sem mensagem)", () => {
    expect(deriveComponentState({ configured: true, ok: false })).toBe(SYSTEM_STATES.ERROR);
    expect(deriveComponentState({ configured: true, ok: false, error: "SQLITE_ERROR" })).toBe(SYSTEM_STATES.ERROR);
    expect(deriveComponentState({ configured: true, ok: null, error: "timeout" })).toBe(SYSTEM_STATES.ERROR);
  });

  it("contingência declarada é FALLBACK; terceiro pendente é EXTERNAL_DEPENDENCY", () => {
    expect(deriveComponentState({ configured: true, ok: true, fallback: true })).toBe(SYSTEM_STATES.FALLBACK);
    expect(deriveComponentState({ configured: true, ok: true, external: true })).toBe(SYSTEM_STATES.EXTERNAL_DEPENDENCY);
  });

  it("responde mas defasado é DEGRADED; íntegro é OPERATIONAL", () => {
    expect(deriveComponentState({ configured: true, ok: true, degraded: true })).toBe(SYSTEM_STATES.DEGRADED);
    expect(deriveComponentState({ configured: true, ok: true })).toBe(SYSTEM_STATES.OPERATIONAL);
    expect(deriveComponentState()).toBe(SYSTEM_STATES.OPERATIONAL);
  });

  it("estado explícito é respeitado ao normalizar (R2 em contingência)", () => {
    const r2 = normalizarComponente({ id: "r2", name: "Arquivos", state: "FALLBACK", detail: "sem bucket" });
    expect(r2.state).toBe(SYSTEM_STATES.FALLBACK);
    expect(r2.label).toBe("Contingência");
    expect(systemStateLabel("OPERATIONAL")).toBe("Operacional");
  });
});

describe("ambiente: LOCAL × PRÉVIA × PRODUÇÃO", () => {
  it("a variável do próprio Worker manda", () => {
    expect(derivarAmbiente({ override: "production", sha: "local" })).toBe("production");
    expect(derivarAmbiente({ override: " Staging " })).toBe("staging");
  });

  it("sem manifesto de build é local", () => {
    expect(derivarAmbiente({})).toBe("local");
    expect(derivarAmbiente({ sha: "local" })).toBe("local");
    expect(derivarAmbiente({ sha: "local-1757000000" })).toBe("local");
  });

  it("CI na main é produção; CI em outra branch é prévia", () => {
    expect(derivarAmbiente({ sha: "abc123", branch: "main", ci: "cloudflare-workers-builds" })).toBe("production");
    expect(derivarAmbiente({ sha: "abc123", branch: "feature/x", ci: "github-actions" })).toBe("preview");
  });

  it("publicação manual fora da main é marcada como manual, não como produção", () => {
    expect(derivarAmbiente({ sha: "abc123", branch: "main" })).toBe("production");
    expect(derivarAmbiente({ sha: "abc123", branch: "claude/x" })).toBe("manual");
    expect(ambienteLabel("manual")).toBe("Publicação manual");
    expect(ambienteLabel("production")).toBe("Produção");
    expect(ambienteLabel("")).toBe("Desconhecido");
  });
});

describe("comparação LOCAL × SERVIDOR × BANCO", () => {
  it("navegador com build diferente do servidor gera alerta de recarregar", () => {
    const r = compararVersoes({ clientSha: "aaa", serverSha: "bbb" });
    expect(r.clientMatchesServer).toBe(false);
    expect(r.alerts.map((a) => a.code)).toEqual(["CLIENT_SERVER_MISMATCH"]);
  });

  it("iguais: sem alerta; sem cliente: indeterminado, não falso", () => {
    expect(compararVersoes({ clientSha: "aaa", serverSha: "aaa" })).toMatchObject({ clientMatchesServer: true, alerts: [] });
    expect(compararVersoes({ serverSha: "aaa" }).clientMatchesServer).toBeNull();
  });

  it("backend novo com D1 antigo é ERRO nomeado — a raiz do zero-falso", () => {
    const r = compararVersoes({ expectedMigrations: 127, appliedMigrations: 126 });
    expect(r.migrationsInSync).toBe(false);
    expect(r.alerts[0]).toMatchObject({ code: "D1_BEHIND_CODE", severity: "error" });
    expect(r.alerts[0].message).toContain("127");
    expect(r.alerts[0].message).toContain("126");
  });

  it("D1 à frente do código é aviso (migration aplicada fora deste build)", () => {
    const r = compararVersoes({ expectedMigrations: 125, appliedMigrations: 126 });
    expect(r.alerts[0]).toMatchObject({ code: "D1_AHEAD_OF_CODE", severity: "warning" });
  });

  it("mesma contagem e última diferente também avisa", () => {
    const r = compararVersoes({
      expectedMigrations: 126, appliedMigrations: 126,
      expectedLastMigration: "0119_a", appliedLastMigration: "0119_b",
    });
    expect(r.migrationsInSync).toBe(false);
    expect(r.alerts[0].code).toBe("D1_LAST_MIGRATION_DIFFERS");
  });

  it("sem contagens não inventa sincronia nem alerta", () => {
    const r = compararVersoes({ expectedMigrations: null, appliedMigrations: 126 });
    expect(r.migrationsInSync).toBeNull();
    expect(r.alerts).toEqual([]);
  });
});

describe("integração: existir código não é estar conectada", () => {
  const agora = Date.parse("2026-09-13T12:00:00.000Z");

  it("NOT_IMPLEMENTED nunca aparece conectada, mesmo com flags mentirosas", () => {
    const r = normalizarIntegracao(
      { id: "ons", name: "ONS", group: "energia", implementation: "NOT_IMPLEMENTED", configured: true, authenticated: true, online: true, checkedAt: new Date(agora).toISOString() },
      { now: agora },
    );
    expect(r.state).toBe(SYSTEM_STATES.NOT_CONFIGURED);
    expect(r.implementation).toBe(IMPLEMENTATION.NOT_IMPLEMENTED);
    expect(r.implementationLabel).toBe("Não implementada");
  });

  it("configurada e nunca testada pede atenção com rótulo honesto", () => {
    const r = normalizarIntegracao({ id: "valhalla", configured: true, authenticated: true, online: false }, { now: agora });
    expect(r.state).toBe(SYSTEM_STATES.DEGRADED);
    expect(r.unverified).toBe(true);
    expect(r.label).toBe("Configurado, sem verificação");
  });

  it("teste bem-sucedido recente é OPERATIONAL com métricas preservadas", () => {
    const r = normalizarIntegracao(
      { id: "osrm", configured: true, authenticated: true, online: true, checkedAt: new Date(agora - 60_000).toISOString(), latencyMs: "120", recordsProcessed: 7 },
      { now: agora, staleMs: DIA },
    );
    expect(r.state).toBe(SYSTEM_STATES.OPERATIONAL);
    expect(r.unverified).toBe(false);
    expect(r.latencyMs).toBe(120);
    expect(r.recordsProcessed).toBe(7);
    expect(r.lastSuccessAt).toBe(new Date(agora - 60_000).toISOString());
  });

  it("último sucesso velho vira DEGRADED e marca stale", () => {
    const r = normalizarIntegracao(
      { id: "anp", configured: true, authenticated: true, online: true, lastSuccessAt: new Date(agora - 3 * DIA).toISOString(), checkedAt: new Date(agora - 3 * DIA).toISOString() },
      { now: agora, staleMs: DIA },
    );
    expect(r.state).toBe(SYSTEM_STATES.DEGRADED);
    expect(r.stale).toBe(true);
  });

  it("erro registrado é ERROR com lastErrorAt; contingência é FALLBACK", () => {
    const quando = new Date(agora).toISOString();
    const erro = normalizarIntegracao({ id: "track3r", configured: true, authenticated: true, online: false, error: "401", checkedAt: quando }, { now: agora });
    expect(erro.state).toBe(SYSTEM_STATES.ERROR);
    expect(erro.lastErrorAt).toBe(quando);
    const fb = normalizarIntegracao({ id: "vroom", configured: true, authenticated: true, online: false, fallbackActive: true }, { now: agora });
    expect(fb.state).toBe(SYSTEM_STATES.FALLBACK);
  });

  it("sem configuração é NOT_CONFIGURED (escolha, não falha)", () => {
    expect(normalizarIntegracao({ id: "syspag", configured: false }, { now: agora }).state).toBe(SYSTEM_STATES.NOT_CONFIGURED);
  });
});

describe("relatório e estado geral", () => {
  const base = {
    version: { environmentOverride: "production", serverSha: "d2396e44d8e4", clientSha: "d2396e44d8e4", branch: "main", expectedMigrations: 127, appliedMigrations: 127 },
    components: [
      { id: "worker", configured: true, ok: true },
      { id: "d1", configured: true, ok: true },
    ],
    integrations: [
      { id: "greenpay", configured: true, authenticated: true, online: true, checkedAt: "2026-09-13T11:59:00.000Z" },
      { id: "ons", implementation: "NOT_IMPLEMENTED" },
    ],
    now: Date.parse("2026-09-13T12:00:00.000Z"),
  };

  it("tudo íntegro é OPERATIONAL e integração não configurada não rebaixa o geral", () => {
    const r = montarRelatorioDeSaude(base);
    expect(r.overall).toBe(SYSTEM_STATES.OPERATIONAL);
    expect(r.version).toMatchObject({ environment: "production", environmentLabel: "Produção", clientMatchesServer: true, migrationsInSync: true });
    expect(r.alerts).toEqual([]);
    expect(r.summary.components.operational).toBe(2);
    expect(r.summary.integrations.notConfigured).toBe(1);
    expect(r.summary.integrations.operational).toBe(1);
    expect(r.checkedAt).toBe("2026-09-13T12:00:00.000Z");
  });

  it("D1 em erro derruba o geral para ERROR mesmo com integrações conectadas", () => {
    const r = montarRelatorioDeSaude({ ...base, components: [{ id: "worker", ok: true }, { id: "d1", configured: true, ok: false, error: "no such table" }] });
    expect(r.overall).toBe(SYSTEM_STATES.ERROR);
    expect(r.components.find((c) => c.id === "d1").state).toBe(SYSTEM_STATES.ERROR);
  });

  it("integração em erro com plataforma íntegra é DEGRADED", () => {
    expect(estadoGeral(
      [{ state: SYSTEM_STATES.OPERATIONAL }],
      [{ state: SYSTEM_STATES.ERROR }, { state: SYSTEM_STATES.NOT_CONFIGURED }],
    )).toBe(SYSTEM_STATES.DEGRADED);
  });

  it("D1 defasado gera alerta de erro e componente DEGRADED", () => {
    const r = montarRelatorioDeSaude({
      ...base,
      version: { ...base.version, expectedMigrations: 127, appliedMigrations: 125 },
      components: [{ id: "d1", configured: true, ok: true, degraded: true }],
    });
    expect(r.alerts.map((a) => a.code)).toContain("D1_BEHIND_CODE");
    expect(r.components[0].state).toBe(SYSTEM_STATES.DEGRADED);
    expect(r.overall).toBe(SYSTEM_STATES.DEGRADED);
  });

  it("resumo conta por estado", () => {
    const s = resumirEstados([{ state: "OPERATIONAL" }, { state: "DEGRADED" }, { state: "ERROR" }, { state: "NOT_CONFIGURED" }, { state: "FALLBACK" }]);
    expect(s).toMatchObject({ total: 5, operational: 1, attention: 2, broken: 1, notConfigured: 1 });
    expect(s.counts.FALLBACK).toBe(1);
  });
});
