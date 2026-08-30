// ===== Inteligência de mercado da empresa =====
//
// Diferente da pesquisa de uma conta, esta fila nasce antes do CRM: procura
// RFQs, notícias e possíveis decisores relevantes ao negócio da To Do Green,
// mesmo quando a organização ainda não está na carteira de ninguém.

import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { envComChavesDeBuscaDoEspaco } from "./search-keys.js";
import { searchWeb } from "./web-search.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

const clean = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const KINDS = new Set(["rfq", "news", "decisors"]);
const STATUSES = new Set(["new", "reviewed", "opportunity", "dismissed"]);

const canRead = (access) => podeNaVertical(access, "market:read") || podeNaVertical(access, "market:research");
const canResearch = (access) => podeNaVertical(access, "market:research");

export function buildMarketResearchPlans({ kind = "all", company = "", year = new Date().getUTCFullYear() } = {}) {
  const selected = kind === "all" ? ["rfq", "news", "decisors"] : [kind];
  const plans = [];
  if (selected.includes("rfq")) {
    plans.push(
      { kind: "rfq", query: `(RFQ OR RFP OR cotação OR licitação) (transporte OR logística OR frete) (moto OR van OR VUC OR caminhão OR carreta) (SP OR "São Paulo") ${year} (aberta OR inscrições OR fornecedor) -bitrem` },
      { kind: "rfq", query: `site:gov.br/pncp (transporte OR logística OR frete) (elétrico OR sustentável OR descarbonização OR "escopo 3") edital ${year} -bitrem` },
    );
  }
  if (selected.includes("news")) {
    plans.push(
      { kind: "news", query: `Brasil empresa novo centro de distribuição expansão e-commerce logística ${year}` },
      { kind: "news", query: `Brasil descarbonização logística frota elétrica escopo 3 transporte fornecedores ${year}` },
    );
  }
  if (selected.includes("decisors") && company) {
    plans.push(
      { kind: "decisors", query: `site:linkedin.com/in "${company}" Brasil (compras OR procurement OR suprimentos OR supply chain)` },
      { kind: "decisors", query: `site:linkedin.com/in "${company}" Brasil (logística OR transportes OR distribuição OR sustentabilidade)` },
    );
  }
  return plans;
}

const validUrl = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString().slice(0, 2000) : "";
  } catch {
    return "";
  }
};

const itemFromRow = (row) => ({
  id: row.id,
  kind: row.kind,
  company: row.company,
  title: row.title,
  url: row.url,
  snippet: row.snippet,
  provider: row.provider,
  sourceQuery: row.source_query,
  status: row.status,
  checkedAt: row.checked_at,
  updatedAt: row.updated_at,
});

async function listItems(env, access, url) {
  const kind = clean(url.searchParams.get("kind"), 20);
  const status = clean(url.searchParams.get("status"), 20);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const clauses = ["tenant_id=?", "workspace_owner_id=?"];
  const params = [TENANT_ID, access.ownerId];
  if (KINDS.has(kind)) { clauses.push("kind=?"); params.push(kind); }
  if (STATUSES.has(status)) { clauses.push("status=?"); params.push(status); }
  const { results } = await env.DB.prepare(
    `SELECT id,kind,company,title,url,snippet,provider,source_query,status,checked_at,updated_at
       FROM todogreen_market_intelligence_items
      WHERE ${clauses.join(" AND ")}
      ORDER BY checked_at DESC, created_at DESC LIMIT ?`,
  ).bind(...params, limit).all();
  const run = await env.DB.prepare(
    `SELECT id,kind,company,providers_json,failures_json,result_count,status,created_at
       FROM todogreen_market_research_runs
      WHERE tenant_id=? AND workspace_owner_id=?
      ORDER BY created_at DESC LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId).first();
  return json({
    items: (results || []).map(itemFromRow),
    lastRun: run ? {
      id: run.id, kind: run.kind, company: run.company,
      providers: JSON.parse(run.providers_json || "[]"),
      failures: JSON.parse(run.failures_json || "[]"),
      resultCount: run.result_count, status: run.status, createdAt: run.created_at,
    } : null,
  });
}

async function research(env, access, user, body) {
  const kind = clean(body.kind, 20) || "all";
  const company = clean(body.company, 160);
  if (kind !== "all" && !KINDS.has(kind)) return json({ error: "Tipo de pesquisa inválido." }, 400);
  if ((kind === "decisors" || kind === "all") && !company && kind === "decisors")
    return json({ error: "Informe a empresa para pesquisar possíveis decisores." }, 400);

  const plans = buildMarketResearchPlans({ kind, company });
  if (!plans.length) return json({ error: "Informe uma pesquisa válida." }, 400);
  const envBusca = await envComChavesDeBuscaDoEspaco(env, access.ownerId);
  const results = await Promise.all(plans.map(async (plan) => ({ ...plan, ...(await searchWeb(envBusca, plan.query)) })));
  if (results.every((item) => !item.configured))
    return json({ error: "Pesquisa web não configurada. Conecte um provedor em Integrações." }, 503);

  const providers = [...new Set(results.flatMap((item) => item.providers || []))];
  const failures = results.flatMap((item) => item.failures || []).slice(0, 20);
  if (!providers.length && failures.length)
    return json({ error: "Os provedores de pesquisa não responderam.", failures }, 502);

  const seen = new Set();
  const found = results.flatMap((result) => (result.results || []).map((item) => ({
    kind: result.kind,
    company: result.kind === "decisors" ? company : "",
    title: clean(item.title, 500),
    url: validUrl(item.url),
    snippet: clean(item.snippet || item.description, 2000),
    provider: clean((result.providers || [])[0], 80),
    sourceQuery: clean(result.query, 500),
  }))).filter((item) => item.title && item.url && !seen.has(`${item.kind}:${item.url}`) && seen.add(`${item.kind}:${item.url}`));

  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO todogreen_market_research_runs
       (id,tenant_id,workspace_owner_id,kind,company,query_plan_json,providers_json,
        failures_json,result_count,status,requested_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,'completed',?,?)`,
  ).bind(runId, TENANT_ID, access.ownerId, kind, company, JSON.stringify(plans),
    JSON.stringify(providers), JSON.stringify(failures), found.length, user.id, now).run();

  if (found.length) await env.DB.batch(found.map((item) => env.DB.prepare(
    `INSERT INTO todogreen_market_intelligence_items
       (id,tenant_id,workspace_owner_id,run_id,kind,company,title,url,snippet,source_query,
        provider,status,checked_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?)
     ON CONFLICT(tenant_id,workspace_owner_id,kind,url) DO UPDATE SET
       run_id=excluded.run_id,company=excluded.company,title=excluded.title,
       snippet=excluded.snippet,source_query=excluded.source_query,provider=excluded.provider,
       checked_at=excluded.checked_at,updated_at=excluded.updated_at`,
  ).bind(crypto.randomUUID(), TENANT_ID, access.ownerId, runId, item.kind, item.company,
    item.title, item.url, item.snippet, item.sourceQuery, item.provider, now, now, now)));

  return json({ ok: true, runId, resultCount: found.length, providers, failures }, 201);
}

async function updateStatus(env, access, body) {
  const id = clean(body.id, 80);
  const status = clean(body.status, 20);
  if (!id || !STATUSES.has(status)) return json({ error: "Informe o item e um status válido." }, 400);
  const { meta } = await env.DB.prepare(
    `UPDATE todogreen_market_intelligence_items SET status=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(status, new Date().toISOString(), id, TENANT_ID, access.ownerId).run();
  return meta?.changes ? json({ ok: true, id, status }) : json({ error: "Item não encontrado." }, 404);
}

export async function handleTodoGreenMarketIntelligence(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  if (!canRead(access)) return json({ error: "Seu acesso não permite consultar inteligência de mercado." }, 403);
  const url = new URL(request.url);
  if (request.method === "GET") return listItems(env, access, url);
  if (!canResearch(access)) return json({ error: "Seu acesso não permite executar pesquisas." }, 403);
  const body = await request.json().catch(() => ({}));
  if (request.method === "POST") return research(env, access, user, body);
  if (request.method === "PATCH") return updateStatus(env, access, body);
  return json({ error: "Método não permitido." }, 405);
}

// O cron roda a cada hora, mas cada espaço só entra duas vezes por dia. Limite
// de dois espaços por rodada evita uma rajada de chamadas quando muitos
// workspaces vencem juntos; os seguintes entram na hora posterior.
export async function runTodoGreenMarketIntelligenceScheduled(env, now = new Date()) {
  if (!env?.DB) return { processed: 0 };
  const cutoff = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT workspace_owner_id FROM (
       SELECT DISTINCT workspace_owner_id
         FROM tenant_users
        WHERE tenant_id=? AND status='active' AND workspace_owner_id<>''
       UNION
       SELECT DISTINCT workspace_owner_id
         FROM todogreen_access_emails
        WHERE tenant_id=? AND status='active' AND workspace_owner_id<>''
       UNION
       SELECT DISTINCT workspace_owner_id
         FROM todogreen_clients
        WHERE tenant_id=? AND archived_at IS NULL AND workspace_owner_id<>''
     ) spaces
     WHERE NOT EXISTS (
       SELECT 1 FROM todogreen_market_research_runs r
        WHERE r.tenant_id=? AND r.workspace_owner_id=spaces.workspace_owner_id
          AND r.kind='all' AND r.created_at>=?
     )
     ORDER BY workspace_owner_id LIMIT 2`,
  ).bind(TENANT_ID, TENANT_ID, TENANT_ID, TENANT_ID, cutoff).all().catch(() => ({ results: [] }));

  let processed = 0;
  for (const row of results || []) {
    const ownerId = clean(row.workspace_owner_id, 120);
    if (!ownerId) continue;
    try {
      const result = await research(
        env,
        { ownerId, role: "owner", permissions: ["*"] },
        { id: ownerId },
        { kind: "all", company: "" },
      );
      if (result.status < 400) processed += 1;
      else console.error("Pesquisa agendada de mercado recusada", ownerId, result.status);
    } catch (error) {
      console.error("Pesquisa agendada de mercado falhou", ownerId, error?.message);
    }
  }
  return { processed };
}
