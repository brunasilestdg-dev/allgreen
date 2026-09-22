import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { sincronizarMondayOportunidades, mapearItemMonday } from "../worker/services/todogreen-monday-sync.js";

// Espelhamento do board "Novos Negócios" do monday.com no Kanban (oportunidades).
// Usa um fetcher injetado para não bater na API real.

const item = (id, name, funil, mensal, anual, resp, upd) => ({
  id,
  name,
  updated_at: "2026-09-20T10:00:00Z",
  column_values: [
    { id: "color_mm3phe88", text: funil, value: null },
    { id: "numeric_mm1jam2g", text: String(mensal), value: null },
    { id: "numeric_mm1jaksg", text: String(anual), value: null },
    { id: "project_owner", text: resp, value: null },
    { id: "text_mm3pq3cr", text: upd, value: null },
  ],
});

const fakeFetch = (pages) => {
  let i = 0;
  return async () => {
    const page = pages[i] || { items: [], cursor: null };
    i += 1;
    return {
      ok: true,
      json: async () => ({ data: { boards: [{ items_page: { cursor: page.cursor, items: page.items } }] } }),
    };
  };
};

const dono = "monday-dono";

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen','todogreen','To Do Green','logistica','active','{}',?,?)`,
  ).bind(agora, agora).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, 'Dona', 'dona@monday.test', 'h', 's', ?)`,
  ).bind(dono, agora).run();
});

describe("monday sync → oportunidades", () => {
  it("mapeia item do board (funil, valores, responsável, resumo)", () => {
    const m = mapearItemMonday(item("1", "On Running", "Negociação", "5000", "60000", "Valentin", "Avançou"));
    expect(m).toMatchObject({
      externalId: "1", cliente: "On Running", estagio: "Negociação",
      valorMensal: 5000, valorContrato: 60000, responsavelNome: "Valentin", fupTexto: "Avançou",
    });
  });

  it("espelha itens com id determinístico, escopado pelo dono, e é idempotente", async () => {
    const env1 = { ...env, MONDAY_API_TOKEN: "tok" };
    const pages = [{
      items: [
        item("101", "On Running", "Negociação", "5000", "60000", "Valentin", "Avançou"),
        item("102", "WE PINK", "Prospeção", "3000", "36000", "Jeberson", ""),
      ],
      cursor: null,
    }];
    const r = await sincronizarMondayOportunidades(env1, { ownerId: dono, fetcher: fakeFetch(pages) });
    expect(r.ok).toBe(true);
    expect(r.sincronizados).toBe(2);

    const row = await env.DB.prepare("SELECT * FROM todogreen_opportunities WHERE id='monday:101'").first();
    expect(row.client_name).toBe("On Running");
    expect(row.stage).toBe("Negociação");
    expect(Number(row.monthly_value)).toBe(5000);
    expect(Number(row.contract_value)).toBe(60000);
    expect(row.workspace_owner_id).toBe(dono);
    const fields = JSON.parse(row.fields_json);
    expect(fields.source).toBe("monday");
    expect(fields.fupTexto).toBe("Avançou");

    // Reprocessar não duplica.
    const r2 = await sincronizarMondayOportunidades(env1, { ownerId: dono, fetcher: fakeFetch(pages) });
    expect(r2.sincronizados).toBe(2);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS t FROM todogreen_opportunities WHERE workspace_owner_id = ?",
    ).bind(dono).first();
    expect(Number(count.t)).toBe(2);
  });

  it("sem token, não roda (fecha seguro)", async () => {
    const r = await sincronizarMondayOportunidades({ ...env, MONDAY_API_TOKEN: "" }, { ownerId: dono, fetcher: fakeFetch([]) });
    expect(r.ok).toBe(false);
    expect(r.erro).toBe("sem_token");
  });
});
