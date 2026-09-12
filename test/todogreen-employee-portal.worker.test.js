import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Portal do colaborador: as perguntas de segurança e honestidade.
// (1) Cada pessoa vê só OS PRÓPRIOS dados (recorte pelo e-mail da sessão).
// (2) PJ imputa a própria NF + PIX; CLT NÃO edita (só lê) — banco é do RH.
// (3) A NF é conferida contra o esperado (salário/contrato), ajustável.
// (4) Aprovar cria conta a pagar; pagar dispara o repasse (SysPag dormente) e,
//     só então, marca paga. Gestão é do RH/financeiro.

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
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
     VALUES (?,'todogreen',?,?,'active',?,'','ep-dono',?,?)`,
  ).bind(crypto.randomUUID(), email, role, permissoes, agora, agora).run();
};

const criarColaborador = async (id, nome, email, tipo, salario) => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_employees
       (id,tenant_id,workspace_owner_id,employee_code,full_name,document,employment_type,
        job_title,work_email,status,salario_base,fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,'todogreen','ep-dono',?,?,'',?,'Prestador',?,'active',?,'{}',1,'ep-dono','ep-dono',?,?)`,
  ).bind(id, id.toUpperCase(), nome, tipo, email, salario, agora, agora).run();
};

let dona, pjA, pjB, clt;

beforeAll(async () => {
  dona = await criarUsuario("ep-dono", "dona@ep.test");
  await autorizar(dona.email, "admin", '["*"]');
  pjA = await criarUsuario("ep-pja", "pja@ep.test");
  pjB = await criarUsuario("ep-pjb", "pjb@ep.test");
  clt = await criarUsuario("ep-clt", "clt@ep.test");
  for (const p of [pjA, pjB, clt]) await autorizar(p.email, "colaborador", '["colaborador:self"]');

  await criarColaborador("emp-pja", "Prestadora A", pjA.email, "pj", 3000);
  await criarColaborador("emp-pjb", "Prestador B", pjB.email, "pj", 5000);
  await criarColaborador("emp-clt", "Colaborador CLT", clt.email, "employee", 4000);
});

describe("sessão do colaborador", () => {
  it("PJ resolve pelo e-mail, mostra o esperado e pode imputar", async () => {
    const r = await (await pedir("/api/todogreen/employee-portal/sessao", { token: pjA.token })).json();
    expect(r.vinculado).toBe(true);
    expect(r.colaborador.tipo).toBe("pj");
    expect(r.colaborador.valorEsperado).toBe(3000);
    expect(r.colaborador.podeImputarNota).toBe(true);
    expect(r.colaborador.podeInformarPix).toBe(true);
  });

  it("CLT vê os próprios dados mas NÃO imputa nem informa PIX", async () => {
    const r = await (await pedir("/api/todogreen/employee-portal/sessao", { token: clt.token })).json();
    expect(r.vinculado).toBe(true);
    expect(r.colaborador.tipo).toBe("clt");
    expect(r.colaborador.podeImputarNota).toBe(false);
    expect(r.colaborador.podeInformarPix).toBe(false);
    // Esperado/salário não vaza para o CLT nesta tela (é do RH).
    expect(r.colaborador.valorEsperado).toBeNull();
  });

  it("sem cadastro ligado, avisa em vez de mostrar dado alheio", async () => {
    const r = await (await pedir("/api/todogreen/employee-portal/sessao", { token: dona.token })).json();
    expect(r.vinculado).toBe(false);
    expect(r.aviso).toMatch(/cadastro de colaborador/i);
  });
});

describe("PJ informa a própria chave PIX", () => {
  it("grava (validada) e a sessão passa a mostrá-la", async () => {
    const r = await pedir("/api/todogreen/employee-portal/pix", {
      method: "POST", token: pjA.token, body: { tipo: "email", chave: "PJA@Pix.com" },
    });
    expect(r.status).toBe(200);
    expect((await r.json()).pix.chave).toBe("pja@pix.com"); // normalizada
    const s = await (await pedir("/api/todogreen/employee-portal/sessao", { token: pjA.token })).json();
    expect(s.colaborador.pix.chave).toBe("pja@pix.com");
    // Gravou como conta bancária do colaborador (owner_type='employee').
    const conta = await env.DB.prepare(
      "SELECT pix_key FROM todogreen_bank_accounts WHERE owner_type='employee' AND owner_id='emp-pja'",
    ).first();
    expect(conta.pix_key).toBe("pja@pix.com");
  });

  it("CLT não grava PIX aqui (é do RH) — 403", async () => {
    const r = await pedir("/api/todogreen/employee-portal/pix", {
      method: "POST", token: clt.token, body: { tipo: "email", chave: "clt@pix.com" },
    });
    expect(r.status).toBe(403);
  });
});

describe("PJ imputa a nota e a conferência sinaliza", () => {
  it("nota que bate com o esperado entra em análise conferindo", async () => {
    const r = await pedir("/api/todogreen/employee-portal/nota", {
      method: "POST", token: pjA.token, body: { numero: "NF-100", competencia: "2026-09", valor: 3000 },
    });
    expect(r.status).toBe(201);
    const s = await (await pedir("/api/todogreen/employee-portal/sessao", { token: pjA.token })).json();
    const nota = s.notas.find((x) => x.numero === "NF-100");
    expect(nota.status).toBe("em_analise");
    expect(nota.confere).toBe(true);
    expect(nota.situacaoConferencia).toBe("confere");
  });

  it("nota abaixo do esperado é aceita mas sinalizada", async () => {
    const r = await pedir("/api/todogreen/employee-portal/nota", {
      method: "POST", token: pjB.token, body: { numero: "NF-200", competencia: "2026-09", valor: 4000 },
    });
    expect(r.status).toBe(201);
    const s = await (await pedir("/api/todogreen/employee-portal/sessao", { token: pjB.token })).json();
    const nota = s.notas.find((x) => x.numero === "NF-200");
    expect(nota.confere).toBe(false);       // esperado 5000, nota 4000
    expect(nota.situacaoConferencia).toBe("abaixo");
    expect(nota.diferenca).toBe(-1000);
  });

  it("nota inválida (sem número) é recusada (400)", async () => {
    const r = await pedir("/api/todogreen/employee-portal/nota", {
      method: "POST", token: pjA.token, body: { numero: "", competencia: "2026-09", valor: 10 },
    });
    expect(r.status).toBe(400);
  });

  it("cada PJ só vê as próprias notas", async () => {
    const sA = await (await pedir("/api/todogreen/employee-portal/sessao", { token: pjA.token })).json();
    expect(sA.notas.every((x) => x.numero !== "NF-200")).toBe(true);
  });
});

describe("gestão do RH/financeiro: analisar, ajustar, aprovar, pagar", () => {
  it("colaborador comum não alcança a gestão (403)", async () => {
    const r = await pedir("/api/todogreen/employee-portal/gestao/notas", { token: pjA.token });
    expect(r.status).toBe(403);
  });

  it("gestor lista, ajusta o esperado e aprova → nasce a conta a pagar", async () => {
    const lista = await (await pedir("/api/todogreen/employee-portal/gestao/notas", { token: dona.token })).json();
    const nf200 = lista.notas.find((x) => x.numero === "NF-200");
    expect(nf200).toBeTruthy();

    // Ajusta o esperado da NF-200 para 4000 (ex.: entrou no meio do mês) → passa a conferir.
    const aj = await pedir(`/api/todogreen/employee-portal/gestao/notas/${nf200.id}/ajustar`, {
      method: "POST", token: dona.token, body: { valorEsperado: 4000 },
    });
    expect(aj.status).toBe(200);

    const ap = await pedir(`/api/todogreen/employee-portal/gestao/notas/${nf200.id}/aprovar`, {
      method: "POST", token: dona.token,
    });
    expect(ap.status).toBe(200);
    const entryId = (await ap.json()).financialEntryId;
    expect(entryId).toBeTruthy();

    // A conta a pagar existe no razão, como custo, pendente.
    const conta = await env.DB.prepare(
      "SELECT kind, amount, invoice_status FROM todogreen_financial_entries WHERE id=?",
    ).bind(entryId).first();
    expect(conta.kind).toBe("cost");
    expect(conta.amount).toBe(4000);
    expect(conta.invoice_status).toBe("pending");
  });

  it("pagar dispara o repasse (SysPag dormente) e quita a conta a pagar", async () => {
    const lista = await (await pedir("/api/todogreen/employee-portal/gestao/notas", { token: dona.token })).json();
    const nf200 = lista.notas.find((x) => x.numero === "NF-200");
    expect(nf200.status).toBe("aprovada");

    const pg = await pedir(`/api/todogreen/employee-portal/gestao/notas/${nf200.id}/pagar`, {
      method: "POST", token: dona.token,
    });
    expect(pg.status).toBe(200);
    const d = await pg.json();
    expect(d.settlementId).toBeTruthy();
    // Conexão dormente: o repasse externo NÃO saiu — foi só razão interno.
    expect(d.repasse.externo).toBe(false);
    expect(d.repasse.motivo).toBe("conexao_nao_configurada");

    // A conta a pagar ligada foi quitada.
    const conta = await env.DB.prepare(
      "SELECT invoice_status, paid_amount FROM todogreen_financial_entries WHERE id=?",
    ).bind(nf200.financialEntryId).first();
    expect(conta.invoice_status).toBe("paid");
    expect(conta.paid_amount).toBe(4000);
  });

  it("recusar exige motivo e volta a nota para o PJ corrigir", async () => {
    // Nova nota do PJ A para recusar.
    await pedir("/api/todogreen/employee-portal/nota", {
      method: "POST", token: pjA.token, body: { numero: "NF-101", competencia: "2026-10", valor: 9999 },
    });
    const lista = await (await pedir("/api/todogreen/employee-portal/gestao/notas", { token: dona.token })).json();
    const nf101 = lista.notas.find((x) => x.numero === "NF-101");

    const semMotivo = await pedir(`/api/todogreen/employee-portal/gestao/notas/${nf101.id}/recusar`, {
      method: "POST", token: dona.token, body: {},
    });
    expect(semMotivo.status).toBe(400);

    const r = await pedir(`/api/todogreen/employee-portal/gestao/notas/${nf101.id}/recusar`, {
      method: "POST", token: dona.token, body: { motivo: "Valor divergente do contrato." },
    });
    expect(r.status).toBe(200);

    // O PJ vê a recusa e pode reenviar a mesma competência (atualiza, não duplica).
    const s = await (await pedir("/api/todogreen/employee-portal/sessao", { token: pjA.token })).json();
    const recusada = s.notas.find((x) => x.numero === "NF-101");
    expect(recusada.status).toBe("recusada");
    expect(recusada.note).toMatch(/divergente/i);

    const reenvio = await pedir("/api/todogreen/employee-portal/nota", {
      method: "POST", token: pjA.token, body: { numero: "NF-101B", competencia: "2026-10", valor: 3000 },
    });
    expect(reenvio.status).toBe(200);
    expect((await reenvio.json()).reenviada).toBe(true);
    const s2 = await (await pedir("/api/todogreen/employee-portal/sessao", { token: pjA.token })).json();
    const daComp = s2.notas.filter((x) => x.competencia === "2026-10");
    expect(daComp.length).toBe(1); // reenvio atualizou, não duplicou
    expect(daComp[0].status).toBe("em_analise");
  });
});
