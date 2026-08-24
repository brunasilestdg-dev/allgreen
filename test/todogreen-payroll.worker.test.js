import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Pessoas e folha. O que estes testes protegem:
//   • dado sensível (CPF, salário) só para quem tem hr:manage — os demais 403;
//   • CPF mascarado na lista, inteiro só no detalhe;
//   • fechar a folha calcula o holerite e TRAVA (não fecha duas vezes);
//   • um espaço não vê o colaborador do outro.

let n = 0;
const nextIp = () => `198.24.0.${(++n % 240) + 1}`;

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
async function autorizar(usuario, papel, permissoes) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails (id, tenant_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'active', ?, '', ?, ?, ?)
     ON CONFLICT(tenant_id, email) DO UPDATE SET role = excluded.role, permissions_json = excluded.permissions_json, status = 'active'`,
  ).bind(crypto.randomUUID(), usuario.email, papel, JSON.stringify(permissoes), usuario.id, agora, agora).run();
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

let rh;
let vendedor;
let colega;

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen','todogreen','To Do Green','logistica','active','{}',?,?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();
  rh = await criarUsuario("folha-rh", "rh@folha.test");
  vendedor = await criarUsuario("folha-vendedor", "vendedor@folha.test");
  colega = await criarUsuario("folha-colega", "colega@folha.test");
  await autorizar(rh, "rh", ["read", "hr:manage"]);
  await autorizar(vendedor, "vendedor", ["read", "crm:manage"]);
  await autorizar(colega, "rh", ["read", "hr:manage"]);
});

describe("LGPD: só o RH entra", () => {
  it("vendedor sem hr:manage recebe 403 em tudo", async () => {
    expect((await pedir("/api/todogreen/payroll/colaboradores", { token: vendedor.token })).status).toBe(403);
    expect((await pedir("/api/todogreen/payroll/resumo", { token: vendedor.token })).status).toBe(403);
  });
  it("sem sessão, 401", async () => {
    expect((await pedir("/api/todogreen/payroll/colaboradores")).status).toBe(401);
  });
});

describe("colaboradores e CPF", () => {
  let colaboradorId;
  it("cria colaborador válido e recusa CPF inválido", async () => {
    const ruim = await pedir("/api/todogreen/payroll/colaboradores", {
      metodo: "POST", token: rh.token, corpo: { nome: "Sem CPF", cpf: "123", salarioBase: 3000, admissaoEm: "2026-01-10" },
    });
    expect(ruim.status).toBe(400);

    const ok = await pedir("/api/todogreen/payroll/colaboradores", {
      metodo: "POST", token: rh.token,
      corpo: { nome: "Ana Motorista", cpf: "111.444.777-35", salarioBase: 3000, dependentes: 1, admissaoEm: "2026-01-10", cargo: "Motorista" },
    });
    expect(ok.status).toBe(201);
    const criado = await ok.json();
    colaboradorId = criado.id;
    // No POST (detalhe), o CPF volta inteiro.
    expect(criado.cpf).toBe("11144477735");
  });

  it("na lista o CPF vem mascarado; no detalhe, inteiro", async () => {
    const lista = await (await pedir("/api/todogreen/payroll/colaboradores", { token: rh.token })).json();
    const naLista = lista.registros.find((c) => c.id === colaboradorId);
    expect(naLista.cpf).toBe("***.***.777-35");

    const detalhe = await (await pedir(`/api/todogreen/payroll/colaboradores/${colaboradorId}`, { token: rh.token })).json();
    expect(detalhe.cpf).toBe("11144477735");
  });
});

describe("fechamento da folha trava", () => {
  it("fecha calculando o holerite e não fecha de novo", async () => {
    // Garante ao menos um colaborador ativo.
    await pedir("/api/todogreen/payroll/colaboradores", {
      metodo: "POST", token: rh.token,
      corpo: { nome: "Beto Ajudante", cpf: "111.444.777-35", salarioBase: 2000, admissaoEm: "2026-02-01" },
    });
    const run = await (await pedir("/api/todogreen/payroll/folhas", {
      metodo: "POST", token: rh.token, corpo: { competencia: "2026-03", tipo: "mensal" },
    })).json();

    const fechar = await pedir(`/api/todogreen/payroll/folhas/${run.id}/fechar`, { metodo: "POST", token: rh.token });
    expect(fechar.status).toBe(200);
    const resultado = await fechar.json();
    expect(resultado.colaboradores).toBeGreaterThanOrEqual(2);
    expect(resultado.totalLiquido).toBeGreaterThan(0);
    expect(resultado.run.status).toBe("fechada");

    // Holerites gravados.
    const itens = await (await pedir(`/api/todogreen/payroll/folhas/${run.id}/itens`, { token: rh.token })).json();
    expect(itens.registros.length).toBe(resultado.colaboradores);
    expect(itens.registros[0].descontos.some((d) => d.codigo === "inss")).toBe(true);

    // Fechar de novo é recusado.
    const denovo = await pedir(`/api/todogreen/payroll/folhas/${run.id}/fechar`, { metodo: "POST", token: rh.token });
    expect(denovo.status).toBe(409);

    // Reabrir volta a permitir.
    expect((await pedir(`/api/todogreen/payroll/folhas/${run.id}/reabrir`, { metodo: "POST", token: rh.token })).status).toBe(200);
  });
});

describe("escopo", () => {
  it("um espaço não vê o colaborador do outro", async () => {
    const doColega = await (await pedir("/api/todogreen/payroll/colaboradores", {
      metodo: "POST", token: colega.token, corpo: { nome: "Do Colega", cpf: "111.444.777-35", salarioBase: 1500, admissaoEm: "2026-01-01" },
    })).json();
    const lista = await (await pedir("/api/todogreen/payroll/colaboradores", { token: rh.token })).json();
    expect(lista.registros.some((c) => c.id === doColega.id)).toBe(false);
    // E acessar direto responde 404, não 403.
    expect((await pedir(`/api/todogreen/payroll/colaboradores/${doColega.id}`, { token: rh.token })).status).toBe(404);
  });
});
