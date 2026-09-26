import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker-entry.js";
import wrangler from "../wrangler.jsonc?raw";
import { CRON_HORARIO, CRON_SEMANAL } from "../worker/lib/cron.js";

// Os dois crons (wrangler.jsonc) disparam juntos às segundas 12:00 UTC, cada
// um numa invocação do scheduled. Antes, as DUAS invocações rodavam todos os
// jobs horários, e o worker-entry.js ainda chamava o rastreador por conta
// própria antes de delegar ao worker.js, que o chamava de novo: duas execuções
// em paralelo lendo as mesmas integrações vencidas e sincronizando em dobro
// com o fornecedor. Estes testes usam a entrada real do deploy.

const TEMPO_DE_CRON = 60_000;
const SEGUNDA_MEIO_DIA = Date.parse("2026-07-20T12:00:00.000Z");
const SEGUNDA_TARDE = Date.parse("2026-07-20T15:00:00.000Z");

// Chaves de assinatura de push válidas (as mesmas de weekly-summary).
const ASSINATURA = {
  p256dh:
    "BBcbXQS6JPMajokpCFSRDHm01L7XO7PDC0Z1bwAfyKFypdJHs7RutE_HYLqomJOc0FO0H1XOJN5kkSi_zlDXEhc",
  auth: "wXFF86sqhUHxDpvV2v6gBg",
};

async function disparar(controller, ambiente) {
  const pendentes = [];
  const ctx = { waitUntil: (p) => pendentes.push(p), passThroughOnException() {} };
  await worker.scheduled(controller, ambiente, ctx);
  await Promise.all(pendentes);
}

async function semear(prefixo) {
  const agora = new Date().toISOString();
  const dono = `${prefixo}-dono`;
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'hash', 'salt', ?)`,
  ).bind(dono, `Dono ${prefixo}`, `${dono}@cron.test`, agora).run();
  // Automação semanal de segunda: vence em 2026-07-20 (job horário).
  await env.DB.prepare(
    "INSERT INTO workspaces (user_id, data, updated_at, revision) VALUES (?, ?, ?, 0)",
  ).bind(
    dono,
    JSON.stringify({
      tasks: [],
      notifications: [],
      automations: [
        { id: "regra", name: "Planejar", enabled: true, frequency: "weekly", day: 1, actionType: "task", actionText: "Planejar a semana", history: {} },
      ],
      // Atividade na semana anterior, para o resumo semanal ter o que mandar.
      orders: [{ id: "o1", status: "Entregue", total: 120, createdAt: "2026-07-15T10:00:00Z" }],
    }),
    agora,
  ).run();
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(`push-${dono}`, dono, `https://push.exemplo.test/${prefixo}`, ASSINATURA.p256dh, ASSINATURA.auth, agora).run();
  // Processo recorrente vencido (job horário do worker-entry.js).
  await env.DB.prepare(
    `INSERT INTO todogreen_enterprise_workflows
       (id, workspace_owner_id, domain, kind, title, status, recurrence_json,
        created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, 'general', 'rotina', 'Rotina recorrente', 'in_progress', ?, ?, ?, ?, ?)`,
  ).bind(
    `${prefixo}-processo`,
    dono,
    JSON.stringify({ enabled: true, frequency: "daily", interval: 1, nextRunAt: "2026-07-01T00:00:00.000Z" }),
    dono,
    dono,
    agora,
    agora,
  ).run();
  // Integração do rastreador em polling, vencida há anos (job horário).
  await env.DB.prepare(
    `INSERT INTO todogreen_tracker_integrations
       (id, workspace_owner_id, name, base_url, token_env_key, status, sync_mode,
        polling_interval_minutes, provider_config_json, created_by, updated_by,
        created_at, updated_at)
     VALUES (?, ?, 'Rastreador', ?, 'TODOGREEN_TRACKER_TESTE_TOKEN', 'ready', 'polling', 60, ?, ?, ?,
             '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
  ).bind(
    `${prefixo}-rastreador`,
    dono,
    `https://${prefixo}.rastreador.exemplo.test/api/`,
    JSON.stringify({ vehiclesPath: "v1/posicoes" }),
    dono,
    dono,
  ).run();
  return dono;
}

async function estado(prefixo) {
  const dono = `${prefixo}-dono`;
  const espaco = await env.DB.prepare("SELECT revision FROM workspaces WHERE user_id = ?").bind(dono).first();
  const processos = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM todogreen_enterprise_workflows WHERE source_template_id = ?",
  ).bind(`${prefixo}-processo`).first();
  const sincronizacoes = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM todogreen_tracker_sync_runs WHERE integration_id = ?",
  ).bind(`${prefixo}-rastreador`).first();
  return {
    revisao: espaco.revision,
    processosCriados: processos.total,
    sincronizacoes: sincronizacoes.total,
    chamadasAoRastreador: chamadas.filter((url) => url.startsWith(`https://${prefixo}.rastreador.`)).length,
    pushes: chamadas.filter((url) => url === `https://push.exemplo.test/${prefixo}`).length,
  };
}

const ambiente = () => ({ ...env, TODOGREEN_TRACKER_TESTE_TOKEN: "token-de-teste" });

const originalFetch = globalThis.fetch;
let chamadas;
beforeEach(() => {
  chamadas = [];
  globalThis.fetch = vi.fn(async (input) => {
    // O rastreador chama fetch com um URL; o push, com string ou Request.
    const url = input instanceof Request ? input.url : String(input);
    chamadas.push(url);
    if (url.includes(".rastreador.exemplo.test/"))
      return new Response("[]", { headers: { "content-type": "application/json" } });
    if (url.startsWith("https://push.exemplo.test/")) return new Response(null, { status: 201 });
    return new Response("sem rede no teste", { status: 503 });
  });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("crons do Worker", () => {
  it("os padrões do código são os de triggers.crons no wrangler.jsonc", () => {
    const lista = wrangler.match(/"crons"\s*:\s*(\[[^\]]*\])/);
    expect(JSON.parse(lista[1]).sort()).toEqual([CRON_HORARIO, CRON_SEMANAL].sort());
  });

  it("o disparo semanal roda só o resumo da semana", async () => {
    await semear("semanal");
    await disparar({ cron: CRON_SEMANAL, scheduledTime: SEGUNDA_MEIO_DIA }, ambiente());
    expect(await estado("semanal")).toEqual({
      revisao: 0,
      processosCriados: 0,
      sincronizacoes: 0,
      chamadasAoRastreador: 0,
      pushes: 1,
    });
  }, TEMPO_DE_CRON);

  it("o disparo horário roda os jobs horários e o rastreador uma vez só", async () => {
    await semear("horario");
    await disparar({ cron: CRON_HORARIO, scheduledTime: SEGUNDA_TARDE }, ambiente());
    expect(await estado("horario")).toEqual({
      revisao: 1,
      processosCriados: 1,
      sincronizacoes: 1,
      chamadasAoRastreador: 1,
      pushes: 0,
    });
  }, TEMPO_DE_CRON);

  it("o disparo manual, sem cron, continua rodando os jobs horários", async () => {
    await semear("manual");
    await disparar({ scheduledTime: SEGUNDA_TARDE }, ambiente());
    expect(await estado("manual")).toEqual({
      revisao: 1,
      processosCriados: 1,
      sincronizacoes: 1,
      chamadasAoRastreador: 1,
      pushes: 0,
    });
  }, TEMPO_DE_CRON);
});
