import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// O desenho da conta — abrangência, modelo operacional, HC por etapa, régua de
// SLA/BSC, integração, faturamento, ocorrência e RASCI — convive com o gate
// técnico sem se misturar a ele. Estes testes travam as três coisas que
// tornariam o documento inútil:
//
// 1. o briefing bloquear a implantação (viraria campo preenchido com "n/a");
// 2. campo que ninguém declarou entrar no `fields_json`;
// 3. salvar um bloco apagar os outros.

const sha256 = async (valor) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

let n = 0;
const pedir = (caminho, { method = "GET", token, body } = {}) =>
  worker.fetch(new Request(`https://app.test${caminho}`, {
    method,
    headers: {
      "cf-connecting-ip": `198.51.102.${(++n % 240) + 1}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, { waitUntil() {}, passThroughOnException() {} });

let token;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id,slug,name,segment,status,theme_json,created_at,updated_at)
     VALUES ('todogreen','todogreen','To Do Green','logistica-sustentavel','active','{}',?,?)`,
  ).bind(agora, agora).run();
  await env.DB.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES ('bf-dona','Dona','bf-dona@todogreen.test','h','s',?)",
  ).bind(agora).run();
  await env.DB.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES ('bf-ses','bf-dona',?, '2099-01-01T00:00:00.000Z',?)",
  ).bind(await sha256("tok-bf"), agora).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id,tenant_id,email,role,status,permissions_json,note,created_by,workspace_owner_id,created_at,updated_at)
     VALUES (?,'todogreen','bf-dona@todogreen.test','admin','active','["*"]','','bf-dona','bf-dona',?,?)`,
  ).bind(crypto.randomUUID(), agora, agora).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id,tenant_id,workspace_owner_id,name,status,portal_enabled,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('bf-cli','todogreen','bf-dona','Embarcador Teste','implantacao',0,'{}',1,'bf-dona','bf-dona',?,?)`,
  ).bind(agora, agora).run();
  token = "tok-bf";
});

const snapshot = async () =>
  (await pedir("/api/todogreen/client-activation?clientId=bf-cli", { token })).json();

describe("o desenho da conta", () => {
  it("começa vazio, com 0% e a lista do que falta", async () => {
    const dados = await snapshot();
    expect(dados.briefing.avaliacao.percentual).toBe(0);
    expect(dados.briefing.avaliacao.faltando.length).toBeGreaterThan(20);
    // Cada pendência diz de qual bloco veio.
    expect(dados.briefing.avaliacao.blocos.map((bloco) => bloco.id)).toContain("faturamento");
  });

  it("salva abrangência e faturamento, e mede por bloco", async () => {
    const antes = await snapshot();
    const resposta = await pedir("/api/todogreen/client-activation?clientId=bf-cli", {
      method: "POST", token,
      body: {
        action: "briefing",
        revision: antes.client.revision,
        briefing: {
          cidades: "Santos, Guarujá, Cubatão",
          bases: "CD Cubatão",
          volumeDia: 900,
          motoristasDia: 12,
          documento: "CT-e",
          modeloPagamento: "Por entrega",
          preco: "R$ 18,50 por entrega",
          prazoPagamento: "30 dias após fechamento quinzenal",
          conemb: false,
          ticketMedio: 18.5,
          margem: 22,
        },
      },
    });
    expect(resposta.status).toBe(200);
    const dados = await resposta.json();

    const bloco = (id) => dados.briefing.avaliacao.blocos.find((item) => item.id === id);
    expect(bloco("abrangencia").completo).toBe(true);
    expect(bloco("faturamento").completo).toBe(true);
    expect(bloco("sistema").completo).toBe(false);
    expect(dados.briefing.valores.cidades).toEqual(["Santos", "Guarujá", "Cubatão"]);

    // O resumo comercial sai do próprio briefing: é a primeira pergunta da
    // diretoria e não deveria exigir abrir outra tela.
    expect(dados.briefing.comercial.ticketMedio).toBe(18.5);
    expect(dados.briefing.comercial.margemPercentual).toBe(22);
    expect(dados.briefing.comercial.receitaMensalEstimada).toBe(366300);
    expect(dados.briefing.comercial.cidades).toBe(3);
  });

  it("salvar um bloco não apaga os outros", async () => {
    const antes = await snapshot();
    const resposta = await pedir("/api/todogreen/client-activation?clientId=bf-cli", {
      method: "POST", token,
      body: {
        action: "briefing",
        revision: antes.client.revision,
        briefing: { responsavel: "Ana Souza", aprovador: "Diretoria comercial" },
      },
    });
    const dados = await resposta.json();
    // A tela salva um bloco por vez; trocar o objeto inteiro apagaria o resto.
    expect(dados.briefing.valores.cidades).toEqual(["Santos", "Guarujá", "Cubatão"]);
    expect(dados.briefing.valores.responsavel).toBe("Ana Souza");
  });

  it("recusa campo que ninguém declarou — fields_json não é depósito", async () => {
    const antes = await snapshot();
    await pedir("/api/todogreen/client-activation?clientId=bf-cli", {
      method: "POST", token,
      body: {
        action: "briefing",
        revision: antes.client.revision,
        briefing: { insucesso: "Duas tentativas, depois devolve", custoInternoPorKm: 4.2 },
      },
    });
    const linha = await env.DB.prepare("SELECT fields_json FROM todogreen_clients WHERE id='bf-cli'").first();
    expect(linha.fields_json).toContain("Duas tentativas");
    expect(linha.fields_json).not.toContain("custoInternoPorKm");
  });

  it("respeita a revisão: dois editores não se sobrescrevem em silêncio", async () => {
    const resposta = await pedir("/api/todogreen/client-activation?clientId=bf-cli", {
      method: "POST", token,
      body: { action: "briefing", revision: 1, briefing: { horarios: "corte 14h" } },
    });
    expect(resposta.status).toBe(409);
    expect((await resposta.json()).error).toMatch(/Recarregue/i);
  });

  it("NÃO bloqueia a implantação: as duas leituras convivem", async () => {
    const dados = await snapshot();
    // O gate técnico segue com as próprias pendências (contrato, portal…),
    // independentes do quanto do briefing está preenchido.
    expect(dados.readiness.ready).toBe(false);
    expect(dados.readiness.missing).toContain("contract");
    expect(dados.briefing.avaliacao.percentual).toBeGreaterThan(0);
    // E são objetos separados: nenhum campo do briefing entrou no readiness.
    expect(dados.readiness).not.toHaveProperty("briefing");
  });

  it("a alteração fica na auditoria da vertical", async () => {
    const linha = await env.DB.prepare(
      "SELECT action, details FROM todogreen_audit_events WHERE resource_id='bf-cli' AND action='client_briefing_updated' ORDER BY created_at DESC LIMIT 1",
    ).first();
    expect(linha).toBeTruthy();
    expect(linha.details).toMatch(/% preenchido/);
  });
});
