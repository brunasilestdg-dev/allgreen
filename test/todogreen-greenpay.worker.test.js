import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// GreenPay: a carteira do motorista. As perguntas de segurança e de honestidade:
// (1) sem régua, a carteira NÃO inventa número; (2) o ganho é derivado da
// entrega, idempotente; (3) o motorista só vê a PRÓPRIA carteira; (4) só a
// gestão financeira administra régua/aprovação/pagamento.

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

let n = 0;
const pedir = (caminho, { method = "GET", token, body } = {}) =>
  worker.fetch(new Request(`https://app.test${caminho}`, {
    method,
    headers: {
      "cf-connecting-ip": `203.0.113.${(++n % 240) + 1}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, { waitUntil() {}, passThroughOnException() {} });

const criarUsuario = async (id, email) => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)",
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)",
  ).bind(`ses-${id}`, id, await sha256(`tok-${id}`), agora).run();
  return { id, email, token: `tok-${id}` };
};

const autorizar = async (email, role, permissoes) => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,'active',?,'','gp-dono',?,?)`,
  ).bind(crypto.randomUUID(), email, role, permissoes, agora, agora).run();
};

let dona, joao, maria;

beforeAll(async () => {
  const agora = new Date().toISOString();
  dona = await criarUsuario("gp-dono", "dona@greenpay.test");
  await autorizar(dona.email, "admin", '["*"]');
  joao = await criarUsuario("gp-joao", "joao@greenpay.test");
  maria = await criarUsuario("gp-maria", "maria@greenpay.test");
  for (const p of [joao, maria]) await autorizar(p.email, "motorista", '["driver:self","driver:event"]');

  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id,tenant_id,workspace_owner_id,name,status,portal_enabled,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('gp-cli','todogreen','gp-dono','Cliente GP','ativo',0,'{}',1,'gp-dono','gp-dono',?,?)`,
  ).bind(agora, agora).run();

  for (const [id, nome, email] of [
    ["gpd-joao", "João GreenPay", joao.email],
    ["gpd-maria", "Maria GreenPay", maria.email],
  ]) {
    await env.DB.prepare(
      `INSERT INTO todogreen_drivers
         (id,tenant_id,workspace_owner_id,driver_code,full_name,document,employment_type,
          availability_status,cnh_number,cnh_category,cnh_expires_at,status,user_email,
          fields_json,revision,created_by,updated_by,created_at,updated_at)
       VALUES (?,'todogreen','gp-dono',?,?,?,'employee','available','1','E','2030-01-01','active',?,
          '{}',1,'gp-dono','gp-dono',?,?)`,
    ).bind(id, id.toUpperCase(), nome, `doc-${id}`, email, agora, agora).run();
  }

  // João: duas viagens ENTREGUES (uma sem ocorrência de 20km, uma com ocorrência
  // de 10km) + uma NÃO entregue. Maria: uma entregue de 5km.
  const ins = async (id, ref, driverId, driverServiceDate, deliveredAt, distanceKm, incident) => {
    await env.DB.prepare(
      `INSERT INTO todogreen_client_operations
         (id,tenant_id,client_id,workspace_owner_id,reference,status,service_date,origin,destination,
          driver_id,delivered_at,distance_km,incident_count,fields_json,created_by,updated_by,created_at,updated_at)
       VALUES (?,'todogreen','gp-cli','gp-dono',?,'active',?,'CD','Loja',?,?,?,?,'{}','gp-dono','gp-dono',?,?)`,
    ).bind(id, ref, driverServiceDate, driverId, deliveredAt, distanceKm, incident, agora, agora).run();
  };
  const hoje = new Date().toISOString().slice(0, 10);
  await ins("gpo-j1", "GP-J1", "gpd-joao", hoje, `${hoje}T12:00:00Z`, 20, 0);
  await ins("gpo-j2", "GP-J2", "gpd-joao", hoje, `${hoje}T13:00:00Z`, 10, 1);
  await ins("gpo-j3", "GP-J3", "gpd-joao", hoje, null, 30, 0); // não entregue
  await ins("gpo-m1", "GP-M1", "gpd-maria", hoje, `${hoje}T12:00:00Z`, 5, 0);
});

describe("GreenPay — honestidade da régua", () => {
  it("sem régua, a carteira do motorista diz não configurada (não mostra R$ 0)", async () => {
    const r = await (await pedir("/api/todogreen/driver-portal/ganhos", { token: joao.token })).json();
    expect(r.configurada).toBe(false);
    expect(r.extrato).toEqual([]);
  });

  it("motorista não administra o GreenPay (403)", async () => {
    const r = await pedir("/api/todogreen/greenpay/regua", { token: joao.token });
    expect(r.status).toBe(403);
  });
});

describe("GreenPay — régua, geração e carteira", () => {
  it("gestor configura a régua com valores reais", async () => {
    const r = await (await pedir("/api/todogreen/greenpay/regua", {
      method: "PUT", token: dona.token,
      body: { valorPorEntrega: 8, valorPorKm: 0.9, bonusEntregaSemOcorrencia: 3 },
    })).json();
    expect(r.configurada).toBe(true);
    expect(r.regra.valorPorEntrega).toBe(8);
  });

  it("a régua expõe a prontidão SysPag DORMENTE por padrão, sem vazar segredo", async () => {
    const r = await (await pedir("/api/todogreen/greenpay/regua", { token: dona.token })).json();
    expect(r.syspag).toBeTruthy();
    // Sem SYSPAG_API_TOKEN/SYSPAG_BASE_URL no ambiente de teste, fica desligado.
    expect(r.syspag.habilitado).toBe(false);
    expect(r.syspag.faltando.length).toBeGreaterThan(0);
    // O status carrega o NOME da variável, nunca um valor de segredo.
    const bruto = JSON.stringify(r.syspag);
    expect(bruto).toContain("SYSPAG_API_TOKEN");
    expect(bruto).not.toMatch(/token["']?\s*[:=]\s*["'][A-Za-z0-9]{8,}/);
  });

  it("a meta mensal é gravada (config_json, sem migração) e volta na leitura e na carteira", async () => {
    await pedir("/api/todogreen/greenpay/regua", {
      method: "PUT", token: dona.token,
      body: { valorPorEntrega: 8, valorPorKm: 0.9, bonusEntregaSemOcorrencia: 3, metaMensal: 3000 },
    });
    const regua = await (await pedir("/api/todogreen/greenpay/regua", { token: dona.token })).json();
    expect(regua.regra.metaMensal).toBe(3000);
    // O motorista vê a meta na própria carteira (para a barra de progresso).
    const carteira = await (await pedir("/api/todogreen/driver-portal/ganhos", { token: joao.token })).json();
    expect(carteira.regra.metaMensal).toBe(3000);
  });

  it("sincronizar deriva o ganho das entregas já feitas (idempotente)", async () => {
    const r1 = await (await pedir("/api/todogreen/greenpay/sincronizar", { method: "POST", token: dona.token })).json();
    expect(r1.lancamentosCriados).toBeGreaterThan(0);
    // Reprocessar não duplica.
    const r2 = await (await pedir("/api/todogreen/greenpay/sincronizar", { method: "POST", token: dona.token })).json();
    expect(r2.lancamentosCriados).toBe(0);
  });

  it("a carteira do João soma entrega + km + bônus, com memória", async () => {
    const r = await (await pedir("/api/todogreen/driver-portal/ganhos", { token: joao.token })).json();
    expect(r.configurada).toBe(true);
    // J1 (20km, sem ocorrência): 8 + 18 + 3 = 29. J2 (10km, com ocorrência): 8 + 9 = 17.
    // Total = 46. J3 não entregue não paga.
    expect(r.resumo.saldos.total).toBe(46);
    const km = r.extrato.find((l) => l.tipo === "km");
    expect(km.memoria.base).toMatch(/dist/i);
    // Nenhum lançamento veio da viagem não entregue.
    expect(r.extrato.some((l) => l.operacaoId === "gpo-j3")).toBe(false);
  });

  it("o motorista só vê a própria carteira (Maria não vê o ganho do João)", async () => {
    const r = await (await pedir("/api/todogreen/driver-portal/ganhos", { token: maria.token })).json();
    // Maria: uma entrega de 5km sem ocorrência = 8 + 4.5 + 3 = 15.5.
    expect(r.resumo.saldos.total).toBe(15.5);
    expect(r.extrato.every((l) => l.operacaoId !== "gpo-j1")).toBe(true);
  });
});

describe("GreenPay — ajuste, aprovação e pagamento", () => {
  it("desconto manual reduz o saldo do motorista", async () => {
    const r = await (await pedir("/api/todogreen/greenpay/ajuste", {
      method: "POST", token: dona.token,
      body: { driverId: "gpd-joao", tipo: "desconto", valor: 6, observacao: "avaria" },
    })).json();
    expect(r.ok).toBe(true);
    expect(r.carteira.resumo.saldos.total).toBe(40); // 46 - 6
  });

  it("aprovar move pendente → aprovado; pagar move aprovado → pago", async () => {
    const ap = await (await pedir("/api/todogreen/greenpay/aprovar", {
      method: "POST", token: dona.token, body: { driverId: "gpd-joao" },
    })).json();
    expect(ap.aprovados).toBeGreaterThan(0);
    expect(ap.carteira.resumo.saldos.pendente).toBe(0);
    expect(ap.carteira.resumo.saldos.aprovado).toBe(40);

    const pg = await (await pedir("/api/todogreen/greenpay/pagar", {
      method: "POST", token: dona.token, body: { driverId: "gpd-joao" },
    })).json();
    expect(pg.pagos).toBeGreaterThan(0);
    expect(pg.settlementId).toBeTruthy();
    expect(pg.carteira.resumo.saldos.pago).toBe(40);
    expect(pg.carteira.resumo.saldos.aReceber).toBe(0);
    // Conexão SysPag dormente no teste: o repasse externo NÃO saiu — foi só
    // razão interno. Honesto: nunca finge que mandou o PIX.
    expect(pg.repasse.externo).toBe(false);
    expect(pg.repasse.motivo).toBe("conexao_nao_configurada");
  });

  it("pagar sem nada aprovado responde 409 (não cria lote vazio)", async () => {
    // A Maria tem ganho pendente, mas nada aprovado ainda.
    const r = await pedir("/api/todogreen/greenpay/pagar", {
      method: "POST", token: dona.token, body: { driverId: "gpd-maria" },
    });
    expect(r.status).toBe(409);
    const d = await r.json();
    expect(d.error).toMatch(/aprovado/i);
  });
});


describe("GreenPay fase 2 — contratos e conciliação", () => {
  it("só a gestão financeira acessa contratos recorrentes", async () => {
    const r = await pedir("/api/todogreen/greenpay/contratos", { token: joao.token });
    expect(r.status).toBe(403);
  });

  it("cria contrato recorrente e gera o mês de forma idempotente", async () => {
    const criado = await pedir("/api/todogreen/greenpay/contratos", {
      method: "POST",
      token: dona.token,
      body: { driverId: "gpd-maria", descricao: "Ajuda de custo", valor: 100, diaDoMes: 10 },
    });
    expect(criado.status).toBe(201);
    const corpo = await criado.json();
    expect(corpo.contratos.some((item) => item.driverId === "gpd-maria" && item.valor === 100)).toBe(true);

    const mes = new Date().toISOString().slice(0, 7);
    const primeira = await (await pedir("/api/todogreen/greenpay/gerar-contratos", {
      method: "POST", token: dona.token, body: { mes },
    })).json();
    expect(primeira.gerados).toBeGreaterThan(0);

    const segunda = await (await pedir("/api/todogreen/greenpay/gerar-contratos", {
      method: "POST", token: dona.token, body: { mes },
    })).json();
    expect(segunda.gerados).toBe(0);

    const carteira = await (await pedir("/api/todogreen/driver-portal/ganhos", { token: maria.token })).json();
    const contratos = carteira.extrato.filter((item) => item.tipo === "contrato");
    expect(contratos).toHaveLength(1);
    expect(contratos[0].valor).toBe(100);
  });

  it("concilia lote pago com retorno externo sem alterar o razão", async () => {
    const lista = await (await pedir("/api/todogreen/greenpay/repasses", { token: dona.token })).json();
    const lote = lista.repasses.find((item) => item.driverId === "gpd-joao");
    expect(lote).toBeTruthy();
    expect(lote.total).toBe(40);

    const conciliacao = await (await pedir("/api/todogreen/greenpay/conciliar", {
      method: "POST",
      token: dona.token,
      body: {
        retornos: [{
          referenciaExterna: lote.settlementId,
          valor: lote.total,
          idExterno: "syspag-test-1",
        }],
      },
    })).json();

    expect(conciliacao.resumo.conferidos).toBeGreaterThan(0);
    expect(conciliacao.resumo.divergentes).toBe(0);
    expect(conciliacao.resumo.semLancamento).toBe(0);

    const carteira = await (await pedir("/api/todogreen/driver-portal/ganhos", { token: joao.token })).json();
    expect(carteira.resumo.saldos.pago).toBe(40);
  });
});
