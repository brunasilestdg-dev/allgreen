import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  expurgarPosicoesAntigasDoTracker,
  TRACKER_RETENCAO_DIAS_PADRAO,
} from "../worker/services/todogreen-tracker.js";

// Retenção de posições do rastreador (P1: teto de escala do D1).
//
// A coleção `todogreen_tracker_positions` cresce a cada polling de cada veículo.
// Estes testes provam que o expurgo do cron: (1) apaga o que está além da janela
// de retenção, (2) preserva o que está dentro dela, (3) respeita o piso de 7 dias
// mesmo com env var absurdo, e (4) não é global demais — só toca o que é antigo.

const OWNER = "retencao-owner";
const OUTRO = "retencao-outro-espaco";

const diasAtras = (dias) => new Date(Date.now() - dias * 86_400_000).toISOString();

async function inserirPosicao(id, ownerId, recordedAt) {
  await env.DB.prepare(
    `INSERT INTO todogreen_tracker_positions
       (id, integration_id, workspace_owner_id, vehicle_link_id, external_vehicle_id,
        latitude, longitude, recorded_at, received_at, raw_hash, raw_json)
     VALUES (?, 'integ-x', ?, 'link-x', 'ext-x', -23.5, -46.6, ?, ?, ?, '{}')`,
  ).bind(id, ownerId, recordedAt, recordedAt, `hash-${id}`).run();
}

const quantas = async (ownerId) =>
  Number(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM todogreen_tracker_positions WHERE workspace_owner_id = ?",
      ).bind(ownerId).first()
    )?.total || 0,
  );

beforeAll(async () => {
  const agora = new Date().toISOString();
  // Linhas-pai: as posições têm FK para integração e vínculo de veículo, e o D1
  // do harness de teste faz cumprir a chave estrangeira.
  await env.DB.prepare(
    `INSERT INTO todogreen_tracker_integrations
       (id, workspace_owner_id, created_by, updated_by, created_at, updated_at)
     VALUES ('integ-x', ?, 'sys', 'sys', ?, ?)`,
  ).bind(OWNER, agora, agora).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_tracker_vehicle_links
       (id, integration_id, workspace_owner_id, external_vehicle_id, created_at, updated_at)
     VALUES ('link-x', 'integ-x', ?, 'ext-x', ?, ?)`,
  ).bind(OWNER, agora, agora).run();

  // Duas antigas (além de 90 dias) e duas recentes (dentro da janela) no espaço
  // sob teste; uma antiga num outro espaço, para provar que a limpeza é por
  // tempo e não deixa passar por ser de outro dono.
  await inserirPosicao("velha-1", OWNER, diasAtras(200));
  await inserirPosicao("velha-2", OWNER, diasAtras(91));
  await inserirPosicao("nova-1", OWNER, diasAtras(30));
  await inserirPosicao("nova-2", OWNER, diasAtras(1));
  await inserirPosicao("velha-outro", OUTRO, diasAtras(120));
});

describe("expurgo de posições do rastreador", () => {
  it("apaga posições além da janela e preserva as de dentro", async () => {
    const resultado = await expurgarPosicoesAntigasDoTracker(env);
    // 2 velhas do OWNER + 1 velha do OUTRO = 3 removidas.
    expect(resultado.removidas).toBe(3);
    expect(resultado.dias).toBe(TRACKER_RETENCAO_DIAS_PADRAO);

    expect(await quantas(OWNER)).toBe(2);
    expect(await quantas(OUTRO)).toBe(0);

    const restantes = await env.DB.prepare(
      "SELECT id FROM todogreen_tracker_positions WHERE workspace_owner_id = ? ORDER BY id",
    ).bind(OWNER).all();
    expect((restantes.results || []).map((r) => r.id)).toEqual(["nova-1", "nova-2"]);
  });

  it("é idempotente: sem nada antigo, não apaga mais nada", async () => {
    const resultado = await expurgarPosicoesAntigasDoTracker(env);
    expect(resultado.removidas).toBe(0);
    expect(await quantas(OWNER)).toBe(2);
  });

  it("respeita o piso de 7 dias mesmo com retenção configurada em 0", async () => {
    await inserirPosicao("borda-8-dias", OWNER, diasAtras(8));
    // Com o piso de 7 dias, tudo além dele é apagado: nova-1 (30 dias) e a de 8
    // dias. Só nova-2 (1 dia) sobrevive. O que o teste prova: um env var absurdo
    // (0) NÃO zera a janela — o dado de 1 dia, quase vivo, permanece.
    const resultado = await expurgarPosicoesAntigasDoTracker(
      { DB: env.DB, TODOGREEN_TRACKER_RETENTION_DAYS: "0" },
    );
    expect(resultado.dias).toBe(7);
    expect(resultado.removidas).toBe(2);
    const ids = await env.DB.prepare(
      "SELECT id FROM todogreen_tracker_positions WHERE workspace_owner_id = ? ORDER BY id",
    ).bind(OWNER).all();
    expect((ids.results || []).map((r) => r.id)).toEqual(["nova-2"]);
  });
});
