// ===== Planejar a eletrificação (Portal do Cliente) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// A jornada que faltava do lado do CLIENTE. Os motores já existem — o
// dimensionamento de frota (quantos elétricos cobrem a operação) e a comparação
// diesel × elétrico (custo, CO₂, payback) —, mas trancados em telas internas.
// Aqui os dois viram UM cenário só, na pergunta que o cliente realmente faz:
// "se eu eletrificar ESTA operação, quantos veículos e carregadores preciso,
// quanto economizo, quanto emito a menos e em quanto tempo o extra da compra se
// paga?".
//
// Honestidade (regra da vertical, não gravar custo que ninguém confirmou):
//  - os PORTES são referências técnicas (autonomia, consumo) — ponto de
//    partida que o cliente ajusta ao veículo real, nunca dado gravado;
//  - o preço de compra é do cliente: sem ele o payback volta `null`, jamais um
//    zero inventado (é o que o motor de comparação já faz);
//  - os CARREGADORES são estimativa derivada dos ciclos de recarga, não um
//    número chutado — e a conta fica exposta na tela.

import { dimensionarFrota, PREMISSAS_DIMENSIONAMENTO_PADRAO } from "./fleetSizingDomain.js";
import { compararDieselEletrico, PREMISSAS_COMPARACAO_PADRAO } from "./fleetComparisonDomain.js";

const num = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const round = (valor, casas = 2) => {
  const f = 10 ** casas;
  return Math.round(num(valor) * f) / f;
};

// Portes de referência: autonomia e consumo típicos por classe de veículo
// elétrico de carga. São PONTO DE PARTIDA — o cliente confirma com o veículo
// real. Espelham a ordem de grandeza dos padrões do motor (0,30 kWh/km é a base
// do leve; o pesado consome mais por km).
export const PORTES_REFERENCIA = Object.freeze([
  { id: "leve", rotulo: "Leve (van · VUC)", autonomiaKm: 150, kwhPorKm: 0.35 },
  { id: "medio", rotulo: "Médio (3/4 · toco)", autonomiaKm: 200, kwhPorKm: 0.7 },
  { id: "pesado", rotulo: "Pesado (truck · carreta)", autonomiaKm: 250, kwhPorKm: 1.2 },
]);

export const DIAS_UTEIS_MES_PADRAO = 22;

export const porteReferencia = (id) =>
  PORTES_REFERENCIA.find((p) => p.id === id) || PORTES_REFERENCIA[0];

// Estimativa de carregadores derivada dos ciclos de recarga — não é chute.
// Noturno: cada veículo da frota carrega parado à noite, um ponto por veículo.
// Diurno (recarga de oportunidade): as recargas que a operação exige DENTRO da
// janela, convertidas em pontos simultâneos. O mesmo carregador serve noite e
// dia; o que dimensiona a instalação é o maior dos dois.
export const estimarCarregadores = ({
  veiculosTotal,
  veiculosPorDemanda,
  recargasPorVeiculoDia,
  tempoRecargaHoras,
  janelaOperacaoHoras,
} = {}) => {
  const total = Math.max(0, Math.ceil(num(veiculosTotal)));
  const demanda = Math.max(0, Math.ceil(num(veiculosPorDemanda)));
  const recargas = Math.max(0, num(recargasPorVeiculoDia));
  const tRecarga = Math.max(0, num(tempoRecargaHoras));
  const janela = Math.max(0, num(janelaOperacaoHoras));

  const pontosNoturnos = total;
  const recargaHorasDia = demanda * recargas * tRecarga;
  const pontosDiurnos = janela > 0 ? Math.ceil(recargaHorasDia / janela) : 0;
  const carregadores = Math.max(pontosNoturnos, pontosDiurnos);

  return {
    carregadores,
    pontosNoturnos,
    pontosDiurnos,
    recargaHorasDia: round(recargaHorasDia, 1),
  };
};

// O orquestrador. `entrada` é o que o cliente informa; `premissas` são os dois
// blocos editáveis (dimensionamento + comparação) sobrepostos aos padrões.
//
// A demanda diária pode vir direta (`kmPorDia`) ou derivada de entregas
// (`entregasPorDia` × `kmPorEntrega`) — o jeito que o cliente pensa a operação.
export const planejarCenario = (entrada = {}, premissas = {}) => {
  const premissasDim = { ...PREMISSAS_DIMENSIONAMENTO_PADRAO, ...(premissas.dimensionamento || {}) };
  const premissasComp = { ...PREMISSAS_COMPARACAO_PADRAO, ...(premissas.comparacao || {}) };

  const porte = porteReferencia(entrada.porte);
  const autonomiaKm = entrada.autonomiaKm != null && num(entrada.autonomiaKm) > 0
    ? num(entrada.autonomiaKm)
    : porte.autonomiaKm;
  const kwhPorKm = entrada.kwhPorKm != null && num(entrada.kwhPorKm) > 0
    ? num(entrada.kwhPorKm)
    : porte.kwhPorKm;
  const diasUteisMes = num(entrada.diasUteisMes) > 0 ? num(entrada.diasUteisMes) : DIAS_UTEIS_MES_PADRAO;

  const entregasPorDia = Math.max(0, num(entrada.entregasPorDia));
  const kmPorEntrega = Math.max(0, num(entrada.kmPorEntrega));
  const kmPorDiaDireto = Math.max(0, num(entrada.kmPorDia));
  const kmPorDia = entregasPorDia > 0 && kmPorEntrega > 0
    ? entregasPorDia * kmPorEntrega
    : kmPorDiaDireto;
  const kmMes = kmPorDia * diasUteisMes;

  const avisos = [];
  if (kmPorDia <= 0) avisos.push("Informe a quilometragem diária — direta ou por entregas — para montar o cenário.");

  // O consumo elétrico do porte entra na comparação; o resto dos fatores são os
  // padrões editáveis do motor.
  const frota = dimensionarFrota(
    { kmPorDia },
    { autonomiaKm },
    premissasDim,
  );
  const comparacao = compararDieselEletrico(
    {
      kmMes,
      valorEletrico: num(entrada.valorEletrico),
      valorDiesel: num(entrada.valorDiesel),
    },
    { ...premissasComp, eletricoKwhPorKm: kwhPorKm },
  );

  const carregadores = frota.disponivel
    ? estimarCarregadores({
      veiculosTotal: frota.resumo.veiculosTotal,
      veiculosPorDemanda: frota.resumo.veiculosPorDemanda,
      recargasPorVeiculoDia: frota.resumo.recargasPorVeiculoDia,
      tempoRecargaHoras: premissasDim.tempoRecargaHoras,
      janelaOperacaoHoras: premissasDim.janelaOperacaoHoras,
    })
    : null;

  // Custo por entrega: só quando o cliente pensa em entregas. Sem entregas/dia
  // não há denominador honesto — devolve `null`, não um número forçado.
  const entregasMes = entregasPorDia * diasUteisMes;
  const custoPorEntrega = entregasMes > 0
    ? {
      eletrico: round(comparacao.eletrico.operacionalMes / entregasMes),
      diesel: round(comparacao.diesel.operacionalMes / entregasMes),
      economia: round((comparacao.diesel.operacionalMes - comparacao.eletrico.operacionalMes) / entregasMes),
    }
    : null;

  const disponivel = frota.disponivel && comparacao.disponivel;

  return {
    disponivel,
    demanda: {
      kmPorDia: round(kmPorDia, 1),
      kmMes: round(kmMes, 1),
      entregasPorDia: entregasPorDia || null,
      entregasMes: entregasMes || null,
      diasUteisMes,
    },
    veiculo: {
      porte: porte.id,
      porteRotulo: porte.rotulo,
      autonomiaKm: round(autonomiaKm, 1),
      kwhPorKm: round(kwhPorKm, 3),
      referencia: entrada.autonomiaKm == null && entrada.kwhPorKm == null,
    },
    frota,
    comparacao,
    carregadores,
    custoPorEntrega,
    avisos: [...avisos, ...frota.avisos, ...comparacao.avisos],
  };
};
