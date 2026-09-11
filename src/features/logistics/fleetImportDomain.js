// ===== Importar a frota em massa (bloco 01 · eletrificação) =====
//
// A frota real da To Do Green era cadastrada um veículo por vez. Quem chega com
// dez, trinta, cem elétricos já rodando não vai redigitar tudo. Esta camada é
// pura sobre a planilha: lê as linhas, reconhece as colunas em português (com
// apelidos), normaliza cada veículo no formato que o cadastro já usa, e
// classifica cada linha em NOVO, DUPLICADO ou INVÁLIDO — nunca grava.
//
// Duas regras da vertical viajam aqui, iguais às do cadastro um-a-um:
//   1) a frota operacional desta vertical é ELÉTRICA — energia impossível na
//      classe é recusada (não se promete emissão zero numa carreta a diesel);
//   2) a classe (moto→carreta) é reconhecida, derivada do peso ou da categoria,
//      nunca chutada: classe errada erra custo, cobrança, habilitação e
//      restrição urbana de uma vez. Sem classe reconhecível, a linha é inválida
//      e a tela pede a correção.
//
// O servidor RE-VALIDA tudo (nunca confia no cliente) e é a autoridade sobre a
// deduplicação por placa contra o que já existe. Aqui o mesmo cálculo roda antes
// só para a pessoa ver o retrato antes de confirmar.

import { parseBrNumber } from "../../domain.js";
import { normalizePlate } from "./todoGreenFleetDomain.js";
import {
  inferClassByPayload,
  normalizeVehicleClass,
  validateVehicleClass,
  vehicleClass,
} from "./vehicleClassDomain.js";

const texto = (valor) => String(valor ?? "").trim();
// Reduz um cabeçalho a letras/dígitos separados por espaço: "Autonomia (km)" e
// "autonomia km" caem na mesma chave, "Consumo kWh/km" vira "consumo kwh km".
const chaveNormalizada = (valor) =>
  texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Placa Mercosul (AAA0A00) ou modelo antigo (AAA0000), depois de tirar traço/espaço.
const PLACA_VALIDA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

// Colunas aceitas, cada uma com seus apelidos (na forma normalizada). A primeira
// de cada lista é o nome "oficial" que o modelo exportado usa.
export const COLUNAS_IMPORTACAO_FROTA = Object.freeze([
  { campo: "prefix", titulo: "Prefixo", apelidos: ["prefixo", "prefix", "codigo", "frota", "id frota"], exigido: true },
  { campo: "plate", titulo: "Placa", apelidos: ["placa", "plate"], exigido: true },
  { campo: "vehicleClass", titulo: "Classe", apelidos: ["classe", "tipo", "tipo de veiculo", "categoria veiculo", "vehicle class"] },
  { campo: "manufacturer", titulo: "Fabricante", apelidos: ["fabricante", "marca", "manufacturer"] },
  { campo: "model", titulo: "Modelo", apelidos: ["modelo", "model"] },
  { campo: "modelYear", titulo: "Ano", apelidos: ["ano", "ano modelo", "model year"] },
  { campo: "operationalUnit", titulo: "Unidade", apelidos: ["unidade", "unidade operacional", "base", "filial"] },
  { campo: "costCenter", titulo: "Centro de custo", apelidos: ["centro de custo", "cost center", "cc"] },
  { campo: "payloadKg", titulo: "Capacidade (kg)", apelidos: ["capacidade kg", "carga kg", "payload", "payload kg", "capacidade de carga", "capacidade de carga kg"] },
  { campo: "batteryCapacityKwh", titulo: "Bateria (kWh)", apelidos: ["bateria kwh", "capacidade da bateria", "capacidade bateria", "capacidade bateria kwh", "battery kwh", "bateria"] },
  { campo: "batterySohPercent", titulo: "Saúde da bateria (%)", apelidos: ["soh", "saude da bateria", "saude bateria", "battery soh", "soh percent"] },
  { campo: "energyConsumptionKwhPerKm", titulo: "Consumo (kWh/km)", apelidos: ["consumo", "consumo kwh km", "kwh km", "consumo kwh", "consumo energia"] },
  { campo: "nominalRangeKm", titulo: "Autonomia (km)", apelidos: ["autonomia", "autonomia km", "autonomia nominal", "range", "alcance"] },
  { campo: "realRangeKm", titulo: "Autonomia real (km)", apelidos: ["autonomia real", "autonomia real km", "real range"] },
  { campo: "odometerKm", titulo: "Hodômetro (km)", apelidos: ["odometro", "hodometro", "km", "km atual", "odometer"] },
  { campo: "acquisitionValue", titulo: "Valor de aquisição", apelidos: ["valor", "valor de aquisicao", "valor aquisicao", "acquisition value", "valor do veiculo"] },
  { campo: "category", titulo: "Categoria (texto livre)", apelidos: ["categoria", "descricao", "category"] },
]);

const NUMERICOS = new Set([
  "modelYear", "payloadKg", "batteryCapacityKwh", "batterySohPercent",
  "energyConsumptionKwhPerKm", "nominalRangeKm", "realRangeKm", "odometerKm", "acquisitionValue",
]);

// Modelo pronto para a pessoa copiar: cabeçalho + uma linha de exemplo.
export const MODELO_CSV_FROTA = [
  "Prefixo,Placa,Classe,Fabricante,Modelo,Ano,Unidade,Capacidade (kg),Bateria (kWh),Saúde da bateria (%),Consumo (kWh/km),Autonomia (km),Hodômetro (km),Valor de aquisição",
  "TDG-001,ABC1D23,VUC,JAC,iEV1200,2024,São Paulo,3000,100,98,0,47,240,12500,380000",
].join("\n");

const indexarLinha = (linha) => {
  const indice = new Map();
  for (const [chave, valor] of Object.entries(linha || {})) {
    const k = chaveNormalizada(chave);
    if (k && !indice.has(k)) indice.set(k, valor);
  }
  return indice;
};

const pegar = (indice, apelidos) => {
  for (const apelido of apelidos) {
    const valor = indice.get(apelido);
    if (texto(valor)) return texto(valor);
  }
  return "";
};

// Uma linha da planilha → o corpo do veículo no formato do cadastro. Números em
// padrão brasileiro (vírgula decimal) passam pelo parser único do repo.
const linhaParaVeiculo = (linha) => {
  const indice = indexarLinha(linha);
  const veiculo = {};
  for (const { campo, apelidos } of COLUNAS_IMPORTACAO_FROTA) {
    const bruto = pegar(indice, apelidos);
    if (campo === "modelYear") {
      const ano = Math.trunc(parseBrNumber(bruto));
      veiculo.modelYear = ano > 0 ? ano : null;
    } else if (NUMERICOS.has(campo)) {
      veiculo[campo] = bruto ? Math.max(0, parseBrNumber(bruto)) : 0;
    } else {
      veiculo[campo] = bruto;
    }
  }
  veiculo.energyType = "electric";
  return veiculo;
};

// Reconhece a classe: declarada na coluna, senão derivada do peso, senão da
// categoria em texto livre. Vazio quando nada dá uma classe conhecida.
const resolverClasse = (veiculo) =>
  normalizeVehicleClass(veiculo.vehicleClass) ||
  inferClassByPayload(veiculo.payloadKg) ||
  normalizeVehicleClass(veiculo.category) ||
  "";

// Recebe as linhas já parseadas (objetos com cabeçalho→valor) e devolve o
// retrato: cada linha classificada e o resumo. `placasExistentes` são as placas
// que já estão no cadastro — a autoridade final é o servidor, isto é a prévia.
export const analisarLinhasDeFrota = (linhas = [], { placasExistentes = [] } = {}) => {
  const jaExistem = new Set((placasExistentes || []).map(normalizePlate).filter(Boolean));
  const vistasNoLote = new Set();
  const analisadas = [];

  (Array.isArray(linhas) ? linhas : []).forEach((linha, i) => {
    const veiculo = linhaParaVeiculo(linha);
    const numero = i + 1;
    const placaNorm = normalizePlate(veiculo.plate);

    if (!veiculo.prefix) {
      analisadas.push({ numero, veiculo, status: "invalido", erro: "Informe o prefixo do veículo." });
      return;
    }
    if (!placaNorm) {
      analisadas.push({ numero, veiculo, status: "invalido", erro: "Informe a placa do veículo." });
      return;
    }
    if (!PLACA_VALIDA.test(placaNorm)) {
      analisadas.push({ numero, veiculo, status: "invalido", erro: `Placa inválida: ${veiculo.plate}.` });
      return;
    }

    const classe = resolverClasse(veiculo);
    if (!classe) {
      analisadas.push({ numero, veiculo, status: "invalido", erro: "Classe não reconhecida (de moto a carreta)." });
      return;
    }
    const erroClasse = validateVehicleClass({ vehicleClass: classe, energyType: veiculo.energyType });
    if (erroClasse) {
      analisadas.push({ numero, veiculo, status: "invalido", erro: erroClasse });
      return;
    }
    veiculo.vehicleClass = classe;

    if (jaExistem.has(placaNorm)) {
      analisadas.push({ numero, veiculo, status: "duplicado", erro: `Placa ${veiculo.plate} já está na frota.` });
      return;
    }
    if (vistasNoLote.has(placaNorm)) {
      analisadas.push({ numero, veiculo, status: "duplicado", erro: `Placa ${veiculo.plate} repetida na planilha.` });
      return;
    }
    vistasNoLote.add(placaNorm);

    const classeInfo = vehicleClass(classe);
    analisadas.push({
      numero,
      veiculo,
      status: "novo",
      classeNome: classeInfo?.name || "",
    });
  });

  const conta = (status) => analisadas.filter((l) => l.status === status).length;
  return {
    linhas: analisadas,
    resumo: {
      total: analisadas.length,
      novos: conta("novo"),
      duplicados: conta("duplicado"),
      invalidos: conta("invalido"),
    },
    // Só os corpos prontos para o servidor — o que a tela envia ao confirmar.
    importaveis: analisadas.filter((l) => l.status === "novo").map((l) => l.veiculo),
  };
};

export const analisarPlanilhaDeFrota = async (texto, opcoes = {}) => {
  // parseDelimitedText é síncrono; o async mantém a porta aberta para XLSX depois.
  const { parseDelimitedText } = await import("../../domain/importacoes.js");
  return analisarLinhasDeFrota(parseDelimitedText(texto), opcoes);
};
