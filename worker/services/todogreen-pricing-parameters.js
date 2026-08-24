// Parâmetros do simulador: versões por escopo, herança e auditoria.

import { exigirAcessoTodoGreen } from "./todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import {
  ESCOPO_PARAMETROS,
  MODELOS_PARAMETROS,
  explicarMudanca,
  resolverParametros,
  simularEfeito,
  validarParametros,
} from "../../src/features/logistics/pricingParametersDomain.js";
import { DEFAULT_PRICING_ASSUMPTIONS } from "../../src/features/logistics/logisticsVerticalDomain.js";

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
  try { return JSON.parse(v || ""); } catch { return fallback; }
};
const podeGerirPreco = (access) => access.role === "owner" || access.role === "admin"
  || access.permissions.includes("*") || access.permissions.includes("pricing:manage");

const perfil = (linha) => ({
  id: linha.id,
  versao: linha.version,
  nome: linha.name,
  scopeType: linha.scope_type,
  scopeKey: linha.scope_key,
  parametros: parse(linha.parameters_json, {}),
  mudanca: linha.change_summary,
  justificativa: linha.justification,
  fonte: linha.source,
  responsavel: linha.responsible,
  vigenciaInicio: linha.effective_from,
  vigenciaFim: linha.effective_to,
  status: linha.status,
  criadoEm: linha.created_at,
});

const listarPerfis = async (env, ownerId, somenteAtivos = false) => {
  const resultado = await env.DB.prepare(
    `SELECT id,version,name,scope_type,scope_key,parameters_json,change_summary,
            justification,source,responsible,effective_from,effective_to,status,created_at
       FROM todogreen_simulator_parameter_sets
      WHERE tenant_id=? AND workspace_owner_id=? ${somenteAtivos ? "AND status='active'" : ""}
      ORDER BY effective_from DESC, created_at DESC LIMIT 200`,
  ).bind(TENANT_ID, ownerId).all().catch(() => ({ results: [] }));
  return (resultado.results || []).map(perfil);
};

const padraoComercial = () => ({ ...DEFAULT_PRICING_ASSUMPTIONS });

// Mantém o contrato antigo. Consumidores que só conhecem `atual.parametros`
// continuam recebendo uma régua global completa.
export async function reguaEmVigor(env, ownerId = "") {
  if (ownerId) {
    const ativos = await listarPerfis(env, ownerId, true);
    const global = ativos.find((item) => item.scopeType === "global" && item.scopeKey === "global");
    if (global) return {
      versao: global.versao,
      parametros: { ...padraoComercial(), ...global.parametros },
      responsavel: global.responsavel,
      vigenciaInicio: global.vigenciaInicio,
      mudanca: global.mudanca,
      deFabrica: false,
    };
  }

  const linha = await env.DB.prepare(
    `SELECT version,parameters_json,responsible,effective_from,change_summary
       FROM todogreen_pricing_parameters
      WHERE tenant_id=? AND status='active'
      ORDER BY effective_from DESC LIMIT 1`,
  ).bind(TENANT_ID).first().catch(() => null);
  if (linha) return {
    versao: linha.version,
    parametros: { ...padraoComercial(), ...parse(linha.parameters_json, {}) },
    responsavel: linha.responsible,
    vigenciaInicio: linha.effective_from,
    mudanca: linha.change_summary,
    deFabrica: false,
  };
  return { versao: "padrao-de-fabrica", parametros: padraoComercial(), responsavel: "", deFabrica: true };
}

export async function parametrosResolvidos(env, ownerId, contexto = {}) {
  const atual = await reguaEmVigor(env, ownerId);
  const perfis = await listarPerfis(env, ownerId, true);
  return resolverParametros(atual.parametros, perfis, contexto);
}

const contextoDaUrl = (url) => ({
  productId: clean(url.searchParams.get("productId"), 100),
  modality: clean(url.searchParams.get("modality"), 100),
  vehicleType: clean(url.searchParams.get("vehicleType"), 120),
  region: clean(url.searchParams.get("region"), 120),
  clientId: clean(url.searchParams.get("clientId"), 120),
  contractId: clean(url.searchParams.get("contractId"), 120),
});

export async function handleTodoGreenPricingParameters(request, env) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  const porta = await exigirAcessoTodoGreen(request, env);
  if (porta.response) return porta.response;
  const { user, access } = porta;

  if (request.method === "GET") {
    const url = new URL(request.url);
    const [atual, perfis, historicoNovo] = await Promise.all([
      reguaEmVigor(env, access.ownerId),
      listarPerfis(env, access.ownerId, true),
      listarPerfis(env, access.ownerId, false),
    ]);
    const legado = await env.DB.prepare(
      `SELECT version,parameters_json,change_summary,justification,responsible,
              effective_from,effective_to,status,created_at
         FROM todogreen_pricing_parameters WHERE tenant_id=?
        ORDER BY effective_from DESC LIMIT 24`,
    ).bind(TENANT_ID).all().catch(() => ({ results: [] }));
    const contexto = contextoDaUrl(url);
    const resolvido = resolverParametros(atual.parametros, perfis, contexto);
    const historico = historicoNovo.length ? historicoNovo : (legado.results || []).map((l) => ({
      versao: l.version, parametros: parse(l.parameters_json, {}), mudanca: l.change_summary,
      justificativa: l.justification, responsavel: l.responsible,
      vigenciaInicio: l.effective_from, vigenciaFim: l.effective_to, status: l.status,
      scopeType: "global", scopeKey: "global", nome: "Régua global",
    }));
    return response({
      atual,
      resolvido,
      perfis,
      podeEditar: podeGerirPreco(access),
      historico: historico.slice(0, 48),
      escopos: ESCOPO_PARAMETROS,
      modelos: MODELOS_PARAMETROS,
    });
  }

  if (request.method === "POST") {
    if (!podeGerirPreco(access))
      return response({ error: "Só quem gere preço pode alterar os parâmetros do simulador." }, 403);
    const body = await request.json().catch(() => null);
    if (!body) return response({ error: "Corpo JSON inválido." }, 400);

    const versao = clean(body.versao ?? body.version, 40);
    if (!versao) return response({ error: "Informe a versão dos parâmetros." }, 400);
    const scopeType = clean(body.scopeType || body.escopoTipo || "global", 20);
    if (!ESCOPO_PARAMETROS.some((item) => item.id === scopeType))
      return response({ error: "Escopo de parâmetros inválido." }, 400);
    const scopeKey = scopeType === "global" ? "global" : clean(body.scopeKey || body.escopoChave, 120);
    if (!scopeKey) return response({ error: "Informe a chave do escopo." }, 400);

    const ativos = await listarPerfis(env, access.ownerId, true);
    const anteriorPerfil = ativos.find((item) => item.scopeType === scopeType && item.scopeKey === scopeKey);
    const baseGlobal = await reguaEmVigor(env, access.ownerId);
    const bruto = body.parametros ?? body.parameters ?? {};
    const validacao = validarParametros(bruto, {
      parcial: scopeType !== "global",
      base: { ...baseGlobal.parametros, ...(anteriorPerfil?.parametros || {}) },
    });
    if (!validacao.valido) return response({ error: validacao.erros.join(" ") }, 400);
    if (scopeType !== "global" && !Object.keys(validacao.parametros).length)
      return response({ error: "Informe ao menos um parâmetro para substituir neste escopo." }, 400);

    const justificativa = clean(body.justificativa ?? body.justification, 500);
    if (justificativa.length < 5)
      return response({ error: "Escreva a justificativa da mudança — ela fica no registro." }, 400);

    const parametros = validacao.parametros;
    const mudanca = explicarMudanca(parametros, anteriorPerfil?.parametros || baseGlobal.parametros);
    const agora = new Date().toISOString();
    const vigencia = clean(body.vigenciaInicio ?? body.effectiveFrom, 10) || agora.slice(0, 10);
    const id = crypto.randomUUID();
    const nome = clean(body.nome || body.name, 120) || `${scopeType}: ${scopeKey}`;
    const fonte = clean(body.fonte || body.source, 300);
    const responsavel = clean(body.responsavel ?? body.responsible, 200) || user.name || user.email;

    const update = env.DB.prepare(
      `UPDATE todogreen_simulator_parameter_sets
          SET status='superseded',effective_to=?,updated_at=?
        WHERE tenant_id=? AND workspace_owner_id=? AND scope_type=? AND scope_key=? AND status='active'`,
    ).bind(vigencia, agora, TENANT_ID, access.ownerId, scopeType, scopeKey);
    const insert = env.DB.prepare(
      `INSERT INTO todogreen_simulator_parameter_sets
         (id,tenant_id,workspace_owner_id,version,name,scope_type,scope_key,parameters_json,
          change_summary,justification,source,responsible,effective_from,status,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`,
    ).bind(id, TENANT_ID, access.ownerId, versao, nome, scopeType, scopeKey,
      JSON.stringify(parametros), mudanca, justificativa, fonte, responsavel,
      vigencia, user.id, agora, agora);
    try {
      await env.DB.batch([update, insert]);
    } catch (error) {
      if (String(error?.message || error).includes("UNIQUE"))
        return response({ error: "Essa versão já existe neste escopo." }, 409);
      throw error;
    }

    await registrarAuditoriaTodoGreen(env, {
      access, user, action: "simulator_parameters_activated", resourceType: "simulator_parameters",
      resourceId: id, before: anteriorPerfil || {},
      after: { id, versao, nome, scopeType, scopeKey, parametros, vigencia, fonte },
      details: justificativa,
    });
    const efetivos = { ...baseGlobal.parametros, ...parametros };
    return response({ ok: true, id, versao, scopeType, scopeKey, mudanca, efeito: simularEfeito(efetivos, 10000) }, 201);
  }

  return response({ error: "Método não permitido." }, 405);
}
