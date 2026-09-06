import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Filter,
  Plus,
  Trash2,
  TrendingUp,
} from "lucide-react";
import Modal from "../../components/Modal.jsx";
import {
  DEFAULT_STAGES,
  LOSS_REASONS,
  conversionRates,
  forecastByMonth,
  isOpen,
  lossBreakdown,
  makeOpportunity,
  makePipeline,
  moveStage,
  opportunityProbability,
  pipelineSummary,
  stageById,
  stageMetrics,
  stalledOpportunities,
  weightedValue,
} from "./pipelineDomain.js";

const brl = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
const hoje = () => new Date().toISOString().slice(0, 10);
const newId = () => `op-${Math.random().toString(36).slice(2, 10)}`;
const mesLabel = (chave) => {
  const nomes = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];
  const [ano, mes] = chave.split("-").map(Number);
  return `${nomes[mes - 1]}/${String(ano).slice(2)}`;
};

export default function SalesPipeline({ db, update, business, setToast }) {
  const [modal, setModal] = useState(null);
  const [verGanhasPerdidas, setVerGanhasPerdidas] = useState(false);

  const funil = useMemo(
    () => db.salesPipeline || makePipeline("funil-principal"),
    [db.salesPipeline],
  );

  const oportunidades = useMemo(
    () =>
      (db.opportunities || []).filter(
        (o) => !business || o.businessId === business.id,
      ),
    [db.opportunities, business],
  );

  const resumo = pipelineSummary(oportunidades, funil);
  const metricas = stageMetrics(oportunidades, funil);
  const taxas = conversionRates(oportunidades, funil);
  const previsao = forecastByMonth(oportunidades, funil, { from: hoje(), months: 3 });
  const paradas = stalledOpportunities(oportunidades, funil, hoje(), 14);
  const perdas = lossBreakdown(oportunidades, funil);
  const maiorEtapa = Math.max(1, ...metricas.map((m) => m.total));

  const persist = (opp) =>
    update((prev) => ({
      ...prev,
      opportunities: (prev.opportunities || []).some((o) => o.id === opp.id)
        ? (prev.opportunities || []).map((o) => (o.id === opp.id ? opp : o))
        : [opp, ...(prev.opportunities || [])],
    }));

  const salvar = (opp) => {
    if (!opp.title.trim()) return;
    const stage = stageById(funil, opp.stageId);
    // Ganhou ou perdeu agora: registra a data de fechamento, que alimenta o
    // ciclo médio de venda.
    const fechou = stage && (stage.won || stage.lost);
    persist({
      ...opp,
      closedAt: fechou ? opp.closedAt || new Date().toISOString() : "",
      lossReason: stage?.lost ? opp.lossReason : "",
    });
    setModal(null);
    setToast("Oportunidade salva");
  };

  const mover = (opp, stageId) => {
    const stage = stageById(funil, stageId);
    const movida = moveStage(opp, stageId, new Date().toISOString());
    persist({
      ...movida,
      closedAt:
        stage && (stage.won || stage.lost)
          ? movida.closedAt || new Date().toISOString()
          : "",
    });
    setToast(`Movida para ${stage?.name || stageId}`);
  };

  const excluir = (id) => {
    if (!window.confirm("Excluir esta oportunidade?")) return;
    update((prev) => ({
      ...prev,
      opportunities: (prev.opportunities || []).filter((o) => o.id !== id),
    }));
    setToast("Oportunidade excluída");
  };

  const abrirNova = () =>
    setModal(
      makeOpportunity(newId(), {
        businessId: business?.id || null,
        ownerId: db.user?.id || null,
      }),
    );

  const colunas = verGanhasPerdidas
    ? funil.stages
    : funil.stages.filter((s) => !s.won && !s.lost);

  return (
    <section className="pipe">
      <header className="pipe-head">
        <div>
          <h2>
            <TrendingUp size={20} /> Funil de vendas
          </h2>
          <p>
            Cada etapa tem uma probabilidade. Disso sai a previsão do que você
            deve faturar de verdade — não só a soma otimista de tudo.
          </p>
        </div>
        <button className="btn" onClick={abrirNova}>
          <Plus size={16} /> Nova oportunidade
        </button>
      </header>

      <div className="pipe-summary">
        <article>
          <strong>{brl(resumo.valorAberto)}</strong>
          <small>em negociação</small>
        </article>
        <article className="weighted">
          <strong>{brl(resumo.valorPonderado)}</strong>
          <small>previsão ponderada</small>
        </article>
        <article className="ok">
          <strong>{resumo.taxaGanho}%</strong>
          <small>taxa de fechamento</small>
        </article>
        <article>
          <strong>{brl(resumo.ticketMedio)}</strong>
          <small>ticket médio</small>
        </article>
        <article>
          <strong>{resumo.cicloMedio} dias</strong>
          <small>ciclo médio de venda</small>
        </article>
      </div>

      {paradas.length > 0 && (
        <div className="pipe-stalled">
          <h3>
            <AlertTriangle size={15} /> Paradas há mais de 14 dias
          </h3>
          <ul>
            {paradas.slice(0, 5).map(({ opp, days }) => (
              <li key={opp.id}>
                <span>{opp.title}</span>
                <small>
                  {stageById(funil, opp.stageId)?.name} · {days} dias sem mexer
                </small>
                <strong>{brl(opp.value)}</strong>
                <button className="btn ghost sm" onClick={() => setModal(opp)}>
                  Abrir
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pipe-panels">
        <section className="pipe-funnel">
          <h3>Funil por etapa</h3>
          {metricas
            .filter((m) => !m.lost)
            .map((m) => (
              <div key={m.id} className="pipe-funnel-row">
                <span className="pipe-funnel-name">{m.name}</span>
                <div className="pipe-funnel-bar">
                  <span style={{ width: `${(m.total / maiorEtapa) * 100}%` }} />
                </div>
                <span className="pipe-funnel-num">
                  {m.count} · {brl(m.total)}
                </span>
              </div>
            ))}
          {taxas.length > 0 && oportunidades.length > 0 && (
            <ul className="pipe-conv">
              {taxas.map((t) => (
                <li key={`${t.from}-${t.to}`}>
                  {stageById(funil, t.from)?.name}
                  <ChevronRight size={12} />
                  {stageById(funil, t.to)?.name}
                  <strong>{t.rate}%</strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pipe-forecast">
          <h3>Previsão dos próximos meses</h3>
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Negócios</th>
                <th>Valor total</th>
                <th>Ponderado</th>
              </tr>
            </thead>
            <tbody>
              {previsao.map((p) => (
                <tr key={p.month}>
                  <td>{mesLabel(p.month)}</td>
                  <td>{p.count}</td>
                  <td>{brl(p.total)}</td>
                  <td>
                    <strong>{brl(p.weighted)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pipe-hint">
            Ponderado = valor × probabilidade da etapa. É a leitura realista.
            Oportunidades sem data prevista não aparecem aqui.
          </p>
          {perdas.length > 0 && (
            <>
              <h4>Por que perdemos</h4>
              <ul className="pipe-loss">
                {perdas.map((p) => (
                  <li key={p.reason}>
                    <span>{p.reason}</span>
                    <small>
                      {p.count} {p.count === 1 ? "negócio" : "negócios"}
                    </small>
                    <strong>{brl(p.total)}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <div className="pipe-toolbar">
        <span className="pipe-filter-label">
          <Filter size={13} /> Quadro
        </span>
        <label className="pipe-show-closed">
          <input
            type="checkbox"
            checked={verGanhasPerdidas}
            onChange={(e) => setVerGanhasPerdidas(e.target.checked)}
          />
          Mostrar ganhas e perdidas
        </label>
      </div>

      {oportunidades.length === 0 ? (
        <div className="pipe-empty">
          <TrendingUp size={28} />
          <h3>Nenhuma oportunidade no funil</h3>
          <p>
            Cadastre um negócio em andamento com valor e data prevista. Com dois
            ou três, o funil já começa a te dizer quanto esperar no mês.
          </p>
          <button className="btn" onClick={abrirNova}>
            <Plus size={16} /> Criar a primeira
          </button>
        </div>
      ) : (
        <div className="pipe-board">
          {colunas.map((stage) => {
            const doStage = oportunidades.filter((o) => o.stageId === stage.id);
            const total = doStage.reduce(
              (s, o) => s + Number(String(o.value).replace(",", ".") || 0),
              0,
            );
            return (
              <div key={stage.id} className="pipe-col">
                <header>
                  <h4>{stage.name}</h4>
                  <small>
                    {stage.probability}% · {doStage.length}
                  </small>
                  <small className="pipe-col-total">{brl(total)}</small>
                </header>
                {doStage.map((opp) => (
                  <article key={opp.id} className="pipe-card">
                    <strong>{opp.title}</strong>
                    {opp.contactName && <small>{opp.contactName}</small>}
                    <span className="pipe-card-value">{brl(opp.value)}</span>
                    <small className="pipe-card-weighted">
                      previsto {brl(weightedValue(opp, funil))} (
                      {opportunityProbability(opp, funil)}%)
                    </small>
                    {opp.expectedCloseDate && (
                      <small>fecha em {opp.expectedCloseDate}</small>
                    )}
                    <div className="pipe-card-actions">
                      <select
                        aria-label={`Mover ${opp.title}`}
                        value={opp.stageId}
                        onChange={(e) => mover(opp, e.target.value)}
                      >
                        {funil.stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn ghost sm"
                        onClick={() => setModal(opp)}
                      >
                        Editar
                      </button>
                      <button
                        className="btn ghost sm danger"
                        onClick={() => excluir(opp.id)}
                        title="Excluir"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </article>
                ))}
                {doStage.length === 0 && (
                  <p className="pipe-col-empty">Vazia</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <Modal
          title={
            (db.opportunities || []).some((o) => o.id === modal.id)
              ? "Editar oportunidade"
              : "Nova oportunidade"
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
            <label className="pipe-field">
              O que está sendo vendido
              <input
                required
                autoFocus
                placeholder="Ex.: Operação dedicada Last Mile — 3 rotas/dia"
                value={modal.title}
                onChange={(e) => setModal({ ...modal, title: e.target.value })}
              />
            </label>
            <div className="pipe-field-row">
              <label className="pipe-field">
                Cliente
                <input
                  value={modal.contactName}
                  onChange={(e) =>
                    setModal({ ...modal, contactName: e.target.value })
                  }
                />
              </label>
              <label className="pipe-field">
                Valor (R$)
                <input
                  inputMode="decimal"
                  placeholder="0,00"
                  value={modal.value}
                  onChange={(e) => setModal({ ...modal, value: e.target.value })}
                />
              </label>
            </div>
            <div className="pipe-field-row">
              <label className="pipe-field">
                Etapa
                <select
                  value={modal.stageId}
                  onChange={(e) => setModal({ ...modal, stageId: e.target.value })}
                >
                  {funil.stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.probability}%)
                    </option>
                  ))}
                </select>
              </label>
              <label className="pipe-field">
                Fechamento previsto
                <input
                  type="date"
                  value={modal.expectedCloseDate}
                  onChange={(e) =>
                    setModal({ ...modal, expectedCloseDate: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="pipe-field-row">
              <label className="pipe-field">
                Probabilidade própria (%) — opcional
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder={`padrão da etapa: ${
                    stageById(funil, modal.stageId)?.probability ?? 0
                  }%`}
                  value={modal.probability}
                  onChange={(e) =>
                    setModal({ ...modal, probability: e.target.value })
                  }
                />
              </label>
              <label className="pipe-field">
                Como chegou até você
                <input
                  placeholder="Indicação, Instagram, site..."
                  value={modal.origin}
                  onChange={(e) => setModal({ ...modal, origin: e.target.value })}
                />
              </label>
            </div>
            {stageById(funil, modal.stageId)?.lost && (
              <label className="pipe-field">
                Motivo da perda
                <select
                  value={modal.lossReason}
                  onChange={(e) =>
                    setModal({ ...modal, lossReason: e.target.value })
                  }
                >
                  <option value="">Escolha um motivo</option>
                  {LOSS_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="pipe-hint">
              Previsão desta oportunidade:{" "}
              <strong>{brl(weightedValue(modal, funil))}</strong>
              {isOpen(modal, funil)
                ? ""
                : " — já decidida, não entra na previsão."}
            </p>
            <footer className="modal-foot">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setModal(null)}
              >
                Cancelar
              </button>
              <button className="btn" type="submit">
                Salvar
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}

export { DEFAULT_STAGES };
