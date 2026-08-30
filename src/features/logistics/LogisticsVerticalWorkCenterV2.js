import "./LogisticsVerticalWorkCenter.css";
import {
  buildWorkCenterAiRequest,
  summarizeWorkCenter,
} from "./todoGreenWorkCenterDomain.js";
import { evalFormula } from "../databases/formulas.js";
import { addAttachmentsFromFiles } from "../../components/Anexos.jsx";

// Plural em português se escreve, não se abrevia com "(ns)". E zero merece
// palavra: "nenhum item" informa; "0 item(ns)" só mostra o código por baixo.
const contarItens = (n) =>
  n === 0 ? "nenhum item" : n === 1 ? "1 item" : `${n} itens`;


const AUTH_TOKEN_KEY = "seu-funcionario-auth-token";
const CACHE_KEY = "todogreen-work-center-api-cache-v1";
const fallbackStatuses = ["novo", "em-andamento", "aguardando", "bloqueado", "concluido"];
const priorities = ["baixa", "media", "alta", "critica"];
const supportedViews = [
  ["table", "Tabela"], ["kanban", "Kanban"], ["calendar", "Calendário"],
  ["timeline", "Timeline"], ["gantt", "Gantt"], ["dashboard", "Gráficos"],
  ["workload", "Carga"], ["gallery", "Cards"], ["form", "Formulário"], ["map", "Mapa"],
  ["pivot", "Pivô"],
];
const labels = {
  "item-created": "item criado",
  "item-updated": "item atualizado",
  "status-changed": "status alterado",
  "field-changed": "campo alterado",
  "date-overdue": "prazo vencido",
  "change-status": "alterar status",
  "change-priority": "alterar prioridade",
  "assign-person": "atribuir responsável",
  "move-item": "mover item",
  "research-client": "pesquisar e completar conta",
  "prepare-whatsapp": "preparar WhatsApp para aprovação",
  "update-field": "atualizar campo",
  "set-date": "definir data de entrega",
  "move-to-group": "mover para grupo",
  "create-item": "criar novo item",
  "duplicate-item": "duplicar item",
  "archive-item": "arquivar item",
  "notify-email": "notificar por e-mail",
};
const label = (value) => labels[value] || String(value || "").replace(/-/g, " ");
const today = () => new Date().toISOString().slice(0, 10);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let state = {
  boards: [],
  items: [],
  activeBoardId: "",
  search: "",
  status: "todos",
  view: "table",
  loading: true,
  saving: new Set(),
  error: "",
  notice: "",
  canWrite: false,
  showForm: false,
  aiBusy: false,
  aiResult: "",
  automationRules: [],
  clients: [],
  showAutomationForm: false,
  showAutomations: false,
  showBoardForm: false,
  selectedItemId: "",
  detail: null,
  detailTab: "details",
  detailLoading: false,
};

const authHeaders = () => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
  return token ? { authorization: `Bearer ${token}` } : {};
};

const api = async (path = "", options = {}) => {
  const response = await fetch(`/api/todogreen/work-center${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Não foi possível sincronizar a Central de Trabalho.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
};

const saveCache = () => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ boards: state.boards, items: state.items, savedAt: new Date().toISOString() }));
  } catch {}
};
const loadCache = () => {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    if (Array.isArray(cached.boards)) state.boards = cached.boards;
    if (Array.isArray(cached.items)) state.items = cached.items;
    if (!state.activeBoardId) state.activeBoardId = state.boards[0]?.id || "";
  } catch {}
};

const activeBoard = () => state.boards.find((board) => board.id === state.activeBoardId) || state.boards[0];
const boardStatuses = () => activeBoard()?.config?.statuses?.length
  ? activeBoard().config.statuses
  : fallbackStatuses.map((id) => ({ id, label: label(id), color: "#64748b" }));
const boardGroups = () => activeBoard()?.config?.groups?.length
  ? activeBoard().config.groups
  : [{ id: "principal", name: "Principal", color: "#176a4a" }];
const boardFields = () => activeBoard()?.config?.fields || [];
const statusLabel = (value) => boardStatuses().find((status) => status.id === value)?.label || label(value);
const setView = (view) => {
  state.view = view;
  try { localStorage.setItem(`todogreen-work-view:${state.activeBoardId}`, view); } catch {}
};
const restoreView = () => {
  const allowed = activeBoard()?.config?.views || supportedViews.map(([id]) => id);
  let saved = "";
  try { saved = localStorage.getItem(`todogreen-work-view:${state.activeBoardId}`) || ""; } catch {}
  state.view = allowed.includes(saved) ? saved : activeBoard()?.config?.defaultView || allowed[0] || "table";
};
const boardItems = () => state.items.filter((item) => item.boardId === state.activeBoardId && !item.archivedAt);
const filteredItems = () => boardItems().filter((item) => {
  const source = `${item.title} ${item.description} ${item.responsible} ${item.client}`.toLowerCase();
  return (!state.search || source.includes(state.search.toLowerCase())) && (state.status === "todos" || item.status === state.status);
});

const sync = async () => {
  state.loading = true;
  state.error = "";
  renderWorkCenter();
  try {
    const payload = await api("?limit=200");
    state.boards = payload.boards || [];
    state.items = payload.items || [];
    state.automationRules = payload.automationRules || [];
    state.clients = payload.clients || [];
    state.canWrite = !!payload.access?.canWrite;
    if (!state.boards.some((board) => board.id === state.activeBoardId)) state.activeBoardId = state.boards[0]?.id || "";
    restoreView();
    saveCache();
  } catch (error) {
    state.error = error.message;
    loadCache();
    if (state.boards.length) state.notice = "Exibindo a última cópia disponível neste aparelho.";
  } finally {
    state.loading = false;
    renderWorkCenter();
  }
};

const upsertItem = (item) => {
  const index = state.items.findIndex((current) => current.id === item.id);
  if (index >= 0) state.items[index] = item;
  else state.items.unshift(item);
  saveCache();
};

const upsertAutomationRule = (rule) => {
  const index = state.automationRules.findIndex((current) => current.id === rule.id);
  if (index >= 0) state.automationRules[index] = rule;
  else state.automationRules.unshift(rule);
};

const createAutomationRule = async (formElement) => {
  if (!state.canWrite) return;
  const values = new FormData(formElement);
  const actionType = values.get("actionType");
  const actionValueByType = {
    "change-status": "statusValue",
    "change-priority": "priorityValue",
    "move-item": "targetBoardId",
    "research-client": "researchFocus",
    "prepare-whatsapp": "whatsappMessage",
    "update-field": "fieldValue",
    "set-date": "dateValue",
    "move-to-group": "groupValue",
    "create-item": "newItemTitle",
    "notify-email": "emailValue",
  };
  // duplicate-item e archive-item não exigem valor.
  const semValor = actionType === "duplicate-item" || actionType === "archive-item";
  const actionValue = semValor
    ? ""
    : values.get(actionValueByType[actionType] || "responsibleValue") || "";
  state.notice = "Salvando automação...";
  renderWorkCenter();
  try {
    const payload = await api("/automations", {
      method: "POST",
      body: JSON.stringify({
        name: values.get("name"),
        boardId: values.get("boardId"),
        trigger: values.get("trigger"),
        conditionField: values.get("conditionField"),
        conditionOperator: values.get("conditionOperator"),
        conditionValue: values.get("conditionValue"),
        actionType,
        actionValue,
      }),
    });
    upsertAutomationRule(payload.automationRule);
    state.showAutomationForm = false;
    state.notice = "Automação ativa. Ela será executada no servidor quando a condição acontecer.";
  } catch (error) {
    state.error = error.message;
  } finally {
    renderWorkCenter();
  }
};

const toggleAutomationRule = async (rule) => {
  if (!state.canWrite) return;
  try {
    const payload = await api(`/automations/${encodeURIComponent(rule.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !rule.enabled, revision: rule.revision }),
    });
    upsertAutomationRule(payload.automationRule);
    state.notice = payload.automationRule.enabled ? "Automação ativada." : "Automação pausada.";
  } catch (error) {
    state.error = error.message;
  } finally {
    renderWorkCenter();
  }
};

const deleteAutomationRule = async (rule) => {
  if (!state.canWrite || !confirm(`Excluir a automação “${rule.name}”?`)) return;
  try {
    await api(`/automations/${encodeURIComponent(rule.id)}`, { method: "DELETE" });
    state.automationRules = state.automationRules.filter((current) => current.id !== rule.id);
    state.notice = "Automação excluída.";
  } catch (error) {
    state.error = error.message;
  } finally {
    renderWorkCenter();
  }
};

const parseConfigLines = (value, mapper) => String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map(mapper);

const saveBoard = async (formElement) => {
  if (!state.canWrite) return;
  const values = new FormData(formElement);
  const editing = values.get("boardId");
  const statuses = parseConfigLines(values.get("statuses"), (line, index) => {
    const [name, color] = line.split("|").map((part) => part.trim());
    return { id: name, label: name, color: color || ["#64748b", "#2563eb", "#d97706", "#dc2626", "#15803d"][index % 5] };
  });
  const groups = parseConfigLines(values.get("groups"), (line, index) => {
    const [name, color] = line.split("|").map((part) => part.trim());
    return { id: name, name, color: color || ["#176a4a", "#2563eb", "#7c3aed", "#d97706"][index % 4] };
  });
  const fields = parseConfigLines(values.get("fields"), (line) => {
    const [name, type = "text", settings = ""] = line.split("|").map((part) => part.trim());
    return {
      id: name, label: name, type,
      formula: type === "formula" ? settings : "",
      sourceField: ["mirror", "lookup", "rollup"].includes(type) ? settings : "",
      options: type === "dropdown" ? settings.split(",").map((option) => option.trim()).filter(Boolean) : [],
    };
  });
  const views = [...formElement.querySelectorAll('[name="views"]:checked')].map((input) => input.value);
  const body = {
    name: values.get("name"), description: values.get("description"), specialist: values.get("specialist"),
    config: { statuses, groups, fields, views, defaultView: values.get("defaultView") },
  };
  state.notice = editing ? "Salvando quadro..." : "Criando quadro...";
  renderWorkCenter();
  try {
    const payload = await api(editing ? `/boards/${encodeURIComponent(editing)}` : "/boards", {
      method: editing ? "PATCH" : "POST", body: JSON.stringify(body),
    });
    const board = payload.board;
    const index = state.boards.findIndex((candidate) => candidate.id === board.id);
    if (index >= 0) state.boards[index] = board; else state.boards.push(board);
    state.activeBoardId = board.id;
    restoreView();
    state.showBoardForm = false;
    state.notice = editing ? "Quadro atualizado." : "Quadro criado.";
  } catch (error) { state.error = error.message; }
  finally { renderWorkCenter(); }
};

const openItem = async (itemId, tab = "details") => {
  state.selectedItemId = itemId;
  state.detailTab = tab;
  state.detailLoading = true;
  state.detail = null;
  renderWorkCenter();
  try {
    state.detail = await api(`/${encodeURIComponent(itemId)}/detail`);
  } catch (error) { state.error = error.message; }
  finally { state.detailLoading = false; renderWorkCenter(); }
};

const closeItem = () => {
  state.selectedItemId = "";
  state.detail = null;
  renderWorkCenter();
};

const addComment = async (formElement) => {
  const values = new FormData(formElement);
  try {
    const payload = await api(`/${encodeURIComponent(state.selectedItemId)}/comments`, {
      method: "POST", body: JSON.stringify({ body: values.get("body") }),
    });
    state.detail.comments.push(payload.comment);
    formElement.reset();
    state.notice = "Atualização publicada.";
    renderWorkCenter();
  } catch (error) { state.error = error.message; renderWorkCenter(); }
};

const addSubitem = async (title) => {
  const parent = state.detail?.item;
  if (!parent || !String(title || "").trim()) return;
  try {
    const payload = await api("", {
      method: "POST",
      body: JSON.stringify({
        boardId: parent.boardId, type: "tarefa", title, responsible: parent.responsible,
        dueDate: parent.dueDate, priority: parent.priority, fields: { parentId: parent.id, groupId: parent.fields?.groupId || "principal" },
      }),
    });
    upsertItem(payload.item);
    state.detail.subitems.unshift(payload.item);
    state.notice = "Subitem criado.";
    renderWorkCenter();
  } catch (error) { state.error = error.message; renderWorkCenter(); }
};

const readDetailPatch = (formElement) => {
  const values = new FormData(formElement);
  const item = state.detail.item;
  const custom = { ...(item.fields?.custom || {}) };
  boardFields().forEach((field) => {
    if (field.type === "formula" || ["mirror", "lookup", "rollup"].includes(field.type)) return;
    if (field.type === "relation") custom[field.id] = values.getAll(`custom:${field.id}`);
    else custom[field.id] = values.get(`custom:${field.id}`) || "";
  });
  const checklist = parseConfigLines(values.get("checklist"), (line) => ({
    id: crypto.randomUUID(), text: line.replace(/^\[[xX ]\]\s*/, ""), done: /^\[[xX]\]/.test(line),
  }));
  const linkAttachments = parseConfigLines(values.get("attachments"), (line) => {
    const [name, url = ""] = line.split("|").map((part) => part.trim());
    return { id: crypto.randomUUID(), name, url };
  });
  const uploadedAttachments = (item.fields?.attachments || []).filter((attachment) => attachment.kind || attachment.dataUrl || attachment.content);
  const attachments = [...uploadedAttachments, ...linkAttachments];
  return {
    title: values.get("title"), description: values.get("description"), status: values.get("status"),
    priority: values.get("priority"), responsible: values.get("responsible"), dueDate: values.get("dueDate"),
    dependencies: values.getAll("dependencies"), relations: values.getAll("relations").map((id) => ({ entity: "work-item", id })),
    fields: {
      ...(item.fields || {}), startDate: values.get("startDate"), groupId: values.get("groupId"), tags: values.get("tags").split(",").map((tag) => tag.trim()).filter(Boolean),
      milestone: values.get("milestone") === "on", recurrence: values.get("recurrence") ? { frequency: values.get("recurrence") } : null,
      estimatedHours: Number(values.get("estimatedHours") || 0), progress: Number(values.get("progress") || 0), location: values.get("location"),
      checklist, attachments, custom,
    },
  };
};

const saveDetail = async (formElement) => {
  const item = state.detail?.item;
  if (!item) return;
  await patchItem(item, readDetailPatch(formElement), { keepDetail: true });
};

const patchItem = async (item, patch, options = {}) => {
  if (!state.canWrite || state.saving.has(item.id)) return;
  state.saving.add(item.id);
  state.notice = "Salvando alteração...";
  renderWorkCenter();
  try {
    const payload = await api(`/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ ...patch, revision: item.revision }),
    });
    upsertItem(payload.item);
    const recurringNotice = payload.recurrenceCreated ? "Item salvo e próxima recorrência criada." : "";
    if (options.keepDetail && state.detail) {
      state.detail.item = payload.item;
      if (payload.recurrenceCreated) {
        upsertItem(payload.recurrenceCreated);
      }
    }
    state.notice = payload.automationsExecuted?.length
      ? `Alteração sincronizada. ${payload.automationsExecuted.join(" ")}`
      : recurringNotice || "Alteração sincronizada.";
  } catch (error) {
    if (error.status === 409 && error.payload?.current) {
      upsertItem(error.payload.current);
      state.notice = "Outra pessoa alterou este item. A versão mais recente foi carregada.";
    } else state.error = error.message;
  } finally {
    state.saving.delete(item.id);
    renderWorkCenter();
  }
};

const confirmWhatsapp = async (item) => {
  const pending = item.fields?.pendingWhatsapp;
  if (!state.canWrite || !pending || pending.status !== "pending") return;
  const confirmed = confirm(`Enviar esta mensagem para ${pending.contactName || "o contato selecionado"}?\n\n${pending.message}`);
  if (!confirmed) return;
  state.saving.add(item.id);
  state.notice = "Enviando WhatsApp confirmado...";
  renderWorkCenter();
  try {
    const payload = await api(`/${encodeURIComponent(item.id)}/whatsapp-confirm`, { method: "POST" });
    upsertItem(payload.item);
    state.notice = "WhatsApp enviado e registrado no histórico do item.";
  } catch (error) {
    state.error = error.message;
  } finally {
    state.saving.delete(item.id);
    renderWorkCenter();
  }
};

const archiveItem = async (item) => {
  if (!state.canWrite || !confirm(`Arquivar “${item.title}”?`)) return;
  state.saving.add(item.id);
  renderWorkCenter();
  try {
    await api(`/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    state.items = state.items.filter((current) => current.id !== item.id);
    state.notice = "Item arquivado.";
    saveCache();
  } catch (error) {
    state.error = error.message;
  } finally {
    state.saving.delete(item.id);
    renderWorkCenter();
  }
};

const createItem = async (formElement) => {
  if (!state.canWrite) return;
  const values = new FormData(formElement);
  const board = activeBoard();
  state.notice = "Criando item...";
  renderWorkCenter();
  try {
    const clientId = values.get("clientId") || "";
    const selectedClient = state.clients.find((client) => client.id === clientId);
    const contactId = values.get("contactId") || "";
    const selectedContact = selectedClient?.contacts?.find((contact) => contact.id === contactId);
    const payload = await api("", {
      method: "POST",
      body: JSON.stringify({
        boardId: board.id,
        type: values.get("type"),
        title: values.get("title"),
        description: values.get("description"),
        priority: values.get("priority"),
        status: "novo",
        responsible: values.get("responsible"),
        dueDate: values.get("dueDate"),
        client: selectedClient?.name || values.get("client"),
        fields: {
          esgImpact: values.get("esgImpact") || "",
          clientId,
          contactId,
          contactName: selectedContact?.name || "",
          startDate: values.get("startDate") || "",
          groupId: values.get("groupId") || boardGroups()[0]?.id || "principal",
          tags: String(values.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean),
          milestone: values.get("milestone") === "on",
          estimatedHours: Number(values.get("estimatedHours") || 0),
        },
      }),
    });
    upsertItem(payload.item);
    state.showForm = false;
    state.notice = "Item criado e compartilhado com a equipe.";
  } catch (error) {
    state.error = error.message;
  } finally {
    renderWorkCenter();
  }
};

const boardFormHtml = () => {
  if (!state.showBoardForm || !state.canWrite) return "";
  const board = activeBoard();
  const editing = state.showBoardForm === "edit" && board;
  const config = editing ? board.config : {
    statuses: boardStatuses(), groups: [{ id: "principal", name: "Principal", color: "#176a4a" }], fields: [],
    views: supportedViews.map(([id]) => id), defaultView: "table",
  };
  return `<div class="tdg-work-modal" data-board-modal><form class="tdg-work-dialog tdg-board-config" data-board-form>
    <header><div><span class="tdg-kicker">CONFIGURAÇÃO DO QUADRO</span><h3>${editing ? "Editar quadro" : "Novo quadro"}</h3></div><button type="button" data-board-cancel aria-label="Fechar">×</button></header>
    <input type="hidden" name="boardId" value="${editing ? esc(board.id) : ""}">
    <label><span>Nome</span><input name="name" required maxlength="120" value="${editing ? esc(board.name) : ""}" placeholder="Ex.: Novos Negócios"></label>
    <label><span>Especialidade da IA</span><select name="specialist">${["projects", "commercial", "pricing", "finance", "operations", "supplyChain", "esg", "legal", "people", "data"].map((value) => `<option value="${value}" ${value === (editing ? board.specialist : "projects") ? "selected" : ""}>${label(value)}</option>`).join("")}</select></label>
    <label class="full"><span>Descrição</span><textarea name="description" maxlength="800">${editing ? esc(board.description) : ""}</textarea></label>
    <label><span>Status, um por linha</span><textarea name="statuses" required>${esc(config.statuses.map((status) => `${status.label}|${status.color}`).join("\n"))}</textarea><small>Formato: Nome | cor hexadecimal</small></label>
    <label><span>Grupos, um por linha</span><textarea name="groups" required>${esc(config.groups.map((group) => `${group.name}|${group.color}`).join("\n"))}</textarea><small>Formato: Nome | cor hexadecimal</small></label>
    <label class="full"><span>Campos personalizados</span><textarea name="fields" placeholder="Margem|number&#10;Tipo de operação|dropdown|First Mile,Middle Mile,Last Mile&#10;Receita projetada|formula|Volume * Tarifa&#10;Cliente espelhado|mirror|Cliente&#10;Receita por vínculo|rollup|Receita">${esc(config.fields.map((field) => `${field.label}|${field.type}|${field.formula || field.sourceField || field.options?.join(",") || ""}`).join("\n"))}</textarea><small>Tipos: text, number, currency, percentage, date, checkbox, dropdown, formula, location, relation, mirror, lookup e rollup.</small></label>
    <fieldset class="full"><legend>Visualizações disponíveis</legend><div class="tdg-view-checks">${supportedViews.map(([id, text]) => `<label><input type="checkbox" name="views" value="${id}" ${config.views.includes(id) ? "checked" : ""}> ${text}</label>`).join("")}</div></fieldset>
    <label><span>Visualização inicial</span><select name="defaultView">${supportedViews.map(([id, text]) => `<option value="${id}" ${id === config.defaultView ? "selected" : ""}>${text}</option>`).join("")}</select></label>
    <footer class="full"><button class="tdg-login-secondary" type="button" data-board-cancel>Cancelar</button><button class="tdg-action" type="submit">Salvar quadro</button></footer>
  </form></div>`;
};

const formHtml = () => {
  if (!state.showForm || !state.canWrite) return "";
  const board = activeBoard();
  return `<form class="tdg-work-form" data-work-form>
    <label class="full"><span>Título</span><input name="title" required maxlength="240" placeholder="Ex.: Validar janela de recarga da operação Cajamar"></label>
    <label><span>Tipo</span><select name="type">${(board?.types || ["tarefa"]).map((type) => `<option value="${esc(type)}">${esc(label(type))}</option>`).join("")}</select></label>
    <label><span>Prioridade</span><select name="priority">${priorities.map((value) => `<option value="${value}">${label(value)}</option>`).join("")}</select></label>
    <label><span>Responsável</span><input name="responsible" maxlength="160" placeholder="Nome ou equipe"></label>
    <label><span>Grupo</span><select name="groupId">${boardGroups().map((group) => `<option value="${esc(group.id)}">${esc(group.name)}</option>`).join("")}</select></label>
    <label><span>Início</span><input name="startDate" type="date"></label>
    <label><span>Prazo</span><input name="dueDate" type="date"></label>
    <label><span>Esforço estimado</span><input name="estimatedHours" type="number" min="0" step="0.5" placeholder="Horas"></label>
    <label><span>Tags</span><input name="tags" maxlength="300" placeholder="RFQ, urgente, cliente"></label>
    <label class="tdg-inline-check"><input name="milestone" type="checkbox"><span>Este item é um marco</span></label>
    <label><span>Conta do CRM</span><select name="clientId" data-work-client><option value="">Sem conta vinculada</option>${state.clients.map((client) => `<option value="${esc(client.id)}">${esc(client.name)}</option>`).join("")}</select></label>
    <label><span>Contato da ação</span><select name="contactId" data-work-contact disabled><option value="">Selecione primeiro a conta</option></select></label>
    <label><span>Operação / referência</span><input name="client" maxlength="200" placeholder="Usado quando não houver uma conta do CRM"></label>
    <label><span>Impacto ESG</span><input name="esgImpact" maxlength="300"></label>
    <label class="full"><span>Descrição e critério de conclusão</span><textarea name="description" maxlength="4000"></textarea></label>
    <div class="tdg-work-center-actions full"><button class="tdg-action" type="submit">Criar item</button><button class="tdg-login-secondary" type="button" data-work-cancel>Cancelar</button></div>
  </form>`;
};

const customFieldInputHtml = (field, item) => {
  const custom = item.fields?.custom || {};
  if (field.type === "formula") {
    const values = Object.fromEntries(boardFields().filter((candidate) => candidate.type !== "formula").map((candidate) => [candidate.label, custom[candidate.id] || 0]));
    return `<label><span>${esc(field.label)}</span><output>${esc(evalFormula(field.formula, values))}</output><small>${esc(field.formula)}</small></label>`;
  }
  if (["mirror", "lookup", "rollup"].includes(field.type)) {
    const relatedItems = (item.relations || [])
      .map((relation) => state.items.find((candidate) => candidate.id === relation.id || candidate.id === relation))
      .filter(Boolean);
    const source = field.sourceField || field.formula || field.label;
    const values = relatedItems.map((related) => related.fields?.custom?.[source] ?? related[source] ?? related.client ?? related.title).filter((value) => value !== "" && value != null);
    const display = field.type === "rollup"
      ? values.reduce((sum, value) => sum + Number(value || 0), 0)
      : values.join(", ");
    return `<label><span>${esc(field.label)}</span><output>${esc(display || "Sem vínculo")}</output><small>${esc(label(field.type))}: ${esc(source || "campo vinculado")}</small></label>`;
  }
  if (field.type === "relation") {
    const ids = Array.isArray(custom[field.id]) ? custom[field.id] : String(custom[field.id] || "").split(",").map((value) => value.trim()).filter(Boolean);
    const candidates = state.items.filter((candidate) => candidate.id !== item.id && !candidate.archivedAt);
    return `<label><span>${esc(field.label)}</span><select name="custom:${esc(field.id)}" multiple>${candidates.map((candidate) => `<option value="${esc(candidate.id)}" ${ids.includes(candidate.id) ? "selected" : ""}>${esc(candidate.title)}</option>`).join("")}</select><small>Selecione itens relacionados para espelhar, consultar ou somar dados.</small></label>`;
  }
  if (field.type === "checkbox") return `<label class="tdg-inline-check"><input type="checkbox" name="custom:${esc(field.id)}" value="1" ${custom[field.id] ? "checked" : ""}><span>${esc(field.label)}</span></label>`;
  if (field.type === "dropdown") return `<label><span>${esc(field.label)}</span><select name="custom:${esc(field.id)}"><option value="">Selecione</option>${(field.options || []).map((option) => `<option value="${esc(option)}" ${custom[field.id] === option ? "selected" : ""}>${esc(option)}</option>`).join("")}</select></label>`;
  const type = ["number", "date"].includes(field.type) ? field.type : "text";
  return `<label><span>${esc(field.label)}</span><input type="${type}" name="custom:${esc(field.id)}" value="${esc(custom[field.id] || "")}" ${field.required ? "required" : ""}></label>`;
};

const itemDetailHtml = () => {
  if (!state.selectedItemId) return "";
  if (state.detailLoading || !state.detail) return `<div class="tdg-work-drawer"><header><strong>Carregando item...</strong><button type="button" data-detail-close>×</button></header></div>`;
  const { item, comments = [], events = [], subitems = [] } = state.detail;
  const boardCandidates = state.items.filter((candidate) => candidate.id !== item.id && !candidate.archivedAt);
  const checklist = item.fields?.checklist || [];
  const attachments = item.fields?.attachments || [];
  const detailBody = state.detailTab === "activity"
    ? `<section class="tdg-detail-activity"><form data-comment-form><textarea name="body" required maxlength="4000" placeholder="Escreva uma atualização. Use @nome para mencionar alguém."></textarea><button class="tdg-action" type="submit">Publicar</button></form><div>${comments.length ? comments.map((comment) => `<article><header><strong>${esc(comment.author)}</strong><time>${esc(new Date(comment.createdAt).toLocaleString("pt-BR"))}</time></header><p>${esc(comment.body)}</p>${comment.mentions?.length ? `<small>Menções: ${comment.mentions.map((mention) => `@${esc(mention)}`).join(", ")}</small>` : ""}</article>`).join("") : '<p class="tdg-work-empty">Nenhuma atualização publicada.</p>'}</div></section>`
    : state.detailTab === "history"
      ? `<section class="tdg-detail-history">${events.length ? events.map((entry) => `<article><span></span><div><strong>${esc(label(entry.action))}</strong><small>${esc(entry.actor)} · ${esc(new Date(entry.createdAt).toLocaleString("pt-BR"))}</small></div></article>`).join("") : '<p class="tdg-work-empty">Nenhuma alteração registrada.</p>'}</section>`
      : `<form class="tdg-detail-form" data-detail-form>
        <label class="full"><span>Título</span><input name="title" required value="${esc(item.title)}"></label>
        <label><span>Status</span><select name="status">${boardStatuses().map((status) => `<option value="${esc(status.id)}" ${item.status === status.id ? "selected" : ""}>${esc(status.label)}</option>`).join("")}</select></label>
        <label><span>Prioridade</span><select name="priority">${priorities.map((value) => `<option value="${value}" ${item.priority === value ? "selected" : ""}>${label(value)}</option>`).join("")}</select></label>
        <label><span>Responsável</span><input name="responsible" value="${esc(item.responsible)}"></label>
        <label><span>Grupo</span><select name="groupId">${boardGroups().map((group) => `<option value="${esc(group.id)}" ${item.fields?.groupId === group.id ? "selected" : ""}>${esc(group.name)}</option>`).join("")}</select></label>
        <label><span>Início</span><input type="date" name="startDate" value="${esc(item.fields?.startDate || "")}"></label>
        <label><span>Prazo</span><input type="date" name="dueDate" value="${esc(item.dueDate)}"></label>
        <label><span>Esforço estimado</span><input type="number" min="0" step="0.5" name="estimatedHours" value="${esc(item.fields?.estimatedHours || "")}"></label>
        <label><span>Progresso</span><input type="number" min="0" max="100" name="progress" value="${esc(item.fields?.progress || 0)}"></label>
        <label><span>Recorrência</span><select name="recurrence"><option value="">Não repetir</option>${[["daily", "Diária"], ["weekly", "Semanal"], ["biweekly", "Quinzenal"], ["monthly", "Mensal"], ["quarterly", "Trimestral"]].map(([id, text]) => `<option value="${id}" ${item.fields?.recurrence?.frequency === id ? "selected" : ""}>${text}</option>`).join("")}</select></label>
        <label><span>Localização</span><input name="location" value="${esc(item.fields?.location || "")}" placeholder="Endereço, cidade ou coordenadas"></label>
        <label class="full"><span>Tags</span><input name="tags" value="${esc((item.fields?.tags || []).join(", "))}" placeholder="Separe por vírgulas"></label>
        <label class="tdg-inline-check"><input type="checkbox" name="milestone" ${item.fields?.milestone ? "checked" : ""}><span>Marco do projeto</span></label>
        <label class="full"><span>Descrição e critério de conclusão</span><textarea name="description">${esc(item.description)}</textarea></label>
        ${boardFields().map((field) => customFieldInputHtml(field, item)).join("")}
        <label class="full"><span>Dependências</span><select name="dependencies" multiple>${boardCandidates.map((candidate) => `<option value="${esc(candidate.id)}" ${(item.dependencies || []).some((dependency) => (typeof dependency === "string" ? dependency : dependency.id) === candidate.id) ? "selected" : ""}>${esc(candidate.title)}</option>`).join("")}</select></label>
        <label class="full"><span>Relacionamentos</span><select name="relations" multiple>${boardCandidates.map((candidate) => `<option value="${esc(candidate.id)}" ${(item.relations || []).some((relation) => relation.id === candidate.id) ? "selected" : ""}>${esc(candidate.title)}</option>`).join("")}</select></label>
        <label class="full"><span>Checklist</span><textarea name="checklist" placeholder="[ ] Item pendente&#10;[x] Item concluído">${esc(checklist.map((entry) => `[${entry.done ? "x" : " "}] ${entry.text}`).join("\n"))}</textarea></label>
        <section class="full tdg-detail-attachments"><header><div><strong>Anexos e links</strong><small>Até cinco arquivos por item</small></div><label>Adicionar arquivos<input type="file" data-detail-files multiple accept="image/*,.pdf,.docx,.txt,.md,.csv"></label></header>${attachments.filter((entry) => entry.kind || entry.dataUrl || entry.content).map((entry) => `<span>${esc(entry.name)}</span>`).join("")}</section>
        <label class="full"><span>Links anexados</span><textarea name="attachments" placeholder="Apresentação|https://...">${esc(attachments.filter((entry) => entry.url).map((entry) => `${entry.name}|${entry.url}`).join("\n"))}</textarea></label>
        <section class="full tdg-subitems"><header><div><strong>Subitens</strong><small>${subitems.length} vinculados</small></div><button type="button" data-add-subitem>+ Adicionar</button></header>${subitems.map((subitem) => `<button type="button" data-open-subitem="${esc(subitem.id)}"><span>${esc(subitem.title)}</span><small>${esc(statusLabel(subitem.status))}</small></button>`).join("") || '<p>Nenhum subitem.</p>'}</section>
        <footer class="full"><button class="tdg-action" type="submit">Salvar alterações</button></footer>
      </form>`;
  return `<aside class="tdg-work-drawer" aria-label="Detalhes do item"><header><div><span class="tdg-work-badge">${esc(label(item.type))}</span><strong>${esc(item.title)}</strong><small>Revisão ${Number(item.revision || 1)}</small></div><button type="button" data-detail-close aria-label="Fechar">×</button></header><nav>${[["details", "Detalhes"], ["activity", `Atualizações (${comments.length})`], ["history", `Histórico (${events.length})`]].map(([id, text]) => `<button type="button" data-detail-tab="${id}" class="${state.detailTab === id ? "active" : ""}">${text}</button>`).join("")}</nav>${detailBody}</aside>`;
};

const automationFormHtml = () => {
  if (!state.showAutomationForm || !state.canWrite) return "";
  return `<form class="tdg-work-form tdg-automation-form" data-automation-form>
    <label class="full"><span>Nome da automação</span><input name="name" required maxlength="160" placeholder="Ex.: Escalar item bloqueado para Operações"></label>
    <label><span>Aplicar em</span><select name="boardId"><option value="">Todos os quadros</option>${state.boards.map((board) => `<option value="${esc(board.id)}" ${board.id === state.activeBoardId ? "selected" : ""}>${esc(board.name)}</option>`).join("")}</select></label>
    <label><span>Quando</span><select name="trigger"><option value="item-created">um item for criado</option><option value="status-changed">o status mudar</option><option value="item-updated">um item for atualizado</option><option value="field-changed">um campo mudar</option><option value="date-overdue">o prazo estiver vencido</option></select></label>
    <label><span>Campo da condição</span><select name="conditionField"><option value="">Sem condição adicional</option><option value="status">Status</option><option value="priority">Prioridade</option><option value="responsible">Responsável</option><option value="client">Cliente/operação</option><option value="type">Tipo</option><option value="dueDate">Prazo</option></select></label>
    <label><span>Comparação</span><select name="conditionOperator"><option value="equals">é igual a</option><option value="not-equals">é diferente de</option><option value="contains">contém</option><option value="is-empty">está vazio</option><option value="is-not-empty">não está vazio</option></select></label>
    <label class="full"><span>Valor da condição</span><input name="conditionValue" maxlength="240" placeholder="Ex.: bloqueado, Adidas ou crítica"></label>
    <label><span>Ação</span><select name="actionType"><option value="change-status">Alterar status</option><option value="change-priority">Alterar prioridade</option><option value="assign-person">Atribuir responsável</option><option value="move-item">Mover para outro quadro</option><option value="research-client">Pesquisar e completar conta</option><option value="prepare-whatsapp">Preparar WhatsApp para aprovação</option><option value="update-field">Atualizar campo</option><option value="set-date">Definir data de entrega</option><option value="move-to-group">Mover para grupo</option><option value="create-item">Criar novo item</option><option value="duplicate-item">Duplicar item</option><option value="archive-item">Arquivar item</option><option value="notify-email">Notificar por e-mail</option></select></label>
    <label data-action-value="change-status"><span>Novo status</span><select name="statusValue">${boardStatuses().map((status) => `<option value="${esc(status.id)}">${esc(status.label)}</option>`).join("")}</select></label>
    <label data-action-value="change-priority"><span>Nova prioridade</span><select name="priorityValue">${priorities.map((value) => `<option value="${value}">${label(value)}</option>`).join("")}</select></label>
    <label data-action-value="assign-person"><span>Novo responsável</span><input name="responsibleValue" maxlength="160" placeholder="Nome ou equipe"></label>
    <label data-action-value="move-item"><span>Quadro de destino</span><select name="targetBoardId">${state.boards.map((board) => `<option value="${esc(board.id)}">${esc(board.name)}</option>`).join("")}</select></label>
    <label data-action-value="research-client"><span>O que pesquisar</span><select name="researchFocus"><option value="company">Empresa, site, segmento, ESG e notícias</option><option value="contacts">Contatos brasileiros de logística e procurement</option></select></label>
    <label class="full" data-action-value="prepare-whatsapp"><span>Mensagem para aprovação</span><textarea name="whatsappMessage" maxlength="1000" placeholder="A mensagem só será enviada depois de uma pessoa confirmar no item."></textarea></label>
    <label data-action-value="update-field"><span>Campo = valor</span><input name="fieldValue" maxlength="240" placeholder="Ex.: area=Financeiro"></label>
    <label data-action-value="set-date"><span>Data de entrega</span><input name="dateValue" maxlength="20" placeholder="hoje, +7 ou 2026-09-30"></label>
    <label data-action-value="move-to-group"><span>Grupo de destino</span><select name="groupValue">${boardGroups().map((group) => `<option value="${esc(group.id)}">${esc(group.name)}</option>`).join("")}</select></label>
    <label data-action-value="create-item"><span>Título do novo item</span><input name="newItemTitle" maxlength="200" placeholder="Ex.: Revisar contrato gerado"></label>
    <label data-action-value="notify-email"><span>E-mail do destinatário</span><input name="emailValue" type="email" maxlength="160" placeholder="pessoa@empresa.com.br"></label>
    <div class="tdg-work-center-actions full"><button class="tdg-action" type="submit">Ativar automação</button><button class="tdg-login-secondary" type="button" data-automation-cancel>Cancelar</button></div>
  </form>`;
};

const automationRulesHtml = () => {
  const rules = state.automationRules.filter((rule) => !rule.boardId || rule.boardId === state.activeBoardId);
  const boardName = (id) => state.boards.find((board) => board.id === id)?.name || "Todos os quadros";
  if (!rules.length) return '<p class="tdg-work-empty">Nenhuma regra personalizada neste quadro.</p>';
  return `<div class="tdg-automation-rules">${rules.map((rule) => `<article class="${rule.enabled ? "" : "paused"}" data-rule-id="${esc(rule.id)}"><div><strong>${esc(rule.name)}</strong><small>${esc(boardName(rule.boardId))} · ${esc(label(rule.trigger))} · ${esc(label(rule.action.type))}: ${esc(rule.action.value)}</small>${rule.lastRunAt ? `<em>Última execução: ${esc(new Date(rule.lastRunAt).toLocaleString("pt-BR"))}</em>` : ""}</div><div><button type="button" data-rule-toggle>${rule.enabled ? "Pausar" : "Ativar"}</button><button type="button" data-rule-delete>Excluir</button></div></article>`).join("")}</div>`;
};

const rowHtml = (item) => {
  const overdue = item.dueDate && item.dueDate < today() && item.status !== "concluido";
  const disabled = !state.canWrite || state.saving.has(item.id) ? "disabled" : "";
  return `<article class="tdg-work-row" data-item-id="${esc(item.id)}">
    <div><span class="tdg-work-badge ${item.priority === "critica" ? "critical" : overdue ? "warning" : ""}">${esc(label(item.type))}</span><button type="button" class="tdg-work-title" data-work-open>${esc(item.title)}</button><small>${esc(item.client || "Sem cliente/operação")}${item.description ? ` · ${esc(item.description)}` : ""}</small><em>rev. ${Number(item.revision || 1)} · ${esc(item.responsible || "sem responsável")}</em>${item.fields?.pendingWhatsapp?.status === "pending" ? `<button type="button" class="tdg-work-whatsapp-approval" data-whatsapp-confirm>Revisar e confirmar WhatsApp para ${esc(item.fields.pendingWhatsapp.contactName || "contato")}</button>` : item.fields?.pendingWhatsapp?.status === "sent" ? '<small class="tdg-work-whatsapp-sent">WhatsApp enviado com confirmação</small>' : ""}</div>
    <select data-field="status" ${disabled}>${boardStatuses().map((status) => `<option value="${esc(status.id)}" ${status.id === item.status ? "selected" : ""}>${esc(status.label)}</option>`).join("")}</select>
    <select data-field="priority" ${disabled}>${priorities.map((value) => `<option value="${value}" ${value === item.priority ? "selected" : ""}>${label(value)}</option>`).join("")}</select>
    <input data-field="responsible" value="${esc(item.responsible)}" placeholder="Responsável" ${disabled}>
    <input data-field="dueDate" type="date" value="${esc(item.dueDate)}" ${disabled}>
    <button type="button" data-work-remove ${disabled} aria-label="Arquivar item">×</button>
  </article>`;
};

const compactItemHtml = (item, mode = "card") => {
  const overdue = item.dueDate && item.dueDate < today() && item.status !== "concluido";
  const disabled = !state.canWrite || state.saving.has(item.id) ? "disabled" : "";
  return `<article class="tdg-work-${mode} ${overdue ? "overdue" : ""}" data-item-id="${esc(item.id)}">
    <div><span class="tdg-work-badge ${item.priority === "critica" ? "critical" : overdue ? "warning" : ""}">${esc(label(item.priority))}</span><button type="button" class="tdg-work-title" data-work-open>${esc(item.title)}</button><small>${esc(item.client || "Sem cliente/operação")}</small></div>
    <p>${esc(item.description || "Sem descrição.")}</p>
    <footer><span>${esc(item.responsible || "Sem responsável")}</span><time>${esc(item.dueDate || "Sem prazo")}</time></footer>
    <div class="tdg-work-card-actions"><select data-field="status" aria-label="Status" ${disabled}>${boardStatuses().map((status) => `<option value="${esc(status.id)}" ${status.id === item.status ? "selected" : ""}>${esc(status.label)}</option>`).join("")}</select>${item.fields?.pendingWhatsapp?.status === "pending" ? '<button type="button" data-whatsapp-confirm>Confirmar WhatsApp</button>' : ""}<button type="button" data-work-remove ${disabled} aria-label="Arquivar item">×</button></div>
  </article>`;
};

const itemsViewHtml = () => {
  const items = filteredItems();
  if (!items.length && state.view !== "form") return `<div class="tdg-work-empty">${state.loading ? "Carregando itens..." : "Nenhum item neste quadro."}</div>`;
  if (state.view === "kanban") return `<div class="tdg-work-kanban">${boardStatuses().map((status) => {
    const columnItems = items.filter((item) => item.status === status.id);
    return `<section style="--status-color:${esc(status.color)}"><header><strong>${esc(status.label)}</strong><span>${columnItems.length}</span></header><div>${columnItems.length ? columnItems.map((item) => compactItemHtml(item)).join("") : "<small>Nenhum item</small>"}</div></section>`;
  }).join("")}</div>`;
  if (state.view === "calendar") {
    const dated = [...items].sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
    return `<div class="tdg-work-calendar">${dated.map((item) => `<section><time>${esc(item.dueDate ? new Date(`${item.dueDate}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", weekday: "short" }) : "Sem prazo")}</time>${compactItemHtml(item, "calendar-item")}</section>`).join("")}</div>`;
  }
  if (state.view === "timeline") {
    const dated = items.filter((item) => item.dueDate).sort((a, b) => String(a.fields?.startDate || a.dueDate).localeCompare(String(b.fields?.startDate || b.dueDate)));
    const allDates = dated.flatMap((item) => [item.fields?.startDate || item.dueDate, item.dueDate]).filter(Boolean).sort();
    const start = new Date(`${allDates[0] || today()}T12:00:00`);
    const end = new Date(`${allDates.at(-1) || today()}T12:00:00`);
    const span = Math.max(1, (end - start) / 86400000 + 1);
    return `<div class="tdg-work-timeline"><header><span>${esc(start.toLocaleDateString("pt-BR"))}</span><strong>Linha do tempo</strong><span>${esc(end.toLocaleDateString("pt-BR"))}</span></header>${dated.map((item) => {
      const itemStart = new Date(`${item.fields?.startDate || item.dueDate}T12:00:00`);
      const itemEnd = new Date(`${item.dueDate}T12:00:00`);
      const left = Math.max(0, ((itemStart - start) / 86400000) / span * 100);
      const width = Math.max(3, (((itemEnd - itemStart) / 86400000) + 1) / span * 100);
      return `<article data-item-id="${esc(item.id)}"><button type="button" data-work-open>${esc(item.title)}</button><div><span style="left:${left}%;width:${Math.min(100 - left, width)}%"></span></div><small>${esc(item.responsible || "Sem responsável")}</small></article>`;
    }).join("")}</div>`;
  }
  if (state.view === "gantt") {
    return `<div class="tdg-work-gantt"><header><strong>Item</strong><span>Início</span><span>Prazo</span><span>Progresso</span><span>Dependências</span></header>${items.map((item) => `<article data-item-id="${esc(item.id)}"><button type="button" data-work-open>${item.fields?.milestone ? "◆ " : ""}${esc(item.title)}</button><span>${esc(item.fields?.startDate || "Sem início")}</span><span>${esc(item.dueDate || "Sem prazo")}</span><span><i style="width:${Math.max(0, Math.min(100, Number(item.fields?.progress || (item.status === "concluido" ? 100 : 0))))}%"></i></span><small>${(item.dependencies || []).length}</small></article>`).join("")}</div>`;
  }
  if (state.view === "dashboard") {
    const total = Math.max(1, items.length);
    const ownerCounts = Object.entries(items.reduce((acc, item) => ({ ...acc, [item.responsible || "Sem responsável"]: (acc[item.responsible || "Sem responsável"] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
    const boardCounts = Object.entries(state.items.filter((item) => !item.archivedAt).reduce((acc, item) => {
      const name = state.boards.find((board) => board.id === item.boardId)?.name || "Sem quadro";
      acc[name] = (acc[name] || 0) + 1;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]);
    const crossTotal = Math.max(1, boardCounts.reduce((sum, [, count]) => sum + count, 0));
    return `<div class="tdg-work-dashboard"><section><header><strong>Status</strong><small>${items.length} itens</small></header>${boardStatuses().map((status) => { const count = items.filter((item) => item.status === status.id).length; return `<div><span>${esc(status.label)}</span><i><b style="width:${count / total * 100}%;background:${esc(status.color)}"></b></i><strong>${count}</strong></div>`; }).join("")}</section><section><header><strong>Responsáveis</strong><small>Distribuição atual</small></header>${ownerCounts.slice(0, 8).map(([owner, count]) => `<div><span>${esc(owner)}</span><i><b style="width:${count / total * 100}%"></b></i><strong>${count}</strong></div>`).join("")}</section><section><header><strong>BI multi-board</strong><small>Todos os quadros carregados</small></header>${boardCounts.slice(0, 8).map(([name, count]) => `<div><span>${esc(name)}</span><i><b style="width:${count / crossTotal * 100}%"></b></i><strong>${count}</strong></div>`).join("")}</section></div>`;
  }
  if (state.view === "workload") {
    const owners = Object.entries(items.reduce((acc, item) => {
      const key = item.responsible || "Sem responsável";
      const hours = Number(item.fields?.estimatedHours || 0);
      acc[key] = { items: (acc[key]?.items || 0) + 1, hours: (acc[key]?.hours || 0) + hours, overdue: (acc[key]?.overdue || 0) + Number(Boolean(item.dueDate && item.dueDate < today() && item.status !== "concluido")) };
      return acc;
    }, {}));
    return `<div class="tdg-workload"><header><strong>Responsável</strong><span>Itens</span><span>Horas estimadas</span><span>Atrasos</span><span>Ocupação</span></header>${owners.map(([owner, data]) => `<article><strong>${esc(owner)}</strong><span>${data.items}</span><span>${data.hours || "Não estimado"}</span><span>${data.overdue}</span><i><b class="${data.hours > 40 ? "over" : ""}" style="width:${Math.min(100, data.hours / 40 * 100)}%"></b></i></article>`).join("")}</div>`;
  }
  if (state.view === "gallery") return `<div class="tdg-work-gallery">${items.map((item) => compactItemHtml(item)).join("")}</div>`;
  if (state.view === "form") return `<div class="tdg-work-public-form"><header><span class="tdg-kicker">FORMULÁRIO DO QUADRO</span><h3>${esc(activeBoard()?.name || "Novo item")}</h3><p>Registre uma solicitação diretamente neste fluxo.</p></header><button class="tdg-action" type="button" data-work-new-form>Preencher formulário</button>${formHtml()}</div>`;
  if (state.view === "map") {
    const located = items.filter((item) => item.fields?.location);
    return `<div class="tdg-work-map"><div class="tdg-map-canvas"><span>Visualização geográfica</span>${located.map((item, index) => `<button type="button" data-item-id="${esc(item.id)}" data-work-open style="--x:${12 + (index * 23) % 76}%;--y:${16 + (index * 31) % 68}%" title="${esc(item.fields.location)}">${index + 1}</button>`).join("")}</div><aside>${located.length ? located.map((item, index) => `<article data-item-id="${esc(item.id)}"><b>${index + 1}</b><button type="button" data-work-open>${esc(item.title)}</button><small>${esc(item.fields.location)}</small><a href="https://www.openstreetmap.org/search?query=${encodeURIComponent(item.fields.location)}" target="_blank" rel="noopener noreferrer">Abrir mapa</a></article>`).join("") : '<p class="tdg-work-empty">Adicione uma localização aos itens para vê-los no mapa.</p>'}</aside></div>`;
  }
  if (state.view === "pivot") {
    const statuses = boardStatuses();
    const owners = [...new Set(items.map((item) => item.responsible || "Sem responsável"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    const statusTotals = statuses.map((status) => items.filter((item) => item.status === status.id).length);
    return `<div class="tdg-work-pivot" style="--pivot-columns:${statuses.length}"><header><strong>Responsável</strong>${statuses.map((status) => `<span>${esc(status.label)}</span>`).join("")}<b>Total</b></header>${owners.map((owner) => {
      const row = statuses.map((status) => items.filter((item) => (item.responsible || "Sem responsável") === owner && item.status === status.id).length);
      return `<article><strong>${esc(owner)}</strong>${row.map((count) => `<span>${count}</span>`).join("")}<b>${row.reduce((sum, count) => sum + count, 0)}</b></article>`;
    }).join("")}<footer><strong>Total</strong>${statusTotals.map((count) => `<span>${count}</span>`).join("")}<b>${items.length}</b></footer></div>`;
  }
  return `<div class="tdg-work-list">${boardGroups().map((group) => {
    const grouped = items.filter((item) => (item.fields?.groupId || boardGroups()[0]?.id) === group.id);
    return `<section class="tdg-work-group" style="--group-color:${esc(group.color)}"><header><strong>${esc(group.name)}</strong><span>${grouped.length}</span></header>${grouped.length ? grouped.map(rowHtml).join("") : '<p class="tdg-work-empty">Nenhum item neste grupo.</p>'}</section>`;
  }).join("")}</div>`;
};

const renderWorkCenter = () => {
  const root = document.querySelector("[data-tdg-work-center-root]");
  if (!root) return;
  const board = activeBoard();
  const summary = summarizeWorkCenter(boardItems().map((item) => ({ ...item, fields: { ...(item.fields || {}), dueDate: item.dueDate, responsible: item.responsible, client: item.client } })));
  const availableViews = (board?.config?.views || supportedViews.map(([id]) => id));
  root.innerHTML = `${boardFormHtml()}<section class="tdg-panel tdg-work-center">
    <div class="tdg-work-center-head"><div><span class="tdg-kicker">CENTRAL DE TRABALHO</span><h2>${esc(board?.name || "Central de Trabalho")}</h2><p>${esc(board?.description || "Quadros compartilhados da To Do Green.")}</p></div><div class="tdg-work-center-actions"><button class="tdg-login-secondary" type="button" data-work-sync>${state.loading ? "Sincronizando..." : "Atualizar"}</button>${state.canWrite ? '<button class="tdg-login-secondary" type="button" data-board-edit>Configurar quadro</button><button class="tdg-action" type="button" data-work-new>+ Novo item</button>' : ""}<button class="tdg-login-secondary" type="button" data-work-ai>Analisar com IA</button></div></div>
    ${(state.error || state.notice) ? `<div class="tdg-alert"><span>${esc(state.error || state.notice)}</span></div>` : ""}
    <div class="tdg-work-center-layout"><aside class="tdg-board-sidebar"><header><strong>Quadros</strong>${state.canWrite ? '<button type="button" data-board-new aria-label="Novo quadro">+</button>' : ""}</header>${state.boards.map((item) => `<button type="button" data-board-id="${esc(item.id)}" class="${item.id === state.activeBoardId ? "active" : ""}"><strong>${esc(item.name)}</strong><small>${contarItens(state.items.filter((work) => work.boardId === item.id && !work.archivedAt).length)}</small></button>`).join("")}</aside>
    <div class="tdg-board-main"><div class="tdg-work-metrics"><span><small>Ativos</small><strong>${summary.total}</strong></span><span><small>Atrasados</small><strong>${summary.overdue}</strong></span><span><small>Bloqueados</small><strong>${summary.blocked}</strong></span><span><small>Aprovações</small><strong>${summary.pendingApprovals}</strong></span></div>
    <div class="tdg-board-toolbar"><input data-work-search value="${esc(state.search)}" placeholder="Buscar título, cliente, operação ou responsável"><select data-work-filter><option value="todos">Todos os status</option>${boardStatuses().map((status) => `<option value="${esc(status.id)}" ${status.id === state.status ? "selected" : ""}>${esc(status.label)}</option>`).join("")}</select></div>
    <div class="tdg-work-view-switch" aria-label="Visualização do quadro">${supportedViews.filter(([id]) => availableViews.includes(id)).map(([id, text]) => `<button type="button" data-work-view="${id}" class="${state.view === id ? "active" : ""}">${text}</button>`).join("")}</div>
    <section class="tdg-work-automation"><button type="button" data-automation-toggle><span><strong>Automações</strong><small>${state.automationRules.filter((rule) => !rule.boardId || rule.boardId === state.activeBoardId).length} regras neste fluxo</small></span><b>${state.showAutomations ? "Ocultar" : "Gerenciar"}</b></button>${state.showAutomations && state.canWrite ? '<button class="tdg-login-secondary" type="button" data-automation-new>+ Criar regra</button>' : ""}</section>
    ${state.showAutomations ? `${automationFormHtml()}${automationRulesHtml()}` : ""}
    ${formHtml()}${itemsViewHtml()}
    ${state.aiResult || state.aiBusy ? `<div class="tdg-ai-panel"><strong>Assistente da Central</strong><small>Analisa somente os registros carregados e usa a camada de IA da To Do Green.</small><textarea readonly placeholder="A análise aparecerá aqui.">${esc(state.aiResult)}</textarea>${state.aiBusy ? "<small>Analisando...</small>" : ""}</div>` : ""}</div></div></section>${itemDetailHtml()}`;

  root.querySelector("[data-work-sync]")?.addEventListener("click", sync);
  root.querySelector("[data-work-new]")?.addEventListener("click", () => { state.showForm = true; renderWorkCenter(); });
  root.querySelector("[data-work-new-form]")?.addEventListener("click", () => { state.showForm = true; renderWorkCenter(); });
  root.querySelector("[data-work-cancel]")?.addEventListener("click", () => { state.showForm = false; renderWorkCenter(); });
  root.querySelector("[data-work-form]")?.addEventListener("submit", (event) => { event.preventDefault(); createItem(event.currentTarget); });
  root.querySelector("[data-board-new]")?.addEventListener("click", () => { state.showBoardForm = "new"; renderWorkCenter(); });
  root.querySelector("[data-board-edit]")?.addEventListener("click", () => { state.showBoardForm = "edit"; renderWorkCenter(); });
  root.querySelectorAll("[data-board-cancel]").forEach((button) => button.addEventListener("click", () => { state.showBoardForm = false; renderWorkCenter(); }));
  root.querySelector("[data-board-form]")?.addEventListener("submit", (event) => { event.preventDefault(); saveBoard(event.currentTarget); });
  const itemForm = root.querySelector("[data-work-form]");
  const syncClientContacts = () => {
    if (!itemForm) return;
    const client = state.clients.find((candidate) => candidate.id === itemForm.elements.clientId?.value);
    const select = itemForm.elements.contactId;
    if (!select) return;
    const contacts = client?.contacts || [];
    select.innerHTML = `<option value="">${contacts.length ? "Selecione o contato" : "Nenhum contato com cadastro"}</option>${contacts.map((contact) => `<option value="${esc(contact.id)}">${esc(contact.name)}${contact.phone ? " · WhatsApp disponível" : " · sem telefone"}</option>`).join("")}`;
    select.disabled = !contacts.length;
  };
  itemForm?.elements.clientId?.addEventListener("change", syncClientContacts);
  syncClientContacts();
  root.querySelector("[data-automation-new]")?.addEventListener("click", () => { state.showAutomationForm = true; renderWorkCenter(); });
  root.querySelector("[data-automation-toggle]")?.addEventListener("click", () => { state.showAutomations = !state.showAutomations; renderWorkCenter(); });
  root.querySelector("[data-automation-cancel]")?.addEventListener("click", () => { state.showAutomationForm = false; renderWorkCenter(); });
  root.querySelector("[data-automation-form]")?.addEventListener("submit", (event) => { event.preventDefault(); createAutomationRule(event.currentTarget); });
  const automationForm = root.querySelector("[data-automation-form]");
  const syncAutomationFields = () => {
    if (!automationForm) return;
    const selected = automationForm.elements.actionType?.value;
    automationForm.querySelectorAll("[data-action-value]").forEach((field) => {
      const active = field.dataset.actionValue === selected;
      field.hidden = !active;
      field.querySelectorAll("input,select").forEach((control) => { control.disabled = !active; });
    });
  };
  automationForm?.elements.actionType?.addEventListener("change", syncAutomationFields);
  syncAutomationFields();
  root.querySelectorAll("[data-rule-id]").forEach((row) => {
    const rule = state.automationRules.find((candidate) => candidate.id === row.dataset.ruleId);
    if (!rule) return;
    row.querySelector("[data-rule-toggle]")?.addEventListener("click", () => toggleAutomationRule(rule));
    row.querySelector("[data-rule-delete]")?.addEventListener("click", () => deleteAutomationRule(rule));
  });
  root.querySelectorAll("[data-board-id]").forEach((button) => button.addEventListener("click", () => { state.activeBoardId = button.dataset.boardId; state.search = ""; state.status = "todos"; state.aiResult = ""; state.showForm = false; restoreView(); renderWorkCenter(); }));
  root.querySelector("[data-work-search]")?.addEventListener("input", (event) => { state.search = event.target.value; renderWorkCenter(); });
  root.querySelector("[data-work-filter]")?.addEventListener("change", (event) => { state.status = event.target.value; renderWorkCenter(); });
  root.querySelectorAll("[data-work-view]").forEach((button) => button.addEventListener("click", () => { setView(button.dataset.workView); renderWorkCenter(); }));
  root.querySelectorAll("[data-item-id]").forEach((row) => {
    const item = state.items.find((candidate) => candidate.id === row.dataset.itemId);
    if (!item) return;
    row.querySelectorAll("[data-field]").forEach((field) => field.addEventListener("change", (event) => patchItem(item, { [event.target.dataset.field]: event.target.value })));
    (row.matches("[data-work-open]") ? row : row.querySelector("[data-work-open]"))?.addEventListener("click", () => openItem(item.id));
    row.querySelector("[data-work-remove]")?.addEventListener("click", () => archiveItem(item));
    row.querySelector("[data-whatsapp-confirm]")?.addEventListener("click", () => confirmWhatsapp(item));
  });
  root.querySelectorAll("[data-detail-close]").forEach((button) => button.addEventListener("click", closeItem));
  root.querySelectorAll("[data-detail-tab]").forEach((button) => button.addEventListener("click", () => { state.detailTab = button.dataset.detailTab; renderWorkCenter(); }));
  root.querySelector("[data-detail-form]")?.addEventListener("submit", (event) => { event.preventDefault(); saveDetail(event.currentTarget); });
  root.querySelector("[data-detail-files]")?.addEventListener("change", async (event) => {
    const item = state.detail?.item;
    if (!item) return;
    const next = await addAttachmentsFromFiles(event.target.files, item.fields?.attachments || [], (message) => { state.error = message; });
    event.target.value = "";
    await patchItem(item, { fields: { ...(item.fields || {}), attachments: next } }, { keepDetail: true });
  });
  root.querySelector("[data-comment-form]")?.addEventListener("submit", (event) => { event.preventDefault(); addComment(event.currentTarget); });
  root.querySelector("[data-add-subitem]")?.addEventListener("click", () => {
    const title = prompt("Nome do subitem:");
    if (title) addSubitem(title);
  });
  root.querySelectorAll("[data-open-subitem]").forEach((button) => button.addEventListener("click", () => openItem(button.dataset.openSubitem)));
  root.querySelector("[data-work-ai]")?.addEventListener("click", async () => {
    if (!board || state.aiBusy) return;
    state.aiBusy = true; state.aiResult = ""; renderWorkCenter();
    const request = buildWorkCenterAiRequest({ action: "identify-bottlenecks", specialist: board.specialist, item: { board: board.name, items: boardItems().slice(0, 100), summary }, boardContext: `${board.name} da transportadora sustentável To Do Green`, instruction: "Identifique atrasos, riscos, responsáveis ausentes e próximos passos. Não invente números." });
    try {
      const response = await fetch(request.endpoint, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ prompt: request.prompt, specialist: request.specialist }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível analisar agora.");
      state.aiResult = payload.content || "Análise concluída sem conteúdo.";
    } catch (error) { state.aiResult = error.message; }
    finally { state.aiBusy = false; renderWorkCenter(); }
  });
};

// A entrada de "Projetos e tarefas" é o cartão fixo no topo do menu lateral.
// Este módulo injetava um segundo botão dentro do menu "Configurações", o que
// fazia a titular perguntar por que projetos viraram configuração — não são.
// A injeção saiu; o toggle de classe abaixo tolera a ausência do botão.

const render = () => {
  if (!location.pathname.startsWith("/todogreen")) return;
  const active = location.pathname.includes("/central-trabalho");
  const main = document.querySelector("main.tdg");
  if (!main) return;
  let root = main.querySelector("[data-tdg-work-center-root]");
  if (!root) { root = document.createElement("div"); root.dataset.tdgWorkCenterRoot = "true"; main.appendChild(root); }
  const pageContent = main.querySelector("[data-tdg-page-content]");
  if (pageContent) pageContent.style.display = active ? "none" : "";
  // Simétrico ao que a Frota já faz: se os dois painéis chegarem a existir ao
  // mesmo tempo, cada um esconde o do outro ao assumir a tela — nenhum fica
  // visível por baixo do que a pessoa está de fato vendo.
  const fleetRoot = main.querySelector("[data-tdg-fleet-root]");
  if (active && fleetRoot) fleetRoot.style.display = "none";
  root.style.display = active ? "block" : "none";
  document.querySelector("[data-tdg-work-center-tab]")?.classList.toggle("active", active);
  if (active) { renderWorkCenter(); if (!state.boards.length && !state.loading) sync(); }
};

// Ver o comentário equivalente em LogisticsVerticalFleet.js: esperar só por
// `main.tdg` não bastava, porque `[data-tdg-page-content]` — o que `render()`
// de fato precisa achar pra esconder o conteúdo do dashboard — pode chegar num
// commit do React posterior. Espera o elemento certo, com um observer de um
// disparo só.
const waitForShell = () => {
  if (document.querySelector("[data-tdg-page-content]")) { render(); return; }
  const alvo = document.getElementById("root") || document.body;
  const observer = new MutationObserver(() => {
    if (!document.querySelector("[data-tdg-page-content]")) return;
    observer.disconnect();
    render();
  });
  observer.observe(alvo, { childList: true, subtree: true });
};

if (typeof window !== "undefined") {
  loadCache();
  state.loading = false;
  const start = () => {
    waitForShell();
  };
  window.addEventListener("popstate", render);
  window.addEventListener("pageshow", render);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
}
