// ===== Green On B2B — conta corporativa (bloco 13) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// A conta B2B do Green On é a mesma rede de recarga do B2C, com três coisas a
// mais: (1) a empresa é a pagadora, não a pessoa; (2) o motorista tem LIMITE
// (por sessão, por dia, por mês) que a empresa configura; (3) o faturamento é
// consolidado no fim do ciclo.
//
// Princípio que sustenta o módulo: o limite é REGRA (não avisa depois — recusa
// antes). E o consumo autorizado é DERIVADO do que a rede registrou; o valor
// total nunca é digitado, é sempre a soma das sessões. Isso protege a empresa
// de erro humano e o motorista de cobrança que ele não fez.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const arredondarReais = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
export const arredondarKwh = (v) => Math.round(num(v) * 1000) / 1000;

// Ciclos permitidos para limite/faturamento. "sessao" = por autorização
// individual; "diario"/"mensal" acumulam por período.
export const CICLOS_LIMITE = Object.freeze(["sessao", "diario", "mensal"]);

// Um limite "não configurado" é DIFERENTE de "zero". Zero = a empresa proibiu
// aquele driver de carregar; ausência = sem teto. O predicado abaixo respeita
// essa distinção.
export const semLimite = (limite) => limite == null || limite === "" || Number.isNaN(Number(limite));

// Normaliza a política de limites configurada para um motorista/veículo.
export const normalizarLimites = (bruto = {}) => ({
  porSessaoKwh: semLimite(bruto.porSessaoKwh) ? null : Math.max(0, arredondarKwh(bruto.porSessaoKwh)),
  porSessaoReais: semLimite(bruto.porSessaoReais) ? null : Math.max(0, arredondarReais(bruto.porSessaoReais)),
  porDiaKwh: semLimite(bruto.porDiaKwh) ? null : Math.max(0, arredondarKwh(bruto.porDiaKwh)),
  porDiaReais: semLimite(bruto.porDiaReais) ? null : Math.max(0, arredondarReais(bruto.porDiaReais)),
  porMesKwh: semLimite(bruto.porMesKwh) ? null : Math.max(0, arredondarKwh(bruto.porMesKwh)),
  porMesReais: semLimite(bruto.porMesReais) ? null : Math.max(0, arredondarReais(bruto.porMesReais)),
});

// Soma consumo autorizado num período. `sessoes` = [{ dataYmd, kwh, custo,
// status }]; considera SÓ `status === "autorizada"` ou `"paga"` — sessão
// recusada não conta.
const somarConsumo = (sessoes = [], { dia, mes } = {}) => {
  let kwh = 0, reais = 0;
  for (const s of sessoes) {
    if (!s || (s.status && s.status !== "autorizada" && s.status !== "paga")) continue;
    const d = String(s.dataYmd || "").slice(0, 10);
    if (dia && d !== dia) continue;
    if (mes && d.slice(0, 7) !== mes) continue;
    kwh = arredondarKwh(kwh + num(s.kwh));
    reais = arredondarReais(reais + num(s.custo));
  }
  return { kwh, reais };
};

// A decisão de autorizar UMA nova sessão. Devolve `autorizada` (bool),
// `motivo` (uma string curta) e `limiteQueBateu` (qual teto travou). Se
// tudo passa, `autorizada: true` e `motivo: "dentro-dos-limites"`.
//
// A demanda é a estimativa de kWh e reais QUE A SESSÃO consumiria; a rede
// calcula isso ao iniciar a recarga (potência × tempo previsto).
export const autorizarSessao = ({ demanda, limites, sessoesAnteriores, hojeYmd }) => {
  const l = normalizarLimites(limites);
  const kwhPedido = Math.max(0, arredondarKwh(demanda?.kwh));
  const reaisPedido = Math.max(0, arredondarReais(demanda?.reais));
  const hoje = String(hojeYmd || "").slice(0, 10);
  const mes = hoje.slice(0, 7);

  const excede = (limite, valor) => limite != null && valor > limite;

  if (excede(l.porSessaoKwh, kwhPedido))
    return { autorizada: false, motivo: "limite-sessao-kwh", limiteQueBateu: "porSessaoKwh" };
  if (excede(l.porSessaoReais, reaisPedido))
    return { autorizada: false, motivo: "limite-sessao-reais", limiteQueBateu: "porSessaoReais" };

  const consumoDia = somarConsumo(sessoesAnteriores, { dia: hoje });
  if (excede(l.porDiaKwh, consumoDia.kwh + kwhPedido))
    return { autorizada: false, motivo: "limite-dia-kwh", limiteQueBateu: "porDiaKwh" };
  if (excede(l.porDiaReais, consumoDia.reais + reaisPedido))
    return { autorizada: false, motivo: "limite-dia-reais", limiteQueBateu: "porDiaReais" };

  const consumoMes = somarConsumo(sessoesAnteriores, { mes });
  if (excede(l.porMesKwh, consumoMes.kwh + kwhPedido))
    return { autorizada: false, motivo: "limite-mes-kwh", limiteQueBateu: "porMesKwh" };
  if (excede(l.porMesReais, consumoMes.reais + reaisPedido))
    return { autorizada: false, motivo: "limite-mes-reais", limiteQueBateu: "porMesReais" };

  return { autorizada: true, motivo: "dentro-dos-limites", limiteQueBateu: null };
};

// Fatura consolidada do CICLO da conta. `ciclo` = { inicioYmd, fimYmd }.
// Agrega sessões autorizadas/pagas dentro do intervalo. Um veículo/driver que
// não aparece no ciclo NÃO entra com R$ 0,00 — sai da lista (zero é dado, não
// ausência).
export const faturaConsolidada = (sessoes = [], ciclo = {}) => {
  const inicio = String(ciclo.inicioYmd || "").slice(0, 10);
  const fim = String(ciclo.fimYmd || "").slice(0, 10);
  const validas = sessoes.filter((s) => {
    if (!s) return false;
    if (s.status && s.status !== "autorizada" && s.status !== "paga") return false;
    const d = String(s.dataYmd || "").slice(0, 10);
    if (!d) return false;
    if (inicio && d < inicio) return false;
    if (fim && d > fim) return false;
    return true;
  });

  const porVeiculo = new Map();
  const porMotorista = new Map();
  let totalKwh = 0, totalReais = 0, sessoesCount = 0;

  for (const s of validas) {
    const kwh = Math.max(0, num(s.kwh));
    const reais = Math.max(0, num(s.custo));
    totalKwh = arredondarKwh(totalKwh + kwh);
    totalReais = arredondarReais(totalReais + reais);
    sessoesCount += 1;

    if (s.veiculoId) {
      const cur = porVeiculo.get(s.veiculoId) || { veiculoId: s.veiculoId, kwh: 0, reais: 0, sessoes: 0 };
      cur.kwh = arredondarKwh(cur.kwh + kwh);
      cur.reais = arredondarReais(cur.reais + reais);
      cur.sessoes += 1;
      porVeiculo.set(s.veiculoId, cur);
    }
    if (s.motoristaId) {
      const cur = porMotorista.get(s.motoristaId) || { motoristaId: s.motoristaId, kwh: 0, reais: 0, sessoes: 0 };
      cur.kwh = arredondarKwh(cur.kwh + kwh);
      cur.reais = arredondarReais(cur.reais + reais);
      cur.sessoes += 1;
      porMotorista.set(s.motoristaId, cur);
    }
  }

  return {
    ciclo: { inicioYmd: inicio || null, fimYmd: fim || null },
    totalKwh,
    totalReais,
    sessoes: sessoesCount,
    veiculos: Array.from(porVeiculo.values()).sort((a, b) => b.reais - a.reais),
    motoristas: Array.from(porMotorista.values()).sort((a, b) => b.reais - a.reais),
  };
};

// Custo por quilômetro rodado no ciclo: gasto total / km rodados no mesmo
// período. Sem km, devolve null (não invento denominador).
export const custoPorKm = (fatura, kmRodadosNoCiclo) => {
  const km = num(kmRodadosNoCiclo);
  if (!(km > 0)) return null;
  const reais = num(fatura?.totalReais);
  return Math.round((reais / km) * 10000) / 10000;
};
