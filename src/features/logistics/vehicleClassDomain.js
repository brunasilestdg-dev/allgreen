// ===== Classes de veículo da To Do Green =====
//
// Este domínio separa duas coisas que antes estavam misturadas:
//   1) FROTA OPERACIONAL DA TO DO GREEN: de moto a carreta, sem bitrem/rodotrem.
//   2) MERCADO: classes que podem aparecer em RFQ/benchmark, inclusive bitrem/rodotrem.
//
// A separação é importante porque um equipamento existente no mercado não deve
// aparecer como opção de cadastro da frota. O cadastro operacional também não
// deve proibir uma carreta elétrica só porque uma versão antiga do catálogo não
// tinha referência de consumo para ela. Quando não há fator de referência
// auditável, o sistema exige dado medido/cadastrado em vez de inventar consumo.

const texto = (valor) => String(valor ?? "").trim();
const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const semAcento = (valor) =>
  texto(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const VEHICLE_PORTES = Object.freeze([
  { id: "leve", name: "Leve" },
  { id: "medio", name: "Médio" },
  { id: "pesado", name: "Pesado" },
]);

const operacional = (config) => Object.freeze({
  ...config,
  // A frota cadastrada nesta vertical é a frota da To Do Green. Benchmark de
  // diesel/biometano pertence ao catálogo de mercado e ao motor comparativo.
  energias: ["electric"],
});

export const VEHICLE_CLASSES = Object.freeze([
  operacional({
    id: "moto", name: "Moto", porte: "leve", axles: 2,
    payloadKgMin: 0, payloadKgMax: 60, cnh: "A", urbanRestricted: false,
    billingUnits: ["pacote", "entrega"],
    notes: "Moto elétrica para entrega unitária e pequenos volumes.",
  }),
  operacional({
    id: "utilitario", name: "Utilitário leve", porte: "leve", axles: 2,
    payloadKgMin: 60, payloadKgMax: 800, cnh: "B", urbanRestricted: false,
    billingUnits: ["pacote", "entrega", "coleta"],
    notes: "Utilitário leve elétrico para last mile de baixo volume.",
  }),
  operacional({
    id: "van", name: "Van / Furgão", porte: "leve", axles: 2,
    payloadKgMin: 800, payloadKgMax: 1600, cnh: "B", urbanRestricted: false,
    billingUnits: ["pacote", "entrega", "coleta", "transferencia"],
    notes: "Van ou furgão elétrico para distribuição e transferência leve.",
  }),
  operacional({
    id: "vuc", name: "VUC", porte: "medio", axles: 2,
    payloadKgMin: 1600, payloadKgMax: 3500, cnh: "B", urbanRestricted: true,
    billingUnits: ["entrega", "coleta", "transferencia", "loja"],
    notes: "Veículo Urbano de Carga elétrico; valide dimensões e restrições locais.",
  }),
  operacional({
    id: "tres_quartos", name: "3/4", porte: "medio", axles: 2,
    payloadKgMin: 3500, payloadKgMax: 5000, cnh: "C", urbanRestricted: false,
    billingUnits: ["entrega", "transferencia", "loja"],
    notes: "Caminhão elétrico de distribuição urbana/regional.",
  }),
  operacional({
    id: "toco", name: "Toco", porte: "medio", axles: 2,
    payloadKgMin: 5000, payloadKgMax: 8000, cnh: "C", urbanRestricted: false,
    billingUnits: ["viagem", "transferencia", "loja", "tonelada"],
    notes: "Toco elétrico. Consumo e autonomia devem vir do veículo/telemetria, não de default genérico.",
  }),
  operacional({
    id: "truck", name: "Truck", porte: "pesado", axles: 3,
    payloadKgMin: 8000, payloadKgMax: 14000, cnh: "C", urbanRestricted: false,
    billingUnits: ["viagem", "transferencia", "tonelada"],
    notes: "Truck elétrico. Valide payload, autonomia e recarga por modelo cadastrado.",
  }),
  operacional({
    id: "bitruck", name: "Bitruck", porte: "pesado", axles: 4,
    payloadKgMin: 14000, payloadKgMax: 18000, cnh: "C", urbanRestricted: false,
    billingUnits: ["viagem", "tonelada"],
    notes: "Bitruck elétrico quando houver unidade cadastrada; não assumir fator de consumo sem fonte.",
  }),
  operacional({
    id: "carreta", name: "Carreta", porte: "pesado", axles: 5,
    payloadKgMin: 18000, payloadKgMax: 30000, cnh: "E", urbanRestricted: false,
    billingUnits: ["viagem", "tonelada"],
    notes: "Cavalo mecânico elétrico com semirreboque. Autonomia/consumo vêm do cadastro e da telemetria da unidade.",
  }),
]);

// Catálogo de mercado: serve para RFQ, benchmark e análise de aderência. Não é
// usado pelo seletor da frota operacional.
export const MARKET_VEHICLE_CLASSES = Object.freeze([
  ...VEHICLE_CLASSES,
  Object.freeze({
    id: "bitrem", name: "Bitrem", porte: "pesado", axles: 7,
    payloadKgMin: 30000, payloadKgMax: 37000, cnh: "E", urbanRestricted: false,
    billingUnits: ["viagem", "tonelada"], energias: ["diesel"],
    notes: "Classe de mercado. Não faz parte da frota operacional cadastrável da To Do Green.",
  }),
  Object.freeze({
    id: "rodotrem", name: "Rodotrem", porte: "pesado", axles: 9,
    payloadKgMin: 37000, payloadKgMax: 57000, cnh: "E", urbanRestricted: false,
    billingUnits: ["viagem", "tonelada"], energias: ["diesel"],
    notes: "Classe de mercado. Não faz parte da frota operacional cadastrável da To Do Green.",
  }),
]);

const POR_ID = new Map(VEHICLE_CLASSES.map((classe) => [classe.id, classe]));
const MERCADO_POR_ID = new Map(MARKET_VEHICLE_CLASSES.map((classe) => [classe.id, classe]));

export const isVehicleClass = (valor) => POR_ID.has(texto(valor).toLowerCase());
export const vehicleClass = (valor) => POR_ID.get(texto(valor).toLowerCase()) || null;
export const marketVehicleClass = (valor) => MERCADO_POR_ID.get(texto(valor).toLowerCase()) || null;
export const vehicleClassOrder = (valor) =>
  VEHICLE_CLASSES.findIndex((classe) => classe.id === texto(valor).toLowerCase());

const APELIDOS = Object.freeze({
  motocicleta: "moto", motoboy: "moto", motofrete: "moto", "moto frete": "moto", "2 rodas": "moto",
  fiorino: "utilitario", saveiro: "utilitario", kangoo: "utilitario", partner: "utilitario",
  utilitario: "utilitario", "utilitario leve": "utilitario", "pick up": "utilitario", pickup: "utilitario",
  furgao: "van", sprinter: "van", ducato: "van", master: "van", jumper: "van", daily: "van",
  "van furgao": "van", furgone: "van",
  "veiculo urbano de carga": "vuc", "vuc eletrico": "vuc", hr: "vuc", bongo: "vuc",
  "3/4": "tres_quartos", "34": "tres_quartos", "tres quartos": "tres_quartos",
  "tres/quartos": "tres_quartos", "3 4": "tres_quartos",
  "caminhao toco": "toco", "toco bau": "toco",
  truk: "truck", "caminhao truck": "truck", "truck bau": "truck",
  "bi truck": "bitruck", bitruk: "bitruck",
  "cavalo mecanico": "carreta", cavalo: "carreta", semirreboque: "carreta",
  "carreta simples": "carreta", "cavalo + carreta": "carreta", conjunto: "carreta",
});

const normalizarBruto = (valor) =>
  semAcento(valor).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

export const normalizeVehicleClass = (valor) => {
  const bruto = normalizarBruto(valor);
  if (!bruto) return "";
  const direto = bruto.replace(/\s+/g, "_");
  if (POR_ID.has(direto)) return direto;
  if (POR_ID.has(bruto)) return bruto;
  if (APELIDOS[bruto] && POR_ID.has(APELIDOS[bruto])) return APELIDOS[bruto];
  const mencoes = [
    ["bitruck", ["bitruck", "bi truck"]], ["carreta", ["carreta", "cavalo", "semirreboque", "semi reboque"]],
    ["truck", ["truck"]], ["toco", ["toco"]], ["tres_quartos", ["3/4", "tres quartos"]],
    ["vuc", ["vuc"]], ["van", ["van", "furgao", "sprinter", "ducato", "master"]],
    ["utilitario", ["utilitario", "fiorino", "saveiro", "kangoo"]], ["moto", ["moto"]],
  ];
  for (const [id, termos] of mencoes) if (termos.some((termo) => bruto.includes(termo))) return id;
  return "";
};

export const normalizeMarketVehicleClass = (valor) => {
  const frota = normalizeVehicleClass(valor);
  if (frota) return frota;
  const bruto = normalizarBruto(valor);
  if (["bitrem", "bi trem", "bitren"].some((termo) => bruto.includes(termo))) return "bitrem";
  if (["rodotrem", "rodo trem", "rodotren"].some((termo) => bruto.includes(termo))) return "rodotrem";
  return "";
};

export const isTodoGreenFleetCompatible = (classeId) => Boolean(vehicleClass(classeId));

export const inferClassByPayload = (payloadKg) => {
  const peso = numero(payloadKg);
  if (peso <= 0) return null;
  const achada = VEHICLE_CLASSES.find((classe) => peso > classe.payloadKgMin && peso <= classe.payloadKgMax);
  return achada?.id || null;
};

export const energiaViavelNaClasse = (classeId, energia) => {
  const classe = vehicleClass(classeId);
  return Boolean(classe && classe.energias.includes(texto(energia).toLowerCase()));
};
export const classeEletrificavel = (classeId) => energiaViavelNaClasse(classeId, "electric");
export const cnhExigida = (classeId) => vehicleClass(classeId)?.cnh || "";
export const aceitaUnidadeDeCobranca = (classeId, unidade) =>
  Boolean(vehicleClass(classeId)?.billingUnits.includes(texto(unidade).toLowerCase()));
export const cargaCabeNaClasse = (classeId, pesoKg) => {
  const classe = vehicleClass(classeId);
  const peso = numero(pesoKg);
  if (!classe || peso <= 0) return null;
  return peso <= classe.payloadKgMax;
};

export const frotaPorClasse = (veiculos = []) => {
  const grupos = new Map();
  let semClasse = 0;
  for (const veiculo of veiculos) {
    const id = normalizeVehicleClass(veiculo?.vehicleClass ?? veiculo?.category);
    if (!id) { semClasse += 1; continue; }
    const atual = grupos.get(id) || { classeId: id, total: 0, eletricos: 0, outrasEnergias: 0 };
    atual.total += 1;
    if (texto(veiculo?.energyType).toLowerCase() === "electric") atual.eletricos += 1;
    else atual.outrasEnergias += 1;
    grupos.set(id, atual);
  }
  const linhas = [...grupos.values()].map((grupo) => {
    const classe = vehicleClass(grupo.classeId);
    return { ...grupo, nome: classe.name, porte: classe.porte, eletrificavel: true, cnh: classe.cnh };
  }).sort((a, b) => vehicleClassOrder(a.classeId) - vehicleClassOrder(b.classeId));
  const total = linhas.reduce((soma, linha) => soma + linha.total, 0);
  const eletricos = linhas.reduce((soma, linha) => soma + linha.eletricos, 0);
  return {
    linhas,
    semClasse,
    total,
    eletricos,
    percentualEletrificado: total > 0 ? Math.round((eletricos / total) * 1000) / 10 : null,
    naoEletrificavel: 0,
  };
};

// Referências comparativas. Para classes pesadas sem fator elétrico auditável,
// `eletricoKwhPorKm` fica null e a aplicação deve usar consumo medido/cadastrado.
export const CONSUMO_REFERENCIA = Object.freeze({
  moto: { eletricoKwhPorKm: 0.04, convencionalKmPorL: 30, convencionalKgCO2ePorL: 2.12, convencionalCombustivel: "gasolina_e27", fonteEletrico: "referência operacional cadastrada", fonteConvencional: "referência operacional cadastrada" },
  utilitario: { eletricoKwhPorKm: 0.15, convencionalKmPorL: 11, convencionalKgCO2ePorL: 2.68, convencionalCombustivel: "diesel_b14", fonteEletrico: "referência operacional cadastrada", fonteConvencional: "referência operacional cadastrada" },
  van: { eletricoKwhPorKm: 0.30, convencionalKmPorL: 9, convencionalKgCO2ePorL: 2.68, convencionalCombustivel: "diesel_b14", fonteEletrico: "referência operacional cadastrada", fonteConvencional: "referência operacional cadastrada" },
  vuc: { eletricoKwhPorKm: 0.47, convencionalKmPorL: 7, convencionalKgCO2ePorL: 2.68, convencionalCombustivel: "diesel_b14", fonteEletrico: "referência operacional cadastrada", fonteConvencional: "referência operacional cadastrada" },
  tres_quartos: { eletricoKwhPorKm: 0.65, convencionalKmPorL: 6, convencionalKgCO2ePorL: 2.68, convencionalCombustivel: "diesel_b14", fonteEletrico: "referência operacional cadastrada", fonteConvencional: "referência operacional cadastrada" },
  toco: { eletricoKwhPorKm: null, convencionalKmPorL: 4.5, convencionalKgCO2ePorL: 2.68, convencionalCombustivel: "diesel_b14", fonteEletrico: null, fonteConvencional: "referência operacional cadastrada" },
  truck: { eletricoKwhPorKm: null, convencionalKmPorL: 3.5, convencionalKgCO2ePorL: 2.68, convencionalCombustivel: "diesel_b14", fonteEletrico: null, fonteConvencional: "referência operacional cadastrada" },
  bitruck: { eletricoKwhPorKm: null, convencionalKmPorL: 3, convencionalKgCO2ePorL: 2.68, convencionalCombustivel: "diesel_b14", fonteEletrico: null, fonteConvencional: "referência operacional cadastrada" },
  carreta: { eletricoKwhPorKm: null, convencionalKmPorL: 2.8, convencionalKgCO2ePorL: 2.68, convencionalCombustivel: "diesel_b14", fonteEletrico: null, fonteConvencional: "referência operacional cadastrada" },
  bitrem: { eletricoKwhPorKm: null, convencionalKmPorL: 2.3, convencionalKgCO2ePorL: 2.68, convencionalCombustivel: "diesel_b14", fonteEletrico: null, fonteConvencional: "referência de mercado" },
  rodotrem: { eletricoKwhPorKm: null, convencionalKmPorL: 2, convencionalKgCO2ePorL: 2.68, convencionalCombustivel: "diesel_b14", fonteEletrico: null, fonteConvencional: "referência de mercado" },
});
export const consumoReferencia = (classeId) => CONSUMO_REFERENCIA[texto(classeId).toLowerCase()] || null;

export const validateVehicleClass = (veiculo = {}) => {
  const id = texto(veiculo.vehicleClass);
  if (!id) return "Informe a classe do veículo (de moto a carreta).";
  if (!isVehicleClass(id)) {
    const mercado = normalizeMarketVehicleClass(id);
    if (["bitrem", "rodotrem"].includes(mercado))
      return `${marketVehicleClass(mercado)?.name || "Este equipamento"} não faz parte da frota operacional cadastrável da To Do Green.`;
    return "Classe de veículo desconhecida.";
  }
  const energia = texto(veiculo.energyType).toLowerCase();
  if (energia && energia !== "electric")
    return "A frota operacional da To Do Green nesta vertical deve ser cadastrada como elétrica.";
  return "";
};
