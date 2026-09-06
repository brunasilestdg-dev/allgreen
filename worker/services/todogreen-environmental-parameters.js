// Régua ESG editável: fatores de CO₂ + pesos do Green Score, versionados por
// espaço. Espelha o molde da régua de preço (versão nova a cada mudança, com
// responsável, justificativa e vigência), mas num modelo simples: uma versão
// ativa por espaço. Sem régua, o motor usa os defaults de fábrica — o
// comportamento é idêntico ao de antes desta feature.

import { exigirAcessoTodoGreen } from "./todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import {
  DEFAULT_ENVIRONMENTAL_FACTORS,
  DEFAULT_GREEN_SCORE_WEIGHTS,
} from "../../src/features/logistics/logisticsVerticalDomain.js";
import { resolverReguaEsg } from "../../src/features/logistics/esgParametersDomain.js";

const TENANT_ID = "todogreen";
const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});
const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const parse = (v, fallback) => {
  try { return JSON.parse(v); } catch { return fallback; }
};

const PADROES = { fatoresPadrao: DEFAULT_ENVIRONMENTAL_FACTORS, pesosPadrao: DEFAULT_GREEN_SCORE_WEIGHTS };

const podeLerEsg = (access) =>
  access.role === "owner" || access.role === "admin" || access.role === "auditor" ||
  access.permissions.includes("*") || access.permissions.includes("esg:manage") ||
  access.permissions.includes("pricing:simulate");
const podeGerirEsg = (access) =>
  access.role === "owner" || access.role === "admin" ||
  access.permissions.includes("*") || access.permissions.includes("esg:manage");

/**
 * A régua ESG em vigor para um espaço, já resolvida (fatores + pesos), com os
 * defaults de fábrica por baixo. Usada pelo motor (simulate/calculate) e pela
 * tela de edição. Nunca lança: em qualquer falha, cai nos defaults.
 */
export async function reguaEsgEmVigor(env, ownerId = "") {
  let linha = null;
  try {
    linha = await env.DB.prepare(
      `SELECT version,factors_json,green_score_weights_json,responsible,effective_from,change_summary
         FROM todogreen_environmental_parameters
        WHERE tenant_id=? AND workspace_owner_id=? AND status='active'
        ORDER BY effective_from DESC LIMIT 1`,
    ).bind(TENANT_ID, ownerId).first();
  } catch { linha = null; }

  const resolvida = resolverReguaEsg(
    linha ? { factors: parse(linha.factors_json, {}), weights: parse(linha.green_score_weights_json, {}) } : null,
    PADROES,
  );
  return {
    versao: linha?.version || "padrao-de-fabrica",
    fatores: resolvida.fatores,
    pesos: resolvida.pesos,
    responsavel: linha?.responsible || "",
    vigenciaInicio: linha?.effective_from || "",
    mudanca: linha?.change_summary || "",
    deFabrica: !linha,
  };
}

export async function handleTodoGreenEnvironmentalParameters(request, env) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  const porta = await exigirAcessoTodoGreen(request, env);
  if (porta.response) return porta.response;
  const { user, access } = porta;

  if (request.method === "GET") {
    if (!podeLerEsg(access))
      return response({ error: "Você não tem permissão para consultar a régua ESG." }, 403);
    const atual = await reguaEsgEmVigor(env, access.ownerId);
    const historico = await env.DB.prepare(
      `SELECT version,factors_json,green_score_weights_json,change_summary,justification,
              responsible,effective_from,effective_to,status
         FROM todogreen_environmental_parameters
        WHERE tenant_id=? AND workspace_owner_id=?
        ORDER BY effective_from DESC LIMIT 24`,
    ).bind(TENANT_ID, access.ownerId).all().catch(() => ({ results: [] }));
    return response({
      atual,
      padrao: { fatores: DEFAULT_ENVIRONMENTAL_FACTORS, pesos: DEFAULT_GREEN_SCORE_WEIGHTS },
      podeEditar: podeGerirEsg(access),
      historico: (historico.results || []).map((l) => ({
        versao: l.version,
        fatores: parse(l.factors_json, {}),
        pesos: parse(l.green_score_weights_json, {}),
        mudanca: l.change_summary,
        justificativa: l.justification,
        responsavel: l.responsible,
        vigenciaInicio: l.effective_from,
        vigenciaFim: l.effective_to,
        status: l.status,
      })),
    });
  }

  if (request.method === "POST") {
    if (!podeGerirEsg(access))
      return response({ error: "Só quem administra ESG pode alterar a régua." }, 403);
    const body = await request.json().catch(() => null);
    if (!body) return response({ error: "Corpo JSON inválido." }, 400);
    const justificativa = clean(body.justificativa ?? body.justification, 500);
    if (justificativa.length < 5)
      return response({ error: "Escreva a justificativa da mudança — ela fica no registro." }, 400);

    // Sanea contra os defaults: só chaves conhecidas e valores válidos entram.
    const resolvida = resolverReguaEsg(
      { factors: body.fatores ?? body.factors, weights: body.pesos ?? body.weights },
      PADROES,
    );

    const agora = new Date().toISOString();
    const versao = clean(body.versao ?? body.version, 40) || `esg-${agora.slice(0, 10)}-${agora.slice(11, 19).replace(/:/g, "")}`;
    const vigencia = clean(body.vigenciaInicio ?? body.effectiveFrom, 10) || agora.slice(0, 10);
    const mudanca = clean(body.mudanca ?? body.changeSummary, 300) || "Régua ESG atualizada.";
    const responsavel = clean(body.responsavel ?? body.responsible, 200) || user.name || user.email;
    const id = crypto.randomUUID();

    // Aposenta a versão ativa e grava a nova como ativa, na mesma transação.
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE todogreen_environmental_parameters
            SET status='superseded',effective_to=?
          WHERE tenant_id=? AND workspace_owner_id=? AND status='active'`,
      ).bind(vigencia, TENANT_ID, access.ownerId),
      env.DB.prepare(
        `INSERT INTO todogreen_environmental_parameters
           (version,tenant_id,workspace_owner_id,factors_json,green_score_weights_json,
            change_summary,justification,responsible,effective_from,status,created_by,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)`,
      ).bind(id, TENANT_ID, access.ownerId, JSON.stringify(resolvida.fatores),
        JSON.stringify(resolvida.pesos), mudanca, justificativa, responsavel,
        vigencia, user.id, agora),
    ]);

    await registrarAuditoriaTodoGreen(env, {
      access, user, action: "todogreen_regua_esg_atualizada", resourceType: "environmental_parameters",
      resourceId: id, after: { versao, fatores: resolvida.fatores, pesos: resolvida.pesos },
    });
    return response({ ok: true, atual: await reguaEsgEmVigor(env, access.ownerId) });
  }

  return response({ error: "Método não permitido." }, 405);
}
