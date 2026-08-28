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
      corpo: { nome: "Beto Ajudante", cpf: "526.018.159-06", salarioBase: 2000, admissaoEm: "2026-02-01" },
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

describe("folha lança no financeiro", () => {
  it("fechar gera as quatro contas a pagar no razão, com vencimento no mês seguinte", async () => {
    await pedir("/api/todogreen/payroll/colaboradores", {
      metodo: "POST", token: rh.token,
      corpo: { nome: "Davi Financeiro", cpf: "390.533.447-05", salarioBase: 4200, admissaoEm: "2026-01-02" },
    });
    const run = await (await pedir("/api/todogreen/payroll/folhas", {
      metodo: "POST", token: rh.token, corpo: { competencia: "2026-05", tipo: "mensal" },
    })).json();

    const fechar = await (await pedir(`/api/todogreen/payroll/folhas/${run.id}/fechar`, { metodo: "POST", token: rh.token })).json();
    expect(fechar.lancamentosFinanceiros).toBeGreaterThanOrEqual(1);

    const { results } = await env.DB.prepare(
      `SELECT category, amount, due_date, kind, competence_date, fields_json
         FROM todogreen_financial_entries
        WHERE workspace_owner_id = ? AND archived_at IS NULL
          AND json_extract(fields_json, '$.origem') = 'folha'
          AND json_extract(fields_json, '$.payrollRunId') = ?`,
    ).bind(rh.id, run.id).all();

    // Líquido + FGTS + INSS + IRRF (as que tiverem valor > 0), todas como custo.
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.kind === "cost")).toBe(true);
    const liquido = results.find((r) => r.category.includes("líquido"));
    expect(liquido).toBeTruthy();
    expect(liquido.amount).toBeGreaterThan(0);
    // Vencimento cai no mês seguinte à competência.
    expect(liquido.due_date.startsWith("2026-06")).toBe(true);
    expect(liquido.competence_date).toBe("2026-05-01");

    // Reprocessar (reabrir + fechar) não duplica os lançamentos não pagos.
    await pedir(`/api/todogreen/payroll/folhas/${run.id}/reabrir`, { metodo: "POST", token: rh.token });
    await pedir(`/api/todogreen/payroll/folhas/${run.id}/fechar`, { metodo: "POST", token: rh.token });
    const { results: depois } = await env.DB.prepare(
      `SELECT id FROM todogreen_financial_entries
        WHERE workspace_owner_id = ? AND archived_at IS NULL
          AND json_extract(fields_json, '$.origem') = 'folha'
          AND json_extract(fields_json, '$.payrollRunId') = ?`,
    ).bind(rh.id, run.id).all();
    expect(depois.length).toBe(results.length);
  });
});

describe("ponto e férias", () => {
  it("registra ponto e férias de um colaborador e lista de volta", async () => {
    const colab = await (await pedir("/api/todogreen/payroll/colaboradores", {
      metodo: "POST", token: rh.token,
      corpo: { nome: "Carla Ponto", cpf: "083.016.613-05", salarioBase: 2500, admissaoEm: "2026-01-05" },
    })).json();

    const ponto = await pedir("/api/todogreen/payroll/ponto", {
      metodo: "POST", token: rh.token,
      corpo: { employeeId: colab.id, dia: "2026-03-10", entrada: "08:00", saida: "18:00", horasExtras: 2 },
    });
    expect(ponto.status).toBe(201);
    const listaPonto = await (await pedir("/api/todogreen/payroll/ponto?colaborador=" + colab.id, { token: rh.token })).json();
    expect(listaPonto.registros.some((p) => p.dia === "2026-03-10" && p.horasExtras === 2)).toBe(true);

    const ferias = await pedir("/api/todogreen/payroll/ferias", {
      metodo: "POST", token: rh.token,
      corpo: { employeeId: colab.id, periodoAquisitivoInicio: "2026-01-05", periodoAquisitivoFim: "2027-01-04", dias: 30 },
    });
    expect(ferias.status).toBe(201);
    const listaFerias = await (await pedir("/api/todogreen/payroll/ferias?colaborador=" + colab.id, { token: rh.token })).json();
    expect(listaFerias.registros.some((f) => f.dias === 30 && f.status === "programada")).toBe(true);
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

describe("encargo patronal no fechamento", () => {
  it("fora do Simples, fechar a folha lança o INSS patronal como conta a pagar", async () => {
    // Empresa em Lucro Presumido → paga CPP+RAT+terceiros (no Simples estaria no DAS).
    await env.DB.prepare(
      `INSERT INTO todogreen_tax_profiles (id,tenant_id,workspace_owner_id,regime_tributario)
       VALUES ('tax-rh','todogreen',?,'lucro_presumido')`,
    ).bind(rh.id).run();
    await pedir("/api/todogreen/payroll/colaboradores", {
      metodo: "POST", token: rh.token,
      corpo: { nome: "Eva Encargo", cpf: "153.509.460-56", salarioBase: 5000, admissaoEm: "2026-01-02" },
    });
    const run = await (await pedir("/api/todogreen/payroll/folhas", {
      metodo: "POST", token: rh.token, corpo: { competencia: "2026-11", tipo: "mensal" },
    })).json();
    await pedir(`/api/todogreen/payroll/folhas/${run.id}/fechar`, { metodo: "POST", token: rh.token });

    const { results } = await env.DB.prepare(
      `SELECT category, amount FROM todogreen_financial_entries
        WHERE workspace_owner_id = ? AND archived_at IS NULL
          AND json_extract(fields_json, '$.origem') = 'folha'
          AND json_extract(fields_json, '$.payrollRunId') = ?`,
    ).bind(rh.id, run.id).all();
    const patronal = results.find((r) => r.category.includes("patronal"));
    expect(patronal).toBeTruthy();
    expect(patronal.amount).toBeGreaterThan(0);
  });
});

describe("mensal: DSR sobre variáveis e desconto de falta", () => {
  it("extras geram DSR (provento) e faltas descontam do líquido e da base", async () => {
    const colab = await (await pedir("/api/todogreen/payroll/colaboradores", {
      metodo: "POST", token: rh.token,
      corpo: { nome: "Gina Falta", cpf: "168.995.350-09", salarioBase: 3300, admissaoEm: "2026-01-02" },
    })).json();
    // Competência 2026-07: 10h extras num dia e uma falta não abonada em outro.
    await pedir("/api/todogreen/payroll/ponto", {
      metodo: "POST", token: rh.token,
      corpo: { employeeId: colab.id, dia: "2026-07-06", entrada: "08:00", saida: "20:00", horasExtras: 10 },
    });
    await pedir("/api/todogreen/payroll/ponto", {
      metodo: "POST", token: rh.token,
      corpo: { employeeId: colab.id, dia: "2026-07-13", falta: true },
    });
    const run = await (await pedir("/api/todogreen/payroll/folhas", {
      metodo: "POST", token: rh.token, corpo: { competencia: "2026-07", tipo: "mensal" },
    })).json();
    expect((await pedir(`/api/todogreen/payroll/folhas/${run.id}/fechar`, { metodo: "POST", token: rh.token })).status).toBe(200);

    const itens = await (await pedir(`/api/todogreen/payroll/folhas/${run.id}/itens`, { token: rh.token })).json();
    const meu = itens.registros.find((i) => i.employeeId === colab.id);
    expect(meu).toBeTruthy();
    // Extras + DSR sobre extras entram como proventos.
    expect(meu.proventos.some((p) => p.codigo === "he50")).toBe(true);
    expect(meu.proventos.some((p) => p.codigo === "dsr")).toBe(true);
    // Falta entra como desconto: (3300/30)×1 = 110, e reduz a base tributável,
    // que por isso fica abaixo do total de proventos (não se tributa o não pago).
    const falta = meu.descontos.find((d) => d.codigo === "falta");
    expect(falta).toBeTruthy();
    expect(falta.valor).toBe(110);
    expect(meu.baseInss).toBeLessThan(meu.totalProventos);
  });
});

describe("13º proporcional aos avos do ano", () => {
  it("fecha por tipo decimo_terceiro, proporcional aos meses, e exclui quem entrou depois", async () => {
    // Helena: ano inteiro → 12 avos (13º = salário). Igor: admitido em julho →
    // 6 avos (13º = metade). Novo2027: admitido depois do ano-base → sem 13º.
    await pedir("/api/todogreen/payroll/colaboradores", {
      metodo: "POST", token: rh.token,
      corpo: { nome: "Helena Treze", cpf: "296.769.940-30", salarioBase: 3000, admissaoEm: "2026-01-05" },
    });
    const igor = await (await pedir("/api/todogreen/payroll/colaboradores", {
      metodo: "POST", token: rh.token,
      corpo: { nome: "Igor Meio", cpf: "638.085.470-30", salarioBase: 4000, admissaoEm: "2026-07-10" },
    })).json();
    const novo = await (await pedir("/api/todogreen/payroll/colaboradores", {
      metodo: "POST", token: rh.token,
      corpo: { nome: "Novo Depois", cpf: "409.774.180-22", salarioBase: 3000, admissaoEm: "2027-03-01" },
    })).json();

    const run = await (await pedir("/api/todogreen/payroll/folhas", {
      metodo: "POST", token: rh.token, corpo: { competencia: "2026-12", tipo: "decimo_terceiro" },
    })).json();
    const fechar = await pedir(`/api/todogreen/payroll/folhas/${run.id}/fechar`, { metodo: "POST", token: rh.token });
    expect(fechar.status).toBe(200);
    expect((await fechar.json()).run.status).toBe("fechada");

    const itens = await (await pedir(`/api/todogreen/payroll/folhas/${run.id}/itens`, { token: rh.token })).json();
    // Igor: 6/12 de 4000 = 2000 de 13º bruto, com INSS descontado.
    const itemIgor = itens.registros.find((i) => i.employeeId === igor.id);
    expect(itemIgor.totalProventos).toBe(2000);
    expect(itemIgor.descontos.some((d) => d.codigo === "inss")).toBe(true);
    // Quem entrou depois do ano-base não gera holerite de 13º.
    expect(itens.registros.some((i) => i.employeeId === novo.id)).toBe(false);
  });
});
