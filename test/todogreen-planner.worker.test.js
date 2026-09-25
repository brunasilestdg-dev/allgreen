import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Planner (estilo Microsoft Planner). O que estes testes protegem:
//   • plano PRIVADO só aparece para quem criou; COMPARTILHADO, para o espaço;
//   • quem não tem planner:manage lê, mas não escreve (403);
//   • um espaço não vê o plano do outro (404, não 403);
//   • escrita direta de tarefa exige opt-in legado; o app atual usa a task canônica;
//   • concorrência no caminho legado: dois PATCH com a mesma revision — o segundo é 409;
//   • progresso concluída carimba data; tarefa órfã de balde inválido cai no
//     primeiro balde, não some.

let n = 0;
const nextIp = () => `198.29.0.${(++n % 240) + 1}`;

async function sha256(v) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function criarUsuario(id, email) {
  const token = `tok-${id}`;
  const agora = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (id, name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, 'h', 's', ?)")
    .bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)")
    .bind(`ses-${id}`, id, await sha256(token), agora).run();
  return { id, email, token };
}
// No MESMO espaço de trabalho — sem isso cada pessoa teria o próprio espaço e a
// visibilidade compartilhada nunca seria exercida.
async function vincular(usuario, papel, permissoes, donoDoEspaco) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO tenant_users
       (id, tenant_id, workspace_owner_id, user_id, role, status, permissions_json, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, user_id) DO UPDATE SET role = excluded.role,
       workspace_owner_id = excluded.workspace_owner_id,
       permissions_json = excluded.permissions_json, status = 'active'`,
  ).bind(crypto.randomUUID(), donoDoEspaco, usuario.id, papel, JSON.stringify(permissoes), agora, agora).run();
}
const pedir = (caminho, { metodo = "GET", token, corpo, compatLegada = true } = {}) => {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers["content-type"] = "application/json";
  if (
    compatLegada &&
    ["POST", "PATCH", "PUT", "DELETE"].includes(metodo) &&
    /\/api\/todogreen\/planner\/planos\/[^/]+\/tarefas/.test(caminho)
  ) headers["x-tdg-legacy-planner-write"] = "1";
  return worker.fetch(
    new Request(`https://app.test${caminho}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }),
    env, { waitUntil() {}, passThroughOnException() {} },
  );
};

let ana; // criadora e dona do espaço
let bia; // colega no mesmo espaço
let leo; // auditor no mesmo espaço, sem planner:manage
let externo; // outro espaço (dono do próprio)
let colab; // só no espaço do APP (memberships), sem vínculo com a vertical

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen','todogreen','To Do Green','logistica','active','{}',?,?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();
  ana = await criarUsuario("plan-ana", "ana@plan.test");
  bia = await criarUsuario("plan-bia", "bia@plan.test");
  leo = await criarUsuario("plan-leo", "leo@plan.test");
  externo = await criarUsuario("plan-externo", "externo@plan.test");
  // O espaço é o do dono, que é um usuário real (FK). Ana é a dona; Bia e Leo
  // são do mesmo espaço; o externo é dono do próprio.
  await vincular(ana, "vendedor", ["read", "planner:manage"], ana.id);
  await vincular(bia, "vendedor", ["read", "planner:manage"], ana.id);
  await vincular(leo, "auditor", ["read"], ana.id);
  await vincular(externo, "vendedor", ["read", "planner:manage"], externo.id);
  // Colaborador convidado pelo "Seu Funcionário": existe em memberships do
  // espaço da Ana, mas nunca foi liberado na To Do Green.
  colab = await criarUsuario("plan-colab", "colab@plan.test");
  await env.DB.prepare(
    "INSERT INTO memberships (id, owner_id, member_id, role, created_at, status) VALUES (?, ?, ?, 'colaborador', ?, 'ativo')",
  ).bind(crypto.randomUUID(), ana.id, colab.id, new Date().toISOString()).run();
});

describe("permissão de escrita", () => {
  it("sem planner:manage, o auditor lê mas não cria (403)", async () => {
    expect((await pedir("/api/todogreen/planner/planos", { token: leo.token })).status).toBe(200);
    const r = await pedir("/api/todogreen/planner/planos", {
      metodo: "POST", token: leo.token, corpo: { name: "Não pode" },
    });
    expect(r.status).toBe(403);
  });
  it("sem sessão, 401", async () => {
    expect((await pedir("/api/todogreen/planner/planos")).status).toBe(401);
  });
});

describe("visibilidade: privado x compartilhado", () => {
  let privadoDaAna;
  let compartilhadoDaAna;

  it("cria plano privado e um compartilhado", async () => {
    const p = await (await pedir("/api/todogreen/planner/planos", {
      metodo: "POST", token: ana.token,
      corpo: { name: "Rascunhos da Ana", visibility: "private" },
    })).json();
    privadoDaAna = p.id;
    expect(p.visibility).toBe("private");
    expect(p.ownerUserId).toBe(ana.id);
    // Todo plano nasce com ao menos o balde padrão.
    expect(p.buckets.length).toBeGreaterThanOrEqual(1);

    const c = await (await pedir("/api/todogreen/planner/planos", {
      metodo: "POST", token: ana.token,
      corpo: { name: "Time comercial", visibility: "shared", buckets: [{ id: "todo", nome: "A fazer" }, { id: "doing", nome: "Fazendo" }] },
    })).json();
    compartilhadoDaAna = c.id;
    expect(c.visibility).toBe("shared");
  });

  it("a colega vê o compartilhado, não vê o privado", async () => {
    const lista = await (await pedir("/api/todogreen/planner/planos", { token: bia.token })).json();
    const ids = lista.registros.map((p) => p.id);
    expect(ids).toContain(compartilhadoDaAna);
    expect(ids).not.toContain(privadoDaAna);
  });

  it("acessar o privado alheio responde 404, não 403", async () => {
    const r = await pedir(`/api/todogreen/planner/planos/${privadoDaAna}/tarefas`, { token: bia.token });
    expect(r.status).toBe(404);
  });

  it("outro espaço não enxerga nada deste", async () => {
    const lista = await (await pedir("/api/todogreen/planner/planos", { token: externo.token })).json();
    const ids = lista.registros.map((p) => p.id);
    expect(ids).not.toContain(compartilhadoDaAna);
    expect(ids).not.toContain(privadoDaAna);
  });

  it("só o criador altera a estrutura do plano compartilhado", async () => {
    const atual = await (await pedir("/api/todogreen/planner/planos", { token: ana.token })).json();
    const plano = atual.registros.find((p) => p.id === compartilhadoDaAna);
    const r = await pedir(`/api/todogreen/planner/planos/${compartilhadoDaAna}`, {
      metodo: "PATCH", token: bia.token, corpo: { name: "Renomeei", revision: plano.revision },
    });
    expect(r.status).toBe(403);
  });
});

describe("tarefas de um plano compartilhado", () => {
  let planId;
  let taskId;
  let taskRevision;

  it("prepara um plano compartilhado", async () => {
    const c = await (await pedir("/api/todogreen/planner/planos", {
      metodo: "POST", token: ana.token,
      corpo: { name: "Operação", visibility: "shared", buckets: [{ id: "todo", nome: "A fazer" }] },
    })).json();
    planId = c.id;
  });

  it("bloqueia escrita direta de tarefa sem opt-in legado", async () => {
    const r = await pedir(`/api/todogreen/planner/planos/${planId}/tarefas`, {
      metodo: "POST",
      token: bia.token,
      compatLegada: false,
      corpo: { title: "Não deve criar uma segunda verdade" },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("CANONICAL_TASK_REQUIRED");
  });

  it("qualquer colega do espaço cria tarefa; balde inválido cai no primeiro", async () => {
    const r = await pedir(`/api/todogreen/planner/planos/${planId}/tarefas`, {
      metodo: "POST", token: bia.token,
      corpo: { title: "Ligar para o cliente", bucketId: "inexistente", priority: "urgente", assigneeUserId: bia.id, assigneeLabel: "Bia" },
    });
    expect(r.status).toBe(201);
    const t = await r.json();
    taskId = t.id;
    taskRevision = t.revision;
    expect(t.bucketId).toBe("todo");
    expect(t.priority).toBe("urgente");
  });

  it("concluir carimba a data de conclusão", async () => {
    const r = await pedir(`/api/todogreen/planner/planos/${planId}/tarefas/${taskId}`, {
      metodo: "PATCH", token: bia.token, corpo: { progress: "concluida", revision: taskRevision },
    });
    expect(r.status).toBe(200);
    const t = await r.json();
    expect(t.progress).toBe("concluida");
    expect(t.completedAt).toBeTruthy();
    taskRevision = t.revision;
  });

  it("dois PATCH com a mesma revision: o segundo é 409", async () => {
    const primeiro = await pedir(`/api/todogreen/planner/planos/${planId}/tarefas/${taskId}`, {
      metodo: "PATCH", token: ana.token, corpo: { title: "Ligar hoje", revision: taskRevision },
    });
    expect(primeiro.status).toBe(200);
    const segundo = await pedir(`/api/todogreen/planner/planos/${planId}/tarefas/${taskId}`, {
      metodo: "PATCH", token: bia.token, corpo: { title: "Outra coisa", revision: taskRevision },
    });
    expect(segundo.status).toBe(409);
  });

  it("minhas-tarefas traz o que é meu; concluídas ficam fora por padrão", async () => {
    // Cria uma tarefa aberta para a Bia.
    await pedir(`/api/todogreen/planner/planos/${planId}/tarefas`, {
      metodo: "POST", token: bia.token, corpo: { title: "Follow-up", assigneeUserId: bia.id },
    });
    const minhas = await (await pedir("/api/todogreen/planner/minhas-tarefas", { token: bia.token })).json();
    const titulos = minhas.registros.map((t) => t.title);
    expect(titulos).toContain("Follow-up");
    // A tarefa concluída não aparece sem o filtro.
    expect(minhas.registros.every((t) => t.progress !== "concluida")).toBe(true);
    const comConcluidas = await (await pedir("/api/todogreen/planner/minhas-tarefas?concluidas=1", { token: bia.token })).json();
    expect(comConcluidas.registros.some((t) => t.progress === "concluida")).toBe(true);
  });

  it("arquivar o plano leva as tarefas junto", async () => {
    expect((await pedir(`/api/todogreen/planner/planos/${planId}`, { metodo: "DELETE", token: ana.token })).status).toBe(200);
    const lista = await (await pedir("/api/todogreen/planner/planos", { token: ana.token })).json();
    expect(lista.registros.some((p) => p.id === planId)).toBe(false);
    // Tarefa arquivada não volta em minhas-tarefas.
    const minhas = await (await pedir("/api/todogreen/planner/minhas-tarefas", { token: bia.token })).json();
    expect(minhas.registros.some((t) => t.planId === planId)).toBe(false);
  });
});

describe("responsável por id precisa ser gente do espaço", () => {
  // A tela sugere pessoas da plataforma e manda o id junto do rótulo. O id só
  // gruda se a pessoa for do espaço (dona, membro do app ou vínculo da
  // vertical); id de fora vira rótulo solto — atribuição fantasma não entra
  // em Minhas tarefas de ninguém.
  let planId;

  it("prepara um plano compartilhado", async () => {
    const c = await (await pedir("/api/todogreen/planner/planos", {
      metodo: "POST", token: ana.token,
      corpo: { name: "Atribuições", visibility: "shared", buckets: [{ id: "todo", nome: "A fazer" }] },
    })).json();
    planId = c.id;
  });

  it("colega do espaço vira responsável de verdade e vê a tarefa nas dela", async () => {
    const r = await pedir(`/api/todogreen/planner/planos/${planId}/tarefas`, {
      metodo: "POST", token: ana.token,
      corpo: { title: "Fechar escala da semana", assigneeUserId: bia.id, assigneeLabel: "Bia" },
    });
    expect(r.status).toBe(201);
    const t = await r.json();
    expect(t.assigneeUserId).toBe(bia.id);

    const minhas = await (await pedir("/api/todogreen/planner/minhas-tarefas", { token: bia.token })).json();
    expect(minhas.registros.some((x) => x.id === t.id)).toBe(true);
  });

  it("id de quem não é do espaço não cola — fica só o rótulo", async () => {
    const r = await pedir(`/api/todogreen/planner/planos/${planId}/tarefas`, {
      metodo: "POST", token: ana.token,
      corpo: { title: "Cobrar fornecedor", assigneeUserId: externo.id, assigneeLabel: "Fornecedor Externo" },
    });
    expect(r.status).toBe(201);
    const t = await r.json();
    expect(t.assigneeUserId).toBe("");
    expect(t.assigneeLabel).toBe("Fornecedor Externo");

    // E o de fora não ganha tarefa no espaço alheio por tabela.
    const dele = await (await pedir("/api/todogreen/planner/minhas-tarefas", { token: externo.token })).json();
    expect(dele.registros.some((x) => x.id === t.id)).toBe(false);
  });

  it("no PATCH a mesma régua vale: id inválido é limpo, válido fica", async () => {
    const criada = await (await pedir(`/api/todogreen/planner/planos/${planId}/tarefas`, {
      metodo: "POST", token: ana.token,
      corpo: { title: "Revisar rota", assigneeUserId: bia.id, assigneeLabel: "Bia" },
    })).json();

    const trocada = await (await pedir(`/api/todogreen/planner/planos/${planId}/tarefas/${criada.id}`, {
      metodo: "PATCH", token: ana.token,
      corpo: { revision: criada.revision, assigneeUserId: externo.id, assigneeLabel: "Alguém de fora" },
    })).json();
    expect(trocada.assigneeUserId).toBe("");
    expect(trocada.assigneeLabel).toBe("Alguém de fora");
  });
});

describe("plano compartilhado com pessoas específicas", () => {
  // Pedido da titular (30/08): "o planner pode ser compartilhado com pessoas
  // específicas". O plano continua privado; quem está na lista vê e trabalha
  // nas tarefas. Quem é do espaço mas NÃO está na lista continua de fora, e
  // id de fora do espaço não entra na lista nem por engano.
  let planId;

  it("cria plano privado com pessoas escolhidas; id de fora do espaço é descartado", async () => {
    const r = await pedir("/api/todogreen/planner/planos", {
      metodo: "POST", token: ana.token,
      corpo: {
        name: "Implantação Cliente X", visibility: "private",
        buckets: [{ id: "todo", nome: "A fazer" }],
        members: [bia.id, externo.id, bia.id],
      },
    });
    expect(r.status).toBe(201);
    const plano = await r.json();
    planId = plano.id;
    expect(plano.visibility).toBe("private");
    expect(plano.members).toEqual([bia.id]);
  });

  it("quem está na lista vê o plano e cria tarefa; quem não está, não vê (404)", async () => {
    const daBia = await (await pedir("/api/todogreen/planner/planos", { token: bia.token })).json();
    expect(daBia.registros.some((p) => p.id === planId)).toBe(true);

    const tarefa = await pedir(`/api/todogreen/planner/planos/${planId}/tarefas`, {
      metodo: "POST", token: bia.token,
      corpo: { title: "Levantar janelas de entrega", assigneeUserId: bia.id, assigneeLabel: "Bia" },
    });
    expect(tarefa.status).toBe(201);

    // Leo é do MESMO espaço, mas não foi listado: o plano não existe para ele.
    const doLeo = await (await pedir("/api/todogreen/planner/planos", { token: leo.token })).json();
    expect(doLeo.registros.some((p) => p.id === planId)).toBe(false);
    expect((await pedir(`/api/todogreen/planner/planos/${planId}/tarefas`, { token: leo.token })).status).toBe(404);
  });

  it("a tarefa atribuída entra em Minhas tarefas de quem foi listado", async () => {
    const minhas = await (await pedir("/api/todogreen/planner/minhas-tarefas", { token: bia.token })).json();
    expect(minhas.registros.some((t) => t.planId === planId)).toBe(true);
  });

  it("só quem criou mexe na lista; tirar a pessoa fecha a porta na hora", async () => {
    const atual = await (await pedir("/api/todogreen/planner/planos", { token: ana.token })).json();
    const plano = atual.registros.find((p) => p.id === planId);

    const daBia = await pedir(`/api/todogreen/planner/planos/${planId}`, {
      metodo: "PATCH", token: bia.token,
      corpo: { revision: plano.revision, members: [] },
    });
    expect(daBia.status).toBe(403);

    const daAna = await pedir(`/api/todogreen/planner/planos/${planId}`, {
      metodo: "PATCH", token: ana.token,
      corpo: { revision: plano.revision, members: [] },
    });
    expect(daAna.status).toBe(200);
    expect((await daAna.json()).members).toEqual([]);

    expect((await pedir(`/api/todogreen/planner/planos/${planId}/tarefas`, { token: bia.token })).status).toBe(404);
  });
});


describe("Planner universal com contexto comercial opcional", () => {
  it("cria projeto de marketing sem exigir cliente ou oportunidade", async () => {
    const plano = await (await pedir("/api/todogreen/planner/planos", {
      metodo: "POST",
      token: ana.token,
      corpo: { name: "Campanha de marca", visibility: "private" },
    })).json();
    const resposta = await pedir(`/api/todogreen/planner/planos/${plano.id}/tarefas`, {
      metodo: "POST",
      token: ana.token,
      corpo: { title: "Criar conceito da campanha", campos: {} },
    });
    expect(resposta.status).toBe(201);
    expect((await resposta.json()).campos).toMatchObject({ clientId: "", opportunityId: "" });
  });

  it("recusa vínculo com cliente inexistente", async () => {
    const plano = await (await pedir("/api/todogreen/planner/planos", {
      metodo: "POST",
      token: ana.token,
      corpo: { name: "Comercial com vínculo", visibility: "private" },
    })).json();
    const resposta = await pedir(`/api/todogreen/planner/planos/${plano.id}/tarefas`, {
      metodo: "POST",
      token: ana.token,
      corpo: {
        title: "Ação comercial",
        campos: { clientId: "cliente-que-nao-existe", opportunityId: "" },
      },
    });
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).error).toMatch(/Cliente vinculado não encontrado/);
  });
});

describe("compartilhar com quem não alcança a vertical", () => {
  // O bug relatado pela titular: "compartilhei e as pessoas não conseguem
  // ver". A lista de pessoas aceitava quem só está no espaço do app
  // (memberships) — e a vertical recusa essa pessoa na porta. Agora o servidor
  // DIZ quem alcança e quem não, e a resposta do plano lista quem ficou de fora.
  it("/pessoas marca quem alcança o Planner neste espaço", async () => {
    const { registros } = await (await pedir("/api/todogreen/planner/pessoas", { token: ana.token })).json();
    const porId = Object.fromEntries(registros.map((p) => [p.id, p]));
    expect(porId[bia.id]?.alcancaPlanner).toBe(true);
    // Auditor lê a vertical: vê plano compartilhado com ele, mesmo sem planner:manage.
    expect(porId[leo.id]?.alcancaPlanner).toBe(true);
    // Só no espaço do app: aparece (é gente do espaço), mas não alcança.
    expect(porId[colab.id]?.alcancaPlanner).toBe(false);
    // Quem é de outro espaço nem aparece.
    expect(porId[externo.id]).toBeUndefined();
  });

  it("o plano aceita a pessoa na lista, mas avisa que ela ainda não alcança; a vertical a recusa (403)", async () => {
    const r = await pedir("/api/todogreen/planner/planos", {
      metodo: "POST", token: ana.token,
      corpo: { name: "Novos Negócios", visibility: "private", members: [bia.id, colab.id] },
    });
    expect(r.status).toBe(201);
    const plano = await r.json();
    expect(plano.members).toEqual([bia.id, colab.id]);
    expect(plano.membrosSemAcesso).toEqual([colab.id]);

    expect((await pedir("/api/todogreen/planner/planos", { token: colab.token })).status).toBe(403);

    // Liberada na vertical, a mesma pessoa passa a ver o plano sem recompartilhar.
    await vincular(colab, "auditor", ["read"], ana.id);
    const daColab = await (await pedir("/api/todogreen/planner/planos", { token: colab.token })).json();
    expect(daColab.registros.some((p) => p.id === plano.id)).toBe(true);

    const patch = await pedir(`/api/todogreen/planner/planos/${plano.id}`, {
      metodo: "PATCH", token: ana.token,
      corpo: { revision: plano.revision, members: [bia.id, colab.id] },
    });
    expect((await patch.json()).membrosSemAcesso).toEqual([]);
  });

  it("?owner= do próprio espaço não muda o recorte; espaço alheio é recusado", async () => {
    const proprio = await pedir(`/api/todogreen/planner/planos?owner=${ana.id}`, { token: bia.token });
    expect(proprio.status).toBe(200);
    const alheio = await pedir(`/api/todogreen/planner/planos?owner=${externo.id}`, { token: bia.token });
    expect(alheio.status).toBe(404);
  });
});

describe("ações do plano no quadro único do espaço", () => {
  // O segundo bug relatado: "permanece invisível para os demais". Cada pessoa
  // gravava as ações no PRÓPRIO workspace; quem recebia o plano abria um
  // quadro vazio. As ações agora moram no db.tasks do dono do espaço e são
  // lidas com o corte do PLANO: quem vê o plano vê todas as ações.
  let planId;
  const quadroDaAna = async () => {
    const row = await env.DB.prepare("SELECT data, revision FROM workspaces WHERE user_id = ?").bind(ana.id).first();
    return { tarefas: JSON.parse(row?.data || "{}").tasks || [], revision: row?.revision ?? -1 };
  };

  it("a colega cria uma ação e ela vai para o quadro da dona do espaço", async () => {
    const plano = await (await pedir("/api/todogreen/planner/planos", {
      metodo: "POST", token: ana.token,
      corpo: { name: "Novos Negócios (ações)", visibility: "private", members: [bia.id] },
    })).json();
    planId = plano.id;

    const antes = (await quadroDaAna()).revision;
    const r = await pedir(`/api/todogreen/planner/planos/${planId}/acoes/acao-bia-1`, {
      metodo: "PUT", token: bia.token,
      corpo: { tarefa: { title: "Informar ID do Mercado Livre", priority: "alta", progress: "nao_iniciada", dueDate: "2026-09-25", bucketId: "a_fazer" } },
    });
    expect(r.status).toBe(200);
    const { tarefa, espaco } = await r.json();
    expect(tarefa).toMatchObject({ id: "acao-bia-1", plannerPlanId: planId, ownerId: bia.id, priority: "Alta", status: "A fazer" });
    expect(espaco.revision).toBe(antes + 1);

    const quadro = await quadroDaAna();
    const gravada = quadro.tarefas.find((t) => t.id === "acao-bia-1");
    expect(gravada).toBeTruthy();
    // A criadora do plano entra na partilha da ação (To Do/Meu Dia dela).
    expect(gravada.sharedWith).toEqual([ana.id]);
  });

  it("a dona cria outra; as duas pessoas do plano veem as DUAS ações", async () => {
    await pedir(`/api/todogreen/planner/planos/${planId}/acoes/acao-ana-1`, {
      metodo: "PUT", token: ana.token,
      corpo: { tarefa: { title: "Integração Mercado Livre", priority: "alta", progress: "em_andamento" } },
    });
    for (const pessoa of [ana, bia]) {
      const { registros } = await (await pedir(`/api/todogreen/planner/planos/${planId}/acoes`, { token: pessoa.token })).json();
      expect(registros.map((t) => t.id).sort()).toEqual(["acao-ana-1", "acao-bia-1"]);
      const todas = await (await pedir("/api/todogreen/planner/acoes", { token: pessoa.token })).json();
      expect(todas.registros.filter((t) => t.plannerPlanId === planId)).toHaveLength(2);
    }
  });

  it("quem é do espaço mas não está no plano não vê as ações (404 / fora da lista)", async () => {
    expect((await pedir(`/api/todogreen/planner/planos/${planId}/acoes`, { token: leo.token })).status).toBe(404);
    const todas = await (await pedir("/api/todogreen/planner/acoes", { token: leo.token })).json();
    expect(todas.registros.some((t) => t.plannerPlanId === planId)).toBe(false);
    // E outro espaço não alcança nada.
    expect((await pedir(`/api/todogreen/planner/planos/${planId}/acoes`, { token: externo.token })).status).toBe(404);
  });

  it("quem só lê vê, mas não grava (403); id de tarefa de fora do plano não é sequestrado (409)", async () => {
    // Leo passa a ver: plano aberto ao espaço.
    const atual = (await (await pedir("/api/todogreen/planner/planos", { token: ana.token })).json()).registros.find((p) => p.id === planId);
    await pedir(`/api/todogreen/planner/planos/${planId}`, { metodo: "PATCH", token: ana.token, corpo: { revision: atual.revision, visibility: "shared", members: [] } });
    const doLeo = await (await pedir(`/api/todogreen/planner/planos/${planId}/acoes`, { token: leo.token })).json();
    expect(doLeo.registros).toHaveLength(2);
    expect((await pedir(`/api/todogreen/planner/planos/${planId}/acoes/x1`, {
      metodo: "PUT", token: leo.token, corpo: { tarefa: { title: "Não pode" } },
    })).status).toBe(403);

    // "Todo o espaço" desceu para as ações no quadro (To Do de quem é do espaço).
    const quadro = await quadroDaAna();
    expect(quadro.tarefas.filter((t) => t.plannerPlanId === planId).every((t) => t.visibility === "espaco_todo")).toBe(true);

    // Uma tarefa do To Do que não é do plano não é tomada por um PUT.
    const { revision } = await quadroDaAna();
    const row = await env.DB.prepare("SELECT data FROM workspaces WHERE user_id = ?").bind(ana.id).first();
    const dados = JSON.parse(row.data);
    dados.tasks = [{ id: "todo-solta", title: "Do To Do", ownerId: ana.id }, ...dados.tasks];
    await env.DB.prepare("UPDATE workspaces SET data = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?").bind(JSON.stringify(dados), ana.id, revision).run();
    expect((await pedir(`/api/todogreen/planner/planos/${planId}/acoes/todo-solta`, {
      metodo: "PUT", token: bia.token, corpo: { tarefa: { title: "Sequestro" } },
    })).status).toBe(409);
  });

  it("remover tira a ação do quadro; arquivar o plano mantém as ações, só desvinculadas", async () => {
    const del = await pedir(`/api/todogreen/planner/planos/${planId}/acoes/acao-bia-1`, { metodo: "DELETE", token: bia.token });
    expect((await del.json()).espaco.removidas).toEqual(["acao-bia-1"]);
    expect((await quadroDaAna()).tarefas.some((t) => t.id === "acao-bia-1")).toBe(false);

    const arq = await pedir(`/api/todogreen/planner/planos/${planId}`, { metodo: "DELETE", token: ana.token });
    expect(arq.status).toBe(200);
    const restante = (await quadroDaAna()).tarefas.find((t) => t.id === "acao-ana-1");
    expect(restante).toMatchObject({ plannerPlanId: "", title: "Integração Mercado Livre" });
    expect(restante.visibility).toBe("privado");
  });
});
