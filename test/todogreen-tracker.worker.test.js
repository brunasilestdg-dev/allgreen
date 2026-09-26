import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../worker-entry.js";

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createUser(id, email) {
  const token = `tracker-token-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'hash', 'salt', ?)`,
  ).bind(id, `Pessoa ${id}`, email, now).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(`session-${id}`, id, await sha256(token), now).run();
  return { id, email, token };
}

const request = (path, { method = "GET", token, body, headers = {} } = {}) => {
  const finalHeaders = { ...headers };
  if (token) finalHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined) finalHeaders["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
};

let manager;
let integrationId;

beforeAll(async () => {
  manager = await createUser("tracker-manager", "operacao.tracker@todogreen.com.br");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
      (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'operations', 'active', '["read","fleet:manage","integration:manage"]', '', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), manager.email, manager.id, now, now).run();
});

describe("estrutura de integração com a Sistemas Tracker", () => {
  it("exige sessão para abrir a configuração", async () => {
    expect((await request("/api/todogreen/tracker")).status).toBe(401);
  });

  it("começa sem dados fictícios", async () => {
    const response = await request("/api/todogreen/tracker", { token: manager.token });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.integration).toBeNull();
    expect(data.summary).toEqual({
      linkedVehicles: 0,
      positions: 0,
      events: 0,
      latestPositionAt: "",
    });
  });

  it("recusa credencial enviada para o banco", async () => {
    const response = await request("/api/todogreen/tracker/config", {
      method: "PUT",
      token: manager.token,
      body: { token: "não-deve-ser-salvo" },
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/não são salvas no banco/i);
  });

  it("recusa URL interna para evitar chamadas indevidas", async () => {
    const response = await request("/api/todogreen/tracker/config", {
      method: "PUT",
      token: manager.token,
      body: {
        baseUrl: "http://localhost:3000",
        providerConfig: { vehiclesPath: "vehicles" },
      },
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/HTTPS pública/i);
  });

  it("salva apenas referências de configuração e nomes de segredos", async () => {
    const response = await request("/api/todogreen/tracker/config", {
      method: "PUT",
      token: manager.token,
      body: {
        name: "Sistemas Tracker",
        baseUrl: "https://tracker.example.com/api/",
        externalAccountId: "conta-teste",
        authMode: "bearer",
        tokenEnvKey: "TODOGREEN_TRACKER_API_TOKEN",
        webhookSecretEnvKey: "TODOGREEN_TRACKER_WEBHOOK_SECRET",
        syncMode: "manual",
        pollingIntervalMinutes: 60,
        providerConfig: {
          vehiclesPath: "v1/positions",
          collectionPath: "data.vehicles",
          fieldMap: { id: "vehicle.id", plate: "vehicle.plate" },
        },
      },
    });
    expect(response.status).toBe(201);
    const data = await response.json();
    integrationId = data.integration.id;
    expect(data.integration.status).toBe("ready");
    expect(data.integration.readOnly).toBe(true);
    expect(data.integration.tokenConfigured).toBe(false);
    expect(JSON.stringify(data)).not.toContain("não-deve-ser-salvo");
  });

  it("não tenta sincronizar sem segredo no cofre", async () => {
    const response = await request("/api/todogreen/tracker/sync", {
      method: "POST",
      token: manager.token,
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/TODOGREEN_TRACKER_API_TOKEN/);
  });

  it("não aceita webhook sem segredo de assinatura configurado", async () => {
    const response = await request(`/api/todogreen/tracker/webhook/${integrationId}`, {
      method: "POST",
      body: { id: "vehicle-1", latitude: -23.5, longitude: -46.7 },
      headers: { "x-tracker-signature": "sha256=invalid" },
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/TODOGREEN_TRACKER_WEBHOOK_SECRET/);
  });

  it("mantém a lista real vazia enquanto o fornecedor não enviar dados", async () => {
    const response = await request("/api/todogreen/tracker/vehicles", { token: manager.token });
    expect(response.status).toBe(200);
    expect((await response.json()).vehicles).toEqual([]);
  });
});

describe("ponte rastreador → operação", () => {
  it("carimba a última posição do tracker na operação em curso da mesma placa", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
       VALUES ('todogreen','todogreen','To Do Green','logistica','active','{}',?,?)`,
    ).bind(now, now).run();

    // Integração + link (placa TRK1A11) + última posição em SP.
    const intId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO todogreen_tracker_integrations (id, workspace_owner_id, provider, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, 'ponte-teste', ?, ?, ?, ?)`,
    ).bind(intId, manager.id, manager.id, manager.id, now, now).run();
    const linkId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO todogreen_tracker_vehicle_links (id, integration_id, workspace_owner_id, external_vehicle_id, plate, created_at, updated_at)
       VALUES (?, ?, ?, 'ext-1', 'TRK1A11', ?, ?)`,
    ).bind(linkId, intId, manager.id, now, now).run();
    await env.DB.prepare(
      `INSERT INTO todogreen_tracker_positions
         (id, integration_id, workspace_owner_id, vehicle_link_id, external_vehicle_id, latitude, longitude, recorded_at, received_at, raw_hash)
       VALUES (?, ?, ?, ?, 'ext-1', -23.5, -46.6, '2026-08-28T12:00:00Z', ?, ?)`,
    ).bind(crypto.randomUUID(), intId, manager.id, linkId, now, `hash-${crypto.randomUUID()}`).run();

    // Cliente + operação em curso na mesma placa (minúscula, para testar a normalização).
    const clienteId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO todogreen_clients (id, tenant_id, workspace_owner_id, name, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'Cliente Rota', ?, ?, ?, ?)`,
    ).bind(clienteId, manager.id, manager.id, manager.id, now, now).run();
    const opId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO todogreen_client_operations
         (id, tenant_id, client_id, workspace_owner_id, vehicle_plate, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, ?, 'trk1a11', ?, ?, ?, ?)`,
    ).bind(opId, clienteId, manager.id, manager.id, manager.id, now, now).run();

    const res = await request("/api/todogreen/tracker/sync-operations", { method: "POST", token: manager.token });
    expect(res.status).toBe(200);
    expect((await res.json()).operacoesAtualizadas).toBeGreaterThanOrEqual(1);

    const op = await env.DB.prepare("SELECT last_position_lat, last_position_lng, last_position_at FROM todogreen_client_operations WHERE id = ?").bind(opId).first();
    expect(op.last_position_lat).toBe(-23.5);
    expect(op.last_position_lng).toBe(-46.6);
    expect(op.last_position_at).toBe("2026-08-28T12:00:00Z");

    // Rodar de novo não re-carimba (a leitura não é mais nova): 0 atualizações.
    const res2 = await request("/api/todogreen/tracker/sync-operations", { method: "POST", token: manager.token });
    expect((await res2.json()).operacoesAtualizadas).toBe(0);
  });
});

describe("segredos do cofre que a integração pode ler", () => {
  // O token é lido do cofre e vai no cabeçalho para a `baseUrl` escolhida por
  // quem configura. Se o nome pudesse ser qualquer um, bastava apontar para
  // BREVO_API_KEY (ou o cofre das chaves de IA) e um host próprio para
  // receber o segredo no servidor de quem configurou.
  it("recusa apontar o token para um segredo que não é do rastreador", async () => {
    for (const tokenEnvKey of ["BREVO_API_KEY", "WORKSPACE_AI_VAULT_KEY", "TODOGREEN_TRACKER_WEBHOOK_SECRET"]) {
      const response = await request("/api/todogreen/tracker/config", {
        method: "PUT",
        token: manager.token,
        body: {
          name: "Sistemas Tracker",
          baseUrl: "https://tracker.example.com/api/",
          authMode: "bearer",
          tokenEnvKey,
          webhookSecretEnvKey: "TODOGREEN_TRACKER_WEBHOOK_SECRET",
          syncMode: "manual",
          providerConfig: { vehiclesPath: "v1/positions" },
        },
      });
      expect({ tokenEnvKey, status: response.status }).toEqual({ tokenEnvKey, status: 400 });
    }
  });

  it("config antiga que aponta para outro segredo não o envia para fora", async () => {
    await env.DB.prepare(
      "UPDATE todogreen_tracker_integrations SET token_env_key = 'BREVO_API_KEY' WHERE id = ?",
    ).bind(integrationId).run();
    const upstream = vi.spyOn(globalThis, "fetch");
    try {
      const response = await request("/api/todogreen/tracker/test", { method: "POST", token: manager.token });
      expect(response.status).toBe(422);
      expect((await response.json()).error).toMatch(/TODOGREEN_TRACKER_/);
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      upstream.mockRestore();
      await env.DB.prepare(
        "UPDATE todogreen_tracker_integrations SET token_env_key = 'TODOGREEN_TRACKER_API_TOKEN' WHERE id = ?",
      ).bind(integrationId).run();
    }
  });
});
