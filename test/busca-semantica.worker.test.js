import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import worker from "../worker.js";
import { deBase64, similaridade } from "../src/features/knowledge/semanticDomain.js";

let requestNumber = 0;
const nextIp = () => `198.18.0.${(++requestNumber % 240) + 1}`;

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function createUser(id) {
  const token = `token-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'hash', 'salt', ?)`,
  ).bind(id, `Pessoa ${id}`, `${id}@example.com`, now).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(`session-${id}`, id, await sha256(token), now).run();
  return { id, token };
}

// bge-m3 falso: cada texto vira um vetor de 1.024 posições que depende do
// próprio texto, e conta quantos textos foram calculados.
const iaFalsa = () => {
  const run = vi.fn(async (_modelo, entrada) => ({
    shape: [entrada.text.length, 1024],
    data: entrada.text.map((texto) =>
      Array.from({ length: 1024 }, (_, i) => Math.sin((i + 1) * (texto.length % 13 + 1))),
    ),
  }));
  return { run };
};

const pedir = (user, corpo, ambiente) =>
  worker.fetch(
    new Request("https://app.test/api/busca/vetores", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": nextIp(),
        ...(user ? { authorization: `Bearer ${user.token}` } : {}),
      },
      body: JSON.stringify(corpo),
    }),
    ambiente,
  );

const hash = (n) => String(n).padStart(32, "0");

describe("POST /api/busca/vetores", () => {
  it("exige sessão", async () => {
    const resposta = await pedir(null, { itens: [{ h: hash(1), t: "texto" }] }, { ...env, AI: iaFalsa() });
    expect(resposta.status).toBe(401);
  });

  it("calcula uma vez, guarda por pessoa e devolve a consulta", async () => {
    const pessoa = await createUser("busca-semantica-a");
    const ia = iaFalsa();
    const ambiente = { ...env, AI: ia };
    const itens = [
      { h: hash(11), t: "Contrato: pagamento em 30 dias após a nota fiscal" },
      { h: hash(12), t: "Comprar embalagens para a loja" },
    ];
    const primeira = await pedir(pessoa, { itens, consulta: "prazo de pagamento" }, ambiente);
    expect(primeira.status).toBe(200);
    const dados = await primeira.json();
    expect(Object.keys(dados.vetores).sort()).toEqual([hash(11), hash(12)]);
    expect(deBase64(dados.vetores[hash(11)])).toHaveLength(1024);
    expect(deBase64(dados.consulta)).toHaveLength(1024);
    // Um só pedido ao modelo com os dois textos e a consulta, sem log nem
    // cache de gateway (não há gateway aqui: chamada direta ao binding).
    expect(ia.run).toHaveBeenCalledTimes(1);
    expect(ia.run.mock.calls[0][0]).toBe("@cf/baai/bge-m3");
    expect(ia.run.mock.calls[0][1]).toMatchObject({ truncate_inputs: true });
    expect(ia.run.mock.calls[0][1].text).toHaveLength(3);

    // De novo: vem do D1, sem gastar modelo, e o vetor é o mesmo.
    const segunda = await pedir(pessoa, { itens }, ambiente);
    const guardado = await segunda.json();
    expect(ia.run).toHaveBeenCalledTimes(1);
    expect(similaridade(deBase64(guardado.vetores[hash(11)]), deBase64(dados.vetores[hash(11)]))).toBeCloseTo(1, 6);

    // O texto em si nunca fica guardado, só o hash e o vetor.
    const linhas = await env.DB.prepare("SELECT * FROM busca_vetores WHERE user_id = ?").bind(pessoa.id).all();
    expect(linhas.results).toHaveLength(2);
    expect(JSON.stringify(linhas.results)).not.toContain("pagamento");
  });

  it("outra pessoa não reaproveita o vetor de ninguém", async () => {
    const dona = await createUser("busca-semantica-dona");
    const outra = await createUser("busca-semantica-outra");
    const ia = iaFalsa();
    const ambiente = { ...env, AI: ia };
    const itens = [{ h: hash(21), t: "Planilha de custos do armazém" }];
    await pedir(dona, { itens }, ambiente);
    await pedir(outra, { itens }, ambiente);
    expect(ia.run).toHaveBeenCalledTimes(2);
  });

  it("recusa lote grande, ignora hash inválido e responde 503 sem IA", async () => {
    const pessoa = await createUser("busca-semantica-limites");
    const ambiente = { ...env, AI: iaFalsa() };
    const muitos = Array.from({ length: 65 }, (_, i) => ({ h: hash(1000 + i), t: `texto ${i}` }));
    expect((await pedir(pessoa, { itens: muitos }, ambiente)).status).toBe(413);
    expect((await pedir(pessoa, { itens: [{ h: "../../x", t: "texto" }] }, ambiente)).status).toBe(400);
    const semIa = await pedir(pessoa, { consulta: "algo" }, env);
    expect(semIa.status).toBe(503);
    expect(await semIa.json()).toMatchObject({ indisponivel: true });
  });

  it("modelo fora do ar devolve 503 marcado, sem quebrar a tela", async () => {
    const pessoa = await createUser("busca-semantica-queda");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ambiente = {
      ...env,
      AI: { run: vi.fn(async () => { throw new Error("3040: Capacity temporarily exceeded"); }) },
    };
    const resposta = await pedir(pessoa, { consulta: "pagamento" }, ambiente);
    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toMatchObject({ indisponivel: true });
    vi.restoreAllMocks();
  });

  it("excluir a conta apaga os vetores dela", async () => {
    const pessoa = await createUser("busca-semantica-exclusao");
    await env.DB.prepare(
      `INSERT INTO workspaces (user_id, data, updated_at, revision) VALUES (?, '{}', ?, 0)`,
    ).bind(pessoa.id, new Date().toISOString()).run();
    await pedir(pessoa, { itens: [{ h: hash(31), t: "Relatório de entregas" }] }, { ...env, AI: iaFalsa() });
    const exclusao = await worker.fetch(
      new Request("https://app.test/api/auth/account", {
        method: "DELETE",
        headers: { authorization: `Bearer ${pessoa.token}`, "cf-connecting-ip": nextIp() },
      }),
      env,
    );
    expect(exclusao.status).toBe(200);
    const restantes = await env.DB.prepare("SELECT COUNT(*) AS total FROM busca_vetores WHERE user_id = ?")
      .bind(pessoa.id)
      .first();
    expect(restantes.total).toBe(0);
  });
});
