import { bookingWindow } from "../../src/features/platform-suite/platformSuiteDomain.js";
import {
  caixaDoTurnstile,
  cspComTurnstile,
  exigirTurnstile,
  scriptDoTurnstile,
} from "../lib/turnstile.js";

const clean = (value, max = 240) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const slugify = (value) =>
  clean(value, 80)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 55);

const digest = async (value) => {
  const bytes = new TextEncoder().encode(String(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const randomToken = (bytes = 18) => {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

// Páginas com formulário passam o `env`: com o Turnstile ligado, a CSP libera
// o script e o iframe do widget. As demais seguem sem script nenhum.
const html = (content, status = 200, env = null) =>
  new Response(content, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": cspComTurnstile(
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        env,
      ),
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });

const pageShell = (title, content) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:#f4f6f2;color:#172018;padding:24px}
main{max-width:680px;margin:4vh auto;background:#fff;border:1px solid #dfe6dd;border-radius:24px;padding:clamp(24px,6vw,48px);box-shadow:0 18px 55px #17331a16}
.mark{display:inline-flex;padding:7px 11px;border-radius:999px;background:#e8f5e8;color:#226528;font-weight:800;font-size:12px}
h1{font-size:clamp(28px,7vw,46px);line-height:1.05;margin:18px 0 10px}p{line-height:1.6;color:#526153}
label{display:grid;gap:7px;margin:16px 0;font-weight:700}input,textarea,select{width:100%;padding:13px 14px;border:1px solid #c9d4c8;border-radius:12px;background:#fff;color:#172018;font:inherit}
textarea{min-height:120px;resize:vertical}button{border:0;border-radius:13px;padding:14px 18px;background:#216b31;color:#fff;font:inherit;font-weight:800;cursor:pointer;width:100%}
.meta{padding:12px 14px;border-radius:13px;background:#f2f6f1;margin:18px 0;color:#405143}.protocol{font:800 22px ui-monospace,monospace;letter-spacing:.04em}
@media(prefers-color-scheme:dark){body{background:#101510;color:#edf5ec}main{background:#182019;border-color:#344235}p{color:#b4c2b3}input,textarea,select{background:#111711;color:#edf5ec;border-color:#405141}.meta{background:#222e23;color:#c9d5c8}}
</style></head><body><main>${content}</main></body></html>`;

const wantsJson = (request) =>
  request.headers.get("content-type")?.includes("application/json") ||
  request.headers.get("accept")?.includes("application/json");

async function requestData(request) {
  if (request.headers.get("content-type")?.includes("application/json"))
    return request.json().catch(() => ({}));
  const form = await request.formData().catch(() => new FormData());
  return Object.fromEntries(form.entries());
}

const parseJson = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const pageRecord = (row) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  businessId: row.business_id || null,
  durationMinutes: row.duration_minutes,
  timezone: row.timezone,
  weekdays: parseJson(row.weekdays_json, [1, 2, 3, 4, 5]),
  startTime: row.start_time,
  endTime: row.end_time,
  location: row.location,
  active: row.active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const bookingRecord = (row) => ({
  id: row.id,
  pageId: row.booking_page_id,
  pageName: row.page_name,
  customerName: row.customer_name,
  customerEmail: row.customer_email,
  customerPhone: row.customer_phone,
  notes: row.notes,
  startAt: row.start_at,
  endAt: row.end_at,
  status: row.status,
  protocol: row.protocol,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const portalRecord = (row) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  businessId: row.business_id || null,
  welcomeText: row.welcome_text,
  slaHours: row.sla_hours,
  active: row.active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const ticketRecord = (row) => ({
  id: row.id,
  portalId: row.support_portal_id,
  portalName: row.portal_name,
  protocol: row.protocol,
  customerName: row.customer_name,
  customerEmail: row.customer_email,
  subject: row.subject,
  description: row.description,
  category: row.category,
  priority: row.priority,
  status: row.status,
  assigneeId: row.assignee_id || null,
  slaDueAt: row.sla_due_at,
  resolution: row.resolution,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const siteRecord = (row) => ({
  id: row.id,
  name: row.name,
  businessId: row.business_id || null,
  siteKey: row.site_key,
  allowedOrigin: row.allowed_origin,
  active: row.active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const campaignRecord = (row) => ({
  id: row.id,
  name: row.name,
  subject: row.subject,
  content: row.content,
  businessId: row.business_id || null,
  audience: parseJson(row.audience_json, {}),
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

async function uniqueSlug(env, table, seed) {
  const base = slugify(seed) || "pagina";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slug = attempt ? `${base}-${randomToken(2)}` : base;
    const existing = await env.DB.prepare(`SELECT id FROM ${table} WHERE slug = ?`)
      .bind(slug)
      .first();
    if (!existing) return slug;
  }
  return `${base}-${randomToken(4)}`;
}

export async function handlePlatformSuite(request, env, user, url, dependencies) {
  const { json, ownerAccess } = dependencies;
  const parts = url.pathname.split("/").filter(Boolean);
  const resource = parts[2] || "";
  const itemId = parts[3] || "";
  let body = {};
  if (request.method !== "GET") {
    try {
      body = await request.json();
    } catch {
      return json({ error: "Solicitação inválida." }, 400);
    }
  }
  const access = await ownerAccess(
    env,
    user,
    request.method === "GET" ? url.searchParams.get("owner") : body.ownerId,
  );
  if (!access) return json({ error: "Você não tem acesso a este espaço." }, 403);
  const { ownerId, role } = access;
  const now = new Date().toISOString();

  if (resource === "booking-pages") {
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT * FROM booking_pages WHERE workspace_owner_id = ?
         ORDER BY updated_at DESC LIMIT 100`,
      )
        .bind(ownerId)
        .all();
      return json({ pages: (rows.results || []).map(pageRecord) });
    }
    if (request.method === "POST") {
      const name = clean(body.name, 100);
      if (!name) return json({ error: "Informe o nome da agenda." }, 400);
      const duration = Math.min(480, Math.max(15, Number(body.durationMinutes) || 30));
      const weekdays = Array.isArray(body.weekdays)
        ? body.weekdays.map(Number).filter((day) => day >= 0 && day <= 6)
        : [1, 2, 3, 4, 5];
      const id = crypto.randomUUID();
      const slug = await uniqueSlug(env, "booking_pages", body.slug || name);
      await env.DB.prepare(
        `INSERT INTO booking_pages
          (id, workspace_owner_id, created_by, business_id, name, slug,
           duration_minutes, timezone, weekdays_json, start_time, end_time,
           location, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
        .bind(
          id,
          ownerId,
          user.id,
          clean(body.businessId, 80) || null,
          name,
          slug,
          duration,
          clean(body.timezone, 60) || "America/Sao_Paulo",
          JSON.stringify(weekdays.length ? weekdays : [1, 2, 3, 4, 5]),
          clean(body.startTime, 5) || "09:00",
          clean(body.endTime, 5) || "18:00",
          clean(body.location, 180),
          now,
          now,
        )
        .run();
      const row = await env.DB.prepare("SELECT * FROM booking_pages WHERE id = ?")
        .bind(id)
        .first();
      return json({ page: pageRecord(row) }, 201);
    }
  }

  if (resource === "bookings") {
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT b.*, p.name AS page_name FROM public_bookings b
         JOIN booking_pages p ON p.id = b.booking_page_id
         WHERE b.workspace_owner_id = ?
         ORDER BY b.start_at DESC LIMIT 300`,
      )
        .bind(ownerId)
        .all();
      return json({ bookings: (rows.results || []).map(bookingRecord) });
    }
    if (request.method === "PATCH" && itemId) {
      const status = clean(body.status, 30);
      if (!["confirmado", "concluído", "cancelado", "não compareceu"].includes(status))
        return json({ error: "Status de agendamento inválido." }, 400);
      const result = await env.DB.prepare(
        `UPDATE public_bookings SET status = ?, updated_at = ?
         WHERE id = ? AND workspace_owner_id = ?`,
      )
        .bind(status, now, itemId, ownerId)
        .run();
      if (!result.meta?.changes) return json({ error: "Agendamento não encontrado." }, 404);
      return json({ ok: true });
    }
  }

  if (resource === "support-portals") {
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT * FROM support_portals WHERE workspace_owner_id = ?
         ORDER BY updated_at DESC LIMIT 100`,
      )
        .bind(ownerId)
        .all();
      return json({ portals: (rows.results || []).map(portalRecord) });
    }
    if (request.method === "POST") {
      const name = clean(body.name, 100);
      if (!name) return json({ error: "Informe o nome da central." }, 400);
      const id = crypto.randomUUID();
      const slug = await uniqueSlug(env, "support_portals", body.slug || name);
      await env.DB.prepare(
        `INSERT INTO support_portals
          (id, workspace_owner_id, created_by, business_id, name, slug,
           welcome_text, sla_hours, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
        .bind(
          id,
          ownerId,
          user.id,
          clean(body.businessId, 80) || null,
          name,
          slug,
          clean(body.welcomeText, 600),
          Math.min(720, Math.max(1, Number(body.slaHours) || 24)),
          now,
          now,
        )
        .run();
      const row = await env.DB.prepare("SELECT * FROM support_portals WHERE id = ?")
        .bind(id)
        .first();
      return json({ portal: portalRecord(row) }, 201);
    }
  }

  if (resource === "tickets") {
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT t.*, p.name AS portal_name FROM support_tickets t
         JOIN support_portals p ON p.id = t.support_portal_id
         WHERE t.workspace_owner_id = ?
         ORDER BY CASE t.status WHEN 'Novo' THEN 0 WHEN 'Em atendimento' THEN 1 ELSE 2 END,
                  t.sla_due_at ASC LIMIT 500`,
      )
        .bind(ownerId)
        .all();
      return json({ tickets: (rows.results || []).map(ticketRecord) });
    }
    if (request.method === "PATCH" && itemId) {
      const status = clean(body.status, 40);
      const allowedStatuses = ["Novo", "Em atendimento", "Aguardando cliente", "Resolvido", "Fechado"];
      if (!allowedStatuses.includes(status))
        return json({ error: "Status de chamado inválido." }, 400);
      if (role !== "owner" && clean(body.assigneeId, 80) && body.assigneeId !== user.id)
        return json({ error: "Somente o proprietário pode reatribuir chamados." }, 403);
      const result = await env.DB.prepare(
        `UPDATE support_tickets SET status = ?, resolution = ?,
         assignee_id = COALESCE(?, assignee_id), updated_at = ?
         WHERE id = ? AND workspace_owner_id = ?`,
      )
        .bind(
          status,
          clean(body.resolution, 2000),
          clean(body.assigneeId, 80) || null,
          now,
          itemId,
          ownerId,
        )
        .run();
      if (!result.meta?.changes) return json({ error: "Chamado não encontrado." }, 404);
      return json({ ok: true });
    }
  }

  if (resource === "analytics-sites") {
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT * FROM analytics_sites WHERE workspace_owner_id = ?
         ORDER BY updated_at DESC LIMIT 100`,
      )
        .bind(ownerId)
        .all();
      return json({ sites: (rows.results || []).map(siteRecord) });
    }
    if (request.method === "POST") {
      const name = clean(body.name, 100);
      if (!name) return json({ error: "Informe o nome do site." }, 400);
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO analytics_sites
          (id, workspace_owner_id, created_by, business_id, name, site_key,
           allowed_origin, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
        .bind(
          id,
          ownerId,
          user.id,
          clean(body.businessId, 80) || null,
          name,
          randomToken(16),
          clean(body.allowedOrigin, 240) || "*",
          now,
          now,
        )
        .run();
      const row = await env.DB.prepare("SELECT * FROM analytics_sites WHERE id = ?")
        .bind(id)
        .first();
      return json({ site: siteRecord(row) }, 201);
    }
  }

  if (resource === "analytics-summary" && request.method === "GET") {
    const siteId = clean(url.searchParams.get("siteId"), 80);
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
    const site = await env.DB.prepare(
      "SELECT id FROM analytics_sites WHERE id = ? AND workspace_owner_id = ?",
    )
      .bind(siteId, ownerId)
      .first();
    if (!site) return json({ error: "Site de analytics não encontrado." }, 404);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const totals = await env.DB.prepare(
      `SELECT COUNT(*) AS events,
       SUM(CASE WHEN event_name = 'page_view' THEN 1 ELSE 0 END) AS page_views,
       COUNT(DISTINCT NULLIF(session_id, '')) AS sessions,
       COUNT(DISTINCT NULLIF(visitor_id, '')) AS visitors
       FROM analytics_events WHERE analytics_site_id = ? AND occurred_at >= ?`,
    )
      .bind(siteId, since)
      .first();
    const topPaths = await env.DB.prepare(
      `SELECT path AS name, COUNT(*) AS count FROM analytics_events
       WHERE analytics_site_id = ? AND occurred_at >= ?
       GROUP BY path ORDER BY count DESC LIMIT 10`,
    )
      .bind(siteId, since)
      .all();
    const topEvents = await env.DB.prepare(
      `SELECT event_name AS name, COUNT(*) AS count FROM analytics_events
       WHERE analytics_site_id = ? AND occurred_at >= ?
       GROUP BY event_name ORDER BY count DESC LIMIT 10`,
    )
      .bind(siteId, since)
      .all();
    return json({
      summary: {
        events: Number(totals?.events) || 0,
        pageViews: Number(totals?.page_views) || 0,
        sessions: Number(totals?.sessions) || 0,
        visitors: Number(totals?.visitors) || 0,
        topPaths: topPaths.results || [],
        topEvents: topEvents.results || [],
      },
    });
  }

  if (resource === "campaigns") {
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT * FROM marketing_campaigns WHERE workspace_owner_id = ?
         ORDER BY updated_at DESC LIMIT 100`,
      )
        .bind(ownerId)
        .all();
      return json({ campaigns: (rows.results || []).map(campaignRecord) });
    }
    if (request.method === "POST") {
      const name = clean(body.name, 120);
      const subject = clean(body.subject, 180);
      const content = clean(body.content, 20_000);
      if (!name || !subject || !content)
        return json({ error: "Preencha nome, assunto e conteúdo." }, 400);
      const id = crypto.randomUUID();
      const audience = {
        query: clean(body.audience?.query, 100),
        tags: Array.isArray(body.audience?.tags)
          ? body.audience.tags.map((tag) => clean(tag, 40)).filter(Boolean).slice(0, 20)
          : [],
        consentRequired: true,
        estimatedCount: Math.max(0, Number(body.audience?.estimatedCount) || 0),
      };
      await env.DB.prepare(
        `INSERT INTO marketing_campaigns
          (id, workspace_owner_id, created_by, business_id, name, subject,
           content, audience_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'rascunho', ?, ?)`,
      )
        .bind(
          id,
          ownerId,
          user.id,
          clean(body.businessId, 80) || null,
          name,
          subject,
          content,
          JSON.stringify(audience),
          now,
          now,
        )
        .run();
      const row = await env.DB.prepare("SELECT * FROM marketing_campaigns WHERE id = ?")
        .bind(id)
        .first();
      return json({ campaign: campaignRecord(row) }, 201);
    }
  }

  return json({ error: "Rota não encontrada." }, 404);
}

async function publicBooking(request, env, url, dependencies) {
  const { json, allowed } = dependencies;
  const parts = url.pathname.split("/").filter(Boolean);
  const pageRoute = url.pathname.startsWith("/agenda/");
  const slug = clean(pageRoute ? parts[1] : parts[2], 80);
  const action = clean(pageRoute ? "" : parts[3], 30);
  const row = await env.DB.prepare(
    "SELECT * FROM booking_pages WHERE slug = ? AND active = 1",
  )
    .bind(slug)
    .first();
  if (!row) return url.pathname.startsWith("/agenda/") ? html(pageShell("Agenda indisponível", "<h1>Agenda indisponível</h1><p>Este link não está ativo.</p>"), 404) : json({ error: "Agenda não encontrada." }, 404);
  const page = pageRecord(row);

  if (request.method === "GET" && url.pathname.startsWith("/agenda/")) {
    return html(
      pageShell(
        page.name,
        `<span class="mark">Agendamento seguro</span><h1>${escapeHtml(page.name)}</h1>
         <p>Escolha um horário disponível. Fuso: ${escapeHtml(page.timezone)}.</p>
         <div class="meta">${escapeHtml(page.durationMinutes)} minutos${page.location ? ` · ${escapeHtml(page.location)}` : ""}<br>Atendimento de ${escapeHtml(page.startTime)} a ${escapeHtml(page.endTime)}</div>
         <form method="post" action="/api/public-scheduling/${encodeURIComponent(page.slug)}/book">
           <label>Seu nome<input name="name" required maxlength="100" autocomplete="name"></label>
           <label>Seu e-mail<input name="email" type="email" required maxlength="180" autocomplete="email"></label>
           <label>Telefone<input name="phone" maxlength="40" autocomplete="tel"></label>
           <label>Data e horário<input name="startAt" type="datetime-local" required></label>
           <label>Observações<textarea name="notes" maxlength="1000"></textarea></label>
           ${caixaDoTurnstile(env, "agenda")}
           <button type="submit">Confirmar agendamento</button>
         </form>${scriptDoTurnstile(env)}`,
      ),
      200,
      env,
    );
  }

  if (request.method === "POST" && action === "book") {
    const ip = request.headers.get("cf-connecting-ip") || "desconhecido";
    if (allowed && !(await allowed(`public-booking:${slug}:${ip}`, 12)))
      return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
    const body = await requestData(request);
    const barrado = await exigirTurnstile(request, env, body, {
      acao: "agenda",
      responder: (dados, status) =>
        wantsJson(request)
          ? json(dados, status)
          : html(pageShell("Verificação necessária", `<h1>Não foi possível agendar</h1><p>${escapeHtml(dados.error)}</p><p><a href="/agenda/${encodeURIComponent(page.slug)}">Voltar para a agenda</a></p>`), status),
    });
    if (barrado) return barrado;
    const name = clean(body.name, 100);
    const email = clean(body.email, 180).toLowerCase();
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      const message = "Informe nome e e-mail válidos.";
      return wantsJson(request)
        ? json({ error: message }, 400)
        : html(pageShell("Dados inválidos", `<h1>Não foi possível agendar</h1><p>${message}</p>`), 400);
    }
    const existing = await env.DB.prepare(
      `SELECT start_at, end_at, status FROM public_bookings
       WHERE booking_page_id = ? AND start_at >= datetime('now', '-1 day')`,
    )
      .bind(page.id)
      .all();
    const window = bookingWindow(page, body.startAt, existing.results || []);
    if (!window.ok)
      return wantsJson(request)
        ? json({ error: window.error }, 409)
        : html(pageShell("Horário indisponível", `<h1>Escolha outro horário</h1><p>${escapeHtml(window.error)}</p>`), 409);
    if (Date.parse(window.startAt) < Date.now() + 5 * 60_000) {
      const message = "Escolha um horário futuro.";
      return wantsJson(request)
        ? json({ error: message }, 400)
        : html(pageShell("Horário inválido", `<h1>Escolha outro horário</h1><p>${message}</p>`), 400);
    }
    const id = crypto.randomUUID();
    const token = randomToken();
    const protocol = `AG-${randomToken(4).toUpperCase()}`;
    const now = new Date().toISOString();
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO public_bookings
            (id, booking_page_id, workspace_owner_id, customer_name, customer_email,
             customer_phone, notes, start_at, end_at, status, protocol,
             cancel_token_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmado', ?, ?, ?, ?)`,
        ).bind(
            id,
            page.id,
            row.workspace_owner_id,
            name,
            email,
            clean(body.phone, 40),
            clean(body.notes, 1000),
            window.startAt,
            window.endAt,
            protocol,
            await digest(token),
            now,
            now,
          ),
        env.DB.prepare(
          `INSERT INTO booking_slots
            (booking_page_id, start_at, booking_id, created_at)
           VALUES (?, ?, ?, ?)`,
        ).bind(page.id, window.startAt, id, now),
      ]);
    } catch (error) {
      if (String(error).toLowerCase().includes("unique"))
        return json({ error: "Este horário acabou de ser ocupado." }, 409);
      throw error;
    }
    if (wantsJson(request))
      return json({ ok: true, protocol, startAt: window.startAt, cancelToken: token }, 201);
    return html(
      pageShell(
        "Agendamento confirmado",
        `<span class="mark">Confirmado</span><h1>Horário reservado</h1>
         <p>Guarde seu protocolo:</p><div class="protocol">${escapeHtml(protocol)}</div>
         <div class="meta">${escapeHtml(window.startAt.replace("T", " ").slice(0, 16))} · ${escapeHtml(page.timezone)}</div>
         <form method="post" action="/api/public-scheduling/${encodeURIComponent(page.slug)}/cancel">
           <input type="hidden" name="token" value="${escapeHtml(token)}">
           <button type="submit">Cancelar este agendamento</button>
         </form>`,
      ),
      201,
    );
  }

  if (request.method === "POST" && action === "cancel") {
    const body = await requestData(request);
    const tokenHash = await digest(clean(body.token, 100));
    const booking = await env.DB.prepare(
      `SELECT id, start_at FROM public_bookings
       WHERE booking_page_id = ? AND cancel_token_hash = ? AND status != 'cancelado'`,
    )
      .bind(page.id, tokenHash)
      .first();
    let ok = false;
    if (booking) {
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE public_bookings SET status = 'cancelado', updated_at = ?
           WHERE id = ? AND booking_page_id = ? AND status != 'cancelado'`,
        ).bind(new Date().toISOString(), booking.id, page.id),
        env.DB.prepare(
          "DELETE FROM booking_slots WHERE booking_page_id = ? AND start_at = ? AND booking_id = ?",
        ).bind(page.id, booking.start_at, booking.id),
      ]);
      ok = Boolean(results[0]?.meta?.changes);
    }
    return wantsJson(request)
      ? json(ok ? { ok: true } : { error: "Link inválido ou já utilizado." }, ok ? 200 : 404)
      : html(pageShell(ok ? "Agendamento cancelado" : "Link inválido", `<h1>${ok ? "Agendamento cancelado" : "Não foi possível cancelar"}</h1><p>${ok ? "O horário voltou a ficar disponível." : "O link é inválido ou já foi utilizado."}</p>`), ok ? 200 : 404);
  }
  return json({ error: "Método não permitido." }, 405);
}

async function publicSupport(request, env, url, dependencies) {
  const { json, allowed } = dependencies;
  const parts = url.pathname.split("/").filter(Boolean);
  const pageRoute = url.pathname.startsWith("/atendimento/");
  const slug = clean(pageRoute ? parts[1] : parts[2], 80);
  const action = clean(pageRoute ? "" : parts[3], 30);
  const row = await env.DB.prepare(
    "SELECT * FROM support_portals WHERE slug = ? AND active = 1",
  )
    .bind(slug)
    .first();
  if (!row) return url.pathname.startsWith("/atendimento/") ? html(pageShell("Central indisponível", "<h1>Central indisponível</h1><p>Este link não está ativo.</p>"), 404) : json({ error: "Central não encontrada." }, 404);
  const portal = portalRecord(row);
  if (request.method === "GET" && url.pathname.startsWith("/atendimento/")) {
    return html(
      pageShell(
        portal.name,
        `<span class="mark">Central de atendimento</span><h1>${escapeHtml(portal.name)}</h1>
         <p>${escapeHtml(portal.welcomeText || "Conte o que aconteceu e acompanhe pelo protocolo.")}</p>
         <div class="meta">Prazo inicial de resposta: até ${portal.slaHours} hora(s).</div>
         <form method="post" action="/api/public-support/${encodeURIComponent(portal.slug)}/tickets">
           <label>Seu nome<input name="name" required maxlength="100" autocomplete="name"></label>
           <label>Seu e-mail<input name="email" type="email" required maxlength="180" autocomplete="email"></label>
           <label>Assunto<input name="subject" required maxlength="160"></label>
           <label>Categoria<select name="category"><option>Geral</option><option>Financeiro</option><option>Entrega</option><option>Produto</option><option>Suporte técnico</option></select></label>
           <label>Prioridade<select name="priority"><option>Normal</option><option>Alta</option><option>Urgente</option></select></label>
           <label>Como podemos ajudar?<textarea name="description" required maxlength="4000"></textarea></label>
           ${caixaDoTurnstile(env, "atendimento")}
           <button type="submit">Abrir chamado</button>
         </form>${scriptDoTurnstile(env)}`,
      ),
      200,
      env,
    );
  }
  if (request.method === "POST" && action === "tickets") {
    const ip = request.headers.get("cf-connecting-ip") || "desconhecido";
    if (allowed && !(await allowed(`public-support:${slug}:${ip}`, 12)))
      return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
    const body = await requestData(request);
    const barrado = await exigirTurnstile(request, env, body, {
      acao: "atendimento",
      responder: (dados, status) =>
        wantsJson(request)
          ? json(dados, status)
          : html(pageShell("Verificação necessária", `<h1>Não foi possível abrir</h1><p>${escapeHtml(dados.error)}</p><p><a href="/atendimento/${encodeURIComponent(portal.slug)}">Voltar para a central</a></p>`), status),
    });
    if (barrado) return barrado;
    const name = clean(body.name, 100);
    const email = clean(body.email, 180).toLowerCase();
    const subject = clean(body.subject, 160);
    const description = clean(body.description, 4000);
    if (!name || !subject || !description || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      const message = "Preencha nome, e-mail, assunto e descrição.";
      return wantsJson(request)
        ? json({ error: message }, 400)
        : html(pageShell("Dados inválidos", `<h1>Não foi possível abrir</h1><p>${message}</p>`), 400);
    }
    const priority = ["Normal", "Alta", "Urgente"].includes(body.priority)
      ? body.priority
      : "Normal";
    const multiplier = priority === "Urgente" ? 0.25 : priority === "Alta" ? 0.5 : 1;
    const nowDate = new Date();
    const due = new Date(nowDate.getTime() + portal.slaHours * multiplier * 3_600_000);
    const protocol = `CH-${randomToken(4).toUpperCase()}`;
    await env.DB.prepare(
      `INSERT INTO support_tickets
        (id, support_portal_id, workspace_owner_id, protocol, customer_name,
         customer_email, subject, description, category, priority, status,
         sla_due_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Novo', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        portal.id,
        row.workspace_owner_id,
        protocol,
        name,
        email,
        subject,
        description,
        clean(body.category, 60) || "Geral",
        priority,
        due.toISOString(),
        nowDate.toISOString(),
        nowDate.toISOString(),
      )
      .run();
    if (wantsJson(request)) return json({ ok: true, protocol }, 201);
    return html(
      pageShell(
        "Chamado aberto",
        `<span class="mark">Recebido</span><h1>Chamado aberto</h1>
         <p>Guarde seu protocolo:</p><div class="protocol">${escapeHtml(protocol)}</div>
         <p>A equipe já pode acompanhar sua solicitação.</p>`,
      ),
      201,
    );
  }
  return json({ error: "Método não permitido." }, 405);
}

async function publicAnalytics(request, env, url, dependencies) {
  const { allowed } = dependencies;
  const parts = url.pathname.split("/").filter(Boolean);
  const siteKey = clean(parts[2], 80);
  const site = await env.DB.prepare(
    "SELECT * FROM analytics_sites WHERE site_key = ? AND active = 1",
  )
    .bind(siteKey)
    .first();
  if (!site) return dependencies.json({ error: "Identificador inválido." }, 404);
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = site.allowed_origin === "*" ? "*" : site.allowed_origin;
  const corsHeaders = {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
  const corsJson = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  if (site.allowed_origin !== "*" && origin && origin !== site.allowed_origin)
    return new Response(null, { status: 403, headers: corsHeaders });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return corsJson({ error: "Método não permitido." }, 405);
  const ip = request.headers.get("cf-connecting-ip") || "desconhecido";
  if (allowed && !(await allowed(`analytics:${siteKey}:${ip}`, 120)))
    return corsJson({ error: "Limite temporário atingido." }, 429);
  const body = await requestData(request);
  const eventName = clean(body.eventName || body.event, 80);
  if (!eventName) return corsJson({ error: "Informe o evento." }, 400);
  let referrerHost = "";
  try {
    referrerHost = body.referrer ? new URL(String(body.referrer)).hostname : "";
  } catch {}
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO analytics_events
      (id, analytics_site_id, workspace_owner_id, event_name, path,
       referrer_host, session_id, visitor_id, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      site.id,
      site.workspace_owner_id,
      eventName,
      clean(body.path, 500) || "/",
      clean(referrerHost, 180),
      clean(body.sessionId, 100),
      clean(body.visitorId, 100),
      clean(body.occurredAt, 40) || now,
      now,
    )
    .run();
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function handlePublicPlatformSuite(request, env, url, dependencies) {
  if (url.pathname.startsWith("/agenda/") || url.pathname.startsWith("/api/public-scheduling/"))
    return publicBooking(request, env, url, dependencies);
  if (url.pathname.startsWith("/atendimento/") || url.pathname.startsWith("/api/public-support/"))
    return publicSupport(request, env, url, dependencies);
  if (url.pathname.startsWith("/api/public-analytics/"))
    return publicAnalytics(request, env, url, dependencies);
  return null;
}
