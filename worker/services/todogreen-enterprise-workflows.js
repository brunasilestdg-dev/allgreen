import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
const text = (value, max = 1000) => String(value ?? "").trim().slice(0, max);
const obj = (value, fallback = {}) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || ""); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback; }
  catch { return fallback; }
};
const arr = (value) => Array.isArray(value) ? value : [];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const DOMAINS = new Set(["legal", "quality", "marketing", "general"]);
const STATUSES = new Set(["draft", "pending", "approved", "rejected", "in_progress", "blocked", "done", "cancelled"]);
const PRIORITIES = new Set(["low", "normal", "high", "critical"]);

const canRead = (access, domain) => {
  if (["owner", "admin"].includes(access.role) || podeNaVertical(access, "*")) return true;
  if (domain === "legal") return ["proposal:manage", "deal:review", "deal:approve", "audit:read"].some((p) => podeNaVertical(access, p));
  if (domain === "quality") return ["operations:manage", "evidence:manage", "audit:read"].some((p) => podeNaVertical(access, p));
  if (domain === "marketing") return ["marketing:manage", "market:read", "crm:manage"].some((p) => podeNaVertical(access, p));
  return podeNaVertical(access, "work:manage");
};
const canWrite = (access, domain) => {
  if (["owner", "admin"].includes(access.role) || podeNaVertical(access, "*")) return true;
  if (domain === "legal") return ["proposal:manage", "deal:review"].some((p) => podeNaVertical(access, p));
  if (domain === "quality") return ["operations:manage", "evidence:manage"].some((p) => podeNaVertical(access, p));
  if (domain === "marketing") return podeNaVertical(access, "marketing:manage");
  return podeNaVertical(access, "work:manage");
};

const approvalPlan = (domain, data = {}) => {
  if (domain === "legal") return [
    { id: "juridico", label: "Jurídico", permission: "compliance:manage" },
    { id: "dono-negocio", label: "Dono do negócio / liderança", permission: "deal:approve" },
  ];
  if (domain === "marketing") {
    const budget = number(data.budget ?? data.orcamento);
    const steps = [{ id: "marketing", label: "Marketing", permission: "marketing:manage" }];
    if (budget > 5000) steps.push({ id: "lideranca", label: "Liderança", permission: "deal:approve" });
    if (budget > 25000) steps.push({ id: "financeiro", label: "Financeiro", permission: "finance:manage" });
    return steps;
  }
  if (domain === "quality" && ["capa", "audit", "nonconformity"].includes(text(data.kind || data.tipo, 40).toLowerCase())) return [
    { id: "operacao", label: "Responsável pela operação", permission: "operations:manage" },
    { id: "qualidade", label: "Qualidade / auditoria", permission: "audit:read" },
  ];
  return [];
};

const normalizeApproval = (domain, data, current = {}) => {
  const plan = approvalPlan(domain, data);
  const approvals = arr(current.approvals).filter((item) => plan.some((step) => step.id === item.stepId));
  // "ressalva" (aprovado com ressalva) satisfaz a etapa como uma aprovação —
  // o fluxo anda — mas fica marcada, porque a área precisa saber que passou
  // com uma observação a resolver (pedido do Jurídico: retornar com ressalva).
  const done = new Set(
    approvals.filter((item) => ["approved", "ressalva"].includes(item.decision)).map((item) => item.stepId),
  );
  const next = plan.find((step) => !done.has(step.id)) || null;
  const ressalvas = approvals.filter((item) => item.decision === "ressalva");
  return { plan, approvals, next, complete: plan.length === 0 || !next, ressalvas, comRessalva: ressalvas.length > 0 };
};

const mapRow = (row) => {
  const data = obj(row.data_json);
  const approval = normalizeApproval(row.domain, { ...data, kind: row.kind }, obj(row.approval_json));
  return {
    id: row.id, domain: row.domain, kind: row.kind, title: row.title, description: row.description,
    clientId: row.client_id || "", ownerUserId: row.owner_user_id || "", priority: row.priority,
    status: row.status, dueAt: row.due_at || "", data, approval,
    recurrence: obj(row.recurrence_json), sourceTemplateId: row.source_template_id || "",
    revision: row.revision, createdBy: row.created_by, updatedBy: row.updated_by,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
};

const event = async (env, access, user, workflowId, eventType, note = "", before = {}, after = {}) => {
  await env.DB.prepare(`INSERT INTO todogreen_enterprise_workflow_events
    (id,workflow_id,tenant_id,workspace_owner_id,event_type,actor_user_id,note,before_json,after_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), workflowId, TENANT_ID, access.ownerId, eventType, user.id, text(note, 4000), JSON.stringify(before), JSON.stringify(after), new Date().toISOString()).run();
};

const list = async (env, access, url) => {
  const domain = text(url.searchParams.get("domain"), 30).toLowerCase();
  if (domain && !DOMAINS.has(domain)) return json({ error: "Área inválida." }, 400);
  if (domain && !canRead(access, domain)) return json({ error: "Seu acesso não permite consultar esta área." }, 403);
  const status = text(url.searchParams.get("status"), 30);
  const clauses = ["tenant_id=?", "workspace_owner_id=?", "archived_at IS NULL"];
  const params = [TENANT_ID, access.ownerId];
  if (domain) { clauses.push("domain=?"); params.push(domain); }
  if (status && STATUSES.has(status)) { clauses.push("status=?"); params.push(status); }
  const { results } = await env.DB.prepare(`SELECT * FROM todogreen_enterprise_workflows WHERE ${clauses.join(" AND ")} ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, due_at IS NULL, due_at, updated_at DESC LIMIT 300`).bind(...params).all();
  return json({ workflows: (results || []).map(mapRow) });
};

const create = async (env, access, user, body) => {
  const domain = text(body.domain, 30).toLowerCase();
  if (!DOMAINS.has(domain)) return json({ error: "Informe Jurídico, Qualidade, Marketing ou Geral." }, 400);
  if (!canWrite(access, domain)) return json({ error: "Seu acesso não permite criar trabalho nesta área." }, 403);
  const title = text(body.title, 240);
  if (title.length < 3) return json({ error: "Informe um título para o processo." }, 400);
  const data = obj(body.data);
  const recurrence = obj(body.recurrence);
  const approval = normalizeApproval(domain, { ...data, kind: body.kind }, {});
  // Etapas obrigatórias não são uma preferência enviada pelo navegador.
  const status = approval.plan.length ? "pending" : "in_progress";
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO todogreen_enterprise_workflows
    (id,tenant_id,workspace_owner_id,domain,kind,title,description,client_id,owner_user_id,priority,status,due_at,data_json,approval_json,recurrence_json,source_template_id,revision,created_by,updated_by,created_at,updated_at,archived_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,NULL)`)
    .bind(id,TENANT_ID,access.ownerId,domain,text(body.kind,60),title,text(body.description,4000),text(body.clientId,120)||null,text(body.ownerUserId,120)||user.id,PRIORITIES.has(body.priority)?body.priority:"normal",status,text(body.dueAt,40)||null,JSON.stringify(data),JSON.stringify({ plan: approval.plan, approvals: [] }),JSON.stringify(recurrence),text(body.sourceTemplateId,120)||null,user.id,user.id,now,now).run();
  const row = await env.DB.prepare("SELECT * FROM todogreen_enterprise_workflows WHERE id=? AND workspace_owner_id=?").bind(id,access.ownerId).first();
  await event(env, access, user, id, "created", body.note || "", {}, mapRow(row));
  return json({ workflow: mapRow(row) }, 201);
};

const load = (env, access, id) => env.DB.prepare("SELECT * FROM todogreen_enterprise_workflows WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL").bind(id,TENANT_ID,access.ownerId).first();

const update = async (env, access, user, id, body) => {
  const row = await load(env, access, id); if (!row) return json({ error: "Processo não encontrado." }, 404);
  if (!canWrite(access, row.domain)) return json({ error: "Seu acesso não permite alterar este processo." }, 403);
  if (Number(body.revision) !== Number(row.revision)) return json({ error: "O processo foi alterado por outra pessoa. Atualize a tela." }, 409);
  const before = mapRow(row);
  const data = { ...obj(row.data_json), ...obj(body.data) };
  const currentApproval = obj(row.approval_json);
  const mudouConteudo = Object.keys(obj(body.data)).length > 0 ||
    ["kind", "title", "description", "clientId"].some((campo) => Object.hasOwn(body, campo));
  const recalculated = normalizeApproval(row.domain, { ...data, kind: body.kind ?? row.kind },
    mudouConteudo ? {} : currentApproval);
  let status = row.status;
  if (recalculated.plan.length && mudouConteudo) status = "pending";
  const solicitado = text(body.status, 30);
  if (solicitado && solicitado !== status) {
    const transicoes = recalculated.plan.length
      ? { pending: ["cancelled"], approved: ["in_progress", "cancelled"], in_progress: ["blocked", "done", "cancelled"], blocked: ["in_progress", "cancelled"] }
      : { draft: ["in_progress", "cancelled"], in_progress: ["blocked", "done", "cancelled"], blocked: ["in_progress", "cancelled"] };
    if (!transicoes[status]?.includes(solicitado))
      return json({ error: "Conclua as aprovações e siga as etapas do processo antes de mudar a situação." }, 409);
    status = solicitado;
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE todogreen_enterprise_workflows SET kind=?,title=?,description=?,client_id=?,owner_user_id=?,priority=?,status=?,due_at=?,data_json=?,approval_json=?,recurrence_json=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`)
    .bind(text(body.kind ?? row.kind,60),text(body.title ?? row.title,240),text(body.description ?? row.description,4000),text(body.clientId ?? row.client_id,120)||null,text(body.ownerUserId ?? row.owner_user_id,120)||null,PRIORITIES.has(body.priority)?body.priority:row.priority,status,text(body.dueAt ?? row.due_at,40)||null,JSON.stringify(data),JSON.stringify({ plan: recalculated.plan, approvals: recalculated.approvals }),JSON.stringify(body.recurrence ? obj(body.recurrence) : obj(row.recurrence_json)),user.id,now,id,TENANT_ID,access.ownerId,row.revision).run();
  const afterRow = await load(env, access, id); const after = mapRow(afterRow);
  await event(env, access, user, id, "updated", body.note || "", before, after);
  return json({ workflow: after });
};

const decide = async (env, access, user, id, body) => {
  const row = await load(env, access, id); if (!row) return json({ error: "Processo não encontrado." }, 404);
  if (!canRead(access, row.domain)) return json({ error: "Sem acesso ao processo." }, 403);
  if (!["pending","approved"].includes(row.status)) return json({ error: "Este processo não está aguardando aprovação." }, 409);
  const before = mapRow(row); const current = before.approval; const next = current.next;
  if (!next) return json({ error: "Não há etapa de aprovação pendente." }, 409);
  const allowed = ["owner","admin"].includes(access.role) || podeNaVertical(access, "*") || podeNaVertical(access, next.permission);
  if (!allowed) return json({ error: `A próxima decisão é de ${next.label}.` }, 403);
  if (before.createdBy === user.id && current.plan.length > 1 && current.approvals.length === 0)
    return json({ error: "Quem abriu o processo não pode fazer a primeira aprovação do próprio pedido." }, 403);
  const decision = body.decision === "reject" ? "rejected" : body.decision === "ressalva" ? "ressalva" : "approved";
  // A ressalva sem o texto do que ressalvar não serve a ninguém: a área
  // precisa saber o que ajustar. Exigimos a nota nesse caso.
  if (decision === "ressalva" && !text(body.note, 2000))
    return json({ error: "Descreva a ressalva: o que precisa ser observado ou ajustado." }, 400);
  const approvals = [...current.approvals, { stepId: next.id, label: next.label, permission: next.permission, decision, actorUserId: user.id, decidedAt: new Date().toISOString(), note: text(body.note,2000) }];
  const state = normalizeApproval(row.domain, { ...before.data, kind: row.kind }, { approvals });
  const status = decision === "rejected" ? "rejected" : state.complete ? "approved" : "pending";
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE todogreen_enterprise_workflows SET approval_json=?,status=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=? AND workspace_owner_id=?")
    .bind(JSON.stringify({ plan: state.plan, approvals }),status,user.id,now,id,TENANT_ID,access.ownerId).run();
  const after = mapRow(await load(env,access,id)); await event(env,access,user,id,"decision",body.note||"",before,after);
  return json({ workflow: after });
};

const history = async (env, access, id) => {
  const row = await load(env, access, id); if (!row) return json({ error: "Processo não encontrado." }, 404);
  if (!canRead(access, row.domain)) return json({ error: "Sem acesso ao processo." }, 403);
  const { results } = await env.DB.prepare("SELECT * FROM todogreen_enterprise_workflow_events WHERE workflow_id=? AND workspace_owner_id=? ORDER BY created_at DESC LIMIT 200").bind(id,access.ownerId).all();
  return json({ events: results || [] });
};

const addDays = (iso, days) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate()+days); return d.toISOString(); };
const nextOccurrence = (recurrence, from) => {
  const every = Math.max(1, Math.trunc(number(recurrence.interval) || 1));
  if (recurrence.frequency === "daily") return addDays(from,every);
  if (recurrence.frequency === "weekly") return addDays(from,7*every);
  if (recurrence.frequency === "monthly") { const d=new Date(from); d.setUTCMonth(d.getUTCMonth()+every); return d.toISOString(); }
  return "";
};

export async function runTodoGreenEnterpriseWorkflowScheduled(env, now = new Date()) {
  if (!env?.DB) return { created: 0 };
  const { results } = await env.DB.prepare("SELECT * FROM todogreen_enterprise_workflows WHERE archived_at IS NULL AND recurrence_json<>'{}' AND recurrence_json<>'' LIMIT 200").all().catch(()=>({results:[]}));
  let created = 0;
  for (const row of results || []) {
    const recurrence = obj(row.recurrence_json); if (!recurrence.enabled || !recurrence.nextRunAt) continue;
    if (new Date(recurrence.nextRunAt).getTime() > now.getTime()) continue;
    const next = nextOccurrence(recurrence, recurrence.nextRunAt); if (!next) continue;
    const id=crypto.randomUUID(); const stamp=now.toISOString();
    const approval = normalizeApproval(row.domain,{...obj(row.data_json),kind:row.kind},{});
    await env.DB.prepare(`INSERT INTO todogreen_enterprise_workflows (id,tenant_id,workspace_owner_id,domain,kind,title,description,client_id,owner_user_id,priority,status,due_at,data_json,approval_json,recurrence_json,source_template_id,revision,created_by,updated_by,created_at,updated_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,1,?,?,?,?,NULL)`)
      .bind(id,row.tenant_id,row.workspace_owner_id,row.domain,row.kind,row.title,row.description,row.client_id,row.owner_user_id,row.priority,approval.plan.length?"pending":"in_progress",row.due_at,row.data_json,JSON.stringify({plan:approval.plan,approvals:[]}),"{}",row.id,row.created_by,row.updated_by,stamp,stamp).run();
    recurrence.nextRunAt=next;
    await env.DB.prepare("UPDATE todogreen_enterprise_workflows SET recurrence_json=?,revision=revision+1,updated_at=? WHERE id=?").bind(JSON.stringify(recurrence),stamp,row.id).run();
    created += 1;
  }
  return { created };
}

export async function handleTodoGreenEnterpriseWorkflows(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  const url = new URL(request.url); const parts = url.pathname.split("/").filter(Boolean); // api,todogreen,enterprise-workflows,id,action
  const id = text(parts[3],120); const action=text(parts[4],40);
  if (request.method === "GET" && !id) return list(env,access,url);
  if (request.method === "POST" && !id) return create(env,access,user,await request.json().catch(()=>({})));
  if (request.method === "PATCH" && id && !action) return update(env,access,user,id,await request.json().catch(()=>({})));
  if (request.method === "POST" && id && action === "decision") return decide(env,access,user,id,await request.json().catch(()=>({})));
  if (request.method === "GET" && id && action === "history") return history(env,access,id);
  return json({ error: "Rota ou método não suportado." }, 405);
}
