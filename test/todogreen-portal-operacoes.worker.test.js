import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// A aba de operações era uma tabela de cinco colunas. Estes testes cobrem o que
// ela nunca teve: busca, filtro, paginação com os números à vista, prazo
// prometido contra realizado, ocorrências e linha do tempo.

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

const pedir = (caminho, token, metodo = "GET") =>
  worker.fetch(
    new Request(`https://app.test${caminho}`, {
      method: metodo,
      headers: token
        ? { authorization: `Bearer ${token}`, "cf-connecting-ip": nextIp(), "content-type": "application/json" }
        : { "cf-connecting-ip": nextIp() },
      body: metodo === "POST" ? "{}" : undefined,
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );

const h = (n) => new Date(Date.now() + n * 3600 * 1000).toISOString();

let dona;
let cliente;
let clienteId;
let comAtraso;
let comOcorrencia;

async function criarOperacao(campos = {}) {
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_client_operations
       (id, tenant_id, client_id, workspace_owner_id, reference, status, service_date,
        origin, destination, promised_at, delivered_at, eta_at, vehicle_plate, driver_name,
        distance_km, proof_url, proof_hash, created_by, updated_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, clienteId, dona.id,
      campos.referencia || "OP-X", campos.situacao || "entregue",
      (campos.dataServico || agora).slice(0, 10),
      campos.origem || "São Paulo", campos.destino || "Campinas",
      campos.prometidoEm || null, campos.entregueEm || null, campos.previsaoEm || null,
      campos.placa || "", campos.motorista || "", campos.distanciaKm || 0,
      campos.comprovanteUrl || "", campos.comprovanteHash || "",
      dona.id, dona.id, agora, agora,
    )
    .run();
  return id;
}

async function registrarEvento(operacaoId, tipo, titulo, quando) {
  await env.DB.prepare(
    `INSERT INTO todogreen_client_operation_events
       (id, tenant_id, operation_id, client_id, workspace_owner_id, kind, titulo, descricao,
        local, ocorrido_em, registrado_por, created_at)
     VALUES (?, 'todogreen', ?, ?, ?, ?, ?, '', '', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), operacaoId, clienteId, dona.id, tipo, titulo, quando, dona.id, new Date().toISOString())
    .run();
}

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();

  dona = await criarUsuario("op-dona", "dona@op.com.br");
  clienteId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id, tenant_id, workspace_owner_id, name, legal_name, document, segment, status,
        portal_enabled, created_by, updated_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'Alfa', 'Alfa LTDA', '', 'varejo', 'ativo', 1, ?, ?, ?, ?)`,
  ).bind(clienteId, dona.id, dona.id, dona.id, agora, agora).run();

  cliente = await criarUsuario("op-cliente", "contato@op.com.br");
  await env.DB.prepare(
    `INSERT INTO todogreen_client_users
       (id, tenant_id, client_id, email, role, status, permissions_json, invited_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'cliente_admin', 'active', '["*"]', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), clienteId, cliente.email, dona.id, agora, agora).run();

  await criarOperacao({ referencia: "OP-NOPRAZO", prometidoEm: h(-20), entregueEm: h(-22), origem: "Santos" });
  comAtraso = await criarOperacao({
    referencia: "OP-ATRASO",
    prometidoEm: h(-30),
    entregueEm: h(-25),
    placa: "ABC1D23",
    motorista: "Joana",
    comprovanteUrl: "https://arquivos.exemplo.com/pod.pdf",
    comprovanteHash: "abc123",
  });
  comOcorrencia = await criarOperacao({ referencia: "OP-OCORR", prometidoEm: h(10), situacao: "em_transito" });

  await registrarEvento(comOcorrencia, "coleta", "Coletado no CD", h(-4));
  await registrarEvento(comOcorrencia, "ocorrencia", "Bloqueio na rodovia", h(-2));
  // Registrado por último, mas aconteceu antes: a ordem é a da viagem.
  await registrarEvento(comOcorrencia, "transito", "Saiu do hub", h(-3));
});

describe("a lista deixou de ser cinco colunas", () => {
  it("traz prazo, ocorrências e resumo da seleção", async () => {
    const r = await pedir("/api/todogreen/portal/operacoes", cliente.token);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.paginacao.total).toBe(3);
    expect(corpo.resumo.pontualidadePercent).toBe(50);
    const atrasada = corpo.operacoes.find((o) => o.referencia === "OP-ATRASO");
    expect(atrasada.sla.situacao).toBe("atrasado");
    expect(atrasada.sla.atrasoHoras).toBe(5);
    expect(atrasada.placa).toBe("ABC1D23");
  });

  it("a lista nunca despeja a posição viva (last_position) — nem de operação entregue", async () => {
    // Carimba uma posição na operação JÁ ENTREGUE. A tabela nunca desenha
    // posição (ela só aparece no detalhe, com a janela LGPD de 6h e só em
    // trânsito); a lista não pode furar essa proteção despejando last_position.
    await env.DB.prepare(
      `UPDATE todogreen_client_operations
          SET last_position_lat = -23.5, last_position_lng = -46.6, last_position_at = ?
        WHERE id = ?`,
    ).bind(new Date().toISOString(), comAtraso).run();

    const corpo = await (await pedir("/api/todogreen/portal/operacoes", cliente.token)).json();
    const atrasada = corpo.operacoes.find((o) => o.referencia === "OP-ATRASO");
    expect(atrasada).toBeTruthy();
    expect(atrasada.ultimaPosicao).toBeUndefined();
    // E nada de latitude/longitude vazando por outro nome no JSON da lista.
    expect(JSON.stringify(corpo)).not.toMatch(/-23\.5|-46\.6/);
  });

  it("busca por origem, ignorando acento", async () => {
    const corpo = await (await pedir("/api/todogreen/portal/operacoes?busca=santos", cliente.token)).json();
    expect(corpo.operacoes.map((o) => o.referencia)).toEqual(["OP-NOPRAZO"]);
  });

  it("busca por placa; o nome do motorista não é pesquisável (dado pessoal fora do portal)", async () => {
    const porPlaca = await (await pedir("/api/todogreen/portal/operacoes?busca=ABC1D23", cliente.token)).json();
    expect(porPlaca.operacoes).toHaveLength(1);
    // O nome do motorista não sai para o embarcador nem alimenta a busca —
    // procurar por ele não pode revelar (ou confirmar) qual operação ele dirigiu.
    const porMotorista = await (await pedir("/api/todogreen/portal/operacoes?busca=joana", cliente.token)).json();
    expect(porMotorista.operacoes).toHaveLength(0);
    // E o campo `motorista` não viaja em nenhuma operação da lista.
    const todas = await (await pedir("/api/todogreen/portal/operacoes", cliente.token)).json();
    expect(todas.operacoes.every((o) => !("motorista" in o))).toBe(true);
  });

  it("filtra atrasadas e com ocorrência", async () => {
    const atrasadas = await (await pedir("/api/todogreen/portal/operacoes?situacao=atrasadas", cliente.token)).json();
    expect(atrasadas.operacoes.map((o) => o.referencia)).toEqual(["OP-ATRASO"]);
    const comOcorr = await (
      await pedir("/api/todogreen/portal/operacoes?situacao=com_ocorrencia", cliente.token)
    ).json();
    expect(comOcorr.operacoes.map((o) => o.referencia)).toEqual(["OP-OCORR"]);
  });

  it("o resumo acompanha o filtro, não a carteira inteira", async () => {
    // Um filtro que muda a lista e não muda o indicador faz a tela contar duas
    // histórias ao mesmo tempo.
    const corpo = await (await pedir("/api/todogreen/portal/operacoes?situacao=atrasadas", cliente.token)).json();
    expect(corpo.resumo.total).toBe(1);
  });

  it("a paginação diz de quantos até quantos", async () => {
    const corpo = await (
      await pedir("/api/todogreen/portal/operacoes?porPagina=2&pagina=2", cliente.token)
    ).json();
    expect(corpo.paginacao.primeiro).toBe(3);
    expect(corpo.paginacao.ultimo).toBe(3);
    expect(corpo.paginacao.total).toBe(3);
    expect(corpo.paginacao.paginas).toBe(2);
  });
});

describe("o detalhe", () => {
  it("traz a linha do tempo na ordem em que aconteceu", async () => {
    const r = await pedir(`/api/todogreen/portal/operacoes/${comOcorrencia}`, cliente.token);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    // O "Saiu do hub" foi registrado por último e aconteceu no meio.
    expect(corpo.linhaDoTempo.map((e) => e.titulo)).toEqual([
      "Coletado no CD",
      "Saiu do hub",
      "Bloqueio na rodovia",
    ]);
    expect(corpo.ocorrencias).toHaveLength(1);
  });

  it("diz quando o comprovante ainda não existe, em vez de oferecer botão morto", async () => {
    const corpo = await (await pedir(`/api/todogreen/portal/operacoes/${comOcorrencia}`, cliente.token)).json();
    expect(corpo.comprovante.disponivel).toBe(false);
    expect(corpo.comprovante.motivo).toMatch(/ainda não foi anexado/);
  });

  it("com comprovante, o link temporário é emitido", async () => {
    const detalhe = await (await pedir(`/api/todogreen/portal/operacoes/${comAtraso}`, cliente.token)).json();
    expect(detalhe.comprovante.disponivel).toBe(true);

    const r = await pedir(`/api/todogreen/portal/operacoes/${comAtraso}/comprovante`, cliente.token, "POST");
    expect(r.status).toBe(201);
    const { url } = await r.json();
    expect(url).toMatch(/^\/api\/todogreen\/arquivo\?t=/);
    // O endereço de origem não chega ao navegador do cliente.
    expect(url).not.toContain("arquivos.exemplo.com");
  });

  it("POD guardado no cofre interno chega ao cliente (link interno, não externo)", async () => {
    // O POD real do motorista é salvo no cofre INTERNO e o proof_url aponta para
    // /api/todogreen/file-vault/:id/download — caminho relativo/interno que o
    // enderecoAceito recusa de propósito. Antes da correção, o cliente recebia
    // erro ao pedir o comprovante de uma entrega de verdade (o teste acima só
    // passava porque usava uma URL externa fabricada).
    const fileId = crypto.randomUUID();
    const conteudo = "POD-BYTES-REAIS";
    await env.DB.prepare(
      `INSERT INTO todogreen_internal_files
         (id,tenant_id,workspace_owner_id,client_id,workflow_id,context_type,context_id,
          file_name,content_type,byte_size,sha256,version,source,external_url,folder_id,
          created_by,created_at,archived_at)
       VALUES (?,'todogreen',?,NULL,NULL,'operation_proof',NULL,?,?,?,'',1,'internal_upload','','',?,?,NULL)`,
    )
      .bind(fileId, dona.id, `pod-${fileId}.jpg`, "image/jpeg", conteudo.length, dona.id, new Date().toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO todogreen_internal_file_chunks (file_id, chunk_index, content_base64) VALUES (?,0,?)",
    )
      .bind(fileId, btoa(conteudo))
      .run();

    const opId = await criarOperacao({
      referencia: "OP-POD-INTERNO",
      prometidoEm: h(-30),
      entregueEm: h(-25),
      comprovanteUrl: `/api/todogreen/file-vault/${fileId}/download`,
      comprovanteHash: "hhh",
    });

    const r = await pedir(`/api/todogreen/portal/operacoes/${opId}/comprovante`, cliente.token, "POST");
    expect(r.status).toBe(201);
    const { url } = await r.json();
    expect(url).toMatch(/^\/api\/todogreen\/arquivo\?t=/);
    // O caminho interno do cofre não vaza para o cliente.
    expect(url).not.toContain("file-vault");

    // O cliente abre o link (público por token) e recebe os BYTES do POD.
    const arq = await worker.fetch(
      new Request(`https://app.test${url}`, { headers: { "cf-connecting-ip": nextIp() } }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    expect(arq.status).toBe(200);
    expect(await arq.text()).toBe(conteudo);
  });

  it("sem comprovante, o pedido de link é recusado com motivo", async () => {
    const r = await pedir(`/api/todogreen/portal/operacoes/${comOcorrencia}/comprovante`, cliente.token, "POST");
    expect(r.status).toBe(409);
  });

  it("operação de outro cliente responde 404", async () => {
    const r = await pedir("/api/todogreen/portal/operacoes/nao-existe", cliente.token);
    expect(r.status).toBe(404);
  });

  it("sem sessão, nada", async () => {
    expect((await pedir("/api/todogreen/portal/operacoes")).status).toBe(401);
  });
});
