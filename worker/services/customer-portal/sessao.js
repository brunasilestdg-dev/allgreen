// ===== Portal do Cliente: sessão e escopo =====
//
// Contrato: quem é a sessão e qual empresa ela alcança.
// - `authenticatedUser(request, env)`: o usuário da MESMA sessão do produto
//   (Bearer → hash → sessions), ou null.
// - `vinculosDaSessao(env, user)`: as empresas que o e-mail da sessão alcança
//   (vínculos em todogreen_client_users resolvidos por `resolveClientScope`),
//   em ordem alfabética, até 50.
// - `clientScopeForSession(env, user, empresaPedida)`: o escopo da requisição.
//   A empresa pedida só vale se estiver na lista da sessão; sem pedido, a
//   primeira. Invariante: o cliente sai SEMPRE do banco, pelo e-mail da
//   sessão — nenhum parâmetro do pedido escolhe cliente.

import {
  normalizeEmail,
  resolveClientScope,
} from "../../../src/features/logistics/customerPortalDomain.js";
import { TENANT_ID, clean } from "../todogreen-client-helpers.js";

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// Mesma sessão do resto do produto: o portal não tem login próprio.
export async function authenticatedUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !env.DB) return null;
  return env.DB.prepare(
    `SELECT u.id, u.name, u.email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first()
    .catch(() => null);
}

// O ponto onde o isolamento acontece. Uma consulta, pelo e-mail da sessão.
// O resultado carrega o cliente; nada além dele é alcançável depois.
// As empresas que este e-mail alcança. Antes a consulta terminava em `LIMIT 1`
// porque a restrição do banco garantia que só havia uma — e era essa restrição
// que deixava de fora grupo empresarial, consultoria, auditor e gestor de
// subsidiárias, que são justamente quem tem várias empresas e um e-mail só.
export async function vinculosDaSessao(env, user) {
  if (!user?.email) return [];
  const { results } = await env.DB.prepare(
    `SELECT v.tenant_id, v.client_id, v.email, v.role, v.status,
            c.name AS client_name, c.status AS client_status,
            c.portal_enabled, c.workspace_owner_id
       FROM todogreen_client_users v
       JOIN todogreen_clients c ON c.id = v.client_id AND c.tenant_id = v.tenant_id
      WHERE v.tenant_id = ? AND v.email = ?
      ORDER BY c.name COLLATE NOCASE
      LIMIT 50`,
  )
    .bind(TENANT_ID, normalizeEmail(user.email))
    .all()
    .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
  return (results || []).map(resolveClientScope).filter(Boolean);
}

// A empresa da requisição sai SEMPRE da lista que a sessão alcança. Aceitar o
// id que veio na query string sem confrontar seria o mesmo furo do `?owner=`
// que já foi fechado no lado interno: trocar o parâmetro e operar dado alheio.
export async function clientScopeForSession(env, user, clientePedido = "") {
  const vinculos = await vinculosDaSessao(env, user);
  if (!vinculos.length) return null;
  const pedido = clean(clientePedido, 120);
  if (pedido) return vinculos.find((v) => v.clientId === pedido) || null;
  // Sem escolha explícita, a primeira em ordem alfabética — determinística, e
  // não "a que o banco devolveu primeiro".
  return vinculos[0];
}
