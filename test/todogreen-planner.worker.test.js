import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Planner (estilo Microsoft Planner). O que estes testes protegem:
//   • plano PRIVADO só aparece para quem criou; COMPARTILHADO, para o espaço;
//   • quem não tem planner:manage lê, mas não escreve (403);
//   • um espaço não vê o plano do outro (404, não 403);
//   • concorrência: dois PATCH com a mesma revision — o segundo é 409;
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
const pedir = (caminho, { metodo = "GET", token, corpo } = {}) => {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${caminho}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }),
    env, { waitUntil() {}, passThroughOnException() {} },
  );
};

let ana; // criadora e dona do espaço
let bia; // colega no mesmo espaço
let leo; // auditor no mesmo espaço, sem planner:manage
let externo; // outro espaço (dono do próprio)

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
