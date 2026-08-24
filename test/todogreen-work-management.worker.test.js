import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Gestão de trabalho nível Monday: grupos no board, subitens, marcos,
// recorrência, checklist e tags — tudo aditivo sobre o work_items que já
// existia. O que estes testes impedem de voltar:
//   • campo novo (grupo/subitem/marco/recorrência/checklist/tag) sumindo no
//     ida-e-volta do servidor;
//   • grupo ou item de um espaço aparecendo em outro;
//   • apagar um grupo levando junto os itens em vez de soltá-los.

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const criarUsuario = async (id, email) => {
  const token = `work-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,'h','s',?)",
  ).bind(id, id, email, now).run();
  await env.DB.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)",
  ).bind(`session-${id}`, id, await sha256(token), now).run();
  return { id, email, token };
};

const call = (path, { method = "GET", token, body } = {}) => worker.fetch(
  new Request(`https://app.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }),
  env,
  { waitUntil() {}, passThroughOnException() {} },
);

let ana;
let outro;
let boardId;

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen','todogreen','To Do Green','logistica','active','{}',?,?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();

  ana = await criarUsuario("work-ana", "ana@work.test");
  outro = await criarUsuario("work-outro", "outro@work.test");
  const now = new Date().toISOString();
  for (const u of [ana, outro]) {
    await env.DB.prepare(
      `INSERT INTO todogreen_access_emails (id,tenant_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
       VALUES (?,'todogreen',?,'admin','active',?,'',?,?,?)`,
    ).bind(crypto.randomUUID(), u.email, JSON.stringify(["*"]), u.id, now, now).run();
  }

  // O primeiro GET semeia os boards padrão do espaço.
  const seed = await (await call("/api/todogreen/work-center", { token: ana.token })).json();
  boardId = seed.boards[0].id;
});

describe("grupos dentro do board", () => {
  it("cria, lista e edita um grupo", async () => {
    const criado = await call("/api/todogreen/work-center/groups", {
      method: "POST", token: ana.token, body: { boardId, name: "Backlog", color: "#34b78f" },
    });
    expect(criado.status).toBe(201);
    const { group } = await criado.json();
    expect(group.name).toBe("Backlog");

    const lista = await (await call(`/api/todogreen/work-center/groups?board=${boardId}`, { token: ana.token })).json();
    expect(lista.groups.some((g) => g.id === group.id)).toBe(true);

    const editado = await call(`/api/todogreen/work-center/groups/${group.id}`, {
      method: "PATCH", token: ana.token, body: { name: "Em execução", collapsed: true },
    });
    expect((await editado.json()).group.name).toBe("Em execução");
  });

  it("apagar o grupo solta os itens em vez de apagá-los", async () => {
    const { group } = await (await call("/api/todogreen/work-center/groups", {
      method: "POST", token: ana.token, body: { boardId, name: "Temporário" },
    })).json();
    const { item } = await (await call("/api/todogreen/work-center", {
      method: "POST", token: ana.token, body: { boardId, title: "Item no grupo", groupId: group.id },
    })).json();
    expect(item.groupId).toBe(group.id);

    const apagar = await call(`/api/todogreen/work-center/groups/${group.id}`, { method: "DELETE", token: ana.token });
    expect(apagar.status).toBe(200);

    const itens = await (await call("/api/todogreen/work-center", { token: ana.token })).json();
    const solto = itens.items.find((i) => i.id === item.id);
    expect(solto).toBeTruthy();
    expect(solto.groupId).toBe("");
  });
});

describe("itens com estrutura nova", () => {
  it("persiste marco, início, recorrência, checklist e tags no ida-e-volta", async () => {
    const body = {
      boardId,
      title: "Kickoff do cliente",
      isMilestone: true,
      startDate: "2026-03-01",
      dueDate: "2026-03-01",
      recurrence: { frequencia: "semanal", intervalo: 1, ate: "2026-04-01" },
      checklist: [{ texto: "Enviar contrato", feito: false }, { texto: "Configurar portal", feito: true }],
      tags: ["onboarding", "prioritario"],
    };
    const criado = await call("/api/todogreen/work-center", { method: "POST", token: ana.token, body });
    expect(criado.status).toBe(201);
    const { item } = await criado.json();
    expect(item.isMilestone).toBe(true);
    expect(item.startDate).toBe("2026-03-01");
    expect(item.recurrence.frequencia).toBe("semanal");
    expect(item.checklist).toHaveLength(2);
    expect(item.tags).toEqual(["onboarding", "prioritario"]);

    // E persiste de verdade — relendo do banco.
    const relido = await (await call("/api/todogreen/work-center", { token: ana.token })).json();
    const encontrado = relido.items.find((i) => i.id === item.id);
    expect(encontrado.tags).toEqual(["onboarding", "prioritario"]);
    expect(encontrado.checklist[1].feito).toBe(true);
  });

  it("subitem aponta para o item pai", async () => {
    const { item: pai } = await (await call("/api/todogreen/work-center", {
      method: "POST", token: ana.token, body: { boardId, title: "Épico" },
    })).json();
    const { item: filho } = await (await call("/api/todogreen/work-center", {
      method: "POST", token: ana.token, body: { boardId, title: "Subtarefa", parentItemId: pai.id },
    })).json();
    expect(filho.parentItemId).toBe(pai.id);
  });

  it("editar mantém os campos novos que não foram enviados", async () => {
    const { item } = await (await call("/api/todogreen/work-center", {
      method: "POST", token: ana.token, body: { boardId, title: "Com tags", tags: ["a", "b"] },
    })).json();
    const editado = await call(`/api/todogreen/work-center/${item.id}`, {
      method: "PATCH", token: ana.token, body: { revision: item.revision, title: "Renomeado" },
    });
    const atualizado = (await editado.json()).item;
    expect(atualizado.title).toBe("Renomeado");
    expect(atualizado.tags).toEqual(["a", "b"]);
  });
});

describe("escopo", () => {
  it("um espaço não vê o grupo do outro", async () => {
    const { group } = await (await call("/api/todogreen/work-center/groups", {
      method: "POST", token: ana.token, body: { boardId, name: "Só da Ana" },
    })).json();
    const seedOutro = await (await call("/api/todogreen/work-center", { token: outro.token })).json();
    const grupos = await (await call(`/api/todogreen/work-center/groups?board=${seedOutro.boards[0].id}`, { token: outro.token })).json();
    expect(grupos.groups.some((g) => g.id === group.id)).toBe(false);
  });
});
