// ===== Catálogo compartilhado das três verticais =====
//
// Camada pura. Fonte única para "que verticais existem", usada pelo seletor
// e por qualquer indicador de contexto. Reflete a visão do produto (SHARED
// CORE + TO DO GREEN + GREEN ON + GREENMOB) sem esconder o fato de que hoje
// Green On e Greenmob são leves — nunca inventar "REAL" onde ainda não é.

export const VERTICAIS = Object.freeze([
  {
    id: "todogreen",
    name: "To Do Green",
    subtitle: "Transporte, TMS, roteirização e Portal do Cliente",
    route: "/todogreen",
    status: "real",
    kicker: "Vertical logística",
    // Módulos que a vertical entrega hoje, para diferenciar do que ainda é
    // prometido em outra vertical.
    modules: [
      "CRM logístico e RFQ",
      "TMS e Torre de Controle",
      "Roteirização e pré-flight",
      "Portal do Cliente e do Motorista",
      "Financeiro, ESG e GreenPay",
    ],
  },
  {
    id: "greenon",
    name: "Green On",
    subtitle: "Recarga, energia e infraestrutura elétrica",
    route: "/greenon",
    status: "parcial",
    kicker: "Vertical de energia",
    modules: [
      "CRM comercial completo (contas, contatos, oportunidades, funil)",
      "Saúde da conta com pesos específicos de energia",
      "Cadastro de sites e painel operacional",
      "Pontos, sessões e energia (reutilizados)",
    ],
  },
  {
    id: "greenmob",
    name: "Greenmob",
    subtitle: "Locação de veículos elétricos para empresas e motoristas",
    route: "/greenmob",
    status: "mvp",
    kicker: "Vertical de locação",
    modules: [
      "CRM Greenmob (funil de locação)",
      "Frota, disponibilidade e contratos",
      "Cálculo de excedente de km",
      "Registro de devolução",
    ],
  },
]);

export const rotuloStatus = (status) => ({
  real: "Operacional",
  parcial: "Parcial",
  mvp: "MVP",
  prepared: "Preparado",
  external: "Depende de terceiros",
}[status] || status);

export const verticalPorId = (id) => VERTICAIS.find((v) => v.id === id) || null;
