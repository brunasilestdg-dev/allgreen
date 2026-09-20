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

// Uma encomenda foi entregue? O Track3R marca "03" como Entregue; o texto de
// status/ocorrência confirma. Guarda contra "não entregue" para não contar
// insucesso como sucesso.
const foiEntregue = (enc) => {
  if (textoLimpo(enc?.occurrenceCode) === "03") return true;
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
    const tipo = textoLimpo(e?.occurrence);
    if (!tipo) continue;
    if (foiEntregue(e)) continue; // ocorrência de sucesso não é "insucesso"
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

// ===== Montagem das três abas =====

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
