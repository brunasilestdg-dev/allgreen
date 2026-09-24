import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import { NEGADO, resolveTodoGreenAccess } from "../worker/services/todogreen-access.js";

// O painel Acessos administra DUAS fontes de vínculo, não uma.
//
// `resolveTodoGreenAccess` aceita `todogreen_access_emails` OU `tenant_users`.
// Enquanto a tela escrevia só na primeira, conceder não ligava a pessoa ao
// espaço da empresa (ERP vazio) e revogar não tirava quem tinha a segunda
// (ex-funcionário lendo a tesouraria depois do desligamento).
//
// Estes testes existem porque nenhuma tela do produto mostra `tenant_users`:
// a divergência era invisível olhando o app, e só aparecia no banco.

const sha256 = async (valor) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

let n = 0;
const pedir = (caminho, { method = "GET", token, body } = {}) =>
  worker.fetch(new Request(`https://app.test${caminho}`, {
    method,
    headers: {
      "cf-connecting-ip": `198.51.101.${(++n % 240) + 1}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, { waitUntil() {}, passThroughOnException() {} });

const criarConta = async (id, email) => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)",
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)",
  ).bind(`ses-${id}`, id, await sha256(`tok-${id}`), agora).run();
  return `tok-${id}`;
};

let tokenDona;
let tokenNovo;
let tokenDesligado;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id,slug,name,segment,status,theme_json,created_at,updated_at)
     VALUES ('todogreen','todogreen','To Do Green','logistica-sustentavel','active','{}',?,?)`,
  ).bind(agora, agora).run();

  tokenDona = await criarConta("vin-dona", "vin-dona@todogreen.test");
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id,tenant_id,email,role,status,permissions_json,note,created_by,workspace_owner_id,created_at,updated_at)
     VALUES (?,'todogreen','vin-dona@todogreen.test','admin','active','["*"]','','vin-dona','vin-dona',?,?)`,
  ).bind(crypto.randomUUID(), agora, agora).run();
  await env.DB.prepare(
    `INSERT INTO tenant_users
       (id,tenant_id,workspace_owner_id,user_id,role,status,permissions_json,created_at,updated_at)
     VALUES (?,'todogreen','vin-dona','vin-dona','admin','active','["*"]',?,?)`,
  ).bind(crypto.randomUUID(), agora, agora).run();

  // Uma conta bancária REAL no espaço da dona. É o que prova se a pessoa está
  // dentro do espaço da empresa ou num espaço próprio e vazio.
  await env.DB.prepare(
    `INSERT INTO todogreen_treasury_accounts
       (id,tenant_id,workspace_owner_id,name,kind,bank_code,branch,account_number,pix_key,
        opening_balance,opening_date,status,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('vin-cc','todogreen','vin-dona','Conta da empresa','corrente','341','1','2','',
        999999,'2026-01-01','ativa','{}',1,'vin-dona','vin-dona',?,?)`,
  ).bind(agora, agora).run();

  tokenNovo = await criarConta("vin-novo", "financeiro.novo@todogreen.test");

  // O desligado é quem trabalhava de verdade: tem as DUAS fontes de vínculo.
  tokenDesligado = await criarConta("vin-desl", "desligado@todogreen.test");
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id,tenant_id,email,role,status,permissions_json,note,created_by,workspace_owner_id,created_at,updated_at)
     VALUES (?,'todogreen','desligado@todogreen.test','financeiro','active',
        '["read","finance:manage"]','','vin-dona','vin-dona',?,?)`,
  ).bind(crypto.randomUUID(), agora, agora).run();
  await env.DB.prepare(
    `INSERT INTO tenant_users
       (id,tenant_id,workspace_owner_id,user_id,role,status,permissions_json,created_at,updated_at)
     VALUES (?,'todogreen','vin-dona','vin-desl','financeiro','active','["read","finance:manage"]',?,?)`,
  ).bind(crypto.randomUUID(), agora, agora).run();
});

describe("conceder acesso liga a pessoa ao espaço da empresa", () => {
  it("aceita seleção explícita de funcionalidades e descarta permissão inventada", async () => {
    const resposta = await pedir("/api/todogreen/access-list", {
      method: "POST",
      token: tokenDona,
      body: {
        email: "acesso-granular@todogreen.test",
        role: "vendedor",
        permissions: ["read", "market:read", "market:research", "permissao:inventada"],
      },
    });
    expect(resposta.status).toBe(201);
    expect((await resposta.json()).permissions).toEqual(["read", "market:read", "market:research"]);

    const lista = await (await pedir("/api/todogreen/access-list", { token: tokenDona })).json();
    expect(lista.emails.find((item) => item.email === "acesso-granular@todogreen.test")?.permissions)
      .toEqual(["read", "market:read", "market:research"]);
  });

  it("cria o vínculo e o ERP abre com os dados da empresa, não vazio", async () => {
    const concessao = await pedir("/api/todogreen/access-list", {
      method: "POST",
      token: tokenDona,
      body: { email: "financeiro.novo@todogreen.test", role: "financeiro" },
    });
    expect(concessao.status).toBe(201);
    expect((await concessao.json()).vinculadoAoEspaco).toBe(true);

    const vinculo = await env.DB.prepare(
      "SELECT workspace_owner_id, status FROM tenant_users WHERE tenant_id='todogreen' AND user_id='vin-novo'",
    ).first();
    expect(vinculo?.workspace_owner_id).toBe("vin-dona");
    expect(vinculo?.status).toBe("active");

    // A prova que interessa não é a linha no banco: é o ERP abrir com dado.
    const acesso = await (await pedir("/api/todogreen/access", { token: tokenNovo })).json();
    expect(acesso.ownerId).toBe("vin-dona");
    const saldos = await (await pedir("/api/todogreen/treasury/saldos", { token: tokenNovo })).json();
    expect(saldos.contas.map((conta) => conta.name)).toContain("Conta da empresa");
  });

  it("quem ainda não tem conta é liberado com o espaço gravado na própria liberação", async () => {
    const resposta = await pedir("/api/todogreen/access-list", {
      method: "POST",
      token: tokenDona,
      body: { email: "vai-criar-conta@todogreen.test", role: "operacoes" },
    });
    const corpo = await resposta.json();
    expect(corpo.aguardandoCadastro).toBe(true);
    expect(corpo.vinculadoAoEspaco).toBe(false);

    const liberacao = await env.DB.prepare(
      "SELECT workspace_owner_id FROM todogreen_access_emails WHERE tenant_id='todogreen' AND email='vai-criar-conta@todogreen.test'",
    ).first();
    expect(liberacao?.workspace_owner_id).toBe("vin-dona");

    // Cria a conta depois — como acontece de verdade — e o primeiro acesso já
    // cai no espaço da empresa.
    const token = await criarConta("vin-tardio", "vai-criar-conta@todogreen.test");
    const acesso = await (await pedir("/api/todogreen/access", { token })).json();
    expect(acesso.ownerId).toBe("vin-dona");
  });
});

describe("revogar acesso revoga de verdade", () => {
  it("encerra as duas fontes de vínculo, não só a liberação por e-mail", async () => {
    const antes = await pedir("/api/todogreen/treasury/saldos", { token: tokenDesligado });
    expect(antes.status).toBe(200);
    expect((await antes.json()).contas.length).toBeGreaterThan(0);

    const revogacao = await pedir(
      "/api/todogreen/access-list?email=desligado@todogreen.test",
      { method: "DELETE", token: tokenDona },
    );
    expect(revogacao.status).toBe(200);

    const vinculo = await env.DB.prepare(
      "SELECT status FROM tenant_users WHERE tenant_id='todogreen' AND user_id='vin-desl'",
    ).first();
    expect(vinculo?.status).toBe("revoked");

    // O que a titular espera de "remover acesso": a porta fecha.
    const depois = await pedir("/api/todogreen/treasury/saldos", { token: tokenDesligado });
    expect(depois.status).toBe(403);
  });
});

// AG-SEP-04 (Bloco 3): a negação de acesso não pode ocorrer ANTES de considerar
// todos os vínculos válidos aplicáveis, e cada vínculo por e-mail (motorista,
// colaborador, vendedor) concede o seu papel MÍNIMO — nunca "auditor" (leitura
// ampla) por acidente e JAMAIS "admin". "admin" continua vindo só do e-mail
// listado em TODOGREEN_ADMIN_EMAILS.
describe("AG-SEP-04: ordem da negação e menor privilégio por tipo de vínculo", () => {
  beforeAll(async () => {
    const agora = new Date().toISOString();
    // Motorista puro: só o cadastro de motorista, sem access_emails/tenant_users.
    await env.DB.prepare(
      `INSERT INTO todogreen_drivers
         (id,tenant_id,workspace_owner_id,full_name,user_email,status,created_by,updated_by,created_at,updated_at)
       VALUES ('sep4-drv','todogreen','vin-dona','Motorista Puro','motorista.puro@todogreen.test','active','vin-dona','vin-dona',?,?)`,
    ).bind(agora, agora).run();
    // Colaborador puro: só o cadastro de pessoal (work_email).
    await env.DB.prepare(
      `INSERT INTO todogreen_employees
         (id,tenant_id,workspace_owner_id,full_name,work_email,status,created_by,updated_by,created_at,updated_at)
       VALUES ('sep4-emp','todogreen','vin-dona','Colaborador Puro','colab.puro@todogreen.test','active','vin-dona','vin-dona',?,?)`,
    ).bind(agora, agora).run();
    // Vendedor puro: só a carteira atribuída (cliente + assignment ativo).
    await env.DB.prepare(
      `INSERT INTO todogreen_clients
         (id,tenant_id,workspace_owner_id,name,created_by,updated_by,created_at,updated_at)
       VALUES ('sep4-cli','todogreen','vin-dona','Cliente Carteira','vin-dona','vin-dona',?,?)`,
    ).bind(agora, agora).run();
    await env.DB.prepare(
      `INSERT INTO todogreen_client_assignments
         (id,tenant_id,client_id,seller_email,status,assigned_by,created_at,updated_at)
       VALUES ('sep4-asg','todogreen','sep4-cli','vendedor.puro@todogreen.test','active','vin-dona',?,?)`,
    ).bind(agora, agora).run();
  });

  it("motorista puro é ADMITIDO (não negado) e resolve como 'motorista' — sem read, sem admin", async () => {
    const { access, motivo } = await resolveTodoGreenAccess(
      env, { id: "sep4-u-drv", email: "motorista.puro@todogreen.test" }, null,
    );
    expect(motivo).toBeNull();
    expect(access?.role).toBe("motorista");
    expect(access?.ownerId).toBe("vin-dona");
    expect(access?.viaAdministradorGlobal).toBe(false);
    expect(access?.permissions).not.toContain("*");
    expect(access?.permissions).not.toContain("read");
    expect(access?.permissions).toEqual(["driver:self", "driver:event"]);
  });

  it("colaborador puro resolve como 'colaborador' (só o portal, sem read)", async () => {
    const { access, motivo } = await resolveTodoGreenAccess(
      env, { id: "sep4-u-emp", email: "colab.puro@todogreen.test" }, null,
    );
    expect(motivo).toBeNull();
    expect(access?.role).toBe("colaborador");
    expect(access?.ownerId).toBe("vin-dona");
    expect(access?.permissions).toEqual(["colaborador:self"]);
  });

  it("vendedor puro (carteira) resolve como 'vendedor' no espaço do cliente", async () => {
    const { access, motivo } = await resolveTodoGreenAccess(
      env, { id: "sep4-u-vend", email: "vendedor.puro@todogreen.test" }, null,
    );
    expect(motivo).toBeNull();
    expect(access?.role).toBe("vendedor");
    expect(access?.ownerId).toBe("vin-dona");
  });

  it("conta sem NENHUM vínculo continua negada (sem-vinculo)", async () => {
    const { access, motivo } = await resolveTodoGreenAccess(
      env, { id: "sep4-u-nada", email: "sem.vinculo.sep4@todogreen.test" }, null,
    );
    expect(access).toBeNull();
    expect(motivo).toBe(NEGADO.semVinculo);
  });

  it("liberação/tenant explícitos vencem o vínculo por e-mail (um motorista com papel concedido NÃO é rebaixado, mas também não vira admin sozinho)", async () => {
    const agora = new Date().toISOString();
    // Mesmo e-mail do motorista, agora com liberação explícita de 'operacoes'.
    await env.DB.prepare(
      `INSERT INTO todogreen_access_emails
         (id,tenant_id,email,role,status,permissions_json,note,created_by,workspace_owner_id,created_at,updated_at)
       VALUES ('sep4-ae','todogreen','motorista.puro@todogreen.test','operacoes','active',
         '["read","operations:manage"]','','vin-dona','vin-dona',?,?)`,
    ).bind(agora, agora).run();
    const { access } = await resolveTodoGreenAccess(
      env, { id: "sep4-u-drv", email: "motorista.puro@todogreen.test" }, null,
    );
    expect(access?.role).toBe("operacoes");
    expect(access?.role).not.toBe("admin");
  });
});

// O administrador global (TODOGREEN_ADMIN_EMAILS) resolve como "admin" com "*".
// Isso não pode apagar um perfil de desenvolvedor dado a ele explicitamente:
// a Central de Integrações ignora "*"/admin e só abre com `dev:access`.
describe("administrador global com perfil de desenvolvedor explícito", () => {
  const envAdmin = () => ({ ...env, TODOGREEN_ADMIN_EMAILS: "dev.admin@todogreen.test,so.admin@todogreen.test" });

  beforeAll(async () => {
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_access_emails
         (id,tenant_id,email,role,status,permissions_json,note,created_by,workspace_owner_id,created_at,updated_at)
       VALUES (?,'todogreen','dev.admin@todogreen.test','desenvolvedor','active','["*","dev:access"]','','vin-dona','vin-dona',?,?)`,
    ).bind(crypto.randomUUID(), agora, agora).run();
  });

  it("mantém `dev:access` quando a liberação dele é de desenvolvedor", async () => {
    const { access } = await resolveTodoGreenAccess(envAdmin(), { id: "dev-admin", email: "dev.admin@todogreen.test" }, null);
    expect(access?.role).toBe("admin");
    expect(access?.permissions).toEqual(["*", "dev:access"]);
  });

  it("admin global sem perfil de desenvolvedor continua sem `dev:access`", async () => {
    const { access } = await resolveTodoGreenAccess(envAdmin(), { id: "so-admin", email: "so.admin@todogreen.test" }, null);
    expect(access?.role).toBe("admin");
    expect(access?.permissions).toEqual(["*"]);
  });
});
