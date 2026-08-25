import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Compras: requisição → pedido → recebimento → estoque + conta a pagar.
//
// O que estes testes existem para impedir de voltar:
//   • pedido nascendo de requisição não aprovada (aprovação virando formalidade);
//   • pedido editado depois de aprovado passando pela alçada sem ninguém ver;
//   • recebimento acima do que foi pedido;
//   • devolução acima do que foi recebido, que criaria estoque negativo a partir
//     de uma correção;
//   • recebimento sem efeito no estoque, ou com efeito em dobro;
//   • pedido encerrado voltando para rascunho;
//   • linha de serviço (sem material) gerando saldo de estoque.

let n = 0;
const nextIp = () => `198.22.0.${(++n % 240) + 1}`;

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
let fornecedor;
let material;
let deposito;

const criarItem = async (token, nome) =>
  (await (await pedir("/api/todogreen/records/items", {
    metodo: "POST", token, corpo: { nome, unidade: "UN" },
  })).json()).registro;

const criarDeposito = async (token, nome) =>
  (await (await pedir("/api/todogreen/records/warehouses", {
    metodo: "POST", token, corpo: { nome },
  })).json()).registro;

const criarFornecedor = async (token, razaoSocial, prazo = 30) =>
  (await (await pedir("/api/todogreen/records/parties", {
    metodo: "POST", token,
    corpo: { razaoSocial, papeis: ["fornecedor"], prazoPagamentoDias: prazo },
  })).json()).registro;

// Cria um pedido já aprovado e enviado, pronto para receber.
const pedidoPronto = async (token, linhas, extra = {}) => {
  const criado = await pedir("/api/todogreen/purchasing/pedidos", {
    metodo: "POST", token,
    corpo: { supplierPartyId: extra.supplierPartyId || fornecedor.id, linhas, ...extra },
  });
  let pedido = (await criado.json()).registro;
  for (const status of ["aprovado", "enviado"]) {
    const r = await pedir(`/api/todogreen/purchasing/pedidos/${pedido.id}`, {
      metodo: "PATCH", token, corpo: { status, revision: pedido.revision },
    });
    pedido = (await r.json()).registro;
  }
  return pedido;
};

const saldoDe = async (token, itemId, warehouseId) => {
  const { saldos } = await (await pedir("/api/todogreen/stock/saldos", { token })).json();
  return saldos.find((s) => s.itemId === itemId && s.warehouseId === warehouseId)?.saldo ?? 0;
};

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();

  gestora = await criarUsuario("compras-gestora", "gestora@compras.test");
  colega = await criarUsuario("compras-colega", "colega@compras.test");
  auditor = await criarUsuario("compras-auditor", "auditor@compras.test");
  await autorizar(gestora);
  await autorizar(colega);
  await autorizar(auditor, "auditor", ["read"]);

  fornecedor = await criarFornecedor(gestora.token, "Fornecedora Alfa Ltda", 30);
  material = await criarItem(gestora.token, "Pneu 295/80");
  deposito = await criarDeposito(gestora.token, "Almoxarifado");
});

describe("requisição", () => {
  it("cria pendente para Suprimentos e aceita item por descrição livre", async () => {
    const ok = await pedir("/api/todogreen/purchasing/requisicoes", {
      metodo: "POST", token: gestora.token,
      corpo: { title: "Pneus para a frota", items: [{ descricao: "Pneu 295/80", quantidade: 8, unidade: "UN" }] },
    });
    expect(ok.status).toBe(201);
    const { registro } = await ok.json();
    expect(registro.status).toBe("pendente");
    // Sem requisitante informado, é quem criou — o caso comum é pedir para si.
    expect(registro.requisitanteId).toBe(gestora.id);

    expect((await pedir("/api/todogreen/purchasing/requisicoes", {
      metodo: "POST", token: gestora.token, corpo: { title: "Sem itens", items: [] },
    })).status).toBe(400);
  });

  it("segue o caminho declarado e recusa pulo de etapa", async () => {
    const criada = await pedir("/api/todogreen/purchasing/requisicoes", {
      metodo: "POST", token: gestora.token,
      corpo: { title: "Fluxo", items: [{ itemId: material.id, quantidade: 1 }] },
    });
    const { registro } = await criada.json();

    // Pendente não vai direto a atendida.
    const pulo = await pedir(`/api/todogreen/purchasing/requisicoes/${registro.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { status: "atendida", revision: registro.revision },
    });
    expect(pulo.status).toBe(409);

    const aprovada = await pedir(`/api/todogreen/purchasing/requisicoes/${registro.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { status: "aprovada", revision: registro.revision },
    });
    expect(aprovada.status).toBe(200);
    const final = (await aprovada.json()).registro;
    expect(final.status).toBe("aprovada");
    // Quem aprovou e quando ficam registrados.
    expect(final.aprovadoPor).toBe(gestora.id);
    expect(final.aprovadoEm).toBeTruthy();
  });

  it("um espaço não vê a requisição do outro", async () => {
    await pedir("/api/todogreen/purchasing/requisicoes", {
      metodo: "POST", token: colega.token,
      corpo: { title: "Requisição do colega", items: [{ descricao: "algo", quantidade: 1 }] },
    });
    const r = await pedir("/api/todogreen/purchasing/requisicoes", { token: gestora.token });
    const titulos = (await r.json()).registros.map((x) => x.title);
    expect(titulos).not.toContain("Requisição do colega");
  });
});

describe("pedido a partir da requisição", () => {
  it("recusa gerar pedido de requisição não aprovada", async () => {
    // Sem isso, a aprovação vira formalidade.
    const criada = await pedir("/api/todogreen/purchasing/requisicoes", {
      metodo: "POST", token: gestora.token,
      corpo: { title: "Ainda em rascunho", items: [{ itemId: material.id, quantidade: 3 }] },
    });
    const { registro } = await criada.json();

    const r = await pedir("/api/todogreen/purchasing/pedidos", {
      metodo: "POST", token: gestora.token,
      corpo: { supplierPartyId: fornecedor.id, requestId: registro.id },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/aprovada/i);
  });

  it("copia as linhas da requisição aprovada com preço em branco", async () => {
    const criada = await pedir("/api/todogreen/purchasing/requisicoes", {
      metodo: "POST", token: gestora.token,
      corpo: { title: "Aprovada", status: "pendente", items: [{ itemId: material.id, quantidade: 6, unidade: "UN" }] },
    });
    let requisicao = (await criada.json()).registro;
    requisicao = (await (await pedir(`/api/todogreen/purchasing/requisicoes/${requisicao.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { status: "aprovada", revision: requisicao.revision },
    })).json()).registro;

    const r = await pedir("/api/todogreen/purchasing/pedidos", {
      metodo: "POST", token: gestora.token,
      corpo: { supplierPartyId: fornecedor.id, requestId: requisicao.id },
    });
    expect(r.status).toBe(201);
    const pedido = (await r.json()).registro;
    expect(pedido.linhas).toHaveLength(1);
    // Preço é decisão da cotação; preenchê-lo aqui inventaria número.
    expect(pedido.linhas[0]).toMatchObject({ itemId: material.id, quantity: 6, unitPrice: 0 });
    // O prazo vem do cadastro do fornecedor, onde a condição negociada mora.
    expect(pedido.paymentTermDays).toBe(30);
  });

  it("recusa fornecedor de outro espaço", async () => {
    const alheio = await criarFornecedor(colega.token, "Fornecedor do colega");
    const r = await pedir("/api/todogreen/purchasing/pedidos", {
      metodo: "POST", token: gestora.token,
      corpo: { supplierPartyId: alheio.id, linhas: [{ itemId: material.id, quantity: 1, unitPrice: 10 }] },
    });
    expect(r.status).toBe(404);
  });
});

describe("aprovação do pedido", () => {
  it("grava o total aprovado como retrato", async () => {
    const criado = await pedir("/api/todogreen/purchasing/pedidos", {
      metodo: "POST", token: gestora.token,
      corpo: {
        supplierPartyId: fornecedor.id,
        linhas: [{ itemId: material.id, quantity: 10, unitPrice: 100 }],
        freight: 50,
      },
    });
    const pedido = (await criado.json()).registro;
    expect(pedido.totais.total).toBe(1050);

    const aprovado = await pedir(`/api/todogreen/purchasing/pedidos/${pedido.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { status: "aprovado", revision: pedido.revision },
    });
    const depois = (await aprovado.json()).registro;
    expect(depois.approvalStatus).toBe("aprovada");
    expect(depois.approvedTotal).toBe(1050);
    expect(depois.aprovacaoValida).toBe(true);
  });

  it("editar depois de aprovado derruba a validade da aprovação", async () => {
    // Aprovar R$ 1.000 e editar para R$ 50.000 não pode passar sem ninguém ver.
    const criado = await pedir("/api/todogreen/purchasing/pedidos", {
      metodo: "POST", token: gestora.token,
      corpo: { supplierPartyId: fornecedor.id, linhas: [{ itemId: material.id, quantity: 10, unitPrice: 100 }] },
    });
    let pedido = (await criado.json()).registro;
    pedido = (await (await pedir(`/api/todogreen/purchasing/pedidos/${pedido.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { status: "aprovado", revision: pedido.revision },
    })).json()).registro;
    expect(pedido.aprovacaoValida).toBe(true);

    const inflado = await pedir(`/api/todogreen/purchasing/pedidos/${pedido.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { linhas: [{ itemId: material.id, quantity: 500, unitPrice: 100 }], revision: pedido.revision },
    });
    const depois = (await inflado.json()).registro;
    expect(depois.totais.total).toBe(50000);
    expect(depois.approvedTotal).toBe(1000);
    expect(depois.aprovacaoValida).toBe(false);
  });

  it("pedido encerrado é terminal", async () => {
    const pedido = await pedidoPronto(gestora.token, [{ itemId: material.id, quantity: 1, unitPrice: 10 }]);
    const encerrado = await pedir(`/api/todogreen/purchasing/pedidos/${pedido.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { status: "encerrado", revision: pedido.revision },
    });
    const final = (await encerrado.json()).registro;

    const volta = await pedir(`/api/todogreen/purchasing/pedidos/${pedido.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { status: "rascunho", revision: final.revision },
    });
    expect(volta.status).toBe(409);
  });

  it("pedido enviado não tem os itens alterados", async () => {
    // O fornecedor já recebeu o documento.
    const pedido = await pedidoPronto(gestora.token, [{ itemId: material.id, quantity: 2, unitPrice: 10 }]);
    const r = await pedir(`/api/todogreen/purchasing/pedidos/${pedido.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { linhas: [{ itemId: material.id, quantity: 99, unitPrice: 10 }], revision: pedido.revision },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/rascunho ou aprovado/i);
  });
});

describe("recebimento: o ponto com efeito", () => {
  it("entra no estoque e gera o título a pagar com vencimento pelo prazo", async () => {
    const pedido = await pedidoPronto(gestora.token, [
      { itemId: material.id, quantity: 10, unitPrice: 200 },
    ]);
    const antes = await saldoDe(gestora.token, material.id, deposito.id);

    const r = await pedir("/api/todogreen/purchasing/recebimentos", {
      metodo: "POST", token: gestora.token,
      corpo: {
        orderId: pedido.id,
        warehouseId: deposito.id,
        receivedAt: "2026-03-10",
        invoiceNumber: "998877",
        linhas: [{ orderItemId: pedido.linhas[0].id, quantidade: 4 }],
      },
    });
    expect(r.status).toBe(201);
    const resultado = await r.json();
    expect(resultado.movimentos).toBe(1);
    expect(resultado.contaGerada).toBe(true);
    expect(resultado.pedido.recepcao.situacao).toBe("parcial");

    // O estoque subiu.
    expect(await saldoDe(gestora.token, material.id, deposito.id)).toBe(antes + 4);

    // O título nasceu com vencimento a 30 dias do recebimento.
    const conta = await env.DB.prepare(
      `SELECT amount, due_date, counterparty, document_number, invoice_status, kind
         FROM todogreen_financial_entries WHERE id = ?`,
    ).bind(resultado.registro.financialEntryId).first();
    expect(conta).toMatchObject({
      amount: 800,
      due_date: "2026-04-09",
      counterparty: "Fornecedora Alfa Ltda",
      document_number: "998877",
      invoice_status: "pending",
      kind: "cost",
    });

    // O movimento aponta para o recebimento, o que torna o lançamento auditável.
    const movimento = await env.DB.prepare(
      `SELECT kind, quantity, unit_cost, origin_type FROM todogreen_stock_movements
        WHERE origin_type = 'recebimento' AND origin_id = ?`,
    ).bind(resultado.registro.id).first();
    expect(movimento).toMatchObject({
      kind: "entrada", quantity: 4, unit_cost: 200, origin_type: "recebimento",
    });
  });

  it("recusa receber mais do que falta", async () => {
    const pedido = await pedidoPronto(gestora.token, [{ itemId: material.id, quantity: 5, unitPrice: 10 }]);
    const r = await pedir("/api/todogreen/purchasing/recebimentos", {
      metodo: "POST", token: gestora.token,
      corpo: {
        orderId: pedido.id, warehouseId: deposito.id, receivedAt: "2026-03-10",
        linhas: [{ orderItemId: pedido.linhas[0].id, quantidade: 6 }],
      },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/pendente/i);
  });

  it("vários recebimentos somam até completar", async () => {
    const pedido = await pedidoPronto(gestora.token, [{ itemId: material.id, quantity: 6, unitPrice: 10 }]);
    const linhaId = pedido.linhas[0].id;

    for (const quantidade of [2, 4]) {
      const r = await pedir("/api/todogreen/purchasing/recebimentos", {
        metodo: "POST", token: gestora.token,
        corpo: {
          orderId: pedido.id, warehouseId: deposito.id, receivedAt: "2026-03-12",
          linhas: [{ orderItemId: linhaId, quantidade }],
        },
      });
      expect(r.status).toBe(201);
    }

    const final = (await (await pedir(`/api/todogreen/purchasing/pedidos/${pedido.id}`, {
      token: gestora.token,
    })).json()).registro;
    expect(final.recepcao.situacao).toBe("completo");
    expect(final.recepcao.percentual).toBe(100);

    // O terceiro recebimento não tem o que receber.
    const excesso = await pedir("/api/todogreen/purchasing/recebimentos", {
      metodo: "POST", token: gestora.token,
      corpo: {
        orderId: pedido.id, warehouseId: deposito.id, receivedAt: "2026-03-13",
        linhas: [{ orderItemId: linhaId, quantidade: 1 }],
      },
    });
    expect(excesso.status).toBe(409);
  });

  it("devolução sai do estoque e não pode passar do recebido", async () => {
    const pedido = await pedidoPronto(gestora.token, [{ itemId: material.id, quantity: 10, unitPrice: 50 }]);
    const linhaId = pedido.linhas[0].id;
    await pedir("/api/todogreen/purchasing/recebimentos", {
      metodo: "POST", token: gestora.token,
      corpo: {
        orderId: pedido.id, warehouseId: deposito.id, receivedAt: "2026-03-14",
        linhas: [{ orderItemId: linhaId, quantidade: 6 }],
      },
    });
    const antes = await saldoDe(gestora.token, material.id, deposito.id);

    // Devolver mais do que chegou criaria estoque negativo a partir de uma
    // correção.
    const demais = await pedir("/api/todogreen/purchasing/recebimentos", {
      metodo: "POST", token: gestora.token,
      corpo: {
        orderId: pedido.id, warehouseId: deposito.id, receivedAt: "2026-03-15",
        kind: "devolucao", linhas: [{ orderItemId: linhaId, quantidade: 7 }],
      },
    });
    expect(demais.status).toBe(409);
    expect((await demais.json()).error).toMatch(/devolver/i);

    const ok = await pedir("/api/todogreen/purchasing/recebimentos", {
      metodo: "POST", token: gestora.token,
      corpo: {
        orderId: pedido.id, warehouseId: deposito.id, receivedAt: "2026-03-15",
        kind: "devolucao", linhas: [{ orderItemId: linhaId, quantidade: 2 }],
      },
    });
    expect(ok.status).toBe(201);
    // Devolução não gera crédito automático — o abatimento é decisão de quem
    // confere a fatura.
    expect((await ok.json()).contaGerada).toBe(false);
    expect(await saldoDe(gestora.token, material.id, deposito.id)).toBe(antes - 2);
  });

  it("linha de serviço não gera movimento de estoque", async () => {
    // Forçar movimento criaria saldo de algo que não existe fisicamente.
    const pedido = await pedidoPronto(gestora.token, [
      { description: "Instalação e balanceamento", quantity: 4, unitPrice: 80 },
    ]);
    const r = await pedir("/api/todogreen/purchasing/recebimentos", {
      metodo: "POST", token: gestora.token,
      corpo: {
        orderId: pedido.id, warehouseId: deposito.id, receivedAt: "2026-03-16",
        linhas: [{ orderItemId: pedido.linhas[0].id, quantidade: 4 }],
      },
    });
    expect(r.status).toBe(201);
    const resultado = await r.json();
    expect(resultado.movimentos).toBe(0);
    // Mas o título existe: serviço se paga.
    expect(resultado.contaGerada).toBe(true);
  });

  it("pode receber sem gerar título", async () => {
    // Conta a pagar nascendo sozinha é dinheiro aparecendo sem decisão.
    const pedido = await pedidoPronto(gestora.token, [{ itemId: material.id, quantity: 3, unitPrice: 10 }]);
    const r = await pedir("/api/todogreen/purchasing/recebimentos", {
      metodo: "POST", token: gestora.token,
      corpo: {
        orderId: pedido.id, warehouseId: deposito.id, receivedAt: "2026-03-17",
        gerarConta: false, linhas: [{ orderItemId: pedido.linhas[0].id, quantidade: 3 }],
      },
    });
    expect((await r.json()).contaGerada).toBe(false);
  });

  it("recusa receber contra pedido em rascunho", async () => {
    const criado = await pedir("/api/todogreen/purchasing/pedidos", {
      metodo: "POST", token: gestora.token,
      corpo: { supplierPartyId: fornecedor.id, linhas: [{ itemId: material.id, quantity: 1, unitPrice: 10 }] },
    });
    const pedido = (await criado.json()).registro;
    const r = await pedir("/api/todogreen/purchasing/recebimentos", {
      metodo: "POST", token: gestora.token,
      corpo: {
        orderId: pedido.id, warehouseId: deposito.id, receivedAt: "2026-03-18",
        linhas: [{ orderItemId: pedido.linhas[0].id, quantidade: 1 }],
      },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/rascunho/i);
  });

  it("recusa chave de nota com tamanho errado", async () => {
    const pedido = await pedidoPronto(gestora.token, [{ itemId: material.id, quantity: 1, unitPrice: 10 }]);
    const r = await pedir("/api/todogreen/purchasing/recebimentos", {
      metodo: "POST", token: gestora.token,
      corpo: {
        orderId: pedido.id, warehouseId: deposito.id, receivedAt: "2026-03-19",
        invoiceKey: "1".repeat(43),
        linhas: [{ orderItemId: pedido.linhas[0].id, quantidade: 1 }],
      },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/44/);
  });

  it("recebimento não é editado nem apagado", async () => {
    const pedido = await pedidoPronto(gestora.token, [{ itemId: material.id, quantity: 2, unitPrice: 10 }]);
    const criado = await pedir("/api/todogreen/purchasing/recebimentos", {
      metodo: "POST", token: gestora.token,
      corpo: {
        orderId: pedido.id, warehouseId: deposito.id, receivedAt: "2026-03-20",
        linhas: [{ orderItemId: pedido.linhas[0].id, quantidade: 2 }],
      },
    });
    const { registro } = await criado.json();
    for (const metodo of ["PATCH", "DELETE"]) {
      const r = await pedir(`/api/todogreen/purchasing/recebimentos/${registro.id}`, {
        metodo, token: gestora.token, corpo: {},
      });
      expect(r.status).toBe(405);
      expect((await r.json()).error).toMatch(/devolução/i);
    }
  });
});

describe("permissão e escopo", () => {
  it("quem só consulta lê pedidos mas não movimenta", async () => {
    expect((await pedir("/api/todogreen/purchasing/pedidos", { token: auditor.token })).status).toBe(200);
    const r = await pedir("/api/todogreen/purchasing/pedidos", {
      metodo: "POST", token: auditor.token,
      corpo: { supplierPartyId: fornecedor.id, linhas: [{ itemId: material.id, quantity: 1, unitPrice: 10 }] },
    });
    expect(r.status).toBe(403);
  });

  it("um espaço não vê o pedido do outro", async () => {
    const alheio = await criarFornecedor(colega.token, "Fornecedor isolado");
    const itemColega = await criarItem(colega.token, "Material isolado");
    await pedir("/api/todogreen/purchasing/pedidos", {
      metodo: "POST", token: colega.token,
      corpo: { supplierPartyId: alheio.id, linhas: [{ itemId: itemColega.id, quantity: 1, unitPrice: 10 }] },
    });

    const r = await pedir("/api/todogreen/purchasing/pedidos", { token: gestora.token });
    const fornecedores = (await r.json()).registros.map((p) => p.supplierName);
    expect(fornecedores).not.toContain("Fornecedor isolado");
  });

  it("sem sessão, nada", async () => {
    expect((await pedir("/api/todogreen/purchasing/pedidos")).status).toBe(401);
  });

  it("exige a revisão que quem edita leu", async () => {
    const criado = await pedir("/api/todogreen/purchasing/pedidos", {
      metodo: "POST", token: gestora.token,
      corpo: { supplierPartyId: fornecedor.id, linhas: [{ itemId: material.id, quantity: 1, unitPrice: 10 }] },
    });
    const pedido = (await criado.json()).registro;
    const r = await pedir(`/api/todogreen/purchasing/pedidos/${pedido.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { notas: "sem revisão" },
    });
    expect(r.status).toBe(400);
  });

  it("a segunda gravação com a mesma revisão recebe 409", async () => {
    const criado = await pedir("/api/todogreen/purchasing/pedidos", {
      metodo: "POST", token: gestora.token,
      corpo: { supplierPartyId: fornecedor.id, linhas: [{ itemId: material.id, quantity: 1, unitPrice: 10 }] },
    });
    const pedido = (await criado.json()).registro;
    const primeira = await pedir(`/api/todogreen/purchasing/pedidos/${pedido.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { notas: "primeira", revision: pedido.revision },
    });
    expect(primeira.status).toBe(200);
    const segunda = await pedir(`/api/todogreen/purchasing/pedidos/${pedido.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { notas: "segunda", revision: pedido.revision },
    });
    expect(segunda.status).toBe(409);
  });
});
