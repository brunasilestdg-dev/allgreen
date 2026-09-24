import {
  LOGISTICS_PRODUCTS,
  TODO_GREEN_MODULE_CATALOG,
  TODO_GREEN_PERMISSION_KEYS,
  TODO_GREEN_PERMISSIONS,
  TODO_GREEN_ROLES,
  TODO_GREEN_TENANT,
  centralPricingEngine,
  createPricingScenarioSnapshot,
  summarizeTodoGreenDashboard,
} from "../../src/features/logistics/logisticsVerticalDomain.js";
import { parametrosResolvidos } from "./todogreen-pricing-parameters.js";
import { reguaEsgEmVigor } from "./todogreen-environmental-parameters.js";
import { podeNaVertical, resolveTodoGreenAccess } from "./todogreen-access.js";
import { handleTodoGreenGoals } from "./todogreen-goals.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import { routeTodoGreenApi } from "./todogreen-router.js";
import { handleTodoGreenMasterData } from "./todogreen-master-data.js";
import { handleTodoGreenTransactions } from "./todogreen-transactions.js";
import { emailEnabled } from "../mensageria/envio.js";
import { enviarConviteDeAcessoTodoGreen, handleTodoGreenAccessInvite } from "./todogreen-access-invites.js";

const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

const parse = (value, fallback = null) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const email = (value) => String(value || "").trim().toLowerCase();

async function resolveCoreAccess(env, user, ownerId) {
  const { access, motivo } = await resolveTodoGreenAccess(env, user, ownerId);
  if (!access) return { access: null, motivo };
  return { access: { ...access, source: access.viaAdministradorGlobal ? "env" : "vinculo" }, motivo: null };
}

// Gestores (liderança) aprovam pedidos de acesso ao lado de owner/admin
// (pedido da titular: "adms ou gestores podem aprová-los"). Pelo papel, para
// não depender do snapshot de permissões gravado em vínculos antigos; a
// permissão `access:manage` na liderança mantém o front alinhado.
const canManage = (access) =>
  ["owner", "admin", "lideranca_comercial"].includes(access?.role)
  || access?.permissions?.includes("*")
  || podeNaVertical(access, "access:manage");
const canAny = (access, permissions = []) => canManage(access) || permissions.some((permission) => podeNaVertical(access, permission));

// ===== O painel Acessos administra o modelo de acesso INTEIRO =====
//
// `resolveTodoGreenAccess` aceita DUAS fontes de vínculo: `todogreen_access_emails`
// (liberação por e-mail, feita nesta tela) e `tenant_users` (associação ao espaço
// de trabalho). Até aqui a tela só escrevia na primeira, e isso produzia dois
// defeitos opostos, ambos silenciosos:
//
// 1) CONCEDER NÃO LIGAVA À EMPRESA. Sem linha em `tenant_users`, o espaço padrão
//    caía no `user.id` da própria pessoa — um espaço vazio. Um financeiro recém-
//    liberado recebia a lista inteira de permissões e abria um ERP sem nada
//    dentro. Só vendedor (por carteira) e motorista (por cadastro) escapavam,
//    cada um por um remendo diferente.
//
// 2) REVOGAR NÃO REVOGAVA. Quem já tinha `tenant_users` continuava entrando
//    depois do "acesso removido" — a tela dizia que deu certo, a auditoria
//    gravava `revoked`, e a pessoa seguia lendo a tesouraria da empresa.
//
// A regra agora: as duas fontes andam juntas. Conceder cria o vínculo apontando
// para o espaço de quem concedeu (é nele que a operação vive); revogar encerra
// os dois lados. Nenhuma tela do produto mostrava `tenant_users`, então não
// havia como perceber a divergência olhando o app.
const espacoDaConcessao = (access) => String(access?.ownerId || "").trim();

async function vincularAoEspaco(env, { access, userId, email: alvo, role, permissions }) {
  const espaco = espacoDaConcessao(access);
  if (!espaco || !userId) return false;
  const now = new Date().toISOString();
  // A conta pode não existir ainda: quem é liberado por e-mail cria a própria
  // conta depois (desde a 0029 não há senha no código). Nesse caso não há
  // `user_id` para vincular, e quem resolve é o `workspace_owner_id` gravado na
  // própria liberação (0071) — `resolveTodoGreenAccess` o usa como espaço
  // padrão no primeiro acesso.
  await env.DB.prepare(
    `INSERT INTO tenant_users
       (id, tenant_id, workspace_owner_id, user_id, role, status, permissions_json, invited_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, user_id) DO UPDATE SET
       role = excluded.role,
       status = 'active',
       permissions_json = excluded.permissions_json,
       updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), TODO_GREEN_TENANT.id, espaco, userId, role,
    JSON.stringify(permissions), access?.userId || null, now, now,
  ).run().catch((erro) => {
    console.error("todogreen vincularAoEspaco", alvo, erro);
    return null;
  });
  return true;
}

async function desvincularDoEspaco(env, access, userId) {
  if (!userId) return;
  await env.DB.prepare(
    "UPDATE tenant_users SET status='revoked', updated_at=? WHERE tenant_id=? AND workspace_owner_id=? AND user_id=?",
  ).bind(new Date().toISOString(), TODO_GREEN_TENANT.id, espacoDaConcessao(access), userId).run().catch((erro) => {
    console.error("todogreen desvincularDoEspaco", userId, erro);
  });
}

const contaPorEmail = (env, alvo) => env.DB
  .prepare("SELECT id FROM users WHERE lower(email) = ? LIMIT 1")
  .bind(email(alvo))
  .first()
  .catch(() => null);

const MASTER_PERMISSIONS = Object.freeze({
  "company-profiles": ["fiscal:manage", "finance:manage"],
  "company-documents": ["fiscal:manage", "finance:manage"],
  employees: ["hr:manage"],
  "employee-documents": ["hr:manage"],
  drivers: ["hr:manage", "operations:manage", "operation:manage", "fleet:manage"],
  "driver-documents": ["hr:manage", "operations:manage", "operation:manage", "fleet:manage"],
  "operational-units": ["operations:manage", "operation:manage", "planning:manage"],
  routes: ["operations:manage", "operation:manage", "planning:manage", "product:manage"],
  "price-tables": ["pricing:manage", "proposal:manage", "finance:manage"],
  "price-rows": ["pricing:manage", "proposal:manage", "finance:manage"],
  "bank-accounts": ["finance:manage", "hr:manage"],
  "implementation-projects": ["operations:manage", "operation:manage", "planning:manage", "product:manage"],
  "implementation-gates": ["operations:manage", "operation:manage", "planning:manage", "product:manage"],
});

async function seedCatalog(env) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, segment=excluded.segment,
       status=excluded.status, theme_json=excluded.theme_json, updated_at=excluded.updated_at`,
  ).bind(
    TODO_GREEN_TENANT.id,
    TODO_GREEN_TENANT.slug,
    TODO_GREEN_TENANT.name,
    TODO_GREEN_TENANT.segment,
    JSON.stringify(TODO_GREEN_TENANT.theme || {}),
    now,
    now,
  ).run();

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
    ).bind(
      item.id, item.name, item.description, item.icon, item.category, item.route,
      item.status, item.version, JSON.stringify(item.dependencies || []),
      JSON.stringify(item.permissions || []), JSON.stringify(item.settings || {}),
      item.availability, item.exclusiveTenant || TODO_GREEN_TENANT.id, item.order, now,
    ));
    statements.push(env.DB.prepare(
      `INSERT INTO tenant_modules (tenant_id,module_id,status,settings_json,enabled_at)
       VALUES (?,?,'active','{}',?)
       ON CONFLICT(tenant_id,module_id) DO UPDATE SET status='active'`,
    ).bind(TODO_GREEN_TENANT.id, item.id, now));
  }

  for (const item of LOGISTICS_PRODUCTS) {
    statements.push(env.DB.prepare(
      `INSERT INTO logistics_products
       (id,tenant_id,code,name,modality,billing_unit,description,required_fields_json,
        optional_fields_json,pricing_rules_json,approval_rules_json,indicators_json,status,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name,modality=excluded.modality,
        billing_unit=excluded.billing_unit,description=excluded.description,
        required_fields_json=excluded.required_fields_json,optional_fields_json=excluded.optional_fields_json,
        pricing_rules_json=excluded.pricing_rules_json,approval_rules_json=excluded.approval_rules_json,
        indicators_json=excluded.indicators_json,status=excluded.status,version=excluded.version,updated_at=excluded.updated_at`,
    ).bind(
      item.id, TODO_GREEN_TENANT.id, item.code, item.name, item.modality, item.billingUnit,
      item.description, JSON.stringify(item.requiredFields || []), JSON.stringify(item.optionalFields || []),
      JSON.stringify(item.pricingRules || {}), JSON.stringify(item.approvalRules || {}),
      JSON.stringify({ operational:item.operationalIndicators || [], environmental:item.environmentalIndicators || [] }),
      item.status, item.version, now, now,
    ));
  }
  if (statements.length) await env.DB.batch(statements);
}

const masterCompanyProfile = async (env, access) => {
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_company_profiles
      WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
      ORDER BY status='active' DESC, updated_at DESC LIMIT 1`,
  ).bind(TODO_GREEN_TENANT.id, access.ownerId).first().catch(() => null);
  if (!row) return null;
  const documents = await env.DB.prepare(
    `SELECT kind,number,issuer,issued_at AS issuedAt,expires_at AS expiresAt,status
       FROM todogreen_company_documents
      WHERE tenant_id=? AND workspace_owner_id=? AND profile_id=? AND archived_at IS NULL
      ORDER BY kind,expires_at`,
  ).bind(TODO_GREEN_TENANT.id, access.ownerId, row.id).all().catch(() => ({ results: [] }));
  return {
    id:row.id,
    legalName:row.legal_name,
    tradeName:row.trade_name,
    document:row.document,
    stateRegistration:row.state_registration,
    cityRegistration:row.city_registration,
    rntrc:row.rntrc,
    rntrcCategory:row.rntrc_category,
    rntrcStatus:row.rntrc_status,
    rntrcCheckedAt:row.rntrc_checked_at || "",
    address:parse(row.address_json, {}),
    status:row.status,
    documents:documents.results || [],
    revision:row.revision,
  };
};

async function handleTransactionsWithControls(request, env, access, user) {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/todogreen\/transactions\/?/, "").split("/").filter(Boolean);
  const [resource, id, action] = parts;

  if (resource === "service-orders" && id && action === "transition" && request.method === "POST") {
    const body = await request.clone().json().catch(() => ({}));
    if (String(body.status || "") === "completed") {
      const order = await env.DB.prepare(
        `SELECT s.id,s.contract_id,c.billing_rules_json
           FROM todogreen_service_orders s
           LEFT JOIN todogreen_contracts c
             ON c.id=s.contract_id AND c.tenant_id=s.tenant_id AND c.workspace_owner_id=s.workspace_owner_id
          WHERE s.id=? AND s.tenant_id=? AND s.workspace_owner_id=? AND s.archived_at IS NULL`,
      ).bind(id, TODO_GREEN_TENANT.id, access.ownerId).first();
      if (order) {
        const rules = parse(order.billing_rules_json, {}) || {};
        if (rules.podRequired !== false) {
          const pod = await env.DB.prepare(
            `SELECT id FROM todogreen_proofs_of_delivery
              WHERE tenant_id=? AND workspace_owner_id=? AND service_order_id=?
              ORDER BY occurred_at DESC LIMIT 1`,
          ).bind(TODO_GREEN_TENANT.id, access.ownerId, id).first();
          if (!pod) {
            return response({
              error:"A OS não pode ser concluída para faturamento sem POD. Registre a evidência de entrega antes de concluir.",
              code:"pod_required",
            },409);
          }
        }
      }
    }
  }

  const original = await handleTodoGreenTransactions(request, env, access, user);
  if (resource === "ciot-integration" && request.method === "GET" && original?.ok) {
    const payload = await original.clone().json().catch(() => null);
    if (payload && typeof payload === "object") {
      return response({ ...payload, regulatoryProfile:await masterCompanyProfile(env, access) }, original.status);
    }
  }
  return original;
}

export async function handleTodoGreenCore(request, env, user, url, dependencies = {}) {
  // O convite é a única porta pública da vertical. O token opaco no link
  // identifica o convite; nenhuma sessão de administrador é reutilizada.
  if (url.pathname === "/api/todogreen/access-invite")
    return handleTodoGreenAccessInvite(request, env, url);
  const requestedOwnerId = url.searchParams.get("owner");
  const { access, motivo } = await resolveCoreAccess(env, user, requestedOwnerId);
  // Espaço de outra conta → 404 (não confirmamos que existe); falta de vínculo → 403.
  if (!access && motivo === "espaco-nao-autorizado")
    return response({ error: "Este espaço de trabalho não pertence à sua conta." }, 404);
  if (!access) return response({ error:"Você não tem acesso à To Do Green." },403);

  const path = url.pathname;
  const resource = path.split("/").filter(Boolean)[2] || "access";

  if (path.startsWith("/api/todogreen/transactions"))
    return handleTransactionsWithControls(request, env, access, user);

  if (path.startsWith("/api/todogreen/master-data")) {
    // Defesa em profundidade: os cadastros mestres guardam PII (motoristas, CNH,
    // chave PIX). Além da permissão por recurso, o motorista é barrado por PAPEL
    // aqui, como nas demais rotas internas — ele usa o portal do motorista.
    if (access.role === "motorista")
      return response({ error: "Motoristas usam o portal do motorista (/portal-motorista)." }, 403);
    const masterResource = path.replace(/^\/api\/todogreen\/master-data\/?/, "").split("/").filter(Boolean)[0] || "";
    const required = MASTER_PERMISSIONS[masterResource] || [];
    if (required.length && !canAny(access, required))
      return response({ error:"Seu papel não pode acessar este cadastro." },403);
    return handleTodoGreenMasterData(request, env, access, user);
  }

  const routed = await routeTodoGreenApi(request, env);
  if (routed) return routed;

  if (resource === "goals") return handleTodoGreenGoals(request, env, user, access, url);

  if (request.method === "GET" && resource === "access") {
    return response({ tenant:TODO_GREEN_TENANT, role:access.role, permissions:access.permissions, ownerId:access.ownerId, source:access.source });
  }

  if (resource === "access-list") {
    if (!canManage(access)) return response({ error:"Você não pode gerenciar acessos da To Do Green." },403);
    await seedCatalog(env);
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT email,role,status,permissions_json,note,expires_at AS expiresAt,revoked_at AS revokedAt,
                last_access_at AS lastAccessAt,created_at AS createdAt,updated_at AS updatedAt
           FROM todogreen_access_emails
          WHERE tenant_id=? AND workspace_owner_id=?
          ORDER BY status='active' DESC,email`,
      ).bind(TODO_GREEN_TENANT.id, espacoDaConcessao(access)).all();
      return response({
        emails:(rows.results || []).map((item) => ({
          ...item,
          permissions:parse(item.permissions_json, []),
          permissions_json:undefined,
        })),
      });
    }
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const normalized = email(body.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return response({ error:"Informe um e-mail válido." },400);

      if (body.action === "resend") {
        const existing = await env.DB.prepare(
          `SELECT email,role,status,permissions_json FROM todogreen_access_emails
             WHERE tenant_id=? AND workspace_owner_id=? AND email=?`,
        ).bind(TODO_GREEN_TENANT.id, espacoDaConcessao(access), normalized).first();
        if (!existing || existing.status !== "active")
          return response({ error:"Só é possível reenviar convite para um acesso ativo." },404);
        if (!emailEnabled(env))
          return response({ error:"O envio de e-mail não está configurado. Configure o canal antes de convidar pessoas." },503);
        try {
          await enviarConviteDeAcessoTodoGreen({
            env, access, user, email: normalized, role: existing.role,
            permissions: parse(existing.permissions_json, []), origin: url.origin,
          });
          return response({ ok:true, email:normalized, invitationSent:true });
        } catch (error) {
          console.error("todogreen resend access invitation", error);
          return response({ error:"O acesso existe, mas o convite não pôde ser enviado agora." },502);
        }
      }

      const role = TODO_GREEN_ROLES.includes(body.role) ? body.role : "auditor";
      const permitidas = new Set(TODO_GREEN_PERMISSION_KEYS);
      const permissions = Array.isArray(body.permissions)
        ? [...new Set(body.permissions.map((item) => String(item).slice(0,80)).filter((item) => permitidas.has(item)))].slice(0,60)
        : TODO_GREEN_PERMISSIONS[role] || ["read"];
      const now = new Date().toISOString();
      const ativo = body.status !== "inactive";
      // A autorização não depende do provedor de e-mail. Se o envio falhar,
      // ela permanece válida e a interface recebe o motivo para reenvio depois.
      const expiresAt = String(body.expiresAt || "").trim().slice(0,40) || null;
      if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()))
        return response({ error:"A validade do acesso precisa estar no futuro." },400);
      await env.DB.prepare(
        `INSERT INTO todogreen_access_emails
         (id,tenant_id,email,role,status,permissions_json,note,expires_at,revoked_at,created_by,workspace_owner_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?,?) ON CONFLICT(tenant_id,workspace_owner_id,email) DO UPDATE SET
          role=excluded.role,status=excluded.status,permissions_json=excluded.permissions_json,
          note=excluded.note,expires_at=excluded.expires_at,revoked_at=NULL,
          workspace_owner_id=excluded.workspace_owner_id,updated_at=excluded.updated_at`,
      ).bind(
        crypto.randomUUID(), TODO_GREEN_TENANT.id, normalized, role,
        body.status === "inactive" ? "inactive" : "active", JSON.stringify(permissions),
        String(body.note || "").trim().slice(0,240), expiresAt, user.id,
        // O espaço de quem concede é o espaço onde a operação vive. Guardá-lo
        // aqui é o que faz o vínculo nascer certo no primeiro acesso de quem
        // ainda não tem conta.
        espacoDaConcessao(access), now, now,
      ).run();
      // O vínculo com o espaço da empresa é metade da concessão. Sem ele a
      // pessoa entra num espaço próprio vazio — ver o comentário do bloco.
      const conta = await contaPorEmail(env, normalized);
      if (ativo && conta?.id)
        await vincularAoEspaco(env, { access, userId: conta.id, email: normalized, role, permissions });
      if (!ativo && conta?.id) await desvincularDoEspaco(env, access, conta.id);

      if (dependencies.audit) await dependencies.audit(env,access.ownerId,user,"todogreen_acesso_autorizado",normalized,`papel: ${role}`);
      await registrarAuditoriaTodoGreen(env, {
        access,user,action:"authorized",resourceType:"access",resourceId:normalized,
        after:{ email:normalized, role, status:ativo ? "active" : "inactive", expiresAt, workspaceOwnerId: espacoDaConcessao(access) },
      });
      let invitationSent = false;
      let invitationError = "";
      if (ativo && body.notify !== false) {
        try {
          await enviarConviteDeAcessoTodoGreen({
            env, access, user, email: normalized, name: String(body.name || "").trim(),
            role, permissions, origin: url.origin,
          });
          invitationSent = true;
        } catch (error) {
          console.error("todogreen access invitation", error);
          invitationError = "O acesso foi salvo, mas o convite não pôde ser enviado agora.";
        }
      }
      return response({
        ok:true,email:normalized,role,status:ativo ? "active" : "inactive",permissions,expiresAt,
        invitationSent, invitationError,
        // A tela precisa saber se a pessoa já tem conta: sem conta, o vínculo
        // com o espaço só nasce no primeiro acesso dela.
        vinculadoAoEspaco: Boolean(ativo && conta?.id),
        aguardandoCadastro: Boolean(ativo && !conta?.id),
      },201);
    }
    if (request.method === "DELETE") {
      const normalized = email(url.searchParams.get("email"));
      if (!normalized) return response({ error:"Informe o e-mail." },400);
      const current = await env.DB.prepare(
        `SELECT email,role,status,note,expires_at AS expiresAt,last_access_at AS lastAccessAt
           FROM todogreen_access_emails
          WHERE tenant_id=? AND workspace_owner_id=? AND email=?`,
      ).bind(TODO_GREEN_TENANT.id,espacoDaConcessao(access),normalized).first();
      const now = new Date().toISOString();
      await env.DB.prepare(
        "UPDATE todogreen_access_emails SET status='inactive',revoked_at=?,updated_at=? WHERE tenant_id=? AND workspace_owner_id=? AND email=?",
      ).bind(now,now,TODO_GREEN_TENANT.id,espacoDaConcessao(access),normalized).run();
      // Encerrar a liberação por e-mail não basta: `tenant_users` é a outra
      // fonte de vínculo, e quem trabalhava de verdade tinha as duas.
      const contaRevogada = await contaPorEmail(env, normalized);
      if (contaRevogada?.id) await desvincularDoEspaco(env, access, contaRevogada.id);
      if (dependencies.audit) await dependencies.audit(env,access.ownerId,user,"todogreen_acesso_removido",normalized,"");
      await registrarAuditoriaTodoGreen(env, {
        access,user,action:"revoked",resourceType:"access",resourceId:normalized,
        before:current || {},after:{ ...(current || {}),status:"inactive",revokedAt:now },
      });
      return response({ ok:true });
    }
    return response({ error:"Método não permitido." },405);
  }

  // Fila de aprovação dos pedidos feitos na tela de login (migração 0086). Só
  // administradores enxergam e decidem. Aprovar concede pelo MESMO caminho da
  // liberação manual por e-mail — não há um segundo jeito de virar usuário.
  if (resource === "access-requests") {
    if (!canManage(access)) return response({ error:"Você não pode gerenciar acessos da To Do Green." },403);
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT id,email,name,company,phone,message,status,decided_role AS decidedRole,
                decided_by AS decidedBy,decided_at AS decidedAt,decision_note AS decisionNote,
                created_at AS createdAt,updated_at AS updatedAt
           FROM todogreen_access_requests
          WHERE tenant_id=?
          ORDER BY status='pending' DESC, created_at DESC LIMIT 200`,
      ).bind(TODO_GREEN_TENANT.id).all().catch(() => ({ results: [] }));
      return response({ requests: rows.results || [] });
    }
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const id = String(body.id || "").trim();
      const decisao = (body.decisao === "aprovar" || body.decision === "approve") ? "approved"
        : (body.decisao === "recusar" || body.decision === "reject") ? "rejected" : "";
      if (!id || !decisao) return response({ error:"Informe o pedido e a decisão." },400);
      const pedido = await env.DB.prepare(
        "SELECT id,email,name,status FROM todogreen_access_requests WHERE tenant_id=? AND id=?",
      ).bind(TODO_GREEN_TENANT.id, id).first();
      if (!pedido) return response({ error:"Pedido não encontrado." },404);
      if (pedido.status !== "pending") return response({ error:"Este pedido já foi decidido." },409);
      const now = new Date().toISOString();
      const nota = String(body.note || body.nota || "").trim().slice(0,240);

      if (decisao === "rejected") {
        await env.DB.prepare(
          "UPDATE todogreen_access_requests SET status='rejected',decided_by=?,decided_at=?,decision_note=?,updated_at=? WHERE tenant_id=? AND id=?",
        ).bind(user.id, now, nota, now, TODO_GREEN_TENANT.id, id).run();
        await registrarAuditoriaTodoGreen(env, {
          access,user,action:"rejected",resourceType:"access-request",resourceId:email(pedido.email),after:{ status:"rejected" },
        });
        return response({ ok:true, status:"rejected" });
      }

      // O papel vem da decisão do administrador; sem papel válido, 'auditor'.
      const role = TODO_GREEN_ROLES.includes(body.role) ? body.role : "auditor";
      const permissions = TODO_GREEN_PERMISSIONS[role] || ["read"];
      const alvo = email(pedido.email);
      // Aprovar o pedido cria o acesso mesmo durante indisponibilidade do
      // provedor de e-mail; o convite é tentado abaixo e seu resultado volta na resposta.
      await env.DB.prepare(
        `INSERT INTO todogreen_access_emails
         (id,tenant_id,email,role,status,permissions_json,note,expires_at,revoked_at,created_by,workspace_owner_id,created_at,updated_at)
         VALUES (?,?,?,?,'active',?,?,NULL,NULL,?,?,?,?) ON CONFLICT(tenant_id,workspace_owner_id,email) DO UPDATE SET
          role=excluded.role,status='active',permissions_json=excluded.permissions_json,
          revoked_at=NULL,workspace_owner_id=excluded.workspace_owner_id,updated_at=excluded.updated_at`,
      ).bind(
        crypto.randomUUID(), TODO_GREEN_TENANT.id, alvo, role,
        JSON.stringify(permissions), `Aprovado da fila de acesso${nota ? ` — ${nota}` : ""}`.slice(0,240),
        user.id, espacoDaConcessao(access), now, now,
      ).run();
      // Se a conta já existe, o vínculo com o espaço nasce agora; se ainda não,
      // nasce no primeiro acesso, como na liberação manual.
      const conta = await contaPorEmail(env, alvo);
      if (conta?.id) await vincularAoEspaco(env, { access, userId: conta.id, email: alvo, role, permissions });

      await env.DB.prepare(
        `UPDATE todogreen_access_requests SET status='approved',decided_workspace_owner_id=?,decided_role=?,
           decided_by=?,decided_at=?,decision_note=?,updated_at=? WHERE tenant_id=? AND id=?`,
      ).bind(espacoDaConcessao(access), role, user.id, now, nota, now, TODO_GREEN_TENANT.id, id).run();

      if (dependencies.audit) await dependencies.audit(env,access.ownerId,user,"todogreen_acesso_autorizado",alvo,`papel: ${role} (fila de acesso)`);
      await registrarAuditoriaTodoGreen(env, {
        access,user,action:"authorized",resourceType:"access-request",resourceId:alvo,
        after:{ email:alvo, role, status:"approved", workspaceOwnerId: espacoDaConcessao(access) },
      });
      let invitationSent = false;
      let invitationError = "";
      try {
        await enviarConviteDeAcessoTodoGreen({
          env, access, user, email: alvo, name: pedido.name || "",
          role, permissions, origin: url.origin,
        });
        invitationSent = true;
      } catch (error) {
        console.error("todogreen approved request invitation", error);
        invitationError = "O acesso foi aprovado, mas o convite não pôde ser enviado agora.";
      }
      return response({
        ok:true, status:"approved", role, email:alvo,
        aguardandoCadastro: Boolean(!conta?.id),
        invitationSent, invitationError,
      });
    }
    return response({ error:"Método não permitido." },405);
  }

  if (["catalog","dashboard","products"].includes(resource)) await seedCatalog(env);
  if (request.method === "GET" && resource === "catalog")
    return response({ tenant:TODO_GREEN_TENANT,modules:TODO_GREEN_MODULE_CATALOG,products:LOGISTICS_PRODUCTS,access });
  if (request.method === "GET" && resource === "products") return response({ products:LOGISTICS_PRODUCTS });

  if (request.method === "GET" && resource === "dashboard") {
    const rows = await env.DB.prepare(
      `SELECT id,product_id,client_id,result_json,status,created_at FROM pricing_scenarios
       WHERE tenant_id=? AND workspace_owner_id=? ORDER BY created_at DESC LIMIT 200`,
    ).bind(TODO_GREEN_TENANT.id,access.ownerId).all().catch(() => ({ results:[] }));
    const pricingScenarios = (rows.results || []).map((row) => ({
      id:row.id,productId:row.product_id,clientId:row.client_id,status:row.status,
      result:parse(row.result_json,{}),createdAt:row.created_at,
    }));
    return response({ summary:summarizeTodoGreenDashboard({ pricingScenarios }) });
  }

  if (request.method === "POST" && resource === "simulate") {
    const body = await request.json().catch(() => ({}));
    // Salvar pede a mesma permissão dos outros caminhos que gravam cenário (a
    // coleção de simulações e o Deal Desk): o cenário salvo entra no painel
    // comercial e pode embasar um pedido de aprovação.
    if (body.persist === true && !podeNaVertical(access,"pricing:simulate"))
      return response({ error:"Seu papel não pode salvar simulações." },403);
    const productId = String(body.productId || "");
    const inputs = body.inputs || {};
    let scenario;
    try {
      const product = LOGISTICS_PRODUCTS.find((item) => item.id === productId);
      const resolved = await parametrosResolvidos(env,access.ownerId,{
        productId,modality:inputs.modality || product?.modality,vehicleType:inputs.vehicleType,
        region:inputs.region || inputs.city,clientId:body.clientId || inputs.clientId,contractId:inputs.contractId,
      });
      const reguaEsg = await reguaEsgEmVigor(env,access.ownerId);
      scenario = createPricingScenarioSnapshot(productId,inputs,{
        tenantId:TODO_GREEN_TENANT.id,userId:user.id,clientId:body.clientId || "",
        opportunityId:body.opportunityId || "",justification:body.justification || "",
      },{
        assumptions:resolved.parametros,
        // Régua ESG editável alimenta o CO₂ evitado e o Green Score do simulador
        // oficial. Sem régua, cai nos defaults de fábrica.
        environmentalFactors:reguaEsg.fatores,
        greenScoreWeights:reguaEsg.pesos,
        parameterVersion:resolved.aplicados.map((item) => item.versao).join(" + ") || "padrao-de-fabrica",
      });
    } catch (error) {
      return response({ error:error.message || "Simulação inválida." },400);
    }
    if (body.persist === true) {
      await env.DB.prepare(
        `INSERT INTO pricing_scenarios
        (id,tenant_id,workspace_owner_id,product_id,client_id,opportunity_id,created_by,
         rule_version,inputs_json,result_json,approvals_json,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?)`,
      ).bind(
        scenario.id,TODO_GREEN_TENANT.id,access.ownerId,productId,scenario.clientId,
        scenario.opportunityId,user.id,scenario.ruleVersion,JSON.stringify(scenario.inputs),
        JSON.stringify(scenario.result),JSON.stringify(scenario.approvals),scenario.createdAt,
      ).run();
      if (dependencies.audit) await dependencies.audit(env,access.ownerId,user,"todogreen_simulacao_criada",scenario.id,scenario.result.productName);
    }
    return response({ scenario });
  }

  if (request.method === "POST" && resource === "audit") {
    const body = await request.json().catch(() => ({}));
    if (dependencies.audit) {
      await dependencies.audit(
        env,access.ownerId,user,String(body.action || "todogreen_event").slice(0,80),
        String(body.target || "").slice(0,160),String(body.details || "").slice(0,600),
      );
    }
    return response({ ok:true });
  }

  if (request.method === "POST" && resource === "calculate") {
    const body = await request.json().catch(() => ({}));
    try {
      const productId = String(body.productId || "");
      const inputs = body.inputs || {};
      const product = LOGISTICS_PRODUCTS.find((item) => item.id === productId);
      const resolved = await parametrosResolvidos(env,access.ownerId,{
        productId,modality:inputs.modality || product?.modality,vehicleType:inputs.vehicleType,
        region:inputs.region || inputs.city,clientId:inputs.clientId,contractId:inputs.contractId,
      });
      const reguaEsg = await reguaEsgEmVigor(env,access.ownerId);
      return response({ result:centralPricingEngine(productId,inputs,{
        assumptions:resolved.parametros,
        environmentalFactors:reguaEsg.fatores,
        greenScoreWeights:reguaEsg.pesos,
        parameterVersion:resolved.aplicados.map((item) => item.versao).join(" + ") || "padrao-de-fabrica",
      }) });
    } catch (error) {
      return response({ error:error.message || "Cálculo inválido." },400);
    }
  }

  return response({ error:"Recurso To Do Green não encontrado." },404);
}
