import "./TodoGreenPages.css";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDollarSign, Plus, ReceiptText } from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import { LOGISTICS_PRODUCTS } from "../logisticsVerticalDomain.js";
import { agruparPorCentroDeCusto, resumoFinanceiro, saldoAberto, statusFinanceiroEfetivo } from "../todoGreenFinanceDomain.js";
import { faixasDeAtraso, proximoVencimentoMensal } from "../contasPonteDomain.js";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const hoje = () => new Date().toISOString().slice(0, 10);
const LABEL = {
  revenue: { title: "Contas a receber", action: "Nova receita", party: "Cliente ou pagador" },
  cost: { title: "Contas a pagar", action: "Novo custo", party: "Fornecedor" },
  commission: { title: "Comissões da equipe comercial", action: "Nova comissão", party: "Beneficiário" },
};
const STATUS = { pending: "em aberto", partial: "parcial", paid: "pago", overdue: "vencido", cancelled: "cancelado" };

export default function FinancePage({ type, entries = [], clients = [], contracts = [], criar, registrarPagamento, estornarPagamento, listarSubrecurso, setToast }) {
  const copy = LABEL[type] || LABEL.cost;
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  // Lançamento novo abre em janela própria: o livro não é mais empurrado
  // por um formulário de 12 campos (rodada "nada corta a tela", 30/08).
  const [novoAberto, setNovoAberto] = useState(false);
  const [paymentFor, setPaymentFor] = useState(null);
  const [payments, setPayments] = useState([]);
  const [payment, setPayment] = useState({ valor: "", pagoEm: hoje(), meioPagamento: "pix", referencia: "", observacoes: "" });
  const empty = { clientId: "", contractId: "", productId: "middle-mile", category: "", description: "", amount: "", referenceMonth: hoje().slice(0, 7), competenceDate: hoje(), dueDate: "", counterparty: "", documentNumber: "", costCenter: "", budgetCode: "" };
  const [form, setForm] = useState(empty);
  const summary = useMemo(() => resumoFinanceiro(entries), [entries]);
  // Aging por faixa de atraso — motor do app geral, via ponte (regra 5).
  const faixas = useMemo(() => faixasDeAtraso(entries), [entries]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    if (!needle) return entries;
    return entries.filter((entry) => [entry.descricao, entry.categoria, entry.contraparte, entry.numeroDocumento, entry.centroCusto]
      .some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(needle)));
  }, [entries, query]);
  const centers = useMemo(() => agruparPorCentroDeCusto(entries).slice(0, 5), [entries]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await criar("financial", {
        tipo: type, clientId: form.clientId, contratoId: form.contractId, produtoId: form.productId,
        categoria: form.category, descricao: form.description, valor: Number(form.amount),
        mesReferencia: form.referenceMonth, competenciaEm: form.competenceDate, vencimentoEm: form.dueDate,
        contraparte: form.counterparty, numeroDocumento: form.documentNumber, centroCusto: form.costCenter,
        codigoOrcamento: form.budgetCode, situacao: "confirmed", statusFinanceiro: "pending",
      });
      setForm(empty);
      setNovoAberto(false);
      setToast?.(`${copy.action} registrada`);
    } catch (error) { setToast?.(error.message); }
    finally { setSaving(false); }
  };

  // Conta mensal (aluguel, seguro, parcela do caminhão) não se redigita: um
  // clique gera o título do mês seguinte, mesmo dia ajustado a mês curto.
  const repetirProximoMes = async (entry) => {
    const vencimento = proximoVencimentoMensal(entry.vencimentoEm);
    if (!vencimento) { setToast?.("Este lançamento não tem vencimento — informe um para repetir."); return; }
    setSaving(true);
    try {
      await criar("financial", {
        tipo: type, clientId: entry.clientId || "", contratoId: entry.contratoId || "",
        produtoId: entry.produtoId || "middle-mile", categoria: entry.categoria || "",
        descricao: entry.descricao || "", valor: Number(entry.valor) || 0,
        mesReferencia: vencimento.slice(0, 7), competenciaEm: vencimento, vencimentoEm: vencimento,
        contraparte: entry.contraparte || "", numeroDocumento: entry.numeroDocumento || "",
        centroCusto: entry.centroCusto || "", codigoOrcamento: entry.codigoOrcamento || "",
        situacao: "confirmed", statusFinanceiro: "pending",
      });
      setToast?.(`Título repetido para ${vencimento.split("-").reverse().join("/")}.`);
    } catch (error) { setToast?.(error.message); }
    finally { setSaving(false); }
  };

  const openPayment = async (entry) => {
    setPaymentFor(entry);
    setPayment({ valor: String(saldoAberto(entry)), pagoEm: hoje(), meioPagamento: "pix", referencia: "", observacoes: "" });
    try {
      const result = await listarSubrecurso("financial", entry.id, "payments");
      setPayments(result.pagamentos || []);
    } catch (error) { setPayments([]); setToast?.(error.message); }
  };

  const pay = async (event) => {
    event.preventDefault();
    if (!paymentFor) return;
    setSaving(true);
    try {
      await registrarPagamento(paymentFor.id, { ...payment, valor: Number(payment.valor), revision: paymentFor.revision });
      setToast?.("Baixa registrada com histórico");
      setPaymentFor(null);
      setPayments([]);
    } catch (error) { setToast?.(error.message); }
    finally { setSaving(false); }
  };

  // Conjunto das baixas já estornadas: cada estorno é um lançamento negativo com
  // referência "estorno:<idDaBaixa>". Serve para não oferecer estornar duas vezes.
  const estornadas = new Set(
    payments.filter((p) => Number(p.valor) < 0 && String(p.referencia || "").startsWith("estorno:"))
      .map((p) => String(p.referencia).slice("estorno:".length)),
  );

  const estornar = async (pagamentoId) => {
    if (!paymentFor || !estornarPagamento) return;
    if (typeof window !== "undefined" && !window.confirm("Estornar esta baixa? O saldo reabre e o histórico guarda o estorno.")) return;
    setSaving(true);
    try {
      await estornarPagamento(paymentFor.id, pagamentoId);
      setToast?.("Baixa estornada. Saldo reaberto.");
      const result = await listarSubrecurso("financial", paymentFor.id, "payments");
      setPayments(result.pagamentos || []);
    } catch (error) { setToast?.(error.message); }
    finally { setSaving(false); }
  };

  return (
    <section className="tdg-panel tdg-enterprise-ledger">
      <div className="tdg-section-head"><div><span className="tdg-kicker">FINANCEIRO OPERACIONAL</span><h2>{copy.title}</h2><p>Vencimento, competência e baixas no mesmo livro.</p></div><div className="tdg-page-actions"><strong>{entries.length} lançamento(s)</strong><button type="button" className="tdg-action" onClick={() => setNovoAberto(true)}><Plus size={16} />{copy.action}</button></div></div>
      <div className="tdg-result">
        <article className="tdg-metric"><span>Total</span><strong>{BRL.format(summary.total)}</strong><small>lançamentos válidos</small></article>
        <article className="tdg-metric good"><span>Realizado</span><strong>{BRL.format(summary.pago)}</strong><small>com baixa registrada</small></article>
        <article className="tdg-metric"><span>Em aberto</span><strong>{BRL.format(summary.aberto)}</strong><small>{summary.parciais} parcial(is)</small></article>
        <article className={`tdg-metric ${summary.vencido ? "risk" : ""}`}><span>Vencido</span><strong>{BRL.format(summary.vencido)}</strong><small>saldo que exige ação</small></article>
      </div>
      {summary.vencido > 0 && (
        <div className="tdg-aging-row" aria-label="Atraso por faixa">
          {Object.values(faixas).filter((faixa) => faixa.count > 0).map((faixa) => (
            <span className={faixa.label === "A vencer" ? "" : "atrasada"} key={faixa.label}>
              <small>{faixa.label}</small><strong>{BRL.format(faixa.total)}</strong><em>{faixa.count} título(s)</em>
            </span>
          ))}
        </div>
      )}
      {novoAberto && <Modal title={copy.action} onClose={() => setNovoAberto(false)} wide>
      <form className="tdg-access-form tdg-enterprise-form tdg-form-em-modal" onSubmit={save}>
        <label><span>Cliente</span><select value={form.clientId} onChange={(e) => setForm((v) => ({ ...v, clientId: e.target.value }))}><option value="">Sem vínculo</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name || client.nome || client.id}</option>)}</select></label>
        <label><span>Contrato</span><select value={form.contractId} onChange={(e) => setForm((v) => ({ ...v, contractId: e.target.value }))}><option value="">Sem contrato</option>{contracts.filter((contract) => !form.clientId || contract.clientId === form.clientId).map((contract) => <option key={contract.id} value={contract.id}>{contract.titulo || contract.title}</option>)}</select></label>
        <label><span>{copy.party}</span><input value={form.counterparty} onChange={(e) => setForm((v) => ({ ...v, counterparty: e.target.value }))} /></label>
        <label><span>Descrição</span><input value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} /></label>
        <label><span>Categoria</span><input value={form.category} onChange={(e) => setForm((v) => ({ ...v, category: e.target.value }))} /></label>
        <label><span>Valor R$</span><input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((v) => ({ ...v, amount: e.target.value }))} /></label>
        <label><span>Vencimento</span><input type="date" value={form.dueDate} onChange={(e) => setForm((v) => ({ ...v, dueDate: e.target.value }))} /></label>
        <label><span>Competência</span><input type="date" value={form.competenceDate} onChange={(e) => setForm((v) => ({ ...v, competenceDate: e.target.value }))} /></label>
        <label><span>Documento</span><input value={form.documentNumber} onChange={(e) => setForm((v) => ({ ...v, documentNumber: e.target.value }))} /></label>
        <label><span>Centro de custo</span><input value={form.costCenter} onChange={(e) => setForm((v) => ({ ...v, costCenter: e.target.value }))} /></label>
        <label><span>Código de orçamento</span><input value={form.budgetCode} onChange={(e) => setForm((v) => ({ ...v, budgetCode: e.target.value }))} /></label>
        <label><span>Produto</span><select value={form.productId} onChange={(e) => setForm((v) => ({ ...v, productId: e.target.value }))}>{LOGISTICS_PRODUCTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="tdg-form-actions"><button type="button" onClick={() => setNovoAberto(false)}>Cancelar</button><button className="tdg-action" type="submit" disabled={saving}><Plus size={17} />{saving ? "Salvando..." : "Salvar lançamento"}</button></div>
      </form>
      </Modal>}
      <div className="tdg-ledger-tools"><label className="tdg-search"><ReceiptText size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar documento, contraparte, categoria ou centro de custo" /></label>{centers.length > 0 && <small>Maiores centros: {centers.map(([name, value]) => `${name} ${BRL.format(value)}`).join(" · ")}</small>}</div>
      <div className="tdg-ledger-table" aria-label={copy.title}>
        {filtered.length === 0 && <div className="tdg-empty-access">Nenhum lançamento encontrado.</div>}
        {filtered.map((entry) => {
          const status = statusFinanceiroEfetivo(entry);
          return <article className="tdg-ledger-row" key={entry.id}><span><strong>{entry.descricao || entry.categoria}</strong><small>{entry.contraparte || "sem contraparte"} · {entry.numeroDocumento || "sem documento"}</small></span><span><small>Vencimento</small><strong>{entry.vencimentoEm || "não informado"}</strong></span><span><small>Saldo</small><strong>{BRL.format(saldoAberto(entry))}</strong></span><span className={`tdg-ledger-status ${status}`}>{status === "overdue" ? <AlertTriangle size={15} /> : status === "paid" ? <CheckCircle2 size={15} /> : <CircleDollarSign size={15} />}{STATUS[status]}</span>{!["paid", "cancelled"].includes(status) && <button type="button" onClick={() => openPayment(entry)}>Dar baixa</button>}{status !== "cancelled" && <button type="button" onClick={() => repetirProximoMes(entry)} disabled={saving} title="Gera o mesmo título com vencimento no mês seguinte">Repetir mês</button>}</article>;
        })}
      </div>
      {/* Baixa em janela própria: antes o formulário nascia DEPOIS da tabela
          inteira — com muitos títulos, a ação abria fora da tela. */}
      {paymentFor && <Modal title={`Baixa de ${paymentFor.descricao || paymentFor.categoria}`} onClose={() => setPaymentFor(null)} wide>
        <form className="tdg-inline-editor tdg-form-em-modal" onSubmit={pay}><div><small>Saldo aberto: {BRL.format(saldoAberto(paymentFor))} · {payments.filter((p) => Number(p.valor) > 0).length} baixa(s) anterior(es)</small></div><label><span>Valor</span><input type="number" min="0.01" max={saldoAberto(paymentFor)} step="0.01" required value={payment.valor} onChange={(e) => setPayment((v) => ({ ...v, valor: e.target.value }))} /></label><label><span>Data</span><input type="date" required value={payment.pagoEm} onChange={(e) => setPayment((v) => ({ ...v, pagoEm: e.target.value }))} /></label><label><span>Meio</span><select value={payment.meioPagamento} onChange={(e) => setPayment((v) => ({ ...v, meioPagamento: e.target.value }))}><option value="pix">PIX</option><option value="transferencia">Transferência</option><option value="boleto">Boleto</option><option value="cartao">Cartão</option><option value="outro">Outro</option></select></label><label><span>Referência</span><input value={payment.referencia} onChange={(e) => setPayment((v) => ({ ...v, referencia: e.target.value }))} /></label><button className="tdg-action" type="submit" disabled={saving}>Confirmar baixa</button><button type="button" onClick={() => setPaymentFor(null)}>Cancelar</button></form>
        {payments.length > 0 && (
          <div className="tdg-payment-history">
            <strong>Histórico de baixas</strong>
            {payments.map((p) => {
              const negativa = Number(p.valor) < 0;
              return (
                <div className={`tdg-payment-row${negativa ? " estorno" : ""}`} key={p.id}>
                  <span>{negativa ? "Estorno" : (p.meioPagamento || "baixa")} · {p.pagoEm ? String(p.pagoEm).slice(0, 10) : ""}</span>
                  <strong>{BRL.format(Number(p.valor))}</strong>
                  {!negativa && estornarPagamento && (
                    estornadas.has(p.id)
                      ? <em>estornada</em>
                      : <button type="button" onClick={() => estornar(p.id)} disabled={saving}>Estornar</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>}
    </section>
  );
}
