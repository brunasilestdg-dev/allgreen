import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../worker-entry.js";

// Mercado Livre / Mercado Envios: OAuth + PKCE e consulta fiscal por espaço.
//
// O que estes testes existem para impedir de voltar:
//   • token do Mercado Livre gravado em claro no D1 ou devolvido para a tela;
//   • state OAuth reutilizável (um code reenviado criando segundo vínculo);
//   • refresh token de uso único renovado sem gravar o par novo;
//   • consulta saindo de api.mercadolibre.com ou usando outro método que GET;
//   • quem só lê consultando dados fiscais do Mercado Envios.

let n = 0;
const nextIp = () => `198.51.77.${(++n % 240) + 1}`;

const ENV = {
  ...env,
  MERCADOLIVRE_CLIENT_ID: "1234567890123456",
  MERCADOLIVRE_CLIENT_SECRET: "segredo-de-teste",
};

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

// Todas as pessoas no MESMO espaço (o da gestora): o vínculo é por espaço.
async function autorizar(usuario, papel, permissoes, dono) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, workspace_owner_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, 'active', ?, '', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET role = excluded.role,
       permissions_json = excluded.permissions_json, status = 'active'`,
  )
    .bind(crypto.randomUUID(), dono.id, usuario.email, papel, JSON.stringify(permissoes), dono.id, agora, agora)
    .run();
}

const pedir = (caminho, { metodo = "GET", token, corpo, ambiente = ENV } = {}) => {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${caminho}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      redirect: "manual",
    }),
    ambiente,
    { waitUntil() {}, passThroughOnException() {} },
  );
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

// Simula o Mercado Livre: token, /users/me e uma consulta qualquer.
const mercadoLivreFalso = (overrides = {}) => {
  const calls = [];
  const original = globalThis.fetch;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.mercadolibre.com")) return original(input, init);
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ url, method: init.method || "GET", body, auth: init.headers?.authorization || "" });
    if (url.endsWith("/oauth/token")) {
      const params = new URLSearchParams(body);
      if (overrides.token) return overrides.token(params);
      if (params.get("grant_type") === "authorization_code") {
        return jsonResponse({
          access_token: "APP_USR-acesso-1", token_type: "Bearer", expires_in: 21600,
          scope: "offline_access read", user_id: 998877, refresh_token: "TG-refresh-1",
        });
      }
      return jsonResponse({
        access_token: "APP_USR-acesso-2", token_type: "Bearer", expires_in: 21600,
        scope: "offline_access read", user_id: 998877, refresh_token: "TG-refresh-2",
      });
    }
    if (url.includes("/users/me")) return jsonResponse({ id: 998877, nickname: "TODOGREEN" });
    return jsonResponse({ id: "envio-1", fiscal: { cte: "ok" } });
  });
  return { calls, spy };
};

afterEach(() => vi.restoreAllMocks());

let gestora;
let fiscal;
let leitor;

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();
  gestora = await criarUsuario("meli-gestora", "gestora@meli.test");
  fiscal = await criarUsuario("meli-fiscal", "fiscal@meli.test");
  leitor = await criarUsuario("meli-leitor", "leitor@meli.test");
  await autorizar(gestora, "operacoes", ["read", "integration:manage"], gestora);
  await autorizar(fiscal, "financeiro", ["read", "fiscal:manage"], gestora);
  await autorizar(leitor, "auditor", ["read"], gestora);
});

const conectar = async () => {
  const inicio = await pedir("/api/todogreen/integrations/mercadolivre/oauth/start", { token: gestora.token });
  const { authorizeUrl } = await inicio.json();
  const state = new URL(authorizeUrl).searchParams.get("state");
  return pedir(`/api/todogreen/integrations/mercadolivre/oauth/callback?code=TG-code&state=${state}`);
};

describe("Mercado Livre · OAuth", () => {
  it("não inicia sem APP ID e segredo no cofre", async () => {
    const r = await pedir("/api/todogreen/integrations/mercadolivre/oauth/start", { token: gestora.token, ambiente: env });
    expect(r.status).toBe(503);
    expect((await r.json()).missing).toEqual(["MERCADOLIVRE_CLIENT_ID", "MERCADOLIVRE_CLIENT_SECRET"]);
  });

  it("só quem gerencia integrações inicia a conexão", async () => {
    const r = await pedir("/api/todogreen/integrations/mercadolivre/oauth/start", { token: fiscal.token });
    expect(r.status).toBe(403);
  });

  it("monta a URL de autorização com PKCE S256 e o callback do próprio domínio", async () => {
    const r = await pedir("/api/todogreen/integrations/mercadolivre/oauth/start", { token: gestora.token });
    expect(r.status).toBe(200);
    const url = new URL((await r.json()).authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://auth.mercadolivre.com.br/authorization");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("1234567890123456");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("redirect_uri"))
      .toBe("https://app.test/api/todogreen/integrations/mercadolivre/oauth/callback");
  });

  it("troca o code, grava os tokens cifrados e não aceita o mesmo state duas vezes", async () => {
    const { calls } = mercadoLivreFalso();
    const inicio = await pedir("/api/todogreen/integrations/mercadolivre/oauth/start", { token: gestora.token });
    const state = new URL((await inicio.json()).authorizeUrl).searchParams.get("state");

    const r = await pedir(`/api/todogreen/integrations/mercadolivre/oauth/callback?code=TG-code&state=${state}`);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://app.test/todogreen/integracoes?mercadolivre=connected");

    const troca = new URLSearchParams(calls.find((c) => c.url.endsWith("/oauth/token")).body);
    expect(troca.get("grant_type")).toBe("authorization_code");
    expect(troca.get("code_verifier")).toBeTruthy();

    const linha = await env.DB.prepare(
      "SELECT * FROM todogreen_mercadolivre_connections WHERE meli_user_id='998877'",
    ).first();
    expect(linha.meli_nickname).toBe("TODOGREEN");
    expect(linha.access_token_enc).toMatch(/^v1\./);
    expect(JSON.stringify(linha)).not.toContain("APP_USR-acesso-1");
    expect(JSON.stringify(linha)).not.toContain("TG-refresh-1");

    const repetido = await pedir(`/api/todogreen/integrations/mercadolivre/oauth/callback?code=TG-code&state=${state}`);
    expect(repetido.status).toBe(400);
  });

  it("autorização negada volta para a tela com aviso", async () => {
    const r = await pedir("/api/todogreen/integrations/mercadolivre/oauth/callback?error=access_denied&state=x");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toContain("mercadolivre=denied");
  });

  it("a tela recebe o resumo da conexão, sem token", async () => {
    const r = await pedir("/api/todogreen/integrations/mercadolivre/connection", { token: fiscal.token });
    const data = await r.json();
    expect(data.connection).toEqual(expect.objectContaining({ userId: "998877", nickname: "TODOGREEN", status: "connected" }));
    expect(JSON.stringify(data)).not.toMatch(/APP_USR|TG-refresh|_enc/);
    expect(data.docs.map((d) => d.id)).toEqual(
      expect.arrayContaining(["linehaul-venda", "linehaul-mwh", "carrito-v3", "shipment", "cte"]),
    );

    const status = await pedir("/api/todogreen/integrations", { token: gestora.token });
    const item = (await status.json()).operational.find((i) => i.id === "mercadolivre");
    expect(item).toEqual(expect.objectContaining({ status: "connected", canTest: true, canConnect: true }));
  });
});

describe("Mercado Livre · consulta fiscal", () => {
  it("quem só lê não consulta", async () => {
    const r = await pedir("/api/todogreen/integrations/mercadolivre/consulta", {
      metodo: "POST", token: leitor.token, corpo: { path: "/shipments/1" },
    });
    expect(r.status).toBe(403);
  });

  it("recusa caminho fora da API ou que tente escapar dela", async () => {
    mercadoLivreFalso();
    for (const path of ["https://evil.test/x", "//evil.test/x", "/shipments/../oauth/token", "/oauth/token", "/a?b=c"]) {
      const r = await pedir("/api/todogreen/integrations/mercadolivre/consulta", {
        metodo: "POST", token: fiscal.token, corpo: { path },
      });
      expect(r.status, path).toBe(400);
    }
  });

  it("consulta por GET com o token do espaço", async () => {
    const { calls } = mercadoLivreFalso();
    const r = await pedir("/api/todogreen/integrations/mercadolivre/consulta", {
      metodo: "POST", token: fiscal.token, corpo: { path: "/shipments/44556677", query: { site_id: "MLB" } },
    });
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data).toEqual(expect.objectContaining({ ok: true, status: 200, path: "/shipments/44556677" }));
    expect(data.data.fiscal.cte).toBe("ok");
    const chamada = calls.find((c) => c.url.includes("/shipments/44556677"));
    expect(chamada.url).toBe("https://api.mercadolibre.com/shipments/44556677?site_id=MLB");
    expect(chamada.method).toBe("GET");
    expect(chamada.auth).toBe("Bearer APP_USR-acesso-1");
  });

  it("renova o token vencido e grava o refresh token novo (uso único)", async () => {
    await env.DB.prepare("UPDATE todogreen_mercadolivre_connections SET access_expires_at=0").run();
    const { calls } = mercadoLivreFalso();
    const r = await pedir("/api/todogreen/integrations/mercadolivre/consulta", {
      metodo: "POST", token: fiscal.token, corpo: { path: "/shipments/1" },
    });
    expect(r.status).toBe(200);
    const refresh = new URLSearchParams(calls.find((c) => c.url.endsWith("/oauth/token")).body);
    expect(refresh.get("grant_type")).toBe("refresh_token");
    expect(refresh.get("refresh_token")).toBe("TG-refresh-1");
    expect(calls.find((c) => c.url.includes("/shipments/1")).auth).toBe("Bearer APP_USR-acesso-2");

    // Próxima renovação precisa usar o refresh NOVO, não o já queimado.
    await env.DB.prepare("UPDATE todogreen_mercadolivre_connections SET access_expires_at=0").run();
    const segunda = mercadoLivreFalso();
    await pedir("/api/todogreen/integrations/mercadolivre/consulta", {
      metodo: "POST", token: fiscal.token, corpo: { path: "/shipments/2" },
    });
    const outra = new URLSearchParams(segunda.calls.find((c) => c.url.endsWith("/oauth/token")).body);
    expect(outra.get("refresh_token")).toBe("TG-refresh-2");
  });

  it("refresh revogado pede nova autorização em vez de fingir sucesso", async () => {
    await env.DB.prepare("UPDATE todogreen_mercadolivre_connections SET access_expires_at=0").run();
    mercadoLivreFalso({ token: () => jsonResponse({ error: "invalid_grant", message: "invalid refresh token" }, 400) });
    const r = await pedir("/api/todogreen/integrations/mercadolivre/consulta", {
      metodo: "POST", token: fiscal.token, corpo: { path: "/shipments/1" },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("reauthorize");

    const status = await pedir("/api/todogreen/integrations", { token: gestora.token });
    const item = (await status.json()).operational.find((i) => i.id === "mercadolivre");
    expect(item.status).toBe("error");
  });

  it("reconectar recupera o vínculo e desconectar apaga os tokens", async () => {
    mercadoLivreFalso();
    expect((await conectar()).status).toBe(302);
    const antes = await env.DB.prepare("SELECT status FROM todogreen_mercadolivre_connections").first();
    expect(antes.status).toBe("connected");

    const negado = await pedir("/api/todogreen/integrations/mercadolivre/connection", { metodo: "DELETE", token: fiscal.token });
    expect(negado.status).toBe(403);
    const r = await pedir("/api/todogreen/integrations/mercadolivre/connection", { metodo: "DELETE", token: gestora.token });
    expect(r.status).toBe(200);
    const depois = await env.DB.prepare("SELECT COUNT(*) AS total FROM todogreen_mercadolivre_connections").first();
    expect(depois.total).toBe(0);
  });
});
