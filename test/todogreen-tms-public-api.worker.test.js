import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { handlePublicTodoGreenTmsApi } from "../worker/services/todogreen-public-tms-api.js";

const json = async (response) => ({ status: response.status, body: await response.json(), headers: response.headers });

async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seedOwnerAndApiKey(suffix, scopes) {
  const ownerId = `tms-api-owner-${suffix}`;
  const clientId = `tms-api-client-${suffix}`;
  const keyId = `tms-api-key-${suffix}`;
  const token = `tdg_live_${suffix}_0123456789abcdef0123456789`;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO users (id,name,email,password_hash,password_salt,created_at)
     VALUES (?,?,?,'hash','salt',?)`,
  ).bind(ownerId, `Owner ${suffix}`, `${suffix}@tms-api.test`, now).run();

  await env.DB.prepare(
    `INSERT INTO todogreen_tms_api_keys
      (id,tenant_id,workspace_owner_id,client_id,name,key_hash,key_prefix,scopes_json,
       rate_limit_per_minute,created_by,created_at)
     VALUES (?,'todogreen',?,?,?,?,?,?,120,?,?)`,
  ).bind(
    keyId,
    ownerId,
    clientId,
    `Integração ${suffix}`,
    await hash(token),
    token.slice(0, 17),
    JSON.stringify(scopes),
    ownerId,
    now,
  ).run();

  await env.DB.prepare(
    `INSERT INTO todogreen_clients
      (id,tenant_id,workspace_owner_id,name,status,portal_enabled,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,'ativo',0,'{}',1,?,?,?,?)`,
  ).bind(clientId, ownerId, `Cliente API ${suffix}`, ownerId, ownerId, now, now).run();

  // Implantação ativa (go-live): a criação de shipment pela API exige o cliente ativo.
  await env.DB.prepare(
    `INSERT INTO todogreen_client_activation_state
      (client_id,tenant_id,workspace_owner_id,status,integration_status,tracking_required,esg_enabled,
       activated_at,activated_by,revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,'todogreen',?,'active','ready',0,0,?,?,1,?,?,?,?)`,
  ).bind(clientId, ownerId, now, ownerId, ownerId, ownerId, now, now).run();

  return { ownerId, clientId, keyId, token, now };
}

function call(path, { method = "GET", token = "", body, idempotencyKey } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const request = new Request(`https://tms.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handlePublicTodoGreenTmsApi(request, env, new URL(request.url));
}

describe("To Do Green TMS API externa", () => {
  it("publica OpenAPI sem autenticação e exige chave nas rotas privadas", async () => {
    const spec = await json(await call("/api/tms/v1/openapi.json"));
    expect(spec.status).toBe(200);
    expect(spec.body.openapi).toBe("3.1.0");
    expect(spec.body.info.title).toBe("To Do Green TMS API");
    expect(spec.body.paths["/shipments"]).toBeTruthy();

    const unauthorized = await json(await call("/api/tms/v1/shipments"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.error).toBe("unauthorized");
  });

  it("cria shipment idempotente, registra tracking e conclui com POD + faturamento", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const seeded = await seedOwnerAndApiKey(suffix, [
      "shipments:read",
      "shipments:write",
      "tracking:write",
      "pod:write",
      "billing:read",
    ]);
    const contractId = `tms-api-contract-${suffix}`;

    await env.DB.prepare(
      `INSERT INTO todogreen_contracts
        (id,tenant_id,workspace_owner_id,client_id,proposal_id,title,monthly_value,status,fields_json,
         created_by,updated_by,created_at,updated_at,service_id,price_table_id,sla_json,billing_rules_json,
         approval_status,signature_status,billing_day,responsible_user_id)
       VALUES (?,'todogreen',?,?,?,?,12.5,'active',?,?,?,?,?,'same-day','pt-api','{"hours":12}',
               '{"cycle":"monthly"}','approved','signed',10,?)`,
    ).bind(
      contractId,
      seeded.ownerId,
      seeded.clientId,
      `proposal-${suffix}`,
      `Contrato API ${suffix}`,
      JSON.stringify({ pricingMode: "per_unit" }),
      seeded.ownerId,
      seeded.ownerId,
      seeded.now,
      seeded.now,
      seeded.ownerId,
    ).run();

    const createBody = {
      clientId: seeded.clientId,
      externalReference: `EXT-${suffix}`,
      serviceType: "same_day",
      origin: { name: "CD Barueri", city: "Barueri", state: "SP", latitude: -23.5108, longitude: -46.8766 },
      destination: { name: "Cliente", city: "São Paulo", state: "SP", lat: -23.5505, lng: -46.6333 },
      packages: [
        {
          trackId: `TRACK-${suffix}`,
          weightKg: 2.4,
          dimensionsCm: { length: 30, width: 20, height: 10 },
          declaredValue: 199.9,
          invoiceNumber: `NF-${suffix}`,
        },
      ],
    };

    const created = await json(await call("/api/tms/v1/shipments", {
      method: "POST",
      token: seeded.token,
      idempotencyKey: `create-${suffix}`,
      body: createBody,
    }));
    expect(created.status).toBe(201);
    expect(created.body.clientId).toBe(seeded.clientId);
    expect(created.body.status).toBe("released");
    expect(created.body.packages).toHaveLength(1);
    expect(created.body.packages[0].trackId).toBe(`TRACK-${suffix}`);
    expect(created.body.amount).toBe(12.5);

    const replayed = await json(await call("/api/tms/v1/shipments", {
      method: "POST",
      token: seeded.token,
      idempotencyKey: `create-${suffix}`,
      body: createBody,
    }));
    expect(replayed.status).toBe(201);
    expect(replayed.headers.get("idempotent-replayed")).toBe("true");
    expect(replayed.body.id).toBe(created.body.id);

    const orderCount = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM todogreen_service_orders WHERE workspace_owner_id=? AND client_id=?",
    ).bind(seeded.ownerId, seeded.clientId).first();
    expect(Number(orderCount.total)).toBe(1);

    const operacao = await env.DB.prepare(
      `SELECT so.operation_id, op.reference, op.client_id, op.contract_id, op.pickup_lat, op.pickup_lng,
              op.delivery_lat, op.delivery_lng, op.fields_json
         FROM todogreen_service_orders so
         JOIN todogreen_client_operations op ON op.id = so.operation_id
        WHERE so.id = ?`,
    ).bind(created.body.id).first();
    expect(operacao.operation_id).toBeTruthy();
    expect(operacao.reference).toBe(created.body.shipmentNumber);
    expect(operacao.client_id).toBe(seeded.clientId);
    expect(operacao.contract_id).toBe(contractId);
    expect(Number(operacao.pickup_lat)).toBeCloseTo(-23.5108);
    expect(Number(operacao.pickup_lng)).toBeCloseTo(-46.8766);
    expect(Number(operacao.delivery_lat)).toBeCloseTo(-23.5505);
    expect(Number(operacao.delivery_lng)).toBeCloseTo(-46.6333);
    expect(JSON.parse(operacao.fields_json).shipmentId).toBe(created.body.id);

    const tracked = await json(await call(`/api/tms/v1/shipments/${created.body.id}/tracking`, {
      method: "POST",
      token: seeded.token,
      idempotencyKey: `track-${suffix}`,
      body: {
        eventType: "IN_TRANSIT",
        city: "Osasco",
        state: "SP",
        externalEventId: `evt-${suffix}`,
      },
    }));
    expect(tracked.status).toBe(201);
    expect(tracked.body.event.eventType).toBe("IN_TRANSIT");
    expect(tracked.body.shipmentStatus).toBe("in_progress");
    const eventoCanonico = await env.DB.prepare(
      `SELECT kind FROM todogreen_client_operation_events
        WHERE operation_id=? AND idempotency_key=?`,
    ).bind(
      operacao.operation_id,
      `tracking:external_api:${created.body.id}:evt-${suffix}`,
    ).first();
    expect(eventoCanonico.kind).toBe("transito");

    const podInvalido = await json(await call(`/api/tms/v1/shipments/${created.body.id}/pod`, {
      method: "POST",
      token: seeded.token,
      idempotencyKey: `pod-invalido-${suffix}`,
      body: {
        recipientName: "Recebedor Teste",
        documentUrl: "javascript:alert(1)",
        completeShipment: true,
      },
    }));
    expect(podInvalido.status).toBe(400);
    expect(podInvalido.body.error).toBe("invalid_document_url");

    const pod = await json(await call(`/api/tms/v1/shipments/${created.body.id}/pod`, {
      method: "POST",
      token: seeded.token,
      idempotencyKey: `pod-${suffix}`,
      body: {
        recipientName: "Recebedor Teste",
        documentUrl: `https://example.test/pod/${suffix}.jpg`,
        completeShipment: true,
      },
    }));
    expect(pod.status).toBe(201);
    expect(pod.body.shipmentStatus).toBe("completed");
    expect(pod.body.billingEligible).toBe(true);

    const operacaoEntregue = await env.DB.prepare(
      "SELECT status,delivered_at,proof_url FROM todogreen_client_operations WHERE id=?",
    ).bind(operacao.operation_id).first();
    expect(operacaoEntregue.status).toBe("concluida");
    expect(operacaoEntregue.delivered_at).toBeTruthy();
    expect(operacaoEntregue.proof_url).toBe(`https://example.test/pod/${suffix}.jpg`);

    const detail = await json(await call(`/api/tms/v1/shipments/${created.body.id}`, { token: seeded.token }));
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe("completed");
    expect(detail.body.tracking).toHaveLength(1);
    expect(detail.body.pods).toHaveLength(1);

    const billing = await env.DB.prepare(
      "SELECT status,amount FROM todogreen_billing_items WHERE service_order_id=?",
    ).bind(created.body.id).first();
    expect(billing.status).toBe("eligible");
    expect(Number(billing.amount)).toBe(12.5);
  });

  it("impede uma chave vinculada a cliente de consultar outro cliente", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const seeded = await seedOwnerAndApiKey(suffix, ["shipments:read"]);
    const otherClient = `other-client-${suffix}`;
    const contractId = `other-contract-${suffix}`;
    const orderId = `other-order-${suffix}`;

    await env.DB.prepare(
      `INSERT INTO todogreen_contracts
        (id,tenant_id,workspace_owner_id,client_id,proposal_id,title,monthly_value,status,created_by,updated_by,created_at,updated_at)
       VALUES (?,'todogreen',?,?,?,?,10,'active',?,?,?,?)`,
    ).bind(contractId, seeded.ownerId, otherClient, `other-proposal-${suffix}`, "Outro contrato", seeded.ownerId, seeded.ownerId, seeded.now, seeded.now).run();

    await env.DB.prepare(
      `INSERT INTO todogreen_service_orders
        (id,tenant_id,workspace_owner_id,number,client_id,contract_id,status,created_by,updated_by,created_at,updated_at)
       VALUES (?,'todogreen',?,?,?,?,'released',?,?,?,?)`,
    ).bind(orderId, seeded.ownerId, `OS-OTHER-${suffix}`, otherClient, contractId, seeded.ownerId, seeded.ownerId, seeded.now, seeded.now).run();

    const response = await json(await call(`/api/tms/v1/shipments/${orderId}`, { token: seeded.token }));
    expect(response.status).toBe(404);
  });
});
