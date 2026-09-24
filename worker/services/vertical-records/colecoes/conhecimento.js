// ===== Coleção do dossiê do negócio =====
//
// O que o Plantû sabe da To Do Green (formato em ./descritor.js). É da empresa
// (`escopoDeCarteira: false`); escrever exige `business:teach` e ler é aberto
// às capacidades listadas em `permissoesLeitura`.

import { normalizarFato } from "../../../../src/features/logistics/businessContextDomain.js";
import { texto } from "../util.js";

export const COLECOES_DO_CONHECIMENTO = {
  // ===== O dossiê do próprio negócio =====
  //
  // É o que o Plantû lê antes de responder qualquer coisa sobre a To Do Green.
  // Escrever exige `admin:manage` de propósito: quem edita isto muda o que o
  // assistente afirma para todo mundo do espaço, inclusive dentro de proposta.
  // Ler é aberto a quem já entra na vertical — um vendedor precisa saber a
  // história da casa para responder um RFI sem inventar.
  businessContext: {
    tabela: "todogreen_business_context",
    permissao: "business:teach",
    // O dossiê é da EMPRESA, não da carteira de ninguém. Sem isto, o recorte
    // de carteira procuraria `client_id` numa tabela que não tem essa coluna e
    // a vendedora receberia 500 ao abrir a tela.
    escopoDeCarteira: false,
    permissoesLeitura: [
      "business:teach", "crm:manage", "clients:manage", "proposal:manage",
      "operations:manage", "finance:manage", "audit:read",
    ],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      chave: row.fact_key || "",
      categoria: row.category || "identidade",
      titulo: row.title || "",
      conteudo: row.content || "",
      fonte: row.source || "",
      vigenteEm: row.effective_at || "",
      sigilo: row.secrecy || "interno",
      origem: row.origin || "cadastrado",
      fixado: Number(row.pinned || 0) === 1,
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => {
      const fato = normalizarFato(corpo);
      return {
        fact_key: fato.chave,
        category: fato.categoria,
        title: fato.titulo,
        content: fato.conteudo,
        source: fato.fonte,
        effective_at: fato.vigenteEm,
        secrecy: fato.sigilo,
        origin: fato.origem,
        pinned: fato.fixado ? 1 : 0,
      };
    },
    exigido: (corpo) => {
      if (!texto(corpo.titulo || corpo.title)) return "Dê um título ao que a IA precisa saber.";
      if (texto(corpo.conteudo || corpo.content, 8000).length < 10)
        return "Escreva o que a IA precisa saber sobre esse ponto.";
      return "";
    },
  },
};
