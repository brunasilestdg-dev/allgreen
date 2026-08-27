// ===== Pessoas e folha =====
//
// O módulo inteiro exige `hr:manage` — e só rh/admin/owner têm essa permissão.
// É essa porta única que protege o dado sensível (CPF, salário, dependentes):
// quem não é do RH nem chega aqui. Ainda assim, o CPF sai mascarado por padrão
// e só volta inteiro quando explicitamente pedido, para não espalhar o número
// em toda listagem.
//
// Vocabulário "colaborador", nunca "funcionário" — funcionário, no produto, é a
// persona de IA.
//
// Fechar a folha é uma operação com efeito e trava: calcula o holerite de cada
// colaborador ativo pela tabela versionada, grava os itens e fecha o período.
// Reabrir é possível (rh/admin/owner), mas fica no registro.

import { TENANT_ID, paginacao, podeNaVertical } from "./todogreen-access.js";
import {
  TABELAS_2025,
  calcularFolha,
  mascararCpf,
  payrollTransmissionEnabled,
  resumoFolha,
  validarColaborador,
} from "../../src/features/logistics/payrollDomain.js";

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
const inteiro = (valor) => Math.trunc(numero(valor));
const parse = (valor, alternativa) => {
  try { return JSON.parse(valor || ""); } catch { return alternativa; }
};
const objeto = (valor) => (valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {});
const lista = (valor) => (Array.isArray(valor) ? valor : []);

// ---------------------------------------------------------------------------
// Mapeamento
// ---------------------------------------------------------------------------

// A tabela `todogreen_employees` é o cadastro mestre (migração 0062, colunas
// em inglês: full_name, document, job_title…). A folha NÃO tem tabela própria
// de colaborador — ela estende o cadastro (0066) e traduz o vocabulário aqui,
// para a API continuar falando português com o front.
const VINCULO_PARA_TIPO = {
  clt: "employee", pj: "pj", estagio: "intern",
  temporario: "temporary", autonomo: "other", aprendiz: "apprentice",
};
const TIPO_PARA_VINCULO = {
  employee: "clt", pj: "pj", intern: "estagio",
  temporary: "temporario", other: "autonomo", apprentice: "aprendiz",
  third_party: "pj",
};
// "ferias" e "afastado" viram os dois 'leave' no cadastro mestre; a distinção
// da folha fica em fields_json.situacaoFolha para não se perder na volta.
const STATUS_PARA_MESTRE = { ativo: "active", afastado: "leave", ferias: "leave", desligado: "terminated" };
const statusDaLinha = (row, campos) => {
  if (row.status === "leave") return campos.situacaoFolha === "ferias" ? "ferias" : "afastado";
  if (row.status === "terminated" || row.status === "inactive") return "desligado";
  return "ativo";
};

// `revelarCpf` só quando pedido explicitamente. Mascarar por padrão evita o CPF
// vazar em toda listagem — mesmo para o RH, que raramente precisa do número
// inteiro numa tabela.
const colaboradorDaLinha = (row, { revelarCpf = false } = {}) => {
  const campos = parse(row.fields_json, {});
  return {
    id: row.id,
    nome: row.full_name,
    cpf: revelarCpf ? row.document : mascararCpf(row.document),
    matricula: row.employee_code,
    cargo: row.job_title,
    departamento: row.department,
    costCenterId: row.cost_center_id,
    vinculo: TIPO_PARA_VINCULO[row.employment_type] || "clt",
    salarioBase: row.salario_base,
    dependentes: row.dependentes,
    jornadaSemanal: row.jornada_semanal,
    admissaoEm: row.hire_date || "",
    desligamentoEm: row.termination_date || "",
    motivoDesligamento: row.motivo_desligamento,
    regimeHoras: row.regime_horas,
    userId: row.user_id || "",
    resourceProfileId: row.resource_profile_id || "",
    status: statusDaLinha(row, campos),
    campos,
    revision: row.revision,
    criadoEm: row.created_at,
    atualizadoEm: row.updated_at,
  };
};

const runDaLinha = (row) => ({
  id: row.id,
  competencia: row.competencia,
  tipo: row.tipo,
  status: row.status,
  versaoTabela: row.versao_tabela,
  totalProventos: row.total_proventos,
  totalDescontos: row.total_descontos,
  totalLiquido: row.total_liquido,
  totalFgts: row.total_fgts,
  totalInss: row.total_inss,
  totalIrrf: row.total_irrf,
  fechadaPor: row.fechada_por,
  fechadaEm: row.fechada_em || "",
  reabertaPor: row.reaberta_por,
  reabertaEm: row.reaberta_em || "",
  notas: row.notas,
  revision: row.revision,
  criadoEm: row.created_at,
});

const itemDaLinha = (row) => ({
  id: row.id,
  payrollRunId: row.payroll_run_id,
  employeeId: row.employee_id,
  salarioBase: row.salario_base,
  totalProventos: row.total_proventos,
  totalDescontos: row.total_descontos,
  liquido: row.liquido,
  baseInss: row.base_inss,
  inssValor: row.inss_valor,
  baseIrrf: row.base_irrf,
  irrfValor: row.irrf_valor,
  fgtsValor: row.fgts_valor,
  proventos: parse(row.proventos_json, []),
  descontos: parse(row.descontos_json, []),
});

const feriasDaLinha = (row) => ({
  id: row.id,
  employeeId: row.employee_id,
  periodoAquisitivoInicio: row.periodo_aquisitivo_inicio,
  periodoAquisitivoFim: row.periodo_aquisitivo_fim,
  gozoInicio: row.gozo_inicio || "",
  gozoFim: row.gozo_fim || "",
  dias: row.dias,
  abonoPecuniario: Boolean(row.abono_pecuniario),
  adiantarDecimo: Boolean(row.adiantar_decimo),
  status: row.status,
  revision: row.revision,
});

// ---------------------------------------------------------------------------
// Colaboradores
// ---------------------------------------------------------------------------

const listarColaboradores = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const status = texto(url.searchParams.get("status"), 20);
  // O filtro chega no vocabulário da API (ativo/afastado/ferias/desligado) e é
  // traduzido para o status do cadastro mestre antes de ir ao SQL.
  const statusMestre = STATUS_PARA_MESTRE[status] || "";
  const filtro = statusMestre ? "AND status = ?" : "";
  const params = [TENANT_ID, access.ownerId, ...(statusMestre ? [statusMestre] : [])];
  const base = `FROM todogreen_employees
    WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL ${filtro}`;
  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(`SELECT * ${base} ORDER BY full_name LIMIT ? OFFSET ?`).bind(...params, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);
  return json({
    registros: (results || []).map((r) => colaboradorDaLinha(r)),
    total: totalRow?.total || 0,
    limit,
    offset,
  });
};

const obterColaborador = async (env, access, id) => {
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_employees WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, access.ownerId).first();
  if (!row) return json({ error: "Colaborador não encontrado." }, 404);
  // No detalhe de um colaborador só, o CPF inteiro é liberado — é onde o RH
  // legitimamente precisa dele.
  return json(colaboradorDaLinha(row, { revelarCpf: true }));
};

const colunasColaborador = (corpo) => {
  const statusApi = ["ativo", "afastado", "ferias", "desligado"].includes(texto(corpo.status, 20))
    ? texto(corpo.status, 20) : "ativo";
  const campos = objeto(corpo.campos);
  // A distinção férias/afastado não existe no cadastro mestre (ambos 'leave');
  // fica registrada nos campos livres para a leitura devolver o valor certo.
  if (statusApi === "ferias" || statusApi === "afastado") campos.situacaoFolha = statusApi;
  else delete campos.situacaoFolha;
  return {
    full_name: texto(corpo.nome, 200),
    document: texto(corpo.cpf, 14).replace(/\D/g, ""),
    employee_code: texto(corpo.matricula, 40),
    job_title: texto(corpo.cargo, 120),
    department: texto(corpo.departamento, 120),
    cost_center_id: texto(corpo.costCenterId, 120),
    employment_type: VINCULO_PARA_TIPO[texto(corpo.vinculo, 20)] || "employee",
    salario_base: numero(corpo.salarioBase),
    dependentes: Math.max(0, inteiro(corpo.dependentes)),
    jornada_semanal: numero(corpo.jornadaSemanal) || 44,
    hire_date: texto(corpo.admissaoEm, 20) || null,
    termination_date: texto(corpo.desligamentoEm, 20) || null,
    motivo_desligamento: texto(corpo.motivoDesligamento, 300),
    regime_horas: texto(corpo.regimeHoras, 30) || "mensalista",
    user_id: texto(corpo.userId, 120) || null,
    resource_profile_id: texto(corpo.resourceProfileId, 120) || null,
    status: STATUS_PARA_MESTRE[statusApi],
    fields_json: JSON.stringify(campos),
  };
};

const criarColaborador = async (env, access, user, corpo) => {
  const erros = validarColaborador({
    nome: corpo.nome, cpf: corpo.cpf, salarioBase: corpo.salarioBase, admissaoEm: corpo.admissaoEm,
  });
  if (erros.length) return json({ error: "Cadastro com pendências.", erros }, 400);

  const dados = colunasColaborador(corpo);
  // O cadastro mestre tem CPF único por espaço (índice da 0062). Verificar
  // antes devolve um erro legível em vez do estouro do índice.
  if (dados.document) {
    const repetido = await env.DB.prepare(
      `SELECT id FROM todogreen_employees
        WHERE tenant_id = ? AND workspace_owner_id = ? AND document = ? AND archived_at IS NULL`,
    ).bind(TENANT_ID, access.ownerId, dados.document).first();
    if (repetido) return json({ error: "Já existe um colaborador com este CPF." }, 409);
  }
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  const colunas = Object.keys(dados).join(", ");
  const placeholders = Object.keys(dados).map(() => "?").join(", ");
  await env.DB.prepare(
    `INSERT INTO todogreen_employees (id, tenant_id, workspace_owner_id, ${colunas}, revision, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ${placeholders}, 1, ?, ?, ?, ?)`,
  ).bind(id, TENANT_ID, access.ownerId, ...Object.values(dados), user.id, user.id, agora, agora).run();
  const row = await env.DB.prepare("SELECT * FROM todogreen_employees WHERE id = ?").bind(id).first();
  return json(colaboradorDaLinha(row, { revelarCpf: true }), 201);
};

const atualizarColaborador = async (env, access, user, id, corpo) => {
  const atual = await env.DB.prepare(
    `SELECT * FROM todogreen_employees WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, access.ownerId).first();
  if (!atual) return json({ error: "Colaborador não encontrado." }, 404);
  if (numero(corpo.revision) !== atual.revision)
    return json({ error: "O cadastro foi alterado por outra pessoa. Recarregue." }, 409);

  const dados = colunasColaborador({ ...colaboradorDaLinha(atual, { revelarCpf: true }), ...corpo });
  const sets = Object.keys(dados).map((k) => `${k} = ?`).join(", ");
  await env.DB.prepare(
    `UPDATE todogreen_employees SET ${sets}, revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(...Object.values(dados), user.id, new Date().toISOString(), id, TENANT_ID, access.ownerId).run();
  const row = await env.DB.prepare("SELECT * FROM todogreen_employees WHERE id = ?").bind(id).first();
  return json(colaboradorDaLinha(row, { revelarCpf: true }));
};

const arquivarColaborador = async (env, access, user, id) => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_employees SET archived_at = ?, status = 'terminated', updated_by = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(agora, user.id, agora, id, TENANT_ID, access.ownerId).run();
  return json({ ok: true });
};

// ---------------------------------------------------------------------------
// Ponto
// ---------------------------------------------------------------------------

const listarPonto = async (env, access, url) => {
  const employeeId = texto(url.searchParams.get("colaborador") || url.searchParams.get("employee"), 120);
  const competencia = texto(url.searchParams.get("competencia"), 7);
  const filtros = [
    employeeId ? "AND employee_id = ?" : "",
    competencia ? "AND dia LIKE ?" : "",
  ].join(" ");
  const params = [
    TENANT_ID, access.ownerId,
    ...(employeeId ? [employeeId] : []),
    ...(competencia ? [`${competencia}%`] : []),
  ];
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_time_clock
      WHERE tenant_id = ? AND workspace_owner_id = ? ${filtros}
      ORDER BY dia DESC, created_at DESC LIMIT 500`,
  ).bind(...params).all();
  return json({ registros: (results || []).map((r) => ({
    id: r.id, employeeId: r.employee_id, dia: r.dia, entrada: r.entrada, saida: r.saida,
    horasNormais: r.horas_normais, horasExtras: r.horas_extras, horasNoturnas: r.horas_noturnas,
    falta: Boolean(r.falta), abonado: Boolean(r.abonado), observacao: r.observacao, criadoEm: r.created_at,
  })) });
};

const registrarPonto = async (env, access, user, corpo) => {
  const employeeId = texto(corpo.employeeId || corpo.colaboradorId, 120);
  const colaborador = await env.DB.prepare(
    `SELECT id FROM todogreen_employees WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(employeeId, TENANT_ID, access.ownerId).first();
  if (!colaborador) return json({ error: "Colaborador não encontrado." }, 404);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(corpo.dia, 10))) return json({ error: "Informe o dia (AAAA-MM-DD)." }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO todogreen_time_clock
      (id, tenant_id, workspace_owner_id, employee_id, dia, entrada, saida,
       horas_normais, horas_extras, horas_noturnas, falta, abonado, observacao, fields_json, created_by, created_at)
     VALUES (?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, TENANT_ID, access.ownerId, employeeId, texto(corpo.dia, 10),
    texto(corpo.entrada, 5), texto(corpo.saida, 5),
    numero(corpo.horasNormais), numero(corpo.horasExtras), numero(corpo.horasNoturnas),
    corpo.falta ? 1 : 0, corpo.abonado ? 1 : 0, texto(corpo.observacao, 300),
    JSON.stringify(objeto(corpo.campos)), user.id, new Date().toISOString(),
  ).run();
  return json({ ok: true, id }, 201);
};

// ---------------------------------------------------------------------------
// Folha: fechamento com trava
// ---------------------------------------------------------------------------

const listarRuns = async (env, access) => {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_payroll_runs WHERE tenant_id = ? AND workspace_owner_id = ? ORDER BY competencia DESC, created_at DESC`,
  ).bind(TENANT_ID, access.ownerId).all();
  return json({ registros: (results || []).map(runDaLinha) });
};

const criarRun = async (env, access, user, corpo) => {
  const competencia = texto(corpo.competencia, 7);
  if (!/^\d{4}-\d{2}$/.test(competencia)) return json({ error: "Informe a competência (AAAA-MM)." }, 400);
  const tipo = ["mensal", "adiantamento", "ferias", "decimo_terceiro", "rescisao"].includes(texto(corpo.tipo, 20))
    ? texto(corpo.tipo, 20) : "mensal";
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO todogreen_payroll_runs (id, tenant_id, workspace_owner_id, competencia, tipo, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'aberta', ?, ?, ?)`,
    ).bind(id, TENANT_ID, access.ownerId, competencia, tipo, user.id, agora, agora).run();
  } catch {
    return json({ error: "Já existe uma folha para esta competência e tipo." }, 409);
  }
  const row = await env.DB.prepare("SELECT * FROM todogreen_payroll_runs WHERE id = ?").bind(id).first();
  return json(runDaLinha(row), 201);
};

// Fechar: calcula o holerite de cada colaborador ativo, grava os itens e trava.
const fecharRun = async (env, access, user, runId) => {
  const run = await env.DB.prepare(
    `SELECT * FROM todogreen_payroll_runs WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(runId, TENANT_ID, access.ownerId).first();
  if (!run) return json({ error: "Folha não encontrada." }, 404);
  if (run.status === "fechada") return json({ error: "Esta folha já está fechada." }, 409);

  const { results: colaboradores } = await env.DB.prepare(
    `SELECT * FROM todogreen_employees
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL AND status IN ('active','leave')`,
  ).bind(TENANT_ID, access.ownerId).all();
  if (!(colaboradores || []).length) return json({ error: "Nenhum colaborador ativo para calcular." }, 400);

  const agora = new Date().toISOString();
  // Limpa itens anteriores (fechamento recalcula do zero) e regrava.
  await env.DB.prepare("DELETE FROM todogreen_payroll_items WHERE payroll_run_id = ? AND workspace_owner_id = ?")
    .bind(runId, access.ownerId).run();

  const itensCalculados = [];
  const gravacoes = [];
  for (const c of colaboradores) {
    // Horas extras do ponto viram provento tributável na competência.
    const ponto = await env.DB.prepare(
      `SELECT COALESCE(SUM(horas_extras),0) AS extras, COALESCE(SUM(horas_noturnas),0) AS noturnas
        FROM todogreen_time_clock WHERE employee_id = ? AND workspace_owner_id = ? AND dia LIKE ?`,
    ).bind(c.id, access.ownerId, `${run.competencia}%`).first();

    const eventos = [];
    const valorHora = c.salario_base / 220;
    if (numero(ponto?.extras) > 0) {
      eventos.push({ codigo: "he50", descricao: "Horas extras 50%", valor: valorHora * 1.5 * numero(ponto.extras), tributavel: true });
    }
    if (numero(ponto?.noturnas) > 0) {
      eventos.push({ codigo: "adnot", descricao: "Adicional noturno", valor: valorHora * 0.2 * numero(ponto.noturnas), tributavel: true });
    }

    const folha = calcularFolha(
      { salarioBase: c.salario_base, dependentes: c.dependentes },
      { tabela: TABELAS_2025, eventos },
    );
    itensCalculados.push({ colaborador: c, folha });
    gravacoes.push(env.DB.prepare(
      `INSERT INTO todogreen_payroll_items
        (id, tenant_id, workspace_owner_id, payroll_run_id, employee_id, salario_base,
         total_proventos, total_descontos, liquido, base_inss, inss_valor, base_irrf, irrf_valor, fgts_valor,
         proventos_json, descontos_json, created_at)
       VALUES (?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?)`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, access.ownerId, runId, c.id, c.salario_base,
      folha.totalProventos, folha.totalDescontos, folha.liquido,
      folha.baseInss, folha.inss.valor, folha.baseIrrf, folha.irrf.valor, folha.fgts.valor,
      JSON.stringify(folha.proventos), JSON.stringify(folha.descontos), agora,
    ));
  }
  await env.DB.batch(gravacoes);

  const totais = resumoFolha(itensCalculados.map(({ folha }) => ({
    totalProventos: folha.totalProventos, totalDescontos: folha.totalDescontos, liquido: folha.liquido,
    fgtsValor: folha.fgts.valor, inssValor: folha.inss.valor, irrfValor: folha.irrf.valor,
  })));

  await env.DB.prepare(
    `UPDATE todogreen_payroll_runs SET status = 'fechada', versao_tabela = ?,
      total_proventos = ?, total_descontos = ?, total_liquido = ?, total_fgts = ?, total_inss = ?, total_irrf = ?,
      fechada_por = ?, fechada_em = ?, revision = revision + 1, updated_at = ?
     WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(
    TABELAS_2025.versao, totais.totalProventos, totais.totalDescontos, totais.totalLiquido,
    totais.totalFgts, totais.totalInss, totais.totalIrrf, user.id, agora, agora,
    runId, TENANT_ID, access.ownerId,
  ).run();

  const row = await env.DB.prepare("SELECT * FROM todogreen_payroll_runs WHERE id = ?").bind(runId).first();
  return json({ run: runDaLinha(row), colaboradores: itensCalculados.length, ...totais });
};

const reabrirRun = async (env, access, user, runId) => {
  const run = await env.DB.prepare(
    `SELECT status FROM todogreen_payroll_runs WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(runId, TENANT_ID, access.ownerId).first();
  if (!run) return json({ error: "Folha não encontrada." }, 404);
  if (run.status !== "fechada") return json({ error: "Só uma folha fechada pode ser reaberta." }, 409);
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_payroll_runs SET status = 'reaberta', reaberta_por = ?, reaberta_em = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(user.id, agora, agora, runId, TENANT_ID, access.ownerId).run();
  return json({ ok: true });
};

const listarItens = async (env, access, runId) => {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_payroll_items WHERE payroll_run_id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(runId, TENANT_ID, access.ownerId).all();
  return json({ registros: (results || []).map(itemDaLinha) });
};

// ---------------------------------------------------------------------------
// Férias
// ---------------------------------------------------------------------------

const listarFerias = async (env, access, url) => {
  const employeeId = texto(url.searchParams.get("colaborador"), 120);
  const filtro = employeeId ? "AND employee_id = ?" : "";
  const params = [TENANT_ID, access.ownerId, ...(employeeId ? [employeeId] : [])];
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_vacations
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL ${filtro}
      ORDER BY periodo_aquisitivo_fim DESC`,
  ).bind(...params).all();
  return json({ registros: (results || []).map(feriasDaLinha) });
};

const criarFerias = async (env, access, user, corpo) => {
  const employeeId = texto(corpo.employeeId || corpo.colaboradorId, 120);
  const colaborador = await env.DB.prepare(
    `SELECT id FROM todogreen_employees WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(employeeId, TENANT_ID, access.ownerId).first();
  if (!colaborador) return json({ error: "Colaborador não encontrado." }, 404);
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_vacations
      (id, tenant_id, workspace_owner_id, employee_id, periodo_aquisitivo_inicio, periodo_aquisitivo_fim,
       gozo_inicio, gozo_fim, dias, abono_pecuniario, adiantar_decimo, status, fields_json, revision, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?, ?,?,?,?,?, ?,?,1,?,?,?)`,
  ).bind(
    id, TENANT_ID, access.ownerId, employeeId,
    texto(corpo.periodoAquisitivoInicio, 20), texto(corpo.periodoAquisitivoFim, 20),
    texto(corpo.gozoInicio, 20) || null, texto(corpo.gozoFim, 20) || null,
    Math.max(0, Math.min(30, inteiro(corpo.dias) || 30)),
    corpo.abonoPecuniario ? 1 : 0, corpo.adiantarDecimo ? 1 : 0,
    ["programada", "aprovada", "em_gozo", "concluida", "cancelada"].includes(texto(corpo.status, 20))
      ? texto(corpo.status, 20) : "programada",
    JSON.stringify(objeto(corpo.campos)), user.id, agora, agora,
  ).run();
  const row = await env.DB.prepare("SELECT * FROM todogreen_vacations WHERE id = ?").bind(id).first();
  return json(feriasDaLinha(row), 201);
};

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------

const obterResumo = async (env, access) => {
  const [ativos, ultimaRun] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(salario_base),0) AS folha
        FROM todogreen_employees WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL AND status NOT IN ('terminated','inactive')`,
    ).bind(TENANT_ID, access.ownerId).first(),
    env.DB.prepare(
      `SELECT * FROM todogreen_payroll_runs WHERE tenant_id = ? AND workspace_owner_id = ? AND status = 'fechada'
        ORDER BY competencia DESC LIMIT 1`,
    ).bind(TENANT_ID, access.ownerId).first(),
  ]);
  return json({
    colaboradoresAtivos: ativos?.total || 0,
    folhaBase: ativos?.folha || 0,
    ultimoFechamento: ultimaRun ? runDaLinha(ultimaRun) : null,
    transmissaoEsocialHabilitada: payrollTransmissionEnabled(env),
  });
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

export async function handleTodoGreenPayroll(request, env, access, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/todogreen/payroll", "");
  const method = request.method;

  // Porta única do dado sensível: sem hr:manage, nada. Só rh/admin/owner têm.
  if (!podeNaVertical(access, "hr:manage"))
    return json({ error: "Sem permissão para o módulo de pessoas e folha." }, 403);

  if (path === "/resumo" && method === "GET") return obterResumo(env, access);

  // Colaboradores
  const empMatch = path.match(/^\/colaboradores(?:\/([^/]+))?$/);
  if (empMatch) {
    const id = empMatch[1];
    if (!id) {
      if (method === "GET") return listarColaboradores(env, access, url);
      if (method === "POST") return criarColaborador(env, access, user, await request.json().catch(() => ({})));
    } else {
      if (method === "GET") return obterColaborador(env, access, id);
      if (method === "PATCH") return atualizarColaborador(env, access, user, id, await request.json().catch(() => ({})));
      if (method === "DELETE") return arquivarColaborador(env, access, user, id);
    }
  }

  // Ponto
  if (path === "/ponto") {
    if (method === "GET") return listarPonto(env, access, url);
    if (method === "POST") return registrarPonto(env, access, user, await request.json().catch(() => ({})));
  }

  // Folha
  const runMatch = path.match(/^\/folhas(?:\/([^/]+))?(?:\/(fechar|reabrir|itens))?$/);
  if (runMatch) {
    const [, runId, acao] = runMatch;
    if (!runId) {
      if (method === "GET") return listarRuns(env, access);
      if (method === "POST") return criarRun(env, access, user, await request.json().catch(() => ({})));
    } else if (acao === "fechar" && method === "POST") {
      return fecharRun(env, access, user, runId);
    } else if (acao === "reabrir" && method === "POST") {
      return reabrirRun(env, access, user, runId);
    } else if (acao === "itens" && method === "GET") {
      return listarItens(env, access, runId);
    }
  }

  // Férias
  if (path === "/ferias") {
    if (method === "GET") return listarFerias(env, access, url);
    if (method === "POST") return criarFerias(env, access, user, await request.json().catch(() => ({})));
  }

  return json({ error: "Rota da folha não encontrada." }, 404);
}
