import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// N.3 fatia 1: a régua ESG editável do espaço entra no motor AUDITÁVEL
// (/calcular grava com a memória inteira). Antes, editar o fator de emissão na
// tela só mudava o simulador de preço — o número que ia para o relatório do
// cliente ficava preso ao fator de fábrica. Estes testes provam a ponta a
// ponta: sem régua cai no de fábrica (2026.2), com régua o número muda e a
// versão gravada passa a ser a da régua.

let n = 0;
const nextIp = () => `198.51.100.${(++n % 240) + 1}`;

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function criarUsuario(id, email) {
  const token = `tok-${id}`;
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'h', 's', ?)`,
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(`ses-${id}`, id, await sha256(token), agora).run();
  return { id, email, token };
}

const pedir = (caminho, { method = "GET", token, body } = {}) => {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${caminho}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
};

// Sem classeVeiculo: cai no caminho genérico, onde tanto a rede elétrica quanto
// o diesel de referência vêm do conjunto — então editar a régua move o número.
const operacaoEletrica = (referencia) => ({
  referencia,
  distanciaKm: 100,
  viagens: 10,
  tipoVeiculo: "Furgão elétrico",
  origens: { distancia: "medido", ocupacao: "documentado" },
});

const calcular = (token, referencia) =>
  pedir("/api/todogreen/esg/calcular", {
    method: "POST",
    token,
    body: {
      clienteId: "esg-regua-cli",
      operacoes: [operacaoEletrica(referencia)],
      ocupacaoPercent: 80,
      frotaLimpaPercent: 70,
      ocorrencias: 0,
    },
  });

let admin;

beforeAll(async () => {
  admin = await criarUsuario("esg-regua-adm", "gestor-regua@todogreen.com.br");

  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();

  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'admin', 'active', '["*"]', '', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), admin.email, admin.id, new Date().toISOString(), new Date().toISOString()).run();

  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id, tenant_id, workspace_owner_id, name, status, portal_enabled,
        created_by, updated_by, created_at, updated_at)
     VALUES ('esg-regua-cli', 'todogreen', ?, 'Cliente Régua ESG', 'ativo', 1, 'seed', 'seed', ?, ?)`,
  ).bind(admin.id, agora, agora).run();
});

describe("a régua editável entra no motor auditável (N.3 fatia 1)", () => {
  let baselineEvitado;

  it("sem régua no espaço, calcula e grava com o fator de fábrica (2026.2)", async () => {
    const d = await (await calcular(admin.token, "SEM-REGUA")).json();
    const calc = d.calculos.find((c) => c.referencia === "SEM-REGUA");
    expect(calc.versaoFatores).toBe("2026.2");
    expect(calc.impacto.co2AvoidedKg).toBeGreaterThan(0);
    baselineEvitado = calc.impacto.co2AvoidedKg;

    const linha = await env.DB.prepare(
      "SELECT methodology_version FROM environmental_calculations WHERE id = ?",
    ).bind(calc.id).first();
    expect(linha.methodology_version).toBe("2026.2");

    const fatores = await (await pedir("/api/todogreen/esg/fatores", { token: admin.token })).json();
    expect(fatores.fatores.versao).toBe("2026.2");
    expect(fatores.fatores.fatores.rede_eletrica_kgco2e_por_kwh.valor).toBe(0.0385);
  });

  it("com régua que sobe o fator da rede, o CO2 evitado cai e a versão gravada é a da régua", async () => {
    // Régua ativa do espaço: fator da rede elétrica bem acima do de fábrica.
    await env.DB.prepare(
      `INSERT INTO todogreen_environmental_parameters
         (version, tenant_id, workspace_owner_id, factors_json, green_score_weights_json,
          change_summary, justification, responsible, effective_from, status, created_by, created_at)
       VALUES (?, 'todogreen', ?, ?, '{}', 'sobe o fator da rede', 'teste N.3 fatia 1',
               'Sustentabilidade', '2026-09-01', 'active', ?, ?)`,
    ).bind(
      "regua-esg-teste",
      admin.id,
      JSON.stringify({ electricKgCo2ePerKwh: 0.08 }),
      admin.id,
      new Date().toISOString(),
    ).run();

    const d = await (await calcular(admin.token, "COM-REGUA")).json();
    const calc = d.calculos.find((c) => c.referencia === "COM-REGUA");
    expect(calc.versaoFatores).toBe("regua-esg-teste");
    expect(calc.impacto.co2AvoidedKg).toBeLessThan(baselineEvitado);

    const linha = await env.DB.prepare(
      "SELECT methodology_version FROM environmental_calculations WHERE id = ?",
    ).bind(calc.id).first();
    expect(linha.methodology_version).toBe("regua-esg-teste");

    // "Fatores em uso" agora reflete a régua, não mente mais.
    const fatores = await (await pedir("/api/todogreen/esg/fatores", { token: admin.token })).json();
    expect(fatores.fatores.versao).toBe("regua-esg-teste");
    expect(fatores.fatores.fatores.rede_eletrica_kgco2e_por_kwh.valor).toBe(0.08);
    // os fatores não editados continuam no de fábrica
    expect(fatores.fatores.fatores.diesel_b14_kgco2e_por_litro.valor).toBe(2.68);
  });
});

describe("energia medida flui pelo /calcular (N.3 fatia 3)", () => {
  it("operação com energia medida grava a energia real, não a derivada", async () => {
    const d = await (
      await pedir("/api/todogreen/esg/calcular", {
        method: "POST",
        token: admin.token,
        body: {
          clienteId: "esg-regua-cli",
          operacoes: [
            { referencia: "DERIVADA", distanciaKm: 100, viagens: 10, tipoVeiculo: "Furgão elétrico", origens: { distancia: "medido" } },
            { referencia: "MEDIDA", distanciaKm: 100, viagens: 10, tipoVeiculo: "Furgão elétrico", energiaKwhMedida: 500, energiaOrigem: "medido", origens: { distancia: "medido" } },
          ],
          ocupacaoPercent: 80,
          frotaLimpaPercent: 70,
          ocorrencias: 0,
        },
      })
    ).json();
    const derivada = d.calculos.find((c) => c.referencia === "DERIVADA");
    const medida = d.calculos.find((c) => c.referencia === "MEDIDA");
    expect(derivada.impacto.energiaKwh).toBe(300);
    expect(medida.impacto.energiaKwh).toBe(500);

    // O gravado carrega a energia medida e a memória diz que não foi derivada.
    const gravado = await env.DB.prepare(
      "SELECT inputs_json, result_json FROM environmental_calculations WHERE id = ?",
    ).bind(medida.id).first();
    const resultado = JSON.parse(gravado.result_json);
    expect(resultado.memoria.entradas.energiaKwhMedida).toBe(500);
    expect(resultado.memoria.entradas.energiaDerivada).toBe(false);
    expect(resultado.memoria.fatoresUsados.some((f) => f.chave === "energia_medida")).toBe(true);
  });
});

describe("fechamento mensal GLEC / ISO 14083 (bloco 08)", () => {
  it("fecha o mês: consolida cálculos + atividade tonne-km, e não duplica ao refechar", async () => {
    const agora = new Date().toISOString();
    const mes = agora.slice(0, 7);
    const hoje = agora.slice(0, 10);

    // Uma operação com peso (2 t) e distância (100 km) no mês corrente = 200 tkm.
    await env.DB.prepare(
      `INSERT INTO todogreen_client_operations
         (id, tenant_id, client_id, workspace_owner_id, service_date, distance_km, fields_json,
          created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', 'esg-regua-cli', ?, ?, 100, ?, 'seed', 'seed', ?, ?)`,
    ).bind(crypto.randomUUID(), admin.id, hoje, JSON.stringify({ weightKg: 2000 }), agora, agora).run();

    // Garante ao menos um cálculo no mês (o motor auditável grava co2ExecutadoKg).
    await calcular(admin.token, "FECHA");

    const r = await pedir("/api/todogreen/esg/fechamento", {
      method: "POST",
      token: admin.token,
      body: { clienteId: "esg-regua-cli", mes },
    });
    expect(r.status).toBe(201);
    const d = await r.json();
    expect(d.fechamento.mes).toBe(mes);
    expect(d.fechamento.metodologia).toMatch(/GLEC|14083/);
    // Prova que o endpoint leu a chave `impact` do cálculo gravado.
    expect(d.fechamento.resumo.co2EmitidoKg).toBeGreaterThan(0);
    expect(d.fechamento.resumo.toneladasKm).toBe(200);
    expect(d.fechamento.resumo.intensidadeGCo2ePorTkm).toBeGreaterThan(0);

    // O registro ficou gravado.
    const gravado = await env.DB.prepare(
      "SELECT status, methodology_version FROM todogreen_esg_monthly_closes WHERE client_id = 'esg-regua-cli' AND period_month = ?",
    ).bind(mes).first();
    expect(gravado.status).toBe("fechado");

    // Refechar o mesmo mês atualiza, não duplica.
    const r2 = await pedir("/api/todogreen/esg/fechamento", {
      method: "POST",
      token: admin.token,
      body: { clienteId: "esg-regua-cli", mes },
    });
    expect((await r2.json()).refechado).toBe(true);
    const contagem = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM todogreen_esg_monthly_closes WHERE client_id = 'esg-regua-cli' AND period_month = ?",
    ).bind(mes).first();
    expect(contagem.n).toBe(1);

    // A listagem traz o mês fechado.
    const lista = await (await pedir("/api/todogreen/esg/fechamentos?cliente=esg-regua-cli", { token: admin.token })).json();
    expect(lista.fechamentos.some((f) => f.mes === mes)).toBe(true);
  });
});
