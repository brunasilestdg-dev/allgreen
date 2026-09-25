// ===== Entrada de mensagens por webhook: WhatsApp e e-mail =====
//
// Contrato
// - Recebe: `request` e `env` (e `url`, no WhatsApp) de
//   `/api/inbound/whatsapp` (WhatsApp Cloud API da Meta) e
//   `/api/inbound/email` (Brevo Inbound Parsing ou formato genérico).
// - Devolve: `{ ok, inserted }` — quantas mensagens viraram interação `in`;
//   no GET do WhatsApp, o `hub.challenge` da verificação.
// - Quem chama: a tabela de rotas públicas; quem aciona é o provedor, não
//   uma pessoa com sessão.
// - Autorização: o WhatsApp confere `x-hub-signature-256` (HMAC com
//   `WHATSAPP_APP_SECRET`, quando configurado) e o token de verificação; o
//   e-mail exige o segredo `INBOUND_EMAIL_SECRET` por cabeçalho ou na URL.
//   O espaço de destino vem de `inbound_channels`, nunca do corpo. Os dois
//   são limitados por IP.

import { encoder, hex, sameHash } from "../auth/credenciais.js";
import { allowed, json } from "../lib/http.js";
import { normalizeInboundEmails } from "../mensageria/inbound-email.js";
import { insertInteraction } from "./omnichannel.js";

async function resolveInboundOwner(env, provider, accountId) {
  const id = String(accountId || "").trim().toLowerCase();
  if (!env.DB || !provider || !id) return "";
  const row = await env.DB.prepare(
    `SELECT workspace_owner_id FROM inbound_channels
      WHERE provider = ? AND lower(provider_account_id) = ? AND active = 1
      LIMIT 1`,
  )
    .bind(provider, id)
    .first();
  if (row?.workspace_owner_id) return row.workspace_owner_id;
  if (provider === "email" && id.includes("@")) {
    const domain = id.split("@").at(-1);
    const domainRow = await env.DB.prepare(
      `SELECT workspace_owner_id FROM inbound_channels
        WHERE provider = 'email' AND lower(provider_account_id) = ? AND active = 1
        LIMIT 1`,
    )
      .bind(domain)
      .first();
    if (domainRow?.workspace_owner_id) return domainRow.workspace_owner_id;
  }
  if (provider === "whatsapp" && env.WHATSAPP_INBOUND_OWNER_ID)
    return env.WHATSAPP_INBOUND_OWNER_ID;
  if (provider === "email" && env.EMAIL_INBOUND_OWNER_ID)
    return env.EMAIL_INBOUND_OWNER_ID;
  return env.INBOUND_WEBHOOK_OWNER_ID || "";
}

async function hmacSha256Hex(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}

async function validMetaSignature(request, rawBody, env) {
  if (!env.WHATSAPP_APP_SECRET) return true;
  const signature = request.headers.get("x-hub-signature-256") || "";
  const expected = `sha256=${await hmacSha256Hex(env.WHATSAPP_APP_SECRET, rawBody)}`;
  return sameHash(signature, expected);
}

export async function handleInboundWhatsApp(request, env, url) {
  if (!env.DB) return json({ error: "Banco de dados indisponível." }, 503);
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (
      mode === "subscribe" &&
      env.WHATSAPP_VERIFY_TOKEN &&
      token === env.WHATSAPP_VERIFY_TOKEN
    )
      return new Response(challenge, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    return json({ error: "Webhook não autorizado." }, 403);
  }
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  const ip = request.headers.get("cf-connecting-ip") || "public";
  if (!allowed(`inbound-whatsapp:${ip}`, 240))
    return json({ error: "Muitas mensagens em pouco tempo." }, 429);
  const raw = await request.text();
  if (!(await validMetaSignature(request, raw, env)))
    return json({ error: "Assinatura inválida." }, 403);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Webhook inválido." }, 400);
  }
  let inserted = 0;
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change.value || {};
      const accountId = value.metadata?.phone_number_id || env.WHATSAPP_PHONE_ID || "";
      const ownerId = await resolveInboundOwner(env, "whatsapp", accountId);
      if (!ownerId) continue;
      const contactsByWaId = new Map(
        (Array.isArray(value.contacts) ? value.contacts : []).map((contact) => [
          String(contact.wa_id || ""),
          contact.profile?.name || "",
        ]),
      );
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const from = String(message.from || "");
        const type = String(message.type || "text");
        const body =
          message.text?.body ||
          message[type]?.caption ||
          message.button?.text ||
          message.interactive?.button_reply?.title ||
          message.interactive?.list_reply?.title ||
          `[${type || "mensagem"} recebida]`;
        await insertInteraction(env, ownerId, ownerId, {
          channel: "whatsapp",
          direction: "in",
          contactName: contactsByWaId.get(from) || from,
          contactHandle: from,
          subject: "WhatsApp recebido",
          body,
          meta: {
            provider: "whatsapp_cloud_api",
            providerMessageId: message.id || "",
            providerAccountId: accountId,
            messageType: type,
          },
        });
        inserted += 1;
      }
    }
  }
  return json({ ok: true, inserted });
}

async function inboundEmailBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return request.json();
  const form = await request.formData();
  return Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
}

const stripHtml = (value) =>
  String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function handleInboundEmail(request, env) {
  if (!env.DB) return json({ error: "Banco de dados indisponível." }, 503);
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  // O segredo pode vir por header (provedores que permitem) OU pela URL
  // (?key=/?secret=) — o Brevo Inbound Parsing não deixa configurar header
  // customizado, então o segredo viaja na própria URL do webhook.
  const url = new URL(request.url);
  const secret =
    request.headers.get("x-sf-inbound-secret") ||
    request.headers.get("x-inbound-secret") ||
    url.searchParams.get("key") ||
    url.searchParams.get("secret") ||
    "";
  if (!env.INBOUND_EMAIL_SECRET || !sameHash(secret, env.INBOUND_EMAIL_SECRET))
    return json({ error: "Webhook não autorizado." }, 403);
  const ip = request.headers.get("cf-connecting-ip") || "public";
  if (!allowed(`inbound-email:${ip}`, 240))
    return json({ error: "Muitos e-mails em pouco tempo." }, 429);
  let body;
  try {
    body = await inboundEmailBody(request);
  } catch {
    return json({ error: "Webhook inválido." }, 400);
  }
  // Entende o formato genérico (um e-mail no topo) e o do Brevo (array items[]).
  const messages = normalizeInboundEmails(body);
  if (!messages.length) return json({ error: "Webhook sem mensagens." }, 400);
  let inserted = 0;
  let anyOwner = false;
  for (const msg of messages) {
    const ownerId = await resolveInboundOwner(env, "email", msg.to);
    if (!ownerId) continue;
    anyOwner = true;
    await insertInteraction(env, ownerId, ownerId, {
      channel: "email",
      direction: "in",
      contactName: msg.fromName || msg.fromAddress,
      contactHandle: msg.fromAddress,
      subject: msg.subject || "(sem assunto)",
      body: (msg.text || stripHtml(msg.html) || "(e-mail sem texto)").slice(0, 4000),
      meta: {
        provider: "inbound_email_webhook",
        providerAccountId: msg.to,
        messageId: msg.messageId,
      },
    });
    inserted += 1;
  }
  if (!anyOwner)
    return json({ error: "Nenhum workspace configurado para este e-mail." }, 404);
  return json({ ok: true, inserted });
}
