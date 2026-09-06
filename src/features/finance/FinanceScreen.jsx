import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Calculator,
  CalendarDays,
  Download,
  Edit3,
  ExternalLink,
  Plus,
  Save,
  Trash2,
  Upload,
  WalletCards,
} from "lucide-react";
import { uid, today, recurringStatus, buildRecurringTransaction } from "../../domain.js";
import { parseDelimitedText, parseOfxTransactions } from "../../domain/importacoes.js";
import { monthLabelPt, dasStatus } from "../../domain/dasEResumoSemanal.js";
import Modal from "../../components/Modal.jsx";
import { Button, Empty, Field, PageTitle } from "../../components/ui.jsx";
import { trackProductEvent } from "../../session/telemetria.js";
import { money } from "../../components/formato.js";

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <span>
        <Icon />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

const REWARD_STATUS_LABELS = {
  prevista: "Prevista",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovada: "Aprovada",
  pendente_pagamento: "Pendente de pagamento",
  paga: "Paga",
  cancelada: "Cancelada",
};

function RewardsPanel({ db, update, business, setToast, pushNotification }) {
  const [launchToFinance, setLaunchToFinance] = useState({});
  const rewardTasks = db.tasks.filter(
    (t) =>
      (!business || t.businessId === business.id) &&
      Number(t.reward) > 0 &&
      (t.ownerId === db.user.id ||
        t.assigneeId === db.user.id ||
        (t.assignees || []).some((a) => a.userId === db.user.id)),
  );
  const markPaid = (task) => {
    const recipientId = task.assigneeId || task.assignees?.[0]?.userId;
    update((d) => ({
      ...d,
      tasks: d.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              rewardStatus: "paga",
              paidAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : t,
      ),
      transactions: launchToFinance[task.id]
        ? [
            {
              id: uid(),
              type: "Despesa",
              description: `Recompensa: ${task.title}`,
              value: task.reward,
              date: today(),
              category: "Recompensas e pagamentos",
              businessId: business?.id || null,
              ownerId: db.user.id,
            },
            ...d.transactions,
          ]
        : d.transactions,
      notifications:
        recipientId && recipientId !== db.user.id
          ? pushNotification(d.notifications, {
              recipientId,
              message: `Recompensa paga: "${task.title}"`,
              link: "financeiro",
              createdBy: db.user.id,
            })
          : d.notifications,
    }));
    setToast("Recompensa marcada como paga");
  };
  if (!rewardTasks.length) return null;
  return (
    <section className="panel" id="finance-rewards">
      <div className="panel-head">
        <div>
          <span className="eyebrow">RECOMPENSAS E PAGAMENTOS</span>
          <h2>Valores de missões e tarefas</h2>
        </div>
      </div>
      <div className="member-list">
        {rewardTasks.map((t) => {
          const status = t.rewardStatus || "prevista";
          const isOwner = t.ownerId === db.user.id;
          return (
            <div key={t.id}>
              <span>
                <strong>{t.title}</strong>
                <small>
                  {REWARD_STATUS_LABELS[status] || status} · {money(t.reward)}
                </small>
              </span>
              {isOwner && status === "aprovada" && (
                <span className="task-actions">
                  <label className="cost-check">
                    <input
                      type="checkbox"
                      checked={!!launchToFinance[t.id]}
                      onChange={(e) =>
                        setLaunchToFinance((c) => ({
                          ...c,
                          [t.id]: e.target.checked,
                        }))
                      }
                    />
                    <span>Lançar no Financeiro</span>
                  </label>
                  <Button variant="secondary" onClick={() => markPaid(t)}>
                    Marcar como paga
                  </Button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Finance({ db, update, business, setToast, go, AreaToolkit, pushNotification }) {
  const importRef = useRef(null);
  const [modal, setModal] = useState(false),
    [calc, setCalc] = useState({
      materials: "",
      hours: "",
      hourValue: "",
      fixed: "",
      tax: "",
      margin: "",
    }),
    [planning, setPlanning] = useState({
      monthlyGoal: "",
      fixedCosts: "",
      contributionMargin: "",
    });
  const financeKey = business?.id || "global";
  useEffect(() => {
    const id = setTimeout(() => {
      setPlanning({
        monthlyGoal: "",
        fixedCosts: "",
        contributionMargin: "",
        ...(db.financeSettings?.[financeKey] || {}),
      });
    }, 0);
    return () => clearTimeout(id);
  }, [db.financeSettings, financeKey]);
  const [form, setForm] = useState({
    type: "Receita",
    description: "",
    value: "",
    date: today(),
    category: "Geral",
  });
  const tx = db.transactions.filter(
      (x) => !business || x.businessId === business.id,
    ),
    revenue = tx
      .filter((x) => x.type === "Receita")
      .reduce((a, x) => a + Number(x.value), 0),
    expense = tx
      .filter((x) => x.type === "Despesa")
      .reduce((a, x) => a + Number(x.value), 0);
  const currentMonth = today().slice(0, 7),
    monthlyRevenue = tx
      .filter(
        (item) =>
          item.type === "Receita" &&
          String(item.date || "").startsWith(currentMonth),
      )
      .reduce((total, item) => total + Number(item.value || 0), 0),
    monthlyGoal = Number(planning.monthlyGoal || 0),
    contributionMargin = Number(planning.contributionMargin || 0),
    breakEven = contributionMargin
      ? Number(planning.fixedCosts || 0) / (contributionMargin / 100)
      : 0,
    goalProgress = monthlyGoal
      ? Math.min(100, Math.round((monthlyRevenue / monthlyGoal) * 100))
      : 0;
  const base =
      Number(calc.materials || 0) +
      Number(calc.hours || 0) * Number(calc.hourValue || 0) +
      Number(calc.fixed || 0),
    tax = Number(calc.tax || 0) / 100,
    margin = Number(calc.margin || 0) / 100,
    suggested = tax + margin < 1 ? base / (1 - tax - margin) : 0;
  const add = (e) => {
    e.preventDefault();
    if (!form.description || !Number(form.value)) return;
    update((d) => ({
      ...d,
      transactions: [
        {
          ...form,
          id: uid(),
          businessId: business?.id || null,
          ownerId: db.user.id,
        },
        ...d.transactions,
      ],
    }));
    setModal(false);
    setToast("Movimentação registrada");
  };
  const recurring = (db.recurring || []).filter(
    (c) => !business || !c.businessId || c.businessId === business.id,
  );
  const [recModal, setRecModal] = useState(false);
  const [recForm, setRecForm] = useState(null);
  const openRecurring = (c = null) => {
    setRecForm(
      c
        ? { ...c }
        : {
            clientName: "",
            description: "",
            amount: "",
            dueDay: 5,
            autoPost: false,
            active: true,
          },
    );
    setRecModal(true);
  };
  const saveRecurring = (e) => {
    e.preventDefault();
    if (!recForm?.clientName?.trim() || !(Number(recForm.amount) > 0)) {
      setToast("Informe o cliente e um valor mensal");
      return;
    }
    const now = new Date().toISOString();
    const item = {
      ...recForm,
      clientName: recForm.clientName.trim(),
      amount: Number(recForm.amount) || 0,
      dueDay: Math.min(28, Math.max(1, Number(recForm.dueDay) || 1)),
      id: recForm.id || uid(),
      history: recForm.history || {},
      businessId: business?.id || recForm.businessId || null,
      ownerId: recForm.ownerId || db.user.id,
      createdAt: recForm.createdAt || now,
      updatedAt: now,
    };
    update((d) => ({
      ...d,
      recurring: recForm.id
        ? (d.recurring || []).map((c) => (c.id === item.id ? item : c))
        : [item, ...(d.recurring || [])],
    }));
    setRecModal(false);
    setToast(recForm.id ? "Contrato atualizado" : "Contrato recorrente criado");
  };
  const removeRecurring = (id) =>
    update((d) => ({
      ...d,
      recurring: (d.recurring || []).filter((c) => c.id !== id),
    }));
  const postRecurring = (contract) => {
    const ym = today().slice(0, 7);
    const transaction = buildRecurringTransaction(contract, {
      userId: db.user.id,
      businessId: business?.id,
    });
    if (!transaction) return;
    update((d) => ({
      ...d,
      transactions: [transaction, ...(d.transactions || [])],
      recurring: (d.recurring || []).map((c) =>
        c.id === contract.id
          ? {
              ...c,
              history: {
                ...(c.history || {}),
                [ym]: { postedAt: new Date().toISOString() },
              },
            }
          : c,
      ),
    }));
    setToast("Receita do contrato lançada no caixa");
  };
  const importTransactions = async (file) => {
    if (!file) return;
    const parseMoney = (value) => {
      const clean = String(value || "")
        .replace(/R\$/gi, "")
        .replace(/\s/g, "");
      const normalized = clean.includes(",")
        ? clean.replace(/\./g, "").replace(",", ".")
        : clean;
      return Number(normalized);
    };
    try {
      const text = await file.text();
      const isOfx = /\.ofx$/i.test(file.name) || /<OFX>/i.test(text);
      const sourceRows = isOfx
        ? parseOfxTransactions(text)
        : parseDelimitedText(text).map((row) => {
            const rawValue = row.valor || row.value || row.quantia || row.amount;
            const amount = parseMoney(rawValue);
            const informedType = String(row.tipo || row.type || "").toLowerCase();
            return {
              fitId: row.id || row.fitid || "",
              type:
                informedType.includes("desp") || amount < 0
                  ? "Despesa"
                  : "Receita",
              value: Math.abs(amount),
              date: row.data || row.date || "",
              description:
                row.descricao || row.description || row.historico || row.memo || "",
              category: row.categoria || row.category || "Importado",
            };
          });
      const existingKeys = new Set(
        (db.transactions || []).map(
          (item) =>
            item.importId ||
            `${item.date}|${Number(item.value || 0).toFixed(2)}|${String(item.description || "").toLowerCase()}`,
        ),
      );
      const imported = sourceRows
        .filter(
          (item) =>
            item.date && item.description && Number.isFinite(item.value) && item.value > 0,
        )
        .map((item) => ({
          ...item,
          id: uid(),
          importId:
            item.fitId ||
            `${item.date}|${Number(item.value).toFixed(2)}|${item.description.toLowerCase()}`,
          businessId: business?.id || null,
          ownerId: db.user.id,
          visibility: "privado",
          createdAt: new Date().toISOString(),
        }))
        .filter((item) => {
          if (existingKeys.has(item.importId)) return false;
          existingKeys.add(item.importId);
          return true;
        });
      if (!imported.length)
        throw new Error("Nenhuma movimentação nova foi encontrada no arquivo.");
      update((current) => ({
        ...current,
        transactions: [...imported, ...(current.transactions || [])],
      }));
      trackProductEvent("import_completed", {
        module: "financeiro",
        kind: isOfx ? "ofx" : "csv",
        count: imported.length,
        success: true,
      });
      setToast(`${imported.length} movimentação(ões) importada(s)`);
    } catch (error) {
      setToast(error.message || "Não foi possível importar o extrato");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };
  const savePlanning = () => {
    update((d) => ({
      ...d,
      financeSettings: {
        ...(d.financeSettings || {}),
        [financeKey]: planning,
      },
    }));
    setToast("Metas e ponto de equilíbrio salvos");
  };
  const taxProfile = db.taxProfile || {
    isMEI: false,
    dueDay: 20,
    cnpj: "",
    dasHistory: {},
  };
  const das = dasStatus(taxProfile);
  const dasMonths = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    return d.toISOString().slice(0, 7);
  });
  const patchTaxProfile = (patch) =>
    update((d) => ({
      ...d,
      taxProfile: {
        isMEI: false,
        dueDay: 20,
        cnpj: "",
        dasHistory: {},
        ...(d.taxProfile || {}),
        ...patch,
      },
    }));
  const setDasPaid = (ym, paid) =>
    update((d) => {
      const current = {
        isMEI: false,
        dueDay: 20,
        cnpj: "",
        dasHistory: {},
        ...(d.taxProfile || {}),
      };
      const history = { ...(current.dasHistory || {}) };
      if (paid) history[ym] = { paid: true, paidAt: new Date().toISOString() };
      else delete history[ym];
      return { ...d, taxProfile: { ...current, dasHistory: history } };
    });
  const exportReport = () => {
    const safe = (value) => {
      const text = String(value ?? "");
      const protectedText = /^[=+@-]/.test(text) ? `'${text}` : text;
      return `"${protectedText.replace(/"/g, '""')}"`;
    };
    const rows = [
      ["Data", "Tipo", "Descricao", "Categoria", "Valor"],
      ...tx.map((item) => [
        item.date,
        item.type,
        item.description,
        item.category,
        Number(item.value || 0).toFixed(2),
      ]),
      [],
      ["Resumo", "Valor"],
      ["Receitas", revenue.toFixed(2)],
      ["Despesas", expense.toFixed(2)],
      ["Saldo", (revenue - expense).toFixed(2)],
      ["Meta mensal", monthlyGoal.toFixed(2)],
      ["Ponto de equilibrio", breakEven.toFixed(2)],
    ];
    const blob = new Blob(
      [`\ufeff${rows.map((row) => row.map(safe).join(";")).join("\n")}`],
      { type: "text/csv;charset=utf-8" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio-financeiro-${currentMonth}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setToast("Relatório financeiro exportado");
    trackProductEvent("export_completed", {
      module: "financeiro",
      kind: "csv",
      success: true,
    });
  };
  return (
    <PageTitle
      eyebrow="FINANCEIRO"
      title="Números claros para decisões melhores"
      text="Registre apenas valores reais. Projeções aparecem sempre identificadas como estimativas."
      action={
        <div className="page-actions">
          <input
            ref={importRef}
            type="file"
            accept=".csv,.ofx,text/csv,text/plain,application/x-ofx"
            hidden
            onChange={(event) => importTransactions(event.target.files?.[0])}
          />
          <Button
            variant="secondary"
            icon={Upload}
            onClick={() => importRef.current?.click()}
          >
            Importar CSV ou OFX
          </Button>
          <Button icon={Plus} onClick={() => setModal(true)}>
            Registrar movimentação
          </Button>
        </div>
      }
    >
      <AreaToolkit
        area="financeiro"
        db={db}
        update={update}
        business={business}
        setToast={setToast}
        go={go}
      />
      <div className="metric-row">
        <Metric
          icon={ArrowUpRight}
          label="Receitas registradas"
          value={money(revenue)}
        />
        <Metric
          icon={ArrowUpRight}
          label="Despesas registradas"
          value={money(expense)}
        />
        <Metric
          icon={WalletCards}
          label="Saldo registrado"
          value={money(revenue - expense)}
        />
      </div>
      <section className="panel finance-planning" id="finance-planning">
        <div className="panel-head">
          <div>
            <span className="eyebrow">PLANEJAMENTO</span>
            <h2>Meta mensal e ponto de equilíbrio</h2>
          </div>
          <Button variant="secondary" icon={Download} onClick={exportReport}>
            Exportar relatório
          </Button>
        </div>
        <div className="planning-grid">
          <Field label="Meta de receita mensal (R$)">
            <input
              type="number"
              min="0"
              value={planning.monthlyGoal}
              onChange={(e) =>
                setPlanning({ ...planning, monthlyGoal: e.target.value })
              }
            />
          </Field>
          <Field label="Custos fixos mensais (R$)">
            <input
              type="number"
              min="0"
              value={planning.fixedCosts}
              onChange={(e) =>
                setPlanning({ ...planning, fixedCosts: e.target.value })
              }
            />
          </Field>
          <Field
            label="Margem de contribuição (%)"
            hint="Receita que sobra após custos e despesas variáveis."
          >
            <input
              type="number"
              min="0"
              max="100"
              value={planning.contributionMargin}
              onChange={(e) =>
                setPlanning({
                  ...planning,
                  contributionMargin: e.target.value,
                })
              }
            />
          </Field>
          <Button icon={Save} onClick={savePlanning}>
            Salvar planejamento
          </Button>
        </div>
        <div className="planning-results">
          <div>
            <small>Receita neste mês</small>
            <strong>{money(monthlyRevenue)}</strong>
            <div className="meter">
              <span style={{ width: `${goalProgress}%` }} />
            </div>
            <span>
              {monthlyGoal ? `${goalProgress}% da meta` : "Defina uma meta"}
            </span>
          </div>
          <div>
            <small>Ponto de equilíbrio estimado</small>
            <strong>
              {breakEven ? money(breakEven) : "Preencha os dados"}
            </strong>
            <span>
              {breakEven
                ? "Receita mensal necessária para cobrir os custos fixos."
                : "Informe custos fixos e margem de contribuição."}
            </span>
          </div>
        </div>
      </section>
      <section className="panel das-panel" id="finance-das">
        <div className="panel-head">
          <div>
            <span className="eyebrow">IMPOSTO DO MEI</span>
            <h2>Controle do DAS</h2>
          </div>
          <label className="das-toggle">
            <input
              type="checkbox"
              checked={!!taxProfile.isMEI}
              onChange={(e) => patchTaxProfile({ isMEI: e.target.checked })}
            />
            <span>Sou MEI</span>
          </label>
        </div>
        {!taxProfile.isMEI ? (
          <p className="das-intro">
            Ative &quot;Sou MEI&quot; para acompanhar o pagamento da guia DAS mês a mês e
            receber um lembrete automático antes do vencimento (todo dia 20).
          </p>
        ) : (
          <>
            <div
              className={`das-current das-${das.status}`}
              role="status"
            >
              <div>
                <small>
                  DAS de {monthLabelPt(das.ym)} · vence dia {das.dueDay}
                </small>
                <strong>
                  {das.status === "pago"
                    ? "Pago ✓"
                    : das.status === "atrasado"
                      ? "Atrasado"
                      : "A pagar"}
                </strong>
              </div>
              <div className="das-actions">
                <label className="das-paid-check">
                  <input
                    type="checkbox"
                    checked={das.paid}
                    onChange={(e) => setDasPaid(das.ym, e.target.checked)}
                  />
                  <span>Marcar como pago</span>
                </label>
                <a
                  className="button secondary"
                  href="https://www.gov.br/pt-br/servicos/pagar-o-das-do-microempreendedor-individual"
                  target="_blank"
                  rel="noreferrer"
                >
                  Emitir/pagar no Portal do MEI <ExternalLink />
                </a>
              </div>
            </div>
            <div className="das-history">
              <small className="das-history-title">Meses recentes</small>
              <div className="das-months">
                {dasMonths.map((ym) => {
                  const st = dasStatus(taxProfile, `${ym}-28`);
                  const paid = st.paid;
                  return (
                    <button
                      key={ym}
                      type="button"
                      className={`das-month das-${st.status}`}
                      onClick={() => setDasPaid(ym, !paid)}
                      title={
                        paid
                          ? "Pago — clique para desmarcar"
                          : "Não pago — clique para marcar como pago"
                      }
                    >
                      <span>{monthLabelPt(ym)}</span>
                      <strong>{paid ? "Pago" : "Em aberto"}</strong>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="das-fields">
              <Field label="Dia de vencimento">
                <input
                  type="number"
                  min="1"
                  max="28"
                  value={taxProfile.dueDay || 20}
                  onChange={(e) =>
                    patchTaxProfile({
                      dueDay: Math.min(
                        28,
                        Math.max(1, Number(e.target.value) || 20),
                      ),
                    })
                  }
                />
              </Field>
              <Field label="CNPJ (opcional)">
                <input
                  value={taxProfile.cnpj || ""}
                  onChange={(e) => patchTaxProfile({ cnpj: e.target.value })}
                  placeholder="00.000.000/0001-00"
                />
              </Field>
            </div>
            <p className="das-note">
              O controle é manual e serve como lembrete — o pagamento continua
              sendo feito no portal oficial. Dúvidas sobre enquadramento ou
              valores? Fale com um contador.
            </p>
          </>
        )}
      </section>
      <div className="finance-grid">
        <section className="panel calculator" id="finance-price">
          <div className="panel-head">
            <div>
              <span className="eyebrow">CALCULADORA</span>
              <h2>Preço de venda</h2>
            </div>
            <Calculator />
          </div>
          <p>Informe seus dados. Nenhum valor é preenchido ou presumido.</p>
          <div className="form-grid">
            <Field label="Materiais (R$)">
              <input
                type="number"
                min="0"
                value={calc.materials}
                onChange={(e) =>
                  setCalc({ ...calc, materials: e.target.value })
                }
              />
            </Field>
            <Field label="Horas de trabalho">
              <input
                type="number"
                min="0"
                value={calc.hours}
                onChange={(e) => setCalc({ ...calc, hours: e.target.value })}
              />
            </Field>
            <Field label="Valor por hora (R$)">
              <input
                type="number"
                min="0"
                value={calc.hourValue}
                onChange={(e) =>
                  setCalc({ ...calc, hourValue: e.target.value })
                }
              />
            </Field>
            <Field label="Custos fixos rateados (R$)">
              <input
                type="number"
                min="0"
                value={calc.fixed}
                onChange={(e) => setCalc({ ...calc, fixed: e.target.value })}
              />
            </Field>
            <Field label="Impostos (%)">
              <input
                type="number"
                min="0"
                max="99"
                value={calc.tax}
                onChange={(e) => setCalc({ ...calc, tax: e.target.value })}
              />
            </Field>
            <Field label="Margem desejada (%)">
              <input
                type="number"
                min="0"
                max="99"
                value={calc.margin}
                onChange={(e) => setCalc({ ...calc, margin: e.target.value })}
              />
            </Field>
          </div>
          <div className="calc-result">
            <span>Preço calculado</span>
            <strong>{base ? money(suggested) : "Preencha os custos"}</strong>
            <small>
              {base
                ? suggested
                  ? "Estimativa calculada a partir dos valores informados."
                  : "Impostos + margem devem ser menores que 100%."
                : "O resultado aparecerá aqui."}
            </small>
          </div>
        </section>
        <section className="panel recurring-panel" id="finance-recurring">
          <div className="panel-head">
            <div>
              <h3>Contratos recorrentes</h3>
              <p>
                Mensalidades e contratos fixos — lembrete todo mês e
                lançamento no caixa com um clique (ou automático).
              </p>
            </div>
            <Button icon={Plus} onClick={() => openRecurring()}>
              Novo contrato
            </Button>
          </div>
          {recurring.length === 0 ? (
            <Empty
              icon={CalendarDays}
              title="Nenhum contrato recorrente"
              text="Cadastre mensalidades e contratos fixos (ex.: contrato mensal de um condomínio). Todo mês o app lembra você e lança no caixa com um clique."
              action="Cadastrar contrato"
              onAction={() => openRecurring()}
            />
          ) : (
            <div className="recurring-list">
              {recurring.map((c) => {
                const st = recurringStatus(c);
                const label = !c.active
                  ? "Inativo"
                  : st.status === "lancado"
                    ? "Lançado este mês"
                    : st.status === "a_lancar"
                      ? "Vence — lançar"
                      : "Agendado";
                const tone = !c.active
                  ? "muted"
                  : st.status === "lancado"
                    ? "ok"
                    : st.status === "a_lancar"
                      ? "warn"
                      : "info";
                return (
                  <div key={c.id} className="recurring-row">
                    <div className="recurring-info">
                      <strong>{c.clientName}</strong>
                      <small>
                        {money(c.amount)}/mês · vence dia {c.dueDay}
                        {c.autoPost ? " · automático" : ""}
                      </small>
                    </div>
                    <span className={`recurring-status ${tone}`}>{label}</span>
                    <div className="recurring-actions">
                      {c.active && st.status === "a_lancar" && (
                        <Button
                          variant="ghost"
                          icon={WalletCards}
                          onClick={() => postRecurring(c)}
                        >
                          Lançar mês
                        </Button>
                      )}
                      <button
                        className="icon-button"
                        aria-label={`Editar ${c.clientName}`}
                        onClick={() => openRecurring(c)}
                      >
                        <Edit3 />
                      </button>
                      <button
                        className="icon-button danger"
                        aria-label={`Excluir ${c.clientName}`}
                        onClick={() => {
                          if (confirm("Excluir este contrato recorrente?"))
                            removeRecurring(c.id);
                        }}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        {recModal && recForm && (
          <Modal
            title={recForm.id ? "Editar contrato" : "Novo contrato recorrente"}
            onClose={() => setRecModal(false)}
          >
            <form className="modal-body" onSubmit={saveRecurring}>
              <div className="form-grid">
                <Field label="Cliente">
                  <input
                    value={recForm.clientName}
                    onChange={(e) =>
                      setRecForm({ ...recForm, clientName: e.target.value })
                    }
                    placeholder="Ex.: Contrato Middle Mile — Cliente X"
                  />
                </Field>
                <Field label="Valor mensal (R$)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={recForm.amount}
                    onChange={(e) =>
                      setRecForm({ ...recForm, amount: e.target.value })
                    }
                    placeholder="600,00"
                  />
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Dia de vencimento">
                  <input
                    type="number"
                    min="1"
                    max="28"
                    value={recForm.dueDay}
                    onChange={(e) =>
                      setRecForm({ ...recForm, dueDay: e.target.value })
                    }
                  />
                </Field>
                <Field label="Descrição (opcional)">
                  <input
                    value={recForm.description}
                    onChange={(e) =>
                      setRecForm({ ...recForm, description: e.target.value })
                    }
                    placeholder="Ex.: Recarga elétrica da frota"
                  />
                </Field>
              </div>
              <label className="cost-check">
                <input
                  type="checkbox"
                  checked={!!recForm.autoPost}
                  onChange={(e) =>
                    setRecForm({ ...recForm, autoPost: e.target.checked })
                  }
                />
                <span>
                  Lançar a receita no caixa automaticamente todo mês (senão, o
                  app só lembra e você lança com um clique)
                </span>
              </label>
              <label className="cost-check">
                <input
                  type="checkbox"
                  checked={recForm.active !== false}
                  onChange={(e) =>
                    setRecForm({ ...recForm, active: e.target.checked })
                  }
                />
                <span>Contrato ativo</span>
              </label>
              <div className="modal-actions">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setRecModal(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" icon={Save}>
                  {recForm.id ? "Salvar" : "Criar contrato"}
                </Button>
              </div>
            </form>
          </Modal>
        )}
        <section className="panel" id="finance-transactions">
          <div className="panel-head">
            <div>
              <span className="eyebrow">MOVIMENTAÇÕES</span>
              <h2>Registros recentes</h2>
            </div>
          </div>
          {tx.length ? (
            <div className="transactions">
              {tx.slice(0, 8).map((x) => (
                <div key={x.id}>
                  <span className={x.type === "Receita" ? "income" : "expense"}>
                    {x.type === "Receita" ? "+" : "−"}
                  </span>
                  <span>
                    <strong>{x.description}</strong>
                    <small>
                      {x.category} ·{" "}
                      {new Date(x.date + "T12:00").toLocaleDateString("pt-BR")}
                    </small>
                  </span>
                  <b>{money(x.value)}</b>
                  <button
                    className="icon-button danger"
                    onClick={() =>
                      update((d) => ({
                        ...d,
                        transactions: d.transactions.filter(
                          (t) => t.id !== x.id,
                        ),
                      }))
                    }
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={WalletCards}
              title="Nenhum valor registrado"
              text="Comece adicionando uma receita ou despesa real."
            />
          )}
        </section>
        <RewardsPanel db={db} update={update} business={business} setToast={setToast} pushNotification={pushNotification} />
      </div>
      {modal && (
        <Modal title="Registrar movimentação" onClose={() => setModal(false)}>
          <form className="modal-body" onSubmit={add}>
            <div className="form-grid">
              <Field label="Tipo">
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option>Receita</option>
                  <option>Despesa</option>
                </select>
              </Field>
              <Field label="Valor (R$)">
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                />
              </Field>
              <Field label="Descrição">
                <input
                  required
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </Field>
              <Field label="Categoria">
                <input
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                />
              </Field>
              <Field label="Data">
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </Field>
            </div>
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" icon={Save}>
                Registrar
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </PageTitle>
  );
}

export default Finance;
