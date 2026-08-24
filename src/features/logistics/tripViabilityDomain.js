// ===== Viabilidade da viagem: aceitar ou não =====
// Camada pura.
//
// O motor de precificação existente responde "quanto devo cobrar". Esta é a
// pergunta inversa, e é a que o operador faz o dia inteiro: **ofereceram este
// frete por este valor — eu aceito?**
//
// Três coisas que fazem a resposta valer:
//
// 1) O custo é informado, não estimado. Cada transportadora tem o seu: o
//    combustível que ela paga, o motorista que ela paga, o pedágio da rota
//    dela. Um custo de tabela produz uma margem de tabela, que não é a margem
//    dela. Por isso as rubricas são abertas — o que o sistema garante é a
//    unidade de cada uma, para que km vire km e hora vire hora.
//
// 2) A margem é calculada, nunca digitada. Margem digitada é margem desejada;
//    o que decide aceite é a margem que sobra depois do custo carregado e da
//    comissão, apurada com a régua comercial em vigor.
//
// 3) Spot e recorrente são contas diferentes. Numa viagem avulsa o retorno
//    vazio costuma não ser remunerado e não há diluição ao longo de meses; num
//    contrato, aceitar é assumir capacidade por um período. Tratar os dois
//    como o mesmo caso é como transportadora perde dinheiro em spot e recusa
//    contrato bom.
//
// Quando falta custo, a saída NÃO recomenda. Recomendar aceite com custo
// incompleto é o erro mais caro que este arquivo poderia cometer.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const arredondar = (v, casas = 2) => {
  const f = 10 ** casas;
  return Math.round(num(v) * f) / f;
};

const texto = (v) => String(v ?? "").trim();

// Número na notação de quem lê: 1,8 e não 1.8.
const ptBr = (v) =>
  num(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

// ---- Modalidade ----
export const MODALIDADES = {
  spot: {
    id: "spot",
    rotulo: "Viagem avulsa (spot)",
    descricao: "Um frete pontual, sem compromisso de recorrência.",
  },
  recorrente: {
    id: "recorrente",
    rotulo: "Contrato recorrente",
    descricao: "Volume repetido por um período, com capacidade comprometida.",
  },
};

export const modalidadeValida = (valor) =>
  Object.prototype.hasOwnProperty.call(MODALIDADES, valor) ? valor : "spot";

export const PRODUTOS_OPERACIONAIS = {
  spot: {
    id: "spot",
    rotulo: "Spot / viagem avulsa",
    descricao: "Frete pontual calculado por viagem, rota e retorno vazio.",
    modeloReceita: "por_viagem",
  },
  first_mile: {
    id: "first_mile",
    rotulo: "First mile",
    descricao: "Coleta na origem, consolidação e janelas por embarcador.",
    modeloReceita: "por_viagem",
  },
  middle_mile: {
    id: "middle_mile",
    rotulo: "Middle mile",
    descricao: "Transferência entre CDs, hubs ou bases com frequência definida.",
    modeloReceita: "por_viagem",
  },
  last_mile: {
    id: "last_mile",
    rotulo: "Last mile",
    descricao: "Distribuição com entregas, ocupação e SLA por rota.",
    modeloReceita: "por_entrega",
  },
  dedicada: {
    id: "dedicada",
    rotulo: "Frota dedicada",
    descricao: "Preço mensal ou diário por veículo alocado.",
    modeloReceita: "por_veiculo_mes",
  },
};

export const produtoValido = (valor) =>
  Object.prototype.hasOwnProperty.call(PRODUTOS_OPERACIONAIS, valor) ? valor : "spot";

// ---- Rubricas de custo ----
//
// A unidade é o que impede o custo personalizado de virar campo livre sem
// sentido. "Motorista: 300" não diz nada; "motorista: R$ 300 por viagem" e
// "motorista: R$ 30 por hora" são contas diferentes.
export const UNIDADES_CUSTO = {
  por_km: {
    id: "por_km",
    rotulo: "por km rodado",
    // Incide sobre TODO km rodado, inclusive o vazio: o caminhão gasta diesel
    // voltando sem carga do mesmo jeito.
    base: "km_total",
  },
  por_km_carregado: {
    id: "por_km_carregado",
    rotulo: "por km com carga",
    base: "km_carregado",
  },
  por_viagem: { id: "por_viagem", rotulo: "por viagem", base: "viagens" },
  por_hora: { id: "por_hora", rotulo: "por hora", base: "horas" },
  por_entrega: { id: "por_entrega", rotulo: "por entrega", base: "entregas" },
  por_veiculo_dia: { id: "por_veiculo_dia", rotulo: "por veículo/dia", base: "veiculo_dia" },
  por_veiculo_mes: { id: "por_veiculo_mes", rotulo: "por veículo/mês", base: "veiculo_mes" },
  fixo: { id: "fixo", rotulo: "valor fechado", base: "fixo" },
  percentual_receita: {
    id: "percentual_receita",
    rotulo: "% sobre o frete",
    base: "receita",
  },
};

export const unidadeValida = (valor) =>
  Object.prototype.hasOwnProperty.call(UNIDADES_CUSTO, valor) ? valor : "fixo";

// Sugestões de rubrica. São ponto de partida para quem está começando, não
// uma tabela fechada: qualquer transportadora pode acrescentar a sua.
export const RUBRICAS_SUGERIDAS = [
  { id: "combustivel", rotulo: "Combustível ou energia", unidade: "por_km", essencial: true },
  { id: "motorista", rotulo: "Motorista", unidade: "por_viagem", essencial: true },
  { id: "custo_frota", rotulo: "Custo do veículo", unidade: "por_veiculo_mes", essencial: true },
  { id: "pedagio", rotulo: "Pedágio", unidade: "por_viagem", essencial: false },
  { id: "manutencao", rotulo: "Manutenção e pneus", unidade: "por_km", essencial: false },
  { id: "ajudante", rotulo: "Ajudante", unidade: "por_hora", essencial: false },
  { id: "diaria_veiculo", rotulo: "Diária do veículo", unidade: "por_veiculo_dia", essencial: false },
  { id: "seguro_carga", rotulo: "Seguro da carga", unidade: "percentual_receita", essencial: false },
  { id: "descarga", rotulo: "Descarga ou movimentação", unidade: "por_viagem", essencial: false },
  { id: "diaria", rotulo: "Diária e alimentação", unidade: "por_viagem", essencial: false },
];

// ---- Volume da operação ----
//
// Separa km com carga de km vazio. Em spot é aqui que mora a diferença entre
// lucro e prejuízo: quem cota 500 km e roda 1000 está pagando o dobro do
// combustível que colocou na conta.
export const volumeDaOperacao = (viagem = {}) => {
  const modalidade = modalidadeValida(viagem.modalidade);
  const produto = produtoValido(viagem.produto);
  const kmPorViagem = num(viagem.kmPorViagem);
  const kmRetornoVazio = Math.max(0, num(viagem.kmRetornoVazio));
  const meses = Math.max(1, Math.round(num(viagem.meses) || 1));
  const veiculos = Math.max(
    0,
    Math.round(num(viagem.veiculosDedicados) || num(viagem.veiculosAlocados) || num(viagem.veiculosDisponiveis) || 0),
  );
  const alocacaoVeiculo = texto(viagem.alocacaoVeiculo) === "dedicado" ? "dedicado" : "compartilhado";
  const diasOperacao = Math.max(
    1,
    Math.round(num(viagem.diasOperacao) || (modalidade === "recorrente" ? meses * 22 : 1)),
  );
  const viagens =
    modalidade === "spot"
      ? Math.max(1, Math.round(num(viagem.viagens) || 1))
      : Math.max(1, Math.round(num(viagem.viagensPorMes) || 0)) *
        meses;
  const entregas = Math.max(
    0,
    Math.round(num(viagem.entregas) || num(viagem.entregasPorViagem) * viagens || 0),
  );

  const kmCarregado = kmPorViagem * viagens;
  const kmTotal = (kmPorViagem + kmRetornoVazio) * viagens;
  const horas = num(viagem.horasPorViagem) * viagens;
  const veiculoDia = veiculos * diasOperacao;
  const veiculoMes =
    modalidade === "recorrente"
      ? veiculos * meses
      : arredondar(veiculoDia / 22, 4);

  return {
    modalidade,
    produto,
    alocacaoVeiculo,
    viagens,
    meses,
    veiculos,
    diasOperacao,
    entregas,
    kmPorViagem,
    kmRetornoVazio,
    kmCarregado: arredondar(kmCarregado, 1),
    kmTotal: arredondar(kmTotal, 1),
    horas: arredondar(horas, 1),
    veiculoDia,
    veiculoMes,
    // Quanto do rodado não gera receita. É o número que ninguém calcula de
    // cabeça e que decide muita viagem spot.
    percentVazio: kmTotal > 0 ? arredondar(((kmTotal - kmCarregado) / kmTotal) * 100, 1) : 0,
  };
};

// ---- Custo direto ----
//
// Cada rubrica vira um valor com a memória de como foi calculada. Sem isso o
// operador vê "R$ 4.320" e não sabe se pode discutir com o cliente.
export const custoDireto = (rubricas = [], volume, receitaBruta = 0) => {
  const itens = [];
  let total = 0;

  for (const rubrica of rubricas) {
    const valor = num(rubrica.valor);
    if (!valor) continue;
    const unidade = unidadeValida(rubrica.unidade);
    const base = UNIDADES_CUSTO[unidade].base;

    let quantidade;
    if (base === "km_total") quantidade = volume.kmTotal;
    else if (base === "km_carregado") quantidade = volume.kmCarregado;
    else if (base === "viagens") quantidade = volume.viagens;
    else if (base === "horas") quantidade = volume.horas;
    else if (base === "entregas") quantidade = volume.entregas;
    else if (base === "veiculo_dia") quantidade = volume.veiculoDia;
    else if (base === "veiculo_mes") quantidade = volume.veiculoMes;
    else if (base === "receita") quantidade = num(receitaBruta) / 100;
    else quantidade = 1;

    const subtotal = valor * quantidade;
    total += subtotal;
    itens.push({
      id: rubrica.id || texto(rubrica.rotulo),
      rotulo: texto(rubrica.rotulo) || rubrica.id || "Rubrica sem nome",
      unidade,
      unidadeRotulo: UNIDADES_CUSTO[unidade].rotulo,
      valorUnitario: arredondar(valor),
      quantidade: arredondar(quantidade, 2),
      subtotal: arredondar(subtotal),
      // A conta escrita, para a pessoa poder conferir sem refazer. Em pt-BR:
      // "1.8 × 400" faz quem lê parar para traduzir o número.
      memoria:
        base === "fixo"
          ? `valor fechado de ${ptBr(valor)}`
          : base === "receita"
            ? `${ptBr(valor)}% sobre o frete de ${ptBr(receitaBruta)}`
            : `${ptBr(valor)} × ${ptBr(quantidade)} ${UNIDADES_CUSTO[unidade].rotulo.replace(/^por /, "")}`,
    });
  }

  // Ordena pelo que mais pesa: é onde a negociação de custo começa.
  itens.sort((a, b) => b.subtotal - a.subtotal);
  return { itens, total: arredondar(total) };
};

// Custos essenciais que faltaram. Sem combustível e sem motorista não existe
// viagem — e uma margem calculada sem eles mente para cima.
export const custosFaltando = (rubricas = []) => {
  const informados = new Set(
    rubricas.filter((r) => num(r.valor) > 0).map((r) => texto(r.id) || texto(r.rotulo)),
  );
  return RUBRICAS_SUGERIDAS.filter((r) => r.essencial && !informados.has(r.id)).map((r) => ({
    id: r.id,
    rotulo: r.rotulo,
  }));
};

// ---- Régua ----
//
// Os mesmos parâmetros que precificam. Se a avaliação de aceite usasse outra
// régua, a empresa recusaria fretes que ela própria cotaria.
export const REGUA_PADRAO = {
  minimumMarginPercent: 18,
  targetMarginPercent: 26,
  opexPercent: 7,
  adminPercent: 4,
  taxPercent: 8.65,
  riskPercent: 3,
  commissionPercent: 2.5,
  versao: "v1.2026",
};

// ---- Avaliação ----
export const RECOMENDACOES = {
  aceitar: "aceitar",
  ressalva: "aceitar-com-ressalva",
  recusar: "recusar",
  semDados: "sem-dados",
};

export const avaliarViagem = (viagem = {}, rubricas = [], regua = REGUA_PADRAO) => {
  const r = { ...REGUA_PADRAO, ...(regua || {}) };
  const volume = volumeDaOperacao(viagem);
  const receitaBruta = arredondar(receitaDaOperacao(viagem, volume));

  const custo = custoDireto(rubricas, volume, receitaBruta);
  const faltando = custosFaltando(rubricas);

  // Mesma composição do motor de preço: encargos incidem sobre o custo direto.
  const opex = custo.total * (num(r.opexPercent) / 100);
  const admin = custo.total * (num(r.adminPercent) / 100);
  const imposto = custo.total * (num(r.taxPercent) / 100);
  const risco = custo.total * (num(r.riskPercent) / 100);
  const custoCarregado = custo.total + opex + admin + imposto + risco;

  const comissao = receitaBruta * (num(r.commissionPercent) / 100);
  const resultado = receitaBruta - custoCarregado - comissao;
  const margemPercent = receitaBruta > 0 ? (resultado / receitaBruta) * 100 : 0;

  // Preço que faria a viagem encostar no piso e no alvo. É o que transforma
  // "recuse" em "peça R$ X" — recusa sem contraproposta não fecha negócio.
  const divisor = (margemAlvo) =>
    Math.max(0.01, 1 - num(margemAlvo) / 100 - num(r.commissionPercent) / 100);
  const precoMinimo = custoCarregado / divisor(r.minimumMarginPercent);
  const precoAlvo = custoCarregado / divisor(r.targetMarginPercent);

  const encargos = {
    opex: arredondar(opex),
    admin: arredondar(admin),
    imposto: arredondar(imposto),
    risco: arredondar(risco),
    total: arredondar(opex + admin + imposto + risco),
  };

  const economia = {
    receitaBruta,
    custoDireto: custo.total,
    encargos,
    custoCarregado: arredondar(custoCarregado),
    comissao: arredondar(comissao),
    resultado: arredondar(resultado),
    margemPercent: arredondar(margemPercent, 1),
    precoMinimo: arredondar(precoMinimo),
    precoAlvo: arredondar(precoAlvo),
    precoMinimoPorViagem: arredondar(precoMinimo / Math.max(1, volume.viagens)),
    precoAlvoPorViagem: arredondar(precoAlvo / Math.max(1, volume.viagens)),
    faltaParaOPiso: arredondar(Math.max(0, precoMinimo - receitaBruta)),
    custoPorKm: volume.kmTotal > 0 ? arredondar(custoCarregado / volume.kmTotal) : 0,
    receitaPorKm: volume.kmCarregado > 0 ? arredondar(receitaBruta / volume.kmCarregado) : 0,
    receitaPorEntrega: volume.entregas > 0 ? arredondar(receitaBruta / volume.entregas) : 0,
    receitaPorVeiculoMes: volume.veiculoMes > 0 ? arredondar(receitaBruta / volume.veiculoMes) : 0,
    precoMinimoPorVeiculoMes: volume.veiculoMes > 0 ? arredondar(precoMinimo / volume.veiculoMes) : 0,
    precoAlvoPorVeiculoMes: volume.veiculoMes > 0 ? arredondar(precoAlvo / volume.veiculoMes) : 0,
    versaoRegua: r.versao || "",
  };

  const { recomendacao, motivo, acao } = decidir({
    economia,
    volume,
    regua: r,
    faltando,
    receitaBruta,
  });

  return {
    modalidade: volume.modalidade,
    produto: volume.produto,
    volume,
    custo,
    economia,
    custosFaltando: faltando,
    recomendacao,
    motivo,
    acao,
    ressalvas: ressalvasDaViagem(viagem, volume, economia, r),
  };
};

export const receitaDaOperacao = (viagem = {}, volume = volumeDaOperacao(viagem)) => {
  const modelo = texto(viagem.modeloReceita) || PRODUTOS_OPERACIONAIS[volume.produto].modeloReceita;
  const frete = num(viagem.freteOferecido);
  if (viagem.fretePorViagem === false || modelo === "global") return frete;
  if (modelo === "por_entrega") return frete * Math.max(1, volume.entregas);
  if (modelo === "por_veiculo_dia") return frete * Math.max(1, volume.veiculoDia);
  if (modelo === "por_veiculo_mes") return frete * Math.max(1, volume.veiculoMes);
  return frete * Math.max(1, volume.viagens);
};

// ---- A decisão ----
//
// Uma recomendação, com o motivo e o que fazer. Três telas de indicador não
// substituem a frase "aceite" ou "não aceite".
const decidir = ({ economia, volume, regua, faltando, receitaBruta }) => {
  if (receitaBruta <= 0)
    return {
      recomendacao: RECOMENDACOES.semDados,
      motivo: "Informe o valor oferecido pelo frete para avaliar a viagem.",
      acao: "Peça o valor ao cliente antes de decidir.",
    };

  if (volume.veiculos <= 0)
    return {
      recomendacao: RECOMENDACOES.semDados,
      motivo: "Informe quantos veículos serão usados na operação.",
      acao: "Defina se o veículo é dedicado ou compartilhado e informe a quantidade alocada.",
    };

  if (economia.custoDireto <= 0)
    return {
      recomendacao: RECOMENDACOES.semDados,
      motivo: "Nenhum custo informado. Sem custo não existe margem para comparar.",
      acao: "Lance ao menos combustível e motorista para o sistema calcular a margem.",
    };

  // Custo essencial faltando é o caso mais perigoso: a conta fecha, a margem
  // parece boa e a viagem dá prejuízo. Não se recomenda aceite assim.
  if (faltando.length)
    return {
      recomendacao: RECOMENDACOES.semDados,
      motivo: `Falta lançar ${faltando.map((f) => f.rotulo.toLowerCase()).join(" e ")}. A margem calculada sem isso fica alta demais e não representa a viagem.`,
      acao: `Informe ${faltando.map((f) => f.rotulo.toLowerCase()).join(" e ")} para o sistema recomendar.`,
    };

  if (economia.resultado < 0)
    return {
      recomendacao: RECOMENDACOES.recusar,
      motivo: `A viagem dá prejuízo de ${moeda(Math.abs(economia.resultado))}: o frete não cobre nem o custo carregado.`,
      acao: `Para não perder dinheiro, o frete precisa ser de ${moeda(economia.precoMinimo)} — hoje está ${moeda(economia.faltaParaOPiso)} abaixo do piso.`,
    };

  if (economia.margemPercent < num(regua.minimumMarginPercent))
    return {
      recomendacao: RECOMENDACOES.recusar,
      motivo: `Margem de ${economia.margemPercent}%, abaixo do piso de ${regua.minimumMarginPercent}% da régua em vigor.`,
      acao: `Peça ${moeda(economia.precoMinimo)}${volume.viagens > 1 ? ` (${moeda(economia.precoMinimoPorViagem)} por viagem)` : ""} para chegar ao piso, ou leve para aprovação comercial com justificativa.`,
    };

  if (economia.margemPercent < num(regua.targetMarginPercent))
    return {
      recomendacao: RECOMENDACOES.ressalva,
      motivo: `Margem de ${economia.margemPercent}%: acima do piso de ${regua.minimumMarginPercent}%, abaixo do alvo de ${regua.targetMarginPercent}%.`,
      acao: `Dá para aceitar. Se houver espaço, ${moeda(economia.precoAlvo)}${volume.viagens > 1 ? ` (${moeda(economia.precoAlvoPorViagem)} por viagem)` : ""} coloca a viagem na margem alvo.`,
    };

  return {
    recomendacao: RECOMENDACOES.aceitar,
    motivo: `Margem de ${economia.margemPercent}%, acima do alvo de ${regua.targetMarginPercent}% da régua em vigor.`,
    acao:
      volume.modalidade === "recorrente"
        ? "Aceite e confirme a capacidade de frota antes de assumir o prazo."
        : "Aceite.",
  };
};

// ---- Ressalvas ----
//
// O que não muda a recomendação, mas muda a conversa. Ordenadas por gravidade.
const ressalvasDaViagem = (viagem, volume, economia, regua) => {
  const lista = [];

  if (volume.percentVazio >= 40)
    lista.push({
      gravidade: "alta",
      texto: `${volume.percentVazio}% do percurso é retorno vazio. Procure carga de retorno antes de fechar: é o item que mais come a margem em viagem avulsa.`,
    });
  else if (volume.percentVazio > 0)
    lista.push({
      gravidade: "baixa",
      texto: `${volume.percentVazio}% do percurso é retorno vazio, já incluído no custo por km.`,
    });

  const prazo = num(viagem.prazoPagamentoDias);
  if (prazo >= 45)
    lista.push({
      gravidade: "media",
      // Sem taxa de capital cadastrada, não se inventa um custo financeiro:
      // diz-se o fato e deixa-se a decisão com quem conhece o caixa.
      texto: `Pagamento em ${prazo} dias. A margem calculada não desconta custo de capital — considere o efeito no caixa antes de aceitar.`,
    });

  if (volume.modalidade === "recorrente" && num(viagem.veiculosDisponiveis) > 0) {
    const necessarios = Math.ceil(
      Math.max(1, num(viagem.viagensPorMes)) /
        Math.max(1, num(viagem.viagensPorVeiculoMes) || 22),
    );
    if (necessarios > num(viagem.veiculosDisponiveis))
      lista.push({
        gravidade: "alta",
        texto: `O contrato exige ${necessarios} veículo(s) e há ${num(viagem.veiculosDisponiveis)} disponível(is). Assumir sem frota confirmada custa o contrato depois.`,
      });
  }

  if (volume.veiculos <= 0)
    lista.push({
      gravidade: "alta",
      texto: "Informe quantos veículos serão usados. Sem veículo alocado, o custo por frota não representa a operação.",
    });

  if (volume.produto === "dedicada" && volume.veiculos <= 0)
    lista.push({
      gravidade: "alta",
      texto: "Frota dedicada exige quantidade de veículos. Sem isso o preço por veículo não representa o contrato.",
    });

  if (volume.alocacaoVeiculo === "compartilhado" && volume.entregas > 1)
    lista.push({
      gravidade: "baixa",
      texto: `Veículo compartilhado com ${volume.entregas} entrega(s). A conta dilui a receita por entrega, mas mantém o custo fixo do veículo na operação.`,
    });

  if (volume.alocacaoVeiculo === "dedicado" && volume.produto !== "dedicada")
    lista.push({
      gravidade: "media",
      texto: "Veículo dedicado em operação que não é frota dedicada. Confira se o cliente remunera a exclusividade.",
    });

  if (volume.produto === "last_mile" && volume.entregas <= 0)
    lista.push({
      gravidade: "media",
      texto: "Last mile sem quantidade de entregas não mostra preço por entrega nem ocupação da rota.",
    });

  if (volume.modalidade === "spot" && economia.margemPercent > 0 && economia.margemPercent < num(regua.targetMarginPercent))
    lista.push({
      gravidade: "baixa",
      texto: "Viagem avulsa com margem apertada ainda pode valer se o veículo ficaria parado. Compare com o que ele renderia no mesmo período.",
    });

  if (economia.receitaPorKm > 0 && economia.custoPorKm > 0 && economia.receitaPorKm < economia.custoPorKm)
    lista.push({
      gravidade: "alta",
      texto: `Receita de ${moeda(economia.receitaPorKm)} por km com carga contra custo de ${moeda(economia.custoPorKm)} por km rodado.`,
    });

  const ordem = { alta: 0, media: 1, baixa: 2 };
  return lista.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
};

const moeda = (valor) =>
  `R$ ${num(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---- Consolidado ----
//
// O que a operação ganhou (ou perdeu) no conjunto das viagens avaliadas.
// Separa aceitas de recusadas porque são perguntas diferentes: "quanto
// rendeu" e "quanto deixamos passar".
export const resumirViagens = (avaliacoes = []) => {
  const decididas = avaliacoes.filter((a) => a.recomendacao !== RECOMENDACOES.semDados);
  const aceitas = decididas.filter(
    (a) => a.recomendacao === RECOMENDACOES.aceitar || a.recomendacao === RECOMENDACOES.ressalva,
  );
  const recusadas = decididas.filter((a) => a.recomendacao === RECOMENDACOES.recusar);
  const receita = aceitas.reduce((s, a) => s + num(a.economia.receitaBruta), 0);
  const resultado = aceitas.reduce((s, a) => s + num(a.economia.resultado), 0);

  return {
    avaliadas: avaliacoes.length,
    // Fila de trabalho: viagens que ainda não dá para decidir.
    semDados: avaliacoes.length - decididas.length,
    recomendadas: aceitas.length,
    recusadas: recusadas.length,
    receita: arredondar(receita),
    resultado: arredondar(resultado),
    margemMediaPercent: receita > 0 ? arredondar((resultado / receita) * 100, 1) : 0,
    // Quanto de frete foi recusado. Serve para a régua ser revista quando a
    // recusa vira regra em vez de exceção.
    freteRecusado: arredondar(recusadas.reduce((s, a) => s + num(a.economia.receitaBruta), 0)),
  };
};
