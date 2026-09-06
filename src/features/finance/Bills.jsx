import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  Plus,
  Repeat,
  Trash2,
  WalletCards,
} from "lucide-react";
import Modal from "../../components/Modal.jsx";
import {
  agingBuckets,
  billOpenAmount,
  billPaidTotal,
  billStatus,
  billsSummary,
  cashFlowForecast,
  makeBill,
  nextRecurrence,
  paymentToTransaction,
  registerPayment,
  upcomingBills,
} from "./billsDomain.js";

const brl = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const hoje = () => new Date().toISOString().slice(0, 10);
const newId = () => `b-${Math.random().toString(36).slice(2, 10)}`;
const diaMes = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const STATUS_ICON = {
  quitada: CheckCircle2,
  atrasada: AlertTriangle,
  "vence-hoje": AlertTriangle,
};

export default function Bills({ db, update, business, setToast }) {
  const [modal, setModal] = useState(null);
  const [payModal, setPayModal] = useState(null);
  const [aba, setAba] = useState("receber");
  const [mostrarQuitadas, setMostrarQuitadas] = useState(false);

  const todas = useMemo(
    () =>
      (db.bills || []).filter((b) => !business || b.businessId === business.id),
    [db.bills, business],
  );

  const resumo = billsSummary(todas, hoje());
  const faixas = agingBuckets(
    todas.filter((b) => b.direction !== "pagar"),
    hoje(),
  );
  const fluxo = cashFlowForecast(todas, { from: hoje(), weeks: 6 });
  const urgentes = upcomingBills(todas, hoje(), 7);

  const listaAba = todas
    .filter((b) => (aba === "pagar" ? b.direction === "pagar" : b.direction !== "pagar"))
    .filter((b) =>
      mostrarQuitadas ? true : billStatus(b, hoje()).state !== "quitada",
    )
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

  const contatos = useMemo(
    () =>
      [
        ...new Set(
          [
            ...(db.contacts || []).map((c) => c.name),
            ...(db.leads || []).map((l) => l.name),
          ].filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [db.contacts, db.leads],
  );

  const salvar = (conta) => {
    if (!conta.description.trim()) return;
    update((prev) => {
      const existentes = prev.bills || [];
      return {
        ...prev,
        bills: existentes.some((b) => b.id === conta.id)
          ? existentes.map((b) => (b.id === conta.id ? conta : b))
          : [conta, ...existentes],
      };
    });
    setModal(null);
    setToast("Conta salva");
  };

  const excluir = (id) => {
    if (!window.confirm("Excluir esta conta?")) return;
    update((prev) => ({
      ...prev,
      bills: (prev.bills || []).filter((b) => b.id !== id),
    }));
    setToast("Conta excluída");
  };

  // Baixa de pagamento: registra na conta E lança no livro-caixa, para que o
  // Financeiro e as contas nunca contem histórias diferentes.
  const confirmarPagamento = () => {
    const { bill, amount, date } = payModal;
    const at = `${date}T12:00:00.000Z`;
    const pagamento = { id: newId(), amount, at };
    const atualizada = registerPayment(bill, pagamento);
    if (atualizada === bill) {
      setToast("Informe um valor maior que zero");
      return;
    }
    const lancamento = paymentToTransaction(
      bill,
      { amount: billPaidTotal(atualizada) - billPaidTotal(bill), at },
      {
        id: newId(),
        businessId: business?.id || null,
        ownerId: db.user?.id || null,
      },
    );
    const quitou = billOpenAmount(atualizada) <= 0;
    const proxima = quitou ? nextRecurrence(atualizada, newId()) : null;

    update((prev) => ({
      ...prev,
      bills: [
        ...(proxima ? [proxima] : []),
        ...(prev.bills || []).map((b) => (b.id === bill.id ? atualizada : b)),
      ],
      transactions: [lancamento, ...(prev.transactions || [])],
    }));
    setPayModal(null);
    setToast(
      proxima
        ? "Pagamento registrado e próxima parcela criada"
        : "Pagamento registrado no livro-caixa",
    );
  };

  const abrirNova = () =>
    setModal(
      makeBill(newId(), {
        businessId: business?.id || null,
        ownerId: db.user?.id || null,
        direction: aba === "pagar" ? "pagar" : "receber",
      }),
    );

  const maiorFluxo = Math.max(
    1,
    ...fluxo.map((f) => Math.max(f.entradas, f.saidas)),
  );

  return (
    <section className="bills">
      <header className="bills-head">
        <div>
          <h2>
            <WalletCards size={20} /> Contas a receber e a pagar
          </h2>
          <p>
            O Financeiro registra o dinheiro que já entrou ou saiu. Aqui fica o
            que foi combinado e ainda não caiu: quem te deve, o que vence e
            quanto sobra no fim.
          </p>
        </div>
        <button className="btn" onClick={abrirNova}>
          <Plus size={16} /> Nova conta
        </button>
      </header>

      <div className="bills-summary">
        <article className="in">
          <ArrowUpCircle size={18} />
          <strong>{brl(resumo.aReceber)}</strong>
          <small>a receber</small>
          {resumo.atrasadoReceber > 0 && (
            <span className="bills-late">
              {brl(resumo.atrasadoReceber)} atrasado
            </span>
          )}
        </article>
        <article className="out">
          <ArrowDownCircle size={18} />
          <strong>{brl(resumo.aPagar)}</strong>
          <small>a pagar</small>
          {resumo.atrasadoPagar > 0 && (
            <span className="bills-late">
              {brl(resumo.atrasadoPagar)} atrasado
            </span>
          )}
        </article>
        <article className={resumo.saldoPrevisto >= 0 ? "ok" : "warn"}>
          <strong>{brl(resumo.saldoPrevisto)}</strong>
          <small>saldo previsto</small>
        </article>
        <article>
          <strong>{resumo.contasAbertas}</strong>
          <small>contas em aberto</small>
        </article>
      </div>

      {urgentes.length > 0 && (
        <div className="bills-urgent">
          <h3>Precisa de atenção agora</h3>
          <ul>
            {urgentes.slice(0, 6).map(({ bill, status }) => (
              <li key={bill.id} className={status.state}>
                <span className="bills-urgent-desc">
                  {bill.description}
                  {bill.contactName ? ` · ${bill.contactName}` : ""}
                </span>
                <span className="bills-urgent-status">{status.label}</span>
                <strong>{brl(status.open)}</strong>
                <button
                  className="btn ghost sm"
                  onClick={() =>
                    setPayModal({ bill, amount: String(status.open), date: hoje() })
                  }
                >
                  Dar baixa
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bills-panels">
        <section className="bills-aging">
          <h3>Quem está devendo, por tempo de atraso</h3>
          {Object.entries(faixas).every(([, f]) => f.count === 0) ? (
            <p className="bills-hint">Nenhuma conta a receber em aberto.</p>
          ) : (
            <ul>
              {Object.entries(faixas).map(([key, faixa]) => (
                <li key={key} className={key === "aVencer" ? "" : "late"}>
                  <span>{faixa.label}</span>
                  <strong>{brl(faixa.total)}</strong>
                  <small>
                    {faixa.count} {faixa.count === 1 ? "conta" : "contas"}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bills-forecast">
          <h3>Próximas semanas</h3>
          <div className="bills-forecast-chart">
            {fluxo.map((semana) => (
              <div key={semana.start} className="bills-week">
                <div className="bills-bars">
                  <span
                    className="in"
                    style={{ height: `${(semana.entradas / maiorFluxo) * 100}%` }}
                    title={`Entradas: ${brl(semana.entradas)}`}
                  />
                  <span
                    className="out"
                    style={{ height: `${(semana.saidas / maiorFluxo) * 100}%` }}
                    title={`Saídas: ${brl(semana.saidas)}`}
                  />
                </div>
                <small>{diaMes(semana.start)}</small>
                <small
                  className={semana.acumulado >= 0 ? "saldo ok" : "saldo warn"}
                >
                  {brl(semana.acumulado)}
                </small>
              </div>
            ))}
          </div>
          <p className="bills-hint">
            Saldo acumulado partindo de zero, considerando só o que está em
            aberto. Contas atrasadas entram na primeira semana.
          </p>
        </section>
      </div>

      <div className="bills-tabs">
        <button
          className={aba === "receber" ? "active" : ""}
          onClick={() => setAba("receber")}
        >
          A receber
        </button>
        <button
          className={aba === "pagar" ? "active" : ""}
          onClick={() => setAba("pagar")}
        >
          A pagar
        </button>
        <label className="bills-show-paid">
          <input
            type="checkbox"
            checked={mostrarQuitadas}
            onChange={(e) => setMostrarQuitadas(e.target.checked)}
          />
          Mostrar quitadas
        </label>
      </div>

      {listaAba.length === 0 ? (
        <div className="bills-empty">
          <WalletCards size={28} />
          <h3>
            {aba === "pagar" ? "Nenhuma conta a pagar" : "Nenhuma conta a receber"}
          </h3>
          <p>
            {aba === "pagar"
              ? "Cadastre o que você tem para pagar, com vencimento, e o app avisa o que está perto de vencer."
              : "Cadastre o que combinaram te pagar, com vencimento, e acompanhe quem está em atraso."}
          </p>
          <button className="btn" onClick={abrirNova}>
            <Plus size={16} /> Cadastrar a primeira
          </button>
        </div>
      ) : (
        <div className="bills-list">
          {listaAba.map((bill) => {
            const status = billStatus(bill, hoje());
            const Icon = STATUS_ICON[status.state];
            return (
              <article key={bill.id} className={`bill-card ${status.state}`}>
                <div className="bill-main">
                  <strong>{bill.description}</strong>
                  {bill.contactName && <small>{bill.contactName}</small>}
                  <small className="bill-cat">{bill.category}</small>
                </div>
                <div className="bill-values">
                  <strong>{brl(bill.value)}</strong>
                  {status.paid > 0 && status.state !== "quitada" && (
                    <small>
                      pago {brl(status.paid)} · falta {brl(status.open)}
                    </small>
                  )}
                </div>
                <div className="bill-due">
                  <span className={`bill-status ${status.state}`}>
                    {Icon && <Icon size={13} />} {status.label}
                  </span>
                  {bill.dueDate && <small>{diaMes(bill.dueDate)}</small>}
                  {bill.recurring && (
                    <small className="bill-rec">
                      <Repeat size={12} /> mensal
                    </small>
                  )}
                </div>
                <div className="bill-actions">
                  {status.state !== "quitada" && (
                    <button
                      className="btn ghost sm"
                      onClick={() =>
                        setPayModal({
                          bill,
                          amount: String(status.open),
                          date: hoje(),
                        })
                      }
                    >
                      Dar baixa
                    </button>
                  )}
                  <button className="btn ghost sm" onClick={() => setModal(bill)}>
                    Editar
                  </button>
                  <button
                    className="btn ghost sm danger"
                    onClick={() => excluir(bill.id)}
                    title="Excluir conta"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {modal && (
        <Modal
          title={
            (db.bills || []).some((b) => b.id === modal.id)
              ? "Editar conta"
              : "Nova conta"
          }
          onClose={() => setModal(null)}
        >
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              salvar(modal);
            }}
          >
            <div className="bills-direction">
              {["receber", "pagar"].map((dir) => (
                <button
                  key={dir}
                  type="button"
                  className={modal.direction === dir ? "active" : ""}
                  onClick={() => setModal({ ...modal, direction: dir })}
                >
                  {dir === "receber" ? "Tenho a receber" : "Tenho a pagar"}
                </button>
              ))}
            </div>
            <label className="bill-field">
              Descrição
              <input
                required
                autoFocus
                placeholder="Ex.: recarga da frota, pedágio, manutenção de veículo"
                value={modal.description}
                onChange={(e) =>
                  setModal({ ...modal, description: e.target.value })
                }
              />
            </label>
            <label className="bill-field">
              {modal.direction === "pagar" ? "Para quem" : "De quem"} (opcional)
              <input
                list="bills-contacts"
                value={modal.contactName}
                onChange={(e) =>
                  setModal({ ...modal, contactName: e.target.value })
                }
              />
              <datalist id="bills-contacts">
                {contatos.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <div className="bill-field-row">
              <label className="bill-field">
                Valor (R$)
                <input
                  required
                  inputMode="decimal"
                  placeholder="0,00"
                  value={modal.value}
                  onChange={(e) => setModal({ ...modal, value: e.target.value })}
                />
              </label>
              <label className="bill-field">
                Vencimento
                <input
                  type="date"
                  value={modal.dueDate}
                  onChange={(e) =>
                    setModal({ ...modal, dueDate: e.target.value })
                  }
                />
              </label>
            </div>
            <label className="bill-field">
              Categoria
              <input
                value={modal.category}
                onChange={(e) => setModal({ ...modal, category: e.target.value })}
              />
            </label>
            <label className="bill-recurring">
              <input
                type="checkbox"
                checked={!!modal.recurring}
                onChange={(e) =>
                  setModal({ ...modal, recurring: e.target.checked })
                }
              />
              <span>
                Se repete todo mês — ao quitar, o app já cria a conta do mês
                seguinte.
              </span>
            </label>
            <footer className="modal-foot">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setModal(null)}
              >
                Cancelar
              </button>
              <button className="btn" type="submit">
                Salvar conta
              </button>
            </footer>
          </form>
        </Modal>
      )}

      {payModal && (
        <Modal title="Dar baixa" onClose={() => setPayModal(null)}>
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              confirmarPagamento();
            }}
          >
            <p className="bills-hint">
              {payModal.bill.description} · em aberto{" "}
              <strong>{brl(billOpenAmount(payModal.bill))}</strong>
            </p>
            <div className="bill-field-row">
              <label className="bill-field">
                Valor recebido/pago
                <input
                  required
                  inputMode="decimal"
                  value={payModal.amount}
                  onChange={(e) =>
                    setPayModal({ ...payModal, amount: e.target.value })
                  }
                />
              </label>
              <label className="bill-field">
                Data
                <input
                  type="date"
                  value={payModal.date}
                  onChange={(e) =>
                    setPayModal({ ...payModal, date: e.target.value })
                  }
                />
              </label>
            </div>
            <p className="bills-hint">
              Pode pagar em partes: o que faltar continua em aberto. O valor
              entra automaticamente no Financeiro como{" "}
              {payModal.bill.direction === "pagar" ? "Despesa" : "Receita"}.
            </p>
            <footer className="modal-foot">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setPayModal(null)}
              >
                Cancelar
              </button>
              <button className="btn" type="submit">
                Confirmar
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
