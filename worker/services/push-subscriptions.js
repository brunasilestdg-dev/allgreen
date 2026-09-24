// ===== Assinaturas de Web Push do navegador (/api/push/*) =====
//
// Contrato
// - Recebe: `request` (POST), `env`, `user` e `url`:
//   `/api/push/subscribe` com `{ endpoint, keys: { p256dh, auth } }` e
//   `/api/push/unsubscribe` com `{ endpoint }`.
// - Devolve: `{ ok: true }`; 503 quando o Web Push não está configurado
//   (sem VAPID); 404 para outra ação.
// - Quem chama: a tabela de rotas autenticadas (exige sessão e banco).
// - Autorização: a assinatura é sempre gravada para a pessoa da sessão, e o
//   cancelamento só apaga um endpoint que seja dela.

import { json } from "../lib/http.js";
import { pushEnabled } from "../mensageria/envio.js";

export async function handlePush(request, env, user, url) {
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  const action = url.pathname.replace("/api/push/", "");
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  if (action === "subscribe") {
    if (!pushEnabled(env))
      return json(
        { error: "Notificações do navegador não estão configuradas." },
        503,
      );
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const p256dh = body.keys?.p256dh;
    const auth = body.keys?.auth;
    if (
      !endpoint ||
      typeof p256dh !== "string" ||
      !p256dh ||
      typeof auth !== "string" ||
      !auth
    )
      return json({ error: "Assinatura inválida." }, 400);
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id, p256dh = excluded.p256dh,
        auth = excluded.auth, created_at = excluded.created_at`,
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        endpoint,
        p256dh,
        auth,
        new Date().toISOString(),
      )
      .run();
    return json({ ok: true });
  }
  if (action === "unsubscribe") {
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    if (!endpoint) return json({ ok: true });
    await env.DB.prepare(
      "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?",
    )
      .bind(endpoint, user.id)
      .run();
    return json({ ok: true });
  }
  return json({ error: "Ação não encontrada." }, 404);
}
