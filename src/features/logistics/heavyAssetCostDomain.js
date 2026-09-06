// ===== Custo de ATIVO PESADO (cavalo mecânico elétrico + carreta) =====
//
// Um cavalo elétrico (XCMG) de R$1,3 MM não tem custo "por dia" chapado: o custo
// é dominado pelo ATIVO — depreciação, custo de capital, seguro sobre o valor,
// infraestrutura de recarga — variáveis que um R$/dia fixo esconde. Este módulo
// reproduz, ao centavo, a aba "Custo Frota" da planilha da titular
// (Precificacao_Middle_Mile_XCMG), e é a fonte do custo de referência das
// carretas/cavalos elétricos no simulador.
//
// "Compramos um caminhão mais caro" = muda `valorCavalo` (ou o que for) aqui/na
// régua, e depreciação + capital + seguro recalculam sozinhos. É o "considerar
// essas variáveis" que a titular pediu.
//
// Puro e testável: sem banco, sem rede, sem DOM.

const num = (v, padrao = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
};
const arredondar = (v, casas = 2) => {
  const f = 10 ** casas;
  return Math.round((num(v) + Number.EPSILON) * f) / f;
};

// Premissas de fábrica = valores da planilha XCMG da titular. Todos editáveis
// (a ideia é o admin manter isto na régua; aqui é o ponto de partida validado).
export const PREMISSAS_ATIVO_PESADO = Object.freeze({
  // 2. Ativos
  valorCavalo: 1300000,
  vidaUtilCavaloMeses: 60,
  residualCavaloPct: 0.2,
  valorCarreta: 280000,
  vidaUtilCarretaMeses: 120,
  residualCarretaPct: 0.2,
  // 3. Custos de propriedade e risco
  ipvaPctAa: 0.02,
  seguroCascoPctAa: 0.045,
  rctrRcfMes: 350,
  rastreamentoGrMes: 450,
  licenciamentoAnttAno: 1200,
  custoCapitalPctAa: 0.1,
  baseCustoCapitalPct: 0.5,
  // 4. Mão de obra
  salarioMotoristaMes: 3400,
  encargosPct: 0.7,
  beneficiosMes: 900,
  horasExtrasPct: 0.1,
  coberturaReservaPct: 0.15,
  ajudanteMes: 0,
  // 5. Energia e infraestrutura
  precoEnergiaKwh: 1.05,
  consumoSoloKwhKm: 0.95,
  consumoConjuntoKwhKm: 1.35,
  investInfraRecarga: 450000,
  amortizacaoInfraMeses: 60,
  veiculosRateandoInfra: 4,
  // 6. Manutenção e pneus
  manutencaoCavaloKm: 0.42,
  manutencaoCarretaKm: 0.12,
  pneusCavaloQtd: 6,
  pneusCavaloPreco: 2800,
  pneusCavaloVidaKm: 90000,
  pneusCarretaQtd: 12,
  pneusCarretaPreco: 2600,
  pneusCarretaVidaKm: 100000,
  // Rateio
  diasUteisMes: 22,
});

// Custo mensal total do motorista (com encargos, benefícios, horas extras e
// reserva) — mesma composição da planilha: 8.346,70 nas premissas de fábrica.
export const custoMotoristaMes = (p = PREMISSAS_ATIVO_PESADO) =>
  arredondar(
    ((num(p.salarioMotoristaMes) * (1 + num(p.encargosPct))) * (1 + num(p.horasExtrasPct)) + num(p.beneficiosMes))
      * (1 + num(p.coberturaReservaPct)) + num(p.ajudanteMes),
  );

// Núcleo: custo fixo mensal + custo variável por km de uma configuração.
// incluiCarreta=false = "cavalo solo" (o cliente fornece os semirreboques).
export const custoAtivoPesado = (premissas = {}, { incluiCarreta = true } = {}) => {
  const p = { ...PREMISSAS_ATIVO_PESADO, ...premissas };
  const dias = Math.max(1, num(p.diasUteisMes, 22));
  const valorAtivos = num(p.valorCavalo) + (incluiCarreta ? num(p.valorCarreta) : 0);

  const depreciacaoCavalo = (num(p.valorCavalo) * (1 - num(p.residualCavaloPct))) / Math.max(1, num(p.vidaUtilCavaloMeses));
  const depreciacaoCarreta = incluiCarreta
    ? (num(p.valorCarreta) * (1 - num(p.residualCarretaPct))) / Math.max(1, num(p.vidaUtilCarretaMeses))
    : 0;
  const ipvaMes = (valorAtivos * num(p.ipvaPctAa)) / 12;
  const seguroMes = (valorAtivos * num(p.seguroCascoPctAa)) / 12;
  const licenciamentoMes = num(p.licenciamentoAnttAno) / 12;
  const custoCapitalMes = (valorAtivos * num(p.baseCustoCapitalPct) * num(p.custoCapitalPctAa)) / 12;
  const motoristaMes = custoMotoristaMes(p);
  const infraMes = num(p.investInfraRecarga)
    / Math.max(1, num(p.amortizacaoInfraMeses))
    / Math.max(1, num(p.veiculosRateandoInfra));

  const custoFixoMes = depreciacaoCavalo + depreciacaoCarreta + ipvaMes + seguroMes
    + num(p.rctrRcfMes) + num(p.rastreamentoGrMes) + licenciamentoMes + custoCapitalMes
    + motoristaMes + infraMes;

  const energiaKm = (incluiCarreta ? num(p.consumoConjuntoKwhKm) : num(p.consumoSoloKwhKm)) * num(p.precoEnergiaKwh);
  const manutencaoKm = num(p.manutencaoCavaloKm) + (incluiCarreta ? num(p.manutencaoCarretaKm) : 0);
  const pneusKm = (num(p.pneusCavaloQtd) * num(p.pneusCavaloPreco)) / Math.max(1, num(p.pneusCavaloVidaKm))
    + (incluiCarreta ? (num(p.pneusCarretaQtd) * num(p.pneusCarretaPreco)) / Math.max(1, num(p.pneusCarretaVidaKm)) : 0);
  const custoVariavelKm = energiaKm + manutencaoKm + pneusKm;

  return {
    custoFixoMes: arredondar(custoFixoMes),
    custoFixoDia: arredondar(custoFixoMes / dias),
    custoVariavelKm: arredondar(custoVariavelKm, 4),
    motoristaMes,
    detalhamento: {
      depreciacaoCavalo: arredondar(depreciacaoCavalo),
      depreciacaoCarreta: arredondar(depreciacaoCarreta),
      ipvaMes: arredondar(ipvaMes),
      seguroMes: arredondar(seguroMes),
      custoCapitalMes: arredondar(custoCapitalMes),
      infraMes: arredondar(infraMes),
      energiaKm: arredondar(energiaKm, 4),
      manutencaoKm: arredondar(manutencaoKm, 4),
      pneusKm: arredondar(pneusKm, 4),
    },
  };
};

// Converte o custo do ativo pesado para as premissas que o motor de preço lê
// (o motor soma o motorista à parte, então o custo de veículo aqui é SEM
// motorista). É isto que alimenta VEHICLE_COST_REFERENCE das carretas elétricas.
export const referenciaEngineAtivoPesado = (premissas = {}, opcoes = {}) => {
  const c = custoAtivoPesado(premissas, opcoes);
  const dias = Math.max(1, num({ ...PREMISSAS_ATIVO_PESADO, ...premissas }.diasUteisMes, 22));
  const driverDailyCost = arredondar(c.motoristaMes / dias);
  return {
    driverDailyCost,
    vehicleDailyCost: arredondar(c.custoFixoDia - driverDailyCost),
    energyCostPerKm: c.detalhamento.energiaKm,
    maintenancePerKm: arredondar(c.detalhamento.manutencaoKm + c.detalhamento.pneusKm, 4),
  };
};
