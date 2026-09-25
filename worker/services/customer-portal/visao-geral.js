// ===== Portal do Cliente: indicadores =====
//
// Contrato: `clientOverview(env, escopo)` devolve os indicadores do cliente da
// sessão — operações, ambiental e Green Score (atual e anterior) — sempre com o
// cliente amarrado na condição (`scopedWhere` ou tenant + espaço + cliente do
// escopo). Sem dado é zero e `semDados: true`, nunca número inventado; uma
// consulta que falha vira null, não erro.

import { scopedWhere } from "../../../src/features/logistics/customerPortalDomain.js";
import { parse } from "../todogreen-client-helpers.js";

// ----- Indicadores do cliente -----
//
// Cada número abaixo é lido das tabelas da vertical, sempre com o cliente da
// sessão amarrado na condição. Sem registro, o número não é inventado: vem
// zero e a tela diz que não há dado.
export async function clientOverview(env, escopo) {
  const { sql, params } = scopedWhere(escopo);

  const operacoes = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CAST(json_extract(fields_json, '$.deliveries') AS REAL)), 0) AS entregas,
            COALESCE(SUM(CAST(json_extract(fields_json, '$.distanceKm') AS REAL)), 0) AS km,
            COALESCE(AVG(CAST(json_extract(fields_json, '$.occupancyPercent') AS REAL)), 0) AS ocupacao
       FROM todogreen_client_operations
      WHERE ${sql} AND lower(status) != 'rascunho'`,
  )
    .bind(...params)
    .first()
    .catch(() => null);

  // Reusa a tabela que a vertical já grava; os números moram no resultado em
  // JSON, com os mesmos nomes que o motor ambiental produz.
  const ambiental = await env.DB.prepare(
    `SELECT COALESCE(SUM(CAST(json_extract(result_json, '$.impact.co2AvoidedKg') AS REAL)), 0) AS co2,
            COALESCE(SUM(CAST(json_extract(result_json, '$.impact.dieselAvoidedLiters') AS REAL)), 0) AS diesel,
            -- Cenário convencional × operação real: os dois lados da comparação
            -- que a tela promete e que o motor já grava. As chaves são as que o
            -- motor ambiental emite (co2ReferenciaKg/co2ExecutadoKg) — antes esta
            -- consulta lia referenceEmissionsKg/actualEmissionsKg, que não existem
            -- no result_json, então convencional/realizado vinham sempre 0 e o
            -- bloco "Comparação de cenários" nunca renderizava.
            COALESCE(SUM(CAST(json_extract(result_json, '$.impact.co2ReferenciaKg') AS REAL)), 0) AS convencional,
            COALESCE(SUM(CAST(json_extract(result_json, '$.impact.co2ExecutadoKg') AS REAL)), 0) AS realizado,
            COALESCE(AVG(CAST(json_extract(result_json, '$.impact.reductionPercent') AS REAL)), 0) AS reducao,
            COALESCE(AVG(data_quality), 0) AS qualidade,
            COUNT(*) AS calculos
       FROM environmental_calculations
      WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ?`,
  )
    .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId)
    .first()
    .catch(() => null);

  // As duas notas mais recentes: a atual e a anterior. A tela mostra a
  // composição (components_json) e a variação (atual − anterior) — antes o
  // /resumo só devolvia valor/versão/data, então "Composição da nota" caía
  // sempre no texto de fallback e a variação nunca aparecia.
  const scores = await env.DB.prepare(
    `SELECT score, weights_version, components_json, calculated_at
       FROM todogreen_green_scores
      WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND scope_type = 'cliente'
      ORDER BY calculated_at DESC LIMIT 2`,
  )
    .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId)
    .all()
    .catch(() => null);

  const scoreRows = scores?.results || [];
  const score = scoreRows[0] || null;
  const scoreAnterior = scoreRows[1] || null;

  return {
    operacoes: {
      total: operacoes?.total || 0,
      entregas: operacoes?.entregas || 0,
      distanciaKm: operacoes?.km || 0,
      ocupacaoMedia: operacoes?.ocupacao || 0,
    },
    ambiental: {
      co2EvitadoKg: ambiental?.co2 || 0,
      dieselEvitadoL: ambiental?.diesel || 0,
      // A comparação de cenários do portal lê estes dois campos (antes vinham
      // sempre 0, então o bloco nunca renderizava).
      emissaoConvencionalKg: ambiental?.convencional || 0,
      emissaoTodogreenKg: ambiental?.realizado || 0,
      reducaoPercent: ambiental?.reducao || 0,
      qualidadeDados: ambiental?.qualidade || 0,
      calculos: ambiental?.calculos || 0,
    },
    greenScore: score
      ? {
          valor: score.score,
          versaoPesos: score.weights_version,
          calculadoEm: score.calculated_at,
          componentes: parse(score.components_json, {}),
          anterior: scoreAnterior ? scoreAnterior.score : null,
        }
      : null,
    // Sem dado é sem dado. A tela mostra convite para cadastrar, não número
    // bonito que ninguém pode auditar.
    semDados:
      !(operacoes?.total || 0) && !(ambiental?.calculos || 0) && !score,
  };
}
