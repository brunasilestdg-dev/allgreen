// ===== A linha do tempo, lida das fontes que já existem =====
//
// Nenhuma tabela nova, nenhum dual-write: as sete tabelas de evento e os
// registros comerciais já guardam tudo. Aqui elas viram uma consulta só,
// sempre dentro do mesmo recorte de carteira do resto da vertical — quem não
// enxerga a conta não enxerga a história dela.

import { recorteDeCarteira, podeNaVertical, TENANT_ID } from "./todogreen-access.js";
import { criarEvento, montarLinhaDoTempo, resumirLinhaDoTempo, TIPOS } from "../../src/features/logistics/accountTimelineDomain.js";
import {
  proximaMelhorAcao,
  saudeDaConta,
  shareOfWallet,
  whiteSpace,
} from "../../src/features/logistics/accountHealthDomain.js";
import { LOGISTICS_PRODUCTS } from "../../src/features/logistics/logisticsVerticalDomain.js";

const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const clean = (value, max = 300) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const parse = (value, fallback) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const linhas = (resultado) => resultado?.results || [];

const BRL = (valor) =>
  Number.isFinite(Number(valor)) && Number(valor) > 0
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(valor))
    : "";

/** Confere que a conta é da carteira de quem pergunta antes de contar a história dela. */
async function contaVisivel(env, access, email, clientId) {
  const scope = recorteDeCarteira(access, email, "c", "id");
  return env.DB.prepare(
    // segment e document entram porque a nota de completude do cadastro os
    // lê: sem eles no SELECT, toda conta apareceria com o cadastro incompleto.
    `SELECT c.id, c.name, c.segment, c.document, c.fields_json FROM todogreen_clients c
      WHERE c.id=? AND c.tenant_id=? AND c.workspace_owner_id=? AND c.archived_at IS NULL ${scope.sql}`,
  ).bind(clientId, TENANT_ID, access.ownerId, ...scope.params).first();
}

export async function reunirEventos(env, { ownerId, clientId, conta }) {
  const bind = [TENANT_ID, ownerId, clientId];
  const [oportunidades, propostas, contratos, operacoes, eventosDeOperacao, solicitacoes, portal, aprovacoes, tarefas] =
    await Promise.all([
      env.DB.prepare(
        `SELECT id,stage,monthly_value,contract_value,created_at,updated_at,last_interaction_at
           FROM todogreen_opportunities
          WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND archived_at IS NULL
          ORDER BY created_at DESC LIMIT 120`).bind(...bind).all(),
      env.DB.prepare(
        `SELECT id,title,status,created_at,updated_at FROM todogreen_proposals
          WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND archived_at IS NULL
          ORDER BY created_at DESC LIMIT 120`).bind(...bind).all(),
      env.DB.prepare(
        `SELECT id,title,status,monthly_value,total_value,start_date,created_at,updated_at
           FROM todogreen_contracts
          WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND archived_at IS NULL
          ORDER BY created_at DESC LIMIT 60`).bind(...bind).all(),
      env.DB.prepare(
        `SELECT id,reference,status,origin,destination,service_date,created_at
           FROM todogreen_client_operations
          WHERE tenant_id=? AND workspace_owner_id=? AND client_id=?
          ORDER BY created_at DESC LIMIT 120`).bind(...bind).all(),
      env.DB.prepare(
        `SELECT id,kind,titulo,descricao,local,ocorrido_em,created_at
           FROM todogreen_client_operation_events
          WHERE tenant_id=? AND workspace_owner_id=? AND client_id=?
          ORDER BY created_at DESC LIMIT 200`).bind(...bind).all(),
      env.DB.prepare(
        `SELECT id,type,subject,status,urgency,created_at,closed_at FROM todogreen_client_requests
          WHERE tenant_id=? AND workspace_owner_id=? AND client_id=?
          ORDER BY created_at DESC LIMIT 120`).bind(...bind).all(),
      // O portal não guarda workspace_owner_id: ele é do cliente, e o cliente
      // já foi conferido contra a carteira antes de chegar aqui.
      env.DB.prepare(
        `SELECT id,email,action,target,details,created_at FROM todogreen_client_portal_events
          WHERE tenant_id=? AND client_id=? ORDER BY created_at DESC LIMIT 200`)
        .bind(TENANT_ID, clientId).all(),
      env.DB.prepare(
        `SELECT e.id,e.kind,e.author_name,e.body,e.created_at,r.client_name
           FROM todogreen_deal_desk_events e
           JOIN todogreen_deal_desk_requests r ON r.id = e.request_id
          WHERE e.workspace_owner_id=? AND lower(r.client_name)=lower(?)
          ORDER BY e.created_at DESC LIMIT 120`).bind(ownerId, conta?.name || "").all(),
      env.DB.prepare(
        `SELECT id,title,type,status,priority,responsible_label,due_date,created_at,updated_at
           FROM todogreen_work_items
          WHERE tenant_id=? AND workspace_owner_id=? AND lower(client_label)=lower(?) AND archived_at IS NULL
          ORDER BY created_at DESC LIMIT 120`).bind(TENANT_ID, ownerId, conta?.name || "").all(),
    ]);

  const eventos = [];
  const add = (evento) => { const pronto = criarEvento(evento); if (pronto) eventos.push(pronto); };

  for (const item of linhas(oportunidades)) {
    add({ id: `opp-${item.id}`, tipo: "oportunidade", quando: item.created_at,
      titulo: `Oportunidade aberta${item.stage ? ` — ${item.stage}` : ""}`,
      detalhe: BRL(item.contract_value || item.monthly_value) ? `Valor estimado ${BRL(item.contract_value || item.monthly_value)}` : "",
      referencia: item.id, valor: item.contract_value || item.monthly_value });
    // A mudança de etapa só vira evento próprio quando de fato houve mudança
    // depois da criação; senão a linha do tempo duplicaria toda oportunidade.
    if (item.updated_at && item.updated_at !== item.created_at)
      add({ id: `opp-mov-${item.id}`, tipo: "oportunidade", quando: item.updated_at,
        titulo: `Oportunidade movida para ${item.stage || "nova etapa"}`, referencia: item.id });
  }

  for (const item of linhas(propostas)) {
    add({ id: `prop-${item.id}`, tipo: "proposta", quando: item.created_at,
      titulo: `Proposta criada — ${clean(item.title, 120) || "sem título"}`, referencia: item.id });
    if (item.updated_at && item.updated_at !== item.created_at)
      add({ id: `prop-st-${item.id}`, tipo: "proposta", quando: item.updated_at,
        titulo: `Proposta ${clean(item.status, 60) || "atualizada"} — ${clean(item.title, 120)}`, referencia: item.id });
  }

  for (const item of linhas(contratos))
    add({ id: `contr-${item.id}`, tipo: "contrato", quando: item.created_at,
      titulo: `Contrato ${clean(item.status, 60) || "registrado"} — ${clean(item.title, 120) || "sem título"}`,
      detalhe: BRL(item.total_value || item.monthly_value) ? `${BRL(item.total_value || item.monthly_value)}${item.start_date ? ` · início ${item.start_date}` : ""}` : "",
      referencia: item.id, valor: item.total_value || item.monthly_value });

  for (const item of linhas(operacoes))
    add({ id: `oper-${item.id}`, tipo: "operacao", quando: item.service_date || item.created_at,
      titulo: `Operação ${clean(item.reference, 80) || "registrada"}${item.status ? ` — ${clean(item.status, 40)}` : ""}`,
      detalhe: [clean(item.origin, 80), clean(item.destination, 80)].filter(Boolean).join(" → "),
      referencia: item.id });

  for (const item of linhas(eventosDeOperacao))
    add({ id: `opev-${item.id}`, tipo: "operacao", quando: item.ocorrido_em || item.created_at,
      titulo: clean(item.titulo, 200) || `Ocorrência ${clean(item.kind, 60)}`,
      detalhe: [clean(item.descricao, 300), clean(item.local, 80)].filter(Boolean).join(" · "),
      referencia: item.operation_id });

  for (const item of linhas(solicitacoes)) {
    add({ id: `sol-${item.id}`, tipo: "solicitacao", quando: item.created_at,
      titulo: `Solicitação aberta — ${clean(item.subject, 140) || clean(item.type, 60)}`,
      detalhe: item.urgency ? `Urgência ${clean(item.urgency, 40)}` : "", referencia: item.id });
    if (item.closed_at)
      add({ id: `sol-fim-${item.id}`, tipo: "solicitacao", quando: item.closed_at,
        titulo: `Solicitação encerrada — ${clean(item.subject, 140)}`, referencia: item.id });
  }

  for (const item of linhas(portal))
    add({ id: `port-${item.id}`, tipo: "portal", quando: item.created_at,
      titulo: `Cliente ${clean(item.action, 80) || "acessou o portal"}${item.target ? ` — ${clean(item.target, 100)}` : ""}`,
      detalhe: clean(item.details, 300), autor: clean(item.email, 160) });

  for (const item of linhas(aprovacoes))
    add({ id: `deal-${item.id}`, tipo: "aprovacao", quando: item.created_at,
      titulo: `Aprovação comercial — ${clean(item.kind, 80) || "movimentação"}`,
      detalhe: clean(item.body, 400), autor: clean(item.author_name, 160) });

  for (const item of linhas(tarefas)) {
    add({ id: `task-${item.id}`, tipo: "tarefa", quando: item.created_at,
      titulo: `Tarefa criada — ${clean(item.title, 160)}`,
      detalhe: [item.due_date ? `prazo ${item.due_date}` : "", clean(item.priority, 40)].filter(Boolean).join(" · "),
      autor: clean(item.responsible_label, 160), referencia: item.id });
    if (item.status === "concluido" && item.updated_at && item.updated_at !== item.created_at)
      add({ id: `task-ok-${item.id}`, tipo: "tarefa", quando: item.updated_at,
        titulo: `Tarefa concluída — ${clean(item.title, 160)}`, referencia: item.id });
  }

  // A pesquisa do Plantû já fica gravada na conta; ela também é história.
  const inteligencia = parse(conta?.fields_json, {})?.intelligence;
  if (inteligencia?.checkedAt) {
    const achados = [
      inteligencia.openRfqs?.length ? `${inteligencia.openRfqs.length} RFQ(s)` : "",
      inteligencia.procurementPeople?.length ? `${inteligencia.procurementPeople.length} contato(s) de procurement` : "",
      inteligencia.esg?.signals?.length ? `${inteligencia.esg.signals.length} sinal(is) ESG` : "",
    ].filter(Boolean);
    add({ id: `sem-${inteligencia.checkedAt}`, tipo: "pesquisa", quando: inteligencia.checkedAt,
      titulo: "Plantû pesquisou a empresa na web",
      detalhe: achados.length ? achados.join(" · ") : "Nenhum sinal acionável comprovado nesta pesquisa.",
      autor: "Plantû" });
  }

  return eventos;
}

/**
 * Saúde, white space, share of wallet e próxima melhor ação da conta.
 *
 * Fica junto da linha do tempo de propósito: as quatro leituras dependem de
 * "há quanto tempo nada acontece", que é a linha do tempo respondendo. Servir
 * em endpoints separados obrigaria a recalcular o histórico duas vezes por
 * abertura de tela.
 */
export async function inteligenciaDaConta(env, { ownerId, clientId, conta, diasSemAtividade }) {
  const campos = parse(conta?.fields_json, {}) || {};
  const [oportunidades, operacoes, cenarios, contratos] = await Promise.all([
    env.DB.prepare(
      `SELECT id,stage,monthly_value,contract_value FROM todogreen_opportunities
        WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND archived_at IS NULL LIMIT 200`)
      .bind(TENANT_ID, ownerId, clientId).all(),
    env.DB.prepare(
      `SELECT product_id,incident_count,sla_status FROM todogreen_client_operations
        WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? LIMIT 400`)
      .bind(TENANT_ID, ownerId, clientId).all(),
    env.DB.prepare(
      `SELECT product_id FROM pricing_scenarios
        WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? LIMIT 200`)
      .bind(TENANT_ID, ownerId, clientId).all(),
    env.DB.prepare(
      `SELECT monthly_value,total_value,status FROM todogreen_contracts
        WHERE tenant_id=? AND workspace_owner_id=? AND client_id=? AND archived_at IS NULL LIMIT 60`)
      .bind(TENANT_ID, ownerId, clientId).all(),
  ]);

  const contatos = Array.isArray(campos.contacts) ? campos.contacts : [];
  const espacos = whiteSpace({
    catalogo: LOGISTICS_PRODUCTS,
    operacoes: linhas(operacoes),
    oportunidades: linhas(cenarios),
    contratos: [],
  });

  // Receita anual nossa sai dos contratos ativos. O gasto logístico total do
  // cliente é dado DELE — se ninguém registrou, o share of wallet diz que não
  // dá para saber, em vez de fingir que somos 100%.
  const receitaAnualNossa = linhas(contratos)
    .filter((item) => String(item.status || "").toLowerCase() !== "encerrado")
    .reduce((soma, item) => soma + (Number(item.monthly_value) || 0) * 12, 0);

  return {
    saude: saudeDaConta({
      conta: {
        segment: conta?.segment,
        document: conta?.document,
        stage: campos.stage,
        nextAction: campos.nextAction,
        headquarters: campos.headquarters,
      },
      contatos,
      oportunidades: linhas(oportunidades),
      operacoes: linhas(operacoes),
      diasSemAtividade,
    }),
    whiteSpace: espacos,
    shareOfWallet: shareOfWallet({
      receitaAnualNossa,
      gastoLogisticoAnualDoCliente: Number(campos.gastoLogisticoAnual) || 0,
    }),
    proximaAcao: proximaMelhorAcao({
      conta: { nextAction: campos.nextAction },
      contatos,
      oportunidades: linhas(oportunidades),
      espacos: espacos.espacos,
      diasSemAtividade,
      pesquisaEm: campos.intelligence?.checkedAt || null,
    }),
  };
}

export async function handleTodoGreenTimeline(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  if (request.method !== "GET") return response({ error: "Método não permitido." }, 405);
  if (!podeNaVertical(access, "read")) return response({ error: "Você não tem acesso à To Do Green." }, 403);

  const url = new URL(request.url);
  const clientId = clean(url.pathname.split("/").filter(Boolean)[3], 60) || clean(url.searchParams.get("cliente"), 60);
  if (!clientId) return response({ error: "Informe o cliente." }, 400);

  const email = String(user?.email || "").trim().toLowerCase();
  const conta = await contaVisivel(env, access, email, clientId);
  if (!conta) return response({ error: "Conta não encontrada na sua carteira." }, 404);

  const tipos = (url.searchParams.get("tipos") || "")
    .split(",").map((item) => item.trim()).filter((item) => TIPOS.includes(item));
  const eventos = await reunirEventos(env, { ownerId: access.ownerId, clientId, conta });
  const linhaDoTempo = montarLinhaDoTempo(eventos, {
    tipos,
    desde: clean(url.searchParams.get("desde"), 30) || undefined,
    ate: clean(url.searchParams.get("ate"), 30) || undefined,
    limite: Math.min(500, Math.max(1, Number(url.searchParams.get("limite")) || 300)),
  });

  const resumo = resumirLinhaDoTempo(linhaDoTempo);
  const inteligencia = await inteligenciaDaConta(env, {
    ownerId: access.ownerId,
    clientId,
    conta,
    diasSemAtividade: resumo.diasSemAtividade,
  });

  return response({
    cliente: { id: conta.id, nome: conta.name },
    eventos: linhaDoTempo,
    resumo,
    ...inteligencia,
  });
}
