// ===== Registros da vertical: o registro de coleções =====
//
// Contrato: `COLECOES` mapeia o nome da rota (/api/todogreen/records/<nome>)
// para o descritor da coleção — formato em ./descritor.js. A ORDEM das chaves
// faz parte do contrato: o GET agregado devolve as coleções nessa ordem. Cada
// descritor mora no módulo do seu domínio; aqui só se monta o mapa, sempre com
// o MESMO objeto, porque a esteira compara por identidade
// (`colecao === COLECOES.contracts`). `nomeDaColecao(descritor)` devolve a
// chave — é o `resourceType` gravado na auditoria.

import { COLECOES_DE_CADASTRO } from "./cadastros.js";
import { COLECOES_DA_CENTRAL_RFQ } from "./central-rfq.js";
import { COLECOES_DO_COFRE } from "./cofre.js";
import { COLECOES_COMERCIAIS } from "./comercial.js";
import { COLECOES_DO_CONHECIMENTO } from "./conhecimento.js";
import { COLECOES_DE_ENERGIA } from "./energia.js";
import { COLECOES_FINANCEIRAS } from "./financeiro.js";
import { COLECOES_JURIDICAS } from "./juridico.js";
import { COLECOES_DA_OPERACAO } from "./operacao.js";
import { COLECOES_DE_QUALIDADE } from "./qualidade.js";

// Cada coleção declara como uma linha vira registro e como um registro vira
// linha. Sem essa tabela, cada endpoint reescreveria o mesmo mapeamento com
// uma diferença sutil — e a diferença sutil é o que faz o painel somar errado.
export const COLECOES = {
  opportunities: COLECOES_COMERCIAIS.opportunities,
  comments: COLECOES_COMERCIAIS.comments,
  interactions: COLECOES_COMERCIAIS.interactions,
  documentFolders: COLECOES_DO_COFRE.documentFolders,
  habilitacao: COLECOES_DA_CENTRAL_RFQ.habilitacao,
  habilitacaoKits: COLECOES_DA_CENTRAL_RFQ.habilitacaoKits,
  rfq: COLECOES_DA_CENTRAL_RFQ.rfq,
  businessContext: COLECOES_DO_CONHECIMENTO.businessContext,
  proposals: COLECOES_COMERCIAIS.proposals,
  contracts: COLECOES_COMERCIAIS.contracts,
  operations: COLECOES_DA_OPERACAO.operations,
  rotas: COLECOES_DA_OPERACAO.rotas,
  pontosRecarga: COLECOES_DE_ENERGIA.pontosRecarga,
  chargingSessions: COLECOES_DE_ENERGIA.chargingSessions,
  chargerReservations: COLECOES_DE_ENERGIA.chargerReservations,
  chargingPrices: COLECOES_DE_ENERGIA.chargingPrices,
  importTemplates: COLECOES_DA_OPERACAO.importTemplates,
  financial: COLECOES_FINANCEIRAS.financial,
  items: COLECOES_DE_CADASTRO.items,
  warehouses: COLECOES_DE_CADASTRO.warehouses,
  parties: COLECOES_DE_CADASTRO.parties,
  accounts: COLECOES_DE_CADASTRO.accounts,
  costCenters: COLECOES_DE_CADASTRO.costCenters,
  bankAccounts: COLECOES_FINANCEIRAS.bankAccounts,
  quality: COLECOES_DE_QUALIDADE.quality,
  legal: COLECOES_JURIDICAS.legal,
};

export const nomeDaColecao = (colecao) =>
  Object.entries(COLECOES).find(([, configuracao]) => configuracao === colecao)?.[0] || "record";
