import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import { carregarMemoriaDoCliente, carregarCorrecoesDoPlantu } from "../worker/services/todogreen-semente.js";

// Memória conversacional do Plantû (0091): a conversa persiste, mas é PRIVADA
// de quem perguntou. Estes testes existem para impedir de voltar:
//   • a thread de uma pessoa aparecer para outra (vazamento entre espaços);
//   • a hidratação vazar a conversa de outro usuário do mesmo espaço.

let n = 0;
const nextIp = () => `198.30.0.${(++n % 240) + 1}`;

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

async function autorizar(usuario) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'admin', 'active', ?, '', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET role = excluded.role,
       permissions_json = excluded.permissions_json, status = 'active'`,
  ).bind(crypto.randomUUID(), usuario.email, JSON.stringify(["*"]), usuario.id, agora, agora).run();
}

async function semearMensagem(ownerId, userId, role, content, clientId = null) {
  await env.DB.prepare(
    `INSERT INTO todogreen_ai_messages
       (id, tenant_id, workspace_owner_id, user_id, assistente, role, content, client_id, created_at, archived_at)
     VALUES (?, 'todogreen', ?, ?, 'plantu', ?, ?, ?, ?, NULL)`,
  ).bind(crypto.randomUUID(), ownerId, userId, role, content, clientId, new Date().toISOString()).run();
}

const pedir = (token, corpo) =>
  worker.fetch(
    new Request("https://app.test/api/todogreen/semente", {
      method: "POST",
      headers: { "cf-connecting-ip": nextIp(), authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );

const pedirHistorico = (token) => pedir(token, { historicoPersistido: true });

let ana;
let bruno;

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();

  ana = await criarUsuario("mem-ana", "ana@memoria.test");
  bruno = await criarUsuario("mem-bruno", "bruno@memoria.test");
  await autorizar(ana);
  await autorizar(bruno);

  // Conversa da Ana, no espaço dela.
  await semearMensagem(ana.id, ana.id, "user", "Quais contas estão frias?");
  await semearMensagem(ana.id, ana.id, "assistant", "Três contas estão frias: A, B e C.");
});

describe("memória conversacional do Plantû", () => {
  it("hidrata a conversa guardada da própria pessoa, em ordem", async () => {
    const resposta = await pedirHistorico(ana.token);
    expect(resposta.status).toBe(200);
    const { mensagens } = await resposta.json();
    expect(mensagens.map((m) => m.de)).toEqual(["voce", "semente"]);
    expect(mensagens[0].texto).toBe("Quais contas estão frias?");
    expect(mensagens[1].texto).toBe("Três contas estão frias: A, B e C.");
  });

  it("não vaza a thread de uma pessoa para outra (isolamento por espaço/usuário)", async () => {
    const resposta = await pedirHistorico(bruno.token);
    expect(resposta.status).toBe(200);
    const { mensagens } = await resposta.json();
    expect(mensagens).toEqual([]);
  });

  it("avaliação (👍/👎) é da própria pessoa: ninguém vota na resposta de outra", async () => {
    // Uma resposta do assistente da Ana, com id conhecido.
    await env.DB.prepare(
      `INSERT INTO todogreen_ai_messages
         (id, tenant_id, workspace_owner_id, user_id, assistente, role, content, client_id, created_at, archived_at)
       VALUES ('resp-ana-voto', 'todogreen', ?, ?, 'plantu', 'assistant', 'Resposta avaliável.', NULL, ?, NULL)`,
    ).bind(ana.id, ana.id, new Date().toISOString()).run();

    // Bruno tenta avaliar a resposta da Ana → 404 (para ele, não existe).
    const brunoTenta = await pedir(bruno.token, { avaliar: { mensagemId: "resp-ana-voto", nota: 1 } });
    expect(brunoTenta.status).toBe(404);

    // Ana avalia a própria resposta → grava.
    const anaVota = await pedir(ana.token, { avaliar: { mensagemId: "resp-ana-voto", nota: 1 } });
    expect(anaVota.status).toBe(200);
    expect((await anaVota.json()).avaliacao).toBe(1);

    // O voto continua NULL na visão do Bruno — ele nunca tocou nela.
    const linha = await env.DB.prepare("SELECT rating FROM todogreen_ai_messages WHERE id = 'resp-ana-voto'").first();
    expect(linha.rating).toBe(1);
  });
});

// Memória por cliente (fase 2b): com uma conta aberta, o Plantû retoma o que já
// se conversou sobre ELA — mas essa memória é privada de quem perguntou e
// escopada à conta certa. Estes testes impedem de voltar: memória de uma conta
// vazando para outra, e memória de uma pessoa vazando para outra do mesmo espaço.
describe("memória por cliente do Plantû", () => {
  beforeAll(async () => {
    await semearMensagem(ana.id, ana.id, "user", "Como está a conta Acme?", "acme");
    await semearMensagem(ana.id, ana.id, "assistant", "A Acme tem 2 oportunidades abertas.", "acme");
    await semearMensagem(ana.id, ana.id, "user", "E a Beta?", "beta");
    await semearMensagem(ana.id, ana.id, "assistant", "A Beta está fria.", "beta");
  });

  it("retoma só a conversa DESTA conta, em ordem, com papéis corretos", async () => {
    const memoria = await carregarMemoriaDoCliente(env, { ownerId: ana.id }, { id: ana.id }, "acme");
    expect(memoria.map((m) => m.de)).toEqual(["Pessoa", "Plantû"]);
    expect(memoria.map((m) => m.texto)).toEqual(["Como está a conta Acme?", "A Acme tem 2 oportunidades abertas."]);
  });

  it("não mistura a memória de outra conta", async () => {
    const memoria = await carregarMemoriaDoCliente(env, { ownerId: ana.id }, { id: ana.id }, "acme");
    expect(memoria.some((m) => m.texto.includes("Beta"))).toBe(false);
  });

  it("é privada de quem perguntou: outra pessoa do espaço não vê a conta da Ana", async () => {
    const memoria = await carregarMemoriaDoCliente(env, { ownerId: ana.id }, { id: bruno.id }, "acme");
    expect(memoria).toEqual([]);
  });

  it("sem conta em foco (id vazio), não retorna nada", async () => {
    expect(await carregarMemoriaDoCliente(env, { ownerId: ana.id }, { id: ana.id }, "")).toEqual([]);
  });

  it("não traz turnos arquivados desta conta", async () => {
    await env.DB.prepare(
      `INSERT INTO todogreen_ai_messages
         (id, tenant_id, workspace_owner_id, user_id, assistente, role, content, client_id, created_at, archived_at)
       VALUES (?, 'todogreen', ?, ?, 'plantu', 'assistant', 'Turno arquivado da Acme.', 'acme', ?, ?)`,
    ).bind(crypto.randomUUID(), ana.id, ana.id, new Date().toISOString(), new Date().toISOString()).run();
    const memoria = await carregarMemoriaDoCliente(env, { ownerId: ana.id }, { id: ana.id }, "acme");
    expect(memoria.some((m) => m.texto.includes("arquivado"))).toBe(false);
  });

  it("não cruza espaços: memória gravada em outro workspace_owner não entra", async () => {
    // Conversa do Bruno, no espaço DELE, sobre uma conta de mesmo id "acme".
    await semearMensagem(bruno.id, bruno.id, "assistant", "Acme vista do espaço do Bruno.", "acme");
    // A Ana, no espaço dela, não enxerga nada disso.
    const memoria = await carregarMemoriaDoCliente(env, { ownerId: ana.id }, { id: ana.id }, "acme");
    expect(memoria.some((m) => m.texto.includes("Bruno"))).toBe(false);
  });

  it("respeita o teto de turnos mais recentes (LIMIT)", async () => {
    for (let i = 0; i < 20; i += 1) {
      await semearMensagem(ana.id, ana.id, i % 2 === 0 ? "user" : "assistant", `Turno ${i} da conta cheia`, "conta-cheia");
    }
    const memoria = await carregarMemoriaDoCliente(env, { ownerId: ana.id }, { id: ana.id }, "conta-cheia");
    expect(memoria.length).toBeLessThanOrEqual(16);
    expect(memoria.length).toBeGreaterThan(0);
  });

  it("turno montado com dado RESTRITO no contexto só volta para quem tem finance:manage", async () => {
    // Resposta gravada quando o restrito estava no contexto (restricted_context=1).
    await env.DB.prepare(
      `INSERT INTO todogreen_ai_messages
         (id, tenant_id, workspace_owner_id, user_id, assistente, role, content, client_id, created_at, archived_at, restricted_context)
       VALUES (?, 'todogreen', ?, ?, 'plantu', 'assistant', 'A conta bancária da To Do Green é X.', 'conta-restrita', ?, NULL, 1)`,
    ).bind(crypto.randomUUID(), ana.id, ana.id, new Date().toISOString()).run();

    // Sem finance:manage (podeVerRestrito=false): a lembrança some.
    const semAcesso = await carregarMemoriaDoCliente(env, { ownerId: ana.id }, { id: ana.id }, "conta-restrita", false);
    expect(semAcesso).toEqual([]);

    // Com finance:manage: volta normalmente.
    const comAcesso = await carregarMemoriaDoCliente(env, { ownerId: ana.id }, { id: ana.id }, "conta-restrita", true);
    expect(comAcesso.some((m) => m.texto.includes("conta bancária"))).toBe(true);
  });
});

// Correção assistida (fase 2b): a pessoa ensina qual era a resposta certa; fica
// guardado (privado dela) e volta como aprendizado. Ninguém corrige a resposta
// de outra pessoa.
describe("correção assistida do Plantû", () => {
  it("grava a correção da própria resposta e marca 👎; a de outra pessoa dá 404", async () => {
    await env.DB.prepare(
      `INSERT INTO todogreen_ai_messages
         (id, tenant_id, workspace_owner_id, user_id, assistente, role, content, client_id, created_at, archived_at)
       VALUES ('resp-corrigir', 'todogreen', ?, ?, 'plantu', 'assistant', 'Resposta errada.', NULL, ?, NULL)`,
    ).bind(ana.id, ana.id, new Date().toISOString()).run();

    // Bruno não corrige a resposta da Ana → 404.
    const brunoTenta = await pedir(bruno.token, { corrigir: { mensagemId: "resp-corrigir", texto: "O certo era Y." } });
    expect(brunoTenta.status).toBe(404);

    // Ana corrige a própria → grava e vira 👎.
    const anaCorrige = await pedir(ana.token, { corrigir: { mensagemId: "resp-corrigir", texto: "O certo era 42 rotas." } });
    expect(anaCorrige.status).toBe(200);
    const linha = await env.DB.prepare("SELECT correction, rating FROM todogreen_ai_messages WHERE id = 'resp-corrigir'").first();
    expect(linha.correction).toBe("O certo era 42 rotas.");
    expect(linha.rating).toBe(-1);
  });

  it("as correções voltam como aprendizado só para quem as ensinou", async () => {
    const daAna = await carregarCorrecoesDoPlantu(env, { ownerId: ana.id }, { id: ana.id }, false);
    expect(daAna.some((c) => c.correcao === "O certo era 42 rotas.")).toBe(true);
    // Bruno, no mesmo espaço, não vê a correção da Ana.
    const doBruno = await carregarCorrecoesDoPlantu(env, { ownerId: ana.id }, { id: bruno.id }, false);
    expect(doBruno.some((c) => c.correcao === "O certo era 42 rotas.")).toBe(false);
  });

  it("correção sobre resposta com dado restrito só volta para quem tem finance:manage", async () => {
    await env.DB.prepare(
      `INSERT INTO todogreen_ai_messages
         (id, tenant_id, workspace_owner_id, user_id, assistente, role, content, client_id, created_at, archived_at, restricted_context, correction)
       VALUES ('resp-corr-restr', 'todogreen', ?, ?, 'plantu', 'assistant', 'Resposta com número sensível.', NULL, ?, NULL, 1, 'O certo era outro valor sigiloso.')`,
    ).bind(ana.id, ana.id, new Date().toISOString()).run();

    const semAcesso = await carregarCorrecoesDoPlantu(env, { ownerId: ana.id }, { id: ana.id }, false);
    expect(semAcesso.some((c) => c.correcao.includes("sigiloso"))).toBe(false);
    const comAcesso = await carregarCorrecoesDoPlantu(env, { ownerId: ana.id }, { id: ana.id }, true);
    expect(comAcesso.some((c) => c.correcao.includes("sigiloso"))).toBe(true);
  });

  it("traz a pergunta que gerou a resposta corrigida (o modelo aprende QUANDO aplicar)", async () => {
    // Turno completo: pergunta (rowid menor) e a resposta corrigida logo depois.
    await env.DB.prepare(
      `INSERT INTO todogreen_ai_messages
         (id, tenant_id, workspace_owner_id, user_id, assistente, role, content, client_id, created_at, archived_at)
       VALUES ('q-prazo', 'todogreen', ?, ?, 'plantu', 'user', 'Qual o prazo da rota X?', NULL, ?, NULL)`,
    ).bind(ana.id, ana.id, new Date().toISOString()).run();
    await env.DB.prepare(
      `INSERT INTO todogreen_ai_messages
         (id, tenant_id, workspace_owner_id, user_id, assistente, role, content, client_id, created_at, archived_at, correction)
       VALUES ('a-prazo', 'todogreen', ?, ?, 'plantu', 'assistant', 'Prazo de 5 dias.', NULL, ?, NULL, 'O prazo certo é 3 dias.')`,
    ).bind(ana.id, ana.id, new Date().toISOString()).run();

    const correcoes = await carregarCorrecoesDoPlantu(env, { ownerId: ana.id }, { id: ana.id }, false);
    const alvo = correcoes.find((c) => c.correcao === "O prazo certo é 3 dias.");
    expect(alvo).toBeTruthy();
    expect(alvo.pergunta).toBe("Qual o prazo da rota X?");
  });
});
