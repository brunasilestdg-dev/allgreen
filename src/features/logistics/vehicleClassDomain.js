// ===== Classe do veículo: de moto a carreta =====
//
// Até aqui `category` era texto livre no cadastro de frota
// (todoGreenFleetDomain.js). Numa operação que vai de MOTO a CARRETA, texto
// livre custa caro em quatro lugares ao mesmo tempo:
//
//   1. CUSTO POR KM. Uma moto e uma carreta não são comparáveis. Somar as duas
//      num "custo médio da frota" produz um número que não descreve nenhum
//      veículo real.
//   2. UNIDADE DE COBRANÇA. Moto e van entregam PACOTE (last mile); carreta faz
//      VIAGEM ou TONELADA (line haul). O produto vendido depende da classe.
//   3. QUEM PODE DIRIGIR. Moto exige CNH A; carreta exige E. Escalar motorista
//      sem saber a classe é escalar para uma habilitação que a pessoa não tem.
//   4. RESTRIÇÃO URBANA. VUC entra onde caminhão não entra. Em São Paulo isso
//      não é detalhe: decide se a rota existe.
//
// E há um quinto, específico da To Do Green: ELETRIFICAÇÃO NÃO É UNIFORME. Moto,
// van e VUC elétricos são realidade comercial no Brasil; carreta elétrica não é.
// Tratar a frota como um bloco só faria a promessa de emissão zero valer para
// um veículo que não pode cumpri-la. Cada classe declara que energias são
// viáveis hoje, e o motor de ESG e de proposta pode perguntar isso em vez de
// supor.
//
// A ordem da lista é a ordem de PORTE — é por ela que qualquer relatório
// ordena, e é o que faz "de moto a carreta" ser uma escala e não um conjunto.

const texto = (valor) => String(valor ?? "").trim();

const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

// `porte` agrupa a escala em três faixas, porque quase toda decisão comercial e
// operacional se resolve nesse nível antes de descer à classe exata.
export const VEHICLE_PORTES = Object.freeze([
  { id: "leve", name: "Leve" },
  { id: "medio", name: "Médio" },
  { id: "pesado", name: "Pesado" },
]);

// `payloadKgMax` é o teto TÍPICO da classe no mercado brasileiro, para conferir
// se a carga cabe. Não é limite legal: o legal está no CRLV do veículo, e é o
// cadastro que manda. Serve para avisar, nunca para bloquear.
export const VEHICLE_CLASSES = Object.freeze([
  {
    id: "moto",
    name: "Moto",
    porte: "leve",
    axles: 2,
    payloadKgMin: 0,
    payloadKgMax: 60,
    cnh: "A",
    urbanRestricted: false,
    billingUnits: ["pacote", "entrega"],
    energias: ["electric", "diesel"],
    notes: "Moto-frete. Entrega unitária e documento; não leva volume.",
  },
  {
    id: "utilitario",
    name: "Utilitário leve",
    porte: "leve",
    axles: 2,
    payloadKgMin: 60,
    payloadKgMax: 800,
    cnh: "B",
    urbanRestricted: false,
    billingUnits: ["pacote", "entrega", "coleta"],
    energias: ["electric", "hybrid", "diesel"],
    notes: "Fiorino, Saveiro, Kangoo. Last mile de baixo volume.",
  },
  {
    id: "van",
    name: "Van / Furgão",
    porte: "leve",
    axles: 2,
    payloadKgMin: 800,
    payloadKgMax: 1600,
    cnh: "B",
    urbanRestricted: false,
    billingUnits: ["pacote", "entrega", "coleta", "transferencia"],
    energias: ["electric", "hybrid", "diesel"],
    notes: "Sprinter, Ducato, Master. Espinha dorsal do last mile de e-commerce.",
  },
  {
    id: "vuc",
    name: "VUC",
    porte: "medio",
    axles: 2,
    payloadKgMin: 1600,
    payloadKgMax: 3500,
    cnh: "B",
    // A razão de o VUC existir como classe: ele entra em via com restrição de
    // dimensão onde caminhão não entra.
    urbanRestricted: true,
    billingUnits: ["entrega", "coleta", "transferencia", "loja"],
    energias: ["electric", "hybrid", "biomethane", "diesel"],
    notes: "Veículo Urbano de Carga. Acessa via restrita por dimensão.",
  },
  {
    id: "tres_quartos",
    name: "3/4",
    porte: "medio",
    axles: 2,
    payloadKgMin: 3500,
    payloadKgMax: 5000,
    cnh: "C",
    urbanRestricted: false,
    billingUnits: ["entrega", "transferencia", "loja"],
    energias: ["electric", "biomethane", "diesel"],
    notes: "Distribuição urbana e regional de volume médio.",
  },
  {
    id: "toco",
    name: "Toco",
    porte: "medio",
    axles: 2,
    payloadKgMin: 5000,
    payloadKgMax: 8000,
    cnh: "C",
    urbanRestricted: false,
    billingUnits: ["viagem", "transferencia", "loja", "tonelada"],
    energias: ["biomethane", "diesel"],
    notes: "Dois eixos, carga seca. Transferência regional.",
  },
  {
    id: "truck",
    name: "Truck",
    porte: "pesado",
    axles: 3,
    payloadKgMin: 8000,
    payloadKgMax: 14000,
    cnh: "C",
    urbanRestricted: false,
    billingUnits: ["viagem", "transferencia", "tonelada"],
    energias: ["biomethane", "diesel"],
    notes: "Três eixos. Middle mile entre centros de distribuição.",
  },
  {
    id: "bitruck",
    name: "Bitruck",
    porte: "pesado",
    axles: 4,
    payloadKgMin: 14000,
    payloadKgMax: 18000,
    cnh: "C",
    urbanRestricted: false,
    billingUnits: ["viagem", "tonelada"],
    energias: ["biomethane", "diesel"],
    notes: "Quatro eixos, chassi único.",
  },
  {
    id: "carreta",
    name: "Carreta",
    porte: "pesado",
    axles: 5,
    payloadKgMin: 18000,
    payloadKgMax: 30000,
    // Carreta é combinação: cavalo mecânico mais semirreboque. Exige CNH E.
    cnh: "E",
    urbanRestricted: false,
    billingUnits: ["viagem", "tonelada"],
    // Carreta elétrica não é realidade comercial no Brasil hoje. Declarar
    // `electric` aqui faria a proposta prometer emissão zero num veículo que
    // não entrega isso.
    energias: ["biomethane", "diesel"],
    notes: "Cavalo mecânico com semirreboque. Line haul de longa distância.",
  },
  {
    id: "bitrem",
    name: "Bitrem",
    porte: "pesado",
    axles: 7,
    payloadKgMin: 30000,
    payloadKgMax: 37000,
    cnh: "E",
    urbanRestricted: false,
    billingUnits: ["viagem", "tonelada"],
    energias: ["diesel"],
    notes: "Dois semirreboques. Alta capacidade em rota autorizada.",
  },
  {
    id: "rodotrem",
    name: "Rodotrem",
    porte: "pesado",
    axles: 9,
    payloadKgMin: 37000,
    payloadKgMax: 57000,
    cnh: "E",
    urbanRestricted: false,
    billingUnits: ["viagem", "tonelada"],
    energias: ["diesel"],
    notes: "Combinação de maior capacidade; exige AET na rota.",
  },
]);

const POR_ID = new Map(VEHICLE_CLASSES.map((classe) => [classe.id, classe]));

export const isVehicleClass = (valor) => POR_ID.has(texto(valor).toLowerCase());

export const vehicleClass = (valor) => POR_ID.get(texto(valor).toLowerCase()) || null;

// Ordem de porte, para relatório e seletor. Sem isso, a lista sai alfabética e
// "bitrem, bitruck, carreta, moto..." não é uma escala.
export const vehicleClassOrder = (valor) =>
  VEHICLE_CLASSES.findIndex((classe) => classe.id === texto(valor).toLowerCase());

// ---------------------------------------------------------------------------
// Normalização: o que vem de fora nunca vem no vocabulário de dentro
// ---------------------------------------------------------------------------

// Apelidos que aparecem em planilha de embarcador, em cadastro de rastreador e
// no TMS. Cada linha aqui é uma grafia que já foi vista ou é previsível.
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
  "carreta simples": "carreta", "cavalo + carreta": "carreta", "conjunto": "carreta",
  "bi trem": "bitrem", bitren: "bitrem",
  "rodo trem": "rodotrem", rodotren: "rodotrem",
});

const semAcento = (valor) =>
  texto(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Devolve o id da classe, ou "" quando não reconhece. NUNCA chuta uma classe:
// classificar uma carreta como van erraria custo, cobrança, habilitação e
// restrição urbana de uma vez. "Não sei" é resposta melhor, e a tela pede para
// a pessoa escolher.
export const normalizeVehicleClass = (valor) => {
  const bruto = semAcento(valor).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!bruto) return "";
  const direto = bruto.replace(/\s+/g, "_");
  if (POR_ID.has(direto)) return direto;
  if (POR_ID.has(bruto)) return bruto;
  if (APELIDOS[bruto]) return APELIDOS[bruto];

  // Só depois de falhar no nome exato tentamos por palavra contida — e sempre da
  // classe mais específica para a mais genérica, senão "bitruck" casaria com
  // "truck" e um bitruck viraria truck.
  const porMenção = [
    ["rodotrem", ["rodotrem", "rodo trem"]],
    ["bitrem", ["bitrem", "bi trem"]],
    ["bitruck", ["bitruck", "bi truck"]],
    ["carreta", ["carreta", "cavalo", "semirreboque", "semi reboque"]],
    ["truck", ["truck"]],
    ["toco", ["toco"]],
    ["tres_quartos", ["3/4", "tres quartos"]],
    ["vuc", ["vuc"]],
    ["van", ["van", "furgao", "sprinter", "ducato", "master"]],
    ["utilitario", ["utilitario", "fiorino", "saveiro", "kangoo"]],
    ["moto", ["moto"]],
  ];
  for (const [id, termos] of porMenção) {
    if (termos.some((termo) => bruto.includes(termo))) return id;
  }
  return "";
};

// ---------------------------------------------------------------------------
// Inferência por capacidade — o último recurso
// ---------------------------------------------------------------------------

// Quando o nome não diz nada mas a capacidade diz. Devolve `null` quando o peso
// não cai em faixa nenhuma, e nunca é usada para sobrescrever uma classe já
// declarada: o cadastro sempre manda sobre o palpite.
export const inferClassByPayload = (payloadKg) => {
  const peso = numero(payloadKg);
  if (peso <= 0) return null;
  const achada = VEHICLE_CLASSES.find(
    (classe) => peso > classe.payloadKgMin && peso <= classe.payloadKgMax,
  );
  return achada ? achada.id : null;
};

// ---------------------------------------------------------------------------
// Perguntas que a classe responde
// ---------------------------------------------------------------------------

// A energia é viável nesta classe? É o que impede a proposta de prometer
// emissão zero numa carreta.
export const energiaViavelNaClasse = (classeId, energia) => {
  const classe = vehicleClass(classeId);
  if (!classe) return false;
  return classe.energias.includes(texto(energia).toLowerCase());
};

// A classe pode ser eletrificada hoje? Separa a frota entre o que a promessa
// comercial alcança e o que ainda não.
export const classeEletrificavel = (classeId) => energiaViavelNaClasse(classeId, "electric");

export const cnhExigida = (classeId) => vehicleClass(classeId)?.cnh || "";

export const aceitaUnidadeDeCobranca = (classeId, unidade) => {
  const classe = vehicleClass(classeId);
  if (!classe) return false;
  return classe.billingUnits.includes(texto(unidade).toLowerCase());
};

// A carga cabe? Devolve `null` quando falta dado — não `false`, que leria como
// "não cabe" e recusaria uma viagem possível.
export const cargaCabeNaClasse = (classeId, pesoKg) => {
  const classe = vehicleClass(classeId);
  const peso = numero(pesoKg);
  if (!classe || peso <= 0) return null;
  return peso <= classe.payloadKgMax;
};

// ---------------------------------------------------------------------------
// Retrato da frota por classe
// ---------------------------------------------------------------------------

// Agrupa a frota pela escala de porte, com a contagem de eletrificados. É o
// número que a To Do Green precisa dizer em voz alta: quanto da operação é de
// fato elétrica e quanto ainda não pode ser.
export const frotaPorClasse = (veiculos = []) => {
  const grupos = new Map();
  let semClasse = 0;

  for (const veiculo of veiculos) {
    const id = normalizeVehicleClass(veiculo?.vehicleClass ?? veiculo?.category);
    if (!id) {
      semClasse += 1;
      continue;
    }
    const atual = grupos.get(id) || { classeId: id, total: 0, eletricos: 0, outrasEnergias: 0 };
    atual.total += 1;
    if (texto(veiculo?.energyType).toLowerCase() === "electric") atual.eletricos += 1;
    else atual.outrasEnergias += 1;
    grupos.set(id, atual);
  }

  const linhas = [...grupos.values()]
    .map((grupo) => {
      const classe = vehicleClass(grupo.classeId);
      return {
        ...grupo,
        nome: classe.name,
        porte: classe.porte,
        eletrificavel: classe.energias.includes("electric"),
        cnh: classe.cnh,
      };
    })
    .sort((a, b) => vehicleClassOrder(a.classeId) - vehicleClassOrder(b.classeId));

  const eletrificaveis = linhas.filter((linha) => linha.eletrificavel);
  const totalEletrificavel = eletrificaveis.reduce((soma, linha) => soma + linha.total, 0);
  const eletricos = linhas.reduce((soma, linha) => soma + linha.eletricos, 0);

  return {
    linhas,
    // Veículo sem classe fica VISÍVEL em vez de somado em qualquer grupo: é um
    // problema de cadastro que precisa aparecer.
    semClasse,
    total: linhas.reduce((soma, linha) => soma + linha.total, 0),
    eletricos,
    // Percentual sobre o que É eletrificável, não sobre a frota inteira. Medir
    // contra a frota inteira faria a meta parecer inalcançável por causa das
    // carretas, que hoje não têm versão elétrica.
    percentualEletrificado: totalEletrificavel > 0
      ? Math.round((eletricos / totalEletrificavel) * 1000) / 10
      : null,
    naoEletrificavel: linhas
      .filter((linha) => !linha.eletrificavel)
      .reduce((soma, linha) => soma + linha.total, 0),
  };
};

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export const validateVehicleClass = (veiculo = {}) => {
  const id = texto(veiculo.vehicleClass);
  if (!id) return "Informe a classe do veículo (de moto a carreta).";
  if (!isVehicleClass(id)) return "Classe de veículo desconhecida.";
  const energia = texto(veiculo.energyType);
  if (energia && !energiaViavelNaClasse(id, energia)) {
    const classe = vehicleClass(id);
    return `${classe.name} não opera com ${energia} hoje. Energias possíveis: ${classe.energias.join(", ")}.`;
  }
  return "";
};
