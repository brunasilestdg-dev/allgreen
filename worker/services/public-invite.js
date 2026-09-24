// ===== Convite de equipe: consulta e aceite públicos =====
//
// Contrato
// - Recebe: `request`, `env` e `url` — GET `/api/collab/invite-info?token=`
//   ou POST `/api/collab/invite/accept` com `{ token, password? }`.
// - Devolve: os dados públicos do convite, ou o aceite (`{ ok, ownerId,
//   ownerName, user, token }`); `null` para qualquer outro caminho, para o
//   roteador seguir adiante.
// - Quem chama: a tabela de rotas públicas, antes do prefixo autenticado
//   `/api/collab`.
// - Autorização: o token do e-mail é a credencial. Sem conta, o aceite cria
//   a conta com a senha informada; com conta, exige a sessão do MESMO e-mail
//   do convite (401 para outra pessoa). Aceite limitado por IP.

import {
  createSession,
  passwordHash,
  randomHex,
  sessionUser,
  sha256,
} from "../auth/credenciais.js";
import { logAudit } from "../lib/audit.js";
import { allowed, json } from "../lib/http.js";

export async function handlePublicInvite(request, env, url) {
  if (!env.DB) return json({ error: "Serviço indisponível." }, 503);
  const infoMatch = url.pathname === "/api/collab/invite-info";
  if (infoMatch) {
    if (request.method !== "GET")
      return json({ error: "Método não permitido." }, 405);
    const token = url.searchParams.get("token") || "";
    if (!token) return json({ error: "Convite inválido." }, 400);
    const invite = await env.DB.prepare(
      `SELECT invites.name, invites.email, invites.role, invites.status, invites.expires_at AS expiresAt,
        users.name AS ownerName
      FROM invites JOIN users ON users.id = invites.owner_id WHERE invites.token = ?`,
    )
      .bind(await sha256(token))
      .first();
    if (!invite) return json({ error: "Convite inválido ou expirado." }, 404);
    if (invite.status !== "enviado")
      return json({ error: "Este convite já foi utilizado ou cancelado." }, 410);
    if (invite.expiresAt < new Date().toISOString())
      return json({ error: "Este convite expirou." }, 410);
    const hasAccount = await env.DB.prepare(
      "SELECT id FROM users WHERE email = ?",
    )
      .bind(invite.email)
      .first();
    return json({
      name: invite.name,
      email: invite.email,
      role: invite.role,
      ownerName: invite.ownerName,
      hasAccount: !!hasAccount,
    });
  }
  if (url.pathname === "/api/collab/invite/accept") {
    if (request.method !== "POST")
      return json({ error: "Método não permitido." }, 405);
    const ip = request.headers.get("cf-connecting-ip") || "public";
    if (!allowed(`invite-accept:${ip}`, 10))
      return json(
        { error: "Muitas tentativas. Aguarde um instante." },
        429,
      );
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Dados inválidos." }, 400);
    }
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) return json({ error: "Convite inválido." }, 400);
    const tokenHash = await sha256(token);
    const invite = await env.DB.prepare(
      "SELECT * FROM invites WHERE token = ?",
    )
      .bind(tokenHash)
      .first();
    if (!invite)
      return json({ error: "Convite inválido ou expirado." }, 404);
    if (invite.status !== "enviado")
      return json(
        { error: "Este convite já foi utilizado ou cancelado." },
        410,
      );
    if (invite.expires_at < new Date().toISOString())
      return json({ error: "Este convite expirou. Peça um novo." }, 410);
    let account = await env.DB.prepare("SELECT id, name FROM users WHERE email = ?")
      .bind(invite.email)
      .first();
    let sessionToken = null;
    if (!account) {
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 8 || password.length > 128)
        return json(
          { error: "A senha precisa ter entre 8 e 128 caracteres." },
          400,
        );
      const id = crypto.randomUUID();
      const salt = randomHex(16);
      await env.DB.prepare(
        "INSERT INTO users (id, name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(
          id,
          invite.name,
          invite.email,
          await passwordHash(password, salt),
          salt,
          new Date().toISOString(),
        )
        .run();
      account = { id, name: invite.name };
      sessionToken = await createSession(env, id);
    } else {
      const requester = await sessionUser(request, env);
      if (!requester || requester.email !== invite.email)
        return json(
          {
            error:
              "Entre com a conta que recebeu este convite para aceitá-lo.",
          },
          401,
        );
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO memberships
        (id, owner_id, member_id, role, created_at, status, function_title, bond_type, direct_manager_id)
      VALUES (?, ?, ?, ?, ?, 'ativo', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        invite.owner_id,
        account.id,
        invite.role,
        new Date().toISOString(),
        invite.function_title || "",
        invite.bond_type || "",
        invite.direct_manager_id || null,
      )
      .run();
    await env.DB.prepare(
      "UPDATE invites SET status = 'ativo', accepted_at = ? WHERE token = ?",
    )
      .bind(new Date().toISOString(), tokenHash)
      .run();
    const owner = await env.DB.prepare("SELECT name FROM users WHERE id = ?")
      .bind(invite.owner_id)
      .first();
    await logAudit(
      env,
      invite.owner_id,
      { id: account.id, name: account.name },
      "convite_aceito",
      invite.email,
      `papel: ${invite.role}`,
    );
    return json({
      ok: true,
      ownerId: invite.owner_id,
      ownerName: owner?.name || "Espaço compartilhado",
      user: sessionToken ? { id: account.id, name: account.name, email: invite.email } : null,
      token: sessionToken,
    });
  }
  return null;
}
