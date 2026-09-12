import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// NPS de cliente no portal. O que importa provar: (1) a nota do cliente A nunca
// alcança o cliente B; (2) uma nota de DETRATOR abre, de verdade, uma ocorrência
// com prazo na fila da equipe — a ponte que fecha o ciclo; (3) nota promotora
// não abre ocorrência; (4) nota inválida é recusada; (5) sem resposta o NPS é
// null, nunca 0.

let n = 0;
const nextIp = () => `203.0.113.${(++n % 240) + 1}`;

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function criarUsuario(id, email) {
  const token = `tok-${id}`;
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'h', 's', ?)`,
  )
    .bind(id, `Pessoa ${id}`, email, agora)
    .run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  )
    .bind(`ses-${id}`, id, await sha256(token), agora)
    .run();
  return { id, email, token };
}

async function criarCliente(id, nome) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id, tenant_id, workspace_owner_id, name, status, portal_enabled,
        created_by, updated_by, created_at, updated_at)
     VALUES (?, 'todogreen', 'dono-nps', ?, 'ativo', 1, 'seed', 'seed', ?, ?)`,
  )
    .bind(id, nome, agora, agora)
    .run();
  return id;
}

async function vincular(clientId, email, role = "cliente_gestor") {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_client_users
       (id, tenant_id, client_id, email, role, status, permissions_json,
        invited_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, 'active', '[]', 'seed', ?, ?)`,
  )
    .bind(crypto.randomUUID(), clientId, email, role, agora, agora)
    .run();
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

let pessoaA;
let pessoaB;

beforeAll(async () => {
  await pedir("/api/todogreen/portal/sessao");

  await criarCliente("nps-a", "Cliente NPS A");
  await criarCliente("nps-b", "Cliente NPS B");
  await criarUsuario("dono-nps", "dona-nps@todogreen.com.br");

  pessoaA = await criarUsuario("nps-u-a", "pessoa@npsa.com.br");
  pessoaB = await criarUsuario("nps-u-b", "pessoa@npsb.com.br");
  await vincular("nps-a", pessoaA.email);
  await vincular("nps-b", pessoaB.email);
});

describe("responder a avaliação", () => {
  it("nota fora de 0..10 é recusada, sem gravar", async () => {
    for (const nota of [11, -1, 3.5, "abc", null]) {
      const r = await pedir("/api/todogreen/portal/nps", {
        method: "POST",
        token: pessoaA.token,
        body: { nota },
      });
      expect(r.status, String(nota)).toBe(400);
    }
  });

  it("nota de promotor grava e NÃO abre ocorrência", async () => {
    const r = await pedir("/api/todogreen/portal/nps", {
      method: "POST",
      token: pessoaA.token,
      body: { nota: 10, comentario: "Serviço impecável" },
    });
    expect(r.status).toBe(201);
    const d = await r.json();
    expect(d.classe).toBe("promotor");
    expect(d.ocorrenciaId).toBeFalsy();
  });

  it("nota de detrator abre ocorrência com prazo na fila da equipe", async () => {
    const r = await pedir("/api/todogreen/portal/nps", {
      method: "POST",
      token: pessoaA.token,
      body: { nota: 3, motivo: "Atraso na entrega", comentario: "Chegou tarde" },
    });
    expect(r.status).toBe(201);
    const d = await r.json();
    expect(d.classe).toBe("detrator");
    expect(d.ocorrenciaId).toBeTruthy();

    // A ponte de verdade: existe uma solicitação type='ocorrencia' com prazo,
    // do cliente da sessão, aberta pela nota.
    const ocorrencia = await env.DB.prepare(
      `SELECT type, status, urgency, due_at, client_id, workspace_owner_id
         FROM todogreen_client_requests WHERE id = ?`,
    )
      .bind(d.ocorrenciaId)
      .first();
    expect(ocorrencia).toBeTruthy();
    expect(ocorrencia.type).toBe("ocorrencia");
    expect(ocorrencia.status).toBe("aberta");
    expect(ocorrencia.due_at).toBeTruthy();
    expect(ocorrencia.client_id).toBe("nps-a");
    expect(ocorrencia.workspace_owner_id).toBe("dono-nps");

    // E a resposta NPS guarda o elo para a ocorrência.
    const resposta = await env.DB.prepare(
      "SELECT incident_request_id, classe FROM todogreen_client_nps WHERE id = ?",
    )
      .bind(d.id)
      .first();
    expect(resposta.incident_request_id).toBe(d.ocorrenciaId);
    expect(resposta.classe).toBe("detrator");
  });
});

describe("leitura da avaliação: agregado do próprio cliente", () => {
  it("o NPS é calculado sobre as respostas do cliente; sem resposta seria null", async () => {
    // pessoaA já tem 1 promotor (10) + 1 detrator (3): (1/2 − 1/2) × 100 = 0.
    const d = await (await pedir("/api/todogreen/portal/nps", { token: pessoaA.token })).json();
    expect(d.resumo.respondidos).toBe(2);
    expect(d.resumo.promotores).toBe(1);
    expect(d.resumo.detratores).toBe(1);
    expect(d.resumo.nps).toBe(0);
    expect(d.ultima).toBeTruthy();
    // A causa da nota baixa entra no ranking.
    expect(d.causas.map((c) => c.causa)).toContain("Atraso na entrega");
  });

  it("cliente sem nenhuma resposta: NPS null, nunca 0", async () => {
    const d = await (await pedir("/api/todogreen/portal/nps", { token: pessoaB.token })).json();
    expect(d.resumo.respondidos).toBe(0);
    expect(d.resumo.nps).toBeNull();
    expect(d.resumo.faixa).toBe("sem-dados");
    expect(d.ultima).toBeNull();
  });
});

describe("o NPS do cliente A nunca alcança o cliente B", () => {
  it("a nota de A não aparece na leitura de B, nem com parâmetro forjado na URL", async () => {
    for (const tentativa of [
      "/api/todogreen/portal/nps",
      "/api/todogreen/portal/nps?client=nps-a",
      "/api/todogreen/portal/nps?clientId=nps-a",
      "/api/todogreen/portal/nps?cliente=nps-a",
    ]) {
      const d = await (await pedir(tentativa, { token: pessoaB.token })).json();
      expect(d.respostas.length, tentativa).toBe(0);
      expect(d.resumo.nps, tentativa).toBeNull();
    }
  });

  it("sem sessão, não responde nem lê", async () => {
    expect((await pedir("/api/todogreen/portal/nps")).status).toBe(401);
    expect(
      (await pedir("/api/todogreen/portal/nps", { method: "POST", body: { nota: 9 } })).status,
    ).toBe(401);
  });
});

describe("o menu do portal oferece a avaliação", () => {
  it("a aba 'Sua avaliação' está no menu do cliente", async () => {
    const d = await (await pedir("/api/todogreen/portal/sessao", { token: pessoaA.token })).json();
    expect(d.menu.map((i) => i.id)).toContain("nps");
  });
});
