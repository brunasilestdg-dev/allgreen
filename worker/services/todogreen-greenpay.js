// ===== GreenPay — carteira de ganhos do motorista (backend, fase 1) =====
//
// Produto próprio, NÃO folha (essa é todogreen-payroll.js, do RH). Aqui vive a
// carteira do motorista: ganho DERIVADO das viagens entregues (nunca digitado),
// ajustes manuais do gestor, e o ciclo pendente → aprovado → pago. Saldo é soma.
//
// Duas portas: o motorista lê a PRÓPRIA carteira pelo portal (driver:self,
// carteiraDoMotorista); o gestor administra régua, ajustes e pagamentos aqui
// (finance:manage). A geração do ganho é chamada quando a entrega é registrada
// da rua (todogreen-driver-portal), idempotente por (operação, tipo).

import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import {
  derivarGanhosDaViagem,
  reguaConfigurada,
  normalizarRegua,
  resumoCarteira,
  PARAMETROS_GREENPAY_PADRAO,
  arredondarReais,
} from "../../src/features/logistics/greenPayDomain.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const texto = (valor, max = 300) => String(valor ?? "").trim().slice(0, max);
const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const parseJson = (valor, padrao) => {
  try { return JSON.parse(valor || ""); } catch { return padrao; }
};
const hojeYmd = () => new Date().toISOString().slice(0, 10);

// --- Régua ---------------------------------------------------------------

export const lerRegua = async (env, ownerId) => {
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_driver_earning_rules
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(TENANT_ID, ownerId).first();
  if (!row) return null;
  return {
    valorPorEntrega: numero(row.value_per_delivery),
    valorPorKm: numero(row.value_per_km),
    bonusEntregaSemOcorrencia: numero(row.bonus_no_incident),
    revision: numero(row.revision) || 1,
    atualizadoEm: row.updated_at || "",
  };
};

const salvarRegua = async (env, ownerId, userId, corpo) => {
  const atual = await lerRegua(env, ownerId);
  const regra = normalizarRegua({
    valorPorEntrega: corpo.valorPorEntrega,
    valorPorKm: corpo.valorPorKm,
    bonusEntregaSemOcorrencia: corpo.bonusEntregaSemOcorrencia,
  });
  const agora = new Date().toISOString();
  if (!atual) {
    await env.DB.prepare(
      `INSERT INTO todogreen_driver_earning_rules
         (id, tenant_id, workspace_owner_id, value_per_delivery, value_per_km,
          bonus_no_incident, config_json, revision, updated_by, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', 1, ?, ?, ?, NULL)`,
    ).bind(crypto.randomUUID(), TENANT_ID, ownerId, regra.valorPorEntrega, regra.valorPorKm,
      regra.bonusEntregaSemOcorrencia, userId, agora, agora).run();
  } else {
    await env.DB.prepare(
      `UPDATE todogreen_driver_earning_rules
         SET value_per_delivery = ?, value_per_km = ?, bonus_no_incident = ?,
             revision = revision + 1, updated_by = ?, updated_at = ?
       WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(regra.valorPorEntrega, regra.valorPorKm, regra.bonusEntregaSemOcorrencia,
      userId, agora, TENANT_ID, ownerId).run();
  }
  return lerRegua(env, ownerId);
};

// --- Geração do ganho derivado (idempotente) -----------------------------

const dataDaOperacao = (operacao) =>
  texto(operacao.service_date, 10) || String(operacao.delivered_at || "").slice(0, 10) || hojeYmd();

// Chamada quando a entrega é registrada. Sem régua configurada, não gera nada.
// A unicidade (workspace, operation_id, kind) faz reprocessar não duplicar.
export const gerarGanhosDaEntrega = async (env, ownerId, operacao, userId) => {
  const regra = await lerRegua(env, ownerId);
  if (!reguaConfigurada(regra)) return { gerados: 0, configurada: false };

  const viagem = {
    entregueEm: operacao.delivered_at || "",
    distanciaKm: numero(operacao.distance_km),
    ocorrencias: numero(operacao.incident_count),
  };
  const lancamentos = derivarGanhosDaViagem(viagem, regra);
  if (!lancamentos.length) return { gerados: 0, configurada: true };

  const agora = new Date().toISOString();
  const dataServico = dataDaOperacao(operacao);
  const referencia = texto(operacao.reference, 120);
  let gerados = 0;
  for (const l of lancamentos) {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO todogreen_driver_earnings
         (id, tenant_id, workspace_owner_id, driver_id, operation_id, kind, amount,
          reference, service_date, status, memory_json, settlement_id, note, created_by, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, NULL, NULL, ?, ?, ?, NULL)`,
    ).bind(crypto.randomUUID(), TENANT_ID, ownerId, operacao.driver_id, operacao.id, l.tipo,
      l.valor, referencia, dataServico, JSON.stringify(l.memoria || {}), userId, agora, agora).run();
    if (res.meta?.changes) gerados += 1;
  }
  return { gerados, configurada: true };
};

// --- Carteira do motorista (lida pelo portal do motorista) ---------------

const lancamentoDaLinha = (row) => ({
  id: row.id,
  tipo: row.kind,
  valor: numero(row.amount),
  referencia: row.reference || "",
  dataServico: row.service_date || "",
  status: row.status || "pendente",
  memoria: parseJson(row.memory_json, {}),
  operacaoId: row.operation_id || "",
  observacao: row.note || "",
  criadoEm: row.created_at || "",
});

export const carteiraDoMotorista = async (env, ownerId, driverId) => {
  const regra = await lerRegua(env, ownerId);
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_driver_earnings
      WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ? AND archived_at IS NULL
      ORDER BY service_date DESC, created_at DESC LIMIT 200`,
  ).bind(TENANT_ID, ownerId, driverId).all();
  const lancamentos = (results || []).map(lancamentoDaLinha);
  return {
    configurada: reguaConfigurada(regra),
    regra: regra ? normalizarRegua(regra) : PARAMETROS_GREENPAY_PADRAO,
    resumo: resumoCarteira(lancamentos, hojeYmd()),
    extrato: lancamentos,
  };
};

// --- Admin: visão do gestor, ajustes, aprovação, pagamento, sync ---------

const podeGerenciar = (access) => podeNaVertical(access, "finance:manage");

const visaoDosMotoristas = async (env, ownerId) => {
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.full_name,
            COALESCE(SUM(e.amount), 0) AS total,
            COALESCE(SUM(CASE WHEN e.status = 'pendente' THEN e.amount ELSE 0 END), 0) AS pendente,
            COALESCE(SUM(CASE WHEN e.status = 'aprovado' THEN e.amount ELSE 0 END), 0) AS aprovado,
            COALESCE(SUM(CASE WHEN e.status = 'pago' THEN e.amount ELSE 0 END), 0) AS pago,
            COUNT(e.id) AS lancamentos
       FROM todogreen_drivers d
       LEFT JOIN todogreen_driver_earnings e
         ON e.driver_id = d.id AND e.workspace_owner_id = d.workspace_owner_id AND e.archived_at IS NULL
      WHERE d.tenant_id = ? AND d.workspace_owner_id = ? AND d.archived_at IS NULL
      GROUP BY d.id
      ORDER BY pendente DESC, aprovado DESC, d.full_name ASC`,
  ).bind(TENANT_ID, ownerId).all();
  return (results || []).map((r) => ({
    driverId: r.id,
    nome: r.full_name || "",
    total: arredondarReais(r.total),
    pendente: arredondarReais(r.pendente),
    aprovado: arredondarReais(r.aprovado),
    pago: arredondarReais(r.pago),
    aReceber: arredondarReais(numero(r.pendente) + numero(r.aprovado)),
    lancamentos: numero(r.lancamentos),
  }));
};

export async function handleTodoGreenGreenPay(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  if (!podeGerenciar(access))
    return json({ error: "GreenPay é da gestão financeira." }, 403);

  const url = new URL(request.url);
  const partes = url.pathname.split("/").filter(Boolean); // api, todogreen, greenpay, [recurso], [id]
  const recurso = texto(partes[3], 40);
  const id = texto(partes[4], 120);
  const ownerId = access.ownerId;

  if (request.method === "GET" && recurso === "regua") {
    const regra = await lerRegua(env, ownerId);
    return json({ configurada: reguaConfigurada(regra), regra: regra || PARAMETROS_GREENPAY_PADRAO });
  }

  if (request.method === "PUT" && recurso === "regua") {
    const corpo = await request.json().catch(() => ({}));
    const regra = await salvarRegua(env, ownerId, user.id, corpo);
    return json({ ok: true, configurada: reguaConfigurada(regra), regra });
  }

  if (request.method === "GET" && (recurso === "" || recurso === "motoristas") && !id) {
    return json({ motoristas: await visaoDosMotoristas(env, ownerId) });
  }

  if (request.method === "GET" && recurso === "motoristas" && id) {
    return json(await carteiraDoMotorista(env, ownerId, id));
  }

  // Ajuste manual: bônus (+), desconto (-) ou correção (sinal informado).
  if (request.method === "POST" && recurso === "ajuste") {
    const corpo = await request.json().catch(() => ({}));
    const driverId = texto(corpo.driverId, 120);
    const tipo = texto(corpo.tipo, 20);
    if (!driverId) return json({ error: "Informe o motorista." }, 400);
    if (!["bonus", "desconto", "ajuste"].includes(tipo))
      return json({ error: "Tipo deve ser bonus, desconto ou ajuste." }, 400);
    const bruto = Math.abs(arredondarReais(corpo.valor));
    if (!(bruto > 0)) return json({ error: "Informe um valor maior que zero." }, 400);
    const valor = tipo === "desconto" ? -bruto : bruto;
    const agora = new Date().toISOString();
    const dataServico = texto(corpo.dataServico, 10) || hojeYmd();
    await env.DB.prepare(
      `INSERT INTO todogreen_driver_earnings
         (id, tenant_id, workspace_owner_id, driver_id, operation_id, kind, amount,
          reference, service_date, status, memory_json, settlement_id, note, created_by, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, '', ?, 'pendente', '{}', NULL, ?, ?, ?, ?, NULL)`,
    ).bind(crypto.randomUUID(), TENANT_ID, ownerId, driverId, tipo, valor, dataServico,
      texto(corpo.observacao, 300), user.id, agora, agora).run();
    return json({ ok: true, carteira: await carteiraDoMotorista(env, ownerId, driverId) });
  }

  // Aprova tudo que está pendente de um motorista.
  if (request.method === "POST" && recurso === "aprovar") {
    const corpo = await request.json().catch(() => ({}));
    const driverId = texto(corpo.driverId, 120);
    if (!driverId) return json({ error: "Informe o motorista." }, 400);
    const agora = new Date().toISOString();
    const res = await env.DB.prepare(
      `UPDATE todogreen_driver_earnings
         SET status = 'aprovado', updated_at = ?
       WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ?
         AND status = 'pendente' AND archived_at IS NULL`,
    ).bind(agora, TENANT_ID, ownerId, driverId).run();
    return json({ ok: true, aprovados: res.meta?.changes || 0, carteira: await carteiraDoMotorista(env, ownerId, driverId) });
  }

  // Paga tudo que está aprovado de um motorista, num lote (settlement).
  if (request.method === "POST" && recurso === "pagar") {
    const corpo = await request.json().catch(() => ({}));
    const driverId = texto(corpo.driverId, 120);
    if (!driverId) return json({ error: "Informe o motorista." }, 400);
    const settlement = crypto.randomUUID();
    const agora = new Date().toISOString();
    const res = await env.DB.prepare(
      `UPDATE todogreen_driver_earnings
         SET status = 'pago', settlement_id = ?, updated_at = ?
       WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ?
         AND status = 'aprovado' AND archived_at IS NULL`,
    ).bind(settlement, agora, TENANT_ID, ownerId, driverId).run();
    return json({ ok: true, pagos: res.meta?.changes || 0, settlementId: settlement, carteira: await carteiraDoMotorista(env, ownerId, driverId) });
  }

  // Backfill: gera o ganho das entregas que já aconteceram antes da régua
  // existir (ou antes do GreenPay). Idempotente — não duplica o que já tem.
  if (request.method === "POST" && recurso === "sincronizar") {
    const regra = await lerRegua(env, ownerId);
    if (!reguaConfigurada(regra))
      return json({ error: "Configure a régua de ganhos antes de sincronizar." }, 409);
    const { results } = await env.DB.prepare(
      `SELECT * FROM todogreen_client_operations
        WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
          AND driver_id IS NOT NULL AND driver_id != '' AND delivered_at IS NOT NULL`,
    ).bind(TENANT_ID, ownerId).all();
    let gerados = 0, viagens = 0;
    for (const operacao of results || []) {
      const r = await gerarGanhosDaEntrega(env, ownerId, operacao, user.id);
      if (r.gerados) { gerados += r.gerados; viagens += 1; }
    }
    return json({ ok: true, viagensProcessadas: (results || []).length, viagensComGanhoNovo: viagens, lancamentosCriados: gerados });
  }

  return json({ error: "Rota do GreenPay não encontrada." }, 404);
}
