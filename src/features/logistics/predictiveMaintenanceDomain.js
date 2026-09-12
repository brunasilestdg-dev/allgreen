// ===== Manutenção preditiva (bloco 02 Fleet Management) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// A frota já avisa a manutenção VENCIDA (fleetAlerts, por data). O que faltava
// era a previsão: em quantos dias o veículo bate o próximo marco de km de
// revisão, no ritmo que ele de fato roda. Nada de sensor mágico — é o hodômetro
// (real) cruzado com o km/dia derivado das operações que já rodaram. O gestor vê
// "faltam ~12 dias" e agenda antes de quebrar, em vez de reagir à falha.
//
// Honestidade (regra da vertical): sem hodômetro, indisponível. Sem ritmo de km
// (uma operação só, ou nenhuma com distância), a tela mostra "faltam X km" mas
// NÃO a data — sem ritmo não se data, e não se inventa. O intervalo de revisão
// é a régua PADRÃO editável, não uma leitura da montadora. A previsão por km é
// para o PRÓXIMO marco; o vencido de fato continua vindo da data agendada.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (v, casas = 0) => {
  const f = 10 ** casas;
  return Math.round(num(v) * f) / f;
};
const diaMs = 86400000;
const parseDia = (iso) => {
  const t = Date.parse(String(iso || "").slice(0, 10));
  return Number.isFinite(t) ? t : null;
};

// Régua padrão: revisão a cada 10.000 km. Editável — é assumption, não a tabela
// da montadora.
export const INTERVALO_REVISAO_PADRAO_KM = 10000;
export const DIAS_ATENCAO = 30; // dentro de 30 dias da revisão → atenção
export const DIAS_CRITICO = 7; // dentro de 7 dias → crítico

// km rodados por dia, a partir das operações da placa. Precisa de pelo menos
// duas datas distintas e alguma distância; senão, null (não se estima ritmo de
// um ponto só).
export const taxaKmPorDia = (operacoes = []) => {
  const lista = (Array.isArray(operacoes) ? operacoes : [])
    .map((o) => ({ km: num(o?.distanciaKm), dia: parseDia(o?.entregueEm || o?.dataServico) }))
    .filter((o) => o.dia != null);
  if (lista.length < 2) return null;
  const kmTotal = lista.reduce((s, o) => s + o.km, 0);
  if (kmTotal <= 0) return null;
  const dias = lista.map((o) => o.dia);
  const spanDias = (Math.max(...dias) - Math.min(...dias)) / diaMs;
  if (spanDias < 1) return null; // tudo no mesmo dia: sem ritmo diário
  return round(kmTotal / spanDias, 1);
};

// km até o próximo marco de revisão. Assume revisões na grade de km (a cada
// intervalo): km desde o último marco = odômetro mod intervalo; falta o resto.
// Sem hodômetro (0), indisponível.
export const kmAteRevisao = (odometerKm, intervaloKm = INTERVALO_REVISAO_PADRAO_KM) => {
  const odo = num(odometerKm);
  const intervalo = num(intervaloKm) > 0 ? num(intervaloKm) : INTERVALO_REVISAO_PADRAO_KM;
  if (odo <= 0) return null;
  const resto = odo % intervalo;
  return round(resto === 0 ? intervalo : intervalo - resto);
};

// Faixa da previsão pela quantidade de dias até a revisão. Sem ritmo (dias
// null), é "sem-ritmo": sabe-se o km, não a data.
export const faixaPrevisao = (diasAte) => {
  if (diasAte == null) return "sem-ritmo";
  if (diasAte <= DIAS_CRITICO) return "critico";
  if (diasAte <= DIAS_ATENCAO) return "atencao";
  return "ok";
};

// A previsão de um veículo. Cruza o marco de km (previsto pelo ritmo) com a
// data agendada (nextMaintenanceAt): vale a que vier primeiro.
export const preverManutencao = ({
  odometerKm = 0,
  kmPorDia = null,
  intervaloKm = INTERVALO_REVISAO_PADRAO_KM,
  nextMaintenanceAt = "",
  hoje = new Date().toISOString().slice(0, 10),
} = {}) => {
  const kmAte = kmAteRevisao(odometerKm, intervaloKm);
  const hojeMs = parseDia(hoje);
  const ritmo = num(kmPorDia);

  if (kmAte == null) {
    return {
      disponivel: false,
      motivo: "Cadastre o hodômetro do veículo para prever a próxima revisão.",
    };
  }

  const diasPorKm = ritmo > 0 ? Math.ceil(kmAte / ritmo) : null;
  const dataPrevistaKm = diasPorKm != null && hojeMs != null
    ? new Date(hojeMs + diasPorKm * diaMs).toISOString().slice(0, 10)
    : null;

  const dataAgendada = parseDia(nextMaintenanceAt) != null ? String(nextMaintenanceAt).slice(0, 10) : null;

  // A data efetiva é a mais próxima entre a prevista por km e a agendada.
  let dataEfetiva = null;
  let origemEfetiva = null;
  const candidatas = [];
  if (dataPrevistaKm) candidatas.push(["km", dataPrevistaKm]);
  if (dataAgendada) candidatas.push(["agenda", dataAgendada]);
  if (candidatas.length) {
    candidatas.sort((a, b) => a[1].localeCompare(b[1]));
    [origemEfetiva, dataEfetiva] = candidatas[0];
  }

  // Dias até a data efetiva (para a faixa). Data agendada no passado → 0.
  const efetivaMs = parseDia(dataEfetiva);
  const diasAteEfetiva = efetivaMs != null && hojeMs != null
    ? Math.max(0, Math.round((efetivaMs - hojeMs) / diaMs))
    : null;

  const faixa = faixaPrevisao(diasAteEfetiva);

  const mensagem = kmAte != null && diasAteEfetiva == null
    ? `Faltam ${round(kmAte).toLocaleString("pt-BR")} km para a próxima revisão. Cadastre a data prevista ou deixe rodar para estimar o prazo.`
    : diasAteEfetiva === 0
      ? "Revisão prevista para hoje ou já vencida."
      : `Revisão em ~${diasAteEfetiva} dia(s)${origemEfetiva === "km" ? ` (~${round(kmAte).toLocaleString("pt-BR")} km no ritmo atual)` : " (data agendada)"}.`;

  return {
    disponivel: true,
    kmAteRevisao: kmAte,
    kmPorDia: ritmo > 0 ? round(ritmo, 1) : null,
    diasAteRevisaoPorKm: diasPorKm,
    dataPrevistaPorKm: dataPrevistaKm,
    dataAgendada,
    dataEfetiva,
    origemEfetiva,
    diasAteEfetiva,
    faixa,
    mensagem,
  };
};

// Resumo da frota: previsão por veículo + os que pedem atenção agora, ordenados
// do mais urgente para o menos. `taxasPorId` mapeia id do veículo → km/dia.
export const resumoManutencaoPreditiva = (veiculos = [], taxasPorId = {}, opts = {}) => {
  const intervaloKm = num(opts.intervaloKm) > 0 ? num(opts.intervaloKm) : INTERVALO_REVISAO_PADRAO_KM;
  const hoje = opts.hoje || new Date().toISOString().slice(0, 10);
  const lista = Array.isArray(veiculos) ? veiculos : [];

  const previsoes = lista.map((v) => ({
    id: v?.id || "",
    prefixo: v?.prefix || "",
    placa: v?.plate || "",
    previsao: preverManutencao({
      odometerKm: v?.odometerKm,
      kmPorDia: taxasPorId[v?.id] ?? null,
      intervaloKm,
      nextMaintenanceAt: v?.nextMaintenanceAt,
      hoje,
    }),
  }));

  const ordemFaixa = { critico: 0, atencao: 1, "sem-ritmo": 2, ok: 3 };
  const atencao = previsoes
    .filter((p) => p.previsao.disponivel && ["critico", "atencao"].includes(p.previsao.faixa))
    .sort((a, b) => {
      const fa = ordemFaixa[a.previsao.faixa] - ordemFaixa[b.previsao.faixa];
      if (fa !== 0) return fa;
      return (a.previsao.diasAteEfetiva ?? 9999) - (b.previsao.diasAteEfetiva ?? 9999);
    });

  return {
    total: lista.length,
    comPrevisao: previsoes.filter((p) => p.previsao.disponivel).length,
    criticos: previsoes.filter((p) => p.previsao.faixa === "critico").length,
    atencao,
    previsoes,
  };
};
