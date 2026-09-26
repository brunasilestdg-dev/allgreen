// ===== Portal do Colaborador (PJ e CLT) =====
//
// Resolve QUEM é a pessoa pelo e-mail da sessão (todogreen_employees.work_email
// ou personal_email) e entrega só OS DADOS DELA. Duas naturezas de vínculo:
//
//  - PJ (employment_type='pj'): self-service. Informa a PRÓPRIA chave PIX e
//    IMPUTA a própria nota fiscal (número, competência, valor, anexo). O valor
//    é conferido contra o valor esperado (salário/contrato, ajustável). Nota
//    aprovada vira conta a pagar; o repasse sai por PIX (SysPag, dormente).
//
//  - CLT (demais vínculos): só LEITURA dos próprios dados. Banco/PIX são
//    cadastrados pelo RH (dado sensível, LGPD). Divergência não é editada aqui:
//    a pessoa abre um chamado (fatia CLT).
//
// O lado da gestão (RH/financeiro) analisa, ajusta o esperado, aprova, recusa e
// paga as notas em /gestao/* — atrás de finance:manage ou hr:manage.

import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { bloqueioDeCompetencia } from "./vertical-records/gates.js";
import { validarChavePix, TIPOS_CHAVE_PIX } from "../../src/features/logistics/pixDomain.js";
import {
  validarNotaPj,
  conferirNota,
  podeAprovar,
  podeRecusar,
  podePagar,
} from "../../src/features/logistics/pjInvoiceDomain.js";
import { enviarPagamentoSyspag, syspagHabilitado, syspagProntidao } from "./todogreen-syspag.js";
import {
  validarChamado,
  podeAtender,
  podeResolver,
} from "../../src/features/logistics/employeeTicketDomain.js";

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
const arred = (v) => Math.round((numero(v) + Number.EPSILON) * 100) / 100;
const ehPj = (colaborador) => texto(colaborador?.employment_type) === "pj";

const podeGerir = (access) =>
  podeNaVertical(access, "finance:manage") || podeNaVertical(access, "hr:manage");

// O colaborador da sessão, pelo e-mail (corporativo ou pessoal). owner/admin
// passam pela regra geral, mas sem cadastro não há dado a mostrar.
const colaboradorDaSessao = async (env, access, user) => {
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return null;
  return env.DB.prepare(
    `SELECT * FROM todogreen_employees
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
        AND (lower(work_email) = ? OR lower(personal_email) = ?)
      ORDER BY (status = 'active') DESC, updated_at DESC
      LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId, email, email).first();
};

// A conta PIX padrão do colaborador (owner_type='employee'). Nunca devolve o
// segredo de ninguém além do dono — o recorte é sempre owner_id.
const pixDoColaborador = async (env, ownerId, employeeId) => {
  const row = await env.DB.prepare(
    `SELECT pix_key, pix_key_type FROM todogreen_bank_accounts
      WHERE tenant_id = ? AND workspace_owner_id = ? AND owner_type = 'employee'
        AND owner_id = ? AND archived_at IS NULL AND pix_key != ''
      ORDER BY is_default DESC, updated_at DESC
      LIMIT 1`,
  ).bind(TENANT_ID, ownerId, employeeId).first();
  return { chave: row?.pix_key || "", tipo: row?.pix_key_type || "" };
};

const notaDaLinha = (row) => {
  const conf = conferirNota({ valor: row.valor, valorEsperado: row.valor_esperado });
  return {
    id: row.id,
    competencia: row.competencia || "",
    numero: row.numero || "",
    valor: numero(row.valor),
    valorEsperado: numero(row.valor_esperado),
    diferenca: conf.diferenca,
    confere: conf.confere,
    situacaoConferencia: conf.situacao,
    status: row.status || "em_analise",
    documentUrl: row.document_url || "",
    note: row.note || "",
    enviadaEm: row.self_submitted_at || row.created_at || "",
    revisadaEm: row.reviewed_at || "",
    financialEntryId: row.financial_entry_id || "",
    settlementId: row.settlement_id || "",
  };
};

const notasDoColaborador = async (env, ownerId, employeeId) => {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_pj_invoices
      WHERE tenant_id = ? AND workspace_owner_id = ? AND employee_id = ? AND archived_at IS NULL
      ORDER BY competencia DESC, created_at DESC LIMIT 60`,
  ).bind(TENANT_ID, ownerId, employeeId).all();
  return (results || []).map(notaDaLinha);
};

const chamadoDaLinha = (row) => ({
  id: row.id,
  categoria: row.categoria || "outro",
  assunto: row.assunto || "",
  descricao: row.descricao || "",
  status: row.status || "aberto",
  resposta: row.response || "",
  abertoEm: row.created_at || "",
  resolvidoEm: row.resolved_at || "",
});

const chamadosDoColaborador = async (env, ownerId, employeeId) => {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_employee_tickets
      WHERE tenant_id = ? AND workspace_owner_id = ? AND employee_id = ? AND archived_at IS NULL
      ORDER BY (status IN ('aberto','em_andamento')) DESC, created_at DESC LIMIT 40`,
  ).bind(TENANT_ID, ownerId, employeeId).all();
  return (results || []).map(chamadoDaLinha);
};

// ---- self-service (a própria pessoa) ------------------------------------

const responderSessao = async (env, access, colaborador) => {
  if (!colaborador)
    return json({
      vinculado: false,
      aviso: "Seu e-mail ainda não está ligado a um cadastro de colaborador. Peça ao RH para preencher o e-mail no seu cadastro.",
    });
  const pj = ehPj(colaborador);
  const pix = await pixDoColaborador(env, access.ownerId, colaborador.id);
  const notas = pj ? await notasDoColaborador(env, access.ownerId, colaborador.id) : [];
  const chamados = await chamadosDoColaborador(env, access.ownerId, colaborador.id);
  return json({
    vinculado: true,
    colaborador: {
      id: colaborador.id,
      nome: colaborador.full_name,
      tipo: pj ? "pj" : "clt",
      cargo: colaborador.job_title || "",
      departamento: colaborador.department || "",
      // O valor esperado do repasse/salário só faz sentido mostrar ao próprio PJ.
      valorEsperado: pj ? numero(colaborador.salario_base) : null,
      podeImputarNota: pj,
      podeInformarPix: pj, // CLT: banco/PIX é cadastrado pelo RH.
      pix,
      tiposPix: TIPOS_CHAVE_PIX,
    },
    notas,
    chamados,
  });
};

// O colaborador (CLT ou PJ) abre um chamado quando vê divergência nos próprios
// dados. Ele não corrige — quem resolve é a equipe (RH/financeiro).
const abrirChamado = async (env, access, user, colaborador, corpo) => {
  const categoria = texto(corpo.categoria, 30);
  const assunto = texto(corpo.assunto, 160);
  const descricao = texto(corpo.descricao, 2000);
  const validacao = validarChamado({ categoria, assunto, descricao });
  if (!validacao.valido) return json({ error: validacao.erro }, 400);
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_employee_tickets
       (id, tenant_id, workspace_owner_id, employee_id, categoria, assunto, descricao, status,
        response, fields_json, revision, created_by, updated_by, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '', '{}', 1, ?, ?, ?, ?, NULL)`,
  ).bind(id, TENANT_ID, access.ownerId, colaborador.id, categoria, assunto, descricao, user.id, user.id, agora, agora).run();
  return json({ ok: true, id, chamados: await chamadosDoColaborador(env, access.ownerId, colaborador.id) }, 201);
};

// PJ grava a PRÓPRIA chave PIX (destino do repasse). Vai para o cadastro
// canônico de banco/PIX (todogreen_bank_accounts, owner_type='employee'), como
// conta padrão. CLT não passa aqui — seus dados são do RH.
const salvarPixColaborador = async (env, access, user, colaborador, corpo) => {
  if (!ehPj(colaborador))
    return json({ error: "Seus dados bancários são cadastrados pelo RH. Se houver divergência, abra um chamado." }, 403);
  const tipo = texto(corpo.tipo, 20);
  const validacao = validarChavePix(tipo, corpo.chave);
  if (!validacao.valido) return json({ error: validacao.erro }, 400);
  const agora = new Date().toISOString();
  const existente = await env.DB.prepare(
    `SELECT id, revision FROM todogreen_bank_accounts
      WHERE tenant_id = ? AND workspace_owner_id = ? AND owner_type = 'employee' AND owner_id = ?
        AND archived_at IS NULL AND is_default = 1
      LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId, colaborador.id).first();
  if (existente) {
    await env.DB.prepare(
      `UPDATE todogreen_bank_accounts
         SET pix_key = ?, pix_key_type = ?, updated_by = ?, updated_at = ?, revision = revision + 1
       WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(validacao.chave, tipo, user.id, agora, existente.id, TENANT_ID, access.ownerId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO todogreen_bank_accounts
         (id, tenant_id, workspace_owner_id, owner_type, owner_id, pix_key, pix_key_type,
          is_default, status, fields_json, revision, created_by, updated_by, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, 'employee', ?, ?, ?, 1, 'active', '{}', 1, ?, ?, ?, ?, NULL)`,
    ).bind(crypto.randomUUID(), TENANT_ID, access.ownerId, colaborador.id, validacao.chave, tipo,
      user.id, user.id, agora, agora).run();
  }
  return json({ ok: true, pix: { chave: validacao.chave, tipo } });
};

// PJ imputa a PRÓPRIA nota. Reenvio da mesma competência (enquanto em análise ou
// recusada) atualiza a nota existente em vez de duplicar.
const imputarNota = async (env, access, user, colaborador, corpo) => {
  if (!ehPj(colaborador))
    return json({ error: "A imputação de nota fiscal é do prestador PJ." }, 403);
  const numeroNf = texto(corpo.numero, 60);
  const competencia = texto(corpo.competencia, 7);
  const valor = arred(corpo.valor);
  const validacao = validarNotaPj({ numero: numeroNf, valor, competencia });
  if (!validacao.valido) return json({ error: validacao.erro }, 400);
  const documentUrl = texto(corpo.documentUrl, 1000);
  const agora = new Date().toISOString();

  // Uma nota ativa por competência: se já existe uma reenviável, atualiza.
  const existente = await env.DB.prepare(
    `SELECT id, status FROM todogreen_pj_invoices
      WHERE tenant_id = ? AND workspace_owner_id = ? AND employee_id = ? AND competencia = ?
        AND archived_at IS NULL AND status IN ('em_analise','recusada')
      LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId, colaborador.id, competencia).first();
  const bloqueada = await env.DB.prepare(
    `SELECT id FROM todogreen_pj_invoices
      WHERE tenant_id = ? AND workspace_owner_id = ? AND employee_id = ? AND competencia = ?
        AND archived_at IS NULL AND status IN ('aprovada','paga')
      LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId, colaborador.id, competencia).first();
  if (bloqueada) return json({ error: "Já existe uma nota aprovada ou paga nessa competência. Fale com o financeiro." }, 409);

  // Esperado: o salário/contrato PJ atual (a gestão pode ajustar na análise).
  const valorEsperado = arred(colaborador.salario_base);

  if (existente) {
    await env.DB.prepare(
      `UPDATE todogreen_pj_invoices
         SET numero = ?, valor = ?, valor_esperado = ?, document_url = ?, status = 'em_analise',
             note = '', self_submitted_at = ?, updated_by = ?, updated_at = ?, revision = revision + 1
       WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(numeroNf, valor, valorEsperado, documentUrl, agora, user.id, agora, existente.id, TENANT_ID, access.ownerId).run();
    return json({ ok: true, id: existente.id, reenviada: true });
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO todogreen_pj_invoices
       (id, tenant_id, workspace_owner_id, employee_id, competencia, numero, valor, valor_esperado,
        document_url, status, self_submitted_at, note, fields_json, revision, created_by, updated_by, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'em_analise', ?, '', '{}', 1, ?, ?, ?, ?, NULL)`,
  ).bind(id, TENANT_ID, access.ownerId, colaborador.id, competencia, numeroNf, valor, valorEsperado,
    documentUrl, agora, user.id, user.id, agora, agora).run();
  return json({ ok: true, id, reenviada: false }, 201);
};

// ---- gestão (RH/financeiro) ---------------------------------------------

const notaGestaoDaLinha = (row) => ({
  ...notaDaLinha(row),
  colaboradorId: row.employee_id,
  colaboradorNome: row.full_name || "",
});

const listarNotasGestao = async (env, ownerId, url) => {
  const status = texto(url.searchParams.get("status"), 20);
  const filtroStatus = ["em_analise", "aprovada", "recusada", "paga", "cancelada"].includes(status) ? status : "";
  const sql =
    `SELECT n.*, e.full_name FROM todogreen_pj_invoices n
       LEFT JOIN todogreen_employees e ON e.id = n.employee_id AND e.workspace_owner_id = n.workspace_owner_id
      WHERE n.tenant_id = ? AND n.workspace_owner_id = ? AND n.archived_at IS NULL` +
    (filtroStatus ? ` AND n.status = ?` : "") +
    ` ORDER BY (n.status = 'em_analise') DESC, n.competencia DESC, n.created_at DESC LIMIT 200`;
  const binds = filtroStatus ? [TENANT_ID, ownerId, filtroStatus] : [TENANT_ID, ownerId];
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results || []).map(notaGestaoDaLinha);
};

const notaPorId = (env, ownerId, id) =>
  env.DB.prepare(
    `SELECT n.*, e.full_name, e.cost_center_id FROM todogreen_pj_invoices n
       LEFT JOIN todogreen_employees e ON e.id = n.employee_id AND e.workspace_owner_id = n.workspace_owner_id
      WHERE n.id = ? AND n.tenant_id = ? AND n.workspace_owner_id = ? AND n.archived_at IS NULL`,
  ).bind(id, TENANT_ID, ownerId).first();

// A operação ajusta o valor esperado (ex.: proporcional por entrada no meio do
// mês). Não mexe no cadastro — é o esperado DESTA nota.
const ajustarEsperado = async (env, ownerId, user, id, corpo) => {
  const nota = await notaPorId(env, ownerId, id);
  if (!nota) return json({ error: "Nota não encontrada." }, 404);
  const valorEsperado = arred(corpo.valorEsperado);
  if (!(valorEsperado > 0)) return json({ error: "Informe um valor esperado maior que zero." }, 400);
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_pj_invoices SET valor_esperado = ?, updated_by = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND status = 'em_analise'`,
  ).bind(valorEsperado, user.id, agora, id, TENANT_ID, ownerId).run();
  return json({ ok: true });
};

const recusarNota = async (env, ownerId, user, id, corpo) => {
  const nota = await notaPorId(env, ownerId, id);
  if (!nota) return json({ error: "Nota não encontrada." }, 404);
  if (!podeRecusar(nota.status)) return json({ error: "Só uma nota em análise pode ser recusada." }, 409);
  const motivo = texto(corpo.motivo, 300);
  if (!motivo) return json({ error: "Informe o motivo da recusa (o PJ vê e corrige)." }, 400);
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_pj_invoices
       SET status = 'recusada', note = ?, reviewed_by = ?, reviewed_at = ?, updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND status = 'em_analise'`,
  ).bind(motivo, user.id, agora, user.id, agora, id, TENANT_ID, ownerId).run();
  return json({ ok: true });
};

// Aprovar cria a conta a pagar (todogreen_financial_entries kind='cost'). O elo
// financial_entry_id torna idempotente e auditável — a nota vira um passivo real.
const aprovarNota = async (env, ownerId, user, id) => {
  const nota = await notaPorId(env, ownerId, id);
  if (!nota) return json({ error: "Nota não encontrada." }, 404);
  if (!podeAprovar(nota.status)) return json({ error: "Só uma nota em análise pode ser aprovada." }, 409);
  const bloqueio = await bloqueioDeCompetencia(env, { ownerId }, { mesReferencia: nota.competencia });
  if (bloqueio) return json({ error: bloqueio }, 409);
  const agora = new Date().toISOString();
  const entryId = nota.financial_entry_id || crypto.randomUUID();
  if (!nota.financial_entry_id) {
    await env.DB.prepare(
      `INSERT INTO todogreen_financial_entries
         (id, tenant_id, workspace_owner_id, kind, category, description, amount, reference_month,
          status, counterparty, document_number, cost_center_id, competence_date, invoice_status,
          fields_json, revision, created_by, updated_by, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, 'cost', 'Repasse PJ', ?, ?, ?, 'confirmed', ?, ?, ?, ?, 'pending', ?, 1, ?, ?, ?, ?, NULL)`,
    ).bind(
      entryId, TENANT_ID, ownerId,
      `NF ${nota.numero} — ${nota.full_name || "prestador PJ"}`,
      numero(nota.valor), nota.competencia,
      texto(nota.full_name, 200), texto(nota.numero, 120), texto(nota.cost_center_id, 120),
      `${nota.competencia}-01`,
      JSON.stringify({ sourcePjInvoiceId: nota.id, employeeId: nota.employee_id }),
      user.id, user.id, agora, agora,
    ).run();
  }
  await env.DB.prepare(
    `UPDATE todogreen_pj_invoices
       SET status = 'aprovada', financial_entry_id = ?, reviewed_by = ?, reviewed_at = ?, updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND status = 'em_analise'`,
  ).bind(entryId, user.id, agora, user.id, agora, id, TENANT_ID, ownerId).run();
  return json({ ok: true, financialEntryId: entryId });
};

// Pagar dispara o repasse por PIX (SysPag, dormente por ausência de segredo) e,
// só quando o repasse não falha, marca paga e quita a conta a pagar. Mesma regra
// de honestidade do GreenPay: conexão ligada e disparo falhando → não paga.
const pagarNota = async (env, ownerId, user, id) => {
  const nota = await notaPorId(env, ownerId, id);
  if (!nota) return json({ error: "Nota não encontrada." }, 404);
  if (!podePagar(nota.status)) return json({ error: "Só uma nota aprovada pode ser paga." }, 409);
  const pix = await pixDoColaborador(env, ownerId, nota.employee_id);
  const settlement = crypto.randomUUID();
  const repasse = await enviarPagamentoSyspag(env, {
    settlementId: settlement,
    motoristaId: nota.employee_id,
    motoristaNome: nota.full_name || "prestador PJ",
    valor: numero(nota.valor),
    chavePix: pix.chave,
    referencia: `Repasse PJ NF ${nota.numero} — ${nota.competencia}`,
  });
  if (syspagHabilitado(env) && !repasse.enviado) {
    const motivo =
      repasse.motivo === "pagamento_invalido"
        ? (repasse.erros || []).join(" ") || "Repasse inválido — confira a chave PIX do PJ."
        : "O repasse pela SysPag não saiu; a nota não foi marcada como paga.";
    return json({ error: motivo, motivo: repasse.motivo, syspag: syspagProntidao(env) }, 409);
  }
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_pj_invoices
       SET status = 'paga', settlement_id = ?, updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND status = 'aprovada'`,
  ).bind(settlement, user.id, agora, id, TENANT_ID, ownerId).run();
  // Quita a conta a pagar ligada (o passivo foi liquidado).
  if (nota.financial_entry_id) {
    await env.DB.prepare(
      `UPDATE todogreen_financial_entries
         SET invoice_status = 'paid', paid_amount = ?, paid_at = ?, updated_by = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(numero(nota.valor), agora, user.id, agora, nota.financial_entry_id, TENANT_ID, ownerId).run();
  }
  return json({
    ok: true,
    settlementId: settlement,
    repasse: { externo: Boolean(repasse.enviado), motivo: repasse.motivo || "", idExterno: repasse.idExterno || "" },
  });
};

const chamadoGestaoDaLinha = (row) => ({
  ...chamadoDaLinha(row),
  colaboradorId: row.employee_id,
  colaboradorNome: row.full_name || "",
});

const listarChamadosGestao = async (env, ownerId, url) => {
  const status = texto(url.searchParams.get("status"), 20);
  const filtro = ["aberto", "em_andamento", "resolvido", "cancelado"].includes(status) ? status : "";
  const sql =
    `SELECT t.*, e.full_name FROM todogreen_employee_tickets t
       LEFT JOIN todogreen_employees e ON e.id = t.employee_id AND e.workspace_owner_id = t.workspace_owner_id
      WHERE t.tenant_id = ? AND t.workspace_owner_id = ? AND t.archived_at IS NULL` +
    (filtro ? ` AND t.status = ?` : "") +
    ` ORDER BY (t.status IN ('aberto','em_andamento')) DESC, t.created_at DESC LIMIT 200`;
  const binds = filtro ? [TENANT_ID, ownerId, filtro] : [TENANT_ID, ownerId];
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results || []).map(chamadoGestaoDaLinha);
};

const chamadoPorId = (env, ownerId, id) =>
  env.DB.prepare(
    `SELECT * FROM todogreen_employee_tickets
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, ownerId).first();

const atenderChamado = async (env, ownerId, user, id) => {
  const t = await chamadoPorId(env, ownerId, id);
  if (!t) return json({ error: "Chamado não encontrado." }, 404);
  if (!podeAtender(t.status)) return json({ error: "Só um chamado aberto entra em andamento." }, 409);
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_employee_tickets SET status = 'em_andamento', updated_by = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND status = 'aberto'`,
  ).bind(user.id, agora, id, TENANT_ID, ownerId).run();
  return json({ ok: true });
};

const resolverChamado = async (env, ownerId, user, id, corpo) => {
  const t = await chamadoPorId(env, ownerId, id);
  if (!t) return json({ error: "Chamado não encontrado." }, 404);
  if (!podeResolver(t.status)) return json({ error: "Este chamado não pode ser resolvido." }, 409);
  const resposta = texto(corpo.resposta, 2000);
  if (!resposta) return json({ error: "Escreva a resposta (o colaborador vê o que foi feito)." }, 400);
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_employee_tickets
       SET status = 'resolvido', response = ?, resolved_by = ?, resolved_at = ?, updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND status IN ('aberto','em_andamento')`,
  ).bind(resposta, user.id, agora, user.id, agora, id, TENANT_ID, ownerId).run();
  return json({ ok: true });
};

export async function handleTodoGreenEmployeePortal(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  const url = new URL(request.url);
  const partes = url.pathname.split("/").filter(Boolean); // api, todogreen, employee-portal, [recurso...]
  const recurso = texto(partes[3], 40);

  // ---- gestão (RH/financeiro) ----
  if (recurso === "gestao") {
    if (!podeGerir(access))
      return json({ error: "A gestão de notas PJ é do RH ou do financeiro." }, 403);
    const sub = texto(partes[4], 40); // "notas" | "chamados"
    const alvoId = texto(partes[5], 120);
    const acao = texto(partes[6], 30);
    if (request.method === "GET" && sub === "notas" && !alvoId)
      return json({ notas: await listarNotasGestao(env, access.ownerId, url) });
    if (request.method === "POST" && sub === "notas" && alvoId) {
      const corpo = await request.json().catch(() => ({}));
      if (acao === "aprovar") return aprovarNota(env, access.ownerId, user, alvoId);
      if (acao === "recusar") return recusarNota(env, access.ownerId, user, alvoId, corpo);
      if (acao === "ajustar") return ajustarEsperado(env, access.ownerId, user, alvoId, corpo);
      if (acao === "pagar") return pagarNota(env, access.ownerId, user, alvoId);
    }
    if (request.method === "GET" && sub === "chamados" && !alvoId)
      return json({ chamados: await listarChamadosGestao(env, access.ownerId, url) });
    if (request.method === "POST" && sub === "chamados" && alvoId) {
      const corpo = await request.json().catch(() => ({}));
      if (acao === "atender") return atenderChamado(env, access.ownerId, user, alvoId);
      if (acao === "resolver") return resolverChamado(env, access.ownerId, user, alvoId, corpo);
    }
    return json({ error: "Rota de gestão do colaborador não encontrada." }, 404);
  }

  // ---- self-service (a própria pessoa) ----
  const colaborador = await colaboradorDaSessao(env, access, user);

  if (request.method === "GET" && (recurso === "" || recurso === "sessao"))
    return responderSessao(env, access, colaborador);

  if (!colaborador)
    return json({ error: "Seu e-mail não está ligado a um cadastro de colaborador." }, 403);

  if (request.method === "POST" && recurso === "pix") {
    const corpo = await request.json().catch(() => ({}));
    return salvarPixColaborador(env, access, user, colaborador, corpo);
  }
  if (request.method === "POST" && recurso === "nota") {
    const corpo = await request.json().catch(() => ({}));
    return imputarNota(env, access, user, colaborador, corpo);
  }
  if (request.method === "POST" && recurso === "chamado") {
    const corpo = await request.json().catch(() => ({}));
    return abrirChamado(env, access, user, colaborador, corpo);
  }

  return json({ error: "Rota do portal do colaborador não encontrada." }, 404);
}
