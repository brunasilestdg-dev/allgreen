import { podeNaVertical } from "./todogreen-access.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extra,
  },
});

const b64url = (bytes) => {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const fromB64url = (value) => {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const decodeJwtPayload = (token) => {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(dec.decode(fromB64url(parts[1])));
  } catch {
    return null;
  }
};

const sha256 = async (value) => b64url(new Uint8Array(
  await crypto.subtle.digest("SHA-256", enc.encode(String(value ?? ""))),
));

const randomToken = (bytes = 32) => {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return b64url(data);
};

const signingToken = (request) => {
  const raw = String(request.headers.get("authorization") || "").trim();
  return raw.replace(/^Bearer\s+/i, "").trim();
};

async function verifyHs256Jwt(token, secret, expectedAudience) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !secret) throw new Error("jwt_invalid");

  let header;
  let payload;
  try {
    header = JSON.parse(dec.decode(fromB64url(parts[0])));
    payload = JSON.parse(dec.decode(fromB64url(parts[1])));
  } catch {
    throw new Error("jwt_invalid");
  }
  if (header?.alg !== "HS256") throw new Error("jwt_alg");

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    fromB64url(parts[2]),
    enc.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error("jwt_signature");

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(payload?.exp)) || Number(payload.exp) <= now) throw new Error("jwt_expired");

  const audiences = Array.isArray(payload?.aud) ? payload.aud : [payload?.aud];
  if (expectedAudience && !audiences.includes(expectedAudience)) throw new Error("jwt_audience");

  return payload;
}

async function encryptionKey(secret) {
  if (!secret) throw new Error("missing_encryption_key");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(String(secret)));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
}

async function encryptSecret(value, secret) {
  if (!value) return "";
  const key = await encryptionKey(secret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(String(value)),
  ));
  return `v1.${b64url(iv)}.${b64url(cipher)}`;
}

const callbackUrl = (request) => {
  const url = new URL(request.url);
  return `${url.origin}/api/todogreen/integrations/monday/oauth/callback`;
};

const integrationsUrl = (request, status) => {
  const url = new URL("/todogreen/integracoes", request.url);
  url.searchParams.set("monday", status);
  return url.toString();
};

async function startOauth(request, env, access, user) {
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);
  if (!podeNaVertical(access, "integration:manage")) {
    return json({ error: "Seu papel não pode gerenciar integrações." }, 403);
  }

  const clientId = String(env.MONDAY_CLIENT_ID || "").trim();
  if (!clientId) return json({ error: "MONDAY_CLIENT_ID não configurado no Worker." }, 503);

  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = await sha256(verifier);
  const redirectUri = callbackUrl(request);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 10 * 60;

  await env.DB.prepare(
    `INSERT INTO todogreen_monday_oauth_states
      (state,tenant_id,workspace_owner_id,created_by,code_verifier,redirect_uri,expires_at,created_at)
     VALUES (?,'todogreen',?,?,?,?,?,?)`,
  ).bind(
    state,
    String(access?.ownerId || ""),
    String(user?.id || access?.userId || ""),
    verifier,
    redirectUri,
    expiresAt,
    now,
  ).run();

  const auth = new URL("https://auth.monday.com/oauth2/authorize");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", challenge);
  auth.searchParams.set("code_challenge_method", "S256");

  return Response.redirect(auth.toString(), 302);
}

async function exchangeOauthCode(request, env) {
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);

  const url = new URL(request.url);
  if (url.searchParams.get("status") && url.searchParams.get("status") !== "success") {
    return Response.redirect(integrationsUrl(request, "denied"), 302);
  }

  const code = String(url.searchParams.get("code") || "").trim();
  const state = String(url.searchParams.get("state") || "").trim();
  if (!code || !state) return json({ error: "Callback OAuth sem code/state." }, 400);

  const clientId = String(env.MONDAY_CLIENT_ID || "").trim();
  const clientSecret = String(env.MONDAY_CLIENT_SECRET || "").trim();
  const tokenKey = String(env.MONDAY_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!clientId || !clientSecret || !tokenKey) {
    return json({
      error: "OAuth do monday.com ainda não está habilitado no Worker.",
      missing: [
        !clientId && "MONDAY_CLIENT_ID",
        !clientSecret && "MONDAY_CLIENT_SECRET",
        !tokenKey && "MONDAY_TOKEN_ENCRYPTION_KEY",
      ].filter(Boolean),
    }, 503);
  }

  const row = await env.DB.prepare(
    `SELECT state,workspace_owner_id,created_by,code_verifier,redirect_uri,expires_at,used_at
       FROM todogreen_monday_oauth_states WHERE state=?`,
  ).bind(state).first();

  const now = Math.floor(Date.now() / 1000);
  if (!row || row.used_at || Number(row.expires_at) < now) {
    return json({ error: "Estado OAuth inválido ou expirado." }, 400);
  }

  const tokenResponse = await fetch("https://auth.monday.com/oauth_ms/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: String(row.code_verifier || ""),
      redirect_uri: String(row.redirect_uri || callbackUrl(request)),
    }),
  });

  const tokens = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokens?.access_token || !tokens?.refresh_token) {
    console.error("Monday OAuth token exchange failed", tokenResponse.status);
    return json({ error: "O monday.com não concluiu a autorização." }, 502);
  }

  const meResponse = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      authorization: String(tokens.access_token),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: "query { me { id name account { id name slug } } }",
    }),
  });
  const meBody = await meResponse.json().catch(() => ({}));
  const account = meBody?.data?.me?.account;
  if (!meResponse.ok || !account?.id) {
    console.error("Monday account identification failed", meResponse.status);
    return json({ error: "Autorização recebida, mas não foi possível identificar a conta monday.com." }, 502);
  }

  const accessTokenEnc = await encryptSecret(tokens.access_token, tokenKey);
  const refreshTokenEnc = await encryptSecret(tokens.refresh_token, tokenKey);
  const tokenPayload = decodeJwtPayload(tokens.access_token);
  const accessExpiresAt = Number(tokenPayload?.exp) || (tokens.expires_in ? now + Number(tokens.expires_in) : null);
  const connectionId = `monday-${row.workspace_owner_id}-${account.id}`;

  await env.DB.prepare(
    `INSERT INTO todogreen_monday_connections
      (id,tenant_id,workspace_owner_id,monday_account_id,monday_account_name,monday_account_slug,
       connected_by,scopes,access_token_enc,refresh_token_enc,access_expires_at,status,created_at,updated_at)
     VALUES (?,'todogreen',?,?,?,?,?,?,?,?,?,?,'connected',?,?)
     ON CONFLICT(tenant_id,workspace_owner_id,monday_account_id) DO UPDATE SET
       monday_account_name=excluded.monday_account_name,
       monday_account_slug=excluded.monday_account_slug,
       connected_by=excluded.connected_by,
       scopes=excluded.scopes,
       access_token_enc=excluded.access_token_enc,
       refresh_token_enc=excluded.refresh_token_enc,
       access_expires_at=excluded.access_expires_at,
       status='connected',
       updated_at=excluded.updated_at`,
  ).bind(
    connectionId,
    String(row.workspace_owner_id || ""),
    String(account.id),
    String(account.name || ""),
    String(account.slug || ""),
    String(row.created_by || meBody?.data?.me?.id || ""),
    String(tokens.scope || ""),
    accessTokenEnc,
    refreshTokenEnc,
    accessExpiresAt,
    now,
    now,
  ).run();

  await env.DB.prepare(
    "UPDATE todogreen_monday_oauth_states SET used_at=? WHERE state=? AND used_at IS NULL",
  ).bind(now, state).run();

  return Response.redirect(integrationsUrl(request, "connected"), 302);
}

async function receiveWebhook(request, env) {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const raw = await request.text();
  if (raw.length > 1_000_000) return json({ error: "Payload muito grande." }, 413);

  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  // monday.com valida a URL enviando um challenge e exige o mesmo valor na resposta.
  if (typeof body?.challenge === "string" && !body?.event) {
    return json({ challenge: body.challenge });
  }

  const signingSecret = String(env.MONDAY_SIGNING_SECRET || "").trim();
  if (!signingSecret) return json({ error: "MONDAY_SIGNING_SECRET não configurado." }, 503);

  let claims;
  try {
    claims = await verifyHs256Jwt(signingToken(request), signingSecret, request.url);
  } catch (error) {
    console.warn("Monday webhook rejected", error?.message || "jwt_invalid");
    return json({ error: "Webhook não autenticado." }, 401);
  }

  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);

  const payloadHash = await sha256(raw);
  const suppliedId = String(
    request.headers.get("x-apps-event-id")
      || body?.event?.triggerUuid
      || body?.triggerUuid
      || "",
  ).trim();
  const eventId = suppliedId ? `monday:${suppliedId}` : `monday:sha256:${payloadHash}`;
  const event = body?.event || body || {};
  const now = Math.floor(Date.now() / 1000);

  try {
    await env.DB.prepare(
      `INSERT INTO todogreen_monday_webhook_events
        (id,tenant_id,monday_account_id,monday_user_id,board_id,item_id,event_type,
         payload_hash,payload_json,status,received_at,created_at)
       VALUES (?,'todogreen',?,?,?,?,?,?,?,'received',?,?)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      eventId,
      String(claims?.accountId || event?.accountId || ""),
      String(claims?.userId || event?.userId || ""),
      String(event?.boardId || event?.board_id || ""),
      String(event?.itemId || event?.pulseId || event?.item_id || ""),
      String(event?.type || body?.type || ""),
      payloadHash,
      raw,
      now,
      now,
    ).run();
  } catch (error) {
    console.error("Monday webhook persistence failed", error);
    return json({ error: "Inbox do monday.com indisponível." }, 503);
  }

  return json({ ok: true, id: eventId });
}

export async function handleTodoGreenMondayPublic(request, env) {
  const path = new URL(request.url).pathname;
  if (path === "/api/todogreen/integrations/monday/webhook") return receiveWebhook(request, env);
  if (path === "/api/todogreen/integrations/monday/oauth/callback") return exchangeOauthCode(request, env);
  return null;
}

export async function handleTodoGreenMondayManage(request, env, access, user) {
  const path = new URL(request.url).pathname;
  if (path === "/api/todogreen/integrations/monday/oauth/start") {
    return startOauth(request, env, access, user);
  }
  return null;
}
