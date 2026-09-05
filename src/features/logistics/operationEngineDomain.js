// Motor de HEADCOUNT e DRE por tipo de operação — núcleo puro e testável.
//
// A régua vem de `operationParamsSeed.js` (ou do banco, editada por admin).
// Aqui só o cálculo: formação de preço por gross-up, DRE (receita − custos −
// impostos), e dimensionamento de headcount por camadas + abordagem + reserva.
//
// Convenções do repositório:
// - Devolve `null` quando falta dado essencial (nunca `0`, que mentiria).
// - Nada de efeito colateral: as mesmas entradas dão sempre a mesma saída.
// - Dinheiro arredondado a centavos só na fronteira de exibição; o núcleo
//   mantém a precisão e arredonda no fim de cada valor devolvido.

const num = (valor) => {
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
};
const pct = (valor) => {
  const n = num(valor);
  return n === null ? null : n;
};
const round2 = (n) => (n === null ? null : Math.round(n * 100) / 100);

// Fator de gross-up: parte do custo para o preço "por dentro" dos tributos.
//   gross_up = 1 / (1 - icms) / (1 - (pis_cofins + comissao))
// Fora das faixas válidas (tributo ≥ 100%) devolve null: preço não existe.
export const fatorGrossUp = ({ icmsPct, pisCofinsPct, comissaoPct } = {}) => {
  const icms = pct(icmsPct);
  const pisCofins = pct(pisCofinsPct);
  const comissao = pct(comissaoPct) ?? 0;
  if (icms === null || pisCofins === null) return null;
  const sobreFaturamento = pisCofins + comissao;
  if (icms >= 1 || sobreFaturamento >= 1) return null;
  return 1 / (1 - icms) / (1 - sobreFaturamento);
};

// Preço a partir do custo direto: overhead e margem sobre o custo, depois o
// gross-up dos tributos sobre o faturamento.
//   preço = custo_direto × (1+overhead) × (1+margem) × gross_up
export const precoPorGrossUp = (
  custoDireto,
  { overheadPct = 0, margemPct = 0, grossUpFator } = {},
) => {
  const custo = num(custoDireto);
  const gu = num(grossUpFator);
  if (custo === null || custo < 0 || gu === null) return null;
  const oh = pct(overheadPct) ?? 0;
  const mg = pct(margemPct) ?? 0;
  return round2(custo * (1 + oh) * (1 + mg) * gu);
};

// DRE de um período: da receita descontam-se custo direto, overhead, comissão
// e os impostos sobre faturamento. Margem bruta = receita − custos operacionais;
// margem líquida = bruta − impostos. `margemPct` é a líquida sobre a receita.
export const calcularDre = ({
  receita,
  custoDireto = 0,
  overheadPct = 0,
  comissaoPct = 0,
  impostosPct = 0,
} = {}) => {
  const rec = num(receita);
  const custo = num(custoDireto);
  if (rec === null || custo === null) return null;
  const oh = round2(custo * (pct(overheadPct) ?? 0));
  const comissao = round2(rec * (pct(comissaoPct) ?? 0));
  const impostos = round2(rec * (pct(impostosPct) ?? 0));
  const custosOperacionais = round2(custo + oh);
  const margemBruta = round2(rec - custosOperacionais - comissao);
  const margemLiquida = round2(margemBruta - impostos);
  return {
    receita: round2(rec),
    custoDireto: round2(custo),
    overhead: oh,
    comissao,
    impostos,
    custosOperacionais,
    margemBruta,
    margemLiquida,
    margemPct: rec > 0 ? round2((margemLiquida / rec) * 100) : null,
  };
};

// Custo mensal de mão de obra do núcleo fixo de uma base (líder + auxiliares).
const custoNucleoBase = (camadas) => {
  const nb = camadas?.nucleo_base || {};
  const lider = num(nb.lider_operacoes_mes) ?? 0;
  const aux = num(nb.auxiliar_mes) ?? 0;
  const qtd = num(nb.qtd_auxiliares) ?? 0;
  return round2(lider + aux * qtd);
};

// Dimensionamento de headcount por camadas, com a reserva de motorista aplicada
// à camada variável (folga, falta, no-show). Devolve o custo mensal por camada
// e o total; `motoristas`/`entregadores` são a contagem dimensionada.
export const dimensionarHeadcount = (
  headcount = {},
  { basesQtd = 1, motoristas = 0, entregadoresDia = 0, diasUteisMes = 22, torres = 0 } = {},
) => {
  const camadas = headcount.camadas || {};
  const bases = Math.max(1, num(basesQtd) ?? 1);
  const reservaPct = pct(headcount.reserva_motorista_pct) ?? 0;

  const nucleoUnit = custoNucleoBase(camadas);
  const nucleo = round2(nucleoUnit * bases);

  const variavel = camadas.variavel || {};
  const motoristaMes = num(variavel.motorista_clt_mes) ?? 0;
  const entregadorDia = num(variavel.entregador_pj_dia) ?? 0;
  const torreMes = num(variavel.torre_controle_mes) ?? 0;

  const qtdMotoristas = num(motoristas) ?? 0;
  const qtdEntregadoresDia = num(entregadoresDia) ?? 0;
  // Reserva aplica-se à força variável: dimensiona-se mais gente do que a
  // demanda nominal para cobrir ausências.
  const motoristasComReserva = qtdMotoristas * (1 + reservaPct);
  const entregadoresComReserva = qtdEntregadoresDia * (1 + reservaPct);

  const custoMotoristas = round2(motoristasComReserva * motoristaMes);
  const custoEntregadores = round2(entregadoresComReserva * entregadorDia * (num(diasUteisMes) ?? 22));
  const custoTorre = round2((num(torres) ?? 0) * torreMes);
  const custoVariavel = round2(custoMotoristas + custoEntregadores + custoTorre);

  return {
    bases,
    reservaPct,
    nucleoPorBase: nucleoUnit,
    custoNucleo: nucleo,
    motoristasDimensionados: round2(motoristasComReserva),
    entregadoresDimensionados: round2(entregadoresComReserva),
    custoMotoristas,
    custoEntregadores,
    custoTorre,
    custoVariavel,
    custoTotalMes: round2(nucleo + custoVariavel),
  };
};

// Ponte da régua para o cálculo: extrai os fatores globais de tributo e devolve
// o gross-up já pronto para a formação de preço.
export const grossUpDaRegua = (params = {}) => {
  const imp = params?.globais?.impostos || {};
  return fatorGrossUp({
    icmsPct: imp.icms_pct,
    pisCofinsPct: imp.pis_cofins_pct,
    comissaoPct: imp.comissao_comercial_pct,
  });
};
