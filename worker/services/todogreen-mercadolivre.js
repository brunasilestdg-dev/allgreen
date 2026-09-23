import { podeNaVertical } from "./todogreen-access.js";

// Mercado Livre / Mercado Envios → To Do Green.
//
// A To Do Green atua como transportadora de middle-mile/linehaul do Mercado
// Envios e precisa dos dados fiscais de cada envio (rotas de venda, MWH,
// Carrito V3, shipment e CT-e) para emitir o próprio CT-e. O acesso a esses
// dados passa por um App do DevCenter do Mercado Livre: o APP ID gerado lá é
// informado ao Mercado Livre, que libera a consulta para esse app.
//
// Desenho (mesmo do monday.com):
//   • OAuth 2.0 authorization_code + PKCE S256, estado de uso único no D1;
//   • um vínculo por espaço, tokens cifrados em AES-GCM (nunca no front/log);
//   • o refresh token do Mercado Livre é de USO ÚNICO — toda renovação grava o
//     novo par, e a gravação é condicional ao token antigo para que duas
//     renovações simultâneas não queimem o vínculo;
//   • a consulta é só GET, só em api.mercadolibre.com, com o token do espaço.
//     Os caminhos exatos das consultas fiscais seguem a documentação do
//     Mercado Envios (links em MERCADOLIVRE_DOCS), liberada para o APP ID.

export const MERCADOLIVRE_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
export const MERCADOLIVRE_API = "https://api.mercadolibre.com";
const TOKEN_URL = `${MERCADOLIVRE_API}/oauth/token`;
const BASE = "/api/todogreen/integrations/mercadolivre";
export const MERCADOLIVRE_CALLBACK_PATH = `${BASE}/oauth/callback`;
const REFRESH_MARGIN_S = 5 * 60;

export const MERCADOLIVRE_DOCS = [
  { id: "app-id", label: "Criação do App ID (OAuth)", url: "https://developers.mercadoenvios.com/pt_br/oauth_access_control" },
  { id: "dados-fiscais", label: "Como obter dados fiscais de envio", url: "https://developers.mercadoenvios.com/pt_br/how-obtain-shipping-tax-data" },
  { id: "linehaul-venda", label: "Rotas middle-mile/linehaul · fluxo de venda", url: "https://developers.mercadoenvios.com/pt_br/consult-linehaul-routes-and-shipments" },
  { id: "linehaul-mwh", label: "Rotas middle-mile/linehaul · MWH (transferências)", url: "https://developers.mercadoenvios.com/pt_br/consult-fiscal-info-mwh" },
  { id: "carrito-v3", label: "Informações fiscais · Carrito V3", url: "https://developers.mercadoenvios.com/pt_br/consult-fiscal-info-carrito-v3" },
  { id: "shipment", label: "Informações fiscais · Shipment", url: "https://developers.mercadoenvios.com/pt_br/consult-fiscal-info-shipment" },
  { id: "cte", label: "Consulta de CT-e", url: "https://developers.mercadoenvios.com/pt_br/cte-consult" },
];

const enc = new TextEncoder();
const dec = new TextDecoder();

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const nowS = () => Math.floor(Date.now() / 1000);

const b64url = (bytes) => {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const fromB64url = (value) => {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

const randomToken = (bytes = 32) => {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return b64url(data);
};

const sha256 = async (value) => b64url(new Uint8Array(
  await crypto.subtle.digest("SHA-256", enc.encode(String(value ?? ""))),
));

export const mercadoLivreConfig = (env = {}) => {
  const clientId = String(env.MERCADOLIVRE_CLIENT_ID || "").trim();
  const clientSecret = String(env.MERCADOLIVRE_CLIENT_SECRET || "").trim();
  const explicitKey = String(env.MERCADOLIVRE_TOKEN_ENCRYPTION_KEY || "").trim();
  const tokenKey = explicitKey || (clientSecret ? `${clientSecret}:todogreen:mercadolivre:token:v1` : "");
  return {
    clientId,
    clientSecret,
    tokenKey,
    configured: Boolean(clientId && clientSecret),
    missing: [!clientId && "MERCADOLIVRE_CLIENT_ID", !clientSecret && "MERCADOLIVRE_CLIENT_SECRET"].filter(Boolean),
  };
};

async function aesKey(secret) {
  if (!secret) throw new Error("missing_encryption_key");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(String(secret)));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(value, secret) {
  if (!value) return "";
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, await aesKey(secret), enc.encode(String(value)),
  ));
  return `v1.${b64url(iv)}.${b64url(cipher)}`;
}

export async function decryptToken(value, secret) {
  const [version, iv, cipher] = String(value || "").split(".");
  if (version !== "v1" || !iv || !cipher) throw new Error("token_format");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(iv) }, await aesKey(secret), fromB64url(cipher),
  );
  return dec.decode(plain);
}

const callbackUrl = (request) => `${new URL(request.url).origin}${MERCADOLIVRE_CALLBACK_PATH}`;

const integrationsUrl = (request, status) => {
  const url = new URL("/todogreen/integracoes", request.url);
  url.searchParams.set("mercadolivre", status);
  return url.toString();
};

// O endpoint de token do Mercado Livre espera x-www-form-urlencoded.
async function postToken(params) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

const connectionRow = (env, ownerId) => env.DB.prepare(
  `SELECT id,workspace_owner_id,meli_user_id,meli_nickname,connected_by,scopes,access_token_enc,
          refresh_token_enc,access_expires_at,status,last_error,created_at,updated_at
     FROM todogreen_mercadolivre_connections
    WHERE tenant_id='todogreen' AND workspace_owner_id=?`,
).bind(String(ownerId || "")).first();

// Resumo sem nenhum token — é o que a tela e o status das integrações recebem.
export async function mercadoLivreConnectionSummary(env, ownerId) {
  if (!env?.DB || !ownerId) return null;
  const row = await connectionRow(env, ownerId).catch(() => null);
  if (!row) return null;
  return {
    userId: String(row.meli_user_id || ""),
    nickname: String(row.meli_nickname || ""),
    status: String(row.status || ""),
    scopes: String(row.scopes || ""),
    lastError: String(row.last_error || ""),
    accessExpiresAt: row.access_expires_at ? new Date(Number(row.access_expires_at) * 1000).toISOString() : "",
    connectedAt: row.created_at ? new Date(Number(row.created_at) * 1000).toISOString() : "",
    updatedAt: row.updated_at ? new Date(Number(row.updated_at) * 1000).toISOString() : "",
  };
}

async function startOauth(request, env, access, user) {
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);
  if (!podeNaVertical(access, "integration:manage")) {
    return json({ error: "Seu papel não pode gerenciar integrações." }, 403);
  }
  const config = mercadoLivreConfig(env);
  if (!config.configured) {
    return json({ error: "Credenciais do App do Mercado Livre não configuradas no Worker.", missing: config.missing }, 503);
  }

  const state = randomToken(32);
  const verifier = randomToken(48);
  const redirectUri = callbackUrl(request);
  const now = nowS();
  await env.DB.prepare(
    `INSERT INTO todogreen_mercadolivre_oauth_states
      (state,tenant_id,workspace_owner_id,created_by,code_verifier,redirect_uri,expires_at,created_at)
     VALUES (?,'todogreen',?,?,?,?,?,?)`,
  ).bind(
    state,
    String(access?.ownerId || ""),
    String(user?.id || access?.userId || ""),
    verifier,
    redirectUri,
    now + 10 * 60,
    now,
  ).run();

  const auth = new URL(MERCADOLIVRE_AUTH_URL);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", config.clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", await sha256(verifier));
  auth.searchParams.set("code_challenge_method", "S256");
  // JSON em vez de 302: o front autentica por Bearer e faz a navegação de topo.
  return json({ authorizeUrl: auth.toString() });
}

async function exchangeOauthCode(request, env) {
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);

  const url = new URL(request.url);
  if (url.searchParams.get("error")) return Response.redirect(integrationsUrl(request, "denied"), 302);

  const code = String(url.searchParams.get("code") || "").trim();
  const state = String(url.searchParams.get("state") || "").trim();
  if (!code || !state) return json({ error: "Callback OAuth sem code/state." }, 400);

  const config = mercadoLivreConfig(env);
  if (!config.configured) {
    return json({ error: "OAuth do Mercado Livre ainda não está habilitado no Worker.", missing: config.missing }, 503);
  }

  const row = await env.DB.prepare(
    `SELECT state,workspace_owner_id,created_by,code_verifier,redirect_uri,expires_at,used_at
       FROM todogreen_mercadolivre_oauth_states WHERE state=?`,
  ).bind(state).first();
  const now = nowS();
  if (!row || row.used_at || Number(row.expires_at) < now) {
    return json({ error: "Estado OAuth inválido ou expirado." }, 400);
  }
  // Queima o estado ANTES da troca: um code reenviado não vira segundo vínculo.
  const burn = await env.DB.prepare(
    "UPDATE todogreen_mercadolivre_oauth_states SET used_at=? WHERE state=? AND used_at IS NULL",
  ).bind(now, state).run();
  if (!burn?.meta?.changes) return json({ error: "Estado OAuth já utilizado." }, 400);

  const token = await postToken({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: String(row.redirect_uri || callbackUrl(request)),
    code_verifier: String(row.code_verifier || ""),
  });
  const tokens = token.body || {};
  if (!token.ok || !tokens.access_token || !tokens.refresh_token) {
    console.error("Mercado Livre OAuth token exchange failed", token.status, tokens?.error || "");
    return Response.redirect(integrationsUrl(request, "error"), 302);
  }

  let meliUserId = String(tokens.user_id || "");
  let nickname = "";
  const me = await fetch(`${MERCADOLIVRE_API}/users/me`, {
    headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
  }).catch(() => null);
  if (me?.ok) {
    const body = await me.json().catch(() => ({}));
    meliUserId = String(body?.id || meliUserId);
    nickname = String(body?.nickname || "");
  }
  if (!meliUserId) return Response.redirect(integrationsUrl(request, "error"), 302);

  const ownerId = String(row.workspace_owner_id || "");
  await env.DB.prepare(
    `INSERT INTO todogreen_mercadolivre_connections
      (id,tenant_id,workspace_owner_id,meli_user_id,meli_nickname,connected_by,scopes,
       access_token_enc,refresh_token_enc,access_expires_at,status,last_error,created_at,updated_at)
     VALUES (?,'todogreen',?,?,?,?,?,?,?,?,'connected','',?,?)
     ON CONFLICT(tenant_id,workspace_owner_id) DO UPDATE SET
       meli_user_id=excluded.meli_user_id,
       meli_nickname=excluded.meli_nickname,
       connected_by=excluded.connected_by,
       scopes=excluded.scopes,
       access_token_enc=excluded.access_token_enc,
       refresh_token_enc=excluded.refresh_token_enc,
       access_expires_at=excluded.access_expires_at,
       status='connected',
       last_error='',
       updated_at=excluded.updated_at`,
  ).bind(
    `mercadolivre-${ownerId}`,
    ownerId,
    meliUserId,
    nickname,
    String(row.created_by || ""),
    String(tokens.scope || ""),
    await encryptToken(tokens.access_token, config.tokenKey),
    await encryptToken(tokens.refresh_token, config.tokenKey),
    now + (Number(tokens.expires_in) || 6 * 60 * 60),
    now,
    now,
  ).run();

  return Response.redirect(integrationsUrl(request, "connected"), 302);
}

const markConnection = (env, ownerId, status, error) => env.DB.prepare(
  `UPDATE todogreen_mercadolivre_connections SET status=?, last_error=?, updated_at=?
    WHERE tenant_id='todogreen' AND workspace_owner_id=?`,
).bind(status, String(error || "").slice(0, 300), nowS(), String(ownerId)).run();

// Token de acesso válido do espaço, renovando quando falta pouco para expirar.
// Lança Error com `code` para o chamador traduzir em HTTP.
export async function mercadoLivreAccessToken(env, ownerId) {
  const fail = (code, message) => Object.assign(new Error(message), { code });
  const config = mercadoLivreConfig(env);
  if (!config.configured) throw fail("not_configured", "App do Mercado Livre não configurado no Worker.");
  const row = await connectionRow(env, ownerId);
  if (!row) throw fail("not_connected", "Este espaço ainda não conectou a conta do Mercado Livre.");
  if (row.status !== "connected") {
    throw fail("reauthorize", "A autorização do Mercado Livre expirou ou foi revogada. Conecte a conta novamente.");
  }
  if (Number(row.access_expires_at || 0) - REFRESH_MARGIN_S > nowS()) {
    return decryptToken(row.access_token_enc, config.tokenKey);
  }

  const refreshToken = await decryptToken(row.refresh_token_enc, config.tokenKey);
  const token = await postToken({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  });
  const tokens = token.body || {};
  if (!token.ok || !tokens.access_token) {
    // invalid_grant = refresh vencido/revogado/já usado: só uma nova autorização resolve.
    if (tokens?.error === "invalid_grant" || token.status === 400 || token.status === 401) {
      // Outra requisição pode ter renovado agora mesmo com este refresh token.
      const fresh = await connectionRow(env, ownerId);
      if (fresh && fresh.refresh_token_enc !== row.refresh_token_enc && fresh.status === "connected") {
        return decryptToken(fresh.access_token_enc, config.tokenKey);
      }
      await markConnection(env, ownerId, "reauthorize", tokens?.message || tokens?.error || "invalid_grant");
      throw fail("reauthorize", "A autorização do Mercado Livre expirou ou foi revogada. Conecte a conta novamente.");
    }
    throw fail("upstream", "O Mercado Livre não renovou o token agora. Tente novamente em instantes.");
  }

  const now = nowS();
  const update = await env.DB.prepare(
    `UPDATE todogreen_mercadolivre_connections
        SET access_token_enc=?, refresh_token_enc=?, access_expires_at=?, scopes=?, last_error='', updated_at=?
      WHERE tenant_id='todogreen' AND workspace_owner_id=? AND refresh_token_enc=?`,
  ).bind(
    await encryptToken(tokens.access_token, config.tokenKey),
    await encryptToken(tokens.refresh_token || refreshToken, config.tokenKey),
    now + (Number(tokens.expires_in) || 6 * 60 * 60),
    String(tokens.scope || row.scopes || ""),
    now,
    String(ownerId),
    row.refresh_token_enc,
  ).run();
  if (!update?.meta?.changes) {
    // Corrida perdida: vale o par que a outra renovação gravou.
    const fresh = await connectionRow(env, ownerId);
    if (fresh?.status === "connected") return decryptToken(fresh.access_token_enc, config.tokenKey);
  }
  return String(tokens.access_token);
}

const SAFE_PATH = /^\/[A-Za-z0-9._~\-/]{0,299}$/;

// Normaliza e valida o caminho de uma consulta: só GET em api.mercadolibre.com.
export function mercadoLivreConsultUrl(path, query = {}) {
  const raw = String(path || "").trim();
  if (!SAFE_PATH.test(raw) || raw.includes("..") || raw.includes("//")) return null;
  if (raw.startsWith("/oauth")) return null;
  const url = new URL(raw, MERCADOLIVRE_API);
  if (url.origin !== MERCADOLIVRE_API) return null;
  const entries = Object.entries(query && typeof query === "object" ? query : {}).slice(0, 20);
  for (const [key, value] of entries) {
    const k = String(key).trim().slice(0, 60);
    if (!k || value === undefined || value === null) continue;
    url.searchParams.set(k, String(value).slice(0, 300));
  }
  return url;
}

// GET autenticado com o token do espaço. Um 401 força uma renovação e uma
// única nova tentativa (token revogado antes do prazo).
export async function consultarMercadoLivre(env, ownerId, path, query = {}) {
  const url = mercadoLivreConsultUrl(path, query);
  if (!url) throw Object.assign(new Error("Caminho de consulta inválido."), { code: "invalid_path" });

  const call = async (accessToken) => fetch(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  const started = Date.now();
  let response = await call(await mercadoLivreAccessToken(env, ownerId));
  if (response.status === 401) {
    await env.DB.prepare(
      `UPDATE todogreen_mercadolivre_connections SET access_expires_at=0
        WHERE tenant_id='todogreen' AND workspace_owner_id=?`,
    ).bind(String(ownerId)).run();
    response = await call(await mercadoLivreAccessToken(env, ownerId));
  }
  const text = (await response.text()).slice(0, 1_000_000);
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return {
    ok: response.ok,
    status: response.status,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    latencyMs: Date.now() - started,
    data,
  };
}

// Teste de conexão (botão "Testar"): identifica a conta autorizada.
export async function probeMercadoLivre(env, ownerId) {
  const result = await consultarMercadoLivre(env, ownerId, "/users/me");
  return {
    ok: result.ok,
    status: result.status,
    latencyMs: result.latencyMs,
    userId: result.ok ? String(result.data?.id || "") : "",
    nickname: result.ok ? String(result.data?.nickname || "") : "",
  };
}

const errorStatus = { not_configured: 503, not_connected: 409, reauthorize: 409, invalid_path: 400, upstream: 502 };

async function manageConnection(request, env, access) {
  if (request.method === "GET") {
    return json({
      config: { configured: mercadoLivreConfig(env).configured, callbackPath: MERCADOLIVRE_CALLBACK_PATH },
      connection: await mercadoLivreConnectionSummary(env, access.ownerId),
      docs: MERCADOLIVRE_DOCS,
    });
  }
  if (request.method !== "DELETE") return json({ error: "Método não permitido." }, 405);
  if (!podeNaVertical(access, "integration:manage")) {
    return json({ error: "Seu papel não pode gerenciar integrações." }, 403);
  }
  await env.DB.prepare(
    `DELETE FROM todogreen_mercadolivre_connections WHERE tenant_id='todogreen' AND workspace_owner_id=?`,
  ).bind(String(access.ownerId)).run();
  return json({ ok: true });
}

async function consulta(request, env, access) {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  // Quem opera integrações ou o fiscal (emite o CT-e a partir desses dados).
  if (!podeNaVertical(access, "integration:manage") && !podeNaVertical(access, "fiscal:manage")) {
    return json({ error: "Seu papel não pode consultar o Mercado Livre." }, 403);
  }
  const body = await request.json().catch(() => ({}));
  try {
    return json(await consultarMercadoLivre(env, access.ownerId, body.path, body.query));
  } catch (error) {
    if (error?.code) return json({ error: error.message, code: error.code }, errorStatus[error.code] || 502);
    throw error;
  }
}

export async function handleTodoGreenMercadoLivrePublic(request, env) {
  const path = new URL(request.url).pathname;
  if (path === MERCADOLIVRE_CALLBACK_PATH) return exchangeOauthCode(request, env);
  return null;
}

export async function handleTodoGreenMercadoLivreManage(request, env, access, user) {
  const path = new URL(request.url).pathname;
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);
  if (path === `${BASE}/oauth/start`) return startOauth(request, env, access, user);
  if (path === `${BASE}/connection`) return manageConnection(request, env, access);
  if (path === `${BASE}/consulta`) return consulta(request, env, access);
  return null;
}
