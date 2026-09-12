// ===== Nota fiscal do prestador PJ — regras puras =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// O colaborador PJ imputa a PRÓPRIA nota (número, competência, valor, anexo). O
// valor da NF é CONFERIDO contra o valor esperado — o "salário"/contrato PJ —,
// que a operação pode AJUSTAR (ex.: entrou no meio do mês → proporcional). A
// regra de honestidade: nota que não bate com o esperado é SINALIZADA, nunca
// aprovada em silêncio; o repasse só existe sobre nota aprovada com chave PIX.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arred = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const texto = (v, max = 200) => String(v ?? "").trim().slice(0, max);

export const STATUS_NOTA_PJ = Object.freeze([
  { id: "em_analise", rotulo: "Em análise" },
  { id: "aprovada", rotulo: "Aprovada" },
  { id: "recusada", rotulo: "Recusada" },
  { id: "paga", rotulo: "Paga" },
  { id: "cancelada", rotulo: "Cancelada" },
]);

export const rotuloStatusNotaPj = (status) =>
  STATUS_NOTA_PJ.find((s) => s.id === texto(status))?.rotulo || texto(status);

// Competência no formato AAAA-MM (o mês de referência do repasse).
export const competenciaValida = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(texto(v));

// Valor esperado proporcional aos dias trabalhados no mês — a operação usa quando
// o PJ entrou/saiu no meio do mês. Sem dias informados, devolve o cheio. Nunca
// passa do salário cheio nem fica negativo.
export const valorEsperadoProporcional = (salarioBase, diasTrabalhados, diasNoMes = 30) => {
  const base = num(salarioBase);
  const dias = num(diasTrabalhados);
  const total = num(diasNoMes) > 0 ? num(diasNoMes) : 30;
  if (!(base > 0)) return 0;
  if (!(dias > 0)) return arred(base);
  const proporcional = (base * Math.min(dias, total)) / total;
  return arred(Math.min(proporcional, base));
};

// Confere a NF contra o esperado. `tolerancia` é o quanto se aceita de diferença
// em reais (padrão: ao centavo). Devolve o diagnóstico — quem decide aprovar é a
// operação, com este número na tela.
export const conferirNota = ({ valor, valorEsperado, tolerancia = 0.01 } = {}) => {
  const v = arred(valor);
  const esperado = arred(valorEsperado);
  const diferenca = arred(v - esperado);
  const confere = Math.abs(diferenca) <= Math.max(0, num(tolerancia));
  return {
    valorNota: v,
    valorEsperado: esperado,
    diferenca,
    confere,
    // Sinal para a tela: bate, acima do esperado, ou abaixo.
    situacao: confere ? "confere" : diferenca > 0 ? "acima" : "abaixo",
  };
};

// Valida a nota que o PJ imputa. Devolve { valido, erro } — erro é mensagem de
// tela, não throw.
export const validarNotaPj = ({ numero, valor, competencia } = {}) => {
  if (!texto(numero)) return { valido: false, erro: "Informe o número da nota fiscal." };
  if (!(num(valor) > 0)) return { valido: false, erro: "Informe o valor da nota (maior que zero)." };
  if (!competenciaValida(competencia)) return { valido: false, erro: "Informe a competência (mês de referência, ex.: 2026-09)." };
  return { valido: true };
};

// As transições permitidas do ciclo da nota.
export const podeAprovar = (status) => texto(status) === "em_analise";
export const podeRecusar = (status) => texto(status) === "em_analise";
export const podePagar = (status) => texto(status) === "aprovada";
export const podeCancelar = (status) => ["em_analise", "aprovada"].includes(texto(status));
// Enquanto está em análise ou recusada, o PJ ainda pode reenviar a nota daquela
// competência (corrigir número/valor/anexo). Aprovada/paga trava.
export const podeReenviar = (status) => ["em_analise", "recusada"].includes(texto(status));
