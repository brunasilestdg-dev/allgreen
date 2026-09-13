import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import {
  latestTodoGreenIntegrationHealth,
  recordTodoGreenIntegrationHealth,
} from "../worker/services/todogreen-integration-health.js";

// Saúde do sistema (P0 da consolidação): /api/system/version é público e sem
// segredo; /api/todogreen/system-health exige sessão + papel administrativo e
// devolve componentes/integrações com estado HONESTO — nunca "conectado" sem
// evidência, nunca zero no lugar de indisponível.

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function createUser(id, email, role, permissions) {
  const token = `health-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)")
    .bind(id, id, email, now).run();
  await env.DB.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)")
    .bind(`session-${id}`, id, await sha256(token), now).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
      (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,'active',?,'',?,?,?)`,
  ).bind(crypto.randomUUID(), email, role, JSON.stringify(permissions), id, now, now).run();
  return { id, email, token };
}

const call = (path, { method = "GET", token } = {}) => worker.fetch(
  new Request(`https://app.test${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }), env, { waitUntil() {}, passThroughOnException() {} },
);

let admin;
let seller;
let auditor;

beforeAll(async () => {
  admin = await createUser("health-admin", "health-admin@example.com", "admin", ["*"]);
  seller = await createUser("health-seller", "health-seller@example.com", "vendedor", ["read"]);
  auditor = await createUser("health-auditor", "health-auditor@example.com", "auditor", ["read", "audit:read"]);
});

describe("GET /api/system/version", () => {
  it("é público, identifica o build e não expõe segredo", async () => {
    const response = await call("/api/system/version");
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(typeof body.sha).toBe("string");
    expect(body.version).toBe(body.sha);
    expect(body).toHaveProperty("buildTime");
    expect(typeof body.environment).toBe("string");
    expect(body).toHaveProperty("checkedAt");
    // Sem assets publicados (ambiente de teste) o build é "local" — e diz isso.
    expect(body.sha).toBe("local");
    expect(body.environment).toBe("local");
    // Nenhum valor de variável secreta do ambiente de teste vaza na resposta.
    expect(text).not.toContain(env.VAPID_PRIVATE_KEY);
    expect(text).not.toContain(env.INBOUND_EMAIL_SECRET);
  });

  it("só aceita GET", async () => {
    expect((await call("/api/system/version", { method: "POST" })).status).toBe(405);
  });
});

describe("GET /api/todogreen/system-health", () => {
  it("exige sessão", async () => {
    expect((await call("/api/todogreen/system-health")).status).toBe(401);
  });

  it("vendedor sem papel administrativo recebe 403", async () => {
    expect((await call("/api/todogreen/system-health", { token: seller.token })).status).toBe(403);
  });

  it("auditor (audit:read) lê o relatório", async () => {
    expect((await call("/api/todogreen/system-health", { token: auditor.token })).status).toBe(200);
  });

  it("admin recebe componentes, integrações e comparação de versões — sem segredo", async () => {
    const response = await call("/api/todogreen/system-health?client=abc123def456", { token: admin.token });
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);

    expect(["OPERATIONAL", "DEGRADED", "FALLBACK", "ERROR"]).toContain(body.overall);
    expect(Array.isArray(body.alerts)).toBe(true);

    const componentes = Object.fromEntries(body.components.map((c) => [c.id, c]));
    expect(Object.keys(componentes)).toEqual(expect.arrayContaining(["worker", "app", "d1", "r2", "ai", "search"]));
    // D1 respondeu ao SELECT 1: operacional, com latência medida.
    expect(componentes.d1.state).toBe("OPERATIONAL");
    expect(typeof componentes.d1.latencyMs).toBe("number");
    // As migrations de teste são as mesmas do repositório: contagem conhecida.
    expect(body.version.appliedMigrations).toBeGreaterThanOrEqual(120);
    expect(body.version.appliedLastMigration).toMatch(/^\d{4}_/);
    // Sem manifesto de build no teste: servidor "local"; o cliente informado
    // não bate → alerta nomeado em vez de silêncio.
    expect(body.version.serverSha).toBe("local");
    expect(body.version.clientSha).toBe("abc123def456");
    expect(body.version.clientMatchesServer).toBe(false);
    expect(body.alerts.map((a) => a.code)).toContain("CLIENT_SERVER_MISMATCH");
    // Sem bucket R2 no teste: contingência declarada, não erro nem zero.
    expect(componentes.r2.state).toBe("FALLBACK");

    const integracoes = Object.fromEntries(body.integrations.map((i) => [i.id, i]));
    // Cliente real existe, mas sem URL o estado é NOT_CONFIGURED — e a linha
    // diz o que acontece com pesados enquanto isso (NO_SAFE_ROUTING_ENGINE).
    expect(integracoes.valhalla).toMatchObject({ state: "NOT_CONFIGURED", implementation: "REAL" });
    expect(integracoes.valhalla.detail).toContain("NO_SAFE_ROUTING_ENGINE");
    expect(integracoes.valhalla.requirement).toContain("TDG_VALHALLA_BASE_URL");
    // Não implementada nunca aparece conectada.
    for (const id of ["ons", "anp", "gdelt", "prf", "compras-gov", "postgis", "elevation"])
      expect(integracoes[id]).toMatchObject({ state: "NOT_CONFIGURED", implementation: "NOT_IMPLEMENTED" });
    // O que roda dentro do próprio Worker sobre o D1 é operacional.
    expect(integracoes.greenpay.state).toBe("OPERATIONAL");
    expect(integracoes["tms-api"].state).toBe("OPERATIONAL");
    // Repasse externo sem segredo: dormente, declarado.
    expect(integracoes.syspag).toMatchObject({ state: "NOT_CONFIGURED", implementation: "EXTERNAL" });
    // OSRM sem servidor próprio: contingência pelo endpoint público, declarada.
    expect(integracoes.osrm.state).toBe("FALLBACK");
    // PNCP só pela busca web: parcial em contingência.
    expect(integracoes.pncp).toMatchObject({ state: "FALLBACK", implementation: "PARTIAL" });

    // Grupos da seção 113 presentes.
    expect(body.groups.map((g) => g.id)).toEqual(expect.arrayContaining(["plataforma", "roteirizacao", "operacao", "energia", "pagamentos", "mercado", "risco"]));

    expect(text).not.toContain(env.VAPID_PRIVATE_KEY);
    expect(text).not.toContain(env.INBOUND_EMAIL_SECRET);
  });

  it("só aceita GET", async () => {
    expect((await call("/api/todogreen/system-health", { method: "POST", token: admin.token })).status).toBe(405);
  });
});

describe("métricas de integração (migration 0120)", () => {
  it("grava latência e volume e devolve último sucesso/falha por integração", async () => {
    const ownerId = admin.id;
    await recordTodoGreenIntegrationHealth(env, {
      ownerId, integrationId: "osrm", configured: true, authenticated: false, online: false,
      error: "timeout", checkedAt: "2026-09-13T10:00:00.000Z", latencyMs: 5000,
    });
    await recordTodoGreenIntegrationHealth(env, {
      ownerId, integrationId: "osrm", configured: true, authenticated: true, online: true,
      checkedAt: "2026-09-13T11:00:00.000Z", latencyMs: 123.6, recordsProcessed: 7,
    });
    const [osrm] = await latestTodoGreenIntegrationHealth(env, ownerId);
    expect(osrm).toMatchObject({
      integrationId: "osrm", online: true, latencyMs: 124, recordsProcessed: 7,
      lastSuccessAt: "2026-09-13T11:00:00.000Z", lastFailureAt: "2026-09-13T10:00:00.000Z",
    });
  });

  it("o relatório de saúde reflete o evento registrado (sem servidor próprio, segue em contingência declarada)", async () => {
    const response = await call("/api/todogreen/system-health", { token: admin.token });
    const body = await response.json();
    const osrm = body.integrations.find((i) => i.id === "osrm");
    expect(osrm.latencyMs).toBe(124);
    expect(osrm.recordsProcessed).toBe(7);
    expect(osrm.lastSuccessAt).toBe("2026-09-13T11:00:00.000Z");
    expect(osrm.lastErrorAt).toBe("2026-09-13T10:00:00.000Z");
    expect(osrm.state).toBe("FALLBACK");
  });
});
