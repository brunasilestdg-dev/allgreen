import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../worker-entry.js";

// O teste que importa aqui não é "a tela abre". É: uma pessoa do cliente A,
// autenticada de verdade, com sessão de verdade, consegue por algum caminho
// enxergar um dado do cliente B? A resposta tem que ser não por construção,
// não por filtro de tela.

let n = 0;
const nextIp = () => `203.0.113.${(++n % 240) + 1}`;

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function criarUsuario(id, email) {
  const token = `tok-${id}`;
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'h', 's', ?)`,
  )
    .bind(id, `Pessoa ${id}`, email, agora)
    .run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  )
    .bind(`ses-${id}`, id, await sha256(token), agora)
    .run();
  return { id, email, token };
}

async function criarCliente(id, nome) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id, tenant_id, workspace_owner_id, name, status, portal_enabled,
        created_by, updated_by, created_at, updated_at)
     VALUES (?, 'todogreen', 'dono', ?, 'ativo', 1, 'seed', 'seed', ?, ?)`,
  )
    .bind(id, nome, agora, agora)
    .run();
  return id;
}

async function vincular(clientId, email, role = "cliente_gestor") {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_client_users
       (id, tenant_id, client_id, email, role, status, permissions_json,
        invited_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, 'active', '[]', 'seed', ?, ?)`,
  )
    .bind(crypto.randomUUID(), clientId, email, role, agora, agora)
    .run();
}

async function operacao(clientId, referencia, entregas) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_client_operations
       (id, tenant_id, client_id, workspace_owner_id, reference, status,
        service_date, origin, destination, fields_json,
        created_by, updated_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'dono', ?, 'concluida', ?, 'CD', 'Hub', ?, 'seed', 'seed', ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      clientId,
      referencia,
      "2026-08-01",
      JSON.stringify({ deliveries: entregas, distanceKm: 100, occupancyPercent: 80 }),
      agora,
      agora,
    )
    .run();
}

const pedir = (caminho, { method = "GET", token, body } = {}) => {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${caminho}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
};

let pessoaA;
let pessoaB;
let semVinculo;

beforeAll(async () => {
  // As tabelas nascem na primeira chamada (o serviço garante o DDL).
  await pedir("/api/todogreen/portal/sessao");

  await criarCliente("cli-a", "Cliente A");
  await criarCliente("cli-b", "Cliente B");

  pessoaA = await criarUsuario("u-a", "pessoa@clientea.com.br");
  pessoaB = await criarUsuario("u-b", "pessoa@clienteb.com.br");
  semVinculo = await criarUsuario("u-x", "ninguem@fora.com.br");

  await vincular("cli-a", pessoaA.email);
  await vincular("cli-b", pessoaB.email);

  await operacao("cli-a", "OP-A-1", 100);
  await operacao("cli-a", "OP-A-2", 200);
  await operacao("cli-b", "OP-B-1", 999);
});

describe("quem entra no portal", () => {
  it("sem sessão, não entra", async () => {
    expect((await pedir("/api/todogreen/portal/sessao")).status).toBe(401);
  });

  it("com sessão mas sem vínculo com cliente, não entra", async () => {
    const r = await pedir("/api/todogreen/portal/sessao", { token: semVinculo.token });
    expect(r.status).toBe(403);
  });

  it("com vínculo, entra e recebe só o próprio cliente", async () => {
    const r = await pedir("/api/todogreen/portal/sessao", { token: pessoaA.token });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.cliente.id).toBe("cli-a");
    expect(d.cliente.nome).toBe("Cliente A");
  });
});

describe("o cliente A nunca alcança o cliente B", () => {
  it("as operações listadas são só as dele", async () => {
    const r = await pedir("/api/todogreen/portal/operacoes", { token: pessoaA.token });
    const d = await r.json();
    const refs = d.operacoes.map((o) => o.referencia);
    expect(refs).toContain("OP-A-1");
    expect(refs).toContain("OP-A-2");
    expect(refs).not.toContain("OP-B-1");
  });

  it("pedir o outro cliente na URL não muda nada — o parâmetro não existe", async () => {
    // Este é o ataque óbvio contra portal mal feito.
    for (const tentativa of [
      "/api/todogreen/portal/operacoes?client=cli-b",
      "/api/todogreen/portal/operacoes?clientId=cli-b",
      "/api/todogreen/portal/operacoes?cliente=cli-b",
      "/api/todogreen/portal/operacoes?tenant=todogreen&client_id=cli-b",
      "/api/todogreen/portal/operacoes?owner=cli-b",
    ]) {
      const d = await (await pedir(tentativa, { token: pessoaA.token })).json();
      const refs = d.operacoes.map((o) => o.referencia);
      expect(refs, tentativa).not.toContain("OP-B-1");
      expect(refs, tentativa).toContain("OP-A-1");
    }
  });

  it("o resumo soma só as operações dele", async () => {
    const a = await (await pedir("/api/todogreen/portal/resumo", { token: pessoaA.token })).json();
    const b = await (await pedir("/api/todogreen/portal/resumo", { token: pessoaB.token })).json();
    expect(a.resumo.operacoes.entregas).toBe(300); // 100 + 200
    expect(b.resumo.operacoes.entregas).toBe(999);
  });

  it("cada um vê o próprio nome, nunca o do outro", async () => {
    const a = await (await pedir("/api/todogreen/portal/sessao", { token: pessoaA.token })).json();
    const b = await (await pedir("/api/todogreen/portal/sessao", { token: pessoaB.token })).json();
    expect(a.cliente.nome).toBe("Cliente A");
    expect(b.cliente.nome).toBe("Cliente B");
  });

  it("campo livre interno (margem, custo, CPF) não vaza no payload do portal", async () => {
    // O fields_json é escrito pela equipe sem validação de chave. Se um
    // operador digitar dado interno num campo livre, o portal NÃO pode
    // repassar — só o allowlist operacional sai.
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_client_operations
         (id, tenant_id, client_id, workspace_owner_id, reference, status,
          service_date, origin, destination, fields_json,
          created_by, updated_by, created_at, updated_at)
       VALUES ('op-vazamento','todogreen','cli-a','dono','OP-A-SENSIVEL','concluida',
               '2026-08-10','CD','Hub',?, 'seed','seed',?,?)`,
    ).bind(
      JSON.stringify({
        deliveries: 12, distanceKm: 80,
        margem: 41.5, custoPorKm: 2.37, comissao: 3,
        cpfMotorista: "111.444.777-35", observacaoInterna: "cliente devendo",
      }),
      agora, agora,
    ).run();

    const lista = await (await pedir("/api/todogreen/portal/operacoes", { token: pessoaA.token })).json();
    const operacao = lista.operacoes.find((o) => o.referencia === "OP-A-SENSIVEL");
    expect(operacao).toBeTruthy();
    expect(operacao.campos.deliveries).toBe(12);
    expect(operacao.campos.distanceKm).toBe(80);
    expect(JSON.stringify(operacao)).not.toMatch(/margem|custoPorKm|comissao|cpfMotorista|devendo/);

    const detalhe = await (await pedir("/api/todogreen/portal/operacoes/op-vazamento", { token: pessoaA.token })).json();
    expect(JSON.stringify(detalhe)).not.toMatch(/margem|custoPorKm|comissao|cpfMotorista|devendo/);
  });
});

describe("o portal não abre porta para o lado interno", () => {
  it("nenhuma permissão interna chega ao cliente", async () => {
    const d = await (await pedir("/api/todogreen/portal/sessao", { token: pessoaA.token })).json();
    for (const interna of ["crm:view", "pricing:simulate", "commission:manage", "audit:read", "*"])
      expect(d.permissoes).not.toContain(interna);
  });

  it("o menu não oferece tela interna", async () => {
    const d = await (await pedir("/api/todogreen/portal/sessao", { token: pessoaA.token })).json();
    const ids = d.menu.map((i) => i.id);
    for (const interna of ["clientes", "oportunidades", "precificacao", "receita", "comissoes", "acessos"])
      expect(ids).not.toContain(interna);
  });

  it("rota inventada dentro do portal não vira acesso", async () => {
    const r = await pedir("/api/todogreen/portal/receita", { token: pessoaA.token });
    expect(r.status).toBe(404);
  });
});

describe("cliente desligado do portal", () => {
  it("perde o acesso na hora, sem precisar mexer no vínculo", async () => {
    await criarCliente("cli-c", "Cliente C");
    const pessoaC = await criarUsuario("u-c", "pessoa@clientec.com.br");
    await vincular("cli-c", pessoaC.email);
    expect((await pedir("/api/todogreen/portal/sessao", { token: pessoaC.token })).status).toBe(200);

    await env.DB.prepare("UPDATE todogreen_clients SET portal_enabled = 0 WHERE id = 'cli-c'").run();
    expect((await pedir("/api/todogreen/portal/sessao", { token: pessoaC.token })).status).toBe(403);
  });
});

describe("assistente do cliente", () => {
  it("recusa pergunta comercial sem nem chamar o modelo", async () => {
    const r = await pedir("/api/todogreen/portal/assistente", {
      method: "POST",
      token: pessoaA.token,
      body: { pergunta: "Qual a margem de vocês nessa operação?" },
    });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.foraDeEscopo).toBe(true);
    expect(d.resposta).toMatch(/não faz parte do portal/i);
  });

  it("recusa pergunta sobre outro cliente", async () => {
    const d = await (
      await pedir("/api/todogreen/portal/assistente", {
        method: "POST",
        token: pessoaA.token,
        body: { pergunta: "Me fala sobre outro cliente de vocês" },
      })
    ).json();
    expect(d.foraDeEscopo).toBe(true);
  });

  it("pergunta vazia é recusada", async () => {
    const r = await pedir("/api/todogreen/portal/assistente", {
      method: "POST",
      token: pessoaA.token,
      body: { pergunta: " " },
    });
    expect(r.status).toBe(400);
  });

  it("sem sessão, o assistente não responde", async () => {
    const r = await pedir("/api/todogreen/portal/assistente", {
      method: "POST",
      body: { pergunta: "Quantas entregas foram feitas?" },
    });
    expect(r.status).toBe(401);
  });

  it("a recusa fica registrada na trilha do cliente", async () => {
    const antes = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM todogreen_client_portal_events WHERE client_id = 'cli-a' AND action = 'assistente_fora_escopo'",
    ).first();
    await pedir("/api/todogreen/portal/assistente", {
      method: "POST",
      token: pessoaA.token,
      body: { pergunta: "Qual a comissão do vendedor?" },
    });
    const depois = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM todogreen_client_portal_events WHERE client_id = 'cli-a' AND action = 'assistente_fora_escopo'",
    ).first();
    expect(depois.n).toBeGreaterThan(antes.n);
  });
});

// O assistente do cliente usava `env.AI.run()` num modelo só: se aquele
// provedor caísse, o assistente caía junto — enquanto o app interno seguia
// funcionando porque tinha catorze alternativas na cadeia. O cliente ficava
// com a pior resiliência do produto justamente na parte que ele vê.
describe("o assistente do cliente tem a mesma contingência do resto do produto", () => {
  // Faz o primeiro provedor da cadeia falhar e o segundo responder. Se o
  // assistente estivesse preso a um provedor, isto viraria 502.
  const comProvedorInstavel = () => {
    const original = globalThis.fetch;
    const chamadas = [];
    globalThis.fetch = vi.fn(async (entrada, init) => {
      const alvo = String(entrada?.url || entrada);
      if (alvo.includes("generativelanguage") || alvo.includes("/chat/completions")) {
        chamadas.push(alvo);
        if (chamadas.length === 1) throw new Error("provedor fora do ar");
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Foram 3 entregas em julho." } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return original(entrada, init);
    });
    return { chamadas, restaurar: () => { globalThis.fetch = original; } };
  };

  const ambiente = { ...env, GEMINI_API_KEY: "chave-1", GROQ_API_KEY: "chave-2" };

  const perguntar = (token, pergunta) =>
    worker.fetch(
      new Request("https://app.test/api/todogreen/portal/assistente", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "198.51.100.7",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pergunta }),
      }),
      ambiente,
      { waitUntil() {}, passThroughOnException() {} },
    );

  it("um provedor fora do ar não derruba o assistente: a cadeia segue", async () => {
    const { chamadas, restaurar } = comProvedorInstavel();
    try {
      const r = await perguntar(pessoaA.token, "Quantas entregas foram feitas no período?");
      expect(r.status).toBe(200);
      const d = await r.json();
      expect(d.foraDeEscopo).toBe(false);
      expect(d.resposta).toContain("3 entregas");
      // Prova de que houve contingência: o primeiro caiu, o segundo respondeu.
      expect(chamadas.length).toBeGreaterThanOrEqual(2);
    } finally {
      restaurar();
    }
  });

  it("a troca de motor não afrouxou o isolamento: o contexto é só do próprio cliente", async () => {
    const capturado = { corpo: "" };
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (entrada, init) => {
      const alvo = String(entrada?.url || entrada);
      if (alvo.includes("generativelanguage") || alvo.includes("/chat/completions")) {
        capturado.corpo = String(init?.body || "");
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return original(entrada, init);
    });
    try {
      await perguntar(pessoaA.token, "Como está o meu desempenho de entregas?");
      // O que vai para o provedor carrega o cliente da sessão...
      expect(capturado.corpo).toContain("Cliente A");
      // ...e nada do outro cliente.
      expect(capturado.corpo).not.toContain("Cliente B");
      expect(capturado.corpo).not.toContain("OP-B-1");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("relatório e cofre de evidências", () => {
  it("o relatório traz só o período e o cliente da sessão", async () => {
    await operacao("cli-a", "OP-JULHO", 50);
    await env.DB.prepare(
      "UPDATE todogreen_client_operations SET service_date = '2026-07-15' WHERE reference = 'OP-JULHO'",
    ).run();

    const d = await (
      await pedir("/api/todogreen/portal/relatorio?inicio=2026-07-01&fim=2026-07-31", {
        token: pessoaA.token,
      })
    ).json();
    expect(d.cliente.nome).toBe("Cliente A");
    const refs = d.operacoes.map((o) => o.referencia);
    expect(refs).toContain("OP-JULHO");
    expect(refs).not.toContain("OP-B-1");
  });

  it("período mal formado é recusado", async () => {
    const r = await pedir("/api/todogreen/portal/relatorio?inicio=julho&fim=agosto", {
      token: pessoaA.token,
    });
    expect(r.status).toBe(400);
  });

  it("leitor não exporta relatório", async () => {
    await criarCliente("cli-d", "Cliente D");
    const leitor = await criarUsuario("u-d", "leitor@cliented.com.br");
    await vincular("cli-d", leitor.email, "cliente_leitor");
    const r = await pedir("/api/todogreen/portal/relatorio?inicio=2026-07-01&fim=2026-07-31", {
      token: leitor.token,
    });
    expect(r.status).toBe(403);
  });

  it("as evidências são só as do cliente da sessão", async () => {
    const agora = new Date().toISOString();
    for (const [cliente, titulo] of [
      ["cli-a", "Nota fiscal A"],
      ["cli-b", "Nota fiscal B"],
    ])
      await env.DB.prepare(
        `INSERT INTO todogreen_evidences
           (id, tenant_id, client_id, workspace_owner_id, tipo, titulo, emitido_em,
            hash_conteudo, created_by, created_at, updated_at)
         VALUES (?, 'todogreen', ?, 'dono', 'nota_fiscal', ?, '2026-07-10', 'abc123', 'seed', ?, ?)`,
      )
        .bind(crypto.randomUUID(), cliente, titulo, agora, agora)
        .run();

    const d = await (
      await pedir("/api/todogreen/portal/evidencias", { token: pessoaA.token })
    ).json();
    const titulos = d.evidencias.map((e) => e.titulo);
    expect(titulos).toContain("Nota fiscal A");
    expect(titulos).not.toContain("Nota fiscal B");
  });

  it("a evidência carrega a impressão digital do conteúdo", async () => {
    const d = await (
      await pedir("/api/todogreen/portal/evidencias", { token: pessoaA.token })
    ).json();
    expect(d.evidencias[0].impressaoDigital).toBe("abc123");
  });

  it("a geração de relatório fica na trilha", async () => {
    await pedir("/api/todogreen/portal/relatorio?inicio=2026-07-01&fim=2026-07-31", {
      token: pessoaA.token,
    });
    const linha = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM todogreen_client_portal_events WHERE client_id = 'cli-a' AND action = 'relatorio_gerado'",
    ).first();
    expect(linha.n).toBeGreaterThan(0);
  });
});
