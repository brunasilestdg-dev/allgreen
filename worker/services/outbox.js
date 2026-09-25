// ===== Envio automático de mensagem (/api/outbox/send) =====
//
// Contrato
// - Recebe: `request` (POST `{ channel: "email" | "whatsapp", to, subject?,
//   body, contactId?, contactName?, source? }`), `env`, `user` e `url`
//   (`?owner=`).
// - Devolve: `{ ok, channel, ...interação, delivery }`; 503 com
//   `PROVIDER_NOT_CONFIGURED` quando o canal não está configurado; 502
//   quando o envio falha.
// - Quem chama: a tabela de rotas autenticadas (exige sessão e banco).
// - Autorização: membro do espaço; 40 envios por minuto por pessoa. O que
//   sai fica registrado na caixa do espaço como interação `out`.

import { allowed, json } from "../lib/http.js";
import { membershipRole } from "../lib/membership.js";
import { sendEmailText, sendWhatsAppText } from "../mensageria/envio.js";
import { insertInteraction } from "./omnichannel.js";

export async function handleOutboxSend(request, env, user, url) {
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  if (!allowed(`outbox:${user.id}`, 40))
    return json({ error: "Muitos envios em pouco tempo." }, 429);
  const ownerId = url.searchParams.get("owner") || user.id;
  const role = await membershipRole(env, user.id, ownerId);
  if (!role) return json({ error: "Você não tem acesso a este espaço." }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Envio inválido." }, 400);
  }

  const channel = String(body.channel || "").trim();
  const to = String(body.to || body.contactHandle || "").trim();
  const subject = String(body.subject || "").trim().slice(0, 200);
  const text = String(body.body || body.text || "").trim().slice(0, 4000);
  if (!text) return json({ error: "Escreva a mensagem antes de enviar." }, 400);

  try {
    let delivery;
    if (channel === "email") {
      const email = to.toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email))
        return json({ error: "Informe um e-mail válido." }, 400);
      delivery = await sendEmailText(env, email, subject, text);
    } else if (channel === "whatsapp") {
      delivery = await sendWhatsAppText(env, to, text);
    } else {
      return json({ error: "Canal de envio automático inválido." }, 400);
    }

    const record = await insertInteraction(env, ownerId, user.id, {
      channel,
      direction: "out",
      contactId: body.contactId,
      contactName: body.contactName,
      contactHandle: to,
      subject,
      body: text,
      meta: {
        automatic: true,
        source: body.source || "outbox",
        provider: delivery.provider,
        providerMessageId: delivery.providerMessageId || "",
      },
    });
    return json({ ok: true, channel, ...record, delivery });
  } catch (error) {
    const message = error.message || "Não foi possível enviar automaticamente.";
    const missing = /não está configurado|nao esta configurado/i.test(message);
    return json({ error: message, code: missing ? "PROVIDER_NOT_CONFIGURED" : "SEND_FAILED" }, missing ? 503 : 502);
  }
}
