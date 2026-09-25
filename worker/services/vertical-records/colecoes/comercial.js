// ===== Coleções do comercial =====
//
// Oportunidades, comentários, interações, propostas e contratos (formato do
// descritor em ./descritor.js). Todas pertencem a um cliente e por isso levam
// o recorte de carteira (nenhuma declara `escopoDeCarteira: false`): vendedor
// lê e escreve só a própria carteira. Escrita: `crm:manage` (oportunidade,
// comentário, interação) e `proposal:manage` (proposta, contrato). As travas
// que dependem do banco — Deal Desk, viabilidade, Jurídico — ficam na esteira
// (`../crud.js` e `../gates.js`), não no descritor.

import { numero, objeto, parse, texto } from "../util.js";

// Campos da oportunidade que têm coluna própria. O que sobra é guardado como
// payload em vez de descartado — é ali que estão ocupação prevista, frota de
// baixa emissão, veículos disponíveis, meses de contrato e probabilidade, que
// a análise de oportunidade usa e esta tabela não precisa indexar.
const COLUNAS_DA_OPORTUNIDADE = new Set([
  "id", "clientId", "cliente", "clientName", "estagio", "stage",
  "valorMensal", "valorContrato", "distanciaKm", "viagensMes", "tipoVeiculo",
  "responsavelId", "ultimaInteracaoEm", "lastInteractionAt", "campos",
  "revision", "criadoEm", "atualizadoEm",
]);

const extrasDaOportunidade = (corpo) =>
  Object.fromEntries(
    Object.entries(corpo).filter(
      ([chave, valor]) => !COLUNAS_DA_OPORTUNIDADE.has(chave) && valor !== undefined,
    ),
  );

// Tipos de interação aceitos. Um tipo desconhecido vira "reuniao" em vez de
// entrar cru: a coluna é filtrada e somada, e lixo nela quebra o corte.
const TIPOS_DE_INTERACAO = new Set([
  "reuniao", "ligacao", "email", "visita", "whatsapp", "tentativa", "proposta", "outro",
]);

export const COLECOES_COMERCIAIS = {
  opportunities: {
    tabela: "todogreen_opportunities",
    permissao: "crm:manage",
    permissoesLeitura: ["crm:manage", "clients:manage", "audit:read"],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      // O que não tem coluna própria volta primeiro, e as colunas mandam por
      // cima. A tela de oportunidades manda mais campos do que esta tabela
      // indexa — ocupação prevista, frota limpa, veículos disponíveis, meses
      // de contrato, probabilidade — e todos alimentam a análise. Descartá-los
      // no caminho faria a oportunidade voltar do servidor mais pobre do que
      // saiu, com a análise mudando sozinha depois de recarregar a página.
      ...parse(row.fields_json, {}),
      id: row.id,
      clientId: row.client_id,
      // O negócio tem nome próprio desde a 0081. Sem ele, uma conta com três
      // frentes abertas devolvia três registros indistinguíveis.
      titulo: row.title || "",
      cliente: row.client_name,
      estagio: row.stage,
      valorMensal: row.monthly_value,
      valorContrato: row.contract_value,
      distanciaKm: row.distance_km,
      viagensMes: row.trips_per_month,
      tipoVeiculo: row.vehicle_type,
      responsavelId: row.owner_user_id || "",
      ultimaInteracaoEm: row.last_interaction_at || "",
      // O motor de oportunidade lê `lastInteractionAt`. Devolver os dois nomes
      // evita um adaptador a mais entre a API e o domínio.
      lastInteractionAt: row.last_interaction_at || "",
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      title: texto(corpo.titulo || corpo.title, 200),
      client_name: texto(corpo.cliente || corpo.clientName, 200),
      stage: texto(corpo.estagio || corpo.stage, 60) || "Prospecção",
      monthly_value: numero(corpo.valorMensal),
      contract_value: numero(corpo.valorContrato),
      distance_km: numero(corpo.distanciaKm),
      trips_per_month: numero(corpo.viagensMes),
      vehicle_type: texto(corpo.tipoVeiculo, 120),
      owner_user_id: texto(corpo.responsavelId, 120) || null,
      last_interaction_at: texto(corpo.ultimaInteracaoEm || corpo.lastInteractionAt, 40) || null,
      fields_json: JSON.stringify({ ...objeto(corpo.campos), ...extrasDaOportunidade(corpo) }),
    }),
    exigido: (corpo) => (texto(corpo.cliente || corpo.clientName) ? "" : "Informe o cliente da oportunidade."),
  },

  // Comentários do comercial (0078). A regra de alcance da titular mora nos
  // dois campos: clientId sem opportunityId = comentário da conta, visível em
  // todas as oportunidades dela; opportunityId preenchido = fica só naquela
  // oportunidade. Quem escreve oportunidade escreve comentário — as mesmas
  // permissões.
  comments: {
    tabela: "todogreen_crm_comments",
    permissao: "crm:manage",
    permissoesLeitura: ["crm:manage", "clients:manage", "audit:read"],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id || "",
      opportunityId: row.opportunity_id || "",
      comentario: row.body,
      autorEmail: row.author_email || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      opportunity_id: texto(corpo.opportunityId, 120),
      body: texto(corpo.comentario || corpo.body, 4000),
      author_email: texto(corpo.autorEmail, 200),
    }),
    exigido: (corpo) => {
      if (!texto(corpo.comentario || corpo.body)) return "Escreva o comentário.";
      if (!texto(corpo.clientId) && !texto(corpo.opportunityId))
        return "Vincule o comentário a uma conta ou a uma oportunidade.";
      return "";
    },
  },

  // Interações do comercial (0079): reunião com ata, ligação, e-mail, visita,
  // WhatsApp, proposta enviada e TENTATIVA de contato — a tentativa que não deu
  // certo também é registro, é ela que mostra o cliente que não retorna.
  // Mesma regra de alcance dos comentários: conta espelha nas oportunidades
  // dela, oportunidade fica só nela.
  interactions: {
    tabela: "todogreen_crm_interactions",
    permissao: "crm:manage",
    permissoesLeitura: ["crm:manage", "clients:manage", "audit:read"],
    ordem: "occurred_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id || "",
      opportunityId: row.opportunity_id || "",
      tipo: row.kind || "reuniao",
      assunto: row.subject || "",
      ata: row.notes || "",
      participantes: row.participants || "",
      resultado: row.outcome || "",
      proximoPasso: row.next_step || "",
      ocorridaEm: row.occurred_at || "",
      proximoPassoEm: row.next_step_at || "",
      autorEmail: row.author_email || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      opportunity_id: texto(corpo.opportunityId, 120),
      kind: TIPOS_DE_INTERACAO.has(texto(corpo.tipo)) ? texto(corpo.tipo) : "reuniao",
      subject: texto(corpo.assunto, 200),
      notes: texto(corpo.ata, 8000),
      participants: texto(corpo.participantes, 500),
      outcome: texto(corpo.resultado, 300),
      next_step: texto(corpo.proximoPasso, 500),
      occurred_at: texto(corpo.ocorridaEm, 40),
      next_step_at: texto(corpo.proximoPassoEm, 40),
      author_email: texto(corpo.autorEmail, 200),
    }),
    exigido: (corpo) => {
      if (!texto(corpo.clientId) && !texto(corpo.opportunityId))
        return "Vincule a interação a uma conta ou a uma oportunidade.";
      if (!texto(corpo.assunto) && !texto(corpo.ata))
        return "Escreva o assunto ou a ata da interação.";
      if (!texto(corpo.ocorridaEm)) return "Informe quando a interação aconteceu.";
      return "";
    },
  },

  proposals: {
    tabela: "todogreen_proposals",
    permissao: "proposal:manage",
    permissoesLeitura: ["proposal:create", "proposal:manage", "deal:review", "deal:approve", "audit:read"],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id,
      cliente: row.client_name,
      oportunidadeId: row.opportunity_id,
      cenarioId: row.scenario_id,
      titulo: row.title,
      escopo: row.scope,
      condicoes: row.commercial_terms,
      riscos: row.risks,
      texto: row.proposal_text,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      client_name: texto(corpo.cliente || corpo.clientName, 200),
      opportunity_id: texto(corpo.oportunidadeId, 120),
      scenario_id: texto(corpo.cenarioId, 120),
      title: texto(corpo.titulo, 240),
      scope: texto(corpo.escopo, 4000),
      commercial_terms: texto(corpo.condicoes, 4000),
      risks: texto(corpo.riscos, 4000),
      proposal_text: texto(corpo.texto, 8000),
      status: texto(corpo.situacao, 40) || "draft",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    // Uma proposta sem simulação por trás é preço sem conta. O vínculo é
    // exigido aqui, no servidor, e não só no botão da tela.
    exigido: (corpo) =>
      texto(corpo.cenarioId)
        ? ""
        : "A proposta precisa apontar para a simulação que gerou o preço.",
  },

  contracts: {
    tabela: "todogreen_contracts",
    permissao: "proposal:manage",
    permissoesLeitura: ["proposal:manage", "deal:review", "deal:approve", "audit:read"],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id,
      cliente: row.client_name,
      oportunidadeId: row.opportunity_id,
      propostaId: row.proposal_id,
      cenarioId: row.scenario_id,
      titulo: row.title,
      inicioEm: row.start_date || "",
      fimEm: row.end_date || "",
      valorMensal: row.monthly_value,
      valorTotal: row.total_value,
      situacao: row.status,
      termos: row.terms,
      assinatura: row.signature_status || "pending",
      assinadoEm: row.signed_at || "",
      renovacao: row.renewal_type || "manual",
      avisoRenovacaoEm: row.renewal_notice_date || "",
      diaFaturamento: row.billing_day || null,
      responsavelId: row.responsible_user_id || "",
      antecedenciaAvisoDias: row.notice_days || 60,
      versao: row.version || 1,
      servicoId: row.service_id || "",
      tabelaPrecoId: row.price_table_id || "",
      sla: parse(row.sla_json, {}),
      condicoesComerciais: parse(row.commercial_terms_json, {}),
      impostos: parse(row.taxes_json, {}),
      regrasFaturamento: parse(row.billing_rules_json, {}),
      indiceReajuste: row.adjustment_index || "",
      dataBaseReajuste: row.adjustment_base_date || "",
      compromissoMinimo: row.minimum_commitment || 0,
      aprovacao: row.approval_status || "pending",
      aprovadoPor: row.approved_by || "",
      aprovadoEm: row.approved_at || "",
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      client_name: texto(corpo.cliente || corpo.clientName, 200),
      opportunity_id: texto(corpo.oportunidadeId, 120),
      proposal_id: texto(corpo.propostaId, 120),
      scenario_id: texto(corpo.cenarioId, 120),
      title: texto(corpo.titulo, 240),
      start_date: texto(corpo.inicioEm, 20) || null,
      end_date: texto(corpo.fimEm, 20) || null,
      monthly_value: numero(corpo.valorMensal),
      total_value: numero(corpo.valorTotal),
      status: texto(corpo.situacao, 40) || "draft",
      terms: texto(corpo.termos, 8000),
      signature_status: ["pending", "sent", "signed", "rejected", "expired"].includes(texto(corpo.assinatura, 40))
        ? texto(corpo.assinatura, 40) : "pending",
      signed_at: texto(corpo.assinadoEm, 40) || null,
      renewal_type: ["manual", "automatic", "none"].includes(texto(corpo.renovacao, 40))
        ? texto(corpo.renovacao, 40) : "manual",
      renewal_notice_date: texto(corpo.avisoRenovacaoEm, 20) || null,
      billing_day: Math.min(31, Math.max(1, Math.trunc(numero(corpo.diaFaturamento)))) || null,
      responsible_user_id: texto(corpo.responsavelId, 120) || null,
      notice_days: Math.min(365, Math.max(0, Math.trunc(numero(corpo.antecedenciaAvisoDias) || 60))),
      service_id: texto(corpo.servicoId, 120),
      price_table_id: texto(corpo.tabelaPrecoId, 120),
      sla_json: JSON.stringify(objeto(corpo.sla)),
      commercial_terms_json: JSON.stringify(objeto(corpo.condicoesComerciais)),
      taxes_json: JSON.stringify(objeto(corpo.impostos)),
      billing_rules_json: JSON.stringify(objeto(corpo.regrasFaturamento)),
      adjustment_index: texto(corpo.indiceReajuste, 80),
      adjustment_base_date: texto(corpo.dataBaseReajuste, 20) || null,
      minimum_commitment: Math.max(0, numero(corpo.compromissoMinimo)),
      approval_status: ["pending", "approved", "rejected"].includes(texto(corpo.aprovacao, 40))
        ? texto(corpo.aprovacao, 40) : "pending",
      approved_by: texto(corpo.aprovadoPor, 120) || null,
      approved_at: texto(corpo.aprovadoEm, 40) || null,
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      !texto(corpo.clientId)
        ? "O contrato precisa de um cliente."
        : !texto(corpo.propostaId)
          ? "O contrato precisa apontar para a proposta aceita."
          : !texto(corpo.titulo)
            ? "Informe o título do contrato."
            : "",
  },
};
