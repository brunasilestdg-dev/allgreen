import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Receptor de ocorrências do TRACK3R (webhook de entrada).
//
// A especificação é do fornecedor: header `Token`, POST, JSON, uma ocorrência
// por chamada, resposta 200 {status:true} e 401 {status:false}. É a única rota
// pública da vertical que escreve — e por isso o que estes testes existem para
// impedir de voltar é, antes de tudo, de segurança:
//
//   • aceitar ocorrência sem segredo cadastrado ("liga agora, protege depois");
//   • aceitar Token errado, ou nenhum;
//   • o id da integração virar oráculo de quais integrações existem;
//   • ocorrência de um espaço aparecendo no outro;
//   • reenvio (o fornecedor repete quando não recebe 200) duplicando documento,
//     evento, incidente ou comprovante;
//   • ocorrência inventando operação que ninguém abriu;
//   • caminho de comprovante com esquema perigoso virando link na tela.

let n = 0;
const nextIp = () => `198.26.0.${(++n % 240) + 1}`;

const SEGREDO = "segredo-de-teste-do-track3r";
const comSegredo = () => ({ ...env, TODOGREEN_TRACK3R_WEBHOOK_SECRET: SEGREDO });
const semSegredo = () => ({ ...env, TODOGREEN_TRACK3R_WEBHOOK_SECRET: "" });

async function sha256(valor) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
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

async function autorizar(usuario, papel = "admin", permissoes = ["*"]) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'active', ?, '', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET role = excluded.role,
       permissions_json = excluded.permissions_json, status = 'active'`,
  ).bind(crypto.randomUUID(), usuario.email, papel, JSON.stringify(permissoes), usuario.id, agora, agora).run();
}

async function criarIntegracao(id, dono, { arquivada = false, envKey = "TODOGREEN_TRACK3R_WEBHOOK_SECRET" } = {}) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_tms_integrations
       (id, tenant_id, workspace_owner_id, provider, name, base_url, token_env_key,
        webhook_secret_env_key, auth_header_name, sync_mode, collections_path, invoices_path,
        field_map_json, polling_interval_minutes, status, last_sync_at, last_error,
        revision, created_by, updated_by, created_at, updated_at, archived_at)
     VALUES (?, 'todogreen', ?, 'track3r', 'TRACK3R', '', 'TODOGREEN_TRACK3R_API_TOKEN',
             ?, 'Authorization', 'webhook', '', '', '{}', 60, 'ativa', '', '',
             1, ?, ?, ?, ?, ?)`,
  ).bind(id, dono.id, envKey, dono.id, dono.id, agora, agora, arquivada ? agora : null).run();
  return id;
}

async function criarCliente(dono, id, nome, documento) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_clients
       (id, tenant_id, workspace_owner_id, name, legal_name, document, status,
        portal_enabled, created_by, updated_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, ?, 'ativo', 0, ?, ?, ?, ?)`,
  ).bind(id, dono.id, nome, nome, documento, dono.id, dono.id, agora, agora).run();
}

// A chamada do fornecedor: sem sessão, com o header Token.
const chamarWebhook = (integracaoId, corpo, { token = SEGREDO, ambiente = comSegredo(), metodo = "POST", cru } = {}) => {
  const headers = { "cf-connecting-ip": nextIp(), "content-type": "application/json" };
  if (token !== null) headers.Token = token;
  return worker.fetch(
    new Request(`https://app.test/api/todogreen/tms/webhook/${integracaoId}`, {
      method: metodo,
      headers,
      body: metodo === "GET" ? undefined : (cru !== undefined ? cru : JSON.stringify(corpo)),
    }),
    ambiente,
    { waitUntil() {}, passThroughOnException() {} },
  );
};

const pedirComSessao = (caminho, token) => worker.fetch(
  new Request(`https://app.test${caminho}`, {
    headers: { "cf-connecting-ip": nextIp(), authorization: `Bearer ${token}` },
  }),
  comSegredo(),
  { waitUntil() {}, passThroughOnException() {} },
);

const contarDocumentos = async (dono) => {
  const linha = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM todogreen_tms_documents WHERE workspace_owner_id = ?",
  ).bind(dono.id).first();
  return Number(linha?.total || 0);
};

// O modelo oficial do documento da titular, com os acentos corrigidos.
const ocorrencia = (extra = {}) => ({
  data_hora_envio: "01/03/2024 15:21:19",
  cnpj_transportadora: "89516147000142",
  cnpj_transportadora_unidade_origem: "11222333000101",
  cnpj_transportadora_unidade_destino: "11222333000101",
  cnpj_embarcador: extra.cnpjEmbarcador === undefined ? "05517785000198" : extra.cnpjEmbarcador,
  data_prevista: "01/03/2024",
  data_agendamento: "01/03/2024",
  encomenda: extra.encomenda || "22558899",
  nota_fiscal: {
    numero: "987654321",
    serie: "1",
    chave: "11112222333344445555666677778888999933335555",
    pedido: "PED123456",
    pedido_integracao: "PED_INT132456",
  },
  recebedor: { tipo: "PORTEIRO", nome: "JOÃO DA SILVA", documento: { tipo: "OUTROS", numero: "123465789X" } },
  motorista: { cpf: "99944455588", nome: "JOSÉ SILVA", placa: "ABH-1A99" },
  ocorrencia: {
    cnpj_transportadora_unidade_atual: "11222333000101",
    codigo: extra.codigo || "03",
    descricao: extra.descricao || "Entregue",
    data: extra.data || "01/03/2024 15:21:19",
    observacao: "Entregue",
    comprovante: { caminho: extra.comprovante === undefined ? "https://tms.exemplo/comprovante/1.jpg" : extra.comprovante },
    assinatura: { caminho: "https://tms.exemplo/assinatura/1.jpg" },
    latitude: -23.49532,
    longitude: -46.84704,
  },
});

let gestora;
let colega;
let integracao;
let integracaoDaColega;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();

  gestora = await criarUsuario("tmw-gestora", "gestora@tmw.test");
  colega = await criarUsuario("tmw-colega", "colega@tmw.test");
  await autorizar(gestora);
  await autorizar(colega);

  integracao = await criarIntegracao("tmw-int-1", gestora);
  integracaoDaColega = await criarIntegracao("tmw-int-2", colega);
  await criarCliente(gestora, "tmw-embarcador", "Embarcador do teste", "05517785000198");
});

describe("segurança do receptor", () => {
  it("sem o segredo no cofre, recusa e diz qual variável falta", async () => {
    const r = await chamarWebhook(integracao, ocorrencia(), { ambiente: semSegredo() });
    expect(r.status).toBe(503);
    const corpo = await r.json();
    expect(corpo.status).toBe(false);
    expect(corpo.descricao).toContain("TODOGREEN_TRACK3R_WEBHOOK_SECRET");
    expect(await contarDocumentos(gestora)).toBe(0);
  });

  it("Token errado é 401 e não grava nada", async () => {
    const antes = await contarDocumentos(gestora);
    const r = await chamarWebhook(integracao, ocorrencia(), { token: "errado" });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ status: false, descricao: "O Token informado é inválido!" });
    expect(await contarDocumentos(gestora)).toBe(antes);
  });

  it("sem header Token, a mesma recusa", async () => {
    const r = await chamarWebhook(integracao, ocorrencia(), { token: null });
    expect(r.status).toBe(401);
    expect((await r.json()).status).toBe(false);
  });

  it("integração inexistente responde igual a token inválido — o id não é oráculo", async () => {
    const r = await chamarWebhook("nao-existe-esse-id", ocorrencia());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ status: false, descricao: "O Token informado é inválido!" });
  });

  it("integração arquivada deixa de receber", async () => {
    await criarIntegracao("tmw-int-morta", gestora, { arquivada: true });
    const r = await chamarWebhook("tmw-int-morta", ocorrencia());
    expect(r.status).toBe(401);
  });

  it("a resposta nunca carrega o segredo nem o nome do token enviado", async () => {
    const r = await chamarWebhook(integracao, ocorrencia(), { token: "outro-errado" });
    const texto = await r.text();
    expect(texto).not.toContain(SEGREDO);
    expect(texto).not.toContain("outro-errado");
  });

  it("GET no caminho do webhook não é aceito", async () => {
    const r = await chamarWebhook(integracao, null, { metodo: "GET" });
    expect(r.status).toBe(405);
  });

  it("corpo que não é JSON é recusado sem gravar", async () => {
    const antes = await contarDocumentos(gestora);
    const r = await chamarWebhook(integracao, null, { cru: "isto não é json" });
    expect(r.status).toBe(400);
    expect(await contarDocumentos(gestora)).toBe(antes);
  });
});

describe("gravação da ocorrência", () => {
  it("aceita sem sessão nenhuma, com o corpo que o fornecedor espera", async () => {
    const r = await chamarWebhook(integracao, ocorrencia());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: true, descricao: "Recebido com sucesso!" });

    const linha = await env.DB.prepare(
      "SELECT * FROM todogreen_tms_documents WHERE workspace_owner_id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(gestora.id).first();
    expect(linha.origem).toBe("webhook");
    expect(linha.kind).toBe("ocorrencia");
    expect(linha.order_ref).toBe("22558899");
    expect(linha.occurrence_code).toBe("03");
    expect(linha.status).toBe("Entregue");
    expect(linha.invoice_number).toBe("987654321");
    // O embarcador casa por CNPJ, nunca por nome.
    expect(linha.client_id).toBe("tmw-embarcador");
    // O payload guardado é o original inteiro, para reprocessar depois.
    expect(JSON.parse(linha.payload_json).recebedor.nome).toBe("JOÃO DA SILVA");
  });

  it("reenvio do mesmo evento não duplica — vira atualização", async () => {
    const antes = await contarDocumentos(gestora);
    const r = await chamarWebhook(integracao, ocorrencia());
    expect(r.status).toBe(200);
    expect(await contarDocumentos(gestora)).toBe(antes);
    const linha = await env.DB.prepare(
      "SELECT revision FROM todogreen_tms_documents WHERE workspace_owner_id = ? AND order_ref = '22558899' AND occurrence_code = '03'",
    ).bind(gestora.id).first();
    expect(Number(linha.revision)).toBeGreaterThan(1);
  });

  it("outra ocorrência da MESMA encomenda entra como linha nova — é o histórico", async () => {
    const antes = await contarDocumentos(gestora);
    const r = await chamarWebhook(integracao, ocorrencia({
      codigo: "01", descricao: "Em trânsito", data: "28/02/2024 08:00:00",
    }));
    expect(r.status).toBe(200);
    expect(await contarDocumentos(gestora)).toBe(antes + 1);
    const linhas = await env.DB.prepare(
      "SELECT occurrence_code FROM todogreen_tms_documents WHERE workspace_owner_id = ? AND order_ref = '22558899' ORDER BY occurrence_code",
    ).bind(gestora.id).all();
    expect((linhas.results || []).map((item) => item.occurrence_code)).toEqual(["01", "03"]);
  });

  it("N.4a: a ocorrência aplicada à operação ganha chave de idempotência e não duplica evento no ledger", async () => {
    const opId = `n4a-op-${crypto.randomUUID()}`;
    const agora = new Date().toISOString();
    // Operação já existente (o webhook não abre operação — só vira evento de uma
    // que já foi projetada). Colunas reais, espelhando o INSERT da projeção.
    await env.DB.prepare(
      `INSERT INTO todogreen_client_operations
         (id,tenant_id,workspace_owner_id,client_id,product_id,contract_id,reference,status,service_date,
          origin,destination,fields_json,sla_status,incident_count,promised_at,delivered_at,eta_at,
          vehicle_plate,driver_name,distance_km,revision,created_by,updated_by,created_at,updated_at,archived_at)
       VALUES (?, 'todogreen', ?, 'tmw-embarcador','','','OP-N4A','active','2026-03-01','A','B','{}','',0,NULL,NULL,NULL,'','',0,1,?,?,?,?,NULL)`,
    ).bind(opId, gestora.id, gestora.id, gestora.id, agora, agora).run();

    const oc = ocorrencia({ encomenda: "N4A-DEDUP", codigo: "07", descricao: "Em trânsito", data: "01/03/2024 09:00:00" });
    // 1ª: cria o staging, mas a remessa ainda não tem operação projetada → evento não entra.
    await chamarWebhook(integracao, oc);
    // Liga o documento à operação (o que a projeção faria).
    await env.DB.prepare(
      "UPDATE todogreen_tms_documents SET operation_id = ? WHERE workspace_owner_id = ? AND order_ref = 'N4A-DEDUP'",
    ).bind(opId, gestora.id).run();
    // 2ª e 3ª da MESMA ocorrência: aplica UMA vez; a repetição dedup pela chave 'ocr:<hash>'.
    await chamarWebhook(integracao, oc);
    await chamarWebhook(integracao, oc);

    const { results } = await env.DB.prepare(
      "SELECT idempotency_key FROM todogreen_client_operation_events WHERE operation_id = ?",
    ).bind(opId).all();
    expect((results || []).length).toBe(1);
    expect(String(results[0].idempotency_key)).toMatch(/^ocr:/);
  });

  it("embarcador sem conta no espaço entra na fila, sem inventar cliente", async () => {
    await chamarWebhook(integracao, ocorrencia({
      encomenda: "99001122", cnpjEmbarcador: "11444777000161", codigo: "03",
    }));
    const linha = await env.DB.prepare(
      "SELECT client_id FROM todogreen_tms_documents WHERE workspace_owner_id = ? AND order_ref = '99001122'",
    ).bind(gestora.id).first();
    expect(linha.client_id).toBe("");
    const clientes = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM todogreen_clients WHERE workspace_owner_id = ?",
    ).bind(gestora.id).first();
    expect(Number(clientes.total)).toBe(1);
  });

  it("comprovante com esquema perigoso não vira link", async () => {
    await chamarWebhook(integracao, ocorrencia({
      encomenda: "77001", comprovante: "javascript:alert(1)", codigo: "03",
    }));
    const linha = await env.DB.prepare(
      "SELECT payload_json FROM todogreen_tms_documents WHERE workspace_owner_id = ? AND order_ref = '77001'",
    ).bind(gestora.id).first();
    // O payload cru guarda o que veio (é evidência), mas o campo normalizado
    // que a tela usa fica vazio — é o que impede o link de existir.
    expect(linha).toBeTruthy();
    const documentos = await (await pedirComSessao("/api/todogreen/tms/documentos", gestora.token)).json();
    const alvo = (documentos.documentos || []).find((item) => item.orderRef === "77001" || item.externalId === "");
    if (alvo) expect(JSON.stringify(alvo)).not.toContain("javascript:");
  });

  it("ocorrência sem nada que a identifique é ignorada, mas responde 200", async () => {
    const antes = await contarDocumentos(gestora);
    const r = await chamarWebhook(integracao, { ocorrencia: { descricao: "" } });
    // 200 de propósito: o fornecedor não deve reenviar para sempre algo que
    // nunca vai entrar.
    expect(r.status).toBe(200);
    expect(await contarDocumentos(gestora)).toBe(antes);
  });
});

describe("isolamento entre espaços", () => {
  it("a ocorrência do espaço da gestora não aparece para a colega", async () => {
    const daColega = await (await pedirComSessao("/api/todogreen/tms/documentos", colega.token)).json();
    expect((daColega.documentos || []).length).toBe(0);
  });

  it("cada integração escreve no espaço da sua dona", async () => {
    await chamarWebhook(integracaoDaColega, ocorrencia({ encomenda: "COLEGA-1" }));
    const daColega = await env.DB.prepare(
      "SELECT workspace_owner_id FROM todogreen_tms_documents WHERE order_ref = 'COLEGA-1'",
    ).first();
    expect(daColega.workspace_owner_id).toBe(colega.id);
    const naGestora = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM todogreen_tms_documents WHERE workspace_owner_id = ? AND order_ref = 'COLEGA-1'",
    ).bind(gestora.id).first();
    expect(Number(naGestora.total)).toBe(0);
  });
});
