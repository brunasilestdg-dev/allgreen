// Parâmetros versionados do simulador. A régua comercial é uma das categorias,
// não o sistema inteiro: frota, equipe e operação também precisam sair do código.

export const PARAMETROS_VERSAO_PADRAO = "v1.2026";

const percentual = (rotulo, descricao, max = 100) => ({
  rotulo, descricao, min: 0, max, sufixo: "%", categoria: "comercial",
});
const moeda = (rotulo, descricao, categoria, max = 1_000_000) => ({
  rotulo, descricao, min: 0, max, sufixo: "R$", categoria,
});
const numero = (rotulo, descricao, categoria, max = 100_000) => ({
  rotulo, descricao, min: 0, max, sufixo: "", categoria,
});

export const PARAMETROS = Object.freeze({
  minimumMarginPercent: percentual("Margem mínima", "Piso de margem. Abaixo dele a proposta exige aprovação comercial.", 80),
  targetMarginPercent: percentual("Margem alvo", "Margem usada para calcular o preço recomendado.", 90),
  opexPercent: percentual("OPEX", "Overhead e despesas operacionais rateados sobre o custo direto.", 60),
  adminPercent: percentual("Administrativo", "Rateio da estrutura administrativa sobre o custo direto.", 60),
  taxPercent: percentual("Impostos", "Carga tributária usada na formação do preço.", 60),
  riskPercent: percentual("Risco", "Provisão para avaria, atraso e reentrega.", 40),
  commissionPercent: percentual("Comissão", "Percentual sobre o preço de venda.", 30),
  reserveVehiclePercent: percentual("Frota reserva", "Adicional de capacidade para cobrir indisponibilidade de frota.", 50),

  vehicleDailyCost: moeda("Veículo por dia", "Locação ou depreciação diária quando não houver valor mensal.", "frota"),
  vehicleMonthlyCost: moeda("Veículo por mês", "Locação ou depreciação mensal. Tem precedência em operação dedicada.", "frota"),
  maintenancePerKm: moeda("Manutenção por km", "Manutenção variável, pneus e desgaste por quilômetro.", "frota", 10_000),
  maintenanceMonthly: moeda("Manutenção mensal", "Manutenção fixa mensal por veículo.", "frota"),
  energyCostPerKwh: moeda("Energia por kWh", "Tarifa efetiva de energia e recarga.", "frota", 1_000),
  electricKwhPerKm: numero("Consumo elétrico por km", "Consumo do veículo elétrico em kWh por quilômetro.", "frota", 100),
  energyCostPerKm: moeda("Energia por km", "Custo direto por km, quando conhecido. Substitui kWh × tarifa.", "frota", 1_000),
  vehicleInsuranceMonthly: moeda("Seguro mensal do veículo", "Seguro mensal por veículo.", "frota"),
  licensingMonthly: moeda("IPVA e licenciamento mensal", "Provisionamento mensal por veículo.", "frota"),

  driverDailyCost: moeda("Motorista por dia", "Custo diário padrão do motorista.", "pessoas"),
  driverDailyCost4h: moeda("Motorista por dia, 4h", "Custo diário para jornada de até quatro horas.", "pessoas"),
  driverDailyCost8h: moeda("Motorista por dia, 8h", "Custo diário para jornada de até oito horas.", "pessoas"),
  driverHourlyCost: moeda("Motorista por hora", "Custo por hora usado quando a jornada não segue uma diária cadastrada.", "pessoas"),
  helperDailyCost: moeda("Ajudante por dia", "Custo diário por ajudante.", "pessoas"),
  supervisionMonthly: moeda("Supervisão mensal", "Custo mensal de supervisão da operação.", "pessoas"),

  waitingCostPerHour: moeda("Espera por hora", "Custo de permanência em fila ou doca.", "operacao"),
  tollMarkupPercent: percentual("Adicional sobre pedágio", "Taxa aplicada ao pedágio informado na rota.", 100),
  trackingMonthly: moeda("Tecnologia e rastreamento", "Custo mensal de tecnologia por veículo.", "operacao"),
  cargoInsuranceMonthly: moeda("Seguro de carga mensal", "Seguro mensal alocado à operação.", "operacao"),
  contingencyPercent: percentual("Contingência operacional", "Reserva sobre o custo direto para variações não previstas.", 40),
});

export const CATEGORIAS_PARAMETROS = Object.freeze([
  { id: "comercial", rotulo: "Formação do preço" },
  { id: "frota", rotulo: "Frota e energia" },
  { id: "pessoas", rotulo: "Equipe e jornada" },
  { id: "operacao", rotulo: "Operação" },
]);

export const ESCOPO_PARAMETROS = Object.freeze([
  { id: "global", rotulo: "Global", dica: "Base do ERP" },
  { id: "product", rotulo: "Produto", dica: "Ex.: Middle Mile Spot" },
  { id: "modality", rotulo: "Modalidade", dica: "Ex.: spot ou recorrente" },
  { id: "vehicle", rotulo: "Veículo", dica: "Ex.: moto elétrica" },
  { id: "region", rotulo: "Região ou base", dica: "Ex.: São Paulo" },
  { id: "client", rotulo: "Cliente", dica: "Condição negociada" },
  { id: "contract", rotulo: "Contrato", dica: "Exceção contratual" },
]);

export const PARAMETROS_OBRIGATORIOS_GLOBAIS = Object.freeze([
  "minimumMarginPercent", "targetMarginPercent", "opexPercent", "adminPercent",
  "taxPercent", "riskPercent", "commissionPercent",
]);
export const CHAVES_PARAMETROS = Object.keys(PARAMETROS);

// Referências importadas da planilha CCN. São pontos de partida editáveis e
// nunca entram em vigor sem versão, justificativa e ação explícita do gestor.
export const MODELOS_PARAMETROS = Object.freeze([
  {
    id: "middle-mile-spot",
    nome: "Middle Mile Spot",
    descricao: "Viagem avulsa com preço por viagem. Complete veículo, equipe, rota e pedágio conforme a cotação.",
    scopeType: "product",
    scopeKey: "middle-mile-spot",
    source: "Modelo operacional To Do Green",
    parametros: {},
  },
  {
    id: "courier-eletrico-8h-ccn",
    nome: "Courier elétrico dedicado, 8h",
    descricao: "Referência CCN da planilha de maio/2026. Revise antes de ativar.",
    scopeType: "product",
    scopeKey: "dedicated",
    source: "CCN_Precificacao_Courier_Eletrico_TodoGreen.xlsx",
    parametros: {
      vehicleMonthlyCost: 1850, driverDailyCost8h: 220, energyCostPerKm: 0.12,
      maintenanceMonthly: 200, licensingMonthly: 80, cargoInsuranceMonthly: 150,
      opexPercent: 10, adminPercent: 0, targetMarginPercent: 26,
      minimumMarginPercent: 18, taxPercent: 14.25, riskPercent: 0, commissionPercent: 0,
    },
  },
  {
    id: "courier-eletrico-4h-ccn",
    nome: "Courier elétrico dedicado, 4h",
    descricao: "Referência CCN para jornada reduzida. Revise antes de ativar.",
    scopeType: "product",
    scopeKey: "dedicated",
    source: "CCN_Precificacao_Courier_Eletrico_TodoGreen.xlsx",
    parametros: {
      vehicleMonthlyCost: 1850, driverDailyCost4h: 160, energyCostPerKm: 0.12,
      maintenanceMonthly: 200, licensingMonthly: 80, cargoInsuranceMonthly: 150,
      opexPercent: 10, adminPercent: 0, targetMarginPercent: 26,
      minimumMarginPercent: 18, taxPercent: 14.25, riskPercent: 0, commissionPercent: 0,
    },
  },
]);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const arredondar = (v, casas = 2) => {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
};
export const LIMITE_MARGEM_MAIS_COMISSAO = 90;

export const validarParametros = (valores = {}, opcoes = {}) => {
  const parcial = opcoes.parcial === true;
  const erros = [];
  const limpos = {};
  const chaves = parcial
    ? Object.keys(valores)
    : [...new Set([...PARAMETROS_OBRIGATORIOS_GLOBAIS, ...Object.keys(valores)])];

  for (const chave of chaves) {
    const definicao = PARAMETROS[chave];
    if (!definicao) {
      erros.push(`Parâmetro desconhecido: ${chave}.`);
      continue;
    }
    const valor = num(valores[chave]);
    if (Number.isNaN(valor)) {
      erros.push(`${definicao.rotulo}: informe um número.`);
      continue;
    }
    if (valor < definicao.min || valor > definicao.max) {
      const unidade = definicao.sufixo === "%" ? "%" : "";
      erros.push(`${definicao.rotulo}: use um valor entre ${definicao.min}${unidade} e ${definicao.max}${unidade}.`);
      continue;
    }
    limpos[chave] = arredondar(valor, 4);
  }
  if (erros.length) return { valido: false, erros, parametros: null };

  const contexto = { ...opcoes.base, ...limpos };
  const minimo = num(contexto.minimumMarginPercent);
  const alvo = num(contexto.targetMarginPercent);
  const comissao = num(contexto.commissionPercent);
  if (Number.isFinite(alvo) && Number.isFinite(minimo) && alvo < minimo)
    erros.push("A margem alvo não pode ser menor que a margem mínima — o preço recomendado nasceria abaixo do piso.");
  if (Number.isFinite(alvo) && Number.isFinite(comissao) && alvo + comissao >= LIMITE_MARGEM_MAIS_COMISSAO)
    erros.push(`Margem alvo (${alvo}%) mais comissão (${comissao}%) somam ${arredondar(alvo + comissao)}%. Acima de ${LIMITE_MARGEM_MAIS_COMISSAO}% a fórmula de preço perde o sentido e devolve um valor irreal.`);

  // A régua global precisa dizer quanto custam o veículo e o motorista — são
  // os dois maiores custos da operação. Sem eles o motor cai em silêncio nos
  // valores padrão do código, e preço calculado sobre custo que ninguém
  // confirmou é exatamente o que esta tela existe para impedir. Escopos
  // parciais (produto, veículo, cliente) herdam da global e não precisam
  // repetir.
  if (!parcial) {
    const positivo = (chave) => num(contexto[chave]) > 0;
    if (!positivo("vehicleDailyCost") && !positivo("vehicleMonthlyCost"))
      erros.push("Defina o custo do veículo (por dia ou por mês) — a régua global não pode ficar sem ele.");
    if (!positivo("driverDailyCost") && !positivo("driverDailyCost4h") && !positivo("driverDailyCost8h") && !positivo("driverHourlyCost"))
      erros.push("Defina o custo do motorista (diária, jornada ou hora) — a régua global não pode ficar sem ele.");
  }
  if (Number.isFinite(minimo) && Number.isFinite(comissao) && minimo + comissao >= LIMITE_MARGEM_MAIS_COMISSAO)
    erros.push(`Margem mínima mais comissão somam ${arredondar(minimo + comissao)}%, acima do limite de ${LIMITE_MARGEM_MAIS_COMISSAO}%.`);
  const imposto = num(contexto.taxPercent);
  if (Number.isFinite(alvo) && Number.isFinite(comissao) && Number.isFinite(imposto)
      && alvo + comissao + imposto >= 95)
    erros.push("Margem alvo, comissão e impostos deixam menos de 5% do preço para cobrir o custo. Revise a formação do preço.");
  return erros.length ? { valido: false, erros, parametros: null } : { valido: true, erros: [], parametros: limpos };
};

// Custo de referência de FÁBRICA por veículo (modelo tipos_operacao.yaml da
// titular). É o que faz o "Tipo de veículo" mudar o preço já de fábrica: ao
// escolher o veículo, estes custos entram na régua ANTES de um eventual perfil
// de régua daquele veículo (escopo "Veículo"), que o admin cria/edita na tela
// de Parâmetros e SOBRESCREVE isto. "Compramos um caminhão mais caro" =
// o admin edita o perfil do veículo, num lugar só, valendo para toda cotação.
//
// Procedência: VUC/Toco 495/dia + motorista 280 + manutenção 0,42/km; carretas
// 1742/dia + motorista/ajudante ~480 + manutenção 0,12/km. Veículo/energia de
// moto/passeio/fiorino/truck são pontos de partida por porte, a confirmar.
export const VEHICLE_COST_REFERENCE = Object.freeze({
  "Moto": { driverDailyCost: 220, vehicleDailyCost: 40, energyCostPerKm: 0.06, maintenancePerKm: 0.12 },
  "Passeio": { driverDailyCost: 220, vehicleDailyCost: 90, energyCostPerKm: 0.10, maintenancePerKm: 0.15 },
  "Fiorino / Van": { driverDailyCost: 280, vehicleDailyCost: 160, energyCostPerKm: 0.12, maintenancePerKm: 0.20 },
  "VUC": { driverDailyCost: 280, vehicleDailyCost: 495, energyCostPerKm: 0.12, maintenancePerKm: 0.42 },
  "Toco": { driverDailyCost: 280, vehicleDailyCost: 495, energyCostPerKm: 0.30, maintenancePerKm: 0.42 },
  "Truck": { driverDailyCost: 340, vehicleDailyCost: 900, energyCostPerKm: 0.60, maintenancePerKm: 0.42 },
  "Carreta Sider": { driverDailyCost: 480, vehicleDailyCost: 1742, energyCostPerKm: 1.42, maintenancePerKm: 0.12 },
  "Carreta Aberta": { driverDailyCost: 480, vehicleDailyCost: 1742, energyCostPerKm: 1.42, maintenancePerKm: 0.12 },
  "Carreta elétrica": { driverDailyCost: 480, vehicleDailyCost: 1742, energyCostPerKm: 1.42, maintenancePerKm: 0.12 },
});

export const resolverParametros = (padrao, perfis = [], contexto = {}) => {
  const ordem = ESCOPO_PARAMETROS.map((item) => item.id);
  const chaves = {
    global: "global", product: contexto.productId, modality: contexto.modality,
    vehicle: contexto.vehicleType, region: contexto.region, client: contexto.clientId,
    contract: contexto.contractId,
  };
  const aplicados = [];
  const parametros = { ...padrao };
  for (const tipo of ordem) {
    const chave = chaves[tipo];
    if (!chave) continue;
    // Referência de fábrica do veículo, sob o perfil do admin (se houver).
    if (tipo === "vehicle" && VEHICLE_COST_REFERENCE[chave]) {
      Object.assign(parametros, VEHICLE_COST_REFERENCE[chave]);
      aplicados.push({ versao: "ref-frota", scopeType: "vehicle", scopeKey: chave, fonte: "referencia_de_fabrica", parametros: VEHICLE_COST_REFERENCE[chave] });
    }
    const perfil = perfis.find((item) => item.status === "active" && item.scopeType === tipo && item.scopeKey === chave);
    if (!perfil) continue;
    Object.assign(parametros, perfil.parametros || {});
    aplicados.push({ id: perfil.id, versao: perfil.versao, scopeType: tipo, scopeKey: chave, parametros: perfil.parametros || {} });
  }
  return { parametros, aplicados };
};

export const simularEfeito = (parametros, custoDireto = 10000) => {
  const { valido, parametros: p } = validarParametros(parametros);
  if (!valido) return null;
  const custo = Math.max(0, num(custoDireto) || 0);
  const carregado = custo * (1 + (p.opexPercent + p.adminPercent + p.riskPercent) / 100);
  const divisorMinimo = 1 - (p.minimumMarginPercent + p.commissionPercent + p.taxPercent) / 100;
  const divisorAlvo = 1 - (p.targetMarginPercent + p.commissionPercent + p.taxPercent) / 100;
  return {
    custoDireto: arredondar(custo), custoCarregado: arredondar(carregado),
    precoMinimo: arredondar(carregado / divisorMinimo), precoRecomendado: arredondar(carregado / divisorAlvo),
    pesoDoCustoPercent: arredondar(divisorAlvo * 100, 1),
  };
};

export const explicarMudanca = (nova, anterior) => {
  if (!anterior) return "Primeira régua cadastrada.";
  const partes = [];
  for (const [chave, paraBruto] of Object.entries(nova || {})) {
    const definicao = PARAMETROS[chave];
    if (!definicao) continue;
    const de = num(anterior[chave]);
    const para = num(paraBruto);
    if (Number.isNaN(para) || de === para) continue;
    const deTexto = Number.isNaN(de) ? "herdado" : `${de}${definicao.sufixo}`;
    partes.push(`${definicao.rotulo}: ${deTexto} → ${para}${definicao.sufixo}`);
  }
  return partes.length ? partes.join(" · ") : "Nenhum parâmetro mudou.";
};
