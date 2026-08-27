// Folha de pagamento: o motor dos encargos, puro e testado nas fronteiras.
//
// Duas decisões estruturam o arquivo:
//
//   1. As tabelas de INSS, IRRF, FGTS e deduções são VERSIONADAS, no mesmo
//      espírito dos fatores de emissão do ESG: mudar a tabela não reescreve o
//      passado. A folha de janeiro guarda a versão que usou; corrigir a tabela
//      em maio não muda o líquido de janeiro. Por isso `TABELAS_2025` carrega
//      `versao` e `fonte`, e toda função recebe a tabela como parâmetro.
//
//   2. O arredondamento é onde a folha vira erro de salário. Cada faixa
//      progressiva é somada e arredondada uma vez, no fim — não a cada faixa —,
//      e o teste cobre exatamente o valor de fronteira entre faixas, onde um
//      centavo a mais ou a menos muda a alíquota aplicada.
//
// Vocabulário: "colaborador", nunca "funcionário" — no produto "funcionário" é
// a persona de IA. Pessoas reais são colaboradores.

import { roundMoney } from "./logisticsVerticalDomain.js";

export { roundMoney };

// ─── Tabelas de encargos (versionadas) ──────────────────────
//
// Valores de referência de 2025. São o ponto de partida auditável; quando a
// Receita/Previdência publicar a tabela de outro ano, entra uma versão nova,
// e as folhas já fechadas continuam apontando para a versão que usaram.

export const TABELAS_2025 = Object.freeze({
  versao: "2025.1",
  fonte: "Portaria Interministerial MPS/MF e tabela progressiva do IRRF vigentes em 2025",
  responsavel: "titular (a confirmar a cada virada de exercício)",

  // INSS: contribuição do empregado, progressiva por faixa. Cada faixa é
  // tributada pela própria alíquota, cumulativamente, até o teto.
  inss: Object.freeze({
    faixas: Object.freeze([
      Object.freeze({ ate: 1518.00, aliquota: 7.5 }),
      Object.freeze({ ate: 2793.88, aliquota: 9 }),
      Object.freeze({ ate: 4190.83, aliquota: 12 }),
      Object.freeze({ ate: 8157.41, aliquota: 14 }),
    ]),
    teto: 8157.41,
  }),

  // IRRF: tabela mensal com dedução por faixa (parcela a deduzir).
  irrf: Object.freeze({
    faixas: Object.freeze([
      Object.freeze({ ate: 2428.80, aliquota: 0, deducao: 0 }),
      Object.freeze({ ate: 2826.65, aliquota: 7.5, deducao: 182.16 }),
      Object.freeze({ ate: 3751.05, aliquota: 15, deducao: 394.16 }),
      Object.freeze({ ate: 4664.68, aliquota: 22.5, deducao: 675.49 }),
      Object.freeze({ ate: Infinity, aliquota: 27.5, deducao: 908.73 }),
    ]),
    deducaoPorDependente: 189.59,
    descontoSimplificado: 607.20,
  }),

  fgts: Object.freeze({ aliquota: 8 }),

  // Adicionais e multiplicadores previstos em lei (CLT).
  adicionais: Object.freeze({
    noturno: 20,        // % sobre a hora, art. 73 CLT
    horaExtra50: 50,    // % mínimo em dia útil
    horaExtra100: 100,  // % em domingos e feriados
  }),
});

const arredondar = (v) => roundMoney(v, 2);
const n = (valor) => {
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : 0;
};

// ─── INSS ────────────────────────────────────────────────────

export function calcularInss(baseBruta, tabela = TABELAS_2025) {
  const base = n(baseBruta);
  const { faixas, teto } = tabela.inss;
  if (base <= 0) return { base: 0, valor: 0, aliquotaEfetiva: 0, faixa: 0 };

  const baseLimitada = Math.min(base, teto);
  let acumulado = 0;
  let anterior = 0;
  let faixaAtingida = 0;

  for (let i = 0; i < faixas.length; i++) {
    const { ate, aliquota } = faixas[i];
    const topo = Math.min(baseLimitada, ate);
    if (topo > anterior) {
      acumulado += (topo - anterior) * (aliquota / 100);
      faixaAtingida = i + 1;
      anterior = topo;
    }
    if (baseLimitada <= ate) break;
  }

  const valor = arredondar(acumulado);
  return {
    base: arredondar(baseLimitada),
    valor,
    aliquotaEfetiva: baseLimitada > 0 ? arredondar((valor / baseLimitada) * 100) : 0,
    faixa: faixaAtingida,
    teto: base > teto,
  };
}

// ─── IRRF ────────────────────────────────────────────────────
//
// A base é o bruto menos o INSS e as deduções legais (dependentes), ou o
// desconto simplificado quando ele for mais vantajoso — a lei garante a opção.

export function calcularIrrf(baseBruta, opts = {}) {
  const { inss = 0, dependentes = 0, simplificado = "auto", tabela = TABELAS_2025 } = opts;
  const bruto = n(baseBruta);
  if (bruto <= 0) return { base: 0, valor: 0, aliquota: 0, deducao: 0, faixa: 0, modelo: "isento" };

  const t = tabela.irrf;
  const deducaoLegal = n(inss) + n(dependentes) * t.deducaoPorDependente;
  const baseLegal = Math.max(0, bruto - deducaoLegal);
  const baseSimplificada = Math.max(0, bruto - t.descontoSimplificado);

  const usarSimplificado = simplificado === true
    || (simplificado === "auto" && baseSimplificada < baseLegal);
  const base = usarSimplificado ? baseSimplificada : baseLegal;

  let faixa = t.faixas[0];
  let indice = 0;
  for (let i = 0; i < t.faixas.length; i++) {
    if (base <= t.faixas[i].ate) { faixa = t.faixas[i]; indice = i; break; }
  }

  const valor = Math.max(0, arredondar(base * (faixa.aliquota / 100) - faixa.deducao));
  return {
    base: arredondar(base),
    valor,
    aliquota: faixa.aliquota,
    deducao: faixa.deducao,
    faixa: indice + 1,
    modelo: usarSimplificado ? "simplificado" : "completo",
  };
}

// ─── FGTS ────────────────────────────────────────────────────
// Encargo do empregador: não desconta do colaborador, mas entra na folha
// porque é custo da operação e alimenta o arquivo do FGTS.

export function calcularFgts(baseBruta, tabela = TABELAS_2025) {
  const base = n(baseBruta);
  if (base <= 0) return { base: 0, valor: 0, aliquota: tabela.fgts.aliquota };
  return {
    base: arredondar(base),
    valor: arredondar(base * (tabela.fgts.aliquota / 100)),
    aliquota: tabela.fgts.aliquota,
  };
}

// ─── Salário-hora e adicionais ──────────────────────────────

// Jornada mensal padrão de 220 horas (44h semanais × 5 semanas), base legal do
// salário-hora quando não há jornada específica.
export const HORAS_MES_PADRAO = 220;

export function salarioHora(salarioMensal, horasMes = HORAS_MES_PADRAO) {
  const horas = n(horasMes) || HORAS_MES_PADRAO;
  return arredondar(n(salarioMensal) / horas);
}

export function calcularHorasExtras(salarioMensal, horas, percentual = 50, horasMes = HORAS_MES_PADRAO) {
  const valorHora = salarioHora(salarioMensal, horasMes);
  const valorHoraExtra = valorHora * (1 + n(percentual) / 100);
  return {
    horas: n(horas),
    percentual: n(percentual),
    valorHora: arredondar(valorHora),
    valor: arredondar(valorHoraExtra * n(horas)),
  };
}

export function calcularAdicionalNoturno(salarioMensal, horasNoturnas, tabela = TABELAS_2025, horasMes = HORAS_MES_PADRAO) {
  const valorHora = salarioHora(salarioMensal, horasMes);
  const percentual = tabela.adicionais.noturno;
  return {
    horas: n(horasNoturnas),
    percentual,
    valor: arredondar(valorHora * (percentual / 100) * n(horasNoturnas)),
  };
}

// ─── 13º salário ─────────────────────────────────────────────
// Proporcional aos meses trabalhados no ano; mês com 15 dias ou mais conta
// como mês cheio (regra da CLT).

export function calcularDecimoTerceiro(salarioMensal, mesesTrabalhados) {
  const meses = Math.max(0, Math.min(12, Math.trunc(n(mesesTrabalhados))));
  const bruto = arredondar((n(salarioMensal) / 12) * meses);
  return { meses, bruto };
}

// ─── Férias ──────────────────────────────────────────────────
// Remuneração das férias = proporcional aos dias + 1/3 constitucional.

export function calcularFerias(salarioMensal, dias = 30) {
  const diasGozo = Math.max(0, Math.min(30, Math.trunc(n(dias))));
  const proporcional = arredondar((n(salarioMensal) / 30) * diasGozo);
  const tercoConstitucional = arredondar(proporcional / 3);
  return {
    dias: diasGozo,
    proporcional,
    tercoConstitucional,
    bruto: arredondar(proporcional + tercoConstitucional),
  };
}

// ─── DSR sobre variáveis ─────────────────────────────────────
// Descanso semanal remunerado incidente sobre horas extras e adicionais:
// (total das variáveis / dias úteis) × domingos e feriados.

export function calcularDsr(totalVariaveis, diasUteis, domingosEFeriados) {
  const uteis = n(diasUteis);
  if (uteis <= 0) return { valor: 0 };
  return {
    valor: arredondar((n(totalVariaveis) / uteis) * n(domingosEFeriados)),
  };
}

// ─── Folha consolidada ───────────────────────────────────────
//
// Junta proventos e descontos de um colaborador numa competência. O líquido é
// derivado — nunca digitado —, e a base do INSS/IRRF inclui os proventos
// tributáveis. Eventos extras (extras, adicionais, descontos avulsos) entram
// pela lista `eventos`, cada um com sinal explícito.

export function calcularFolha(colaborador, opts = {}) {
  const { tabela = TABELAS_2025, eventos = [] } = opts;
  const salario = n(colaborador?.salarioBase);
  const dependentes = Math.max(0, Math.trunc(n(colaborador?.dependentes)));

  const proventos = [];
  const descontos = [];

  proventos.push({ codigo: "salario", descricao: "Salário base", valor: arredondar(salario) });

  let baseTributavel = salario;
  for (const evento of eventos) {
    const valor = arredondar(n(evento.valor));
    if (valor === 0) continue;
    const tributavel = evento.tributavel !== false;
    const registro = { codigo: evento.codigo || "evento", descricao: evento.descricao || "", valor: Math.abs(valor) };
    if (evento.tipo === "desconto" || valor < 0) {
      descontos.push(registro);
    } else {
      proventos.push(registro);
      if (tributavel) baseTributavel += valor;
    }
  }

  const inss = calcularInss(baseTributavel, tabela);
  const irrf = calcularIrrf(baseTributavel, { inss: inss.valor, dependentes, tabela });
  const fgts = calcularFgts(baseTributavel, tabela);

  descontos.push({ codigo: "inss", descricao: "INSS", valor: inss.valor });
  if (irrf.valor > 0) descontos.push({ codigo: "irrf", descricao: "IRRF", valor: irrf.valor });

  const totalProventos = arredondar(proventos.reduce((s, p) => s + p.valor, 0));
  const totalDescontos = arredondar(descontos.reduce((s, d) => s + d.valor, 0));
  const liquido = arredondar(totalProventos - totalDescontos);

  return {
    proventos,
    descontos,
    totalProventos,
    totalDescontos,
    liquido,
    baseInss: inss.base,
    baseIrrf: irrf.base,
    inss,
    irrf,
    fgts,
    versaoTabela: tabela.versao,
  };
}

// ─── Validação de cadastro ───────────────────────────────────

export function validarColaborador(dados) {
  const erros = [];
  if (!dados) return ["Dados do colaborador não informados"];
  if (!String(dados.nome || "").trim()) erros.push("Nome é obrigatório");
  if (!validarCpf(dados.cpf)) erros.push("CPF inválido");
  if (!(n(dados.salarioBase) > 0)) erros.push("Salário base deve ser maior que zero");
  if (!String(dados.admissaoEm || "").trim()) erros.push("Data de admissão é obrigatória");
  return erros;
}

// ─── CPF ─────────────────────────────────────────────────────

export function validarCpf(cpf) {
  const limpo = String(cpf ?? "").replace(/\D/g, "");
  if (limpo.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(limpo)) return false;
  const dv = (fatorInicial) => {
    let soma = 0;
    for (let i = 0; i < fatorInicial - 1; i++) soma += Number(limpo[i]) * (fatorInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(10) === Number(limpo[9]) && dv(11) === Number(limpo[10]);
}

// ─── Máscara para dado sensível ──────────────────────────────
// CPF e salário só aparecem para rh/admin/owner. Fora disso, o número não sai
// do servidor — mas quando precisar aparecer parcialmente (uma lista para o
// próprio colaborador conferir), a máscara mostra só o fim.

export function mascararCpf(cpf) {
  const limpo = String(cpf ?? "").replace(/\D/g, "");
  if (limpo.length !== 11) return "";
  return `***.***.${limpo.slice(6, 9)}-${limpo.slice(9)}`;
}

// ─── eSocial / arquivo (sem transmissão) ─────────────────────
// A geração do arquivo fica pronta; a transmissão depende de certificado, como
// no fiscal. Aqui só montamos o conteúdo estruturado.

export function payrollTransmissionEnabled(env) {
  return !!(env && env.ESOCIAL_CERT_PFX && env.ESOCIAL_CERT_PASSWORD);
}

export function resumoFolha(itens) {
  if (!itens || !itens.length) {
    return { colaboradores: 0, totalProventos: 0, totalDescontos: 0, totalLiquido: 0, totalFgts: 0, totalInss: 0, totalIrrf: 0 };
  }
  let totalProventos = 0, totalDescontos = 0, totalLiquido = 0, totalFgts = 0, totalInss = 0, totalIrrf = 0;
  for (const item of itens) {
    totalProventos += n(item.total_proventos ?? item.totalProventos);
    totalDescontos += n(item.total_descontos ?? item.totalDescontos);
    totalLiquido += n(item.liquido);
    totalFgts += n(item.fgts_valor ?? item.fgtsValor);
    totalInss += n(item.inss_valor ?? item.inssValor);
    totalIrrf += n(item.irrf_valor ?? item.irrfValor);
  }
  return {
    colaboradores: itens.length,
    totalProventos: arredondar(totalProventos),
    totalDescontos: arredondar(totalDescontos),
    totalLiquido: arredondar(totalLiquido),
    totalFgts: arredondar(totalFgts),
    totalInss: arredondar(totalInss),
    totalIrrf: arredondar(totalIrrf),
  };
}
