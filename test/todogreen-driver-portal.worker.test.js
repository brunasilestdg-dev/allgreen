import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// O portal do motorista tem UMA pergunta de segurança: a pessoa logada
// consegue ver ou tocar uma viagem que não é dela? A resposta precisa ser
// não por construção — o recorte é o driver_id da operação (0070), nunca a
// tela.

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

let n = 0;
const pedir = (caminho, { method = "GET", token, body } = {}) =>
  worker.fetch(new Request(`https://app.test${caminho}`, {
    method,
    headers: {
      "cf-connecting-ip": `198.51.100.${(++n % 240) + 1}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, { waitUntil() {}, passThroughOnException() {} });

const criarUsuario = async (id, email) => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)",
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)",
  ).bind(`ses-${id}`, id, await sha256(`tok-${id}`), agora).run();
  return { id, email, token: `tok-${id}` };
};

const autorizar = async (email, role) => {
  const agora = new Date().toISOString();
  // A lista explícita do vínculo é a autoridade no worker — o teste grava a
  // lista do papel, como a tela de acessos faz.
  const permissoes = role === "admin" ? '["*"]' : '["driver:self","driver:event"]';
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,'active',?,'','dp-dono',?,?)`,
  ).bind(crypto.randomUUID(), email, role, permissoes, agora, agora).run();
};

let dona;
let joao;
let maria;
let semCadastro;

beforeAll(async () => {
  const agora = new Date().toISOString();
  dona = await criarUsuario("dp-dono", "dona@todogreen.com.br");
  await autorizar(dona.email, "admin");

  joao = await criarUsuario("dp-joao", "joao@motorista.com.br");
  maria = await criarUsuario("dp-maria", "maria@motorista.com.br");
  semCadastro = await criarUsuario("dp-solto", "solto@motorista.com.br");
  for (const pessoa of [joao, maria, semCadastro]) await autorizar(pessoa.email, "motorista");

  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id,tenant_id,workspace_owner_id,name,status,portal_enabled,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('dp-cli','todogreen','dp-dono','Cliente Rota','ativo',0,'{}',1,'dp-dono','dp-dono',?,?)`,
  ).bind(agora, agora).run();

  // Cadastro mestre de motoristas com e-mail de acesso (0070). CNH da Maria
  // está para vencer: o portal precisa avisar.
  for (const [id, nome, email, cnh] of [
    ["drv-joao", "João da Estrada", joao.email, "2030-01-01"],
    ["drv-maria", "Maria do Volante", maria.email, new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)],
  ]) {
    await env.DB.prepare(
      `INSERT INTO todogreen_drivers
         (id,tenant_id,workspace_owner_id,driver_code,full_name,document,employment_type,
          availability_status,cnh_number,cnh_category,cnh_expires_at,status,user_email,
          fields_json,revision,created_by,updated_by,created_at,updated_at)
       VALUES (?,'todogreen','dp-dono',?,?,?,'employee','available','123','E',?,'active',?,
          '{}',1,'dp-dono','dp-dono',?,?)`,
    ).bind(id, id.toUpperCase(), nome, `000000000${id.length}`, cnh, email, agora, agora).run();
  }

  // Duas viagens do João, uma da Maria — e uma OS amarrada à viagem do João
  // para provar que a entrega da rua gera o POD do faturamento.
  for (const [id, ref, driverId] of [
    ["op-j1", "ROTA-J1", "drv-joao"],
    ["op-j2", "ROTA-J2", "drv-joao"],
    ["op-m1", "ROTA-M1", "drv-maria"],
  ]) {
    await env.DB.prepare(
      `INSERT INTO todogreen_client_operations
         (id,tenant_id,client_id,workspace_owner_id,reference,status,service_date,origin,destination,
          driver_id,fields_json,created_by,updated_by,created_at,updated_at)
       VALUES (?,'todogreen','dp-cli','dp-dono',?,'active','2026-08-26','CD Osasco','Loja Centro',?,
          '{}','dp-dono','dp-dono',?,?)`,
    ).bind(id, ref, driverId, agora, agora).run();
  }
  await env.DB.prepare(
    `INSERT INTO todogreen_contracts
       (id,tenant_id,workspace_owner_id,client_id,client_name,proposal_id,title,status,signature_status,
        approval_status,service_id,price_table_id,sla_json,commercial_terms_json,taxes_json,billing_rules_json,
        fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('dp-contrato','todogreen','dp-dono','dp-cli','Cliente Rota','p','Contrato','active','signed',
        'approved','','','{}','{}','{}','{}','{}',1,'dp-dono','dp-dono',?,?)`,
  ).bind(agora, agora).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_service_orders
       (id,tenant_id,workspace_owner_id,number,client_id,contract_id,operation_id,service_id,price_table_id,
        status,requested_at,origin_json,destination_json,quantity,charge_unit,unit_price,gross_amount,
        discount_amount,tax_amount,net_amount,sla_json,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('os-j1','todogreen','dp-dono','OS-J1','dp-cli','dp-contrato','op-j1','','',
        'in_progress',?,'{}','{}',1,'viagem',100,100,0,0,100,'{}','{}',1,'dp-dono','dp-dono',?,?)`,
  ).bind(agora, agora, agora).run();
});

describe("sessão do motorista", () => {
  it("sem cadastro ligado ao e-mail, avisa em vez de mostrar dado alheio", async () => {
    const r = await (await pedir("/api/todogreen/driver-portal/sessao", { token: semCadastro.token })).json();
    expect(r.vinculado).toBe(false);
    expect(r.aviso).toMatch(/cadastro de motorista/i);
  });

  it("com cadastro, resolve pelo e-mail e avisa CNH a vencer", async () => {
    const r = await (await pedir("/api/todogreen/driver-portal/sessao", { token: maria.token })).json();
    expect(r.vinculado).toBe(true);
    expect(r.motorista.nome).toBe("Maria do Volante");
    expect(r.motorista.cnhAlerta).toMatch(/vence em/i);
  });
});

describe("minhas viagens são só as minhas", () => {
  it("cada motorista vê o próprio recorte", async () => {
    const doJoao = await (await pedir("/api/todogreen/driver-portal/viagens", { token: joao.token })).json();
    expect(doJoao.viagens.map((v) => v.referencia).sort()).toEqual(["ROTA-J1", "ROTA-J2"]);
    const daMaria = await (await pedir("/api/todogreen/driver-portal/viagens", { token: maria.token })).json();
    expect(daMaria.viagens.map((v) => v.referencia)).toEqual(["ROTA-M1"]);
  });

  it("evento na viagem de outro motorista responde 404", async () => {
    const r = await pedir("/api/todogreen/driver-portal/viagens/op-m1/evento", {
      method: "POST", token: joao.token, body: { tipo: "chegada" },
    });
    expect(r.status).toBe(404);
  });

  it("o papel motorista não alcança o resto da vertical", async () => {
    expect((await pedir("/api/todogreen/records/operations", { token: joao.token })).status).toBe(403);
    expect((await pedir("/api/todogreen/payroll/colaboradores", { token: joao.token })).status).toBe(403);
  });
});

describe("a entrega da rua fecha o ciclo", () => {
  it("registra entrega com recebedor, GPS e comprovante — e o POD da OS nasce", async () => {
    const r = await pedir("/api/todogreen/driver-portal/viagens/op-j1/evento", {
      method: "POST", token: joao.token,
      body: {
        tipo: "entrega", recebedor: "Portaria Central",
        comprovanteUrl: "https://exemplo.test/canhoto-j1.jpg",
        latitude: -23.55, longitude: -46.63,
      },
    });
    expect(r.status).toBe(201);
    const dados = await r.json();
    expect(dados.viagem.entregueEm).toBeTruthy();
    expect(dados.viagem.comprovanteRegistrado).toBe(true);

    const pod = await env.DB.prepare(
      "SELECT * FROM todogreen_proofs_of_delivery WHERE service_order_id = 'os-j1'",
    ).first();
    expect(pod).toBeTruthy();
    expect(pod.recipient_name).toBe("Portaria Central");
    expect(pod.latitude).toBeCloseTo(-23.55);
    expect(pod.document_url).toContain("canhoto-j1");
  });

  it("ocorrência incrementa o contador da operação", async () => {
    const r = await pedir("/api/todogreen/driver-portal/viagens/op-j2/evento", {
      method: "POST", token: joao.token,
      body: { tipo: "ocorrencia", descricao: "Destinatário ausente" },
    });
    expect(r.status).toBe(201);
    const linha = await env.DB.prepare(
      "SELECT incident_count FROM todogreen_client_operations WHERE id = 'op-j2'",
    ).first();
    expect(linha.incident_count).toBe(1);
  });
});

// #132 — a fila offline reenvia com uma chave estável por gesto. O reenvio não
// pode gravar o mesmo evento duas vezes (nem notificar o cliente de novo).
describe("idempotência da fila offline do motorista", () => {
  const contarEventos = (opId, chave) =>
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM todogreen_client_operation_events WHERE operation_id = ? AND idempotency_key = ?",
    ).bind(opId, chave).first().then((r) => r.n);

  it("reenvio com a mesma chave devolve o evento já gravado (200) e não duplica", async () => {
    const corpo = { tipo: "chegada", descricao: "Cheguei na loja", idempotencyKey: "idem-m1-A" };
    const primeira = await pedir("/api/todogreen/driver-portal/viagens/op-m1/evento", {
      method: "POST", token: maria.token, body: corpo,
    });
    expect(primeira.status).toBe(201);
    const idPrimeira = (await primeira.json()).evento.id;

    const reenvio = await pedir("/api/todogreen/driver-portal/viagens/op-m1/evento", {
      method: "POST", token: maria.token, body: corpo,
    });
    expect(reenvio.status).toBe(200);
    const dados = await reenvio.json();
    expect(dados.duplicada).toBe(true);
    // Devolve exatamente o mesmo evento — não um novo.
    expect(dados.evento.id).toBe(idPrimeira);

    expect(await contarEventos("op-m1", "idem-m1-A")).toBe(1);
  });

  it("chave diferente é um gesto diferente e grava normalmente", async () => {
    const r = await pedir("/api/todogreen/driver-portal/viagens/op-m1/evento", {
      method: "POST", token: maria.token,
      body: { tipo: "ocorrencia", descricao: "Portão fechado", idempotencyKey: "idem-m1-B" },
    });
    expect(r.status).toBe(201);
    expect(await contarEventos("op-m1", "idem-m1-B")).toBe(1);
    // A chave A continua com um único evento — a B não a tocou.
    expect(await contarEventos("op-m1", "idem-m1-A")).toBe(1);
  });
});

// #120b — a entrega carrega FOTO do canhoto e ASSINATURA capturadas no celular,
// como imagem reduzida (data URL). O servidor guarda no cofre e o comprovante
// passa a apontar para o download do cofre — não mais um link colado.
describe("POD do motorista: foto e assinatura capturadas", () => {
  // 1x1 GIF transparente — imagem mínima válida.
  const IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  beforeAll(async () => {
    const agora = new Date().toISOString();
    // Viagem nova (não entregue) do João + OS amarrada, para provar o POD.
    await env.DB.prepare(
      `INSERT INTO todogreen_client_operations
         (id,tenant_id,client_id,workspace_owner_id,reference,status,service_date,origin,destination,
          driver_id,fields_json,created_by,updated_by,created_at,updated_at)
       VALUES ('op-cap','todogreen','dp-cli','dp-dono','ROTA-CAP','active','2026-08-27','CD Osasco','Loja Sul','drv-joao',
          '{}','dp-dono','dp-dono',?,?)`,
    ).bind(agora, agora).run();
    await env.DB.prepare(
      `INSERT INTO todogreen_service_orders
         (id,tenant_id,workspace_owner_id,number,client_id,contract_id,operation_id,service_id,price_table_id,
          status,requested_at,origin_json,destination_json,quantity,charge_unit,unit_price,gross_amount,
          discount_amount,tax_amount,net_amount,sla_json,fields_json,revision,created_by,updated_by,created_at,updated_at)
       VALUES ('os-cap','todogreen','dp-dono','OS-CAP','dp-cli','dp-contrato','op-cap','','',
          'in_progress',?,'{}','{}',1,'viagem',100,100,0,0,100,'{}','{}',1,'dp-dono','dp-dono',?,?)`,
    ).bind(agora, agora, agora).run();
  });

  it("guarda foto e assinatura no cofre e aponta o comprovante para o download", async () => {
    const r = await pedir("/api/todogreen/driver-portal/viagens/op-cap/evento", {
      method: "POST", token: joao.token,
      body: {
        tipo: "entrega", recebedor: "Dona Rosa",
        comprovanteBase64: IMG, assinaturaBase64: IMG,
        latitude: -23.6, longitude: -46.7, idempotencyKey: "cap-1",
      },
    });
    expect(r.status).toBe(201);
    const dados = await r.json();
    expect(dados.viagem.comprovanteRegistrado).toBe(true);

    // A operação aponta para o cofre — foto e assinatura em arquivos distintos.
    const op = await env.DB.prepare(
      "SELECT proof_url, signature_url FROM todogreen_client_operations WHERE id='op-cap'",
    ).first();
    expect(op.proof_url).toMatch(/^\/api\/todogreen\/file-vault\/[^/]+\/download$/);
    expect(op.signature_url).toMatch(/^\/api\/todogreen\/file-vault\/[^/]+\/download$/);
    expect(op.proof_url).not.toBe(op.signature_url);

    // Os bytes foram mesmo guardados, escopados à operação (contexto).
    const arquivos = await env.DB.prepare(
      "SELECT context_type, context_id, content_type FROM todogreen_internal_files WHERE context_id='op-cap' ORDER BY created_at",
    ).all();
    expect(arquivos.results.length).toBe(2);
    expect(arquivos.results.every((a) => a.context_type === "operation_proof")).toBe(true);
    expect(arquivos.results.every((a) => a.content_type === "image/gif")).toBe(true);

    // O POD do faturamento nasce com foto e assinatura.
    const pod = await env.DB.prepare(
      "SELECT document_url, signature_url, recipient_name FROM todogreen_proofs_of_delivery WHERE service_order_id='os-cap'",
    ).first();
    expect(pod.recipient_name).toBe("Dona Rosa");
    expect(pod.document_url).toBe(op.proof_url);
    expect(pod.signature_url).toBe(op.signature_url);
  });

  it("reenvio com a mesma chave NÃO guarda a imagem de novo (dedup antes de gravar)", async () => {
    const reenvio = await pedir("/api/todogreen/driver-portal/viagens/op-cap/evento", {
      method: "POST", token: joao.token,
      body: { tipo: "entrega", recebedor: "Dona Rosa", comprovanteBase64: IMG, assinaturaBase64: IMG, idempotencyKey: "cap-1" },
    });
    expect(reenvio.status).toBe(200);
    // Continua com só os dois arquivos do primeiro envio — o reenvio não dobrou.
    const arquivos = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM todogreen_internal_files WHERE context_id='op-cap'",
    ).first();
    expect(arquivos.n).toBe(2);
  });

  it("recusa (400) uma entrega com 'imagem' que não é imagem", async () => {
    await env.DB.prepare(
      `INSERT INTO todogreen_client_operations
         (id,tenant_id,client_id,workspace_owner_id,reference,status,service_date,origin,destination,
          driver_id,fields_json,created_by,updated_by,created_at,updated_at)
       VALUES ('op-cap2','todogreen','dp-cli','dp-dono','ROTA-CAP2','active','2026-08-27','A','B','drv-joao',
          '{}','dp-dono','dp-dono',?,?)`,
    ).bind(new Date().toISOString(), new Date().toISOString()).run();
    const r = await pedir("/api/todogreen/driver-portal/viagens/op-cap2/evento", {
      method: "POST", token: joao.token,
      body: { tipo: "entrega", recebedor: "X", comprovanteBase64: "data:application/pdf;base64,JVBERi0=" },
    });
    expect(r.status).toBe(400);
    // Não entregou pela metade: sem comprovante gravado.
    const op = await env.DB.prepare("SELECT delivered_at FROM todogreen_client_operations WHERE id='op-cap2'").first();
    expect(op.delivered_at).toBeFalsy();
  });
});

describe("rota do dia atribuída ao motorista (#139)", () => {
  const paradas = [
    { ordem: 1, rotulo: "CD Osasco, SP", lat: -23.5, lng: -46.7, recarga: false, concluida: false },
    { ordem: 2, rotulo: "Loja Centro, SP", lat: -23.55, lng: -46.63, recarga: true, concluida: false },
  ];

  const criarRota = (driverId, token) =>
    pedir("/api/todogreen/records/rotas", {
      method: "POST",
      token,
      body: {
        nome: `Rota ${driverId}`,
        motoristaId: driverId,
        motorista: "Motorista",
        dataServico: "2026-08-26",
        origem: paradas[0].rotulo,
        destino: paradas[1].rotulo,
        distanciaKm: 12,
        paradas,
      },
    });

  it("a operação cria a rota e o motorista dono a enxerga; o outro não", async () => {
    const criacao = await criarRota("drv-joao", dona.token);
    expect(criacao.status).toBe(201);

    const doJoao = await (await pedir("/api/todogreen/driver-portal/rotas", { token: joao.token })).json();
    expect(doJoao.rotas.map((r) => r.nome)).toContain("Rota drv-joao");
    const daMaria = await (await pedir("/api/todogreen/driver-portal/rotas", { token: maria.token })).json();
    expect(daMaria.rotas.map((r) => r.nome)).not.toContain("Rota drv-joao");
  });

  it("marcar parada recalcula o status (planejada → em rota → concluída)", async () => {
    const criacao = await (await criarRota("drv-joao", dona.token)).json();
    const rotaId = criacao.registro.id;

    const parcial = await (await pedir(`/api/todogreen/driver-portal/rotas/${rotaId}/parada`, {
      method: "POST", token: joao.token, body: { indice: 0, concluida: true },
    })).json();
    expect(parcial.rota.status).toBe("em_rota");
    expect(parcial.rota.paradas[0].concluida).toBe(true);

    const total = await (await pedir(`/api/todogreen/driver-portal/rotas/${rotaId}/parada`, {
      method: "POST", token: joao.token, body: { indice: 1, concluida: true },
    })).json();
    expect(total.rota.status).toBe("concluida");
  });

  it("marcar parada de rota de outro motorista responde 404", async () => {
    const criacao = await (await criarRota("drv-joao", dona.token)).json();
    const r = await pedir(`/api/todogreen/driver-portal/rotas/${criacao.registro.id}/parada`, {
      method: "POST", token: maria.token, body: { indice: 0, concluida: true },
    });
    expect(r.status).toBe(404);
  });
});
