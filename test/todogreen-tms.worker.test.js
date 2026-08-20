import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Integração com o TMS TRACK3R.
//
// O que estes testes existem para impedir de voltar:
//   • reimportar o relatório duplicando documento (o do dia seguinte repete os
//     dias anteriores — reimportar é rotina, não exceção);
//   • atualização de status criando documento novo em vez de atualizar;
//   • reimportação DESFAZENDO um vínculo que alguém casou à mão;
//   • embarcador casado por nome parecido, criando vínculo falso;
//   • documento sem conta ou sem classe de veículo sendo descartado — faltar
//     vínculo não é erro;
//   • projeção criando operação órfã, sem conta ou sem data;
//   • moto e carreta caindo no mesmo balde de custo.

let n = 0;
const nextIp = () => `198.25.0.${(++n % 240) + 1}`;

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

async function criarCliente(usuario, id, nome, documento = "") {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_clients
       (id, tenant_id, workspace_owner_id, name, legal_name, document, status,
        portal_enabled, created_by, updated_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, ?, 'ativo', 0, ?, ?, ?, ?)`,
  ).bind(id, usuario.id, nome, nome, documento, usuario.id, usuario.id, agora, agora).run();
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
let auditor;

// Uma linha como o relatório do TRACK3R sai: rótulos da tela, dd/mm/aaaa.
const linha = (extra = {}) => ({
  "Nº do Documento": extra.id || "TG-1",
  "Serviço": extra.servico || "Coleta",
  "Embarcador": extra.embarcador || "Amazon Serviços de Varejo do Brasil",
  "Embarcador Agrupador": extra.grupo || "AMAZON",
  "CNPJ": extra.cnpj === undefined ? "11.222.333/0001-81" : extra.cnpj,
  "Unidade Origem da Coleta": extra.origem || "Sorocaba",
  "Unidade Atual da Coleta": extra.atual || "Cajamar",
  "Produto": "Encomenda",
  "Status": extra.status || "Em trânsito",
  "Número da Nota Fiscal": extra.nota || "5001",
  "Placa": extra.placa || "ABC1D23",
  "Tipo de Veículo": extra.veiculo === undefined ? "Sprinter" : extra.veiculo,
  "Motorista": "João Silva",
  "Volumes": extra.volumes || "10",
  "Distância": "40",
  "Data Altera": extra.data || "19/08/2026 10:00",
});

const importar = (token, linhas) =>
  pedir("/api/todogreen/tms/importacoes", { metodo: "POST", token, corpo: { linhas } });

const documentos = async (token, query = "") =>
  (await (await pedir(`/api/todogreen/tms/documentos${query}`, { token })).json());

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(new Date().toISOString(), new Date().toISOString()).run();

  gestora = await criarUsuario("tms-gestora", "gestora@tms.test");
  colega = await criarUsuario("tms-colega", "colega@tms.test");
  auditor = await criarUsuario("tms-auditor", "auditor@tms.test");
  await autorizar(gestora);
  await autorizar(colega);
  await autorizar(auditor, "auditor", ["read"]);

  await criarCliente(gestora, "c-amazon", "Amazon", "11222333000181");
  await criarCliente(gestora, "c-shopee", "Shopee", "52998224725");
});

describe("configuração", () => {
  it("diz o que está ligado e o que falta, sem expor segredo", async () => {
    const r = await pedir("/api/todogreen/tms/configuracao", { token: gestora.token });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    // O modo arquivo funciona sempre; API e webhook dependem de segredo.
    expect(corpo.modos).toMatchObject({ arquivo: true, api: false, webhook: false });
    // E as perguntas ao fornecedor são o próximo passo concreto.
    expect(corpo.perguntasAoFornecedor.join(" ")).toMatch(/API REST/);
  });

  it("salva o modo arquivo e devolve a integração", async () => {
    const r = await pedir("/api/todogreen/tms/configuracao", {
      metodo: "POST", token: gestora.token,
      corpo: { name: "TRACK3R", syncMode: "arquivo", fieldMap: { externalId: "CODIGO" } },
    });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.integracao).toMatchObject({ provider: "track3r", syncMode: "arquivo" });
    expect(corpo.integracao.segredos).toMatchObject({ apiToken: false, webhookSecret: false });
    // O segredo em si nunca viaja.
    expect(JSON.stringify(corpo)).not.toMatch(/TODOGREEN_TRACK3R_API_TOKEN.*=/);
  });

  it("recusa ligar a API sem URL base e sem token no cofre", async () => {
    // Salvar um modo que não pode funcionar transformaria a tela num relatório
    // de erro silencioso.
    const semUrl = await pedir("/api/todogreen/tms/configuracao", {
      metodo: "POST", token: gestora.token, corpo: { syncMode: "api", revision: 1 },
    });
    expect(semUrl.status).toBe(400);

    const semToken = await pedir("/api/todogreen/tms/configuracao", {
      metodo: "POST", token: gestora.token,
      corpo: { syncMode: "api", baseUrl: "https://www.track3r.com.br/tms", revision: 1 },
    });
    expect(semToken.status).toBe(409);
    expect((await semToken.json()).segredoFaltando).toBe("TODOGREEN_TRACK3R_API_TOKEN");
  });

  it("recusa sincronizar pela API enquanto ela não está ligada", async () => {
    const r = await pedir("/api/todogreen/tms/sincronizacoes", {
      metodo: "POST", token: gestora.token, corpo: {},
    });
    expect(r.status).toBe(409);
    const corpo = await r.json();
    expect(corpo.error).toMatch(/ainda não está ligada/i);
    expect(corpo.perguntasAoFornecedor.length).toBeGreaterThan(0);
  });

  it("quem só consulta lê a configuração mas não a altera", async () => {
    expect((await pedir("/api/todogreen/tms/configuracao", { token: auditor.token })).status).toBe(200);
    const r = await pedir("/api/todogreen/tms/importacoes", {
      metodo: "POST", token: auditor.token, corpo: { linhas: [linha()] },
    });
    expect(r.status).toBe(403);
  });

  it("sem sessão, nada", async () => {
    expect((await pedir("/api/todogreen/tms/configuracao")).status).toBe(401);
  });
});

describe("importação de arquivo — funciona sem credencial", () => {
  it("importa, casa o embarcador por CNPJ e reconhece a classe do veículo", async () => {
    const r = await importar(gestora.token, [linha({ id: "TG-100" })]);
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ recebidos: 1, gravados: 1, ignorados: 0 });

    const { registros } = await documentos(gestora.token);
    const doc = registros.find((d) => d.externalId === "TG-100");
    expect(doc).toMatchObject({
      kind: "coleta",
      shipperGroup: "AMAZON",
      clientId: "c-amazon",
      vehicleClass: "van",
      originUnit: "Sorocaba",
      status: "Em trânsito",
      origem: "arquivo",
    });
  });

  it("reimportar o mesmo relatório não duplica", async () => {
    const antes = (await documentos(gestora.token)).total;
    await importar(gestora.token, [linha({ id: "TG-200" })]);
    const meio = (await documentos(gestora.token)).total;
    await importar(gestora.token, [linha({ id: "TG-200" })]);
    const depois = (await documentos(gestora.token)).total;
    expect(meio).toBe(antes + 1);
    expect(depois).toBe(meio);
  });

  it("o status novo ATUALIZA o documento, não cria outro", async () => {
    // A mesma coleta reaparece no relatório do dia seguinte com status novo.
    await importar(gestora.token, [linha({ id: "TG-300", status: "Em trânsito" })]);
    const antes = (await documentos(gestora.token)).total;

    await importar(gestora.token, [
      linha({ id: "TG-300", status: "Entregue", atual: "Jundiaí" }),
    ]);
    const { registros, total } = await documentos(gestora.token);
    expect(total).toBe(antes);
    const doc = registros.find((d) => d.externalId === "TG-300");
    expect(doc.status).toBe("Entregue");
    expect(doc.currentUnit).toBe("Jundiaí");
    expect(doc.revision).toBeGreaterThan(1);
  });

  it("a reimportação NÃO desfaz um vínculo casado à mão", async () => {
    // Alguém pode ter casado manualmente; a reimportação não pode desfazer.
    await importar(gestora.token, [linha({ id: "TG-400", cnpj: "", embarcador: "Transportadora nova" })]);
    let doc = (await documentos(gestora.token)).registros.find((d) => d.externalId === "TG-400");
    expect(doc.clientId).toBe("");

    await pedir("/api/todogreen/tms/vinculos", {
      metodo: "POST", token: gestora.token,
      corpo: { documentoId: doc.id, clientId: "c-shopee" },
    });

    await importar(gestora.token, [linha({ id: "TG-400", cnpj: "", embarcador: "Transportadora nova", status: "Entregue" })]);
    doc = (await documentos(gestora.token)).registros.find((d) => d.externalId === "TG-400");
    expect(doc.clientId).toBe("c-shopee");
    expect(doc.status).toBe("Entregue");
  });

  it("informa o motivo de cada linha ignorada", async () => {
    // "12 ignorados" sem dizer por quê deixa a pessoa sem ação possível.
    const r = await importar(gestora.token, [
      linha({ id: "TG-500" }),
      { "Data Altera": "19/08/2026" },
      { "Embarcador": "Sem data" },
    ]);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ recebidos: 3, gravados: 1, ignorados: 2 });
    expect(corpo.erros[0]).toMatchObject({ linha: 2 });
    expect(corpo.erros.map((e) => e.motivo).join(" ")).toMatch(/identificá-la|data reconhecível/i);
  });

  it("recusa lote vazio e lote acima do teto", async () => {
    expect((await importar(gestora.token, [])).status).toBe(400);
    const grande = Array.from({ length: 301 }, (_, i) => linha({ id: `X${i}` }));
    expect((await importar(gestora.token, grande)).status).toBe(400);
  });

  it("registra a execução com recebidos, importados e ignorados", async () => {
    // Uma integração que falha em silêncio é pior que uma que não existe.
    const r = await pedir("/api/todogreen/tms/execucoes", { token: gestora.token });
    const { registros } = await r.json();
    expect(registros.length).toBeGreaterThan(0);
    expect(registros[0]).toMatchObject({ origem: "arquivo" });
    expect(registros[0].recebidos).toBeGreaterThan(0);
  });

  it("um espaço não vê o documento do outro", async () => {
    await importar(colega.token, [linha({ id: "DO-COLEGA", embarcador: "Embarcador do colega" })]);
    const { registros } = await documentos(gestora.token);
    expect(registros.map((d) => d.externalId)).not.toContain("DO-COLEGA");
  });
});

describe("vínculo faltando não é erro", () => {
  it("aceita documento sem CNPJ que case, e ele fica na fila", async () => {
    // Os assuntos nem sempre se relacionam: casar por nome parecido criaria
    // vínculo falso que ninguém depois sabe que é falso.
    const r = await importar(gestora.token, [
      linha({ id: "TG-600", cnpj: "", embarcador: "Amazon", grupo: "AMAZON" }),
    ]);
    expect(r.status).toBe(201);

    const { registros, resumo } = await documentos(gestora.token, "?semConta=1");
    expect(registros.map((d) => d.externalId)).toContain("TG-600");
    expect(resumo.semEmbarcador).toBeGreaterThan(0);
  });

  it("aceita documento sem classe de veículo reconhecível", async () => {
    await importar(gestora.token, [linha({ id: "TG-610", veiculo: "XPTO-9000" })]);
    const { registros } = await documentos(gestora.token, "?semClasse=1");
    const doc = registros.find((d) => d.externalId === "TG-610");
    expect(doc).toBeTruthy();
    expect(doc.vehicleClass).toBe("");
  });

  it("sugere a conta por nome e grupo, sem aplicar", async () => {
    const doc = (await documentos(gestora.token, "?semConta=1")).registros
      .find((d) => d.externalId === "TG-600");
    const r = await pedir(`/api/todogreen/tms/sugestoes?documento=${doc.id}`, { token: gestora.token });
    const { candidatos } = await r.json();
    expect(candidatos[0]).toMatchObject({ clientId: "c-amazon" });
    // Sugerir não é casar: o documento continua sem conta.
    const aindaSem = (await documentos(gestora.token, "?semConta=1")).registros
      .find((d) => d.externalId === "TG-600");
    expect(aindaSem.clientId).toBe("");
  });

  it("vincular pelo grupo resolve AMAZON DBA e AMAZON RETAIL de uma vez", async () => {
    await importar(gestora.token, [
      linha({ id: "GRP-1", cnpj: "", embarcador: "AMAZON DBA", grupo: "AMZ-BR" }),
      linha({ id: "GRP-2", cnpj: "", embarcador: "AMAZON RETAIL", grupo: "AMZ-BR" }),
    ]);
    const doc = (await documentos(gestora.token, "?semConta=1")).registros
      .find((d) => d.externalId === "GRP-1");

    const r = await pedir("/api/todogreen/tms/vinculos", {
      metodo: "POST", token: gestora.token,
      corpo: { documentoId: doc.id, clientId: "c-amazon", aplicarAoGrupo: true },
    });
    expect(r.status).toBe(200);
    // O outro do mesmo grupo também foi vinculado.
    expect((await r.json()).vinculadosPorGrupo).toBeGreaterThanOrEqual(1);

    const { registros } = await documentos(gestora.token);
    expect(registros.find((d) => d.externalId === "GRP-2").clientId).toBe("c-amazon");
  });

  it("recusa vincular a conta de outro espaço", async () => {
    const doc = (await documentos(gestora.token)).registros[0];
    const r = await pedir("/api/todogreen/tms/vinculos", {
      metodo: "POST", token: gestora.token,
      corpo: { documentoId: doc.id, clientId: "conta-inexistente" },
    });
    expect(r.status).toBe(404);
  });

  it("define a classe do veículo à mão e recusa classe inventada", async () => {
    const doc = (await documentos(gestora.token, "?semClasse=1")).registros
      .find((d) => d.externalId === "TG-610");

    expect((await pedir("/api/todogreen/tms/vinculos/classe", {
      metodo: "POST", token: gestora.token,
      corpo: { documentoId: doc.id, vehicleClass: "carreta" },
    })).status).toBe(200);

    expect((await pedir("/api/todogreen/tms/vinculos/classe", {
      metodo: "POST", token: gestora.token,
      corpo: { documentoId: doc.id, vehicleClass: "caminhonete" },
    })).status).toBe(400);
  });
});

describe("de moto a carreta, separado", () => {
  it("agrupa volumes e km por classe de veículo", async () => {
    await importar(gestora.token, [
      linha({ id: "CL-MOTO", veiculo: "MOTOBOY", volumes: "3", data: "01/09/2026 08:00" }),
      linha({ id: "CL-VAN", veiculo: "Sprinter", volumes: "20", data: "01/09/2026 09:00" }),
      linha({ id: "CL-CARRETA", veiculo: "CARRETA LS", volumes: "500", data: "01/09/2026 10:00" }),
    ]);

    const r = await pedir("/api/todogreen/tms/classes?mes=2026-09", { token: gestora.token });
    const { linhas } = await r.json();
    const porClasse = Object.fromEntries(linhas.map((l) => [l.classe, l]));
    // Moto e carreta não caem no mesmo balde.
    expect(porClasse.moto.volumes).toBe(3);
    expect(porClasse.van.volumes).toBe(20);
    expect(porClasse.carreta.volumes).toBe(500);
  });

  it("o que não tem classe aparece separado, não somado em outra", async () => {
    await importar(gestora.token, [
      linha({ id: "CL-SEM", veiculo: "???", volumes: "7", data: "02/09/2026 08:00" }),
    ]);
    const r = await pedir("/api/todogreen/tms/classes?mes=2026-09", { token: gestora.token });
    const { linhas } = await r.json();
    expect(linhas.find((l) => l.classe === "(sem classe)").volumes).toBe(7);
  });
});

describe("projeção na operação", () => {
  it("projeta o documento casado e cria o evento da linha do tempo", async () => {
    await importar(gestora.token, [
      linha({ id: "PRJ-1", status: "Entregue", data: "10/10/2026 15:00" }),
    ]);
    const doc = (await documentos(gestora.token)).registros.find((d) => d.externalId === "PRJ-1");
    expect(doc.clientId).toBe("c-amazon");

    const r = await pedir("/api/todogreen/tms/projecoes", {
      metodo: "POST", token: gestora.token, corpo: { documentoIds: [doc.id] },
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ projetados: 1, pulados: [] });

    // As colunas são as reais da tabela: `reference` e `service_date`. Volume e
    // peso vivem em `fields_json`, como a migração 0047 decidiu.
    const operacao = await env.DB.prepare(
      `SELECT client_id, reference, service_date, status, delivered_at, origin,
              destination, distance_km, fields_json
         FROM todogreen_client_operations WHERE workspace_owner_id = ?
        ORDER BY created_at DESC LIMIT 1`,
    ).bind(gestora.id).first();
    expect(operacao).toMatchObject({
      client_id: "c-amazon",
      reference: "5001",
      service_date: "2026-10-10",
      status: "concluida",
      origin: "Sorocaba",
      destination: "Cajamar",
    });
    expect(operacao.delivered_at).toBeTruthy();
    expect(JSON.parse(operacao.fields_json)).toMatchObject({
      sourceTms: "track3r", packages: 10, vehicleClass: "van",
    });

    const evento = await env.DB.prepare(
      `SELECT kind, titulo FROM todogreen_client_operation_events
        WHERE workspace_owner_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(gestora.id).first();
    expect(evento).toMatchObject({ kind: "entrega", titulo: "Entregue" });
  });

  it("não projeta sem conta casada, e diz o motivo", async () => {
    // Projetar sem cliente criaria operação órfã.
    await importar(gestora.token, [
      linha({ id: "PRJ-2", cnpj: "", embarcador: "Desconhecido", data: "11/10/2026 09:00" }),
    ]);
    const doc = (await documentos(gestora.token, "?semConta=1")).registros
      .find((d) => d.externalId === "PRJ-2");

    const r = await pedir("/api/todogreen/tms/projecoes", {
      metodo: "POST", token: gestora.token, corpo: { documentoIds: [doc.id] },
    });
    const corpo = await r.json();
    expect(corpo.projetados).toBe(0);
    expect(corpo.pulados[0]).toMatchObject({ documentoId: doc.id, motivo: "sem conta casada" });
  });

  it("não projeta o mesmo documento duas vezes", async () => {
    const doc = (await documentos(gestora.token)).registros.find((d) => d.externalId === "PRJ-1");
    expect(doc.operationId).toBeTruthy();
    const r = await pedir("/api/todogreen/tms/projecoes", {
      metodo: "POST", token: gestora.token, corpo: { documentoIds: [doc.id] },
    });
    expect((await r.json()).projetados).toBe(0);
  });

  it("status irreconhecível projeta a operação sem evento inventado", async () => {
    // Chutar "entrega" registraria uma entrega que não houve.
    await importar(gestora.token, [
      linha({ id: "PRJ-3", nota: "PRJ-3", status: "SITUACAO-XPTO", data: "12/10/2026 09:00" }),
    ]);
    const doc = (await documentos(gestora.token)).registros.find((d) => d.externalId === "PRJ-3");
    const r = await pedir("/api/todogreen/tms/projecoes", {
      metodo: "POST", token: gestora.token, corpo: { documentoIds: [doc.id] },
    });
    expect((await r.json()).projetados).toBe(1);

    const operacao = await env.DB.prepare(
      `SELECT status, delivered_at FROM todogreen_client_operations
        WHERE workspace_owner_id = ? AND reference = 'PRJ-3'`,
    ).bind(gestora.id).first();
    expect(operacao.status).toBe("active");
    expect(operacao.delivered_at).toBeNull();
  });

  it("recusa lote vazio e acima do teto", async () => {
    expect((await pedir("/api/todogreen/tms/projecoes", {
      metodo: "POST", token: gestora.token, corpo: { documentoIds: [] },
    })).status).toBe(400);
    expect((await pedir("/api/todogreen/tms/projecoes", {
      metodo: "POST", token: gestora.token,
      corpo: { documentoIds: Array.from({ length: 101 }, (_, i) => `x${i}`) },
    })).status).toBe(400);
  });
});

describe("o documento do TMS não é editado", () => {
  it("PATCH e DELETE respondem 405 apontando o vínculo", async () => {
    const doc = (await documentos(gestora.token)).registros[0];
    for (const metodo of ["PATCH", "DELETE"]) {
      const r = await pedir(`/api/todogreen/tms/documentos/${doc.id}`, {
        metodo, token: gestora.token, corpo: {},
      });
      expect(r.status).toBe(405);
      expect((await r.json()).error).toMatch(/Ajuste o vínculo/i);
    }
  });
});
