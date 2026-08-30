import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Os cadastros de base do ERP: material, depósito, parte, plano de contas e
// centro de custo.
//
// O que estes testes existem para impedir de voltar:
//   • cadastro de um espaço aparecendo no outro;
//   • fornecedor invisível para operações e financeiro porque o recorte de
//     carteira foi aplicado a uma tabela que não é de carteira (o defeito que
//     `escopoDeCarteira: false` resolve — e que falharia em SILÊNCIO, com 404,
//     porque `noAlcanceDaCarteira` engole o erro de SQL);
//   • duas grafias do mesmo CNPJ virando dois fornecedores;
//   • unidade de medida inventada somando quilo com caixa;
//   • quem só consulta conseguindo alterar cadastro.

let n = 0;
const nextIp = () => `198.20.0.${(++n % 240) + 1}`;

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
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET role = excluded.role,
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
let operacao;
let auditor;

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();

  gestora = await criarUsuario("erp-gestora", "gestora@erp.test");
  colega = await criarUsuario("erp-colega", "colega@erp.test");
  // `operacoes` NÃO tem `clients:manage`, então não vê a carteira inteira — é
  // exatamente o papel que exporia o defeito do recorte nas tabelas sem
  // `client_id`.
  operacao = await criarUsuario("erp-operacao", "operacao@erp.test");
  auditor = await criarUsuario("erp-auditor", "auditor@erp.test");

  await autorizar(gestora);
  await autorizar(colega);
  await autorizar(operacao, "operacoes", [
    "read", "operation:manage", "operations:manage", "stock:manage",
    "purchase:manage", "production:manage", "tms:manage",
  ]);
  await autorizar(auditor, "auditor", ["read"]);
});

describe("material", () => {
  it("cria, normaliza o SKU e nasce com revisão 1", async () => {
    const r = await pedir("/api/todogreen/records/items", {
      metodo: "POST",
      token: gestora.token,
      corpo: { codigo: " pn-295/80 ", nome: "Pneu 295/80 R22.5", unidade: "un", custoReferencia: 1850 },
    });
    expect(r.status).toBe(201);
    const { registro } = await r.json();
    // "/" cai fora: o mesmo item digitado com e sem barra tem de ser um só.
    expect(registro.codigo).toBe("PN-29580");
    expect(registro.unidade).toBe("UN");
    expect(registro.revision).toBe(1);
  });

  it("recusa unidade que não existe em vez de assumir UN", async () => {
    const r = await pedir("/api/todogreen/records/items", {
      metodo: "POST",
      token: gestora.token,
      corpo: { nome: "Óleo", unidade: "dúzia" },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/unidade/i);
  });

  it("recusa NCM com tamanho errado", async () => {
    const r = await pedir("/api/todogreen/records/items", {
      metodo: "POST",
      token: gestora.token,
      corpo: { nome: "Filtro", unidade: "UN", ncm: "123" },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/NCM/);
  });

  it("exige nome", async () => {
    const r = await pedir("/api/todogreen/records/items", {
      metodo: "POST",
      token: gestora.token,
      corpo: { unidade: "UN" },
    });
    expect(r.status).toBe(400);
  });

  it("um espaço não vê o material do outro", async () => {
    await pedir("/api/todogreen/records/items", {
      metodo: "POST",
      token: colega.token,
      corpo: { nome: "Material do colega", unidade: "UN" },
    });
    const r = await pedir("/api/todogreen/records/items", { token: gestora.token });
    const nomes = (await r.json()).registros.map((item) => item.nome);
    expect(nomes).not.toContain("Material do colega");
  });

  it("quem só consulta não altera cadastro", async () => {
    const r = await pedir("/api/todogreen/records/items", {
      metodo: "POST",
      token: auditor.token,
      corpo: { nome: "Não deveria entrar", unidade: "UN" },
    });
    expect(r.status).toBe(403);
  });
});

describe("papel sem carteira inteira alcança o cadastro da empresa", () => {
  // Este é o teste que justifica `escopoDeCarteira: false`. Sem ele, o SQL do
  // recorte referenciaria `t.client_id` numa tabela que não tem essa coluna:
  // a leitura quebraria e a escrita responderia 404 sem dizer por quê.
  it("operações lista materiais mesmo sem cliente atribuído", async () => {
    const r = await pedir("/api/todogreen/records/items", { token: operacao.token });
    expect(r.status).toBe(200);
    expect(Array.isArray((await r.json()).registros)).toBe(true);
  });

  it("operações cria e depois atualiza um depósito", async () => {
    const criado = await pedir("/api/todogreen/records/warehouses", {
      metodo: "POST",
      token: operacao.token,
      corpo: { codigo: "alm-1", nome: "Almoxarifado central" },
    });
    expect(criado.status).toBe(201);
    const { registro } = await criado.json();
    expect(registro.codigo).toBe("ALM-1");

    // O PATCH é o caminho que falharia em silêncio com 404.
    const alterado = await pedir(`/api/todogreen/records/warehouses/${registro.id}`, {
      metodo: "PATCH",
      token: operacao.token,
      corpo: { nome: "Almoxarifado matriz", revision: registro.revision },
    });
    expect(alterado.status).toBe(200);
    expect((await alterado.json()).registro.nome).toBe("Almoxarifado matriz");
  });

  it("operações vê o fornecedor, que não pertence a carteira nenhuma", async () => {
    await pedir("/api/todogreen/records/parties", {
      metodo: "POST",
      token: operacao.token,
      corpo: { razaoSocial: "Fornecedora de Pneus Ltda", papeis: ["fornecedor"], documento: "11.222.333/0001-81" },
    });
    const r = await pedir("/api/todogreen/records/parties", { token: operacao.token });
    const nomes = (await r.json()).registros.map((item) => item.razaoSocial);
    expect(nomes).toContain("Fornecedora de Pneus Ltda");
  });
});

describe("depósito", () => {
  it("do tipo veículo exige o veículo", async () => {
    const r = await pedir("/api/todogreen/records/warehouses", {
      metodo: "POST",
      token: gestora.token,
      corpo: { nome: "Van 1", tipo: "veiculo" },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/veículo/i);
  });

  it("aceita tipo válido e recusa tipo inventado caindo no padrão", async () => {
    const r = await pedir("/api/todogreen/records/warehouses", {
      metodo: "POST",
      token: gestora.token,
      corpo: { nome: "Pátio terceirizado", tipo: "terceiro" },
    });
    expect((await r.json()).registro.tipo).toBe("terceiro");

    const outro = await pedir("/api/todogreen/records/warehouses", {
      metodo: "POST",
      token: gestora.token,
      corpo: { nome: "Sem tipo", tipo: "inventado" },
    });
    expect((await outro.json()).registro.tipo).toBe("proprio");
  });
});

describe("parte (cliente, fornecedor, transportadora)", () => {
  it("guarda o documento só com dígitos, para não duplicar o fornecedor", async () => {
    const r = await pedir("/api/todogreen/records/parties", {
      metodo: "POST",
      token: gestora.token,
      corpo: { razaoSocial: "Transportes Alfa", papeis: ["fornecedor", "transportador"], documento: "11.222.333/0001-81" },
    });
    expect(r.status).toBe(201);
    const { registro } = await r.json();
    expect(registro.documento).toBe("11222333000181");
    expect(registro.papeis).toEqual(["fornecedor", "transportador"]);
  });

  it("recusa CNPJ inválido preenchido, mas aceita documento ausente", async () => {
    const invalido = await pedir("/api/todogreen/records/parties", {
      metodo: "POST",
      token: gestora.token,
      corpo: { razaoSocial: "Erro de digitação", papeis: ["cliente"], documento: "11222333000182" },
    });
    expect(invalido.status).toBe(400);
    expect((await invalido.json()).error).toMatch(/inválido/i);

    // Parte estrangeira e produtor rural sem inscrição existem.
    const semDoc = await pedir("/api/todogreen/records/parties", {
      metodo: "POST",
      token: gestora.token,
      corpo: { razaoSocial: "Parte sem documento", papeis: ["cliente"] },
    });
    expect(semDoc.status).toBe(201);
  });

  it("exige ao menos um papel conhecido", async () => {
    const r = await pedir("/api/todogreen/records/parties", {
      metodo: "POST",
      token: gestora.token,
      corpo: { razaoSocial: "Sem papel", papeis: ["inventado"] },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/papel/i);
  });
});

describe("plano de contas e centro de custo", () => {
  it("cria conta com natureza válida e recusa a inventada", async () => {
    const ok = await pedir("/api/todogreen/records/accounts", {
      metodo: "POST",
      token: gestora.token,
      corpo: { codigo: "3.1", nome: "Combustível", natureza: "despesa" },
    });
    expect(ok.status).toBe(201);
    expect((await ok.json()).registro.natureza).toBe("despesa");

    const ruim = await pedir("/api/todogreen/records/accounts", {
      metodo: "POST",
      token: gestora.token,
      corpo: { nome: "Sem natureza", natureza: "outra" },
    });
    expect(ruim.status).toBe(400);
  });

  it("guarda a marcação de sintética", async () => {
    const r = await pedir("/api/todogreen/records/accounts", {
      metodo: "POST",
      token: gestora.token,
      corpo: { codigo: "3", nome: "Despesas", natureza: "despesa", analitica: false },
    });
    expect((await r.json()).registro.analitica).toBe(false);
  });

  it("cria centro de custo e exige nome", async () => {
    const ok = await pedir("/api/todogreen/records/costCenters", {
      metodo: "POST",
      token: gestora.token,
      corpo: { codigo: "CC-1", nome: "Middle mile" },
    });
    expect(ok.status).toBe(201);

    const ruim = await pedir("/api/todogreen/records/costCenters", {
      metodo: "POST",
      token: gestora.token,
      corpo: { codigo: "CC-2" },
    });
    expect(ruim.status).toBe(400);
  });
});

describe("escrita concorrente", () => {
  it("a segunda gravação com a mesma revisão recebe 409", async () => {
    const criado = await pedir("/api/todogreen/records/items", {
      metodo: "POST",
      token: gestora.token,
      corpo: { nome: "Disputado", unidade: "UN" },
    });
    const { registro } = await criado.json();

    const primeira = await pedir(`/api/todogreen/records/items/${registro.id}`, {
      metodo: "PATCH",
      token: gestora.token,
      corpo: { nome: "Primeira gravação", unidade: "UN", revision: registro.revision },
    });
    expect(primeira.status).toBe(200);
    expect((await primeira.json()).registro.revision).toBe(2);

    const segunda = await pedir(`/api/todogreen/records/items/${registro.id}`, {
      metodo: "PATCH",
      token: gestora.token,
      corpo: { nome: "Segunda gravação", unidade: "UN", revision: registro.revision },
    });
    expect(segunda.status).toBe(409);
  });

  it("exige a revisão que quem edita leu", async () => {
    const criado = await pedir("/api/todogreen/records/items", {
      metodo: "POST",
      token: gestora.token,
      corpo: { nome: "Sem revisão", unidade: "UN" },
    });
    const { registro } = await criado.json();
    const r = await pedir(`/api/todogreen/records/items/${registro.id}`, {
      metodo: "PATCH",
      token: gestora.token,
      corpo: { nome: "Outro nome", unidade: "UN" },
    });
    expect(r.status).toBe(400);
  });
});

describe("arquivar em vez de apagar", () => {
  it("sai da lista e o histórico sobrevive na tabela", async () => {
    const criado = await pedir("/api/todogreen/records/items", {
      metodo: "POST",
      token: gestora.token,
      corpo: { nome: "Descontinuado", unidade: "UN" },
    });
    const { registro } = await criado.json();

    expect((await pedir(`/api/todogreen/records/items/${registro.id}`, {
      metodo: "DELETE",
      token: gestora.token,
    })).status).toBe(200);

    const lista = await pedir("/api/todogreen/records/items", { token: gestora.token });
    expect((await lista.json()).registros.map((item) => item.id)).not.toContain(registro.id);

    const linha = await env.DB
      .prepare("SELECT archived_at FROM todogreen_items WHERE id = ?")
      .bind(registro.id)
      .first();
    expect(linha?.archived_at).toBeTruthy();
  });
});
