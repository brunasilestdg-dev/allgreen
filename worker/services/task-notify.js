// ===== Aviso de tarefa por e-mail (/api/tasks/notify) =====
//
// Contrato
// - Recebe: `request` (POST `{ email, title, description?, due?, project? }`),
//   `env` e `user`, quem atribuiu e assina o aviso.
// - Devolve: `{ ok: true }`; 503 sem e-mail configurado; 502 se o envio falhar.
// - Quem chama: a tabela de rotas autenticadas (exige sessão; não exige
//   banco, então também funciona no modo local).
// - Autorização: qualquer pessoa com sessão. Limitado a 10 avisos por minuto
//   por IP, e todo texto do corpo é escapado antes de virar HTML.

import { allowed, json } from "../lib/http.js";
import { emailEnabled, escMail, sendEmail } from "../mensageria/envio.js";

export async function handleTaskNotify(request, env, user) {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!emailEnabled(env)) return json({ error: "O envio de e-mail não está configurado." }, 503);
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (!allowed(`notify:${ip}`, 10)) return json({ error: "Muitos avisos em pouco tempo. Aguarde um instante." }, 429);
  let body = {};
  try { body = await request.json(); } catch { return json({ error: "Solicitação inválida." }, 400); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Informe um e-mail válido para o aviso." }, 400);
  const title = escMail(String(body.title || "").slice(0, 160));
  if (!title.trim()) return json({ error: "Tarefa sem título." }, 400);
  const description = escMail(String(body.description || "").slice(0, 800));
  const due = escMail(String(body.due || "").slice(0, 40));
  const project = escMail(String(body.project || "").slice(0, 120));
  const who = escMail(user.name || "Um colega");
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#1e1b35">
    <div style="background:#0f0d1c;border-radius:14px;padding:18px;text-align:center"><span style="color:#fff;font-size:17px;font-weight:bold">Seu Funcionário</span></div>
    <h2 style="margin:22px 0 6px">Nova tarefa para você</h2>
    <p style="color:#555;margin:0 0 16px"><strong>${who}</strong> atribuiu uma tarefa a você:</p>
    <div style="background:#f1eff8;border-radius:12px;padding:16px">
      <p style="margin:0 0 6px;font-size:17px"><strong>${title}</strong></p>
      ${description ? `<p style="margin:0 0 6px;color:#444">${description}</p>` : ""}
      ${project ? `<p style="margin:0;color:#777;font-size:13px">Projeto: ${project}</p>` : ""}
      ${due ? `<p style="margin:0;color:#777;font-size:13px">Prazo: ${due}</p>` : ""}
    </div>
    <p style="color:#888;font-size:12px;margin:18px 0 0">Aviso enviado pelo aplicativo Seu Funcionário a pedido de ${who}.</p>
  </div>`;
  try { await sendEmail(env, email, `Nova tarefa: ${String(body.title || "").slice(0, 80)}`, html); }
  catch (e) { console.error("task notify", e); return json({ error: "Não foi possível enviar o aviso agora." }, 502); }
  return json({ ok: true });
}
