// ===== Coleções do financeiro =====
//
// Lançamentos do razão e contas bancárias (formato em ./descritor.js).
// Escrita: `finance:manage`. O lançamento leva recorte de carteira; a conta
// bancária é da empresa. Baixa, estorno e trava de competência não são CRUD:
// moram em `../pagamentos.js` e `../gates.js`.

import { validateBankAccount } from "../../../../src/features/logistics/treasuryDomain.js";
import { numero, objeto, parse, texto } from "../util.js";

export const COLECOES_FINANCEIRAS = {
  financial: {
    tabela: "todogreen_financial_entries",
    permissao: "finance:manage",
    permissoesLeitura: ["finance:manage", "revenue:manage", "cost:manage", "commission:manage", "audit:read"],
    ordem: "reference_month DESC, updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      tipo: row.kind,
      clientId: row.client_id,
      produtoId: row.product_id,
      cenarioId: row.scenario_id,
      categoria: row.category,
      descricao: row.description,
      valor: row.amount,
      mesReferencia: row.reference_month,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      vencimentoEm: row.due_date || "",
      pagoEm: row.paid_at || "",
      valorPago: row.paid_amount || 0,
      contraparte: row.counterparty || "",
      // Contraparte por referência (costura 4): o id da parte é o que concilia
      // com o fornecedor do pedido; `contraparte` fica como rótulo legível.
      partyId: row.party_id || "",
      numeroDocumento: row.document_number || "",
      centroCusto: row.cost_center || "",
      codigoOrcamento: row.budget_code || "",
      meioPagamento: row.payment_method || "",
      competenciaEm: row.competence_date || "",
      contratoId: row.contract_id || "",
      statusFinanceiro: row.invoice_status || "pending",
      // Eixos do relatório (migração 0056). As colunas de texto `categoria` e
      // `centroCusto` continuam valendo como detalhe livre; estas apontam para o
      // cadastro e é por elas que o relatório soma sem depender de grafia.
      accountId: row.account_id || "",
      costCenterId: row.cost_center_id || "",
      bankAccountId: row.bank_account_id || "",
      multaPercent: row.late_fee_percent || 0,
      jurosMesPercent: row.late_interest_month_percent || 0,
      conciliadoEm: row.reconciled_at || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      kind: ["revenue", "cost", "commission"].includes(texto(corpo.tipo)) ? texto(corpo.tipo) : "cost",
      client_id: texto(corpo.clientId, 120),
      product_id: texto(corpo.produtoId, 120),
      scenario_id: texto(corpo.cenarioId, 120),
      category: texto(corpo.categoria, 120),
      description: texto(corpo.descricao, 500),
      amount: numero(corpo.valor),
      reference_month: texto(corpo.mesReferencia, 10),
      status: texto(corpo.situacao, 40) || "confirmed",
      due_date: texto(corpo.vencimentoEm, 20) || null,
      paid_at: texto(corpo.pagoEm, 40) || null,
      paid_amount: Math.max(0, numero(corpo.valorPago)),
      counterparty: texto(corpo.contraparte, 200),
      party_id: texto(corpo.partyId, 120),
      document_number: texto(corpo.numeroDocumento, 120),
      cost_center: texto(corpo.centroCusto, 120),
      budget_code: texto(corpo.codigoOrcamento, 120),
      payment_method: texto(corpo.meioPagamento, 80),
      competence_date: texto(corpo.competenciaEm, 20) || null,
      contract_id: texto(corpo.contratoId, 120),
      invoice_status: ["pending", "partial", "paid", "overdue", "cancelled"].includes(texto(corpo.statusFinanceiro, 40))
        ? texto(corpo.statusFinanceiro, 40) : "pending",
      account_id: texto(corpo.accountId, 120),
      cost_center_id: texto(corpo.costCenterId, 120),
      bank_account_id: texto(corpo.bankAccountId, 120),
      // Percentual negativo não gera crédito; o encargo do atraso só pode
      // aumentar o que se deve.
      late_fee_percent: Math.max(0, numero(corpo.multaPercent)),
      late_interest_month_percent: Math.max(0, numero(corpo.jurosMesPercent)),
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      ["revenue", "cost", "commission"].includes(texto(corpo.tipo))
        ? numero(corpo.valor) > 0
          ? ""
          : "Informe o valor do lançamento."
        : "Informe se o lançamento é receita, custo ou comissão.",
  },

  // Conta bancária é CRUD puro; o que tem regra — importar extrato, conciliar,
  // fechar período — mora em `todogreen-treasury.js`. O saldo NÃO fica aqui:
  // `opening_balance` é o saldo inicial (premissa), e o saldo de hoje é ele mais
  // o que foi conciliado, calculado por `saldoDaConta`.
  bankAccounts: {
    tabela: "todogreen_treasury_accounts",
    permissao: "finance:manage",
    permissoesLeitura: ["finance:manage"],
    escopoDeCarteira: false,
    ordem: "name ASC",
    daLinha: (row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      bancoCodigo: row.bank_code,
      agencia: row.branch,
      conta: row.account_number,
      chavePix: row.pix_key,
      saldoInicial: row.opening_balance,
      aberturaEm: row.opening_date || "",
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      name: texto(corpo.name ?? corpo.nome, 200),
      kind: ["corrente", "poupanca", "caixa", "aplicacao", "cartao"].includes(texto(corpo.kind))
        ? texto(corpo.kind)
        : "corrente",
      bank_code: texto(corpo.bancoCodigo, 20),
      branch: texto(corpo.agencia, 20),
      account_number: texto(corpo.conta, 40),
      pix_key: texto(corpo.chavePix, 200),
      // Saldo inicial pode ser negativo: conta com limite usado começa no
      // vermelho, e forçar zero mentiria sobre a posição de caixa.
      opening_balance: numero(corpo.saldoInicial),
      opening_date: texto(corpo.aberturaEm, 20) || null,
      status: texto(corpo.situacao, 40) || "ativa",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validateBankAccount({ name: corpo.name ?? corpo.nome, kind: corpo.kind }),
  },
};
