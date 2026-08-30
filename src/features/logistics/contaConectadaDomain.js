// Conta 360 conectada: a ficha do cliente no CRM lê operação e financeiro da
// MESMA fonte que as telas de Operações, Ocorrências e Contas a receber usam —
// os registros da vertical — em vez de reescrever a regra de "o que está em
// aberto" dentro do CRM. Duas regras para "título vencido" ou "operação em
// andamento" é o caminho garantido para o CRM mostrar um número e o Financeiro
// mostrar outro para a mesma conta.

// Situações de operação que contam como "em andamento": tudo que ainda não foi
// entregue nem cancelado. É o mesmo vocabulário da OperationsPage
// (planned/active/in_transit/delivered/cancelled).
const OPERACAO_ENCERRADA = new Set(["delivered", "cancelled", "entregue", "cancelado", "cancelada"]);

const soData = (valor) => String(valor || "").slice(0, 10);

// Uma operação está atrasada quando foi prometida para uma data já passada e
// ainda não foi entregue. Mesma leitura de prazo das telas de operação.
const operacaoAtrasada = (op, hoje) => {
  if (op.entregueEm) return false;
  const prometido = soData(op.prometidoEm);
  return Boolean(prometido) && prometido < hoje;
};

// Um título a receber está em aberto quando não foi pago. "Pago" é ter data de
// pagamento ou situação paga — não inventamos baixa que o Financeiro não deu.
const tituloEmAberto = (item) => {
  if (item.pagoEm) return false;
  const situacao = String(item.situacao || item.statusFinanceiro || "").toLowerCase();
  return !["paid", "pago", "baixado", "liquidado", "cancelado"].includes(situacao);
};

export const resumoContaConectada = ({ clientId, operations = [], financial = [], agora = Date.now() } = {}) => {
  const hoje = soData(new Date(agora).toISOString());
  const vazio = {
    operacoesAndamento: [],
    totalAndamento: 0,
    operacoesAtrasadas: 0,
    ocorrenciasAbertas: [],
    totalOcorrencias: 0,
    titulosAbertos: [],
    totalAReceber: 0,
    totalVencido: 0,
    qtdVencidos: 0,
    temAlgo: false,
  };
  if (!clientId) return vazio;

  const doCliente = (operations || []).filter((op) => op.clientId === clientId);

  const operacoesAndamento = doCliente
    .filter((op) => !OPERACAO_ENCERRADA.has(String(op.situacao || "").toLowerCase()))
    .map((op) => ({
      id: op.id,
      referencia: op.referencia || "Operação sem referência",
      origem: op.origem || "",
      destino: op.destino || "",
      situacao: op.situacao || "",
      atrasada: operacaoAtrasada(op, hoje),
    }))
    // Atrasadas primeiro, para o comercial ver o risco antes.
    .sort((a, b) => Number(b.atrasada) - Number(a.atrasada));

  const ocorrenciasAbertas = doCliente
    .map((op) => ({ id: op.id, referencia: op.referencia || "Operação sem referência", ocorrencias: Number(op.ocorrencias || op.incidents || 0) }))
    .filter((op) => op.ocorrencias > 0)
    .sort((a, b) => b.ocorrencias - a.ocorrencias);

  const titulosAbertos = (financial || [])
    .filter((item) => item.clientId === clientId)
    .filter((item) => String(item.tipo || item.kind || "").toLowerCase() === "revenue")
    .filter(tituloEmAberto)
    .map((item) => {
      const valor = Number(item.valor ?? item.amount ?? 0) || 0;
      const vencimentoEm = soData(item.vencimentoEm || item.dueDate);
      const atrasado = Boolean(vencimentoEm) && vencimentoEm < hoje;
      return {
        id: item.id,
        descricao: item.descricao || item.note || item.numeroDocumento || "Título a receber",
        valor,
        vencimentoEm,
        atrasado,
      };
    })
    .sort((a, b) => String(a.vencimentoEm).localeCompare(String(b.vencimentoEm)));

  const totalAReceber = titulosAbertos.reduce((soma, item) => soma + item.valor, 0);
  const vencidos = titulosAbertos.filter((item) => item.atrasado);

  return {
    operacoesAndamento,
    totalAndamento: operacoesAndamento.length,
    operacoesAtrasadas: operacoesAndamento.filter((op) => op.atrasada).length,
    ocorrenciasAbertas,
    totalOcorrencias: ocorrenciasAbertas.reduce((soma, op) => soma + op.ocorrencias, 0),
    titulosAbertos,
    totalAReceber,
    totalVencido: vencidos.reduce((soma, item) => soma + item.valor, 0),
    qtdVencidos: vencidos.length,
    temAlgo: operacoesAndamento.length > 0 || ocorrenciasAbertas.length > 0 || titulosAbertos.length > 0,
  };
};
