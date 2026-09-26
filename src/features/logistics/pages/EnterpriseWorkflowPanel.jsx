import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, Plus, RefreshCw, ShieldCheck, X } from "lucide-react";
import { authHeaders } from "../../../session/armazenamento.js";
import Modal from "../../../components/Modal.jsx";
import AnexosContexto from "./AnexosContexto.jsx";
import {
  alternarPonto,
  normalizarPontos,
  outroLado,
  pontosDeTexto,
  resumoDosPontos,
  rotuloDoLado,
} from "../contratoNegociacaoDomain.js";
// Sem este import, os estilos do vaivém só existem se outra página lazy já
// tiver sido visitada na sessão — a mesma armadilha documentada do DealDesk.
import "./TodoGreenPages.css";

const DOMAIN = {
  legal: {
    kicker: "JURÍDICO OPERACIONAL",
    title: "Contratos, minutas e aprovações",
    description: "Controle de minuta, origem do documento, versão, revisão jurídica, aprovação do negócio, assinatura e aditivos.",
    kinds: [["contract", "Contrato"], ["amendment", "Aditivo"], ["nda", "NDA / confidencialidade"], ["legal-review", "Revisão jurídica"]],
  },
  quality: {
    kicker: "QUALIDADE OPERACIONAL",
    title: "Não conformidades, auditorias e CAPA",
    description: "Registre causa raiz, correção, prevenção, responsável, prazo e validação de encerramento.",
    kinds: [["nonconformity", "Não conformidade"], ["capa", "CAPA"], ["audit", "Auditoria"], ["improvement", "Melhoria contínua"]],
  },
  marketing: {
    kicker: "MARKETING OPERACIONAL",
    title: "Campanhas, aprovações e resultado",
    description: "Briefing, orçamento, canais, calendário, aprovação, leads e receita atribuída no mesmo fluxo.",
    kinds: [["campaign", "Campanha"], ["event", "Evento"], ["content", "Conteúdo"], ["commercial-material", "Material comercial"]],
  },
};

const STATUS = {
  draft: "Rascunho", pending: "Aguardando aprovação", approved: "Aprovado",
  rejected: "Recusado", in_progress: "Em andamento", blocked: "Bloqueado",
  done: "Concluído", cancelled: "Cancelado",
};
const PRIORITY = { low: "Baixa", normal: "Normal", high: "Alta", critical: "Crítica" };
const empty = (domain) => ({
  title: "", description: "", kind: DOMAIN[domain]?.kinds?.[0]?.[0] || "",
  priority: "normal", dueAt: "", clientId: "", clientName: "",
  recurrenceEnabled: false, recurrenceFrequency: "monthly", recurrenceInterval: 1,
  data: domain === "legal"
    ? { documentOwner: "client", version: "1", signatureStatus: "pending", externalUrl: "", risk: "", bola: "juridico", pontosTexto: "" }
    : domain === "quality"
      ? { severity: "medium", rootCause: "", correctiveAction: "", preventiveAction: "", operationReference: "", evidence: "" }
      : { objective: "", audience: "", channel: "", budget: "", startAt: "", endAt: "", expectedLeads: "", actualLeads: "", attributedRevenue: "" },
});

const api = async (path, options = {}) => {
  const response = await fetch(`/api/todogreen/enterprise-workflows${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...authHeaders(), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Não foi possível concluir a ação.");
  return body;
};
const date = (value) => value ? new Date(value).toLocaleDateString("pt-BR") : "Sem prazo";
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function DomainFields({ domain, form, setForm }) {
  const setData = (key, value) => setForm((current) => ({ ...current, data: { ...current.data, [key]: value } }));
  if (domain === "legal") return <>
    <label><span>Origem do documento</span><select value={form.data.documentOwner} onChange={(e) => setData("documentOwner", e.target.value)}><option value="client">Documento do cliente / referência externa</option><option value="company">Documento da To Do Green / arquivo interno</option></select></label>
    <label><span>Versão</span><input value={form.data.version} onChange={(e) => setData("version", e.target.value)} /></label>
    <label><span>Assinatura</span><select value={form.data.signatureStatus} onChange={(e) => setData("signatureStatus", e.target.value)}><option value="pending">Pendente</option><option value="sent">Enviado para assinatura</option><option value="signed">Assinado</option><option value="expired">Expirado</option></select></label>
    <label><span>Com quem está agora</span><select value={form.data.bola || "juridico"} onChange={(e) => setData("bola", e.target.value)}><option value="juridico">Jurídico — analisando</option><option value="comercial">Comercial — alinhando com o cliente</option></select></label>
    <label><span>Link do cliente, se houver</span><input type="url" value={form.data.externalUrl} onChange={(e) => setData("externalUrl", e.target.value)} placeholder="https://..." /></label>
    <label className="full"><span>Pontos de discordância (um por linha)</span><textarea value={form.data.pontosTexto || ""} onChange={(e) => setData("pontosTexto", e.target.value)} placeholder={"Multa por rescisão antecipada\nPrazo de pagamento 60 dias"} /></label>
    <label className="full"><span>Risco / ressalvas jurídicas</span><textarea value={form.data.risk} onChange={(e) => setData("risk", e.target.value)} /></label>
  </>;
  if (domain === "quality") return <>
    <label><span>Gravidade</span><select value={form.data.severity} onChange={(e) => setData("severity", e.target.value)}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label>
    <label><span>Operação / referência</span><input value={form.data.operationReference} onChange={(e) => setData("operationReference", e.target.value)} /></label>
    <label className="full"><span>Causa raiz</span><textarea value={form.data.rootCause} onChange={(e) => setData("rootCause", e.target.value)} /></label>
    <label className="full"><span>Ação corretiva</span><textarea value={form.data.correctiveAction} onChange={(e) => setData("correctiveAction", e.target.value)} /></label>
    <label className="full"><span>Ação preventiva</span><textarea value={form.data.preventiveAction} onChange={(e) => setData("preventiveAction", e.target.value)} /></label>
    <label className="full"><span>Evidência</span><input value={form.data.evidence} onChange={(e) => setData("evidence", e.target.value)} placeholder="Link, número do documento ou descrição da evidência" /></label>
  </>;
  return <>
    <label><span>Objetivo</span><input value={form.data.objective} onChange={(e) => setData("objective", e.target.value)} /></label>
    <label><span>Público / segmento</span><input value={form.data.audience} onChange={(e) => setData("audience", e.target.value)} /></label>
    <label><span>Canal</span><input value={form.data.channel} onChange={(e) => setData("channel", e.target.value)} placeholder="LinkedIn, evento, ABM..." /></label>
    <label><span>Orçamento R$</span><input type="number" min="0" step="0.01" value={form.data.budget} onChange={(e) => setData("budget", e.target.value)} /></label>
    <label><span>Início</span><input type="date" value={form.data.startAt} onChange={(e) => setData("startAt", e.target.value)} /></label>
    <label><span>Fim</span><input type="date" value={form.data.endAt} onChange={(e) => setData("endAt", e.target.value)} /></label>
    <label><span>Leads esperados</span><input type="number" min="0" value={form.data.expectedLeads} onChange={(e) => setData("expectedLeads", e.target.value)} /></label>
    <label><span>Leads realizados</span><input type="number" min="0" value={form.data.actualLeads} onChange={(e) => setData("actualLeads", e.target.value)} /></label>
    <label><span>Receita atribuída R$</span><input type="number" min="0" step="0.01" value={form.data.attributedRevenue} onChange={(e) => setData("attributedRevenue", e.target.value)} /></label>
  </>;
}

const DECISAO_ROTULO = { approved: "aprovado", rejected: "recusado", ressalva: "com ressalva" };

function Card({ item, domain, reload, setToast }) {
  const [busy, setBusy] = useState(false);
  const [ressalvaAberta, setRessalvaAberta] = useState(false);
  const [ressalvaNota, setRessalvaNota] = useState("");
  const decide = async (decision, note = "") => {
    if (decision === "ressalva" && !note.trim()) { setToast?.("Descreva a ressalva antes de confirmar."); return; }
    setBusy(true);
    try {
      await api(`/${item.id}/decision`, { method: "POST", body: JSON.stringify({ decision, note }) });
      setRessalvaAberta(false); setRessalvaNota("");
      await reload();
    }
    catch (error) { setToast?.(error.message); }
    finally { setBusy(false); }
  };
  const updateStatus = async (status) => {
    setBusy(true);
    try { await api(`/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, status }) }); await reload(); }
    catch (error) { setToast?.(error.message); }
    finally { setBusy(false); }
  };
  // O PATCH de data é merge raso no servidor: mandar só {pontos} ou {bola}
  // preserva o resto do payload do domínio.
  const saveData = async (data) => {
    setBusy(true);
    try { await api(`/${item.id}`, { method: "PATCH", body: JSON.stringify({ revision: item.revision, data }) }); await reload(); }
    catch (error) { setToast?.(error.message); }
    finally { setBusy(false); }
  };
  const pontos = domain === "legal" ? normalizarPontos(item.data?.pontos) : [];
  const resumoPontos = resumoDosPontos(pontos);
  const extra = domain === "marketing"
    ? `${money(item.data?.budget)} orçamento · ${Number(item.data?.actualLeads || 0)} lead(s) · ${money(item.data?.attributedRevenue)} receita atribuída`
    : domain === "quality"
      ? `${item.data?.severity || "sem gravidade"} · ${item.data?.operationReference || "sem operação vinculada"}`
      : `${item.data?.documentOwner === "company" ? "Documento To Do Green" : "Documento do cliente"} · versão ${item.data?.version || "—"} · assinatura ${item.data?.signatureStatus || "pendente"}`;
  return <article className="tdg-panel tdg-workflow-card">
    <header className="tdg-section-head"><div><span className="tdg-kicker">{DOMAIN[domain]?.kinds.find(([id]) => id === item.kind)?.[1] || item.kind}</span><h3>{item.title}</h3><p>{item.description || extra}</p></div><strong>{STATUS[item.status] || item.status}</strong></header>
    <div className="tdg-workflow-meta"><span><Clock3 size={14} />{date(item.dueAt)}</span><span>Prioridade {PRIORITY[item.priority] || item.priority}</span>{item.data?.clientName ? <span>{item.data.clientName}</span> : null}<span>{extra}</span></div>
    {domain === "legal" && pontos.length > 0 && (
      <div className="tdg-wf-pontos">
        <strong>
          Pontos de discordância · {resumoPontos.texto} · com o {rotuloDoLado(item.data?.bola)}
        </strong>
        <ul>
          {pontos.map((ponto) => (
            <li key={ponto.id} data-status={ponto.status}>
              <button
                type="button"
                disabled={busy}
                onClick={() => saveData({ pontos: alternarPonto(pontos, ponto.id) })}
                title={ponto.status === "acordado" ? "Reabrir este ponto" : "Marcar como acordado"}
                aria-label={`${ponto.status === "acordado" ? "Reabrir" : "Acordar"}: ${ponto.texto}`}
              >
                <Check size={13} />
              </button>
              <span>{ponto.texto}</span>
            </li>
          ))}
        </ul>
        <button type="button" disabled={busy} onClick={() => saveData({ bola: outroLado(item.data?.bola) })}>
          Passar para o {rotuloDoLado(outroLado(item.data?.bola))}
        </button>
      </div>
    )}
    {item.approval?.plan?.length > 0 && <div className="tdg-workflow-approval"><ShieldCheck size={16} /><span><strong>{item.approval.complete ? (item.approval.comRessalva ? "Aprovado com ressalva" : "Aprovações concluídas") : `Próxima aprovação: ${item.approval.next?.label || "—"}`}</strong><small>{item.approval.approvals?.map((step) => `${step.label}: ${DECISAO_ROTULO[step.decision] || step.decision}`).join(" · ") || "Nenhuma decisão registrada"}</small></span></div>}
    {item.approval?.ressalvas?.length > 0 && (
      <ul className="tdg-workflow-ressalvas">
        {item.approval.ressalvas.map((r, i) => (
          <li key={`${r.stepId}-${i}`}><strong>Ressalva de {r.label}:</strong> {r.note || "sem detalhe"}</li>
        ))}
      </ul>
    )}
    <div className="tdg-page-actions">
      {item.status === "pending" && !ressalvaAberta && <><button className="tdg-action" type="button" disabled={busy} onClick={() => decide("approve")}><Check size={15} />Aprovar etapa</button><button type="button" disabled={busy} onClick={() => setRessalvaAberta(true)}>Aprovar com ressalva</button><button type="button" disabled={busy} onClick={() => decide("reject")}><X size={15} />Reprovar</button></>}
      {item.status === "approved" && <button className="tdg-action" type="button" disabled={busy} onClick={() => updateStatus("in_progress")}>Iniciar execução</button>}
      {item.status === "in_progress" && <button className="tdg-action" type="button" disabled={busy} onClick={() => updateStatus("done")}>Concluir</button>}
      {item.status === "blocked" && <button type="button" disabled={busy} onClick={() => updateStatus("in_progress")}>Desbloquear</button>}
    </div>
    <AnexosContexto contextType="workflow" contextId={item.id} titulo={domain === "legal" ? "Contrato e documentos" : "Documentos"} setToast={setToast} />
    {item.status === "pending" && ressalvaAberta && (
      <div className="tdg-workflow-ressalva-form">
        <label>
          Ressalva (o que precisa ser observado ou ajustado)
          <textarea value={ressalvaNota} onChange={(e) => setRessalvaNota(e.target.value)} rows={3} placeholder="Ex.: aprovado desde que a multa por rescisão caia para 2 mensalidades." autoFocus />
        </label>
        <div className="tdg-page-actions">
          <button type="button" disabled={busy} onClick={() => { setRessalvaAberta(false); setRessalvaNota(""); }}>Cancelar</button>
          <button className="tdg-action" type="button" disabled={busy || !ressalvaNota.trim()} onClick={() => decide("ressalva", ressalvaNota)}><Check size={15} />Confirmar ressalva</button>
        </div>
      </div>
    )}
  </article>;
}

export default function EnterpriseWorkflowPanel({ domain, setToast }) {
  const config = DOMAIN[domain] || DOMAIN.quality;
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(() => empty(domain));
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Contas do CRM para sugerir no vínculo do processo. O clientId tem coluna
  // própria no workflow desde sempre — só faltava a tela preencher. Falha na
  // carga deixa a lista vazia e o campo segue como texto livre de rótulo.
  const [contas, setContas] = useState([]);
  useEffect(() => {
    let ativo = true;
    fetch("/api/todogreen/clients", { headers: authHeaders() })
      .then((response) => (response.ok ? response.json() : null))
      .then((corpo) => { if (ativo && corpo) setContas(corpo.clientes || []); })
      .catch(() => {});
    return () => { ativo = false; };
  }, []);
  const reload = useCallback(async () => {
    setLoading(true);
    try { const data = await api(`?domain=${domain}`); setItems(data.workflows || []); }
    catch (error) { setToast?.(error.message); }
    finally { setLoading(false); }
  }, [domain, setToast]);
  useEffect(() => { setForm(empty(domain)); reload(); }, [domain, reload]);
  const metrics = useMemo(() => ({
    open: items.filter((item) => !["done", "cancelled", "rejected"].includes(item.status)).length,
    pending: items.filter((item) => item.status === "pending").length,
    late: items.filter((item) => item.dueAt && item.dueAt < new Date().toISOString() && !["done", "cancelled"].includes(item.status)).length,
  }), [items]);
  const submit = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      const recurrence = form.recurrenceEnabled ? { enabled: true, frequency: form.recurrenceFrequency, interval: Number(form.recurrenceInterval) || 1, nextRunAt: form.dueAt ? new Date(`${form.dueAt}T12:00:00Z`).toISOString() : new Date(Date.now() + 86400000).toISOString() } : {};
      const data = { ...form.data, clientName: form.clientName || "" };
      if (domain === "marketing") {
        data.budget = Number(form.data.budget || 0);
        data.actualLeads = Number(form.data.actualLeads || 0);
        data.expectedLeads = Number(form.data.expectedLeads || 0);
        data.attributedRevenue = Number(form.data.attributedRevenue || 0);
      }
      if (domain === "legal") {
        // O textarea é rascunho de digitação; o que o workflow guarda são os
        // pontos estruturados, marcáveis um a um no cartão.
        data.pontos = pontosDeTexto(form.data.pontosTexto);
        data.bola = form.data.bola === "comercial" ? "comercial" : "juridico";
        delete data.pontosTexto;
      }
      await api("", { method: "POST", body: JSON.stringify({ ...form, domain, data, recurrence }) });
      setForm(empty(domain)); setOpen(false); await reload(); setToast?.("Processo registrado.");
    } catch (error) { setToast?.(error.message); }
    finally { setSaving(false); }
  };
  return <section className="tdg-enterprise-workflow"><header className="tdg-page-title"><div><span>{config.kicker}</span><h2>{config.title}</h2><p>{config.description}</p></div><div className="tdg-page-actions"><button type="button" onClick={reload}><RefreshCw size={15} />Atualizar</button><button type="button" className="tdg-action" onClick={() => setOpen(true)}><Plus size={15} />Novo processo</button></div></header><section className="tdg-metrics"><article className="tdg-metric"><span>Em aberto</span><strong>{metrics.open}</strong></article><article className={`tdg-metric ${metrics.pending ? "warn" : ""}`}><span>Aguardando aprovação</span><strong>{metrics.pending}</strong></article><article className={`tdg-metric ${metrics.late ? "risk" : ""}`}><span>Prazo vencido</span><strong>{metrics.late}</strong></article></section>{open && <Modal title="Novo processo" onClose={() => setOpen(false)} wide><form className="tdg-form tdg-form-em-modal" onSubmit={submit}><label><span>Tipo</span><select value={form.kind} onChange={(e) => setForm((current) => ({ ...current, kind: e.target.value }))}>{config.kinds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="full"><span>Título</span><input required minLength={3} value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} /></label><label className="full"><span>Descrição / briefing</span><textarea value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} /></label><label><span>Conta To Do Green (opcional)</span><input list="tdg-wf-contas" value={form.clientName} onChange={(e) => { const nome = e.target.value; const conta = contas.find((c) => c.name === nome); setForm((current) => ({ ...current, clientName: nome, clientId: conta?.id || "" })); }} placeholder="Digite para sugerir contas do CRM" /><datalist id="tdg-wf-contas">{contas.map((c) => <option value={c.name} key={c.id} />)}</datalist></label><label><span>Prioridade</span><select value={form.priority} onChange={(e) => setForm((current) => ({ ...current, priority: e.target.value }))}>{Object.entries(PRIORITY).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label><span>Prazo</span><input type="date" value={form.dueAt} onChange={(e) => setForm((current) => ({ ...current, dueAt: e.target.value }))} /></label><DomainFields domain={domain} form={form} setForm={setForm} /><label><span><input type="checkbox" checked={form.recurrenceEnabled} onChange={(e) => setForm((current) => ({ ...current, recurrenceEnabled: e.target.checked }))} /> Processo recorrente</span></label>{form.recurrenceEnabled && <><label><span>Frequência</span><select value={form.recurrenceFrequency} onChange={(e) => setForm((current) => ({ ...current, recurrenceFrequency: e.target.value }))}><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="monthly">Mensal</option></select></label><label><span>A cada</span><input type="number" min="1" max="24" value={form.recurrenceInterval} onChange={(e) => setForm((current) => ({ ...current, recurrenceInterval: e.target.value }))} /></label></>}<div className="tdg-form-actions"><button type="button" onClick={() => setOpen(false)}>Cancelar</button><button className="tdg-action" disabled={saving}>{saving ? "Salvando..." : "Criar processo"}</button></div></form></Modal>}<div className="tdg-workflow-list">{loading && <p>Carregando...</p>}{!loading && items.length === 0 && <p className="tdg-empty-access">Nenhum processo registrado nesta área.</p>}{items.map((item) => <Card key={item.id} item={item} domain={domain} reload={reload} setToast={setToast} />)}</div></section>;
}
