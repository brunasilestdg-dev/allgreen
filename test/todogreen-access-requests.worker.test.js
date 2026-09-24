import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Solicitar acesso na tela de login → fila de aprovação dos administradores.
//
// O que estes testes protegem:
//   • a porta pública aceita o pedido SEM sessão (quem pede não tem conta);
//   • ela nunca duplica um pedido pendente do mesmo e-mail;
//   • só administrador lê e decide a fila;
//   • aprovar concede de verdade (vira e-mail autorizado ativo);
//   • um pedido já decidido não é decidido duas vezes.

let n = 0;
const nextIp = () => `198.19.7.${(++n % 240) + 1}`;

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

async function autorizar(usuario, papel = "admin", permissoes = ["*"], workspaceOwnerId = usuario.id) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, workspace_owner_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, 'active', ?, '', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET role = excluded.role,
       permissions_json = excluded.permissions_json, status = 'active'`,
  ).bind(crypto.randomUUID(), workspaceOwnerId, usuario.email, papel, JSON.stringify(permissoes), usuario.id, agora, agora).run();
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

let gestora;
let auditor;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();
  gestora = await criarUsuario("acr-gestora", "acr-gestora@parceiro.com.br");
  auditor = await criarUsuario("acr-auditor", "acr-auditor@parceiro.com.br");
  await autorizar(gestora);
  await autorizar(auditor, "auditor", ["read", "audit:read"]);
});

describe("solicitar acesso e a fila de aprovação", () => {
  it("aceita o pedido público sem sessão e não duplica o pendente", async () => {
    const email = `pede-${crypto.randomUUID()}@empresa.com.br`;
    const um = await pedir("/api/todogreen/solicitar-acesso", { metodo: "POST", corpo: { nome: "Fulano", email, empresa: "ACME" } });
    expect(um.status).toBe(201);
    // Clicou de novo: atualiza, não empilha.
    const dois = await pedir("/api/todogreen/solicitar-acesso", { metodo: "POST", corpo: { nome: "Fulano da Silva", email, empresa: "ACME Log" } });
    expect(dois.status).toBe(201);
    const linhas = await env.DB.prepare(
      "SELECT name, company FROM todogreen_access_requests WHERE tenant_id='todogreen' AND email=? AND status='pending'",
    ).bind(email.toLowerCase()).all();
    expect(linhas.results.length).toBe(1);
    expect(linhas.results[0].name).toBe("Fulano da Silva");
  });

  it("recusa e-mail inválido, mas com nome e e-mail válidos aceita", async () => {
    const ruim = await pedir("/api/todogreen/solicitar-acesso", { metodo: "POST", corpo: { nome: "Sem Email", email: "arroba-nada" } });
    expect(ruim.status).toBe(400);
    const semNome = await pedir("/api/todogreen/solicitar-acesso", { metodo: "POST", corpo: { email: `sonome-${crypto.randomUUID()}@x.com.br` } });
    expect(semNome.status).toBe(400);
  });

  it("só administrador lê a fila", async () => {
    const negado = await pedir("/api/todogreen/access-requests", { token: auditor.token });
    expect(negado.status).toBe(403);
    const ok = await pedir("/api/todogreen/access-requests", { token: gestora.token });
    expect(ok.status).toBe(200);
    const corpo = await ok.json();
    expect(Array.isArray(corpo.requests)).toBe(true);
  });

  it("gestor (liderança) também lê e aprova — mesmo sem access:manage no vínculo antigo", async () => {
    // Simula um vínculo de liderança criado ANTES do access:manage: o papel
    // sozinho já libera a fila (pedido da titular: "adms ou gestores aprovam").
    const lider = await criarUsuario("acr-lider", "acr-lider@parceiro.com.br");
    await autorizar(lider, "lideranca_comercial", ["read", "crm:manage"]);
    const ok = await pedir("/api/todogreen/access-requests", { token: lider.token });
    expect(ok.status).toBe(200);

    const email = `lider-aprova-${crypto.randomUUID()}@empresa.com.br`.toLowerCase();
    await pedir("/api/todogreen/solicitar-acesso", { metodo: "POST", corpo: { nome: "Pela Liderança", email } });
    const fila = await (await pedir("/api/todogreen/access-requests", { token: lider.token })).json();
    const pedido = fila.requests.find((item) => item.email === email);
    expect(pedido).toBeTruthy();
    const aprovar = await pedir("/api/todogreen/access-requests", {
      metodo: "POST", token: lider.token, corpo: { id: pedido.id, decisao: "aprovar", role: "vendedor" },
    });
    expect(aprovar.status).toBe(200);
  });

  it("aprovar concede acesso de verdade e trava o segundo julgamento", async () => {
    const email = `aprova-${crypto.randomUUID()}@empresa.com.br`.toLowerCase();
    await pedir("/api/todogreen/solicitar-acesso", { metodo: "POST", corpo: { nome: "Aprovada", email } });
    const fila = await (await pedir("/api/todogreen/access-requests", { token: gestora.token })).json();
    const pedido = fila.requests.find((item) => item.email === email);
    expect(pedido).toBeTruthy();

    const aprovar = await pedir("/api/todogreen/access-requests", {
      metodo: "POST", token: gestora.token, corpo: { id: pedido.id, decisao: "aprovar", role: "operacoes" },
    });
    expect(aprovar.status).toBe(200);
    // Virou e-mail autorizado ativo no espaço de quem aprovou.
    const concedido = await env.DB.prepare(
      "SELECT role, status FROM todogreen_access_emails WHERE tenant_id='todogreen' AND workspace_owner_id=? AND email=?",
    ).bind(gestora.id, email).first();
    expect(concedido).toBeTruthy();
    expect(concedido.status).toBe("active");
    expect(concedido.role).toBe("operacoes");
    // O pedido ficou approved.
    const marcado = await env.DB.prepare(
      "SELECT status, decided_role FROM todogreen_access_requests WHERE tenant_id='todogreen' AND id=?",
    ).bind(pedido.id).first();
    expect(marcado.status).toBe("approved");
    expect(marcado.decided_role).toBe("operacoes");

    // Julgar de novo é 409.
    const denovo = await pedir("/api/todogreen/access-requests", {
      metodo: "POST", token: gestora.token, corpo: { id: pedido.id, decisao: "aprovar", role: "auditor" },
    });
    expect(denovo.status).toBe(409);
  });

  it("sem e-mail configurado, aprovar devolve um link de convite válido para entrega manual", async () => {
    // O ambiente de teste não tem Brevo (BREVO_API_KEY/MAIL_SENDER), então o
    // e-mail não sai — mas a autorização não pode ficar presa a isso. O convite
    // continua válido e o link volta na resposta para o admin copiar e enviar.
    const email = `linkmanual-${crypto.randomUUID()}@empresa.com.br`.toLowerCase();
    await pedir("/api/todogreen/solicitar-acesso", { metodo: "POST", corpo: { nome: "Link Manual", email } });
    const fila = await (await pedir("/api/todogreen/access-requests", { token: gestora.token })).json();
    const pedido = fila.requests.find((item) => item.email === email);
    expect(pedido).toBeTruthy();

    const aprovar = await pedir("/api/todogreen/access-requests", {
      metodo: "POST", token: gestora.token, corpo: { id: pedido.id, decisao: "aprovar", role: "auditor" },
    });
    expect(aprovar.status).toBe(200);
    const corpo = await aprovar.json();
    expect(corpo.invitationSent).toBe(false);
    expect(typeof corpo.inviteLink).toBe("string");
    expect(corpo.inviteLink).toContain("/todogreen/convite/");

    // O convite ficou 'pending' (usável), não 'send_failed' — o link precisa valer.
    const conviteRow = await env.DB.prepare(
      "SELECT status FROM todogreen_access_invites WHERE tenant_id='todogreen' AND email=? ORDER BY created_at DESC LIMIT 1",
    ).bind(email).first();
    expect(conviteRow?.status).toBe("pending");

    // O link é a credencial: com o token dele a pessoa define a senha e entra —
    // exatamente o caminho que o e-mail traria, mas entregue à mão.
    const token = corpo.inviteLink.split("/todogreen/convite/")[1];
    expect(token).toBeTruthy();
    const aceite = await pedir("/api/todogreen/access-invite", {
      metodo: "POST", corpo: { token, password: "senha-forte-123", name: "Link Manual" },
    });
    expect(aceite.status).toBe(200);
    const sessao = await aceite.json();
    expect(sessao.user?.email).toBe(email);
    expect(sessao.token).toBeTruthy();
  });

  it("recusar marca o pedido como recusado sem conceder nada", async () => {
    const email = `recusa-${crypto.randomUUID()}@empresa.com.br`.toLowerCase();
    await pedir("/api/todogreen/solicitar-acesso", { metodo: "POST", corpo: { nome: "Recusada", email } });
    const fila = await (await pedir("/api/todogreen/access-requests", { token: gestora.token })).json();
    const pedido = fila.requests.find((item) => item.email === email);

    const recusar = await pedir("/api/todogreen/access-requests", {
      metodo: "POST", token: gestora.token, corpo: { id: pedido.id, decisao: "recusar" },
    });
    expect(recusar.status).toBe(200);
    const marcado = await env.DB.prepare(
      "SELECT status FROM todogreen_access_requests WHERE tenant_id='todogreen' AND id=?",
    ).bind(pedido.id).first();
    expect(marcado.status).toBe("rejected");
    // Nenhum acesso concedido.
    const concedido = await env.DB.prepare(
      "SELECT email FROM todogreen_access_emails WHERE tenant_id='todogreen' AND email=?",
    ).bind(email).first();
    expect(concedido).toBeFalsy();
  });
});
