// ===== Comparar diesel × elétrico (bloco 01 · fatia 3) =====
// Camada pura.
//
// O "aha" que vende a troca: pôr os dois lado a lado. O CO₂ o motor auditável já
// compara; o CUSTO faltava o gêmeo diesel. Aqui os dois viram um retrato só —
// custo operacional mensal (energia/combustível + manutenção), CO₂ e o PAYBACK
// do que o elétrico custa a mais na compra.
//
// Honestidade: os fatores do elétrico vêm dos mesmos padrões do motor
// (0,30 kWh/km, R$/kWh, fator da rede). O lado DIESEL é REFERÊNCIA DE MERCADO a
// confirmar — preço do litro, km/l, manutenção. São premissas editáveis, nunca
// custo gravado como verdade (a regra da vertical: não gravar custo que ninguém
// confirmou). O payload/motorista/seguro são parecidos nos dois e se cancelam no
// delta, então a conta foca no que DIFERE: energia, manutenção e a compra.

const num = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const round = (valor, casas = 2) => {
  const f = 10 ** casas;
  return Math.round(num(valor) * f) / f;
};

export const PREMISSAS_COMPARACAO_PADRAO = Object.freeze({
  // Elétrico — padrões do motor (DEFAULT_ENVIRONMENTAL_FACTORS / FLEET_ENERGY_DEFAULTS)
  eletricoKwhPorKm: 0.3,
  precoKwh: 0.92,
  manutencaoEletricaPorKm: 0.42,
  fatorRedeKgCo2ePorKwh: 0.0385,
  // Diesel — referências de mercado a confirmar (a operação real manda)
  dieselKmPorLitro: 4.2,
  precoDieselLitro: 6.0,
  manutencaoDieselPorKm: 0.72,
  fatorDieselKgCo2ePorLitro: 2.68,
});

// Campos editáveis, agrupados por lado, para a tela renderizar sem duplicar regra.
export const PREMISSAS_COMPARACAO_FIELDS = Object.freeze([
  { chave: "eletricoKwhPorKm", rotulo: "Consumo elétrico", sufixo: "kWh/km", lado: "eletrico", min: 0, max: 5 },
  { chave: "precoKwh", rotulo: "Preço da energia", sufixo: "R$/kWh", lado: "eletrico", min: 0, max: 10 },
  { chave: "manutencaoEletricaPorKm", rotulo: "Manutenção elétrica", sufixo: "R$/km", lado: "eletrico", min: 0, max: 20 },
  { chave: "fatorRedeKgCo2ePorKwh", rotulo: "Fator da rede", sufixo: "kgCO₂e/kWh", lado: "eletrico", min: 0, max: 5 },
  { chave: "dieselKmPorLitro", rotulo: "Consumo diesel", sufixo: "km/l", lado: "diesel", min: 0.1, max: 30 },
  { chave: "precoDieselLitro", rotulo: "Preço do diesel", sufixo: "R$/l", lado: "diesel", min: 0, max: 30 },
  { chave: "manutencaoDieselPorKm", rotulo: "Manutenção diesel", sufixo: "R$/km", lado: "diesel", min: 0, max: 20 },
  { chave: "fatorDieselKgCo2ePorLitro", rotulo: "Fator do diesel", sufixo: "kgCO₂e/l", lado: "diesel", min: 0, max: 10 },
]);

// `entrada.kmMes` é a quilometragem mensal da operação (o denominador de tudo).
// `valorEletrico`/`valorDiesel` são o preço de compra de cada — só usados no
// payback, e opcionais: sem eles a economia operacional continua valendo.
export const compararDieselEletrico = (entrada = {}, premissasEntrada = {}) => {
  const p = { ...PREMISSAS_COMPARACAO_PADRAO, ...(premissasEntrada || {}) };
  const kmMes = num(entrada.kmMes);
  const valorEletrico = Math.max(0, num(entrada.valorEletrico));
  const valorDiesel = Math.max(0, num(entrada.valorDiesel));

  const avisos = [];
  const disponivel = kmMes > 0;
  if (!disponivel) avisos.push("Informe a quilometragem mensal da operação para comparar.");

  // Elétrico
  const energiaKwhMes = kmMes * num(p.eletricoKwhPorKm);
  const eletricoEnergiaMes = energiaKwhMes * num(p.precoKwh);
  const eletricoManutMes = kmMes * num(p.manutencaoEletricaPorKm);
  const eletricoOpMes = eletricoEnergiaMes + eletricoManutMes;
  const eletricoCo2Mes = energiaKwhMes * num(p.fatorRedeKgCo2ePorKwh);

  // Diesel
  const dieselKmL = num(p.dieselKmPorLitro);
  const litrosMes = dieselKmL > 0 ? kmMes / dieselKmL : 0;
  const dieselCombustivelMes = litrosMes * num(p.precoDieselLitro);
  const dieselManutMes = kmMes * num(p.manutencaoDieselPorKm);
  const dieselOpMes = dieselCombustivelMes + dieselManutMes;
  const dieselCo2Mes = litrosMes * num(p.fatorDieselKgCo2ePorLitro);

  const economiaOperacionalMes = dieselOpMes - eletricoOpMes;
  const co2EvitadoMes = dieselCo2Mes - eletricoCo2Mes;

  // Payback: o extra da compra do elétrico dividido pela economia operacional.
  const paybackDisponivel = disponivel && valorEletrico > 0 && valorDiesel > 0;
  const capexDelta = valorEletrico - valorDiesel;
  let paybackMeses = null;
  if (paybackDisponivel) {
    if (capexDelta <= 0) paybackMeses = 0; // elétrico não custa mais: paga na hora
    else if (economiaOperacionalMes > 0) paybackMeses = capexDelta / economiaOperacionalMes;
    else avisos.push("Sem economia operacional com estas premissas: reveja preços e consumo.");
  } else if (disponivel) {
    avisos.push("Informe o valor de compra dos dois veículos para calcular o payback.");
  }

  return {
    disponivel,
    eletrico: {
      energiaKwhMes: round(energiaKwhMes, 1),
      energiaMes: round(eletricoEnergiaMes),
      manutencaoMes: round(eletricoManutMes),
      operacionalMes: round(eletricoOpMes),
      co2Mes: round(eletricoCo2Mes, 1),
    },
    diesel: {
      litrosMes: round(litrosMes, 1),
      combustivelMes: round(dieselCombustivelMes),
      manutencaoMes: round(dieselManutMes),
      operacionalMes: round(dieselOpMes),
      co2Mes: round(dieselCo2Mes, 1),
    },
    delta: {
      economiaOperacionalMes: round(economiaOperacionalMes),
      economiaOperacionalAno: round(economiaOperacionalMes * 12),
      co2EvitadoMesKg: round(co2EvitadoMes, 1),
      co2EvitadoAnoKg: round(co2EvitadoMes * 12, 1),
      capexDelta: paybackDisponivel ? round(capexDelta) : null,
      paybackMeses: paybackMeses != null ? round(paybackMeses, 1) : null,
      paybackDisponivel,
    },
    premissas: p,
    avisos,
  };
};
