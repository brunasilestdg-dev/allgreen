// Os dados da vertical montados a partir da API — JS puro, sem React. Os
// cenários de demonstração moram aqui porque só `montarDadosDaVertical` os
// usa (e só com o modo demonstração ligado).
import { TODO_GREEN_TENANT, createPricingScenarioSnapshot } from "../logisticsVerticalDomain.js";
import { cenarioConfirmado } from "../pricingPremisesDomain.js";
import { demoModeEnabled } from "./acesso.js";

const seedScenario = createPricingScenarioSnapshot(
  "middle-mile",
  {
    client: "Demonstração Middle Mile",
    clientId: "demo-middle-mile",
    origin: "CD exemplo",
    destination: "Hub exemplo",
    distanceKm: 86,
    tripsPerMonth: 44,
    vehicleType: "VUC elétrico",
    pallets: 12,
    weightKg: 3200,
    waitingHours: 1.5,
    tollCost: 42,
    customerTargetPrice: 72000,
    occupancyPercent: 78,
    dataQuality: 82,
  },
  { userId: "demo", tenantId: TODO_GREEN_TENANT.id, justification: "Dado demonstrativo; não usar como produção." },
);

const seedLastMile = createPricingScenarioSnapshot(
  "last-mile",
  {
    client: "Demonstração Last Mile",
    clientId: "demo-last-mile",
    city: "São Paulo",
    packages: 9600,
    routesPerDay: 18,
    daysPerMonth: 22,
    kmPerRoute: 62,
    vehicleType: "Furgão elétrico",
    stops: 7200,
    successRate: 93,
    customerTargetPrice: 142000,
    occupancyPercent: 81,
    dataQuality: 76,
  },
  { userId: "demo", tenantId: TODO_GREEN_TENANT.id, justification: "Dado demonstrativo; não usar como produção." },
);

// ===== Os dados da vertical, vindos de um lugar só =====
//
// Esta função montava a vertical a partir do `db` — o JSON do espaço de
// trabalho — enquanto clientes, ESG, Tracker e portal já vinham da API. Duas
// fontes para a mesma vertical davam painel somando coisas diferentes, portal
// cego para o que foi escrito por dentro, e sobrescrita entre pessoas do mesmo
// espaço.
//
// Agora tudo vem de `/api/todogreen/records`. Do `db` sobra só o que é do
// produto inteiro e não da vertical: tarefas e caixa de entrada.
//
// A tradução de nomes acontece aqui, num lugar só. O motor de resumo fala
// inglês desde a origem e a API fala português como o resto da vertical;
// espalhar essa conversão pelos painéis é o que faz dois lugares somarem
// campos diferentes com o mesmo nome.
const financeiroDaApi = (item) => ({
  id: item.id,
  kind: item.tipo,
  amount: item.valor,
  clientId: item.clientId,
  productId: item.produtoId,
  category: item.categoria,
  status: item.situacao,
  note: item.descricao,
  referenceMonth: item.mesReferencia,
  dueDate: item.vencimentoEm,
  paidAt: item.pagoEm,
  paidAmount: item.valorPago,
  counterparty: item.contraparte,
  documentNumber: item.numeroDocumento,
  costCenter: item.centroCusto,
  budgetCode: item.codigoOrcamento,
  paymentMethod: item.meioPagamento,
  competenceDate: item.competenciaEm,
  contractId: item.contratoId,
  invoiceStatus: item.statusFinanceiro,
  revision: item.revision,
  createdAt: item.criadoEm,
});

const operacaoDaApi = (item) => ({
  id: item.id,
  clientId: item.clientId,
  productId: item.produtoId,
  deliveries: item.entregas,
  packages: item.pacotes,
  trips: item.viagens,
  distanceKm: item.distanciaKm,
  occupancyPercent: item.ocupacaoPercent,
  status: item.situacao,
  route: item.referencia || item.campos?.route || "",
  referencia: item.referencia || item.campos?.route || "",
  contratoId: item.contratoId,
  dataServico: item.dataServico,
  origem: item.origem,
  destino: item.destino,
  prometidoEm: item.prometidoEm,
  entregueEm: item.entregueEm,
  etaEm: item.etaEm,
  placa: item.placa,
  motorista: item.motorista,
  sla: item.sla,
  comprovanteUrl: item.comprovanteUrl,
  ultimaPosicaoEm: item.ultimaPosicaoEm,
  mesReferencia: item.mesReferencia || String(item.criadoEm || "").slice(0, 7),
  produtoId: item.produtoId,
  entregas: item.entregas,
  pacotes: item.pacotes,
  viagens: item.viagens,
  distanciaKm: item.distanciaKm,
  ocupacaoPercent: item.ocupacaoPercent,
  incidents: Number(item.ocorrencias || 0),
  ocorrencias: Number(item.ocorrencias || 0),
  revision: item.revision,
  createdAt: item.criadoEm,
});

const propostaDaApi = (item) => ({
  id: item.id,
  clientId: item.clientId,
  client: item.cliente,
  opportunityId: item.oportunidadeId,
  title: item.titulo,
  scope: item.escopo,
  commercialTerms: item.condicoes,
  risks: item.riscos,
  proposalText: item.texto,
  scenarioId: item.cenarioId,
  status: item.situacao,
  revision: item.revision,
  createdAt: item.criadoEm,
});

const contratoDaApi = (item) => ({
  id: item.id,
  clientId: item.clientId,
  client: item.cliente,
  opportunityId: item.oportunidadeId,
  proposalId: item.propostaId,
  scenarioId: item.cenarioId,
  title: item.titulo,
  startAt: item.inicioEm,
  endAt: item.fimEm,
  monthlyValue: item.valorMensal,
  totalValue: item.valorTotal,
  status: item.situacao,
  terms: item.termos,
  signatureStatus: item.assinatura,
  signedAt: item.assinadoEm,
  renewalType: item.renovacao,
  renewalNoticeAt: item.avisoRenovacaoEm,
  billingDay: item.diaFaturamento,
  responsibleId: item.responsavelId,
  noticeDays: item.antecedenciaAvisoDias,
  version: item.versao,
  serviceId: item.servicoId,
  priceTableId: item.tabelaPrecoId,
  sla: item.sla || {},
  commercialTerms: item.condicoesComerciais || {},
  taxes: item.impostos || {},
  billingRules: item.regrasFaturamento || {},
  adjustmentIndex: item.indiceReajuste,
  adjustmentBaseDate: item.dataBaseReajuste,
  minimumCommitment: item.compromissoMinimo,
  approvalStatus: item.aprovacao,
  revision: item.revision,
  createdAt: item.criadoEm,
});

export const montarDadosDaVertical = (registros = {}, clientes = [], db = {}, access = {}) => {
  const demo = demoModeEnabled(db, access);
  // Painel, indicadores e relatórios só somam simulação com premissa
  // confirmada. O que ficou de fora é contado à parte — sumir com ele em
  // silêncio seria trocar um número inventado por outro.
  const salvos = registros.scenarios || [];
  const confirmados = salvos.filter(cenarioConfirmado);
  const financeiro = (registros.financial || []).map(financeiroDaApi);
  return {
    demo,
    clients: clientes,
    opportunities: registros.opportunities || [],
    proposals: (registros.proposals || []).map(propostaDaApi),
    contracts: (registros.contracts || []).map(contratoDaApi),
    pricingScenarios: confirmados.length ? confirmados : demo ? [seedScenario, seedLastMile] : [],
    simulacoesSemProcedencia: salvos.length - confirmados.length,
    revenueEntries: financeiro.filter((item) => item.kind === "revenue"),
    costEntries: financeiro.filter((item) => item.kind === "cost"),
    commissionEntries: financeiro.filter((item) => item.kind === "commission"),
    // Registros financeiros CRUS (tipo/valor/mesReferencia/clientId) — é o que os
    // extratores de gráfico leem (`data.financial`). Sem isto, os cartões
    // receita/custo/margem/clientes da home caíam sempre em "Sem dados ainda",
    // mesmo com lançamento no razão. Mesma forma que a tela "Meus painéis" já usa.
    financial: registros.financial || [],
    operations: (registros.operations || []).map(operacaoDaApi),
    // Clientes, Oportunidades e Avanços da semana leem estes dois; sem eles a
    // lista na tela ficava vazia mesmo com o registro salvo no servidor.
    comments: registros.comments || [],
    interactions: registros.interactions || [],
    tasks: db.tasks || [],
    inboxUnread: (db.notifications || []).filter((item) => !item.read).length,
  };
};
