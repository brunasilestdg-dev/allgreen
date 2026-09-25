import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// L8 da matriz de prontidão: o colaborador PJ/CLT (`colaborador:self`, sem
// "read") lia saldos e extrato da tesouraria, títulos, fila de faturamento,
// compras e estoque do espaço — os GET só conferiam o vínculo, e o corte por
// papel das rotas internas barrava apenas o motorista. O colaborador só alcança
// o próprio portal, como o motorista; os papéis internos seguem lendo.
const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
let n = 0;
const pedir = (caminho, { method = "GET", token } = {}) =>
  worker.fetch(new Request(`https://app.test${caminho}`, {
    method,
    headers: {
      "cf-connecting-ip": `198.51.102.${(++n % 240) + 1}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
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
const autorizar = async (email, role, permissoes, espaco = "") => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id,tenant_id,workspace_owner_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,?,'active',?,'','lp-dono',?,?)`,
  ).bind(crypto.randomUUID(), espaco, email, role, permissoes, agora, agora).run();
};

// O que é da empresa, e não do colaborador: dinheiro, cobrança, compras,
// estoque e os cadastros com dado pessoal.
const ROTAS_INTERNAS = [
  "/api/todogreen/treasury/saldos",
  "/api/todogreen/treasury/extrato",
  "/api/todogreen/transactions/titles?kind=receivable",
  "/api/todogreen/transactions/billing-items",
  "/api/todogreen/transactions/service-orders",
  "/api/todogreen/transactions/costs",
  "/api/todogreen/purchasing/pedidos",
  "/api/todogreen/purchasing/requisicoes",
  "/api/todogreen/stock/saldos",
  "/api/todogreen/master-data/bank-accounts",
];

let dona, colaborador, financeiro, vendedor, auditor;
beforeAll(async () => {
  dona = await criarUsuario("lp-dono", "dona@lp.test");
  await autorizar(dona.email, "admin", '["*"]');
  colaborador = await criarUsuario("lp-colab", "colab@lp.test");
  await autorizar(colaborador.email, "colaborador", '["colaborador:self"]');
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_employees
       (id,tenant_id,workspace_owner_id,employee_code,full_name,document,employment_type,
        job_title,work_email,status,salario_base,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES ('lp-emp','todogreen','lp-dono','LP-EMP','Prestadora LP','','pj','Prestadora',?,'active',3000,'{}',1,'lp-dono','lp-dono',?,?)`,
  ).bind(colaborador.email, agora, agora).run();
  financeiro = await criarUsuario("lp-fin", "fin@lp.test");
  await autorizar(financeiro.email, "financeiro", JSON.stringify(["read", "finance:manage", "purchase:manage", "fiscal:manage"]), "lp-dono");
  vendedor = await criarUsuario("lp-vend", "vend@lp.test");
  await autorizar(vendedor.email, "vendedor", JSON.stringify(["read", "crm:manage", "proposal:manage"]), "lp-dono");
  auditor = await criarUsuario("lp-aud", "aud@lp.test");
  await autorizar(auditor.email, "auditor", JSON.stringify(["read", "audit:read"]), "lp-dono");
  // Um título a receber no espaço: o que o colaborador não pode ver.
  await env.DB.prepare(
    `INSERT INTO todogreen_financial_titles
       (id,tenant_id,workspace_owner_id,number,kind,client_id,contract_id,billing_run_id,invoice_id,
        competence_date,issue_date,due_date,original_amount,open_amount,status,created_by,updated_by,created_at,updated_at)
     VALUES ('lp-titulo','todogreen','lp-dono','REC-LP','receivable','cliente-lp','','','',
        '2026-09-01','2026-09-01','2026-10-01',1000,1000,'open','lp-dono','lp-dono',?,?)`,
  ).bind(agora, agora).run();
});

describe("o colaborador só alcança o próprio portal", () => {
  it("tesouraria, transações, compras, estoque e cadastros respondem 403 ao colaborador", async () => {
    for (const rota of ROTAS_INTERNAS) {
      const resposta = await pedir(rota, { token: colaborador.token });
      expect({ rota, status: resposta.status }).toEqual({ rota, status: 403 });
      expect(JSON.stringify(await resposta.json())).not.toContain("REC-LP");
    }
  });

  it("o portal do colaborador continua abrindo para ele", async () => {
    const sessao = await pedir("/api/todogreen/employee-portal/sessao", { token: colaborador.token });
    expect(sessao.status).toBe(200);
    expect((await sessao.json()).vinculado).toBe(true);
  });

  it("papel interno sem permissão financeira não lê tesouraria, títulos nem custos", async () => {
    // A mesma régua do razão (coleção `financial`): quem não abre as telas do
    // Financeiro não lê o dinheiro da empresa pela API.
    for (const rota of ["/api/todogreen/treasury/saldos", "/api/todogreen/transactions/titles?kind=receivable", "/api/todogreen/transactions/costs"]) {
      const resposta = await pedir(rota, { token: vendedor.token });
      expect({ rota, status: resposta.status }).toEqual({ rota, status: 403 });
    }
    // OS e requisições seguem legíveis: a operação acompanha as ordens e
    // qualquer área requisita e acompanha a própria requisição.
    expect((await pedir("/api/todogreen/transactions/service-orders", { token: vendedor.token })).status).toBe(200);
    expect((await pedir("/api/todogreen/purchasing/requisicoes", { token: vendedor.token })).status).toBe(200);
  });

  it("o auditor lê a tesouraria e os títulos, como lê o razão", async () => {
    expect((await pedir("/api/todogreen/treasury/saldos", { token: auditor.token })).status).toBe(200);
    expect((await pedir("/api/todogreen/transactions/titles?kind=receivable", { token: auditor.token })).status).toBe(200);
  });

  it("o financeiro do espaço continua lendo tesouraria e títulos", async () => {
    const saldos = await pedir("/api/todogreen/treasury/saldos", { token: financeiro.token });
    expect(saldos.status).toBe(200);
    const titulos = await pedir("/api/todogreen/transactions/titles?kind=receivable", { token: financeiro.token });
    expect(titulos.status).toBe(200);
    expect((await titulos.json()).records.map((titulo) => titulo.number)).toContain("REC-LP");
  });
});
