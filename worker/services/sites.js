// ===== Sites do espaço: publicação e leads (/api/sites/*) =====
//
// Contrato
// - Recebe: `request`, `env`, `user` e `url`. POST `/api/sites/publish`,
//   `/unpublish` e `/delete` com `{ id, ownerId?, ... }`; GET
//   `/api/sites/leads?site_id=`.
// - Devolve: `{ ok, slug, url, publishedAt }` na publicação, `{ ok }` nas
//   demais ações, `{ leads }` na leitura; 4xx com o motivo.
// - Quem chama: a tabela de rotas autenticadas (exige sessão e banco).
//   `siteSlug` e `sanitizeSiteHtml` também são reexportados por worker.js.
// - Autorização: toda ação passa por `canManageSite` — dono do espaço,
//   `admin` ou quem pode editar o registro do site. A página pública
//   `/s/:slug` é servida por public-site.js, não por aqui.

import { json } from "../lib/http.js";
import { canManageSite } from "../lib/record-permissions.js";

export const siteSlug = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);

// Atributo de evento (onclick, onerror…). O navegador aceita "/" como
// separador de atributo — "<svg/onload=…>" e '<img src="x"/onerror=…>' rodam
// o handler —, então o separador é espaço OU barra. A barra sem espaço antes
// só conta logo depois do nome da tag ou do fecho de um valor entre aspas,
// para não cortar um caminho de URL como href="/online=1".
const ATRIBUTO_DE_EVENTO =
  /(?:\s[\s/]*|(?:(?<=<[a-z][a-z0-9-]*)|(?<==\s*"[^"]*")|(?<==\s*'[^']*'))\/[\s/]*)on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

export function sanitizeSiteHtml(value) {
  let html = String(value || "").slice(0, 300_000);
  html = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(
      /<(?:iframe|object|embed|base)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed|base)\s*>/gi,
      "",
    )
    .replace(/<(?:iframe|object|embed|base)\b[^>]*\/?>/gi, "")
    .replace(
      /<meta\b[^>]*http-equiv\s*=\s*["']?(?:refresh|content-security-policy)["']?[^>]*>/gi,
      "",
    )
    .replace(ATRIBUTO_DE_EVENTO, "")
    .replace(/javascript\s*:/gi, "");
  return html;
}

export async function handleSites(request, env, user, url) {
  const action = url.pathname.replace("/api/sites/", "");
  if (action === "leads" && request.method === "GET") {
    const siteId = url.searchParams.get("site_id") || "";
    const site = await env.DB.prepare(
      "SELECT owner_id FROM public_sites WHERE id = ?",
    )
      .bind(siteId)
      .first();
    if (!site) return json({ leads: [] });
    if (!(await canManageSite(env, user.id, site.owner_id, siteId)))
      return json({ error: "Você não tem acesso a este site." }, 403);
    const leads = await env.DB.prepare(
      `SELECT id, name, email, phone, message, created_at AS createdAt FROM public_site_leads
      WHERE site_id = ? ORDER BY created_at DESC LIMIT 200`,
    )
      .bind(siteId)
      .all();
    return json({ leads: leads.results || [] });
  }
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }
  const id = typeof body.id === "string" ? body.id.trim().slice(0, 80) : "";
  const ownerId =
    typeof body.ownerId === "string" && body.ownerId ? body.ownerId : user.id;
  if (!id || !/^[a-zA-Z0-9_-]{3,80}$/.test(id))
    return json({ error: "Identificador do site inválido." }, 400);
  if (!(await canManageSite(env, user.id, ownerId, id)))
    return json({ error: "Você não tem acesso a este site." }, 403);

  if (action === "publish") {
    const slug = siteSlug(body.slug);
    const name =
      typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const description =
      typeof body.description === "string"
        ? body.description.trim().slice(0, 200)
        : "";
    const html = sanitizeSiteHtml(body.html);
    const pages = Array.isArray(body.pages)
      ? body.pages.slice(0, 8).map((page) => ({
          slug: siteSlug(page?.slug || "").slice(0, 50),
          name:
            typeof page?.name === "string"
              ? page.name.trim().slice(0, 80)
              : "Página",
          html: sanitizeSiteHtml(page?.html || ""),
        }))
      : [];
    const pagesJson = JSON.stringify(pages);
    if (pagesJson.length > 900_000)
      return json(
        { error: "As páginas excederam o limite de publicação." },
        413,
      );
    if (slug.length < 3 || !name || html.length < 120)
      return json(
        { error: "Revise nome, endereço e conteúdo antes de publicar." },
        400,
      );
    const existing = await env.DB.prepare(
      "SELECT owner_id FROM public_sites WHERE id = ?",
    )
      .bind(id)
      .first();
    if (existing && existing.owner_id !== ownerId)
      return json({ error: "Este site pertence a outro espaço." }, 403);
    const collision = await env.DB.prepare(
      "SELECT id FROM public_sites WHERE slug = ?",
    )
      .bind(slug)
      .first();
    if (collision && collision.id !== id)
      return json(
        { error: "Este endereço já está em uso. Escolha outro slug." },
        409,
      );
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO public_sites (id, owner_id, slug, name, description, html, pages_json, published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, name = excluded.name, description = excluded.description,
      html = excluded.html, pages_json = excluded.pages_json, published = 1, updated_at = excluded.updated_at`,
    )
      .bind(id, ownerId, slug, name, description, html, pagesJson, now, now)
      .run();
    return json({
      ok: true,
      slug,
      url: `${url.origin}/s/${slug}`,
      publishedAt: now,
    });
  }
  if (action === "unpublish") {
    await env.DB.prepare(
      "UPDATE public_sites SET published = 0, updated_at = ? WHERE id = ? AND owner_id = ?",
    )
      .bind(new Date().toISOString(), id, ownerId)
      .run();
    return json({ ok: true });
  }
  if (action === "delete") {
    await env.DB.prepare(
      "DELETE FROM public_sites WHERE id = ? AND owner_id = ?",
    )
      .bind(id, ownerId)
      .run();
    return json({ ok: true });
  }
  return json({ error: "Ação não encontrada." }, 404);
}
