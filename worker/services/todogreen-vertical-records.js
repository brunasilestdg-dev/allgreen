// ===== Registros da vertical =====
//
// Simulações, propostas, oportunidades, operações, receitas, custos e comissões
// moravam no estado genérico do espaço de trabalho — um JSON por usuário,
// gravado inteiro a cada alteração. O preço disso aparecia em quatro lugares:
//
//   • duas pessoas no mesmo espaço sobrescreviam o trabalho uma da outra;
//   • o portal do cliente não enxergava nada escrito por dentro;
//   • auditoria e versionamento valiam para metade da vertical;
//   • o painel somava fontes diferentes, com identificadores que não casavam.
//
// Aqui é a outra metade indo para o mesmo lugar onde clientes, carteiras,
// solicitações, ESG e Tracker já estavam.
//
// Duas decisões que valem explicação:
//
// 1) O escopo é da LINHA, não da consulta. Todo SELECT e todo UPDATE carregam
//    `workspace_owner_id = ?` vindo do vínculo da sessão, nunca do corpo do
//    pedido. Um handler que esquecesse o filtro devolveria a tabela inteira, e
//    é exatamente esse esquecimento que o formato abaixo torna difícil.
//
// 2) Escrita concorrente é resolvida por `revision`, não por "quem chegou
//    depois vence". O UPDATE exige a revisão que o cliente leu; se ela mudou,
//    a resposta é 409 e a tela recarrega — em vez de apagar em silêncio o que
//    a outra pessoa acabou de escrever, que é o defeito do JSON único.

import { TENANT_ID, paginacao, podeNaVertical, recorteDeCarteira } from "./todogreen-access.js";
// A validação e a normalização dos cadastros vêm do domínio, não daqui: é a
// mesma regra que a tela aplica, e uma segunda cópia no worker seria a
// divergência entre o botão liberado e a resposta recusada.
import {
  normalizeDocument,
  normalizePartyRoles,
  normalizeSku,
  normalizeUnit,
  validateAccount,
  validateCostCenter,
  validateItem,
  validateParty,
  validateWarehouse,
} from "../../src/features/logistics/erpCoreDomain.js";
import {
  bloqueioPorFechamento,
  validateBankAccount,
} from "../../src/features/logistics/treasuryDomain.js";
import { doBanco as pedidoDoBanco } from "./todogreen-deal-desk.js";
import { liberacaoDaProposta } from "../../src/features/logistics/dealDeskDomain.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";

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
const etapaGanha = (valor) => texto(valor, 80).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === "fechada ganha";
export const deveCriarHandoff = (anterior, proxima) => !etapaGanha(anterior) && etapaGanha(proxima);

const criarHandoffOperacional = async (env, access, user, oportunidade) => {
  const agora = new Date().toISOString();
  const boardId = `todogreen-handoff-${access.ownerId}`;
  const itemId = `todogreen-handoff-opportunity-${oportunidade.id}`;
  const prazo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_work_boards
       (id,tenant_id,workspace_owner_id,name,description,specialist,object_types_json,
        permissions_json,status,display_order,created_by,created_at,updated_at)
     VALUES (?,? ,?, 'Implantação de contratos',
       'Transição automática do comercial para operação após oportunidade ganha.',
       'operations','["oportunidade","cliente","contrato"]','{}','active',30,?,?,?)`,
  ).bind(boardId, TENANT_ID, access.ownerId, user.id, agora, agora).run();
  const relations = [
    { type: "opportunity", id: oportunidade.id },
    ...(oportunidade.clientId ? [{ type: "client", id: oportunidade.clientId }] : []),
  ];
  const { meta } = await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_work_items
       (id,tenant_id,workspace_owner_id,board_id,type,title,description,status,priority,
        responsible_user_id,responsible_label,client_label,due_date,fields_json,relations_json,
        dependencies_json,revision,created_by,updated_by,created_at,updated_at,archived_at)
     VALUES (?,?,?,?, 'handoff', ?, ?, 'novo','alta',NULL,'Operações',?,?,?,?,'[]',1,?,?,?,?,NULL)`,
  ).bind(
    itemId, TENANT_ID, access.ownerId, boardId,
    `Implantar operação de ${oportunidade.cliente || "cliente"}`,
    "Validar contrato, kick-off, responsáveis, integrações, frota, indicadores e data de início.",
    oportunidade.cliente || "", prazo,
    JSON.stringify({ source: "opportunity_won", opportunityId: oportunidade.id, clientId: oportunidade.clientId || "" }),
    JSON.stringify(relations), user.id, user.id, agora, agora,
  ).run();
  if (meta?.changes) await env.DB.prepare(
    `INSERT INTO todogreen_work_item_events
       (id,workspace_owner_id,board_id,item_id,actor_user_id,action,before_json,after_json,created_at)
     VALUES (?,?,?,?,?,'created_from_won_opportunity','{}',?,?)`,
  ).bind(crypto.randomUUID(), access.ownerId, boardId, itemId, user.id, JSON.stringify({ opportunityId: oportunidade.id }), agora).run();
};

// Cada coleção declara como uma linha vira registro e como um registro vira
// linha. Sem essa tabela, cada endpoint reescreveria o mesmo mapeamento com
// uma diferença sutil — e a diferença sutil é o que faz o painel somar errado.
// Campos da oportunidade que têm coluna própria. O que sobra é guardado como
// payload em vez de descartado — é ali que estão ocupação prevista, frota de
// baixa emissão, veículos disponíveis, meses de contrato e probabilidade, que
// a análise de oportunidade usa e esta tabela não precisa indexar.
const COLUNAS_DA_OPORTUNIDADE = new Set([
  "id", "clientId", "cliente", "clientName", "estagio", "stage",
  "valorMensal", "valorContrato", "distanciaKm", "viagensMes", "tipoVeiculo",
  "responsavelId", "ultimaInteracaoEm", "lastInteractionAt", "campos",
  "revision", "criadoEm", "atualizadoEm",
]);

const extrasDaOportunidade = (corpo) =>
  Object.fromEntries(
    Object.entries(corpo).filter(
      ([chave, valor]) => !COLUNAS_DA_OPORTUNIDADE.has(chave) && valor !== undefined,
    ),
  );

const COLECOES = {
  opportunities: {
    tabela: "todogreen_opportunities",
    permissao: "crm:manage",
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      // O que não tem coluna própria volta primeiro, e as colunas mandam por
      // cima. A tela de oportunidades manda mais campos do que esta tabela
      // indexa — ocupação prevista, frota limpa, veículos disponíveis, meses
      // de contrato, probabilidade — e todos alimentam a análise. Descartá-los
      // no caminho faria a oportunidade voltar do servidor mais pobre do que
      // saiu, com a análise mudando sozinha depois de recarregar a página.
      ...parse(row.fields_json, {}),
      id: row.id,
      clientId: row.client_id,
      cliente: row.client_name,
      estagio: row.stage,
      valorMensal: row.monthly_value,
      valorContrato: row.contract_value,
      distanciaKm: row.distance_km,
      viagensMes: row.trips_per_month,
      tipoVeiculo: row.vehicle_type,
      responsavelId: row.owner_user_id || "",
      ultimaInteracaoEm: row.last_interaction_at || "",
      // O motor de oportunidade lê `lastInteractionAt`. Devolver os dois nomes
      // evita um adaptador a mais entre a API e o domínio.
      lastInteractionAt: row.last_interaction_at || "",
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      client_name: texto(corpo.cliente || corpo.clientName, 200),
      stage: texto(corpo.estagio || corpo.stage, 60) || "Mapeamento",
      monthly_value: numero(corpo.valorMensal),
      contract_value: numero(corpo.valorContrato),
      distance_km: numero(corpo.distanciaKm),
      trips_per_month: numero(corpo.viagensMes),
      vehicle_type: texto(corpo.tipoVeiculo, 120),
      owner_user_id: texto(corpo.responsavelId, 120) || null,
      last_interaction_at: texto(corpo.ultimaInteracaoEm || corpo.lastInteractionAt, 40) || null,
      fields_json: JSON.stringify({ ...objeto(corpo.campos), ...extrasDaOportunidade(corpo) }),
    }),
    exigido: (corpo) => (texto(corpo.cliente || corpo.clientName) ? "" : "Informe o cliente da oportunidade."),
  },

  proposals: {
    tabela: "todogreen_proposals",
    permissao: "proposal:manage",
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id,
      cliente: row.client_name,
      oportunidadeId: row.opportunity_id,
      cenarioId: row.scenario_id,
      titulo: row.title,
      escopo: row.scope,
      condicoes: row.commercial_terms,
      riscos: row.risks,
      texto: row.proposal_text,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      client_name: texto(corpo.cliente || corpo.clientName, 200),
      opportunity_id: texto(corpo.oportunidadeId, 120),
      scenario_id: texto(corpo.cenarioId, 120),
      title: texto(corpo.titulo, 240),
      scope: texto(corpo.escopo, 4000),
      commercial_terms: texto(corpo.condicoes, 4000),
      risks: texto(corpo.riscos, 4000),
      proposal_text: texto(corpo.texto, 8000),
      status: texto(corpo.situacao, 40) || "draft",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    // Uma proposta sem simulação por trás é preço sem conta. O vínculo é
    // exigido aqui, no servidor, e não só no botão da tela.
    exigido: (corpo) =>
      texto(corpo.cenarioId)
        ? ""
        : "A proposta precisa apontar para a simulação que gerou o preço.",
  },

  contracts: {
    tabela: "todogreen_contracts",
    permissao: "proposal:manage",
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id,
      cliente: row.client_name,
      oportunidadeId: row.opportunity_id,
      propostaId: row.proposal_id,
      cenarioId: row.scenario_id,
      titulo: row.title,
      inicioEm: row.start_date || "",
      fimEm: row.end_date || "",
      valorMensal: row.monthly_value,
      valorTotal: row.total_value,
      situacao: row.status,
      termos: row.terms,
      assinatura: row.signature_status || "pending",
      assinadoEm: row.signed_at || "",
      renovacao: row.renewal_type || "manual",
      avisoRenovacaoEm: row.renewal_notice_date || "",
      diaFaturamento: row.billing_day || null,
      responsavelId: row.responsible_user_id || "",
      antecedenciaAvisoDias: row.notice_days || 60,
      versao: row.version || 1,
      servicoId: row.service_id || "",
      tabelaPrecoId: row.price_table_id || "",
      sla: parse(row.sla_json, {}),
      condicoesComerciais: parse(row.commercial_terms_json, {}),
      impostos: parse(row.taxes_json, {}),
      regrasFaturamento: parse(row.billing_rules_json, {}),
      indiceReajuste: row.adjustment_index || "",
      dataBaseReajuste: row.adjustment_base_date || "",
      compromissoMinimo: row.minimum_commitment || 0,
      aprovacao: row.approval_status || "pending",
      aprovadoPor: row.approved_by || "",
      aprovadoEm: row.approved_at || "",
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      client_name: texto(corpo.cliente || corpo.clientName, 200),
      opportunity_id: texto(corpo.oportunidadeId, 120),
      proposal_id: texto(corpo.propostaId, 120),
      scenario_id: texto(corpo.cenarioId, 120),
      title: texto(corpo.titulo, 240),
      start_date: texto(corpo.inicioEm, 20) || null,
      end_date: texto(corpo.fimEm, 20) || null,
      monthly_value: numero(corpo.valorMensal),
      total_value: numero(corpo.valorTotal),
      status: texto(corpo.situacao, 40) || "draft",
      terms: texto(corpo.termos, 8000),
      signature_status: ["pending", "sent", "signed", "rejected", "expired"].includes(texto(corpo.assinatura, 40))
        ? texto(corpo.assinatura, 40) : "pending",
      signed_at: texto(corpo.assinadoEm, 40) || null,
      renewal_type: ["manual", "automatic", "none"].includes(texto(corpo.renovacao, 40))
        ? texto(corpo.renovacao, 40) : "manual",
      renewal_notice_date: texto(corpo.avisoRenovacaoEm, 20) || null,
      billing_day: Math.min(31, Math.max(1, Math.trunc(numero(corpo.diaFaturamento)))) || null,
      responsible_user_id: texto(corpo.responsavelId, 120) || null,
      notice_days: Math.min(365, Math.max(0, Math.trunc(numero(corpo.antecedenciaAvisoDias) || 60))),
      service_id: texto(corpo.servicoId, 120),
      price_table_id: texto(corpo.tabelaPrecoId, 120),
      sla_json: JSON.stringify(objeto(corpo.sla)),
      commercial_terms_json: JSON.stringify(objeto(corpo.condicoesComerciais)),
      taxes_json: JSON.stringify(objeto(corpo.impostos)),
      billing_rules_json: JSON.stringify(objeto(corpo.regrasFaturamento)),
      adjustment_index: texto(corpo.indiceReajuste, 80),
      adjustment_base_date: texto(corpo.dataBaseReajuste, 20) || null,
      minimum_commitment: Math.max(0, numero(corpo.compromissoMinimo)),
      approval_status: ["pending", "approved", "rejected"].includes(texto(corpo.aprovacao, 40))
        ? texto(corpo.aprovacao, 40) : "pending",
      approved_by: texto(corpo.aprovadoPor, 120) || null,
      approved_at: texto(corpo.aprovadoEm, 40) || null,
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      !texto(corpo.clientId)
        ? "O contrato precisa de um cliente."
        : !texto(corpo.propostaId)
          ? "O contrato precisa apontar para a proposta aceita."
          : !texto(corpo.titulo)
            ? "Informe o título do contrato."
            : "",
  },

  operations: {
    // Fonte canônica compartilhada com o Portal do Cliente. Antes o painel
    // escrevia em todogreen_operations e o cliente lia outra tabela.
    tabela: "todogreen_client_operations",
    permissao: "operations:manage",
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id,
      produtoId: row.product_id,
      mesReferencia: row.service_date ? row.service_date.slice(0, 7) : "",
      referencia: row.reference,
      contratoId: row.contract_id || "",
      dataServico: row.service_date || "",
      origem: row.origin || "",
      destino: row.destination || "",
      prometidoEm: row.promised_at || "",
      entregueEm: row.delivered_at || "",
      etaEm: row.eta_at || "",
      placa: row.vehicle_plate || "",
      motorista: row.driver_name || "",
      sla: row.sla_status || "",
      comprovanteUrl: row.proof_url || "",
      comprovanteHash: row.proof_hash || "",
      ultimaPosicaoEm: row.last_position_at || "",
      latitude: row.last_position_lat,
      longitude: row.last_position_lng,
      entregas: numero(parse(row.fields_json, {}).deliveries),
      pacotes: numero(parse(row.fields_json, {}).packages),
      viagens: numero(parse(row.fields_json, {}).trips),
      distanciaKm: numero(row.distance_km || parse(row.fields_json, {}).distanceKm),
      ocupacaoPercent: numero(parse(row.fields_json, {}).occupancyPercent),
      ocorrencias: numero(row.incident_count),
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      product_id: texto(corpo.produtoId, 120),
      contract_id: texto(corpo.contratoId, 120),
      reference: texto(corpo.referencia || corpo.rota, 200),
      service_date: /^\d{4}-\d{2}-\d{2}$/.test(texto(corpo.dataServico, 10))
        ? texto(corpo.dataServico, 10)
        : /^\d{4}-\d{2}$/.test(texto(corpo.mesReferencia, 10))
          ? `${texto(corpo.mesReferencia, 10)}-01`
          : null,
      origin: texto(corpo.origem, 200),
      destination: texto(corpo.destino, 200),
      promised_at: texto(corpo.prometidoEm, 40) || null,
      delivered_at: texto(corpo.entregueEm, 40) || null,
      eta_at: texto(corpo.etaEm, 40) || null,
      vehicle_plate: texto(corpo.placa, 20).toUpperCase(),
      driver_name: texto(corpo.motorista, 160),
      distance_km: numero(corpo.distanciaKm),
      incident_count: numero(corpo.ocorrencias),
      sla_status: texto(corpo.sla, 40),
      proof_url: texto(corpo.comprovanteUrl, 2000),
      proof_hash: texto(corpo.comprovanteHash, 160),
      last_position_at: texto(corpo.ultimaPosicaoEm, 40) || null,
      last_position_lat: corpo.latitude === "" || corpo.latitude == null ? null : numero(corpo.latitude),
      last_position_lng: corpo.longitude === "" || corpo.longitude == null ? null : numero(corpo.longitude),
      status: texto(corpo.situacao, 40) || "active",
      fields_json: JSON.stringify({
        ...objeto(corpo.campos),
        deliveries: numero(corpo.entregas),
        packages: numero(corpo.pacotes),
        trips: numero(corpo.viagens),
        distanceKm: numero(corpo.distanciaKm),
        occupancyPercent: numero(corpo.ocupacaoPercent),
      }),
    }),
    exigido: (corpo) => (texto(corpo.clientId) ? "" : "Informe o cliente da operação."),
  },

  financial: {
    tabela: "todogreen_financial_entries",
    permissao: "finance:manage",
    ordem: "reference_month DESC, updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      tipo: row.kind,
      clientId: row.client_id,
      produtoId: row.product_id,
      cenarioId: row.scenario_id,
      categoria: row.category,
      descricao: row.description,
      valor: row.amount,
      mesReferencia: row.reference_month,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      vencimentoEm: row.due_date || "",
      pagoEm: row.paid_at || "",
      valorPago: row.paid_amount || 0,
      contraparte: row.counterparty || "",
      numeroDocumento: row.document_number || "",
      centroCusto: row.cost_center || "",
      codigoOrcamento: row.budget_code || "",
      meioPagamento: row.payment_method || "",
      competenciaEm: row.competence_date || "",
      contratoId: row.contract_id || "",
      statusFinanceiro: row.invoice_status || "pending",
      // Eixos do relatório (migração 0056). As colunas de texto `categoria` e
      // `centroCusto` continuam valendo como detalhe livre; estas apontam para o
      // cadastro e é por elas que o relatório soma sem depender de grafia.
      accountId: row.account_id || "",
      costCenterId: row.cost_center_id || "",
      bankAccountId: row.bank_account_id || "",
      multaPercent: row.late_fee_percent || 0,
      jurosMesPercent: row.late_interest_month_percent || 0,
      conciliadoEm: row.reconciled_at || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      kind: ["revenue", "cost", "commission"].includes(texto(corpo.tipo)) ? texto(corpo.tipo) : "cost",
      client_id: texto(corpo.clientId, 120),
      product_id: texto(corpo.produtoId, 120),
      scenario_id: texto(corpo.cenarioId, 120),
      category: texto(corpo.categoria, 120),
      description: texto(corpo.descricao, 500),
      amount: numero(corpo.valor),
      reference_month: texto(corpo.mesReferencia, 10),
      status: texto(corpo.situacao, 40) || "confirmed",
      due_date: texto(corpo.vencimentoEm, 20) || null,
      paid_at: texto(corpo.pagoEm, 40) || null,
      paid_amount: Math.max(0, numero(corpo.valorPago)),
      counterparty: texto(corpo.contraparte, 200),
      document_number: texto(corpo.numeroDocumento, 120),
      cost_center: texto(corpo.centroCusto, 120),
      budget_code: texto(corpo.codigoOrcamento, 120),
      payment_method: texto(corpo.meioPagamento, 80),
      competence_date: texto(corpo.competenciaEm, 20) || null,
      contract_id: texto(corpo.contratoId, 120),
      invoice_status: ["pending", "partial", "paid", "overdue", "cancelled"].includes(texto(corpo.statusFinanceiro, 40))
        ? texto(corpo.statusFinanceiro, 40) : "pending",
      account_id: texto(corpo.accountId, 120),
      cost_center_id: texto(corpo.costCenterId, 120),
      bank_account_id: texto(corpo.bankAccountId, 120),
      // Percentual negativo não gera crédito; o encargo do atraso só pode
      // aumentar o que se deve.
      late_fee_percent: Math.max(0, numero(corpo.multaPercent)),
      late_interest_month_percent: Math.max(0, numero(corpo.jurosMesPercent)),
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      ["revenue", "cost", "commission"].includes(texto(corpo.tipo))
        ? numero(corpo.valor) > 0
          ? ""
          : "Informe o valor do lançamento."
        : "Informe se o lançamento é receita, custo ou comissão.",
  },

  // ===== Cadastros de base do ERP (migração 0053) =====
  //
  // Os cinco entram pelo caminho genérico porque são CRUD puro: nenhum tem
  // efeito colateral, cálculo de saldo ou máquina de estados. O que tem regra
  // — movimento de estoque, apuração de imposto, fechamento de folha — ganha
  // handler próprio justamente por não caber aqui.
  //
  // Todos são `escopoDeCarteira: false`: cadastro da empresa não pertence à
  // carteira de vendedor nenhum, e a validação vem de `erpCoreDomain.js`, a
  // mesma que a tela usa — para o botão não liberar o que o servidor recusa.

  items: {
    tabela: "todogreen_items",
    permissao: "stock:manage",
    escopoDeCarteira: false,
    ordem: "name ASC",
    daLinha: (row) => ({
      id: row.id,
      codigo: row.code,
      nome: row.name,
      unidade: row.unit,
      categoria: row.category,
      ncm: row.ncm,
      cest: row.cest,
      custoReferencia: row.standard_cost,
      estoqueMinimo: row.min_stock,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      code: normalizeSku(corpo.codigo),
      name: texto(corpo.nome, 200),
      // A unidade já vem validada por `exigido`; normalizar de novo aqui evita
      // que "kg" e "KG" virem dois saldos do mesmo material.
      unit: normalizeUnit(corpo.unidade),
      category: texto(corpo.categoria, 120),
      ncm: texto(corpo.ncm, 8).replace(/\D+/g, ""),
      cest: texto(corpo.cest, 7).replace(/\D+/g, ""),
      standard_cost: Math.max(0, numero(corpo.custoReferencia)),
      min_stock: Math.max(0, numero(corpo.estoqueMinimo)),
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      validateItem({
        name: corpo.nome,
        unit: corpo.unidade,
        ncm: corpo.ncm,
        standardCost: corpo.custoReferencia,
        minStock: corpo.estoqueMinimo,
      }),
  },

  warehouses: {
    tabela: "todogreen_warehouses",
    permissao: "stock:manage",
    escopoDeCarteira: false,
    ordem: "name ASC",
    daLinha: (row) => ({
      id: row.id,
      codigo: row.code,
      nome: row.name,
      tipo: row.kind,
      veiculoId: row.vehicle_id,
      endereco: row.address,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      code: texto(corpo.codigo, 40).toUpperCase(),
      name: texto(corpo.nome, 200),
      kind: ["proprio", "terceiro", "veiculo", "transito"].includes(texto(corpo.tipo))
        ? texto(corpo.tipo)
        : "proprio",
      vehicle_id: texto(corpo.veiculoId, 120),
      address: texto(corpo.endereco, 400),
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      validateWarehouse({ name: corpo.nome, kind: corpo.tipo, vehicleId: corpo.veiculoId }),
  },

  parties: {
    tabela: "todogreen_parties",
    // Escrita é de compras: é quem cadastra fornecedor. A conta comercial
    // continua sendo escrita em `todogreen_clients`, com a carteira valendo lá.
    permissao: "purchase:manage",
    // A parte tem `client_id`, mas o recorte de carteira aqui esconderia todo
    // fornecedor (client_id vazio) de operações e financeiro — exatamente de
    // quem precisa dele. O que é sensível por carteira (score, pipeline,
    // forecast, responsável) nunca esteve nesta tabela; aqui há só dado
    // cadastral e fiscal.
    escopoDeCarteira: false,
    ordem: "legal_name ASC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id,
      documento: row.document,
      razaoSocial: row.legal_name,
      nomeFantasia: row.trade_name,
      papeis: parse(row.roles_json, []),
      inscricaoEstadual: row.state_registration,
      inscricaoMunicipal: row.city_registration,
      regimeTributario: row.tax_regime,
      endereco: parse(row.address_json, {}),
      prazoPagamentoDias: row.payment_term_days,
      email: row.email,
      telefone: row.phone,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      // Só dígitos: duas grafias do mesmo CNPJ viram dois fornecedores, e o
      // índice único não pegaria porque as strings diferem.
      document: normalizeDocument(corpo.documento),
      legal_name: texto(corpo.razaoSocial, 240),
      trade_name: texto(corpo.nomeFantasia, 240),
      roles_json: JSON.stringify(normalizePartyRoles(corpo.papeis)),
      state_registration: texto(corpo.inscricaoEstadual, 40),
      city_registration: texto(corpo.inscricaoMunicipal, 40),
      tax_regime: texto(corpo.regimeTributario, 60),
      address_json: JSON.stringify(objeto(corpo.endereco)),
      payment_term_days: Math.max(0, Math.trunc(numero(corpo.prazoPagamentoDias))),
      email: texto(corpo.email, 200),
      phone: texto(corpo.telefone, 60),
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      validateParty({
        legalName: corpo.razaoSocial,
        roles: corpo.papeis,
        document: corpo.documento,
        paymentTermDays: corpo.prazoPagamentoDias,
      }),
  },

  accounts: {
    tabela: "todogreen_chart_of_accounts",
    permissao: "finance:manage",
    escopoDeCarteira: false,
    ordem: "code ASC, name ASC",
    daLinha: (row) => ({
      id: row.id,
      codigo: row.code,
      nome: row.name,
      natureza: row.kind,
      paiId: row.parent_id,
      analitica: row.analytical === 1,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      code: texto(corpo.codigo, 40),
      name: texto(corpo.nome, 200),
      kind: ["receita", "despesa", "ativo", "passivo", "resultado"].includes(texto(corpo.natureza))
        ? texto(corpo.natureza)
        : "despesa",
      parent_id: texto(corpo.paiId, 120),
      analytical: corpo.analitica === false ? 0 : 1,
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validateAccount({ name: corpo.nome, kind: corpo.natureza }),
  },

  costCenters: {
    tabela: "todogreen_cost_centers",
    permissao: "finance:manage",
    escopoDeCarteira: false,
    ordem: "code ASC, name ASC",
    daLinha: (row) => ({
      id: row.id,
      codigo: row.code,
      nome: row.name,
      paiId: row.parent_id,
      responsavelId: row.owner_user_id || "",
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      code: texto(corpo.codigo, 40),
      name: texto(corpo.nome, 200),
      parent_id: texto(corpo.paiId, 120),
      owner_user_id: texto(corpo.responsavelId, 120) || null,
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validateCostCenter({ name: corpo.nome }),
  },

  // Conta bancária é CRUD puro; o que tem regra — importar extrato, conciliar,
  // fechar período — mora em `todogreen-treasury.js`. O saldo NÃO fica aqui:
  // `opening_balance` é o saldo inicial (premissa), e o saldo de hoje é ele mais
  // o que foi conciliado, calculado por `saldoDaConta`.
  bankAccounts: {
    tabela: "todogreen_bank_accounts",
    permissao: "finance:manage",
    escopoDeCarteira: false,
    ordem: "name ASC",
    daLinha: (row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      bancoCodigo: row.bank_code,
      agencia: row.branch,
      conta: row.account_number,
      chavePix: row.pix_key,
      saldoInicial: row.opening_balance,
      aberturaEm: row.opening_date || "",
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      name: texto(corpo.name ?? corpo.nome, 200),
      kind: ["corrente", "poupanca", "caixa", "aplicacao", "cartao"].includes(texto(corpo.kind))
        ? texto(corpo.kind)
        : "corrente",
      bank_code: texto(corpo.bancoCodigo, 20),
      branch: texto(corpo.agencia, 20),
      account_number: texto(corpo.conta, 40),
      pix_key: texto(corpo.chavePix, 200),
      // Saldo inicial pode ser negativo: conta com limite usado começa no
      // vermelho, e forçar zero mentiria sobre a posição de caixa.
      opening_balance: numero(corpo.saldoInicial),
      opening_date: texto(corpo.aberturaEm, 20) || null,
      status: texto(corpo.situacao, 40) || "ativa",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validateBankAccount({ name: corpo.name ?? corpo.nome, kind: corpo.kind }),
  },
};

const nomeDaColecao = (colecao) =>
  Object.entries(COLECOES).find(([, configuracao]) => configuracao === colecao)?.[0] || "record";

const validarFinanceiro = (corpo, atual = null) => {
  const valor = numero(corpo.valor);
  const pago = Math.max(0, numero(corpo.valorPago));
  if (pago > valor + 0.0001) return "O valor pago não pode superar o valor do lançamento.";
  if (!atual && pago > 0)
    return "Crie o lançamento e use a ação de baixa para registrar o pagamento com histórico.";
  if (
    atual
    && Object.prototype.hasOwnProperty.call(corpo, "valorPago")
    && Math.abs(pago - numero(atual.paid_amount)) > 0.0001
  ) return "O valor pago só pode mudar por uma baixa financeira.";
  return "";
};

const registrarEventoContrato = async (env, access, user, contractId, action, before, after, note = "") => {
  await env.DB.prepare(
    `INSERT INTO todogreen_contract_events
       (id,tenant_id,workspace_owner_id,contract_id,action,before_json,after_json,note,actor_user_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    crypto.randomUUID(), TENANT_ID, access.ownerId, contractId, action,
    JSON.stringify(before || {}), JSON.stringify(after || {}), texto(note, 1000), user.id,
    new Date().toISOString(),
  ).run();
};

// A simulação é um retrato, não um cadastro: ela registra o que a régua e as
// premissas diziam no momento em que alguém calculou. Editar uma simulação
// salva seria reescrever o passado — então ela nasce e não muda. Quem precisa
// de outro número faz outra simulação.
//
// Por isso `pricing_scenarios` não tem revision nem archived_at, e por isso
// esta coleção não passa pelo caminho genérico de atualizar e arquivar.
const CENARIOS = {
  daLinha: (row) => ({
    id: row.id,
    productId: row.product_id,
    clientId: row.client_id,
    opportunityId: row.opportunity_id,
    ruleVersion: row.rule_version,
    inputs: parse(row.inputs_json, {}),
    result: parse(row.result_json, {}),
    approvals: parse(row.approvals_json, {}),
    premissas: parse(row.premises_json, {}),
    status: row.status,
    criadoPor: row.created_by,
    criadoEm: row.created_at,
  }),
};

const listarCenarios = async (env, access, email, { clienteId = "", limit = 200, offset = 0 } = {}) => {
  const recorte = recorteDeCarteira(access, email, "pricing_scenarios");
  const filtroCliente = clienteId ? "AND pricing_scenarios.client_id = ?" : "";
  const paramsFiltro = clienteId ? [clienteId] : [];
  const base = `FROM pricing_scenarios
      WHERE tenant_id = ? AND workspace_owner_id = ? ${filtroCliente} ${recorte.sql}`;
  const params = [TENANT_ID, access.ownerId, ...paramsFiltro, ...recorte.params];
  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(`SELECT * ${base} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);
  return { registros: (results || []).map(CENARIOS.daLinha), total: totalRow?.total || 0 };
};

const criarCenario = async (env, access, user, corpo) => {
  const produto = texto(corpo.productId, 80);
  if (!produto) return json({ error: "Informe o produto da simulação." }, 400);
  const resultado = objeto(corpo.result);
  if (!Object.keys(resultado).length)
    return json({ error: "A simulação precisa do resultado calculado." }, 400);

  const id = texto(corpo.id, 120) || crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO pricing_scenarios
       (id, tenant_id, workspace_owner_id, product_id, client_id, opportunity_id, created_by,
        rule_version, inputs_json, result_json, approvals_json, premises_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      TENANT_ID,
      access.ownerId,
      produto,
      texto(corpo.clientId, 120),
      texto(corpo.opportunityId, 120),
      user.id,
      texto(corpo.ruleVersion, 60) || "padrao",
      JSON.stringify(objeto(corpo.inputs)),
      JSON.stringify(resultado),
      JSON.stringify(objeto(corpo.approvals)),
      JSON.stringify(objeto(corpo.premissas)),
      texto(corpo.status, 40) || "draft",
      agora,
    )
    .run();

  const row = await env.DB.prepare(
    "SELECT * FROM pricing_scenarios WHERE id = ? AND workspace_owner_id = ?",
  )
    .bind(id, access.ownerId)
    .first();
  const registro = CENARIOS.daLinha(row);
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "created", resourceType: "scenario", resourceId: id,
    clientId: registro.clientId, after: registro,
  });
  return json({ registro }, 201);
};

// O recorte de carteira só faz sentido em coleção que pertence a um cliente.
// Um cadastro da empresa — material, depósito, plano de contas, centro de custo,
// fornecedor — não tem dono comercial, e essas tabelas não têm sequer a coluna
// `client_id` que o recorte referencia. Sem esta saída, o SQL do recorte
// quebraria a leitura para todo papel que não vê a carteira inteira e, pior,
// faria `noAlcanceDaCarteira` devolver 404 em silêncio (ele engole o erro no
// `.catch`), o que pareceria "registro não encontrado" em vez de defeito.
//
// Quem declara `escopoDeCarteira: false` está dizendo "isto é cadastro da
// empresa, não carteira de ninguém" — e continua protegido pelos outros dois
// cortes, tenant e espaço, que valem sempre.
const recorteDaColecao = (colecao, access, email) =>
  colecao.escopoDeCarteira === false
    ? { sql: "", params: [] }
    : recorteDeCarteira(access, email, "t");

// A leitura carrega o recorte de carteira além do escopo de espaço. São dois
// cortes diferentes: o espaço separa empresas, a carteira separa vendedores
// dentro da mesma empresa. Sem o segundo, um vendedor lista as oportunidades
// dos colegas.
const listar = async (env, colecao, access, email, { clienteId = "", limit = 500, offset = 0 } = {}) => {
  const recorte = recorteDaColecao(colecao, access, email);
  const porCliente = clienteId && colecao.escopoDeCarteira !== false;
  const filtroCliente = porCliente ? "AND t.client_id = ?" : "";
  const paramsFiltro = porCliente ? [clienteId] : [];
  const base = `FROM ${colecao.tabela} t
      WHERE t.tenant_id = ? AND t.workspace_owner_id = ? AND t.archived_at IS NULL ${filtroCliente} ${recorte.sql}`;
  const params = [TENANT_ID, access.ownerId, ...paramsFiltro, ...recorte.params];
  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(
      `SELECT t.* ${base}
        ORDER BY ${colecao.ordem.replace(/\b(updated_at|reference_month)\b/g, "t.$1")}
        LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);
  return { registros: (results || []).map(colecao.daLinha), total: totalRow?.total || 0 };
};

// Confirma que o registro está na carteira de quem pede, ANTES de escrever.
// 404 e não 403 quando está fora: dizer "existe mas não é sua" já entrega que
// o registro existe.
const noAlcanceDaCarteira = async (env, colecao, access, email, id) => {
  const recorte = recorteDaColecao(colecao, access, email);
  return env.DB
    .prepare(
      `SELECT t.id FROM ${colecao.tabela} t
        WHERE t.id = ? AND t.tenant_id = ? AND t.workspace_owner_id = ? AND t.archived_at IS NULL ${recorte.sql}
        LIMIT 1`,
    )
    .bind(id, TENANT_ID, access.ownerId, ...recorte.params)
    .first()
    .catch(() => null);
};

// A tela já recusa gerar a proposta quando o Deal Desk não liberou a
// simulação — "Guarda no código, não só no `disabled`", diz o comentário lá.
// Só que o guarda estava no componente React, e qualquer chamada direta a
// este endpoint passava por cima dele. A régua é a mesma (liberacaoDaProposta,
// de dealDeskDomain.js); o que muda é onde ela é aplicada.
const proposalLiberada = async (env, access, cenarioId) => {
  const { results } = await env.DB.prepare(
    "SELECT * FROM todogreen_deal_desk_requests WHERE workspace_owner_id = ? AND scenario_id = ?",
  )
    .bind(access.ownerId, cenarioId)
    .all();
  return liberacaoDaProposta(cenarioId, (results || []).map(pedidoDoBanco));
};

// A trava do fechamento de período (migração 0056). Um mês fechado não aceita
// lançamento novo, alteração nem arquivamento — é o que faz um resultado
// publicado continuar valendo. Sem isso, o resultado de janeiro poderia mudar em
// dezembro e nenhum relatório emitido antes continuaria verdadeiro.
//
// Vale para as DUAS competências numa alteração: a de onde o lançamento está e a
// para onde ele iria. Checar só uma permitiria tirar um lançamento de um mês
// fechado (mudando o resultado dele) ou empurrar um lançamento para dentro dele.
const bloqueioDeCompetencia = async (env, access, ...entradas) => {
  const { results } = await env.DB.prepare(
    `SELECT reference_month AS referenceMonth, status FROM todogreen_financial_periods
      WHERE tenant_id = ? AND workspace_owner_id = ? AND status = 'fechado'`,
  ).bind(TENANT_ID, access.ownerId).all();
  const periodos = results || [];
  if (!periodos.length) return "";
  for (const entrada of entradas) {
    if (!entrada) continue;
    const bloqueio = bloqueioPorFechamento(entrada, periodos);
    if (bloqueio) return bloqueio;
  }
  return "";
};

const criar = async (env, colecao, access, user, corpo) => {
  const erro = colecao.exigido(corpo);
  if (erro) return json({ error: erro }, 400);
  if (colecao === COLECOES.financial) {
    const erroFinanceiro = validarFinanceiro(corpo);
    if (erroFinanceiro) return json({ error: erroFinanceiro }, 400);
    const travado = await bloqueioDeCompetencia(env, access, corpo);
    if (travado) return json({ error: travado }, 409);
  }

  if (colecao === COLECOES.proposals) {
    const liberacao = await proposalLiberada(env, access, texto(corpo.cenarioId, 120));
    if (!liberacao.liberada) return json({ error: liberacao.motivo }, 409);
  }

  if (colecao === COLECOES.contracts) {
    const propostaId = texto(corpo.propostaId, 120);
    const proposta = await env.DB.prepare(
      `SELECT id,client_id,client_name,opportunity_id,scenario_id,status
         FROM todogreen_proposals
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
    ).bind(propostaId, TENANT_ID, access.ownerId).first();
    if (!proposta) return json({ error: "Proposta não encontrada neste espaço." }, 404);
    if (!new Set(["accepted", "approved", "aceita", "aprovada"]).has(texto(proposta.status).toLowerCase()))
      return json({ error: "Aceite a proposta antes de gerar o contrato." }, 409);
    if (texto(corpo.clientId) !== texto(proposta.client_id))
      return json({ error: "O cliente do contrato não corresponde ao da proposta." }, 409);
    const existente = await env.DB.prepare(
      `SELECT id FROM todogreen_contracts
        WHERE tenant_id=? AND workspace_owner_id=? AND proposal_id=? AND archived_at IS NULL`,
    ).bind(TENANT_ID, access.ownerId, propostaId).first();
    if (existente) return json({ error: "Esta proposta já possui contrato ativo." }, 409);
    corpo = {
      ...corpo,
      cliente: corpo.cliente || proposta.client_name,
      oportunidadeId: corpo.oportunidadeId || proposta.opportunity_id,
      cenarioId: corpo.cenarioId || proposta.scenario_id,
      aprovadoPor: texto(corpo.aprovacao, 40) === "approved" ? user.id : "",
      aprovadoEm: texto(corpo.aprovacao, 40) === "approved" ? new Date().toISOString() : "",
    };
  }

  if (colecao === COLECOES.operations) {
    const cliente = await env.DB.prepare(
      `SELECT id FROM todogreen_clients
        WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ?
          AND archived_at IS NULL AND status = 'ativo'`,
    ).bind(TENANT_ID, access.ownerId, texto(corpo.clientId, 120)).first();
    if (!cliente) return json({ error: "Cliente não encontrado neste espaço." }, 404);
  }

  const valores = colecao.colunas(corpo);
  const campos = Object.keys(valores);
  const agora = new Date().toISOString();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO ${colecao.tabela}
       (id, tenant_id, workspace_owner_id, ${campos.join(", ")},
        revision, created_by, updated_by, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ${campos.map(() => "?").join(", ")}, 1, ?, ?, ?, ?, NULL)`,
  )
    .bind(id, TENANT_ID, access.ownerId, ...campos.map((c) => valores[c]), user.id, user.id, agora, agora)
    .run();

  const row = await env.DB.prepare(
    `SELECT * FROM ${colecao.tabela} WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  )
    .bind(id, TENANT_ID, access.ownerId)
    .first();
  const registro = colecao.daLinha(row);
  const tipo = nomeDaColecao(colecao);
  if (colecao === COLECOES.contracts)
    await registrarEventoContrato(env, access, user, id, "created", {}, registro, texto(corpo.nota, 1000));
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "created", resourceType: tipo, resourceId: id,
    clientId: registro.clientId, after: registro,
  });
  return json({ registro }, 201);
};

const atualizar = async (env, colecao, access, user, id, corpo) => {
  const atual = await env.DB.prepare(
    `SELECT * FROM ${colecao.tabela}
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  )
    .bind(id, TENANT_ID, access.ownerId)
    .first();
  // 404 e não 403: dizer "existe, mas não é seu" já entrega que existe. Vale
  // tanto para registro de outro espaço quanto para cliente fora da carteira.
  if (!atual) return json({ error: "Registro não encontrado." }, 404);
  if (!(await noAlcanceDaCarteira(env, colecao, access, user.email, id)))
    return json({ error: "Registro não encontrado." }, 404);

  // A revisão vem de quem edita, não do banco. Se viesse do banco, o UPDATE
  // sempre casaria e a trava de concorrência não travaria nada — que é o
  // mesmo comportamento do JSON único que esta tabela veio substituir.
  const revisaoEsperada = Number(corpo.revision);
  if (!Number.isFinite(revisaoEsperada) || revisaoEsperada <= 0)
    return json({ error: "Informe a revisão do registro que você leu." }, 400);

  const proximo = { ...colecao.daLinha(atual), ...corpo };
  if (colecao === COLECOES.contracts && texto(corpo.aprovacao, 40)) {
    proximo.aprovadoPor = texto(corpo.aprovacao, 40) === "approved" ? user.id : "";
    proximo.aprovadoEm = texto(corpo.aprovacao, 40) === "approved" ? new Date().toISOString() : "";
  }
  const erro = colecao.exigido(proximo);
  if (erro) return json({ error: erro }, 400);
  if (colecao === COLECOES.financial) {
    const erroFinanceiro = validarFinanceiro(corpo, atual);
    if (erroFinanceiro) return json({ error: erroFinanceiro }, 400);
    // As duas competências: de onde sai e para onde vai.
    const travado = await bloqueioDeCompetencia(env, access, colecao.daLinha(atual), proximo);
    if (travado) return json({ error: travado }, 409);
  }

  if (colecao === COLECOES.operations) {
    const cliente = await env.DB.prepare(
      `SELECT id FROM todogreen_clients
        WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ?
          AND archived_at IS NULL AND status = 'ativo'`,
    ).bind(TENANT_ID, access.ownerId, texto(proximo.clientId, 120)).first();
    if (!cliente) return json({ error: "Cliente não encontrado neste espaço." }, 404);
  }

  const valores = colecao.colunas(proximo);
  const campos = Object.keys(valores);
  const agora = new Date().toISOString();

  const { meta } = await env.DB.prepare(
    `UPDATE ${colecao.tabela}
        SET ${campos.map((c) => `${c} = ?`).join(", ")},
            revision = revision + 1${colecao === COLECOES.contracts ? ", version = version + 1" : ""},
            updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND revision = ?`,
  )
    .bind(...campos.map((c) => valores[c]), user.id, agora, id, TENANT_ID, access.ownerId, revisaoEsperada)
    .run();

  // Alguém salvou entre a leitura e a escrita. Sobrescrever aqui seria repetir
  // o defeito do JSON único, que é justamente o motivo desta tabela existir.
  if (!meta?.changes)
    return json(
      { error: "Este registro mudou enquanto você editava. Recarregue para ver a versão atual." },
      409,
    );

  const row = await env.DB.prepare(
    `SELECT * FROM ${colecao.tabela} WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  )
    .bind(id, TENANT_ID, access.ownerId)
    .first();
  const antes = colecao.daLinha(atual);
  const depois = colecao.daLinha(row);
  if (colecao === COLECOES.opportunities && deveCriarHandoff(atual.stage, row.stage))
    await criarHandoffOperacional(env, access, user, depois);
  if (colecao === COLECOES.contracts)
    await registrarEventoContrato(env, access, user, id, "updated", antes, depois, texto(corpo.nota, 1000));
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "updated", resourceType: nomeDaColecao(colecao), resourceId: id,
    clientId: depois.clientId, before: antes, after: depois,
  });
  return json({ registro: depois });
};

const arquivar = async (env, colecao, access, user, id) => {
  if (!(await noAlcanceDaCarteira(env, colecao, access, user.email, id)))
    return json({ error: "Registro não encontrado." }, 404);
  const atual = await env.DB.prepare(
    `SELECT * FROM ${colecao.tabela}
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, access.ownerId).first();

  // Arquivar um lançamento de mês fechado mudaria um resultado já publicado.
  if (colecao === COLECOES.financial && atual) {
    const travado = await bloqueioDeCompetencia(env, access, colecao.daLinha(atual));
    if (travado) return json({ error: travado }, 409);
  }

  const agora = new Date().toISOString();
  // Arquiva em vez de apagar: o histórico é a única defesa quando alguém
  // pergunta, meses depois, de onde veio um número.
  const { meta } = await env.DB.prepare(
    `UPDATE ${colecao.tabela}
        SET archived_at = ?, updated_by = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  )
    .bind(agora, user.id, agora, id, TENANT_ID, access.ownerId)
    .run();
  if (!meta?.changes) return json({ error: "Registro não encontrado." }, 404);
  const antes = atual ? colecao.daLinha(atual) : {};
  if (colecao === COLECOES.contracts)
    await registrarEventoContrato(env, access, user, id, "archived", antes, {}, "Contrato arquivado.");
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "archived", resourceType: nomeDaColecao(colecao), resourceId: id,
    clientId: antes.clientId, before: antes,
  });
  return json({ ok: true });
};

const listarEventosOperacao = async (env, access, user, operationId) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.operations, access, user.email, operationId)))
    return json({ error: "Operação não encontrada." }, 404);
  const { results } = await env.DB.prepare(
    `SELECT id,kind,titulo,descricao,local,ocorrido_em,registrado_por,created_at
       FROM todogreen_client_operation_events
      WHERE tenant_id=? AND workspace_owner_id=? AND operation_id=?
      ORDER BY ocorrido_em DESC, created_at DESC LIMIT 300`,
  ).bind(TENANT_ID, access.ownerId, operationId).all();
  return json({
    eventos: (results || []).map((row) => ({
      id: row.id, tipo: row.kind, titulo: row.titulo, descricao: row.descricao,
      local: row.local, ocorridoEm: row.ocorrido_em, registradoPor: row.registrado_por,
      criadoEm: row.created_at,
    })),
  });
};

const registrarEventoOperacao = async (env, access, user, operationId, corpo) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.operations, access, user.email, operationId)))
    return json({ error: "Operação não encontrada." }, 404);
  const operacao = await env.DB.prepare(
    `SELECT * FROM todogreen_client_operations
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(operationId, TENANT_ID, access.ownerId).first();
  const tipos = new Set(["coleta", "transito", "chegada", "entrega", "ocorrencia", "reagendamento", "documento"]);
  const tipo = tipos.has(texto(corpo.tipo, 40)) ? texto(corpo.tipo, 40) : "transito";
  const titulo = texto(corpo.titulo, 200);
  const descricao = texto(corpo.descricao, 3000);
  if (!titulo && !descricao) return json({ error: "Informe o título ou a descrição do evento." }, 400);
  const ocorridoEm = texto(corpo.ocorridoEm, 40) || new Date().toISOString();
  const agora = new Date().toISOString();
  const eventoId = crypto.randomUUID();
  const atualizacaoIncidente = tipo === "ocorrencia" ? ", incident_count = incident_count + 1" : "";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO todogreen_client_operation_events
         (id,tenant_id,operation_id,client_id,workspace_owner_id,kind,titulo,descricao,local,
          ocorrido_em,registrado_por,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      eventoId, TENANT_ID, operationId, operacao.client_id, access.ownerId, tipo, titulo,
      descricao, texto(corpo.local, 300), ocorridoEm, user.id, agora,
    ),
    env.DB.prepare(
      `UPDATE todogreen_client_operations
          SET updated_at=?, updated_by=?, revision=revision+1${atualizacaoIncidente}
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
    ).bind(agora, user.id, operationId, TENANT_ID, access.ownerId),
  ]);
  const atualizada = await env.DB.prepare(
    `SELECT * FROM todogreen_client_operations
      WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(operationId, TENANT_ID, access.ownerId).first();
  const evento = { id: eventoId, tipo, titulo, descricao, local: texto(corpo.local, 300), ocorridoEm, registradoPor: user.id, criadoEm: agora };
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "event_added", resourceType: "operations", resourceId: operationId,
    clientId: operacao.client_id, before: COLECOES.operations.daLinha(operacao),
    after: COLECOES.operations.daLinha(atualizada), details: `${tipo}: ${titulo || descricao}`,
  });
  return json({ evento, registro: COLECOES.operations.daLinha(atualizada) }, 201);
};

const listarPagamentos = async (env, access, user, entryId) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.financial, access, user.email, entryId)))
    return json({ error: "Lançamento não encontrado." }, 404);
  const { results } = await env.DB.prepare(
    `SELECT id,amount,paid_at,payment_method,reference,notes,created_by,created_at
       FROM todogreen_financial_payments
      WHERE tenant_id=? AND workspace_owner_id=? AND entry_id=?
      ORDER BY paid_at DESC, created_at DESC LIMIT 300`,
  ).bind(TENANT_ID, access.ownerId, entryId).all();
  return json({
    pagamentos: (results || []).map((row) => ({
      id: row.id, valor: row.amount, pagoEm: row.paid_at, meioPagamento: row.payment_method,
      referencia: row.reference, observacoes: row.notes, criadoPor: row.created_by, criadoEm: row.created_at,
    })),
  });
};

const registrarPagamento = async (env, access, user, entryId, corpo) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.financial, access, user.email, entryId)))
    return json({ error: "Lançamento não encontrado." }, 404);
  const lancamento = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(entryId, TENANT_ID, access.ownerId).first();
  const revisao = Number(corpo.revision);
  if (!Number.isFinite(revisao) || revisao !== Number(lancamento.revision))
    return json({ error: "O lançamento mudou. Recarregue antes de registrar a baixa." }, 409);
  if (lancamento.invoice_status === "cancelled")
    return json({ error: "Um lançamento cancelado não pode receber baixa." }, 409);
  const valor = numero(corpo.valor);
  const restante = Math.max(0, numero(lancamento.amount) - numero(lancamento.paid_amount));
  if (valor <= 0) return json({ error: "Informe um valor de baixa maior que zero." }, 400);
  if (valor > restante + 0.0001)
    return json({ error: `A baixa supera o saldo aberto de ${restante.toFixed(2)}.` }, 409);
  const pagoEm = texto(corpo.pagoEm, 40) || new Date().toISOString();
  const novoPago = numero(lancamento.paid_amount) + valor;
  const novoStatus = novoPago >= numero(lancamento.amount) - 0.0001 ? "paid" : "partial";
  const agora = new Date().toISOString();
  const pagamentoId = crypto.randomUUID();
  const [updateResult, insertResult] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE todogreen_financial_entries
          SET paid_amount=?, paid_at=?, payment_method=?, invoice_status=?, revision=revision+1,
              updated_by=?, updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=? AND archived_at IS NULL`,
    ).bind(
      novoPago, novoStatus === "paid" ? pagoEm : lancamento.paid_at,
      texto(corpo.meioPagamento, 80), novoStatus, user.id, agora,
      entryId, TENANT_ID, access.ownerId, revisao,
    ),
    env.DB.prepare(
      `INSERT INTO todogreen_financial_payments
         (id,tenant_id,workspace_owner_id,entry_id,amount,paid_at,payment_method,reference,notes,created_by,created_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?
        WHERE EXISTS (
          SELECT 1 FROM todogreen_financial_entries
           WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?
        )`,
    ).bind(
      pagamentoId, TENANT_ID, access.ownerId, entryId, valor, pagoEm,
      texto(corpo.meioPagamento, 80), texto(corpo.referencia, 160), texto(corpo.observacoes, 1000),
      user.id, agora, entryId, TENANT_ID, access.ownerId, revisao + 1,
    ),
  ]);
  if (!updateResult?.meta?.changes || !insertResult?.meta?.changes)
    return json({ error: "O lançamento mudou. Recarregue antes de registrar a baixa." }, 409);
  const atualizada = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries
      WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(entryId, TENANT_ID, access.ownerId).first();
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "payment_added", resourceType: "financial", resourceId: entryId,
    clientId: lancamento.client_id, before: COLECOES.financial.daLinha(lancamento),
    after: COLECOES.financial.daLinha(atualizada), details: `Baixa ${pagamentoId}`,
  });
  return json({
    pagamento: {
      id: pagamentoId, valor, pagoEm, meioPagamento: texto(corpo.meioPagamento, 80),
      referencia: texto(corpo.referencia, 160), observacoes: texto(corpo.observacoes, 1000),
    },
    registro: COLECOES.financial.daLinha(atualizada),
  }, 201);
};

const listarEventosContrato = async (env, access, user, contractId) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.contracts, access, user.email, contractId)))
    return json({ error: "Contrato não encontrado." }, 404);
  const { results } = await env.DB.prepare(
    `SELECT id,action,before_json,after_json,note,actor_user_id,created_at
       FROM todogreen_contract_events
      WHERE tenant_id=? AND workspace_owner_id=? AND contract_id=?
      ORDER BY created_at DESC LIMIT 300`,
  ).bind(TENANT_ID, access.ownerId, contractId).all();
  return json({
    eventos: (results || []).map((row) => ({
      id: row.id, acao: row.action, antes: parse(row.before_json, {}), depois: parse(row.after_json, {}),
      nota: row.note, atorId: row.actor_user_id, criadoEm: row.created_at,
    })),
  });
};

export async function handleTodoGreenVerticalRecords(request, env, access, user) {
  const url = new URL(request.url);
  const partes = url.pathname.split("/").filter(Boolean); // api, todogreen, records, [colecao], [id]
  const nome = partes[3] || "";
  const id = texto(partes[4], 120);
  const subrecurso = texto(partes[5], 80);

  // Sem coleção na URL: a vertical inteira de uma vez, sem filtro nem
  // página — é a carga do painel, que precisa do total para somar, não de um
  // recorte dele. Filtro e paginação são de quem abre UMA coleção por vez.
  if (!nome) {
    if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
    const nomes = Object.keys(COLECOES);
    const [listas, cenarios] = await Promise.all([
      Promise.all(nomes.map((n) => listar(env, COLECOES[n], access, user.email))),
      listarCenarios(env, access, user.email),
    ]);
    const payload = {
      ...Object.fromEntries(nomes.map((n, i) => [n, listas[i].registros])),
      scenarios: cenarios.registros,
    };
    if (url.searchParams.get("includeTotals") === "1" || request.headers.get("x-todogreen-include-totals") === "1") payload.totals = {
        ...Object.fromEntries(nomes.map((n, i) => [n, listas[i].total])),
        scenarios: cenarios.total,
      };
    return json(payload);
  }

  if (nome === "scenarios") {
    if (request.method === "GET") {
      const { limit, offset } = paginacao(url);
      const clienteId = texto(url.searchParams.get("cliente"), 120);
      const resultado = await listarCenarios(env, access, user.email, { clienteId, limit, offset });
      return json({ ...resultado, limit, offset });
    }
    if (request.method === "POST") {
      if (!podeNaVertical(access, "pricing:simulate"))
        return json({ error: "Seu papel não pode salvar simulações." }, 403);
      return criarCenario(env, access, user, await request.json().catch(() => ({})));
    }
    return json({ error: "A simulação salva não muda. Faça outra simulação." }, 405);
  }

  const colecao = COLECOES[nome];
  if (!colecao) return json({ error: "Coleção desconhecida." }, 404);

  if (id && subrecurso === "events" && colecao === COLECOES.operations) {
    if (request.method === "GET") return listarEventosOperacao(env, access, user, id);
    if (request.method === "POST") {
      if (!podeNaVertical(access, colecao.permissao))
        return json({ error: "Seu papel não pode registrar eventos operacionais." }, 403);
      return registrarEventoOperacao(env, access, user, id, await request.json().catch(() => ({})));
    }
    return json({ error: "Método não permitido." }, 405);
  }

  if (id && subrecurso === "payments" && colecao === COLECOES.financial) {
    if (request.method === "GET") return listarPagamentos(env, access, user, id);
    if (request.method === "POST") {
      if (!podeNaVertical(access, colecao.permissao))
        return json({ error: "Seu papel não pode registrar baixas." }, 403);
      return registrarPagamento(env, access, user, id, await request.json().catch(() => ({})));
    }
    return json({ error: "Método não permitido." }, 405);
  }

  if (id && subrecurso === "events" && colecao === COLECOES.contracts) {
    if (request.method === "GET") return listarEventosContrato(env, access, user, id);
    return json({ error: "O histórico contratual é gerado pelas alterações do contrato." }, 405);
  }

  if (request.method === "GET") {
    const { limit, offset } = paginacao(url);
    const clienteId = texto(url.searchParams.get("cliente"), 120);
    const resultado = await listar(env, colecao, access, user.email, { clienteId, limit, offset });
    return json({ ...resultado, limit, offset });
  }

  // Leitura segue o vínculo; escrita exige permissão. Papel que só consulta
  // não altera premissa comercial.
  if (!podeNaVertical(access, colecao.permissao))
    return json({ error: "Seu papel não pode alterar estes registros." }, 403);

  const corpo = request.method === "DELETE" ? {} : await request.json().catch(() => ({}));

  if (request.method === "POST" && !id) return criar(env, colecao, access, user, corpo);
  if (request.method === "PATCH" && id) return atualizar(env, colecao, access, user, id, corpo);
  if (request.method === "DELETE" && id) return arquivar(env, colecao, access, user, id);
  return json({ error: "Método não permitido." }, 405);
}
