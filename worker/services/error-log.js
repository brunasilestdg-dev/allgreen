// ===== Registro de erros do navegador (/api/errors) =====
//
// Contrato
// - Recebe: `request` e `env`.
// - Devolve: GET → os 50 erros mais recentes da própria pessoa; POST → grava
//   um erro (mensagem, pilha, URL) e responde `{ ok: true }`.
// - Quem chama: o roteador do worker, como rota pública.
// - Autorização: a rota é pública porque o erro pode acontecer antes do
//   login. O GET exige sessão aqui dentro (401); o POST aceita anônimo,
//   liga o registro à pessoa quando há sessão e é limitado por IP.

import { sessionUser } from "../auth/credenciais.js";
import { allowed, json } from "../lib/http.js";

export async function handleErrorLog(request, env) {
  if (request.method === "GET") {
    if (!env.DB) return json({ logs: [] });
    let user = null;
    try {
      user = await sessionUser(request, env);
    } catch {}
    if (!user)
      return json({ error: "Sua sessão expirou. Entre novamente." }, 401);
    const logs = await env.DB.prepare(
      `SELECT id, message, stack, component_stack AS componentStack, url, created_at AS createdAt
      FROM error_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(user.id)
      .all();
    return json({ logs: logs.results || [] });
  }
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!env.DB) return json({ ok: true });
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (!allowed(`err:${ip}`, 20)) return json({ ok: true });
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitação inválida." }, 400);
  }
  const message = String(body?.message || "").slice(0, 500);
  if (!message) return json({ error: "Mensagem obrigatória." }, 400);
  let userId = null;
  try {
    const user = await sessionUser(request, env);
    userId = user?.id || null;
  } catch {}
  await env.DB.prepare(
    `INSERT INTO error_logs (id, message, stack, component_stack, url, user_agent, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      message,
      String(body?.stack || "").slice(0, 4000),
      String(body?.componentStack || "").slice(0, 4000),
      String(body?.url || "").slice(0, 500),
      request.headers.get("user-agent")?.slice(0, 300) || "",
      userId,
      new Date().toISOString(),
    )
    .run();
  return json({ ok: true });
}
