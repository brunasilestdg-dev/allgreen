import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Copy,
  Download,
  FileCheck2,
  FilePlus,
  FileSearch,
  Gavel,
  Handshake,
  History,
  ListChecks,
  Plus,
  ScrollText,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import {
  CHECK_STATUSES,
  DUE_DILIGENCE_CATEGORIES,
  LEGAL_APPROVAL_STATUSES,
  LEGAL_CONFIDENTIALITY,
  LEGAL_CONTRACT_STATUSES,
  LEGAL_CONTRACT_TYPES,
  LEGAL_EVENT_KINDS,
  LEGAL_MATTER_STATUSES,
  LEGAL_MATTER_TYPES,
  LEGAL_PROCESS_INSTANCES,
  LEGAL_PROCESS_NATURES,
  LEGAL_PROCESS_ROLES,
  LEGAL_PROCESS_STATUSES,
  LEGAL_PROVISION_LEVELS,
  LEGAL_RISK_LEVELS,
  LEGAL_TEMPLATES,
  appendLegalEvent,
  approvalActionsFor,
  buildLegalAiPrompt,
  buildLegalNotifications,
  canRead,
  complianceGaps,
  complianceScore,
  contractStatusIsClosed,
  createContract,
  createDeadline,
  createFee,
  createLegalRequest,
  createMatter,
  createOffice,
  createPowerOfAttorney,
  createProcess,
  daysUntil,
  deadlineUrgency,
  exposureComposition,
  exportContractsCsv,
  exportDeadlinesCsv,
  exportMattersCsv,
  exportProcessesCsv,
  fillLegalTemplate,
  filterOwnOrLegal,
  formatMoneyBR,
  isLegalStaff,
  labelConfidentiality,
  labelContractStatus,
  labelContractType,
  labelMatterStatus,
  labelMatterType,
  labelProcessNature,
  labelProcessStatus,
  labelProvision,
  labelRisk,
  legalAlerts,
  legalDashboard,
  legalReports,
  legalTemplateFields,
  matterStatusIsClosed,
  parseLegalAiResponse,
  processStatusIsClosed,
  riskExposureSeries,
  riskMatrix,
  searchLegal,
  templateToDocument,
  validateContract,
  validateDeadline,
  validateFee,
  validateMatter,
  validateOffice,
  validatePowerOfAttorney,
  validateProcess,
} from "./legalHubDomain.js";
import { isTdgLegalAvailable } from "./tdgLegalBridge.js";
import { useTdgLegalRecords } from "./useTdgLegalRecords.js";
import "./legalHub.css";

// Ordem das abas. Cada uma declara se é RESTRITA ao Jurídico ("staff"): a UI
// esconde do solicitante quando ele não tem papel jurídico. "Solicitar" e
// "Minhas solicitações" ficam disponíveis para todo mundo — respeitando a
// regra da titular: qualquer pessoa pode solicitar, mas só o Jurídico vê a
// fila completa.
const TABS = [
  { id: "solicitar", label: "Solicitar ao Jurídico", icon: FilePlus, forAll: true },
  { id: "minhas", label: "Minhas solicitações", icon: ClipboardCheck, forAll: true },
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "demandas", label: "Fila do Jurídico", icon: ClipboardCheck },
  { id: "contratos", label: "Contratos", icon: FileCheck2 },
  { id: "processos", label: "Processos", icon: Gavel },
  { id: "procuracoes", label: "Procurações", icon: ScrollText },
  { id: "prazos", label: "Prazos", icon: AlarmClock },
  { id: "escritorios", label: "Escritórios e advogados", icon: Users },
  { id: "honorarios", label: "Honorários e provisões", icon: Handshake },
  { id: "compliance", label: "Compliance", icon: ShieldCheck },
  { id: "modelos", label: "Modelos", icon: ScrollText, forAll: true },
  { id: "ia", label: "IA jurídica", icon: Sparkles, forAll: true },
  { id: "busca", label: "Busca", icon: Search, forAll: true },
  { id: "relatorios", label: "Relatórios", icon: ListChecks },
];

const dataBR = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("pt-BR");
};

const dataHoraBR = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("pt-BR");
};

// Baixa uma string CSV como arquivo. Reaproveita o padrão dos módulos
// Planilhas/Contatos — usa Blob + link temporário, sem lib externa.
function downloadCsv(content, filename) {
  try {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return true;
  } catch {
    return false;
  }
}

// Gráfico simples em SVG puro — barras horizontais para risco/exposição.
// Sem lib. `series` é `[{label, value, color}]`. Valor sempre positivo.
function LegalBarChart({ series, format = (v) => formatMoneyBR(v) }) {
  const max = Math.max(1, ...series.map((s) => Number(s.value) || 0));
  return (
    <div className="lgl-chart">
      {series.map((row) => {
        const width = Math.max(2, Math.round(((Number(row.value) || 0) / max) * 100));
        return (
          <div className="lgl-chart-row" key={row.id || row.label}>
            <span className="lgl-chart-label">{row.label}</span>
            <div className="lgl-chart-track">
              <div
                className="lgl-chart-bar"
                style={{ width: `${width}%`, background: row.color || "var(--lgl-accent)" }}
              />
            </div>
            <strong className="lgl-chart-value">{format(row.value)}</strong>
          </div>
        );
      })}
    </div>
  );
}

// Timeline compacta de eventos do registro (nota, parecer, decisão…).
function LegalTimeline({ record, onAddEvent }) {
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState("note");
  const events = Array.isArray(record?.events) ? record.events : [];
  const submit = () => {
    if (!message.trim()) return;
    onAddEvent({ kind, message: message.trim() });
    setMessage("");
    setKind("note");
  };
  return (
    <div className="lgl-timeline">
      <div className="lgl-timeline-list">
        {events.length === 0 && <small>Sem eventos ainda.</small>}
        {events.map((ev) => (
          <article key={ev.id} className={`lgl-timeline-ev kind-${ev.kind}`}>
            <header>
              <strong>
                {LEGAL_EVENT_KINDS.find((k) => k.id === ev.kind)?.label || ev.kind}
              </strong>
              <small>
                {ev.author ? `${ev.author} · ` : ""}
                {dataHoraBR(ev.createdAt)}
              </small>
            </header>
            {ev.message && <p>{ev.message}</p>}
          </article>
        ))}
      </div>
      <div className="lgl-timeline-add">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {LEGAL_EVENT_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Escrever nota, parecer ou decisão"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="primary" onClick={submit}>
          Registrar
        </button>
      </div>
    </div>
  );
}

const readonlyLegal = (db) => ({
  matters: Array.isArray(db?.legalMatters) ? db.legalMatters : [],
  contracts: Array.isArray(db?.legalContracts) ? db.legalContracts : [],
  processes: Array.isArray(db?.legalProcesses) ? db.legalProcesses : [],
  powersOfAttorney: Array.isArray(db?.legalPowersOfAttorney) ? db.legalPowersOfAttorney : [],
  deadlines: Array.isArray(db?.legalDeadlines) ? db.legalDeadlines : [],
  offices: Array.isArray(db?.legalOffices) ? db.legalOffices : [],
  fees: Array.isArray(db?.legalFees) ? db.legalFees : [],
  templates: Array.isArray(db?.legalTemplates) ? db.legalTemplates : [],
  compliance: Array.isArray(db?.legalCompliance) ? db.legalCompliance : [],
});

// Combina contatos + leads + oportunidades num único array para os pickers de
// "vínculo". A UI mostra rótulo `nome · categoria`, e grava o próprio texto —
// preserva o formato atual das colecões existentes sem exigir migração.
function useLinkedEntities(db) {
  return useMemo(() => {
    const items = [];
    for (const c of db?.contacts || []) {
      const label = c.name + (c.company ? ` · ${c.company}` : "");
      items.push({ id: c.id, label, kind: "contato" });
    }
    for (const l of db?.leads || []) {
      items.push({ id: l.id, label: `${l.name || "Lead"} · Lead`, kind: "lead" });
    }
    for (const o of db?.opportunities || []) {
      items.push({ id: o.id, label: `${o.title || "Oportunidade"} · Oportunidade`, kind: "oportunidade" });
    }
    return items;
  }, [db]);
}

// Auxiliar para inserir/remover/atualizar coleções por chave. Reaproveitado
// em várias abas — mantém a semântica de update do App (que trabalha com
// callback ou objeto simples).
function useCollection(update, key) {
  return useMemo(() => ({
    add: (record) =>
      update((prev) => ({
        ...prev,
        [key]: [...(prev?.[key] || []), record],
      })),
    replace: (id, patch) =>
      update((prev) => ({
        ...prev,
        [key]: (prev?.[key] || []).map((item) =>
          item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item,
        ),
      })),
    remove: (id) =>
      update((prev) => ({
        ...prev,
        [key]: (prev?.[key] || []).filter((item) => item.id !== id),
      })),
  }), [update, key]);
}

function ConfidentialityBadge({ id }) {
  return <span className="lgl-chip">{labelConfidentiality(id)}</span>;
}

function RiskBadge({ id }) {
  return <span className={`lgl-chip risco-${id || "medio"}`}>{labelRisk(id)}</span>;
}

function UrgencyBadge({ dueDate, now }) {
  const days = daysUntil(dueDate, now);
  const u = deadlineUrgency(days);
  return (
    <span className={`lgl-chip urgencia-${u.level}`}>
      <CalendarClock size={12} /> {u.label}
    </span>
  );
}

// -----------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------

function DashboardTab({ records, now }) {
  const dashboard = useMemo(() => legalDashboard(records, now), [records, now]);
  const matrix = useMemo(
    () => riskMatrix(records.matters, records.processes),
    [records.matters, records.processes],
  );
  const alerts = useMemo(() => legalAlerts(records, now), [records, now]);
  const exposureBars = useMemo(() => exposureComposition(records, now), [records, now]);
  const riskBars = useMemo(() => riskExposureSeries(records), [records]);

  const { counts, exposure, riskCounts } = dashboard;
  return (
    <div className="lgl-panel">
      <div className="lgl-metrics">
        <article>
          <small>Demandas em aberto</small>
          <strong>{counts.openMatters}</strong>
        </article>
        <article>
          <small>Contratos vigentes</small>
          <strong>{counts.activeContracts}</strong>
        </article>
        <article className={counts.inNegotiationContracts > 0 ? "warn" : ""}>
          <small>Em negociação</small>
          <strong>{counts.inNegotiationContracts}</strong>
        </article>
        <article className={counts.openProcesses > 0 ? "warn" : ""}>
          <small>Processos em aberto</small>
          <strong>{counts.openProcesses}</strong>
        </article>
        <article className={counts.openDeadlines > 0 ? "danger" : ""}>
          <small>Prazos em 30 dias</small>
          <strong>{counts.openDeadlines}</strong>
        </article>
        <article>
          <small>Procurações vigentes</small>
          <strong>{counts.powersOfAttorney}</strong>
        </article>
      </div>

      <div className="lgl-metrics">
        <article>
          <small>Exposição contingente</small>
          <strong>{formatMoneyBR(exposure.contingent)}</strong>
        </article>
        <article>
          <small>Provisões</small>
          <strong>{formatMoneyBR(exposure.provisioned)}</strong>
        </article>
        <article>
          <small>Honorários em aberto</small>
          <strong>{formatMoneyBR(exposure.fees)}</strong>
        </article>
        <article className={exposure.total > 0 ? "warn" : ""}>
          <small>Exposição total</small>
          <strong>{formatMoneyBR(exposure.total)}</strong>
        </article>
      </div>

      <h2>Risco em aberto (por nível)</h2>
      <div className="lgl-metrics">
        {LEGAL_RISK_LEVELS.map((r) => (
          <article key={r.id} className={r.id === "critico" ? "danger" : r.id === "alto" ? "warn" : ""}>
            <small>Risco {r.label.toLowerCase()}</small>
            <strong>{riskCounts[r.id] || 0}</strong>
          </article>
        ))}
      </div>

      <h2>Composição da exposição</h2>
      <LegalBarChart series={exposureBars} />

      <h2>Valor em aberto por risco</h2>
      <LegalBarChart series={riskBars} />

      <h2>Matriz de risco × exposição</h2>
      {matrix.length === 0 ? (
        <p className="hint">Nenhum risco em aberto ainda.</p>
      ) : (
        <div className="lgl-risk-matrix">
          {matrix.map((cell) => (
            <article key={`${cell.risk}-${cell.bucket}`} className="lgl-risk-cell">
              <RiskBadge id={cell.risk} />
              <small>
                {cell.bucket === "sem" && "Sem valor informado"}
                {cell.bucket === "ate10k" && "Até R$ 10 mil"}
                {cell.bucket === "ate100k" && "R$ 10 mil a R$ 100 mil"}
                {cell.bucket === "ate1M" && "R$ 100 mil a R$ 1 milhão"}
                {cell.bucket === "acima1M" && "Acima de R$ 1 milhão"}
              </small>
              <strong>
                {cell.count} · {formatMoneyBR(cell.amount)}
              </strong>
            </article>
          ))}
        </div>
      )}

      <h2>Alertas e vencimentos</h2>
      {alerts.length === 0 ? (
        <p className="hint">Nenhum alerta no horizonte de 30 dias.</p>
      ) : (
        <div className="lgl-alert-list">
          {alerts.slice(0, 20).map((alert) => (
            <div key={alert.id} className={`lgl-alert level-${alert.level}`}>
              <strong>{alert.title}</strong>
              <small>{alert.subtitle}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Solicitar ao Jurídico (formulário simplificado, disponível a todos)
// -----------------------------------------------------------------------

const emptyRequest = {
  title: "",
  description: "",
  type: "consultivo",
  risk: "medio",
  area: "",
  dueDate: "",
};

function RequestTab({ collection, setToast, viewer, allRecords }) {
  const [form, setForm] = useState(emptyRequest);
  const submit = (event) => {
    event.preventDefault();
    if (!form.title.trim()) return setToast?.("Descreva a solicitação no título.");
    if (!form.description.trim())
      return setToast?.("Escreva um pequeno resumo do que precisa do Jurídico.");
    const request = createLegalRequest(form, viewer);
    collection.add(request);
    setForm(emptyRequest);
    setToast?.("Solicitação enviada ao Jurídico.");
  };
  const own = useMemo(
    () =>
      (allRecords.matters || []).filter(
        (m) => m.submitterId && m.submitterId === viewer.userId,
      ).length,
    [allRecords.matters, viewer.userId],
  );
  return (
    <div className="lgl-panel">
      <header>
        <h2>Solicitar ao Jurídico</h2>
        <p className="hint">
          Qualquer pessoa pode registrar uma solicitação. Ela entra na fila do Jurídico e você
          acompanha o status na aba &ldquo;Minhas solicitações&rdquo;. O Jurídico complementa com
          risco, prazo, responsável e escritório externo depois de analisar.
          {own > 0 ? ` Você tem ${own} solicitaç${own === 1 ? "ão" : "ões"} registrada${own === 1 ? "" : "s"}.` : ""}
        </p>
      </header>
      <form className="lgl-form" onSubmit={submit}>
        <label className="wide">
          <span>Assunto</span>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Ex.: Revisar minuta de contrato com fornecedor XPTO"
          />
        </label>
        <label>
          <span>Tipo</span>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {LEGAL_MATTER_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Urgência percebida</span>
          <select
            value={form.risk}
            onChange={(e) => setForm({ ...form, risk: e.target.value })}
          >
            {LEGAL_RISK_LEVELS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Área / setor solicitante</span>
          <input
            value={form.area}
            onChange={(e) => setForm({ ...form, area: e.target.value })}
            placeholder="Comercial, TI, RH..."
          />
        </label>
        <label>
          <span>Prazo desejado (opcional)</span>
          <input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          />
        </label>
        <label className="wide">
          <span>Contexto e o que você precisa</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Explique o que gerou a demanda, o que você espera do Jurídico e prazos externos que vale respeitar."
          />
        </label>
        <div className="lgl-form-actions" style={{ gridColumn: "1 / -1" }}>
          <button className="primary" type="submit">
            Enviar ao Jurídico
          </button>
        </div>
      </form>
      <p className="lgl-notice">
        <ShieldAlert size={13} /> Solicitações não substituem parecer formal — o Jurídico analisa
        e responde na sua caixa de notificações.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------
// Minhas solicitações (visão do solicitante — só as próprias)
// -----------------------------------------------------------------------

function MyRequestsTab({ records, viewer, now }) {
  const mine = useMemo(
    () =>
      (records.matters || [])
        .filter((m) => m.submitterId && m.submitterId === viewer.userId)
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))),
    [records.matters, viewer.userId],
  );
  return (
    <div className="lgl-panel">
      <header>
        <h2>Minhas solicitações</h2>
        <p className="hint">
          Aqui você acompanha o que registrou. A fila completa fica visível só para o Jurídico.
        </p>
      </header>
      {mine.length === 0 ? (
        <div className="lgl-empty">
          <ClipboardCheck size={22} /> Você ainda não registrou nenhuma solicitação.
        </div>
      ) : (
        <div className="lgl-list">
          {mine.map((m) => (
            <article key={m.id} className={`lgl-card risk-${m.risk}`}>
              <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <h3>{m.title}</h3>
                  <small>
                    {labelMatterType(m.type)} · {labelMatterStatus(m.status)}
                  </small>
                </div>
                <div className="lgl-badges">
                  <RiskBadge id={m.risk} />
                </div>
              </header>
              {m.description && <p>{m.description}</p>}
              <div className="lgl-badges">
                {m.dueDate && <UrgencyBadge dueDate={m.dueDate} now={now} />}
                {m.responsibleId && (
                  <span className="lgl-chip">Responsável: {m.responsibleId}</span>
                )}
                <span className="lgl-chip">Enviada em {dataBR(m.openedAt)}</span>
              </div>
              {Array.isArray(m.events) && m.events.length > 0 && (
                <details>
                  <summary>
                    <History size={12} /> Histórico ({m.events.length})
                  </summary>
                  <div className="lgl-timeline-list" style={{ marginTop: 8 }}>
                    {m.events.slice(-6).map((ev) => (
                      <article key={ev.id} className={`lgl-timeline-ev kind-${ev.kind}`}>
                        <header>
                          <strong>
                            {LEGAL_EVENT_KINDS.find((k) => k.id === ev.kind)?.label || ev.kind}
                          </strong>
                          <small>{dataHoraBR(ev.createdAt)}</small>
                        </header>
                        {ev.message && <p>{ev.message}</p>}
                      </article>
                    ))}
                  </div>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Demandas jurídicas
// -----------------------------------------------------------------------

const emptyMatter = {
  title: "",
  description: "",
  type: "consultivo",
  status: "aberto",
  risk: "medio",
  confidentiality: "interno",
  amountAtRisk: "",
  provision: "remota",
  dueDate: "",
  responsibleId: "",
  externalOfficeId: "",
  notes: "",
};

function MattersTab({ records, collection, now, setToast, linkedEntities, offices, viewer }) {
  const [form, setForm] = useState(emptyMatter);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("abertas");
  const [expandedId, setExpandedId] = useState(null);

  const list = useMemo(() => {
    const items = [...(records.matters || [])].sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
    );
    if (filter === "todas") return items;
    if (filter === "encerradas") return items.filter((m) => matterStatusIsClosed(m.status));
    return items.filter((m) => !matterStatusIsClosed(m.status));
  }, [records.matters, filter]);

  const save = (event) => {
    event.preventDefault();
    const err = validateMatter(form);
    if (err) return setToast?.(err);
    collection.add(createMatter(form));
    setForm(emptyMatter);
    setOpen(false);
    setToast?.("Demanda jurídica registrada.");
  };

  const exportCsv = () => {
    const ok = downloadCsv(exportMattersCsv(list), `juridico-demandas-${new Date().toISOString().slice(0, 10)}.csv`);
    setToast?.(ok ? "CSV exportado." : "Não foi possível exportar o CSV.");
  };

  const addEventTo = (matter, event) => {
    const updated = appendLegalEvent(matter, {
      ...event,
      author: viewer.name || viewer.userId || "Jurídico",
    });
    collection.replace(matter.id, updated);
  };

  return (
    <div className="lgl-panel">
      <header className="lgl-actions" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>Fila do Jurídico</h2>
          <p className="hint">
            Demandas (internas e solicitadas por outras áreas) com responsável, risco e prazo. Só o
            time jurídico enxerga esta fila completa.
          </p>
        </div>
        <div className="lgl-actions">
          <button type="button" onClick={exportCsv} title="Exportar lista atual em CSV">
            <Download size={14} /> Exportar CSV
          </button>
          <button className="primary" onClick={() => setOpen((v) => !v)}>
            <Plus size={14} /> Nova demanda
          </button>
        </div>
      </header>

      <div className="lgl-tabs" role="tablist" aria-label="Filtro de demandas">
        {[["abertas", "Em aberto"], ["encerradas", "Encerradas"], ["todas", "Todas"]].map(
          ([id, label]) => (
            <button
              key={id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
              type="button"
            >
              {label}
            </button>
          ),
        )}
      </div>

      {open && (
        <form className="lgl-form" onSubmit={save}>
          <label className="wide">
            <span>Título</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex.: Revisão da nova política de privacidade"
            />
          </label>
          <label>
            <span>Tipo</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {LEGAL_MATTER_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Situação</span>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {LEGAL_MATTER_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Risco</span>
            <select value={form.risk} onChange={(e) => setForm({ ...form, risk: e.target.value })}>
              {LEGAL_RISK_LEVELS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Provisão</span>
            <select
              value={form.provision}
              onChange={(e) => setForm({ ...form, provision: e.target.value })}
            >
              {LEGAL_PROVISION_LEVELS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Confidencialidade</span>
            <select
              value={form.confidentiality}
              onChange={(e) => setForm({ ...form, confidentiality: e.target.value })}
            >
              {LEGAL_CONFIDENTIALITY.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Valor em risco (R$)</span>
            <input
              value={form.amountAtRisk}
              onChange={(e) => setForm({ ...form, amountAtRisk: e.target.value })}
              placeholder="0,00"
              inputMode="decimal"
            />
          </label>
          <label>
            <span>Prazo interno</span>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </label>
          <label>
            <span>Responsável pela demanda</span>
            <input
              value={form.responsibleId}
              onChange={(e) => setForm({ ...form, responsibleId: e.target.value })}
              placeholder="Nome de quem toca a demanda"
            />
          </label>
          <label>
            <span>Vinculado a (contato / lead / oportunidade)</span>
            <select
              value={(form.links && form.links[0]) || ""}
              onChange={(e) =>
                setForm({ ...form, links: e.target.value ? [e.target.value] : [] })
              }
            >
              <option value="">Sem vínculo</option>
              {(linkedEntities || []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Escritório externo</span>
            <select
              value={form.externalOfficeId}
              onChange={(e) => setForm({ ...form, externalOfficeId: e.target.value })}
            >
              <option value="">Sem escritório externo</option>
              {(offices || []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            <span>Descrição / pedido</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Contexto, expectativas e restrições"
            />
          </label>
          <label className="wide">
            <span>Notas do jurídico</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Observações, riscos e ressalvas"
            />
          </label>
          <div className="lgl-form-actions" style={{ gridColumn: "1 / -1" }}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setForm(emptyMatter);
              }}
            >
              Cancelar
            </button>
            <button className="primary" type="submit">
              Registrar demanda
            </button>
          </div>
        </form>
      )}

      <div className="lgl-list">
        {list.length === 0 && (
          <div className="lgl-empty">
            <ClipboardCheck size={22} />
            Nenhuma demanda registrada. Cadastre a primeira para o Jurídico começar a acompanhar.
          </div>
        )}
        {list.map((m) => (
          <article key={m.id} className={`lgl-card risk-${m.risk}`}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <h3>{m.title}</h3>
                <small>
                  {labelMatterType(m.type)} · {labelMatterStatus(m.status)}
                </small>
              </div>
              <div className="lgl-badges">
                <RiskBadge id={m.risk} />
                <ConfidentialityBadge id={m.confidentiality} />
              </div>
            </header>
            {m.description && <p>{m.description}</p>}
            <div className="lgl-badges">
              {m.dueDate && <UrgencyBadge dueDate={m.dueDate} now={now} />}
              {Number(m.amountAtRisk) > 0 && (
                <span className="lgl-chip">Em risco: {formatMoneyBR(m.amountAtRisk)}</span>
              )}
              {m.provision && (
                <span className="lgl-chip">Provisão: {labelProvision(m.provision)}</span>
              )}
              {m.externalOfficeId && (
                <span className="lgl-chip">
                  <Building2 size={12} /> Escritório:{" "}
                  {(offices || []).find((o) => o.id === m.externalOfficeId)?.name || m.externalOfficeId}
                </span>
              )}
              {m.submitterName && (
                <span className="lgl-chip">
                  Solicitante: {m.submitterName}
                  {m.submitterArea ? ` · ${m.submitterArea}` : ""}
                </span>
              )}
            </div>
            <footer>
              <small>Atualizada em {new Date(m.updatedAt).toLocaleString("pt-BR")}</small>
              <div className="lgl-actions">
                <button onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}>
                  <History size={12} />
                  {expandedId === m.id ? "Fechar histórico" : "Histórico"}
                </button>
                <button
                  onClick={() =>
                    collection.replace(m.id, {
                      status: matterStatusIsClosed(m.status) ? "em_andamento" : "concluido",
                    })
                  }
                >
                  {matterStatusIsClosed(m.status) ? "Reabrir" : "Concluir"}
                </button>
                <button className="danger" onClick={() => collection.remove(m.id)}>
                  <Trash2 size={12} /> Remover
                </button>
              </div>
            </footer>
            {expandedId === m.id && (
              <LegalTimeline record={m} onAddEvent={(ev) => addEventTo(m, ev)} />
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Contratos
// -----------------------------------------------------------------------

const emptyContract = {
  title: "",
  type: "prestacao_servicos",
  status: "rascunho",
  risk: "medio",
  confidentiality: "interno",
  counterparty: "",
  counterpartyDocument: "",
  amount: "",
  currency: "BRL",
  startDate: "",
  endDate: "",
  renewalMode: "manual",
  renewalNoticeDays: 30,
  approvalStatus: "pendente",
  notes: "",
};

function ContractsTab({ records, collection, now, setToast, viewer }) {
  const [form, setForm] = useState(emptyContract);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [timelineId, setTimelineId] = useState(null);

  const list = useMemo(
    () =>
      [...(records.contracts || [])].sort((a, b) =>
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
      ),
    [records.contracts],
  );

  const selected = list.find((c) => c.id === selectedId) || null;

  const save = (event) => {
    event.preventDefault();
    const err = validateContract(form);
    if (err) return setToast?.(err);
    collection.add(createContract(form));
    setForm(emptyContract);
    setOpen(false);
    setToast?.("Contrato registrado.");
  };

  const exportCsv = () => {
    const ok = downloadCsv(exportContractsCsv(list), `juridico-contratos-${new Date().toISOString().slice(0, 10)}.csv`);
    setToast?.(ok ? "CSV exportado." : "Não foi possível exportar o CSV.");
  };

  const addEventTo = (contract, event) => {
    const updated = appendLegalEvent(contract, {
      ...event,
      author: viewer.name || viewer.userId || "Jurídico",
    });
    collection.replace(contract.id, updated);
  };

  const actions = selected ? approvalActionsFor(selected.status, viewer) : [];

  return (
    <div className="lgl-panel">
      <header className="lgl-actions" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>Contratos</h2>
          <p className="hint">
            Vigência, contraparte, valor, status de assinatura e vínculo com o fluxo de aprovação.
          </p>
        </div>
        <div className="lgl-actions">
          <button type="button" onClick={exportCsv}>
            <Download size={14} /> Exportar CSV
          </button>
          <button className="primary" onClick={() => setOpen((v) => !v)}>
            <Plus size={14} /> Novo contrato
          </button>
        </div>
      </header>

      {open && (
        <form className="lgl-form" onSubmit={save}>
          <label className="wide">
            <span>Título</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex.: Contrato de prestação de serviços · Cliente Alfa"
            />
          </label>
          <label>
            <span>Tipo</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {LEGAL_CONTRACT_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {LEGAL_CONTRACT_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Risco</span>
            <select value={form.risk} onChange={(e) => setForm({ ...form, risk: e.target.value })}>
              {LEGAL_RISK_LEVELS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Contraparte</span>
            <input
              value={form.counterparty}
              onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
              placeholder="Razão social ou nome"
            />
          </label>
          <label>
            <span>CPF/CNPJ da contraparte</span>
            <input
              value={form.counterpartyDocument}
              onChange={(e) => setForm({ ...form, counterpartyDocument: e.target.value })}
              placeholder="Só números"
            />
          </label>
          <label>
            <span>Valor</span>
            <input
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0,00"
              inputMode="decimal"
            />
          </label>
          <label>
            <span>Moeda</span>
            <input
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              placeholder="BRL, USD..."
            />
          </label>
          <label>
            <span>Início</span>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </label>
          <label>
            <span>Fim</span>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </label>
          <label>
            <span>Renovação</span>
            <select
              value={form.renewalMode}
              onChange={(e) => setForm({ ...form, renewalMode: e.target.value })}
            >
              <option value="manual">Manual</option>
              <option value="automatic">Automática</option>
            </select>
          </label>
          <label>
            <span>Aviso prévio (dias)</span>
            <input
              type="number"
              min="0"
              max="365"
              value={form.renewalNoticeDays}
              onChange={(e) =>
                setForm({ ...form, renewalNoticeDays: e.target.value })
              }
            />
          </label>
          <label>
            <span>Confidencialidade</span>
            <select
              value={form.confidentiality}
              onChange={(e) => setForm({ ...form, confidentiality: e.target.value })}
            >
              {LEGAL_CONFIDENTIALITY.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Aprovação</span>
            <select
              value={form.approvalStatus}
              onChange={(e) => setForm({ ...form, approvalStatus: e.target.value })}
            >
              {LEGAL_APPROVAL_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            <span>Notas</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Observações, cláusulas de risco, exceções"
            />
          </label>
          <div className="lgl-form-actions" style={{ gridColumn: "1 / -1" }}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setForm(emptyContract);
              }}
            >
              Cancelar
            </button>
            <button className="primary" type="submit">
              Registrar contrato
            </button>
          </div>
        </form>
      )}

      <div className="lgl-list">
        {list.length === 0 && (
          <div className="lgl-empty">
            <FileCheck2 size={22} /> Nenhum contrato cadastrado ainda.
          </div>
        )}
        {list.map((c) => {
          const showUrgency = c.status === "vigente" && c.endDate;
          return (
            <article key={c.id} className={`lgl-card risk-${c.risk}`}>
              <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <h3>{c.title}</h3>
                  <small>
                    {labelContractType(c.type)} · {labelContractStatus(c.status)}
                    {c.counterparty ? ` · ${c.counterparty}` : ""}
                  </small>
                </div>
                <div className="lgl-badges">
                  <RiskBadge id={c.risk} />
                  <ConfidentialityBadge id={c.confidentiality} />
                </div>
              </header>
              <div className="lgl-badges">
                {c.amount > 0 && <span className="lgl-chip">{formatMoneyBR(c.amount)}</span>}
                {c.startDate && (
                  <span className="lgl-chip">
                    <CalendarClock size={12} /> {dataBR(c.startDate)} → {dataBR(c.endDate)}
                  </span>
                )}
                {showUrgency && <UrgencyBadge dueDate={c.endDate} now={now} />}
                {c.renewalMode === "automatic" && (
                  <span className="lgl-chip">Renovação automática</span>
                )}
              </div>
              <footer>
                <small>Aprovação: {c.approvalStatus}</small>
                <div className="lgl-actions">
                  <button onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}>
                    {selectedId === c.id ? "Fechar fluxo" : "Fluxo de aprovação"}
                  </button>
                  <button onClick={() => setTimelineId(timelineId === c.id ? null : c.id)}>
                    <History size={12} />
                    {timelineId === c.id ? "Fechar histórico" : "Histórico"}
                  </button>
                  {!contractStatusIsClosed(c.status) && (
                    <button
                      onClick={() =>
                        collection.replace(c.id, {
                          status: c.status === "vigente" ? "encerrado" : "vigente",
                        })
                      }
                    >
                      {c.status === "vigente" ? "Encerrar" : "Marcar vigente"}
                    </button>
                  )}
                  <button className="danger" onClick={() => collection.remove(c.id)}>
                    <Trash2 size={12} /> Remover
                  </button>
                </div>
              </footer>
              {timelineId === c.id && (
                <LegalTimeline record={c} onAddEvent={(ev) => addEventTo(c, ev)} />
              )}
              {selectedId === c.id && (
                <div className="lgl-approval-flow">
                  <header>
                    <strong>Fluxo de aprovação</strong>
                    <small>Situação atual: {labelContractStatus(c.status)}</small>
                  </header>
                  {actions.length === 0 ? (
                    <p className="hint">Sem ações disponíveis para esta situação.</p>
                  ) : (
                    <div className="lgl-actions">
                      {actions.map((action) => (
                        <button
                          key={action.id}
                          className={action.juridico ? "primary" : ""}
                          onClick={() =>
                            collection.replace(c.id, {
                              status:
                                action.id === "submeter"
                                  ? "em_analise"
                                  : action.id === "aprovar"
                                    ? "aprovado"
                                    : action.id === "reprovar"
                                      ? "rascunho"
                                      : action.id === "solicitar_ajuste"
                                        ? "ajuste_solicitado"
                                        : c.status,
                              approvalStatus:
                                action.id === "aprovar"
                                  ? "aprovado"
                                  : action.id === "reprovar"
                                    ? "reprovado"
                                    : action.id === "solicitar_ajuste"
                                      ? "ajuste_solicitado"
                                      : "pendente",
                            })
                          }
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="hint">
                    Cada ação registra na atualização; para linha do tempo completa, use um evento
                    na aba &ldquo;IA jurídica&rdquo; ou anexe um parecer nas notas do contrato.
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Processos judiciais e administrativos
// -----------------------------------------------------------------------

const emptyProcess = {
  title: "",
  number: "",
  nature: "civel",
  status: "em_andamento",
  instance: "primeira",
  role: "autor",
  risk: "medio",
  provision: "remota",
  amount: "",
  provisionAmount: "",
  court: "",
  jurisdiction: "",
  filedAt: "",
  nextHearing: "",
  nextDeadline: "",
  confidentiality: "restrito",
  notes: "",
};

function ProcessesTab({ records, collection, now, setToast, viewer }) {
  const [form, setForm] = useState(emptyProcess);
  const [open, setOpen] = useState(false);
  const [timelineId, setTimelineId] = useState(null);

  const list = useMemo(
    () =>
      [...(records.processes || [])].sort((a, b) =>
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
      ),
    [records.processes],
  );

  const save = (event) => {
    event.preventDefault();
    const err = validateProcess(form);
    if (err) return setToast?.(err);
    collection.add(createProcess(form));
    setForm(emptyProcess);
    setOpen(false);
    setToast?.("Processo cadastrado.");
  };

  const exportCsv = () => {
    const ok = downloadCsv(exportProcessesCsv(list), `juridico-processos-${new Date().toISOString().slice(0, 10)}.csv`);
    setToast?.(ok ? "CSV exportado." : "Não foi possível exportar o CSV.");
  };

  const addEventTo = (process, event) => {
    const updated = appendLegalEvent(process, {
      ...event,
      author: viewer.name || viewer.userId || "Jurídico",
    });
    collection.replace(process.id, updated);
  };

  return (
    <div className="lgl-panel">
      <header className="lgl-actions" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>Processos judiciais e administrativos</h2>
          <p className="hint">
            Cível, trabalhista, tributário, regulatório ou administrativo — com instância, papel,
            valor de causa e provisão.
          </p>
        </div>
        <div className="lgl-actions">
          <button type="button" onClick={exportCsv}>
            <Download size={14} /> Exportar CSV
          </button>
          <button className="primary" onClick={() => setOpen((v) => !v)}>
            <Plus size={14} /> Novo processo
          </button>
        </div>
      </header>

      {open && (
        <form className="lgl-form" onSubmit={save}>
          <label className="wide">
            <span>Título</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex.: Reclamação Trabalhista · João Silva"
            />
          </label>
          <label>
            <span>Nº do processo</span>
            <input
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
              placeholder="1234567-89.2026..."
            />
          </label>
          <label>
            <span>Natureza</span>
            <select
              value={form.nature}
              onChange={(e) => setForm({ ...form, nature: e.target.value })}
            >
              {LEGAL_PROCESS_NATURES.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Situação</span>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {LEGAL_PROCESS_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Instância</span>
            <select
              value={form.instance}
              onChange={(e) => setForm({ ...form, instance: e.target.value })}
            >
              {LEGAL_PROCESS_INSTANCES.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Papel</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {LEGAL_PROCESS_ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Risco</span>
            <select value={form.risk} onChange={(e) => setForm({ ...form, risk: e.target.value })}>
              {LEGAL_RISK_LEVELS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Provisão</span>
            <select
              value={form.provision}
              onChange={(e) => setForm({ ...form, provision: e.target.value })}
            >
              {LEGAL_PROVISION_LEVELS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Valor da causa (R$)</span>
            <input
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0,00"
              inputMode="decimal"
            />
          </label>
          <label>
            <span>Valor provisionado (R$)</span>
            <input
              value={form.provisionAmount}
              onChange={(e) => setForm({ ...form, provisionAmount: e.target.value })}
              placeholder="0,00"
              inputMode="decimal"
            />
          </label>
          <label>
            <span>Órgão / vara</span>
            <input
              value={form.court}
              onChange={(e) => setForm({ ...form, court: e.target.value })}
              placeholder="2ª Vara do Trabalho de São Paulo"
            />
          </label>
          <label>
            <span>Foro / jurisdição</span>
            <input
              value={form.jurisdiction}
              onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
              placeholder="São Paulo/SP"
            />
          </label>
          <label>
            <span>Data de distribuição</span>
            <input
              type="date"
              value={form.filedAt}
              onChange={(e) => setForm({ ...form, filedAt: e.target.value })}
            />
          </label>
          <label>
            <span>Próxima audiência</span>
            <input
              type="date"
              value={form.nextHearing}
              onChange={(e) => setForm({ ...form, nextHearing: e.target.value })}
            />
          </label>
          <label>
            <span>Próximo prazo</span>
            <input
              type="date"
              value={form.nextDeadline}
              onChange={(e) => setForm({ ...form, nextDeadline: e.target.value })}
            />
          </label>
          <label className="wide">
            <span>Notas / histórico resumido</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Tratativas, pareceres, tese, cadeia de eventos"
            />
          </label>
          <div className="lgl-form-actions" style={{ gridColumn: "1 / -1" }}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setForm(emptyProcess);
              }}
            >
              Cancelar
            </button>
            <button className="primary" type="submit">
              Registrar processo
            </button>
          </div>
        </form>
      )}

      <div className="lgl-list">
        {list.length === 0 && (
          <div className="lgl-empty">
            <Gavel size={22} /> Nenhum processo cadastrado ainda.
          </div>
        )}
        {list.map((p) => (
          <article key={p.id} className={`lgl-card risk-${p.risk}`}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <h3>{p.title}</h3>
                <small>
                  {p.number || "sem número"} · {labelProcessNature(p.nature)} · {labelProcessStatus(p.status)}
                </small>
              </div>
              <div className="lgl-badges">
                <RiskBadge id={p.risk} />
                <ConfidentialityBadge id={p.confidentiality} />
              </div>
            </header>
            <div className="lgl-badges">
              {p.court && <span className="lgl-chip"><Building2 size={12} /> {p.court}</span>}
              {p.amount > 0 && (
                <span className="lgl-chip">Causa: {formatMoneyBR(p.amount)}</span>
              )}
              {p.provisionAmount > 0 && (
                <span className="lgl-chip">Prov.: {formatMoneyBR(p.provisionAmount)}</span>
              )}
              {p.nextHearing && (
                <span className="lgl-chip">
                  <CalendarClock size={12} /> Audiência: {dataBR(p.nextHearing)}
                </span>
              )}
              {p.nextDeadline && <UrgencyBadge dueDate={p.nextDeadline} now={now} />}
            </div>
            <footer>
              <small>Atualizado em {new Date(p.updatedAt).toLocaleString("pt-BR")}</small>
              <div className="lgl-actions">
                <button onClick={() => setTimelineId(timelineId === p.id ? null : p.id)}>
                  <History size={12} />
                  {timelineId === p.id ? "Fechar histórico" : "Histórico"}
                </button>
                <button
                  onClick={() =>
                    collection.replace(p.id, {
                      status: processStatusIsClosed(p.status) ? "em_andamento" : "arquivado",
                    })
                  }
                >
                  {processStatusIsClosed(p.status) ? "Reabrir" : "Arquivar"}
                </button>
                <button className="danger" onClick={() => collection.remove(p.id)}>
                  <Trash2 size={12} /> Remover
                </button>
              </div>
            </footer>
            {timelineId === p.id && (
              <LegalTimeline record={p} onAddEvent={(ev) => addEventTo(p, ev)} />
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Procurações
// -----------------------------------------------------------------------

const emptyPoa = {
  title: "",
  grantor: "",
  grantorDocument: "",
  attorney: "",
  attorneyDocument: "",
  purpose: "",
  effectiveFrom: "",
  expiresAt: "",
  substabelecimento: false,
  status: "vigente",
  confidentiality: "restrito",
  notes: "",
};

function PowersOfAttorneyTab({ records, collection, now, setToast }) {
  const [form, setForm] = useState(emptyPoa);
  const [open, setOpen] = useState(false);

  const list = useMemo(
    () =>
      [...(records.powersOfAttorney || [])].sort((a, b) =>
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
      ),
    [records.powersOfAttorney],
  );

  const save = (event) => {
    event.preventDefault();
    const err = validatePowerOfAttorney(form);
    if (err) return setToast?.(err);
    collection.add(createPowerOfAttorney(form));
    setForm(emptyPoa);
    setOpen(false);
    setToast?.("Procuração registrada.");
  };

  return (
    <div className="lgl-panel">
      <header className="lgl-actions" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>Procurações</h2>
          <p className="hint">Quem representa a empresa, com quais poderes e por quanto tempo.</p>
        </div>
        <button className="primary" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} /> Nova procuração
        </button>
      </header>

      {open && (
        <form className="lgl-form" onSubmit={save}>
          <label className="wide">
            <span>Título (opcional)</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex.: Procuração ad negotia — João Silva"
            />
          </label>
          <label>
            <span>Outorgante</span>
            <input
              value={form.grantor}
              onChange={(e) => setForm({ ...form, grantor: e.target.value })}
              placeholder="Quem outorga"
            />
          </label>
          <label>
            <span>CPF/CNPJ do outorgante</span>
            <input
              value={form.grantorDocument}
              onChange={(e) => setForm({ ...form, grantorDocument: e.target.value })}
            />
          </label>
          <label>
            <span>Outorgado(a)</span>
            <input
              value={form.attorney}
              onChange={(e) => setForm({ ...form, attorney: e.target.value })}
              placeholder="Quem recebe os poderes"
            />
          </label>
          <label>
            <span>CPF do outorgado</span>
            <input
              value={form.attorneyDocument}
              onChange={(e) => setForm({ ...form, attorneyDocument: e.target.value })}
            />
          </label>
          <label>
            <span>Finalidade / poderes</span>
            <input
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              placeholder="Ex.: Representar em processo trabalhista"
            />
          </label>
          <label>
            <span>Início</span>
            <input
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
            />
          </label>
          <label>
            <span>Validade</span>
            <input
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
          </label>
          <label>
            <span>Situação</span>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="vigente">Vigente</option>
              <option value="revogada">Revogada</option>
              <option value="expirada">Expirada</option>
            </select>
          </label>
          <label>
            <span>Substabelecimento</span>
            <select
              value={form.substabelecimento ? "sim" : "nao"}
              onChange={(e) =>
                setForm({ ...form, substabelecimento: e.target.value === "sim" })
              }
            >
              <option value="nao">Não permite</option>
              <option value="sim">Permite</option>
            </select>
          </label>
          <label>
            <span>Confidencialidade</span>
            <select
              value={form.confidentiality}
              onChange={(e) => setForm({ ...form, confidentiality: e.target.value })}
            >
              {LEGAL_CONFIDENTIALITY.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            <span>Notas</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Observações, poderes específicos, limitações"
            />
          </label>
          <div className="lgl-form-actions" style={{ gridColumn: "1 / -1" }}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setForm(emptyPoa);
              }}
            >
              Cancelar
            </button>
            <button className="primary" type="submit">
              Registrar procuração
            </button>
          </div>
        </form>
      )}

      <div className="lgl-list">
        {list.length === 0 && (
          <div className="lgl-empty">
            <ScrollText size={22} /> Nenhuma procuração cadastrada ainda.
          </div>
        )}
        {list.map((p) => (
          <article key={p.id} className="lgl-card">
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <h3>{p.title}</h3>
                <small>
                  {p.grantor || "Outorgante"} → {p.attorney || "Outorgado"}
                </small>
              </div>
              <div className="lgl-badges">
                <span className={`lgl-chip ${p.status === "vigente" ? "risco-baixo" : "risco-alto"}`}>
                  {p.status === "vigente" ? "Vigente" : p.status === "revogada" ? "Revogada" : "Expirada"}
                </span>
                <ConfidentialityBadge id={p.confidentiality} />
              </div>
            </header>
            {p.purpose && <p>{p.purpose}</p>}
            <div className="lgl-badges">
              {p.effectiveFrom && (
                <span className="lgl-chip">Início: {dataBR(p.effectiveFrom)}</span>
              )}
              {p.expiresAt && p.status === "vigente" && (
                <UrgencyBadge dueDate={p.expiresAt} now={now} />
              )}
              {p.substabelecimento && <span className="lgl-chip">Permite substabelecer</span>}
            </div>
            <footer>
              <small>Atualizada em {new Date(p.updatedAt).toLocaleString("pt-BR")}</small>
              <div className="lgl-actions">
                {p.status === "vigente" && (
                  <button onClick={() => collection.replace(p.id, { status: "revogada" })}>
                    Revogar
                  </button>
                )}
                <button className="danger" onClick={() => collection.remove(p.id)}>
                  <Trash2 size={12} /> Remover
                </button>
              </div>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Prazos e vencimentos
// -----------------------------------------------------------------------

const emptyDeadline = {
  title: "",
  kind: "prazo",
  dueDate: "",
  fatal: false,
  responsibleId: "",
  matterId: "",
  contractId: "",
  processId: "",
  powerOfAttorneyId: "",
  notes: "",
};

function DeadlinesTab({ records, collection, now, setToast }) {
  const [form, setForm] = useState(emptyDeadline);
  const [open, setOpen] = useState(false);

  const list = useMemo(() => {
    return [...(records.deadlines || [])]
      .map((d) => ({ ...d, days: daysUntil(d.dueDate, now) }))
      .sort((a, b) => (a.days ?? 99999) - (b.days ?? 99999));
  }, [records.deadlines, now]);

  const save = (event) => {
    event.preventDefault();
    const err = validateDeadline(form);
    if (err) return setToast?.(err);
    collection.add(createDeadline(form));
    setForm(emptyDeadline);
    setOpen(false);
    setToast?.("Prazo cadastrado.");
  };

  const exportCsv = () => {
    const ok = downloadCsv(exportDeadlinesCsv(list), `juridico-prazos-${new Date().toISOString().slice(0, 10)}.csv`);
    setToast?.(ok ? "CSV exportado." : "Não foi possível exportar o CSV.");
  };

  return (
    <div className="lgl-panel">
      <header className="lgl-actions" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>Prazos e vencimentos</h2>
          <p className="hint">
            Prazos processuais, audiências, renovações e datas fatais — do mais urgente ao mais
            distante.
          </p>
        </div>
        <div className="lgl-actions">
          <button type="button" onClick={exportCsv}>
            <Download size={14} /> Exportar CSV
          </button>
          <button className="primary" onClick={() => setOpen((v) => !v)}>
            <Plus size={14} /> Novo prazo
          </button>
        </div>
      </header>

      {open && (
        <form className="lgl-form" onSubmit={save}>
          <label className="wide">
            <span>Descrição</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex.: Contestação — Processo 001"
            />
          </label>
          <label>
            <span>Tipo</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="prazo">Prazo</option>
              <option value="audiencia">Audiência</option>
              <option value="vencimento">Vencimento</option>
              <option value="recurso">Recurso</option>
              <option value="renovacao">Renovação</option>
            </select>
          </label>
          <label>
            <span>Data</span>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </label>
          <label>
            <span>Fatal?</span>
            <select
              value={form.fatal ? "sim" : "nao"}
              onChange={(e) => setForm({ ...form, fatal: e.target.value === "sim" })}
            >
              <option value="nao">Não</option>
              <option value="sim">Sim — prazo fatal</option>
            </select>
          </label>
          <label>
            <span>Responsável</span>
            <input
              value={form.responsibleId}
              onChange={(e) => setForm({ ...form, responsibleId: e.target.value })}
              placeholder="Id ou nome"
            />
          </label>
          <label>
            <span>Demanda vinculada (id)</span>
            <input
              value={form.matterId}
              onChange={(e) => setForm({ ...form, matterId: e.target.value })}
            />
          </label>
          <label>
            <span>Contrato vinculado (id)</span>
            <input
              value={form.contractId}
              onChange={(e) => setForm({ ...form, contractId: e.target.value })}
            />
          </label>
          <label>
            <span>Processo vinculado (id)</span>
            <input
              value={form.processId}
              onChange={(e) => setForm({ ...form, processId: e.target.value })}
            />
          </label>
          <label className="wide">
            <span>Notas</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Observações, referências, preparo necessário"
            />
          </label>
          <div className="lgl-form-actions" style={{ gridColumn: "1 / -1" }}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setForm(emptyDeadline);
              }}
            >
              Cancelar
            </button>
            <button className="primary" type="submit">
              Registrar prazo
            </button>
          </div>
        </form>
      )}

      <div className="lgl-list">
        {list.length === 0 && (
          <div className="lgl-empty">
            <AlarmClock size={22} /> Nenhum prazo cadastrado.
          </div>
        )}
        {list.map((d) => (
          <article key={d.id} className={`lgl-card ${d.fatal ? "risk-critico" : ""}`}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <h3>{d.title}</h3>
                <small>
                  {d.kind} · {dataBR(d.dueDate)}
                  {d.responsibleId ? ` · ${d.responsibleId}` : ""}
                </small>
              </div>
              <div className="lgl-badges">
                {d.fatal && (
                  <span className="lgl-chip risco-critico">
                    <ShieldAlert size={12} /> Fatal
                  </span>
                )}
                <UrgencyBadge dueDate={d.dueDate} now={now} />
              </div>
            </header>
            {d.notes && <p>{d.notes}</p>}
            <footer>
              <small>
                {d.matterId ? `Demanda ${d.matterId} · ` : ""}
                {d.contractId ? `Contrato ${d.contractId} · ` : ""}
                {d.processId ? `Processo ${d.processId}` : ""}
              </small>
              <div className="lgl-actions">
                <button
                  onClick={() =>
                    collection.replace(d.id, {
                      status: d.status === "cumprido" ? "pendente" : "cumprido",
                    })
                  }
                >
                  {d.status === "cumprido" ? "Reabrir" : "Marcar cumprido"}
                </button>
                <button className="danger" onClick={() => collection.remove(d.id)}>
                  <Trash2 size={12} /> Remover
                </button>
              </div>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Escritórios / advogados externos
// -----------------------------------------------------------------------

const emptyOffice = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
  oab: "",
  document: "",
  specialties: "",
  rate: "",
  active: true,
  notes: "",
};

function OfficesTab({ records, collection, setToast }) {
  const [form, setForm] = useState(emptyOffice);
  const [open, setOpen] = useState(false);

  const list = useMemo(
    () =>
      [...(records.offices || [])].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || "")),
      ),
    [records.offices],
  );

  const save = (event) => {
    event.preventDefault();
    const err = validateOffice(form);
    if (err) return setToast?.(err);
    collection.add(
      createOffice({
        ...form,
        specialties: form.specialties.split(",").map((v) => v.trim()).filter(Boolean),
      }),
    );
    setForm(emptyOffice);
    setOpen(false);
    setToast?.("Escritório cadastrado.");
  };

  return (
    <div className="lgl-panel">
      <header className="lgl-actions" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>Escritórios e advogados externos</h2>
          <p className="hint">Parceiros externos, com especialidades, tarifas e contato.</p>
        </div>
        <button className="primary" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} /> Novo cadastro
        </button>
      </header>

      {open && (
        <form className="lgl-form" onSubmit={save}>
          <label>
            <span>Nome do escritório / advogado</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex.: Silva & Sousa Advogados"
            />
          </label>
          <label>
            <span>Contato</span>
            <input
              value={form.contactName}
              onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              placeholder="Pessoa responsável"
            />
          </label>
          <label>
            <span>E-mail</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            <span>Telefone</span>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label>
            <span>OAB</span>
            <input
              value={form.oab}
              onChange={(e) => setForm({ ...form, oab: e.target.value })}
              placeholder="Ex.: OAB/SP 123.456"
            />
          </label>
          <label>
            <span>CPF/CNPJ</span>
            <input
              value={form.document}
              onChange={(e) => setForm({ ...form, document: e.target.value })}
            />
          </label>
          <label className="wide">
            <span>Especialidades (separadas por vírgula)</span>
            <input
              value={form.specialties}
              onChange={(e) => setForm({ ...form, specialties: e.target.value })}
              placeholder="Trabalhista, Tributário, Cível"
            />
          </label>
          <label>
            <span>Tarifa média (R$/h)</span>
            <input
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
              placeholder="0,00"
              inputMode="decimal"
            />
          </label>
          <label>
            <span>Ativo?</span>
            <select
              value={form.active ? "sim" : "nao"}
              onChange={(e) => setForm({ ...form, active: e.target.value === "sim" })}
            >
              <option value="sim">Ativo</option>
              <option value="nao">Inativo</option>
            </select>
          </label>
          <label className="wide">
            <span>Notas</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <div className="lgl-form-actions" style={{ gridColumn: "1 / -1" }}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setForm(emptyOffice);
              }}
            >
              Cancelar
            </button>
            <button className="primary" type="submit">
              Registrar
            </button>
          </div>
        </form>
      )}

      <div className="lgl-list">
        {list.length === 0 && (
          <div className="lgl-empty">
            <Users size={22} /> Nenhum escritório cadastrado.
          </div>
        )}
        {list.map((o) => (
          <article key={o.id} className="lgl-card">
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <h3>{o.name}</h3>
                <small>
                  {o.contactName || "sem contato"} · {o.oab || "sem OAB"}
                </small>
              </div>
              {!o.active && <span className="lgl-chip">Inativo</span>}
            </header>
            <div className="lgl-badges">
              {o.email && <span className="lgl-chip">{o.email}</span>}
              {o.phone && <span className="lgl-chip">{o.phone}</span>}
              {Number(o.rate) > 0 && (
                <span className="lgl-chip">Tarifa: {formatMoneyBR(o.rate)}/h</span>
              )}
              {(o.specialties || []).map((s) => (
                <span key={s} className="lgl-chip">
                  {s}
                </span>
              ))}
            </div>
            {o.notes && <p>{o.notes}</p>}
            <footer>
              <small>Id: {o.id}</small>
              <div className="lgl-actions">
                <button onClick={() => collection.replace(o.id, { active: !o.active })}>
                  {o.active ? "Desativar" : "Ativar"}
                </button>
                <button className="danger" onClick={() => collection.remove(o.id)}>
                  <Trash2 size={12} /> Remover
                </button>
              </div>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Honorários, custas e provisões
// -----------------------------------------------------------------------

const emptyFee = {
  title: "",
  kind: "honorario",
  amount: "",
  dueDate: "",
  paid: false,
  officeId: "",
  matterId: "",
  contractId: "",
  processId: "",
  notes: "",
};

function FeesTab({ records, collection, now, setToast }) {
  const [form, setForm] = useState(emptyFee);
  const [open, setOpen] = useState(false);

  const list = useMemo(() => {
    return [...(records.fees || [])].sort((a, b) =>
      String(a.dueDate || "").localeCompare(String(b.dueDate || "")),
    );
  }, [records.fees]);

  const totals = useMemo(() => {
    const open = list.filter((f) => !f.paid);
    return {
      openCount: open.length,
      openAmount: open.reduce((s, f) => s + Number(f.amount || 0), 0),
      paidAmount: list.filter((f) => f.paid).reduce((s, f) => s + Number(f.amount || 0), 0),
    };
  }, [list]);

  const save = (event) => {
    event.preventDefault();
    const err = validateFee(form);
    if (err) return setToast?.(err);
    collection.add(createFee(form));
    setForm(emptyFee);
    setOpen(false);
    setToast?.("Lançamento registrado.");
  };

  return (
    <div className="lgl-panel">
      <header className="lgl-actions" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>Honorários, custas e provisões</h2>
          <p className="hint">
            Lançamentos do Jurídico com vencimento, pagamento e vínculo com escritório ou processo.
          </p>
        </div>
        <button className="primary" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} /> Novo lançamento
        </button>
      </header>

      <div className="lgl-metrics">
        <article>
          <small>Em aberto</small>
          <strong>{totals.openCount}</strong>
        </article>
        <article className={totals.openAmount > 0 ? "warn" : ""}>
          <small>Valor em aberto</small>
          <strong>{formatMoneyBR(totals.openAmount)}</strong>
        </article>
        <article>
          <small>Pago</small>
          <strong>{formatMoneyBR(totals.paidAmount)}</strong>
        </article>
      </div>

      {open && (
        <form className="lgl-form" onSubmit={save}>
          <label className="wide">
            <span>Descrição</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex.: Honorários — Fase 1"
            />
          </label>
          <label>
            <span>Tipo</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="honorario">Honorário</option>
              <option value="custa">Custa processual</option>
              <option value="provisao">Provisão</option>
              <option value="reembolso">Reembolso</option>
              <option value="outro">Outro</option>
            </select>
          </label>
          <label>
            <span>Valor (R$)</span>
            <input
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0,00"
              inputMode="decimal"
            />
          </label>
          <label>
            <span>Vencimento</span>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </label>
          <label>
            <span>Pago?</span>
            <select
              value={form.paid ? "sim" : "nao"}
              onChange={(e) => setForm({ ...form, paid: e.target.value === "sim" })}
            >
              <option value="nao">Não</option>
              <option value="sim">Sim</option>
            </select>
          </label>
          <label>
            <span>Escritório (id)</span>
            <input
              value={form.officeId}
              onChange={(e) => setForm({ ...form, officeId: e.target.value })}
            />
          </label>
          <label>
            <span>Demanda (id)</span>
            <input
              value={form.matterId}
              onChange={(e) => setForm({ ...form, matterId: e.target.value })}
            />
          </label>
          <label>
            <span>Contrato (id)</span>
            <input
              value={form.contractId}
              onChange={(e) => setForm({ ...form, contractId: e.target.value })}
            />
          </label>
          <label>
            <span>Processo (id)</span>
            <input
              value={form.processId}
              onChange={(e) => setForm({ ...form, processId: e.target.value })}
            />
          </label>
          <label className="wide">
            <span>Notas</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <div className="lgl-form-actions" style={{ gridColumn: "1 / -1" }}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setForm(emptyFee);
              }}
            >
              Cancelar
            </button>
            <button className="primary" type="submit">
              Registrar
            </button>
          </div>
        </form>
      )}

      <div className="lgl-list">
        {list.length === 0 && (
          <div className="lgl-empty">
            <Handshake size={22} /> Nenhum lançamento ainda.
          </div>
        )}
        {list.map((f) => (
          <article key={f.id} className="lgl-card">
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <h3>{f.title}</h3>
                <small>
                  {f.kind} · {formatMoneyBR(f.amount)} · Vence {dataBR(f.dueDate)}
                </small>
              </div>
              <div className="lgl-badges">
                {f.paid ? (
                  <span className="lgl-chip risco-baixo">Pago</span>
                ) : (
                  <UrgencyBadge dueDate={f.dueDate} now={now} />
                )}
              </div>
            </header>
            {f.notes && <p>{f.notes}</p>}
            <footer>
              <small>
                {f.officeId ? `Escritório ${f.officeId} · ` : ""}
                {f.matterId ? `Demanda ${f.matterId} · ` : ""}
                {f.contractId ? `Contrato ${f.contractId} · ` : ""}
                {f.processId ? `Processo ${f.processId}` : ""}
              </small>
              <div className="lgl-actions">
                <button
                  onClick={() =>
                    collection.replace(f.id, {
                      paid: !f.paid,
                      paidAt: !f.paid ? new Date().toISOString().slice(0, 10) : "",
                    })
                  }
                >
                  {f.paid ? "Marcar em aberto" : "Marcar como pago"}
                </button>
                <button className="danger" onClick={() => collection.remove(f.id)}>
                  <Trash2 size={12} /> Remover
                </button>
              </div>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Compliance / due diligence
// -----------------------------------------------------------------------

function ComplianceTab({ records, update, setToast }) {
  const checks = records.compliance || [];
  const [form, setForm] = useState({ category: "societaria", title: "", status: "pendente", notes: "" });

  const addCheck = (event) => {
    event.preventDefault();
    if (!form.title.trim()) return setToast?.("Informe o item de conformidade.");
    update((prev) => ({
      ...prev,
      legalCompliance: [
        ...(prev?.legalCompliance || []),
        {
          id: crypto?.randomUUID?.() || `c-${Math.random().toString(36).slice(2)}`,
          category: form.category,
          title: form.title.trim(),
          status: form.status,
          notes: form.notes,
          updatedAt: new Date().toISOString(),
        },
      ],
    }));
    setForm({ category: form.category, title: "", status: "pendente", notes: "" });
    setToast?.("Item de conformidade registrado.");
  };

  const updateStatus = (id, status) =>
    update((prev) => ({
      ...prev,
      legalCompliance: (prev?.legalCompliance || []).map((c) =>
        c.id === id ? { ...c, status, updatedAt: new Date().toISOString() } : c,
      ),
    }));

  const remove = (id) =>
    update((prev) => ({
      ...prev,
      legalCompliance: (prev?.legalCompliance || []).filter((c) => c.id !== id),
    }));

  const score = complianceScore(checks);
  const gaps = complianceGaps(checks);

  return (
    <div className="lgl-panel">
      <header>
        <h2>Compliance e due diligence</h2>
        <p className="hint">
          Checklists por categoria, com situação por item. O escore ignora &ldquo;não
          aplicáveis&rdquo; e nunca reporta &ldquo;0%&rdquo; quando nada foi cadastrado ainda.
        </p>
      </header>

      <div className="lgl-metrics">
        <article>
          <small>Itens registrados</small>
          <strong>{checks.length}</strong>
        </article>
        <article className={gaps.length > 0 ? "warn" : ""}>
          <small>Pendências / não conformes</small>
          <strong>{gaps.length}</strong>
        </article>
        <article className={score === null ? "" : score < 0.6 ? "warn" : "ok"}>
          <small>Escore</small>
          <strong>{score === null ? "—" : `${Math.round(score * 100)}%`}</strong>
        </article>
      </div>

      <form className="lgl-form" onSubmit={addCheck}>
        <label>
          <span>Categoria</span>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {DUE_DILIGENCE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          <span>Item</span>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Ex.: Certidão negativa federal atualizada"
          />
        </label>
        <label>
          <span>Situação</span>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {CHECK_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          <span>Notas</span>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>
        <div className="lgl-form-actions" style={{ gridColumn: "1 / -1" }}>
          <button className="primary" type="submit">
            Adicionar item
          </button>
        </div>
      </form>

      <div className="lgl-list">
        {checks.length === 0 && (
          <div className="lgl-empty">
            <ShieldCheck size={22} /> Nenhum item de conformidade ainda.
          </div>
        )}
        {DUE_DILIGENCE_CATEGORIES.map((cat) => {
          const catChecks = checks.filter((c) => c.category === cat.id);
          if (catChecks.length === 0) return null;
          return (
            <section key={cat.id} className="lgl-card">
              <h3>{cat.label}</h3>
              {catChecks.map((c) => (
                <article
                  key={c.id}
                  className="lgl-card"
                  style={{ background: "transparent", border: "none", padding: 4 }}
                >
                  <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{c.title}</span>
                    <select value={c.status} onChange={(e) => updateStatus(c.id, e.target.value)}>
                      {CHECK_STATUSES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </header>
                  {c.notes && <p>{c.notes}</p>}
                  <footer style={{ justifyContent: "flex-end" }}>
                    <button className="danger" onClick={() => remove(c.id)}>
                      <Trash2 size={12} /> Remover
                    </button>
                  </footer>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Modelos (templates)
// -----------------------------------------------------------------------

function TemplatesTab({ setToast, saveAsDocument }) {
  const [selectedId, setSelectedId] = useState(LEGAL_TEMPLATES[0]?.id || null);
  const template = LEGAL_TEMPLATES.find((t) => t.id === selectedId) || LEGAL_TEMPLATES[0];
  const fields = useMemo(() => legalTemplateFields(template?.body || ""), [template]);
  const [context, setContext] = useState({});

  const filled = useMemo(() => fillLegalTemplate(template?.body || "", context), [
    template,
    context,
  ]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(filled);
      setToast?.("Modelo copiado para a área de transferência.");
    } catch {
      setToast?.("Não foi possível copiar. Copie o texto manualmente.");
    }
  };

  const saveDoc = () => {
    if (!template) return;
    saveAsDocument?.(templateToDocument(template, context));
    setToast?.("Modelo salvo em Documentos.");
  };

  return (
    <div className="lgl-panel">
      <header>
        <h2>Modelos de contratos, termos, notificações e documentos</h2>
        <p className="hint">
          Ponto de partida versionado. Cada modelo destaca os placeholders <code>{"{{campo}}"}</code>{" "}
          — preencha à direita e copie o texto pronto. Modelos exigem revisão do responsável jurídico
          antes da assinatura.
        </p>
      </header>

      <div className="lgl-template-list">
        {LEGAL_TEMPLATES.map((t) => (
          <button
            key={t.id}
            className="lgl-template-card"
            onClick={() => {
              setSelectedId(t.id);
              setContext({});
            }}
          >
            <strong>{t.label}</strong>
            <small>{t.kind}</small>
          </button>
        ))}
      </div>

      {template && (
        <>
          <div className="lgl-form">
            {fields.map((field) => (
              <label key={field}>
                <span>{field}</span>
                <input
                  value={context[field] || ""}
                  onChange={(e) => setContext({ ...context, [field]: e.target.value })}
                  placeholder={`Preencher ${field}`}
                />
              </label>
            ))}
          </div>
          <div className="lgl-template-preview">{filled}</div>
          <div className="lgl-actions">
            <button className="primary" onClick={copy}>
              <Copy size={14} /> Copiar texto
            </button>
            {saveAsDocument && (
              <button onClick={saveDoc}>
                <FilePlus size={14} /> Salvar em Documentos
              </button>
            )}
          </div>
          <p className="lgl-notice">
            <ShieldAlert size={13} /> Este modelo NÃO constitui aconselhamento jurídico e exige
            revisão do Jurídico antes do uso oficial.
          </p>
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// IA jurídica
// -----------------------------------------------------------------------

function AiTab({ authHeaders, setToast }) {
  const [mode, setMode] = useState("resumo");
  const [text, setText] = useState("");
  const [textB, setTextB] = useState("");
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState("");
  const [parsed, setParsed] = useState(null);

  const run = async () => {
    if (!text.trim()) return setToast?.("Cole o texto do documento para analisar.");
    setBusy(true);
    setResponse("");
    setParsed(null);
    try {
      const prompt = buildLegalAiPrompt(mode, { text, textA: text, textB });
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({ specialist: "Advogado", messages: [{ role: "user", content: prompt }] }),
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(p?.error || "Não foi possível chamar a IA agora.");
      const content = p?.reply || p?.content || p?.message || "";
      setResponse(content);
      if (mode !== "resumo") setParsed(parseLegalAiResponse(mode, content));
    } catch (err) {
      setToast?.(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lgl-panel">
      <header>
        <h2>IA jurídica</h2>
        <p className="hint">
          Resumo, comparação, identificação de cláusulas e extração de prazos, com regras rígidas
          contra invenção. A IA trabalha só com o texto colado — não navega, não consulta processos.
        </p>
      </header>
      <div className="lgl-tabs">
        {[
          ["resumo", "Resumo do documento"],
          ["comparar", "Comparar dois documentos"],
          ["clausulas", "Identificar cláusulas"],
          ["prazos", "Extrair prazos"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={mode === id ? "active" : ""}
            onClick={() => {
              setMode(id);
              setResponse("");
              setParsed(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="wide">
        <span>{mode === "comparar" ? "Documento A" : "Texto do documento"}</span>
        <textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Cole aqui o texto do contrato, parecer ou notificação"
        />
      </label>
      {mode === "comparar" && (
        <label className="wide">
          <span>Documento B</span>
          <textarea
            rows={10}
            value={textB}
            onChange={(e) => setTextB(e.target.value)}
            placeholder="Cole aqui o segundo documento para comparação"
          />
        </label>
      )}
      <div className="lgl-actions">
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? "Consultando IA..." : "Rodar análise"}
        </button>
      </div>

      {response && (
        <div className="lgl-template-preview">{response}</div>
      )}
      {parsed && (mode === "clausulas") && (
        <div className="lgl-list">
          {(parsed.clauses || []).map((c, i) => (
            <article key={i} className="lgl-card">
              <h3>{c.titulo || c.title || `Cláusula ${i + 1}`}</h3>
              {c.resumo || c.summary ? <p>{c.resumo || c.summary}</p> : null}
              {Array.isArray(c.riscos) && c.riscos.length > 0 && (
                <div className="lgl-badges">
                  {c.riscos.map((r, j) => (
                    <span key={j} className="lgl-chip risco-alto">
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {parsed && (mode === "prazos") && (
        <div className="lgl-list">
          {(parsed.deadlines || []).map((d, i) => (
            <article key={i} className="lgl-card">
              <h3>{d.o_que || d.what || `Prazo ${i + 1}`}</h3>
              <p>
                {d.quando || d.when || ""} {d.trecho ? `— "${d.trecho}"` : ""}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Busca centralizada
// -----------------------------------------------------------------------

function SearchTab({ records, viewer }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchLegal(records, query, viewer), [records, query, viewer]);

  return (
    <div className="lgl-panel">
      <header>
        <h2>Busca centralizada</h2>
        <p className="hint">
          Pesquise por empresa, pessoa, contrato, processo, demanda, procuração ou escritório —
          respeitando a confidencialidade que você tem acesso.
        </p>
      </header>
      <div className="lgl-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Digite o termo (contraparte, CPF, número, palavra-chave)"
        />
        {query && results.length === 0 && (
          <div className="lgl-empty">
            <FileSearch size={22} /> Nenhum resultado.
          </div>
        )}
        <div className="lgl-list">
          {results.map((r) => (
            <article key={`${r.kind}-${r.id}`} className="lgl-card">
              <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <span className="result-kind">{r.kind}</span>
                  <h3>{r.title}</h3>
                </div>
                <small>Score {r.score}</small>
              </header>
              {r.record?.notes && <p>{r.record.notes}</p>}
              {r.record?.confidentiality && (
                <div className="lgl-badges">
                  <ConfidentialityBadge id={r.record.confidentiality} />
                  {r.record?.risk && <RiskBadge id={r.record.risk} />}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Relatórios
// -----------------------------------------------------------------------

function ReportsTab({ records, now }) {
  const reports = useMemo(() => legalReports(records, now), [records, now]);
  const { dashboard, contractsSigned30, matterAverageAgeDays, processWinRate } = reports;

  return (
    <div className="lgl-panel">
      <header>
        <h2>Relatórios e indicadores do Jurídico</h2>
        <p className="hint">
          Números derivados dos registros — não gravamos &ldquo;meta&rdquo; que ninguém definiu, e
          &ldquo;—&rdquo; significa &ldquo;sem dado suficiente&rdquo; (não zero).
        </p>
      </header>
      <div className="lgl-metrics">
        <article>
          <small>Contratos assinados nos últimos 30 dias</small>
          <strong>{contractsSigned30}</strong>
        </article>
        <article>
          <small>Idade média das demandas abertas</small>
          <strong>{matterAverageAgeDays === null ? "—" : `${matterAverageAgeDays} d`}</strong>
        </article>
        <article className={processWinRate !== null && processWinRate < 0.5 ? "warn" : ""}>
          <small>Taxa de vitória em processos decididos</small>
          <strong>
            {processWinRate === null ? "—" : `${Math.round(processWinRate * 100)}%`}
          </strong>
        </article>
        <article>
          <small>Contratos com vigência em 90 dias</small>
          <strong>{dashboard.expiringContracts.length}</strong>
        </article>
        <article>
          <small>Procurações vencendo em 60 dias</small>
          <strong>{dashboard.expiringPowersOfAttorney.length}</strong>
        </article>
        <article>
          <small>Exposição financeira total</small>
          <strong>{formatMoneyBR(dashboard.exposure.total)}</strong>
        </article>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Componente raiz
// -----------------------------------------------------------------------

export default function LegalHub({
  db,
  update,
  setToast,
  authHeaders,
  business,
  viewer,
  now: nowProp,
  pushNotification,
  // Quando `true`, força a UI a considerar o Jurídico canônico do TDG mesmo
  // que a detecção pelo `db` falhe — a `LogisticsVertical` monta a UI aqui
  // já sabendo que está no ERP e o backend responde `/api/todogreen/records/legal`.
  tdgAvailable: tdgForced,
}) {
  const legalStaff = isLegalStaff(viewer || {});
  const defaultTab = legalStaff ? "dashboard" : "solicitar";
  const [tab, setTab] = useState(defaultTab);
  const [nowFallback] = useState(() => Date.now());
  const now = typeof nowProp === "number" ? nowProp : nowFallback;
  const baseRecords = useMemo(() => readonlyLegal(db), [db]);
  // Quando o TDG está disponível (detectado ou forçado pela vertical), os
  // contratos são LIDOS do backend TDG (via hook `useTdgLegalRecords`) — o
  // blob não é mais fonte da verdade aqui, para não haver "dois Jurídicos"
  // divergentes.
  const records = useMemo(
    () => ({
      ...baseRecords,
      contracts: tdgLegal ? tdgLegalRecords.records : baseRecords.contracts,
    }),
    [baseRecords, tdgLegal, tdgLegalRecords.records],
  );

  // Duas visões: a "staff" enxerga tudo conforme confidencialidade; o
  // solicitante enxerga só as próprias submissões via `canAccessRequest`.
  const scoped = useMemo(() => {
    if (legalStaff) {
      return {
        ...records,
        matters: records.matters.filter((r) => canRead(r, viewer || {})),
        contracts: records.contracts.filter((r) => canRead(r, viewer || {})),
        processes: records.processes.filter((r) => canRead(r, viewer || {})),
        powersOfAttorney: records.powersOfAttorney.filter((r) => canRead(r, viewer || {})),
      };
    }
    return {
      ...records,
      matters: filterOwnOrLegal(records.matters, viewer || {}),
      contracts: [],
      processes: [],
      powersOfAttorney: [],
      deadlines: [],
      fees: [],
    };
  }, [records, viewer, legalStaff]);

  const matters = useCollection(update, "legalMatters");
  const blobContracts = useCollection(update, "legalContracts");
  const processes = useCollection(update, "legalProcesses");
  // JURÍDICO CANÔNICO: quando o espaço tem acesso à vertical To Do Green, os
  // CONTRATOS deixam de viver no blob e passam a viver em `todogreen_legal_records`
  // (D1) — a mesma tabela que os gates operacionais do backend leem
  // (`juridicoConcluido`, `documentoDeAssinaturaVinculado`). Sem isso, um
  // contrato aprovado na UI nova jamais destravaria a proposta. O ERP monta
  // essa UI já sabendo do TDG (`tdgForced`); fora do ERP a detecção fica com
  // `isTdgLegalAvailable(db)`.
  const tdgLegal = Boolean(tdgForced) || isTdgLegalAvailable(db);
  const tdgLegalRecords = useTdgLegalRecords({
    authHeaders,
    enabled: tdgLegal,
    setToast,
  });
  const contracts = tdgLegal
    ? {
        add: (record) =>
          tdgLegalRecords.add(record).catch((err) => setToast?.(err.message)),
        replace: (id, patch) =>
          tdgLegalRecords
            .replace(id, patch)
            .catch((err) => setToast?.(err.message)),
        remove: (id) =>
          tdgLegalRecords.remove(id).catch((err) => setToast?.(err.message)),
      }
    : blobContracts;
  const powersOfAttorney = useCollection(update, "legalPowersOfAttorney");
  const deadlines = useCollection(update, "legalDeadlines");
  const offices = useCollection(update, "legalOffices");
  const fees = useCollection(update, "legalFees");

  const linkedEntities = useLinkedEntities(db);

  // Salvar template como documento reaproveita a coleção `documents` já
  // existente; o módulo Documentos já sabe listar, editar, exportar e assinar.
  const saveAsDocument = useMemo(() => {
    if (!update) return null;
    return (doc) =>
      update((prev) => ({
        ...prev,
        documents: [
          {
            id: crypto?.randomUUID?.() || `d-${Math.random().toString(36).slice(2)}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ownerId: viewer?.userId || null,
            ...doc,
          },
          ...(prev?.documents || []),
        ],
      }));
  }, [update, viewer?.userId]);

  // Alertas viram notificações in-app, deduplicadas por id. Só empurra
  // notificações NOVAS (id ainda não presente em `db.notifications`).
  // Reaproveita o mesmo `pushNotification` que o restante do app usa.
  const seenAlertIdsRef = useRef(new Set());
  const legalNotifications = useMemo(
    () => (legalStaff ? buildLegalNotifications(scoped, viewer, now) : []),
    [legalStaff, scoped, viewer, now],
  );
  // Chave estável para o useEffect: os ids dos alertas atuais concatenados.
  // Sem isso o efeito rodaria em toda renderização e o React reclamaria da
  // dependência calculada inline.
  const legalNotificationsKey = legalNotifications.map((n) => n.id).join("|");
  useEffect(() => {
    if (!legalStaff || !pushNotification || !update || !viewer?.userId) return;
    const existing = new Set((db?.notifications || []).map((n) => n.id));
    const fresh = legalNotifications.filter(
      (n) => n.recipientId && !existing.has(n.id) && !seenAlertIdsRef.current.has(n.id),
    );
    if (fresh.length === 0) return;
    fresh.forEach((n) => seenAlertIdsRef.current.add(n.id));
    update((prev) => ({
      ...prev,
      notifications: fresh.reduce(
        (list, n) =>
          pushNotification(list, {
            recipientId: n.recipientId,
            message: n.message,
            link: n.link,
            createdBy: viewer.userId,
          }),
        prev?.notifications || [],
      ),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legalStaff, viewer?.userId, legalNotificationsKey]);

  const alertsCount = useMemo(() => legalAlerts(scoped, now).length, [scoped, now]);

  return (
    <div className="legal-hub">
      <header className="lgl-header">
        <div>
          <span className="lgl-eyebrow">Jurídico</span>
          <h1>Central Jurídica</h1>
          <p>
            {legalStaff
              ? "Demandas, contratos, processos, prazos, procurações, compliance e exposição financeira num só lugar. Modelos, fluxo de aprovação e alertas — tudo integrado aos contatos, contratos e áreas do negócio."
              : "Peça uma análise ao Jurídico, acompanhe suas solicitações e use os modelos de documentos. A fila completa do Jurídico é vista só pela equipe da área."}
          </p>
        </div>
        <div className="lgl-badges">
          {legalStaff && (
            <span className="lgl-chip">
              <Bell size={13} />
              {alertsCount} alertas
            </span>
          )}
          {tdgLegal && (
            <span
              className="lgl-chip"
              title="Contratos e minutas gravam no Jurídico canônico da To Do Green (D1) — os gates operacionais (juridicoConcluido, documentoDeAssinaturaVinculado) leem daqui."
            >
              <ShieldCheck size={13} /> Jurídico canônico TDG
            </span>
          )}
          <span className="lgl-chip">
            <Building2 size={13} />
            {business?.name || "Negócio"}
          </span>
        </div>
      </header>

      <nav className="lgl-tabs" aria-label="Seções do Jurídico">
        {TABS.filter((t) => legalStaff || t.forAll).map(({ id, label, icon: Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </nav>

      {tab === "solicitar" && (
        <RequestTab
          collection={matters}
          setToast={setToast}
          viewer={viewer || {}}
          allRecords={records}
        />
      )}
      {tab === "minhas" && (
        <MyRequestsTab records={records} viewer={viewer || {}} now={now} />
      )}
      {tab === "dashboard" && legalStaff && <DashboardTab records={scoped} now={now} />}
      {tab === "demandas" && legalStaff && (
        <MattersTab
          records={scoped}
          collection={matters}
          now={now}
          setToast={setToast}
          linkedEntities={linkedEntities}
          offices={scoped.offices}
          viewer={viewer || {}}
        />
      )}
      {tab === "contratos" && legalStaff && (
        <ContractsTab
          records={scoped}
          collection={contracts}
          now={now}
          setToast={setToast}
          viewer={viewer || {}}
        />
      )}
      {tab === "processos" && legalStaff && (
        <ProcessesTab
          records={scoped}
          collection={processes}
          now={now}
          setToast={setToast}
          viewer={viewer || {}}
        />
      )}
      {tab === "procuracoes" && legalStaff && (
        <PowersOfAttorneyTab
          records={scoped}
          collection={powersOfAttorney}
          now={now}
          setToast={setToast}
        />
      )}
      {tab === "prazos" && legalStaff && (
        <DeadlinesTab records={scoped} collection={deadlines} now={now} setToast={setToast} />
      )}
      {tab === "escritorios" && legalStaff && (
        <OfficesTab records={records} collection={offices} setToast={setToast} />
      )}
      {tab === "honorarios" && legalStaff && (
        <FeesTab records={records} collection={fees} now={now} setToast={setToast} />
      )}
      {tab === "compliance" && legalStaff && (
        <ComplianceTab records={records} update={update} setToast={setToast} />
      )}
      {tab === "modelos" && (
        <TemplatesTab setToast={setToast} saveAsDocument={saveAsDocument} />
      )}
      {tab === "ia" && <AiTab authHeaders={authHeaders} setToast={setToast} />}
      {tab === "busca" && <SearchTab records={records} viewer={viewer || {}} />}
      {tab === "relatorios" && legalStaff && <ReportsTab records={scoped} now={now} />}
    </div>
  );
}
