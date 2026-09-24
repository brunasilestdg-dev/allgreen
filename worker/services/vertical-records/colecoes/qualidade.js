// ===== Coleção da qualidade =====
//
// Não conformidades (formato em ./descritor.js). Da operação inteira
// (`escopoDeCarteira: false`); leitura e escrita por `operations:manage`.

import {
  normalizarGravidade,
  normalizarSituacaoQualidade,
  normalizarTipo,
  validarNaoConformidade,
} from "../../../../src/features/logistics/qualityDomain.js";
import { objeto, parse, texto } from "../util.js";

export const COLECOES_DE_QUALIDADE = {
  // Qualidade: não conformidades com causa raiz, plano de ação, dono e prazo.
  // Não é escopo de carteira — Qualidade enxerga a operação inteira, não só a
  // carteira de um vendedor.
  quality: {
    tabela: "todogreen_quality_records",
    permissao: "operations:manage",
    escopoDeCarteira: false,
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      titulo: row.title,
      clientId: row.client_id || "",
      operacaoId: row.operation_id || "",
      tipo: row.kind,
      gravidade: row.severity,
      causaRaiz: row.root_cause || "",
      planoAcao: row.action_plan || "",
      responsavelId: row.owner_user_id || "",
      prazo: row.due_date || "",
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      title: texto(corpo.titulo || corpo.title, 240),
      client_id: texto(corpo.clientId, 120),
      operation_id: texto(corpo.operacaoId, 120),
      kind: normalizarTipo(texto(corpo.tipo || corpo.kind, 40)),
      severity: normalizarGravidade(texto(corpo.gravidade || corpo.severity, 40)),
      root_cause: texto(corpo.causaRaiz || corpo.rootCause, 2000),
      action_plan: texto(corpo.planoAcao || corpo.actionPlan, 2000),
      owner_user_id: texto(corpo.responsavelId, 120) || null,
      due_date: texto(corpo.prazo || corpo.dueDate, 40) || null,
      status: normalizarSituacaoQualidade(texto(corpo.situacao || corpo.status, 40)),
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validarNaoConformidade({ titulo: corpo.titulo || corpo.title }),
  },
};
