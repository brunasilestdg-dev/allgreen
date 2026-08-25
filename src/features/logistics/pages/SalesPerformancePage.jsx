import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Target, UserRoundCheck, Users } from "lucide-react";
import { buildSalesPerformance, summarizeSalesPerformance } from "../salesPerformanceDomain.js";
import "./TodoGreenPages.css";

const get = async (path, authHeaders) => {
  const response = await fetch(path, { headers: { ...(authHeaders?.() || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível carregar a performance comercial.");
  return payload;
};

const pct = (value) => `${Number(value || 0).toLocaleString("pt-BR")}%`;
const sellerLabel = (value) => value === "sem-responsavel" ? "Sem responsável" : value;

export default function SalesPerformancePage({ authHeaders, onNavigate }) {
  const [clients, setClients] = useState([]);
  const [goals, setGoals] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      get("/api/todogreen/clients", authHeaders),
      get("/api/todogreen/goals?category=commercial", authHeaders),
    ]).then(([clientData, goalData]) => {
      if (!active) return;
      setClients(clientData.clientes || []);
      setGoals(goalData.goals || []);
    }).catch((reason) => active && setError(reason.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const rows = useMemo(() => buildSalesPerformance(clients, goals), [clients, goals]);
  const summary = useMemo(() => summarizeSalesPerformance(rows), [rows]);

  return (
    <section className="tdg-panel tdg-page tdg-performance-page">
      <header className="tdg-page-title">
        <div><span>EXECUÇÃO DA CARTEIRA</span><h2>Performance comercial</h2><p>Execução da carteira e atingimento de metas.</p></div>
        <button className="tdg-action" type="button" onClick={() => onNavigate?.("/todogreen/metas")}><Target size={16} />Abrir metas</button>
      </header>
      <div className="tdg-performance-boundary"><CheckCircle2 size={17} /><span>Esta página não usa oportunidades, pipeline, forecast nem faturamento para calcular performance.</span></div>
      {error && <div className="tdg-page-error">{error}</div>}
      <div className="tdg-performance-summary">
        <article><Users size={18} /><span>Vendedores</span><strong>{summary.sellers}</strong></article>
        <article><UserRoundCheck size={18} /><span>Contas atribuídas</span><strong>{summary.portfolioSize}</strong></article>
        <article><CheckCircle2 size={18} /><span>Cobertura de contato</span><strong>{pct(summary.contactCoveragePercent)}</strong></article>
        <article><CalendarClock size={18} /><span>Carteira atualizada</span><strong>{pct(summary.freshAccountsPercent)}</strong></article>
        <article className={summary.overdueActions ? "attention" : ""}><AlertTriangle size={18} /><span>Ações vencidas</span><strong>{summary.overdueActions}</strong></article>
      </div>
      {loading && <p>Carregando performance da carteira...</p>}
      {!loading && !rows.length && <p className="tdg-crm-empty">Ainda não há contas atribuídas para compor a performance.</p>}
      {!loading && rows.length > 0 && <div className="tdg-performance-table" role="table" aria-label="Performance por vendedor">
        <div role="row" className="head"><span>Responsável</span><span>Carteira</span><span>Relacionamento</span><span>Próximas ações</span><span>Metas</span><span>Execução</span></div>
        {rows.map((row) => <div role="row" key={row.sellerEmail}><span><strong>{sellerLabel(row.sellerEmail)}</strong><small>{row.temperatures.warm} mornas · {row.temperatures.cold} frias · {row.temperatures.hot} quentes</small></span><span><strong>{row.portfolioSize}</strong><small>contas atribuídas</small></span><span><strong>{pct(row.contactCoveragePercent)}</strong><small>{pct(row.freshAccountsPercent)} atualizadas</small></span><span className={row.overdueActions ? "risk" : ""}><strong>{row.overdueActions} vencidas</strong><small>{row.missingActions} sem próxima ação</small></span><span><strong>{row.goalAttainmentPercent == null ? "—" : pct(row.goalAttainmentPercent)}</strong><small>{row.commercialGoals} metas comerciais</small></span><span><strong>{pct(row.executionScore)}</strong><small>índice de execução</small></span></div>)}
      </div>}
    </section>
  );
}
