import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// O Todô deixou de só LER o CRM: ele move o funil. Estas ações escrevem no
// banco, então os testes vão pelo endpoint de verdade (body.executar), o mesmo
// caminho do clique em "Confirmar". O que não pode voltar:
//   • criar/avançar oportunidade de conta que não é da carteira de quem pede;
//   • o Todô FECHAR negócio pelo chat (ganha/perdida é da tela do CRM);
//   • mover a oportunidade errada quando a conta tem mais de uma aberta;
//   • número inventado (texto vira premissa 0 no forecast) — nasce em branco.

let n = 0;
const nextIp = () => `198.31.0.${(++n % 240) + 1}`;

async function sha256(valor) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
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

async function autorizar(usuario) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'admin', 'active', ?, '', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET role = excluded.role,
       permissions_json = excluded.permissions_json, status = 'active'`,
  ).bind(crypto.randomUUID(), usuario.email, JSON.stringify(["*"]), usuario.id, agora, agora).run();
}

async function criarConta(ownerId, id, nome) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id, tenant_id, workspace_owner_id, name, status, portal_enabled, fields_json,
        created_by, updated_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'ativo', 0, '{}', ?, ?, ?, ?)`,
  ).bind(id, ownerId, nome, ownerId, ownerId, agora, agora).run();
}

const pedir = (token, corpo) =>
  worker.fetch(
    new Request("https://app.test/api/todogreen/semente", {
      method: "POST",
      headers: { "cf-connecting-ip": nextIp(), authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );

const oportunidadesDe = async (ownerId, clientId) =>
  (await env.DB.prepare(
    `SELECT id, title, stage, monthly_value, distance_km, trips_per_month, vehicle_type, last_interaction_at, revision
       FROM todogreen_opportunities
      WHERE tenant_id='todogreen' AND workspace_owner_id=? AND client_id=? AND archived_at IS NULL
      ORDER BY created_at`,
  ).bind(ownerId, clientId).all()).results || [];

let vendedora;
let outra;

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();

  vendedora = await criarUsuario("opp-vend", "vend@opp.test");
  outra = await criarUsuario("opp-outra", "outra@opp.test");
  await autorizar(vendedora);
  await autorizar(outra);

  await criarConta(vendedora.id, "conta-dhl", "DHL Supply Chain");
  // Uma conta do MESMO nome no espaço da outra pessoa: prova que o escopo é por
  // espaço, não por nome.
  await criarConta(outra.id, "conta-dhl-outra", "DHL Supply Chain");
});

describe("Todô cria oportunidade", () => {
  it("abre a oportunidade em Prospecção, ligada à conta por id, com os números que recebeu", async () => {
    const r = await pedir(vendedora.token, {
      executar: {
        tipo: "criar_oportunidade",
        cliente: "DHL Supply Chain",
        titulo: "Transferência CD Cajamar",
        valorMensal: 42000,
        distanciaKm: 120,
        viagensMes: 22,
        tipoVeiculo: "elétrico",
      },
    });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.ok).toBe(true);
    expect(corpo.resumo).toContain("Prospecção");

    const opps = await oportunidadesDe(vendedora.id, "conta-dhl");
    expect(opps).toHaveLength(1);
    expect(opps[0].title).toBe("Transferência CD Cajamar");
    expect(opps[0].stage).toBe("Prospecção");
    expect(opps[0].monthly_value).toBe(42000);
    expect(opps[0].distance_km).toBe(120);
    expect(opps[0].trips_per_month).toBe(22);
    expect(opps[0].vehicle_type).toBe("elétrico");
  });

  it("número que veio como texto não vira premissa: entra 0 (em branco), não um chute", async () => {
    const r = await pedir(vendedora.token, {
      executar: { tipo: "criar_oportunidade", cliente: "DHL Supply Chain", titulo: "Sem números ainda", valorMensal: "não sei" },
    });
    expect(r.status).toBe(200);
    const opp = (await oportunidadesDe(vendedora.id, "conta-dhl")).find((o) => o.title === "Sem números ainda");
    expect(opp.monthly_value).toBe(0);
  });

  it("sem título não abre nada", async () => {
    const r = await pedir(vendedora.token, { executar: { tipo: "criar_oportunidade", cliente: "DHL Supply Chain", titulo: "ok" } });
    expect(r.status).toBe(400);
  });

  it("conta fora da carteira de quem pede: 404, não vaza que existe em outro espaço", async () => {
    // "outra" tem uma conta DHL no espaço dela; a vendedora vê a DELA, mas não a
    // da outra. Aqui a vendedora tenta uma conta que não é sua de jeito nenhum.
    const r = await pedir(vendedora.token, {
      executar: { tipo: "criar_oportunidade", cliente: "Conta Que Não Existe", titulo: "Fantasma" },
    });
    expect(r.status).toBe(404);
  });
});

describe("Todô avança oportunidade no funil", () => {
  beforeAll(async () => {
    await criarConta(vendedora.id, "conta-magalu", "Magalu");
    const agora = new Date().toISOString();
    // Uma oportunidade aberta, em Prospecção.
    await env.DB.prepare(
      `INSERT INTO todogreen_opportunities
        (id, tenant_id, workspace_owner_id, client_id, client_name, title, stage, monthly_value, contract_value,
         distance_km, trips_per_month, vehicle_type, owner_user_id, last_interaction_at, fields_json,
         revision, created_by, updated_by, created_at, updated_at)
       VALUES ('opp-magalu-1','todogreen',?,'conta-magalu','Magalu','Last mile Grande SP','Prospecção',0,0,0,0,'',?,NULL,
               '{}',1,?,?,?,?)`,
    ).bind(vendedora.id, vendedora.id, vendedora.id, vendedora.id, agora, agora).run();
  });

  it("move o estágio, carimba a última interação e diz de onde para onde foi", async () => {
    const r = await pedir(vendedora.token, {
      executar: { tipo: "avancar_oportunidade", cliente: "Magalu", estagio: "Negociação" },
    });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.resumo).toContain("Prospecção");
    expect(corpo.resumo).toContain("Negociação");
    const opp = (await oportunidadesDe(vendedora.id, "conta-magalu")).find((o) => o.id === "opp-magalu-1");
    expect(opp.stage).toBe("Negociação");
    expect(opp.last_interaction_at).toBeTruthy();
    expect(opp.revision).toBe(2);
  });

  it("aceita apelido de estágio em linguagem livre (proposta → Apresentação)", async () => {
    // Volta para Prospecção pela via de dados, e o Todô a leva para Apresentação
    // usando a palavra "proposta".
    await env.DB.prepare("UPDATE todogreen_opportunities SET stage='Prospecção' WHERE id='opp-magalu-1'").run();
    const r = await pedir(vendedora.token, {
      executar: { tipo: "avancar_oportunidade", cliente: "Magalu", estagio: "proposta" },
    });
    expect(r.status).toBe(200);
    const opp = (await oportunidadesDe(vendedora.id, "conta-magalu")).find((o) => o.id === "opp-magalu-1");
    expect(opp.stage).toBe("Apresentação");
  });

  it("NÃO fecha negócio pelo chat: ganha/perdida é da tela do CRM (400)", async () => {
    const ganha = await pedir(vendedora.token, {
      executar: { tipo: "avancar_oportunidade", cliente: "Magalu", estagio: "Fechada ganha" },
    });
    expect(ganha.status).toBe(400);
    expect((await ganha.json()).error).toMatch(/tela do CRM/);

    const perdida = await pedir(vendedora.token, {
      executar: { tipo: "avancar_oportunidade", cliente: "Magalu", estagio: "perdida" },
    });
    expect(perdida.status).toBe(400);
  });

  it("com mais de uma oportunidade aberta e sem título: pergunta em vez de mover a errada (409)", async () => {
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_opportunities
        (id, tenant_id, workspace_owner_id, client_id, client_name, title, stage, monthly_value, contract_value,
         distance_km, trips_per_month, vehicle_type, owner_user_id, last_interaction_at, fields_json,
         revision, created_by, updated_by, created_at, updated_at)
       VALUES ('opp-magalu-2','todogreen',?,'conta-magalu','Magalu','Dedicada RJ','Prospecção',0,0,0,0,'',?,NULL,
               '{}',1,?,?,?,?)`,
    ).bind(vendedora.id, vendedora.id, vendedora.id, vendedora.id, agora, agora).run();

    const semTitulo = await pedir(vendedora.token, {
      executar: { tipo: "avancar_oportunidade", cliente: "Magalu", estagio: "Negociação" },
    });
    expect(semTitulo.status).toBe(409);
    expect((await semTitulo.json()).error).toMatch(/mais de uma/i);

    // Com o título, resolve para a certa.
    const comTitulo = await pedir(vendedora.token, {
      executar: { tipo: "avancar_oportunidade", cliente: "Magalu", estagio: "Negociação", titulo: "Dedicada RJ" },
    });
    expect(comTitulo.status).toBe(200);
    const opp = (await oportunidadesDe(vendedora.id, "conta-magalu")).find((o) => o.id === "opp-magalu-2");
    expect(opp.stage).toBe("Negociação");
  });

  it("conta sem oportunidade aberta: 404 claro", async () => {
    const r = await pedir(vendedora.token, {
      executar: { tipo: "avancar_oportunidade", cliente: "DHL Supply Chain", estagio: "Negociação", titulo: "nada assim" },
    });
    expect(r.status).toBe(404);
  });

  it("outra pessoa não avança a oportunidade de um espaço que não é seu (404)", async () => {
    const r = await pedir(outra.token, {
      executar: { tipo: "avancar_oportunidade", cliente: "Magalu", estagio: "Negociação" },
    });
    // A "outra" não tem Magalu na carteira dela → conta não encontrada.
    expect(r.status).toBe(404);
    // E nada mudou no espaço da vendedora.
    const opp = (await oportunidadesDe(vendedora.id, "conta-magalu")).find((o) => o.id === "opp-magalu-1");
    expect(opp.stage).toBe("Apresentação");
  });
});
