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

// Quais veículos do catálogo têm o custo dominado pelo ATIVO (e portanto usam
// este modelo em vez de um R$/dia chapado), e se a configuração inclui a
// carreta. As chaves batem com VEHICLE_TYPES e VEHICLE_COST_REFERENCE.
export const VEICULOS_ATIVO_PESADO = Object.freeze({
  "Carreta elétrica": { incluiCarreta: true, rotulo: "Cavalo + carreta elétricos" },
  "Cavalo elétrico (solo)": { incluiCarreta: false, rotulo: "Cavalo elétrico (cliente fornece a carreta)" },
});

export const ehVeiculoAtivoPesado = (chave) => Boolean(VEICULOS_ATIVO_PESADO[chave]);

// Metadados das premissas para a régua: rótulo, grupo, unidade e faixa. `escala`
// "fracao" = valor guardado como fração (0,045) mas exibido como % (4,5). Assim o
// admin edita "seguro 4,5% a.a." e o modelo recebe 0,045.
export const PREMISSAS_ATIVO_FIELDS = Object.freeze([
  { chave: "valorCavalo", rotulo: "Valor do cavalo", grupo: "Ativos", sufixo: "R$", min: 0, max: 10_000_000 },
  { chave: "vidaUtilCavaloMeses", rotulo: "Vida útil do cavalo", grupo: "Ativos", sufixo: "meses", min: 1, max: 360 },
  { chave: "residualCavaloPct", rotulo: "Valor residual do cavalo", grupo: "Ativos", sufixo: "%", escala: "fracao", min: 0, max: 1 },
  { chave: "valorCarreta", rotulo: "Valor da carreta", grupo: "Ativos", sufixo: "R$", min: 0, max: 5_000_000 },
  { chave: "vidaUtilCarretaMeses", rotulo: "Vida útil da carreta", grupo: "Ativos", sufixo: "meses", min: 1, max: 360 },
  { chave: "residualCarretaPct", rotulo: "Valor residual da carreta", grupo: "Ativos", sufixo: "%", escala: "fracao", min: 0, max: 1 },

  { chave: "ipvaPctAa", rotulo: "IPVA ao ano", grupo: "Propriedade e risco", sufixo: "%", escala: "fracao", min: 0, max: 0.2 },
  { chave: "seguroCascoPctAa", rotulo: "Seguro casco ao ano", grupo: "Propriedade e risco", sufixo: "%", escala: "fracao", min: 0, max: 0.3 },
  { chave: "rctrRcfMes", rotulo: "RCTR-C / RCF-DC mensal", grupo: "Propriedade e risco", sufixo: "R$", min: 0, max: 20_000 },
  { chave: "rastreamentoGrMes", rotulo: "Rastreamento e GR mensal", grupo: "Propriedade e risco", sufixo: "R$", min: 0, max: 20_000 },
  { chave: "licenciamentoAnttAno", rotulo: "Licenciamento e ANTT ao ano", grupo: "Propriedade e risco", sufixo: "R$", min: 0, max: 50_000 },
  { chave: "custoCapitalPctAa", rotulo: "Custo de capital ao ano", grupo: "Propriedade e risco", sufixo: "%", escala: "fracao", min: 0, max: 0.6 },
  { chave: "baseCustoCapitalPct", rotulo: "Base sujeita a custo de capital", grupo: "Propriedade e risco", sufixo: "%", escala: "fracao", min: 0, max: 1 },

  { chave: "salarioMotoristaMes", rotulo: "Salário do motorista", grupo: "Mão de obra", sufixo: "R$", min: 0, max: 50_000 },
  { chave: "encargosPct", rotulo: "Encargos sobre o salário", grupo: "Mão de obra", sufixo: "%", escala: "fracao", min: 0, max: 3 },
  { chave: "beneficiosMes", rotulo: "Benefícios mensais", grupo: "Mão de obra", sufixo: "R$", min: 0, max: 20_000 },
  { chave: "horasExtrasPct", rotulo: "Horas extras", grupo: "Mão de obra", sufixo: "%", escala: "fracao", min: 0, max: 1 },
  { chave: "coberturaReservaPct", rotulo: "Cobertura de reserva", grupo: "Mão de obra", sufixo: "%", escala: "fracao", min: 0, max: 1 },
  { chave: "ajudanteMes", rotulo: "Ajudante mensal", grupo: "Mão de obra", sufixo: "R$", min: 0, max: 20_000 },

  { chave: "precoEnergiaKwh", rotulo: "Preço da energia", grupo: "Energia e infraestrutura", sufixo: "R$/kWh", min: 0, max: 20 },
  { chave: "consumoSoloKwhKm", rotulo: "Consumo do cavalo solo", grupo: "Energia e infraestrutura", sufixo: "kWh/km", min: 0, max: 10 },
  { chave: "consumoConjuntoKwhKm", rotulo: "Consumo do conjunto", grupo: "Energia e infraestrutura", sufixo: "kWh/km", min: 0, max: 10 },
  { chave: "investInfraRecarga", rotulo: "Investimento em recarga", grupo: "Energia e infraestrutura", sufixo: "R$", min: 0, max: 10_000_000 },
  { chave: "amortizacaoInfraMeses", rotulo: "Amortização da infra", grupo: "Energia e infraestrutura", sufixo: "meses", min: 1, max: 360 },
  { chave: "veiculosRateandoInfra", rotulo: "Veículos rateando a infra", grupo: "Energia e infraestrutura", sufixo: "un", min: 1, max: 500 },

  { chave: "manutencaoCavaloKm", rotulo: "Manutenção do cavalo", grupo: "Manutenção e pneus", sufixo: "R$/km", min: 0, max: 50 },
  { chave: "manutencaoCarretaKm", rotulo: "Manutenção da carreta", grupo: "Manutenção e pneus", sufixo: "R$/km", min: 0, max: 50 },
  { chave: "pneusCavaloQtd", rotulo: "Pneus do cavalo (qtd)", grupo: "Manutenção e pneus", sufixo: "un", min: 0, max: 60 },
  { chave: "pneusCavaloPreco", rotulo: "Preço do pneu do cavalo", grupo: "Manutenção e pneus", sufixo: "R$", min: 0, max: 20_000 },
  { chave: "pneusCavaloVidaKm", rotulo: "Vida do pneu do cavalo", grupo: "Manutenção e pneus", sufixo: "km", min: 1, max: 500_000 },
  { chave: "pneusCarretaQtd", rotulo: "Pneus da carreta (qtd)", grupo: "Manutenção e pneus", sufixo: "un", min: 0, max: 60 },
  { chave: "pneusCarretaPreco", rotulo: "Preço do pneu da carreta", grupo: "Manutenção e pneus", sufixo: "R$", min: 0, max: 20_000 },
  { chave: "pneusCarretaVidaKm", rotulo: "Vida do pneu da carreta", grupo: "Manutenção e pneus", sufixo: "km", min: 1, max: 500_000 },

  { chave: "diasUteisMes", rotulo: "Dias úteis no mês", grupo: "Rateio", sufixo: "dias", min: 1, max: 31 },
]);

export const PREMISSAS_ATIVO_CHAVES = PREMISSAS_ATIVO_FIELDS.map((f) => f.chave);

// Valida um conjunto de premissas do ativo pesado. `parcial` aceita só as chaves
// enviadas (as demais herdam de fábrica). Devolve as premissas limpas ou os erros
// — no espírito do resto da régua: nada entra sem passar por validação.
export const validarPremissasAtivo = (valores = {}, { parcial = false } = {}) => {
  const erros = [];
  const limpos = {};
  const porChave = Object.fromEntries(PREMISSAS_ATIVO_FIELDS.map((f) => [f.chave, f]));
  const chaves = parcial ? Object.keys(valores) : PREMISSAS_ATIVO_CHAVES;
  for (const chave of chaves) {
    const def = porChave[chave];
    if (!def) {
      erros.push(`Premissa desconhecida: ${chave}.`);
      continue;
    }
    const valor = Number(valores[chave]);
    if (!Number.isFinite(valor)) {
      erros.push(`${def.rotulo}: informe um número.`);
      continue;
    }
    if (valor < def.min || valor > def.max) {
      const u = def.escala === "fracao" ? "" : ` ${def.sufixo}`;
      const mostra = (n) => (def.escala === "fracao" ? `${arredondar(n * 100, 2)}%` : `${n}${u}`);
      erros.push(`${def.rotulo}: use um valor entre ${mostra(def.min)} e ${mostra(def.max)}.`);
      continue;
    }
    limpos[chave] = arredondar(valor, 6);
  }
  return erros.length
    ? { valido: false, erros, premissas: null }
    : { valido: true, erros: [], premissas: limpos };
};
