// Fila ativa de inteligência comercial.
//
// Revisado/descartado deixam de exigir ação e saem da tela principal, mas o
// registro continua no banco para histórico e auditoria. Oportunidade permanece
// visível porque ainda demanda tratamento comercial.
export const itemVisivelNaFilaDeInteligencia = (item = {}) =>
  !["reviewed", "dismissed"].includes(String(item.status || "new"));
