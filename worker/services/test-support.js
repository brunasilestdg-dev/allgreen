// ===== Suporte a testes de ponta a ponta =====
//
// Existe só para o E2E poder colocar a própria conta na To Do Green sem
// reproduzir, por fora, a tela de "acessos por e-mail" — o mesmo caminho que
// um admin de verdade usaria, com o mesmo INSERT, exercitado por script em
// vez de clique.
//
// Duas travas, não uma:
//
//   1) Sem IP de borda (edgeIp(), em worker/lib/http.js). Em produção a borda
//      da Cloudflare carimba `cf-connecting-ip` com o IP real do cliente; o
//      `wrangler dev` local carimba 127.0.0.1 — um valor que a borda de
//      produção nunca reportaria para um cliente de verdade. Tratar os dois
//      casos (ausência e loopback) como "sem borda" é a mesma trava já usada
//      para separar o limite de tentativas de login em dev.
//
//   2) A concessão é só para o e-mail da PRÓPRIA sessão. Mesmo se a primeira
//      trava falhasse por algum motivo, este endpoint não dá a ninguém
//      acesso à conta de outra pessoa — só республica o vínculo de quem já
//      provou identidade com sessão válida.

import { sessionUser } from "../auth/credenciais.js";
import { edgeIp, json } from "../lib/http.js";
import { TODO_GREEN_PERMISSIONS, TODO_GREEN_ROLES } from "../../src/features/logistics/logisticsVerticalDomain.js";

const TENANT_ID = "todogreen";
const PAPEL_PADRAO = "vendedor";

// Importados da mesma fonte que o endpoint real de concessão de acesso
// (todogreen-core.js) usa — não uma cópia à mão. Isto já escondeu uma vez o
// mesmo defeito: o mapa duplicado aqui não tinha as permissões que o teste
// precisava, então o E2E testava um papel que não existia em produção
// nenhuma, e a divergência real (permissão nunca derivada do papel na
// concessão de verdade) passou despercebida.

export async function handleTestSupport(request, env, url) {
  // wrangler dev grava cf-connecting-ip: 127.0.0.1 em toda requisição local —
  // não deixa o cabeçalho ausente. edgeIp() trata esse loopback como "sem IP
  // de borda", exatamente como o limite de tentativas de login já precisou
  // tratar; ver worker/lib/http.js.
  if (edgeIp(request)) return json({ error: "Indisponível." }, 404);

  if (url.pathname !== "/api/test-support/todogreen-acesso" || request.method !== "POST")
    return json({ error: "Rota de teste não encontrada." }, 404);

  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Sessão inválida." }, 401);

  const body = await request.json().catch(() => ({}));
  const role = TODO_GREEN_ROLES.includes(body.role) ? body.role : PAPEL_PADRAO;
  const permissions = TODO_GREEN_PERMISSIONS[role] || ["read"];
  const email = String(user.email || "").trim().toLowerCase();
  if (!email) return json({ error: "Sessão sem e-mail." }, 400);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, 'concedido pelo suporte de teste E2E', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET
       role = excluded.role, status = 'active', permissions_json = excluded.permissions_json,
       updated_at = excluded.updated_at`,
  )
    .bind(crypto.randomUUID(), TENANT_ID, email, role, JSON.stringify(permissions), user.id, now, now)
    .run();

  return json({ ok: true, email, role }, 201);
}
