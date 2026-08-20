import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Fiscal da transportadora: CT-e, MDF-e e NFS-e.
//
// O que estes testes existem para impedir de voltar:
//   • documento avançando de rascunho para validado sem os campos obrigatórios;
//   • transição de status fora da máquina de estados (ex.: rascunho direto para
//     autorizado);
//   • imposto calculado no cliente em vez do servidor;
//   • perfil ou documento de outro espaço aparecendo na consulta;
//   • quem só lê conseguindo emitir;
//   • transmissão à SEFAZ ligada sem certificado no cofre.

let n = 0;
const nextIp = () => `198.23.0.${(++n % 240) + 1}`;

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
let leitor;

const criarDocumento = (token, corpo) =>
  pedir("/api/todogreen/fiscal/documentos", { metodo: "POST", token, corpo });

const transitar = (token, id, statusNovo) =>
  pedir(`/api/todogreen/fiscal/documentos/${id}/transicao`, {
    metodo: "POST", token, corpo: { statusNovo },
  });

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();

  gestora = await criarUsuario("fiscal-gestora", "gestora@fiscal.test");
  colega = await criarUsuario("fiscal-colega", "colega@fiscal.test");
  leitor = await criarUsuario("fiscal-leitor", "leitor@fiscal.test");
  await autorizar(gestora, "financeiro", ["read", "fiscal:manage"]);
  await autorizar(colega, "financeiro", ["read", "fiscal:manage"]);
  await autorizar(leitor, "auditor", ["read"]);
});

describe("perfil fiscal", () => {
  it("grava e relê o perfil, e o número na tela vem do banco", async () => {
    const r = await pedir("/api/todogreen/fiscal/profile", {
      metodo: "POST", token: gestora.token,
      corpo: {
        razaoSocial: "To Do Green Transportes",
        cnpj: "12.345.678/0001-99",
        uf: "SP", regimeTributario: "simples", simplesAnexo: "III",
        faturamento12m: 500000, icmsAliquotaInterna: 18, issAliquota: 2,
      },
    });
    expect(r.status).toBe(201);
    const perfil = await r.json();
    expect(perfil.razaoSocial).toBe("To Do Green Transportes");
    expect(perfil.cnpj).toBe("12345678000199");
    expect(perfil.revision).toBe(1);
  });

  it("exige a revisão lida — dois salvamentos concorrentes não se atropelam", async () => {
    const atual = await (await pedir("/api/todogreen/fiscal/profile", { token: gestora.token })).json();
    const r = await pedir("/api/todogreen/fiscal/profile", {
      metodo: "POST", token: gestora.token,
      corpo: { razaoSocial: "Nome novo", cnpj: atual.cnpj, uf: "SP", revision: 999 },
    });
    expect(r.status).toBe(409);
  });
});

describe("ciclo de vida do documento", () => {
  it("cria como rascunho", async () => {
    const r = await criarDocumento(gestora.token, {
      docType: "cte", valorServico: 1000, ufInicio: "SP", ufFim: "RJ",
      tomadorId: "cli-1", cfop: "6353", serie: 1, numero: 1,
    });
    expect(r.status).toBe(201);
    const doc = await r.json();
    expect(doc.status).toBe("rascunho");
    expect(doc.docType).toBe("cte");
  });

  it("não valida um CT-e sem os campos obrigatórios", async () => {
    const criado = await (await criarDocumento(gestora.token, {
      docType: "cte", valorServico: 0,
    })).json();
    const r = await transitar(gestora.token, criado.id, "validado");
    expect(r.status).toBe(400);
    const corpo = await r.json();
    expect(corpo.erros.length).toBeGreaterThan(0);
  });

  it("valida um CT-e completo e recusa pulo de estado", async () => {
    const criado = await (await criarDocumento(gestora.token, {
      docType: "cte", valorServico: 2000, ufInicio: "SP", ufFim: "MG",
      tomadorId: "cli-2", cfop: "6353",
    })).json();

    // rascunho → autorizado não existe na máquina de estados
    const pulo = await transitar(gestora.token, criado.id, "autorizado");
    expect(pulo.status).toBe(409);

    // rascunho → validado é o passo legítimo
    const ok = await transitar(gestora.token, criado.id, "validado");
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("validado");
  });
});

describe("impostos são calculados no servidor", () => {
  it("CT-e interestadual S→SE devolve ICMS e CFOP corretos", async () => {
    const r = await pedir("/api/todogreen/fiscal/calcular", {
      metodo: "POST", token: gestora.token,
      corpo: { docType: "cte", valorServico: 1000, ufOrigem: "SP", ufDestino: "RJ", cstIcms: "00" },
    });
    expect(r.status).toBe(200);
    const impostos = await r.json();
    // Simples Nacional: ICMS não sai destacado (CST 90).
    expect(impostos.cfop).toBe("6353");
    expect(impostos.icms.cstIcms).toBe("90");
  });
});

describe("escopo e permissão", () => {
  it("um espaço não vê o documento do outro", async () => {
    const doColega = await (await criarDocumento(colega.token, {
      docType: "cte", valorServico: 5000, ufInicio: "BA", ufFim: "SP", tomadorId: "x", cfop: "6353",
    })).json();

    const lista = await (await pedir("/api/todogreen/fiscal/documentos", { token: gestora.token })).json();
    expect(lista.registros.map((d) => d.id)).not.toContain(doColega.id);

    // E a transição num documento de outro espaço responde 404, não 403.
    const r = await transitar(gestora.token, doColega.id, "validado");
    expect(r.status).toBe(404);
  });

  it("quem só lê consulta mas não emite", async () => {
    expect((await pedir("/api/todogreen/fiscal/resumo", { token: leitor.token })).status).toBe(403);
    const r = await criarDocumento(leitor.token, { docType: "cte", valorServico: 100 });
    expect(r.status).toBe(403);
  });

  it("sem sessão, nada", async () => {
    expect((await pedir("/api/todogreen/fiscal/documentos")).status).toBe(401);
  });
});

describe("transmissão desligada sem certificado", () => {
  it("o resumo informa que a transmissão à SEFAZ está desabilitada", async () => {
    const r = await pedir("/api/todogreen/fiscal/resumo", { token: gestora.token });
    expect(r.status).toBe(200);
    // Sem NFE_CERT_PFX/NFE_CERT_PASSWORD no ambiente de teste.
    expect((await r.json()).transmissaoHabilitada).toBe(false);
  });
});
