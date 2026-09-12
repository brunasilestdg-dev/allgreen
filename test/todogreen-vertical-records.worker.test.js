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

async function autorizar(usuario, papel = "admin", permissoes = ["*"], workspaceOwnerId = usuario.id) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, workspace_owner_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, 'active', ?, '', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET role = excluded.role,
       permissions_json = excluded.permissions_json, status = 'active'`,
  )
    .bind(crypto.randomUUID(), workspaceOwnerId, usuario.email, papel, JSON.stringify(permissoes), usuario.id, agora, agora)
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
  await autorizar(auditor, "auditor", ["read", "audit:read"]);
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

describe("oportunidade vinculada esquenta a conta fria", () => {
  // Pedido da titular (30/08): "oportunidade, posso atribuir a um cliente na
  // plataforma e automaticamente sai de frio pra morno". A régua só sobe —
  // classificação manual acima de Frio nunca é rebaixada por automação.
  const contaComCampos = async (id, campos) => {
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_clients
         (id, tenant_id, workspace_owner_id, name, status, portal_enabled, fields_json,
          created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, ?, 'ativo', 0, ?, ?, ?, ?, ?)`,
    ).bind(id, gestora.id, id, JSON.stringify(campos), gestora.id, gestora.id, agora, agora).run();
  };
  const camposDaConta = async (id) => {
    const linha = await env.DB.prepare(
      "SELECT fields_json FROM todogreen_clients WHERE id = ?",
    ).bind(id).first();
    return JSON.parse(linha.fields_json || "{}");
  };

  it("conta Fria vira Morno quando nasce oportunidade vinculada a ela", async () => {
    await contaComCampos("cli-fria", { temperature: "Frio", stage: "Mapeamento", tags: ["frota"] });
    const criada = await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: gestora.token,
      corpo: { cliente: "cli-fria", clientId: "cli-fria", valorMensal: 12000 },
    });
    expect(criada.status).toBe(201);
    const campos = await camposDaConta("cli-fria");
    expect(campos.temperature).toBe("Morno");
    // O aquecimento mexe só na temperatura; o resto do CRM fica intacto.
    expect(campos.stage).toBe("Mapeamento");
    expect(campos.tags).toEqual(["frota"]);
  });

  it("conta ainda sem classificação também esquenta", async () => {
    await contaComCampos("cli-sem-classe", {});
    await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: gestora.token,
      corpo: { cliente: "cli-sem-classe", clientId: "cli-sem-classe", valorMensal: 800 },
    });
    expect((await camposDaConta("cli-sem-classe")).temperature).toBe("Morno");
  });

  it("Quente classificado à mão não é rebaixado", async () => {
    await contaComCampos("cli-quente", { temperature: "Quente" });
    await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: gestora.token,
      corpo: { cliente: "cli-quente", clientId: "cli-quente", valorMensal: 5000 },
    });
    expect((await camposDaConta("cli-quente")).temperature).toBe("Quente");
  });

  it("vincular a conta depois, na edição da oportunidade, também esquenta", async () => {
    await contaComCampos("cli-tardia", { temperature: "Frio" });
    const criada = await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: gestora.token,
      corpo: { cliente: "Ainda sem conta", valorMensal: 900 },
    });
    const { registro } = await criada.json();
    expect((await camposDaConta("cli-tardia")).temperature).toBe("Frio");

    const editada = await pedir(`/api/todogreen/records/opportunities/${registro.id}`, {
      metodo: "PATCH",
      token: gestora.token,
      corpo: { revision: registro.revision, clientId: "cli-tardia" },
    });
    expect(editada.status).toBe(200);
    expect((await camposDaConta("cli-tardia")).temperature).toBe("Morno");
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

    // Antes do Jurídico, a assinatura é recusada (gate: todo contrato passa
    // pelo Jurídico).
    const semJuridico = await pedir(`/api/todogreen/records/contracts/${contrato.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { revision: contrato.revision, assinatura: "signed", assinadoEm: "2026-08-14" },
    });
    expect(semJuridico.status).toBe(409);

    // Validação jurídica concluída, amarrada ao contrato pelo contractId
    // (semeada direto no banco: a segregação de funções do fluxo — quem abre
    // não faz a 1ª aprovação — não é o alvo deste teste).
    const agora = new Date().toISOString();
    const workflowId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO todogreen_enterprise_workflows
        (id,tenant_id,workspace_owner_id,domain,kind,title,description,client_id,owner_user_id,priority,
         status,due_at,data_json,approval_json,recurrence_json,source_template_id,revision,created_by,updated_by,created_at,updated_at,archived_at)
       VALUES (?,'todogreen',?,'legal','contrato','Revisão do ciclo','',?,?,'normal','approved',NULL,?,?,'{}','',1,?,?,?,?,NULL)`,
    ).bind(
      workflowId, gestora.id, clienteId, gestora.id,
      JSON.stringify({ contractId: contrato.id, proposalId: proposta.id }),
      JSON.stringify({ approvals: [{ stepId: "juridico", decision: "approved", decidedAt: agora }] }),
      gestora.id, gestora.id, agora, agora,
    ).run();

    // Com Jurídico, mas sem o documento assinado anexado, a assinatura ainda é recusada.
    const semDocumento = await pedir(`/api/todogreen/records/contracts/${contrato.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { revision: contrato.revision, assinatura: "signed", assinadoEm: "2026-08-14" },
    });
    expect(semDocumento.status).toBe(409);

    // Contrato assinado anexado ao fluxo jurídico (cofre interno).
    await env.DB.prepare(
      `INSERT INTO todogreen_internal_files
        (id,tenant_id,workspace_owner_id,client_id,workflow_id,context_type,context_id,file_name,content_type,
         byte_size,sha256,version,source,external_url,folder_id,created_by,created_at,archived_at)
       VALUES (?,'todogreen',?,?,?,'workflow',?,'contrato-assinado.pdf','application/pdf',1024,'hash',1,'internal_upload','','',?,?,NULL)`,
    ).bind(crypto.randomUUID(), gestora.id, clienteId, workflowId, workflowId, gestora.id, agora).run();

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

  it("conclui o gate pela página do Jurídico (sistema unificado), não só pelo fluxo empresarial", async () => {
    const clienteId = `cli-jur-uni-${crypto.randomUUID()}`;
    await criarCliente(gestora, clienteId, "Cliente Jurídico Unificado");
    const proposta = (await (await pedir("/api/todogreen/records/proposals", {
      metodo: "POST", token: gestora.token,
      corpo: { clientId: clienteId, cliente: "Cliente Jurídico Unificado", titulo: "Proposta unificada", cenarioId: "cen-uni", situacao: "accepted" },
    })).json()).registro;
    const contrato = (await (await pedir("/api/todogreen/records/contracts", {
      metodo: "POST", token: gestora.token,
      corpo: { clientId: clienteId, propostaId: proposta.id, titulo: "Contrato unificado" },
    })).json()).registro;

    // Sem documento jurídico, assinar é recusado (gate ativo).
    const semJuridico = await pedir(`/api/todogreen/records/contracts/${contrato.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { revision: contrato.revision, assinatura: "signed", assinadoEm: "2026-08-14" },
    });
    expect(semJuridico.status).toBe(409);

    // Documento na PÁGINA DO JURÍDICO, aprovado e amarrado à proposta pelo
    // campos.proposalId — a fonte única que a titular escolheu.
    const legal = (await (await pedir("/api/todogreen/records/legal", {
      metodo: "POST", token: gestora.token,
      corpo: { titulo: "Contrato unificado — minuta", situacao: "aprovado", clientId: clienteId, campos: { proposalId: proposta.id } },
    })).json()).registro;
    expect(legal.situacao).toBe("aprovado");

    // Jurídico aprovado libera a aprovação; a assinatura ainda exige o anexo.
    const semAnexo = await pedir(`/api/todogreen/records/contracts/${contrato.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { revision: contrato.revision, assinatura: "signed", assinadoEm: "2026-08-14" },
    });
    expect(semAnexo.status).toBe(409);

    // Contrato assinado anexado AO DOCUMENTO DO JURÍDICO (context_type='legal').
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_internal_files
        (id,tenant_id,workspace_owner_id,client_id,workflow_id,context_type,context_id,file_name,content_type,
         byte_size,sha256,version,source,external_url,folder_id,created_by,created_at,archived_at)
       VALUES (?,'todogreen',?,?,NULL,'legal',?,'contrato-assinado.pdf','application/pdf',2048,'hash2',1,'internal_upload','','',?,?,NULL)`,
    ).bind(crypto.randomUUID(), gestora.id, clienteId, legal.id, gestora.id, agora).run();

    const assinado = await pedir(`/api/todogreen/records/contracts/${contrato.id}`, {
      metodo: "PATCH", token: gestora.token,
      corpo: { revision: contrato.revision, assinatura: "signed", assinadoEm: "2026-08-14" },
    });
    expect(assinado.status).toBe(200);
    expect((await assinado.json()).registro).toEqual(expect.objectContaining({ assinatura: "signed" }));
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

  it("estorna uma baixa lançando compensatório e reabrindo o saldo, sem apagar o histórico", async () => {
    const criado = await pedir("/api/todogreen/records/financial", {
      metodo: "POST", token: gestora.token,
      corpo: { tipo: "cost", valor: 500, descricao: "Baixa a estornar", vencimentoEm: "2026-08-20" },
    });
    const lancamento = (await criado.json()).registro;
    const baixa = await pedir(`/api/todogreen/records/financial/${lancamento.id}/payments`, {
      metodo: "POST", token: gestora.token,
      corpo: { revision: lancamento.revision, valor: 500, pagoEm: "2026-08-14", meioPagamento: "pix" },
    });
    const pagamentoId = (await baixa.json()).pagamento.id;
    expect((await pedir(`/api/todogreen/records/financial`, { token: gestora.token })).status).toBe(200);

    const estorno = await pedir(`/api/todogreen/records/financial/${lancamento.id}/payments/${pagamentoId}`, {
      metodo: "DELETE", token: gestora.token,
    });
    expect(estorno.status).toBe(201);
    const registro = (await estorno.json()).registro;
    // Saldo reabre: pago volta a zero e o status deixa de ser 'paid'.
    expect(registro).toEqual(expect.objectContaining({ valorPago: 0, statusFinanceiro: "pending" }));

    // O histórico guarda a baixa E o compensatório negativo — nada é apagado.
    const historico = await (await pedir(`/api/todogreen/records/financial/${lancamento.id}/payments`, { token: gestora.token })).json();
    expect(historico.pagamentos.some((p) => p.valor === 500)).toBe(true);
    expect(historico.pagamentos.some((p) => p.valor === -500 && p.referencia === `estorno:${pagamentoId}`)).toBe(true);

    // Estornar de novo a mesma baixa é recusado.
    const denovo = await pedir(`/api/todogreen/records/financial/${lancamento.id}/payments/${pagamentoId}`, {
      metodo: "DELETE", token: gestora.token,
    });
    expect(denovo.status).toBe(409);
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

  it("km e energia viram fato do evento e refletem na operação vazia, sem sobrescrever depois (N.2)", async () => {
    const clienteId = `cli-medicao-${crypto.randomUUID()}`;
    await criarCliente(gestora, clienteId, "Cliente Medição");
    const operacao = (await (await pedir("/api/todogreen/records/operations", {
      metodo: "POST", token: gestora.token,
      corpo: { clientId: clienteId, referencia: "OP-MEDICAO", viagens: 1 },
    })).json()).registro;

    // Evento com medição numa operação sem distância (distance_km=0): grava o
    // fato no evento e REFLETE na operação (estava vazia).
    const ev1 = await pedir(`/api/todogreen/records/operations/${operacao.id}/events`, {
      metodo: "POST", token: gestora.token,
      corpo: { tipo: "transito", titulo: "Perna 1", distanciaKm: 120, energiaKwh: 30 },
    });
    expect(ev1.status).toBe(201);

    const eventoRow = await env.DB.prepare(
      `SELECT distance_km, distance_source, energy_kwh, energy_source
         FROM todogreen_client_operation_events WHERE operation_id=? ORDER BY created_at DESC LIMIT 1`,
    ).bind(operacao.id).first();
    expect(eventoRow).toEqual({ distance_km: 120, distance_source: "medido", energy_kwh: 30, energy_source: "medido" });

    const op1 = await env.DB.prepare(
      `SELECT distance_km, distance_km_quality, energy_kwh, energy_kwh_quality
         FROM todogreen_client_operations WHERE id=?`,
    ).bind(operacao.id).first();
    expect(op1).toEqual({ distance_km: 120, distance_km_quality: "medido", energy_kwh: 30, energy_kwh_quality: "medido" });

    // Segundo evento com outra distância NÃO sobrescreve — a operação já tinha o
    // dado (guarda "só-se-vazio", igual ao last_position). Sem double-count.
    await pedir(`/api/todogreen/records/operations/${operacao.id}/events`, {
      metodo: "POST", token: gestora.token,
      corpo: { tipo: "transito", titulo: "Perna 2", distanciaKm: 999, energiaKwh: 500 },
    });
    const op2 = await env.DB.prepare(
      `SELECT distance_km, energy_kwh FROM todogreen_client_operations WHERE id=?`,
    ).bind(operacao.id).first();
    expect(op2).toEqual({ distance_km: 120, energy_kwh: 30 });

    // Evento sem medição deixa tudo intacto e grava NULL nas 4 colunas do evento.
    await pedir(`/api/todogreen/records/operations/${operacao.id}/events`, {
      metodo: "POST", token: gestora.token,
      corpo: { tipo: "chegada", titulo: "Sem medir" },
    });
    const semMedicao = await env.DB.prepare(
      `SELECT distance_km, energy_kwh FROM todogreen_client_operation_events
        WHERE operation_id=? ORDER BY created_at DESC LIMIT 1`,
    ).bind(operacao.id).first();
    expect(semMedicao).toEqual({ distance_km: null, energy_kwh: null });
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
      "bankAccounts",
      "businessContext",
      "comments",
      "contracts",
      "costCenters",
      "documentFolders",
      "financial",
      "habilitacao",
      "habilitacaoKits",
      "interactions",
      "items",
      "legal",
      "operations",
      "opportunities",
      "parties",
      "pontosRecarga",
      "proposals",
      "quality",
      "rfq",
      "rotas",
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

describe("leitura por funcionalidade", () => {
  it("quem só pesquisa mercado não recebe financeiro nem contas bancárias na carga geral", async () => {
    const pesquisa = await criarUsuario(`rec-market-${n}`, `rec-market-${n}@example.com`);
    await autorizar(pesquisa, "marketing", ["read", "market:read", "market:research"], gestora.id);

    const financeiro = await pedir("/api/todogreen/records/financial", { token: pesquisa.token });
    expect(financeiro.status).toBe(403);

    const contas = await pedir("/api/todogreen/records/bankAccounts", { token: pesquisa.token });
    expect(contas.status).toBe(403);

    const geral = await pedir("/api/todogreen/records?includeTotals=1", { token: pesquisa.token });
    expect(geral.status).toBe(200);
    const payload = await geral.json();
    expect(payload.financial).toEqual([]);
    expect(payload.bankAccounts).toEqual([]);
    expect(payload.totals.financial).toBe(0);
    expect(payload.totals.bankAccounts).toBe(0);
  });
});

describe("interações do comercial: ata, tentativa de contato e carimbo da data", () => {
  // Pedido da titular (30/08): "preciso registrar as interações, atas de agenda
  // com o cliente, tentativas de contato, etc nas oportunidades e clientes".
  // Mesma regra de alcance dos comentários, e a data da interação carimba a
  // última interação da conta e da oportunidade — é dela que a saúde da conta e
  // os Avanços da semana vivem.
  const criarConta = async (id, campos = {}) => {
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_clients
         (id, tenant_id, workspace_owner_id, name, status, portal_enabled, fields_json,
          created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, ?, 'ativo', 0, ?, ?, ?, ?, ?)`,
    ).bind(id, gestora.id, id, JSON.stringify(campos), gestora.id, gestora.id, agora, agora).run();
  };

  it("grava a ata da reunião com autor da sessão e carimba a conta e a oportunidade", async () => {
    await criarConta("cli-ata", { temperature: "Morno", lastInteractionAt: "2026-01-10" });
    const oportunidade = (await (await pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: gestora.token,
      corpo: { cliente: "cli-ata", clientId: "cli-ata", valorMensal: 5000 },
    })).json()).registro;

    const criada = await pedir("/api/todogreen/records/interactions", {
      metodo: "POST",
      token: gestora.token,
      corpo: {
        clientId: "cli-ata",
        opportunityId: oportunidade.id,
        tipo: "reuniao",
        assunto: "Agenda com o time de logística",
        ata: "Cliente pediu piloto em SP com 4 veículos. Jurídico deles revisa a minuta.",
        participantes: "Bruna, Diretor de logística",
        resultado: "avancou",
        proximoPasso: "Enviar minuta revisada",
        proximoPassoEm: "2026-09-05",
        ocorridaEm: "2026-08-30",
        autorEmail: "forjado@x.com",
      },
    });
    expect(criada.status).toBe(201);
    const registro = (await criada.json()).registro;
    expect(registro.tipo).toBe("reuniao");
    expect(registro.ata).toContain("piloto em SP");
    // Assinatura é da sessão, nunca do corpo.
    expect(registro.autorEmail).toBe(gestora.email);

    const conta = await env.DB.prepare("SELECT fields_json FROM todogreen_clients WHERE id = ?")
      .bind("cli-ata").first();
    expect(JSON.parse(conta.fields_json).lastInteractionAt).toBe("2026-08-30");
    const linha = await env.DB.prepare(
      "SELECT last_interaction_at FROM todogreen_opportunities WHERE id = ?",
    ).bind(oportunidade.id).first();
    expect(linha.last_interaction_at).toBe("2026-08-30");
  });

  it("ata antiga registrada depois não rejuvenesce a conta", async () => {
    await criarConta("cli-antiga", { lastInteractionAt: "2026-08-20" });
    await pedir("/api/todogreen/records/interactions", {
      metodo: "POST",
      token: gestora.token,
      corpo: { clientId: "cli-antiga", tipo: "ligacao", assunto: "Ligação de julho", ocorridaEm: "2026-07-01" },
    });
    const conta = await env.DB.prepare("SELECT fields_json FROM todogreen_clients WHERE id = ?")
      .bind("cli-antiga").first();
    expect(JSON.parse(conta.fields_json).lastInteractionAt).toBe("2026-08-20");
  });

  it("tentativa de contato é registro de primeira classe", async () => {
    const r = await pedir("/api/todogreen/records/interactions", {
      metodo: "POST",
      token: gestora.token,
      corpo: { clientId: "cli-ata", tipo: "tentativa", assunto: "Liguei, caiu na caixa postal", ocorridaEm: "2026-08-29" },
    });
    expect(r.status).toBe(201);
    expect((await r.json()).registro.tipo).toBe("tentativa");
  });

  it("tipo desconhecido não entra cru na coluna", async () => {
    const r = await pedir("/api/todogreen/records/interactions", {
      metodo: "POST",
      token: gestora.token,
      corpo: { clientId: "cli-ata", tipo: "<script>", assunto: "Qualquer coisa", ocorridaEm: "2026-08-29" },
    });
    expect((await r.json()).registro.tipo).toBe("reuniao");
  });

  it("interação sem vínculo, sem texto ou sem data é recusada", async () => {
    const semVinculo = await pedir("/api/todogreen/records/interactions", {
      metodo: "POST", token: gestora.token, corpo: { assunto: "Solta", ocorridaEm: "2026-08-30" },
    });
    expect(semVinculo.status).toBe(400);
    const semTexto = await pedir("/api/todogreen/records/interactions", {
      metodo: "POST", token: gestora.token, corpo: { clientId: "cli-ata", ocorridaEm: "2026-08-30" },
    });
    expect(semTexto.status).toBe(400);
    const semData = await pedir("/api/todogreen/records/interactions", {
      metodo: "POST", token: gestora.token, corpo: { clientId: "cli-ata", assunto: "Sem data" },
    });
    expect(semData.status).toBe(400);
  });

  it("o espaço de outra pessoa não vê as interações", async () => {
    const doColega = await (await pedir("/api/todogreen/records/interactions", { token: colega.token })).json();
    expect(doColega.registros.map((r) => r.assunto)).not.toContain("Agenda com o time de logística");
  });
});

describe("comentários do comercial: conta replica, oportunidade fica nela", () => {
  // Regra da titular (30/08): comentário na CONTA aparece em todas as
  // oportunidades dela; comentário na OPORTUNIDADE fica só nela. O servidor
  // guarda os dois campos e carimba o autor pela sessão — o corte de quem vê
  // o quê é feito por quem lê, com dado íntegro.
  it("grava comentário de conta e de oportunidade, com autor da sessão", async () => {
    const daConta = await pedir("/api/todogreen/records/comments", {
      metodo: "POST",
      token: gestora.token,
      corpo: { clientId: "cli-fria", comentario: "Reunião ótima — cliente quer piloto em SP.", autorEmail: "forjado@x.com" },
    });
    expect(daConta.status).toBe(201);
    const conta = (await daConta.json()).registro;
    expect(conta.clientId).toBe("cli-fria");
    expect(conta.opportunityId).toBe("");
    // O autor vem da sessão; o corpo não escolhe assinatura.
    expect(conta.autorEmail).toBe(gestora.email);

    const daOportunidade = await pedir("/api/todogreen/records/comments", {
      metodo: "POST",
      token: gestora.token,
      corpo: { clientId: "cli-fria", opportunityId: "opp-x", comentario: "Só nesta oportunidade: renegociar prazo." },
    });
    expect(daOportunidade.status).toBe(201);
    expect((await daOportunidade.json()).registro.opportunityId).toBe("opp-x");

    const lista = await (await pedir("/api/todogreen/records/comments", { token: gestora.token })).json();
    const textos = lista.registros.map((r) => r.comentario);
    expect(textos).toContain("Reunião ótima — cliente quer piloto em SP.");
    expect(textos).toContain("Só nesta oportunidade: renegociar prazo.");
  });

  it("comentário sem texto ou sem vínculo é recusado", async () => {
    expect((await pedir("/api/todogreen/records/comments", {
      metodo: "POST", token: gestora.token, corpo: { clientId: "cli-fria", comentario: "  " },
    })).status).toBe(400);
    expect((await pedir("/api/todogreen/records/comments", {
      metodo: "POST", token: gestora.token, corpo: { comentario: "Sem vínculo nenhum" },
    })).status).toBe(400);
  });

  it("o espaço de outra pessoa não vê os comentários", async () => {
    const doColega = await (await pedir("/api/todogreen/records/comments", { token: colega.token })).json();
    expect(doColega.registros.map((r) => r.comentario)).not.toContain("Reunião ótima — cliente quer piloto em SP.");
  });
});

// ===== O dossiê do negócio =====
//
// É o que o Plantû lê antes de responder qualquer coisa sobre a To Do Green.
// O que estes testes impedem de voltar: o dossiê de um espaço aparecendo no
// outro, e qualquer papel que conversa com o assistente conseguindo mudar o
// que ele afirma para todo mundo.
describe("o que a IA sabe sobre o negócio", () => {
  let vendedora;

  beforeAll(async () => {
    vendedora = await criarUsuario(`u-vend-${crypto.randomUUID().slice(0, 8)}`, `vend-${crypto.randomUUID().slice(0, 8)}@todogreen.com.br`);
    await autorizar(vendedora, "vendedor", ["read", "crm:manage"], gestora.id);
  });

  it("a dona cadastra um ponto e ele volta na leitura", async () => {
    const criada = await pedir("/api/todogreen/records/businessContext", {
      metodo: "POST",
      token: gestora.token,
      corpo: {
        chave: "frota-real",
        categoria: "operacao",
        titulo: "Frota real conferida",
        conteudo: "A contagem real da frota foi conferida em agosto de 2026.",
        fonte: "Conferência interna",
        sigilo: "interno",
        fixado: true,
      },
    });
    expect(criada.status).toBe(201);
    const lista = await (await pedir("/api/todogreen/records/businessContext", { token: gestora.token })).json();
    const fato = lista.registros.find((item) => item.chave === "frota-real");
    expect(fato.titulo).toBe("Frota real conferida");
    expect(fato.fixado).toBe(true);
    expect(fato.origem).toBe("cadastrado");
  });

  it("vendedora LÊ o dossiê mas não ensina — ensinar muda o que a IA afirma para todo mundo", async () => {
    const leitura = await pedir("/api/todogreen/records/businessContext", { token: vendedora.token });
    expect(leitura.status).toBe(200);
    expect((await leitura.json()).registros.some((item) => item.chave === "frota-real")).toBe(true);

    const tentativa = await pedir("/api/todogreen/records/businessContext", {
      metodo: "POST",
      token: vendedora.token,
      corpo: { titulo: "Inventado", conteudo: "A empresa aceita qualquer preço." },
    });
    expect(tentativa.status).toBe(403);
  });

  it("o dossiê de um espaço não vaza para o outro", async () => {
    const doColega = await (await pedir("/api/todogreen/records/businessContext", { token: colega.token })).json();
    expect(doColega.registros.map((item) => item.chave)).not.toContain("frota-real");
  });

  it("ponto sem conteúdo é recusado — dossiê vazio ensina o assistente a inventar", async () => {
    const vazio = await pedir("/api/todogreen/records/businessContext", {
      metodo: "POST",
      token: gestora.token,
      corpo: { titulo: "Só o título" },
    });
    expect(vazio.status).toBe(400);
  });
});

// ===== O nome do negócio =====
describe("oportunidade com nome próprio", () => {
  it("grava e devolve o título, e duas frentes da mesma conta não ficam idênticas", async () => {
    const criar = (titulo) => pedir("/api/todogreen/records/opportunities", {
      metodo: "POST",
      token: gestora.token,
      corpo: { titulo, cliente: "Amazon", estagio: "Negociação", valorMensal: 1000 },
    });
    const primeira = await (await criar("Middle Mile Sorocaba")).json();
    const segunda = await (await criar("Same Day SP")).json();
    expect(primeira.registro.titulo).toBe("Middle Mile Sorocaba");
    expect(segunda.registro.titulo).toBe("Same Day SP");
    expect(primeira.registro.titulo).not.toBe(segunda.registro.titulo);
  });
});

// ===== Central de RFQ e RFI =====
//
// O que estes testes impedem de voltar: acervo de habilitação de um espaço
// aparecendo no outro, vendedor cadastrando documento oficial, e RFQ fechado
// sem motivo — que joga fora a única inteligência comercial que um ano de
// cotações produz.
describe("Central de RFQ e RFI", () => {
  let vendedoraRfq;

  beforeAll(async () => {
    vendedoraRfq = await criarUsuario(
      `u-rfq-${crypto.randomUUID().slice(0, 8)}`,
      `rfq-${crypto.randomUUID().slice(0, 8)}@todogreen.com.br`,
    );
    await autorizar(vendedoraRfq, "vendedor", ["read", "crm:manage"], gestora.id);
  });

  it("a dona cadastra documento e ele volta sem coluna de status", async () => {
    const criada = await pedir("/api/todogreen/records/habilitacao", {
      metodo: "POST",
      token: gestora.token,
      corpo: {
        tipo: "APOLICE-RCTR-C",
        numero: "654 66 04001125",
        unidade: "EMPRESA",
        venceEm: "2026-08-13",
      },
    });
    expect(criada.status).toBe(201);
    const registro = (await criada.json()).registro;
    // O tipo vira canônico e o catálogo preenche título, categoria e órgão:
    // o que a casa já sabe não se digita de novo.
    expect(registro.tipo).toBe("APOLICE-RCTR-C");
    expect(registro.titulo).toBe("Apólice RCTR-C");
    expect(registro.categoria).toBe("seguros");
    // E não existe campo de status: o semáforo é derivado na leitura.
    expect(registro.status).toBeUndefined();
    expect(registro.situacao).toBeUndefined();
  });

  it("documento sem data nenhuma é recusado — sem data não há semáforo", async () => {
    const semData = await pedir("/api/todogreen/records/habilitacao", {
      metodo: "POST",
      token: gestora.token,
      corpo: { tipo: "CND-FEDERAL" },
    });
    expect(semData.status).toBe(400);
    expect((await semData.json()).error).toMatch(/emissão ou o vencimento/);
  });

  it("documento permanente não guarda vencimento", async () => {
    const criada = await pedir("/api/todogreen/records/habilitacao", {
      metodo: "POST",
      token: gestora.token,
      corpo: { tipo: "CONTRATO-SOCIAL-CONSOLIDADO", numero: "NIRE 35.237.011.921", venceEm: "2030-01-01" },
    });
    expect(criada.status).toBe(201);
    const registro = (await criada.json()).registro;
    expect(registro.permanente).toBe(true);
    // Guardar os dois deixaria a tela ter que escolher em qual acreditar.
    expect(registro.venceEm).toBe("");
  });

  it("vendedora LÊ o acervo para responder RFQ mas não cadastra documento oficial", async () => {
    const leitura = await pedir("/api/todogreen/records/habilitacao", { token: vendedoraRfq.token });
    expect(leitura.status).toBe(200);
    expect((await leitura.json()).registros.some((item) => item.tipo === "APOLICE-RCTR-C")).toBe(true);

    const tentativa = await pedir("/api/todogreen/records/habilitacao", {
      metodo: "POST",
      token: vendedoraRfq.token,
      corpo: { tipo: "CND-FEDERAL", emitidoEm: "2026-08-31" },
    });
    expect(tentativa.status).toBe(403);
  });

  it("o acervo de um espaço não vaza para o outro", async () => {
    const doColega = await (await pedir("/api/todogreen/records/habilitacao", { token: colega.token })).json();
    expect(doColega.registros.map((item) => item.tipo)).not.toContain("APOLICE-RCTR-C");
  });

  it("kit vazio é recusado — não anexa nada", async () => {
    const vazio = await pedir("/api/todogreen/records/habilitacaoKits", {
      metodo: "POST",
      token: gestora.token,
      corpo: { nome: "Kit sem nada", tipos: [] },
    });
    expect(vazio.status).toBe(400);
  });

  it("RFQ fechado sem motivo é recusado", async () => {
    const semMotivo = await pedir("/api/todogreen/records/rfq", {
      metodo: "POST",
      token: gestora.token,
      corpo: { titulo: "RFQ last mile", cliente: "DHL", etapa: "perdido" },
    });
    expect(semMotivo.status).toBe(400);
    expect((await semMotivo.json()).error).toMatch(/motivo/);

    const comMotivo = await pedir("/api/todogreen/records/rfq", {
      metodo: "POST",
      token: gestora.token,
      corpo: { titulo: "RFQ last mile", cliente: "DHL", etapa: "perdido", motivo: "Preço 12% acima do incumbente." },
    });
    expect(comMotivo.status).toBe(201);
  });

  it("o texto do pedido é guardado cru, sem resumir", async () => {
    const bruto = "Prezados,\n\nSolicitamos:\n1) CNPJ\n2) CND Federal\n\nPrazo: 05/09.";
    const criada = await pedir("/api/todogreen/records/rfq", {
      metodo: "POST",
      token: gestora.token,
      corpo: { titulo: "RFQ com pedido cru", cliente: "Maersk", pedido: bruto, prazo: "2026-09-05" },
    });
    expect(criada.status).toBe(201);
    // A quebra de linha sobrevive: é o que responde "mandaram o quê mesmo?".
    expect((await criada.json()).registro.pedido).toContain("1) CNPJ");
  });
});

// ===== Pastas do cofre =====
//
// O que estes testes impedem de voltar: subpasta "do espaço" dentro de uma
// privada vazando o conteúdo do pai, arquivo escondido na lista mas baixável
// pela URL, e a dona do espaço virando dona de toda pasta privada que abrir
// para arrumar.
describe("pastas do cofre de documentos", () => {
  let outraPessoa;
  let privadaId;
  let dentroDaPrivadaId;

  beforeAll(async () => {
    outraPessoa = await criarUsuario(
      `u-pasta-${crypto.randomUUID().slice(0, 8)}`,
      `pasta-${crypto.randomUUID().slice(0, 8)}@todogreen.com.br`,
    );
    // Papel que escreve no cofre, para provar que a trava é de VISIBILIDADE e
    // não de permissão de escrita.
    await autorizar(outraPessoa, "operacoes", ["read", "evidence:manage", "operations:manage"], gestora.id);
  });

  it("a pasta privada nasce com a dona da sessão, não com quem o corpo disser", async () => {
    const criada = await pedir("/api/todogreen/records/documentFolders", {
      metodo: "POST",
      token: outraPessoa.token,
      corpo: { nome: "Privada da operação", visibilidade: "private", donoEmail: gestora.email },
    });
    expect(criada.status).toBe(201);
    const pasta = (await criada.json()).registro;
    // O corpo tentou pôr a gestora como dona. O servidor ignorou.
    expect(pasta.donoEmail).toBe(outraPessoa.email.toLowerCase());
    privadaId = pasta.id;
  });

  it("subpasta 'do espaço' dentro de uma privada NÃO vaza para quem não vê o pai", async () => {
    const criada = await pedir("/api/todogreen/records/documentFolders", {
      metodo: "POST",
      token: outraPessoa.token,
      corpo: { nome: "Dentro da privada", visibilidade: "shared", paiId: privadaId },
    });
    expect(criada.status).toBe(201);
    dentroDaPrivadaId = (await criada.json()).registro.id;

    // Uma terceira pessoa do MESMO espaço, sem ser dona nem membro.
    const terceira = await criarUsuario(
      `u-terc-${crypto.randomUUID().slice(0, 8)}`,
      `terc-${crypto.randomUUID().slice(0, 8)}@todogreen.com.br`,
    );
    await autorizar(terceira, "operacoes", ["read", "evidence:manage", "operations:manage"], gestora.id);
    const lista = await (await pedir("/api/todogreen/records/documentFolders", { token: terceira.token })).json();
    const ids = lista.registros.map((item) => item.id);
    expect(ids).not.toContain(privadaId);
    // Esta é a regra que importa: marcada como 'shared', mas dentro da privada.
    expect(ids).not.toContain(dentroDaPrivadaId);
  });

  it("quem criou vê a própria pasta e a subpasta dela", async () => {
    const lista = await (await pedir("/api/todogreen/records/documentFolders", { token: outraPessoa.token })).json();
    const ids = lista.registros.map((item) => item.id);
    expect(ids).toContain(privadaId);
    expect(ids).toContain(dentroDaPrivadaId);
  });

  it("a dona do espaço vê a pasta privada de terceiro — e editá-la NÃO transfere a dona", async () => {
    const lista = await (await pedir("/api/todogreen/records/documentFolders", { token: gestora.token })).json();
    const pasta = lista.registros.find((item) => item.id === privadaId);
    expect(pasta).toBeTruthy();

    const editada = await pedir(`/api/todogreen/records/documentFolders/${privadaId}`, {
      metodo: "PATCH",
      token: gestora.token,
      corpo: { nome: "Privada da operação (arrumada)", revision: pasta.revision },
    });
    expect(editada.status).toBe(200);
    // Sem isto a gestora viraria dona ao abrir a pasta para arrumar, e quem
    // criou perderia o acesso.
    expect((await editada.json()).registro.donoEmail).toBe(outraPessoa.email.toLowerCase());
  });

  it("pasta não entra dentro da própria descendência", async () => {
    const minha = await (await pedir("/api/todogreen/records/documentFolders", { token: outraPessoa.token })).json();
    const pasta = minha.registros.find((item) => item.id === privadaId);
    const anel = await pedir(`/api/todogreen/records/documentFolders/${privadaId}`, {
      metodo: "PATCH",
      token: outraPessoa.token,
      corpo: { paiId: dentroDaPrivadaId, revision: pasta.revision },
    });
    expect(anel.status).toBe(409);
    expect((await anel.json()).error).toMatch(/dentro de si mesma/);
  });

  it("duas pastas irmãs com o mesmo nome são recusadas", async () => {
    const repetida = await pedir("/api/todogreen/records/documentFolders", {
      metodo: "POST",
      token: outraPessoa.token,
      corpo: { nome: "Privada da operação (arrumada)", visibilidade: "private" },
    });
    expect(repetida.status).toBe(409);
  });

  it("pasta da área sem área escolhida é recusada", async () => {
    const semArea = await pedir("/api/todogreen/records/documentFolders", {
      metodo: "POST",
      token: outraPessoa.token,
      corpo: { nome: "Área nenhuma", visibilidade: "area" },
    });
    expect(semArea.status).toBe(400);
    expect((await semArea.json()).error).toMatch(/qual área/);
  });

  it("as pastas de um espaço não vazam para o outro", async () => {
    const doColega = await (await pedir("/api/todogreen/records/documentFolders", { token: colega.token })).json();
    expect(doColega.registros.map((item) => item.id)).not.toContain(privadaId);
  });
});

describe("qualidade: não conformidades saem da página de orientação para dados reais", () => {
  it("cria, lista, atualiza situação e recusa NC sem título", async () => {
    const dona = await criarUsuario(`q-dona-${n}`, `q-dona-${n}@parceiro.com.br`);
    await autorizar(dona);

    const criada = await pedir("/api/todogreen/records/quality", {
      metodo: "POST",
      token: dona.token,
      corpo: {
        titulo: "Avaria na doca 3",
        tipo: "avaria",
        gravidade: "critica",
        causaRaiz: "Empilhadeira sem manutenção",
        planoAcao: "Revisar plano preventivo",
        prazo: "2026-09-30",
      },
    });
    expect(criada.status).toBe(201);
    const { registro } = await criada.json();
    expect(registro.titulo).toBe("Avaria na doca 3");
    expect(registro.gravidade).toBe("critica");
    expect(registro.situacao).toBe("aberta");
    expect(registro.revision).toBe(1);

    const lista = await pedir("/api/todogreen/records/quality", { token: dona.token });
    expect((await lista.json()).registros.map((r) => r.titulo)).toContain("Avaria na doca 3");

    const atualizada = await pedir(`/api/todogreen/records/quality/${registro.id}`, {
      metodo: "PATCH",
      token: dona.token,
      corpo: { situacao: "em_acao", revision: 1 },
    });
    expect(atualizada.status).toBe(200);
    expect((await atualizada.json()).registro.situacao).toBe("em_acao");

    const semTitulo = await pedir("/api/todogreen/records/quality", {
      metodo: "POST",
      token: dona.token,
      corpo: { gravidade: "alta" },
    });
    expect(semTitulo.status).toBe(400);
  });

  it("valores fora da lista caem no padrão em vez de gravar lixo", async () => {
    const dona = await criarUsuario(`q-norm-${n}`, `q-norm-${n}@parceiro.com.br`);
    await autorizar(dona);
    const criada = await pedir("/api/todogreen/records/quality", {
      metodo: "POST",
      token: dona.token,
      corpo: { titulo: "NC com valores estranhos", tipo: "foguete", gravidade: "apocaliptica", situacao: "inventada" },
    });
    const { registro } = await criada.json();
    expect(registro.tipo).toBe("processo");
    expect(registro.gravidade).toBe("media");
    expect(registro.situacao).toBe("aberta");
  });

  it("quem só lê não cria não conformidade", async () => {
    const criada = await pedir("/api/todogreen/records/quality", {
      metodo: "POST",
      token: auditor.token,
      corpo: { titulo: "Auditor não deveria gravar" },
    });
    expect(criada.status).toBe(403);
  });
});

describe("jurídico: minutas e contratos saem da página de orientação para dados reais", () => {
  it("cria, lista, atualiza situação e recusa documento sem título", async () => {
    const dona = await criarUsuario(`j-dona-${n}`, `j-dona-${n}@parceiro.com.br`);
    await autorizar(dona);

    const criada = await pedir("/api/todogreen/records/legal", {
      metodo: "POST",
      token: dona.token,
      corpo: {
        titulo: "Contrato de operação · Rede Alfa",
        tipo: "contrato",
        risco: "alto",
        contraparte: "Rede Alfa Ltda",
        inicioVigencia: "2026-09-01",
        fimVigencia: "2027-09-01",
        observacoes: "Cláusula de reajuste em discussão.",
      },
    });
    expect(criada.status).toBe(201);
    const { registro } = await criada.json();
    expect(registro.titulo).toBe("Contrato de operação · Rede Alfa");
    expect(registro.risco).toBe("alto");
    expect(registro.situacao).toBe("rascunho");
    expect(registro.revision).toBe(1);

    const lista = await pedir("/api/todogreen/records/legal", { token: dona.token });
    expect((await lista.json()).registros.map((r) => r.titulo)).toContain("Contrato de operação · Rede Alfa");

    const atualizada = await pedir(`/api/todogreen/records/legal/${registro.id}`, {
      metodo: "PATCH",
      token: dona.token,
      corpo: { situacao: "em_analise", revision: 1 },
    });
    expect(atualizada.status).toBe(200);
    expect((await atualizada.json()).registro.situacao).toBe("em_analise");

    const semTitulo = await pedir("/api/todogreen/records/legal", {
      metodo: "POST",
      token: dona.token,
      corpo: { tipo: "minuta" },
    });
    expect(semTitulo.status).toBe(400);
  });

  it("valores fora da lista caem no padrão em vez de gravar lixo", async () => {
    const dona = await criarUsuario(`j-norm-${n}`, `j-norm-${n}@parceiro.com.br`);
    await autorizar(dona);
    const criada = await pedir("/api/todogreen/records/legal", {
      metodo: "POST",
      token: dona.token,
      corpo: { titulo: "Documento estranho", tipo: "foguete", risco: "catastrofico", situacao: "inventada" },
    });
    const { registro } = await criada.json();
    expect(registro.tipo).toBe("minuta");
    expect(registro.risco).toBe("medio");
    expect(registro.situacao).toBe("rascunho");
  });

  it("quem só lê não cria documento jurídico", async () => {
    const criada = await pedir("/api/todogreen/records/legal", {
      metodo: "POST",
      token: auditor.token,
      corpo: { titulo: "Auditor não deveria gravar" },
    });
    expect(criada.status).toBe(403);
  });
});

describe("pontos de recarga próprios (cadastro da eletrificação)", () => {
  it("grava o ponto e deriva 'serve pesado' de corrente + potência", async () => {
    const criada = await pedir("/api/todogreen/records/pontosRecarga", {
      metodo: "POST",
      token: gestora.token,
      corpo: {
        nome: "Pátio Guarulhos", operador: "GreenOn", tipoCorrente: "dc",
        conector: "CCS2", potenciaKw: 150, latitude: -23.43, longitude: -46.47, status: "ativo",
      },
    });
    expect(criada.status).toBe(201);
    const { registro } = await criada.json();
    expect(registro.nome).toBe("Pátio Guarulhos");
    expect(registro.tipoCorrente).toBe("DC");
    expect(registro.servePesado).toBe(true);
    expect(registro.latitude).toBe(-23.43);
  });

  it("AC potente não serve pesado; coordenada (0,0) não é gravada", async () => {
    const criada = await pedir("/api/todogreen/records/pontosRecarga", {
      metodo: "POST",
      token: gestora.token,
      corpo: { nome: "Doca AC", tipoCorrente: "AC", potenciaKw: 300, latitude: 0, longitude: 0 },
    });
    const { registro } = await criada.json();
    expect(registro.servePesado).toBe(false);
    expect(registro.latitude).toBeNull();
    expect(registro.longitude).toBeNull();
  });

  it("recusa ponto sem nome", async () => {
    const criada = await pedir("/api/todogreen/records/pontosRecarga", {
      metodo: "POST", token: gestora.token, corpo: { nome: "", potenciaKw: 50 },
    });
    expect(criada.status).toBe(400);
  });

  it("ponto de um espaço não aparece no outro", async () => {
    await pedir("/api/todogreen/records/pontosRecarga", {
      metodo: "POST", token: gestora.token, corpo: { nome: "Só da gestora", potenciaKw: 60, tipoCorrente: "DC" },
    });
    const lista = await pedir("/api/todogreen/records/pontosRecarga", { token: colega.token });
    const { registros } = await lista.json();
    expect(registros.some((r) => r.nome === "Só da gestora")).toBe(false);
  });

  it("quem só lê não cria ponto de recarga", async () => {
    const criada = await pedir("/api/todogreen/records/pontosRecarga", {
      metodo: "POST", token: auditor.token, corpo: { nome: "Auditor não grava" },
    });
    expect(criada.status).toBe(403);
  });
});
