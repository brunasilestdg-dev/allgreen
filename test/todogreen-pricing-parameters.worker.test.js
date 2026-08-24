import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// A régua comercial: quem lê, quem muda, o que fica registrado, e o que é
// barrado antes de virar preço absurdo em proposta.

let n = 0;
const nextIp = () => `198.51.100.${(++n % 240) + 1}`;

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

const parametros = (extra = {}) => ({
  minimumMarginPercent: 18,
  targetMarginPercent: 26,
  opexPercent: 7,
  adminPercent: 4,
  taxPercent: 8.65,
  riskPercent: 3,
  commissionPercent: 2.5,
  ...extra,
});

let gestor;
let vendedor;

beforeAll(async () => {
  gestor = await criarUsuario("pp-gestor", "gestor.preco@todogreen.com.br");
  vendedor = await criarUsuario("pp-vend", "vendedor@todogreen.com.br");

  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  )
    .bind(agora, agora)
    .run();
  // Gestor com pricing:manage; vendedor liberado como auditor, sem permissão
  // de gestão. Os dois precisam de vínculo explícito.
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'pricing', 'active', '["read","pricing:manage"]', '', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), gestor.email, gestor.id, agora, agora)
    .run();

  // Acesso é vínculo explícito: a regra de domínio "@todogreen.com.br" foi
  // removida por abrir a vertical para qualquer conta criada nesse domínio.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'auditor', 'active', '[]', '', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), vendedor.email, gestor.id, agora, agora).run();

});

describe("ler a régua", () => {
  it("sem sessão, não", async () => {
    expect((await pedir("/api/todogreen/pricing-parameters")).status).toBe(401);
  });

  it("antes de qualquer cadastro, a régua é o padrão de fábrica — e diz isso", async () => {
    const d = await (
      await pedir("/api/todogreen/pricing-parameters", { token: vendedor.token })
    ).json();
    expect(d.atual.deFabrica).toBe(true);
    expect(d.atual.versao).toBe("padrao-de-fabrica");
    expect(d.atual.parametros.minimumMarginPercent).toBe(18);
  });

  it("o vendedor lê mas a resposta diz que ele não edita", async () => {
    const d = await (
      await pedir("/api/todogreen/pricing-parameters", { token: vendedor.token })
    ).json();
    expect(d.podeEditar).toBe(false);
  });
});

describe("mudar a régua", () => {
  it("vendedor não muda", async () => {
    const r = await pedir("/api/todogreen/pricing-parameters", {
      method: "POST",
      token: vendedor.token,
      body: { versao: "v-vend", parametros: parametros(), justificativa: "teste" },
    });
    expect(r.status).toBe(403);
  });

  it("sem justificativa, nem o gestor muda", async () => {
    // Régua sem motivo registrado é régua que ninguém defende em auditoria.
    const r = await pedir("/api/todogreen/pricing-parameters", {
      method: "POST",
      token: gestor.token,
      body: { versao: "v-sem-motivo", parametros: parametros() },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/justificativa/i);
  });

  it("régua que produziria preço irreal é barrada", async () => {
    const r = await pedir("/api/todogreen/pricing-parameters", {
      method: "POST",
      token: gestor.token,
      body: {
        versao: "v-absurda",
        parametros: parametros({ targetMarginPercent: 88, commissionPercent: 5 }),
        justificativa: "tentativa",
      },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/perde o sentido|irreal/i);
  });

  it("o gestor cadastra, e a resposta traz o que mudou e o efeito no preço", async () => {
    const r = await pedir("/api/todogreen/pricing-parameters", {
      method: "POST",
      token: gestor.token,
      body: {
        versao: "v2.ago",
        parametros: parametros({ targetMarginPercent: 30, opexPercent: 9 }),
        justificativa: "Reajuste de OPEX pelo custo de energia e nova meta de margem.",
        vigenciaInicio: "2026-08-05",
      },
    });
    expect(r.status).toBe(201);
    const d = await r.json();
    expect(d.mudanca).toMatch(/Margem alvo: 26% → 30%/);
    expect(d.mudanca).toMatch(/OPEX: 7% → 9%/);
    expect(d.efeito.precoRecomendado).toBeGreaterThan(d.efeito.precoMinimo);
  });

  it("a régua nova passa a valer e a anterior fica encerrada, não apagada", async () => {
    const d = await (
      await pedir("/api/todogreen/pricing-parameters", { token: gestor.token })
    ).json();
    expect(d.atual.versao).toBe("v2.ago");
    expect(d.atual.deFabrica).toBe(false);
    expect(d.atual.parametros.targetMarginPercent).toBe(30);
  });

  it("uma segunda versão encerra a primeira e o histórico guarda as duas", async () => {
    await pedir("/api/todogreen/pricing-parameters", {
      method: "POST",
      token: gestor.token,
      body: {
        versao: "v3.set",
        parametros: parametros({ targetMarginPercent: 28 }),
        justificativa: "Ajuste fino da meta após fechamento do mês.",
      },
    });
    const d = await (
      await pedir("/api/todogreen/pricing-parameters", { token: gestor.token })
    ).json();
    expect(d.atual.versao).toBe("v3.set");
    const versoes = d.historico.map((h) => [h.versao, h.status]);
    expect(versoes).toContainEqual(["v3.set", "active"]);
    expect(versoes).toContainEqual(["v2.ago", "superseded"]);
    // A justificativa fica no registro.
    expect(d.historico.find((h) => h.versao === "v2.ago").justificativa).toMatch(/OPEX/);
  });

  it("Middle Mile Spot substitui só o custo específico e herda a base global", async () => {
    const r = await pedir("/api/todogreen/pricing-parameters", {
      method: "POST",
      token: gestor.token,
      body: {
        versao: "spot.ago.1",
        nome: "Middle Mile Spot",
        scopeType: "product",
        scopeKey: "middle-mile-spot",
        parametros: { opexPercent: 5, waitingCostPerHour: 125 },
        justificativa: "Referência spot atualizada após cotação operacional.",
      },
    });
    expect(r.status).toBe(201);

    const d = await (await pedir(
      "/api/todogreen/pricing-parameters?productId=middle-mile-spot",
      { token: gestor.token },
    )).json();
    expect(d.atual.parametros.targetMarginPercent).toBe(28);
    expect(d.resolvido.parametros.targetMarginPercent).toBe(28);
    expect(d.resolvido.parametros.opexPercent).toBe(5);
    expect(d.resolvido.parametros.waitingCostPerHour).toBe(125);
    expect(d.resolvido.aplicados.at(-1).versao).toBe("spot.ago.1");
  });
});
