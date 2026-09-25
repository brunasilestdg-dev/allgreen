// ===== Planner (estilo Microsoft Planner) =====
//
// Planos com baldes e tarefas legadas de migração. A regra que este handler protege é a
// visibilidade: um plano `private` só aparece para quem o criou; um `shared`,
// para todo o espaço de trabalho. É o "pode ser compartilhado ou não". A mesma
// regra do `plannerDomain.js` (podeVerPlano/podeEditarPlano) é repetida aqui em
// SQL — o servidor é a autoridade, nunca o botão da tela.
//
// Escopo, como toda a vertical: tenant_id → workspace_owner_id (do vínculo,
// nunca do corpo) → archived_at IS NULL. E, por cima, o corte de visibilidade.
//
// Progresso da tarefa é status + checklist; nunca um número solto. O `progress`
// gravado é só o rótulo (nao_iniciada / em_andamento / concluida) — a barra é
// calculada no domínio.

import { TENANT_ID, alcancaEspacoNaVertical, paginacao, podeNaVertical } from "./todogreen-access.js";
import {
  normalizarBaldes,
  normalizarMembros,
  normalizarPrioridade,
  normalizarProgresso,
  normalizarVisibilidade,
  validarPlano,
  validarTarefa,
} from "../../src/features/logistics/plannerDomain.js";
import {
  aplicarEdicaoPlannerNaTarefa,
  aplicarPartilhaDoPlanoNaTarefa,
  desvincularTarefaDoPlanner,
} from "../../src/features/logistics/plannerIntegrationDomain.js";

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
  try {
    return JSON.parse(valor || "");
  } catch {
    return alternativa;
  }
};
const objeto = (valor) => (valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {});
const listaJson = (valor) => (Array.isArray(valor) ? valor : []);
const dataOuNulo = (valor) => {
  const t = texto(valor, 30);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};

const ehAdmin = (access) => ["owner", "admin"].includes(access?.role);

// ---------------------------------------------------------------------------
// Mapeamento
// ---------------------------------------------------------------------------

const planoDaLinha = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  visibility: row.visibility,
  color: row.color,
  buckets: parse(row.buckets_json, []),
  // Pessoas específicas de um plano privado (0077). Linha anterior à
  // migração volta [] pelo DEFAULT da coluna.
  members: parse(row.members_json, []),
  ownerUserId: row.owner_user_id,
  campos: parse(row.fields_json, {}),
  revision: row.revision,
  criadoPor: row.created_by,
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
});

const tarefaDaLinha = (row) => ({
  id: row.id,
  planId: row.plan_id,
  bucketId: row.bucket_id,
  title: row.title,
  notes: row.notes,
  assigneeUserId: row.assignee_user_id,
  assigneeLabel: row.assignee_label,
  progress: row.progress,
  priority: row.priority,
  startDate: row.start_date || "",
  dueDate: row.due_date || "",
  completedAt: row.completed_at || "",
  checklist: parse(row.checklist_json, []),
  labels: parse(row.labels_json, []),
  displayOrder: row.display_order,
  campos: parse(row.fields_json, {}),
  revision: row.revision,
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
});

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------

// Corte de visibilidade como SQL. Admin/owner veem o espaço inteiro; os demais
// veem os compartilhados, os próprios privados e os privados em que foram
// listados como pessoa específica (json_each sobre members_json — espelho em
// SQL do podeVerPlano do plannerDomain). O prefixo serve para a consulta de
// "minhas tarefas", onde o plano entra por JOIN como `p`.
const recorteVisibilidade = (access, p = "") => {
  if (ehAdmin(access)) return { sql: "", params: [] };
  return {
    sql: ` AND (${p}visibility = 'shared' OR ${p}owner_user_id = ?
      OR EXISTS (SELECT 1 FROM json_each(${p}members_json) WHERE json_each.value = ?))`,
    params: [access.userId, access.userId],
  };
};

const listarPlanos = async (env, access) => {
  const corte = recorteVisibilidade(access);
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_planner_plans
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL ${corte.sql}
      ORDER BY updated_at DESC`,
  ).bind(TENANT_ID, access.ownerId, ...corte.params).all();
  return json({ registros: (results || []).map(planoDaLinha) });
};

// Busca o plano já aplicando o corte de visibilidade. Devolve a linha ou null —
// e o chamador responde 404 (não 403): não entregamos que o plano existe para
// quem não pode vê-lo.
const buscarPlanoVisivel = async (env, access, id) => {
  const corte = recorteVisibilidade(access);
  return env.DB.prepare(
    `SELECT * FROM todogreen_planner_plans
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL ${corte.sql}`,
  ).bind(id, TENANT_ID, access.ownerId, ...corte.params).first();
};

const colunasPlano = (corpo) => ({
  name: texto(corpo.name || corpo.nome, 120),
  description: texto(corpo.description || corpo.descricao, 2000),
  visibility: normalizarVisibilidade(corpo.visibility || corpo.visibilidade),
  color: texto(corpo.color || corpo.cor, 20) || "#17624f",
  buckets_json: JSON.stringify(normalizarBaldes(corpo.buckets || corpo.baldes)),
  fields_json: JSON.stringify(objeto(corpo.campos)),
});

// As pessoas específicas de um plano vêm do navegador: id que não é gente do
// espaço é descartado em silêncio — a mesma régua do responsável de tarefa.
// A lista sobrevive à troca de visibilidade (voltar de 'shared' para privado
// não perde quem foi escolhido).
const membrosValidados = async (env, access, valor) => {
  const ids = normalizarMembros(valor);
  const validos = [];
  for (const id of ids) {
    if (await responsavelValidado(env, access, id)) validos.push(id);
  }
  return validos;
};

// Ser "gente do espaço" (memberships/tenant_users) não é o mesmo que conseguir
// ABRIR a To Do Green neste espaço: quem entrou só pelo espaço do app (convite
// do Seu Funcionário) é aceito na lista, mas o servidor da vertical o recusa na
// porta — e a titular via "compartilhado com 2 pessoas" enquanto ninguém via o
// plano. A lista é mantida (quando o acesso for liberado em Acessos, o plano
// aparece sem precisar compartilhar de novo); o que muda é que a resposta DIZ
// quem ainda não alcança, para a tela avisar em vez de prometer.
const membrosQueNaoAlcancam = async (env, access, ids) => {
  if (!ids.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT id, email FROM users WHERE id IN (${ids.map(() => "?").join(",")})`,
  ).bind(...ids).all();
  const porId = new Map((results || []).map((u) => [u.id, u]));
  const alcance = await Promise.all(ids.map(async (id) => {
    const pessoa = porId.get(id);
    if (!pessoa) return false;
    return alcancaEspacoNaVertical(env, pessoa, access.ownerId);
  }));
  return ids.filter((_, i) => !alcance[i]);
};

const criarPlano = async (env, access, corpo) => {
  const erros = validarPlano({ name: corpo.name || corpo.nome });
  if (erros.length) return json({ error: "Plano com pendências.", erros }, 400);
  const dados = colunasPlano(corpo);
  const membros = await membrosValidados(env, access, corpo.members || corpo.membros);
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_planner_plans
      (id, tenant_id, workspace_owner_id, name, description, visibility, color, buckets_json,
       members_json, owner_user_id, fields_json, revision, created_by, updated_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?, ?,?,?,1,?,?,?,?)`,
  ).bind(
    id, TENANT_ID, access.ownerId, dados.name, dados.description, dados.visibility,
    dados.color, dados.buckets_json, JSON.stringify(membros), access.userId, dados.fields_json,
    access.userId, access.userId, agora, agora,
  ).run();
  const row = await env.DB.prepare("SELECT * FROM todogreen_planner_plans WHERE id = ?").bind(id).first();
  return json({ ...planoDaLinha(row), membrosSemAcesso: await membrosQueNaoAlcancam(env, access, membros) }, 201);
};

// Editar a estrutura do plano (nome, baldes, visibilidade) é do criador — e da
// administração. Quem só participa mexe nas tarefas, não no plano.
const podeEditarPlanoLinha = (row, access) =>
  ehAdmin(access) || row.owner_user_id === access.userId;

const atualizarPlano = async (env, access, id, corpo) => {
  const atual = await buscarPlanoVisivel(env, access, id);
  if (!atual) return json({ error: "Plano não encontrado." }, 404);
  if (!podeEditarPlanoLinha(atual, access))
    return json({ error: "Só quem criou o plano pode alterá-lo." }, 403);
  if (numero(corpo.revision) !== atual.revision)
    return json({ error: "O plano foi alterado por outra pessoa. Recarregue." }, 409);

  const mesclado = { ...planoDaLinha(atual), ...corpo };
  const dados = colunasPlano(mesclado);
  const membros = await membrosValidados(env, access, mesclado.members ?? mesclado.membros);
  await env.DB.prepare(
    `UPDATE todogreen_planner_plans
       SET name = ?, description = ?, visibility = ?, color = ?, buckets_json = ?, members_json = ?, fields_json = ?,
           revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(
    dados.name, dados.description, dados.visibility, dados.color, dados.buckets_json,
    JSON.stringify(membros), dados.fields_json, access.userId, new Date().toISOString(), id, TENANT_ID, access.ownerId,
  ).run();
  const row = await env.DB.prepare("SELECT * FROM todogreen_planner_plans WHERE id = ?").bind(id).first();
  const plano = planoDaLinha(row);
  const espaco = await sincronizarTarefasDoPlano(env, access, (t) => aplicarPartilhaDoPlanoNaTarefa(t, plano));
  return json({ ...plano, membrosSemAcesso: await membrosQueNaoAlcancam(env, access, membros), espaco });
};

const arquivarPlano = async (env, access, id) => {
  const atual = await buscarPlanoVisivel(env, access, id);
  if (!atual) return json({ error: "Plano não encontrado." }, 404);
  if (!podeEditarPlanoLinha(atual, access))
    return json({ error: "Só quem criou o plano pode arquivá-lo." }, 403);
  const agora = new Date().toISOString();
  // Arquivar o plano leva junto as tarefas: um plano fora do ar não deixa
  // tarefa órfã aparecendo em "minhas tarefas".
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE todogreen_planner_plans SET archived_at = ?, revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(agora, access.userId, agora, id, TENANT_ID, access.ownerId),
    env.DB.prepare(
      `UPDATE todogreen_planner_tasks SET archived_at = ?, updated_at = ?
        WHERE plan_id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(agora, agora, id, TENANT_ID, access.ownerId),
  ]);
  // A task canônica fica (arquivar remove a VISTA, não o trabalho): só perde o
  // vínculo com o plano e a partilha que veio dele.
  const espaco = await sincronizarTarefasDoPlano(env, access, (t) => desvincularTarefaDoPlanner(t, id));
  return json({ ok: true, espaco });
};

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

const listarTarefas = async (env, access, planId) => {
  const plano = await buscarPlanoVisivel(env, access, planId);
  if (!plano) return json({ error: "Plano não encontrado." }, 404);
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_planner_tasks
      WHERE plan_id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
      ORDER BY display_order, created_at`,
  ).bind(planId, TENANT_ID, access.ownerId).all();
  return json({ plano: planoDaLinha(plano), registros: (results || []).map(tarefaDaLinha) });
};

// "Minhas tarefas": o que está atribuído a mim, entre os planos que eu alcanço.
// O corte de visibilidade entra por JOIN — tarefa de plano privado alheio não
// aparece, mesmo que por algum engano eu esteja como responsável.
const minhasTarefas = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const corte = recorteVisibilidade(access, "p.");
  const incluirConcluidas = url.searchParams.get("concluidas") === "1";
  const filtroStatus = incluirConcluidas ? "" : " AND t.progress != 'concluida'";
  const { results } = await env.DB.prepare(
    `SELECT t.* FROM todogreen_planner_tasks t
       JOIN todogreen_planner_plans p ON p.id = t.plan_id
      WHERE t.tenant_id = ? AND t.workspace_owner_id = ? AND t.archived_at IS NULL
        AND p.archived_at IS NULL AND t.assignee_user_id = ? ${filtroStatus} ${corte.sql}
      ORDER BY (t.due_date IS NULL), t.due_date, t.display_order
      LIMIT ? OFFSET ?`,
  ).bind(TENANT_ID, access.ownerId, access.userId, ...corte.params, limit, offset).all();
  return json({ registros: (results || []).map(tarefaDaLinha), limit, offset });
};

const colunasTarefa = (corpo, plano) => {
  // O balde tem de existir no plano; um id inválido cai no primeiro balde em
  // vez de virar tarefa órfã que a tela esconde.
  const baldes = normalizarBaldes(parse(plano.buckets_json, []));
  const bucketPedido = texto(corpo.bucketId || corpo.balde, 60);
  const bucketId = baldes.some((b) => b.id === bucketPedido) ? bucketPedido : baldes[0].id;
  const progress = normalizarProgresso(corpo.progress || corpo.progresso);
  return {
    bucket_id: bucketId,
    title: texto(corpo.title || corpo.titulo, 200),
    notes: texto(corpo.notes || corpo.notas, 4000),
    assignee_user_id: texto(corpo.assigneeUserId, 120),
    assignee_label: texto(corpo.assigneeLabel || corpo.responsavel, 160),
    progress,
    priority: normalizarPrioridade(corpo.priority || corpo.prioridade),
    start_date: dataOuNulo(corpo.startDate || corpo.inicio),
    due_date: dataOuNulo(corpo.dueDate || corpo.prazo),
    // Concluir carimba a data; reabrir a limpa. O carimbo é derivado do status,
    // nunca enviado solto pela tela.
    completed_at: progress === "concluida" ? texto(corpo.completedAt, 30) || new Date().toISOString() : null,
    checklist_json: JSON.stringify(
      listaJson(corpo.checklist).slice(0, 100).map((i) => ({
        texto: texto(i?.texto || i?.text, 300),
        feito: Boolean(i?.feito || i?.done),
      })),
    ),
    labels_json: JSON.stringify(listaJson(corpo.labels).slice(0, 30).map((l) => texto(l, 60))),
    display_order: inteiro(corpo.displayOrder) || 100,
    fields_json: JSON.stringify(objeto(corpo.campos)),
  };
};

// A tela sugere pessoas da plataforma, mas o corpo vem do navegador: um id
// que não é gente do espaço não entra na coluna — a tarefa ficaria
// "atribuída" a alguém que nunca a veria em Minhas tarefas. O rótulo continua
// valendo sozinho para gente de fora (um terceiro, um contato do cliente);
// só o vínculo por id exige vínculo real. "Gente do espaço" são as duas
// portas que existem: membro do espaço do app (memberships, a lista que o
// /api/collab sugere na tela) ou vínculo direto na vertical (tenant_users).
const vinculosComerciaisValidados = async (env, access, campos) => {
  const recebidos = objeto(campos);
  const clientId = texto(recebidos.clientId, 120);
  const opportunityId = texto(recebidos.opportunityId, 120);
  if (!clientId && !opportunityId) return { ...recebidos, clientId: "", opportunityId: "" };

  const cliente = clientId
    ? await env.DB.prepare(
      `SELECT id FROM todogreen_clients
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(clientId, TENANT_ID, access.ownerId).first()
    : null;
  if (clientId && !cliente) throw Object.assign(new Error("Cliente vinculado não encontrado."), { status: 400 });

  const oportunidade = opportunityId
    ? await env.DB.prepare(
      `SELECT id, client_id FROM todogreen_opportunities
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(opportunityId, TENANT_ID, access.ownerId).first()
    : null;
  if (opportunityId && (!oportunidade || !clientId || oportunidade.client_id !== clientId))
    throw Object.assign(new Error("A oportunidade não pertence ao cliente selecionado."), { status: 400 });

  return { ...recebidos, clientId, opportunityId };
};

const responsavelValidado = async (env, access, assigneeUserId) => {
  const id = texto(assigneeUserId, 120);
  if (!id) return "";
  if (id === access.ownerId || id === access.userId) return id;
  const membro = await env.DB.prepare(
    "SELECT member_id FROM memberships WHERE owner_id = ? AND member_id = ? AND status = 'ativo'",
  ).bind(access.ownerId, id).first();
  if (membro) return id;
  const vinculo = await env.DB.prepare(
    `SELECT user_id FROM tenant_users
      WHERE tenant_id = ? AND workspace_owner_id = ? AND user_id = ? AND status = 'active'`,
  ).bind(TENANT_ID, access.ownerId, id).first();
  return vinculo ? id : "";
};

const criarTarefa = async (env, access, planId, corpo) => {
  const plano = await buscarPlanoVisivel(env, access, planId);
  if (!plano) return json({ error: "Plano não encontrado." }, 404);
  const erros = validarTarefa({
    title: corpo.title || corpo.titulo,
    startDate: corpo.startDate,
    dueDate: corpo.dueDate,
  });
  if (erros.length) return json({ error: "Tarefa com pendências.", erros }, 400);

  let camposValidados;
  try {
    camposValidados = await vinculosComerciaisValidados(env, access, corpo.campos);
  } catch (erro) {
    return json({ error: erro.message }, erro.status || 400);
  }
  const dados = colunasTarefa(
    {
      ...corpo,
      campos: camposValidados,
      assigneeUserId: await responsavelValidado(env, access, corpo.assigneeUserId),
    },
    plano,
  );
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  const colunas = Object.keys(dados).join(", ");
  const placeholders = Object.keys(dados).map(() => "?").join(", ");
  await env.DB.prepare(
    `INSERT INTO todogreen_planner_tasks
      (id, tenant_id, workspace_owner_id, plan_id, ${colunas}, revision, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ${placeholders}, 1, ?, ?, ?, ?)`,
  ).bind(id, TENANT_ID, access.ownerId, planId, ...Object.values(dados), access.userId, access.userId, agora, agora).run();
  const row = await env.DB.prepare("SELECT * FROM todogreen_planner_tasks WHERE id = ?").bind(id).first();
  return json(tarefaDaLinha(row), 201);
};

const atualizarTarefa = async (env, access, planId, taskId, corpo) => {
  const plano = await buscarPlanoVisivel(env, access, planId);
  if (!plano) return json({ error: "Plano não encontrado." }, 404);
  const atual = await env.DB.prepare(
    `SELECT * FROM todogreen_planner_tasks
      WHERE id = ? AND plan_id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(taskId, planId, TENANT_ID, access.ownerId).first();
  if (!atual) return json({ error: "Tarefa não encontrada." }, 404);
  if (numero(corpo.revision) !== atual.revision)
    return json({ error: "A tarefa foi alterada por outra pessoa. Recarregue." }, 409);

  const erros = validarTarefa({
    title: corpo.title ?? atual.title,
    startDate: corpo.startDate ?? atual.start_date,
    dueDate: corpo.dueDate ?? atual.due_date,
  });
  if (erros.length) return json({ error: "Tarefa com pendências.", erros }, 400);

  const mesclado = { ...tarefaDaLinha(atual), ...corpo };
  mesclado.assigneeUserId = await responsavelValidado(env, access, mesclado.assigneeUserId);
  try {
    mesclado.campos = await vinculosComerciaisValidados(env, access, mesclado.campos);
  } catch (erro) {
    return json({ error: erro.message }, erro.status || 400);
  }
  const dados = colunasTarefa(mesclado, plano);
  const sets = Object.keys(dados).map((k) => `${k} = ?`).join(", ");
  await env.DB.prepare(
    `UPDATE todogreen_planner_tasks SET ${sets}, revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND plan_id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(...Object.values(dados), access.userId, new Date().toISOString(), taskId, planId, TENANT_ID, access.ownerId).run();
  const row = await env.DB.prepare("SELECT * FROM todogreen_planner_tasks WHERE id = ?").bind(taskId).first();
  return json(tarefaDaLinha(row));
};

const arquivarTarefa = async (env, access, planId, taskId) => {
  const plano = await buscarPlanoVisivel(env, access, planId);
  if (!plano) return json({ error: "Plano não encontrado." }, 404);
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE todogreen_planner_tasks SET archived_at = ?, updated_by = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND plan_id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(agora, access.userId, agora, taskId, planId, TENANT_ID, access.ownerId).run();
  return json({ ok: true });
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

// As pessoas que a tela pode sugerir para responsável de tarefa e para
// compartilhar plano são as MESMAS duas portas que `responsavelValidado`
// aceita: membro do espaço do app (memberships, status 'ativo') e vínculo
// direto na vertical (tenant_users, status 'active'). O /api/collab só
// enxerga a primeira porta — quem entrou pela vertical (ex.: um colaborador
// cadastrado só no To Do Green) existia no banco, era aceito na gravação,
// mas nunca aparecia na sugestão. Aqui unimos as duas, sempre dentro do
// espaço (owner_id/workspace_owner_id), com nome e e-mail de `users`.
const pessoasDoEspaco = async (env, access) => {
  const dono = await env.DB.prepare(
    "SELECT id, name, email FROM users WHERE id = ?",
  ).bind(access.ownerId).first();

  const membros = await env.DB.prepare(
    `SELECT users.id, users.name, users.email
       FROM memberships
       JOIN users ON users.id = memberships.member_id
      WHERE memberships.owner_id = ? AND memberships.status = 'ativo'`,
  ).bind(access.ownerId).all();

  const vinculos = await env.DB.prepare(
    `SELECT users.id, users.name, users.email
       FROM tenant_users
       JOIN users ON users.id = tenant_users.user_id
      WHERE tenant_users.tenant_id = ? AND tenant_users.workspace_owner_id = ?
        AND tenant_users.status = 'active'`,
  ).bind(TENANT_ID, access.ownerId).all();

  const unicos = [];
  const vistos = new Set();
  for (const pessoa of [dono, ...(membros.results || []), ...(vinculos.results || [])]) {
    if (pessoa?.id && pessoa?.name && !vistos.has(pessoa.id)) {
      vistos.add(pessoa.id);
      unicos.push({ id: pessoa.id, name: pessoa.name, email: pessoa.email || "" });
    }
  }
  // `alcancaPlanner`: se esta pessoa consegue abrir a vertical neste espaço —
  // isto é, se compartilhar um plano com ela vai de fato mostrá-lo. Quem está
  // só no espaço do app vem marcado false, e a tela explica o que falta
  // (liberar em Acessos) em vez de deixar a titular achar que compartilhou.
  const alcances = await Promise.all(
    unicos.map((pessoa) => alcancaEspacoNaVertical(env, pessoa, access.ownerId)),
  );
  return json({ registros: unicos.map((pessoa, i) => ({ ...pessoa, alcancaPlanner: alcances[i] })) });
};


// ---------------------------------------------------------------------------
// Ações do plano (task canônica no quadro único do espaço)
// ---------------------------------------------------------------------------
//
// As tarefas do Planner são a task canônica (`db.tasks`), e o `db.tasks` que
// vale para a To Do Green é o do DONO do espaço (`workspaces.user_id =
// access.ownerId`). Antes a tela gravava no workspace de QUEM estava logado:
// a titular via as ações dela, cada colega via só as que ele mesmo criou, e
// quem entrou pela vertical (tenant_users, sem estar no espaço do app) abria o
// plano compartilhado com o quadro vazio. Aqui o servidor lê e grava as ações
// do plano no quadro do espaço, com o mesmo corte de visibilidade do PLANO:
// quem vê o plano vê TODAS as ações dele — é o que "compartilhar" promete.
//
// Não é um segundo store: é o mesmo `db.tasks` que o To Do, o Meu Dia e o CRM
// leem, gravado com a revisão condicional do workspace (o mesmo padrão do
// `/api/tasks/action`). `todogreen_planner_tasks` continua só para migração.

const TAREFAS_DO_ESPACO_MAX = 5000;

const lerEspaco = async (env, ownerId) => {
  const row = await env.DB.prepare(
    "SELECT data, revision, updated_at FROM workspaces WHERE user_id = ?",
  ).bind(ownerId).first();
  if (!row) return null;
  return { data: objeto(parse(row.data, {})), revision: Number(row.revision) || 0, updatedAt: row.updated_at };
};

// `mutar(tarefas)` devolve `{ tarefas, alteradas, removidas }` ou null quando
// não há nada a gravar. Revisão condicional com retentativa: outra gravação no
// meio (a própria tela da titular salvando) não se perde nem é atropelada.
const gravarNoEspaco = async (env, ownerId, mutar) => {
  for (let tentativa = 0; tentativa < 4; tentativa += 1) {
    let espaco = await lerEspaco(env, ownerId);
    if (!espaco) {
      await env.DB.prepare(
        "INSERT INTO workspaces (user_id, data, updated_at, revision) VALUES (?, '{}', ?, 0) ON CONFLICT(user_id) DO NOTHING",
      ).bind(ownerId, new Date().toISOString()).run();
      espaco = await lerEspaco(env, ownerId);
      if (!espaco) throw Object.assign(new Error("Espaço de trabalho indisponível."), { status: 503 });
    }
    const atuais = listaJson(espaco.data.tasks);
    const resultado = mutar(atuais);
    if (!resultado) return { revision: espaco.revision, updatedAt: espaco.updatedAt, tarefas: [], removidas: [] };
    if (resultado.tarefas.length > TAREFAS_DO_ESPACO_MAX)
      throw Object.assign(new Error("O quadro de tarefas do espaço atingiu o limite."), { status: 413 });
    const updatedAt = new Date().toISOString();
    const gravado = await env.DB.prepare(
      `UPDATE workspaces
          SET data = ?, updated_at = ?, revision = revision + 1
        WHERE user_id = ? AND revision = ?
        RETURNING revision, updated_at`,
    ).bind(
      JSON.stringify({ ...espaco.data, tasks: resultado.tarefas, updatedAt }),
      updatedAt, ownerId, espaco.revision,
    ).first();
    if (gravado)
      return {
        revision: gravado.revision,
        updatedAt: gravado.updated_at,
        tarefas: resultado.alteradas || [],
        removidas: resultado.removidas || [],
      };
  }
  throw Object.assign(new Error("O quadro mudou enquanto você salvava. Tente de novo."), { status: 409 });
};

const planosVisiveis = async (env, access) => {
  const corte = recorteVisibilidade(access);
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_planner_plans
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL ${corte.sql}`,
  ).bind(TENANT_ID, access.ownerId, ...corte.params).all();
  return results || [];
};

const tarefaAtiva = (t) => t && t.id && t.archived !== true && t.deleted !== true;

const listarAcoes = async (env, access, url) => {
  const planos = await planosVisiveis(env, access);
  const pedido = texto(url.searchParams.get("plano"), 120);
  const ids = new Set(planos.map((p) => p.id).filter((id) => !pedido || id === pedido));
  if (pedido && !ids.size) return json({ error: "Plano não encontrado." }, 404);
  const espaco = await lerEspaco(env, access.ownerId);
  const registros = listaJson(espaco?.data?.tasks)
    .filter((t) => tarefaAtiva(t) && ids.has(t.plannerPlanId));
  return json({ registros, revision: espaco?.revision ?? 0 });
};

const limparLista = (valor, max, mapa) => listaJson(valor).slice(0, max).map(mapa).filter(Boolean);

const salvarAcao = async (env, access, planId, taskId, corpo) => {
  const row = await buscarPlanoVisivel(env, access, planId);
  if (!row) return json({ error: "Plano não encontrado." }, 404);
  const recebida = objeto(corpo.tarefa || corpo);
  const erros = validarTarefa({ title: recebida.title, startDate: recebida.startDate, dueDate: recebida.dueDate });
  if (erros.length) return json({ error: "Tarefa com pendências.", erros }, 400);
  const id = texto(taskId, 120);
  if (!id) return json({ error: "Tarefa sem identificador." }, 400);

  let campos;
  try {
    campos = await vinculosComerciaisValidados(env, access, recebida.campos);
  } catch (erro) {
    return json({ error: erro.message }, erro.status || 400);
  }
  const cliente = campos.clientId
    ? await env.DB.prepare(
      "SELECT name FROM todogreen_clients WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?",
    ).bind(campos.clientId, TENANT_ID, access.ownerId).first()
    : null;
  const assigneeUserId = await responsavelValidado(env, access, recebida.assigneeUserId);
  const plano = planoDaLinha(row);
  const limpa = {
    id,
    planId,
    title: texto(recebida.title, 200),
    notes: texto(recebida.notes, 5000),
    bucketId: texto(recebida.bucketId, 60),
    assigneeUserId,
    assigneeLabel: texto(recebida.assigneeLabel, 120),
    priority: normalizarPrioridade(recebida.priority),
    progress: normalizarProgresso(recebida.progress),
    startDate: dataOuNulo(recebida.startDate) || "",
    dueDate: dataOuNulo(recebida.dueDate) || "",
    checklist: limparLista(recebida.checklist, 100, (item) => {
      const textoItem = texto(item?.texto ?? item?.text, 300);
      return textoItem ? { ...objeto(item), texto: textoItem, feito: Boolean(item?.feito) } : null;
    }),
    labels: limparLista(recebida.labels, 20, (rotulo) => texto(rotulo, 40) || null),
    campos,
  };

  let conflito = null;
  const espaco = await gravarNoEspaco(env, access.ownerId, (tarefas) => {
    const indice = tarefas.findIndex((t) => t?.id === id);
    const existente = indice >= 0 ? tarefas[indice] : null;
    // Um id que já é de OUTRA tarefa (de outro plano, ou do To Do fora do
    // Planner) não é sequestrado por um PUT vindo do navegador.
    if (existente && existente.plannerPlanId !== planId) { conflito = "Esta tarefa não pertence a este plano."; return null; }
    const base = existente || { ownerId: access.userId, userId: access.userId, createdBy: access.userId };
    const canonica = {
      ...aplicarEdicaoPlannerNaTarefa(limpa, plano, base, { clientLabel: cliente?.name || "" }),
      updatedBy: access.userId,
    };
    const proximas = existente
      ? tarefas.map((t, i) => (i === indice ? canonica : t))
      : [canonica, ...tarefas];
    return { tarefas: proximas, alteradas: [canonica], removidas: [] };
  });
  if (conflito) return json({ error: conflito }, 409);
  return json({ tarefa: espaco.tarefas[0] || null, espaco });
};

const removerAcao = async (env, access, planId, taskId) => {
  const row = await buscarPlanoVisivel(env, access, planId);
  if (!row) return json({ error: "Plano não encontrado." }, 404);
  const id = texto(taskId, 120);
  const espaco = await gravarNoEspaco(env, access.ownerId, (tarefas) => {
    const alvo = tarefas.find((t) => t?.id === id);
    if (!alvo || alvo.plannerPlanId !== planId) return null;
    return { tarefas: tarefas.filter((t) => t?.id !== id), alteradas: [], removidas: [id] };
  });
  return json({ ok: true, espaco });
};

// Quando o plano muda de partilha ou é arquivado, as tarefas dele no quadro do
// espaço acompanham (o To Do e o Meu Dia leem `canSeeTask`). Sem alteração,
// nada é gravado.
const sincronizarTarefasDoPlano = (env, access, transformar) =>
  gravarNoEspaco(env, access.ownerId, (tarefas) => {
    const alteradas = [];
    const proximas = tarefas.map((t) => {
      const nova = transformar(t);
      if (nova !== t) alteradas.push(nova);
      return nova;
    });
    return alteradas.length ? { tarefas: proximas, alteradas, removidas: [] } : null;
  });

export async function handleTodoGreenPlanner(request, env, access) {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/todogreen/planner", "");
  const method = request.method;

  // Ler exige estar na vertical; escrever exige planner:manage. O auditor lê o
  // que é compartilhado e não cria nada.
  const podeEscrever = podeNaVertical(access, "planner:manage");
  const escrita = ["POST", "PATCH", "PUT", "DELETE"].includes(method);
  if (escrita && !podeEscrever)
    return json({ error: "Sem permissão para gerir o Planner." }, 403);

  const corpo = async () => request.json().catch(() => ({}));

  if (path === "/minhas-tarefas" && method === "GET") return minhasTarefas(env, access, url);
  if (path === "/acoes" && method === "GET") return listarAcoes(env, access, url);

  // Ações do plano: a task canônica no quadro do espaço, com o corte de
  // visibilidade do plano. É o caminho do runtime (não o legado /tarefas).
  const acaoMatch = path.match(/^\/planos\/([^/]+)\/acoes(?:\/([^/]+))?$/);
  if (acaoMatch) {
    const [, planId, taskId] = acaoMatch;
    try {
      if (!taskId && method === "GET") {
        url.searchParams.set("plano", planId);
        return listarAcoes(env, access, url);
      }
      if (taskId && method === "PUT") return await salvarAcao(env, access, planId, taskId, await corpo());
      if (taskId && method === "DELETE") return await removerAcao(env, access, planId, taskId);
    } catch (erro) {
      if (erro?.status) return json({ error: erro.message }, erro.status);
      throw erro;
    }
  }
  if (path === "/pessoas" && method === "GET") return pessoasDoEspaco(env, access);

  // Planos: /planos e /planos/:id
  const planoMatch = path.match(/^\/planos(?:\/([^/]+))?$/);
  if (planoMatch) {
    const id = planoMatch[1];
    if (!id) {
      if (method === "GET") return listarPlanos(env, access);
      if (method === "POST") return criarPlano(env, access, await corpo());
    } else {
      try {
        if (method === "PATCH") return await atualizarPlano(env, access, id, await corpo());
        if (method === "DELETE") return await arquivarPlano(env, access, id);
      } catch (erro) {
        if (erro?.status) return json({ error: erro.message }, erro.status);
        throw erro;
      }
    }
  }

  // Tarefas do Planner são legado de migração. A aplicação atual usa `db.tasks` como
  // fonte canônica e o Planner apenas projeta essa mesma entidade. Leitura segue
  // disponível para importar dados antigos; escrita só existe com opt-in
  // explícito para ferramentas de migração, evitando reabrir a segunda verdade.
  const tarefaMatch = path.match(/^\/planos\/([^/]+)\/tarefas(?:\/([^/]+))?$/);
  if (tarefaMatch) {
    const [, planId, taskId] = tarefaMatch;
    const escritaDeTarefa = ["POST", "PATCH", "PUT", "DELETE"].includes(method);
    const compatibilidadeLegada = request.headers.get("x-tdg-legacy-planner-write") === "1";
    if (escritaDeTarefa && !compatibilidadeLegada) {
      return json({
        error: "As tarefas do Planner agora são uma visão da task canônica. Edite pelo To Do/Planner atual.",
        code: "CANONICAL_TASK_REQUIRED",
      }, 409);
    }
    if (!taskId) {
      if (method === "GET") return listarTarefas(env, access, planId);
      if (method === "POST") return criarTarefa(env, access, planId, await corpo());
    } else {
      if (method === "PATCH") return atualizarTarefa(env, access, planId, taskId, await corpo());
      if (method === "DELETE") return arquivarTarefa(env, access, planId, taskId);
    }
  }

  return json({ error: "Rota do Planner não encontrada." }, 404);
}
