import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../worker-entry.js";

// A aba de documentos do portal listava título, tipo, data e impressão digital
// e não tinha botão nem endpoint. A permissão chamava-se
// `portal:document:download` e o que era entregue era metadado — e a tabela
// estava vazia por construção, porque nada no produto escrevia nela.

let n = 0;
const nextIp = () => `198.21.0.${(++n % 240) + 1}`;

async function sha256(valor) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    typeof valor === "string" ? new TextEncoder().encode(valor) : valor,
  );
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

async function vincular(usuario, papel, permissoes, dono) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO tenant_users
       (id, tenant_id, workspace_owner_id, user_id, role, status, permissions_json, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, user_id) DO UPDATE SET role = excluded.role,
       permissions_json = excluded.permissions_json, status = 'active'`,
  )
    .bind(crypto.randomUUID(), dono, usuario.id, papel, JSON.stringify(permissoes), agora, agora)
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

const CONTEUDO = "conteudo do documento de teste";
const ENDERECO = "https://arquivos.exemplo.com/nf-123.pdf";

// O worker busca o arquivo uma vez no cadastro e outra no download. Trocamos o
// `fetch` externo por um que devolve bytes conhecidos: assim dá para conferir
// que a impressão digital sai do CONTEÚDO, e não do título nem da URL.
const comArquivo = (corpo = CONTEUDO, status = 200) => {
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (entrada) => {
    const alvo = String(entrada?.url || entrada);
    if (alvo.startsWith("https://arquivos.exemplo.com/"))
      return new Response(corpo, { status, headers: { "content-type": "application/pdf" } });
    return original(entrada);
  });
  return () => {
    globalThis.fetch = original;
  };
};

let gestora;
let cliente;
let clienteId;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();

  gestora = await criarUsuario("ev-gestora", "gestora@doc.com.br");
  await vincular(gestora, "admin", ["*"], gestora.id);

  clienteId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id, tenant_id, workspace_owner_id, name, legal_name, document, segment, status,
        portal_enabled, created_by, updated_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'Distribuidora Alfa', 'Alfa LTDA', '', 'varejo', 'ativo', 1, ?, ?, ?, ?)`,
  ).bind(clienteId, gestora.id, gestora.id, gestora.id, agora, agora).run();

  cliente = await criarUsuario("ev-cliente", "contato@alfa.com.br");
  await env.DB.prepare(
    `INSERT INTO todogreen_client_users
       (id, tenant_id, client_id, email, role, status, permissions_json, invited_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'cliente_admin', 'active', '["*"]', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), clienteId, cliente.email, gestora.id, agora, agora).run();
});

describe("cadastrar documento", () => {
  it("a impressão digital sai dos bytes do arquivo, não do título nem da URL", async () => {
    const restaurar = comArquivo();
    try {
      const r = await pedir("/api/todogreen/evidencias", {
        metodo: "POST",
        token: gestora.token,
        corpo: { clientId: clienteId, titulo: "NF 12345", tipo: "nota_fiscal", arquivoUrl: ENDERECO },
      });
      expect(r.status).toBe(201);
      const { documento } = await r.json();
      expect(documento.impressaoDigital).toBe(await sha256(CONTEUDO));
      expect(documento.arquivoBytes).toBe(new TextEncoder().encode(CONTEUDO).byteLength);
    } finally {
      restaurar();
    }
  });

  it("arquivo inacessível não vira documento", async () => {
    const restaurar = comArquivo("", 404);
    try {
      const r = await pedir("/api/todogreen/evidencias", {
        metodo: "POST",
        token: gestora.token,
        corpo: { clientId: clienteId, titulo: "NF sumida", tipo: "nota_fiscal", arquivoUrl: ENDERECO },
      });
      // Uma prova falsa é pior do que nenhuma.
      expect(r.status).toBe(422);
    } finally {
      restaurar();
    }
  });

  it("endereço de rede interna é recusado", async () => {
    const r = await pedir("/api/todogreen/evidencias", {
      metodo: "POST",
      token: gestora.token,
      corpo: {
        clientId: clienteId,
        titulo: "metadados",
        tipo: "outro",
        arquivoUrl: "http://169.254.169.254/latest/meta-data",
      },
    });
    // Sem isto, o worker viraria porta de entrada para a rede de onde ele roda.
    expect(r.status).toBe(400);
  });

  it("cliente de outra carteira não recebe documento", async () => {
    const outra = await criarUsuario("ev-outra", "outra@empresa.com.br");
    await vincular(outra, "admin", ["*"], outra.id);
    const restaurar = comArquivo();
    try {
      const r = await pedir("/api/todogreen/evidencias", {
        metodo: "POST",
        token: outra.token,
        corpo: { clientId: clienteId, titulo: "NF alheia", tipo: "nota_fiscal", arquivoUrl: ENDERECO },
      });
      expect(r.status).toBe(404);
    } finally {
      restaurar();
    }
  });
});

async function cenario({ dono, clienteId: clienteDoCenario, espaco } = {}) {
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO pricing_scenarios
       (id, tenant_id, workspace_owner_id, product_id, client_id, opportunity_id, created_by,
        rule_version, inputs_json, result_json, approvals_json, premises_json, status, created_at)
     VALUES (?, 'todogreen', ?, 'middle-mile', ?, '', ?, 'v1', '{}', '{}', '{}', '{}', 'draft', ?)`,
  )
    .bind(id, espaco || dono.id, clienteDoCenario, dono.id, agora)
    .run();
  return id;
}

describe("vincular documento a uma simulação", () => {
  it("aceita calculoId de simulação real do mesmo cliente", async () => {
    const cenarioId = await cenario({ dono: gestora, clienteId });
    const restaurar = comArquivo();
    try {
      const r = await pedir("/api/todogreen/evidencias", {
        metodo: "POST",
        token: gestora.token,
        corpo: {
          clientId: clienteId,
          titulo: "NF vinculada",
          tipo: "nota_fiscal",
          arquivoUrl: ENDERECO,
          calculoId: cenarioId,
        },
      });
      expect(r.status).toBe(201);
      const { documento } = await r.json();
      expect(documento.calculoId).toBe(cenarioId);
    } finally {
      restaurar();
    }
  });

  it("recusa calculoId que não existe", async () => {
    const restaurar = comArquivo();
    try {
      const r = await pedir("/api/todogreen/evidencias", {
        metodo: "POST",
        token: gestora.token,
        corpo: {
          clientId: clienteId,
          titulo: "NF com vínculo inventado",
          tipo: "nota_fiscal",
          arquivoUrl: ENDERECO,
          calculoId: "simulacao-que-nao-existe",
        },
      });
      expect(r.status).toBe(404);
    } finally {
      restaurar();
    }
  });

  it("recusa calculoId de simulação de outro cliente", async () => {
    const outroClienteId = crypto.randomUUID();
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_clients
         (id, tenant_id, workspace_owner_id, name, legal_name, document, segment, status,
          portal_enabled, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'Distribuidora Beta', 'Beta LTDA', '', 'varejo', 'ativo', 1, ?, ?, ?, ?)`,
    ).bind(outroClienteId, gestora.id, gestora.id, gestora.id, agora, agora).run();
    const cenarioDeOutroCliente = await cenario({ dono: gestora, clienteId: outroClienteId });

    const restaurar = comArquivo();
    try {
      const r = await pedir("/api/todogreen/evidencias", {
        metodo: "POST",
        token: gestora.token,
        corpo: {
          clientId: clienteId,
          titulo: "NF com vínculo cruzado",
          tipo: "nota_fiscal",
          arquivoUrl: ENDERECO,
          calculoId: cenarioDeOutroCliente,
        },
      });
      expect(r.status).toBe(404);
    } finally {
      restaurar();
    }
  });
});

describe("baixar pelo portal", () => {
  let documentoId;

  const cadastrar = async () => {
    const restaurar = comArquivo();
    try {
      const r = await pedir("/api/todogreen/evidencias", {
        metodo: "POST",
        token: gestora.token,
        corpo: { clientId: clienteId, titulo: "Comprovante", tipo: "comprovante", arquivoUrl: ENDERECO },
      });
      return (await r.json()).documento.id;
    } finally {
      restaurar();
    }
  };

  it("o cliente pede o link e recebe um endereço temporário", async () => {
    documentoId = await cadastrar();
    const r = await pedir(`/api/todogreen/portal/evidencias/${documentoId}/link`, {
      metodo: "POST",
      token: cliente.token,
      corpo: {},
    });
    expect(r.status).toBe(201);
    const { url, expiraEm } = await r.json();
    expect(url).toMatch(/^\/api\/todogreen\/arquivo\?t=/);
    expect(new Date(expiraEm).getTime()).toBeGreaterThan(Date.now());
    // O endereço de origem nunca chega ao navegador do cliente.
    expect(url).not.toContain("arquivos.exemplo.com");
  });

  it("o link entrega o arquivo, com a impressão digital no cabeçalho", async () => {
    documentoId = await cadastrar();
    const { url } = await (
      await pedir(`/api/todogreen/portal/evidencias/${documentoId}/link`, {
        metodo: "POST",
        token: cliente.token,
        corpo: {},
      })
    ).json();

    const restaurar = comArquivo();
    try {
      const arquivo = await pedir(url);
      expect(arquivo.status).toBe(200);
      expect(arquivo.headers.get("content-disposition")).toMatch(/attachment/);
      expect(arquivo.headers.get("x-documento-sha256")).toBe(await sha256(CONTEUDO));
      expect(await arquivo.text()).toBe(CONTEUDO);
    } finally {
      restaurar();
    }
  });

  it("token inventado responde igual a token vencido", async () => {
    const r = await pedir("/api/todogreen/arquivo?t=nao-existe-esse-token");
    // Distinguir os dois contaria a quem tenta adivinhar que ele acertou o
    // formato.
    expect(r.status).toBe(410);
  });

  it("link vencido não abre", async () => {
    documentoId = await cadastrar();
    const { url } = await (
      await pedir(`/api/todogreen/portal/evidencias/${documentoId}/link`, {
        metodo: "POST",
        token: cliente.token,
        corpo: {},
      })
    ).json();
    const token = new URL(`https://app.test${url}`).searchParams.get("t");
    await env.DB.prepare(
      "UPDATE todogreen_document_grants SET expires_at = '2020-01-01T00:00:00.000Z' WHERE token_hash = ?",
    )
      .bind(await sha256(token))
      .run();
    expect((await pedir(url)).status).toBe(410);
  });

  it("documento de outro cliente responde 404 pelo portal", async () => {
    const outroCliente = crypto.randomUUID();
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_clients
         (id, tenant_id, workspace_owner_id, name, legal_name, document, segment, status,
          portal_enabled, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'todogreen', ?, 'Beta', 'Beta LTDA', '', 'varejo', 'ativo', 1, ?, ?, ?, ?)`,
    ).bind(outroCliente, gestora.id, gestora.id, gestora.id, agora, agora).run();

    const restaurar = comArquivo();
    let idAlheio;
    try {
      idAlheio = (
        await (
          await pedir("/api/todogreen/evidencias", {
            metodo: "POST",
            token: gestora.token,
            corpo: { clientId: outroCliente, titulo: "NF Beta", tipo: "nota_fiscal", arquivoUrl: ENDERECO },
          })
        ).json()
      ).documento.id;
    } finally {
      restaurar();
    }

    const r = await pedir(`/api/todogreen/portal/evidencias/${idAlheio}/link`, {
      metodo: "POST",
      token: cliente.token,
      corpo: {},
    });
    expect(r.status).toBe(404);
  });

  it("cada abertura fica registrada", async () => {
    documentoId = await cadastrar();
    const { url } = await (
      await pedir(`/api/todogreen/portal/evidencias/${documentoId}/link`, {
        metodo: "POST",
        token: cliente.token,
        corpo: {},
      })
    ).json();
    const token = new URL(`https://app.test${url}`).searchParams.get("t");

    const restaurar = comArquivo();
    try {
      await pedir(url);
      await pedir(url);
    } finally {
      restaurar();
    }

    const linha = await env.DB.prepare(
      "SELECT downloads, last_used_at FROM todogreen_document_grants WHERE token_hash = ?",
    )
      .bind(await sha256(token))
      .first();
    expect(linha.downloads).toBe(2);
    expect(linha.last_used_at).toBeTruthy();
  });

  it("o banco guarda o hash do token, nunca o token", async () => {
    documentoId = await cadastrar();
    const { url } = await (
      await pedir(`/api/todogreen/portal/evidencias/${documentoId}/link`, {
        metodo: "POST",
        token: cliente.token,
        corpo: {},
      })
    ).json();
    const token = new URL(`https://app.test${url}`).searchParams.get("t");
    const achou = await env.DB.prepare(
      "SELECT id FROM todogreen_document_grants WHERE token_hash = ?",
    )
      .bind(token)
      .first();
    // O banco não precisa saber abrir a porta — só reconhecer a chave certa.
    expect(achou).toBeFalsy();
  });
});

describe("a lista interna", () => {
  it("sem sessão, nada", async () => {
    expect((await pedir("/api/todogreen/evidencias")).status).toBe(401);
  });

  it("filtra por cliente", async () => {
    const r = await pedir(`/api/todogreen/evidencias?cliente=${clienteId}`, { token: gestora.token });
    expect(r.status).toBe(200);
    const { documentos } = await r.json();
    expect(documentos.length).toBeGreaterThan(0);
    expect(documentos.every((d) => d.clientId === clienteId)).toBe(true);
  });
});
