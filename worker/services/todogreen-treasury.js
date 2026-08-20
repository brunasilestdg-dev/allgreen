// ===== Tesouraria: extrato, conciliação e fechamento de período =====
//
// Serviço próprio porque nada aqui é CRUD:
//
//   1. IMPORTAR EXTRATO é uma operação em lote com deduplicação. Reimportar o
//      arquivo do dia seguinte, que repete os dias anteriores, é rotina — e sem
//      o `import_hash` cada reimportação dobraria o extrato.
//
//   2. CONCILIAR liga duas linhas de tabelas diferentes numa só gravação. Feito
//      em duas chamadas, uma falha deixaria a linha do extrato apontando para um
//      lançamento que não sabe que foi conciliado.
//
//   3. FECHAR PERÍODO é uma trava que vale para outro handler. É aqui que ela é
//      criada, e é `bloqueioPorFechamento` que a aplica na escrita do
//      lançamento.
//
// A conciliação NUNCA casa sozinha. `sugerirConciliacao` devolve candidatos com
// pontuação e a decisão é de quem confere: conciliação automática que erra é pior
// que conciliação manual, porque ninguém revisa o que o sistema deu por certo.

import { TENANT_ID, paginacao, podeNaVertical } from "./todogreen-access.js";
// `saldoDaConta` NÃO é importado de propósito: aqui o saldo é somado no banco
// (ver `listarSaldos`), porque trazer todo o extrato para o Worker para somar
// pararia de funcionar quando o extrato crescer. A função do domínio continua
// valendo para a tela, que já tem as linhas em mão — as duas calculam a mesma
// coisa, uma sobre SQL e outra sobre o array já carregado.
import {
  hashDaLinhaDoExtrato,
  periodoTravado,
  resultadoPorEixo,
  sugerirConciliacao,
  validatePeriodClose,
  validateStatementLine,
  valorDevido,
} from "../../src/features/logistics/treasuryDomain.js";

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

// Um lote grande de extrato vira muitas instruções; o teto existe para uma
// requisição não estourar o limite de subrequests do Worker. Mesmo desenho do
// import de clientes (100 por chamada).
const MAX_LINHAS_POR_IMPORTACAO = 200;

const linhaDoExtratoDaLinha = (row) => ({
  id: row.id,
  bankAccountId: row.bank_account_id,
  occurredOn: row.occurred_on,
  amount: row.amount,
  description: row.description,
  document: row.document,
  entryId: row.entry_id,
  conciliadoEm: row.reconciled_at || "",
  conciliadoPor: row.reconciled_by || "",
  campos: parse(row.fields_json, {}),
  criadoEm: row.created_at,
});

const periodoDaLinha = (row) => ({
  id: row.id,
  referenceMonth: row.reference_month,
  status: row.status,
  totais: parse(row.totals_json, {}),
  fechadoPor: row.closed_by,
  fechadoEm: row.closed_at,
  reabertoPor: row.reopened_by || "",
  reabertoEm: row.reopened_at || "",
  motivoReabertura: row.reopen_reason,
  notas: row.notes,
});

// O lançamento no formato que o domínio espera. Só os campos que a tesouraria
// usa — trazer a linha inteira faria o domínio depender do schema.
const lancamentoParaDominio = (row) => ({
  id: row.id,
  tipo: row.kind,
  valor: row.amount,
  valorPago: row.paid_amount,
  vencimentoEm: row.due_date || "",
  competenciaEm: row.competence_date || "",
  mesReferencia: row.reference_month || "",
  statusFinanceiro: row.invoice_status,
  numeroDocumento: row.document_number,
  contraparte: row.counterparty,
  costCenterId: row.cost_center_id,
  accountId: row.account_id,
  conciliadoEm: row.reconciled_at || "",
  multaPercent: row.late_fee_percent,
  jurosMesPercent: row.late_interest_month_percent,
});

const lerPeriodos = async (env, ownerId) => {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_periods
      WHERE tenant_id = ? AND workspace_owner_id = ?
      ORDER BY reference_month DESC`,
  ).bind(TENANT_ID, ownerId).all();
  return (results || []).map(periodoDaLinha);
};

// ---------------------------------------------------------------------------
// Extrato
// ---------------------------------------------------------------------------

const importarExtrato = async (env, access, user, corpo) => {
  const contaId = texto(corpo.bankAccountId, 120);
  const conta = await env.DB.prepare(
    `SELECT id FROM todogreen_bank_accounts
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(contaId, TENANT_ID, access.ownerId).first();
  if (!conta) return json({ error: "Conta bancária não encontrada neste espaço." }, 404);

  const linhas = lista(corpo.linhas);
  if (!linhas.length) return json({ error: "Nenhuma linha de extrato para importar." }, 400);
  if (linhas.length > MAX_LINHAS_POR_IMPORTACAO)
    return json({
      error: `Importe no máximo ${MAX_LINHAS_POR_IMPORTACAO} linhas por vez.`,
    }, 400);

  // Valida TUDO antes de gravar QUALQUER coisa. Gravar metade e recusar a outra
  // metade deixaria o extrato incompleto sem ninguém saber onde parou.
  for (const linha of linhas) {
    const erro = validateStatementLine({ ...linha, bankAccountId: contaId });
    if (erro) return json({ error: erro }, 400);
  }

  const agora = new Date().toISOString();
  // `INSERT OR IGNORE` contra o índice único (espaço + conta + hash): a linha
  // repetida é descartada em silêncio, que é exatamente o comportamento certo
  // para reimportação. `meta.changes` conta quantas de fato entraram.
  const gravacoes = linhas.map((linha) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO todogreen_bank_statement_lines
         (id, tenant_id, workspace_owner_id, bank_account_id, occurred_on, amount,
          description, document, import_hash, entry_id, fields_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, access.ownerId, contaId,
      texto(linha.occurredOn, 10), numero(linha.amount),
      texto(linha.description, 500), texto(linha.document, 120),
      hashDaLinhaDoExtrato(linha),
      JSON.stringify(objeto(linha.campos)), user.id, agora,
    ),
  );

  const resultado = await env.DB.batch(gravacoes);
  const importadas = resultado.reduce((soma, item) => soma + (item?.meta?.changes || 0), 0);
  return json({
    importadas,
    // A diferença é o que já estava lá. Dizer isso em voz alta evita a dúvida
    // "subi 300 linhas e só entraram 12, deu erro?".
    repetidas: linhas.length - importadas,
  }, 201);
};

const listarExtrato = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const contaId = texto(url.searchParams.get("conta"), 120);
  const pendentes = url.searchParams.get("pendentes") === "1";
  const filtros = [
    contaId ? "AND bank_account_id = ?" : "",
    pendentes ? "AND reconciled_at IS NULL" : "",
  ].join(" ");
  const params = [TENANT_ID, access.ownerId, ...(contaId ? [contaId] : [])];
  const base = `FROM todogreen_bank_statement_lines
      WHERE tenant_id = ? AND workspace_owner_id = ? ${filtros}`;
  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(`SELECT * ${base} ORDER BY occurred_on DESC, created_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);
  return json({
    registros: (results || []).map(linhaDoExtratoDaLinha),
    total: totalRow?.total || 0,
    limit,
    offset,
  });
};

// Saldo por conta: inicial mais o que foi conciliado. Somado no banco, porque
// trazer todo o extrato para o Worker para somar pararia de funcionar quando o
// extrato crescer.
const listarSaldos = async (env, access) => {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.name, c.kind, c.opening_balance,
            COALESCE((
              SELECT SUM(l.amount) FROM todogreen_bank_statement_lines l
               WHERE l.bank_account_id = c.id AND l.workspace_owner_id = c.workspace_owner_id
                 AND l.reconciled_at IS NOT NULL
            ), 0) AS conciliado,
            COALESCE((
              SELECT COUNT(*) FROM todogreen_bank_statement_lines l
               WHERE l.bank_account_id = c.id AND l.workspace_owner_id = c.workspace_owner_id
                 AND l.reconciled_at IS NULL
            ), 0) AS pendentes
       FROM todogreen_bank_accounts c
      WHERE c.tenant_id = ? AND c.workspace_owner_id = ? AND c.archived_at IS NULL
      ORDER BY c.name`,
  ).bind(TENANT_ID, access.ownerId).all();

  return json({
    contas: (results || []).map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      saldoInicial: row.opening_balance,
      conciliado: row.conciliado,
      saldo: Math.round((row.opening_balance + row.conciliado + Number.EPSILON) * 100) / 100,
      // O número que diz se o saldo pode ser confiado: com linhas pendentes, ele
      // ainda vai mudar.
      linhasPendentes: row.pendentes,
    })),
  });
};

// ---------------------------------------------------------------------------
// Conciliação
// ---------------------------------------------------------------------------

const sugestoesDeConciliacao = async (env, access, url) => {
  const linhaId = texto(url.searchParams.get("linha"), 120);
  if (!linhaId) return json({ error: "Informe a linha do extrato." }, 400);

  const linha = await env.DB.prepare(
    `SELECT * FROM todogreen_bank_statement_lines
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(linhaId, TENANT_ID, access.ownerId).first();
  if (!linha) return json({ error: "Linha do extrato não encontrada." }, 404);

  // Só os lançamentos que ainda podem ser conciliados, e só os do espaço. O
  // teto existe para a sugestão não varrer anos de histórico a cada clique.
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
        AND reconciled_at IS NULL AND invoice_status <> 'cancelled'
      ORDER BY ABS(amount - ?) ASC, due_date DESC
      LIMIT 200`,
  ).bind(TENANT_ID, access.ownerId, Math.abs(numero(linha.amount))).all();

  const candidatos = sugerirConciliacao(
    linhaDoExtratoDaLinha(linha),
    (results || []).map(lancamentoParaDominio),
  );
  return json({ linha: linhaDoExtratoDaLinha(linha), candidatos });
};

// Liga a linha do extrato ao lançamento numa gravação só. As duas pontas mudam
// juntas ou não mudam: em chamadas separadas, uma falha deixaria a linha
// apontando para um lançamento que não sabe que foi conciliado.
const conciliar = async (env, access, user, corpo) => {
  const linhaId = texto(corpo.linhaId, 120);
  const entryId = texto(corpo.entryId, 120);
  if (!linhaId || !entryId) return json({ error: "Informe a linha do extrato e o lançamento." }, 400);

  const [linha, lancamento] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM todogreen_bank_statement_lines
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(linhaId, TENANT_ID, access.ownerId).first(),
    env.DB.prepare(
      `SELECT * FROM todogreen_financial_entries
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(entryId, TENANT_ID, access.ownerId).first(),
  ]);
  if (!linha) return json({ error: "Linha do extrato não encontrada." }, 404);
  if (!lancamento) return json({ error: "Lançamento não encontrado." }, 404);
  if (linha.reconciled_at) return json({ error: "Esta linha do extrato já foi conciliada." }, 409);
  if (lancamento.reconciled_at) return json({ error: "Este lançamento já foi conciliado." }, 409);

  // Entrada no banco não pode casar com custo, nem saída com receita — seria
  // dinheiro entrando registrado como despesa.
  const entrada = numero(linha.amount) > 0;
  const ehReceita = lancamento.kind === "revenue";
  if (entrada !== ehReceita)
    return json({
      error: entrada
        ? "Uma entrada no banco não pode ser conciliada com um custo."
        : "Uma saída do banco não pode ser conciliada com uma receita.",
    }, 409);

  const agora = new Date().toISOString();
  const resultado = await env.DB.batch([
    env.DB.prepare(
      `UPDATE todogreen_bank_statement_lines
          SET entry_id = ?, reconciled_at = ?, reconciled_by = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND reconciled_at IS NULL`,
    ).bind(entryId, agora, user.id, linhaId, TENANT_ID, access.ownerId),
    env.DB.prepare(
      `UPDATE todogreen_financial_entries
          SET reconciled_at = ?, bank_account_id = ?, revision = revision + 1,
              updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND reconciled_at IS NULL`,
    ).bind(agora, linha.bank_account_id, user.id, agora, entryId, TENANT_ID, access.ownerId),
  ]);

  // Se a primeira não mudou nada, outra pessoa conciliou entre a leitura e a
  // gravação.
  if (!resultado?.[0]?.meta?.changes)
    return json({ error: "Esta linha foi conciliada por outra pessoa. Recarregue." }, 409);

  return json({ ok: true, conciliadoEm: agora });
};

const desconciliar = async (env, access, user, corpo) => {
  const linhaId = texto(corpo.linhaId, 120);
  if (!linhaId) return json({ error: "Informe a linha do extrato." }, 400);

  const linha = await env.DB.prepare(
    `SELECT * FROM todogreen_bank_statement_lines
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(linhaId, TENANT_ID, access.ownerId).first();
  if (!linha) return json({ error: "Linha do extrato não encontrada." }, 404);
  if (!linha.reconciled_at) return json({ error: "Esta linha não está conciliada." }, 409);

  // Desfazer conciliação em mês fechado mudaria um saldo já publicado.
  const periodos = await lerPeriodos(env, access.ownerId);
  const mes = texto(linha.occurred_on, 7);
  if (periodoTravado(mes, periodos))
    return json({
      error: `A competência ${mes} está fechada. Reabra o período para desfazer a conciliação.`,
    }, 409);

  const agora = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE todogreen_bank_statement_lines
          SET entry_id = '', reconciled_at = NULL, reconciled_by = NULL
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(linhaId, TENANT_ID, access.ownerId),
    env.DB.prepare(
      `UPDATE todogreen_financial_entries
          SET reconciled_at = NULL, revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(user.id, agora, linha.entry_id, TENANT_ID, access.ownerId),
  ]);
  return json({ ok: true });
};

// ---------------------------------------------------------------------------
// Fechamento de período
// ---------------------------------------------------------------------------

const fecharPeriodo = async (env, access, user, corpo) => {
  const mes = texto(corpo.referenceMonth, 7);
  const erro = validatePeriodClose(mes);
  if (erro) return json({ error: erro }, 400);

  const existente = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_periods
      WHERE tenant_id = ? AND workspace_owner_id = ? AND reference_month = ?`,
  ).bind(TENANT_ID, access.ownerId, mes).first();
  if (existente?.status === "fechado")
    return json({ error: `A competência ${mes} já está fechada.` }, 409);

  // O retrato do resultado no momento do fechamento. É contra ele que se compara
  // depois para saber se alguém mexeu no passado.
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
        AND (substr(COALESCE(competence_date, ''), 1, 7) = ?
             OR (COALESCE(competence_date, '') = '' AND reference_month = ?))`,
  ).bind(TENANT_ID, access.ownerId, mes, mes).all();

  const lancamentos = (results || []).map(lancamentoParaDominio);
  const porCentro = resultadoPorEixo(lancamentos, "costCenterId");
  const totais = porCentro.reduce(
    (soma, linha) => ({
      receita: soma.receita + linha.receita,
      custo: soma.custo + linha.custo,
      comissao: soma.comissao + linha.comissao,
      resultado: soma.resultado + linha.resultado,
      lancamentos: soma.lancamentos,
    }),
    { receita: 0, custo: 0, comissao: 0, resultado: 0, lancamentos: lancamentos.length },
  );

  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_financial_periods
       (id, tenant_id, workspace_owner_id, reference_month, status, totals_json,
        closed_by, closed_at, reopened_by, reopened_at, reopen_reason, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'fechado', ?, ?, ?, NULL, NULL, '', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, reference_month) DO UPDATE SET
       status = 'fechado', totals_json = excluded.totals_json,
       closed_by = excluded.closed_by, closed_at = excluded.closed_at,
       reopened_by = NULL, reopened_at = NULL, reopen_reason = '',
       notes = excluded.notes, updated_at = excluded.updated_at`,
  )
    .bind(
      existente?.id || crypto.randomUUID(), TENANT_ID, access.ownerId, mes,
      JSON.stringify(totais), user.id, agora, texto(corpo.notas, 2000), agora, agora,
    )
    .run();

  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_periods
      WHERE tenant_id = ? AND workspace_owner_id = ? AND reference_month = ?`,
  ).bind(TENANT_ID, access.ownerId, mes).first();
  return json({ registro: periodoDaLinha(row), porCentroDeCusto: porCentro }, 201);
};

// Reabrir é possível, mas nunca em silêncio: exige motivo, e quem reabriu fica
// registrado. Fechar e reabrir sem deixar rastro seria o mesmo que não fechar.
const reabrirPeriodo = async (env, access, user, corpo) => {
  const mes = texto(corpo.referenceMonth, 7);
  const erro = validatePeriodClose(mes);
  if (erro) return json({ error: erro }, 400);
  const motivo = texto(corpo.motivo, 1000);
  if (!motivo) return json({ error: "Informe o motivo da reabertura." }, 400);

  const agora = new Date().toISOString();
  const meta = await env.DB.prepare(
    `UPDATE todogreen_financial_periods
        SET status = 'reaberto', reopened_by = ?, reopened_at = ?, reopen_reason = ?, updated_at = ?
      WHERE tenant_id = ? AND workspace_owner_id = ? AND reference_month = ? AND status = 'fechado'`,
  ).bind(user.id, agora, motivo, agora, TENANT_ID, access.ownerId, mes).run();

  if (!meta?.meta?.changes)
    return json({ error: `A competência ${mes} não está fechada.` }, 409);

  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_periods
      WHERE tenant_id = ? AND workspace_owner_id = ? AND reference_month = ?`,
  ).bind(TENANT_ID, access.ownerId, mes).first();
  return json({ registro: periodoDaLinha(row) });
};

// ---------------------------------------------------------------------------
// Cobrança e resultado
// ---------------------------------------------------------------------------

// O que cobrar hoje de cada título aberto, com a composição à vista. Um total
// sem composição é um número que o cliente contesta e ninguém sabe explicar.
const listarCobranca = async (env, access, url) => {
  const hoje = texto(url.searchParams.get("hoje"), 10) || new Date().toISOString().slice(0, 10);
  const tipo = texto(url.searchParams.get("tipo"), 20);
  const filtro = tipo === "receber" ? "AND kind = 'revenue'" : tipo === "pagar" ? "AND kind <> 'revenue'" : "";
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
        AND invoice_status NOT IN ('paid', 'cancelled') ${filtro}
      ORDER BY due_date ASC
      LIMIT 500`,
  ).bind(TENANT_ID, access.ownerId).all();

  const registros = (results || []).map((row) => {
    const entry = lancamentoParaDominio(row);
    return {
      id: entry.id,
      tipo: entry.tipo,
      contraparte: entry.contraparte,
      numeroDocumento: entry.numeroDocumento,
      vencimentoEm: entry.vencimentoEm,
      devido: valorDevido(entry, hoje),
    };
  });

  return json({
    hoje,
    registros,
    // Os totais somam o DEVIDO, não o valor de face: é o que de fato entra ou
    // sai se tudo for pago hoje.
    totais: registros.reduce(
      (soma, item) => ({
        principal: Math.round((soma.principal + item.devido.principal + Number.EPSILON) * 100) / 100,
        encargos: Math.round((soma.encargos + item.devido.multa + item.devido.juros + Number.EPSILON) * 100) / 100,
        total: Math.round((soma.total + item.devido.total + Number.EPSILON) * 100) / 100,
      }),
      { principal: 0, encargos: 0, total: 0 },
    ),
  });
};

const listarResultado = async (env, access, url) => {
  const eixo = url.searchParams.get("eixo") === "conta" ? "accountId" : "costCenterId";
  const mes = texto(url.searchParams.get("mes"), 7);
  const filtro = mes
    ? `AND (substr(COALESCE(competence_date, ''), 1, 7) = ?
           OR (COALESCE(competence_date, '') = '' AND reference_month = ?))`
    : "";
  const params = [TENANT_ID, access.ownerId, ...(mes ? [mes, mes] : [])];
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL ${filtro}
      LIMIT 2000`,
  ).bind(...params).all();

  return json({
    eixo: eixo === "accountId" ? "conta" : "centro-de-custo",
    mes,
    linhas: resultadoPorEixo((results || []).map(lancamentoParaDominio), eixo),
  });
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

export async function handleTodoGreenTreasury(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  const url = new URL(request.url);
  // api, todogreen, treasury, [recurso], [acao]
  const partes = url.pathname.split("/").filter(Boolean);
  const recurso = texto(partes[3], 40);
  const acao = texto(partes[4], 40);

  if (request.method === "GET") {
    if (recurso === "extrato") return listarExtrato(env, access, url);
    if (recurso === "saldos") return listarSaldos(env, access);
    if (recurso === "sugestoes") return sugestoesDeConciliacao(env, access, url);
    if (recurso === "periodos") return json({ registros: await lerPeriodos(env, access.ownerId) });
    if (recurso === "cobranca") return listarCobranca(env, access, url);
    if (recurso === "resultado") return listarResultado(env, access, url);
    return json({ error: "Recurso desconhecido." }, 404);
  }

  if (!podeNaVertical(access, "finance:manage"))
    return json({ error: "Seu papel não pode movimentar a tesouraria." }, 403);

  const corpo = await request.json().catch(() => ({}));

  if (request.method === "POST") {
    if (recurso === "extrato") return importarExtrato(env, access, user, corpo);
    if (recurso === "conciliacoes") {
      if (acao === "desfazer") return desconciliar(env, access, user, corpo);
      return conciliar(env, access, user, corpo);
    }
    if (recurso === "periodos") {
      if (acao === "reabrir") return reabrirPeriodo(env, access, user, corpo);
      return fecharPeriodo(env, access, user, corpo);
    }
    return json({ error: "Recurso desconhecido." }, 404);
  }

  // Linha de extrato não é editada: ela é o que o banco disse. Corrigir é
  // desfazer a conciliação e conciliar com o lançamento certo.
  if (["PATCH", "PUT", "DELETE"].includes(request.method) && recurso === "extrato")
    return json({
      error: "Linha de extrato não é editada — ela é o que o banco informou. Desfaça a conciliação e refaça.",
    }, 405);

  return json({ error: "Método não permitido." }, 405);
}
