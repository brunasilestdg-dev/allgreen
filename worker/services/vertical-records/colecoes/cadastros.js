// ===== Coleções dos cadastros de base do ERP =====
//
// Materiais, depósitos, partes, plano de contas e centros de custo (formato em
// ./descritor.js). CRUD puro e da empresa (`escopoDeCarteira: false`), com a
// validação de `erpCoreDomain.js`.

// A validação e a normalização dos cadastros vêm do domínio, não daqui: é a
// mesma regra que a tela aplica, e uma segunda cópia no worker seria a
// divergência entre o botão liberado e a resposta recusada.
import {
  normalizeDocument,
  normalizePartyRoles,
  normalizeSku,
  normalizeUnit,
  validateAccount,
  validateCostCenter,
  validateItem,
  validateParty,
  validateWarehouse,
} from "../../../../src/features/logistics/erpCoreDomain.js";
import { numero, objeto, parse, texto } from "../util.js";

export const COLECOES_DE_CADASTRO = {
  // ===== Cadastros de base do ERP (migração 0053) =====
  //
  // Os cinco entram pelo caminho genérico porque são CRUD puro: nenhum tem
  // efeito colateral, cálculo de saldo ou máquina de estados. O que tem regra
  // — movimento de estoque, apuração de imposto, fechamento de folha — ganha
  // handler próprio justamente por não caber aqui.
  //
  // Todos são `escopoDeCarteira: false`: cadastro da empresa não pertence à
  // carteira de vendedor nenhum, e a validação vem de `erpCoreDomain.js`, a
  // mesma que a tela usa — para o botão não liberar o que o servidor recusa.

  items: {
    tabela: "todogreen_items",
    permissao: "stock:manage",
    permissoesLeitura: ["stock:manage", "purchase:manage", "operations:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "name ASC",
    daLinha: (row) => ({
      id: row.id,
      codigo: row.code,
      nome: row.name,
      unidade: row.unit,
      categoria: row.category,
      ncm: row.ncm,
      cest: row.cest,
      custoReferencia: row.standard_cost,
      estoqueMinimo: row.min_stock,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      code: normalizeSku(corpo.codigo),
      name: texto(corpo.nome, 200),
      // A unidade já vem validada por `exigido`; normalizar de novo aqui evita
      // que "kg" e "KG" virem dois saldos do mesmo material.
      unit: normalizeUnit(corpo.unidade),
      category: texto(corpo.categoria, 120),
      ncm: texto(corpo.ncm, 8).replace(/\D+/g, ""),
      cest: texto(corpo.cest, 7).replace(/\D+/g, ""),
      standard_cost: Math.max(0, numero(corpo.custoReferencia)),
      min_stock: Math.max(0, numero(corpo.estoqueMinimo)),
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      validateItem({
        name: corpo.nome,
        unit: corpo.unidade,
        ncm: corpo.ncm,
        standardCost: corpo.custoReferencia,
        minStock: corpo.estoqueMinimo,
      }),
  },

  warehouses: {
    tabela: "todogreen_warehouses",
    permissao: "stock:manage",
    permissoesLeitura: ["stock:manage", "purchase:manage", "operations:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "name ASC",
    daLinha: (row) => ({
      id: row.id,
      codigo: row.code,
      nome: row.name,
      tipo: row.kind,
      veiculoId: row.vehicle_id,
      endereco: row.address,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      code: texto(corpo.codigo, 40).toUpperCase(),
      name: texto(corpo.nome, 200),
      kind: ["proprio", "terceiro", "veiculo", "transito"].includes(texto(corpo.tipo))
        ? texto(corpo.tipo)
        : "proprio",
      vehicle_id: texto(corpo.veiculoId, 120),
      address: texto(corpo.endereco, 400),
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      validateWarehouse({ name: corpo.nome, kind: corpo.tipo, vehicleId: corpo.veiculoId }),
  },

  parties: {
    tabela: "todogreen_parties",
    // Escrita é de compras: é quem cadastra fornecedor. A conta comercial
    // continua sendo escrita em `todogreen_clients`, com a carteira valendo lá.
    permissao: "purchase:manage",
    permissoesLeitura: ["purchase:manage", "finance:manage", "clients:manage", "audit:read"],
    // A parte tem `client_id`, mas o recorte de carteira aqui esconderia todo
    // fornecedor (client_id vazio) de operações e financeiro — exatamente de
    // quem precisa dele. O que é sensível por carteira (score, pipeline,
    // forecast, responsável) nunca esteve nesta tabela; aqui há só dado
    // cadastral e fiscal.
    escopoDeCarteira: false,
    ordem: "legal_name ASC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id,
      documento: row.document,
      razaoSocial: row.legal_name,
      nomeFantasia: row.trade_name,
      papeis: parse(row.roles_json, []),
      inscricaoEstadual: row.state_registration,
      inscricaoMunicipal: row.city_registration,
      regimeTributario: row.tax_regime,
      endereco: parse(row.address_json, {}),
      prazoPagamentoDias: row.payment_term_days,
      email: row.email,
      telefone: row.phone,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      // Só dígitos: duas grafias do mesmo CNPJ viram dois fornecedores, e o
      // índice único não pegaria porque as strings diferem.
      document: normalizeDocument(corpo.documento),
      legal_name: texto(corpo.razaoSocial, 240),
      trade_name: texto(corpo.nomeFantasia, 240),
      roles_json: JSON.stringify(normalizePartyRoles(corpo.papeis)),
      state_registration: texto(corpo.inscricaoEstadual, 40),
      city_registration: texto(corpo.inscricaoMunicipal, 40),
      tax_regime: texto(corpo.regimeTributario, 60),
      address_json: JSON.stringify(objeto(corpo.endereco)),
      payment_term_days: Math.max(0, Math.trunc(numero(corpo.prazoPagamentoDias))),
      email: texto(corpo.email, 200),
      phone: texto(corpo.telefone, 60),
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      validateParty({
        legalName: corpo.razaoSocial,
        roles: corpo.papeis,
        document: corpo.documento,
        paymentTermDays: corpo.prazoPagamentoDias,
      }),
  },

  accounts: {
    tabela: "todogreen_chart_of_accounts",
    permissao: "finance:manage",
    permissoesLeitura: ["finance:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "code ASC, name ASC",
    daLinha: (row) => ({
      id: row.id,
      codigo: row.code,
      nome: row.name,
      natureza: row.kind,
      paiId: row.parent_id,
      analitica: row.analytical === 1,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      code: texto(corpo.codigo, 40),
      name: texto(corpo.nome, 200),
      kind: ["receita", "despesa", "ativo", "passivo", "resultado"].includes(texto(corpo.natureza))
        ? texto(corpo.natureza)
        : "despesa",
      parent_id: texto(corpo.paiId, 120),
      analytical: corpo.analitica === false ? 0 : 1,
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validateAccount({ name: corpo.nome, kind: corpo.natureza }),
  },

  costCenters: {
    tabela: "todogreen_cost_centers",
    permissao: "finance:manage",
    permissoesLeitura: ["finance:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "code ASC, name ASC",
    daLinha: (row) => ({
      id: row.id,
      codigo: row.code,
      nome: row.name,
      paiId: row.parent_id,
      responsavelId: row.owner_user_id || "",
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      code: texto(corpo.codigo, 40),
      name: texto(corpo.nome, 200),
      parent_id: texto(corpo.paiId, 120),
      owner_user_id: texto(corpo.responsavelId, 120) || null,
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validateCostCenter({ name: corpo.nome }),
  },
};
