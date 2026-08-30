import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Estoque: o movimento entra, o saldo é somado.
//
// O que estes testes existem para impedir de voltar:
//   • saída acima do saldo virando saldo zero em silêncio (o
//     `Math.max(0, stock - qtd)` do catálogo do monólito);
//   • movimento editável ou apagável, que tornaria o saldo impossível de
//     auditar;
//   • transferência criando estoque no destino sem baixar na origem;
//   • contagem fechando contra o saldo de hoje em vez do saldo do dia da
//     contagem;
//   • movimento de material ou depósito de outro espaço.

let n = 0;
const nextIp = () => `198.21.0.${(++n % 240) + 1}`;

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
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET role = excluded.role,
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
let item;
let matriz;
let filial;

const criarItem = async (token, nome) => {
  const r = await pedir("/api/todogreen/records/items", {
    metodo: "POST", token, corpo: { nome, unidade: "UN" },
  });
  return (await r.json()).registro;
};

const criarDeposito = async (token, nome) => {
  const r = await pedir("/api/todogreen/records/warehouses", {
    metodo: "POST", token, corpo: { nome },
  });
  return (await r.json()).registro;
};

const movimentar = (token, corpo) =>
  pedir("/api/todogreen/stock/movimentos", { metodo: "POST", token, corpo });

const saldoDe = async (token, itemId, warehouseId) => {
  const r = await pedir("/api/todogreen/stock/saldos", { token });
  const { saldos } = await r.json();
  return saldos.find((s) => s.itemId === itemId && s.warehouseId === warehouseId)?.saldo ?? 0;
};

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();

  gestora = await criarUsuario("estoque-gestora", "gestora@estoque.test");
  colega = await criarUsuario("estoque-colega", "colega@estoque.test");
  auditor = await criarUsuario("estoque-auditor", "auditor@estoque.test");
  await autorizar(gestora);
  await autorizar(colega);
  await autorizar(auditor, "auditor", ["read"]);

  item = await criarItem(gestora.token, "Pneu 295/80");
  matriz = await criarDeposito(gestora.token, "Matriz");
  filial = await criarDeposito(gestora.token, "Filial");
});

describe("entrada e saldo", () => {
  it("a entrada soma e o saldo vem do banco", async () => {
    const r = await movimentar(gestora.token, {
      itemId: item.id, warehouseId: matriz.id, kind: "entrada",
      quantity: 10, unitCost: 100, occurredAt: "2026-01-10",
    });
    expect(r.status).toBe(201);
    expect((await r.json()).registro.quantity).toBe(10);
    expect(await saldoDe(gestora.token, item.id, matriz.id)).toBe(10);
  });

  it("a saída dentro do saldo é aceita e subtrai", async () => {
    const r = await movimentar(gestora.token, {
      itemId: item.id, warehouseId: matriz.id, kind: "saida",
      quantity: 4, occurredAt: "2026-01-11",
    });
    expect(r.status).toBe(201);
    expect(await saldoDe(gestora.token, item.id, matriz.id)).toBe(6);
  });

  it("a saída exatamente igual ao saldo é aceita", async () => {
    const zerado = await criarItem(gestora.token, "Item para zerar");
    await movimentar(gestora.token, {
      itemId: zerado.id, warehouseId: matriz.id, kind: "entrada",
      quantity: 5, occurredAt: "2026-01-01",
    });
    const r = await movimentar(gestora.token, {
      itemId: zerado.id, warehouseId: matriz.id, kind: "saida",
      quantity: 5, occurredAt: "2026-01-02",
    });
    expect(r.status).toBe(201);
    expect(await saldoDe(gestora.token, zerado.id, matriz.id)).toBe(0);
  });
});

describe("saída acima do saldo é RECUSADA, não aparada", () => {
  it("responde 409 com o saldo disponível e não grava nada", async () => {
    // É o defeito do catálogo do monólito: `Math.max(0, stock - qtd)` levaria o
    // saldo a zero e a informação de que faltou mercadoria desapareceria.
    const antes = await saldoDe(gestora.token, item.id, matriz.id);
    const r = await movimentar(gestora.token, {
      itemId: item.id, warehouseId: matriz.id, kind: "saida",
      quantity: antes + 1, occurredAt: "2026-01-20",
    });
    expect(r.status).toBe(409);
    const corpo = await r.json();
    expect(corpo.error).toMatch(/insuficiente/i);
    expect(corpo.saldoDisponivel).toBe(antes);
    // O saldo não se moveu: nenhuma linha entrou.
    expect(await saldoDe(gestora.token, item.id, matriz.id)).toBe(antes);
  });

  it("saída num depósito sem nenhum movimento também é recusada", async () => {
    const r = await movimentar(gestora.token, {
      itemId: item.id, warehouseId: filial.id, kind: "saida",
      quantity: 1, occurredAt: "2026-01-20",
    });
    expect(r.status).toBe(409);
    expect((await r.json()).saldoDisponivel).toBe(0);
  });

  it("o saldo é por depósito: ter na matriz não libera saída na filial", async () => {
    expect(await saldoDe(gestora.token, item.id, matriz.id)).toBeGreaterThan(0);
    const r = await movimentar(gestora.token, {
      itemId: item.id, warehouseId: filial.id, kind: "saida",
      quantity: 1, occurredAt: "2026-01-21",
    });
    expect(r.status).toBe(409);
  });

  it("o ajuste negativo NÃO é barrado pelo saldo", async () => {
    // O ajuste existe para corrigir o saldo, inclusive para baixo. Recusá-lo por
    // falta de saldo impediria de registrar a falta que a contagem encontrou.
    const novo = await criarItem(gestora.token, "Item só com ajuste");
    const r = await movimentar(gestora.token, {
      itemId: novo.id, warehouseId: matriz.id, kind: "ajuste_saida",
      quantity: 3, occurredAt: "2026-01-05",
    });
    expect(r.status).toBe(201);
    expect(await saldoDe(gestora.token, novo.id, matriz.id)).toBe(-3);
  });
});

describe("movimento não é editado nem apagado", () => {
  it("PATCH e DELETE respondem 405 explicando o caminho certo", async () => {
    const criado = await movimentar(gestora.token, {
      itemId: item.id, warehouseId: matriz.id, kind: "entrada",
      quantity: 2, occurredAt: "2026-02-01",
    });
    const { registro } = await criado.json();

    for (const metodo of ["PATCH", "DELETE"]) {
      const r = await pedir(`/api/todogreen/stock/movimentos/${registro.id}`, {
        metodo, token: gestora.token, corpo: {},
      });
      expect(r.status).toBe(405);
      expect((await r.json()).error).toMatch(/ajuste contrário/i);
    }
  });
});

describe("validação e escopo", () => {
  it("recusa quantidade zero e tipo desconhecido", async () => {
    expect((await movimentar(gestora.token, {
      itemId: item.id, warehouseId: matriz.id, kind: "entrada",
      quantity: 0, occurredAt: "2026-01-01",
    })).status).toBe(400);

    expect((await movimentar(gestora.token, {
      itemId: item.id, warehouseId: matriz.id, kind: "inventado",
      quantity: 1, occurredAt: "2026-01-01",
    })).status).toBe(400);
  });

  it("recusa material que não existe neste espaço", async () => {
    const doColega = await criarItem(colega.token, "Material do colega");
    const r = await movimentar(gestora.token, {
      itemId: doColega.id, warehouseId: matriz.id, kind: "entrada",
      quantity: 1, occurredAt: "2026-01-01",
    });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toMatch(/material/i);
  });

  it("recusa depósito que não existe neste espaço", async () => {
    const r = await movimentar(gestora.token, {
      itemId: item.id, warehouseId: "deposito-inventado", kind: "entrada",
      quantity: 1, occurredAt: "2026-01-01",
    });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toMatch(/depósito/i);
  });

  it("um espaço não vê o movimento do outro", async () => {
    const doColega = await criarItem(colega.token, "Item do colega");
    const depColega = await criarDeposito(colega.token, "Depósito do colega");
    await movimentar(colega.token, {
      itemId: doColega.id, warehouseId: depColega.id, kind: "entrada",
      quantity: 99, occurredAt: "2026-01-01",
    });

    const r = await pedir("/api/todogreen/stock/saldos", { token: gestora.token });
    const { saldos } = await r.json();
    expect(saldos.map((s) => s.itemId)).not.toContain(doColega.id);
  });

  it("quem só consulta lê o saldo mas não movimenta", async () => {
    expect((await pedir("/api/todogreen/stock/saldos", { token: auditor.token })).status).toBe(200);
    const r = await movimentar(auditor.token, {
      itemId: item.id, warehouseId: matriz.id, kind: "entrada",
      quantity: 1, occurredAt: "2026-01-01",
    });
    expect(r.status).toBe(403);
  });

  it("sem sessão, nada", async () => {
    expect((await pedir("/api/todogreen/stock/saldos")).status).toBe(401);
  });
});

describe("transferência", () => {
  it("baixa na origem e entra no destino, ligadas pelo mesmo grupo", async () => {
    const transferido = await criarItem(gestora.token, "Item para transferir");
    await movimentar(gestora.token, {
      itemId: transferido.id, warehouseId: matriz.id, kind: "entrada",
      quantity: 10, unitCost: 50, occurredAt: "2026-03-01",
    });

    const r = await pedir("/api/todogreen/stock/transferencias", {
      metodo: "POST",
      token: gestora.token,
      corpo: {
        itemId: transferido.id, fromWarehouseId: matriz.id,
        toWarehouseId: filial.id, quantity: 4, occurredAt: "2026-03-02",
      },
    });
    expect(r.status).toBe(201);
    const { registro } = await r.json();
    expect(registro.transferGroup).toBeTruthy();

    expect(await saldoDe(gestora.token, transferido.id, matriz.id)).toBe(6);
    expect(await saldoDe(gestora.token, transferido.id, filial.id)).toBe(4);

    // As duas pontas existem e compartilham o grupo.
    const { results } = await env.DB
      .prepare("SELECT kind FROM todogreen_stock_movements WHERE transfer_group = ? ORDER BY kind")
      .bind(registro.transferGroup)
      .all();
    expect(results.map((row) => row.kind)).toEqual(["entrada", "saida"]);
  });

  it("sem saldo na origem, nada é criado no destino", async () => {
    // O risco real: criar estoque no destino sem baixar na origem.
    const vazio = await criarItem(gestora.token, "Item sem saldo");
    const r = await pedir("/api/todogreen/stock/transferencias", {
      metodo: "POST",
      token: gestora.token,
      corpo: {
        itemId: vazio.id, fromWarehouseId: matriz.id,
        toWarehouseId: filial.id, quantity: 5, occurredAt: "2026-03-05",
      },
    });
    expect(r.status).toBe(409);
    expect(await saldoDe(gestora.token, vazio.id, filial.id)).toBe(0);
    expect(await saldoDe(gestora.token, vazio.id, matriz.id)).toBe(0);
  });

  it("recusa origem igual ao destino", async () => {
    const r = await pedir("/api/todogreen/stock/transferencias", {
      metodo: "POST",
      token: gestora.token,
      corpo: {
        itemId: item.id, fromWarehouseId: matriz.id,
        toWarehouseId: matriz.id, quantity: 1,
      },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/diferentes/i);
  });
});

describe("inventário", () => {
  it("abrir guarda o saldo do sistema no momento da contagem", async () => {
    const contado = await criarItem(gestora.token, "Item para contar");
    const deposito = await criarDeposito(gestora.token, "Depósito de contagem");
    await movimentar(gestora.token, {
      itemId: contado.id, warehouseId: deposito.id, kind: "entrada",
      quantity: 10, occurredAt: "2026-04-01",
    });

    const abrir = await pedir("/api/todogreen/stock/contagens", {
      metodo: "POST",
      token: gestora.token,
      corpo: { warehouseId: deposito.id, contadoEm: "2026-04-10" },
    });
    expect(abrir.status).toBe(201);
    const { registro } = await abrir.json();
    expect(registro.situacao).toBe("aberta");
    const linha = registro.linhas.find((l) => l.itemId === contado.id);
    expect(linha.saldoSistema).toBe(10);
    expect(linha.contado).toBeNull();

    // O saldo muda DEPOIS de abrir a contagem.
    await movimentar(gestora.token, {
      itemId: contado.id, warehouseId: deposito.id, kind: "entrada",
      quantity: 5, occurredAt: "2026-04-11",
    });

    // Informar a contagem: 10 contados contra os 10 do retrato = sem
    // divergência, mesmo com o saldo agora em 15.
    const atualizar = await pedir(`/api/todogreen/stock/contagens/${registro.id}`, {
      metodo: "PATCH",
      token: gestora.token,
      corpo: {
        revision: registro.revision,
        linhas: registro.linhas.map((l) => ({ ...l, contado: l.itemId === contado.id ? 10 : null })),
      },
    });
    expect(atualizar.status).toBe(200);
    const atualizada = (await atualizar.json()).registro;

    const fechar = await pedir(`/api/todogreen/stock/contagens/${registro.id}/fechar`, {
      metodo: "POST", token: gestora.token, corpo: {},
    });
    expect(fechar.status).toBe(200);
    const resultado = await fechar.json();
    // Zero ajuste: o contado bateu com o retrato, e o saldo continua 15.
    expect(resultado.ajustes).toBe(0);
    expect(resultado.registro.situacao).toBe("fechada");
    expect(await saldoDe(gestora.token, contado.id, deposito.id)).toBe(15);
    expect(atualizada.revision).toBe(2);
  });

  it("divergência gera movimento de ajuste auditável", async () => {
    const faltando = await criarItem(gestora.token, "Item com falta");
    const deposito = await criarDeposito(gestora.token, "Depósito com falta");
    await movimentar(gestora.token, {
      itemId: faltando.id, warehouseId: deposito.id, kind: "entrada",
      quantity: 20, occurredAt: "2026-05-01",
    });

    const abrir = await pedir("/api/todogreen/stock/contagens", {
      metodo: "POST", token: gestora.token, corpo: { warehouseId: deposito.id },
    });
    const { registro } = await abrir.json();

    await pedir(`/api/todogreen/stock/contagens/${registro.id}`, {
      metodo: "PATCH",
      token: gestora.token,
      corpo: {
        revision: registro.revision,
        linhas: [{ itemId: faltando.id, saldoSistema: 20, contado: 17 }],
      },
    });

    const fechar = await pedir(`/api/todogreen/stock/contagens/${registro.id}/fechar`, {
      metodo: "POST", token: gestora.token, corpo: {},
    });
    expect((await fechar.json()).ajustes).toBe(1);
    expect(await saldoDe(gestora.token, faltando.id, deposito.id)).toBe(17);

    // A correção é um movimento, não uma mudança de valor — é isso que a torna
    // auditável.
    const ajuste = await env.DB
      .prepare(
        `SELECT kind, quantity, origin_type FROM todogreen_stock_movements
          WHERE origin_type = 'inventario' AND origin_id = ?`,
      )
      .bind(registro.id)
      .first();
    expect(ajuste).toMatchObject({ kind: "ajuste_saida", quantity: 3, origin_type: "inventario" });
  });

  it("linha sem contagem informada não gera ajuste", async () => {
    // Tratar "não contei" como zero zeraria o estoque do que ficou de fora.
    const intocado = await criarItem(gestora.token, "Item não contado");
    const deposito = await criarDeposito(gestora.token, "Depósito parcial");
    await movimentar(gestora.token, {
      itemId: intocado.id, warehouseId: deposito.id, kind: "entrada",
      quantity: 8, occurredAt: "2026-06-01",
    });

    const abrir = await pedir("/api/todogreen/stock/contagens", {
      metodo: "POST", token: gestora.token, corpo: { warehouseId: deposito.id },
    });
    const { registro } = await abrir.json();

    const fechar = await pedir(`/api/todogreen/stock/contagens/${registro.id}/fechar`, {
      metodo: "POST", token: gestora.token, corpo: {},
    });
    expect((await fechar.json()).ajustes).toBe(0);
    expect(await saldoDe(gestora.token, intocado.id, deposito.id)).toBe(8);
  });

  it("contagem fechada não é reaberta nem editada", async () => {
    const deposito = await criarDeposito(gestora.token, "Depósito encerrado");
    const abrir = await pedir("/api/todogreen/stock/contagens", {
      metodo: "POST", token: gestora.token, corpo: { warehouseId: deposito.id },
    });
    const { registro } = await abrir.json();
    await pedir(`/api/todogreen/stock/contagens/${registro.id}/fechar`, {
      metodo: "POST", token: gestora.token, corpo: {},
    });

    const refechar = await pedir(`/api/todogreen/stock/contagens/${registro.id}/fechar`, {
      metodo: "POST", token: gestora.token, corpo: {},
    });
    expect(refechar.status).toBe(409);

    const editar = await pedir(`/api/todogreen/stock/contagens/${registro.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { revision: 2, linhas: [] },
    });
    expect(editar.status).toBe(409);
  });

  it("exige a revisão que quem edita leu", async () => {
    const deposito = await criarDeposito(gestora.token, "Depósito de revisão");
    const abrir = await pedir("/api/todogreen/stock/contagens", {
      metodo: "POST", token: gestora.token, corpo: { warehouseId: deposito.id },
    });
    const { registro } = await abrir.json();
    const r = await pedir(`/api/todogreen/stock/contagens/${registro.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { linhas: [] },
    });
    expect(r.status).toBe(400);
  });

  it("recusa contagem em depósito de outro espaço", async () => {
    const doColega = await criarDeposito(colega.token, "Depósito alheio");
    const r = await pedir("/api/todogreen/stock/contagens", {
      metodo: "POST", token: gestora.token, corpo: { warehouseId: doColega.id },
    });
    expect(r.status).toBe(404);
  });
});
