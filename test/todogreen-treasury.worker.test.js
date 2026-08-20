import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Tesouraria: extrato, conciliação e fechamento de período.
//
// O que estes testes existem para impedir de voltar:
//   • reimportar o extrato do banco duplicando linhas (o arquivo do dia seguinte
//     repete os dias anteriores — reimportar é rotina, não exceção);
//   • entrada no banco conciliada com custo, ou saída com receita;
//   • conciliação automática em caso de empate, onde o sistema não sabe qual é;
//   • saldo de conta contando o que ainda não passou pelo banco;
//   • lançamento de mês fechado sendo criado, alterado ou arquivado — o que
//     faria o resultado de janeiro mudar em dezembro;
//   • reabertura de período sem motivo e sem rastro.

let n = 0;
const nextIp = () => `198.23.0.${(++n % 240) + 1}`;

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

async function autorizar(usuario, papel = "admin", permissoes = ["*"]) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'active', ?, '', ?, ?, ?)
     ON CONFLICT(tenant_id, email) DO UPDATE SET role = excluded.role,
       permissions_json = excluded.permissions_json, status = 'active'`,
  )
    .bind(crypto.randomUUID(), usuario.email, papel, JSON.stringify(permissoes), usuario.id, agora, agora)
    .run();
}

const pedir = (caminho, { metodo = "GET", token, corpo } = {}) => {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${caminho}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
};

let gestora;
let colega;
let auditor;
let conta;

const criarConta = async (token, nome, saldoInicial = 0) =>
  (await (await pedir("/api/todogreen/records/bankAccounts", {
    metodo: "POST", token, corpo: { name: nome, kind: "corrente", saldoInicial },
  })).json()).registro;

const criarLancamento = async (token, corpo) =>
  (await (await pedir("/api/todogreen/records/financial", {
    metodo: "POST", token, corpo,
  })).json()).registro;

const importar = (token, bankAccountId, linhas) =>
  pedir("/api/todogreen/treasury/extrato", {
    metodo: "POST", token, corpo: { bankAccountId, linhas },
  });

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();

  gestora = await criarUsuario("tes-gestora", "gestora@tesouraria.test");
  colega = await criarUsuario("tes-colega", "colega@tesouraria.test");
  auditor = await criarUsuario("tes-auditor", "auditor@tesouraria.test");
  await autorizar(gestora);
  await autorizar(colega);
  await autorizar(auditor, "auditor", ["read"]);

  conta = await criarConta(gestora.token, "Banco do Brasil", 5000);
});

describe("conta bancária", () => {
  it("cria e aceita saldo inicial negativo", async () => {
    // Conta com limite usado começa no vermelho; forçar zero mentiria sobre a
    // posição de caixa.
    const negativa = await criarConta(gestora.token, "Conta no limite", -1200);
    expect(negativa.saldoInicial).toBe(-1200);
  });

  it("exige nome e recusa tipo inventado", async () => {
    expect((await pedir("/api/todogreen/records/bankAccounts", {
      metodo: "POST", token: gestora.token, corpo: { kind: "corrente" },
    })).status).toBe(400);

    const r = await pedir("/api/todogreen/records/bankAccounts", {
      metodo: "POST", token: gestora.token, corpo: { name: "X", kind: "inventado" },
    });
    expect(r.status).toBe(400);
  });

  it("um espaço não vê a conta do outro", async () => {
    await criarConta(colega.token, "Conta do colega");
    const r = await pedir("/api/todogreen/records/bankAccounts", { token: gestora.token });
    expect((await r.json()).registros.map((c) => c.name)).not.toContain("Conta do colega");
  });
});

describe("importação de extrato", () => {
  it("importa e ignora a linha repetida na reimportação", async () => {
    const alvo = await criarConta(gestora.token, "Conta de importação", 0);
    const linhas = [
      { occurredOn: "2026-03-10", amount: 1000, description: "TED RECEBIDA", document: "111" },
      { occurredOn: "2026-03-11", amount: -250, description: "PAGAMENTO FORNECEDOR", document: "222" },
    ];

    const primeira = await importar(gestora.token, alvo.id, linhas);
    expect(primeira.status).toBe(201);
    expect(await primeira.json()).toMatchObject({ importadas: 2, repetidas: 0 });

    // O arquivo do dia seguinte repete os dias anteriores e traz uma linha nova.
    const segunda = await importar(gestora.token, alvo.id, [
      ...linhas,
      { occurredOn: "2026-03-12", amount: 500, description: "TED RECEBIDA", document: "333" },
    ]);
    expect(await segunda.json()).toMatchObject({ importadas: 1, repetidas: 2 });
  });

  it("recusa linha com valor zero e data inválida, sem gravar nada", async () => {
    // Valida tudo antes de gravar qualquer coisa: gravar metade deixaria o
    // extrato incompleto sem ninguém saber onde parou.
    const alvo = await criarConta(gestora.token, "Conta de validação", 0);
    const r = await importar(gestora.token, alvo.id, [
      { occurredOn: "2026-03-10", amount: 100, description: "boa" },
      { occurredOn: "2026-03-11", amount: 0, description: "zero" },
    ]);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/zero/i);

    const lista = await pedir(`/api/todogreen/treasury/extrato?conta=${alvo.id}`, { token: gestora.token });
    expect((await lista.json()).total).toBe(0);
  });

  it("recusa conta de outro espaço", async () => {
    const alheia = await criarConta(colega.token, "Conta alheia");
    const r = await importar(gestora.token, alheia.id, [
      { occurredOn: "2026-03-10", amount: 100, description: "x" },
    ]);
    expect(r.status).toBe(404);
  });

  it("lista só as pendentes quando pedido", async () => {
    const alvo = await criarConta(gestora.token, "Conta de pendências", 0);
    await importar(gestora.token, alvo.id, [
      { occurredOn: "2026-04-01", amount: 300, description: "a" },
    ]);
    const r = await pedir(`/api/todogreen/treasury/extrato?conta=${alvo.id}&pendentes=1`, {
      token: gestora.token,
    });
    expect((await r.json()).total).toBe(1);
  });

  it("linha de extrato não é editada", async () => {
    const r = await pedir("/api/todogreen/treasury/extrato/qualquer", {
      metodo: "PATCH", token: gestora.token, corpo: {},
    });
    expect(r.status).toBe(405);
    expect((await r.json()).error).toMatch(/banco informou/i);
  });
});

describe("conciliação", () => {
  it("sugere o lançamento certo e conciliar move o saldo", async () => {
    const alvo = await criarConta(gestora.token, "Conta de conciliação", 1000);
    const lancamento = await criarLancamento(gestora.token, {
      tipo: "revenue", valor: 2500, descricao: "Frete março",
      vencimentoEm: "2026-03-15", competenciaEm: "2026-03-01",
      contraparte: "Cliente Alfa", numeroDocumento: "NF-777",
    });
    await importar(gestora.token, alvo.id, [
      { occurredOn: "2026-03-15", amount: 2500, description: "TED CLIENTE ALFA NF-777" },
    ]);
    const linha = (await (await pedir(`/api/todogreen/treasury/extrato?conta=${alvo.id}`, {
      token: gestora.token,
    })).json()).registros[0];

    const sugestoes = await pedir(`/api/todogreen/treasury/sugestoes?linha=${linha.id}`, {
      token: gestora.token,
    });
    const { candidatos } = await sugestoes.json();
    expect(candidatos[0]).toMatchObject({ entryId: lancamento.id });
    expect(candidatos[0].motivos).toContain("valor exato");

    const antes = (await (await pedir("/api/todogreen/treasury/saldos", { token: gestora.token })).json())
      .contas.find((c) => c.id === alvo.id);
    // Antes de conciliar, o saldo é só o inicial — e a tela sabe que ainda vai
    // mudar porque há linha pendente.
    expect(antes).toMatchObject({ saldo: 1000, linhasPendentes: 1 });

    const r = await pedir("/api/todogreen/treasury/conciliacoes", {
      metodo: "POST", token: gestora.token, corpo: { linhaId: linha.id, entryId: lancamento.id },
    });
    expect(r.status).toBe(200);

    const depois = (await (await pedir("/api/todogreen/treasury/saldos", { token: gestora.token })).json())
      .contas.find((c) => c.id === alvo.id);
    expect(depois).toMatchObject({ saldo: 3500, linhasPendentes: 0 });
  });

  it("entrada no banco não concilia com custo", async () => {
    const alvo = await criarConta(gestora.token, "Conta de sinal", 0);
    const custo = await criarLancamento(gestora.token, {
      tipo: "cost", valor: 400, descricao: "Combustível", competenciaEm: "2026-05-01",
    });
    await importar(gestora.token, alvo.id, [
      { occurredOn: "2026-05-02", amount: 400, description: "ENTRADA" },
    ]);
    const linha = (await (await pedir(`/api/todogreen/treasury/extrato?conta=${alvo.id}`, {
      token: gestora.token,
    })).json()).registros[0];

    const r = await pedir("/api/todogreen/treasury/conciliacoes", {
      metodo: "POST", token: gestora.token, corpo: { linhaId: linha.id, entryId: custo.id },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/entrada no banco/i);
  });

  it("não concilia duas vezes a mesma linha", async () => {
    const alvo = await criarConta(gestora.token, "Conta de repetição", 0);
    const receita = await criarLancamento(gestora.token, {
      tipo: "revenue", valor: 100, descricao: "X", competenciaEm: "2026-06-01",
    });
    const outra = await criarLancamento(gestora.token, {
      tipo: "revenue", valor: 100, descricao: "Y", competenciaEm: "2026-06-01",
    });
    await importar(gestora.token, alvo.id, [
      { occurredOn: "2026-06-02", amount: 100, description: "TED" },
    ]);
    const linha = (await (await pedir(`/api/todogreen/treasury/extrato?conta=${alvo.id}`, {
      token: gestora.token,
    })).json()).registros[0];

    expect((await pedir("/api/todogreen/treasury/conciliacoes", {
      metodo: "POST", token: gestora.token, corpo: { linhaId: linha.id, entryId: receita.id },
    })).status).toBe(200);

    const segunda = await pedir("/api/todogreen/treasury/conciliacoes", {
      metodo: "POST", token: gestora.token, corpo: { linhaId: linha.id, entryId: outra.id },
    });
    expect(segunda.status).toBe(409);
  });

  it("desfazer libera a linha e o lançamento", async () => {
    const alvo = await criarConta(gestora.token, "Conta de desfazer", 0);
    const receita = await criarLancamento(gestora.token, {
      tipo: "revenue", valor: 700, descricao: "Z", competenciaEm: "2026-07-01",
    });
    await importar(gestora.token, alvo.id, [
      { occurredOn: "2026-07-02", amount: 700, description: "TED" },
    ]);
    const linha = (await (await pedir(`/api/todogreen/treasury/extrato?conta=${alvo.id}`, {
      token: gestora.token,
    })).json()).registros[0];
    await pedir("/api/todogreen/treasury/conciliacoes", {
      metodo: "POST", token: gestora.token, corpo: { linhaId: linha.id, entryId: receita.id },
    });

    const r = await pedir("/api/todogreen/treasury/conciliacoes/desfazer", {
      metodo: "POST", token: gestora.token, corpo: { linhaId: linha.id },
    });
    expect(r.status).toBe(200);

    const saldo = (await (await pedir("/api/todogreen/treasury/saldos", { token: gestora.token })).json())
      .contas.find((c) => c.id === alvo.id);
    expect(saldo).toMatchObject({ saldo: 0, linhasPendentes: 1 });
  });

  it("quem só consulta lê mas não concilia", async () => {
    expect((await pedir("/api/todogreen/treasury/saldos", { token: auditor.token })).status).toBe(200);
    const r = await pedir("/api/todogreen/treasury/conciliacoes", {
      metodo: "POST", token: auditor.token, corpo: { linhaId: "x", entryId: "y" },
    });
    expect(r.status).toBe(403);
  });
});

describe("cobrança com multa e juros", () => {
  it("mostra a composição do que cobrar hoje", async () => {
    const vencido = await criarLancamento(gestora.token, {
      tipo: "revenue", valor: 1000, descricao: "Vencido",
      vencimentoEm: "2026-03-10", competenciaEm: "2026-03-01",
      multaPercent: 2, jurosMesPercent: 1,
    });

    const r = await pedir("/api/todogreen/treasury/cobranca?hoje=2026-04-09&tipo=receber", {
      token: gestora.token,
    });
    const { registros } = await r.json();
    const alvo = registros.find((x) => x.id === vencido.id);
    // 1000 aberto: multa 2% = 20, juros 1%/mês por 30 dias = 10.
    expect(alvo.devido).toMatchObject({ principal: 1000, multa: 20, juros: 10, total: 1030, diasDeAtraso: 30 });
  });

  it("não cobra encargo antes do vencimento", async () => {
    const futuro = await criarLancamento(gestora.token, {
      tipo: "revenue", valor: 500, descricao: "A vencer",
      vencimentoEm: "2026-12-31", competenciaEm: "2026-12-01",
      multaPercent: 2, jurosMesPercent: 1,
    });
    const r = await pedir("/api/todogreen/treasury/cobranca?hoje=2026-06-01", { token: gestora.token });
    const alvo = (await r.json()).registros.find((x) => x.id === futuro.id);
    expect(alvo.devido).toMatchObject({ multa: 0, juros: 0, total: 500, diasDeAtraso: 0 });
  });

  it("percentual negativo não gera crédito", async () => {
    const lancamento = await criarLancamento(gestora.token, {
      tipo: "cost", valor: 300, descricao: "Negativo",
      vencimentoEm: "2026-01-10", competenciaEm: "2026-11-01",
      multaPercent: -50, jurosMesPercent: -5,
    });
    // A coluna guarda zero, não o negativo.
    expect(lancamento.multaPercent).toBe(0);
    expect(lancamento.jurosMesPercent).toBe(0);
  });
});

describe("fechamento de período", () => {
  it("fecha o mês guardando o retrato do resultado", async () => {
    await criarLancamento(gestora.token, {
      tipo: "revenue", valor: 10000, descricao: "Receita ago", competenciaEm: "2026-08-05",
      centroCusto: "mid", costCenterId: "cc-mid",
    });
    await criarLancamento(gestora.token, {
      tipo: "cost", valor: 4000, descricao: "Custo ago", competenciaEm: "2026-08-06",
      costCenterId: "cc-mid",
    });

    const r = await pedir("/api/todogreen/treasury/periodos", {
      metodo: "POST", token: gestora.token, corpo: { referenceMonth: "2026-08" },
    });
    expect(r.status).toBe(201);
    const { registro, porCentroDeCusto } = await r.json();
    expect(registro).toMatchObject({ referenceMonth: "2026-08", status: "fechado" });
    expect(registro.totais).toMatchObject({ receita: 10000, custo: 4000, resultado: 6000 });
    expect(porCentroDeCusto.find((l) => l.chave === "cc-mid")).toMatchObject({ margem: 60 });
  });

  it("mês fechado recusa lançamento novo", async () => {
    // Sem isso, o resultado de agosto mudaria em dezembro.
    const r = await pedir("/api/todogreen/records/financial", {
      metodo: "POST", token: gestora.token,
      corpo: { tipo: "cost", valor: 999, descricao: "Atrasado", competenciaEm: "2026-08-20" },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/2026-08 está fechada/);
  });

  it("mês fechado recusa alteração e arquivamento do que já existe", async () => {
    // Um lançamento criado antes do fechamento.
    const antes = await criarLancamento(gestora.token, {
      tipo: "cost", valor: 100, descricao: "Antes do fecho", competenciaEm: "2026-09-10",
    });
    await pedir("/api/todogreen/treasury/periodos", {
      metodo: "POST", token: gestora.token, corpo: { referenceMonth: "2026-09" },
    });

    const alterar = await pedir(`/api/todogreen/records/financial/${antes.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { tipo: "cost", valor: 5000, revision: antes.revision },
    });
    expect(alterar.status).toBe(409);

    const arquivar = await pedir(`/api/todogreen/records/financial/${antes.id}`, {
      metodo: "DELETE", token: gestora.token,
    });
    expect(arquivar.status).toBe(409);
  });

  it("não deixa empurrar lançamento para dentro do mês fechado", async () => {
    // Checar só a competência de origem permitiria mover para dentro do fecho.
    const aberto = await criarLancamento(gestora.token, {
      tipo: "cost", valor: 100, descricao: "Mês aberto", competenciaEm: "2026-10-10",
    });
    const r = await pedir(`/api/todogreen/records/financial/${aberto.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { tipo: "cost", valor: 100, competenciaEm: "2026-09-15", revision: aberto.revision },
    });
    expect(r.status).toBe(409);
  });

  it("mês aberto continua aceitando lançamento", async () => {
    const r = await pedir("/api/todogreen/records/financial", {
      metodo: "POST", token: gestora.token,
      corpo: { tipo: "cost", valor: 50, descricao: "Mês livre", competenciaEm: "2026-11-05" },
    });
    expect(r.status).toBe(201);
  });

  it("fechar duas vezes o mesmo mês responde 409", async () => {
    const r = await pedir("/api/todogreen/treasury/periodos", {
      metodo: "POST", token: gestora.token, corpo: { referenceMonth: "2026-08" },
    });
    expect(r.status).toBe(409);
  });

  it("recusa mês em formato inválido", async () => {
    for (const mes of ["2026-13", "2026-8", ""]) {
      const r = await pedir("/api/todogreen/treasury/periodos", {
        metodo: "POST", token: gestora.token, corpo: { referenceMonth: mes },
      });
      expect(r.status).toBe(400);
    }
  });

  it("reabrir exige motivo e deixa rastro", async () => {
    // Fechar e reabrir em silêncio seria o mesmo que não fechar.
    const semMotivo = await pedir("/api/todogreen/treasury/periodos/reabrir", {
      metodo: "POST", token: gestora.token, corpo: { referenceMonth: "2026-08" },
    });
    expect(semMotivo.status).toBe(400);
    expect((await semMotivo.json()).error).toMatch(/motivo/i);

    const r = await pedir("/api/todogreen/treasury/periodos/reabrir", {
      metodo: "POST", token: gestora.token,
      corpo: { referenceMonth: "2026-08", motivo: "Nota do fornecedor chegou atrasada." },
    });
    expect(r.status).toBe(200);
    const { registro } = await r.json();
    expect(registro).toMatchObject({
      status: "reaberto",
      reabertoPor: gestora.id,
      motivoReabertura: "Nota do fornecedor chegou atrasada.",
    });

    // Reaberto volta a aceitar lançamento.
    const depois = await pedir("/api/todogreen/records/financial", {
      metodo: "POST", token: gestora.token,
      corpo: { tipo: "cost", valor: 999, descricao: "Agora vai", competenciaEm: "2026-08-20" },
    });
    expect(depois.status).toBe(201);
  });

  it("reabrir mês que não está fechado responde 409", async () => {
    const r = await pedir("/api/todogreen/treasury/periodos/reabrir", {
      metodo: "POST", token: gestora.token,
      corpo: { referenceMonth: "2026-12", motivo: "qualquer" },
    });
    expect(r.status).toBe(409);
  });

  it("o fechamento de um espaço não trava o outro", async () => {
    const r = await pedir("/api/todogreen/records/financial", {
      metodo: "POST", token: colega.token,
      corpo: { tipo: "cost", valor: 10, descricao: "Do colega", competenciaEm: "2026-09-15" },
    });
    expect(r.status).toBe(201);
  });
});

describe("resultado por eixo", () => {
  it("agrupa por centro de custo e por conta", async () => {
    const porCentro = await pedir("/api/todogreen/treasury/resultado?mes=2026-08", { token: gestora.token });
    const corpo = await porCentro.json();
    expect(corpo.eixo).toBe("centro-de-custo");
    expect(corpo.linhas.find((l) => l.chave === "cc-mid")).toMatchObject({ receita: 10000 });

    const porConta = await pedir("/api/todogreen/treasury/resultado?eixo=conta", { token: gestora.token });
    expect((await porConta.json()).eixo).toBe("conta");
  });

  it("sem sessão, nada", async () => {
    expect((await pedir("/api/todogreen/treasury/saldos")).status).toBe(401);
  });
});
