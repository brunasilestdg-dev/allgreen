// ===== Tesouraria: atraso, conciliação, saldo e resultado =====
//
// Camada pura. Estende `todoGreenFinanceDomain.js` (saldo aberto, status
// efetivo, agrupamento por centro de custo) em vez de recriá-lo — as duas
// convivem, e o que já está testado lá continua sendo a fonte.
//
// A regra que organiza o arquivo é a de sempre nesta vertical: número mostrado é
// número derivado. Saldo de conta bancária é saldo inicial mais o que foi
// conciliado; valor devido de um título vencido é o valor de face mais o encargo
// calculado agora — nenhum dos dois é coluna.

import { saldoAberto, statusFinanceiroEfetivo } from "./todoGreenFinanceDomain.js";

const texto = (valor) => String(valor ?? "").trim();

const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

// Duas casas, sempre. Somar centavos sem arredondar produz 0.30000000000000004 no
// total do relatório.
const dinheiro = (valor) => Math.round((numero(valor) + Number.EPSILON) * 100) / 100;

const soDia = (valor) => {
  const base = texto(valor).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(base) ? base : "";
};

// Diferença em dias inteiros, em UTC. Usar o fuso local faria o mesmo título
// estar 1 dia mais ou menos atrasado dependendo de onde o Worker rodou.
export const diasEntre = (de, ate) => {
  const a = soDia(de);
  const b = soDia(ate);
  if (!a || !b) return null;
  const ms = Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86400000);
};

// ---------------------------------------------------------------------------
// Multa e juros
// ---------------------------------------------------------------------------

// Multa é percentual único sobre o saldo aberto, cobrada uma vez ao vencer.
// Juros são ao mês, proporcionais aos dias (pro rata die), que é a prática
// brasileira usual — juros compostos exigiriam contrato dizendo isso.
//
// Devolve `{multa, juros, total, dias}` com `dias: null` quando não há vencimento
// declarado. Não vencido devolve zeros, nunca `null`: zero de encargo é resposta
// legítima e a tela pode somar sem checar.
export const encargosDoAtraso = (entry = {}, hojeYmd = "") => {
  const aberto = saldoAberto(entry);
  const vencimento = soDia(entry.vencimentoEm);
  const hoje = soDia(hojeYmd);
  const dias = vencimento && hoje ? diasEntre(vencimento, hoje) : null;

  const semEncargo = { multa: 0, juros: 0, total: 0, dias };
  if (aberto <= 0) return semEncargo;
  // Cancelado não rende encargo.
  if (texto(entry.statusFinanceiro) === "cancelled") return semEncargo;
  if (dias === null || dias <= 0) return semEncargo;

  const multa = dinheiro(aberto * Math.max(0, numero(entry.multaPercent)) / 100);
  const jurosMes = Math.max(0, numero(entry.jurosMesPercent));
  const juros = dinheiro(aberto * (jurosMes / 100) * (dias / 30));
  return { multa, juros, total: dinheiro(multa + juros), dias };
};

// O que cobrar hoje: saldo aberto mais encargos. Separados no retorno para a
// tela poder mostrar a composição — um total sem composição é um número que o
// cliente contesta e ninguém sabe explicar.
export const valorDevido = (entry = {}, hojeYmd = "") => {
  const aberto = dinheiro(saldoAberto(entry));
  const encargos = encargosDoAtraso(entry, hojeYmd);
  return {
    principal: aberto,
    multa: encargos.multa,
    juros: encargos.juros,
    total: dinheiro(aberto + encargos.total),
    diasDeAtraso: encargos.dias !== null && encargos.dias > 0 ? encargos.dias : 0,
  };
};

// ---------------------------------------------------------------------------
// Conta bancária
// ---------------------------------------------------------------------------

// Saldo = saldo inicial + o que foi conciliado. Só o CONCILIADO entra: um título
// marcado como pago mas ainda não casado com o extrato não moveu o banco, e
// somá-lo mostraria um saldo que a conta não tem.
export const saldoDaConta = (conta = {}, linhasDoExtrato = []) => {
  const inicial = numero(conta.saldoInicial);
  const movimento = linhasDoExtrato
    .filter((linha) => texto(linha?.bankAccountId) === texto(conta.id) && linha?.conciliadoEm)
    .reduce((soma, linha) => soma + numero(linha.amount), 0);
  return dinheiro(inicial + movimento);
};

// ---------------------------------------------------------------------------
// Conciliação
// ---------------------------------------------------------------------------

// Sugere o casamento entre uma linha de extrato e os lançamentos abertos.
// Deliberadamente NÃO casa sozinho: devolve candidatos com uma pontuação, e a
// decisão é de quem confere. Conciliação automática que erra é pior que
// conciliação manual, porque ninguém revisa o que o sistema já deu por certo.
//
// A pontuação combina três sinais, do mais forte ao mais fraco:
//   • valor exato (o sinal mais confiável);
//   • proximidade de data (o banco lança em D+0 ou D+1);
//   • documento ou contraparte aparecendo na descrição do extrato.
export const sugerirConciliacao = (linha = {}, lancamentos = [], opcoes = {}) => {
  const valorExtrato = Math.abs(numero(linha.amount));
  const entrada = numero(linha.amount) > 0;
  const dataExtrato = soDia(linha.occurredOn);
  const descricao = texto(linha.description).toLowerCase();
  const toleranciaDias = Math.max(0, Math.trunc(numero(opcoes.toleranciaDias ?? 5)));

  return lancamentos
    .filter((entry) => {
      if (entry?.conciliadoEm) return false;
      if (saldoAberto(entry) <= 0 && numero(entry?.valorPago) <= 0) return false;
      // Entrada no banco casa com receita; saída, com custo ou comissão.
      const tipo = texto(entry?.tipo);
      return entrada ? tipo === "revenue" : tipo !== "revenue";
    })
    .map((entry) => {
      let pontos = 0;
      const motivos = [];

      const face = dinheiro(numero(entry.valor));
      const aberto = dinheiro(saldoAberto(entry));
      // Bate com o valor de face OU com o que ainda falta — as duas coisas
      // acontecem, dependendo de a baixa ser total ou parcial.
      if (Math.abs(face - valorExtrato) <= 0.01) { pontos += 60; motivos.push("valor exato"); }
      else if (Math.abs(aberto - valorExtrato) <= 0.01) { pontos += 50; motivos.push("valor do saldo aberto"); }

      const referencia = soDia(entry.vencimentoEm) || soDia(entry.competenciaEm);
      const distancia = referencia && dataExtrato ? Math.abs(diasEntre(referencia, dataExtrato) ?? 999) : null;
      if (distancia !== null && distancia <= toleranciaDias) {
        pontos += Math.max(0, 25 - distancia * 3);
        motivos.push(distancia === 0 ? "mesma data" : `${distancia} dia(s) de diferença`);
      }

      const documento = texto(entry.numeroDocumento).toLowerCase();
      if (documento && descricao.includes(documento)) { pontos += 15; motivos.push("documento na descrição"); }
      const contraparte = texto(entry.contraparte).toLowerCase();
      if (contraparte.length >= 4 && descricao.includes(contraparte)) {
        pontos += 10;
        motivos.push("contraparte na descrição");
      }

      return { entryId: texto(entry.id), pontos, motivos, valor: face, aberto };
    })
    // Sem valor casando, não é candidato — data e descrição sozinhas casariam
    // qualquer coisa do mesmo dia.
    .filter((candidato) => candidato.pontos >= 50)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 5);
};

// Uma sugestão só é "confiante" quando é isolada: se duas linhas empatam, o
// sistema não sabe qual é, e escolher a primeira seria chutar.
export const conciliacaoConfiavel = (candidatos = []) => {
  if (candidatos.length !== 1) {
    if (candidatos.length < 2) return null;
    if (candidatos[0].pontos - candidatos[1].pontos < 20) return null;
  }
  const melhor = candidatos[0];
  return melhor && melhor.pontos >= 75 ? melhor : null;
};

// Hash estável de uma linha de extrato, para reimportar o mesmo arquivo não
// duplicar. Usa os campos que o banco garante: data, valor, descrição e
// documento. Determinístico de propósito — nada de aleatório nem de horário.
export const hashDaLinhaDoExtrato = (linha = {}) =>
  [
    soDia(linha.occurredOn),
    dinheiro(linha.amount).toFixed(2),
    texto(linha.description).toLowerCase().replace(/\s+/g, " "),
    texto(linha.document),
  ].join("|");

// ---------------------------------------------------------------------------
// Fechamento de período
// ---------------------------------------------------------------------------

export const mesDeCompetencia = (entry = {}) =>
  soDia(entry.competenciaEm).slice(0, 7) ||
  texto(entry.mesReferencia).slice(0, 7) ||
  soDia(entry.vencimentoEm).slice(0, 7);

// Um mês está travado quando existe fechamento com status `fechado`. Reaberto
// não trava — mas o registro do reabrimento fica.
export const periodoTravado = (mes, periodos = []) => {
  const alvo = texto(mes).slice(0, 7);
  if (!alvo) return false;
  return periodos.some(
    (periodo) => texto(periodo?.referenceMonth).slice(0, 7) === alvo && texto(periodo?.status) === "fechado",
  );
};

// A frase do bloqueio, ou "" quando pode escrever. Mesmo contrato dos outros
// validadores do módulo.
export const bloqueioPorFechamento = (entry = {}, periodos = []) => {
  const mes = mesDeCompetencia(entry);
  if (!mes) return "";
  return periodoTravado(mes, periodos)
    ? `A competência ${mes} está fechada. Reabra o período para alterar lançamentos desse mês.`
    : "";
};

// ---------------------------------------------------------------------------
// Resultado estruturado
// ---------------------------------------------------------------------------

// DRE por eixo (conta ou centro de custo), separando receita de custo em vez de
// somar tudo num número. `margem: null` quando não há receita — não 0%, porque
// dividir por zero não é zero por cento. É a mesma convenção de
// `statementDomain.monthResult` no monólito.
export const resultadoPorEixo = (lancamentos = [], eixo = "costCenterId") => {
  const grupos = new Map();
  for (const entry of lancamentos) {
    if (statusFinanceiroEfetivo(entry) === "cancelled") continue;
    const chave = texto(entry?.[eixo]) || "(sem classificação)";
    const atual = grupos.get(chave) || { chave, receita: 0, custo: 0, comissao: 0 };
    const valor = numero(entry?.valor);
    if (entry?.tipo === "revenue") atual.receita += valor;
    else if (entry?.tipo === "commission") atual.comissao += valor;
    else atual.custo += valor;
    grupos.set(chave, atual);
  }

  return [...grupos.values()]
    .map((grupo) => {
      const resultado = dinheiro(grupo.receita - grupo.custo - grupo.comissao);
      return {
        ...grupo,
        receita: dinheiro(grupo.receita),
        custo: dinheiro(grupo.custo),
        comissao: dinheiro(grupo.comissao),
        resultado,
        margem: grupo.receita > 0 ? Math.round((resultado / grupo.receita) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => b.receita - a.receita || a.chave.localeCompare(b.chave, "pt-BR"));
};

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export const validateBankAccount = (conta = {}) => {
  if (!texto(conta.name)) return "Informe o nome da conta.";
  if (!["corrente", "poupanca", "caixa", "aplicacao", "cartao"].includes(texto(conta.kind) || "corrente"))
    return "Escolha o tipo da conta.";
  return "";
};

export const validateStatementLine = (linha = {}) => {
  if (!texto(linha.bankAccountId)) return "Informe a conta bancária.";
  if (!soDia(linha.occurredOn)) return "Informe a data do lançamento do extrato.";
  // Zero não é lançamento de extrato: o banco não registra movimento de nada.
  if (!numero(linha.amount)) return "O valor do lançamento não pode ser zero.";
  return "";
};

export const validatePeriodClose = (mes) =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(texto(mes)) ? "" : "Informe o mês no formato AAAA-MM.";
