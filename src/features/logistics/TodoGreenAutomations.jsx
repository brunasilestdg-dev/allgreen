import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CirclePause,
  Clock3,
  Plus,
  RefreshCw,
  ServerCog,
  Trash2,
  Workflow,
} from "lucide-react";
import Modal from "../../components/Modal.jsx";
// Estilos compartilhados dos formulários em modal (tdg-form-em-modal, tdg-form-actions).
import "./pages/TodoGreenPages.css";
import { authHeaders } from "../../session/armazenamento.js";

const API = "/api/todogreen/work-center";

const TRIGGERS = [
  ["item-created", "um item for criado"],
  ["status-changed", "o status mudar"],
  ["item-updated", "um item for atualizado"],
  ["field-changed", "um campo mudar"],
  ["date-overdue", "o prazo estiver vencido"],
];

const CONDITIONS = [
  ["", "sem condição adicional"],
  ["status", "status"],
  ["priority", "prioridade"],
  ["responsible", "responsável"],
  ["client", "cliente ou operação"],
  ["type", "tipo de item"],
  ["dueDate", "prazo"],
  ["fields.clientId", "conta do CRM"],
  ["fields.contactId", "contato do CRM"],
];

const OPERATORS = [
  ["equals", "é igual a"],
  ["not-equals", "é diferente de"],
  ["contains", "contém"],
  ["is-empty", "está vazio"],
  ["is-not-empty", "não está vazio"],
];

const ACTIONS = [
  ["change-status", "alterar o status"],
  ["change-priority", "alterar a prioridade"],
  ["assign-person", "atribuir um responsável"],
  ["move-item", "mover para outro quadro"],
  ["research-client", "pesquisar e completar a conta"],
  ["prepare-whatsapp", "preparar WhatsApp para aprovação"],
  ["update-field", "atualizar um campo"],
  ["set-date", "definir a data de entrega"],
  ["move-to-group", "mover para outro grupo"],
  ["create-item", "criar um novo item"],
  ["duplicate-item", "duplicar este item"],
  ["archive-item", "arquivar este item"],
  ["notify-email", "notificar por e-mail"],
];

const STATUS = [
  ["novo", "Novo"],
  ["em-andamento", "Em andamento"],
  ["aguardando", "Aguardando"],
  ["bloqueado", "Bloqueado"],
  ["concluido", "Concluído"],
];

const PRIORITIES = [
  ["baixa", "Baixa"],
  ["media", "Média"],
  ["alta", "Alta"],
  ["critica", "Crítica"],
];

const labelOf = (list, value) => list.find(([id]) => id === value)?.[1] || value;

const emptyForm = () => ({
  name: "",
  boardId: "",
  trigger: "item-created",
  conditionField: "",
  conditionOperator: "equals",
  conditionValue: "",
  actionType: "change-status",
  actionValue: "em-andamento",
});

const templates = [
  {
    id: "atraso-critico",
    name: "Escalar prazo vencido",
    description: "Quando o prazo vencer, elevar a prioridade para crítica.",
    values: {
      name: "Escalar prazo vencido",
      trigger: "date-overdue",
      conditionField: "",
      conditionOperator: "equals",
      conditionValue: "",
      actionType: "change-priority",
      actionValue: "critica",
    },
  },
  {
    id: "bloqueio-critico",
    name: "Tratar item bloqueado",
    description: "Quando o status virar bloqueado, elevar a prioridade para crítica.",
    values: {
      name: "Tratar item bloqueado",
      trigger: "status-changed",
      conditionField: "status",
      conditionOperator: "equals",
      conditionValue: "bloqueado",
      actionType: "change-priority",
      actionValue: "critica",
    },
  },
  {
    id: "pesquisa-conta",
    name: "Completar conta vinculada",
    description: "Ao criar um item com cliente, pesquisar empresa, segmento, ESG e notícias.",
    values: {
      name: "Completar conta vinculada",
      trigger: "item-created",
      conditionField: "fields.clientId",
      conditionOperator: "is-not-empty",
      conditionValue: "",
      actionType: "research-client",
      actionValue: "company",
    },
  },
];

async function request(path = "", options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Não foi possível sincronizar as automações.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function ActionValue({ form, boards, onChange }) {
  if (form.actionType === "change-status")
    return (
      <label><span>Novo status</span><select value={form.actionValue} onChange={(event) => onChange(event.target.value)}>{STATUS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
    );
  if (form.actionType === "change-priority")
    return (
      <label><span>Nova prioridade</span><select value={form.actionValue} onChange={(event) => onChange(event.target.value)}>{PRIORITIES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
    );
  if (form.actionType === "move-item")
    return (
      <label><span>Quadro de destino</span><select value={form.actionValue} onChange={(event) => onChange(event.target.value)}>{boards.map((board) => <option value={board.id} key={board.id}>{board.name}</option>)}</select></label>
    );
  if (form.actionType === "research-client")
    return (
      <label><span>O que pesquisar</span><select value={form.actionValue} onChange={(event) => onChange(event.target.value)}><option value="company">Empresa, segmento, ESG e notícias</option><option value="contacts">Contatos brasileiros de logística e procurement</option></select></label>
    );
  if (form.actionType === "prepare-whatsapp")
    return (
      <label className="full"><span>Mensagem para aprovação</span><textarea maxLength={1000} value={form.actionValue} onChange={(event) => onChange(event.target.value)} placeholder="A mensagem só será enviada depois da confirmação de uma pessoa no item." /></label>
    );
  if (form.actionType === "update-field")
    return (
      <label className="full"><span>Campo e valor</span><input maxLength={200} value={form.actionValue} onChange={(event) => onChange(event.target.value)} placeholder="campo=valor · ex.: area=Financeiro" /></label>
    );
  if (form.actionType === "set-date")
    return (
      <label><span>Data</span><input maxLength={20} value={form.actionValue} onChange={(event) => onChange(event.target.value)} placeholder="hoje, +7 (dias) ou AAAA-MM-DD" /></label>
    );
  if (form.actionType === "move-to-group")
    return (
      <label><span>Grupo de destino (id)</span><input maxLength={60} value={form.actionValue} onChange={(event) => onChange(event.target.value)} placeholder="id do grupo" /></label>
    );
  if (form.actionType === "create-item")
    return (
      <label className="full"><span>Título do novo item</span><input maxLength={200} value={form.actionValue} onChange={(event) => onChange(event.target.value)} placeholder="Ex.: Revisar contrato" /></label>
    );
  if (form.actionType === "notify-email")
    return (
      <label><span>E-mail do destinatário</span><input type="email" maxLength={200} value={form.actionValue} onChange={(event) => onChange(event.target.value)} placeholder="pessoa@todogreen.com.br" /></label>
    );
  if (form.actionType === "duplicate-item" || form.actionType === "archive-item")
    return <p className="tdg-auto-nota">Esta ação age no próprio item e não precisa de valor.</p>;
  return (
    <label><span>Responsável</span><input maxLength={160} value={form.actionValue} onChange={(event) => onChange(event.target.value)} placeholder="Nome ou equipe" /></label>
  );
}

const defaultActionValue = (actionType, boards) => ({
  "change-status": "em-andamento",
  "change-priority": "alta",
  "assign-person": "",
  "move-item": boards[0]?.id || "",
  "research-client": "company",
  "prepare-whatsapp": "",
  "update-field": "",
  "set-date": "hoje",
  "move-to-group": "",
  "create-item": "",
  "duplicate-item": "",
  "archive-item": "",
  "notify-email": "",
}[actionType] || "");

export default function TodoGreenAutomations({ setToast, onNavigate }) {
  const [boards, setBoards] = useState([]);
  const [rules, setRules] = useState([]);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const metrics = useMemo(() => ({
    total: rules.length,
    active: rules.filter((rule) => rule.enabled).length,
    paused: rules.filter((rule) => !rule.enabled).length,
    executed: rules.filter((rule) => rule.lastRunAt).length,
  }), [rules]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await request("?limit=1");
      setBoards(payload.boards || []);
      setRules(payload.automationRules || []);
      setCanWrite(Boolean(payload.access?.canWrite));
    } catch (reason) {
      setError(reason.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    request("?limit=1")
      .then((payload) => {
        if (!active) return;
        setBoards(payload.boards || []);
        setRules(payload.automationRules || []);
        setCanWrite(Boolean(payload.access?.canWrite));
      })
      .catch((reason) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const openTemplate = (template) => {
    setForm({ ...emptyForm(), ...template.values });
    setError("");
    setFormOpen(true);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!canWrite || saving || !form.name.trim() || !form.actionValue.trim()) return;
    setSaving(true);
    setError("");
    try {
      const payload = await request("/automations", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setRules((current) => [payload.automationRule, ...current]);
      setForm(emptyForm());
      setFormOpen(false);
      setToast?.("Automação ativa no servidor");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (rule) => {
    if (!canWrite) return;
    setError("");
    try {
      const payload = await request(`/automations/${encodeURIComponent(rule.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !rule.enabled, revision: rule.revision }),
      });
      setRules((current) => current.map((item) => item.id === rule.id ? payload.automationRule : item));
      setToast?.(payload.automationRule.enabled ? "Automação ativada" : "Automação pausada");
    } catch (reason) {
      if (reason.status === 409 && reason.payload?.current)
        setRules((current) => current.map((item) => item.id === rule.id ? reason.payload.current : item));
      setError(reason.message);
    }
  };

  const remove = async (rule) => {
    if (!canWrite || !window.confirm(`Excluir a automação “${rule.name}”?`)) return;
    setError("");
    try {
      await request(`/automations/${encodeURIComponent(rule.id)}`, { method: "DELETE" });
      setRules((current) => current.filter((item) => item.id !== rule.id));
      setToast?.("Automação excluída");
    } catch (reason) {
      setError(reason.message);
    }
  };

  const boardName = (id) => boards.find((board) => board.id === id)?.name || "Todos os quadros";
  const displayValue = (rule) => {
    if (rule.action?.type === "change-status") return labelOf(STATUS, rule.action.value);
    if (rule.action?.type === "change-priority") return labelOf(PRIORITIES, rule.action.value);
    if (rule.action?.type === "move-item") return boardName(rule.action.value);
    if (rule.action?.type === "research-client") return rule.action.value === "contacts" ? "contatos brasileiros" : "empresa, ESG e notícias";
    return rule.action?.value;
  };
  const conditionText = (rule) => rule.condition?.field
    ? ` se ${labelOf(CONDITIONS, rule.condition.field)} ${labelOf(OPERATORS, rule.condition.operator)}${["is-empty", "is-not-empty"].includes(rule.condition.operator) ? "" : ` ${rule.condition.value}`}`
    : "";

  return (
    <div className="tdg-automations">
      <section className="tdg-automation-hero">
        <div><span className="tdg-kicker">AUTOMAÇÕES</span><h2>Quando isso acontecer, faça aquilo</h2><p>As regras rodam no servidor, respeitam o acesso da To Do Green e registram a execução no histórico do item.</p></div>
        <div className="tdg-automation-hero-actions">
          <button type="button" className="tdg-login-secondary" onClick={load} disabled={loading}><RefreshCw size={16} /> Atualizar</button>
          {canWrite && <button type="button" className="tdg-action" onClick={() => { setForm(emptyForm()); setError(""); setFormOpen(true); }}><Plus size={16} /> Nova automação</button>}
        </div>
      </section>

      {error && <div className="tdg-alert"><span>{error}</span></div>}

      <section className="tdg-automation-metrics" aria-label="Resumo das automações">
        <span><Workflow /><small>Total</small><strong>{metrics.total}</strong></span>
        <span><CheckCircle2 /><small>Ativas</small><strong>{metrics.active}</strong></span>
        <span><CirclePause /><small>Pausadas</small><strong>{metrics.paused}</strong></span>
        <span><Clock3 /><small>Já executadas</small><strong>{metrics.executed}</strong></span>
      </section>

      {canWrite && (
        <section className="tdg-automation-templates">
          <header><div><span className="tdg-kicker">ATALHOS</span><h3>Comece de uma regra segura</h3></div></header>
          <div>{templates.map((template) => <button type="button" onClick={() => openTemplate(template)} key={template.id}><ServerCog /><span><strong>{template.name}</strong><small>{template.description}</small></span><ArrowRight /></button>)}</div>
        </section>
      )}

      {formOpen && canWrite && (
        <Modal title="Nova automação" onClose={() => setFormOpen(false)} wide>
        <form className="tdg-automation-builder tdg-form-em-modal" onSubmit={save}>
          <label className="full"><span>Nome</span><input required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Escalar item bloqueado" /></label>
          <label><span>Aplicar em</span><select value={form.boardId} onChange={(event) => setForm({ ...form, boardId: event.target.value })}><option value="">Todos os quadros</option>{boards.map((board) => <option value={board.id} key={board.id}>{board.name}</option>)}</select></label>
          <label><span>Quando</span><select value={form.trigger} onChange={(event) => setForm({ ...form, trigger: event.target.value })}>{TRIGGERS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
          <label><span>Campo da condição</span><select value={form.conditionField} onChange={(event) => setForm({ ...form, conditionField: event.target.value })}>{CONDITIONS.map(([id, label]) => <option value={id} key={id || "none"}>{label}</option>)}</select></label>
          <label><span>Comparação</span><select value={form.conditionOperator} onChange={(event) => setForm({ ...form, conditionOperator: event.target.value })}>{OPERATORS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
          {form.conditionField && !["is-empty", "is-not-empty"].includes(form.conditionOperator) && <label className="full"><span>Valor da condição</span><input maxLength={240} value={form.conditionValue} onChange={(event) => setForm({ ...form, conditionValue: event.target.value })} placeholder="Ex.: bloqueado, crítica ou nome do cliente" /></label>}
          <label><span>Ação</span><select value={form.actionType} onChange={(event) => { const actionType = event.target.value; setForm({ ...form, actionType, actionValue: defaultActionValue(actionType, boards) }); }}>{ACTIONS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
          <ActionValue form={form} boards={boards} onChange={(actionValue) => setForm({ ...form, actionValue })} />
          {/* O alerta do topo da página fica atrás do fundo do modal; o erro
              do salvamento precisa aparecer aqui, com o formulário aberto. */}
          {error && <div className="tdg-alert full"><span>{error}</span></div>}
          <div className="tdg-form-actions full"><button type="button" className="tdg-login-secondary" onClick={() => setFormOpen(false)}>Cancelar</button><button type="submit" className="tdg-action" disabled={saving || !form.name.trim() || !form.actionValue.trim()}>{saving ? "Salvando..." : "Ativar automação"}</button></div>
        </form>
        </Modal>
      )}

      <section className="tdg-automation-list">
        <header><div><span className="tdg-kicker">REGRAS</span><h3>Automações configuradas</h3></div><button type="button" onClick={() => onNavigate?.("/todogreen/central-trabalho")}>Abrir Central de Implantação <ArrowRight /></button></header>
        {loading ? <p className="tdg-work-empty">Carregando automações...</p> : rules.length === 0 ? <p className="tdg-work-empty">Nenhuma automação criada. Use um atalho ou monte a primeira regra.</p> : <div>{rules.map((rule) => (
          <article className={rule.enabled ? "" : "paused"} key={rule.id}>
            <span className="tdg-automation-rule-icon"><Workflow /></span>
            <div><strong>{rule.name}</strong><p><b>Quando</b> {labelOf(TRIGGERS, rule.trigger)}{conditionText(rule)}, <b>então</b> {labelOf(ACTIONS, rule.action?.type)}: {displayValue(rule)}.</p><small>{boardName(rule.boardId)}{rule.lastRunAt ? ` · última execução ${new Date(rule.lastRunAt).toLocaleString("pt-BR")}` : " · ainda não executada"}</small></div>
            <div><button type="button" onClick={() => toggle(rule)} disabled={!canWrite}>{rule.enabled ? "Pausar" : "Ativar"}</button><button type="button" className="danger" aria-label={`Excluir ${rule.name}`} onClick={() => remove(rule)} disabled={!canWrite}><Trash2 /></button></div>
          </article>
        ))}</div>}
      </section>
    </div>
  );
}
