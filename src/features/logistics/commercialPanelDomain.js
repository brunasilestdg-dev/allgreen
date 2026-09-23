// Motor de cálculo do Painel Comercial (puro, sem I/O, testável).
//
// Recebe fatos JÁ normalizados pelo endpoint (nada de coluna crua aqui) e
// devolve as três abas prontas para a tela:
//   1. Receita Novos Negócios  (fonte: faturamento Track3R -> ledger de receita)
//   2. Kanban Novos Clientes   (fonte: oportunidades nativas / Monday)
//   3. Modelo Operacional      (fonte: encomendas/ocorrências Track3R)
//
// Regra de ouro: sem dado -> `disponivel:false` e listas vazias. NUNCA número
// inventado. Cada seção diz honestamente se tem base para o que mostra.

import {
  categoriaStatusTrack3r,
  CATEGORIAS_INSUCESSO,
} from "./track3rStatusDomain.js";

const soNumero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

const textoLimpo = (valor) => String(valor ?? "").trim();

// Chave de agrupamento por nome, tolerante a caixa/acentos/espaços — para casar
// "On Running" com "ON RUNNING " sem tratar como dois clientes distintos.
export const normalizarNome = (valor) =>
  textoLimpo(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const mesDe = (iso) => textoLimpo(iso).slice(0, 7);
const diaDe = (iso) => textoLimpo(iso).slice(0, 10);
const numeroDoDia = (iso) => {
  const d = Number(textoLimpo(iso).slice(8, 10));
  return Number.isFinite(d) ? d : 0;
};

const diasNoMes = (mes) => {
  const [ano, m] = textoLimpo(mes).split("-").map(Number);
  if (!ano || !m) return 30;
  return new Date(Date.UTC(ano, m, 0)).getUTCDate();
};

const mesAnteriorDe = (mes) => {
  const [ano, m] = textoLimpo(mes).split("-").map(Number);
  if (!ano || !m) return "";
  const d = new Date(Date.UTC(ano, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const ordenarMeses = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Variação mês-a-mês (fração; 0.12 = +12%). Sem base anterior positiva, null:
// crescimento "infinito" a partir do zero engana mais do que informa.
const varMoM = (atual, anterior) => {
  const base = soNumero(anterior);
  if (base <= 0) return null;
  return (soNumero(atual) - base) / base;
};

// Uma encomenda foi entregue? Ordem de confiança:
//   1. Track3R marca a ocorrência "03" como Entregue (código operacional).
//   2. De-para OFICIAL: a encomenda grava a descrição do status (descricao_status)
//      na coluna `status`; a tabela do Lucas diz a categoria canônica. Categoria
//      "entregue" -> sim; qualquer outra categoria CONHECIDA -> não (não confunde
//      em trânsito/insucesso com entrega).
//   3. Sem de-para (status fora da tabela oficial): cai no texto, com guarda
//      contra "não entregue" para não contar insucesso como sucesso.
const foiEntregue = (enc) => {
  if (textoLimpo(enc?.occurrenceCode) === "03") return true;
  const cat = categoriaStatusTrack3r(textoLimpo(enc?.status) || textoLimpo(enc?.occurrence));
  if (cat === "entregue") return true;
  if (cat) return false; // categoria oficial conhecida e não-entregue
  const alvo = `${textoLimpo(enc?.status)} ${textoLimpo(enc?.occurrence)}`.toLowerCase();
  if (/n[ãa]o\s*entreg/.test(alvo)) return false;
  return /entreg/.test(alvo);
};

// Uma linha representa uma TENTATIVA de entrega (para reentrega/efetividade)?
const ehTentativaDeEntrega = (enc) =>
  textoLimpo(enc?.kind) === "entrega" ||
  textoLimpo(enc?.kind) === "ocorrencia" ||
  Boolean(textoLimpo(enc?.occurrenceCode));

const rotaDe = (enc) => {
  const origem = textoLimpo(enc?.originUnit) || "—";
  const destino = textoLimpo(enc?.currentUnit) || "—";
  return `${origem} → ${destino}`;
};

// ===== ABA 1 · RECEITA NOVOS NEGÓCIOS =====

export function receitaPorPeriodo(faturas = []) {
  const porMes = new Map();
  const porDia = new Map();
  for (const f of faturas) {
    const mes = mesDe(f?.data) || mesDe(f?.mes);
    if (!mes) continue;
    porMes.set(mes, soNumero(porMes.get(mes)) + soNumero(f?.valor));
    const dia = diaDe(f?.data);
    if (dia) {
      if (!porDia.has(mes)) porDia.set(mes, new Map());
      const mapaDia = porDia.get(mes);
      mapaDia.set(dia, soNumero(mapaDia.get(dia)) + soNumero(f?.valor));
    }
  }
  const meses = [...porMes.entries()]
    .map(([mes, receita]) => ({ mes, receita }))
    .sort((a, b) => ordenarMeses(a.mes, b.mes));
  const porDiaObj = {};
  for (const [mes, mapaDia] of porDia.entries()) {
    porDiaObj[mes] = [...mapaDia.entries()]
      .map(([dia, receita]) => ({ dia, receita }))
      .sort((a, b) => ordenarMeses(a.dia, b.dia));
  }
  return { disponivel: meses.length > 0, meses, porDia: porDiaObj };
}

export function previsaoDeFechamento(faturas = [], hoje = new Date()) {
  const ref = hoje instanceof Date ? hoje : new Date(hoje);
  const mesAtual = `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, "0")}`;
  const diaAtual = ref.getUTCDate();
  const mesAnterior = mesAnteriorDe(mesAtual);

  let acumulado = 0;
  let anteriorAteODia = 0;
  let anteriorTotal = 0;
  for (const f of faturas) {
    const mes = mesDe(f?.data) || mesDe(f?.mes);
    const dia = numeroDoDia(f?.data);
    const valor = soNumero(f?.valor);
    if (mes === mesAtual && (dia === 0 || dia <= diaAtual)) acumulado += valor;
    if (mes === mesAnterior) {
      anteriorTotal += valor;
      if (dia === 0 || dia <= diaAtual) anteriorAteODia += valor;
    }
  }

  let projecao = null;
  let base = "sem-base";
  if (anteriorAteODia > 0) {
    projecao = acumulado * (anteriorTotal / anteriorAteODia);
    base = "comparado";
  } else if (acumulado > 0 && diaAtual > 0) {
    projecao = (acumulado / diaAtual) * diasNoMes(mesAtual);
    base = "linear";
  }
  return {
    disponivel: projecao !== null,
    mesAtual,
    diaAtual,
    acumulado,
    projecao,
    base,
    mesAnterior,
    mesAnteriorTotal: anteriorTotal,
  };
}

export function concentracaoPorTomador(faturas = []) {
  const porTomador = new Map();
  const mesesSet = new Set();
  for (const f of faturas) {
    const mes = mesDe(f?.data) || mesDe(f?.mes);
    const nome = textoLimpo(f?.tomador) || "Sem tomador identificado";
    const chave = normalizarNome(nome);
    if (!porTomador.has(chave)) porTomador.set(chave, { tomador: nome, porMes: new Map(), total: 0 });
    const reg = porTomador.get(chave);
    reg.total += soNumero(f?.valor);
    if (mes) {
      mesesSet.add(mes);
      reg.porMes.set(mes, soNumero(reg.porMes.get(mes)) + soNumero(f?.valor));
    }
  }
  const totalGeral = [...porTomador.values()].reduce((s, r) => s + r.total, 0);
  const clientes = [...porTomador.values()]
    .map((r) => ({
      tomador: r.tomador,
      total: r.total,
      participacao: totalGeral > 0 ? r.total / totalGeral : 0,
      porMes: Object.fromEntries(r.porMes),
    }))
    .sort((a, b) => b.total - a.total);
  return {
    disponivel: clientes.length > 0,
    meses: [...mesesSet].sort(ordenarMeses),
    clientes,
    totalGeral,
  };
}

export function resumoMensalReceita(faturas = []) {
  const conc = concentracaoPorTomador(faturas);
  const clientePrincipal = conc.clientes[0]?.tomador || "";
  const chavePrincipal = normalizarNome(clientePrincipal);

  const porMes = new Map();
  for (const f of faturas) {
    const mes = mesDe(f?.data) || mesDe(f?.mes);
    if (!mes) continue;
    if (!porMes.has(mes)) porMes.set(mes, { receita: 0, principal: 0 });
    const reg = porMes.get(mes);
    const valor = soNumero(f?.valor);
    reg.receita += valor;
    if (chavePrincipal && normalizarNome(f?.tomador) === chavePrincipal) reg.principal += valor;
  }
  const ordenados = [...porMes.entries()].sort((a, b) => ordenarMeses(a[0], b[0]));
  const meses = ordenados.map(([mes, reg], idx) => {
    const anterior = idx > 0 ? ordenados[idx - 1][1].receita : 0;
    return {
      mes,
      receita: reg.receita,
      varMoM: varMoM(reg.receita, anterior),
      principal: reg.principal,
      outros: reg.receita - reg.principal,
    };
  });
  return { disponivel: meses.length > 0, clientePrincipal, meses };
}

export function ticketMedioPorCliente(faturas = [], encomendas = []) {
  const receitaPorNome = new Map();
  for (const f of faturas) {
    const chave = normalizarNome(f?.tomador);
    if (!chave) continue;
    if (!receitaPorNome.has(chave)) receitaPorNome.set(chave, { nome: textoLimpo(f?.tomador), receita: 0 });
    receitaPorNome.get(chave).receita += soNumero(f?.valor);
  }
  const pedidosPorNome = new Map();
  const vistos = new Set();
  for (const e of encomendas) {
    const chave = normalizarNome(e?.cliente);
    const ref = textoLimpo(e?.orderRef);
    if (!chave || !ref) continue;
    const dedup = `${chave}|${ref}`;
    if (vistos.has(dedup)) continue;
    vistos.add(dedup);
    pedidosPorNome.set(chave, soNumero(pedidosPorNome.get(chave)) + 1);
  }
  const clientes = [...receitaPorNome.entries()]
    .map(([chave, reg]) => {
      const pedidos = soNumero(pedidosPorNome.get(chave));
      return {
        cliente: reg.nome,
        receita: reg.receita,
        pedidos,
        ticketMedio: pedidos > 0 ? reg.receita / pedidos : null,
      };
    })
    .sort((a, b) => b.receita - a.receita);
  return {
    disponivel: clientes.length > 0,
    temVolume: clientes.some((c) => c.pedidos > 0),
    clientes,
  };
}

// ===== ABA 2 · KANBAN NOVOS CLIENTES =====

export function pipelinePorEtapa(oportunidades = []) {
  const porEtapa = new Map();
  for (const o of oportunidades) {
    const etapa = textoLimpo(o?.estagio) || "Sem etapa";
    if (!porEtapa.has(etapa)) porEtapa.set(etapa, { etapa, quantidade: 0, valorMensal: 0, valorContrato: 0, itens: [] });
    const reg = porEtapa.get(etapa);
    reg.quantidade += 1;
    reg.valorMensal += soNumero(o?.valorMensal);
    reg.valorContrato += soNumero(o?.valorContrato);
    reg.itens.push({
      cliente: textoLimpo(o?.cliente) || textoLimpo(o?.titulo) || "Oportunidade",
      valorMensal: soNumero(o?.valorMensal),
      responsavel: textoLimpo(o?.responsavel),
      atualizadoEm: textoLimpo(o?.atualizadoEm),
    });
  }
  const etapas = [...porEtapa.values()].sort((a, b) => b.valorMensal - a.valorMensal);
  return {
    disponivel: etapas.length > 0,
    etapas,
    totalOportunidades: oportunidades.length,
    valorMensalTotal: etapas.reduce((s, e) => s + e.valorMensal, 0),
  };
}

export function clientesParaFup(oportunidades = [], hoje = new Date()) {
  const ref = (hoje instanceof Date ? hoje : new Date(hoje)).getTime();
  const clientes = oportunidades
    .map((o) => {
      const atualizadoEm = textoLimpo(o?.atualizadoEm);
      const t = atualizadoEm ? Date.parse(atualizadoEm) : NaN;
      const semFupDias = Number.isFinite(t) ? Math.max(0, Math.floor((ref - t) / 86400000)) : null;
      return {
        cliente: textoLimpo(o?.cliente) || textoLimpo(o?.titulo) || "Oportunidade",
        etapa: textoLimpo(o?.estagio) || "Sem etapa",
        valorMensal: soNumero(o?.valorMensal),
        atualizadoEm,
        semFupDias,
      };
    })
    .sort((a, b) => (soNumero(b.semFupDias) - soNumero(a.semFupDias)));
  return { disponivel: clientes.length > 0, clientes };
}

// ===== ABA 3 · MODELO OPERACIONAL =====

// Agrupa por encomenda (order_ref): uma encomenda pode ter várias linhas
// (cadastro + ocorrências). Consolida a data de registro, a promessa e a
// entrega/■ tentativas para os indicadores operacionais.
const consolidarPorEncomenda = (encomendas = []) => {
  const mapa = new Map();
  for (const e of encomendas) {
    const ref = textoLimpo(e?.orderRef) || textoLimpo(e?.externalId);
    if (!ref) continue;
    if (!mapa.has(ref)) {
      mapa.set(ref, {
        orderRef: ref,
        cliente: "",
        rota: "—",
        praca: "",
        registroEm: "",
        prometidoEm: "",
        entregueEm: "",
        entregue: false,
        tentativas: 0,
        ocorrencias: [],
      });
    }
    const reg = mapa.get(ref);
    const cliente = textoLimpo(e?.cliente);
    if (cliente && !reg.cliente) reg.cliente = cliente;
    // Praça de embarque = unidade de ORIGEM da encomenda (Track3R origin_unit).
    const origem = textoLimpo(e?.originUnit);
    if (origem && !reg.praca) reg.praca = origem;
    const rota = rotaDe(e);
    if (rota !== "— → —" && reg.rota === "—") reg.rota = rota;
    else if (reg.rota === "—") reg.rota = rota;
    const cadastro = textoLimpo(e?.occurredAt);
    if (cadastro && (!reg.registroEm || cadastro < reg.registroEm)) reg.registroEm = cadastro;
    const prometido = textoLimpo(e?.promisedAt);
    if (prometido && !reg.prometidoEm) reg.prometidoEm = prometido;
    if (ehTentativaDeEntrega(e)) reg.tentativas += 1;
    const ocorr = textoLimpo(e?.occurrence);
    if (ocorr) reg.ocorrencias.push(ocorr);
    if (foiEntregue(e)) {
      reg.entregue = true;
      const quando = textoLimpo(e?.occurredAt);
      if (quando && (!reg.entregueEm || quando > reg.entregueEm)) reg.entregueEm = quando;
    }
  }
  return [...mapa.values()];
};

export function volumeDiarioDePedidos(encomendas = []) {
  const consolidadas = consolidarPorEncomenda(encomendas);
  const porMes = new Map();
  const porDia = new Map();
  for (const p of consolidadas) {
    const base = p.registroEm || p.entregueEm;
    const mes = mesDe(base);
    if (!mes) continue;
    porMes.set(mes, soNumero(porMes.get(mes)) + 1);
    const dia = diaDe(base);
    if (dia) {
      if (!porDia.has(mes)) porDia.set(mes, new Map());
      const md = porDia.get(mes);
      md.set(dia, soNumero(md.get(dia)) + 1);
    }
  }
  const meses = [...porMes.entries()].map(([mes, pedidos]) => ({ mes, pedidos })).sort((a, b) => ordenarMeses(a.mes, b.mes));
  const porDiaObj = {};
  for (const [mes, md] of porDia.entries()) {
    porDiaObj[mes] = [...md.entries()].map(([dia, pedidos]) => ({ dia, pedidos })).sort((a, b) => ordenarMeses(a.dia, b.dia));
  }
  return { disponivel: meses.length > 0, meses, porDia: porDiaObj, totalPedidos: consolidadas.length };
}

export function otdPorMes(encomendas = [], meta = 0.98) {
  const consolidadas = consolidarPorEncomenda(encomendas);
  const porMes = new Map();
  let entreguesTotal = 0;
  let noPrazoTotal = 0;
  for (const p of consolidadas) {
    if (!p.entregue || !p.prometidoEm || !p.entregueEm) continue;
    const mes = mesDe(p.entregueEm);
    if (!mes) continue;
    if (!porMes.has(mes)) porMes.set(mes, { entregues: 0, noPrazo: 0 });
    const reg = porMes.get(mes);
    reg.entregues += 1;
    entreguesTotal += 1;
    if (diaDe(p.entregueEm) <= diaDe(p.prometidoEm)) {
      reg.noPrazo += 1;
      noPrazoTotal += 1;
    }
  }
  const meses = [...porMes.entries()]
    .map(([mes, reg]) => ({ mes, entregues: reg.entregues, noPrazo: reg.noPrazo, otd: reg.entregues > 0 ? reg.noPrazo / reg.entregues : null }))
    .sort((a, b) => ordenarMeses(a.mes, b.mes));
  return {
    disponivel: entreguesTotal > 0,
    meta,
    meses,
    otdGeral: entreguesTotal > 0 ? noPrazoTotal / entreguesTotal : null,
    entreguesTotal,
  };
}

export function efetividadeDeEntregas(encomendas = []) {
  const consolidadas = consolidarPorEncomenda(encomendas);
  const porMes = new Map();
  let total = 0;
  let entregues = 0;
  for (const p of consolidadas) {
    const base = p.entregueEm || p.registroEm;
    const mes = mesDe(base);
    if (!mes) continue;
    if (!porMes.has(mes)) porMes.set(mes, { total: 0, entregues: 0 });
    const reg = porMes.get(mes);
    reg.total += 1;
    total += 1;
    if (p.entregue) {
      reg.entregues += 1;
      entregues += 1;
    }
  }
  const meses = [...porMes.entries()]
    .map(([mes, reg]) => ({ mes, total: reg.total, entregues: reg.entregues, efetividade: reg.total > 0 ? reg.entregues / reg.total : null }))
    .sort((a, b) => ordenarMeses(a.mes, b.mes));
  return { disponivel: total > 0, meses, efetividadeGeral: total > 0 ? entregues / total : null, total, entregues };
}

export function decomposicaoDeOcorrencias(encomendas = []) {
  const porTipo = new Map();
  let total = 0;
  for (const e of encomendas) {
    // A encomenda do webhook grava a descrição do status em `status`; o campo
    // `occurrence` só vem do artefato/importação. Considera os dois.
    const tipo = textoLimpo(e?.occurrence) || textoLimpo(e?.status);
    if (!tipo) continue;
    if (foiEntregue(e)) continue; // ocorrência de sucesso não é "insucesso"
    // De-para oficial: só insucesso/avaria/extravio contam como falha de entrega.
    // Status fora da tabela (categoria "") mantém o comportamento antigo, para
    // não perder ocorrência legada que ainda não esteja mapeada.
    const cat = categoriaStatusTrack3r(tipo);
    if (cat && !CATEGORIAS_INSUCESSO.includes(cat)) continue;
    porTipo.set(tipo, soNumero(porTipo.get(tipo)) + 1);
    total += 1;
  }
  const tipos = [...porTipo.entries()]
    .map(([tipo, quantidade]) => ({ tipo, quantidade, percentual: total > 0 ? quantidade / total : 0 }))
    .sort((a, b) => b.quantidade - a.quantidade);
  return { disponivel: total > 0, tipos, total };
}

export function resumoMensalOperacional(encomendas = []) {
  const volume = volumeDiarioDePedidos(encomendas);
  const otd = otdPorMes(encomendas);
  const efet = efetividadeDeEntregas(encomendas);
  const otdPorMesMapa = new Map(otd.meses.map((m) => [m.mes, m.otd]));
  const efetPorMesMapa = new Map(efet.meses.map((m) => [m.mes, m]));

  const meses = volume.meses.map((m, idx) => {
    const anterior = idx > 0 ? volume.meses[idx - 1].pedidos : 0;
    const efetMes = efetPorMesMapa.get(m.mes);
    const insucessos = efetMes ? efetMes.total - efetMes.entregues : null;
    return {
      mes: m.mes,
      volume: m.pedidos,
      varMoM: varMoM(m.pedidos, anterior),
      otd: otdPorMesMapa.has(m.mes) ? otdPorMesMapa.get(m.mes) : null,
      efetividade: efetMes ? efetMes.efetividade : null,
      insucessos,
    };
  });
  return { disponivel: meses.length > 0, meses };
}

export function rankingClientesPorVolume(encomendas = []) {
  const consolidadas = consolidarPorEncomenda(encomendas);
  const porCliente = new Map();
  const mesesSet = new Set();
  for (const p of consolidadas) {
    const nome = p.cliente || "Sem cliente identificado";
    const chave = normalizarNome(nome);
    if (!porCliente.has(chave)) porCliente.set(chave, { cliente: nome, total: 0, porMes: new Map() });
    const reg = porCliente.get(chave);
    reg.total += 1;
    const mes = mesDe(p.registroEm || p.entregueEm);
    if (mes) {
      mesesSet.add(mes);
      reg.porMes.set(mes, soNumero(reg.porMes.get(mes)) + 1);
    }
  }
  const clientes = [...porCliente.values()]
    .map((r) => ({ cliente: r.cliente, total: r.total, porMes: Object.fromEntries(r.porMes) }))
    .sort((a, b) => b.total - a.total);
  return { disponivel: clientes.length > 0, meses: [...mesesSet].sort(ordenarMeses), clientes };
}

export function leadTimeDeEntrega(encomendas = []) {
  const consolidadas = consolidarPorEncomenda(encomendas);
  const porMes = new Map();
  let somaGeral = 0;
  let contagemGeral = 0;
  for (const p of consolidadas) {
    if (!p.entregue || !p.registroEm || !p.entregueEm) continue;
    const inicio = Date.parse(p.registroEm);
    const fim = Date.parse(p.entregueEm);
    if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim < inicio) continue;
    const horas = (fim - inicio) / 3600000;
    const mes = mesDe(p.entregueEm);
    if (!mes) continue;
    if (!porMes.has(mes)) porMes.set(mes, { soma: 0, contagem: 0 });
    const reg = porMes.get(mes);
    reg.soma += horas;
    reg.contagem += 1;
    somaGeral += horas;
    contagemGeral += 1;
  }
  const meses = [...porMes.entries()]
    .map(([mes, reg]) => ({ mes, horasMedias: reg.contagem > 0 ? reg.soma / reg.contagem : null, pedidos: reg.contagem }))
    .sort((a, b) => ordenarMeses(a.mes, b.mes));
  return {
    disponivel: contagemGeral > 0,
    meses,
    horasMediasGeral: contagemGeral > 0 ? somaGeral / contagemGeral : null,
    diasMediosGeral: contagemGeral > 0 ? somaGeral / contagemGeral / 24 : null,
    pedidos: contagemGeral,
  };
}

export function slaPorRota(encomendas = []) {
  const consolidadas = consolidarPorEncomenda(encomendas);
  const porRota = new Map();
  for (const p of consolidadas) {
    if (!p.entregue || !p.prometidoEm || !p.entregueEm) continue;
    const rota = p.rota || "—";
    if (!porRota.has(rota)) porRota.set(rota, { rota, pedidos: 0, foraDoPrazo: 0 });
    const reg = porRota.get(rota);
    reg.pedidos += 1;
    if (diaDe(p.entregueEm) > diaDe(p.prometidoEm)) reg.foraDoPrazo += 1;
  }
  const rotas = [...porRota.values()]
    .map((r) => ({ ...r, percentualForaDoPrazo: r.pedidos > 0 ? r.foraDoPrazo / r.pedidos : 0 }))
    .sort((a, b) => b.foraDoPrazo - a.foraDoPrazo || b.pedidos - a.pedidos);
  return { disponivel: rotas.length > 0, rotas };
}

// Operacional por PRAÇA DE EMBARQUE (unidade de origem, Track3R) e a matriz
// cliente × praça. Preenche quando as encomendas do Track3R chegarem.
export function operacionalPorPraca(encomendas = []) {
  const consolidadas = consolidarPorEncomenda(encomendas);
  const porPraca = new Map();
  const matriz = new Map();
  for (const p of consolidadas) {
    const praca = textoLimpo(p.praca) || "Sem praça";
    if (!porPraca.has(praca)) porPraca.set(praca, { praca, pedidos: 0, entregues: 0, noPrazo: 0 });
    const reg = porPraca.get(praca);
    reg.pedidos += 1;
    if (p.entregue) {
      reg.entregues += 1;
      if (p.prometidoEm && p.entregueEm && diaDe(p.entregueEm) <= diaDe(p.prometidoEm)) reg.noPrazo += 1;
    }
    const cliente = textoLimpo(p.cliente) || "Sem cliente";
    const chave = `${normalizarNome(cliente)}|${normalizarNome(praca)}`;
    if (!matriz.has(chave)) matriz.set(chave, { cliente, praca, pedidos: 0 });
    matriz.get(chave).pedidos += 1;
  }
  const pracas = [...porPraca.values()]
    .map((r) => ({
      praca: r.praca,
      pedidos: r.pedidos,
      entregues: r.entregues,
      otd: r.entregues > 0 ? r.noPrazo / r.entregues : null,
      efetividade: r.pedidos > 0 ? r.entregues / r.pedidos : null,
    }))
    .sort((a, b) => b.pedidos - a.pedidos);
  const cruzamento = [...matriz.values()].sort((a, b) => b.pedidos - a.pedidos);
  return { disponivel: pracas.length > 0, pracas, matriz: cruzamento };
}

export function reentregaPorRota(encomendas = []) {
  const consolidadas = consolidarPorEncomenda(encomendas);
  const porRota = new Map();
  for (const p of consolidadas) {
    const rota = p.rota || "—";
    if (!porRota.has(rota)) porRota.set(rota, { rota, pedidos: 0, comReentrega: 0 });
    const reg = porRota.get(rota);
    reg.pedidos += 1;
    if (p.tentativas > 1) reg.comReentrega += 1;
  }
  const rotas = [...porRota.values()]
    .map((r) => ({ ...r, percentualReentrega: r.pedidos > 0 ? r.comReentrega / r.pedidos : 0 }))
    .sort((a, b) => b.comReentrega - a.comReentrega || b.pedidos - a.pedidos);
  return { disponivel: rotas.some((r) => r.comReentrega > 0), rotas };
}

// ===== Comparativos (MoM / MTD / DoD / YoY) para métricas aditivas =====
// Recebe séries {mensal:[{mes,valor}], diaria:[{dia,valor}]} e devolve os quatro
// comparativos, cada um com atual, anterior e delta (fração). `disponivel:false`
// quando não há base (ex.: YoY sem o ano anterior) — nunca inventa comparação.
export function comparativosDeSerie({ mensal = [], diaria = [] } = {}) {
  const meses = [...mensal].filter((m) => m && m.mes).sort((a, b) => ordenarMeses(a.mes, b.mes));
  const dias = [...diaria].filter((d) => d && d.dia).sort((a, b) => ordenarMeses(a.dia, b.dia));
  const ultimo = meses[meses.length - 1];
  const penultimo = meses[meses.length - 2];

  const par = (atual, anterior, extra = {}) => ({
    disponivel: true, atual: soNumero(atual), anterior: soNumero(anterior),
    delta: varMoM(atual, anterior), ...extra,
  });

  const mom = ultimo && penultimo
    ? par(ultimo.valor, penultimo.valor, { rotuloAtual: ultimo.mes, rotuloAnterior: penultimo.mes })
    : { disponivel: false };

  let yoy = { disponivel: false };
  if (ultimo) {
    const [ano, mm] = String(ultimo.mes).split("-");
    const alvo = `${Number(ano) - 1}-${mm}`;
    const anoAnterior = meses.find((m) => m.mes === alvo);
    if (anoAnterior) yoy = par(ultimo.valor, anoAnterior.valor, { rotuloAtual: ultimo.mes, rotuloAnterior: alvo });
  }

  const dod = dias.length >= 2
    ? par(dias[dias.length - 1].valor, dias[dias.length - 2].valor, { rotuloAtual: dias[dias.length - 1].dia, rotuloAnterior: dias[dias.length - 2].dia })
    : { disponivel: false };

  let mtd = { disponivel: false };
  if (ultimo && dias.length) {
    const mesAtual = ultimo.mes;
    const diasAtual = dias.filter((d) => d.dia.slice(0, 7) === mesAtual);
    if (diasAtual.length && penultimo) {
      const corte = Number(diasAtual[diasAtual.length - 1].dia.slice(8, 10));
      const somaAte = (mes) => dias
        .filter((d) => d.dia.slice(0, 7) === mes && Number(d.dia.slice(8, 10)) <= corte)
        .reduce((s, d) => s + soNumero(d.valor), 0);
      const accAtual = somaAte(mesAtual);
      const accAnterior = somaAte(penultimo.mes);
      mtd = par(accAtual, accAnterior, { corteDia: corte, rotuloAtual: mesAtual, rotuloAnterior: penultimo.mes });
    }
  }

  return { mom, mtd, dod, yoy };
}

// ===== Ponte temporária: receita a partir do retrato (artefato/importação) =====
//
// O retrato traz `daily` [{data, receita}] e `monthly` [{mes_num, receita,
// clientes:[{nome, valor, pedidos}]}] JÁ pré-agregados pela extração externa.
// Devolve EXATAMENTE a mesma forma que a aba Receita monta a partir do ledger
// canônico — a tela não sabe nem se importa de qual fonte veio.
export function receitaDeSnapshot({ daily = [], monthly = [] } = {}, hoje = new Date()) {
  const ano = textoLimpo(daily[0]?.data).slice(0, 4) || String((hoje instanceof Date ? hoje : new Date(hoje)).getUTCFullYear());
  const mesKey = (mesNum) => `${ano}-${String(mesNum).padStart(2, "0")}`;

  const meses = monthly
    .map((m) => ({ mes: mesKey(m?.mes_num), receita: soNumero(m?.receita) }))
    .sort((a, b) => ordenarMeses(a.mes, b.mes));
  const porDiaMap = new Map();
  for (const dd of daily) {
    const mes = mesDe(dd?.data);
    const dia = diaDe(dd?.data);
    if (!mes || !dia) continue;
    if (!porDiaMap.has(mes)) porDiaMap.set(mes, []);
    porDiaMap.get(mes).push({ dia, receita: soNumero(dd?.receita) });
  }
  const porDia = {};
  for (const [mes, arr] of porDiaMap.entries()) porDia[mes] = arr.sort((a, b) => ordenarMeses(a.dia, b.dia));
  const porPeriodo = { disponivel: meses.length > 0, meses, porDia };

  const previsao = previsaoDeFechamento(
    daily.map((dd) => ({ data: dd?.data, valor: soNumero(dd?.receita), mes: mesDe(dd?.data), tomador: "" })),
    hoje,
  );

  const porTomador = new Map();
  for (const m of monthly) {
    const mes = mesKey(m?.mes_num);
    for (const c of m?.clientes || []) {
      const nome = textoLimpo(c?.nome) || "Sem tomador identificado";
      const chave = normalizarNome(nome);
      if (!porTomador.has(chave)) porTomador.set(chave, { tomador: nome, total: 0, pedidos: 0, porMes: new Map() });
      const r = porTomador.get(chave);
      r.total += soNumero(c?.valor);
      r.pedidos += soNumero(c?.pedidos);
      r.porMes.set(mes, soNumero(r.porMes.get(mes)) + soNumero(c?.valor));
    }
  }
  const totalGeral = [...porTomador.values()].reduce((s, r) => s + r.total, 0);
  const clientesConc = [...porTomador.values()]
    .map((r) => ({ tomador: r.tomador, total: r.total, participacao: totalGeral > 0 ? r.total / totalGeral : 0, porMes: Object.fromEntries(r.porMes) }))
    .sort((a, b) => b.total - a.total);
  const concentracao = { disponivel: clientesConc.length > 0, meses: meses.map((m) => m.mes), clientes: clientesConc, totalGeral };

  const clientePrincipal = clientesConc[0]?.tomador || "";
  const chavePrincipal = normalizarNome(clientePrincipal);
  const resumoMeses = meses.map((mm, idx) => {
    const m = monthly.find((x) => mesKey(x?.mes_num) === mm.mes);
    const principal = (m?.clientes || [])
      .filter((c) => normalizarNome(c?.nome) === chavePrincipal)
      .reduce((s, c) => s + soNumero(c?.valor), 0);
    const anterior = idx > 0 ? meses[idx - 1].receita : 0;
    return { mes: mm.mes, receita: mm.receita, varMoM: varMoM(mm.receita, anterior), principal, outros: mm.receita - principal };
  });
  const resumoMensal = { disponivel: resumoMeses.length > 0, clientePrincipal, meses: resumoMeses };

  const clientesTicket = [...porTomador.values()]
    .map((r) => ({ cliente: r.tomador, receita: r.total, pedidos: r.pedidos, ticketMedio: r.pedidos > 0 ? r.total / r.pedidos : null }))
    .sort((a, b) => b.receita - a.receita);
  const ticketMedio = { disponivel: clientesTicket.length > 0, temVolume: clientesTicket.some((c) => c.pedidos > 0), clientes: clientesTicket };

  return { porPeriodo, previsao, concentracao, resumoMensal, ticketMedio };
}

// ===== Espelho do artefato (mirror): mesma forma para as 3 abas =====
// A tela consome UMA forma só (a "mirror"). O artefato já traz tudo
// pré-calculado, então aqui é quase pass-through normalizado.

function normalizarKanbanArtefato(KANBAN = {}, UPDATES = {}) {
  const etapas = (KANBAN.stages || []).map((st) => ({
    etapa: textoLimpo(st?.label) || "Sem etapa",
    quantidade: (st?.items || []).length,
    valor: (st?.items || []).reduce((s, i) => s + soNumero(i?.valor), 0),
    itens: (st?.items || []).map((i) => ({ cliente: textoLimpo(i?.nome), valor: soNumero(i?.valor) })),
  }));
  const pipeline = {
    disponivel: etapas.length > 0,
    etapas,
    total: etapas.reduce((s, e) => s + e.quantidade, 0),
    valorTotal: etapas.reduce((s, e) => s + e.valor, 0),
  };
  const fupClientes = (UPDATES.fup_list || [])
    .map((f) => ({
      cliente: textoLimpo(f?.nome),
      etapa: textoLimpo(f?.etapa),
      valor: soNumero(f?.valor),
      atualizadoEm: textoLimpo(f?.data_ultima_atualizacao),
      semFupDias: soNumero(f?.dias_sem_atualizacao),
      texto: textoLimpo(f?.texto),
    }))
    .sort((a, b) => b.semFupDias - a.semFupDias);
  const semana = (UPDATES.weekly_updates || []).map((w) => ({
    cliente: textoLimpo(w?.nome),
    etapa: textoLimpo(w?.etapa),
    valor: soNumero(w?.valor),
    data: textoLimpo(w?.data_ultima_atualizacao),
    texto: textoLimpo(w?.texto),
  }));
  return {
    atualizado: textoLimpo(KANBAN.atualizado) || textoLimpo(UPDATES.atualizado),
    pipeline,
    fup: { disponivel: fupClientes.length > 0, clientes: fupClientes },
    updatesSemana: { disponivel: semana.length > 0, itens: semana },
  };
}

function normalizarOpsArtefato(OPS = {}) {
  const otd = OPS.otd || {};
  const efet = OPS.efetividade || {};
  const wf = OPS.waterfall || {};
  const lt = OPS.leadtime || {};
  const sla = OPS.slaRota || {};
  const re = OPS.reentrega || {};
  // Chave YYYY-MM (a partir do mes_num) para os comparativos ordenarem/casarem
  // corretamente; o rótulo na tela continua vindo do mesLabel.
  const anoOps = (textoLimpo(OPS.otd?.daily?.[0]?.data) || textoLimpo(OPS.periodo).match(/\d{4}/)?.[0] || "2026").slice(0, 4);
  const volumeMeses = (otd.monthly || []).map((m) => ({
    mes: m?.mes_num ? `${anoOps}-${String(m.mes_num).padStart(2, "0")}` : textoLimpo(m?.mes),
    pedidos: soNumero(m?.total),
  }));
  return {
    atualizado: textoLimpo(OPS.atualizado),
    periodo: textoLimpo(OPS.periodo),
    servicoNota: textoLimpo(OPS.servicoNota),
    volume: { disponivel: volumeMeses.length > 0, meses: volumeMeses },
    otd: {
      disponivel: (otd.monthly || []).length > 0,
      meta: soNumero(OPS.meta_otd) || 98,
      acumuladoPct: soNumero(otd.acumulado_pct),
      meses: (otd.monthly || []).map((m) => ({ mes: textoLimpo(m?.mes), total: soNumero(m?.total), noPrazo: soNumero(m?.noPrazo), foraPrazo: soNumero(m?.foraPrazo), pct: soNumero(m?.pct) })),
      daily: (otd.daily || []).map((d) => ({ data: textoLimpo(d?.data), pct: soNumero(d?.pct) })),
    },
    efetividade: {
      disponivel: (efet.monthly || []).length > 0,
      acumuladoPct: soNumero(efet.acumulado_pct),
      meses: (efet.monthly || []).map((m) => ({ mes: textoLimpo(m?.mes), total: soNumero(m?.total), finalizadas: soNumero(m?.finalizadas), insucessos: soNumero(m?.insucessos), pctEfetividade: soNumero(m?.pctEfetividade), pctInsucesso: soNumero(m?.pctInsucesso) })),
    },
    ocorrencias: {
      disponivel: (wf.monthly || []).length > 0,
      defaultKey: textoLimpo(wf.defaultKey),
      meses: (wf.monthly || []).map((m) => ({
        key: textoLimpo(m?.key),
        label: textoLimpo(m?.label),
        mes: textoLimpo(m?.mes),
        totalProcessadas: soNumero(m?.totalProcessadas),
        totalInsucessos: soNumero(m?.totalInsucessos),
        pctInsucesso: soNumero(m?.pctInsucesso),
        motivos: (m?.motivos || []).map((x) => ({ motivo: textoLimpo(x?.motivo), count: soNumero(x?.count), pct: soNumero(x?.pct), pctOfTotal: soNumero(x?.pctOfTotal) })),
      })),
    },
    leadtime: {
      disponivel: (lt.monthly || []).length > 0,
      nota: textoLimpo(lt.nota),
      meses: (lt.monthly || []).map((m) => ({ mes: textoLimpo(m?.mes), medianaH: soNumero(m?.medianaH), mediaH: soNumero(m?.mediaH), count: soNumero(m?.count) })),
    },
    slaRota: {
      disponivel: (sla.rows || []).length > 0,
      topN: soNumero(sla.top_n),
      pctVolumeCoberto: soNumero(sla.pct_volume_coberto),
      rotasTotais: soNumero(sla.rotas_totais),
      nota: textoLimpo(sla.nota),
      rows: (sla.rows || []).map((r) => ({ rota: textoLimpo(r?.rota), total: soNumero(r?.total), foraPrazo: soNumero(r?.foraPrazo), pctForaPrazo: soNumero(r?.pctForaPrazo) })),
    },
    reentrega: {
      disponivel: (re.rows_por_rota || []).length > 0 || soNumero(re.pct_geral) > 0,
      pctGeral: soNumero(re.pct_geral),
      nota: textoLimpo(re.nota),
      distribuicao: (re.distribuicao_tentativas || []).map((d) => ({ tentativas: soNumero(d?.tentativas), count: soNumero(d?.count) })),
      rows: (re.rows_por_rota || []).map((r) => ({ rota: textoLimpo(r?.rota), total: soNumero(r?.total), multiTentativa: soNumero(r?.multiTentativa), pctMultiTentativa: soNumero(r?.pctMultiTentativa) })),
    },
    // O artefato não traz a quebra cliente × praça de embarque; ela vem dos
    // fatos do Track3R (origem por encomenda). Fica pronta e vazia até lá.
    praca: { disponivel: false, pracas: [], matriz: [] },
  };
}

// Kanban EDITÁVEL a partir das oportunidades nativas do ERP (todogreen_opportunities).
// Mesma forma "mirror" das outras fontes, mas cada card carrega o `id` da
// oportunidade para permitir editar (mover etapa, valor, follow-up) na tela.
export function montarKanbanDeOportunidades(oportunidades = [], hoje = new Date()) {
  const ref = (hoje instanceof Date ? hoje : new Date(hoje)).getTime();
  const porEtapa = new Map();
  for (const o of oportunidades) {
    const etapa = textoLimpo(o?.estagio) || "Sem etapa";
    if (!porEtapa.has(etapa)) porEtapa.set(etapa, { etapa, quantidade: 0, valor: 0, itens: [] });
    const r = porEtapa.get(etapa);
    r.quantidade += 1;
    r.valor += soNumero(o?.valorMensal);
    r.itens.push({
      id: textoLimpo(o?.id),
      cliente: textoLimpo(o?.cliente) || textoLimpo(o?.titulo) || "Oportunidade",
      valor: soNumero(o?.valorMensal),
      interacoes: soNumero(o?.interacoes),
    });
  }
  const etapas = [...porEtapa.values()].sort((a, b) => b.valor - a.valor);
  const pipeline = {
    disponivel: etapas.length > 0,
    etapas,
    total: oportunidades.length,
    valorTotal: etapas.reduce((s, e) => s + e.valor, 0),
  };
  const clientes = oportunidades
    .map((o) => {
      const base = textoLimpo(o?.ultimaInteracaoEm) || textoLimpo(o?.atualizadoEm);
      const t = base ? Date.parse(base) : NaN;
      const semFupDias = Number.isFinite(t) ? Math.max(0, Math.floor((ref - t) / 86400000)) : null;
      return {
        id: textoLimpo(o?.id),
        cliente: textoLimpo(o?.cliente) || textoLimpo(o?.titulo) || "Oportunidade",
        etapa: textoLimpo(o?.estagio) || "Sem etapa",
        valor: soNumero(o?.valorMensal),
        atualizadoEm: base,
        semFupDias,
        texto: textoLimpo(o?.texto),
        interacoes: soNumero(o?.interacoes),
      };
    })
    .sort((a, b) => soNumero(b.semFupDias) - soNumero(a.semFupDias));
  return {
    atualizado: "",
    editavel: true,
    pipeline,
    fup: { disponivel: clientes.length > 0, clientes },
    updatesSemana: { disponivel: false, itens: [] },
  };
}

// Merge da RECEITA: artefato (base congelada até o corte) + faturas do webhook
// (lançadas DEPOIS do corte). O histórico do artefato é preservado e as faturas
// novas somam por cima — sem gatilho manual e sem dupla contagem (o worker filtra
// as faturas por data > corte antes de chamar). `resumoMensal`/`ticketMedio`
// seguem do artefato (base histórica); `porPeriodo`, `concentracao` e `previsao`
// passam a refletir a soma.
export function mesclarReceitaComFaturas(receitaArtefato, faturasApos = [], hoje = new Date()) {
  if (!receitaArtefato) return receitaArtefato;
  if (!Array.isArray(faturasApos) || faturasApos.length === 0) return receitaArtefato;

  const incPeriodo = receitaPorPeriodo(faturasApos);
  const incConc = concentracaoPorTomador(faturasApos);

  const mesMap = new Map();
  for (const m of receitaArtefato.porPeriodo?.meses || []) mesMap.set(m.mes, soNumero(m.receita));
  for (const m of incPeriodo.meses) mesMap.set(m.mes, soNumero(mesMap.get(m.mes)) + soNumero(m.receita));
  const meses = [...mesMap.entries()].map(([mes, receita]) => ({ mes, receita })).sort((a, b) => ordenarMeses(a.mes, b.mes));

  const diaMap = {};
  const somarDias = (src) => {
    for (const [mes, arr] of Object.entries(src || {})) {
      if (!diaMap[mes]) diaMap[mes] = new Map();
      for (const d of arr) diaMap[mes].set(d.dia, soNumero(diaMap[mes].get(d.dia)) + soNumero(d.receita));
    }
  };
  somarDias(receitaArtefato.porPeriodo?.porDia);
  somarDias(incPeriodo.porDia);
  const porDia = {};
  for (const [mes, mp] of Object.entries(diaMap)) {
    porDia[mes] = [...mp.entries()].map(([dia, receita]) => ({ dia, receita })).sort((a, b) => ordenarMeses(a.dia, b.dia));
  }
  const porPeriodo = { disponivel: meses.length > 0, meses, porDia };

  const cMap = new Map();
  const somarClientes = (conc) => {
    for (const c of conc?.clientes || []) {
      const chave = normalizarNome(c.tomador);
      if (!cMap.has(chave)) cMap.set(chave, { tomador: c.tomador, total: 0, porMes: new Map() });
      const r = cMap.get(chave);
      r.total += soNumero(c.total);
      for (const [mes, v] of Object.entries(c.porMes || {})) r.porMes.set(mes, soNumero(r.porMes.get(mes)) + soNumero(v));
    }
  };
  somarClientes(receitaArtefato.concentracao);
  somarClientes(incConc);
  const totalGeral = [...cMap.values()].reduce((s, r) => s + r.total, 0);
  const clientes = [...cMap.values()]
    .map((r) => ({ tomador: r.tomador, total: r.total, participacao: totalGeral > 0 ? r.total / totalGeral : 0, porMes: Object.fromEntries(r.porMes) }))
    .sort((a, b) => b.total - a.total);
  const concentracao = { disponivel: clientes.length > 0, meses: meses.map((m) => m.mes), clientes, totalGeral };

  const diarioMesclado = [];
  for (const [mes, arr] of Object.entries(porDia)) {
    for (const d of arr) diarioMesclado.push({ data: d.dia, valor: d.receita, mes, tomador: "" });
  }
  const previsao = previsaoDeFechamento(diarioMesclado, hoje);

  return { ...receitaArtefato, porPeriodo, concentracao, previsao };
}

// Espelho completo do artefato -> forma "mirror" das 3 abas.
export function montarPainelDoArtefato(artefato = {}, hoje = new Date()) {
  const { DATA = {}, KANBAN = {}, UPDATES = {}, OPS = {} } = artefato || {};
  return {
    receita: receitaDeSnapshot(DATA, hoje),
    kanban: normalizarKanbanArtefato(KANBAN, UPDATES),
    operacional: normalizarOpsArtefato(OPS),
  };
}

// Canônico (fatos crus do Track3R via webhook) -> MESMA forma "mirror" que o
// artefato, para a tela ter um caminho só. Preenche o que os fatos permitem;
// o resto fica disponivel:false até haver base.
export function montarPainelCanonicoMirror({ faturas = [], encomendas = [], oportunidades = [] } = {}, hoje = new Date()) {
  const receita = {
    porPeriodo: receitaPorPeriodo(faturas),
    previsao: previsaoDeFechamento(faturas, hoje),
    concentracao: concentracaoPorTomador(faturas),
    resumoMensal: resumoMensalReceita(faturas),
    ticketMedio: ticketMedioPorCliente(faturas, encomendas),
  };
  const pipe = pipelinePorEtapa(oportunidades);
  const fup = clientesParaFup(oportunidades, hoje);
  const kanban = {
    atualizado: "",
    pipeline: {
      disponivel: pipe.disponivel,
      etapas: pipe.etapas.map((e) => ({ etapa: e.etapa, quantidade: e.quantidade, valor: e.valorMensal, itens: e.itens.map((i) => ({ cliente: i.cliente, valor: i.valorMensal })) })),
      total: pipe.totalOportunidades,
      valorTotal: pipe.valorMensalTotal,
    },
    fup: { disponivel: fup.disponivel, clientes: fup.clientes.map((c) => ({ ...c, texto: "" })) },
    updatesSemana: { disponivel: false, itens: [] },
  };
  const otd = otdPorMes(encomendas);
  const efet = efetividadeDeEntregas(encomendas);
  const ocorr = decomposicaoDeOcorrencias(encomendas);
  const lt = leadTimeDeEntrega(encomendas);
  const sla = slaPorRota(encomendas);
  const re = reentregaPorRota(encomendas);
  const vol = volumeDiarioDePedidos(encomendas);
  const operacional = {
    atualizado: "",
    periodo: "",
    servicoNota: "",
    volume: { disponivel: vol.disponivel, meses: vol.meses.map((m) => ({ mes: m.mes, pedidos: m.pedidos })) },
    otd: {
      disponivel: otd.disponivel,
      meta: Math.round((otd.meta || 0.98) * 100),
      acumuladoPct: otd.otdGeral === null ? 0 : otd.otdGeral * 100,
      meses: otd.meses.map((m) => ({ mes: m.mes, total: m.entregues, noPrazo: m.noPrazo, foraPrazo: m.entregues - m.noPrazo, pct: m.otd === null ? 0 : m.otd * 100 })),
      daily: [],
    },
    efetividade: {
      disponivel: efet.disponivel,
      acumuladoPct: efet.efetividadeGeral === null ? 0 : efet.efetividadeGeral * 100,
      meses: efet.meses.map((m) => ({ mes: m.mes, total: m.total, finalizadas: m.entregues, insucessos: m.total - m.entregues, pctEfetividade: m.efetividade === null ? 0 : m.efetividade * 100, pctInsucesso: m.efetividade === null ? 0 : (1 - m.efetividade) * 100 })),
    },
    ocorrencias: {
      disponivel: ocorr.disponivel,
      defaultKey: "",
      meses: ocorr.disponivel
        ? [{ key: "geral", label: "Todos os insucessos", mes: "Geral", totalProcessadas: 0, totalInsucessos: ocorr.total, pctInsucesso: 0, motivos: ocorr.tipos.map((t) => ({ motivo: t.tipo, count: t.quantidade, pct: t.percentual * 100, pctOfTotal: 0 })) }]
        : [],
    },
    leadtime: { disponivel: lt.disponivel, nota: "", meses: lt.meses.map((m) => ({ mes: m.mes, medianaH: null, mediaH: m.horasMedias, count: m.pedidos })) },
    slaRota: { disponivel: sla.disponivel, topN: 20, pctVolumeCoberto: 0, rotasTotais: sla.rotas.length, nota: "", rows: sla.rotas.map((r) => ({ rota: r.rota, total: r.pedidos, foraPrazo: r.foraDoPrazo, pctForaPrazo: r.percentualForaDoPrazo * 100 })) },
    reentrega: { disponivel: re.disponivel, pctGeral: 0, nota: "", distribuicao: [], rows: re.rotas.map((r) => ({ rota: r.rota, total: r.pedidos, multiTentativa: r.comReentrega, pctMultiTentativa: r.percentualReentrega * 100 })) },
    praca: operacionalPorPraca(encomendas),
  };
  return { receita, kanban, operacional };
}

// ===== Montagem das três abas (canônico, a partir dos fatos crus) =====

export function montarPainelComercial({ faturas = [], encomendas = [], oportunidades = [] } = {}, hoje = new Date()) {
  return {
    receita: {
      porPeriodo: receitaPorPeriodo(faturas),
      previsao: previsaoDeFechamento(faturas, hoje),
      concentracao: concentracaoPorTomador(faturas),
      resumoMensal: resumoMensalReceita(faturas),
      ticketMedio: ticketMedioPorCliente(faturas, encomendas),
    },
    kanban: {
      pipeline: pipelinePorEtapa(oportunidades),
      fup: clientesParaFup(oportunidades, hoje),
    },
    operacional: {
      volume: volumeDiarioDePedidos(encomendas),
      otd: otdPorMes(encomendas),
      efetividade: efetividadeDeEntregas(encomendas),
      ocorrencias: decomposicaoDeOcorrencias(encomendas),
      resumoMensal: resumoMensalOperacional(encomendas),
      ranking: rankingClientesPorVolume(encomendas),
      leadTime: leadTimeDeEntrega(encomendas),
      slaPorRota: slaPorRota(encomendas),
      reentrega: reentregaPorRota(encomendas),
    },
  };
}
