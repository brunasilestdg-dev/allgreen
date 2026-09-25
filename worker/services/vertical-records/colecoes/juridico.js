// ===== Coleção do Jurídico =====
//
// Documentos jurídicos — a fonte que `juridicoConcluido` e
// `documentoDeAssinaturaVinculado` (`../gates.js`) leem (formato em
// ./descritor.js). Da operação inteira (`escopoDeCarteira: false`); leitura e
// escrita por `proposal:manage`. O vai-e-volta do documento é de `../eventos.js`.

import {
  normalizarRisco,
  normalizarSituacaoJuridica,
  normalizarTipoJuridico,
  validarDocumentoJuridico,
} from "../../../../src/features/logistics/legalDomain.js";
import { objeto, parse, texto } from "../util.js";

export const COLECOES_JURIDICAS = {
  // Jurídico: minutas, contratos, aditivos e afins com risco, vigência e
  // situação. Não é escopo de carteira — o Jurídico enxerga a operação inteira.
  legal: {
    tabela: "todogreen_legal_records",
    permissao: "proposal:manage",
    escopoDeCarteira: false,
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      titulo: row.title,
      clientId: row.client_id || "",
      contraparte: row.counterparty || "",
      tipo: row.kind,
      risco: row.risk,
      inicioVigencia: row.effective_start || "",
      fimVigencia: row.effective_end || "",
      responsavelId: row.owner_user_id || "",
      observacoes: row.notes || "",
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      title: texto(corpo.titulo || corpo.title, 240),
      client_id: texto(corpo.clientId, 120),
      counterparty: texto(corpo.contraparte || corpo.counterparty, 240),
      kind: normalizarTipoJuridico(texto(corpo.tipo || corpo.kind, 40)),
      risk: normalizarRisco(texto(corpo.risco || corpo.risk, 40)),
      effective_start: texto(corpo.inicioVigencia || corpo.effectiveStart, 40) || null,
      effective_end: texto(corpo.fimVigencia || corpo.effectiveEnd, 40) || null,
      owner_user_id: texto(corpo.responsavelId, 120) || null,
      notes: texto(corpo.observacoes || corpo.notes, 4000),
      status: normalizarSituacaoJuridica(texto(corpo.situacao || corpo.status, 40)),
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validarDocumentoJuridico({ titulo: corpo.titulo || corpo.title }),
  },
};
