import { isBlockedHost } from "../lib/net.js";
import { podeNaVertical } from "./todogreen-access.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

const PROVIDER = "mcp";
const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);

// O filtro de host é o de worker/lib/net.js (a fonte única contra SSRF): a
// versão local comparava prefixos de texto e deixava passar 0.0.0.0, CGNAT,
// `.internal` e o IPv6 que embrulha um IPv4 (metadados da nuvem inclusive).
const publicHttpsUrl = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return isBlockedHost(url.hostname) ? "" : url.href;
  } catch {
    return "";
  }
};

const vaultKey = async (env) => {
  const secret = String(env.WORKSPACE_AI_VAULT_KEY || "");
  if (secret.length < 32)
    throw new Error("Cofre indisponível: configure WORKSPACE_AI_VAULT_KEY.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
};

const toBase64 = (bytes) => {
  let value = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    value += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(value);
};
const fromBase64 = (value) => Uint8Array.from(atob(String(value || "")), (char) => char.charCodeAt(0));

const encrypt = async (env, secret) => {
  if (!secret) return { ciphertext: null, iv: null, prefix: "" };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await vaultKey(env),
    new TextEncoder().encode(secret),
  );
  return {
    ciphertext: toBase64(new Uint8Array(encrypted)),
    iv: toBase64(iv),
    prefix: `${secret.slice(0, 5)}…`,
  };
};

const decrypt = async (env, row) => {
  if (!row?.secret_ciphertext || !row?.secret_iv) return "";
  const opened = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(row.secret_iv) },
    await vaultKey(env),
    fromBase64(row.secret_ciphertext),
  );
  return new TextDecoder().decode(opened);
};

const ssePayload = (body) => {
  const line = String(body || "").split("\n").find((item) => item.trim().startsWith("data:"));
  if (!line) return null;
  try { return JSON.parse(line.replace(/^\s*data:\s*/, "")); }
  catch { return null; }
};

export const probeMcpServer = async ({ url, token = "" }) => {
  const endpoint = publicHttpsUrl(url);
  if (!endpoint)
    return { ok: false, error: "Use uma URL pública HTTPS. Endereços locais ou de rede privada não são aceitos." };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      // A checagem do endereço só vale para o primeiro salto: um host público
      // que responde 302 para 127.0.0.1 a driblaria. Redireção é recusa.
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "todogreen-connect",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "To Do Green", version: "1.0" },
        },
      }),
    });
    if (response.status >= 300 && response.status < 400)
      return { ok: false, error: "O servidor MCP tentou redirecionar para outro endereço. Informe a URL final do servidor." };
    const raw = await response.text();
    if (!response.ok)
      return { ok: false, error: `Servidor MCP respondeu ${response.status}: ${raw.slice(0, 220)}` };
    let payload = null;
    try { payload = JSON.parse(raw); }
    catch { payload = ssePayload(raw); }
    if (!payload?.result || payload.error)
      return { ok: false, error: "O endereço respondeu, mas não concluiu o initialize do protocolo MCP." };
    return {
      ok: true,
      error: "",
      serverName: text(payload.result.serverInfo?.name || "Servidor MCP", 120),
      protocolVersion: text(payload.result.protocolVersion || "2025-03-26", 40),
      capabilities: Object.keys(payload.result.capabilities || {}).slice(0, 20),
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === "AbortError"
        ? "O servidor MCP não respondeu em 12 segundos."
        : `Não foi possível conectar: ${text(error?.message || error, 180)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const screenData = (row) => row ? {
  name: row.label || "Servidor MCP",
  url: row.base_url || "",
  hasToken: Boolean(row.secret_ciphertext),
  active: row.status === "active",
  testedAt: row.last_test_at || "",
  testOk: row.last_test_ok === 1,
  testError: row.last_test_error || "",
  updatedAt: row.updated_at || "",
} : null;

export async function handleTodoGreenMcpConnections(request, env, access, user) {
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);
  if (!podeNaVertical(access, "integration:manage"))
    return json({ error: "Seu papel não pode gerenciar integrações MCP." }, 403);

  const ownerId = access.ownerId;
  const current = () => env.DB.prepare(
    "SELECT * FROM workspace_search_keys WHERE workspace_owner_id=? AND provider=?",
  ).bind(ownerId, PROVIDER).first();

  if (request.method === "GET") {
    const row = await current().catch(() => null);
    return json({
      vaultAvailable: String(env.WORKSPACE_AI_VAULT_KEY || "").length >= 32,
      connection: screenData(row),
      supportedTransport: "Streamable HTTP",
      oauthSupported: false,
    });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(
      "DELETE FROM workspace_search_keys WHERE workspace_owner_id=? AND provider=?",
    ).bind(ownerId, PROVIDER).run();
    return json({ ok: true });
  }

  if (request.method !== "POST" && request.method !== "PUT")
    return json({ error: "Método não permitido." }, 405);

  const body = await request.json().catch(() => ({}));
  if (body.action === "activate" || body.action === "deactivate") {
    const result = await env.DB.prepare(
      "UPDATE workspace_search_keys SET status=?, updated_at=? WHERE workspace_owner_id=? AND provider=?",
    ).bind(body.action === "activate" ? "active" : "inactive", new Date().toISOString(), ownerId, PROVIDER).run();
    if (!result?.meta?.changes) return json({ error: "Conexão MCP não cadastrada." }, 404);
    return json({ ok: true });
  }

  if (body.action === "test") {
    const row = await current();
    if (!row) return json({ error: "Conexão MCP não cadastrada." }, 404);
    let token = "";
    try { token = await decrypt(env, row); }
    catch (error) { return json({ error: error.message }, 503); }
    const result = await probeMcpServer({ url: row.base_url, token });
    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE workspace_search_keys SET last_test_at=?, last_test_ok=?, last_test_error=?, updated_at=? WHERE id=?",
    ).bind(now, result.ok ? 1 : 0, text(result.error, 400), now, row.id).run();
    return json(result, result.ok ? 200 : 502);
  }

  const url = publicHttpsUrl(body.url);
  if (!url)
    return json({ error: "Informe a URL pública HTTPS do servidor MCP. Endereços locais ou privados são bloqueados." }, 400);
  const name = text(body.name || "Servidor MCP", 120);
  let token = String(body.token || "").trim();
  if (!token) {
    const existing = await current().catch(() => null);
    if (existing?.secret_ciphertext) {
      try { token = await decrypt(env, existing); }
      catch (error) { return json({ error: error.message }, 503); }
    }
  }
  const result = await probeMcpServer({ url, token });
  if (!result.ok && body.saveAnyway !== true)
    return json({ error: "O servidor MCP não concluiu a conexão.", detail: result.error, canSaveAnyway: true }, 400);

  let secured;
  try { secured = await encrypt(env, token); }
  catch (error) { return json({ error: error.message }, 503); }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspace_search_keys
       (id, workspace_owner_id, provider, label, base_url, secret_ciphertext, secret_iv,
        secret_prefix, status, last_test_at, last_test_ok, last_test_error, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'active', ?,?,?,?,?,?)
     ON CONFLICT(workspace_owner_id, provider) DO UPDATE SET
       label=excluded.label, base_url=excluded.base_url,
       secret_ciphertext=excluded.secret_ciphertext, secret_iv=excluded.secret_iv,
       secret_prefix=excluded.secret_prefix, status='active',
       last_test_at=excluded.last_test_at, last_test_ok=excluded.last_test_ok,
       last_test_error=excluded.last_test_error, updated_at=excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), ownerId, PROVIDER, name, url,
    secured.ciphertext, secured.iv, secured.prefix,
    now, result.ok ? 1 : 0, text(result.error, 400), user?.id || access.userId || "", now, now,
  ).run();

  return json({ ...result, saved: true }, 201);
}
