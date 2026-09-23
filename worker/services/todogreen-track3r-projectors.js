// ===== TRACK3R: projeção dos webhooks no Financeiro canônico =====
//
// O webhook é só transporte. Aqui cada fato externo entra na fonte de verdade
// já existente do ERP:
// - fatura de cliente -> título a receber + razão de receita;
// - fatura de motorista/rede terceira -> razão de custos;
// - valores da encomenda -> fato financeiro por encomenda para margem;
// - embarcador/tomador/unidade -> cadastro de referência do provedor.
//
// IDs determinísticos tornam o processamento idempotente. Reenvio do fornecedor
// atualiza o mesmo registro em vez de duplicar receita/custo.

import { TENANT_ID } from "./todogreen-access.js";
import { normalizeVehicleClass } from "../../src/features/logistics/vehicleClassDomain.js";

const texto = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const isoData = (v) => {
  const s = texto(v, 40);
  if (!s) return "";
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
};

const mes = (data) => {
  const d = isoData(data);
  return d ? d.slice(0, 7) : "";
};

const isoInstante = (v) => {
  const s = texto(v, 50);
  if (!s) return "";
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}T${br[4] || "00"}:${br[5] || "00"}:${br[6] || "00"}.000Z`;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

const soDigitos = (v) => texto(v, 50).replace(/\D/g, "");

const ator = (integracao) => texto(integracao?.updated_by || integracao?.created_by, 120);

const idSeguro = (...partes) =>
  partes.map((p) => texto(p, 120).replace(/[^a-zA-Z0-9_.:-]/g, "_")).join(":").slice(0, 240);

const statusTitulo = ({ valor, pago, vencimento }) => {
  const total = Math.max(0, numero(valor));
  const quitado = Math.max(0, numero(pago));
  if (total <= 0 || quitado + 0.0001 >= total) return "settled";
  if (quitado > 0) return "partial";
  const hoje = new Date().toISOString().slice(0, 10);
  return vencimento && vencimento < hoje ? "overdue" : "open";
};

const statusEntrada = (status) => ({
  settled: "paid",
  partial: "partial",
  overdue: "overdue",
  cancelled: "cancelled",
}[status] || "pending");

async function salvarEntidade(env, integracao, tipo, corpo) {
  const mapa = {
    embarcadores: ["embarcador", corpo?.codigo_embarcador, corpo?.nome, corpo?.fantasia, corpo?.cpf_cnpj],
    tomadores: ["tomador", corpo?.codigo_tomador, corpo?.nome, corpo?.fantasia, corpo?.cpf_cnpj],
    unidades: ["unidade", corpo?.codigo_unidade, corpo?.nome, corpo?.sigla, corpo?.cnpj],
  };
  const dados = mapa[tipo];
  if (!dados) return false;
  const [entityType, externalCode, name, tradeName, document] = dados;
  const codigo = texto(externalCode, 120);
  if (!codigo) return false;
  const agora = new Date().toISOString();
  const id = idSeguro("track3r-entity", integracao.id, entityType, codigo);

  await env.DB.prepare(
    `INSERT INTO todogreen_track3r_entities
       (id,tenant_id,workspace_owner_id,integration_id,entity_type,external_code,
        name,trade_name,document,payload_json,first_seen_at,last_seen_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(workspace_owner_id,integration_id,entity_type,external_code)
     DO UPDATE SET
       name=excluded.name,
       trade_name=excluded.trade_name,
       document=excluded.document,
       payload_json=excluded.payload_json,
       last_seen_at=excluded.last_seen_at`,
  ).bind(
    id, TENANT_ID, integracao.workspace_owner_id, integracao.id, entityType, codigo,
    texto(name, 240), texto(tradeName, 240), texto(document, 40),
    JSON.stringify(corpo), agora, agora,
  ).run();

  if (entityType === "embarcador") {
    const clientId = await garantirClienteEmbarcador(env, integracao, tradeName || name, document);
    if (clientId) {
      await env.DB.prepare(
        `UPDATE todogreen_tms_documents
            SET shipper_name=CASE WHEN shipper_name='' THEN ? ELSE shipper_name END,
                shipper_document=CASE WHEN shipper_document='' THEN ? ELSE shipper_document END,
                client_id=CASE WHEN client_id='' THEN ? ELSE client_id END,
                revision=revision+1,updated_at=?
          WHERE tenant_id=? AND workspace_owner_id=? AND integration_id=?
            AND archived_at IS NULL
            AND json_extract(payload_json,'$.codigo_embarcador')=?`,
      ).bind(
        texto(tradeName || name, 240), texto(document, 40), clientId, agora,
        TENANT_ID, integracao.workspace_owner_id, integracao.id, codigo,
      ).run();
    }
  }
  return true;
}

async function nomeEntidade(env, integracao, tipo, codigo) {
  const code = texto(codigo, 120);
  if (!code) return "";
  const row = await env.DB.prepare(
    `SELECT name,trade_name,document FROM todogreen_track3r_entities
      WHERE workspace_owner_id=? AND integration_id=? AND entity_type=? AND external_code=?`,
  ).bind(integracao.workspace_owner_id, integracao.id, tipo, code).first();
  return texto(row?.trade_name || row?.name || row?.document, 240);
}

async function clientePorDocumento(env, integracao, documento) {
  const doc = soDigitos(documento);
  if (!doc) return "";
  const row = await env.DB.prepare(
    `SELECT id FROM todogreen_clients
      WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
        AND REPLACE(REPLACE(REPLACE(REPLACE(document,'.',''),'/',''),'-',''),' ','')=?
      LIMIT 1`,
  ).bind(TENANT_ID, integracao.workspace_owner_id, doc).first();
  return texto(row?.id, 120);
}

// Plano B da atribuição por cliente: garante um cliente no ERP a partir do
// embarcador. Casa por CNPJ; senão por nome (enriquecendo o CNPJ que faltava);
// senão cria. Assim "por cliente" no painel funciona sem cadastro manual e o
// CNPJ dos clientes passa a existir para o casamento por documento.
async function garantirClienteEmbarcador(env, integracao, nome, documento) {
  const doc = soDigitos(documento);
  const nomeLimpo = texto(nome, 240);
  if (doc) {
    const porDoc = await clientePorDocumento(env, integracao, documento);
    if (porDoc) return porDoc;
  }
  if (!nomeLimpo) return "";
  const agora = new Date().toISOString();
  const atorId = ator(integracao) || texto(integracao.workspace_owner_id, 120);
  const porNome = await env.DB.prepare(
    `SELECT id, document FROM todogreen_clients
      WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
        AND lower(trim(name)) = lower(trim(?)) LIMIT 1`,
  ).bind(TENANT_ID, integracao.workspace_owner_id, nomeLimpo).first().catch(() => null);
  if (porNome?.id) {
    if (doc && !soDigitos(porNome.document)) {
      await env.DB.prepare(
        `UPDATE todogreen_clients SET document=?, updated_by=?, updated_at=?, revision=revision+1 WHERE id=?`,
      ).bind(texto(documento, 40), atorId, agora, porNome.id).run().catch(() => {});
    }
    return texto(porNome.id, 120);
  }
  const id = idSeguro("track3r-client", integracao.workspace_owner_id, doc || nomeLimpo);
  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id,tenant_id,workspace_owner_id,name,legal_name,document,status,portal_enabled,
        fields_json,revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'ativo',0,?,1,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       document=CASE WHEN COALESCE(todogreen_clients.document,'')='' THEN excluded.document ELSE todogreen_clients.document END,
       updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
  ).bind(
    id, TENANT_ID, integracao.workspace_owner_id, nomeLimpo, nomeLimpo, texto(documento, 40),
    JSON.stringify({ source: "track3r_embarcador" }), atorId, atorId, agora, agora,
  ).run().catch(() => {});
  return id;
}

async function entidadeTrack3r(env, integracao, tipo, codigo) {
  const code = texto(codigo, 120);
  if (!code) return null;
  return env.DB.prepare(
    `SELECT external_code,name,trade_name,document
       FROM todogreen_track3r_entities
      WHERE workspace_owner_id=? AND integration_id=? AND entity_type=? AND external_code=?`,
  ).bind(integracao.workspace_owner_id, integracao.id, tipo, code).first();
}

async function ultimaListaDaEncomenda(env, integracao, codigo) {
  const code = texto(codigo, 120);
  if (!code) return null;
  return env.DB.prepare(
    `SELECT l.external_list_code,l.origin_unit_code,l.origin_unit_name,
            l.destination_unit_code,l.destination_unit_name,l.driver_name,
            l.driver_document,l.vehicle_plate,l.vehicle_type,l.vehicle_class,l.generated_at
       FROM todogreen_track3r_list_orders lo
       JOIN todogreen_track3r_lists l
         ON l.workspace_owner_id=lo.workspace_owner_id
        AND l.integration_id=lo.integration_id
        AND l.external_list_code=lo.external_list_code
      WHERE lo.workspace_owner_id=? AND lo.integration_id=? AND lo.external_order_code=?
      ORDER BY lo.last_seen_at DESC LIMIT 1`,
  ).bind(integracao.workspace_owner_id, integracao.id, code).first();
}

const pesoDaEncomenda = (corpo) => {
  const volumes = Array.isArray(corpo?.documento?.volumes) ? corpo.documento.volumes : [];
  return volumes.reduce((total, volume) => {
    const manual = numero(volume?.peso_manual);
    const cubado = numero(volume?.peso_cubado);
    const arquivo = numero(volume?.peso_arquivo);
    return total + (manual > 0 ? manual : cubado > 0 ? cubado : arquivo);
  }, 0);
};

const kindDaEncomenda = (corpo) => {
  const servico = texto(corpo?.descricao_servico, 120).toLowerCase();
  const produto = texto(corpo?.descricao_produto, 120).toLowerCase();
  const base = `${servico} ${produto}`;
  if (base.includes("reversa")) return "coleta_reversa";
  if (base.includes("coleta")) return "coleta";
  if (base.includes("transfer")) return "transferencia";
  return "entrega";
};

async function salvarEncomenda(env, integracao, corpo) {
  const codigo = texto(corpo?.codigo_encomenda, 120);
  if (!codigo) return false;

  const agora = new Date().toISOString();
  const actor = ator(integracao);
  const embarcador = await entidadeTrack3r(env, integracao, "embarcador", corpo?.codigo_embarcador);
  const lista = await ultimaListaDaEncomenda(env, integracao, codigo);
  const clientIdEncontrado = await clientePorDocumento(env, integracao, embarcador?.document);
  const existente = await env.DB.prepare(
    `SELECT id,client_id,operation_id,projected_at,created_by,created_at
       FROM todogreen_tms_documents
      WHERE tenant_id=? AND workspace_owner_id=? AND external_id=? AND archived_at IS NULL
      LIMIT 1`,
  ).bind(TENANT_ID, integracao.workspace_owner_id, codigo).first();

  const doc = corpo?.documento || {};
  const quantidadeVolumes = numero(doc?.quantidade_volumes) ||
    (Array.isArray(doc?.volumes) ? doc.volumes.length : 0);
  const prometido = isoInstante(corpo?.data_agendamento || corpo?.data_prevista);
  const cadastrado = isoInstante(corpo?.data_hora_cadastro || corpo?.data_hora_envio);
  const shipperName = texto(embarcador?.trade_name || embarcador?.name, 240);
  const shipperDocument = texto(embarcador?.document, 40);
  const originUnit = texto(lista?.origin_unit_name || corpo?.codigo_unidade_origem, 160);
  const currentUnit = texto(lista?.origin_unit_name || corpo?.codigo_unidade_origem, 160);
  const vehicleClass = texto(lista?.vehicle_class, 40);
  const importHash = idSeguro("track3r-encomenda", integracao.id, codigo);
  const payload = JSON.stringify(corpo);

  if (existente) {
    await env.DB.prepare(
      `UPDATE todogreen_tms_documents
          SET integration_id=?,origem='webhook',kind=?,
              shipper_name=CASE WHEN ?<>'' THEN ? ELSE shipper_name END,
              shipper_document=CASE WHEN ?<>'' THEN ? ELSE shipper_document END,
              client_id=CASE WHEN client_id='' AND ?<>'' THEN ? ELSE client_id END,
              origin_unit=?,current_unit=?,service=?,product=?,status=?,
              invoice_number=?,invoice_key=?,
              vehicle_plate=CASE WHEN ?<>'' THEN ? ELSE vehicle_plate END,
              vehicle_class=CASE WHEN ?<>'' THEN ? ELSE vehicle_class END,
              driver_name=CASE WHEN ?<>'' THEN ? ELSE driver_name END,
              packages=?,weight_kg=?,promised_at=?,occurred_at=?,
              payload_json=?,import_hash=?,order_ref=?,revision=revision+1,
              updated_by=?,updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
    ).bind(
      integracao.id, kindDaEncomenda(corpo),
      shipperName, shipperName, shipperDocument, shipperDocument,
      clientIdEncontrado, clientIdEncontrado,
      originUnit, currentUnit, texto(corpo?.descricao_servico, 160),
      texto(corpo?.descricao_produto, 160), texto(corpo?.descricao_status, 160),
      texto(doc?.numero, 120), texto(doc?.chave, 120),
      texto(lista?.vehicle_plate, 40), texto(lista?.vehicle_plate, 40),
      vehicleClass, vehicleClass,
      texto(lista?.driver_name, 160), texto(lista?.driver_name, 160),
      quantidadeVolumes, pesoDaEncomenda(corpo), prometido || null, cadastrado || null,
      payload, importHash, codigo, actor, agora,
      existente.id, TENANT_ID, integracao.workspace_owner_id,
    ).run();
    await reconciliarFiscalPorEncomenda(env, integracao, codigo);
    return true;
  }

  await env.DB.prepare(
    `INSERT INTO todogreen_tms_documents
       (id,tenant_id,workspace_owner_id,integration_id,origem,external_id,kind,
        shipper_name,shipper_group,shipper_document,client_id,origin_unit,current_unit,
        service,product,status,occurrence,invoice_number,invoice_key,vehicle_plate,
        vehicle_class,driver_name,packages,weight_kg,distance_km,promised_at,occurred_at,
        payload_json,import_hash,order_ref,occurrence_code,operation_id,projected_at,
        revision,created_by,updated_by,created_at,updated_at,archived_at)
     VALUES (?,?,?,?,'webhook',?,?,?,'',?,?,?,?,?,?,?,'',?,?,?,?,?,?,?,0,?,?,?,?,?,'','',NULL,1,?,?,?,?,NULL)`,
  ).bind(
    crypto.randomUUID(), TENANT_ID, integracao.workspace_owner_id, integracao.id,
    codigo, kindDaEncomenda(corpo), shipperName, shipperDocument, clientIdEncontrado,
    originUnit, currentUnit, texto(corpo?.descricao_servico, 160),
    texto(corpo?.descricao_produto, 160), texto(corpo?.descricao_status, 160),
    texto(doc?.numero, 120), texto(doc?.chave, 120), texto(lista?.vehicle_plate, 40),
    vehicleClass, texto(lista?.driver_name, 160), quantidadeVolumes, pesoDaEncomenda(corpo),
    prometido || null, cadastrado || null, payload, importHash, codigo,
    actor, actor, agora, agora,
  ).run();
  await reconciliarFiscalPorEncomenda(env, integracao, codigo);
  return true;
}

async function salvarLista(env, integracao, corpo) {
  const codigo = texto(corpo?.codigo_lista, 120);
  if (!codigo) return false;
  const detalhes = corpo?.detalhes || {};
  const motorista = detalhes?.motorista || {};
  const veiculo = detalhes?.veiculo || {};
  const origem = detalhes?.unidade || {};
  const destino = detalhes?.unidade_destino || {};
  const classe = normalizeVehicleClass(veiculo?.tipo_veiculo?.descricao || "");
  const agora = new Date().toISOString();
  const generatedAt = isoInstante(detalhes?.data_geracao || corpo?.data_hora_envio);
  const id = idSeguro("track3r-list", integracao.id, codigo);

  await env.DB.prepare(
    `INSERT INTO todogreen_track3r_lists
       (id,tenant_id,workspace_owner_id,integration_id,external_list_code,service_code,
        list_type,generated_at,order_count,origin_unit_code,origin_unit_name,
        destination_unit_code,destination_unit_name,driver_code,driver_name,
        driver_document,driver_type,vehicle_code,vehicle_plate,vehicle_type,vehicle_class,
        payload_json,first_seen_at,last_seen_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(workspace_owner_id,integration_id,external_list_code)
     DO UPDATE SET
       service_code=excluded.service_code,list_type=excluded.list_type,
       generated_at=excluded.generated_at,order_count=excluded.order_count,
       origin_unit_code=excluded.origin_unit_code,origin_unit_name=excluded.origin_unit_name,
       destination_unit_code=excluded.destination_unit_code,destination_unit_name=excluded.destination_unit_name,
       driver_code=excluded.driver_code,driver_name=excluded.driver_name,
       driver_document=excluded.driver_document,driver_type=excluded.driver_type,
       vehicle_code=excluded.vehicle_code,vehicle_plate=excluded.vehicle_plate,
       vehicle_type=excluded.vehicle_type,vehicle_class=excluded.vehicle_class,
       payload_json=excluded.payload_json,last_seen_at=excluded.last_seen_at`,
  ).bind(
    id, TENANT_ID, integracao.workspace_owner_id, integracao.id, codigo,
    texto(detalhes?.codigo_servico, 80), texto(detalhes?.tipo, 80), generatedAt,
    numero(detalhes?.quantidade_encomendas), texto(origem?.codigo, 80), texto(origem?.nome, 160),
    texto(destino?.codigo, 80), texto(destino?.nome, 160), texto(motorista?.codigo, 80),
    texto(motorista?.nome, 160), texto(motorista?.cpf, 40),
    texto(motorista?.tipo_motorista?.descricao, 100), texto(veiculo?.codigo, 80),
    texto(veiculo?.placa, 40), texto(veiculo?.tipo_veiculo?.descricao, 120), classe,
    JSON.stringify(corpo), agora, agora,
  ).run();

  const encomendas = Array.isArray(detalhes?.encomendas) ? detalhes.encomendas : [];
  for (const encomenda of encomendas.slice(0, 1000)) {
    const orderCode = texto(encomenda?.codigo_encomenda, 120);
    if (!orderCode) continue;
    const linkId = idSeguro("track3r-list-order", integracao.id, codigo, orderCode);
    await env.DB.prepare(
      `INSERT INTO todogreen_track3r_list_orders
         (id,tenant_id,workspace_owner_id,integration_id,external_list_code,
          external_order_code,items_json,first_seen_at,last_seen_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(workspace_owner_id,integration_id,external_list_code,external_order_code)
       DO UPDATE SET items_json=excluded.items_json,last_seen_at=excluded.last_seen_at`,
    ).bind(
      linkId, TENANT_ID, integracao.workspace_owner_id, integracao.id, codigo, orderCode,
      JSON.stringify(Array.isArray(encomenda?.itens) ? encomenda.itens : []), agora, agora,
    ).run();

    await env.DB.prepare(
      `UPDATE todogreen_tms_documents
          SET current_unit=CASE WHEN ?<>'' THEN ? ELSE current_unit END,
              vehicle_plate=CASE WHEN ?<>'' THEN ? ELSE vehicle_plate END,
              vehicle_class=CASE WHEN ?<>'' THEN ? ELSE vehicle_class END,
              driver_name=CASE WHEN ?<>'' THEN ? ELSE driver_name END,
              revision=revision+1,updated_by=?,updated_at=?
        WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
          AND (order_ref=? OR external_id=?)`,
    ).bind(
      texto(origem?.nome, 160), texto(origem?.nome, 160),
      texto(veiculo?.placa, 40), texto(veiculo?.placa, 40),
      classe, classe, texto(motorista?.nome, 160), texto(motorista?.nome, 160),
      ator(integracao), agora, TENANT_ID, integracao.workspace_owner_id, orderCode, orderCode,
    ).run();
  }
  return true;
}

async function dadosTmsDaEncomenda(env, integracao, codigo) {
  const code = texto(codigo, 120);
  if (!code) return null;
  return env.DB.prepare(
    `SELECT client_id,operation_id FROM todogreen_tms_documents
      WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
        AND (external_id=? OR order_ref=?)
      ORDER BY updated_at DESC LIMIT 1`,
  ).bind(TENANT_ID, integracao.workspace_owner_id, code, code).first();
}

async function ultimaAverbacao(env, integracao, codigo) {
  const code = texto(codigo, 120);
  if (!code) return null;
  return env.DB.prepare(
    `SELECT cte_number,cte_series,endorsed_at,protocol,message
       FROM todogreen_track3r_endorsements
      WHERE workspace_owner_id=? AND integration_id=? AND external_order_code=?
      ORDER BY last_seen_at DESC LIMIT 1`,
  ).bind(integracao.workspace_owner_id, integracao.id, code).first();
}

async function reconciliarFiscalPorEncomenda(env, integracao, codigo) {
  const tms = await dadosTmsDaEncomenda(env, integracao, codigo);
  if (!tms || (!tms.client_id && !tms.operation_id)) return;
  await env.DB.prepare(
    `UPDATE todogreen_fiscal_documents
        SET client_id=CASE WHEN COALESCE(client_id,'')='' AND ?<>'' THEN ? ELSE client_id END,
            operation_id=CASE WHEN COALESCE(operation_id,'')='' AND ?<>'' THEN ? ELSE operation_id END,
            revision=revision+1,updated_at=?
      WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
        AND json_extract(fields_json,'$.externalOrderCode')=?`,
  ).bind(
    texto(tms.client_id,120), texto(tms.client_id,120),
    texto(tms.operation_id,120), texto(tms.operation_id,120),
    new Date().toISOString(), TENANT_ID, integracao.workspace_owner_id, texto(codigo,120),
  ).run();
}

async function salvarCte(env, integracao, corpo) {
  const orderCode = texto(corpo?.codigo_encomenda, 120);
  const cte = corpo?.cte || {};
  const chave = texto(cte?.chave, 80);
  const numeroCte = texto(cte?.numero, 40);
  const serieCte = texto(cte?.serie, 20);
  if (!orderCode || (!chave && !numeroCte)) return false;

  const agora = new Date().toISOString();
  const actor = ator(integracao);
  const tms = await dadosTmsDaEncomenda(env, integracao, orderCode);
  const endorsement = await ultimaAverbacao(env, integracao, orderCode);
  const fields = {
    source: "track3r",
    integrationId: integracao.id,
    eventType: "ctes",
    externalOrderCode: orderCode,
    externalEventCode: texto(corpo?.codigo_tipo_evento, 80),
    xmlUrl: texto(cte?.caminho_xml, 2000),
    dacteUrl: texto(cte?.caminho_dacte, 2000),
    track3rSentAt: isoInstante(corpo?.data_hora_envio),
    ...(endorsement ? {
      track3rEndorsement: {
        endorsedAt: endorsement.endorsed_at,
        protocol: endorsement.protocol,
        message: endorsement.message,
      },
    } : {}),
  };

  let existing = null;
  if (chave) {
    existing = await env.DB.prepare(
      `SELECT id,status,fields_json FROM todogreen_fiscal_documents
        WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL AND chave_acesso=?
        ORDER BY created_at DESC LIMIT 1`,
    ).bind(TENANT_ID, integracao.workspace_owner_id, chave).first();
  }
  const id = existing?.id || idSeguro(
    "track3r-cte", integracao.id, chave || `${numeroCte}-${serieCte}-${orderCode}`,
  );
  const data = isoInstante(cte?.data || corpo?.data_hora_envio);
  const numeroInt = Math.trunc(numero(numeroCte));
  const serieInt = Math.trunc(numero(serieCte)) || 1;

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO todogreen_fiscal_documents
         (id,tenant_id,workspace_owner_id,doc_type,numero,serie,chave_acesso,status,
          protocolo_autorizacao,data_emissao,operation_id,client_id,xml_content,
          fields_json,revision,created_by,updated_by,created_at,updated_at,archived_at)
       VALUES (?,?,?,'cte',?,?,?,'validado',?,?,?,?,NULL,?,1,?,?,?,?,NULL)`,
    ).bind(
      id, TENANT_ID, integracao.workspace_owner_id, numeroInt || null, serieInt,
      chave || null, texto(cte?.protocolo, 120) || null, data || null,
      texto(tms?.operation_id,120) || null, texto(tms?.client_id,120) || null,
      JSON.stringify(fields), actor, actor, agora, agora,
    ).run();
  } else {
    let atuais = {};
    try { atuais = JSON.parse(existing.fields_json || "{}"); } catch { atuais = {}; }
    const merged = JSON.stringify({ ...atuais, ...fields });
    await env.DB.prepare(
      `UPDATE todogreen_fiscal_documents
          SET numero=CASE WHEN numero IS NULL OR numero=0 THEN ? ELSE numero END,
              serie=CASE WHEN serie IS NULL OR serie=0 THEN ? ELSE serie END,
              protocolo_autorizacao=CASE WHEN COALESCE(protocolo_autorizacao,'')='' THEN ? ELSE protocolo_autorizacao END,
              data_emissao=CASE WHEN COALESCE(data_emissao,'')='' THEN ? ELSE data_emissao END,
              operation_id=CASE WHEN COALESCE(operation_id,'')='' AND ?<>'' THEN ? ELSE operation_id END,
              client_id=CASE WHEN COALESCE(client_id,'')='' AND ?<>'' THEN ? ELSE client_id END,
              fields_json=?,revision=revision+1,updated_by=?,updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
    ).bind(
      numeroInt || null, serieInt, texto(cte?.protocolo,120), data || null,
      texto(tms?.operation_id,120), texto(tms?.operation_id,120),
      texto(tms?.client_id,120), texto(tms?.client_id,120),
      merged, actor, agora, id, TENANT_ID, integracao.workspace_owner_id,
    ).run();
  }
  return true;
}

async function salvarAverbacao(env, integracao, corpo) {
  const orderCode = texto(corpo?.codigo_encomenda, 120);
  const averbacao = corpo?.averbacao || {};
  const protocol = texto(averbacao?.protocolo, 240);
  if (!orderCode || !protocol) return false;
  const cte = corpo?.cte || {};
  const agora = new Date().toISOString();
  const id = idSeguro("track3r-endorsement", integracao.id, orderCode, protocol);

  await env.DB.prepare(
    `INSERT INTO todogreen_track3r_endorsements
       (id,tenant_id,workspace_owner_id,integration_id,external_order_code,
        external_cte_code,cte_number,cte_series,endorsed_at,protocol,message,
        payload_json,first_seen_at,last_seen_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(workspace_owner_id,integration_id,external_order_code,protocol)
     DO UPDATE SET
       external_cte_code=excluded.external_cte_code,cte_number=excluded.cte_number,
       cte_series=excluded.cte_series,endorsed_at=excluded.endorsed_at,
       message=excluded.message,payload_json=excluded.payload_json,last_seen_at=excluded.last_seen_at`,
  ).bind(
    id,TENANT_ID,integracao.workspace_owner_id,integracao.id,orderCode,
    texto(corpo?.codigo_encomenda_cte,120),texto(cte?.numero,40),texto(cte?.serie,20),
    isoInstante(averbacao?.data || corpo?.data_hora_envio),protocol,
    texto(averbacao?.mensagem,500),JSON.stringify(corpo),agora,agora,
  ).run();

  const { results } = await env.DB.prepare(
    `SELECT id,fields_json FROM todogreen_fiscal_documents
      WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
        AND (
          json_extract(fields_json,'$.externalOrderCode')=?
          OR (CAST(numero AS TEXT)=? AND CAST(serie AS TEXT)=?)
        )`,
  ).bind(
    TENANT_ID,integracao.workspace_owner_id,orderCode,texto(cte?.numero,40),texto(cte?.serie,20),
  ).all();

  for (const row of results || []) {
    let fields = {};
    try { fields = JSON.parse(row.fields_json || "{}"); } catch { fields = {}; }
    fields.track3rEndorsement = {
      endorsedAt: isoInstante(averbacao?.data || corpo?.data_hora_envio),
      protocol,
      message: texto(averbacao?.mensagem,500),
    };
    await env.DB.prepare(
      `UPDATE todogreen_fiscal_documents
          SET fields_json=?,revision=revision+1,updated_by=?,updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
    ).bind(
      JSON.stringify(fields),ator(integracao),agora,row.id,TENANT_ID,integracao.workspace_owner_id,
    ).run();
  }
  return true;
}

async function salvarCotacao(env, integracao, corpo) {
  const codigo = texto(corpo?.codigo_cotacao, 120);
  if (!codigo) return false;

  const embarcador = await entidadeTrack3r(env, integracao, "embarcador", corpo?.codigo_embarcador);
  const tomador = await entidadeTrack3r(env, integracao, "tomador", corpo?.codigo_tomador);
  const clientId =
    await clientePorDocumento(env, integracao, embarcador?.document) ||
    await clientePorDocumento(env, integracao, tomador?.document);

  const desconto = corpo?.desconto || {};
  const frete = corpo?.frete || {};
  const imposto = corpo?.imposto || {};
  const prazo = corpo?.prazo || {};
  const peso = corpo?.peso || {};
  const origem = corpo?.origem || {};
  const destino = corpo?.destino || {};
  const agora = new Date().toISOString();
  const id = idSeguro("track3r-quote", integracao.id, codigo);

  await env.DB.prepare(
    `INSERT INTO todogreen_track3r_quotes
       (id,tenant_id,workspace_owner_id,integration_id,external_quote_code,client_id,
        user_name,taker_code,shipper_code,service_code,product_code,volume_count,
        volumes_json,origin_ibge,origin_city,origin_state,destination_zip,
        discount_amount,discount_percent,freight_weight,pickup_fee,delivery_fee,
        dispatch_fee,ad_valorem,gris,quoted_amount,tax_type,tax_description,tax_rate,
        tax_base,tax_amount,lead_time_value,lead_time_unit,promised_date,
        weight_entered,weight_cubed,weight_charged,payload_json,first_seen_at,last_seen_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(workspace_owner_id,integration_id,external_quote_code)
     DO UPDATE SET
       client_id=CASE WHEN excluded.client_id<>'' THEN excluded.client_id ELSE todogreen_track3r_quotes.client_id END,
       user_name=excluded.user_name,taker_code=excluded.taker_code,shipper_code=excluded.shipper_code,
       service_code=excluded.service_code,product_code=excluded.product_code,
       volume_count=excluded.volume_count,volumes_json=excluded.volumes_json,
       origin_ibge=excluded.origin_ibge,origin_city=excluded.origin_city,origin_state=excluded.origin_state,
       destination_zip=excluded.destination_zip,discount_amount=excluded.discount_amount,
       discount_percent=excluded.discount_percent,freight_weight=excluded.freight_weight,
       pickup_fee=excluded.pickup_fee,delivery_fee=excluded.delivery_fee,
       dispatch_fee=excluded.dispatch_fee,ad_valorem=excluded.ad_valorem,gris=excluded.gris,
       quoted_amount=excluded.quoted_amount,tax_type=excluded.tax_type,
       tax_description=excluded.tax_description,tax_rate=excluded.tax_rate,
       tax_base=excluded.tax_base,tax_amount=excluded.tax_amount,
       lead_time_value=excluded.lead_time_value,lead_time_unit=excluded.lead_time_unit,
       promised_date=excluded.promised_date,weight_entered=excluded.weight_entered,
       weight_cubed=excluded.weight_cubed,weight_charged=excluded.weight_charged,
       payload_json=excluded.payload_json,last_seen_at=excluded.last_seen_at`,
  ).bind(
    id,TENANT_ID,integracao.workspace_owner_id,integracao.id,codigo,clientId,
    texto(corpo?.nome_usuario,160),texto(corpo?.codigo_tomador,120),
    texto(corpo?.codigo_embarcador,120),texto(corpo?.codigo_servico,80),
    texto(corpo?.codigo_produto,80),Math.trunc(numero(corpo?.quantidade_volumes)),
    JSON.stringify(Array.isArray(corpo?.volumes) ? corpo.volumes : []),
    texto(origem?.codigo_ibge,40),texto(origem?.cidade,120),texto(origem?.uf,8),
    texto(destino?.cep,20),numero(desconto?.frete_total),numero(desconto?.percentual),
    numero(frete?.frete_peso),numero(frete?.taxa_coleta),numero(frete?.taxa_entrega),
    numero(frete?.taxa_despacho),numero(frete?.ad_valorem),numero(frete?.gris),
    numero(frete?.valor),texto(imposto?.tipo,40),texto(imposto?.descricao,120),
    numero(imposto?.aliquota),numero(imposto?.base_calculo),numero(imposto?.valor),
    numero(prazo?.prazo),texto(prazo?.tipo,40),isoData(prazo?.data),
    numero(peso?.digitado),numero(peso?.cubado),numero(peso?.taxado),
    JSON.stringify(corpo),agora,agora,
  ).run();
  return true;
}

async function salvarValorEncomenda(env, integracao, corpo) {
  const codigo = texto(corpo?.codigo_encomenda, 120);
  if (!codigo) return false;
  const agora = new Date().toISOString();
  const id = idSeguro("track3r-order-value", integracao.id, codigo);

  await env.DB.prepare(
    `INSERT INTO todogreen_track3r_order_values
       (id,tenant_id,workspace_owner_id,integration_id,external_order_code,
        product_code,product_description,merchandise_value,weight_kg,freight,
        ad_valorem,gris,dispatch_fee,toll_fee,river_fee,difficult_access_fee,
        unloading_fee,ctrc_fee,extra_pickup_fee,extra_delivery_fee,trt_fee,
        emex_fee,tde_fee,cfop,tax_rate,icms,iss,total_freight,payload_json,
        first_seen_at,last_seen_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(workspace_owner_id,integration_id,external_order_code)
     DO UPDATE SET
       product_code=excluded.product_code,
       product_description=excluded.product_description,
       merchandise_value=excluded.merchandise_value,
       weight_kg=excluded.weight_kg,
       freight=excluded.freight,
       ad_valorem=excluded.ad_valorem,
       gris=excluded.gris,
       dispatch_fee=excluded.dispatch_fee,
       toll_fee=excluded.toll_fee,
       river_fee=excluded.river_fee,
       difficult_access_fee=excluded.difficult_access_fee,
       unloading_fee=excluded.unloading_fee,
       ctrc_fee=excluded.ctrc_fee,
       extra_pickup_fee=excluded.extra_pickup_fee,
       extra_delivery_fee=excluded.extra_delivery_fee,
       trt_fee=excluded.trt_fee,
       emex_fee=excluded.emex_fee,
       tde_fee=excluded.tde_fee,
       cfop=excluded.cfop,
       tax_rate=excluded.tax_rate,
       icms=excluded.icms,
       iss=excluded.iss,
       total_freight=excluded.total_freight,
       payload_json=excluded.payload_json,
       last_seen_at=excluded.last_seen_at`,
  ).bind(
    id, TENANT_ID, integracao.workspace_owner_id, integracao.id, codigo,
    texto(corpo?.codigo_produto, 80), texto(corpo?.descricao_produto, 200),
    numero(corpo?.valor_mercadoria), numero(corpo?.peso), numero(corpo?.frete),
    numero(corpo?.taxa_ad_valorem), numero(corpo?.taxa_gris), numero(corpo?.taxa_despacho),
    numero(corpo?.taxa_pedagio), numero(corpo?.taxa_fluvial), numero(corpo?.taxa_dificuldade_acesso),
    numero(corpo?.taxa_descarga), numero(corpo?.taxa_ctrc), numero(corpo?.taxa_extra_coleta_embarcador),
    numero(corpo?.taxa_extra_entrega), numero(corpo?.taxa_trt), numero(corpo?.taxa_emex),
    numero(corpo?.taxa_tde), texto(corpo?.cfop, 40), numero(corpo?.aliquota),
    numero(corpo?.icms), numero(corpo?.iss), numero(corpo?.frete_total),
    JSON.stringify(corpo), agora, agora,
  ).run();
  return true;
}

async function totalBaixadoDoTitulo(env, integracao, titleId) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount),0) AS total, MAX(settled_at) AS last_paid_at
       FROM todogreen_settlements
      WHERE tenant_id=? AND workspace_owner_id=? AND title_id=?`,
  ).bind(TENANT_ID, integracao.workspace_owner_id, titleId).first();
  return { total: numero(row?.total), lastPaidAt: texto(row?.last_paid_at, 40) };
}

async function projetarFaturaCliente(env, integracao, corpo) {
  const codigo = texto(corpo?.codigo_fatura, 120);
  if (!codigo) return false;
  const detalhes = corpo?.detalhes || {};
  const valor = Math.max(0, numero(detalhes?.valor));
  const competencia = isoData(detalhes?.data_cobranca_final) || isoData(detalhes?.data_geracao) || new Date().toISOString().slice(0, 10);
  const emissao = isoData(detalhes?.data_geracao) || competencia;
  const vencimento = isoData(detalhes?.data_vencimento) || competencia;
  const titleId = idSeguro("track3r-receivable", integracao.id, codigo);
  const number = idSeguro("TR3R-REC", integracao.id.slice(0, 8), codigo).slice(0, 120);
  const actor = ator(integracao);
  const agora = new Date().toISOString();

  const tomador = await nomeEntidade(env, integracao, "tomador", corpo?.codigo_tomador);
  const embarcador = await nomeEntidade(env, integracao, "embarcador", corpo?.codigo_embarcador);
  const contraparte = tomador || embarcador ||
    `TRACK3R · tomador ${texto(corpo?.codigo_tomador, 60) || "não informado"}`;

  const baixas = await totalBaixadoDoTitulo(env, integracao, titleId);
  const status = statusTitulo({ valor, pago: baixas.total, vencimento });
  const aberto = Math.max(0, valor - baixas.total);
  const fields = JSON.stringify({
    source: "track3r",
    integrationId: integracao.id,
    eventType: "faturas",
    externalInvoiceId: codigo,
    takerCode: texto(corpo?.codigo_tomador, 120),
    shipperCode: texto(corpo?.codigo_embarcador, 120),
    billingStart: isoData(detalhes?.data_cobranca_inicial),
    billingEnd: isoData(detalhes?.data_cobranca_final),
    orders: Array.isArray(detalhes?.encomendas) ? detalhes.encomendas : [],
  });

  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_financial_titles
       (id,tenant_id,workspace_owner_id,number,kind,client_id,competence_date,
        issue_date,due_date,original_amount,open_amount,status,fields_json,
        revision,created_by,updated_by,created_at,updated_at,archived_at)
     VALUES (?,?,?,?,'receivable','',?,?,?,?,?,?,?,1,?,?,?,?,NULL)`,
  ).bind(
    titleId, TENANT_ID, integracao.workspace_owner_id, number,
    competencia, emissao, vencimento, valor, aberto, status, fields,
    actor, actor, agora, agora,
  ).run();

  await env.DB.prepare(
    `UPDATE todogreen_financial_titles
        SET competence_date=?,issue_date=?,due_date=?,original_amount=?,open_amount=?,
            status=?,fields_json=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(
    competencia, emissao, vencimento, valor, aberto, status, fields, actor, agora,
    titleId, TENANT_ID, integracao.workspace_owner_id,
  ).run();

  const entryId = `entry-${titleId}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_financial_entries
       (id,tenant_id,workspace_owner_id,kind,client_id,product_id,scenario_id,
        category,description,amount,reference_month,status,fields_json,revision,
        created_by,updated_by,created_at,updated_at,archived_at,due_date,paid_at,
        paid_amount,counterparty,document_number,competence_date,invoice_status)
     VALUES (?,?,?,'revenue','','','',
        'track3r_faturamento',?,?,?,?,?,1,?,?,?,?,NULL,?,?,?,?,?,?,?)`,
  ).bind(
    entryId, TENANT_ID, integracao.workspace_owner_id,
    `Fatura TRACK3R #${codigo}`, valor, competencia.slice(0, 7), "confirmed", fields,
    actor, actor, agora, agora,
    vencimento, baixas.lastPaidAt || null, baixas.total, contraparte, number,
    competencia, statusEntrada(status),
  ).run();

  await env.DB.prepare(
    `UPDATE todogreen_financial_entries
        SET category='track3r_faturamento',description=?,amount=?,reference_month=?,
            fields_json=?,due_date=?,paid_at=?,paid_amount=?,counterparty=?,
            document_number=?,competence_date=?,invoice_status=?,
            revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(
    `Fatura TRACK3R #${codigo}`, valor, competencia.slice(0, 7), fields, vencimento,
    baixas.lastPaidAt || null, baixas.total, contraparte, number, competencia,
    statusEntrada(status), actor, agora, entryId, TENANT_ID, integracao.workspace_owner_id,
  ).run();
  return true;
}

async function projetarCusto(env, integracao, tipo, corpo) {
  const codigo = texto(corpo?.codigo_fatura, 120);
  if (!codigo) return false;
  const detalhes = corpo?.detalhes || {};
  const valor = Math.max(0, numero(detalhes?.valor));
  const competencia =
    isoData(detalhes?.data_pagamento_final) ||
    isoData(detalhes?.data_geracao) ||
    new Date().toISOString().slice(0, 10);
  const vencimento = isoData(detalhes?.data_vencimento) || competencia;
  const actor = ator(integracao);
  const agora = new Date().toISOString();
  const motorista = corpo?.motorista || {};
  const empresa = corpo?.motorista_empresa || {};
  const unidade = corpo?.unidade || {};
  const isDriver = tipo === "faturas-motorista";
  const counterparty = isDriver
    ? texto(empresa?.nome || motorista?.nome || motorista?.cpf, 240)
    : texto(unidade?.nome || unidade?.sigla || unidade?.cnpj, 240);
  const category = isDriver ? "track3r_motorista" : "track3r_rede_terceira";
  const entryId = idSeguro(
    isDriver ? "track3r-driver-cost" : "track3r-network-cost",
    integracao.id,
    codigo,
  );
  const documentNumber = idSeguro(
    isDriver ? "TR3R-MOT" : "TR3R-RED",
    integracao.id.slice(0, 8),
    codigo,
  ).slice(0, 120);

  const existente = await env.DB.prepare(
    `SELECT paid_amount,paid_at FROM todogreen_financial_entries
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(entryId, TENANT_ID, integracao.workspace_owner_id).first();
  const pago = numero(existente?.paid_amount);
  const estado = statusTitulo({ valor, pago, vencimento });

  const fields = JSON.stringify({
    source: "track3r",
    integrationId: integracao.id,
    eventType: tipo,
    externalInvoiceId: codigo,
    driverCompany: isDriver ? empresa : undefined,
    driver: isDriver ? motorista : undefined,
    thirdPartyUnit: !isDriver ? unidade : undefined,
    documents: Array.isArray(corpo?.documentos) ? corpo.documentos : undefined,
    orders: Array.isArray(detalhes?.encomendas) ? detalhes.encomendas : undefined,
    operationType: isDriver ? detalhes?.tipo_operacao : undefined,
    periodStart: isoData(detalhes?.data_pagamento_inicial),
    periodEnd: isoData(detalhes?.data_pagamento_final),
  });

  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_financial_entries
       (id,tenant_id,workspace_owner_id,kind,client_id,product_id,scenario_id,
        category,description,amount,reference_month,status,fields_json,revision,
        created_by,updated_by,created_at,updated_at,archived_at,due_date,paid_at,
        paid_amount,counterparty,document_number,competence_date,invoice_status)
     VALUES (?,?,?,'cost','','','',?,?,?,?,?, ?,1,?,?,?,?,NULL,?,?,?,?,?,?,?)`,
  ).bind(
    entryId, TENANT_ID, integracao.workspace_owner_id,
    category,
    isDriver ? `Fatura motorista TRACK3R #${codigo}` : `Fatura rede terceira TRACK3R #${codigo}`,
    valor, competencia.slice(0, 7), "confirmed", fields,
    actor, actor, agora, agora,
    vencimento, existente?.paid_at || null, pago, counterparty, documentNumber,
    competencia, statusEntrada(estado),
  ).run();

  await env.DB.prepare(
    `UPDATE todogreen_financial_entries
        SET category=?,description=?,amount=?,reference_month=?,fields_json=?,
            due_date=?,counterparty=?,document_number=?,competence_date=?,
            invoice_status=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(
    category,
    isDriver ? `Fatura motorista TRACK3R #${codigo}` : `Fatura rede terceira TRACK3R #${codigo}`,
    valor, competencia.slice(0, 7), fields, vencimento, counterparty, documentNumber,
    competencia, statusEntrada(estado), actor, agora,
    entryId, TENANT_ID, integracao.workspace_owner_id,
  ).run();
  return true;
}

export async function projetarWebhookTrack3r(env, integracao, tipo, corpo) {
  if (tipo === "encomendas")
    return { processed: await salvarEncomenda(env, integracao, corpo), domain: "tms" };

  if (tipo === "listas")
    return { processed: await salvarLista(env, integracao, corpo), domain: "tms" };

  if (tipo === "ctes")
    return { processed: await salvarCte(env, integracao, corpo), domain: "fiscal" };

  if (tipo === "averbacoes")
    return { processed: await salvarAverbacao(env, integracao, corpo), domain: "fiscal" };

  if (["embarcadores", "tomadores", "unidades"].includes(tipo))
    return { processed: await salvarEntidade(env, integracao, tipo, corpo), domain: "cadastros" };

  if (tipo === "cotacoes")
    return { processed: await salvarCotacao(env, integracao, corpo), domain: "comercial" };

  if (tipo === "valores-encomendas")
    return { processed: await salvarValorEncomenda(env, integracao, corpo), domain: "financeiro" };

  if (tipo === "faturas")
    return { processed: await projetarFaturaCliente(env, integracao, corpo), domain: "financeiro" };

  if (tipo === "faturas-motorista" || tipo === "faturas-rede-terceira")
    return { processed: await projetarCusto(env, integracao, tipo, corpo), domain: "financeiro" };

  return { processed: false, domain: "" };
}
