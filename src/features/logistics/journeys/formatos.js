// Formatação em pt-BR compartilhada pelos painéis da vertical — JS puro.

export const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
