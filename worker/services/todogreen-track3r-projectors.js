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
     VALUES (?,?,?,?,'receivable','',?,?,?,?,?,?,?,?,1,?,?,?,?,NULL)`,
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
  if (["embarcadores", "tomadores", "unidades"].includes(tipo))
    return { processed: await salvarEntidade(env, integracao, tipo, corpo), domain: "cadastros" };

  if (tipo === "valores-encomendas")
    return { processed: await salvarValorEncomenda(env, integracao, corpo), domain: "financeiro" };

  if (tipo === "faturas")
    return { processed: await projetarFaturaCliente(env, integracao, corpo), domain: "financeiro" };

  if (tipo === "faturas-motorista" || tipo === "faturas-rede-terceira")
    return { processed: await projetarCusto(env, integracao, tipo, corpo), domain: "financeiro" };

  return { processed: false, domain: "" };
}
