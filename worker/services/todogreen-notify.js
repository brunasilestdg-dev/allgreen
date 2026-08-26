// ===== Notificações ao cliente do portal =====
//
// A infraestrutura de e-mail (Brevo) existia e estava ociosa: a equipe
// respondia uma solicitação, a entrega acontecia — e o cliente só descobria
// se voltasse ao portal por conta própria. Este módulo avisa os usuários
// ATIVOS do portal daquele cliente, e nunca derruba a operação que o chamou:
// e-mail é cortesia, não pré-condição.

import { emailEnabled, escMail, sendEmail } from "../mensageria/envio.js";

const TENANT_ID = "todogreen";

const moldura = (titulo, corpo, chamada) => `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1e1b35">
  <div style="background:#173d31;border-radius:14px;padding:20px;text-align:center">
    <span style="color:#fff;font-size:18px;font-weight:bold">To Do Green · Portal do Cliente</span>
  </div>
  <h2 style="margin:24px 0 8px">${titulo}</h2>
  <p style="color:#555;margin:0 0 18px">${corpo}</p>
  <div style="text-align:center;margin:22px 0">
    <a href="${chamada.url}" style="display:inline-block;background:#0b9f8f;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:bold">${chamada.rotulo}</a>
  </div>
  <p style="color:#888;font-size:12px;margin:20px 0 0">Você recebe este aviso porque tem acesso ao portal. Dúvidas? Responda pela aba Solicitações.</p>
</div>`;

// Envia para todos os usuários ativos do portal do cliente. Falha de envio é
// engolida de propósito: o dado já está gravado e o portal já mostra — o
// e-mail que não saiu não pode desfazer a entrega que aconteceu.
export async function notificarPortalDoCliente(env, clientId, { assunto, titulo, corpo, origem }) {
  try {
    if (!emailEnabled(env) || !clientId) return { enviados: 0 };
    const { results } = await env.DB.prepare(
      `SELECT v.email FROM todogreen_client_users v
         JOIN todogreen_clients c ON c.id = v.client_id AND c.tenant_id = v.tenant_id
        WHERE v.tenant_id = ? AND v.client_id = ? AND v.status = 'active'
          AND c.portal_enabled = 1 AND c.archived_at IS NULL
        LIMIT 20`,
    ).bind(TENANT_ID, clientId).all();
    const emails = (results || []).map((linha) => linha.email).filter(Boolean);
    if (!emails.length) return { enviados: 0 };
    const html = moldura(escMail(titulo), escMail(corpo), {
      url: `${origem || ""}/portal-cliente`,
      rotulo: "Abrir o portal",
    });
    let enviados = 0;
    for (const email of emails) {
      // Um destinatário com e-mail inválido não pode calar os demais.
      const ok = await sendEmail(env, email, assunto, html).then(() => true).catch(() => false);
      if (ok) enviados += 1;
    }
    return { enviados };
  } catch {
    return { enviados: 0 };
  }
}
