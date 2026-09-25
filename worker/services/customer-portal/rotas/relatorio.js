// ===== Portal do Cliente: rota do relatório =====
//
// Contrato de todo sub-handler de rotas/: recebe o contexto da requisição já
// autenticada e com o escopo resolvido (`escopo` = o cliente da SESSÃO, nunca
// um parâmetro do pedido) e devolve a Response quando o pedido é deste
// recurso, ou null para o próximo sub-handler tentar.
//
// GET /relatorio?inicio&fim: o material bruto do relatório do período (os
// `campos` das operações passam pela whitelist). Exige `portal:report:export`.

import { clientCan, scopedWhere } from "../../../../src/features/logistics/customerPortalDomain.js";
import { clean, parse, response } from "../../todogreen-client-helpers.js";
import { logPortalEvent } from "../auditoria.js";
import { camposParaCliente } from "../visao-do-cliente.js";

export async function rotaDoRelatorio({ request, env, url, resource, user, escopo }) {
  // Dados para o relatório. O portal devolve o material bruto e a montagem do
  // documento acontece no navegador, com o mesmo código que a tela interna usa
  // — assim não existem duas versões do mesmo relatório.
  if (request.method === "GET" && resource === "relatorio") {
    if (!clientCan(escopo, "portal:report:export"))
      return response({ error: "Seu acesso não permite exportar relatórios." }, 403);

    const inicio = clean(url.searchParams.get("inicio"), 10);
    const fim = clean(url.searchParams.get("fim"), 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim))
      return response({ error: "Informe início e fim no formato AAAA-MM-DD." }, 400);

    const { sql, params } = scopedWhere(escopo, "service_date BETWEEN ? AND ?");
    const operacoes = await env.DB.prepare(
      `SELECT id, reference, status, service_date, origin, destination, fields_json
         FROM todogreen_client_operations
        WHERE ${sql}
        ORDER BY service_date`,
    )
      .bind(...params, inicio, fim)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    const calculos = await env.DB.prepare(
      `SELECT id, result_json, methodology_version, data_quality, created_at
         FROM environmental_calculations
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ?
          AND substr(created_at, 1, 10) BETWEEN ? AND ?
        ORDER BY created_at`,
    )
      .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, inicio, fim)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    const score = await env.DB.prepare(
      `SELECT score, weights_version, components_json, calculated_at
         FROM todogreen_green_scores
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND scope_type = 'cliente'
        ORDER BY calculated_at DESC LIMIT 1`,
    )
      .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId)
      .first()
      .catch(() => null);

    await logPortalEvent(env, escopo, user, "relatorio_gerado", `${inicio}..${fim}`);

    return response({
      cliente: { nome: escopo.clientName },
      periodo: { inicio, fim },
      operacoes: (operacoes.results || []).map((l) => ({
        id: l.id,
        referencia: l.reference,
        data: l.service_date,
        campos: camposParaCliente(parse(l.fields_json, {})),
      })),
      calculos: (calculos.results || []).map((l, i) => ({
        ...parse(l.result_json, {}),
        referencia: `Cálculo ${i + 1}`,
        qualidadeDados: l.data_quality,
        versaoFatores: l.methodology_version,
      })),
      greenScore: score
        ? {
            score: score.score,
            versaoPesos: score.weights_version,
            componentes: parse(score.components_json, {}),
          }
        : null,
    });
  }
  return null;
}
