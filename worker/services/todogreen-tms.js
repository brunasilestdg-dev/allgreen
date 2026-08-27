// ===== TRACK3R: o TMS entrando na vertical =====
//
// Serviço próprio, e não coleção genérica, porque nada aqui é CRUD:
//
//   1. IMPORTAR é lote com deduplicação E atualização. A mesma coleta reaparece
//      no relatório do dia seguinte com status novo — precisa ATUALIZAR o
//      documento que existe, não criar outro. É o que o `import_hash` sem status
//      permite.
//
//   2. CASAR EMBARCADOR só acontece por CNPJ. Sem CNPJ que case, o documento
//      entra SEM conta e fica na fila. Casar por nome parecido criaria vínculo
//      falso que ninguém depois sabe que é falso.
//
//   3. PROJETAR na operação da vertical é opcional e explícito. Documento sem
//      cliente ou sem data não projeta — e continua valendo como registro.
//
// O modo ARQUIVO funciona hoje, sem credencial e sem custo. API e webhook ficam
// prontos e desligados por ausência de segredo, como o VAPID: `modoDisponivel`
// diz o que está ligado, e a tela mostra o que falta.

import { TENANT_ID, paginacao, podeNaVertical } from "./todogreen-access.js";
import {
  PERGUNTAS_AO_TRACK3R,
  casarEmbarcador,
  hashDoDocumento,
  normalizarDocumento,
  projetarEvento,
  projetarOperacao,
  resumoDaImportacao,
  sugerirEmbarcador,
  validarDocumento,
} from "../../src/features/logistics/track3rDomain.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const texto = (valor, max = 500) => String(valor ?? "").trim().slice(0, max);
const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const parse = (valor, alternativa) => {
  try {
    return JSON.parse(valor || "");
  } catch {
    return alternativa;
  }
};
const objeto = (valor) => (valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {});
const lista = (valor) => (Array.isArray(valor) ? valor : []);

// Teto por chamada, para o lote não estourar o limite de subrequests do Worker.
// O mesmo desenho do import de clientes e do extrato bancário.
const MAX_LINHAS = 300;

const integracaoDaLinha = (row, env) => ({
  id: row.id,
  provider: row.provider,
  name: row.name,
  baseUrl: row.base_url,
  tokenEnvKey: row.token_env_key,
  webhookSecretEnvKey: row.webhook_secret_env_key,
  authHeaderName: row.auth_header_name,
  syncMode: row.sync_mode,
  collectionsPath: row.collections_path,
  invoicesPath: row.invoices_path,
  fieldMap: parse(row.field_map_json, {}),
  pollingIntervalMinutes: row.polling_interval_minutes,
  status: row.status,
  lastSyncAt: row.last_sync_at || "",
  lastError: row.last_error,
  revision: row.revision,
  // Nunca o segredo — só se ele existe. É o que a tela precisa para dizer o que
  // falta sem expor nada.
  segredos: {
    apiToken: Boolean(env?.[row.token_env_key]),
    webhookSecret: Boolean(env?.[row.webhook_secret_env_key]),
  },
});

const documentoDaLinha = (row) => ({
  id: row.id,
  integrationId: row.integration_id,
  origem: row.origem,
  externalId: row.external_id,
  kind: row.kind,
  shipperName: row.shipper_name,
  shipperGroup: row.shipper_group,
  shipperDocument: row.shipper_document,
  clientId: row.client_id,
  originUnit: row.origin_unit,
  currentUnit: row.current_unit,
  service: row.service,
  product: row.product,
  status: row.status,
  occurrence: row.occurrence,
  invoiceNumber: row.invoice_number,
  invoiceKey: row.invoice_key,
  vehiclePlate: row.vehicle_plate,
  vehicleClass: row.vehicle_class,
  driverName: row.driver_name,
  packages: row.packages,
  weightKg: row.weight_kg,
  distanceKm: row.distance_km,
  promisedAt: row.promised_at || "",
  occurredAt: row.occurred_at || "",
  payload: parse(row.payload_json, {}),
  importHash: row.import_hash,
  operationId: row.operation_id,
  projectedAt: row.projected_at || "",
  revision: row.revision,
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
});

// Qual modo está de fato disponível. Sem segredo, API e webhook não ligam — e
// dizer isso em voz alta é melhor que falhar na hora de sincronizar.
const modoDisponivel = (integracao, env) => ({
  arquivo: true,
  api: Boolean(integracao?.baseUrl && env?.[integracao?.tokenEnvKey]),
  webhook: Boolean(env?.[integracao?.webhookSecretEnvKey]),
});

const lerIntegracao = async (env, ownerId) => {
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_tms_integrations
      WHERE tenant_id = ? AND workspace_owner_id = ? AND provider = 'track3r' AND archived_at IS NULL`,
  ).bind(TENANT_ID, ownerId).first();
  return row || null;
};

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const verConfiguracao = async (env, access) => {
  const row = await lerIntegracao(env, access.ownerId);
  const integracao = row ? integracaoDaLinha(row, env) : null;
  return json({
    integracao,
    modos: modoDisponivel(integracao, env),
    // Enquanto o fornecedor não responder, é isto que a tela mostra como
    // próximo passo concreto.
    perguntasAoFornecedor: PERGUNTAS_AO_TRACK3R,
  });
};

const salvarConfiguracao = async (env, access, user, corpo) => {
  const atual = await lerIntegracao(env, access.ownerId);
  const agora = new Date().toISOString();
  const modo = ["arquivo", "api", "webhook"].includes(texto(corpo.syncMode))
    ? texto(corpo.syncMode)
    : "arquivo";

  // Não deixa marcar API ou webhook sem o que eles exigem. Salvar um modo que
  // não pode funcionar transformaria a tela num relatório de erro silencioso.
  if (modo === "api" && !texto(corpo.baseUrl))
    return json({ error: "O modo API precisa da URL base do TRACK3R." }, 400);
  if (modo === "api" && !env[texto(corpo.tokenEnvKey) || "TODOGREEN_TRACK3R_API_TOKEN"])
    return json({
      error: "O modo API precisa do token no cofre do Worker. Cadastre o segredo e tente de novo.",
      segredoFaltando: texto(corpo.tokenEnvKey) || "TODOGREEN_TRACK3R_API_TOKEN",
    }, 409);
  if (modo === "webhook" && !env[texto(corpo.webhookSecretEnvKey) || "TODOGREEN_TRACK3R_WEBHOOK_SECRET"])
    return json({
      error: "O modo webhook precisa do segredo no cofre do Worker.",
      segredoFaltando: texto(corpo.webhookSecretEnvKey) || "TODOGREEN_TRACK3R_WEBHOOK_SECRET",
    }, 409);

  const campos = [
    texto(corpo.name, 120) || "TRACK3R",
    texto(corpo.baseUrl, 400),
    texto(corpo.tokenEnvKey, 120) || "TODOGREEN_TRACK3R_API_TOKEN",
    texto(corpo.webhookSecretEnvKey, 120) || "TODOGREEN_TRACK3R_WEBHOOK_SECRET",
    texto(corpo.authHeaderName, 60) || "authorization",
    modo,
    texto(corpo.collectionsPath, 200),
    texto(corpo.invoicesPath, 200),
    JSON.stringify(objeto(corpo.fieldMap)),
    Math.min(1440, Math.max(60, Math.trunc(numero(corpo.pollingIntervalMinutes) || 60))),
    // "pronta" quando há o que sincronizar; "rascunho" enquanto é só arquivo.
    modo === "arquivo" ? "pronta" : "pronta",
  ];

  if (!atual) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO todogreen_tms_integrations
         (id, tenant_id, workspace_owner_id, provider, name, base_url, token_env_key,
          webhook_secret_env_key, auth_header_name, sync_mode, collections_path,
          invoices_path, field_map_json, polling_interval_minutes, status,
          last_error, fields_json, revision, created_by, updated_by, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, 'track3r', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '{}', 1, ?, ?, ?, ?, NULL)`,
    ).bind(id, TENANT_ID, access.ownerId, ...campos, user.id, user.id, agora, agora).run();
    return verConfiguracao(env, access);
  }

  const revisao = Number(corpo.revision);
  if (!Number.isFinite(revisao) || revisao <= 0)
    return json({ error: "Informe a revisão da configuração que você leu." }, 400);

  const meta = await env.DB.prepare(
    `UPDATE todogreen_tms_integrations
        SET name = ?, base_url = ?, token_env_key = ?, webhook_secret_env_key = ?,
            auth_header_name = ?, sync_mode = ?, collections_path = ?, invoices_path = ?,
            field_map_json = ?, polling_interval_minutes = ?, status = ?,
            revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND revision = ?`,
  ).bind(...campos, user.id, agora, atual.id, TENANT_ID, access.ownerId, revisao).run();

  if (!meta?.meta?.changes)
    return json({
      error: "Esta configuração mudou enquanto você editava. Recarregue para ver a versão atual.",
    }, 409);
  return verConfiguracao(env, access);
};

// ---------------------------------------------------------------------------
// Importação — o coração
// ---------------------------------------------------------------------------

// Grava um lote de linhas brutas. Vale para os três transportes: arquivo, API e
// webhook chamam esta mesma função, com `origem` diferente.
const importarLinhas = async (env, access, user, { linhas, origem, integracao }) => {
  const comeco = new Date().toISOString();
  const fieldMap = integracao ? parse(integracao.field_map_json, {}) : {};

  // Os clientes do espaço, uma vez, para casar por CNPJ sem uma consulta por
  // linha.
  const { results: clientes } = await env.DB.prepare(
    `SELECT id, name, legal_name AS legalName, document FROM todogreen_clients
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(TENANT_ID, access.ownerId).all();

  const erros = [];
  const paraGravar = [];

  for (const [indice, bruta] of linhas.entries()) {
    const doc = normalizarDocumento(bruta, fieldMap);
    const erro = validarDocumento(doc);
    if (erro) {
      // O motivo, com a linha. "12 ignorados" sem dizer por quê deixa a pessoa
      // sem ação possível.
      erros.push({ linha: indice + 1, motivo: erro });
      continue;
    }
    const casado = casarEmbarcador(doc, clientes || []);
    paraGravar.push({
      doc,
      hash: hashDoDocumento(doc),
      // Vazio é estado legítimo: o documento entra sem conta e fica na fila.
      clientId: casado?.clientId || "",
    });
  }

  const agora = new Date().toISOString();
  const gravacoes = paraGravar.map(({ doc, hash, clientId }) =>
    env.DB.prepare(
      `INSERT INTO todogreen_tms_documents
         (id, tenant_id, workspace_owner_id, integration_id, origem, external_id, kind,
          shipper_name, shipper_group, shipper_document, client_id, origin_unit, current_unit,
          service, product, status, occurrence, invoice_number, invoice_key,
          vehicle_plate, vehicle_class, driver_name, packages, weight_kg, distance_km,
          promised_at, occurred_at, payload_json, import_hash, operation_id,
          revision, created_by, updated_by, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 1, ?, ?, ?, ?, NULL)
       ON CONFLICT(workspace_owner_id, import_hash) DO UPDATE SET
         -- Só o que MUDA numa reimportação. O status é justamente o que muda, e
         -- é por isso que ele fica fora do hash.
         status = excluded.status,
         occurrence = excluded.occurrence,
         current_unit = excluded.current_unit,
         vehicle_plate = CASE WHEN excluded.vehicle_plate <> '' THEN excluded.vehicle_plate
                              ELSE todogreen_tms_documents.vehicle_plate END,
         vehicle_class = CASE WHEN excluded.vehicle_class <> '' THEN excluded.vehicle_class
                              ELSE todogreen_tms_documents.vehicle_class END,
         driver_name = CASE WHEN excluded.driver_name <> '' THEN excluded.driver_name
                            ELSE todogreen_tms_documents.driver_name END,
         occurred_at = excluded.occurred_at,
         promised_at = COALESCE(excluded.promised_at, todogreen_tms_documents.promised_at),
         payload_json = excluded.payload_json,
         -- O vínculo com a conta NÃO é sobrescrito quando já existe: alguém pode
         -- ter casado à mão, e a reimportação não pode desfazer isso.
         client_id = CASE WHEN todogreen_tms_documents.client_id <> ''
                          THEN todogreen_tms_documents.client_id ELSE excluded.client_id END,
         revision = todogreen_tms_documents.revision + 1,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, access.ownerId,
      integracao?.id || "", origem, doc.externalId, doc.kind || "coleta",
      doc.shipperName, doc.shipperGroup, doc.shipperDocument, clientId,
      doc.originUnit, doc.currentUnit, doc.service, doc.product, doc.status, doc.occurrence,
      doc.invoiceNumber, doc.invoiceKey, doc.vehiclePlate, doc.vehicleClass, doc.driverName,
      doc.packages, doc.weightKg, doc.distanceKm,
      doc.promisedAt || null, doc.occurredAt || null,
      JSON.stringify(doc.payload || {}), hash,
      user.id, user.id, agora, agora,
    ),
  );

  const resultado = gravacoes.length ? await env.DB.batch(gravacoes) : [];
  // `changes` conta 1 tanto no insert quanto no update do ON CONFLICT, então o
  // que distingue novo de atualizado é a revisão da linha resultante. Contar
  // pelo hash já presente antes seria outra consulta; aqui basta a diferença
  // entre recebidas e gravadas para a pessoa entender o que aconteceu.
  const gravados = resultado.reduce((soma, item) => soma + (item?.meta?.changes || 0), 0);

  const fim = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_tms_sync_runs
       (id, tenant_id, workspace_owner_id, integration_id, origem, status,
        recebidos, importados, repetidos, atualizados, ignorados, erros_json,
        started_at, finished_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), TENANT_ID, access.ownerId, integracao?.id || "", origem,
    erros.length ? (gravados ? "parcial" : "erro") : "ok",
    linhas.length, gravados, erros.length,
    JSON.stringify(erros.slice(0, 50)), comeco, fim, user.id, fim,
  ).run();

  return { recebidos: linhas.length, gravados, ignorados: erros.length, erros: erros.slice(0, 50) };
};

const importarArquivo = async (env, access, user, corpo) => {
  const linhas = lista(corpo.linhas);
  if (!linhas.length) return json({ error: "Nenhuma linha para importar." }, 400);
  if (linhas.length > MAX_LINHAS)
    return json({ error: `Importe no máximo ${MAX_LINHAS} linhas por vez.` }, 400);

  const integracao = await lerIntegracao(env, access.ownerId);
  const resultado = await importarLinhas(env, access, user, {
    linhas, origem: "arquivo", integracao,
  });
  return json(resultado, resultado.gravados ? 201 : 200);
};

// Puxa da API do TRACK3R. Recusa com clareza quando falta o que ligar, em vez de
// tentar e devolver um erro de rede que ninguém entende.
const sincronizarApi = async (env, access, user, corpo) => {
  const row = await lerIntegracao(env, access.ownerId);
  if (!row) return json({ error: "Configure a integração antes de sincronizar." }, 409);
  const integracao = integracaoDaLinha(row, env);
  const modos = modoDisponivel(integracao, env);
  if (!modos.api)
    return json({
      error: "A API do TRACK3R ainda não está ligada: falta a URL base ou o token no cofre.",
      falta: {
        baseUrl: !integracao.baseUrl,
        segredo: !env[integracao.tokenEnvKey] ? integracao.tokenEnvKey : null,
      },
      perguntasAoFornecedor: PERGUNTAS_AO_TRACK3R,
    }, 409);

  const caminho = texto(corpo.caminho, 200) || integracao.collectionsPath;
  if (!caminho) return json({ error: "Informe o caminho da consulta na API." }, 400);

  let payload;
  try {
    const resposta = await fetch(new URL(caminho, integracao.baseUrl).href, {
      headers: {
        [integracao.authHeaderName]: String(env[integracao.tokenEnvKey]),
        accept: "application/json",
      },
    });
    if (!resposta.ok) throw new Error(`O TRACK3R respondeu ${resposta.status}.`);
    payload = await resposta.json();
  } catch (erro) {
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE todogreen_tms_integrations SET status = 'erro', last_error = ?, updated_at = ?
        WHERE id = ? AND workspace_owner_id = ?`,
    ).bind(texto(erro.message, 500), agora, row.id, access.ownerId).run();
    // Falha visível, nunca silenciosa: um painel que mostra o número de ontem
    // como se fosse de hoje é pior que um painel que admite não saber.
    return json({ error: `Não foi possível falar com o TRACK3R: ${erro.message}` }, 502);
  }

  // A resposta pode vir como array direto ou embrulhada. Aceitar as duas formas
  // evita depender de um formato que ainda não conhecemos.
  const linhas = Array.isArray(payload)
    ? payload
    : lista(payload?.data || payload?.items || payload?.registros || payload?.result);
  if (!linhas.length) return json({ error: "A resposta do TRACK3R não trouxe linhas reconhecíveis." }, 422);

  const resultado = await importarLinhas(env, access, user, {
    linhas: linhas.slice(0, MAX_LINHAS), origem: "api", integracao: row,
  });
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_tms_integrations SET status = 'ativa', last_error = '', last_sync_at = ?, updated_at = ?
      WHERE id = ? AND workspace_owner_id = ?`,
  ).bind(agora, agora, row.id, access.ownerId).run();
  return json(resultado, 201);
};

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const listarDocumentos = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const semConta = url.searchParams.get("semConta") === "1";
  const semClasse = url.searchParams.get("semClasse") === "1";
  const kind = texto(url.searchParams.get("tipo"), 40);
  const grupo = texto(url.searchParams.get("grupo"), 240);
  const classe = texto(url.searchParams.get("classe"), 40);

  const filtros = [
    semConta ? "AND client_id = ''" : "",
    semClasse ? "AND vehicle_class = ''" : "",
    kind ? "AND kind = ?" : "",
    grupo ? "AND shipper_group = ?" : "",
    classe ? "AND vehicle_class = ?" : "",
  ].join(" ");
  const params = [
    TENANT_ID, access.ownerId,
    ...(kind ? [kind] : []),
    ...(grupo ? [grupo] : []),
    ...(classe ? [classe] : []),
  ];
  const base = `FROM todogreen_tms_documents
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL ${filtros}`;

  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(`SELECT * ${base} ORDER BY occurred_at DESC, created_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);

  const registros = (results || []).map(documentoDaLinha);
  return json({
    registros,
    // O retrato do que falta casar. Sem ele a integração parece completa
    // enquanto metade dos documentos não chegou a lugar nenhum.
    resumo: resumoDaImportacao(registros),
    total: totalRow?.total || 0,
    limit,
    offset,
  });
};

// A frota vista pelo TMS, por classe. É a resposta a "de moto a carreta, quanto
// cada classe rodou?" — que o campo de texto livre nunca conseguiu dar.
const listarPorClasse = async (env, access, url) => {
  const mes = texto(url.searchParams.get("mes"), 7);
  const filtro = mes ? "AND substr(COALESCE(occurred_at, ''), 1, 7) = ?" : "";
  const params = [TENANT_ID, access.ownerId, ...(mes ? [mes] : [])];
  const { results } = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(vehicle_class, ''), '(sem classe)') AS classe,
            COUNT(*) AS documentos,
            SUM(packages) AS volumes,
            SUM(distance_km) AS km,
            SUM(weight_kg) AS pesoKg,
            COUNT(DISTINCT NULLIF(vehicle_plate, '')) AS veiculos
       FROM todogreen_tms_documents
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL ${filtro}
      GROUP BY classe
      ORDER BY documentos DESC`,
  ).bind(...params).all();
  return json({ mes, linhas: results || [] });
};

const verSugestoes = async (env, access, url) => {
  const id = texto(url.searchParams.get("documento"), 120);
  if (!id) return json({ error: "Informe o documento." }, 400);
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_tms_documents
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(id, TENANT_ID, access.ownerId).first();
  if (!row) return json({ error: "Documento não encontrado." }, 404);

  const { results: clientes } = await env.DB.prepare(
    `SELECT id, name, legal_name AS legalName, document FROM todogreen_clients
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(TENANT_ID, access.ownerId).all();

  return json({
    documento: documentoDaLinha(row),
    // Sugestões para uma PESSOA escolher — nunca aplicadas sozinhas.
    candidatos: sugerirEmbarcador(documentoDaLinha(row), clientes || []),
  });
};

const listarExecucoes = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_tms_sync_runs
      WHERE tenant_id = ? AND workspace_owner_id = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).bind(TENANT_ID, access.ownerId, limit, offset).all();
  return json({
    registros: (results || []).map((row) => ({
      id: row.id,
      origem: row.origem,
      status: row.status,
      recebidos: row.recebidos,
      importados: row.importados,
      ignorados: row.ignorados,
      erros: parse(row.erros_json, []),
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    })),
  });
};

// ---------------------------------------------------------------------------
// Vínculos — sempre explícitos
// ---------------------------------------------------------------------------

const vincularEmbarcador = async (env, access, user, corpo) => {
  const id = texto(corpo.documentoId, 120);
  const clientId = texto(corpo.clientId, 120);
  if (!id || !clientId) return json({ error: "Informe o documento e a conta." }, 400);

  const cliente = await env.DB.prepare(
    `SELECT id FROM todogreen_clients
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(clientId, TENANT_ID, access.ownerId).first();
  if (!cliente) return json({ error: "Conta não encontrada neste espaço." }, 404);

  const agora = new Date().toISOString();
  const { meta } = await env.DB.prepare(
    `UPDATE todogreen_tms_documents
        SET client_id = ?, revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(clientId, user.id, agora, id, TENANT_ID, access.ownerId).run();
  if (!meta?.changes) return json({ error: "Documento não encontrado." }, 404);

  // Vincular por grupo, quando pedido: é o que resolve "AMAZON DBA" e
  // "AMAZON RETAIL" de uma vez, em vez de um a um.
  let porGrupo = 0;
  if (corpo.aplicarAoGrupo === true) {
    const doc = await env.DB.prepare(
      "SELECT shipper_group FROM todogreen_tms_documents WHERE id = ?",
    ).bind(id).first();
    const grupo = texto(doc?.shipper_group, 240);
    if (grupo) {
      const resultado = await env.DB.prepare(
        `UPDATE todogreen_tms_documents
            SET client_id = ?, revision = revision + 1, updated_by = ?, updated_at = ?
          WHERE tenant_id = ? AND workspace_owner_id = ? AND shipper_group = ?
            AND client_id = '' AND archived_at IS NULL`,
      ).bind(clientId, user.id, agora, TENANT_ID, access.ownerId, grupo).run();
      porGrupo = resultado?.meta?.changes || 0;
    }
  }
  return json({ ok: true, vinculadosPorGrupo: porGrupo });
};

const definirClasse = async (env, access, user, corpo) => {
  const id = texto(corpo.documentoId, 120);
  const classe = texto(corpo.vehicleClass, 40);
  if (!id || !classe) return json({ error: "Informe o documento e a classe do veículo." }, 400);
  const { isVehicleClass } = await import("../../src/features/logistics/vehicleClassDomain.js");
  if (!isVehicleClass(classe))
    return json({ error: "Classe de veículo desconhecida (de moto a carreta)." }, 400);

  const agora = new Date().toISOString();
  const { meta } = await env.DB.prepare(
    `UPDATE todogreen_tms_documents
        SET vehicle_class = ?, revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(classe.toLowerCase(), user.id, agora, id, TENANT_ID, access.ownerId).run();
  return meta?.changes ? json({ ok: true }) : json({ error: "Documento não encontrado." }, 404);
};

// Projeta o documento na operação da vertical. Explícito de propósito: importar
// não projeta sozinho, porque projetar cria registro operacional e isso é
// decisão de quem confere.
const projetar = async (env, access, user, corpo) => {
  const ids = lista(corpo.documentoIds).map((valor) => texto(valor, 120)).filter(Boolean);
  if (!ids.length) return json({ error: "Informe os documentos a projetar." }, 400);
  if (ids.length > 100) return json({ error: "Projete no máximo 100 documentos por vez." }, 400);

  const marcas = ids.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_tms_documents
      WHERE id IN (${marcas}) AND tenant_id = ? AND workspace_owner_id = ?
        AND archived_at IS NULL AND operation_id = ''`,
  ).bind(...ids, TENANT_ID, access.ownerId).all();

  const agora = new Date().toISOString();
  const gravacoes = [];
  const pulados = [];

  for (const row of results || []) {
    const doc = documentoDaLinha(row);
    const operacao = projetarOperacao(doc);
    if (!operacao) {
      // Sem cliente ou sem data. Fica na fila, visível — melhor que uma
      // operação órfã que nenhum relatório encontra.
      pulados.push({
        documentoId: doc.id,
        motivo: !doc.clientId ? "sem conta casada" : "sem data reconhecível",
      });
      continue;
    }
    const operacaoId = crypto.randomUUID();
    gravacoes.push(
      // As colunas são as REAIS de `todogreen_client_operations` (0033 + 0045).
      // Volume, peso e ocupação não têm coluna nessa tabela — a 0047 os
      // consolidou em `fields_json`.
      env.DB.prepare(
        `INSERT INTO todogreen_client_operations
           (id, tenant_id, workspace_owner_id, client_id, product_id, contract_id,
            reference, status, service_date, origin, destination, fields_json,
            sla_status, incident_count, promised_at, delivered_at, eta_at,
            vehicle_plate, driver_name, distance_km,
            revision, created_by, updated_by, created_at, updated_at, archived_at)
         VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, '', ?, ?, ?, NULL, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
      ).bind(
        operacaoId, TENANT_ID, access.ownerId, operacao.clientId,
        operacao.referencia, operacao.status, operacao.serviceDate,
        operacao.origem, operacao.destino, JSON.stringify(operacao.campos),
        operacao.incidentes, operacao.promisedAt, operacao.deliveredAt,
        operacao.vehiclePlate, operacao.driverName, operacao.distanceKm,
        user.id, user.id, agora, agora,
      ),
    );

    const evento = projetarEvento(doc);
    if (evento) {
      gravacoes.push(
        // `client_id` é NOT NULL nesta tabela (0045) e não tem default: o evento
        // é consultado por cliente direto, sem passar pela operação.
        env.DB.prepare(
          `INSERT INTO todogreen_client_operation_events
             (id, tenant_id, operation_id, client_id, workspace_owner_id, kind, titulo,
              descricao, local, ocorrido_em, registrado_por, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), TENANT_ID, operacaoId, operacao.clientId, access.ownerId,
          evento.kind, evento.titulo, evento.descricao, evento.local,
          // `ocorrido_em` é NOT NULL: sem hora no documento, usa a data do
          // serviço em vez de gravar vazio.
          evento.ocorridoEm || operacao.serviceDate, user.id, agora,
        ),
      );
    }

    gravacoes.push(
      env.DB.prepare(
        `UPDATE todogreen_tms_documents
            SET operation_id = ?, projected_at = ?, revision = revision + 1,
                updated_by = ?, updated_at = ?
          WHERE id = ? AND workspace_owner_id = ?`,
      ).bind(operacaoId, agora, user.id, agora, doc.id, access.ownerId),
    );
  }

  if (gravacoes.length) await env.DB.batch(gravacoes);
  return json({
    projetados: (results || []).length - pulados.length,
    // Os pulados COM O MOTIVO. Dizer "8 de 10" sem dizer o que houve com os
    // outros 2 deixa a pessoa sem ação.
    pulados,
  });
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

export async function handleTodoGreenTms(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  const url = new URL(request.url);
  // api, todogreen, tms, [recurso], [acao]
  const partes = url.pathname.split("/").filter(Boolean);
  const recurso = texto(partes[3], 40);
  const acao = texto(partes[4], 40);

  if (request.method === "GET") {
    if (recurso === "configuracao" || !recurso) return verConfiguracao(env, access);
    if (recurso === "documentos") return listarDocumentos(env, access, url);
    if (recurso === "classes") return listarPorClasse(env, access, url);
    if (recurso === "sugestoes") return verSugestoes(env, access, url);
    if (recurso === "execucoes") return listarExecucoes(env, access, url);
    return json({ error: "Recurso desconhecido." }, 404);
  }

  if (!podeNaVertical(access, "tms:manage"))
    return json({ error: "Seu papel não pode operar a integração com o TMS." }, 403);

  const corpo = await request.json().catch(() => ({}));

  if (request.method === "POST") {
    if (recurso === "configuracao") return salvarConfiguracao(env, access, user, corpo);
    if (recurso === "importacoes") return importarArquivo(env, access, user, corpo);
    if (recurso === "sincronizacoes") return sincronizarApi(env, access, user, corpo);
    if (recurso === "vinculos") {
      if (acao === "classe") return definirClasse(env, access, user, corpo);
      return vincularEmbarcador(env, access, user, corpo);
    }
    if (recurso === "projecoes") return projetar(env, access, user, corpo);
    return json({ error: "Recurso desconhecido." }, 404);
  }

  // O documento do TMS não é editado: ele é o que o TRACK3R informou. O que se
  // ajusta é o VÍNCULO — conta e classe do veículo — por endpoint próprio.
  if (["PATCH", "PUT", "DELETE"].includes(request.method) && recurso === "documentos")
    return json({
      error: "Documento do TMS não é editado — ele é o que o TRACK3R informou. Ajuste o vínculo.",
    }, 405);

  return json({ error: "Método não permitido." }, 405);
}
