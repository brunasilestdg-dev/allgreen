// ===== Greenmob · Locação de frota elétrica (bloco 21) =====
// Camada pura. Sem banco, sem rede.
//
// O que resolve, na ordem em que a titular pediu:
//   contrato de locação · associação veículo × empresa · associação veículo ×
//   motorista · período contratado · uso (km, autonomia, bateria) · avarias
//   registradas · cobrança · prazo de devolução · processo de devolução ·
//   histórico durante a locação · visão ISOLADA por locatário.
//
// Princípios:
// 1. Isolamento POR REGISTRO: um método sozinho não devolve locações — quem
//    chama passa a sessão do locatário; o filtro se aplica antes do resto.
//    Isso é o mesmo desenho do Portal do Cliente (customerPortalDomain).
// 2. Avaria tem MOMENTO: "pré-existente" (no cadastro/retirada) NÃO gera
//    cobrança no fim; "durante a locação" gera. A cobrança sai desse critério,
//    nunca de campo digitado à parte.
// 3. Cobrança é DERIVADA: mensalidade + hora/km excedente + avarias durante a
//    locação. Nunca gravar um "valorAcumulado" que perde a memória — o total
//    é sempre a soma.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const arredondarReais = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const ymd = (v) => String(v || "").slice(0, 10);

export const ESTADO_CONTRATO = Object.freeze(["ativo", "em-devolucao", "devolvido", "cancelado"]);
export const AVARIA_MOMENTO = Object.freeze(["pre-existente", "durante-locacao"]);
export const AVARIA_STATUS = Object.freeze(["registrada", "aprovada-cobranca", "isenta", "reparada"]);

// Cria (ou preenche defaults de) um contrato de locação.
export const criarContrato = (bruto = {}) => ({
  id: String(bruto.id || `rental-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
  locatarioId: bruto.locatarioId || null,
  tenantId: bruto.tenantId || null,
  veiculoId: bruto.veiculoId || null,
  motoristaId: bruto.motoristaId || null,
  inicioYmd: ymd(bruto.inicioYmd),
  fimContratadoYmd: ymd(bruto.fimContratadoYmd),
  devolvidoEmYmd: ymd(bruto.devolvidoEmYmd),
  franquiaKmMes: Math.max(0, num(bruto.franquiaKmMes)),
  precoMensalReais: Math.max(0, arredondarReais(bruto.precoMensalReais)),
  precoKmExcedenteReais: Math.max(0, arredondarReais(bruto.precoKmExcedenteReais)),
  kmSaida: Math.max(0, num(bruto.kmSaida)),
  kmDevolucao: bruto.kmDevolucao != null ? Math.max(0, num(bruto.kmDevolucao)) : null,
  socSaidaPct: bruto.socSaidaPct != null ? Math.max(0, Math.min(100, num(bruto.socSaidaPct))) : null,
  socDevolucaoPct: bruto.socDevolucaoPct != null ? Math.max(0, Math.min(100, num(bruto.socDevolucaoPct))) : null,
  estado: ESTADO_CONTRATO.includes(bruto.estado) ? bruto.estado : "ativo",
  avarias: Array.isArray(bruto.avarias) ? bruto.avarias : [],
  historico: Array.isArray(bruto.historico) ? bruto.historico : [],
});

// Registra avaria com momento explícito. "durante-locacao" é o que vira
// cobrança; "pre-existente" só documenta o estado de saída para não punir
// o locatário depois.
export const registrarAvaria = (contrato, avaria = {}) => {
  const item = {
    id: String(avaria.id || `av-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    descricao: String(avaria.descricao || "").trim(),
    momento: AVARIA_MOMENTO.includes(avaria.momento) ? avaria.momento : "durante-locacao",
    valorReparoReais: Math.max(0, arredondarReais(avaria.valorReparoReais)),
    status: AVARIA_STATUS.includes(avaria.status) ? avaria.status : "registrada",
    registradoEm: avaria.registradoEm || new Date().toISOString(),
    autor: String(avaria.autor || "operacao"),
    evidencia: avaria.evidencia || null,
  };
  return { ...contrato, avarias: [...(contrato.avarias || []), item] };
};

// Meses corridos entre inicio e fim (inteiro, arredondado para cima).
const mesesEntre = (inicioYmd, fimYmd) => {
  const a = new Date(`${ymd(inicioYmd)}T00:00:00Z`);
  const b = new Date(`${ymd(fimYmd)}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  if (b < a) return 0;
  const diasMs = 24 * 3600000;
  const dias = Math.ceil((b - a) / diasMs);
  // Um mês contratual = 30 dias corridos (regra padrão de locação); frações
  // arredondam PARA CIMA (2 dias = 1 mês; 32 = 2 meses).
  return Math.max(1, Math.ceil(dias / 30));
};

export const kmRodados = (contrato) => {
  if (!contrato) return 0;
  const saida = num(contrato.kmSaida);
  const dev = contrato.kmDevolucao != null ? num(contrato.kmDevolucao) : null;
  if (dev == null) return 0;
  return Math.max(0, dev - saida);
};

// Cobrança consolidada do contrato ao devolver. Devolve os componentes
// separados (a UI mostra os três; a fatura junta). Sem preço mensal
// configurado, a mensalidade fica null (não invento).
export const cobrancaFinal = (contrato) => {
  if (!contrato) return null;
  const fim = contrato.devolvidoEmYmd || contrato.fimContratadoYmd || null;
  const meses = fim ? mesesEntre(contrato.inicioYmd, fim) : null;
  const mensalidade = contrato.precoMensalReais > 0 && meses
    ? arredondarReais(contrato.precoMensalReais * meses)
    : null;

  const km = kmRodados(contrato);
  const franquiaTotal = num(contrato.franquiaKmMes) * (meses || 0);
  const excedenteKm = Math.max(0, km - franquiaTotal);
  const excedenteReais = contrato.precoKmExcedenteReais > 0
    ? arredondarReais(excedenteKm * contrato.precoKmExcedenteReais)
    : 0;

  const avariasCobradas = (contrato.avarias || []).filter(
    (a) => a.momento === "durante-locacao" && a.status !== "isenta",
  );
  const avariasReais = arredondarReais(
    avariasCobradas.reduce((s, a) => s + num(a.valorReparoReais), 0),
  );

  const total = arredondarReais(num(mensalidade) + excedenteReais + avariasReais);
  return {
    mesesCobrados: meses,
    mensalidadeReais: mensalidade,
    kmRodados: km,
    franquiaTotalKm: franquiaTotal,
    excedenteKm,
    excedenteReais,
    avariasCobradas: avariasCobradas.length,
    avariasReais,
    totalReais: mensalidade == null && excedenteReais === 0 && avariasReais === 0 ? null : total,
  };
};

// Devolução: fecha o contrato, registra km/soc e histórico. NÃO decide
// cobrança aqui — quem quiser chama `cobrancaFinal` sobre o resultado.
export const registrarDevolucao = (contrato, dados = {}) => {
  if (!contrato) return contrato;
  const devolvidoEmYmd = ymd(dados.devolvidoEmYmd) || ymd(new Date().toISOString());
  return {
    ...contrato,
    devolvidoEmYmd,
    kmDevolucao: dados.kmDevolucao != null ? Math.max(0, num(dados.kmDevolucao)) : contrato.kmDevolucao,
    socDevolucaoPct: dados.socDevolucaoPct != null ? Math.max(0, Math.min(100, num(dados.socDevolucaoPct))) : contrato.socDevolucaoPct,
    estado: "devolvido",
    historico: [
      ...(contrato.historico || []),
      {
        quando: dados.quando || new Date().toISOString(),
        acao: "devolucao",
        autor: String(dados.autor || "operacao"),
      },
    ],
  };
};

// Isolamento: SÓ contratos daquele locatário (ou do tenant, se admin de
// plataforma). Nunca leia contratos sem passar por aqui.
export const scopeContratosDoLocatario = (contratos = [], sessao) => {
  if (!sessao) return [];
  if (sessao.role === "plataforma_admin") return contratos;
  const arr = Array.isArray(contratos) ? contratos : [];
  return arr.filter((c) => {
    if (sessao.tenantId && c.tenantId && c.tenantId !== sessao.tenantId) return false;
    if (sessao.tenantAccountId && c.locatarioId && c.locatarioId !== sessao.tenantAccountId) return false;
    return true;
  });
};

// Histórico do veículo enquanto está numa locação — o que o veículo fez SÓ
// dentro do período do contrato. `eventos` = [{ dataYmd, tipo, ... }].
export const historicoNaLocacao = (contrato, eventos = []) => {
  const ini = ymd(contrato?.inicioYmd);
  const fim = ymd(contrato?.devolvidoEmYmd || contrato?.fimContratadoYmd || new Date().toISOString());
  if (!ini) return [];
  return (Array.isArray(eventos) ? eventos : []).filter((e) => {
    if (!e?.veiculoId || e.veiculoId !== contrato.veiculoId) return false;
    const d = ymd(e.dataYmd);
    if (!d) return false;
    if (d < ini) return false;
    if (fim && d > fim) return false;
    return true;
  });
};
