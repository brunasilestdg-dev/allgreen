import {
  LOGISTICS_PRODUCTS,
  TODO_GREEN_MODULE_CATALOG,
  TODO_GREEN_PERMISSIONS,
  TODO_GREEN_ROLES,
  TODO_GREEN_TENANT,
  centralPricingEngine,
  createPricingScenarioSnapshot,
  summarizeTodoGreenDashboard,
} from "../../src/features/logistics/logisticsVerticalDomain.js";
import { parametrosResolvidos } from "./todogreen-pricing-parameters.js";

import { resolveTodoGreenAccess } from "./todogreen-access.js";
import { handleTodoGreenGoals } from "./todogreen-goals.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";

const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const parse = (value, fallback = null) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const email = (value) => String(value || "").trim().toLowerCase();

// A porta de entrada é uma só, e fica em todogreen-access.js. Este arquivo
// mantinha a sua própria — e era por ela que os dois furos já fechados
// continuavam abertos justamente onde mais pesa: é ele que responde
// `/api/todogreen/access`, a pergunta que a tela faz para saber se abre.
//
// O que saiu daqui:
//   • `envAllows`, que transformava qualquer conta terminada em
//     @todogreen.com.br em administradora da vertical inteira;
//   • `workspaceIsTodoGreen`, que dava admin a quem tivesse um negócio
//     chamado "To Do Green" no próprio espaço — nome de negócio é texto que a
//     própria pessoa digita, não prova de vínculo.
//
// Os administradores declarados em TODOGREEN_ADMIN_EMAILS continuam valendo:
// são vínculo explícito, configurado fora do alcance de quem se cadastra.
async function resolveCoreAccess(env, user, ownerId) {
  const { access } = await resolveTodoGreenAccess(env, user, ownerId);
  if (!access) return null;
  return { ...access, source: access.viaAdministradorGlobal ? "env" : "vinculo" };
}

const canManage = (access) => ["owner", "admin"].includes(access?.role) || access?.permissions?.includes("*");

async function seedCatalog(env) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, segment=excluded.segment,
       status=excluded.status, theme_json=excluded.theme_json, updated_at=excluded.updated_at`,
  ).bind(TODO_GREEN_TENANT.id, TODO_GREEN_TENANT.slug, TODO_GREEN_TENANT.name,
    TODO_GREEN_TENANT.segment, JSON.stringify(TODO_GREEN_TENANT.theme || {}), now, now).run();
  const statements = [];
  for (const item of TODO_GREEN_MODULE_CATALOG) {
    statements.push(env.DB.prepare(
      `INSERT INTO module_catalog
       (id,name,description,icon,category,route,status,version,dependencies_json,
        permissions_json,settings_json,availability,exclusive_tenant_id,display_order,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
        icon=excluded.icon,category=excluded.category,route=excluded.route,status=excluded.status,
        version=excluded.version,permissions_json=excluded.permissions_json,
        settings_json=excluded.settings_json,display_order=excluded.display_order,updated_at=excluded.updated_at`,
    ).bind(item.id,item.name,item.description,item.icon,item.category,item.route,item.status,item.version,
      JSON.stringify(item.dependencies || []),JSON.stringify(item.permissions || []),JSON.stringify(item.settings || {}),
      item.availability,item.exclusiveTenant || TODO_GREEN_TENANT.id,item.order,now));
    statements.push(env.DB.prepare(
      `INSERT INTO tenant_modules (tenant_id,module_id,status,settings_json,enabled_at)
       VALUES (?,?,'active','{}',?) ON CONFLICT(tenant_id,module_id) DO UPDATE SET status='active'`,
    ).bind(TODO_GREEN_TENANT.id,item.id,now));
  }
  for (const item of LOGISTICS_PRODUCTS) statements.push(env.DB.prepare(
    `INSERT INTO logistics_products
     (id,tenant_id,code,name,modality,billing_unit,description,required_fields_json,
      optional_fields_json,pricing_rules_json,approval_rules_json,indicators_json,status,version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name,modality=excluded.modality,
      billing_unit=excluded.billing_unit,description=excluded.description,
      required_fields_json=excluded.required_fields_json,optional_fields_json=excluded.optional_fields_json,
      pricing_rules_json=excluded.pricing_rules_json,approval_rules_json=excluded.approval_rules_json,
      indicators_json=excluded.indicators_json,status=excluded.status,version=excluded.version,updated_at=excluded.updated_at`,
  ).bind(item.id,TODO_GREEN_TENANT.id,item.code,item.name,item.modality,item.billingUnit,item.description,
    JSON.stringify(item.requiredFields || []),JSON.stringify(item.optionalFields || []),JSON.stringify(item.pricingRules || {}),
    JSON.stringify(item.approvalRules || {}),JSON.stringify({operational:item.operationalIndicators || [],environmental:item.environmentalIndicators || []}),
    item.status,item.version,now,now));
  if (statements.length) await env.DB.batch(statements);
}

export async function handleTodoGreenCore(request, env, user, url, dependencies) {
  // Ausência de `owner` significa usar o workspace definido pelo vínculo.
  // Transformar a ausência em `user.id` fazia cada colaborador abrir um espaço
  // próprio vazio, mesmo quando `tenant_users` o ligava ao espaço da empresa.
  const requestedOwnerId = url.searchParams.get("owner");
  const access = await resolveCoreAccess(env, user, requestedOwnerId);
  if (!access) return response({ error: "Você não tem acesso à To Do Green." }, 403);
  const resource = url.pathname.split("/").filter(Boolean)[2] || "access";

  if (resource === "goals") return handleTodoGreenGoals(request, env, user, access, url);

  if (request.method === "GET" && resource === "access")
    return response({ tenant: TODO_GREEN_TENANT, role: access.role, permissions: access.permissions,
      ownerId: access.ownerId, source: access.source });

  if (resource === "access-list") {
    if (!canManage(access)) return response({ error: "Você não pode gerenciar acessos da To Do Green." }, 403);
    await seedCatalog(env);
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT email,role,status,note,expires_at AS expiresAt,revoked_at AS revokedAt,
                last_access_at AS lastAccessAt,created_at AS createdAt,updated_at AS updatedAt
         FROM todogreen_access_emails WHERE tenant_id=? ORDER BY status='active' DESC,email`,
      ).bind(TODO_GREEN_TENANT.id).all();
      return response({ emails: rows.results || [] });
    }
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const normalized = email(body.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return response({ error: "Informe um e-mail válido." }, 400);
      // Papel inválido cai no mais restrito, nunca em admin: um corpo mal
      // formado não pode virar acesso total por omissão.
      const role = TODO_GREEN_ROLES.includes(body.role) ? body.role : "auditor";
      // A permissão nasce do papel escolhido — não de uma lista que o
      // formulário de autorização nunca envia. Antes, todo papel selecionado
      // (vendedor, pricing, financeiro, operações, liderança...) recebia
      // ["read"] fixo, porque só owner/admin tinham caso especial aqui; a
      // tela mostrava os botões de escrita como se funcionassem (ela deriva
      // do papel via hasTodoGreenPermission) e o servidor recusava tudo com
      // 403 — a pessoa parecia ter acesso e não conseguia salvar nada.
      const permissions = Array.isArray(body.permissions)
        ? body.permissions.map((item) => String(item).slice(0,80)).slice(0,30)
        : TODO_GREEN_PERMISSIONS[role] || ["read"];
      const now = new Date().toISOString();
      const expiresAt = String(body.expiresAt || "").trim().slice(0, 40) || null;
      if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()))
        return response({ error: "A validade do acesso precisa estar no futuro." }, 400);
      await env.DB.prepare(
        `INSERT INTO todogreen_access_emails
         (id,tenant_id,email,role,status,permissions_json,note,expires_at,revoked_at,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?) ON CONFLICT(tenant_id,email) DO UPDATE SET
          role=excluded.role,status=excluded.status,permissions_json=excluded.permissions_json,
          note=excluded.note,expires_at=excluded.expires_at,revoked_at=NULL,updated_at=excluded.updated_at`,
      ).bind(crypto.randomUUID(),TODO_GREEN_TENANT.id,normalized,role,body.status === "inactive" ? "inactive" : "active",
        JSON.stringify(permissions),String(body.note || "").trim().slice(0,240),expiresAt,user.id,now,now).run();
      await dependencies.audit(env,access.ownerId,user,"todogreen_acesso_autorizado",normalized,`papel: ${role}`);
      await registrarAuditoriaTodoGreen(env, {
        access, user, action: "authorized", resourceType: "access", resourceId: normalized,
        after: { email: normalized, role, status: body.status === "inactive" ? "inactive" : "active", expiresAt },
      });
      return response({ ok:true,email:normalized,role,status:body.status === "inactive" ? "inactive" : "active",permissions,expiresAt },201);
    }
    if (request.method === "DELETE") {
      const normalized = email(url.searchParams.get("email"));
      if (!normalized) return response({ error:"Informe o e-mail."},400);
      const atual = await env.DB.prepare(
        `SELECT email,role,status,note,expires_at AS expiresAt,last_access_at AS lastAccessAt
           FROM todogreen_access_emails WHERE tenant_id=? AND email=?`,
      ).bind(TODO_GREEN_TENANT.id,normalized).first();
      const now = new Date().toISOString();
      await env.DB.prepare(
        "UPDATE todogreen_access_emails SET status='inactive',revoked_at=?,updated_at=? WHERE tenant_id=? AND email=?",
      ).bind(now,now,TODO_GREEN_TENANT.id,normalized).run();
      await dependencies.audit(env,access.ownerId,user,"todogreen_acesso_removido",normalized,"");
      await registrarAuditoriaTodoGreen(env, {
        access, user, action: "revoked", resourceType: "access", resourceId: normalized,
        before: atual || {}, after: { ...(atual || {}), status: "inactive", revokedAt: now },
      });
      return response({ok:true});
    }
    return response({error:"Método não permitido."},405);
  }

  if (["catalog","dashboard","products"].includes(resource)) await seedCatalog(env);
  if (request.method === "GET" && resource === "catalog")
    return response({tenant:TODO_GREEN_TENANT,modules:TODO_GREEN_MODULE_CATALOG,products:LOGISTICS_PRODUCTS,access});
  if (request.method === "GET" && resource === "products") return response({products:LOGISTICS_PRODUCTS});
  if (request.method === "GET" && resource === "dashboard") {
    const rows = await env.DB.prepare(
      `SELECT id,product_id,client_id,result_json,status,created_at FROM pricing_scenarios
       WHERE tenant_id=? AND workspace_owner_id=? ORDER BY created_at DESC LIMIT 200`,
    ).bind(TODO_GREEN_TENANT.id,access.ownerId).all().catch(() => ({results:[]}));
    const pricingScenarios = (rows.results || []).map((row) => ({id:row.id,productId:row.product_id,
      clientId:row.client_id,status:row.status,result:parse(row.result_json,{}),createdAt:row.created_at}));
    return response({summary:summarizeTodoGreenDashboard({pricingScenarios})});
  }
  if (request.method === "POST" && resource === "simulate") {
    const body = await request.json().catch(() => ({}));
    const productId = String(body.productId || "");
    const inputs = body.inputs || {};
    let scenario;
    try {
      const product = LOGISTICS_PRODUCTS.find((item) => item.id === productId);
      const resolved = await parametrosResolvidos(env, access.ownerId, {
        productId, modality: inputs.modality || product?.modality, vehicleType: inputs.vehicleType,
        region: inputs.region || inputs.city, clientId: body.clientId || inputs.clientId,
        contractId: inputs.contractId,
      });
      scenario = createPricingScenarioSnapshot(productId,inputs,{
      tenantId:TODO_GREEN_TENANT.id,userId:user.id,clientId:body.clientId || "",
      opportunityId:body.opportunityId || "",justification:body.justification || ""},
      { assumptions: resolved.parametros, parameterVersion: resolved.aplicados.map((item) => item.versao).join(" + ") || "padrao-de-fabrica" });
    }
    catch (error) { return response({error:error.message || "Simulação inválida."},400); }
    if (body.persist === true) {
      await env.DB.prepare(
        `INSERT INTO pricing_scenarios
        (id,tenant_id,workspace_owner_id,product_id,client_id,opportunity_id,created_by,
         rule_version,inputs_json,result_json,approvals_json,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?)`,
      ).bind(scenario.id,TODO_GREEN_TENANT.id,access.ownerId,String(body.productId || ""),scenario.clientId,
        scenario.opportunityId,user.id,scenario.ruleVersion,JSON.stringify(scenario.inputs),JSON.stringify(scenario.result),
        JSON.stringify(scenario.approvals),scenario.createdAt).run();
      await dependencies.audit(env,access.ownerId,user,"todogreen_simulacao_criada",scenario.id,scenario.result.productName);
    }
    return response({scenario});
  }
  if (request.method === "POST" && resource === "audit") {
    const body = await request.json().catch(() => ({}));
    await dependencies.audit(env,access.ownerId,user,String(body.action || "todogreen_event").slice(0,80),
      String(body.target || "").slice(0,160),String(body.details || "").slice(0,600));
    return response({ok:true});
  }
  if (request.method === "POST" && resource === "calculate") {
    const body = await request.json().catch(() => ({}));
    try {
      const productId = String(body.productId || "");
      const inputs = body.inputs || {};
      const product = LOGISTICS_PRODUCTS.find((item) => item.id === productId);
      const resolved = await parametrosResolvidos(env, access.ownerId, {
        productId, modality: inputs.modality || product?.modality, vehicleType: inputs.vehicleType,
        region: inputs.region || inputs.city, clientId: inputs.clientId, contractId: inputs.contractId,
      });
      return response({result:centralPricingEngine(productId, inputs, {
        assumptions: resolved.parametros,
        parameterVersion: resolved.aplicados.map((item) => item.versao).join(" + ") || "padrao-de-fabrica",
      })});
    }
    catch (error) { return response({error:error.message || "Cálculo inválido."},400); }
  }
  return response({error:"Recurso To Do Green não encontrado."},404);
}
