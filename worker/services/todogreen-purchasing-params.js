// Alçadas de compras: régua editável (versionada por espaço) das faixas de
// aprovação por valor. GET devolve a régua em vigor (ou a de fábrica quando
// ainda não há linha); PUT substitui a régua, com revisão para concorrência
// otimista e trilha de auditoria. Mesmo molde de todogreen-operation-params.
//
// A régua define QUEM aprova até QUANTO — dado sensível: editar exige
// owner/admin. O servidor RE-VALIDA cada faixa (normalizarBandas) antes de
// gravar, então config malformada nunca entra.

import { TENANT_ID } from "./todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import { PURCHASE_APPROVAL_BANDS, PURCHASE_APPROVAL_STEP_PERMISSIONS, normalizarBandas } from "./todogreen-purchasing-enterprise.js";

const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});
const parse = (v, fallback) => {
  try { return JSON.parse(v || ""); } catch { return fallback; }
};

const podeGerir = (access) =>
  access.role === "owner" || access.role === "admin" || (Array.isArray(access.permissions) && access.permissions.includes("*"));
const podeLer = (access) =>
  podeGerir(access) || access.role === "auditor"
  || (Array.isArray(access.permissions) && (access.permissions.includes("purchase:manage") || access.permissions.includes("finance:manage")));

const reguaDoEspaco = async (env, ownerId) => {
  const linha = await env.DB.prepare(
    "SELECT config_json, revision, updated_at, updated_by FROM todogreen_purchase_approval_params WHERE tenant_id=? AND workspace_owner_id=?",
  ).bind(TENANT_ID, ownerId).first().catch(() => null);
  if (!linha)
    return { bands: PURCHASE_APPROVAL_BANDS.map((b) => ({ ...b, steps: b.steps.map((s) => ({ ...s })) })), revision: 0, padrao: true, updatedAt: "", updatedBy: "" };
  const normalizada = normalizarBandas(parse(linha.config_json, null));
  // Linha ilegível (não deveria acontecer: o PUT valida antes de gravar) volta à
  // régua de fábrica, para a tela e a alçada nunca ficarem sem faixa nenhuma.
  return {
    bands: normalizada || PURCHASE_APPROVAL_BANDS.map((b) => ({ ...b, steps: b.steps.map((s) => ({ ...s })) })),
    revision: linha.revision,
    padrao: !normalizada,
    updatedAt: linha.updated_at || "",
    updatedBy: linha.updated_by || "",
  };
};

export async function handleTodoGreenPurchasingParams(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);

  if (request.method === "GET") {
    if (!podeLer(access))
      return response({ error: "Você não tem permissão para consultar as alçadas de compras." }, 403);
    const regua = await reguaDoEspaco(env, access.ownerId);
    return response({
      ...regua,
      // A tela monta o editor só com papéis conhecidos — os mesmos que a
      // validação aceita — em vez de campo livre de permissão.
      permissoesDisponiveis: PURCHASE_APPROVAL_STEP_PERMISSIONS,
      podeEditar: podeGerir(access),
    });
  }

  if (request.method === "PUT") {
    if (!podeGerir(access))
      return response({ error: "Só a administração edita as alçadas de compras." }, 403);
    const corpo = await request.json().catch(() => ({}));
    const bandas = normalizarBandas(corpo.config ?? corpo);
    if (!bandas)
      return response({
        error: "Régua inválida. Cada faixa precisa de um teto (número > 0, ou nulo no topo) e de etapas com papel de aprovação conhecido.",
      }, 400);

    // Concorrência otimista: a tela manda a revisão que leu; se o banco avançou,
    // recusa com 409 para recarregar em vez de sobrescrever às cegas.
    const atual = await reguaDoEspaco(env, access.ownerId);
    const revisaoEnviada = Number(corpo.revision);
    if (!atual.padrao && Number.isFinite(revisaoEnviada) && revisaoEnviada !== atual.revision)
      return response({ error: "As alçadas mudaram em outra tela. Recarregue.", revision: atual.revision }, 409);

    const agora = new Date().toISOString();
    const proxima = (atual.padrao ? 0 : atual.revision) + 1;
    const json = JSON.stringify({ bands: bandas });
    await env.DB.prepare(
      `INSERT INTO todogreen_purchase_approval_params (tenant_id, workspace_owner_id, config_json, revision, updated_by, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(tenant_id, workspace_owner_id) DO UPDATE SET
         config_json=excluded.config_json, revision=excluded.revision,
         updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
    ).bind(TENANT_ID, access.ownerId, json, proxima, user.id, agora).run();
    await registrarAuditoriaTodoGreen(env, {
      access,
      user,
      action: "purchase_approval_params.update",
      resourceType: "purchase_approval_params",
      resourceId: access.ownerId,
      details: `Alçadas de compras atualizadas (${bandas.length} faixa(s))`,
    }).catch(() => {});
    return response({ bands: bandas, revision: proxima, padrao: false, updatedAt: agora, updatedBy: user.id, podeEditar: true });
  }

  return response({ error: "Método não permitido." }, 405);
}
