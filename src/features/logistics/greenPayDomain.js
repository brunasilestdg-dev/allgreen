// ===== GreenPay — carteira de ganhos do motorista (fase 1: razão interno) =====
//
// GreenPay NÃO é folha de pagamento. É a carteira do motorista: o quanto ele
// ganhou, de onde veio cada valor, o que está pendente, aprovado ou pago.
//
// Princípio central (o mesmo do estoque e do razão financeiro): o ganho é
// DERIVADO das viagens entregues, nunca digitado. Cada entrega concluída gera
// crédito por entrega + crédito por km, pela régua vigente do espaço. Ajustes
// (bônus, desconto, correção) são lançamentos manuais do gestor, com autor e
// motivo. O saldo é sempre uma SOMA, nunca um número gravado que se corrompe.
//
// Regra de honestidade: sem régua configurada não há ganho — a carteira diz
// "regra não configurada", jamais mostra R$ 0,00 como se fosse o que o
// motorista ganhou. Zero de ganho e ausência de régua são coisas diferentes.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const arredondarReais = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

export const STATUS_GANHO = Object.freeze(["pendente", "aprovado", "pago"]);
export const TIPOS_GANHO = Object.freeze(["entrega", "km", "bonus", "ajuste", "desconto"]);

// A régua de ganhos: quanto o motorista recebe por entrega, por km e o bônus
// por entrega sem ocorrência. Valores em reais. O padrão é ZERO — a operação
// precisa informar os valores reais; até lá a carteira não inventa número.
export const PARAMETROS_GREENPAY_PADRAO = Object.freeze({
  valorPorEntrega: 0,
  valorPorKm: 0,
  bonusEntregaSemOcorrencia: 0,
});

// Uma régua está "configurada" quando de fato paga algo por entrega ou por km.
export const reguaConfigurada = (regra) =>
  !!regra && (num(regra.valorPorEntrega) > 0 || num(regra.valorPorKm) > 0);

export const normalizarRegua = (bruto = {}) => ({
  valorPorEntrega: Math.max(0, arredondarReais(bruto.valorPorEntrega)),
  valorPorKm: Math.max(0, arredondarReais(bruto.valorPorKm)),
  bonusEntregaSemOcorrencia: Math.max(0, arredondarReais(bruto.bonusEntregaSemOcorrencia)),
});

// Deriva os lançamentos de UMA viagem. Só a entrega concluída paga: viagem sem
// `entregueEm` não gera ganho. Cada componente carrega a memória de cálculo,
// para o motorista ver de onde saiu cada real.
export const derivarGanhosDaViagem = (viagem, regra) => {
  if (!viagem || !viagem.entregueEm) return [];
  if (!reguaConfigurada(regra)) return [];

  const km = Math.max(0, num(viagem.distanciaKm));
  const semOcorrencia = num(viagem.ocorrencias) === 0;
  const lancamentos = [];

  const vEntrega = num(regra.valorPorEntrega);
  if (vEntrega > 0) {
    lancamentos.push({
      tipo: "entrega",
      valor: arredondarReais(vEntrega),
      memoria: { base: "valor fixo por entrega concluída", valorPorEntrega: vEntrega },
    });
  }

  const vKm = num(regra.valorPorKm);
  if (vKm > 0 && km > 0) {
    lancamentos.push({
      tipo: "km",
      valor: arredondarReais(vKm * km),
      memoria: { base: "distância rodada na viagem", km, valorPorKm: vKm },
    });
  }

  const bonus = num(regra.bonusEntregaSemOcorrencia);
  if (bonus > 0 && semOcorrencia) {
    lancamentos.push({
      tipo: "bonus",
      valor: arredondarReais(bonus),
      memoria: { base: "entrega sem ocorrência", bonus },
    });
  }

  return lancamentos;
};

// Saldos por status. `aReceber` é o que o motorista já ganhou e ainda não foi
// pago (pendente + aprovado). Um desconto/ajuste negativo entra na conta.
export const saldos = (lancamentos = []) => {
  const s = { pendente: 0, aprovado: 0, pago: 0, total: 0, aReceber: 0 };
  for (const l of lancamentos) {
    const v = num(l.valor);
    s.total = arredondarReais(s.total + v);
    if (l.status === "pago") s.pago = arredondarReais(s.pago + v);
    else if (l.status === "aprovado") s.aprovado = arredondarReais(s.aprovado + v);
    else s.pendente = arredondarReais(s.pendente + v);
  }
  s.aReceber = arredondarReais(s.pendente + s.aprovado);
  return s;
};

// Resumo por período sobre a data de serviço do lançamento.
// `hojeYmd` = "YYYY-MM-DD". Dia = hoje; semana = os últimos 7 dias corridos
// (inclui hoje); mês = mês corrente. As datas são comparadas como texto/UTC
// para não depender do fuso de quem abre a carteira.
export const resumoCarteira = (lancamentos = [], hojeYmd) => {
  const hoje = String(hojeYmd || "").slice(0, 10);
  const hojeDate = new Date(`${hoje}T00:00:00Z`);
  const valido = !Number.isNaN(hojeDate.getTime());
  const seteDiasAtras = valido ? new Date(hojeDate.getTime() - 6 * 86400000) : null;
  const mesCorrente = hoje.slice(0, 7);

  let dia = 0, semana = 0, mes = 0;
  for (const l of lancamentos) {
    const d = String(l.dataServico || "").slice(0, 10);
    if (!d) continue;
    const v = num(l.valor);
    if (d === hoje) dia = arredondarReais(dia + v);
    if (valido) {
      const dDate = new Date(`${d}T00:00:00Z`);
      if (!Number.isNaN(dDate.getTime()) && dDate >= seteDiasAtras && dDate <= hojeDate) {
        semana = arredondarReais(semana + v);
      }
    }
    if (d.slice(0, 7) === mesCorrente) mes = arredondarReais(mes + v);
  }

  return { dia, semana, mes, saldos: saldos(lancamentos) };
};
