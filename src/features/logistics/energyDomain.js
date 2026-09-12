// ===== Gestão de Energia (visão da eletrificação) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// A energia sempre esteve no sistema — só espalhada. Cada veículo já deriva
// kWh estimado (km × consumo), custo e emissões (todoGreenFleetDomain); a rede
// de recarga própria já soma potência (chargingPointsDomain). Aqui os dois
// viram UMA visão de energia: quanto a frota consome, quanto custa, quanto
// emite, e qual a capacidade instalada para recarregar.
//
// Honestidade: o kWh é ESTIMADO (hodômetro × consumo), não medido por sessão
// de recarga — a tela diz isso. Sem frota, indisponível, sem número chutado.

import {
  FLEET_ENERGY_DEFAULTS,
  fleetVehicleMetrics,
  normalizeFleetVehicle,
  summarizeFleet,
} from "./todoGreenFleetDomain.js";
import { resumoPontos } from "./chargingPointsDomain.js";

const round = (valor, casas = 2) => {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
};

export const resumoEnergia = (vehicles = [], pontos = [], assumptions = {}) => {
  const lista = Array.isArray(vehicles) ? vehicles : [];
  const energyCostPerKwh = Number(assumptions.energyCostPerKwh) > 0
    ? Number(assumptions.energyCostPerKwh)
    : FLEET_ENERGY_DEFAULTS.energyCostPerKwh;

  const resumoFrota = summarizeFleet(lista, { energyCostPerKwh });
  const rede = resumoPontos(pontos);

  const porVeiculo = lista.map((v) => {
    const n = normalizeFleetVehicle(v);
    const m = fleetVehicleMetrics(n, { energyCostPerKwh });
    return {
      id: n.id,
      placa: n.plate,
      prefixo: n.prefix,
      tipoEnergia: n.energyType,
      energiaKwh: round(m.estimatedEnergyKwh, 1),
      custoEstimado: round(m.estimatedEnergyKwh * energyCostPerKwh),
      emissoesKg: round(m.operationalEmissionsKgCo2e, 1),
    };
  });

  const eletricos = porVeiculo.filter((v) => v.tipoEnergia === "electric").length;
  const topConsumidores = porVeiculo
    .filter((v) => v.energiaKwh > 0)
    .sort((a, b) => b.energiaKwh - a.energiaKwh)
    .slice(0, 5);

  const energiaKwh = round(resumoFrota.energyKwh, 1);
  const disponivel = lista.length > 0 && energiaKwh > 0;

  return {
    disponivel,
    energiaKwh,
    custoEstimado: round(energiaKwh * energyCostPerKwh),
    emissoesKg: round(resumoFrota.emissionsKgCo2e, 1),
    energyCostPerKwh,
    frota: { total: lista.length, eletricos },
    rede: {
      pontos: rede.total,
      ativos: rede.ativos,
      potenciaTotalKw: rede.potenciaTotalKw,
      servemPesado: rede.servemPesado,
    },
    topConsumidores,
  };
};
