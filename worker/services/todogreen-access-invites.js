import {
  createSession,
  passwordHash,
  randomHex,
  sha256,
} from "../auth/credenciais.js";
import { emailEnabled, escMail, sendEmail } from "../mensageria/envio.js";
import { TENANT_ID } from "./todogreen-access.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const emailValido = (value) => /^\S+@\S+\.\S+$/.test(String(value || ""));
const nomeLimpo = (value, fallback) =>
  String(value || "").trim().replace(/\s+/g, " ").slice(0, 100) || fallback;

const conviteHtml = ({ name, role, link }) => `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#edf5f1;font-family:Arial,sans-serif;color:#153b32">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(13,55,45,.12)">
    <div style="padding:28px 32px;background:#123f35;color:#ffffff">
      <div style="font-size:12px;letter-spacing:1.5px;font-weight:700;color:#b8dc69">TO DO GREEN</div>
      <div style="font-size:26px;font-weight:700;margin-top:7px">Seu acesso foi liberado</div>
    </div>
    <div style="padding:30px 32px">
      <p style="margin:0 0 16px;font-size:16px">Olá, <strong>${escMail(name)}</strong>.</p>
      <p style="margin:0 0 16px;line-height:1.55">Você foi convidado(a) para a To Do Green como <strong>${escMail(String(role).replace(/_/g, " "))}</strong>.</p>
      <p style="margin:0 0 24px;line-height:1.55">Neste primeiro acesso, você vai definir uma senha exclusiva. Se já tiver uma conta, poderá trocar a senha e entrar na sua própria sessão.</p>
      <p style="margin:0 0 28px"><a href="${escMail(link)}" style="display:inline-block;padding:14px 22px;border-radius:9px;background:#16725c;color:#ffffff;text-decoration:none;font-weight:700">Definir minha senha e entrar</a></p>
      <p style="margin:0;color:#6b7d77;font-size:12px;line-height:1.45">Este convite é individual, expira em 7 dias e não concede acesso a quem não recebeu este e-mail. Se você não esperava esta mensagem, pode ignorá-la.</p>
    </div>
  </div>
</body></html>`;

export async function enviarConviteDeAcessoTodoGreen({
  env,
  access,
  user,
  email,
  role,
  permissions,
  name,
  origin,
}) {
  const alvo = String(email || "").trim().toLowerCase();
  if (!emailValido(alvo)) throw new Error("E-mail de convite inválido.");
  if (!emailEnabled(env))
    throw new Error("O envio de e-mail ainda não está configurado.");
  const workspaceOwnerId = String(access?.ownerId || "").trim();
  if (!workspaceOwnerId) throw new Error("Espaço da To Do Green não encontrado.");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const token = randomHex(24);
  const tokenHash = await sha256(token);
  const account = await env.DB.prepare(
    "SELECT name FROM users WHERE lower(email)=? LIMIT 1",
  ).bind(alvo).first();
  const recipientName = nomeLimpo(name, account?.name || alvo.split("@")[0]);

  await env.DB.prepare(
    `UPDATE todogreen_access_invites
        SET status='superseded', updated_at=?
      WHERE tenant_id=? AND workspace_owner_id=? AND email=? AND status='pending'`,
  ).bind(now.toISOString(), TENANT_ID, workspaceOwnerId, alvo).run();

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_invites
      (id,tenant_id,workspace_owner_id,email,name,role,permissions_json,token_hash,status,expires_at,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?,?)`,
  ).bind(
    id, TENANT_ID, workspaceOwnerId, alvo, recipientName, role,
    JSON.stringify(Array.isArray(permissions) ? permissions : []),
    tokenHash, expiresAt, user?.id || null, now.toISOString(), now.toISOString(),
  ).run();

  const base = String(origin || "").replace(/\/$/, "");
  const link = `${base}/todogreen/convite/${token}`;
  try {
    await sendEmail(
      env,
      alvo,
      "Convite de acesso — To Do Green",
      conviteHtml({ name: recipientName, role, link }),
    );
  } catch (error) {
    await env.DB.prepare(
      "UPDATE todogreen_access_invites SET status='send_failed', updated_at=? WHERE id=?",
    ).bind(new Date().toISOString(), id).run().catch(() => {});
    throw error;
  }
  return { email: alvo, expiresAt };
}

export async function handleTodoGreenAccessInvite(request, env, url) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  const body = request.method === "POST"
    ? await request.json().catch(() => ({}))
    : {};
  const token = request.method === "GET"
    ? String(url.searchParams.get("token") || "").trim()
    : String(body.token || "").trim();
  if (!token) return json({ error: "Convite inválido." }, 400);

  const invite = await env.DB.prepare(
    `SELECT * FROM todogreen_access_invites
       WHERE token_hash=? AND tenant_id=? LIMIT 1`,
  ).bind(await sha256(token), TENANT_ID).first();
  if (!invite || invite.status !== "pending")
    return json({ error: "Este convite não está mais disponível." }, 404);
  if (invite.expires_at <= new Date().toISOString())
    return json({ error: "Este convite expirou. Peça um novo convite à To Do Green." }, 410);

  if (request.method === "GET") {
    const account = await env.DB.prepare(
      "SELECT id FROM users WHERE lower(email)=? LIMIT 1",
    ).bind(invite.email).first();
    return json({
      email: invite.email,
      name: invite.name || "",
      role: invite.role,
      hasAccount: Boolean(account?.id),
      expiresAt: invite.expires_at,
    });
  }
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const password = String(body.password || "");
  if (password.length < 8 || password.length > 128)
    return json({ error: "A senha precisa ter entre 8 e 128 caracteres." }, 400);
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "SELECT id,name FROM users WHERE lower(email)=? LIMIT 1",
  ).bind(invite.email).first();
  const name = nomeLimpo(body.name, invite.name || existing?.name || invite.email.split("@")[0]);
  const salt = randomHex(16);
  let userId = existing?.id || crypto.randomUUID();

  if (existing) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE users SET password_hash=?, password_salt=? WHERE id=?",
      ).bind(await passwordHash(password, salt), salt, userId),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(userId),
    ]);
  } else {
    await env.DB.prepare(
      "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)",
    ).bind(userId, name, invite.email, await passwordHash(password, salt), salt, now).run();
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tenant_users
        (id,tenant_id,workspace_owner_id,user_id,role,status,permissions_json,invited_by,created_at,updated_at)
       VALUES (?,?,?,?,?,'active',?,?,?,?)
       ON CONFLICT(tenant_id,workspace_owner_id,user_id) DO UPDATE SET
         role=excluded.role,status='active',permissions_json=excluded.permissions_json,updated_at=excluded.updated_at`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, invite.workspace_owner_id, userId, invite.role,
      invite.permissions_json || "[]", invite.created_by || null, now, now,
    ),
    env.DB.prepare(
      `UPDATE todogreen_access_emails
          SET status='active',revoked_at=NULL,updated_at=?
        WHERE tenant_id=? AND workspace_owner_id=? AND email=?`,
    ).bind(now, TENANT_ID, invite.workspace_owner_id, invite.email),
    env.DB.prepare(
      "UPDATE todogreen_access_invites SET status='accepted',accepted_at=?,updated_at=? WHERE id=?",
    ).bind(now, now, invite.id),
  ]);

  return json({
    user: { id: userId, name, email: invite.email },
    token: await createSession(env, userId),
  });
}
