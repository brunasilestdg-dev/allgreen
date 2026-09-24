// ===== Colaboração: convites, papéis e membros =====
//
// handleCollab é o CRUD de quem tem acesso a um espaço: convidar, reenviar,
// cancelar, trocar papel, remover. Extraído de worker.js para reunir essa
// lógica num só lugar, perto de onde ela é revisada com mais cuidado —
// autorização é a parte que menos pode se perder em oito mil linhas.

import { logAudit } from "../lib/audit.js";
import { allowed, json } from "../lib/http.js";
import { membershipRole } from "../lib/membership.js";
import { randomHex, sha256 } from "../auth/credenciais.js";
import {
  emailEnabled,
  emailFailureReason,
  inviteEmailHtml,
  sendEmail,
} from "../mensageria/envio.js";

const VALID_ROLES = ["admin", "gestor", "colaborador"];
const EMAIL_NOT_CONFIGURED =
  "O envio automático de e-mail não está configurado neste ambiente (faltam BREVO_API_KEY/MAIL_SENDER).";

export async function handleCollab(request, env, user, url) {
  const action = url.pathname.replace("/api/collab", "").replace(/^\//, "");
  if (!action) {
    const ownerId = url.searchParams.get("owner") || user.id;
    if (ownerId !== user.id) {
      const role = await membershipRole(env, user.id, ownerId);
      if (!role)
        return json({ error: "Você não tem acesso a este espaço." }, 403);
      const canManage = role === "admin";
      const members = await env.DB.prepare(
        `SELECT users.id, users.name, users.email, memberships.role, memberships.status,
          memberships.function_title AS functionTitle, memberships.bond_type AS bondType,
          memberships.direct_manager_id AS directManagerId, memberships.created_at AS createdAt
        FROM memberships
        JOIN users ON users.id = memberships.member_id WHERE memberships.owner_id = ? ORDER BY memberships.created_at`,
      )
        .bind(ownerId)
        .all();
      let invites = [];
      if (canManage) {
        const now = new Date().toISOString();
        const inviteRows = await env.DB.prepare(
          `SELECT code AS id, name, email, role, status, function_title AS functionTitle, bond_type AS bondType,
            direct_manager_id AS directManagerId, created_at AS createdAt, expires_at AS expiresAt
          FROM invites WHERE owner_id = ? ORDER BY created_at DESC`,
        )
          .bind(ownerId)
          .all();
        invites = (inviteRows.results || []).map((invite) => ({
          ...invite,
          status:
            invite.status === "enviado" && invite.expiresAt < now
              ? "expirado"
              : invite.status,
        }));
      }
      const owner = await env.DB.prepare(
        "SELECT id, name, email FROM users WHERE id = ?",
      )
        .bind(ownerId)
        .first();
      return json({
        members: members.results || [],
        invites,
        spaces: [],
        canManage,
        owner: owner || null,
      });
    }
    const members = await env.DB.prepare(
      `SELECT users.id, users.name, users.email, memberships.role, memberships.status,
        memberships.function_title AS functionTitle, memberships.bond_type AS bondType,
        memberships.direct_manager_id AS directManagerId, memberships.created_at AS createdAt
      FROM memberships
      JOIN users ON users.id = memberships.member_id WHERE memberships.owner_id = ? ORDER BY memberships.created_at`,
    )
      .bind(user.id)
      .all();
    const invites = await env.DB.prepare(
      `SELECT code AS id, name, email, role, status, function_title AS functionTitle, bond_type AS bondType,
        direct_manager_id AS directManagerId, created_at AS createdAt, expires_at AS expiresAt
      FROM invites WHERE owner_id = ? ORDER BY created_at DESC`,
    )
      .bind(user.id)
      .all();
    const spaces = await env.DB.prepare(
      `SELECT memberships.owner_id AS ownerId, users.name AS ownerName, users.email AS ownerEmail FROM memberships
      JOIN users ON users.id = memberships.owner_id WHERE memberships.member_id = ? AND memberships.status = 'ativo' ORDER BY memberships.created_at`,
    )
      .bind(user.id)
      .all();
    const now = new Date().toISOString();
    return json({
      members: members.results || [],
      invites: (invites.results || []).map((invite) => ({
        ...invite,
        status:
          invite.status === "enviado" && invite.expiresAt < now
            ? "expirado"
            : invite.status,
      })),
      spaces: spaces.results || [],
      canManage: true,
      owner: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  }
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (!allowed(`collab:${ip}`, 20))
    return json(
      { error: "Muitas ações em pouco tempo. Aguarde um instante." },
      429,
    );
  let body = {};
  try {
    body = await request.json();
  } catch {}

  // "leave" operates on whatever space the user is leaving, named explicitly
  // in the body — it isn't administering that space, so it's exempt from the
  // owner-scope/admin gate below.
  if (action === "leave") {
    const ownerId = typeof body.ownerId === "string" ? body.ownerId : "";
    await env.DB.prepare(
      "DELETE FROM memberships WHERE owner_id = ? AND member_id = ?",
    )
      .bind(ownerId, user.id)
      .run();
    return json({ ok: true });
  }

  const scopeOwnerId = url.searchParams.get("owner") || user.id;
  let actingOnBehalfOf = user;
  if (scopeOwnerId !== user.id) {
    const scopeRole = await membershipRole(env, user.id, scopeOwnerId);
    if (scopeRole !== "admin")
      return json(
        { error: "Você não tem permissão para administrar este espaço." },
        403,
      );
    const ownerRow = await env.DB.prepare("SELECT id, name, email FROM users WHERE id = ?")
      .bind(scopeOwnerId)
      .first();
    if (!ownerRow) return json({ error: "Espaço não encontrado." }, 404);
    actingOnBehalfOf = ownerRow;
  }

  if (action === "invite") {
    const name =
      typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase().slice(0, 160)
        : "";
    const role = VALID_ROLES.includes(body.role) ? body.role : "colaborador";
    const functionTitle =
      typeof body.functionTitle === "string"
        ? body.functionTitle.trim().slice(0, 100)
        : "";
    const bondType =
      typeof body.bondType === "string" ? body.bondType.trim().slice(0, 40) : "";
    const directManagerId =
      typeof body.directManagerId === "string" && body.directManagerId
        ? body.directManagerId
        : null;
    if (name.length < 2) return json({ error: "Informe o nome." }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email))
      return json({ error: "Informe um e-mail válido." }, 400);
    if (email === user.email || email === actingOnBehalfOf.email)
      return json(
        { error: "Você não pode convidar a si mesmo." },
        400,
      );
    const alreadyMember = await env.DB.prepare(
      `SELECT memberships.id FROM memberships JOIN users ON users.id = memberships.member_id
      WHERE memberships.owner_id = ? AND users.email = ? AND memberships.status = 'ativo'`,
    )
      .bind(scopeOwnerId, email)
      .first();
    if (alreadyMember)
      return json(
        { error: "Esta pessoa já faz parte do seu espaço." },
        409,
      );
    const code = crypto.randomUUID();
    const token = randomHex(24);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await env.DB.prepare(
      `INSERT INTO invites
        (code, owner_id, role, created_at, expires_at, token, email, name, status, function_title, bond_type, direct_manager_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enviado', ?, ?, ?)`,
    )
      .bind(
        code,
        scopeOwnerId,
        role,
        now.toISOString(),
        expiresAt,
        await sha256(token),
        email,
        name,
        functionTitle,
        bondType,
        directManagerId,
      )
      .run();
    // O convite vale pelo LINK, não pelo e-mail. Devolvemos o link para o
    // admin copiar e enviar por onde quiser (WhatsApp, etc.) — assim o acesso
    // nunca fica preso à entrega do e-mail (que pode cair no spam ou falhar).
    // O e-mail, quando configurado, é só a conveniência de já mandar sozinho:
    // se falhar, o convite continua de pé e o link segue na resposta.
    const link = `${url.origin}/convite/${token}`;
    let emailSent = false;
    let emailError = "";
    if (emailEnabled(env)) {
      try {
        await sendEmail(
          env,
          email,
          `${actingOnBehalfOf.name} convidou você — Seu Funcionário`,
          inviteEmailHtml(name, actingOnBehalfOf.name, role, link),
        );
        emailSent = true;
      } catch (e) {
        console.error("invite mail", e);
        emailError = emailFailureReason(e);
      }
    } else {
      emailError = EMAIL_NOT_CONFIGURED;
    }
    await logAudit(env, scopeOwnerId, user, "convite_criado", email, `papel: ${role}`);
    return json({ id: code, expiresAt, link, emailSent, emailError });
  }
  if (action === "resend") {
    const id = typeof body.id === "string" ? body.id : "";
    const invite = await env.DB.prepare(
      "SELECT * FROM invites WHERE code = ? AND owner_id = ?",
    )
      .bind(id, scopeOwnerId)
      .first();
    if (!invite) return json({ error: "Convite não encontrado." }, 404);
    if (invite.status !== "enviado")
      return json({ error: "Este convite não pode ser reenviado." }, 400);
    const token = randomHex(24);
    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await env.DB.prepare(
      "UPDATE invites SET token = ?, expires_at = ?, status = 'enviado' WHERE code = ?",
    )
      .bind(await sha256(token), expiresAt, id)
      .run();
    // Gera um link novo (o token antigo deixa de valer) e o devolve para copiar.
    const link = `${url.origin}/convite/${token}`;
    let emailSent = false;
    let emailError = "";
    if (emailEnabled(env)) {
      try {
        await sendEmail(
          env,
          invite.email,
          `${actingOnBehalfOf.name} convidou você — Seu Funcionário`,
          inviteEmailHtml(invite.name, actingOnBehalfOf.name, invite.role, link),
        );
        emailSent = true;
      } catch (e) {
        console.error("resend invite mail", e);
        emailError = emailFailureReason(e);
      }
    } else {
      emailError = EMAIL_NOT_CONFIGURED;
    }
    await logAudit(env, scopeOwnerId, user, "convite_reenviado", invite.email, "");
    return json({ ok: true, expiresAt, link, emailSent, emailError });
  }
  if (action === "cancel") {
    const id = typeof body.id === "string" ? body.id : "";
    const invite = await env.DB.prepare(
      "SELECT email FROM invites WHERE code = ? AND owner_id = ?",
    )
      .bind(id, scopeOwnerId)
      .first();
    await env.DB.prepare(
      "UPDATE invites SET status = 'cancelado' WHERE code = ? AND owner_id = ? AND status != 'ativo'",
    )
      .bind(id, scopeOwnerId)
      .run();
    if (invite)
      await logAudit(env, scopeOwnerId, user, "convite_cancelado", invite.email, "");
    return json({ ok: true });
  }
  if (action === "member-status") {
    const memberId = typeof body.memberId === "string" ? body.memberId : "";
    const status = body.status === "suspenso" ? "suspenso" : "ativo";
    if (memberId === user.id)
      return json({ error: "Você não pode alterar seu próprio acesso." }, 400);
    await env.DB.prepare(
      "UPDATE memberships SET status = ? WHERE owner_id = ? AND member_id = ?",
    )
      .bind(status, scopeOwnerId, memberId)
      .run();
    await logAudit(
      env,
      scopeOwnerId,
      user,
      status === "suspenso" ? "colaborador_suspenso" : "colaborador_reativado",
      memberId,
      "",
    );
    return json({ ok: true });
  }
  if (action === "member-role") {
    const memberId = typeof body.memberId === "string" ? body.memberId : "";
    const role = VALID_ROLES.includes(body.role) ? body.role : null;
    if (!role) return json({ error: "Papel inválido." }, 400);
    if (memberId === user.id)
      return json({ error: "Você não pode alterar seu próprio papel." }, 400);
    await env.DB.prepare(
      "UPDATE memberships SET role = ? WHERE owner_id = ? AND member_id = ?",
    )
      .bind(role, scopeOwnerId, memberId)
      .run();
    await logAudit(env, scopeOwnerId, user, "papel_alterado", memberId, `novo papel: ${role}`);
    return json({ ok: true });
  }
  if (action === "remove") {
    const memberId = typeof body.memberId === "string" ? body.memberId : "";
    await env.DB.prepare(
      "DELETE FROM memberships WHERE owner_id = ? AND member_id = ?",
    )
      .bind(scopeOwnerId, memberId)
      .run();
    await logAudit(env, scopeOwnerId, user, "colaborador_removido", memberId, "");
    return json({ ok: true });
  }
  if (action === "audit") {
    const logs = await env.DB.prepare(
      `SELECT id, actor_name AS actorName, action, target, details, created_at AS createdAt
      FROM audit_log WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(scopeOwnerId)
      .all();
    return json({ logs: logs.results || [] });
  }
  return json({ error: "Ação não encontrada." }, 404);
}
