import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { handleTodoGreenPurchasing } from "./todogreen-purchasing.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
const parse = (value, fallback = {}) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || ""); } catch { return fallback; }
};
const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

// A matriz fica no servidor. Quem pede a compra não escolhe o próprio teto.
// Cada clique aprova UMA etapa, deixando explícito quem ainda precisa decidir.
//
// Esta é a régua "de fábrica". A partir da 0111 cada espaço pode versioná-la
// (todogreen_purchase_approval_params) — `bandasDoEspaco` carrega a do espaço e
// cai nesta quando não há uma. `max: null` no topo = faixa sem teto (é o
// catch-all); usar `null` em vez de Infinity mantém a régua serializável em JSON.
export const PURCHASE_APPROVAL_BANDS = Object.freeze([
  { max: 5000, steps: [{ id: "gestor", label: "Gestor / Suprimentos", permission: "purchase:manage" }] },
  { max: 25000, steps: [
    { id: "gestor", label: "Gestor / Suprimentos", permission: "purchase:manage" },
    { id: "financeiro", label: "Financeiro", permission: "finance:manage" },
  ] },
  { max: 100000, steps: [
    { id: "gestor", label: "Gestor / Suprimentos", permission: "purchase:manage" },
    { id: "financeiro", label: "Financeiro", permission: "finance:manage" },
    { id: "head", label: "Head / Liderança", permission: "deal:approve" },
  ] },
  { max: null, steps: [
    { id: "gestor", label: "Gestor / Suprimentos", permission: "purchase:manage" },
    { id: "financeiro", label: "Financeiro", permission: "finance:manage" },
    { id: "head", label: "Head / Liderança", permission: "deal:approve" },
    { id: "diretoria", label: "Diretoria", ownerOnly: true },
  ] },
]);

// Papéis de aprovação permitidos numa faixa configurada. A régua é editável,
// mas só entre papéis conhecidos — um permission fora do catálogo viraria etapa
// que ninguém (ou todo mundo) satisfaz, furando a alçada por digitação.
export const PURCHASE_APPROVAL_STEP_PERMISSIONS = Object.freeze([
  "purchase:manage", "finance:manage", "deal:approve",
]);

const slugPasso = (value) => String(value ?? "").trim().toLowerCase().slice(0, 40);

// Valida e normaliza a régua vinda do banco. Devolve a matriz utilizável ou
// `null` quando algo está fora do contrato (o chamador então cai na régua de
// fábrica, e o endpoint recusa a gravação). Ordena por teto e força a última
// faixa a ser o catch-all (max=null), para nunca sobrar valor sem faixa.
export const normalizarBandas = (config) => {
  const bruto = Array.isArray(config?.bands) ? config.bands : Array.isArray(config) ? config : null;
  if (!bruto || !bruto.length || bruto.length > 10) return null;
  const bandas = [];
  for (const item of bruto) {
    const maxBruto = item?.max;
    const max = maxBruto === null || maxBruto === undefined
      ? null
      : (Number.isFinite(Number(maxBruto)) && Number(maxBruto) > 0 ? Number(maxBruto) : NaN);
    if (Number.isNaN(max)) return null;
    const passos = Array.isArray(item?.steps) ? item.steps : null;
    if (!passos || !passos.length || passos.length > 8) return null;
    const steps = [];
    for (const passo of passos) {
      const id = slugPasso(passo?.id);
      const label = String(passo?.label ?? "").trim().slice(0, 80);
      if (!id || !label) return null;
      const ownerOnly = passo?.ownerOnly === true;
      const permission = String(passo?.permission ?? "").trim();
      if (!ownerOnly && !PURCHASE_APPROVAL_STEP_PERMISSIONS.includes(permission)) return null;
      steps.push(ownerOnly ? { id, label, ownerOnly: true } : { id, label, permission });
    }
    bandas.push({ max, steps });
  }
  bandas.sort((a, b) => (a.max ?? Infinity) - (b.max ?? Infinity));
  bandas[bandas.length - 1] = { ...bandas[bandas.length - 1], max: null };
  return bandas;
};

export const purchaseApprovalPlan = (total, bands = PURCHASE_APPROVAL_BANDS) => {
  const value = Math.max(0, num(total));
  const usadas = Array.isArray(bands) && bands.length ? bands : PURCHASE_APPROVAL_BANDS;
  const band = usadas.find((item) => value <= (item.max ?? Infinity)) || usadas.at(-1);
  return { total: value, steps: band.steps.map((step) => ({ ...step })) };
};

// A régua do espaço, carregada do banco e normalizada; cai na de fábrica quando
// não há linha ou a config gravada não passa na validação.
export const bandasDoEspaco = async (env, ownerId) => {
  if (!env?.DB) return PURCHASE_APPROVAL_BANDS;
  const linha = await env.DB.prepare(
    "SELECT config_json FROM todogreen_purchase_approval_params WHERE tenant_id=? AND workspace_owner_id=?",
  ).bind(TENANT_ID, ownerId).first().catch(() => null);
  if (!linha) return PURCHASE_APPROVAL_BANDS;
  return normalizarBandas(parse(linha.config_json, null)) || PURCHASE_APPROVAL_BANDS;
};

const canApproveStep = (access, step) => {
  if (["owner", "admin"].includes(access.role) || podeNaVertical(access, "*")) return true;
  if (step.ownerOnly) return false;
  return podeNaVertical(access, step.permission);
};

export const normalizedPurchaseApprovalFlow = (total, fields = {}, bands = PURCHASE_APPROVAL_BANDS) => {
  const plan = purchaseApprovalPlan(total, bands);
  const saved = parse(fields?.purchaseApprovalFlow, {});
  const approvals = Array.isArray(saved.approvals)
    ? saved.approvals.filter((item) => plan.steps.some((step) => step.id === item.stepId) && item.decision === "approved")
    : [];
  const done = new Set(approvals.map((item) => item.stepId));
  const next = plan.steps.find((step) => !done.has(step.id)) || null;
  return { total: plan.total, steps: plan.steps, approvals, next, complete: !next };
};

const estimatedRequestTotal = (row) => {
  const items = parse(row.items_json, []);
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + Math.abs(num(item.quantity ?? item.quantidade)) * Math.max(0, num(item.estimatedUnitPrice ?? item.precoUnitario ?? item.unitPrice)), 0);
};

const orderTotal = async (env, access, row) => {
  const { results } = await env.DB.prepare("SELECT quantity,unit_price FROM todogreen_purchase_order_items WHERE order_id=? AND tenant_id=? AND workspace_owner_id=? ORDER BY line_number")
    .bind(row.id, TENANT_ID, access.ownerId).all();
  const subtotal = (results || []).reduce((sum, item) => sum + Math.abs(num(item.quantity)) * Math.max(0, num(item.unit_price)), 0);
  return Math.max(0, subtotal + num(row.freight) + num(row.taxes) - num(row.discount));
};

const approve = async (request, env, access, user, resource, id, body) => {
  const table = resource === "requisicoes" ? "todogreen_purchase_requests" : "todogreen_purchase_orders";
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`)
    .bind(id, TENANT_ID, access.ownerId).first();
  if (!row) return json({ error: resource === "requisicoes" ? "Requisição não encontrada." : "Pedido não encontrado." }, 404);
  if (Number(body.revision) !== Number(row.revision)) return json({ error: "O registro foi alterado por outra pessoa. Recarregue a tela." }, 409);

  const total = resource === "requisicoes" ? estimatedRequestTotal(row) : await orderTotal(env, access, row);
  // Item sem preço estimado ainda precisa passar por gestor. Quando virar pedido,
  // o preço real recalcula a alçada e pode exigir níveis adicionais.
  // A régua é a versionada do espaço (ou a de fábrica), nunca escolhida por quem pede.
  const bands = await bandasDoEspaco(env, access.ownerId);
  const fields = parse(row.fields_json, {});
  const flow = normalizedPurchaseApprovalFlow(total, fields, bands);
  const next = flow.next;
  if (!next) {
    const forwarded = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify({
        ...body,
        campos: { ...fields, purchaseApprovalFlow: { total, steps: flow.steps, approvals: flow.approvals, complete: true } },
      }),
    });
    return handleTodoGreenPurchasing(forwarded, env, access, user);
  }
  if (!canApproveStep(access, next)) return json({ error: `A próxima aprovação é de ${next.label}.`, approval: flow }, 403);

  // Segregação vale para equipe em espaço alheio: quem abriu não faz a própria
  // primeira aprovação. A dona operando o PRÓPRIO espaço fica de fora da trava —
  // numa operação de uma pessoa não existe segundo aprovador, e bloquear a dona
  // deixaria toda compra presa para sempre.
  const donaDoProprioEspaco = user.id === access.ownerId || access.viaAdministradorGlobal === true;
  const creator = row.requester_user_id || row.created_by || "";
  if (!donaDoProprioEspaco && flow.approvals.length === 0 && creator && creator === user.id)
    return json({ error: "Quem abriu a compra não pode fazer a primeira aprovação do próprio pedido.", approval: flow }, 403);

  const now = new Date().toISOString();
  const approvals = [...flow.approvals, {
    stepId: next.id,
    label: next.label,
    decision: "approved",
    actorUserId: user.id,
    decidedAt: now,
  }];
  const nextFlow = normalizedPurchaseApprovalFlow(total, { purchaseApprovalFlow: { approvals } }, bands);
  const newFields = {
    ...fields,
    purchaseApprovalFlow: {
      total,
      steps: nextFlow.steps,
      approvals,
      next: nextFlow.next,
      complete: nextFlow.complete,
    },
  };

  if (nextFlow.complete) {
    const forwarded = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify({
        ...body,
        campos: newFields,
        notaDecisao: body.notaDecisao || `Alçada concluída em ${now}`,
      }),
    });
    return handleTodoGreenPurchasing(forwarded, env, access, user);
  }

  const result = await env.DB.prepare(`UPDATE ${table} SET fields_json=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`)
    .bind(JSON.stringify(newFields), user.id, now, id, TENANT_ID, access.ownerId, row.revision).run();
  if (!result?.meta?.changes) return json({ error: "A compra mudou durante a aprovação. Recarregue." }, 409);
  return json({
    ok: true,
    approvalPending: true,
    approval: nextFlow,
    message: `Etapa ${next.label} aprovada. Próxima: ${nextFlow.next?.label || "concluída"}.`,
  }, 202);
};

export async function handleTodoGreenPurchasingEnterprise(request, env, access, user) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const resource = parts[3] || "";
  const id = parts[4] || "";
  if (request.method === "PATCH" && id && ["requisicoes", "pedidos"].includes(resource)) {
    const clone = request.clone();
    const body = await clone.json().catch(() => ({}));
    const wantsApproval = (resource === "requisicoes" && body.status === "aprovada") || (resource === "pedidos" && body.status === "aprovado");
    if (wantsApproval) return approve(request, env, access, user, resource, id, body);
  }
  return handleTodoGreenPurchasing(request, env, access, user);
}
