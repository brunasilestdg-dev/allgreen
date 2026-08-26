import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const request = (path, method = "GET", body) => worker.fetch(new Request(`https://app.test${path}`, {
  method,
  headers: { authorization: "Bearer transactional-token", "content-type": "application/json", "cf-connecting-ip": "198.51.100.91" },
  body: body === undefined ? undefined : JSON.stringify(body),
}), env, { waitUntil() {}, passThroughOnException() {} });

beforeAll(async () => {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO users (id,name,email,password_hash,password_salt,created_at)
    VALUES ('txn-user','Gestora','txn@test.local','h','s',?)`).bind(now).run();
  await env.DB.prepare(`INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at)
    VALUES ('txn-session','txn-user',?,'2099-01-01T00:00:00.000Z',?)`).bind(await sha256("transactional-token"),now).run();
  await env.DB.prepare(`INSERT INTO todogreen_access_emails
    (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
    VALUES ('txn-access','todogreen','txn@test.local','admin','active','["*"]','','txn-user',?,?)`).bind(now,now).run();
  await env.DB.prepare(`INSERT INTO todogreen_clients
    (id,tenant_id,workspace_owner_id,name,status,portal_enabled,fields_json,revision,created_by,updated_by,created_at,updated_at)
    VALUES ('txn-client','todogreen','txn-user','Cliente Transacional','ativo',0,'{}',1,'txn-user','txn-user',?,?)`).bind(now,now).run();
  await env.DB.prepare(`INSERT INTO todogreen_contracts
    (id,tenant_id,workspace_owner_id,client_id,client_name,proposal_id,title,status,signature_status,
     approval_status,service_id,price_table_id,sla_json,commercial_terms_json,taxes_json,billing_rules_json,
     fields_json,revision,created_by,updated_by,created_at,updated_at)
    VALUES ('txn-contract','todogreen','txn-user','txn-client','Cliente Transacional','proposal-x','Contrato','active','signed',
     'approved','same-day','table-a','{}','{}','{}','{}','{}',1,'txn-user','txn-user',?,?)`).bind(now,now).run();
});

describe("espinha transacional", () => {
  let order;
  let billingItem;
  let title;

  it("cria uma ordem somente sobre contrato aprovado e assinado", async () => {
    const response = await request("/api/todogreen/transactions/service-orders", "POST", {
      clientId: "txn-client", contractId: "txn-contract", quantity: 10, unitPrice: 25, chargeUnit: "entrega",
    });
    expect(response.status).toBe(201);
    order = (await response.json()).record;
    expect(order.number).toMatch(/^OS-/);
    expect(order.netAmount).toBe(250);
  });

  it("prepara CIOT e bloqueia frete abaixo do piso mínimo", async () => {
    const setup = await request("/api/todogreen/transactions/ciot-integration", "POST", {
      environment: "homologation",
      certificateType: "A1",
      baseUrl: "https://appservices-hml.antt.gov.br/ciot",
      certificateEnvKey: "TODOGREEN_ANTT_CIOT_CERTIFICATE_PFX",
      certificatePasswordEnvKey: "TODOGREEN_ANTT_CIOT_CERTIFICATE_PASSWORD",
      connectorUrlEnvKey: "TODOGREEN_ANTT_CIOT_CONNECTOR_URL",
      connectorTokenEnvKey: "TODOGREEN_ANTT_CIOT_CONNECTOR_TOKEN",
    });
    expect(setup.status).toBe(201);
    const integration = (await setup.json()).integration;
    expect(integration).toMatchObject({ mode: "direct_api", requiresIpef: false, environment: "homologation" });

    const belowFloor = await request("/api/todogreen/transactions/ciot", "POST", {
      serviceOrderId: order.id,
      operationType: "carga_lotacao",
      responsibleType: "etc",
      vehiclePlate: "ABC1D23",
      originCity: "São Paulo",
      originState: "SP",
      destinationCity: "Campinas",
      destinationState: "SP",
      cargoDescription: "Carga geral",
      freightAmount: 200,
      floorAmount: 250,
    });
    expect(belowFloor.status).toBe(409);

    const prepared = await request("/api/todogreen/transactions/ciot", "POST", {
      serviceOrderId: order.id,
      operationType: "carga_lotacao",
      responsibleType: "etc",
      contractorDocument: "11222333000144",
      carrierDocument: "11222333000144",
      driverDocument: "12345678901",
      vehiclePlate: "ABC1D23",
      originCity: "São Paulo",
      originState: "SP",
      destinationCity: "Campinas",
      destinationState: "SP",
      cargoDescription: "Carga geral",
      freightAmount: 250,
      floorAmount: 250,
    });
    expect(prepared.status).toBe(201);
    const ciot = (await prepared.json()).record;
    expect(ciot.number).toMatch(/^CIOT-PREP-/);
    expect(ciot.status).toBe("ready");
    expect(ciot.payload).toMatchObject({ serviceOrderNumber: order.number, floorAmount: 250, integrationMode: "direct_api", requiresIpef: false });

    const missingConnector = await request(`/api/todogreen/transactions/ciot/${ciot.id}/submit`, "POST", {
      revision: ciot.revision,
    });
    expect(missingConnector.status).toBe(409);
    expect((await missingConnector.json()).error).toMatch(/conector direto/i);

    const issued = await request(`/api/todogreen/transactions/ciot/${ciot.id}/issue`, "POST", {
      ciotCode: "123456789012",
      protocol: "PROTO-1",
      revision: ciot.revision,
    });
    expect(issued.status).toBe(200);
    expect((await issued.json()).record).toMatchObject({ status: "issued", ciotCode: "123456789012" });
  });

  it("não pula etapas e só gera elegibilidade depois do POD e da conclusão", async () => {
    const skipped = await request(`/api/todogreen/transactions/service-orders/${order.id}/transition`, "POST", { status: "completed", revision: 1 });
    expect(skipped.status).toBe(409);

    for (const status of ["released", "in_progress"]) {
      const response = await request(`/api/todogreen/transactions/service-orders/${order.id}/transition`, "POST", { status, revision: order.revision });
      expect(response.status).toBe(200);
      order = (await response.json()).record;
    }

    const beforePod = await request("/api/todogreen/transactions/billing-items?status=eligible");
    expect((await beforePod.json()).records).toHaveLength(0);

    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO todogreen_proofs_of_delivery
      (id,tenant_id,workspace_owner_id,service_order_id,delivery_id,kind,occurred_at,recipient_name,
       document_url,document_hash,fields_json,created_by,created_at)
      VALUES ('txn-pod','todogreen','txn-user',?,'','delivery',?,'Recebedor','','hash-pod','{}','txn-user',?)`)
      .bind(order.id, now, now).run();

    const completed = await request(`/api/todogreen/transactions/service-orders/${order.id}/transition`, "POST", {
      status: "completed", revision: order.revision,
    });
    expect(completed.status).toBe(200);
    order = (await completed.json()).record;

    const queue = await request("/api/todogreen/transactions/billing-items?status=eligible");
    const records = (await queue.json()).records;
    expect(records).toHaveLength(1);
    billingItem = records[0];
  });

  it("confere, fecha, prepara documento e cria contas a receber", async () => {
    const checked = await request(`/api/todogreen/transactions/billing-items/${billingItem.id}/check`, "POST", { approved: true, revision: 1 });
    expect(checked.status).toBe(200);
    const closed = await request("/api/todogreen/transactions/billing-runs", "POST", {
      itemIds: [billingItem.id], competenceDate: "2026-08-20", dueDate: "2026-09-20",
    });
    expect(closed.status).toBe(201);
    const result = await closed.json();
    expect(result.amount).toBe(250);
    expect(result).toMatchObject({ documentType: "cte" });
    expect(result.invoiceNumber).toMatch(/^CTE-/);
    const titles = await request("/api/todogreen/transactions/titles?kind=receivable");
    title = (await titles.json()).records[0];
    expect(title.open_amount).toBe(250);
  });

  it("aceita baixa parcial e depois integral", async () => {
    let response = await request(`/api/todogreen/transactions/titles/${title.id}/settle`, "POST", { amount: 100, method: "pix" });
    expect(await response.json()).toMatchObject({ openAmount: 150, status: "partial" });
    response = await request(`/api/todogreen/transactions/titles/${title.id}/settle`, "POST", { amount: 150, method: "pix" });
    expect(await response.json()).toMatchObject({ openAmount: 0, status: "settled" });
  });

  it("recusa custo sem rateio integral e grava custo multidimensional", async () => {
    const invalid = await request("/api/todogreen/transactions/costs", "POST", { description: "Energia", amount: 100, allocations: [{ amount: 90, clientId: "txn-client" }] });
    expect(invalid.status).toBe(400);
    const valid = await request("/api/todogreen/transactions/costs", "POST", {
      description: "Energia", amount: 100, competenceDate: "2026-08-20",
      allocations: [{ amount: 60, serviceOrderId: order.id, clientId: "txn-client", contractId: "txn-contract" }, { amount: 40, vehicleId: "vehicle-a", costCenterId: "cc-a" }],
    });
    expect(valid.status).toBe(201);
    const rows = await env.DB.prepare("SELECT SUM(amount) AS total FROM todogreen_cost_allocations WHERE cost_entry_id=?").bind((await valid.json()).costEntryId).first();
    expect(rows.total).toBe(100);
    const listed = await request("/api/todogreen/transactions/costs");
    const records = (await listed.json()).records;
    expect(records[0]).toMatchObject({ description: "Energia", amount: 100 });
    expect(records[0].allocations).toHaveLength(2);
  });
});
