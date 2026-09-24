// ===== Coleções da Central de RFQ e RFI =====
//
// Acervo de habilitação, kits e o ciclo do pedido (formato em ./descritor.js).
// Nenhuma grava status: o semáforo é derivado na leitura. Acervo e kits são da
// empresa (`escopoDeCarteira: false`, escrita `compliance:manage`); o RFQ é de
// um cliente (recorte de carteira, escrita `crm:manage`).

import {
  categoriaValida as categoriaDeHabilitacaoValida,
  doCatalogo as doCatalogoDeHabilitacao,
  etapaDoRfqValida,
} from "../../../../src/features/logistics/habilitacaoDomain.js";
import { numero, parse, texto } from "../util.js";

export const COLECOES_DA_CENTRAL_RFQ = {
  // ===== Central de RFQ e RFI =====
  //
  // Três coleções: o acervo de habilitação, os kits e o ciclo do pedido.
  //
  // Nenhuma delas grava STATUS. O semáforo do documento e a prontidão do kit
  // são derivados na leitura (`habilitacaoDomain.js`), sempre contra a data de
  // hoje — status gravado é status que envelhece calado, e o preço disso é
  // mandar ao comprador uma apólice vencida confiando na etiqueta.
  //
  // O acervo é da EMPRESA, não da carteira de ninguém: `escopoDeCarteira: false`.
  habilitacao: {
    tabela: "todogreen_habilitacao_documentos",
    permissao: "compliance:manage",
    permissoesLeitura: [
      "compliance:manage", "crm:manage", "clients:manage", "proposal:manage",
      "operations:manage", "finance:manage", "audit:read",
    ],
    escopoDeCarteira: false,
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      tipo: row.doc_type || "",
      categoria: row.category || "societario",
      titulo: row.title || "",
      numero: row.numero || "",
      orgao: row.orgao || "",
      unidade: row.unidade || "EMPRESA",
      cnpj: row.cnpj || "",
      emitidoEm: row.issued_at || "",
      venceEm: row.expires_at || "",
      permanente: Number(row.permanente || 0) === 1,
      diasAceitaveis: Number(row.dias_aceitaveis || 0),
      arquivoId: row.arquivo_id || "",
      arquivoUrl: row.arquivo_url || "",
      arquivoNome: row.arquivo_nome || "",
      observacao: row.observacao || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => {
      const tipo = texto(corpo.tipo, 80).toUpperCase();
      const definicao = doCatalogoDeHabilitacao(tipo);
      const permanente = corpo.permanente === undefined
        ? Boolean(definicao?.permanente)
        : Boolean(corpo.permanente);
      return {
        doc_type: tipo,
        category: categoriaDeHabilitacaoValida(corpo.categoria || definicao?.categoria),
        title: texto(corpo.titulo, 200) || definicao?.titulo || tipo,
        numero: texto(corpo.numero, 120),
        orgao: texto(corpo.orgao, 160) || texto(definicao?.orgao, 160),
        unidade: texto(corpo.unidade, 60).toUpperCase() || "EMPRESA",
        cnpj: texto(corpo.cnpj, 30),
        issued_at: texto(corpo.emitidoEm, 10),
        // Documento permanente não guarda vencimento: guardar os dois deixaria
        // a tela ter que escolher qual acreditar.
        expires_at: permanente ? "" : texto(corpo.venceEm, 10),
        permanente: permanente ? 1 : 0,
        dias_aceitaveis: numero(corpo.diasAceitaveis) || numero(definicao?.diasAceitaveis),
        arquivo_id: texto(corpo.arquivoId, 120),
        arquivo_url: texto(corpo.arquivoUrl, 1000),
        arquivo_nome: texto(corpo.arquivoNome, 300),
        observacao: texto(corpo.observacao, 2000),
      };
    },
    exigido: (corpo) => {
      if (!texto(corpo.tipo)) return "Escolha o tipo do documento.";
      if (!texto(corpo.titulo) && !doCatalogoDeHabilitacao(texto(corpo.tipo, 80).toUpperCase()))
        return "Dê um título ao documento.";
      if (!corpo.permanente && !texto(corpo.emitidoEm) && !texto(corpo.venceEm))
        return "Informe a emissão ou o vencimento — sem data não há semáforo, e sem semáforo o documento vence calado.";
      return "";
    },
  },

  habilitacaoKits: {
    tabela: "todogreen_habilitacao_kits",
    permissao: "compliance:manage",
    permissoesLeitura: [
      "compliance:manage", "crm:manage", "clients:manage", "proposal:manage", "audit:read",
    ],
    escopoDeCarteira: false,
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      chave: row.kit_key || "",
      nome: row.nome || "",
      descricao: row.descricao || "",
      tipos: parse(row.tipos_json, []) || [],
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      kit_key: texto(corpo.chave, 60).toLowerCase(),
      nome: texto(corpo.nome, 160),
      descricao: texto(corpo.descricao, 500),
      tipos_json: JSON.stringify(
        (Array.isArray(corpo.tipos) ? corpo.tipos : [])
          .map((item) => texto(item, 80).toUpperCase())
          .filter(Boolean)
          .slice(0, 80),
      ),
    }),
    exigido: (corpo) => {
      if (!texto(corpo.nome)) return "Dê um nome ao kit.";
      if (!Array.isArray(corpo.tipos) || !corpo.tipos.length)
        return "Um kit vazio não anexa nada — escolha os documentos que ele reúne.";
      return "";
    },
  },

  rfq: {
    tabela: "todogreen_rfq_pedidos",
    permissao: "crm:manage",
    permissoesLeitura: [
      "crm:manage", "clients:manage", "proposal:manage", "compliance:manage", "audit:read",
    ],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id || "",
      cliente: row.client_name || "",
      opportunityId: row.opportunity_id || "",
      titulo: row.titulo || "",
      etapa: row.etapa || "recebido",
      canal: row.canal || "",
      solicitante: row.solicitante || "",
      pedido: row.pedido || "",
      kit: row.kit_key || "",
      prazo: row.prazo || "",
      enviadoEm: row.enviado_em || "",
      enviados: parse(row.enviados_json, []) || [],
      resultadoEm: row.resultado_em || "",
      motivo: row.motivo || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      client_name: texto(corpo.cliente, 200),
      opportunity_id: texto(corpo.opportunityId, 120),
      titulo: texto(corpo.titulo, 200),
      etapa: etapaDoRfqValida(corpo.etapa),
      canal: texto(corpo.canal, 120),
      solicitante: texto(corpo.solicitante, 200),
      // O texto do pedido entra CRU, sem resumir: é o que responde "mandaram o
      // quê mesmo?" três meses depois.
      pedido: texto(corpo.pedido, 8000),
      kit_key: texto(corpo.kit, 60).toLowerCase(),
      prazo: texto(corpo.prazo, 10),
      enviado_em: texto(corpo.enviadoEm, 30),
      enviados_json: JSON.stringify(
        (Array.isArray(corpo.enviados) ? corpo.enviados : [])
          .map((item) => texto(item, 300))
          .filter(Boolean)
          .slice(0, 120),
      ),
      resultado_em: texto(corpo.resultadoEm, 30),
      motivo: texto(corpo.motivo, 2000),
    }),
    exigido: (corpo) => {
      if (!texto(corpo.titulo)) return "Diga do que é este RFQ.";
      if (!texto(corpo.clientId) && !texto(corpo.cliente)) return "Informe de quem veio o pedido.";
      // Fechar sem motivo joga fora a única inteligência comercial que um ano
      // de cotações produz.
      if (["ganho", "perdido", "sem-resposta"].includes(etapaDoRfqValida(corpo.etapa)) && !texto(corpo.motivo))
        return "Registre o motivo do resultado — é o que vira material de inteligência comercial.";
      return "";
    },
  },
};
