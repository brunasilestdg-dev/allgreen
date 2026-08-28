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

    // Sem POD, concluir é recusado com 409 LEGÍVEL (antes era um 500 opaco do
    // trigger) e nada muda na OS.
    const semPod = await request(`/api/todogreen/transactions/service-orders/${order.id}/transition`, "POST", {
      status: "completed", revision: order.revision,
    });
    expect(semPod.status).toBe(409);
    expect((await semPod.json()).code).toBe("pod_required");

    const beforePod = await request("/api/todogreen/transactions/billing-items?status=eligible");
    expect((await beforePod.json()).records).toHaveLength(0);

    // O POD entra pelo endpoint do produto — não por SQL de teste: é o caminho
    // que a Operação usa de verdade.
    const semNada = await request(`/api/todogreen/transactions/service-orders/${order.id}/pod`, "POST", {});
    expect(semNada.status).toBe(400);
    const pod = await request(`/api/todogreen/transactions/service-orders/${order.id}/pod`, "POST", {
      recipientName: "Recebedor", documentUrl: "https://exemplo.test/canhoto.jpg",
    });
    expect(pod.status).toBe(201);
    expect((await pod.json()).record.recipientName).toBe("Recebedor");
    const listaPod = await request(`/api/todogreen/transactions/service-orders/${order.id}/pod`);
    expect((await listaPod.json()).records).toHaveLength(1);

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

  it("o título a receber aparece no razão como receita (ponte 0069)", async () => {
    // Sem esta ponte, faturar era invisível para a Tesouraria, para a
    // conciliação e para a receita dos painéis — a planilha paralela.
    const entry = await env.DB.prepare(
      "SELECT * FROM todogreen_financial_entries WHERE id = 'entry-' || ?",
    ).bind(title.id).first();
    expect(entry).toBeTruthy();
    expect(entry.kind).toBe("revenue");
    expect(entry.amount).toBe(250);
    expect(entry.client_id).toBe("txn-client");
    expect(entry.invoice_status).toBe("pending");
    expect(entry.document_number).toBe(title.number);
  });

  it("recusa baixa do recebível-ponte pelo razão (evita dupla baixa)", async () => {
    // O recebível 'entry-<titleId>' só se baixa pela via do título; dar baixa
    // aqui no razão não reduziria o open_amount do título e contaria o dinheiro
    // duas vezes.
    const response = await request(`/api/todogreen/records/financial/entry-${title.id}/payments`, "POST", { valor: 100 });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Faturamento.*Títulos/i);
    // E o título continua aberto pelo valor cheio.
    const ainda = await env.DB.prepare("SELECT open_amount,status FROM todogreen_financial_titles WHERE id=?").bind(title.id).first();
    expect(ainda.open_amount).toBe(250);
    expect(ainda.status).toBe("open");
  });

  it("aceita baixa parcial e depois integral", async () => {
    let response = await request(`/api/todogreen/transactions/titles/${title.id}/settle`, "POST", { amount: 100, method: "pix" });
    expect(await response.json()).toMatchObject({ openAmount: 150, status: "partial" });
    response = await request(`/api/todogreen/transactions/titles/${title.id}/settle`, "POST", { amount: 150, method: "pix" });
    expect(await response.json()).toMatchObject({ openAmount: 0, status: "settled" });

    // A baixa refletiu no razão: pagamentos gravados e lançamento quitado.
    const entry = await env.DB.prepare(
      "SELECT * FROM todogreen_financial_entries WHERE id = 'entry-' || ?",
    ).bind(title.id).first();
    expect(entry.paid_amount).toBe(250);
    expect(entry.invoice_status).toBe("paid");
    const pagamentos = await env.DB.prepare(
      "SELECT COUNT(*) AS total, SUM(amount) AS soma FROM todogreen_financial_payments WHERE entry_id = 'entry-' || ?",
    ).bind(title.id).first();
    expect(pagamentos.total).toBe(2);
    expect(pagamentos.soma).toBe(250);
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

describe("a fatura fechada vira documento fiscal preparado", () => {
  it("lista a fatura pendente e prepara o CT-e pré-preenchido, sem duplicar", async () => {
    // Perfil fiscal mínimo — a preparação e a validação dependem dele.
    await request("/api/todogreen/fiscal/profile", "POST", {
      razaoSocial: "To Do Green Transportes", cnpj: "41.385.427/0001-32",
      uf: "SP", regimeTributario: "simples", faturamento12m: 500000,
    });

    const pendentes = await (await request("/api/todogreen/fiscal/faturas-pendentes")).json();
    expect(pendentes.registros.length).toBeGreaterThanOrEqual(1);
    const fatura = pendentes.registros[0];
    expect(fatura.valor).toBe(250);

    const preparado = await request("/api/todogreen/fiscal/documentos/da-fatura", "POST", { invoiceId: fatura.invoiceId });
    expect(preparado.status).toBe(201);
    const doc = await preparado.json();
    expect(doc.status).toBe("rascunho");
    expect(doc.valorTotal).toBe(250);
    expect(doc.clientId).toBe("txn-client");
    expect(doc.invoiceId).toBe(fatura.invoiceId);

    // A mesma fatura não vira dois documentos, e sai da fila de pendentes.
    const denovo = await request("/api/todogreen/fiscal/documentos/da-fatura", "POST", { invoiceId: fatura.invoiceId });
    expect(denovo.status).toBe(409);
    const depois = await (await request("/api/todogreen/fiscal/faturas-pendentes")).json();
    expect(depois.registros.some((r) => r.invoiceId === fatura.invoiceId)).toBe(false);
  });
});

describe("evento de entrega fecha o ciclo da operação", () => {
  it("carimba delivered_at, guarda o comprovante e cria o POD da OS vinculada", async () => {
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_client_operations
         (id, tenant_id, client_id, workspace_owner_id, reference, status,
          service_date, origin, destination, fields_json,
          created_by, updated_by, created_at, updated_at)
       VALUES ('txn-op','todogreen','txn-client','txn-user','OP-ENTREGA','em_andamento',
               '2026-08-25','CD','Hub','{}','txn-user','txn-user',?,?)`,
    ).bind(agora, agora).run();

    // OS amarrada à operação, ainda sem POD.
    const criada = await request("/api/todogreen/transactions/service-orders", "POST", {
      clientId: "txn-client", contractId: "txn-contract", operationId: "txn-op",
      quantity: 2, unitPrice: 50, chargeUnit: "viagem",
    });
    expect(criada.status).toBe(201);
    const os = (await criada.json()).record;

    const evento = await request("/api/todogreen/records/operations/txn-op/events", "POST", {
      tipo: "entrega", titulo: "Entrega concluída", recebedor: "Portaria",
      comprovanteUrl: "https://exemplo.test/pod-op.jpg",
    });
    expect(evento.status).toBe(201);
    const registro = (await evento.json()).registro;
    expect(registro.entregueEm || registro.deliveredAt).toBeTruthy();
    expect(registro.comprovanteUrl).toBe("https://exemplo.test/pod-op.jpg");

    // O POD nasceu para a OS vinculada — o gate de faturamento passa a vê-lo.
    const pods = await request(`/api/todogreen/transactions/service-orders/${os.id}/pod`);
    const lista = (await pods.json()).records;
    expect(lista).toHaveLength(1);
    expect(lista[0].recipientName).toBe("Portaria");
  });
});

describe("aceite → OS: a ordem herda o preço", () => {
  beforeAll(async () => {
    const now = new Date().toISOString();
    // Simulação com preço recomendado de 1500.
    await env.DB.prepare(`INSERT INTO pricing_scenarios
      (id,tenant_id,workspace_owner_id,product_id,created_by,rule_version,inputs_json,result_json,status,created_at)
      VALUES ('sc-preco','todogreen','txn-user','same-day','txn-user','v1','{}','{"precoRecomendado":1500}','approved',?)`).bind(now).run();
    // Contrato com valor negociado 1000 e ligado à simulação.
    await env.DB.prepare(`INSERT INTO todogreen_contracts
      (id,tenant_id,workspace_owner_id,client_id,client_name,proposal_id,scenario_id,monthly_value,title,status,signature_status,
       approval_status,service_id,price_table_id,sla_json,commercial_terms_json,taxes_json,billing_rules_json,
       fields_json,revision,created_by,updated_by,created_at,updated_at)
      VALUES ('ct-preco','todogreen','txn-user','txn-client','Cliente Transacional','prop-preco','sc-preco',1000,'Contrato com preço','active','signed',
       'approved','same-day','table-a','{}','{}','{}','{}','{}',1,'txn-user','txn-user',?,?)`).bind(now,now).run();
    // Contrato sem valor negociado, só com a simulação por trás.
    await env.DB.prepare(`INSERT INTO todogreen_contracts
      (id,tenant_id,workspace_owner_id,client_id,client_name,proposal_id,scenario_id,monthly_value,title,status,signature_status,
       approval_status,service_id,price_table_id,sla_json,commercial_terms_json,taxes_json,billing_rules_json,
       fields_json,revision,created_by,updated_by,created_at,updated_at)
      VALUES ('ct-sim','todogreen','txn-user','txn-client','Cliente Transacional','prop-sim','sc-preco',0,'Contrato só simulação','active','signed',
       'approved','same-day','table-a','{}','{}','{}','{}','{}',1,'txn-user','txn-user',?,?)`).bind(now,now).run();
  });

  it("sem preço digitado, herda o valor negociado do contrato", async () => {
    const res = await request("/api/todogreen/transactions/service-orders", "POST", {
      clientId: "txn-client", contractId: "ct-preco", quantity: 2, chargeUnit: "entrega",
    });
    expect(res.status).toBe(201);
    const os = (await res.json()).record;
    expect(os.unitPrice).toBe(1000);
    expect(os.netAmount).toBe(2000);
    expect(os.precoOrigem).toBe("contrato");
  });

  it("sem contrato com valor, herda o preço da simulação", async () => {
    const res = await request("/api/todogreen/transactions/service-orders", "POST", {
      clientId: "txn-client", contractId: "ct-sim", quantity: 3, chargeUnit: "entrega",
    });
    expect(res.status).toBe(201);
    const os = (await res.json()).record;
    expect(os.unitPrice).toBe(1500);
    expect(os.precoOrigem).toBe("simulacao");
  });

  it("o preço digitado vence a herança", async () => {
    const res = await request("/api/todogreen/transactions/service-orders", "POST", {
      clientId: "txn-client", contractId: "ct-preco", quantity: 1, unitPrice: 777, chargeUnit: "entrega",
    });
    const os = (await res.json()).record;
    expect(os.unitPrice).toBe(777);
    expect(os.precoOrigem).toBe("digitado");
  });
});
