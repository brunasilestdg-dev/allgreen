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
import { autenticarTokenWebhookTrack3r, estadoTokensWebhookTrack3r, TRACK3R_WEBHOOK_TOKEN_KEYS } from "./todogreen-track3r-webhook-auth.js";
import { allowed as limitarTaxa, edgeIp } from "../lib/http.js";
import { safeExternalUrl, isTrack3rEnvKey, isSafeHeaderName } from "../lib/net.js";
import { aplicarEventoNaOperacaoPorId } from "./todogreen-vertical-records.js";
import {
  PERGUNTAS_AO_TRACK3R,
  casarEmbarcador,
  hashDaOcorrencia,
  hashDoDocumento,
  normalizarDocumento,
  normalizarOcorrenciaDoWebhook,
  projetarEvento,
  projetarOperacao,
  resumoDaImportacao,
  sugerirEmbarcador,
  validarDocumento,
} from "../../src/features/logistics/track3rDomain.js";
import { normalizarTipoEvento } from "../../src/features/logistics/operationTrackingDomain.js";
import { montarKitWebhookTrack3r } from "../../src/features/logistics/track3rWebhookDomain.js";

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
    webhookSecret: estadoTokensWebhookTrack3r(env, row).disponivel,
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
  webhook: Boolean(integracao) && estadoTokensWebhookTrack3r(env, {
    webhook_secret_env_key: integracao.webhookSecretEnvKey,
  }).disponivel,
});

// Estado honesto do motor de roteirização. O planejador elétrico nativo
// (planElectricRoute) roda sempre — é JavaScript, sem dependência externa. Já o
// OTIMIZADOR de rotas (VROOM) só existe quando TDG_ROUTING_URL aponta para um
// servidor auto-hospedado válido. A tela não pode dizer "roteirização
// operacional" quando o otimizador está desligado: código existente não é motor
// no ar. Este é o sinal mínimo; o health-check com versão e tempo de resposta
// entra na onda do motor próprio.
const estadoRoteirizacao = (env) => {
  const bruto = String(env?.TDG_ROUTING_URL || "").trim();
  let motorConfigurado = false;
  try {
    motorConfigurado = bruto ? ["https:", "http:"].includes(new URL(bruto).protocol) : false;
  } catch {
    motorConfigurado = false;
  }
  return {
    plannerNativo: true,
    motorConfigurado,
    engine: motorConfigurado ? "vroom" : "",
  };
};

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

const verConfiguracao = async (env, access, request) => {
  const row = await lerIntegracao(env, access.ownerId);
  const integracao = row ? integracaoDaLinha(row, env) : null;
  let origin = "";
  try { origin = request ? new URL(request.url).origin : ""; } catch { origin = ""; }
  return json({
    integracao,
    modos: modoDisponivel(integracao, env),
    webhookKit: integracao ? {
      ...montarKitWebhookTrack3r({ origin, integrationId: integracao.id }),
      tokensIndividuais: estadoTokensWebhookTrack3r(env, row).individual,
      endpoints: montarKitWebhookTrack3r({ origin, integrationId: integracao.id }).endpoints
        .map((endpoint) => ({
          ...endpoint,
          tokenEnvKey: TRACK3R_WEBHOOK_TOKEN_KEYS[endpoint.type],
          tokenConfigurado: Boolean(env?.[TRACK3R_WEBHOOK_TOKEN_KEYS[endpoint.type]]),
        })),
    } : null,
    // Estado real do otimizador de rotas, para a tela não fingir motor no ar.
    roteirizacao: estadoRoteirizacao(env),
    // Enquanto o fornecedor não responder, é isto que a tela mostra como
    // próximo passo concreto.
    perguntasAoFornecedor: PERGUNTAS_AO_TRACK3R,
  });
};

const salvarConfiguracao = async (env, access, user, corpo, request) => {
  const atual = await lerIntegracao(env, access.ownerId);
  const agora = new Date().toISOString();
  const modo = ["arquivo", "api", "webhook"].includes(texto(corpo.syncMode))
    ? texto(corpo.syncMode)
    : "arquivo";

  // As chaves de segredo que a config aponta são LIDAS do cofre na
  // sincronização e enviadas no cabeçalho da chamada externa. Se pudessem ser
  // qualquer nome, um usuário `tms:manage` apontaria para BREVO/GEMINI/SEFAZ/
  // SysPag/VAPID e receberia o valor do segredo. Por isso só aceitamos chaves do
  // próprio conector (prefixo TODOGREEN_TRACK3R_).
  const tokenEnvKey = texto(corpo.tokenEnvKey, 120) || "TODOGREEN_TRACK3R_API_TOKEN";
  const webhookSecretEnvKey = texto(corpo.webhookSecretEnvKey, 120) || "TODOGREEN_TRACK3R_WEBHOOK_SECRET";
  const authHeaderName = texto(corpo.authHeaderName, 60) || "authorization";
  if (!isTrack3rEnvKey(tokenEnvKey) || !isTrack3rEnvKey(webhookSecretEnvKey))
    return json({ error: "As chaves de segredo devem começar com TODOGREEN_TRACK3R_." }, 400);
  if (!isSafeHeaderName(authHeaderName))
    return json({ error: "Nome de cabeçalho de autenticação inválido." }, 400);

  // Não deixa marcar API ou webhook sem o que eles exigem. Salvar um modo que
  // não pode funcionar transformaria a tela num relatório de erro silencioso.
  if (modo === "api" && !texto(corpo.baseUrl))
    return json({ error: "O modo API precisa da URL base do TRACK3R." }, 400);
  // A URL base precisa ser HTTPS e pública — nada de apontar para a rede interna.
  if (modo === "api" && texto(corpo.baseUrl)) {
    try {
      safeExternalUrl(corpo.baseUrl, texto(corpo.collectionsPath) || "/");
    } catch (erro) {
      return json({ error: erro.message }, 400);
    }
  }
  if (modo === "api" && !env[tokenEnvKey])
    return json({
      error: "O modo API precisa do token no cofre do Worker. Cadastre o segredo e tente de novo.",
      segredoFaltando: tokenEnvKey,
    }, 409);
  if (modo === "webhook" && !estadoTokensWebhookTrack3r(env, {
    webhook_secret_env_key: webhookSecretEnvKey,
  }).disponivel)
    return json({
      error: "O modo webhook precisa do segredo no cofre do Worker.",
      segredoFaltando: webhookSecretEnvKey,
    }, 409);

  const campos = [
    texto(corpo.name, 120) || "TRACK3R",
    texto(corpo.baseUrl, 400),
    tokenEnvKey,
    webhookSecretEnvKey,
    authHeaderName,
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
    return verConfiguracao(env, access, request);
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
  return verConfiguracao(env, access, request);
};

// ---------------------------------------------------------------------------
// Importação — o coração
// ---------------------------------------------------------------------------

// Grava um lote de linhas brutas. Vale para os três transportes: arquivo, API e
// webhook chamam esta mesma função, com `origem` diferente.
const importarLinhas = async (env, access, user, {
  linhas,
  origem,
  integracao,
  // Arquivo e API usam o normalizador e o hash de documento; o webhook de
  // ocorrências troca os dois (corpo aninhado, e cada evento é uma linha
  // própria). Todo o resto — dedup, casamento por CNPJ, upsert que preserva o
  // vínculo feito à mão, contagem e motivos — continua sendo um caminho só.
  normalizar = normalizarDocumento,
  calcularHash = hashDoDocumento,
  registrarExecucao = true,
} = {}) => {
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
    const doc = normalizar(bruta, fieldMap);
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
      hash: calcularHash(doc),
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
          promised_at, occurred_at, payload_json, import_hash, order_ref, occurrence_code, operation_id,
          revision, created_by, updated_by, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 1, ?, ?, ?, ?, NULL)
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
      texto(doc.orderId, 120), texto(doc.occurrenceCode, 20),
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
  // O webhook chega uma ocorrência por vez: uma linha de execução por chamada
  // encheria a tabela de histórico com ruído. Ali só se registra quando algo
  // deu errado — que é o que alguém vai querer procurar depois.
  if (registrarExecucao || erros.length) await env.DB.prepare(
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

  // Defesa em profundidade: mesmo que uma config antiga guarde uma chave fora do
  // padrão, nunca lemos do cofre um segredo que não seja do conector TRACK3R.
  if (!isTrack3rEnvKey(integracao.tokenEnvKey))
    return json({ error: "A chave de token da integração é inválida. Reconfigure a integração." }, 400);

  // `safeExternalUrl` exige HTTPS, host público, caminho relativo e MESMA origem
  // da base — um caminho absoluto não redireciona o fetch para outro host.
  let alvo;
  try {
    alvo = safeExternalUrl(integracao.baseUrl, caminho);
  } catch (erro) {
    return json({ error: erro.message }, 400);
  }

  let payload;
  try {
    const resposta = await fetch(alvo.href, {
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

  const [{ results }, totalRow, summaryRow] = await Promise.all([
    env.DB.prepare(`SELECT * ${base} ORDER BY occurred_at DESC, created_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
    // Totais globais da torre. Não usar a página de 100 documentos como se
    // fosse a operação inteira.
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN COALESCE(client_id,'') = '' OR COALESCE(operation_id,'') = '' THEN 1 ELSE 0 END) AS sem_vinculo,
         SUM(CASE WHEN lower(COALESCE(status,'')) NOT IN ('completed','concluida','delivered','entregue','cancelled','canceled','cancelado') THEN 1 ELSE 0 END) AS abertas
       FROM todogreen_tms_documents
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(TENANT_ID, access.ownerId).first(),
  ]);

  const registros = (results || []).map(documentoDaLinha);
  return json({
    registros,
    // O retrato do que falta casar. Sem ele a integração parece completa
    // enquanto metade dos documentos não chegou a lugar nenhum.
    resumo: {
      ...resumoDaImportacao(registros),
      total: Number(totalRow?.total || 0),
      semVinculo: Number(summaryRow?.sem_vinculo || 0),
      abertas: Number(summaryRow?.abertas || 0),
    },
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

// Cadastros de referência que a TRACK3R envia por webhook (embarcador, tomador,
// unidade). Antes esses dados entravam no banco (todogreen_track3r_entities) mas
// nenhuma tela os lia — ficavam só para enriquecer o nome nas outras projeções.
// Esta leitura os expõe no Portal TMS. Somente leitura, escopada por espaço.
const TIPOS_CADASTRO = { embarcador: "embarcador", tomador: "tomador", unidade: "unidade" };
const listarCadastros = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  // Aceita singular e plural (o menu usa "embarcadores"; o webhook, "embarcador").
  const pedido = texto(url.searchParams.get("tipo"), 20).toLowerCase().replace(/(es|s)$/, "");
  const tipo = TIPOS_CADASTRO[pedido] || "";
  const filtro = tipo ? "AND entity_type = ?" : "";
  const params = [TENANT_ID, access.ownerId, ...(tipo ? [tipo] : [])];
  const base = `FROM todogreen_track3r_entities
      WHERE tenant_id = ? AND workspace_owner_id = ? ${filtro}`;

  const [{ results }, totalRow, resumoRows] = await Promise.all([
    env.DB.prepare(
      `SELECT entity_type, external_code, name, trade_name, document, first_seen_at, last_seen_at
         ${base} ORDER BY last_seen_at DESC, name ASC LIMIT ? OFFSET ?`,
    ).bind(...params, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
    // Contadores por tipo são globais (não da página atual), para os cartões do
    // topo refletirem tudo que já entrou, não só os 100 mais recentes.
    env.DB.prepare(
      `SELECT entity_type, COUNT(*) AS total
         FROM todogreen_track3r_entities
        WHERE tenant_id = ? AND workspace_owner_id = ?
        GROUP BY entity_type`,
    ).bind(TENANT_ID, access.ownerId).all(),
  ]);

  const porTipo = { embarcador: 0, tomador: 0, unidade: 0 };
  for (const row of resumoRows?.results || []) {
    const t = row?.entity_type;
    if (t && Object.prototype.hasOwnProperty.call(porTipo, t)) porTipo[t] = Number(row.total || 0);
  }

  return json({
    registros: (results || []).map((row) => ({
      tipo: row.entity_type,
      codigo: row.external_code,
      nome: row.name || "",
      nomeFantasia: row.trade_name || "",
      documento: row.document || "",
      primeiroEnvio: row.first_seen_at || "",
      ultimoEnvio: row.last_seen_at || "",
    })),
    resumo: {
      embarcadores: porTipo.embarcador,
      tomadores: porTipo.tomador,
      unidades: porTipo.unidade,
      total: porTipo.embarcador + porTipo.tomador + porTipo.unidade,
    },
    total: Number(totalRow?.total || 0),
    limit,
    offset,
  });
};

// Valores por encomenda que a TRACK3R envia (webhook valores-encomendas):
// valor da mercadoria, frete, taxas e impostos por encomenda. Antes entravam
// no banco (todogreen_track3r_order_values) sem tela; esta leitura os expõe no
// Portal TMS. Somente leitura, escopada por espaço.
const listarValores = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const base = `FROM todogreen_track3r_order_values
      WHERE tenant_id = ? AND workspace_owner_id = ?`;
  const params = [TENANT_ID, access.ownerId];

  const [{ results }, resumoRow] = await Promise.all([
    env.DB.prepare(
      `SELECT external_order_code, product_code, product_description, merchandise_value,
              weight_kg, freight, total_freight, icms, iss, tax_rate, cfop,
              ad_valorem, gris, dispatch_fee, toll_fee, river_fee, difficult_access_fee,
              unloading_fee, ctrc_fee, extra_pickup_fee, extra_delivery_fee, trt_fee,
              emex_fee, tde_fee, last_seen_at
         ${base} ORDER BY last_seen_at DESC, external_order_code ASC LIMIT ? OFFSET ?`,
    ).bind(...params, limit, offset).all(),
    // Totais globais (não da página): o topo da tela soma tudo que entrou.
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(total_freight), 0) AS frete_total,
              COALESCE(SUM(merchandise_value), 0) AS mercadoria,
              COALESCE(SUM(icms), 0) AS icms
         ${base}`,
    ).bind(...params).first(),
  ]);

  return json({
    registros: (results || []).map((row) => ({
      codigo: row.external_order_code,
      produtoCodigo: row.product_code || "",
      produto: row.product_description || "",
      valorMercadoria: Number(row.merchandise_value || 0),
      pesoKg: Number(row.weight_kg || 0),
      frete: Number(row.freight || 0),
      freteTotal: Number(row.total_freight || 0),
      icms: Number(row.icms || 0),
      iss: Number(row.iss || 0),
      aliquota: Number(row.tax_rate || 0),
      cfop: row.cfop || "",
      ultimoEnvio: row.last_seen_at || "",
      taxas: {
        adValorem: Number(row.ad_valorem || 0),
        gris: Number(row.gris || 0),
        despacho: Number(row.dispatch_fee || 0),
        pedagio: Number(row.toll_fee || 0),
        fluvial: Number(row.river_fee || 0),
        dificuldadeAcesso: Number(row.difficult_access_fee || 0),
        descarga: Number(row.unloading_fee || 0),
        ctrc: Number(row.ctrc_fee || 0),
        extraColeta: Number(row.extra_pickup_fee || 0),
        extraEntrega: Number(row.extra_delivery_fee || 0),
        trt: Number(row.trt_fee || 0),
        emex: Number(row.emex_fee || 0),
        tde: Number(row.tde_fee || 0),
      },
    })),
    resumo: {
      total: Number(resumoRow?.total || 0),
      freteTotal: Number(resumoRow?.frete_total || 0),
      valorMercadoria: Number(resumoRow?.mercadoria || 0),
      icms: Number(resumoRow?.icms || 0),
    },
    total: Number(resumoRow?.total || 0),
    limit,
    offset,
  });
};

// Tentativas de webhook RECUSADas (401/503), para diagnosticar se um evento
// "não chega" porque não é enviado ou porque é enviado e recusado. Somente
// leitura. Nunca expõe token (a tabela não guarda o valor).
const listarRecusas = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const { results } = await env.DB.prepare(
    `SELECT integration_id, event_type, http_status, reason, token_present, ip,
            attempt_count, first_seen_at, last_seen_at
       FROM todogreen_tms_webhook_rejections
      WHERE tenant_id = ?
      ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`,
  ).bind(TENANT_ID, limit, offset).all();
  return json({
    registros: (results || []).map((row) => ({
      integracaoId: row.integration_id,
      tipo: row.event_type,
      status: Number(row.http_status || 0),
      motivo: row.reason,
      tokenEnviado: Boolean(row.token_present),
      ip: row.ip,
      tentativas: Number(row.attempt_count || 0),
      primeiraEm: row.first_seen_at,
      ultimaEm: row.last_seen_at,
    })),
  });
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
            vehicle_plate, driver_name, distance_km, proof_url, signature_url,
            revision, created_by, updated_by, created_at, updated_at, archived_at)
         VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, '', ?, ?, ?, NULL, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
      ).bind(
        operacaoId, TENANT_ID, access.ownerId, operacao.clientId,
        operacao.referencia, operacao.status, operacao.serviceDate,
        operacao.origem, operacao.destino, JSON.stringify(operacao.campos),
        operacao.incidentes, operacao.promisedAt, operacao.deliveredAt,
        operacao.vehiclePlate, operacao.driverName, operacao.distanceKm,
        // Comprovante e assinatura que a projeção agora extrai do payload do
        // webhook — antes essas colunas ficavam vazias e o POD nunca acendia.
        operacao.proofUrl || "", operacao.signatureUrl || "",
        user.id, user.id, agora, agora,
      ),
    );

    const evento = projetarEvento(doc);
    if (evento) {
      gravacoes.push(
        // `client_id` é NOT NULL nesta tabela (0045) e não tem default: o evento
        // é consultado por cliente direto, sem passar pela operação.
        env.DB.prepare(
          // Mesmo contrato de evento do app do motorista: `kind` normalizado pelo
          // vocabulário canônico e `idempotency_key` estável por documento, para o
          // evento projetado ter a mesma identidade e nunca duplicar num reprocesso.
          // A distância do documento (N.2) vai como medição do evento com origem
          // 'documentado' — o MESMO número que a operação projetada carrega (não há
          // reflect aqui, então não dobra); dá rastro de proveniência ao fato.
          `INSERT INTO todogreen_client_operation_events
             (id, tenant_id, operation_id, client_id, workspace_owner_id, kind, titulo,
              descricao, local, ocorrido_em, registrado_por, created_at, idempotency_key,
              distance_km, distance_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), TENANT_ID, operacaoId, operacao.clientId, access.ownerId,
          normalizarTipoEvento(evento.kind), evento.titulo, evento.descricao, evento.local,
          // `ocorrido_em` é NOT NULL: sem hora no documento, usa a data do
          // serviço em vez de gravar vazio.
          evento.ocorridoEm || operacao.serviceDate, user.id, agora, `tms:${doc.id}`,
          Number(operacao.distanceKm) > 0 ? Number(operacao.distanceKm) : null,
          Number(operacao.distanceKm) > 0 ? "documentado" : null,
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

// ===========================================================================
// Receptor de ocorrências do TRACK3R (webhook de entrada)
// ===========================================================================
//
// Especificação entregue pela titular (WebHook Envio de Ocorrências/Tracking):
// NÓS expomos a API e informamos a URL ao fornecedor; ele chama com header
// `Token`, POST, JSON, uma ocorrência por chamada. As respostas são as DELE —
// 200 {status:true,...} e 401 {status:false,...} —, por isso este é o único
// lugar da vertical que não responde no formato {error}.
//
// É rota pública de propósito: o TRACK3R não tem sessão nem papel. Quem
// autoriza é o token conferido contra o COFRE do Worker (o banco guarda apenas
// o NOME da variável), e quem diz de qual espaço é a chamada é o id da
// integração na URL — nunca um CNPJ do corpo, que identifica CLIENTE e não
// espaço.
const MAX_CORPO_DO_WEBHOOK = 1_000_000;

const respostaDoFornecedor = (ok, descricao, status) =>
  new Response(JSON.stringify({ status: ok, descricao }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// Token ausente, token errado e integração inexistente respondem IGUAL: se o id
// desconhecido tivesse resposta própria, a URL viraria um oráculo de quais
// integrações existem.
const TOKEN_INVALIDO = () => respostaDoFornecedor(false, "O Token informado é inválido!", 401);

const integracaoDoWebhook = async (env, integracaoId) => {
  if (!integracaoId) return null;
  return env.DB.prepare(
    `SELECT * FROM todogreen_tms_integrations
      WHERE id = ? AND tenant_id = ? AND provider = 'track3r' AND archived_at IS NULL`,
  ).bind(integracaoId, TENANT_ID).first();
};

// A remessa que a ocorrência descreve, achada pelo documento do TMS que já foi
// projetado em operação — a encomenda primeiro, depois a chave da nota. A
// tabela de operações não tem identificador externo, e inventar um vínculo por
// aproximação seria pior do que não achar.
const operacaoDaRemessa = async (env, ownerId, doc) => {
  const encomenda = texto(doc.orderId, 120);
  const chave = texto(doc.invoiceKey, 60);
  const nota = texto(doc.invoiceNumber, 60);
  if (!encomenda && !chave && !nota) return "";
  const linha = await env.DB.prepare(
    `SELECT operation_id FROM todogreen_tms_documents
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
        AND operation_id <> ''
        AND ((? <> '' AND order_ref = ?) OR (? <> '' AND invoice_key = ?) OR (? <> '' AND invoice_number = ?))
      ORDER BY created_at LIMIT 1`,
  ).bind(TENANT_ID, ownerId, encomenda, encomenda, chave, chave, nota, nota).first();
  return texto(linha?.operation_id, 120);
};

// A ocorrência vira EVENTO de uma operação que já existe. Criar operação
// continua sendo ato explícito de alguém (POST /projecoes) — um fornecedor não
// abre operação no nosso ERP.
const aplicarOcorrenciaNaOperacao = async (env, { ownerId, userId, doc }) => {
  const tipo = texto(doc.eventoPreferido, 40);
  if (!tipo) return { aplicado: false, motivo: "ocorrência sem evento reconhecível" };
  const operationId = await operacaoDaRemessa(env, ownerId, doc);
  if (!operationId) return { aplicado: false, motivo: "remessa ainda sem operação projetada" };

  // Converge para a ponte canônica (N.4): a operação é carregada lá, e o evento
  // ganha a MESMA chave de idempotência de ledger que as outras portas — a
  // identidade estável da ocorrência (hashDaOcorrencia) que o staging já usa.
  // Antes o evento do webhook entrava sem chave: reenviar a mesma ocorrência
  // gravava um segundo evento na linha do tempo.
  return aplicarEventoNaOperacaoPorId(env, {
    ownerId,
    userId,
    operationId,
    origem: "track3r-webhook",
    corpo: {
      tipo,
      titulo: texto(doc.status, 200) || "Ocorrência do TRACK3R",
      descricao: texto(doc.occurrence, 3000),
      local: texto(doc.currentUnit, 200) || texto(doc.originUnit, 200),
      ocorridoEm: texto(doc.occurredAt, 40),
      // Só a entrega carrega comprovante e recebedor — é o que destrava o POD.
      comprovanteUrl: texto(doc.proofUrl, 800),
      recebedor: texto(doc.receiverName, 200),
      idempotencyKey: `ocr:${hashDaOcorrencia(doc)}`,
    },
  });
};

export async function receberOcorrenciaTrack3r(request, env) {
  if (!env.DB) return respostaDoFornecedor(false, "Banco indisponível.", 503);
  if (request.method !== "POST") return respostaDoFornecedor(false, "Método não permitido.", 405);

  const url = new URL(request.url);
  // api, todogreen, tms, webhook, [id]
  const partes = url.pathname.split("/").filter(Boolean);
  const integracaoId = texto(partes[4], 120);

  // Teto de rajada por integração e por IP: o receptor é público, e público sem
  // teto é convite. `edgeIp` devolve vazio em loopback — sem IP, só o teto da
  // integração vale.
  if (!limitarTaxa(`tms-webhook:${integracaoId}`, 600))
    return respostaDoFornecedor(false, "Muitas chamadas em sequência. Tente novamente em instantes.", 429);
  const ip = edgeIp(request);
  if (ip && !limitarTaxa(`tms-webhook-ip:${ip}`, 600))
    return respostaDoFornecedor(false, "Muitas chamadas em sequência. Tente novamente em instantes.", 429);

  const integracao = await integracaoDoWebhook(env, integracaoId);
  if (!integracao) return TOKEN_INVALIDO();

  const enviado = String(request.headers.get("Token") || "").trim().slice(0, 500);
  const token = autenticarTokenWebhookTrack3r(env, integracao, "ocorrencias", enviado);
  if (!token.configurado)
    return respostaDoFornecedor(false, `Integração sem token configurado para ocorrencias (${token.nome}).`, 503);
  if (!token.autorizado) return TOKEN_INVALIDO();

  // O corpo é lido como texto UMA vez, para poder medir antes de interpretar.
  const bruto = await request.text().catch(() => "");
  if (bruto.length > MAX_CORPO_DO_WEBHOOK)
    return respostaDoFornecedor(false, "Corpo maior do que o aceito.", 413);
  let corpo;
  try { corpo = JSON.parse(bruto || "{}"); } catch { corpo = null; }
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo))
    return respostaDoFornecedor(false, "Não foi possível ler o JSON enviado.", 400);

  const access = { ownerId: integracao.workspace_owner_id };
  // As escritas precisam de um ator real (created_by tem chave estrangeira para
  // users): é quem configurou a integração. Fica auditável como "entrou pela
  // integração que fulana ligou", sem inventar usuário de sistema.
  const user = { id: integracao.updated_by || integracao.created_by };

  const importado = await importarLinhas(env, access, user, {
    linhas: [corpo],
    origem: "webhook",
    integracao,
    normalizar: normalizarOcorrenciaDoWebhook,
    calcularHash: hashDaOcorrencia,
    registrarExecucao: false,
  });

  // Ocorrência que não dá para identificar não é motivo para o fornecedor
  // reenviar para sempre: responde 200 e fica registrada como execução com erro.
  if (!importado.gravados)
    return respostaDoFornecedor(true, "Recebido com sucesso!", 200);

  const fieldMap = parse(integracao.field_map_json, {});
  const doc = normalizarOcorrenciaDoWebhook(corpo, fieldMap);
  // A projeção na linha do tempo é melhor-esforço: a ocorrência já está
  // guardada, e falhar aqui não pode fazer o fornecedor reenviar tudo.
  const projecao = await aplicarOcorrenciaNaOperacao(env, {
    ownerId: access.ownerId, userId: user.id, doc,
  }).catch((erro) => ({ aplicado: false, motivo: erro?.message || "falha ao aplicar o evento" }));

  await env.DB.prepare(
    `UPDATE todogreen_tms_integrations
        SET status = 'ativa', last_sync_at = ?, last_error = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`,
  ).bind(
    new Date().toISOString(),
    projecao.aplicado ? "" : texto(projecao.motivo, 300),
    new Date().toISOString(), integracao.id, TENANT_ID,
  ).run().catch(() => {});

  return respostaDoFornecedor(true, "Recebido com sucesso!", 200);
}

export async function handleTodoGreenTms(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  const url = new URL(request.url);
  // api, todogreen, tms, [recurso], [acao]
  const partes = url.pathname.split("/").filter(Boolean);
  const recurso = texto(partes[3], 40);
  const acao = texto(partes[4], 40);

  if (request.method === "GET") {
    if (recurso === "configuracao" || !recurso) return verConfiguracao(env, access, request);
    if (recurso === "documentos") return listarDocumentos(env, access, url);
    if (recurso === "cadastros") return listarCadastros(env, access, url);
    if (recurso === "valores") return listarValores(env, access, url);
    if (recurso === "recusas") return listarRecusas(env, access, url);
    if (recurso === "classes") return listarPorClasse(env, access, url);
    if (recurso === "sugestoes") return verSugestoes(env, access, url);
    if (recurso === "execucoes") return listarExecucoes(env, access, url);
    return json({ error: "Recurso desconhecido." }, 404);
  }

  if (!podeNaVertical(access, "tms:manage"))
    return json({ error: "Seu papel não pode operar a integração com o TMS." }, 403);

  const corpo = await request.json().catch(() => ({}));

  if (request.method === "POST") {
    if (recurso === "configuracao") return salvarConfiguracao(env, access, user, corpo, request);
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
