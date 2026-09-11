// ===== Dimensionamento da frota elétrica (bloco 01 · fatia 2) =====
// Camada pura.
//
// "Quantos elétricos cobrem esta operação?" — a pergunta que a jornada de
// eletrificação faz depois de mapear a demanda. Num diesel a resposta é só
// km ÷ km-por-veículo. No elétrico entra o que o diesel não tem: a AUTONOMIA
// por ciclo e a JANELA DE RECARGA. Um veículo que precisa recarregar no meio
// do dia "gasta" horas da janela parado — e isso muda quantos você precisa.
//
// O modelo é honesto: simula o dia de UM veículo leg a leg (roda até a
// autonomia útil, recarrega 1h30, roda de novo) até a janela de operação
// acabar. Daí sai o km/veículo/dia real; a demanda diária dividida por ele dá
// a frota, com uma reserva para manutenção/disponibilidade. Falta autonomia ou
// demanda? O número não é chutado: volta indisponível com o motivo, como o
// resto da vertical.
//
// As premissas (velocidade média, janela, tempo de recarga, folga de bateria,
// reserva) são REFERÊNCIAS a confirmar — a operação real manda. O tempo de
// recarga padrão é o mesmo do roteirizador: 1h30 por ciclo (frota pesada).

const num = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const arredondar = (valor, casas = 1) => {
  const f = 10 ** casas;
  return Math.round(num(valor) * f) / f;
};

export const PREMISSAS_DIMENSIONAMENTO_PADRAO = Object.freeze({
  velocidadeMediaKmh: 40, // média operacional urbana/regional; a operação confirma
  janelaOperacaoHoras: 10, // jornada útil do veículo no dia
  tempoRecargaHoras: 1.5, // 1h30 por ciclo, igual ao roteirizador (MINUTOS_RECARGA)
  folgaAutonomiaPercent: 15, // não descarrega até 0%: reserva de segurança
  reservaFrotaPercent: 10, // veículos extras para manutenção/indisponibilidade
});

// Campos editáveis da premissa (rótulo + limites), para a tela renderizar sem
// duplicar a regra. Espelha o padrão de PREMISSAS_ATIVO_FIELDS.
export const PREMISSAS_DIMENSIONAMENTO_FIELDS = Object.freeze([
  { chave: "velocidadeMediaKmh", rotulo: "Velocidade média", sufixo: "km/h", min: 5, max: 120 },
  { chave: "janelaOperacaoHoras", rotulo: "Janela de operação", sufixo: "h/dia", min: 1, max: 24 },
  { chave: "tempoRecargaHoras", rotulo: "Tempo de recarga", sufixo: "h", min: 0, max: 12 },
  { chave: "folgaAutonomiaPercent", rotulo: "Folga de bateria", sufixo: "%", min: 0, max: 60 },
  { chave: "reservaFrotaPercent", rotulo: "Reserva da frota", sufixo: "%", min: 0, max: 100 },
]);

// Máximo de km que UM veículo cobre no dia, dada a autonomia útil e o custo em
// tempo das recargas dentro da janela. Simula leg a leg (começa carregado).
export const kmPorVeiculoDia = ({
  autonomiaUtilKm,
  velocidadeMediaKmh,
  tempoRecargaHoras,
  janelaOperacaoHoras,
} = {}) => {
  const a = num(autonomiaUtilKm);
  const v = num(velocidadeMediaKmh);
  const r = Math.max(0, num(tempoRecargaHoras));
  const W = num(janelaOperacaoHoras);
  if (a <= 0 || v <= 0 || W <= 0) return { km: 0, recargas: 0, horasDirigindo: 0, horasRecarga: 0 };

  let km = 0;
  let tempo = 0;
  let recargas = 0;
  let horasRecarga = 0;
  const tempoLegCheio = a / v; // horas para esgotar uma carga
  // Trava contra laço infinito (janela absurda vs. leg minúsculo).
  for (let leg = 0; leg < 1000 && tempo < W; leg += 1) {
    if (leg > 0) {
      // Precisa recarregar para continuar; sem tempo para isso, o dia acabou.
      if (tempo + r >= W) break;
      tempo += r;
      horasRecarga += r;
      recargas += 1;
    }
    const horasDisponiveis = W - tempo;
    const horasDirigindo = Math.min(tempoLegCheio, horasDisponiveis);
    km += horasDirigindo * v;
    tempo += horasDirigindo;
    if (horasDirigindo < tempoLegCheio) break; // janela esgotou no meio do leg
  }
  return {
    km,
    recargas,
    horasRecarga,
    horasDirigindo: km / v,
  };
};

// A conta principal. `operacao.kmPorDia` é a demanda diária total (todos os
// veículos somados) e `veiculo.autonomiaKm` é a autonomia real da unidade.
export const dimensionarFrota = (operacao = {}, veiculo = {}, premissasEntrada = {}) => {
  const premissas = { ...PREMISSAS_DIMENSIONAMENTO_PADRAO, ...(premissasEntrada || {}) };
  const kmPorDia = num(operacao.kmPorDia);
  const autonomia = num(veiculo.autonomiaKm);
  const folga = Math.min(60, Math.max(0, num(premissas.folgaAutonomiaPercent)));
  const autonomiaUtilKm = autonomia * (1 - folga / 100);

  const avisos = [];
  if (autonomia <= 0) avisos.push("Informe a autonomia real do veículo elétrico para dimensionar.");
  if (kmPorDia <= 0) avisos.push("Informe a quilometragem diária da operação.");

  const perVeiculo = kmPorVeiculoDia({
    autonomiaUtilKm,
    velocidadeMediaKmh: premissas.velocidadeMediaKmh,
    tempoRecargaHoras: premissas.tempoRecargaHoras,
    janelaOperacaoHoras: premissas.janelaOperacaoHoras,
  });

  const disponivel = autonomia > 0 && kmPorDia > 0 && perVeiculo.km > 0;
  if (autonomia > 0 && kmPorDia > 0 && perVeiculo.km <= 0)
    avisos.push("A janela de operação não permite rodar nada com esta autonomia. Reveja janela e recarga.");

  const veiculosPorDemanda = disponivel ? Math.ceil(kmPorDia / perVeiculo.km) : null;
  const reserva = Math.max(0, num(premissas.reservaFrotaPercent));
  const veiculosComReserva = veiculosPorDemanda != null
    ? Math.ceil(veiculosPorDemanda * (1 + reserva / 100))
    : null;
  const veiculosReserva = veiculosComReserva != null ? veiculosComReserva - veiculosPorDemanda : null;

  // O que aperta primeiro: se um veículo precisa recarregar para cumprir o dia,
  // o gargalo é a autonomia/recarga; senão, é só a demanda de quilometragem.
  const gargalo = !disponivel ? null : perVeiculo.recargas > 0 ? "autonomia" : "demanda";

  return {
    disponivel,
    resumo: {
      kmPorDia: arredondar(kmPorDia),
      autonomiaKm: arredondar(autonomia),
      autonomiaUtilKm: arredondar(autonomiaUtilKm),
      kmPorVeiculoDia: arredondar(perVeiculo.km),
      recargasPorVeiculoDia: perVeiculo.recargas,
      horasDirigindoPorVeiculo: arredondar(perVeiculo.horasDirigindo, 2),
      horasRecargaPorVeiculo: arredondar(perVeiculo.horasRecarga, 2),
      veiculosPorDemanda,
      veiculosReserva,
      veiculosTotal: veiculosComReserva,
      gargalo,
    },
    premissas,
    avisos,
  };
};
