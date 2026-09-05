// ===== Rotas de autenticação =====
//
// Cadastro, login por senha, código por e-mail, sessão e exclusão de conta.
// Extraído de worker.js para reunir num só lugar tudo que decide "quem é
// você" antes de qualquer outra rota confiar na resposta.

import {
  createSession,
  passwordHash,
  randomHex,
  sameHash,
  sessionUser,
  sha256,
} from "../auth/credenciais.js";
import { allowed, edgeIp, json } from "../lib/http.js";
import {
  codeEmailHtml,
  emailEnabled,
  sendEmail,
  sixDigitCode,
} from "../mensageria/envio.js";

export async function handleAuth(request, env, url) {
  if (!env.DB)
    return json(
      { error: "O serviço de contas ainda não está configurado." },
      503,
    );
  const ip = edgeIp(request);
  // Em produção o Cloudflare sempre carimba este cabeçalho com o IP real do
  // cliente. `wrangler dev` também carimba um valor — 127.0.0.1 — mas não é
  // IP de borda nenhum; edgeIp() trata os dois casos (ausência e loopback)
  // como "sem como identificar quem pede", e é por isso que o teto fica bem
  // mais largo: um limite pensado para atacante de verdade não pode travar a
  // própria suíte de E2E rodando local.
  if (!allowed(`auth:${ip || "local-auth"}`, ip ? 8 : 200))
    return json(
      { error: "Muitas tentativas. Aguarde um minuto e tente novamente." },
      429,
    );

  if (url.pathname === "/api/auth/session") {
    const token =
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!token) return json({ error: "Sessão não encontrada." }, 401);
    const tokenHash = await sha256(token);
    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(tokenHash)
        .run();
      return json({ ok: true });
    }
    if (request.method !== "GET")
      return json({ error: "Método não permitido." }, 405);
    const agoraSessao = new Date().toISOString();
    // As colunas de perfil (avatar/status) entram por migração; se ela ainda
    // não rodou, o login não pode quebrar — cai para o SELECT básico.
    let user;
    try {
      user = await env.DB.prepare(
        `SELECT users.id, users.name, users.email,
                users.avatar_url AS avatarUrl, users.status_emoji AS statusEmoji, users.status_text AS statusText
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
      ).bind(tokenHash, agoraSessao).first();
    } catch {
      user = await env.DB.prepare(
        `SELECT users.id, users.name, users.email FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
      ).bind(tokenHash, agoraSessao).first();
    }
    return user
      ? json({ user })
      : json({ error: "Sua sessão expirou. Entre novamente." }, 401);
  }

  // Derruba TODAS as sessões da conta, em todos os aparelhos — o remédio
  // para "esqueci uma máquina logada": revoga à distância, sem esperar o
  // prazo de expiração.
  if (url.pathname === "/api/auth/sessions") {
    if (request.method !== "DELETE")
      return json({ error: "Método não permitido." }, 405);
    const account = await sessionUser(request, env);
    if (!account) return json({ error: "Sessão inválida." }, 401);
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?")
      .bind(account.id)
      .run();
    return json({ ok: true });
  }

  if (url.pathname === "/api/auth/account") {
    if (request.method !== "DELETE")
      return json({ error: "Método não permitido." }, 405);
    const account = await sessionUser(request, env);
    if (!account)
      return json({ error: "Sua sessão expirou. Entre novamente." }, 401);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(
        account.id,
      ),
      env.DB.prepare("DELETE FROM workspaces WHERE user_id = ?").bind(
        account.id,
      ),
      env.DB.prepare(
        "DELETE FROM memberships WHERE owner_id = ? OR member_id = ?",
      ).bind(account.id, account.id),
      env.DB.prepare("DELETE FROM invites WHERE owner_id = ?").bind(
        account.id,
      ),
      env.DB.prepare("DELETE FROM public_site_leads WHERE owner_id = ?").bind(
        account.id,
      ),
      env.DB.prepare("DELETE FROM public_sites WHERE owner_id = ?").bind(
        account.id,
      ),
      env.DB.prepare("DELETE FROM error_logs WHERE user_id = ?").bind(
        account.id,
      ),
      env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(
        account.id,
      ),
      env.DB.prepare(
        "DELETE FROM product_events WHERE user_id = ? OR workspace_owner_id = ?",
      ).bind(account.id, account.id),
      env.DB.prepare("DELETE FROM weekly_summary_log WHERE user_id = ?").bind(
        account.id,
      ),
      env.DB.prepare("DELETE FROM audit_log WHERE owner_id = ?").bind(
        account.id,
      ),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(account.id),
    ]);
    return json({ ok: true });
  }

  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitação inválida." }, 400);
  }

  if (url.pathname === "/api/auth/verify") {
    const vemail =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^\d{6}$/.test(code))
      return json({ error: "Digite o código de 6 dígitos." }, 400);
    const p = await env.DB.prepare(
      "SELECT * FROM pending_signups WHERE email = ?",
    )
      .bind(vemail)
      .first();
    if (!p)
      return json(
        {
          error:
            "Cadastro não encontrado ou já concluído. Cadastre-se novamente.",
        },
        404,
      );
    if (p.expires_at < new Date().toISOString()) {
      await env.DB.prepare("DELETE FROM pending_signups WHERE email = ?")
        .bind(vemail)
        .run();
      return json({ error: "O código expirou. Cadastre-se novamente." }, 410);
    }
    if (p.attempts >= 6) {
      await env.DB.prepare("DELETE FROM pending_signups WHERE email = ?")
        .bind(vemail)
        .run();
      return json({ error: "Muitas tentativas. Cadastre-se novamente." }, 429);
    }
    if ((await sha256(code)) !== p.code_hash) {
      await env.DB.prepare(
        "UPDATE pending_signups SET attempts = attempts + 1 WHERE email = ?",
      )
        .bind(vemail)
        .run();
      return json({ error: "Código incorreto. Confira e tente de novo." }, 401);
    }
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(vemail)
      .first();
    if (exists) {
      await env.DB.prepare("DELETE FROM pending_signups WHERE email = ?")
        .bind(vemail)
        .run();
      return json(
        { error: "Este e-mail já possui uma conta. Use a opção Entrar." },
        409,
      );
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        p.name,
        vemail,
        p.password_hash,
        p.password_salt,
        new Date().toISOString(),
      )
      .run();
    await env.DB.prepare("DELETE FROM pending_signups WHERE email = ?")
      .bind(vemail)
      .run();
    return json(
      {
        user: { id, name: p.name, email: vemail },
        token: await createSession(env, id),
      },
      201,
    );
  }

  if (url.pathname === "/api/auth/resend") {
    const vemail =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const p = await env.DB.prepare(
      "SELECT email FROM pending_signups WHERE email = ?",
    )
      .bind(vemail)
      .first();
    if (!p)
      return json(
        { error: "Cadastro não encontrado. Cadastre-se novamente." },
        404,
      );
    if (!emailEnabled(env))
      return json({ error: "Envio de e-mail não está configurado." }, 503);
    const code = sixDigitCode();
    await env.DB.prepare(
      "UPDATE pending_signups SET code_hash = ?, expires_at = ?, attempts = 0 WHERE email = ?",
    )
      .bind(
        await sha256(code),
        new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        vemail,
      )
      .run();
    try {
      await sendEmail(
        env,
        vemail,
        "Seu novo código — Seu Funcionário",
        codeEmailHtml(code),
      );
    } catch (e) {
      console.error("resend mail", e);
      return json({ error: "Não foi possível reenviar o e-mail agora." }, 502);
    }
    return json({ ok: true });
  }

  if (url.pathname === "/api/auth/forgot") {
    const vemail =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^\S+@\S+\.\S+$/.test(vemail))
      return json({ error: "Informe um e-mail válido." }, 400);
    if (!emailEnabled(env))
      return json(
        { error: "A recuperação por e-mail não está configurada." },
        503,
      );
    const account = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(vemail)
      .first();
    if (account) {
      const code = sixDigitCode();
      await env.DB.prepare(
        `INSERT INTO password_resets (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)
        ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
      )
        .bind(
          vemail,
          await sha256(code),
          new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          new Date().toISOString(),
        )
        .run();
      try {
        await sendEmail(
          env,
          vemail,
          "Redefinição de senha — Seu Funcionário",
          codeEmailHtml(code),
        );
      } catch (e) {
        console.error("forgot mail", e);
        return json(
          { error: "Não foi possível enviar o e-mail agora. Tente novamente." },
          502,
        );
      }
    }
    return json({ ok: true });
  }

  if (url.pathname === "/api/auth/google") {
    const credential =
      typeof body.credential === "string" ? body.credential : "";
    if (!credential) return json({ error: "Token do Google ausente." }, 400);
    if (!env.GOOGLE_CLIENT_ID)
      return json(
        { error: "Login com Google ainda não está configurado." },
        503,
      );
    const resp = await fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" +
        encodeURIComponent(credential),
    );
    if (!resp.ok)
      return json({ error: "Não foi possível validar sua conta Google." }, 401);
    const info = await resp.json().catch(() => ({}));
    const okIss =
      info.iss === "accounts.google.com" ||
      info.iss === "https://accounts.google.com";
    const emailOk =
      info.email &&
      (info.email_verified === "true" || info.email_verified === true);
    if (!okIss || info.aud !== env.GOOGLE_CLIENT_ID || !emailOk)
      return json({ error: "Conta Google inválida." }, 401);
    const gEmail = String(info.email).trim().toLowerCase();
    let account = await env.DB.prepare(
      "SELECT id, name, email FROM users WHERE email = ?",
    )
      .bind(gEmail)
      .first();
    if (!account) {
      const id = crypto.randomUUID();
      const gName =
        String(info.name || info.given_name || gEmail.split("@")[0])
          .trim()
          .slice(0, 100) || "Usuário";
      const salt = randomHex(16);
      await env.DB.prepare(
        "INSERT INTO users (id, name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(
          id,
          gName,
          gEmail,
          await passwordHash(randomHex(32), salt),
          salt,
          new Date().toISOString(),
        )
        .run();
      account = { id, name: gName, email: gEmail };
    }
    return json({
      user: { id: account.id, name: account.name, email: account.email },
      token: await createSession(env, account.id),
    });
  }

  if (url.pathname === "/api/auth/profile") {
    const account = await sessionUser(request, env);
    if (!account)
      return json({ error: "Sua sessão expirou. Entre novamente." }, 401);
    // Nome, foto e status são campos independentes do perfil: a tela pode
    // mandar só um. Foto é um "lembrete forte que dá pra pular" (não trava),
    // e o status é livre — emoji e/ou frase curta.
    const campos = [];
    const valores = [];
    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
      if (name.length < 2 || name.length > 100)
        return json({ error: "Informe um nome válido." }, 400);
      campos.push("name = ?");
      valores.push(name);
    }
    if (Object.prototype.hasOwnProperty.call(body, "avatarUrl")) {
      const avatar = String(body.avatarUrl || "").trim();
      // Só imagem em data URL (o cliente já reduz), com teto de ~700 KB de
      // base64 para não estourar a linha do usuário.
      if (avatar && !/^data:image\/(png|jpe?g|webp);base64,/.test(avatar))
        return json({ error: "Envie uma imagem válida (PNG, JPG ou WebP)." }, 400);
      if (avatar.length > 720000)
        return json({ error: "A foto ficou grande demais. Use uma imagem menor." }, 400);
      campos.push("avatar_url = ?");
      valores.push(avatar || null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "statusEmoji")) {
      campos.push("status_emoji = ?");
      valores.push(String(body.statusEmoji || "").slice(0, 16) || null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "statusText")) {
      campos.push("status_text = ?");
      valores.push(String(body.statusText || "").trim().slice(0, 140) || null);
    }
    if (!campos.length) return json({ error: "Nada para atualizar." }, 400);
    valores.push(account.id);
    try {
      await env.DB.prepare(`UPDATE users SET ${campos.join(", ")} WHERE id = ?`)
        .bind(...valores)
        .run();
    } catch {
      // Colunas de perfil ainda sem migração: se veio só foto/status, avisa
      // com clareza; se veio nome junto, ainda grava o nome.
      const temNome = campos.some((c) => c.startsWith("name"));
      if (!temNome) return json({ error: "Perfil de foto/status ainda não está disponível. Tente de novo em instantes." }, 503);
      await env.DB.prepare("UPDATE users SET name = ? WHERE id = ?")
        .bind(valores[campos.findIndex((c) => c.startsWith("name"))], account.id)
        .run();
    }
    let atualizado;
    try {
      atualizado = await env.DB.prepare(
        `SELECT id, name, email, avatar_url AS avatarUrl, status_emoji AS statusEmoji, status_text AS statusText
         FROM users WHERE id = ?`,
      ).bind(account.id).first();
    } catch {
      atualizado = await env.DB.prepare("SELECT id, name, email FROM users WHERE id = ?").bind(account.id).first();
    }
    return json({ user: atualizado });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^\S+@\S+\.\S+$/.test(email))
    return json({ error: "Informe um e-mail válido." }, 400);
  if (password.length < 8 || password.length > 128)
    return json(
      { error: "A senha precisa ter entre 8 e 128 caracteres." },
      400,
    );

  if (url.pathname === "/api/auth/reset") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^\d{6}$/.test(code))
      return json(
        { error: "Digite o código de 6 dígitos enviado ao seu e-mail." },
        400,
      );
    const reset = await env.DB.prepare(
      "SELECT * FROM password_resets WHERE email = ?",
    )
      .bind(email)
      .first();
    if (!reset)
      return json({ error: "Solicite a recuperação novamente." }, 404);
    if (reset.expires_at < new Date().toISOString()) {
      await env.DB.prepare("DELETE FROM password_resets WHERE email = ?")
        .bind(email)
        .run();
      return json({ error: "O código expirou. Solicite novamente." }, 410);
    }
    if (reset.attempts >= 6) {
      await env.DB.prepare("DELETE FROM password_resets WHERE email = ?")
        .bind(email)
        .run();
      return json({ error: "Muitas tentativas. Solicite novamente." }, 429);
    }
    if ((await sha256(code)) !== reset.code_hash) {
      await env.DB.prepare(
        "UPDATE password_resets SET attempts = attempts + 1 WHERE email = ?",
      )
        .bind(email)
        .run();
      return json({ error: "Código incorreto. Confira e tente de novo." }, 401);
    }
    const account = await env.DB.prepare(
      "SELECT id, name FROM users WHERE email = ?",
    )
      .bind(email)
      .first();
    if (!account) {
      await env.DB.prepare("DELETE FROM password_resets WHERE email = ?")
        .bind(email)
        .run();
      return json({ error: "Conta não encontrada." }, 404);
    }
    const salt = randomHex(16);
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?",
    )
      .bind(await passwordHash(password, salt), salt, account.id)
      .run();
    await env.DB.prepare("DELETE FROM password_resets WHERE email = ?")
      .bind(email)
      .run();
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?")
      .bind(account.id)
      .run();
    return json({
      user: { id: account.id, name: account.name, email },
      token: await createSession(env, account.id),
    });
  }

  if (url.pathname === "/api/auth/register") {
    const name =
      typeof body.name === "string"
        ? body.name.trim().replace(/\s+/g, " ")
        : "";
    if (name.length < 2 || name.length > 100)
      return json({ error: "Informe um nome válido." }, 400);
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first();
    if (exists)
      return json(
        { error: "Este e-mail já possui uma conta. Use a opção Entrar." },
        409,
      );
    const salt = randomHex(16);
    const passHash = await passwordHash(password, salt);

    if (emailEnabled(env)) {
      const code = sixDigitCode();
      await env.DB.prepare(
        `INSERT INTO pending_signups (email, name, password_hash, password_salt, code_hash, expires_at, attempts, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash, password_salt = excluded.password_salt, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
      )
        .bind(
          email,
          name,
          passHash,
          salt,
          await sha256(code),
          new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          new Date().toISOString(),
        )
        .run();
      try {
        await sendEmail(
          env,
          email,
          "Seu código de acesso — Seu Funcionário",
          codeEmailHtml(code),
        );
      } catch (error) {
        console.error("signup mail", error);
        return json(
          {
            error:
              "Não foi possível enviar o e-mail de verificação. Confira o e-mail e tente novamente.",
          },
          502,
        );
      }
      return json({ pending: true, email }, 200);
    }

    const user = { id: crypto.randomUUID(), name, email };
    try {
      await env.DB.prepare(
        "INSERT INTO users (id, name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(user.id, name, email, passHash, salt, new Date().toISOString())
        .run();
    } catch (error) {
      if (/unique/i.test(error.message))
        return json(
          { error: "Este e-mail já possui uma conta. Use a opção Entrar." },
          409,
        );
      throw error;
    }
    return json({ user, token: await createSession(env, user.id) }, 201);
  }

  if (url.pathname === "/api/auth/login") {
    // O limite por IP acima não protege uma conta específica de tentativas
    // distribuídas entre vários IPs — este limite é por e-mail, independente
    // de onde a tentativa vem.
    if (!allowed(`auth-account:${email}`, 8))
      return json(
        {
          error:
            "Muitas tentativas para esta conta. Aguarde um minuto e tente novamente.",
        },
        429,
      );
    const account = await env.DB.prepare(
      "SELECT id, name, email, password_hash, password_salt FROM users WHERE email = ?",
    )
      .bind(email)
      .first();
    const valid =
      account &&
      sameHash(
        await passwordHash(password, account.password_salt),
        account.password_hash,
      );
    if (!valid) return json({ error: "E-mail ou senha incorretos." }, 401);
    const user = { id: account.id, name: account.name, email: account.email };
    return json({ user, token: await createSession(env, user.id) });
  }

  return json({ error: "Rota de acesso não encontrada." }, 404);
}
