import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// O lado da equipe. A pergunta que importa aqui não é "a fila carrega", é:
// um vendedor consegue ler, responder ou mover a solicitação de um cliente
// que não está na carteira dele? A resposta tem que ser não no SQL, não na
// tela.

let n = 0;
const nextIp = () => `192.0.2.${(++n % 240) + 1}`;

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

const pedir = (caminho, { method = "GET", token, body } = {}) => {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${caminho}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
};

let gestor;
let vendedor;
let clienteDoPortal;

// Ids fixos para não depender de ordem entre arquivos de teste.
const CLI_MEU = "int-cli-meu";
const CLI_OUTRO = "int-cli-outro";
const REQ_MEU = "int-req-meu";
const REQ_OUTRO = "int-req-outro";

async function seedSolicitacao(id, clientId, assunto, extra = {}) {
  const agora = new Date().toISOString();
  const ownerId = extra.ownerId || gestor?.id || "dono";
  await env.DB.prepare(
    `INSERT INTO todogreen_client_requests
       (id, tenant_id, client_id, workspace_owner_id, type, subject, description,
        urgency, status, fields_json, due_at, opened_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'nova_rota', ?, 'descrição do pedido',
             'normal', ?, '{}', ?, 'cliente@empresa.com', ?, ?)`,
  )
    .bind(
      id,
      clientId,
      ownerId,
      assunto,
      extra.status || "aberta",
      extra.prazoEm || new Date(Date.now() + 48 * 3600000).toISOString(),
      agora,
      agora,
    )
    .run();
}

// Acesso à vertical vem de vínculo explícito. Antes estes testes passavam por
// causa da regra de domínio "@todogreen.com.br", que foi removida por ser um
// caminho aberto para qualquer conta criada com um e-mail daquele domínio.
async function autorizar(env, email, criadoPor, role = "auditor", permissoes = "[]") {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'active', ?, '', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), email, role, permissoes, criadoPor, agora, agora).run();
}

beforeAll(async () => {
  // Garante o DDL das tabelas do portal.
  await pedir("/api/todogreen/portal/sessao");

  gestor = await criarUsuario("int-u-gestor", "gestor@todogreen.com.br");
  vendedor = await criarUsuario("int-u-vend", "vendedor@todogreen.com.br");
  clienteDoPortal = await criarUsuario("int-u-cli", "pessoa@int-cliente.com.br");

  const agora = new Date().toISOString();

  // Sem isto o "gestor" seria só mais um e-mail @todogreen.com.br, que entra
  // como auditor. Quem gere a operação é quem está na lista de acesso com
  // papel de administração — é essa a diferença que o teste precisa exercitar.
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'admin', 'active', '["*"]', '', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), gestor.email, gestor.id, agora, agora).run();

  for (const [id, nome] of [[CLI_MEU, "Cliente da carteira"], [CLI_OUTRO, "Cliente de outro"]]) {
    await env.DB.prepare(
      `INSERT INTO todogreen_clients
         (id, tenant_id, workspace_owner_id, name, status, portal_enabled,
          created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, ?, 'ativo', 1, 'seed', 'seed', ?, ?)`,
    ).bind(id, gestor.id, nome, agora, agora).run();
  }

  // O vendedor responde só pelo primeiro cliente.
  await env.DB.prepare(
    `INSERT INTO todogreen_client_assignments
       (id, tenant_id, client_id, seller_email, status, note, assigned_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'active', '', ?, ?, ?)`,
    // assigned_by tem chave estrangeira para users: precisa ser gente de verdade.
  ).bind(crypto.randomUUID(), CLI_MEU, vendedor.email, gestor.id, agora, agora).run();

  await env.DB.prepare(
    `INSERT INTO todogreen_client_users
       (id, tenant_id, client_id, email, role, status, permissions_json,
        invited_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'cliente_gestor', 'active', '[]', 'seed', ?, ?)`,
  ).bind(crypto.randomUUID(), CLI_MEU, clienteDoPortal.email, agora, agora).run();

  await autorizar(env, vendedor.email, gestor.id);

  await seedSolicitacao(REQ_MEU, CLI_MEU, "Pedido da minha carteira");
  await seedSolicitacao(REQ_OUTRO, CLI_OUTRO, "Pedido de outra carteira");
});

describe("acesso à fila interna", () => {
  it("sem sessão, não entra", async () => {
    expect((await pedir("/api/todogreen/requests")).status).toBe(401);
  });

  it("quem gere a operação vê a caixa inteira", async () => {
    const d = await (await pedir("/api/todogreen/requests", { token: gestor.token })).json();
    const assuntos = d.solicitacoes.map((s) => s.assunto);
    expect(assuntos).toContain("Pedido da minha carteira");
    expect(assuntos).toContain("Pedido de outra carteira");
    expect(d.carteiraCompleta).toBe(true);
  });

  it("o vendedor vê só a própria carteira", async () => {
    const d = await (await pedir("/api/todogreen/requests", { token: vendedor.token })).json();
    const assuntos = d.solicitacoes.map((s) => s.assunto);
    expect(assuntos).toContain("Pedido da minha carteira");
    expect(assuntos).not.toContain("Pedido de outra carteira");
    expect(d.carteiraCompleta).toBe(false);
  });

  it("o vendedor não lê a conversa de fora da carteira", async () => {
    const d = await (
      await pedir(`/api/todogreen/requests?id=${REQ_OUTRO}`, { token: vendedor.token })
    ).json();
    expect(d.mensagens).toHaveLength(0);
  });

  it("o vendedor não responde fora da carteira", async () => {
    const r = await pedir("/api/todogreen/requests", {
      method: "POST",
      token: vendedor.token,
      body: { id: REQ_OUTRO, mensagem: "resposta indevida" },
    });
    // 404 e não 403: dizer "existe mas não é sua" já entrega que o cliente existe.
    expect(r.status).toBe(404);
    const linha = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM todogreen_client_request_messages WHERE request_id = ?",
    ).bind(REQ_OUTRO).first();
    expect(linha.total).toBe(0);
  });

  it("o vendedor não move o estado de fora da carteira", async () => {
    const r = await pedir("/api/todogreen/requests", {
      method: "PATCH",
      token: vendedor.token,
      body: { id: REQ_OUTRO, status: "concluida" },
    });
    expect(r.status).toBe(404);
    const linha = await env.DB.prepare(
      "SELECT status FROM todogreen_client_requests WHERE id = ?",
    ).bind(REQ_OUTRO).first();
    expect(linha.status).toBe("aberta");
  });
});

describe("responder", () => {
  it("responder marca como respondida e a resposta chega ao cliente", async () => {
    const r = await pedir("/api/todogreen/requests", {
      method: "POST",
      token: vendedor.token,
      body: { id: REQ_MEU, mensagem: "Conseguimos incluir a rota a partir de abril." },
    });
    expect(r.status).toBe(200);

    const linha = await env.DB.prepare(
      "SELECT status FROM todogreen_client_requests WHERE id = ?",
    ).bind(REQ_MEU).first();
    expect(linha.status).toBe("respondida");

    const doCliente = await (
      await pedir(`/api/todogreen/portal/solicitacoes?id=${REQ_MEU}`, {
        token: clienteDoPortal.token,
      })
    ).json();
    expect(JSON.stringify(doCliente.mensagens)).toMatch(/a partir de abril/);
  });

  it("nota interna não move o pedido nem chega ao cliente", async () => {
    await seedSolicitacao("int-req-nota", CLI_MEU, "Pedido com nota");
    const r = await pedir("/api/todogreen/requests", {
      method: "POST",
      token: gestor.token,
      body: { id: "int-req-nota", mensagem: "margem apertada, checar com o comercial", interna: true },
    });
    expect(r.status).toBe(200);

    const linha = await env.DB.prepare(
      "SELECT status FROM todogreen_client_requests WHERE id = ?",
    ).bind("int-req-nota").first();
    // Marcar como "respondida" faria o cliente esperar por algo que nunca
    // chegou até ele.
    expect(linha.status).toBe("aberta");

    const doCliente = await (
      await pedir("/api/todogreen/portal/solicitacoes?id=int-req-nota", {
        token: clienteDoPortal.token,
      })
    ).json();
    expect(JSON.stringify(doCliente.mensagens)).not.toMatch(/margem apertada/);
  });

  it("a equipe enxerga a própria nota interna", async () => {
    const d = await (
      await pedir("/api/todogreen/requests?id=int-req-nota", { token: gestor.token })
    ).json();
    const nota = d.mensagens.find((m) => m.interna);
    expect(nota.texto).toMatch(/margem apertada/);
  });

  it("pedido encerrado não recebe resposta nova", async () => {
    await seedSolicitacao("int-req-fim", CLI_MEU, "Pedido fechado", { status: "concluida" });
    const r = await pedir("/api/todogreen/requests", {
      method: "POST",
      token: gestor.token,
      body: { id: "int-req-fim", mensagem: "tentativa tardia" },
    });
    expect(r.status).toBe(409);
  });
});

describe("fila e indicadores", () => {
  it("a fila devolve o que estourou antes do que está no prazo", async () => {
    await seedSolicitacao("int-req-atrasado", CLI_MEU, "Já estourou", {
      prazoEm: new Date(Date.now() - 5 * 3600000).toISOString(),
    });
    const d = await (await pedir("/api/todogreen/requests", { token: gestor.token })).json();
    const atrasado = d.solicitacoes.find((s) => s.id === "int-req-atrasado");
    expect(atrasado.prazo.emAtraso).toBe(true);
    expect(d.fila[0]).toBe("int-req-atrasado");
    expect(d.indicadores.atrasadas).toBeGreaterThan(0);
  });

  it("assumir o pedido não mexe no estado nem no prazo", async () => {
    await seedSolicitacao("int-req-assumir", CLI_MEU, "Para assumir");
    const antes = await env.DB.prepare(
      "SELECT status, due_at FROM todogreen_client_requests WHERE id = ?",
    ).bind("int-req-assumir").first();

    const r = await pedir("/api/todogreen/requests", {
      method: "PATCH",
      token: vendedor.token,
      body: { id: "int-req-assumir", assumir: true },
    });
    expect(r.status).toBe(200);

    const depois = await env.DB.prepare(
      "SELECT status, due_at, assigned_to FROM todogreen_client_requests WHERE id = ?",
    ).bind("int-req-assumir").first();
    expect(depois.assigned_to).toBe(vendedor.email);
    // Quem assume passa a responder pelo pedido, não reinicia o relógio.
    expect(depois.status).toBe(antes.status);
    expect(depois.due_at).toBe(antes.due_at);
  });

  it("transição inválida é recusada com explicação", async () => {
    await seedSolicitacao("int-req-invalida", CLI_MEU, "Já concluída", { status: "concluida" });
    const r = await pedir("/api/todogreen/requests", {
      method: "PATCH",
      token: gestor.token,
      body: { id: "int-req-invalida", status: "aberta" },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/Concluída/);
  });
});
