import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// A metade da vertical que ainda morava no JSON do espaço de trabalho.
//
// O que estes testes existem para impedir de voltar:
//   • duas pessoas no mesmo espaço sobrescrevendo o trabalho uma da outra;
//   • um registro de um espaço aparecendo no outro;
//   • proposta salva sem a simulação que gerou o preço;
//   • quem só consulta conseguindo alterar premissa comercial.

let n = 0;
const nextIp = () => `198.19.0.${(++n % 240) + 1}`;

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

async function criarCliente(usuario, id, nome = id) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_clients
       (id, tenant_id, workspace_owner_id, name, status, portal_enabled,
        created_by, updated_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'ativo', 1, ?, ?, ?, ?)`,
  ).bind(id, usuario.id, nome, usuario.id, usuario.id, agora, agora).run();
}

async function vincularPortal(clientId, email) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_client_users
       (id, tenant_id, client_id, email, role, status, permissions_json,
        invited_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'cliente_leitor', 'active', '[]', 'seed', ?, ?)`,
  ).bind(crypto.randomUUID(), clientId, email, agora, agora).run();
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

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();

  gestora = await criarUsuario("rec-gestora", "gestora@parceiro.com.br");
  colega = await criarUsuario("rec-colega", "colega@parceiro.com.br");
  auditor = await criarUsuario("rec-auditor", "auditor@parceiro.com.br");

  await autorizar(gestora);
  await autorizar(colega);
  // Papel que enxerga tudo e não altera nada.
  await autorizar(auditor, "auditor", ["read"]);
});

describe("oportunidades saem do JSON do espaço", () => {
  it("cria, lista e devolve o que foi gravado", async () => {
    const criada = await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: gestora.token,
      corpo: { cliente: "Distribuidora Alfa", valorMensal: 42000, distanciaKm: 120, viagensMes: 40 },
    });
    expect(criada.status).toBe(201);
    const { registro } = await criada.json();
    expect(registro.cliente).toBe("Distribuidora Alfa");
    expect(registro.valorMensal).toBe(42000);
    expect(registro.revision).toBe(1);

    const lista = await pedir("/api/todogreen/records/opportunities", { token: gestora.token });
    const nomes = (await lista.json()).registros.map((r) => r.cliente);
    expect(nomes).toContain("Distribuidora Alfa");
  });

  it("campo sem coluna própria volta inteiro depois de recarregar", async () => {
    const criada = await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: gestora.token,
      corpo: {
        cliente: "Alfa com detalhes",
        // A análise de oportunidade usa estes; a tabela não os indexa.
        ocupacaoPrevistaPercent: 82,
        frotaLimpaPercent: 40,
        veiculosDisponiveis: 6,
        mesesContrato: 24,
        probabilidade: 65,
        productId: "middle-mile",
      },
    });
    const { registro } = await criada.json();
    expect(registro.ocupacaoPrevistaPercent).toBe(82);
    expect(registro.probabilidade).toBe(65);
    expect(registro.productId).toBe("middle-mile");

    const lista = await pedir("/api/todogreen/records/opportunities", { token: gestora.token });
    const voltou = (await lista.json()).registros.find((r) => r.cliente === "Alfa com detalhes");
    expect(voltou.frotaLimpaPercent).toBe(40);
    expect(voltou.mesesContrato).toBe(24);
    // E o nome próprio da coluna continua mandando por cima do payload.
    expect(voltou.cliente).toBe("Alfa com detalhes");
  });

  it("oportunidade sem cliente não é aceita", async () => {
    const r = await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: gestora.token,
      corpo: { valorMensal: 1000 },
    });
    expect(r.status).toBe(400);
  });

  it("o espaço de outra pessoa não aparece na lista", async () => {
    await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: colega.token,
      corpo: { cliente: "Cliente do colega" },
    });
    const lista = await pedir("/api/todogreen/records/opportunities", { token: gestora.token });
    const nomes = (await lista.json()).registros.map((r) => r.cliente);
    expect(nomes).not.toContain("Cliente do colega");
  });
});

describe("paginação e filtro no servidor", () => {
  it("limit e offset recortam a página, e o total conta a lista inteira", async () => {
    const dono = await criarUsuario("rec-pag-dono", "pag-dono@parceiro.com.br");
    await autorizar(dono);
    for (let i = 0; i < 5; i += 1) {
      await pedir("/api/todogreen/records/proposals", {
        metodo: "POST",
        token: dono.token,
        corpo: { cliente: `Cliente pag ${i}`, cenarioId: "cen-pag" },
      });
    }

    const primeiraPagina = await pedir("/api/todogreen/records/proposals?limit=2&offset=0", {
      token: dono.token,
    });
    const corpo1 = await primeiraPagina.json();
    expect(corpo1.registros).toHaveLength(2);
    expect(corpo1.total).toBe(5);
    expect(corpo1.limit).toBe(2);
    expect(corpo1.offset).toBe(0);

    const segundaPagina = await pedir("/api/todogreen/records/proposals?limit=2&offset=2", {
      token: dono.token,
    });
    const corpo2 = await segundaPagina.json();
    expect(corpo2.registros).toHaveLength(2);
    // Páginas diferentes não repetem registro.
    const idsPagina1 = corpo1.registros.map((r) => r.id);
    const idsPagina2 = corpo2.registros.map((r) => r.id);
    expect(idsPagina1.some((id) => idsPagina2.includes(id))).toBe(false);
  });

  it("o filtro por cliente é aplicado no servidor, não recortado depois na tela", async () => {
    const dono = await criarUsuario("rec-filtro-dono", "filtro-dono@parceiro.com.br");
    await autorizar(dono);
    await criarCliente(dono, "cli-filtro-alvo", "Cliente alvo");
    await criarCliente(dono, "cli-filtro-outro", "Cliente outro");
    const doCliente = await (
      await pedir("/api/todogreen/records/operations", {
        metodo: "POST",
        token: dono.token,
        corpo: { clientId: "cli-filtro-alvo", produtoId: "middle-mile" },
      })
    ).json();
    await pedir("/api/todogreen/records/operations", {
      metodo: "POST",
      token: dono.token,
      corpo: { clientId: "cli-filtro-outro", produtoId: "middle-mile" },
    });

    const filtrada = await pedir("/api/todogreen/records/operations?cliente=cli-filtro-alvo", {
      token: dono.token,
    });
    const { registros, total } = await filtrada.json();
    expect(registros.map((r) => r.id)).toEqual([doCliente.registro.id]);
    expect(total).toBe(1);
  });

  it("a operação criada por dentro aparece no Portal do Cliente", async () => {
    const dono = await criarUsuario("rec-portal-dono", "portal-dono@parceiro.com.br");
    const cliente = await criarUsuario("rec-portal-cliente", "operacao@cliente.com.br");
    await autorizar(dono);
    await criarCliente(dono, "cli-portal-canonico", "Cliente canônico");
    await vincularPortal("cli-portal-canonico", cliente.email);

    const criada = await pedir("/api/todogreen/records/operations", {
      metodo: "POST",
      token: dono.token,
      corpo: {
        clientId: "cli-portal-canonico",
        referencia: "OP-CANONICA-1",
        mesReferencia: "2026-08",
        entregas: 12,
        distanciaKm: 88,
      },
    });
    expect(criada.status).toBe(201);

    const portal = await pedir("/api/todogreen/portal/operacoes", { token: cliente.token });
    expect(portal.status).toBe(200);
    const referencias = (await portal.json()).operacoes.map((item) => item.referencia);
    expect(referencias).toContain("OP-CANONICA-1");
  });
});

describe("escrita concorrente não apaga o trabalho alheio", () => {
  it("a segunda gravação em cima da mesma versão é recusada", async () => {
    const { registro } = await (
      await pedir("/api/todogreen/records/opportunities", {
        metodo: "POST",
        token: gestora.token,
        corpo: { cliente: "Concorrência" },
      })
    ).json();

    const primeira = await pedir(`/api/todogreen/records/opportunities/${registro.id}`, {
      metodo: "PATCH",
      token: gestora.token,
      corpo: { estagio: "Proposta enviada", revision: registro.revision },
    });
    expect(primeira.status).toBe(200);
    expect((await primeira.json()).registro.revision).toBe(2);

    // Alguém que leu antes tenta salvar por cima. Era isto que o JSON único
    // aceitava em silêncio.
    const segunda = await pedir(`/api/todogreen/records/opportunities/${registro.id}`, {
      metodo: "PATCH",
      token: gestora.token,
      corpo: { estagio: "Fechada perdida", revision: registro.revision },
    });
    expect(segunda.status).toBe(409);
    expect((await segunda.json()).error).toMatch(/mudou enquanto você editava/i);
  });

  it("registro de outro espaço responde 404, não 403", async () => {
    const { registro } = await (
      await pedir("/api/todogreen/records/opportunities", {
        metodo: "POST",
        token: colega.token,
        corpo: { cliente: "Só do colega" },
      })
    ).json();
    // Dizer "existe, mas não é seu" já entrega que existe.
    const r = await pedir(`/api/todogreen/records/opportunities/${registro.id}`, {
      metodo: "PATCH",
      token: gestora.token,
      corpo: { estagio: "Mapeamento", revision: registro.revision },
    });
    expect(r.status).toBe(404);
  });
});

describe("proposta precisa da simulação que gerou o preço", () => {
  it("sem cenário, não salva", async () => {
    const r = await pedir("/api/todogreen/records/proposals", {
      metodo: "POST",
      token: gestora.token,
      corpo: { cliente: "Alfa", titulo: "Proposta sem conta" },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/simulação/i);
  });

  it("com cenário, salva", async () => {
    const r = await pedir("/api/todogreen/records/proposals", {
      metodo: "POST",
      token: gestora.token,
      corpo: { cliente: "Alfa", titulo: "Proposta com conta", cenarioId: "cen-1" },
    });
    expect(r.status).toBe(201);
    expect((await r.json()).registro.cenarioId).toBe("cen-1");
  });
});

describe("contrato nasce de proposta aceita", () => {
  it("preserva cliente, oportunidade e simulação e impede duplicidade", async () => {
    const clienteId = `cli-contrato-${crypto.randomUUID()}`;
    await criarCliente(gestora, clienteId, "Cliente Contrato");
    const proposalResponse = await pedir("/api/todogreen/records/proposals", {
      metodo: "POST", token: gestora.token,
      corpo: { clientId: clienteId, cliente: "Cliente Contrato", oportunidadeId: "opp-c", titulo: "Proposta aceita", cenarioId: "cen-c", situacao: "accepted" },
    });
    const proposal = (await proposalResponse.json()).registro;
    const body = { clientId: clienteId, propostaId: proposal.id, titulo: "Contrato logístico", valorTotal: 120000 };
    const contractResponse = await pedir("/api/todogreen/records/contracts", { metodo: "POST", token: gestora.token, corpo: body });
    expect(contractResponse.status).toBe(201);
    expect((await contractResponse.json()).registro).toEqual(expect.objectContaining({
      clientId: clienteId, oportunidadeId: "opp-c", cenarioId: "cen-c", propostaId: proposal.id,
    }));
    const duplicated = await pedir("/api/todogreen/records/contracts", { metodo: "POST", token: gestora.token, corpo: body });
    expect(duplicated.status).toBe(409);
  });

  it("versiona alterações e preserva a trilha do ciclo contratual", async () => {
    const clienteId = `cli-ciclo-${crypto.randomUUID()}`;
    await criarCliente(gestora, clienteId, "Cliente Ciclo");
    const proposta = (await (await pedir("/api/todogreen/records/proposals", {
      metodo: "POST", token: gestora.token,
      corpo: { clientId: clienteId, cliente: "Cliente Ciclo", titulo: "Proposta ciclo", cenarioId: "cen-ciclo", situacao: "accepted" },
    })).json()).registro;
    const contrato = (await (await pedir("/api/todogreen/records/contracts", {
      metodo: "POST", token: gestora.token,
      corpo: { clientId: clienteId, propostaId: proposta.id, titulo: "Contrato ciclo", renovacao: "automatic" },
    })).json()).registro;

    const atualizado = await pedir(`/api/todogreen/records/contracts/${contrato.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { revision: contrato.revision, assinatura: "signed", assinadoEm: "2026-08-14", nota: "Assinado pelo cliente" },
    });
    expect(atualizado.status).toBe(200);
    expect((await atualizado.json()).registro).toEqual(expect.objectContaining({ assinatura: "signed", versao: 2, revision: 2 }));

    const historico = await pedir(`/api/todogreen/records/contracts/${contrato.id}/events`, { token: gestora.token });
    expect(historico.status).toBe(200);
    expect((await historico.json()).eventos.map((evento) => evento.acao)).toEqual(expect.arrayContaining(["created", "updated"]));
  });
});

describe("oportunidade ganha abre handoff operacional", () => {
  it("cria um único item na Central de Trabalho", async () => {
    const { registro } = await (await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST", token: gestora.token, corpo: { cliente: "Cliente Handoff", estagio: "Negociação" },
    })).json();
    const won = await pedir(`/api/todogreen/records/opportunities/${registro.id}`, {
      metodo: "PATCH", token: gestora.token, corpo: { estagio: "Fechada ganha", revision: registro.revision },
    });
    expect(won.status).toBe(200);
    const item = await env.DB.prepare(
      "SELECT type,status,client_label FROM todogreen_work_items WHERE id=? AND workspace_owner_id=?",
    ).bind(`todogreen-handoff-opportunity-${registro.id}`, gestora.id).first();
    expect(item).toEqual(expect.objectContaining({ type: "handoff", status: "novo", client_label: "Cliente Handoff" }));
  });
});

// A tela recusa gerar a proposta quando a aprovação comercial não liberou a simulação —
// mas isso morava só no componente React. Estes testes existem para que uma
// chamada direta ao endpoint não passe por cima do mesmo controle.
async function pedidoDeDealDesk(cenarioId, { situacao = "pendente" } = {}) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_deal_desk_requests
       (id, tenant_id, workspace_owner_id, scenario_id, client_name, alcada_id, deviation_points,
        alcada_reason, triggers_json, justification, requester_id, status, version,
        decided_by, decision_note, decided_at, due_at, revision, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'Alfa', 'gestao_comercial', 2, 'margem', '[]',
             'Justificativa com trinta caracteres reais.', ?, ?, 1, ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      gestora.id,
      cenarioId,
      gestora.id,
      situacao,
      situacao === "aprovado" ? gestora.id : null,
      situacao === "aprovado" ? "aprovado no teste" : "",
      situacao === "aprovado" ? agora : null,
      new Date(Date.now() + 86_400_000).toISOString(),
      agora,
      agora,
    )
    .run();
}

describe("proposta não sai por cima de uma aprovação comercial pendente", () => {
  it("pedido pendente para a simulação bloqueia a proposta direto no servidor", async () => {
    const cenarioId = `cen-dd-pendente-${crypto.randomUUID()}`;
    await pedidoDeDealDesk(cenarioId);
    const r = await pedir("/api/todogreen/records/proposals", {
      metodo: "POST",
      token: gestora.token,
      corpo: { cliente: "Alfa", titulo: "Proposta sem liberação", cenarioId },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/aprovação comercial|decisão comercial/i);
  });

  it("pedido aprovado libera a proposta", async () => {
    const cenarioId = `cen-dd-aprovado-${crypto.randomUUID()}`;
    await pedidoDeDealDesk(cenarioId, { situacao: "aprovado" });
    const r = await pedir("/api/todogreen/records/proposals", {
      metodo: "POST",
      token: gestora.token,
      corpo: { cliente: "Alfa", titulo: "Proposta liberada", cenarioId },
    });
    expect(r.status).toBe(201);
  });
});

describe("lançamentos financeiros", () => {
  it("receita, custo e comissão convivem na mesma coleção", async () => {
    for (const tipo of ["revenue", "cost", "commission"]) {
      const r = await pedir("/api/todogreen/records/financial", {
        metodo: "POST",
        token: gestora.token,
        corpo: { tipo, valor: 1000, descricao: `lançamento ${tipo}`, mesReferencia: "2026-08" },
      });
      expect(r.status).toBe(201);
      expect((await r.json()).registro.tipo).toBe(tipo);
    }
    const lista = await pedir("/api/todogreen/records/financial", { token: gestora.token });
    const tipos = (await lista.json()).registros.map((r) => r.tipo);
    expect(new Set(tipos)).toEqual(new Set(["revenue", "cost", "commission"]));
  });

  it("lançamento sem valor não entra", async () => {
    const r = await pedir("/api/todogreen/records/financial", {
      metodo: "POST",
      token: gestora.token,
      corpo: { tipo: "cost", valor: 0 },
    });
    expect(r.status).toBe(400);
  });

  it("registra baixas parciais com histórico e impede pagamento acima do saldo", async () => {
    const criado = await pedir("/api/todogreen/records/financial", {
      metodo: "POST", token: gestora.token,
      corpo: { tipo: "cost", valor: 1000, descricao: "Fornecedor rastreável", vencimentoEm: "2026-08-20" },
    });
    const lancamento = (await criado.json()).registro;
    const baixa = await pedir(`/api/todogreen/records/financial/${lancamento.id}/payments`, {
      metodo: "POST", token: gestora.token,
      corpo: { revision: lancamento.revision, valor: 400, pagoEm: "2026-08-14", meioPagamento: "pix", referencia: "PIX-001" },
    });
    expect(baixa.status).toBe(201);
    const aposBaixa = (await baixa.json()).registro;
    expect(aposBaixa).toEqual(expect.objectContaining({ valorPago: 400, statusFinanceiro: "partial", revision: 2 }));

    const acimaDoSaldo = await pedir(`/api/todogreen/records/financial/${lancamento.id}/payments`, {
      metodo: "POST", token: gestora.token,
      corpo: { revision: aposBaixa.revision, valor: 601, pagoEm: "2026-08-15" },
    });
    expect(acimaDoSaldo.status).toBe(409);

    const historico = await pedir(`/api/todogreen/records/financial/${lancamento.id}/payments`, { token: gestora.token });
    expect(historico.status).toBe(200);
    expect((await historico.json()).pagamentos).toEqual([
      expect.objectContaining({ valor: 400, meioPagamento: "pix", referencia: "PIX-001" }),
    ]);
  });
});

describe("linha do tempo operacional", () => {
  it("registra ocorrências sem perder o histórico da execução", async () => {
    const clienteId = `cli-evento-${crypto.randomUUID()}`;
    await criarCliente(gestora, clienteId, "Cliente Evento");
    const operacao = (await (await pedir("/api/todogreen/records/operations", {
      metodo: "POST", token: gestora.token,
      corpo: { clientId: clienteId, referencia: "OP-EVENTO", viagens: 1 },
    })).json()).registro;
    const evento = await pedir(`/api/todogreen/records/operations/${operacao.id}/events`, {
      metodo: "POST", token: gestora.token,
      corpo: { tipo: "ocorrencia", titulo: "Atraso no acesso", descricao: "Fila na portaria", local: "CD Sul" },
    });
    expect(evento.status).toBe(201);
    expect((await evento.json()).registro).toEqual(expect.objectContaining({ ocorrencias: 1, revision: 2 }));

    const historico = await pedir(`/api/todogreen/records/operations/${operacao.id}/events`, { token: gestora.token });
    expect(historico.status).toBe(200);
    expect((await historico.json()).eventos).toEqual([
      expect.objectContaining({ tipo: "ocorrencia", titulo: "Atraso no acesso", local: "CD Sul" }),
    ]);
  });
});

describe("papel que só consulta não altera", () => {
  it("o auditor lê a lista", async () => {
    expect((await pedir("/api/todogreen/records/opportunities", { token: auditor.token })).status).toBe(200);
  });

  it("o auditor não cria", async () => {
    const r = await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: auditor.token,
      corpo: { cliente: "Não deveria entrar" },
    });
    expect(r.status).toBe(403);
  });
});

describe("arquivar em vez de apagar", () => {
  it("o registro some da lista mas continua no banco", async () => {
    await criarCliente(gestora, "c-1", "Cliente arquivamento");
    const { registro } = await (
      await pedir("/api/todogreen/records/operations", {
        metodo: "POST",
        token: gestora.token,
        corpo: { clientId: "c-1", viagens: 10, distanciaKm: 500 },
      })
    ).json();

    expect((await pedir(`/api/todogreen/records/operations/${registro.id}`, { metodo: "DELETE", token: gestora.token })).status).toBe(200);

    const lista = await pedir("/api/todogreen/records/operations", { token: gestora.token });
    expect((await lista.json()).registros.map((r) => r.id)).not.toContain(registro.id);

    const linha = await env.DB.prepare("SELECT archived_at FROM todogreen_client_operations WHERE id = ?")
      .bind(registro.id)
      .first();
    expect(linha.archived_at).toBeTruthy();
  });
});

describe("a simulação é retrato, não cadastro", () => {
  it("salva com a procedência das premissas junto", async () => {
    const r = await pedir("/api/todogreen/records/scenarios", {
      metodo: "POST",
      token: gestora.token,
      corpo: {
        productId: "middle-mile",
        inputs: { distanceKm: 120, tripsPerMonth: 40 },
        result: { recommendedPrice: 90000, marginPercent: 24 },
        premissas: { confirmadas: true, confirmadasPor: "rec-gestora", confirmadasEm: "2026-08-07T10:00:00.000Z" },
        ruleVersion: "v3",
      },
    });
    expect(r.status).toBe(201);
    const { registro } = await r.json();
    expect(registro.premissas.confirmadas).toBe(true);
    expect(registro.result.recommendedPrice).toBe(90000);
    expect(registro.ruleVersion).toBe("v3");
  });

  it("simulação sem resultado calculado não entra", async () => {
    const r = await pedir("/api/todogreen/records/scenarios", {
      metodo: "POST",
      token: gestora.token,
      corpo: { productId: "middle-mile", inputs: { distanceKm: 1 } },
    });
    expect(r.status).toBe(400);
  });

  it("simulação salva não pode ser editada", async () => {
    const r = await pedir("/api/todogreen/records/scenarios/qualquer", {
      metodo: "PATCH",
      token: gestora.token,
      corpo: { status: "approved", revision: 1 },
    });
    // Editar o retrato seria reescrever o passado.
    expect(r.status).toBe(405);
  });

  it("a simulação de outro espaço não aparece", async () => {
    await pedir("/api/todogreen/records/scenarios", {
      metodo: "POST",
      token: colega.token,
      corpo: { productId: "last-mile", result: { recommendedPrice: 1 }, clientId: "so-do-colega" },
    });
    const lista = await pedir("/api/todogreen/records/scenarios", { token: gestora.token });
    const clientes = (await lista.json()).registros.map((r) => r.clientId);
    expect(clientes).not.toContain("so-do-colega");
  });
});

describe("a vertical inteira numa chamada só", () => {
  it("devolve todas as coleções do próprio espaço", async () => {
    const r = await pedir("/api/todogreen/records", { token: gestora.token });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(Object.keys(corpo).sort()).toEqual([
      "accounts",
      "contracts",
      "costCenters",
      "financial",
      "items",
      "operations",
      "opportunities",
      "parties",
      "proposals",
      "scenarios",
      "warehouses",
    ]);
    expect(Array.isArray(corpo.opportunities)).toBe(true);
  });

  it("sem sessão, nada", async () => {
    expect((await pedir("/api/todogreen/records")).status).toBe(401);
  });
});

describe("carteira: o vendedor nao ve a oportunidade do colega", () => {
  it("lista so o que esta na propria carteira", async () => {
    const agora = new Date().toISOString();
    // Dois clientes no mesmo espaco da gestora.
    const meu = crypto.randomUUID();
    const doColega = crypto.randomUUID();
    for (const [id, nome] of [[meu, "Cliente do vendedor"], [doColega, "Cliente do colega"]]) {
      await env.DB.prepare(
        `INSERT INTO todogreen_clients
           (id, tenant_id, workspace_owner_id, name, legal_name, document, segment, status,
            portal_enabled, created_by, updated_by, created_at, updated_at)
         VALUES (?, 'todogreen', ?, ?, ?, '', 'varejo', 'ativo', 0, ?, ?, ?, ?)`,
      ).bind(id, gestora.id, nome, nome, gestora.id, gestora.id, agora, agora).run();
    }

    // Um vendedor com carteira, no MESMO espaco da gestora — e por vinculo de
    // tenant, nao por autorizacao de dominio, que daria a ele o proprio
    // espaco em vez do da gestora.
    const vendedor = await criarUsuario("rec-vendedor", "vendedor@parceiro.com.br");
    await env.DB.prepare(
      `INSERT INTO tenant_users
         (id, tenant_id, workspace_owner_id, user_id, role, status, permissions_json, created_at, updated_at)
       VALUES (?, 'todogreen', ?, ?, 'vendedor', 'active', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), gestora.id, vendedor.id, JSON.stringify(["read", "crm:manage"]), agora, agora)
      .run();
    await env.DB.prepare(
      `INSERT INTO todogreen_client_assignments
         (id, tenant_id, client_id, seller_email, status, note, assigned_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, ?, 'active', '', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), meu, vendedor.email, gestora.id, agora, agora).run();

    // A gestora registra duas oportunidades, uma para cada cliente.
    for (const [cliente, nome] of [[meu, "Oportunidade minha"], [doColega, "Oportunidade do colega"]]) {
      const r = await pedir("/api/todogreen/records/opportunities", {
        metodo: "POST",
        token: gestora.token,
        corpo: { cliente: nome, clientId: cliente },
      });
      expect(r.status).toBe(201);
    }

    const lista = await pedir("/api/todogreen/records/opportunities", { token: vendedor.token });
    expect(lista.status).toBe(200);
    const nomes = (await lista.json()).registros.map((r) => r.cliente);
    expect(nomes).toContain("Oportunidade minha");
    // Mesmo espaco de trabalho, carteira diferente: nao aparece.
    expect(nomes).not.toContain("Oportunidade do colega");
  });

  it("a gestora continua vendo a carteira inteira", async () => {
    const lista = await pedir("/api/todogreen/records/opportunities", { token: gestora.token });
    const nomes = (await lista.json()).registros.map((r) => r.cliente);
    expect(nomes).toContain("Oportunidade do colega");
  });
});

// A concessão de acesso pelo formulário real (/api/todogreen/access-list) não
// manda `permissions` — só e-mail, papel e observação. O servidor precisa
// derivar a permissão do papel escolhido sozinho. Chegou a ficar sem essa
// derivação: todo papel virava ["read"], a tela mostrava os botões de
// escrita como se funcionassem (ela deriva do papel para decidir o que
// exibir) e o servidor recusava tudo com 403 — a pessoa parecia ter acesso e
// não conseguia salvar nada. Nenhum teste passava pelo endpoint real de
// concessão para pegar isso; os outros injetam a permissão direto no banco.
describe("a concessão real deriva a permissão do papel, não fixa ['read']", () => {
  it("vendedor autorizado pelo formulário consegue registrar a própria oportunidade", async () => {
    const dona = await criarUsuario(`tg-conc-dona-${n}`, `conc-dona-${n}@example.com`);
    await autorizar(dona);

    const emailVendedor = `conc-vendedor-${n}@example.com`;
    const concessao = await pedir("/api/todogreen/access-list", {
      metodo: "POST",
      token: dona.token,
      corpo: { email: emailVendedor, role: "vendedor", note: "" },
    });
    expect(concessao.status).toBe(201);

    const vendedor = await criarUsuario(`tg-conc-vend-${n}`, emailVendedor);
    const registrar = await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: vendedor.token,
      corpo: { cliente: "Conta registrada pelo vendedor" },
    });
    expect(registrar.status).toBe(201);
  });

  it("papel inválido no corpo cai no mais restrito, não em admin", async () => {
    const dona = await criarUsuario(`tg-conc-dona2-${n}`, `conc-dona2-${n}@example.com`);
    await autorizar(dona);

    const emailEstranho = `conc-estranho-${n}@example.com`;
    await pedir("/api/todogreen/access-list", {
      metodo: "POST",
      token: dona.token,
      corpo: { email: emailEstranho, role: "papel-que-nao-existe", note: "" },
    });

    const estranho = await criarUsuario(`tg-conc-estr-${n}`, emailEstranho);
    const tentativa = await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: estranho.token,
      corpo: { cliente: "Não deveria conseguir" },
    });
    expect(tentativa.status).toBe(403);
  });
});
