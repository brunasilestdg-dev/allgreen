import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// A aprovação comercial era um aviso: a tela dizia "precisa de aprovação comercial" e a
// simulação era salva do mesmo jeito. Estes testes existem para que ele volte a
// ser aviso só por cima do cadáver de um deles.

let n = 0;
const nextIp = () => `198.20.0.${(++n % 240) + 1}`;

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

// Aprovação é coisa de time, então os três precisam estar no MESMO espaço de
// trabalho — que é o que `tenant_users.workspace_owner_id` significa. Autorizar
// cada um por e-mail avulso daria a cada pessoa o próprio espaço, e o pedido do
// vendedor simplesmente não existiria para o chefe.
async function vincular(usuario, papel, permissoes, donoDoEspaco) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO tenant_users
       (id, tenant_id, workspace_owner_id, user_id, role, status, permissions_json, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, user_id) DO UPDATE SET role = excluded.role,
       permissions_json = excluded.permissions_json, status = 'active'`,
  )
    .bind(crypto.randomUUID(), donoDoEspaco, usuario.id, papel, JSON.stringify(permissoes), agora, agora)
    .run();
}

const pedir = (caminho, { metodo = "GET", token, corpo } = {}) => {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${caminho}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
};

let vendedor;
let chefe;
let dona;
const JUSTIFICATIVA = "Cliente estratégico com volume garantido por 24 meses e entrada em nova região.";

// Cria a simulação direto no banco: aqui o assunto é a aprovação, não o
// caminho da calculadora, que já tem teste próprio.
async function cenario({ margem = 15, preco = 300000, dono, espaco, clienteId = "cli-1" } = {}) {
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO pricing_scenarios
       (id, tenant_id, workspace_owner_id, product_id, client_id, opportunity_id, created_by,
        rule_version, inputs_json, result_json, approvals_json, premises_json, status, created_at)
     VALUES (?, 'todogreen', ?, 'middle-mile', ?, '', ?, 'v1', '{}', ?, '{}', '{}', 'draft', ?)`,
  )
    .bind(
      id,
      espaco || dona.id,
      clienteId,
      dono.id,
      JSON.stringify({
        marginPercent: margem,
        recommendedPrice: preco,
        approval: { required: true, triggers: ["margem abaixo do piso"] },
      }),
      agora,
    )
    .run();
  return id;
}

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();

  // todogreen_pricing_parameters.created_by referencia users(id) desde a
  // migração 0086 (isolamento por workspace) — precisa existir de verdade.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES ('dd-seed', 'Seed', 'seed@parceiro.com.br', 'h', 's', ?)`,
  ).bind(agora).run();

  // Régua vigente: piso de 18%. É contra ela que o desvio é medido.
  await env.DB.prepare(
    `INSERT OR REPLACE INTO todogreen_pricing_parameters
       (version, tenant_id, parameters_json, change_summary, justification, responsible,
        effective_from, effective_to, status, created_by, created_at)
     VALUES ('dd-v1', 'todogreen', ?, '', '', 'teste', ?, NULL, 'active', 'dd-seed', ?)`,
  )
    .bind(JSON.stringify({ minimumMarginPercent: 18, targetMarginPercent: 26 }), agora, agora)
    .run();

  dona = await criarUsuario("dd-dona", "dona@parceiro.com.br");
  vendedor = await criarUsuario("dd-vendedor", "vendedor@parceiro.com.br");
  chefe = await criarUsuario("dd-chefe", "chefe@parceiro.com.br");

  // Um espaço só, o da dona. É assim que um time comercial de verdade opera.
  await vincular(dona, "owner", ["*"], dona.id);
  await vincular(vendedor, "vendedor", ["pricing:simulate"], dona.id);
  await vincular(chefe, "lideranca_comercial", ["pricing:simulate", "deal:approve"], dona.id);
});

describe("abrir o pedido", () => {
  it("a alçada, o desvio e o prazo saem do resultado gravado, não do corpo do pedido", async () => {
    const id = await cenario({ margem: 16, preco: 200000, dono: vendedor });
    const r = await pedir("/api/todogreen/deal-desk", {
      metodo: "POST",
      token: vendedor.token,
      // Tentando escolher a própria alçada.
      corpo: { cenarioId: id, justificativa: JUSTIFICATIVA, alcadaId: "gestao_comercial", desvioPontos: 0 },
    });
    expect(r.status).toBe(201);
    const { pedido } = await r.json();
    expect(pedido.desvioPontos).toBe(2);
    expect(pedido.alcadaId).toBe("gestao_comercial");
    expect(pedido.situacao).toBe("pendente");
    expect(pedido.versao).toBe(1);
    expect(pedido.prazoEm).toBeTruthy();
    // A simulação nasce com "margem abaixo do piso"; sem evidência vinculada
    // no cofre, o próprio abrir() acrescenta o segundo gatilho.
    expect(pedido.gatilhos).toEqual(["margem abaixo do piso", "Operação sem evidência suficiente"]);
  });

  it("desvio grande sobe a alçada sozinho", async () => {
    // 11% contra um piso de 18% é desvio de 7 pontos: passa da gestão
    // comercial (3) e para na diretoria (8).
    const id = await cenario({ margem: 11, preco: 200000, dono: vendedor });
    const { pedido } = await (
      await pedir("/api/todogreen/deal-desk", {
        metodo: "POST",
        token: vendedor.token,
        corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
      })
    ).json();
    expect(pedido.alcadaId).toBe("diretoria");
    expect(pedido.desvioPontos).toBe(7);
  });

  it("justificativa curta não abre pedido", async () => {
    const id = await cenario({ dono: vendedor });
    const r = await pedir("/api/todogreen/deal-desk", {
      metodo: "POST",
      token: vendedor.token,
      corpo: { cenarioId: id, justificativa: "urgente" },
    });
    expect(r.status).toBe(400);
  });

  it("simulação de outro espaço responde 404", async () => {
    const foraDoTime = await criarUsuario("dd-fora", "fora@outraempresa.com.br");
    await vincular(foraDoTime, "admin", ["*"], foraDoTime.id);
    const id = await cenario({ dono: foraDoTime, espaco: foraDoTime.id });
    const r = await pedir("/api/todogreen/deal-desk", {
      metodo: "POST",
      token: vendedor.token,
      corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
    });
    expect(r.status).toBe(404);
  });

  it("dois pedidos pendentes para a mesma simulação não convivem", async () => {
    const id = await cenario({ dono: vendedor });
    await pedir("/api/todogreen/deal-desk", {
      metodo: "POST",
      token: vendedor.token,
      corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
    });
    const segunda = await pedir("/api/todogreen/deal-desk", {
      metodo: "POST",
      token: vendedor.token,
      corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
    });
    expect(segunda.status).toBe(409);
  });

  it("marca 'Operação sem evidência suficiente' quando o cofre está vazio para a simulação", async () => {
    const id = await cenario({ dono: vendedor });
    const { pedido } = await (
      await pedir("/api/todogreen/deal-desk", {
        metodo: "POST",
        token: vendedor.token,
        corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
      })
    ).json();
    expect(pedido.gatilhos).toContain("Operação sem evidência suficiente");
  });

  it("não marca o gatilho de evidência quando há documento ativo vinculado", async () => {
    const clienteId = crypto.randomUUID();
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_clients
         (id, tenant_id, workspace_owner_id, name, legal_name, document, segment, status,
          portal_enabled, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'Distribuidora Gama', 'Gama LTDA', '', 'varejo', 'ativo', 1, ?, ?, ?, ?)`,
    ).bind(clienteId, dona.id, dona.id, dona.id, agora, agora).run();

    const id = await cenario({ dono: vendedor, clienteId });
    await env.DB.prepare(
      `INSERT INTO todogreen_evidences
         (id, tenant_id, client_id, workspace_owner_id, tipo, titulo, referencia, descricao,
          emitido_em, arquivo_url, arquivo_nome, arquivo_bytes, hash_conteudo, calculo_id,
          status, created_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, ?, 'nota_fiscal', 'NF de apoio', '', '', ?, 'https://x', 'x.pdf', 10,
               'hash', ?, 'ativo', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), clienteId, dona.id, agora, id, dona.id, agora, agora)
      .run();

    const { pedido } = await (
      await pedir("/api/todogreen/deal-desk", {
        metodo: "POST",
        token: vendedor.token,
        corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
      })
    ).json();
    expect(pedido.gatilhos).not.toContain("Operação sem evidência suficiente");
  });
});

describe("decidir", () => {
  const abrir = async (opcoes = {}) => {
    const id = await cenario({ dono: vendedor, ...opcoes });
    const { pedido } = await (
      await pedir("/api/todogreen/deal-desk", {
        metodo: "POST",
        token: vendedor.token,
        corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
      })
    ).json();
    return pedido;
  };

  it("quem pede não decide o próprio pedido, nem chamando a API direto", async () => {
    const pedido = await abrir();
    const r = await pedir(`/api/todogreen/deal-desk/${pedido.id}/decisao`, {
      metodo: "POST",
      token: vendedor.token,
      corpo: { decisao: "aprovar", justificativa: "eu mesmo aprovo" },
    });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/Quem pede não decide/);
  });

  it("papel abaixo da alçada não decide", async () => {
    // Desvio de 7 pontos exige diretoria; liderança comercial não alcança.
    const pedido = await abrir({ margem: 11 });
    expect(pedido.alcadaId).toBe("diretoria");
    const r = await pedir(`/api/todogreen/deal-desk/${pedido.id}/decisao`, {
      metodo: "POST",
      token: chefe.token,
      corpo: { decisao: "aprovar", justificativa: "vamos nessa" },
    });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/Diretoria/);
  });

  it("quem tem alçada aprova, e a decisão fica registrada", async () => {
    const pedido = await abrir({ margem: 16 });
    const r = await pedir(`/api/todogreen/deal-desk/${pedido.id}/decisao`, {
      metodo: "POST",
      token: chefe.token,
      corpo: { decisao: "aprovar", justificativa: "volume compensa o desvio" },
    });
    expect(r.status).toBe(200);
    const decidido = (await r.json()).pedido;
    expect(decidido.situacao).toBe("aprovado");
    expect(decidido.decisorId).toBe(chefe.id);
    expect(decidido.decididoEm).toBeTruthy();
  });

  it("recusa sem motivo escrito não passa", async () => {
    const pedido = await abrir({ margem: 16 });
    const r = await pedir(`/api/todogreen/deal-desk/${pedido.id}/decisao`, {
      metodo: "POST",
      token: chefe.token,
      corpo: { decisao: "recusar", justificativa: "não" },
    });
    expect(r.status).toBe(400);
  });

  it("pedido já decidido não é decidido de novo", async () => {
    const pedido = await abrir({ margem: 16 });
    await pedir(`/api/todogreen/deal-desk/${pedido.id}/decisao`, {
      metodo: "POST",
      token: chefe.token,
      corpo: { decisao: "aprovar", justificativa: "ok, aprovado" },
    });
    const segunda = await pedir(`/api/todogreen/deal-desk/${pedido.id}/decisao`, {
      metodo: "POST",
      token: dona.token,
      corpo: { decisao: "recusar", justificativa: "mudei de ideia depois" },
    });
    expect(segunda.status).toBe(403);
  });
});

describe("revisar reabre e a decisão aponta para a versão certa", () => {
  it("revisar sobe a versão, limpa a decisão e volta para pendente", async () => {
    const id = await cenario({ margem: 16, dono: vendedor });
    const { pedido } = await (
      await pedir("/api/todogreen/deal-desk", {
        metodo: "POST",
        token: vendedor.token,
        corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
      })
    ).json();
    await pedir(`/api/todogreen/deal-desk/${pedido.id}/decisao`, {
      metodo: "POST",
      token: chefe.token,
      corpo: { decisao: "aprovar", justificativa: "aprovado na versão 1" },
    });

    const revisado = (
      await (
        await pedir(`/api/todogreen/deal-desk/${pedido.id}/revisao`, {
          metodo: "POST",
          token: vendedor.token,
          corpo: { justificativa: "Cliente pediu mais duas paradas por rota, a condição mudou." },
        })
      ).json()
    ).pedido;

    expect(revisado.versao).toBe(2);
    // A aprovação da versão 1 não pode continuar valendo para a versão 2.
    expect(revisado.situacao).toBe("pendente");
    expect(revisado.decisorId).toBe("");
    expect(revisado.decisaoJustificativa).toBe("");
  });
});

describe("histórico só cresce", () => {
  it("abertura, comentário, decisão e revisão ficam todos registrados, em ordem", async () => {
    const id = await cenario({ margem: 16, dono: vendedor });
    const { pedido } = await (
      await pedir("/api/todogreen/deal-desk", {
        metodo: "POST",
        token: vendedor.token,
        corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
      })
    ).json();
    await pedir(`/api/todogreen/deal-desk/${pedido.id}/comentario`, {
      metodo: "POST",
      token: chefe.token,
      corpo: { texto: "Qual é o prazo de fidelidade?" },
    });
    await pedir(`/api/todogreen/deal-desk/${pedido.id}/decisao`, {
      metodo: "POST",
      token: chefe.token,
      corpo: { decisao: "aprovar", justificativa: "fidelidade de 24 meses resolve" },
    });
    await pedir(`/api/todogreen/deal-desk/${pedido.id}/revisao`, {
      metodo: "POST",
      token: vendedor.token,
      corpo: { justificativa: "Cliente reduziu o volume, refiz a condição do zero." },
    });

    const { historico } = await (
      await pedir(`/api/todogreen/deal-desk/${pedido.id}/historico`, { token: chefe.token })
    ).json();
    expect(historico.map((e) => e.tipo)).toEqual(["abertura", "comentario", "decisao", "revisao"]);

    // A decisão da versão 1 continua lá depois da revisão — é onde a pergunta
    // "quem aprovou a versão 1?" tem resposta.
    const decisao = historico.find((e) => e.tipo === "decisao");
    expect(decisao.versao).toBe(1);
    expect(decisao.autorId).toBe(chefe.id);

    // E nada some: a revisão acrescenta, não reescreve.
    const linhas = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM todogreen_deal_desk_events WHERE request_id = ?",
    ).bind(pedido.id).first();
    expect(linhas.total).toBe(4);
  });

  it("o histórico de um pedido de outro espaço não abre", async () => {
    const foraDoTime = await criarUsuario("dd-fora-hist", "fora-hist@outraempresa.com.br");
    await vincular(foraDoTime, "admin", ["*"], foraDoTime.id);
    const id = await cenario({ margem: 16, dono: foraDoTime, espaco: foraDoTime.id });
    const { pedido } = await (
      await pedir("/api/todogreen/deal-desk", {
        metodo: "POST",
        token: foraDoTime.token,
        corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
      })
    ).json();
    const r = await pedir(`/api/todogreen/deal-desk/${pedido.id}/historico`, { token: vendedor.token });
    expect(r.status).toBe(404);
  });
});

describe("cancelar", () => {
  it("quem não pediu nem aprova não cancela", async () => {
    const id = await cenario({ margem: 16, dono: vendedor });
    const { pedido } = await (
      await pedir("/api/todogreen/deal-desk", {
        metodo: "POST",
        token: vendedor.token,
        corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
      })
    ).json();
    // Um segundo vendedor no mesmo espaço não limpa a fila alheia.
    const outro = await criarUsuario("dd-outro", "outro@parceiro.com.br");
    await vincular(outro, "vendedor", ["pricing:simulate"], dona.id);
    const r = await pedir(`/api/todogreen/deal-desk/${pedido.id}/cancelamento`, {
      metodo: "POST",
      token: outro.token,
      corpo: {},
    });
    expect([403, 404]).toContain(r.status);
  });
});

describe("a fila", () => {
  it("sem sessão não abre", async () => {
    expect((await pedir("/api/todogreen/deal-desk")).status).toBe(401);
  });

  it("só mostra os pedidos do próprio espaço", async () => {
    const lista = await pedir("/api/todogreen/deal-desk", { token: vendedor.token });
    expect(lista.status).toBe(200);
    const { pedidos } = await lista.json();
    expect(pedidos.length).toBeGreaterThan(0);
    expect(pedidos.every((p) => p.solicitanteId === vendedor.id)).toBe(true);
  });

  it("vendedor sem alçada não vê pedido de cliente fora da própria carteira, mas quem tem alçada vê", async () => {
    const colega = await criarUsuario("dd-colega", "colega@parceiro.com.br");
    await vincular(colega, "vendedor", ["pricing:simulate"], dona.id);
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_clients
         (id, tenant_id, workspace_owner_id, name, legal_name, document, segment, status,
          portal_enabled, created_by, updated_by, created_at, updated_at)
       VALUES ('cli-so-do-colega', 'todogreen', ?, 'Cliente do colega', 'Cliente do colega', '', 'varejo',
               'ativo', 0, ?, ?, ?, ?)`,
    )
      .bind(dona.id, dona.id, dona.id, agora, agora)
      .run();
    await env.DB.prepare(
      `INSERT INTO todogreen_client_assignments
         (id, tenant_id, client_id, seller_email, status, assigned_by, created_at, updated_at)
       VALUES (?, 'todogreen', 'cli-so-do-colega', ?, 'active', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), colega.email, dona.id, agora, agora)
      .run();

    const id = await cenario({ dono: colega, clienteId: "cli-so-do-colega" });
    await pedir("/api/todogreen/deal-desk", {
      metodo: "POST",
      token: colega.token,
      corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
    });

    // O vendedor original não tem "cli-so-do-colega" na carteira e não foi
    // quem pediu: o pedido do colega não aparece na fila dele.
    const listaVendedor = await pedir("/api/todogreen/deal-desk", { token: vendedor.token });
    const { pedidos: pedidosVendedor } = await listaVendedor.json();
    expect(pedidosVendedor.some((p) => p.solicitanteId === colega.id)).toBe(false);

    // Quem tem alçada (deal:approve) vê a fila inteira, carteira à parte —
    // é assim que aprovação funciona: por operação, não por cliente.
    const listaChefe = await pedir("/api/todogreen/deal-desk", { token: chefe.token });
    const { pedidos: pedidosChefe } = await listaChefe.json();
    expect(pedidosChefe.some((p) => p.solicitanteId === colega.id)).toBe(true);
  });

  it("limit/offset paginam a fila e status filtra no servidor", async () => {
    for (let i = 0; i < 3; i += 1) {
      const id = await cenario({ margem: 15, preco: 300000, dono: chefe });
      await pedir("/api/todogreen/deal-desk", {
        metodo: "POST",
        token: chefe.token,
        corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
      });
    }

    const pagina = await pedir("/api/todogreen/deal-desk?limit=1&offset=0", { token: chefe.token });
    const corpoPagina = await pagina.json();
    expect(corpoPagina.pedidos).toHaveLength(1);
    expect(corpoPagina.limit).toBe(1);
    expect(corpoPagina.offset).toBe(0);
    expect(corpoPagina.total).toBeGreaterThanOrEqual(3);

    const filtrada = await pedir("/api/todogreen/deal-desk?status=pendente", { token: chefe.token });
    const { pedidos } = await filtrada.json();
    expect(pedidos.every((p) => p.situacao === "pendente")).toBe(true);
  });
});

// O gate de alçada tem de valer nas DUAS portas: ao criar a proposta e ao
// liberá-la por PATCH. Sem a segunda, dava para nascer em rascunho (cenário
// limpo), abrir o pedido de alçada e depois enviar por PATCH — contornando a
// alçada no servidor. Sem oportunidade vinculada, um 409 aqui só pode ser o
// Deal Desk (o gate de viabilidade nem roda), o que isola o que estamos testando.
describe("o gate do Deal Desk vale ao criar E ao liberar a proposta por PATCH", () => {
  it("não libera cenário que exige alçada sem sequer abrir o pedido", async () => {
    const id = await cenario({ margem: 11, preco: 200000, dono: vendedor });
    const resposta = await pedir("/api/todogreen/records/proposals", {
      metodo: "POST", token: dona.token,
      corpo: { cenarioId: id, titulo: "Proposta sem pedido", situacao: "sent" },
    });
    expect(resposta.status).toBe(409);
    expect((await resposta.json()).error).toMatch(/aprovação comercial/);
  });
  it("cenário com pedido pendente bloqueia CRIAR proposta já enviada (409)", async () => {
    const id = await cenario({ margem: 11, preco: 200000, dono: vendedor });
    const abrir = await pedir("/api/todogreen/deal-desk", {
      metodo: "POST", token: vendedor.token,
      corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
    });
    expect(abrir.status).toBe(201);
    const r = await pedir("/api/todogreen/records/proposals", {
      metodo: "POST", token: dona.token,
      corpo: { cenarioId: id, titulo: "Proposta", situacao: "sent" },
    });
    expect(r.status).toBe(409);
  });

  it("PATCH rascunho→enviada com pedido pendente é bloqueado (409)", async () => {
    const id = await cenario({ margem: 11, preco: 200000, dono: vendedor });
    // O rascunho nasce ANTES de existir pedido de alçada — passa.
    const criar = await pedir("/api/todogreen/records/proposals", {
      metodo: "POST", token: dona.token,
      corpo: { cenarioId: id, titulo: "Proposta", situacao: "draft" },
    });
    expect(criar.status).toBe(201);
    const proposta = (await criar.json()).registro;
    // Agora o vendedor abre o pedido de alçada (fica pendente).
    await pedir("/api/todogreen/deal-desk", {
      metodo: "POST", token: vendedor.token,
      corpo: { cenarioId: id, justificativa: JUSTIFICATIVA },
    });
    // Tentar liberar por PATCH tem de bater no gate. Antes da correção, saía 200.
    const patch = await pedir(`/api/todogreen/records/proposals/${proposta.id}`, {
      metodo: "PATCH", token: dona.token,
      corpo: { revision: proposta.revision, situacao: "sent" },
    });
    expect(patch.status).toBe(409);
  });
});
