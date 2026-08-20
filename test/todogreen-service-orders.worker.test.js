import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Ordem de serviço: material que sai do estoque, hora que vira custo.
//
// O que estes testes existem para impedir de voltar:
//   • consumir material que não há em estoque (o mesmo erro de vender o que não
//     se tem), ou registrar na OS um consumo que o estoque não teve;
//   • custo do serviço mudando meses depois porque o preço do fornecedor mudou;
//   • avanço gravado dizendo 100% enquanto as horas dizem outra coisa;
//   • apontamento de 240 horas num dia passando por erro de digitação;
//   • ordem de outro espaço aparecendo na lista.

let n = 0;
const nextIp = () => `198.24.0.${(++n % 240) + 1}`;

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
let deposito;
let bateria;

const criarItem = async (token, nome) =>
  (await (await pedir("/api/todogreen/records/items", {
    metodo: "POST", token, corpo: { nome, unidade: "UN" },
  })).json()).registro;

const criarDeposito = async (token, nome) =>
  (await (await pedir("/api/todogreen/records/warehouses", {
    metodo: "POST", token, corpo: { nome },
  })).json()).registro;

const entrada = (token, itemId, warehouseId, quantity, unitCost, occurredAt = "2026-01-05") =>
  pedir("/api/todogreen/stock/movimentos", {
    metodo: "POST", token,
    corpo: { itemId, warehouseId, kind: "entrada", quantity, unitCost, occurredAt },
  });

// Cria a OS e a leva a "em execução", que é onde se consome e aponta.
const ordemEmExecucao = async (token, corpo = {}) => {
  const criada = await pedir("/api/todogreen/service-orders", {
    metodo: "POST", token,
    corpo: { title: "Instalação de carregador", warehouseId: deposito.id, ...corpo },
  });
  const ordem = (await criada.json()).registro;
  const r = await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
    metodo: "PATCH", token, corpo: { status: "em_execucao", revision: ordem.revision },
  });
  return (await r.json()).registro;
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

  gestora = await criarUsuario("os-gestora", "gestora@os.test");
  colega = await criarUsuario("os-colega", "colega@os.test");
  auditor = await criarUsuario("os-auditor", "auditor@os.test");
  await autorizar(gestora);
  await autorizar(colega);
  await autorizar(auditor, "auditor", ["read"]);

  deposito = await criarDeposito(gestora.token, "Almoxarifado da oficina");
  bateria = await criarItem(gestora.token, "Bateria 60V");
});

describe("ciclo da ordem", () => {
  it("nasce aberta e marca o início ao entrar em execução", async () => {
    const criada = await pedir("/api/todogreen/service-orders", {
      metodo: "POST", token: gestora.token,
      corpo: { title: "Adequação de van", estimatedHours: 20, estimatedCost: 5000 },
    });
    expect(criada.status).toBe(201);
    const ordem = (await criada.json()).registro;
    expect(ordem.status).toBe("aberta");
    expect(ordem.startedAt).toBe("");

    const emExecucao = await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { status: "em_execucao", revision: ordem.revision },
    });
    // A data é consequência da decisão, não campo para digitar.
    expect((await emExecucao.json()).registro.startedAt).toBeTruthy();
  });

  it("concluir marca o fim, e reabrir o limpa", async () => {
    const ordem = await ordemEmExecucao(gestora.token);
    const concluida = await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { status: "concluida", revision: ordem.revision },
    });
    const fechada = (await concluida.json()).registro;
    expect(fechada.finishedAt).toBeTruthy();

    // Apontar hora esquecida é rotina; travar isso quebraria o histórico de
    // custo do serviço.
    const reaberta = await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { status: "em_execucao", revision: fechada.revision },
    });
    expect((await reaberta.json()).registro.finishedAt).toBe("");
  });

  it("não pula de aberta direto para concluída", async () => {
    const criada = await pedir("/api/todogreen/service-orders", {
      metodo: "POST", token: gestora.token, corpo: { title: "Pulo" },
    });
    const ordem = (await criada.json()).registro;
    const r = await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { status: "concluida", revision: ordem.revision },
    });
    expect(r.status).toBe(409);
  });

  it("exige título e recusa prazo final antes do início", async () => {
    expect((await pedir("/api/todogreen/service-orders", {
      metodo: "POST", token: gestora.token, corpo: {},
    })).status).toBe(400);

    const r = await pedir("/api/todogreen/service-orders", {
      metodo: "POST", token: gestora.token,
      corpo: { title: "X", scheduledStart: "2026-03-10", scheduledEnd: "2026-03-01" },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/antes do início/i);
  });

  it("estimativa ausente volta null, não zero", async () => {
    // "Não estimamos" e "estimamos zero" são coisas diferentes.
    const criada = await pedir("/api/todogreen/service-orders", {
      metodo: "POST", token: gestora.token, corpo: { title: "Sem estimativa" },
    });
    const ordem = (await criada.json()).registro;
    expect(ordem.estimatedHours).toBeNull();
    expect(ordem.estimatedCost).toBeNull();
    expect(ordem.custo.previsto).toBeNull();
    expect(ordem.custo.estourou).toBe(false);
  });

  it("recusa cliente e depósito de outro espaço", async () => {
    const depAlheio = await criarDeposito(colega.token, "Depósito alheio");
    const r = await pedir("/api/todogreen/service-orders", {
      metodo: "POST", token: gestora.token,
      corpo: { title: "X", warehouseId: depAlheio.id },
    });
    expect(r.status).toBe(404);
  });
});

describe("consumo de material", () => {
  it("baixa o estoque e congela o custo médio na linha da OS", async () => {
    const item = await criarItem(gestora.token, "Cabo 6mm");
    // Duas entradas: 10 a 100 e 10 a 200 → custo médio 150.
    await entrada(gestora.token, item.id, deposito.id, 10, 100, "2026-01-01");
    await entrada(gestora.token, item.id, deposito.id, 10, 200, "2026-02-01");

    const ordem = await ordemEmExecucao(gestora.token);
    const r = await pedir(`/api/todogreen/service-orders/${ordem.id}/materiais`, {
      metodo: "POST", token: gestora.token,
      corpo: { itemId: item.id, quantity: 4, consumedAt: "2026-03-10" },
    });
    expect(r.status).toBe(201);
    const atualizada = (await r.json()).registro;

    expect(atualizada.materiais).toHaveLength(1);
    expect(atualizada.materiais[0].unitCost).toBe(150);
    expect(atualizada.custo.material).toBe(600);
    // O estoque caiu de verdade.
    expect(await saldoDe(gestora.token, item.id, deposito.id)).toBe(16);

    // O movimento aponta para a linha do consumo, o que torna a baixa auditável.
    const movimento = await env.DB.prepare(
      `SELECT kind, quantity, origin_type FROM todogreen_stock_movements
        WHERE origin_type = 'ordem_servico' AND origin_id = ?`,
    ).bind(atualizada.materiais[0].id).first();
    expect(movimento).toMatchObject({ kind: "saida", quantity: 4, origin_type: "ordem_servico" });
  });

  it("o custo congelado não muda quando o preço do fornecedor muda depois", async () => {
    // Recalcular faria o custo do serviço mudar meses após o trabalho.
    const item = await criarItem(gestora.token, "Conector");
    await entrada(gestora.token, item.id, deposito.id, 10, 50, "2026-01-01");
    const ordem = await ordemEmExecucao(gestora.token);
    await pedir(`/api/todogreen/service-orders/${ordem.id}/materiais`, {
      metodo: "POST", token: gestora.token,
      corpo: { itemId: item.id, quantity: 2, consumedAt: "2026-03-10" },
    });

    // Compra nova, muito mais caro.
    await entrada(gestora.token, item.id, deposito.id, 100, 500, "2026-04-01");

    const depois = (await (await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      token: gestora.token,
    })).json()).registro;
    expect(depois.materiais[0].unitCost).toBe(50);
    expect(depois.custo.material).toBe(100);
  });

  it("recusa consumo acima do saldo e não registra na OS", async () => {
    // O risco real: a linha da OS registrar um consumo que o estoque não teve.
    const item = await criarItem(gestora.token, "Peça escassa");
    await entrada(gestora.token, item.id, deposito.id, 3, 10, "2026-01-01");
    const ordem = await ordemEmExecucao(gestora.token);

    const r = await pedir(`/api/todogreen/service-orders/${ordem.id}/materiais`, {
      metodo: "POST", token: gestora.token,
      corpo: { itemId: item.id, quantity: 5, consumedAt: "2026-03-10" },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).saldoDisponivel).toBe(3);

    const depois = (await (await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      token: gestora.token,
    })).json()).registro;
    expect(depois.materiais).toHaveLength(0);
    expect(await saldoDe(gestora.token, item.id, deposito.id)).toBe(3);
  });

  it("devolução volta ao estoque com o custo com que saiu", async () => {
    const item = await criarItem(gestora.token, "Parafuso");
    await entrada(gestora.token, item.id, deposito.id, 100, 2, "2026-01-01");
    const ordem = await ordemEmExecucao(gestora.token);
    const consumido = (await (await pedir(`/api/todogreen/service-orders/${ordem.id}/materiais`, {
      metodo: "POST", token: gestora.token,
      corpo: { itemId: item.id, quantity: 20, consumedAt: "2026-03-10" },
    })).json()).registro;
    const consumoId = consumido.materiais[0].id;
    expect(await saldoDe(gestora.token, item.id, deposito.id)).toBe(80);

    const r = await pedir(`/api/todogreen/service-orders/${ordem.id}/devolucoes`, {
      metodo: "POST", token: gestora.token, corpo: { consumoId, quantity: 5 },
    });
    expect(r.status).toBe(200);
    const depois = (await r.json()).registro;
    // O material devolvido não custou à ordem.
    expect(depois.materiais[0].quantity).toBe(15);
    expect(depois.custo.material).toBe(30);
    expect(await saldoDe(gestora.token, item.id, deposito.id)).toBe(85);
  });

  it("devolver tudo remove a linha do consumo", async () => {
    // Uma linha com quantidade zero faria o relatório contar um consumo que não
    // houve.
    const item = await criarItem(gestora.token, "Fita");
    await entrada(gestora.token, item.id, deposito.id, 10, 5, "2026-01-01");
    const ordem = await ordemEmExecucao(gestora.token);
    const consumido = (await (await pedir(`/api/todogreen/service-orders/${ordem.id}/materiais`, {
      metodo: "POST", token: gestora.token,
      corpo: { itemId: item.id, quantity: 4, consumedAt: "2026-03-10" },
    })).json()).registro;

    const r = await pedir(`/api/todogreen/service-orders/${ordem.id}/devolucoes`, {
      metodo: "POST", token: gestora.token,
      corpo: { consumoId: consumido.materiais[0].id, quantity: 4 },
    });
    expect((await r.json()).registro.materiais).toHaveLength(0);
    expect(await saldoDe(gestora.token, item.id, deposito.id)).toBe(10);
  });

  it("recusa devolver mais do que foi consumido", async () => {
    const item = await criarItem(gestora.token, "Abraçadeira");
    await entrada(gestora.token, item.id, deposito.id, 10, 1, "2026-01-01");
    const ordem = await ordemEmExecucao(gestora.token);
    const consumido = (await (await pedir(`/api/todogreen/service-orders/${ordem.id}/materiais`, {
      metodo: "POST", token: gestora.token,
      corpo: { itemId: item.id, quantity: 2, consumedAt: "2026-03-10" },
    })).json()).registro;

    const r = await pedir(`/api/todogreen/service-orders/${ordem.id}/devolucoes`, {
      metodo: "POST", token: gestora.token,
      corpo: { consumoId: consumido.materiais[0].id, quantity: 3 },
    });
    expect(r.status).toBe(409);
  });

  it("ordem concluída não consome sem reabrir", async () => {
    const ordem = await ordemEmExecucao(gestora.token);
    const concluida = (await (await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { status: "concluida", revision: ordem.revision },
    })).json()).registro;
    expect(concluida.status).toBe("concluida");

    const r = await pedir(`/api/todogreen/service-orders/${ordem.id}/materiais`, {
      metodo: "POST", token: gestora.token,
      corpo: { itemId: bateria.id, quantity: 1, consumedAt: "2026-03-10" },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/Reabra/i);
  });

  it("consumo não é editado nem apagado", async () => {
    const ordem = await ordemEmExecucao(gestora.token);
    const r = await pedir(`/api/todogreen/service-orders/${ordem.id}/materiais`, {
      metodo: "DELETE", token: gestora.token, corpo: {},
    });
    expect(r.status).toBe(405);
    expect((await r.json()).error).toMatch(/Devolva/i);
  });
});

describe("apontamento de hora e avanço", () => {
  it("hora vira custo e o avanço sai das horas apontadas", async () => {
    const ordem = await ordemEmExecucao(gestora.token, { estimatedHours: 20 });
    const r = await pedir(`/api/todogreen/service-orders/${ordem.id}/horas`, {
      metodo: "POST", token: gestora.token,
      corpo: { userId: gestora.id, hours: 5, hourlyCost: 60, workedOn: "2026-03-10" },
    });
    expect(r.status).toBe(201);
    const atualizada = (await r.json()).registro;
    expect(atualizada.custo.maoDeObra).toBe(300);
    // 5 de 20 horas = 25%, derivado, nunca gravado.
    expect(atualizada.avanco).toMatchObject({ percentual: 25, horas: 5, horasPrevistas: 20 });
  });

  it("passar das horas previstas limita a barra mas avisa", async () => {
    const ordem = await ordemEmExecucao(gestora.token, { estimatedHours: 4 });
    await pedir(`/api/todogreen/service-orders/${ordem.id}/horas`, {
      metodo: "POST", token: gestora.token,
      corpo: { personName: "Prestador", hours: 10, hourlyCost: 10, workedOn: "2026-03-10" },
    });
    const depois = (await (await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      token: gestora.token,
    })).json()).registro;
    expect(depois.avanco).toMatchObject({ percentual: 100, limitado: true });
  });

  it("sem estimativa de horas, o avanço é null — não uma barra que finge saber", async () => {
    const ordem = await ordemEmExecucao(gestora.token);
    await pedir(`/api/todogreen/service-orders/${ordem.id}/horas`, {
      metodo: "POST", token: gestora.token,
      corpo: { userId: gestora.id, hours: 3, hourlyCost: 50, workedOn: "2026-03-10" },
    });
    const depois = (await (await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      token: gestora.token,
    })).json()).registro;
    expect(depois.avanco.percentual).toBeNull();
    expect(depois.avanco.horas).toBe(3);
  });

  it("aceita quem não tem login e recusa quem não foi informado", async () => {
    // Terceirizado e prestador apontam hora e não têm conta.
    const ordem = await ordemEmExecucao(gestora.token);
    expect((await pedir(`/api/todogreen/service-orders/${ordem.id}/horas`, {
      metodo: "POST", token: gestora.token,
      corpo: { personName: "Eletricista contratado", hours: 6, hourlyCost: 80, workedOn: "2026-03-10" },
    })).status).toBe(201);

    expect((await pedir(`/api/todogreen/service-orders/${ordem.id}/horas`, {
      metodo: "POST", token: gestora.token,
      corpo: { hours: 6, workedOn: "2026-03-10" },
    })).status).toBe(400);
  });

  it("recusa mais de 24 horas num dia", async () => {
    // 240 por erro de digitação estragaria o custo sem ninguém notar.
    const ordem = await ordemEmExecucao(gestora.token);
    const r = await pedir(`/api/todogreen/service-orders/${ordem.id}/horas`, {
      metodo: "POST", token: gestora.token,
      corpo: { userId: gestora.id, hours: 240, hourlyCost: 50, workedOn: "2026-03-10" },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/24 horas/i);
  });

  it("compara realizado com previsto e aponta estouro", async () => {
    const ordem = await ordemEmExecucao(gestora.token, { estimatedCost: 200 });
    await pedir(`/api/todogreen/service-orders/${ordem.id}/horas`, {
      metodo: "POST", token: gestora.token,
      corpo: { userId: gestora.id, hours: 10, hourlyCost: 50, workedOn: "2026-03-10" },
    });
    const depois = (await (await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      token: gestora.token,
    })).json()).registro;
    expect(depois.custo).toMatchObject({ realizado: 500, previsto: 200, desvio: 300, estourou: true });
  });
});

describe("prazo, resumo e escopo", () => {
  it("aponta a ordem atrasada e a conta no resumo", async () => {
    await ordemEmExecucao(gestora.token, { title: "Atrasada", scheduledEnd: "2026-01-10" });
    const r = await pedir("/api/todogreen/service-orders?hoje=2026-03-01", { token: gestora.token });
    const corpo = await r.json();
    const atrasada = corpo.registros.find((o) => o.title === "Atrasada");
    expect(atrasada.prazo).toMatchObject({ situacao: "atrasada" });
    expect(corpo.resumo.atrasadas).toBeGreaterThanOrEqual(1);
  });

  it("um espaço não vê a ordem do outro", async () => {
    await pedir("/api/todogreen/service-orders", {
      metodo: "POST", token: colega.token, corpo: { title: "Ordem do colega" },
    });
    const r = await pedir("/api/todogreen/service-orders", { token: gestora.token });
    expect((await r.json()).registros.map((o) => o.title)).not.toContain("Ordem do colega");
  });

  it("quem só consulta lê mas não movimenta", async () => {
    expect((await pedir("/api/todogreen/service-orders", { token: auditor.token })).status).toBe(200);
    const r = await pedir("/api/todogreen/service-orders", {
      metodo: "POST", token: auditor.token, corpo: { title: "Não deveria" },
    });
    expect(r.status).toBe(403);
  });

  it("arquivar tira da lista", async () => {
    const criada = await pedir("/api/todogreen/service-orders", {
      metodo: "POST", token: gestora.token, corpo: { title: "Para arquivar" },
    });
    const ordem = (await criada.json()).registro;
    expect((await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      metodo: "DELETE", token: gestora.token,
    })).status).toBe(200);
    const r = await pedir("/api/todogreen/service-orders", { token: gestora.token });
    expect((await r.json()).registros.map((o) => o.id)).not.toContain(ordem.id);
  });

  it("a segunda gravação com a mesma revisão recebe 409", async () => {
    const criada = await pedir("/api/todogreen/service-orders", {
      metodo: "POST", token: gestora.token, corpo: { title: "Disputada" },
    });
    const ordem = (await criada.json()).registro;
    expect((await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { notes: "primeira", revision: ordem.revision },
    })).status).toBe(200);
    expect((await pedir(`/api/todogreen/service-orders/${ordem.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { notes: "segunda", revision: ordem.revision },
    })).status).toBe(409);
  });

  it("sem sessão, nada", async () => {
    expect((await pedir("/api/todogreen/service-orders")).status).toBe(401);
  });
});
