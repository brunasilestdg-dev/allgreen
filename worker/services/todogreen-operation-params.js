// Parâmetros do motor de HC e DRE por tipo de operação (régua editável só por
// admin/owner, por espaço). GET devolve a régua em vigor (ou a semente do
// código quando ainda não há linha); PUT substitui a régua, com revisão para
// concorrência otimista.

import { exigirAcessoTodoGreen } from "./todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import { PARAMS_OPERACAO_PADRAO } from "../../src/features/logistics/operationParamsSeed.js";

const TENANT_ID = "todogreen";
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
  access.role === "owner" || access.role === "admin" || access.permissions.includes("*");
const podeLer = (access) =>
  podeGerir(access) || access.role === "auditor" || access.permissions.includes("operations:manage")
  || access.permissions.includes("pricing:simulate") || access.permissions.includes("pricing:manage");

const reguaDoEspaco = async (env, ownerId) => {
  const linha = await env.DB.prepare(
    `SELECT config_json, revision, updated_at, updated_by FROM todogreen_operation_params
      WHERE tenant_id=? AND workspace_owner_id=?`,
  ).bind(TENANT_ID, ownerId).first().catch(() => null);
  if (!linha) return { config: PARAMS_OPERACAO_PADRAO, revision: 0, padrao: true, updatedAt: "", updatedBy: "" };
  return {
    config: parse(linha.config_json, PARAMS_OPERACAO_PADRAO),
    revision: linha.revision,
    padrao: false,
    updatedAt: linha.updated_at || "",
    updatedBy: linha.updated_by || "",
  };
};

export async function handleTodoGreenOperationParams(request, env) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  const porta = await exigirAcessoTodoGreen(request, env);
  if (porta.response) return porta.response;
  const { user, access } = porta;

  if (request.method === "GET") {
    if (!podeLer(access))
      return response({ error: "Você não tem permissão para consultar a régua de operação." }, 403);
    const regua = await reguaDoEspaco(env, access.ownerId);
    return response({ ...regua, podeEditar: podeGerir(access) });
  }

  if (request.method === "PUT") {
    if (!podeGerir(access))
      return response({ error: "Só a administração edita a régua de HC e DRE." }, 403);
    const corpo = await request.json().catch(() => ({}));
    const config = corpo.config;
    if (!config || typeof config !== "object" || Array.isArray(config))
      return response({ error: "Envie a régua completa em `config`." }, 400);
    // Concorrência otimista: a tela manda a revisão que leu; se o banco avançou,
    // recusa com 409 para a pessoa recarregar em vez de sobrescrever às cegas.
    const atual = await reguaDoEspaco(env, access.ownerId);
    const revisaoEnviada = Number(corpo.revision);
    if (!atual.padrao && Number.isFinite(revisaoEnviada) && revisaoEnviada !== atual.revision)
      return response({ error: "A régua mudou em outra tela. Recarregue.", revision: atual.revision }, 409);

    const agora = new Date().toISOString();
    const proxima = (atual.padrao ? 0 : atual.revision) + 1;
    const json = JSON.stringify(config);
    if (json.length > 200000)
      return response({ error: "A régua ficou grande demais." }, 400);
    await env.DB.prepare(
      `INSERT INTO todogreen_operation_params (tenant_id, workspace_owner_id, config_json, revision, updated_by, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(tenant_id, workspace_owner_id) DO UPDATE SET
         config_json=excluded.config_json, revision=excluded.revision,
         updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
    ).bind(TENANT_ID, access.ownerId, json, proxima, user.id, agora).run();
    await registrarAuditoriaTodoGreen(env, {
      access,
      user,
      action: "operation_params.update",
      resourceType: "operation_params",
      resourceId: access.ownerId,
      details: "Régua de HC e DRE atualizada",
    }).catch(() => {});
    return response({ config, revision: proxima, padrao: false, updatedAt: agora, updatedBy: user.id, podeEditar: true });
  }

  return response({ error: "Método não permitido." }, 405);
}
