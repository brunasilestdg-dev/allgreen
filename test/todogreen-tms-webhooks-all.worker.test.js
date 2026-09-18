import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

const SEGREDO = "segredo-track3r-webhooks-completos";
const ambiente = () => ({ ...env, TODOGREEN_TRACK3R_WEBHOOK_SECRET: SEGREDO });
let ip = 10;

async function sha256(valor) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function criarUsuario() {
  const id = "tmw-all-user";
  const email = "tmw-all@test.local";
  const token = "tok-tmw-all";
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, 'Track3R Webhooks', ?, 'h', 's', ?)`,
  ).bind(id, email, agora).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES ('ses-tmw-all', ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(id, await sha256(token), agora).run();
  return { id, email };
}

async function criarIntegracao(usuario) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_tms_integrations
       (id, tenant_id, workspace_owner_id, provider, name, base_url, token_env_key,
        webhook_secret_env_key, auth_header_name, sync_mode, collections_path, invoices_path,
        field_map_json, polling_interval_minutes, status, last_sync_at, last_error,
        revision, created_by, updated_by, created_at, updated_at, archived_at)
     VALUES ('tmw-all-int', 'todogreen', ?, 'track3r', 'TRACK3R', '', 'TODOGREEN_TRACK3R_API_TOKEN',
             'TODOGREEN_TRACK3R_WEBHOOK_SECRET', 'Authorization', 'webhook', '', '', '{}',
             60, 'pronta', '', '', 1, ?, ?, ?, ?, NULL)`,
  ).bind(usuario.id, usuario.id, usuario.id, agora, agora).run();
}

const chamar = (tipo, corpo, token = SEGREDO) => worker.fetch(
  new Request(`https://app.test/api/todogreen/tms/webhook/tmw-all-int/${tipo}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": `198.51.100.${++ip}`,
      Token: token,
    },
    body: JSON.stringify(corpo),
  }),
  ambiente(),
  { waitUntil() {}, passThroughOnException() {} },
);

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();
  const usuario = await criarUsuario();
  await criarIntegracao(usuario);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_clients
       (id,tenant_id,workspace_owner_id,name,document,status,portal_enabled,fields_json,
        revision,created_by,updated_by,created_at,updated_at)
     VALUES ('tmw-client','todogreen',?,'Cliente TRACK3R','05517785000198','ativo',0,'{}',1,?,?,?,?)`,
  ).bind(usuario.id, usuario.id, usuario.id, agora, agora).run();
});

describe("TRACK3R — webhooks documentados", () => {
  it("recebe encomenda e preserva o payload bruto na inbox", async () => {
    const payload = {
      data_hora_envio: "01/03/2024 15:21:19",
      codigo_encomenda: 123,
      descricao_servico: "Entrega",
      codigo_status: 1,
      descricao_status: "Arquivo Recebido",
      documento: { numero: "12345678", peso_cubado: 0.7 },
    };
    const r = await chamar("encomendas", payload);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: true, descricao: "Recebido com sucesso!" });

    const row = await env.DB.prepare(
      `SELECT * FROM todogreen_tms_webhook_events
        WHERE integration_id = 'tmw-all-int' AND event_type = 'encomendas'`,
    ).first();
    expect(row.external_ref).toBe("123");
    expect(row.source_sent_at).toBe("01/03/2024 15:21:19");
    expect(row.status).toBe("processed");
    expect(JSON.parse(row.payload_json).document.numero).toBe("12345678");
  });

  it("projeta lista e encomenda no TMS independentemente da ordem de chegada", async () => {
    await chamar("embarcadores", {
      data_hora_envio: "28/06/2024 13:00:00",
      codigo_embarcador: 900,
      nome: "Cliente TRACK3R",
      fantasia: "Cliente TRACK3R",
      cpf_cnpj: "05517785000198",
    });

    const lista = await chamar("listas", {
      data_hora_envio: "28/06/2024 13:21:01",
      codigo_lista: 300,
      detalhes: {
        tipo: 1,
        codigo_servico: 10,
        data_geracao: "28/06/2024 13:20:52",
        quantidade_encomendas: 1,
        unidade: { codigo: 1, nome: "Unidade São Paulo", sigla: "SAO", cnpj: "01456785000537" },
        unidade_destino: { codigo: 2, nome: "Unidade Campinas", sigla: "CPQ", cnpj: "01456785000158" },
        motorista: {
          codigo: 20,
          nome: "João Motorista",
          cpf: "00047845877",
          tipo_motorista: { codigo: 1, descricao: "CLT" },
        },
        veiculo: {
          codigo: 30,
          placa: "ABC1D23",
          tipo_veiculo: { codigo: 4, descricao: "Furgão" },
        },
        encomendas: [{ codigo_encomenda: 9001, itens: [{ codigo: "SKU1", descricao: "Produto" }] }],
      },
    });
    expect(lista.status).toBe(200);

    const encomenda = await chamar("encomendas", {
      data_hora_envio: "28/06/2024 13:22:00",
      data_hora_cadastro: "28/06/2024 12:00:00",
      codigo_encomenda: 9001,
      codigo_embarcador: 900,
      codigo_tomador: 901,
      codigo_unidade_origem: 1,
      codigo_unidade_destino: 2,
      descricao_servico: "Entrega",
      descricao_status: "Em transporte",
      descricao_produto: "Entrega Padrão",
      data_prevista: "29/06/2024",
      documento: {
        numero: "NF9001",
        serie: "1",
        chave: "CHAVE-NF-9001",
        quantidade_volumes: 2,
        volumes: [
          { peso_manual: 3.2, peso_cubado: 2.5 },
          { peso_manual: 1.8, peso_cubado: 1.5 },
        ],
      },
    });
    expect(encomenda.status).toBe(200);

    const doc = await env.DB.prepare(
      `SELECT * FROM todogreen_tms_documents
        WHERE workspace_owner_id='tmw-all-user' AND external_id='9001'`,
    ).first();
    expect(doc.order_ref).toBe("9001");
    expect(doc.client_id).toBe("tmw-client");
    expect(doc.vehicle_plate).toBe("ABC1D23");
    expect(doc.vehicle_class).toBe("van");
    expect(doc.driver_name).toBe("João Motorista");
    expect(Number(doc.packages)).toBe(2);
    expect(Number(doc.weight_kg)).toBe(5);
    expect(doc.invoice_key).toBe("CHAVE-NF-9001");

    const list = await env.DB.prepare(
      `SELECT * FROM todogreen_track3r_lists
        WHERE integration_id='tmw-all-int' AND external_list_code='300'`,
    ).first();
    expect(list.vehicle_class).toBe("van");
    expect(list.driver_name).toBe("João Motorista");

    const link = await env.DB.prepare(
      `SELECT * FROM todogreen_track3r_list_orders
        WHERE integration_id='tmw-all-int' AND external_order_code='9001'`,
    ).first();
    expect(link.external_list_code).toBe("300");

    await chamar("encomendas", {
      data_hora_envio: "28/06/2024 14:00:00",
      data_hora_cadastro: "28/06/2024 12:00:00",
      codigo_encomenda: 9001,
      codigo_embarcador: 900,
      descricao_servico: "Entrega",
      descricao_status: "Saiu para entrega",
      documento: { numero: "NF9001", chave: "CHAVE-NF-9001", quantidade_volumes: 2 },
    });
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM todogreen_tms_documents
        WHERE workspace_owner_id='tmw-all-user' AND external_id='9001'`,
    ).first();
    expect(Number(count.total)).toBe(1);
    const updated = await env.DB.prepare(
      `SELECT status,vehicle_plate,driver_name FROM todogreen_tms_documents
        WHERE workspace_owner_id='tmw-all-user' AND external_id='9001'`,
    ).first();
    expect(updated.status).toBe("Saiu para entrega");
    expect(updated.vehicle_plate).toBe("ABC1D23");
    expect(updated.driver_name).toBe("João Motorista");
  });

  it("reenvio idêntico é idempotente e só aumenta receive_count", async () => {
    const payload = {
      data_hora_envio: "24/06/2024 09:21:19",
      codigo_fatura: 77,
      motorista: { codigo: 1, nome: "João Felix", cpf: "00100200315" },
      detalhes: { valor: 190.5 },
    };
    await chamar("faturas-motorista", payload);
    await chamar("faturas-motorista", payload);

    const rows = await env.DB.prepare(
      `SELECT receive_count, external_ref FROM todogreen_tms_webhook_events
        WHERE integration_id = 'tmw-all-int' AND event_type = 'faturas-motorista'`,
    ).all();
    expect(rows.results).toHaveLength(1);
    expect(Number(rows.results[0].receive_count)).toBe(2);
    expect(rows.results[0].external_ref).toBe("77");
  });

  it("aceita os tipos adicionais da documentação", async () => {
    const amostras = [
      ["valores-encomendas", { data_hora_envio: "01/03/2024 15:21:19", codigo_encomenda: 10, frete_total: 8.5 }],
      ["embarcadores", { data_hora_envio: "01/03/2024 15:21:19", codigo_embarcador: "E1", nome: "Cliente" }],
      ["tomadores", { data_hora_envio: "01/03/2024 15:21:19", codigo_tomador: "T1", nome: "Tomador" }],
      ["ctes", { data_hora_envio: "01/03/2024 15:21:19", codigo_encomenda: 10, cte: { chave: "CTE-CHAVE" } }],
      ["unidades", { data_hora_envio: "11/06/2024 15:21:19", codigo_unidade: 3, nome: "HUB" }],
      ["averbacoes", { data_hora_envio: "20/06/2024 15:21:19", codigo_encomenda: 10, averbacao: { protocolo: "PROTO-1" } }],
      ["cotacoes", { data_hora_envio: "20/06/2024 15:21:19", codigo_cotacao: 55 }],
      ["faturas", { data_hora_envio: "01/07/2024 08:21:00", codigo_fatura: 90 }],
      ["faturas-rede-terceira", { data_hora_envio: "24/06/2024 09:21:19", codigo_fatura: 91 }],
      ["listas", { data_hora_envio: "28/06/2024 13:21:01", codigo_lista: 100 }],
    ];
    for (const [tipo, payload] of amostras) {
      const r = await chamar(tipo, payload);
      expect(r.status).toBe(200);
    }
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM todogreen_tms_webhook_events
        WHERE integration_id = 'tmw-all-int'`,
    ).first();
    expect(Number(row.total)).toBeGreaterThanOrEqual(amostras.length + 2);
  });

  it("projeta valores da encomenda para a base financeira TRACK3R", async () => {
    const r = await chamar("valores-encomendas", {
      data_hora_envio: "01/03/2024 15:21:19",
      codigo_encomenda: 501,
      codigo_produto: 8,
      descricao_produto: "Same Day",
      valor_mercadoria: 1500,
      peso: 12.5,
      frete: 120,
      taxa_ad_valorem: 3.5,
      taxa_gris: 2.4,
      taxa_pedagio: 18,
      icms: 14.4,
      frete_total: 158.3,
    });
    expect(r.status).toBe(200);

    const value = await env.DB.prepare(
      `SELECT * FROM todogreen_track3r_order_values
        WHERE integration_id='tmw-all-int' AND external_order_code='501'`,
    ).first();
    expect(value.product_description).toBe("Same Day");
    expect(Number(value.freight)).toBe(120);
    expect(Number(value.gris)).toBe(2.4);
    expect(Number(value.toll_fee)).toBe(18);
    expect(Number(value.total_freight)).toBe(158.3);

    const event = await env.DB.prepare(
      `SELECT status FROM todogreen_tms_webhook_events
        WHERE integration_id='tmw-all-int' AND event_type='valores-encomendas'
          AND external_ref='501' ORDER BY last_received_at DESC LIMIT 1`,
    ).first();
    expect(event.status).toBe("processed");
  });

  it("projeta fatura de cliente no contas a receber e no razão", async () => {
    await chamar("tomadores", {
      data_hora_envio: "01/07/2024 08:00:00",
      codigo_tomador: 700,
      nome: "Cliente Financeiro",
      fantasia: "Cliente Financeiro",
      cpf_cnpj: "12345678000190",
    });
    const r = await chamar("faturas", {
      data_hora_envio: "01/07/2024 08:21:00",
      codigo_fatura: 7001,
      codigo_tomador: 700,
      codigo_embarcador: 701,
      detalhes: {
        data_cobranca_inicial: "01/06/2024",
        data_cobranca_final: "30/06/2024",
        data_geracao: "30/06/2024 08:20:00",
        data_vencimento: "15/07/2024",
        valor: 2450.75,
        encomendas: [{ codigo_encomenda: 501, tipo: 1, descricao: "Entrega" }],
      },
    });
    expect(r.status).toBe(200);

    const title = await env.DB.prepare(
      `SELECT * FROM todogreen_financial_titles
        WHERE workspace_owner_id='tmw-all-user'
          AND json_extract(fields_json,'$.externalInvoiceId')='7001'`,
    ).first();
    expect(title.kind).toBe("receivable");
    expect(Number(title.original_amount)).toBe(2450.75);
    expect(title.due_date).toBe("2024-07-15");

    const entry = await env.DB.prepare(
      `SELECT * FROM todogreen_financial_entries WHERE id=?`,
    ).bind(`entry-${title.id}`).first();
    expect(entry.kind).toBe("revenue");
    expect(entry.category).toBe("track3r_faturamento");
    expect(entry.counterparty).toBe("Cliente Financeiro");
    expect(Number(entry.amount)).toBe(2450.75);
  });

  it("projeta faturas de motorista e rede terceira como custos sem duplicar reenvio", async () => {
    const driverPayload = {
      data_hora_envio: "24/06/2024 09:21:19",
      codigo_fatura: 8101,
      motorista_empresa: { codigo: 1, nome: "Motoristas XPTO", cnpj: "12345678000190" },
      motorista: { codigo: 2, nome: "João Felix", cpf: "00100200315" },
      detalhes: {
        tipo_operacao: 4,
        data_pagamento_inicial: "01/06/2024",
        data_pagamento_final: "30/06/2024",
        data_geracao: "24/06/2024 09:20:15",
        data_vencimento: "15/07/2024",
        valor: 190.5,
      },
      documentos: [{ codigo_lista: 1, codigo_encomenda: 501, valor: 190.5 }],
    };
    await chamar("faturas-motorista", driverPayload);
    await chamar("faturas-motorista", driverPayload);

    const driverRows = await env.DB.prepare(
      `SELECT * FROM todogreen_financial_entries
        WHERE workspace_owner_id='tmw-all-user'
          AND json_extract(fields_json,'$.externalInvoiceId')='8101'`,
    ).all();
    expect(driverRows.results).toHaveLength(1);
    expect(driverRows.results[0].kind).toBe("cost");
    expect(driverRows.results[0].category).toBe("track3r_motorista");
    expect(driverRows.results[0].counterparty).toBe("Motoristas XPTO");
    expect(Number(driverRows.results[0].amount)).toBe(190.5);

    const network = await chamar("faturas-rede-terceira", {
      data_hora_envio: "24/06/2024 09:21:19",
      codigo_fatura: 8201,
      unidade: { codigo: 1, nome: "Parceiro SP", sigla: "SAO", cnpj: "01169000000112" },
      detalhes: {
        data_pagamento_inicial: "01/06/2024",
        data_pagamento_final: "30/06/2024",
        data_geracao: "24/06/2024 09:21:19",
        data_vencimento: "15/07/2024",
        valor: 1900,
        encomendas: [{ codigo_encomenda: 501, valor: 1900 }],
      },
    });
    expect(network.status).toBe(200);
    const networkRow = await env.DB.prepare(
      `SELECT * FROM todogreen_financial_entries
        WHERE workspace_owner_id='tmw-all-user'
          AND json_extract(fields_json,'$.externalInvoiceId')='8201'`,
    ).first();
    expect(networkRow.category).toBe("track3r_rede_terceira");
    expect(networkRow.counterparty).toBe("Parceiro SP");
    expect(Number(networkRow.amount)).toBe(1900);
  });

  it("não grava com Token incorreto", async () => {
    const antes = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM todogreen_tms_webhook_events WHERE integration_id = 'tmw-all-int'",
    ).first();
    const r = await chamar("listas", { codigo_lista: 999 }, "token-errado");
    expect(r.status).toBe(401);
    const depois = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM todogreen_tms_webhook_events WHERE integration_id = 'tmw-all-int'",
    ).first();
    expect(Number(depois.total)).toBe(Number(antes.total));
  });

  it("recusa tipo inexistente em vez de aceitar payload ambíguo", async () => {
    const r = await chamar("qualquer-coisa", { id: 1 });
    expect(r.status).toBe(400);
  });
});
