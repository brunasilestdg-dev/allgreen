// ===== Como o produto fala com quem está fora dele =====
//
// E-mail, WhatsApp e Web Push. As três saídas do worker para o mundo, juntas
// porque compartilham a mesma pergunta antes de cada envio: isto está
// configurado neste ambiente? Sem a checagem, um ambiente sem chave falha com
// erro de rede em vez de dizer que o canal não existe.
//
// `notifyNewNotifications` compara a lista antes e depois da sincronização e
// dispara push só para o que apareceu. Comparar em vez de disparar no momento
// da escrita é o que evita a pessoa receber a mesma notificação duas vezes
// quando dois aparelhos sincronizam.

import { buildPushPayload } from "@block65/webcrypto-web-push";

export const escMail = (v) =>
  String(v || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function emailEnabled(env) {
  return !!(env.BREVO_API_KEY && env.MAIL_SENDER);
}

export function sixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function codeEmailHtml(code) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1e1b35">
    <div style="background:#0f0d1c;border-radius:14px;padding:20px;text-align:center">
      <span style="color:#fff;font-size:18px;font-weight:bold">Seu Funcionário</span>
    </div>
    <h2 style="margin:24px 0 8px">Seu código de acesso</h2>
    <p style="color:#555;margin:0 0 18px">Use o código abaixo para ativar sua conta. Ele expira em 15 minutos.</p>
    <div style="font-size:34px;letter-spacing:10px;font-weight:bold;text-align:center;background:#f1eff8;border-radius:12px;padding:18px;color:#0b9f8f">${code}</div>
    <p style="color:#888;font-size:12px;margin:20px 0 0">Se você não solicitou este código, ignore este e-mail.</p>
  </div>`;
}

const ROLE_LABELS = {
  admin: "Administrador",
  gestor: "Gestor",
  colaborador: "Colaborador",
};

export function inviteEmailHtml(inviteeName, ownerName, role, link) {
  const roleLabel = ROLE_LABELS[role] || "Colaborador";
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1e1b35">
    <div style="background:#0f0d1c;border-radius:14px;padding:20px;text-align:center">
      <span style="color:#fff;font-size:18px;font-weight:bold">Seu Funcionário</span>
    </div>
    <h2 style="margin:24px 0 8px">${escMail(ownerName)} convidou você</h2>
    <p style="color:#555;margin:0 0 18px">Olá, ${escMail(inviteeName)}. Você foi convidado para o espaço de ${escMail(ownerName)} como <strong>${roleLabel}</strong>. Clique no botão abaixo para criar sua conta e começar.</p>
    <div style="text-align:center;margin:22px 0">
      <a href="${link}" style="display:inline-block;background:#0b9f8f;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:bold">Aceitar convite</a>
    </div>
    <p style="color:#888;font-size:12px;margin:20px 0 0">O convite expira em 7 dias e só pode ser usado por este e-mail. Se você não esperava este convite, ignore esta mensagem.</p>
  </div>`;
}

export async function sendEmail(env, to, subject, html) {
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: env.MAIL_SENDER,
        name: env.MAIL_SENDER_NAME || "Seu Funcionário",
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Falha no envio (${resp.status}) ${t.slice(0, 140)}`);
  }
}

const plainTextHtml = (text) =>
  `<div style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.5;color:#1e1b35">${escMail(text)}</div>`;

export async function sendEmailText(env, to, subject, text) {
  if (env.OUTBOX_TEST_DELIVERY === "mock") return { provider: "brevo" };
  if (!emailEnabled(env))
    throw new Error("O envio automático de e-mail não está configurado.");
  await sendEmail(
    env,
    to,
    subject || "Mensagem do Seu Funcionário",
    plainTextHtml(text),
  );
  return { provider: "brevo" };
}

const evolutionWhatsappConfig = (env = {}) => {
  const baseUrl = String(env.EVOLUTION_API_BASE_URL || "").trim();
  const apiKey = String(env.EVOLUTION_API_KEY || "").trim();
  const instance = String(env.EVOLUTION_INSTANCE || "").trim();
  if (!baseUrl || !apiKey || !instance) return null;
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return {
      baseUrl: url.toString().replace(/\/$/, ""),
      apiKey,
      instance,
    };
  } catch {
    return null;
  }
};

const metaWhatsappEnabled = (env = {}) =>
  Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID);

export function whatsappEnabled(env) {
  return Boolean(evolutionWhatsappConfig(env) || metaWhatsappEnabled(env));
}

const normalizeWhatsappTo = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
};

export async function sendWhatsAppText(env, to, text) {
  const evolution = evolutionWhatsappConfig(env);
  if (env.OUTBOX_TEST_DELIVERY === "mock")
    return {
      provider: evolution ? "evolution_api" : "whatsapp_cloud_api",
      providerMessageId: "wamid.test",
    };
  if (!whatsappEnabled(env))
    throw new Error("O envio automático de WhatsApp não está configurado.");
  const phone = normalizeWhatsappTo(to);
  if (!phone)
    throw new Error("Informe o WhatsApp com DDI e DDD para envio automático.");

  if (evolution) {
    const resp = await fetch(
      `${evolution.baseUrl}/message/sendText/${encodeURIComponent(evolution.instance)}`,
      {
        method: "POST",
        headers: {
          apikey: evolution.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          number: phone,
          textMessage: { text: String(text || "") },
          linkPreview: false,
        }),
      },
    );
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok)
      throw new Error(
        payload?.response?.message ||
          payload?.message ||
          payload?.error ||
          `Falha na Evolution API (${resp.status}).`,
      );
    return {
      provider: "evolution_api",
      providerMessageId:
        payload?.key?.id || payload?.message?.key?.id || payload?.messageId || "",
    };
  }

  const version = env.WHATSAPP_API_VERSION || "v20.0";
  const resp = await fetch(
    `https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    },
  );
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok)
    throw new Error(
      payload?.error?.message || `Falha no WhatsApp (${resp.status}).`,
    );
  return {
    provider: "whatsapp_cloud_api",
    providerMessageId: payload?.messages?.[0]?.id || "",
  };
}

export function pushEnabled(env) {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

// Envia uma notificação Web Push para uma única assinatura. Retorna
// { ok: true } em sucesso, ou { ok: false, gone: true } quando o navegador
// já invalidou essa assinatura (404/410) — sinal para apagá-la do banco.
export async function sendWebPush(env, subscription, message) {
  const vapid = {
    subject:
      env.VAPID_SUBJECT ||
      "https://orianone.app",
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  const payload = await buildPushPayload(message, subscription, vapid);
  const response = await fetch(subscription.endpoint, payload);
  if (response.ok) return { ok: true };
  if (response.status === 404 || response.status === 410)
    return { ok: false, gone: true };
  return { ok: false, gone: false };
}

// Compara as notificações antes/depois de um PUT em /api/workspace e envia
// um Web Push para cada uma que for genuinamente nova (não existia antes),
// desde que o destinatário (assigneeId) tenha alguma assinatura salva.
export async function notifyNewNotifications(env, beforeList, afterList) {
  if (!pushEnabled(env)) return;
  const before = new Set(
    (Array.isArray(beforeList) ? beforeList : [])
      .filter((n) => n && n.id)
      .map((n) => n.id),
  );
  const fresh = (Array.isArray(afterList) ? afterList : []).filter(
    (n) => n && n.id && n.assigneeId && !before.has(n.id),
  );
  if (!fresh.length) return;
  const recipients = new Map();
  for (const n of fresh) {
    if (!recipients.has(n.assigneeId)) recipients.set(n.assigneeId, []);
    recipients.get(n.assigneeId).push(n);
  }
  for (const [recipientId, items] of recipients) {
    let subs;
    try {
      subs = await env.DB.prepare(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
      )
        .bind(recipientId)
        .all();
    } catch (error) {
      console.error("push subscriptions lookup", error);
      continue;
    }
    const rows = subs.results || [];
    if (!rows.length) continue;
    const latest = items[0];
    const message = {
      data: {
        title: "Seu Funcionário",
        body: latest.message || "Você tem uma novidade.",
        link: latest.link || "/",
        count: items.length,
      },
      options: { ttl: 3600, urgency: "normal" },
    };
    for (const row of rows) {
      const subscription = {
        endpoint: row.endpoint,
        expirationTime: null,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
        const result = await sendWebPush(env, subscription, message);
        if (!result.ok && result.gone) {
          await env.DB.prepare(
            "DELETE FROM push_subscriptions WHERE endpoint = ?",
          )
            .bind(row.endpoint)
            .run();
        }
      } catch (error) {
        console.error("web push send", error);
      }
    }
  }
}
