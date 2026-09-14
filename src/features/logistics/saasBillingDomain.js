// ===== SaaS · Billing multi-tenant (bloco 24) =====
// Camada pura. Sem HTTP, sem cofre, sem cobrança externa.
//
// Este módulo NÃO cobra ninguém. Ele decide o que o cliente contratou, o que
// está no plano dele agora, e QUAL é o preço do ciclo atual. Quem cobra é a
// integração com o parceiro financeiro (GreenPay) ou a passarela paga que a
// titular decidir ligar (Stripe/Mercado Pago) — o mesmo padrão do resto do
// app: o núcleo é gratuito e o "toque no dinheiro" é opcional e explícito.
//
// Estratégia de licenciamento herdada do documento da titular:
//   contratar UM módulo isolado · combinar módulos · contratar end-to-end.
// Métricas de licença suportadas: veículo, motorista, estação, carregador,
// enterprise (fixo por mês), rota planejada (uso), sessão de recarga (uso).

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const arredondarReais = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

// Módulos da plataforma que podem ser contratados isoladamente.
export const MODULOS = Object.freeze([
  "planejamento",     // Fleet Electrification Planning
  "frota",            // Fleet & Vehicle Management
  "motorista",        // Driver Management + Driver App
  "operacao",         // Operations & Routing + Torre de Controle
  "portal-cliente",   // Portal do Cliente
  "recarga",          // Charging Infrastructure + Green On (B2C/B2B)
  "energia",          // Energy Management + BESS + solar + smart charging
  "greenpay",         // GreenPay
  "esg",              // ESG e sustentabilidade
  "seguranca",        // Segurança operacional
  "greenmob",         // Greenmob (locação)
  "ai",               // AI Optimization (camada premium)
  "bi",               // BI/relatórios avançados (camada premium)
]);

// Métricas de licença aceitas. Cada plano lista os módulos e os limites por
// métrica; excesso vai para o cálculo de uso do ciclo.
export const METRICAS = Object.freeze([
  "veiculo",
  "motorista",
  "estacao",
  "carregador",
  "rota-planejada",
  "sessao-recarga",
  "enterprise",
]);

export const CICLOS = Object.freeze(["mensal", "anual"]);

// Normaliza a definição de um plano contratado. `precoBase` = fixo do ciclo
// (mensalidade). `porUnidade` = { metrica: { preco, franquia } }. Franquia é
// o QUANTO está incluído no preço base; excesso vira uso pago à parte.
export const normalizarPlano = (bruto = {}) => {
  const modulos = Array.isArray(bruto.modulos)
    ? bruto.modulos.filter((m) => MODULOS.includes(m))
    : [];
  const porUnidade = {};
  const src = bruto.porUnidade || {};
  for (const key of Object.keys(src)) {
    if (!METRICAS.includes(key)) continue;
    const v = src[key] || {};
    porUnidade[key] = {
      precoReais: Math.max(0, arredondarReais(v.precoReais)),
      franquia: Math.max(0, num(v.franquia)),
    };
  }
  return {
    id: String(bruto.id || "plano"),
    nome: String(bruto.nome || "").trim() || "Plano",
    ciclo: CICLOS.includes(bruto.ciclo) ? bruto.ciclo : "mensal",
    precoBaseReais: Math.max(0, arredondarReais(bruto.precoBaseReais)),
    modulos,
    porUnidade,
    // Desconto anual só se ciclo = "anual"; senão ignora silenciosamente.
    descontoAnualPct: bruto.ciclo === "anual" ? Math.max(0, Math.min(100, num(bruto.descontoAnualPct))) : 0,
  };
};

// Predicado central: aquele tenant tem aquele módulo contratado?
export const hasModulo = (assinatura, modulo) => {
  if (!assinatura) return false;
  const plano = assinatura.plano || {};
  return Array.isArray(plano.modulos) && plano.modulos.includes(modulo);
};

// Cálculo de excedente do ciclo por métrica. `uso` = { metrica: consumido }.
// Uma métrica sem preço configurado NÃO vira cobrança — retorna 0 e um alerta
// no `avisos`.
const calcularExcedente = (plano, uso = {}) => {
  const detalhe = {};
  const avisos = [];
  let total = 0;
  for (const metrica of METRICAS) {
    const consumido = Math.max(0, num(uso[metrica]));
    const conf = plano.porUnidade?.[metrica];
    if (!conf) {
      if (consumido > 0) avisos.push({ metrica, motivo: "sem-preco-configurado", consumido });
      continue;
    }
    const excedente = Math.max(0, consumido - num(conf.franquia));
    const valor = arredondarReais(excedente * conf.precoReais);
    if (consumido > 0) {
      detalhe[metrica] = { consumido, franquia: conf.franquia, excedente, valorReais: valor };
      total = arredondarReais(total + valor);
    }
  }
  return { detalhe, avisos, totalReais: total };
};

// Fatura consolidada do ciclo: base + excedente por uso. Desconto anual se
// o ciclo do plano for anual.
export const faturarCiclo = (assinatura, uso = {}) => {
  if (!assinatura) return null;
  const plano = normalizarPlano(assinatura.plano || {});
  const base = plano.precoBaseReais;
  const { detalhe, avisos, totalReais: excedente } = calcularExcedente(plano, uso);
  const bruto = arredondarReais(base + excedente);
  const desconto = plano.ciclo === "anual" && plano.descontoAnualPct > 0
    ? arredondarReais(bruto * (plano.descontoAnualPct / 100))
    : 0;
  const total = arredondarReais(bruto - desconto);
  return {
    planoId: plano.id,
    planoNome: plano.nome,
    ciclo: plano.ciclo,
    modulos: plano.modulos,
    baseReais: base,
    usoDetalhe: detalhe,
    usoReais: excedente,
    brutoReais: bruto,
    descontoAnualReais: desconto,
    totalReais: total,
    avisos,
  };
};

// Registro simples de tenant. Escopo estrito: cada tenant tem plano próprio.
export const criarTenant = (bruto = {}) => ({
  id: String(bruto.id || `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
  razaoSocial: String(bruto.razaoSocial || "").trim(),
  cnpj: String(bruto.cnpj || "").replace(/\D/g, ""),
  status: bruto.status === "suspenso" ? "suspenso" : "ativo",
  plano: normalizarPlano(bruto.plano || {}),
  criadoEm: bruto.criadoEm || new Date().toISOString(),
});

// Assina um plano diferente para um tenant. Mantém o histórico dos anteriores.
export const trocarPlano = (tenant, novoPlanoBruto) => {
  if (!tenant) return tenant;
  const plano = normalizarPlano(novoPlanoBruto);
  const historico = Array.isArray(tenant.planoHistorico) ? tenant.planoHistorico : [];
  return {
    ...tenant,
    plano,
    planoHistorico: [
      ...historico,
      { quando: new Date().toISOString(), planoAnterior: tenant.plano || null },
    ],
  };
};

// Aviso de churn/downgrade: se um tenant tem uso ativo de um módulo que ele
// vai perder, o operador precisa saber ANTES da mudança. Devolve a lista de
// módulos afetados; vazia = pode trocar sem risco.
export const analisarDowngrade = (tenant, novoPlanoBruto, usoAtual = {}) => {
  const plano = normalizarPlano(novoPlanoBruto);
  const atuais = tenant?.plano?.modulos || [];
  const perdendo = atuais.filter((m) => !plano.modulos.includes(m));
  const impacto = [];
  const mapUso = {
    frota: "veiculo",
    motorista: "motorista",
    recarga: "carregador",
    greenpay: "sessao-recarga",
    operacao: "rota-planejada",
  };
  for (const modulo of perdendo) {
    const metrica = mapUso[modulo];
    const consumido = metrica ? num(usoAtual[metrica]) : 0;
    if (consumido > 0) impacto.push({ modulo, metrica, consumido });
    else impacto.push({ modulo, metrica: null, consumido: 0 });
  }
  return { perdendo, impacto };
};
