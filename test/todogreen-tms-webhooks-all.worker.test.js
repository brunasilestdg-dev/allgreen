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
    expect(row.status).toBe("received");
    expect(JSON.parse(row.payload_json).document.numero).toBe("12345678");
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
