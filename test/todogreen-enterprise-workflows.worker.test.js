import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Jurídico operacional: o contrato pode voltar com RESSALVA (aprovado com
// observação a resolver), além de aprovar e reprovar. A ressalva satisfaz a
// etapa — o fluxo anda — mas fica registrada com o texto do que ajustar.

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
    `INSERT OR IGNORE INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'h', 's', ?)`,
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO sessions (id, user_id, token_hash, expires_at, created_at)
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
  )
    .bind(crypto.randomUUID(), workspaceOwnerId, usuario.email, papel, JSON.stringify(permissoes), usuario.id, agora, agora)
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

let dona;
let juridico;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();
  dona = await criarUsuario("ew-dona", "dona@ew.com.br");
  juridico = await criarUsuario("ew-jur", "jur@ew.com.br");
  await autorizar(dona); // admin no próprio espaço, cria o contrato
  // Jurídico atua no espaço da dona, com poder de revisão jurídica.
  await autorizar(juridico, "gestor", ["deal:review", "deal:approve"], dona.id);
});

describe("Jurídico: aprovar contrato com ressalva", () => {
  async function criarContrato() {
    const r = await pedir("/api/todogreen/enterprise-workflows", {
      metodo: "POST",
      token: dona.token,
      corpo: { domain: "legal", kind: "contract", title: "Contrato Alfa", requireApproval: true },
    });
    expect(r.status).toBe(201);
    return (await r.json()).workflow;
  }

  it("exige a nota, registra a ressalva e faz o fluxo avançar sem reprovar", async () => {
    const wf = await criarContrato();
    expect(wf.status).toBe("pending");

    // Ressalva sem descrever o que ressalvar não passa.
    const semNota = await pedir(`/api/todogreen/enterprise-workflows/${wf.id}/decision`, {
      metodo: "POST",
      token: juridico.token,
      corpo: { decision: "ressalva" },
    });
    expect(semNota.status).toBe(400);

    // Com a nota, a ressalva é registrada e a etapa do Jurídico é satisfeita.
    const comNota = await pedir(`/api/todogreen/enterprise-workflows/${wf.id}/decision`, {
      metodo: "POST",
      token: juridico.token,
      corpo: { decision: "ressalva", note: "Reduzir a multa de rescisão para 2 mensalidades." },
    });
    expect(comNota.status).toBe(200);
    const depois = (await comNota.json()).workflow;
    expect(depois.approval.comRessalva).toBe(true);
    expect(depois.approval.ressalvas[0].note).toContain("multa de rescisão");
    // Não é reprovação: o fluxo anda para a próxima etapa (dono do negócio).
    expect(depois.status).toBe("pending");
    expect(depois.approval.next?.id).toBe("dono-negocio");
  });

  it("reprovar continua encerrando o processo", async () => {
    const wf = await criarContrato();
    const r = await pedir(`/api/todogreen/enterprise-workflows/${wf.id}/decision`, {
      metodo: "POST",
      token: juridico.token,
      corpo: { decision: "reject", note: "Cláusula inaceitável." },
    });
    expect(r.status).toBe(200);
    expect((await r.json()).workflow.status).toBe("rejected");
  });
});
