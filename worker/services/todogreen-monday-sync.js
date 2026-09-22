// Espelhamento do board "Novos Negócios" do monday.com -> oportunidades do ERP
// (Kanban Novos Clientes do painel comercial).
//
// Usa um TOKEN de API pessoal guardado no cofre (MONDAY_API_TOKEN) — nunca no
// código. Somente LEITURA no monday.com; escreve idempotente em
// todogreen_opportunities com id determinístico "monday:<itemId>" e
// source "monday" no fields_json, para não colidir com oportunidades nativas.
import { TENANT_ID } from "./todogreen-access.js";

const MONDAY_API = "https://api.monday.com/v2";
const BOARD_PADRAO = "18393502536"; // Dashboard - Novos Negocios & Projetos

// Colunas do board (ver estrutura real): Funil (etapa), faturamentos e resumo.
const COL = Object.freeze({
  funil: "color_mm3phe88",
  mensal: "numeric_mm1jam2g",
  anual: "numeric_mm1jaksg",
  responsavel: "project_owner",
  update: "text_mm3pq3cr",
});

const texto = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const numero = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export async function mondayQuery(env, query, variables = {}, fetcher = fetch) {
  const token = String(env?.MONDAY_API_TOKEN || "").trim();
  if (!token) throw new Error("MONDAY_API_TOKEN ausente");
  const resp = await fetcher(MONDAY_API, {
    method: "POST",
    headers: { authorization: token, "content-type": "application/json", "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || body?.errors) {
    throw new Error(`monday_api_${resp.status}: ${texto(JSON.stringify(body?.errors || ""), 200)}`);
  }
  return body?.data;
}

// Descobre o espaço (workspace_owner_id) que recebe as oportunidades: o mesmo do
// retrato comercial / integração Track3R, para o painel (que lê por esse dono)
// enxergar. Evita dono hardcoded no cron. MONDAY_SYNC_OWNER_ID sobrepõe.
async function donoAlvo(env) {
  const explicit = texto(env?.MONDAY_SYNC_OWNER_ID, 120);
  if (explicit) return explicit;
  const snap = await env.DB.prepare(
    `SELECT workspace_owner_id FROM todogreen_commercial_snapshots
      WHERE tenant_id=? ORDER BY imported_at DESC LIMIT 1`,
  ).bind(TENANT_ID).first().catch(() => null);
  if (snap?.workspace_owner_id) return texto(snap.workspace_owner_id, 120);
  const trk = await env.DB.prepare(
    `SELECT workspace_owner_id FROM todogreen_tms_integrations
      WHERE tenant_id=? AND provider='track3r' AND archived_at IS NULL LIMIT 1`,
  ).bind(TENANT_ID).first().catch(() => null);
  return texto(trk?.workspace_owner_id, 120);
}

const coluna = (cols, id) => (cols || []).find((c) => c?.id === id) || null;

export function mapearItemMonday(item) {
  const cols = item?.column_values || [];
  return {
    externalId: texto(item?.id, 60),
    cliente: texto(item?.name, 240),
    estagio: texto(coluna(cols, COL.funil)?.text, 80) || "Sem Classificação",
    valorMensal: numero(coluna(cols, COL.mensal)?.text),
    valorContrato: numero(coluna(cols, COL.anual)?.text),
    responsavelNome: texto(coluna(cols, COL.responsavel)?.text, 240),
    fupTexto: texto(coluna(cols, COL.update)?.text, 1000),
    atualizadoEm: texto(item?.updated_at, 40),
  };
}

const QUERY = `query ($board: [ID!], $cursor: String) {
  boards(ids: $board) {
    items_page(limit: 100, cursor: $cursor) {
      cursor
      items {
        id
        name
        updated_at
        column_values(ids: ["${COL.funil}","${COL.mensal}","${COL.anual}","${COL.responsavel}","${COL.update}"]) { id text value }
      }
    }
  }
}`;

export async function sincronizarMondayOportunidades(env, { ownerId, fetcher = fetch } = {}) {
  if (!env?.DB) return { ok: false, erro: "db_indisponivel" };
  if (!String(env?.MONDAY_API_TOKEN || "").trim()) return { ok: false, erro: "sem_token" };
  const dono = texto(ownerId, 120) || await donoAlvo(env);
  if (!dono) return { ok: false, erro: "sem_dono" };
  const boardId = texto(env?.MONDAY_SYNC_BOARD_ID, 60) || BOARD_PADRAO;

  const agora = new Date().toISOString();
  let cursor = null;
  let sincronizados = 0;
  let paginas = 0;
  do {
    const data = await mondayQuery(env, QUERY, { board: [boardId], cursor }, fetcher);
    const page = data?.boards?.[0]?.items_page;
    const items = page?.items || [];
    for (const item of items) {
      const m = mapearItemMonday(item);
      if (!m.externalId || !m.cliente) continue;
      const id = `monday:${m.externalId}`;
      const quando = m.atualizadoEm || agora;
      const fields = JSON.stringify({
        source: "monday",
        mondayItemId: m.externalId,
        boardId,
        responsavelNome: m.responsavelNome,
        fupTexto: m.fupTexto,
      });
      // created_by/workspace_owner_id têm FK para users(id): usar o dono (usuário
      // real do espaço), nunca um rótulo sintético.
      await env.DB.prepare(
        `INSERT INTO todogreen_opportunities
           (id,tenant_id,workspace_owner_id,client_name,stage,monthly_value,contract_value,
            last_interaction_at,fields_json,revision,created_by,updated_by,created_at,updated_at,archived_at)
         VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,?,NULL)
         ON CONFLICT(id) DO UPDATE SET
           client_name=excluded.client_name,
           stage=excluded.stage,
           monthly_value=excluded.monthly_value,
           contract_value=excluded.contract_value,
           last_interaction_at=excluded.last_interaction_at,
           fields_json=excluded.fields_json,
           revision=todogreen_opportunities.revision+1,
           updated_by=excluded.updated_by,
           updated_at=excluded.updated_at,
           archived_at=NULL`,
      ).bind(
        id, TENANT_ID, dono, m.cliente, m.estagio, m.valorMensal, m.valorContrato,
        quando, fields, dono, dono, quando, quando,
      ).run();
      sincronizados += 1;
    }
    cursor = page?.cursor || null;
    paginas += 1;
    if (paginas > 200) break; // guarda contra laço infinito
  } while (cursor);

  return { ok: true, sincronizados, dono, boardId };
}

// Cron: mantém o Kanban espelhado sem ninguém clicar. Auto-limitado: só roda se
// o token estiver no cofre; erros não derrubam os outros jobs agendados.
export async function runTodoGreenMondaySyncScheduled(env) {
  if (!String(env?.MONDAY_API_TOKEN || "").trim()) return { ok: false, skipped: true };
  return sincronizarMondayOportunidades(env).catch((error) => ({
    ok: false, erro: texto(error?.message || error, 200),
  }));
}
