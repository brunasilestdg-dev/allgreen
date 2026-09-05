import "./TodoGreenPages.css";
import { useEffect, useMemo, useState } from "react";
import { History, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { hasTodoGreenPermission } from "../logisticsVerticalDomain.js";

const RULES = [
  ["Custos oficiais", "Bloqueado para vendedores", "cost:manage"],
  ["Margem mínima", "Alteração exige Precificação ou Financeiro", "pricing:manage"],
  ["Fatores ambientais", "Sustentabilidade mantém as versões", "esg:manage"],
  ["Aprovação comercial", "Decisão registrada com justificativa", "deal:approve"],
  ["Histórico de alterações", "Criação, edição, baixa, evento e revogação", "audit:read"],
];

export default function GovernancePage({ role, permissions = [], authHeaders, setToast }) {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState("");
  const canRead = hasTodoGreenPermission(role, "audit:read", permissions);
  const query = useMemo(() => new URLSearchParams({ ...(type ? { tipo: type } : {}), limit: "100" }).toString(), [type]);
  const load = async () => {
    if (!canRead) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/todogreen/governance?${query}`, { headers: authHeaders?.() || {} });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar a auditoria.");
      setEvents(payload.eventos || []);
      setTotal(payload.total || 0);
    } catch (error) { setToast?.(error.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [query, canRead]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="tdg-panel tdg-governance-page">
      <div className="tdg-section-head"><div><span className="tdg-kicker">GOVERNANÇA</span><h2>Permissões e trilha unificada</h2><p>O histórico abaixo reúne alterações reais por área, usuário e recurso.</p></div><strong>{role || "sem papel"}</strong></div>
      <div className="tdg-governance-grid">{RULES.map(([title, detail, permission]) => <article className="tdg-rule" key={title}><ShieldCheck size={18} /><strong>{title}</strong><span>{detail}</span><small>{hasTodoGreenPermission(role, permission, permissions) ? "permitido" : "sem permissão direta"}</small></article>)}</div>
      {!canRead && <div className="tdg-empty-access"><ShieldCheck size={18} />Seu papel não pode consultar a trilha detalhada de auditoria.</div>}
      {canRead && <><div className="tdg-ledger-tools"><label><span>Tipo de recurso</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="">Todos</option>{["opportunities", "proposals", "contracts", "operations", "financial", "scenario", "access"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label><button type="button" onClick={load} disabled={loading}><RefreshCw size={16} />{loading ? "Atualizando..." : "Atualizar"}</button><small>{total} evento(s) no filtro</small></div><div className="tdg-audit-stream">{events.length === 0 && !loading && <div className="tdg-empty-access"><History size={18} />Nenhuma mutação auditada neste filtro.</div>}{events.map((event) => <article key={event.id}><div><span className="tdg-audit-action">{event.acao}</span><strong>{event.tipo} {event.recursoId && `· ${event.recursoId}`}</strong><small>{new Date(event.criadoEm).toLocaleString("pt-BR")}</small></div><div><UserRound size={15} /><span>{event.atorEmail || event.atorId}</span></div>{event.detalhes && <p>{event.detalhes}</p>}</article>)}</div></>}
    </section>
  );
}
