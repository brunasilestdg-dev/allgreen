import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Cadastro manual de carga no Portal TMS: a mesma regra de negócio da API
// pública (/api/tms/v1/shipments), só que pela sessão interna — sem precisar
// gerar chave de API pra usar o próprio painel.

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function criarUsuario(id, email) {
  const token = `tok-${id}`;
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'h', 's', ?)`,
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(`ses-${id}`, id, await sha256(token), agora).run();
  return { id, email, token };
}

const pedir = (caminho, { metodo = "GET", token, corpo } = {}) => {
  const headers = { "cf-connecting-ip": `198.19.1.${(Math.random() * 240 | 0) + 1}` };
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${caminho}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
};

let gestor;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();

  gestor = await criarUsuario("tms-man-gestor", "gestor.tmsmanual@todogreen.com.br");
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'admin', 'active', '["*"]', '', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), gestor.email, gestor.id, agora, agora).run();
});

describe("Cadastro manual de carga no Portal TMS", () => {
  it("lista só clientes ativos do próprio espaço", async () => {
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_clients (id, tenant_id, workspace_owner_id, name, status, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'Cliente Manual Um', 'ativo', ?, ?, ?, ?)`,
    ).bind("cli-man-1", gestor.id, gestor.id, gestor.id, agora, agora).run();
    // Sem go-live ativo não se cria OS — mesma trava da API pública.
    await env.DB.prepare(
      `INSERT INTO todogreen_client_activation_state
         (client_id, tenant_id, workspace_owner_id, status, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'active', ?, ?, ?, ?)`,
    ).bind("cli-man-1", gestor.id, gestor.id, gestor.id, agora, agora).run();

    const r = await pedir("/api/todogreen/tms-manual/clients", { token: gestor.token });
    expect(r.status).toBe(200);
    const nomes = (await r.json()).clientes.map((c) => c.nome);
    expect(nomes).toContain("Cliente Manual Um");
  });

  it("sem contrato aprovado e assinado, recusa criar carga", async () => {
    const r = await pedir("/api/todogreen/tms-manual/shipments", {
      metodo: "POST",
      token: gestor.token,
      corpo: { clientId: "cli-man-1", origin: { address: "CD" }, destination: { address: "Cliente" } },
    });
    expect(r.status).toBe(409);
  });

  it("com contrato aprovado e assinado, cria a OS e ela aparece na lista de transações", async () => {
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_contracts
        (id,tenant_id,workspace_owner_id,client_id,proposal_id,title,monthly_value,status,fields_json,
         created_by,updated_by,created_at,updated_at,approval_status,signature_status)
       VALUES (?,'todogreen',?,?,?,?,15.75,'active',?,?,?,?,?,'approved','signed')`,
    ).bind(
      "contr-man-1", gestor.id, "cli-man-1", "prop-man-1", "Contrato Manual",
      JSON.stringify({ pricingMode: "per_unit" }), gestor.id, gestor.id, agora, agora,
    ).run();

    const contratosResp = await pedir("/api/todogreen/tms-manual/contracts?clientId=cli-man-1", { token: gestor.token });
    expect(contratosResp.status).toBe(200);
    const contratos = (await contratosResp.json()).contratos;
    expect(contratos).toHaveLength(1);
    expect(contratos[0].id).toBe("contr-man-1");

    const criada = await pedir("/api/todogreen/tms-manual/shipments", {
      metodo: "POST",
      token: gestor.token,
      corpo: {
        clientId: "cli-man-1",
        contractId: "contr-man-1",
        origin: { address: "CD Barueri", lat: -23.5108, lng: -46.8766 },
        destination: { address: "Cliente final", lat: -23.5505, lng: -46.6333 },
        quantity: 3,
        notes: "Carga cadastrada na tela",
      },
    });
    expect(criada.status).toBe(201);
    const registro = await criada.json();
    expect(registro.shipmentNumber).toMatch(/^OS-MAN-/);
    expect(registro.clientId).toBe("cli-man-1");
    expect(registro.amount).toBe(15.75 * 3);

    const linha = await env.DB.prepare(
      "SELECT created_by, fields_json FROM todogreen_service_orders WHERE id=?",
    ).bind(registro.id).first();
    expect(linha.created_by).toBe(`interno:${gestor.id}`);
    expect(JSON.parse(linha.fields_json).source).toBe("portal_tms_manual");

    const operacao = await env.DB.prepare(
      `SELECT so.operation_id, op.reference, op.pickup_lat, op.pickup_lng, op.delivery_lat, op.delivery_lng, op.fields_json
         FROM todogreen_service_orders so
         JOIN todogreen_client_operations op ON op.id = so.operation_id
        WHERE so.id = ?`,
    ).bind(registro.id).first();
    expect(operacao.operation_id).toBeTruthy();
    expect(operacao.reference).toBe(registro.shipmentNumber);
    expect(Number(operacao.pickup_lat)).toBeCloseTo(-23.5108);
    expect(Number(operacao.pickup_lng)).toBeCloseTo(-46.8766);
    expect(Number(operacao.delivery_lat)).toBeCloseTo(-23.5505);
    expect(Number(operacao.delivery_lng)).toBeCloseTo(-46.6333);
    expect(JSON.parse(operacao.fields_json).shipmentId).toBe(registro.id);

    // Registra a entrega com "assinatura" (aqui, um data URI qualquer — o
    // teste não abre canvas de verdade, só confirma que o campo aceita e
    // que a OS fecha e vira item de faturamento elegível).
    const pod = await pedir(`/api/todogreen/tms-manual/shipments/${registro.id}/pod`, {
      metodo: "POST",
      token: gestor.token,
      corpo: { recipientName: "Recebedor Teste", documentUrl: "data:image/png;base64,AAAA" },
    });
    expect(pod.status).toBe(201);
    const podCorpo = await pod.json();
    expect(podCorpo.shipmentStatus).toBe("completed");
    expect(podCorpo.billingEligible).toBe(true);
    expect(podCorpo.pod.documentUrl).toMatch(/^\/api\/todogreen\/file-vault\/[^/]+\/download$/);

    const osFinal = await env.DB.prepare("SELECT status FROM todogreen_service_orders WHERE id=?").bind(registro.id).first();
    expect(osFinal.status).toBe("completed");
    const faturamento = await env.DB.prepare("SELECT status FROM todogreen_billing_items WHERE service_order_id=?").bind(registro.id).first();
    expect(faturamento.status).toBe("eligible");
  });

  it("bipagem: encontra o volume pelo Track ID, registra evento e fecha ao entregar", async () => {
    // Segundo pedido/volume, isolado dos testes anteriores.
    const criada = await pedir("/api/todogreen/tms-manual/shipments", {
      metodo: "POST",
      token: gestor.token,
      corpo: {
        clientId: "cli-man-1", contractId: "contr-man-1",
        origin: { address: "CD" }, destination: { address: "Cliente" },
        packages: [{ trackId: "TRK-BIP-1", description: "Caixa 1" }],
      },
    });
    expect(criada.status).toBe(201);
    const pedido = await criada.json();
    expect(pedido.packages).toHaveLength(1);

    const semEvento = await pedir("/api/todogreen/tms-manual/scan", {
      metodo: "POST",
      token: gestor.token,
      corpo: { trackId: "TRK-BIP-1" },
    });
    expect(semEvento.status).toBe(400);

    const naoExiste = await pedir("/api/todogreen/tms-manual/scan", {
      metodo: "POST",
      token: gestor.token,
      corpo: { trackId: "NAO-EXISTE", eventType: "PICKED_UP" },
    });
    expect(naoExiste.status).toBe(404);

    const coleta = await pedir("/api/todogreen/tms-manual/scan", {
      metodo: "POST",
      token: gestor.token,
      corpo: { trackId: "TRK-BIP-1", eventType: "PICKED_UP" },
    });
    expect(coleta.status).toBe(201);
    const coletaCorpo = await coleta.json();
    expect(coletaCorpo.pacote.status).toBe("em_transito");
    expect(coletaCorpo.pedido.id).toBe(pedido.id);
    expect(coletaCorpo.shipmentStatus).toBe("in_progress");

    // Bipar como "entregue" marca o volume, mas quem fecha a OS de verdade é
    // o POD (assinatura) — o evento de rastreamento só sinaliza que falta o
    // comprovante, não completa sozinho.
    const entrega = await pedir("/api/todogreen/tms-manual/scan", {
      metodo: "POST",
      token: gestor.token,
      corpo: { trackId: "TRK-BIP-1", eventType: "DELIVERED" },
    });
    expect(entrega.status).toBe(201);
    const entregaCorpo = await entrega.json();
    expect(entregaCorpo.pacote.status).toBe("entregue");
    expect(entregaCorpo.shipmentStatus).toBe("in_progress");
    expect(entregaCorpo.requiresPodToComplete).toBe(true);

    const pacoteFinal = await env.DB.prepare("SELECT status FROM todogreen_tms_packages WHERE track_id=?").bind("TRK-BIP-1").first();
    expect(pacoteFinal.status).toBe("entregue");
  });

  it("mapa de frota só mostra veículo com posição recente", async () => {
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_fleet_vehicles (id, tenant_id, workspace_owner_id, prefix, plate, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'V-01', 'ABC1D23', ?, ?, ?, ?)`,
    ).bind("veic-man-1", gestor.id, gestor.id, gestor.id, agora, agora).run();
    await env.DB.prepare(
      `INSERT INTO todogreen_fleet_vehicles (id, tenant_id, workspace_owner_id, prefix, plate, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'V-02', 'XYZ9W88', ?, ?, ?, ?)`,
    ).bind("veic-man-2", gestor.id, gestor.id, gestor.id, agora, agora).run();
    await env.DB.prepare(
      `INSERT INTO todogreen_client_operations
        (id, tenant_id, workspace_owner_id, client_id, vehicle_plate, driver_name, last_position_lat, last_position_lng, last_position_at, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'cli-man-1', 'ABC1D23', 'Motorista Um', -23.5, -46.6, ?, ?, ?, ?, ?)`,
    ).bind("op-man-1", gestor.id, agora, gestor.id, gestor.id, agora, agora).run();

    const r = await pedir("/api/todogreen/tms-manual/positions", { token: gestor.token });
    expect(r.status).toBe(200);
    const veiculos = (await r.json()).veiculos;
    expect(veiculos.map((v) => v.placa)).toContain("ABC1D23");
    expect(veiculos.map((v) => v.placa)).not.toContain("XYZ9W88");
  });

  it("motorista não acessa o cadastro manual do TMS", async () => {
    const motorista = await criarUsuario("tms-man-motorista", "motorista.tmsmanual@todogreen.com.br");
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_access_emails
         (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'motorista', 'active', '[]', '', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), motorista.email, gestor.id, agora, agora).run();

    const r = await pedir("/api/todogreen/tms-manual/clients", { token: motorista.token });
    expect(r.status).toBe(403);
  });
});
