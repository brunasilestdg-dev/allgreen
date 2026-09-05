// ===== Tarefas =====
//
// A maior tela do produto: lista, quadro, calendário, subtarefas, dependências,
// recorrência, anexos, ações em lote, missões e revisão. Três mil linhas que
// moravam no meio de App.jsx, entre o painel e "meu trabalho".
//
// O corte é literal — nenhuma linha foi reescrita ao mudar de arquivo. O que um
// refactor de tamanho assim não pode fazer é misturar mudança de lugar com
// mudança de comportamento: aí o diff deixa de mostrar o movimento e passa a
// esconder o bug.

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Award,
  BadgeCheck,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Edit3,
  GripVertical,
  ListTodo,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  RotateCcw,
  Save,
  Search,
  Target,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import Modal from "../../components/Modal.jsx";
import Markdown from "../../components/Markdown.jsx";
import SharingFields from "../../components/SharingFields.jsx";
import {
  AttachmentList,
  addAttachmentsFromFiles,
} from "../../components/Anexos.jsx";
import {
  Button,
  Empty,
  Field,
  FilterSelect,
  LIST_PAGE_SIZE,
  LoadMoreButton,
  PageTitle,
} from "../../components/ui.jsx";
import { money } from "../../components/formato.js";
import { today, uid } from "../../domain.js";
import {
  RECURRENCE_OPTIONS,
  addBusinessDays,
  buildTaskCalendar,
  nextRecurrenceDue,
  shiftYearMonth,
  todayYearMonth,
} from "../../domain/datas.js";
import { specialistData } from "../../domain/especialistas.js";
import {
  MILESTONE_TYPES,
  PROJECT_STATUSES,
  createProjectRecord,
  normalizeGovernanceItem,
  projectMetrics,
} from "../projects/projectDomain.js";
import {
  buildProjectSchedule,
  ganttPosition,
  ganttWidth,
  scheduleRiskSummary,
} from "../projects/scheduleDomain.js";
import {
  buildDigitalTaskPrompt,
  buildTaskStructurePrompt,
  localTaskStructure,
  parseTaskStructure,
  prioritizeTaskBacklog,
  proximaAcaoDaTarefa,
  taskCompletionGaps,
} from "./taskAiDomain.js";
import { taskUrgency } from "./taskUrgencia.js";
import {
  patchPlannerDaTarefa,
  tarefaVinculadaAoPlanner,
} from "../logistics/plannerIntegrationDomain.js";
import {
  createGoogleCalendarEventReal,
  googleCalendarUrl,
} from "../../integrations/google.js";
import { activeSpaceId, authHeaders } from "../../session/armazenamento.js";
import {
  aiWorkspaceContext,
  trackProductEvent,
} from "../../session/telemetria.js";
import { pushNotification } from "../../App.jsx";

export default function Tasks({
  AreaToolkit,
  db,
  update,
  business,
  setToast,
  go,
  searchSeed,
  clearSearchSeed,
  workspaceAction,
}) {
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [taskAiBusy, setTaskAiBusy] = useState(false);
  const [taskAiError, setTaskAiError] = useState("");
  const [search, setSearch] = useState("");
  const [targetTaskId, setTargetTaskId] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("task") || "");
  const searchTerm = searchSeed || search;
  useEffect(() => {
    if (!searchSeed) return undefined;
    const id = setTimeout(() => {
      clearSearchSeed?.();
    }, 0);
    return () => clearTimeout(id);
  }, [clearSearchSeed, searchSeed]);
  const [view, setView] = useState("board");
  const [calendarMonth, setCalendarMonth] = useState(todayYearMonth);
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [priorityFilter, setPriorityFilter] = useState("Todas");
  const [assigneeFilter, setAssigneeFilter] = useState("Todos");
  const [projectFilter, setProjectFilter] = useState("Todos");
  const [archiveFilter, setArchiveFilter] = useState("Ativas");
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  useEffect(() => {
    const id = setTimeout(() => setVisibleCount(LIST_PAGE_SIZE), 0);
    return () => clearTimeout(id);
  }, [
    searchTerm,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    projectFilter,
    archiveFilter,
  ]);
  const [realMembers, setRealMembers] = useState([]);
  const [deadlineCalc, setDeadlineCalc] = useState({
    open: false,
    base: today(),
    days: "5",
  });
  const [deliveryFeedback, setDeliveryFeedback] = useState({
    wasClear: false,
    neededHelp: false,
  });
  const [reviewFeedback, setReviewFeedback] = useState({
    followedInstructions: false,
    autonomous: false,
  });
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dragOverStatus, setDragOverStatus] = useState(null);
  const kanbanRef = useRef(null);
  const touchDragRef = useRef({
    taskId: null,
    startX: 0,
    startY: 0,
    timer: null,
    active: false,
  });
  const clearTouchDrag = () => {
    if (touchDragRef.current.timer) clearTimeout(touchDragRef.current.timer);
    touchDragRef.current = {
      taskId: null,
      startX: 0,
      startY: 0,
      timer: null,
      active: false,
    };
  };
  const onCardTouchStart = (t) => (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    clearTouchDrag();
    touchDragRef.current = {
      taskId: t.id,
      startX: touch.clientX,
      startY: touch.clientY,
      timer: setTimeout(() => {
        touchDragRef.current.active = true;
        setDraggedTaskId(t.id);
      }, 350),
      active: false,
    };
  };
  const onCardTouchEnd = () => {
    const state = touchDragRef.current;
    if (state.active && state.taskId && dragOverStatus) {
      const task = items.find((x) => x.id === state.taskId);
      if (task && task.status !== dragOverStatus)
        changeTaskStatus(task, dragOverStatus);
    }
    clearTouchDrag();
    setDraggedTaskId(null);
    setDragOverStatus(null);
  };
  useEffect(() => {
    const el = kanbanRef.current;
    if (!el) return undefined;
    const handleTouchMove = (e) => {
      const state = touchDragRef.current;
      if (!state.taskId) return;
      const touch = e.touches[0];
      if (!state.active) {
        const dx = Math.abs(touch.clientX - state.startX);
        const dy = Math.abs(touch.clientY - state.startY);
        if (dx > 10 || dy > 10) clearTouchDrag();
        return;
      }
      e.preventDefault();
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const column = target?.closest("[data-kanban-status]");
      setDragOverStatus(
        column ? column.getAttribute("data-kanban-status") : null,
      );
    };
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", handleTouchMove);
  }, []);
  const [deliveryAttachments, setDeliveryAttachments] = useState([]);
  const taskAttachRef = useRef(null);
  const deliveryAttachRef = useRef(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAssignee, setBulkAssignee] = useState("");
  const blankProject = {
    name: "",
    description: "",
    objective: "",
    scope: "",
    deliverables: "",
    successCriteria: "",
    sponsor: "",
    manager: "",
    startDate: "",
    dueDate: "",
    status: "Planejamento",
    priority: "Média",
    budgetPlanned: "",
    costActual: "",
    hoursPlanned: "",
    hoursActual: "",
    workdays: [1, 2, 3, 4, 5],
    holidays: "",
    milestones: [],
    risks: [],
    issues: [],
    decisions: [],
    changeRequests: [],
  };
  const [projectForm, setProjectForm] = useState(blankProject);
  const [milestoneDraft, setMilestoneDraft] = useState({
    title: "",
    type: "Entrega",
    plannedDate: "",
    ownerName: "",
  });
  const [governanceDraft, setGovernanceDraft] = useState({
    kind: "risk",
    title: "",
    description: "",
    ownerName: "",
    severity: "Média",
    dueDate: "",
  });
  const [editingProject, setEditingProject] = useState(null);
  const saveProject = (e) => {
    e.preventDefault();
    if (!projectForm.name.trim()) return;
    update((d) => {
      const previous = (d.projects || []).find((p) => p.id === editingProject);
      const item = createProjectRecord(
        projectForm,
        { businessId: business?.id, ownerId: db.user.id },
        previous,
      );
      return {
        ...d,
        projects: editingProject
          ? (d.projects || []).map((p) => (p.id === editingProject ? item : p))
          : [...(d.projects || []), item],
      };
    });
    setToast(editingProject ? "Projeto atualizado" : "Projeto criado");
    setProjectForm(blankProject);
    setEditingProject(null);
  };
  const editProject = (project) => {
    setEditingProject(project.id);
    setProjectForm({ ...blankProject, ...project });
  };
  const cancelProjectEdit = () => {
    setEditingProject(null);
    setProjectForm(blankProject);
  };
  const removeProject = (id) => {
    if (
      !confirm(
        "Excluir este projeto? As tarefas já criadas com esse nome não são apagadas.",
      )
    )
      return;
    update((d) => ({
      ...d,
      projects: (d.projects || []).filter((p) => p.id !== id),
    }));
    if (editingProject === id) cancelProjectEdit();
    setToast("Projeto excluído");
  };
  const addMilestone = () => {
    if (!milestoneDraft.title.trim()) return;
    setProjectForm((current) => ({
      ...current,
      milestones: [
        ...(current.milestones || []),
        { ...milestoneDraft, id: uid(), status: "Pendente" },
      ],
    }));
    setMilestoneDraft({
      title: "",
      type: "Entrega",
      plannedDate: "",
      ownerName: "",
    });
  };
  const removeMilestone = (id) =>
    setProjectForm((current) => ({
      ...current,
      milestones: (current.milestones || []).filter((item) => item.id !== id),
    }));
  const governanceCollection = {
    risk: "risks",
    issue: "issues",
    decision: "decisions",
    change: "changeRequests",
  };
  const addGovernanceItem = () => {
    if (!governanceDraft.title.trim()) return;
    const collection = governanceCollection[governanceDraft.kind];
    const status =
      governanceDraft.kind === "decision"
        ? "Registrada"
        : governanceDraft.kind === "change"
          ? "Solicitada"
          : "Aberto";
    const item = normalizeGovernanceItem(
      { ...governanceDraft, status },
      governanceDraft.kind,
    );
    setProjectForm((current) => ({
      ...current,
      [collection]: [...(current[collection] || []), item],
    }));
    setGovernanceDraft({
      kind: governanceDraft.kind,
      title: "",
      description: "",
      ownerName: "",
      severity: "Média",
      dueDate: "",
    });
  };
  const removeGovernanceItem = (kind, id) => {
    const collection = governanceCollection[kind];
    setProjectForm((current) => ({
      ...current,
      [collection]: (current[collection] || []).filter(
        (item) => item.id !== id,
      ),
    }));
  };
  const [googleId, setGoogleId] = useState("");
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => setGoogleId(d.googleClientId || ""))
      .catch(() => {});
  }, []);
  const addTaskToCalendar = async (task) => {
    try {
      await createGoogleCalendarEventReal(googleId, task);
      setToast("Evento adicionado à sua Google Agenda");
    } catch {
      window.open(googleCalendarUrl(task), "_blank", "noopener");
    }
  };
  const blankTask = {
    title: "",
    description: "",
    priority: "Média",
    status: "A fazer",
    startDate: "",
    due: "",
    estimatedDays: "1",
    baselineStart: "",
    baselineDue: "",
    area: "Operação",
    assigneeType: "real",
    assignee: "",
    assigneeId: "",
    project: "",
    isMission: false,
    distribution: "atribuida",
    difficulty: "Simples",
    slots: "1",
    points: "",
    reward: "",
    approvalMode: "imediata",
    allowWithdrawal: true,
    assignees: [],
    interested: [],
    missionStatus: "",
    deliveries: [],
    deliveryDraft: "",
    visibility: "privado",
    sharedWith: [],
    sharedTeams: [],
    subtasks: [],
    subtaskDraft: "",
    acceptanceCriteria: [],
    criterionDraft: "",
    aiOutputs: [],
    aiRisks: [],
    aiQuestions: [],
    aiSuggestedSpecialist: "",
    dependsOn: [],
    attachments: [],
    recurrence: { frequency: "none" },
  };
  const [form, setForm] = useState(blankTask);
  const digitalCollaborators = [
    ...specialistData.map(([name]) => name),
    ...(db.customSpecialists || []).map((item) => item.name),
  ];
  useEffect(() => {
    let cancelled = false;
    const space = activeSpaceId();
    fetch(`/api/collab${space ? `?owner=${encodeURIComponent(space)}` : ""}`, {
      headers: authHeaders(),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setRealMembers(data?.members || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const statuses = ["A fazer", "Em andamento", "Aguardando", "Concluído"];
  const scoped = db.tasks.filter(
    (task) => !business || task.businessId === business.id,
  );
  const focusQueue = prioritizeTaskBacklog(scoped, { now: today() }).slice(
    0,
    3,
  );
  const assignees = [
    ...new Set(scoped.map((task) => task.assignee).filter(Boolean)),
  ];
  const projects = [
    ...new Set([
      ...(db.projects || []).map((p) => p.name),
      ...scoped.map((task) => task.project).filter(Boolean),
    ]),
  ];
  const ganttProject =
    projectFilter !== "Todos"
      ? (db.projects || []).find((project) => project.name === projectFilter)
      : null;
  const ganttSchedule = ganttProject
    ? buildProjectSchedule(db.tasks, ganttProject, {
        holidays: ganttProject.holidays || [],
        workdays: ganttProject.workdays || [1, 2, 3, 4, 5],
      })
    : null;
  const ganttRisks = ganttSchedule ? scheduleRiskSummary(ganttSchedule) : null;
  const applyCalculatedSchedule = () => {
    if (!ganttSchedule?.valid) {
      setToast("Corrija as dependências circulares antes de reprogramar.");
      return;
    }
    const calculated = new Map(ganttSchedule.rows.map((row) => [row.id, row]));
    update((current) => ({
      ...current,
      tasks: current.tasks.map((task) => {
        const row = calculated.get(task.id);
        if (!row) return task;
        return {
          ...task,
          startDate: row.start,
          due: row.end,
          estimatedDays: row.duration,
          baselineStart: task.baselineStart || task.startDate || row.start,
          baselineDue: task.baselineDue || task.due || row.end,
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    setToast("Cronograma aplicado sem alterar a baseline.");
  };
  const items = db.tasks.filter(
    (t) =>
      (!targetTaskId || t.id === targetTaskId) &&
      (!business || t.businessId === business.id) &&
      `${t.title} ${t.description || ""} ${t.assignee || ""} ${t.project || ""}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) &&
      (statusFilter === "Todos" || t.status === statusFilter) &&
      (priorityFilter === "Todas" || t.priority === priorityFilter) &&
      (assigneeFilter === "Todos" || t.assignee === assigneeFilter) &&
      (projectFilter === "Todos" || t.project === projectFilter) &&
      (archiveFilter === "Todas" ||
        (archiveFilter === "Arquivadas" ? !!t.archived : !t.archived)),
  );
  const editingTask = editing ? db.tasks.find((t) => t.id === editing) : null;
  const availableMissions = db.tasks.filter(
    (t) =>
      (!business || t.businessId === business.id) &&
      t.isMission &&
      t.distribution === "disponivel" &&
      !t.archived &&
      (t.assignees || []).length < (t.slots || 1),
  );
  const openTask = (task = null) => {
    setEditing(task?.id || null);
    setForm(
      task
        ? {
            ...blankTask,
            ...task,
            acceptanceCriteria: (task.acceptanceCriteria || []).map((item) =>
              typeof item === "string"
                ? { id: uid(), text: item, done: false }
                : { ...item, id: item.id || uid() },
            ),
          }
        : blankTask,
    );
    setTaskAiError("");
    setDeadlineCalc({ open: false, base: today(), days: "5" });
    setModal(true);
  };
  const applyTaskStructure = (structure) => {
    const suggestedSpecialist = digitalCollaborators.includes(
      structure.suggestedSpecialist,
    )
      ? structure.suggestedSpecialist
      : "";
    const mergeChecklist = (current, generated, field) => {
      const existing = Array.isArray(current) ? current : [];
      const known = new Set(
        existing.map((item) =>
          String(item?.[field] || "")
            .trim()
            .toLocaleLowerCase("pt-BR"),
        ),
      );
      return [
        ...existing,
        ...(generated || [])
          .filter(
            (text) =>
              text &&
              !known.has(String(text).trim().toLocaleLowerCase("pt-BR")),
          )
          .map((text) => ({ id: uid(), [field]: text, done: false })),
      ];
    };
    setForm((current) => ({
      ...current,
      title: structure.title || current.title,
      description: structure.description || current.description,
      priority: structure.priority || current.priority,
      area: structure.area || current.area,
      estimatedDays: structure.estimatedDays || current.estimatedDays,
      subtasks: mergeChecklist(current.subtasks, structure.subtasks, "title"),
      acceptanceCriteria: mergeChecklist(
        current.acceptanceCriteria,
        structure.acceptanceCriteria,
        "text",
      ),
      aiRisks: structure.risks || [],
      aiQuestions: structure.questions || [],
      aiSuggestedSpecialist: suggestedSpecialist,
      assigneeType: suggestedSpecialist ? "digital" : current.assigneeType,
      assignee: suggestedSpecialist || current.assignee,
    }));
  };
  const structureTaskWithAi = async () => {
    if (!form.title.trim() && !form.description.trim()) {
      setTaskAiError("Escreva ao menos um título ou uma descrição.");
      return;
    }
    setTaskAiBusy(true);
    setTaskAiError("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50_000);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: buildTaskStructurePrompt({
            task: form,
            business,
            projects,
            specialists: digitalCollaborators,
          }),
          specialist: "Diretor",
          ...aiWorkspaceContext(business),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Provedor indisponível");
      const structure = parseTaskStructure(data.content, form);
      if (!structure)
        throw new Error("A resposta não veio no formato esperado");
      applyTaskStructure(structure);
      setToast("Tarefa estruturada com etapas e critérios verificáveis");
    } catch {
      applyTaskStructure(localTaskStructure(form));
      setTaskAiError(
        "A IA externa não respondeu. A contingência local organizou uma versão segura para você revisar.",
      );
      setToast("Tarefa organizada pela contingência local");
    } finally {
      clearTimeout(timer);
      setTaskAiBusy(false);
    }
  };
  const applyDeadlineCalc = () => {
    const due = addBusinessDays(
      deadlineCalc.base,
      Number(deadlineCalc.days) || 0,
    );
    if (due) setForm((current) => ({ ...current, due }));
  };
  const save = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    if (form.status === "Concluído") {
      const gaps = taskCompletionGaps(form);
      if (gaps.length) {
        setToast(`Ainda não pode concluir: ${gaps.join("; ")}`);
        return;
      }
    }
    if (
      form.status === "Concluído" &&
      editingTask &&
      editingTask.status !== "Concluído" &&
      isBlocked(editingTask)
    ) {
      setToast(
        `Bloqueada: conclua antes "${blockingTasks(editingTask)
          .map((dep) => dep.title)
          .join('", "')}"`,
      );
      return;
    }
    const now = new Date().toISOString();
    update((d) => {
      const {
        deliveryDraft: _deliveryDraft,
        subtaskDraft: _subtaskDraft,
        criterionDraft: _criterionDraft,
        ...rest
      } = form;
      const isMission = !!form.isMission;
      const selectedProject = (d.projects || []).find(
        (project) => project.name === form.project,
      );
      const item = {
        ...rest,
        title: form.title.trim(),
        id: editing || uid(),
        businessId: business?.id || form.businessId || null,
        archived: !!form.archived,
        ownerId: form.ownerId || db.user.id,
        projectId: selectedProject?.id || form.projectId || null,
        baselineStart:
          form.baselineStart || (!editing ? form.startDate || "" : ""),
        baselineDue: form.baselineDue || (!editing ? form.due || "" : ""),
        visibility:
          isMission && form.distribution === "disponivel"
            ? "espaco_todo"
            : form.visibility || "privado",
        missionStatus:
          isMission && !editing && form.distribution === "disponivel"
            ? "disponivel"
            : form.missionStatus || "",
        slots: isMission ? Number(form.slots) || 1 : 1,
        points: isMission ? Number(form.points) || 0 : 0,
        reward: isMission ? Number(form.reward) || 0 : 0,
        rewardStatus:
          isMission && Number(form.reward) > 0
            ? form.rewardStatus || "prevista"
            : form.rewardStatus || "",
        assignees: Array.isArray(form.assignees) ? form.assignees : [],
        interested: Array.isArray(form.interested) ? form.interested : [],
        deliveries: Array.isArray(form.deliveries) ? form.deliveries : [],
        sharedWith: Array.isArray(form.sharedWith) ? form.sharedWith : [],
        sharedTeams: Array.isArray(form.sharedTeams) ? form.sharedTeams : [],
        subtasks: Array.isArray(form.subtasks) ? form.subtasks : [],
        acceptanceCriteria: Array.isArray(form.acceptanceCriteria)
          ? form.acceptanceCriteria
          : [],
        aiOutputs: Array.isArray(form.aiOutputs)
          ? form.aiOutputs.slice(0, 3)
          : [],
        dependsOn: Array.isArray(form.dependsOn) ? form.dependsOn : [],
        attachments: Array.isArray(form.attachments) ? form.attachments : [],
        recurrence:
          form.recurrence?.frequency && form.recurrence.frequency !== "none"
            ? {
                frequency: form.recurrence.frequency,
                seriesId: form.recurrence.seriesId || uid(),
              }
            : { frequency: "none" },
        createdAt: form.createdAt || now,
        updatedAt: now,
      };
      return {
        ...d,
        tasks: editing
          ? d.tasks.map((task) => (task.id === editing ? item : task))
          : [item, ...d.tasks],
      };
    });
    if (editingTask && tarefaVinculadaAoPlanner(editingTask)) {
      syncTaskToPlanner(editingTask, {
        title: form.title.trim(),
        description: form.description || "",
        status: form.status,
        priority: form.priority,
        startDate: form.startDate || "",
        due: form.due || "",
        assigneeId: form.assigneeId || "",
        assignee: form.assignee || "",
      });
    }
    const wantsNotify =
      form.assigneeType !== "digital" &&
      form.notify &&
      (form.notifyTo || "").trim();
    setModal(false);
    setEditing(null);
    setForm(blankTask);
    if (wantsNotify) {
      fetch("/api/tasks/notify", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          email: form.notifyTo.trim(),
          title: form.title.trim(),
          description: form.description || "",
          due: form.due || "",
          project: form.project || "",
        }),
      })
        .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) =>
          setToast(
            ok
              ? "Tarefa salva e aviso enviado por e-mail"
              : d.error || "Tarefa salva, mas o aviso por e-mail falhou",
          ),
        )
        .catch(() => setToast("Tarefa salva, mas o aviso por e-mail falhou"));
    } else {
      setToast(editing ? "Tarefa atualizada" : "Tarefa criada");
    }
  };
  const syncTaskToPlanner = (task, changes) => {
    if (!tarefaVinculadaAoPlanner(task)) return;
    fetch(
      `/api/todogreen/planner/planos/${encodeURIComponent(task.plannerPlanId)}/tarefas/${encodeURIComponent(task.plannerTaskId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify(patchPlannerDaTarefa(task, changes)),
      },
    )
      .then(async (resposta) => {
        const corpo = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(corpo.error || "A To-do foi salva, mas o Planner não sincronizou.");
        update((atual) => ({
          ...atual,
          tasks: atual.tasks.map((item) => (
            item.id === task.id ? { ...item, plannerRevision: corpo.revision } : item
          )),
        }));
      })
      .catch((erro) => setToast(erro.message));
  };
  const changeTask = (id, changes) => {
    const task = db.tasks.find((item) => item.id === id);
    update((d) => ({
      ...d,
      tasks: d.tasks.map((item) =>
        item.id === id
          ? { ...item, ...changes, updatedAt: new Date().toISOString() }
          : item,
      ),
    }));
    if (task) syncTaskToPlanner(task, changes);
  };
  const blockingTasks = (task) =>
    (task.dependsOn || [])
      .map((depId) => db.tasks.find((x) => x.id === depId))
      .filter((dep) => dep && dep.status !== "Concluído");
  const isBlocked = (task) => blockingTasks(task).length > 0;
  const changeTaskStatus = (task, newStatus) => {
    if (newStatus === "Concluído") {
      const gaps = taskCompletionGaps(task);
      if (gaps.length) {
        setToast(`Ainda não pode concluir: ${gaps.join("; ")}`);
        return;
      }
    }
    if (newStatus === "Concluído" && isBlocked(task)) {
      setToast(
        `Bloqueada: conclua antes "${blockingTasks(task)
          .map((dep) => dep.title)
          .join('", "')}"`,
      );
      return;
    }
    const frequency = task.recurrence?.frequency;
    const completesRecurring =
      newStatus === "Concluído" &&
      task.status !== "Concluído" &&
      frequency &&
      frequency !== "none";
    if (!completesRecurring) {
      changeTask(task.id, { status: newStatus });
      return;
    }
    const now = new Date().toISOString();
    const nextTask = {
      ...task,
      id: uid(),
      status: "A fazer",
      due: nextRecurrenceDue(task.due, frequency),
      deliveries: [],
      interested: [],
      attachments: [],
      subtasks: (task.subtasks || []).map((item) => ({ ...item, done: false })),
      acceptanceCriteria: (task.acceptanceCriteria || []).map((item) => ({
        ...item,
        done: false,
      })),
      aiOutputs: [],
      missionStatus:
        task.isMission && task.distribution === "disponivel"
          ? "disponivel"
          : "",
      createdAt: now,
      updatedAt: now,
    };
    update((d) => ({
      ...d,
      tasks: [
        nextTask,
        ...d.tasks.map((x) =>
          x.id === task.id ? { ...x, status: newStatus, updatedAt: now } : x,
        ),
      ],
    }));
    setToast("Tarefa concluída — próxima ocorrência criada");
  };
  const notifyUser = (recipientId, message) => {
    if (!recipientId || recipientId === db.user.id) return;
    update((d) => ({
      ...d,
      notifications: pushNotification(d.notifications, {
        recipientId,
        message,
        link: "operacao",
        createdBy: db.user.id,
      }),
    }));
  };
  const expressInterest = async (task) => {
    const already = (task.interested || []).some(
      (i) => i.userId === db.user.id,
    );
    if (already) return;
    try {
      const payload = await workspaceAction("interest", task.id);
      if (!payload?.task) {
        changeTask(task.id, {
          interested: [
            ...(task.interested || []),
            {
              userId: db.user.id,
              name: db.user.name,
              at: new Date().toISOString(),
            },
          ],
        });
        notifyUser(task.ownerId, `Novo interesse em "${task.title}"`);
      }
      setToast("Interesse enviado");
    } catch (error) {
      setToast(error.message || "Não foi possível enviar o interesse");
    }
  };
  const withdrawInterest = async (task) => {
    try {
      const payload = await workspaceAction("withdraw-interest", task.id);
      if (!payload?.task)
        changeTask(task.id, {
          interested: (task.interested || []).filter(
            (i) => i.userId !== db.user.id,
          ),
        });
      setToast("Interesse retirado");
    } catch (error) {
      setToast(error.message || "Não foi possível retirar o interesse");
    }
  };
  const assumeTask = async (task) => {
    if (isBlocked(task)) {
      setToast(
        `Bloqueada: conclua antes "${blockingTasks(task)
          .map((dep) => dep.title)
          .join('", "')}"`,
      );
      return;
    }
    const assignees = task.assignees || [];
    if (assignees.some((a) => a.userId === db.user.id)) return;
    const slots = task.slots || 1;
    if (assignees.length >= slots) {
      setToast("Não há mais vagas disponíveis para esta missão");
      return;
    }
    try {
      const payload = await workspaceAction("assume", task.id);
      if (!payload?.task) {
        const nextAssignees = [
          ...assignees,
          {
            userId: db.user.id,
            name: db.user.name,
            at: new Date().toISOString(),
          },
        ];
        const full = nextAssignees.length >= slots;
        changeTask(task.id, {
          assignees: nextAssignees,
          missionStatus: full ? "em_andamento" : "disponivel",
          status: full ? "Em andamento" : task.status,
        });
        notifyUser(task.ownerId, `Vaga assumida em "${task.title}"`);
      }
      trackProductEvent("task_claimed", {
        module: "operacao",
        kind: "mission",
        success: true,
      });
      setToast("Missão assumida");
    } catch (error) {
      setToast(error.message || "Não foi possível assumir a missão");
    }
  };
  const approveInterested = (task, userId) => {
    const person = (task.interested || []).find((i) => i.userId === userId);
    if (!person) return;
    const assignees = [...(task.assignees || []), person];
    const full = assignees.length >= (task.slots || 1);
    changeTask(task.id, {
      assignees,
      interested: (task.interested || []).filter((i) => i.userId !== userId),
      missionStatus: full ? "em_andamento" : "aguardando_aprovacao",
      status: full ? "Em andamento" : task.status,
    });
    notifyUser(userId, `Você foi aprovado(a) para "${task.title}"`);
    setToast(`${person.name} aprovado(a) para a missão`);
  };
  const rejectInterested = (task, userId) => {
    changeTask(task.id, {
      interested: (task.interested || []).filter((i) => i.userId !== userId),
    });
    setToast("Interesse recusado");
  };
  const submitDelivery = (
    task,
    comment,
    collaboratorFeedback = {},
    attachments = [],
  ) => {
    if (!comment.trim()) return;
    if (isBlocked(task)) {
      setToast(
        `Bloqueada: conclua antes "${blockingTasks(task)
          .map((dep) => dep.title)
          .join('", "')}"`,
      );
      return;
    }
    changeTask(task.id, {
      deliveries: [
        ...(task.deliveries || []),
        {
          id: uid(),
          comment: comment.trim(),
          authorId: db.user.id,
          authorName: db.user.name,
          createdAt: new Date().toISOString(),
          status: "enviada",
          wasClear: !!collaboratorFeedback.wasClear,
          neededHelp: !!collaboratorFeedback.neededHelp,
          attachments: Array.isArray(attachments) ? attachments : [],
        },
      ],
      missionStatus: "enviada_para_revisao",
    });
    notifyUser(task.ownerId, `Nova entrega em "${task.title}"`);
    setToast("Entrega enviada para revisão");
  };
  const reviewDelivery = (task, approved, feedback, managerFeedback = {}) => {
    if (approved) {
      const gaps = taskCompletionGaps(task);
      if (gaps.length) {
        setToast(`Confirme a entrega antes de aprovar: ${gaps.join("; ")}`);
        return;
      }
    }
    changeTask(task.id, {
      missionStatus: approved ? "aprovada" : "correcao_solicitada",
      status: approved ? "Concluído" : task.status,
      rewardStatus:
        approved && Number(task.reward) > 0 ? "aprovada" : task.rewardStatus,
      deliveries: (task.deliveries || []).map((d, i) =>
        i === (task.deliveries || []).length - 1
          ? {
              ...d,
              status: approved ? "aprovada" : "correcao_solicitada",
              feedback,
              followedInstructions: !!managerFeedback.followedInstructions,
              autonomous: !!managerFeedback.autonomous,
            }
          : d,
      ),
    });
    const notifyMessage = approved
      ? `Entrega aprovada: "${task.title}"`
      : `Correção solicitada: "${task.title}"`;
    const recipients = new Set(
      [task.assigneeId, ...(task.assignees || []).map((a) => a.userId)].filter(
        Boolean,
      ),
    );
    recipients.forEach((id) => notifyUser(id, notifyMessage));
    setToast(approved ? "Entrega aprovada" : "Correção solicitada");
  };
  const removeTask = (id) => {
    if (!confirm("Excluir esta tarefa definitivamente?")) return;
    update((d) => ({
      ...d,
      tasks: d.tasks.filter((task) => task.id !== id),
    }));
    setToast("Tarefa excluída");
  };
  const toggleSelected = (id) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  const clearSelection = () => setSelectedIds([]);
  const bulkArchive = (archived) => {
    const now = new Date().toISOString();
    update((d) => ({
      ...d,
      tasks: d.tasks.map((task) =>
        selectedIds.includes(task.id)
          ? { ...task, archived, updatedAt: now }
          : task,
      ),
    }));
    setToast(
      archived
        ? `${selectedIds.length} tarefa(s) arquivada(s)`
        : `${selectedIds.length} tarefa(s) desarquivada(s)`,
    );
    clearSelection();
  };
  const bulkReassign = () => {
    const value = bulkAssignee.trim();
    if (!value) return;
    const member = realMembers.find((m) => m.name === value);
    const now = new Date().toISOString();
    update((d) => ({
      ...d,
      tasks: d.tasks.map((task) =>
        selectedIds.includes(task.id)
          ? {
              ...task,
              assignee: value,
              assigneeId: member ? member.id : "",
              updatedAt: now,
            }
          : task,
      ),
    }));
    setToast(`${selectedIds.length} tarefa(s) reatribuída(s) para ${value}`);
    setBulkAssignee("");
    clearSelection();
  };
  const startDigitalTask = (task) => {
    const specialist = task.assignee || "Diretor";
    const prompt = buildDigitalTaskPrompt(task, {
      specialist,
      business,
      dependencies: (task.dependsOn || [])
        .map((id) => db.tasks.find((item) => item.id === id))
        .filter(Boolean),
    });
    const conversationId = uid();
    const now = new Date().toISOString();
    localStorage.setItem("sf-draft", prompt);
    update((d) => ({
      ...d,
      selectedConversationId: conversationId,
      conversations: [
        {
          id: conversationId,
          sourceTaskId: task.id,
          title: task.title,
          businessId: business?.id || null,
          specialist,
          ownerId: db.user.id,
          createdAt: now,
          messages: [],
        },
        ...(d.conversations || []),
      ],
      preferences: { ...d.preferences, specialist },
      tasks: d.tasks.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status: item.status === "A fazer" ? "Em andamento" : item.status,
              startedAt: item.startedAt || now,
              updatedAt: now,
            }
          : item,
      ),
    }));
    setToast(`Tarefa encaminhada para ${specialist}`);
    go("estrategia");
  };
  return (
    <PageTitle
      eyebrow="OPERAÇÃO"
      title="Tarefas e projetos"
      text="Organize as próximas ações sem perder o contexto."
      action={
        <Button icon={Plus} onClick={() => openTask()}>
          Nova tarefa
        </Button>
      }
    >
      <AreaToolkit
        area="operacao"
        db={db}
        update={update}
        business={business}
        setToast={setToast}
        go={go}
      />
      {targetTaskId && <section className="task-deep-link" role="status"><span><strong>Tarefa vinculada</strong><small>Esta é a mesma tarefa exibida no CRM e no Planner. O status é único.</small></span><Button variant="ghost" onClick={() => { setTargetTaskId(""); if (typeof window !== "undefined") { const url = new URL(window.location.href); url.searchParams.delete("task"); window.history.replaceState({}, "", `${url.pathname}${url.search}`); } }}>Mostrar todas</Button></section>}
      <section className="task-focus-card" aria-label="Foco recomendado">
        <div className="task-focus-head">
          <span>
            <Target />
          </span>
          <div>
            <strong>Foco recomendado</strong>
            <small>
              Prioridade calculada no aparelho por prazo, urgência e bloqueios —
              sem gastar cota de IA.
            </small>
          </div>
        </div>
        {focusQueue.length ? (
          <div className="task-focus-list">
            {focusQueue.map((item, index) => (
              <button
                type="button"
                key={item.task.id}
                aria-label={`Abrir tarefa prioritária: ${item.task.title}`}
                onClick={() => openTask(item.task)}
              >
                <span>{index + 1}</span>
                <span>
                  <strong
                    className="task-focus-title"
                    data-title={item.task.title}
                    aria-hidden="true"
                  />
                  <small>
                    {item.reasons.slice(0, 2).join(" · ") ||
                      "próxima ação disponível"}
                  </small>
                  <small className="task-focus-action">
                    → {proximaAcaoDaTarefa(item)}
                  </small>
                </span>
                <ChevronRight />
              </button>
            ))}
          </div>
        ) : (
          <small className="task-focus-empty">
            Nenhuma tarefa ativa esperando atenção.
          </small>
        )}
      </section>
      <div className="toolbar" id="task-board">
        <div className="search">
          <Search />
          <input
            value={searchTerm}
            onChange={(e) => {
              setSearch(e.target.value);
              clearSearchSeed?.();
            }}
            placeholder="Pesquisar tarefas"
          />
        </div>
        <div className="view-toggle">
          <button
            className={view === "board" ? "active" : ""}
            onClick={() => setView("board")}
          >
            <GripVertical />
            Quadro
          </button>
          <button
            className={view === "list" ? "active" : ""}
            onClick={() => setView("list")}
          >
            <ListTodo />
            Lista
          </button>
          <button
            className={view === "missoes" ? "active" : ""}
            onClick={() => setView("missoes")}
          >
            <Award />
            Disponíveis
          </button>
          <button
            className={view === "calendario" ? "active" : ""}
            onClick={() => setView("calendario")}
          >
            <CalendarDays />
            Calendário
          </button>
          <button
            className={view === "gantt" ? "active" : ""}
            onClick={() => setView("gantt")}
          >
            <BarChart3 />
            Gantt
          </button>
        </div>
      </div>
      <div className="collab-card">
        <h3>
          <ListTodo />
          Projetos
        </h3>
        <p>
          Crie um projeto antes de começar as tarefas, ou apenas escreva o nome
          do projeto na tarefa — funciona dos dois jeitos.
        </p>
        <Button
          variant="ghost"
          icon={ListTodo}
          onClick={() => setProjectsOpen((v) => !v)}
        >
          {projectsOpen ? "Ocultar projetos" : "Gerenciar projetos"}
        </Button>
        {projectsOpen && (
          <>
            <form className="invite-form" onSubmit={saveProject}>
              <div className="form-grid">
                <Field label="Nome do projeto">
                  <input
                    required
                    value={projectForm.name}
                    onChange={(e) =>
                      setProjectForm({ ...projectForm, name: e.target.value })
                    }
                  />
                </Field>
                <Field label="Descrição (opcional)">
                  <input
                    value={projectForm.description}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        description: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Objetivo">
                  <input
                    value={projectForm.objective}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        objective: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Escopo">
                  <input
                    value={projectForm.scope}
                    onChange={(e) =>
                      setProjectForm({ ...projectForm, scope: e.target.value })
                    }
                  />
                </Field>
                <Field label="Entregáveis">
                  <input
                    value={projectForm.deliverables}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        deliverables: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Critérios de sucesso">
                  <input
                    value={projectForm.successCriteria}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        successCriteria: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Patrocinador">
                  <input
                    value={projectForm.sponsor}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        sponsor: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Gerente do projeto">
                  <input
                    value={projectForm.manager}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        manager: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Início">
                  <input
                    type="date"
                    value={projectForm.startDate}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        startDate: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Conclusão prevista">
                  <input
                    type="date"
                    value={projectForm.dueDate}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        dueDate: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Status">
                  <select
                    value={projectForm.status}
                    onChange={(e) =>
                      setProjectForm({ ...projectForm, status: e.target.value })
                    }
                  >
                    {PROJECT_STATUSES.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Prioridade">
                  <select
                    value={projectForm.priority}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        priority: e.target.value,
                      })
                    }
                  >
                    {["Baixa", "Média", "Alta", "Crítica"].map((priority) => (
                      <option key={priority}>{priority}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Orçamento planejado">
                  <input
                    type="number"
                    min="0"
                    value={projectForm.budgetPlanned}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        budgetPlanned: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Custo realizado">
                  <input
                    type="number"
                    min="0"
                    value={projectForm.costActual}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        costActual: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Horas previstas">
                  <input
                    type="number"
                    min="0"
                    value={projectForm.hoursPlanned}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        hoursPlanned: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Horas realizadas">
                  <input
                    type="number"
                    min="0"
                    value={projectForm.hoursActual}
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        hoursActual: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Feriados do projeto">
                  <textarea
                    rows={2}
                    value={
                      Array.isArray(projectForm.holidays)
                        ? projectForm.holidays.join("\n")
                        : projectForm.holidays || ""
                    }
                    onChange={(e) =>
                      setProjectForm({
                        ...projectForm,
                        holidays: e.target.value,
                      })
                    }
                    placeholder={"2026-09-07\n2026-10-12"}
                  />
                </Field>
              </div>
              <div className="field">
                <span>Dias de trabalho</span>
                <div className="checkbox-list compact">
                  {[
                    [1, "Seg"],
                    [2, "Ter"],
                    [3, "Qua"],
                    [4, "Qui"],
                    [5, "Sex"],
                    [6, "Sáb"],
                    [0, "Dom"],
                  ].map(([day, label]) => (
                    <label className="cost-check" key={day}>
                      <input
                        type="checkbox"
                        checked={(projectForm.workdays || []).includes(day)}
                        onChange={() =>
                          setProjectForm((current) => ({
                            ...current,
                            workdays: (current.workdays || []).includes(day)
                              ? current.workdays.filter((item) => item !== day)
                              : [...(current.workdays || []), day],
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="project-milestone-editor">
                <h4>Linha de marcos</h4>
                <div className="form-grid">
                  <Field label="Marco">
                    <input
                      value={milestoneDraft.title}
                      onChange={(e) =>
                        setMilestoneDraft({
                          ...milestoneDraft,
                          title: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Tipo">
                    <select
                      value={milestoneDraft.type}
                      onChange={(e) =>
                        setMilestoneDraft({
                          ...milestoneDraft,
                          type: e.target.value,
                        })
                      }
                    >
                      {MILESTONE_TYPES.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Data planejada">
                    <input
                      type="date"
                      value={milestoneDraft.plannedDate}
                      onChange={(e) =>
                        setMilestoneDraft({
                          ...milestoneDraft,
                          plannedDate: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Responsável">
                    <input
                      value={milestoneDraft.ownerName}
                      onChange={(e) =>
                        setMilestoneDraft({
                          ...milestoneDraft,
                          ownerName: e.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  icon={Plus}
                  onClick={addMilestone}
                >
                  Adicionar marco
                </Button>
                {(projectForm.milestones || []).map((milestone) => (
                  <div className="project-milestone-row" key={milestone.id}>
                    <span>
                      <strong>{milestone.title}</strong>
                      <small>
                        {milestone.type}
                        {milestone.plannedDate
                          ? ` · ${new Date(`${milestone.plannedDate}T12:00:00`).toLocaleDateString("pt-BR")}`
                          : ""}
                        {milestone.ownerName ? ` · ${milestone.ownerName}` : ""}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="icon-button danger"
                      title="Remover marco"
                      onClick={() => removeMilestone(milestone.id)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))}
              </div>
              <div className="project-milestone-editor">
                <h4>Governança do projeto</h4>
                <p className="field-hint">
                  Registre riscos, problemas, decisões e solicitações de mudança
                  no mesmo projeto.
                </p>
                <div className="form-grid">
                  <Field label="Tipo">
                    <select
                      value={governanceDraft.kind}
                      onChange={(e) =>
                        setGovernanceDraft({
                          ...governanceDraft,
                          kind: e.target.value,
                        })
                      }
                    >
                      <option value="risk">Risco</option>
                      <option value="issue">Problema</option>
                      <option value="decision">Decisão</option>
                      <option value="change">Mudança de escopo</option>
                    </select>
                  </Field>
                  <Field label="Título">
                    <input
                      value={governanceDraft.title}
                      onChange={(e) =>
                        setGovernanceDraft({
                          ...governanceDraft,
                          title: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Responsável">
                    <input
                      value={governanceDraft.ownerName}
                      onChange={(e) =>
                        setGovernanceDraft({
                          ...governanceDraft,
                          ownerName: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Severidade">
                    <select
                      value={governanceDraft.severity}
                      onChange={(e) =>
                        setGovernanceDraft({
                          ...governanceDraft,
                          severity: e.target.value,
                        })
                      }
                    >
                      {["Baixa", "Média", "Alta", "Crítica"].map((severity) => (
                        <option key={severity}>{severity}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Prazo">
                    <input
                      type="date"
                      value={governanceDraft.dueDate}
                      onChange={(e) =>
                        setGovernanceDraft({
                          ...governanceDraft,
                          dueDate: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Descrição">
                    <input
                      value={governanceDraft.description}
                      onChange={(e) =>
                        setGovernanceDraft({
                          ...governanceDraft,
                          description: e.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  icon={Plus}
                  onClick={addGovernanceItem}
                >
                  Adicionar registro
                </Button>
                {[
                  ...(projectForm.risks || []),
                  ...(projectForm.issues || []),
                  ...(projectForm.decisions || []),
                  ...(projectForm.changeRequests || []),
                ].map((item) => (
                  <div className="project-milestone-row" key={item.id}>
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {{
                          risk: "Risco",
                          issue: "Problema",
                          decision: "Decisão",
                          change: "Mudança",
                        }[item.kind] || item.kind}
                        {" · "}
                        {item.severity}
                        {item.ownerName ? ` · ${item.ownerName}` : ""}
                        {item.status ? ` · ${item.status}` : ""}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="icon-button danger"
                      title="Remover registro"
                      onClick={() => removeGovernanceItem(item.kind, item.id)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))}
              </div>
              <div className="task-actions">
                <Button type="submit" icon={editingProject ? Save : Plus}>
                  {editingProject ? "Salvar projeto" : "Criar projeto"}
                </Button>
                {editingProject && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={cancelProjectEdit}
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            </form>
            {(db.projects || []).length > 0 && (
              <div className="member-list">
                {(db.projects || []).map((p) => {
                  const metrics = projectMetrics(p, db.tasks);
                  return (
                    <div key={p.id} className="project-summary-row">
                      <span className="avatar">{p.name[0]}</span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          {p.status || "Planejamento"} · {metrics.progress}% ·{" "}
                          {metrics.health}
                        </small>
                        {(metrics.openRisks > 0 || metrics.openIssues > 0) && (
                          <small>
                            {metrics.openRisks} risco(s) · {metrics.openIssues}{" "}
                            problema(s)
                          </small>
                        )}
                        <span
                          className="project-progress"
                          aria-label={`${metrics.progress}% concluído`}
                        >
                          <i style={{ width: `${metrics.progress}%` }} />
                        </span>
                        {metrics.nextMilestones[0] && (
                          <small>
                            Próximo marco:{" "}
                            {metrics.nextMilestones[0].milestone.title}
                            {metrics.nextMilestones[0].milestone.plannedDate
                              ? ` · ${new Date(`${metrics.nextMilestones[0].milestone.plannedDate}T12:00:00`).toLocaleDateString("pt-BR")}`
                              : ""}
                          </small>
                        )}
                      </span>
                      <span className="task-actions">
                        <button
                          className="icon-button"
                          title="Editar projeto"
                          onClick={() => editProject(p)}
                        >
                          <Edit3 />
                        </button>
                        <button
                          className="icon-button danger"
                          title="Excluir projeto"
                          onClick={() => removeProject(p.id)}
                        >
                          <Trash2 />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
      {view !== "missoes" && (
        <div className="filter-row">
          <FilterSelect
            aria-label="Filtrar por status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option>Todos</option>
            {statuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </FilterSelect>
          <FilterSelect
            aria-label="Filtrar por prioridade"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option>Todas</option>
            <option>Baixa</option>
            <option>Média</option>
            <option>Alta</option>
          </FilterSelect>
          <FilterSelect
            aria-label="Filtrar por responsável"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
          >
            <option>Todos</option>
            {assignees.map((assignee) => (
              <option key={assignee}>{assignee}</option>
            ))}
          </FilterSelect>
          <FilterSelect
            aria-label="Filtrar por projeto"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option>Todos</option>
            {projects.map((project) => (
              <option key={project}>{project}</option>
            ))}
          </FilterSelect>
          <FilterSelect
            aria-label="Filtrar arquivamento"
            value={archiveFilter}
            onChange={(e) => setArchiveFilter(e.target.value)}
          >
            <option>Ativas</option>
            <option>Arquivadas</option>
            <option>Todas</option>
          </FilterSelect>
        </div>
      )}
      {view === "missoes" ? (
        availableMissions.length === 0 ? (
          <Empty
            icon={Award}
            title="Nenhuma missão disponível no momento"
            text="Quando alguém publicar uma missão aberta para escolha, ela aparece aqui."
          />
        ) : (
          <div className="data-list">
            {availableMissions.map((t) => {
              const alreadyAssigned = (t.assignees || []).some(
                (a) => a.userId === db.user.id,
              );
              const alreadyInterested = (t.interested || []).some(
                (i) => i.userId === db.user.id,
              );
              const slotsLeft = (t.slots || 1) - (t.assignees || []).length;
              return (
                <article key={t.id}>
                  <span>
                    <strong>{t.title}</strong>
                    <small>
                      {t.difficulty} · {t.points || 0} pontos
                      {t.reward ? ` · ${money(t.reward)}` : ""} · {slotsLeft}{" "}
                      {slotsLeft === 1 ? "vaga" : "vagas"}
                      {t.due ? ` · Prazo: ${t.due}` : ""}
                    </small>
                  </span>
                  {alreadyAssigned ? (
                    <span className="publish-state live">
                      <BadgeCheck /> Você assumiu
                    </span>
                  ) : t.approvalMode === "aprovacao" ? (
                    <Button
                      variant={alreadyInterested ? "ghost" : "secondary"}
                      onClick={() =>
                        alreadyInterested
                          ? withdrawInterest(t)
                          : expressInterest(t)
                      }
                    >
                      {alreadyInterested
                        ? "Retirar interesse"
                        : "Demonstrar interesse"}
                    </Button>
                  ) : (
                    <Button onClick={() => assumeTask(t)}>
                      Assumir missão
                    </Button>
                  )}
                </article>
              );
            })}
          </div>
        )
      ) : items.length === 0 ? (
        <Empty
          icon={ListTodo}
          title="Nenhuma tarefa encontrada"
          text="Crie uma ação com prioridade e prazo para começar."
          action="Criar tarefa"
          onAction={() => openTask()}
        />
      ) : view === "board" ? (
        <div className="kanban" ref={kanbanRef}>
          {statuses.map((s) => (
            /* eslint-disable-next-line jsx-a11y/no-static-element-interactions */
            <section
              key={s}
              data-kanban-status={s}
              className={dragOverStatus === s ? "drag-over" : ""}
              onDragOver={(e) => {
                if (!draggedTaskId) return;
                e.preventDefault();
                setDragOverStatus(s);
              }}
              onDragLeave={() =>
                setDragOverStatus((current) => (current === s ? null : current))
              }
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStatus(null);
                const task = items.find((x) => x.id === draggedTaskId);
                setDraggedTaskId(null);
                if (task && task.status !== s) changeTaskStatus(task, s);
              }}
            >
              <header>
                <span>{s}</span>
                <b>{items.filter((x) => x.status === s).length}</b>
              </header>
              {items
                .filter((x) => x.status === s)
                .map((t) => (
                  /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
                  <article
                    key={t.id}
                    draggable
                    className={draggedTaskId === t.id ? "dragging" : ""}
                    onDragStart={() => setDraggedTaskId(t.id)}
                    onDragEnd={() => {
                      setDraggedTaskId(null);
                      setDragOverStatus(null);
                    }}
                    onTouchStart={onCardTouchStart(t)}
                    onTouchEnd={onCardTouchEnd}
                    onTouchCancel={() => {
                      clearTouchDrag();
                      setDraggedTaskId(null);
                      setDragOverStatus(null);
                    }}
                  >
                    <div>
                      <span className={`priority ${t.priority.toLowerCase()}`}>
                        {t.priority}
                      </span>
                      <span className="task-actions">
                        {t.due && (
                          <button
                            className="icon-button"
                            aria-label={`Adicionar "${t.title}" ao Google Agenda`}
                            title="Adicionar ao Google Agenda"
                            onClick={() => addTaskToCalendar(t)}
                          >
                            <CalendarDays />
                          </button>
                        )}
                        <button
                          className="icon-button"
                          aria-label="Editar tarefa"
                          onClick={() => openTask(t)}
                        >
                          <Edit3 />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={t.archived ? "Desarquivar" : "Arquivar"}
                          onClick={() =>
                            changeTask(t.id, { archived: !t.archived })
                          }
                        >
                          <Archive />
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label="Excluir tarefa"
                          onClick={() => removeTask(t.id)}
                        >
                          <Trash2 />
                        </button>
                      </span>
                    </div>
                    <h3>
                      {t.title}
                      {isBlocked(t) && (
                        <span
                          className="blocked-badge"
                          title={`Aguardando: ${blockingTasks(t)
                            .map((dep) => dep.title)
                            .join(", ")}`}
                        >
                          Bloqueada
                        </span>
                      )}
                    </h3>
                    <p>{t.description || "Sem descrição"}</p>
                    <footer>
                      <span>
                        <Clock3 />
                        {t.due || "Sem prazo"}
                        {taskUrgency(t) && (
                          <em className={`urgency ${taskUrgency(t).tone}`}>
                            {taskUrgency(t).text}
                          </em>
                        )}
                        {(t.attachments || []).length > 0 && (
                          <em
                            className="attachment-count"
                            title={`${t.attachments.length} anexo(s)`}
                          >
                            <Paperclip />
                            {t.attachments.length}
                          </em>
                        )}
                        {t.recurrence?.frequency &&
                          t.recurrence.frequency !== "none" && (
                            <em
                              className="attachment-count"
                              title={
                                RECURRENCE_OPTIONS.find(
                                  (option) =>
                                    option.value === t.recurrence.frequency,
                                )?.label || "Tarefa recorrente"
                              }
                            >
                              <Repeat />
                            </em>
                          )}
                      </span>
                      <select
                        value={t.status}
                        onChange={(e) => changeTaskStatus(t, e.target.value)}
                      >
                        {statuses.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </footer>
                    {(t.project || t.assignee) && (
                      <small className="task-context">
                        {t.project || "Sem projeto"} ·{" "}
                        {t.assignee || "Sem responsável"}
                        {t.assignee &&
                          ` · ${t.assigneeType === "digital" ? "Colaborador digital" : "Pessoa"}`}
                      </small>
                    )}
                    {t.assigneeType === "digital" &&
                      t.assignee &&
                      !t.archived && (
                        <button
                          className="task-trigger"
                          onClick={() => startDigitalTask(t)}
                          aria-label={`Iniciar tarefa com ${t.assignee}`}
                        >
                          <Play /> Iniciar com {t.assignee}
                        </button>
                      )}
                  </article>
                ))}
            </section>
          ))}
        </div>
      ) : view === "gantt" ? (
        !ganttProject ? (
          <div className="empty-state">
            <BarChart3 />
            <h3>Escolha um projeto</h3>
            <p>
              Use o filtro de projeto para calcular dependências, folgas e
              caminho crítico.
            </p>
          </div>
        ) : ganttSchedule.rows.length === 0 ? (
          <div className="empty-state">
            <BarChart3 />
            <h3>Projeto sem tarefas</h3>
            <p>
              Vincule tarefas a {ganttProject.name} para gerar o cronograma.
            </p>
          </div>
        ) : (
          <div className="gantt-panel">
            <div className="gantt-summary">
              <span>
                <strong>{ganttProject.name}</strong>
                <small>
                  {ganttSchedule.start} a {ganttSchedule.end} ·{" "}
                  {ganttSchedule.duration} dias úteis
                </small>
              </span>
              <span
                className={
                  ganttSchedule.valid
                    ? "publish-state live"
                    : "publish-state error"
                }
              >
                {ganttSchedule.valid
                  ? `${ganttRisks.criticalTasks} tarefa(s) crítica(s)`
                  : `${ganttRisks.cyclicTasks} dependência(s) circular(es)`}
              </span>
              {ganttRisks.delayedAgainstBaseline > 0 && (
                <span className="blocked-badge">
                  {ganttRisks.delayedAgainstBaseline} atraso(s) contra baseline
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                icon={RefreshCw}
                onClick={applyCalculatedSchedule}
                disabled={!ganttSchedule.valid}
              >
                Aplicar reprogramação
              </Button>
            </div>
            <div className="gantt-table">
              <div className="gantt-head">
                <span>Tarefa</span>
                <span>Cronograma calculado</span>
              </div>
              {ganttSchedule.rows.map((row) => (
                <div className="gantt-row" key={row.id}>
                  <button type="button" onClick={() => openTask(row.task)}>
                    <strong>{row.task.title}</strong>
                    <small>
                      {row.start} a {row.end} · {row.duration}d · folga{" "}
                      {row.slack}d
                    </small>
                  </button>
                  <div className="gantt-track">
                    {row.task.baselineStart && row.task.baselineDue && (
                      <i
                        className="gantt-baseline"
                        style={{
                          left: `${ganttPosition(
                            row.task.baselineStart,
                            ganttSchedule,
                          )}%`,
                          width: `${Math.max(
                            2,
                            ganttPosition(row.task.baselineDue, ganttSchedule) -
                              ganttPosition(
                                row.task.baselineStart,
                                ganttSchedule,
                              ),
                          )}%`,
                        }}
                      />
                    )}
                    <i
                      className={`gantt-bar ${row.critical ? "critical" : ""} ${
                        row.cyclic ? "cyclic" : ""
                      }`}
                      style={{
                        left: `${ganttPosition(row.start, ganttSchedule)}%`,
                        width: `${ganttWidth(row.duration, ganttSchedule)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {(ganttProject.milestones || []).length > 0 && (
              <div className="gantt-milestones">
                <strong>Marcos</strong>
                {(ganttProject.milestones || []).map((milestone) => (
                  <span key={milestone.id}>
                    <i
                      style={{
                        left: `${ganttPosition(
                          milestone.actualDate || milestone.plannedDate,
                          ganttSchedule,
                        )}%`,
                      }}
                    />
                    {milestone.title} ·{" "}
                    {milestone.actualDate || milestone.plannedDate}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      ) : view === "calendario" ? (
        <div className="task-calendar">
          <div className="task-calendar-header">
            <button
              type="button"
              className="icon-button"
              aria-label="Mês anterior"
              onClick={() => setCalendarMonth((m) => shiftYearMonth(m, -1))}
            >
              <ChevronLeft />
            </button>
            <strong>
              {new Date(`${calendarMonth}-01T00:00:00`).toLocaleDateString(
                "pt-BR",
                { month: "long", year: "numeric" },
              )}
            </strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Próximo mês"
              onClick={() => setCalendarMonth((m) => shiftYearMonth(m, 1))}
            >
              <ChevronRight />
            </button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCalendarMonth(todayYearMonth())}
            >
              Hoje
            </Button>
          </div>
          <div className="task-calendar-weekdays">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="task-calendar-grid">
            {buildTaskCalendar(calendarMonth, items).map((cell, index) =>
              cell ? (
                <div
                  key={cell.ymd}
                  className={`task-calendar-cell ${
                    cell.ymd === today() ? "is-today" : ""
                  }`}
                >
                  <span className="task-calendar-day">{cell.day}</span>
                  {cell.tasks.slice(0, 3).map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      className={`task-calendar-chip priority-${t.priority.toLowerCase()}`}
                      onClick={() => openTask(t)}
                    >
                      {t.title}
                    </button>
                  ))}
                  {cell.tasks.length > 3 && (
                    <small>+{cell.tasks.length - 3} mais</small>
                  )}
                </div>
              ) : (
                <div
                  key={`blank-${index}`}
                  className="task-calendar-cell is-blank"
                />
              ),
            )}
          </div>
        </div>
      ) : (
        <div className="data-list">
          {items.length > 0 && (
            <div className="bulk-bar">
              <label className="cost-check">
                <input
                  type="checkbox"
                  aria-label="Selecionar todas as tarefas visíveis"
                  checked={
                    selectedIds.length > 0 &&
                    items.every((t) => selectedIds.includes(t.id))
                  }
                  onChange={(e) =>
                    setSelectedIds(
                      e.target.checked ? items.map((t) => t.id) : [],
                    )
                  }
                />
                <span>
                  {selectedIds.length > 0
                    ? `${selectedIds.length} selecionada(s)`
                    : "Selecionar todas"}
                </span>
              </label>
              {selectedIds.length > 0 && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    icon={Archive}
                    onClick={() => bulkArchive(true)}
                  >
                    Arquivar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    icon={RotateCcw}
                    onClick={() => bulkArchive(false)}
                  >
                    Desarquivar
                  </Button>
                  <input
                    list="real-team-members"
                    className="bulk-assignee-input"
                    aria-label="Reatribuir selecionadas para"
                    value={bulkAssignee}
                    onChange={(e) => setBulkAssignee(e.target.value)}
                    placeholder="Reatribuir para..."
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!bulkAssignee.trim()}
                    onClick={bulkReassign}
                  >
                    Aplicar
                  </Button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={clearSelection}
                  >
                    Limpar seleção
                  </button>
                </>
              )}
            </div>
          )}
          {items.slice(0, visibleCount).map((t) => (
            <article
              key={t.id}
              className={selectedIds.includes(t.id) ? "selected" : ""}
            >
              <input
                type="checkbox"
                aria-label={`Selecionar "${t.title}"`}
                checked={selectedIds.includes(t.id)}
                onChange={() => toggleSelected(t.id)}
              />
              <button
                onClick={() =>
                  changeTaskStatus(
                    t,
                    t.status === "Concluído" ? "A fazer" : "Concluído",
                  )
                }
              >
                {t.status === "Concluído" ? <CheckCircle2 /> : <Circle />}
              </button>
              <span>
                <strong>
                  {t.title}
                  {isBlocked(t) && (
                    <span
                      className="blocked-badge"
                      title={`Aguardando: ${blockingTasks(t)
                        .map((dep) => dep.title)
                        .join(", ")}`}
                    >
                      Bloqueada
                    </span>
                  )}
                </strong>
                <small>
                  {t.area} · {t.priority} · {t.due || "Sem prazo"} ·{" "}
                  {t.project || "Sem projeto"} ·{" "}
                  {t.assignee || "Sem responsável"}
                  {t.assignee &&
                    ` · ${t.assigneeType === "digital" ? "Digital" : "Pessoa"}`}
                  {taskUrgency(t) && (
                    <em className={`urgency ${taskUrgency(t).tone}`}>
                      {taskUrgency(t).text}
                    </em>
                  )}
                  {(t.attachments || []).length > 0 && (
                    <em
                      className="attachment-count"
                      title={`${t.attachments.length} anexo(s)`}
                    >
                      <Paperclip />
                      {t.attachments.length}
                    </em>
                  )}
                  {t.recurrence?.frequency &&
                    t.recurrence.frequency !== "none" && (
                      <em
                        className="attachment-count"
                        title={
                          RECURRENCE_OPTIONS.find(
                            (option) => option.value === t.recurrence.frequency,
                          )?.label || "Tarefa recorrente"
                        }
                      >
                        <Repeat />
                      </em>
                    )}
                </small>
              </span>
              <select
                value={t.status}
                onChange={(e) => changeTaskStatus(t, e.target.value)}
              >
                {statuses.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              <span className="task-actions">
                {t.assigneeType === "digital" && t.assignee && !t.archived && (
                  <button
                    className="icon-button"
                    aria-label={`Iniciar tarefa com ${t.assignee}`}
                    title={`Iniciar com ${t.assignee}`}
                    onClick={() => startDigitalTask(t)}
                  >
                    <Play />
                  </button>
                )}
                {t.due && (
                  <button
                    className="icon-button"
                    aria-label={`Adicionar "${t.title}" ao Google Agenda`}
                    title="Adicionar ao Google Agenda"
                    onClick={() => addTaskToCalendar(t)}
                  >
                    <CalendarDays />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label="Editar tarefa"
                  onClick={() => openTask(t)}
                >
                  <Edit3 />
                </button>
                <button
                  className="icon-button"
                  aria-label={t.archived ? "Desarquivar" : "Arquivar"}
                  onClick={() => changeTask(t.id, { archived: !t.archived })}
                >
                  <Archive />
                </button>
              </span>
            </article>
          ))}
          <LoadMoreButton
            shown={Math.min(visibleCount, items.length)}
            total={items.length}
            onClick={() => setVisibleCount((c) => c + LIST_PAGE_SIZE)}
          />
        </div>
      )}
      {modal && (
        <Modal
          title={editing ? "Editar tarefa" : "Criar tarefa"}
          onClose={() => setModal(false)}
        >
          <form className="modal-body" onSubmit={save}>
            <Field label="Título">
              <input
                autoFocus
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Descrição">
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </Field>
            <div className="task-ai-actions">
              <Button
                type="button"
                variant="secondary"
                icon={taskAiBusy ? RefreshCw : WandSparkles}
                disabled={taskAiBusy}
                onClick={structureTaskWithAi}
              >
                {taskAiBusy ? "Estruturando..." : "Estruturar tarefa com IA"}
              </Button>
              <small>
                Organiza o rascunho em etapas, critérios, prioridade e
                responsável sugerido. Você revisa tudo antes de salvar.
              </small>
            </div>
            {(taskAiError ||
              form.aiSuggestedSpecialist ||
              (form.aiRisks || []).length > 0 ||
              (form.aiQuestions || []).length > 0) && (
              <div className="task-ai-insights" role="status">
                {taskAiError && <p>{taskAiError}</p>}
                {form.aiSuggestedSpecialist && (
                  <p>
                    <strong>Colaborador sugerido:</strong>{" "}
                    {form.aiSuggestedSpecialist}
                  </p>
                )}
                {(form.aiRisks || []).length > 0 && (
                  <div>
                    <strong>Riscos para revisar</strong>
                    <ul>
                      {form.aiRisks.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(form.aiQuestions || []).length > 0 && (
                  <div>
                    <strong>Informações que podem melhorar a execução</strong>
                    <ul>
                      {form.aiQuestions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <div className="field">
              <span>Anexos</span>
              <input
                ref={taskAttachRef}
                className="visually-hidden"
                type="file"
                multiple
                accept="image/*,.pdf,.docx,.txt,.md,.markdown,.csv"
                aria-label="Anexar arquivo à tarefa"
                onChange={async (e) => {
                  const files = e.target.files;
                  e.target.value = "";
                  const next = await addAttachmentsFromFiles(
                    files,
                    form.attachments || [],
                    setToast,
                  );
                  setForm((current) => ({ ...current, attachments: next }));
                }}
              />
              <Button
                type="button"
                variant="ghost"
                icon={Paperclip}
                onClick={() => taskAttachRef.current?.click()}
              >
                Anexar arquivo
              </Button>
              <AttachmentList
                attachments={form.attachments}
                onRemove={(id) =>
                  setForm((current) => ({
                    ...current,
                    attachments: (current.attachments || []).filter(
                      (a) => a.id !== id,
                    ),
                  }))
                }
              />
            </div>
            <div className="form-grid">
              <Field label="Prioridade">
                <select
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: e.target.value })
                  }
                >
                  <option>Baixa</option>
                  <option>Média</option>
                  <option>Alta</option>
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {statuses.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Prazo">
                <input
                  type="date"
                  value={form.due}
                  onChange={(e) => setForm({ ...form, due: e.target.value })}
                />
              </Field>
              <Field label="Início planejado">
                <input
                  type="date"
                  value={form.startDate || ""}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                />
              </Field>
              <Field label="Duração estimada (dias úteis)">
                <input
                  type="number"
                  min="1"
                  value={form.estimatedDays || "1"}
                  onChange={(e) =>
                    setForm({ ...form, estimatedDays: e.target.value })
                  }
                />
              </Field>
              <Field label="Repetir">
                <select
                  value={form.recurrence?.frequency || "none"}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      recurrence: {
                        frequency: e.target.value,
                        seriesId: form.recurrence?.seriesId,
                      },
                    })
                  }
                >
                  {RECURRENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {editing &&
                  form.recurrence?.frequency &&
                  form.recurrence.frequency !== "none" &&
                  form.recurrence.seriesId && (
                    <p className="recurrence-note">
                      Parte de uma série recorrente (
                      {
                        db.tasks.filter(
                          (t) =>
                            t.recurrence?.seriesId === form.recurrence.seriesId,
                        ).length
                      }{" "}
                      no total).{" "}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() =>
                          setForm({
                            ...form,
                            recurrence: { frequency: "none" },
                          })
                        }
                      >
                        Cancelar recorrência
                      </button>
                    </p>
                  )}
              </Field>
              <div className="deadline-calc-wrap">
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    setDeadlineCalc((c) => ({ ...c, open: !c.open }))
                  }
                >
                  {deadlineCalc.open
                    ? "Fechar calculadora"
                    : "Calcular em dias úteis"}
                </button>
                {deadlineCalc.open && (
                  <div className="deadline-calc">
                    <input
                      type="date"
                      aria-label="Data base do prazo"
                      value={deadlineCalc.base}
                      onChange={(e) =>
                        setDeadlineCalc((c) => ({ ...c, base: e.target.value }))
                      }
                    />
                    <input
                      type="number"
                      min="1"
                      aria-label="Dias úteis"
                      value={deadlineCalc.days}
                      onChange={(e) =>
                        setDeadlineCalc((c) => ({ ...c, days: e.target.value }))
                      }
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={applyDeadlineCalc}
                    >
                      Usar como prazo
                    </Button>
                    <small>
                      Conta apenas dias úteis (sem sábado e domingo). Feriados
                      nacionais não são descontados automaticamente.
                    </small>
                  </div>
                )}
              </div>
              <Field label="Área">
                <select
                  value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value })}
                >
                  <option>Operação</option>
                  <option>Estratégia</option>
                  <option>Vendas</option>
                  <option>Marketing</option>
                  <option>Atendimento</option>
                  <option>Financeiro</option>
                  <option>Jurídico</option>
                  <option>RH / Pessoas</option>
                  <option>TI / Tecnologia</option>
                  <option>Logística</option>
                  <option>Compras</option>
                  <option>Administrativo</option>
                  <option>Outra</option>
                </select>
              </Field>
              <Field label="Responsável">
                <select
                  value={form.assigneeType || "real"}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      assigneeType: e.target.value,
                      assignee: "",
                    })
                  }
                >
                  <option value="real">Funcionário real</option>
                  <option value="digital">Colaborador digital</option>
                </select>
              </Field>
              {form.assigneeType === "digital" ? (
                <Field label="Colaborador digital">
                  <select
                    value={form.assignee || ""}
                    onChange={(e) =>
                      setForm({ ...form, assignee: e.target.value })
                    }
                  >
                    <option value="">Escolha quem executará</option>
                    {digitalCollaborators.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="Nome do responsável">
                  <input
                    list="real-team-members"
                    value={form.assignee || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      const member = realMembers.find((m) => m.name === value);
                      setForm({
                        ...form,
                        assignee: value,
                        assigneeId: member ? member.id : "",
                        notifyTo: member ? member.email : form.notifyTo || "",
                      });
                    }}
                    placeholder="Nome da pessoa (ou escolha da equipe)"
                  />
                  <datalist id="real-team-members">
                    {realMembers.map((member) => (
                      <option key={member.id} value={member.name}>
                        {member.email}
                      </option>
                    ))}
                  </datalist>
                </Field>
              )}
              {form.assigneeType !== "digital" && (
                <Field
                  label="Avisar por e-mail"
                  hint="A pessoa recebe os detalhes da tarefa mesmo sem usar o app"
                >
                  <div className="notify-row">
                    <label className="cost-check">
                      <input
                        type="checkbox"
                        checked={!!form.notify}
                        onChange={(e) =>
                          setForm({ ...form, notify: e.target.checked })
                        }
                      />
                      <span>Enviar aviso</span>
                    </label>
                    {form.notify && (
                      <input
                        type="email"
                        value={form.notifyTo || ""}
                        onChange={(e) =>
                          setForm({ ...form, notifyTo: e.target.value })
                        }
                        placeholder="email@dapessoa.com"
                      />
                    )}
                  </div>
                </Field>
              )}
              <Field label="Projeto">
                <input
                  value={form.project || ""}
                  onChange={(e) =>
                    setForm({ ...form, project: e.target.value })
                  }
                  placeholder="Ex.: Lançamento de julho"
                />
              </Field>
            </div>
            {db.tasks.filter((t) => t.id !== editing).length > 0 && (
              <div className="field">
                <span>Depende de</span>
                <div className="checkbox-list">
                  {db.tasks
                    .filter((t) => t.id !== editing)
                    .map((t) => (
                      <label key={t.id} className="cost-check">
                        <input
                          type="checkbox"
                          checked={(form.dependsOn || []).includes(t.id)}
                          onChange={() =>
                            setForm({
                              ...form,
                              dependsOn: (form.dependsOn || []).includes(t.id)
                                ? form.dependsOn.filter((id) => id !== t.id)
                                : [...(form.dependsOn || []), t.id],
                            })
                          }
                        />
                        {t.title} ({t.status})
                      </label>
                    ))}
                </div>
                <small>
                  Esta tarefa fica bloqueada para concluir, entregar ou assumir
                  enquanto as tarefas marcadas acima não estiverem concluídas.
                </small>
              </div>
            )}
            <div className="field">
              <label className="cost-check">
                <input
                  type="checkbox"
                  checked={!!form.isMission}
                  onChange={(e) =>
                    setForm({ ...form, isMission: e.target.checked })
                  }
                />
                <span>
                  Tratar como missão (vagas, pontos, recompensa, subtarefas e
                  entregas)
                </span>
              </label>
            </div>
            <SharingFields
              value={{
                visibility: form.visibility,
                sharedWith: form.sharedWith,
                sharedTeams: form.sharedTeams,
                project: form.project,
              }}
              onChange={(next) => setForm({ ...form, ...next })}
              teams={db.teams}
              projectOptions={projects}
              hideProjectField
              disabled={form.isMission && form.distribution === "disponivel"}
              disabledHint="Missões disponíveis ficam visíveis para todo o espaço automaticamente."
            />
            {form.isMission && (
              <div className="form-grid">
                <Field label="Distribuição">
                  <select
                    value={form.distribution}
                    onChange={(e) =>
                      setForm({ ...form, distribution: e.target.value })
                    }
                  >
                    <option value="atribuida">Atribuída diretamente</option>
                    <option value="disponivel">
                      Disponível para colaboradores escolherem
                    </option>
                    <option value="pessoal">
                      Pessoal (organização própria)
                    </option>
                  </select>
                </Field>
                <Field label="Dificuldade">
                  <select
                    value={form.difficulty}
                    onChange={(e) =>
                      setForm({ ...form, difficulty: e.target.value })
                    }
                  >
                    <option>Simples</option>
                    <option>Intermediária</option>
                    <option>Avançada</option>
                  </select>
                </Field>
                {form.distribution === "disponivel" && (
                  <>
                    <Field label="Vagas">
                      <input
                        type="number"
                        min="1"
                        value={form.slots}
                        onChange={(e) =>
                          setForm({ ...form, slots: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Como assumir">
                      <select
                        value={form.approvalMode}
                        onChange={(e) =>
                          setForm({ ...form, approvalMode: e.target.value })
                        }
                      >
                        <option value="imediata">Aceitação imediata</option>
                        <option value="aprovacao">
                          Precisa da minha aprovação
                        </option>
                      </select>
                    </Field>
                  </>
                )}
                <Field label="Pontos">
                  <input
                    type="number"
                    min="0"
                    value={form.points}
                    onChange={(e) =>
                      setForm({ ...form, points: e.target.value })
                    }
                  />
                </Field>
                <Field label="Recompensa financeira (opcional)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.reward}
                    onChange={(e) =>
                      setForm({ ...form, reward: e.target.value })
                    }
                    placeholder="R$"
                  />
                </Field>
                <Field label="Desistência">
                  <label className="cost-check">
                    <input
                      type="checkbox"
                      checked={!!form.allowWithdrawal}
                      onChange={(e) =>
                        setForm({ ...form, allowWithdrawal: e.target.checked })
                      }
                    />
                    <span>Permitir desistir antes do início</span>
                  </label>
                </Field>
              </div>
            )}
            <div className="field">
              <span>Critérios de conclusão</span>
              <small>
                A tarefa só poderá ser concluída depois que todos os critérios
                cadastrados forem confirmados.
              </small>
              <div className="subtask-editor">
                <input
                  value={form.criterionDraft || ""}
                  onChange={(e) =>
                    setForm({ ...form, criterionDraft: e.target.value })
                  }
                  placeholder="Ex.: Cliente aprovou o PDF final"
                  aria-label="Novo critério de conclusão"
                />
                <Button
                  type="button"
                  variant="secondary"
                  icon={Plus}
                  disabled={!(form.criterionDraft || "").trim()}
                  onClick={() =>
                    setForm({
                      ...form,
                      acceptanceCriteria: [
                        ...(form.acceptanceCriteria || []),
                        {
                          id: uid(),
                          text: form.criterionDraft.trim(),
                          done: false,
                        },
                      ],
                      criterionDraft: "",
                    })
                  }
                >
                  Adicionar critério
                </Button>
              </div>
              {(form.acceptanceCriteria || []).length > 0 && (
                <div className="member-list">
                  {form.acceptanceCriteria.map((criterion) => (
                    <div key={criterion.id}>
                      <label className="cost-check">
                        <input
                          type="checkbox"
                          checked={!!criterion.done}
                          onChange={() =>
                            setForm({
                              ...form,
                              acceptanceCriteria: form.acceptanceCriteria.map(
                                (item) =>
                                  item.id === criterion.id
                                    ? { ...item, done: !item.done }
                                    : item,
                              ),
                            })
                          }
                        />
                        <span
                          className={
                            criterion.done ? "subtask-done" : undefined
                          }
                        >
                          {criterion.text}
                        </span>
                      </label>
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label={`Remover critério ${criterion.text}`}
                        onClick={() =>
                          setForm({
                            ...form,
                            acceptanceCriteria: form.acceptanceCriteria.filter(
                              (item) => item.id !== criterion.id,
                            ),
                          })
                        }
                      >
                        <X />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="field">
              <span>
                {form.isMission
                  ? "Subtarefas (mini-missões)"
                  : "Etapas da tarefa"}
              </span>
              <div className="subtask-editor">
                <input
                  value={form.subtaskDraft || ""}
                  onChange={(e) =>
                    setForm({ ...form, subtaskDraft: e.target.value })
                  }
                  placeholder="Ex.: Enviar orçamento para aprovação"
                  aria-label="Nova subtarefa"
                />
                <Button
                  type="button"
                  variant="secondary"
                  icon={Plus}
                  disabled={!(form.subtaskDraft || "").trim()}
                  onClick={() =>
                    setForm({
                      ...form,
                      subtasks: [
                        ...(form.subtasks || []),
                        {
                          id: uid(),
                          title: form.subtaskDraft.trim(),
                          done: false,
                        },
                      ],
                      subtaskDraft: "",
                    })
                  }
                >
                  Adicionar
                </Button>
              </div>
              {(form.subtasks || []).length > 0 && (
                <div className="member-list">
                  {form.subtasks.map((s) => (
                    <div key={s.id}>
                      <label className="cost-check">
                        <input
                          type="checkbox"
                          checked={!!s.done}
                          onChange={() =>
                            setForm({
                              ...form,
                              subtasks: form.subtasks.map((x) =>
                                x.id === s.id ? { ...x, done: !x.done } : x,
                              ),
                            })
                          }
                        />
                        <span className={s.done ? "subtask-done" : undefined}>
                          {s.title}
                        </span>
                      </label>
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label={`Remover subtarefa ${s.title}`}
                        onClick={() =>
                          setForm({
                            ...form,
                            subtasks: form.subtasks.filter(
                              (x) => x.id !== s.id,
                            ),
                          })
                        }
                      >
                        <X />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {editingTask && (form.aiOutputs || []).length > 0 && (
              <div className="field task-ai-outputs">
                <span>Entregas produzidas pela IA</span>
                <small>
                  Confira a entrega e os critérios antes de marcar a tarefa como
                  concluída.
                </small>
                {form.aiOutputs.map((output, index) => (
                  <details className="task-ai-output" key={output.id}>
                    <summary>
                      Entrega {index + 1} ·{" "}
                      {output.specialist || "Seu Funcionário"}
                    </summary>
                    <Markdown text={output.content} />
                  </details>
                ))}
              </div>
            )}
            {editingTask?.isMission &&
              (editingTask.interested || []).length > 0 && (
                <div className="field">
                  <span>Interessados nesta missão</span>
                  <div className="member-list">
                    {editingTask.interested.map((i) => (
                      <div key={i.userId}>
                        <span className="avatar">{i.name[0]}</span>
                        <span>
                          <strong>{i.name}</strong>
                        </span>
                        <span className="task-actions">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() =>
                              approveInterested(editingTask, i.userId)
                            }
                          >
                            Aprovar
                          </Button>
                          <button
                            type="button"
                            className="icon-button danger"
                            aria-label={`Recusar interesse de ${i.name}`}
                            onClick={() =>
                              rejectInterested(editingTask, i.userId)
                            }
                          >
                            <X />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            {editingTask &&
              (editingTask.assigneeId === db.user.id ||
                (editingTask.assignees || []).some(
                  (a) => a.userId === db.user.id,
                )) && (
                <div className="field">
                  <span>Enviar entrega</span>
                  <textarea
                    aria-label="Comentário da entrega"
                    value={form.deliveryDraft || ""}
                    onChange={(e) =>
                      setForm({ ...form, deliveryDraft: e.target.value })
                    }
                    placeholder="Descreva o que foi feito, links ou observações"
                  />
                  <div className="feedback-toggles">
                    <label className="cost-check">
                      <input
                        type="checkbox"
                        checked={deliveryFeedback.wasClear}
                        onChange={(e) =>
                          setDeliveryFeedback((f) => ({
                            ...f,
                            wasClear: e.target.checked,
                          }))
                        }
                      />
                      <span>A tarefa estava clara</span>
                    </label>
                    <label className="cost-check">
                      <input
                        type="checkbox"
                        checked={deliveryFeedback.neededHelp}
                        onChange={(e) =>
                          setDeliveryFeedback((f) => ({
                            ...f,
                            neededHelp: e.target.checked,
                          }))
                        }
                      />
                      <span>Precisei de ajuda</span>
                    </label>
                  </div>
                  <input
                    ref={deliveryAttachRef}
                    className="visually-hidden"
                    type="file"
                    multiple
                    accept="image/*,.pdf,.docx,.txt,.md,.markdown,.csv"
                    aria-label="Anexar arquivo à entrega"
                    onChange={async (e) => {
                      const files = e.target.files;
                      e.target.value = "";
                      const next = await addAttachmentsFromFiles(
                        files,
                        deliveryAttachments,
                        setToast,
                      );
                      setDeliveryAttachments(next);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    icon={Paperclip}
                    onClick={() => deliveryAttachRef.current?.click()}
                  >
                    Anexar arquivo à entrega
                  </Button>
                  <AttachmentList
                    attachments={deliveryAttachments}
                    onRemove={(id) =>
                      setDeliveryAttachments((current) =>
                        current.filter((a) => a.id !== id),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!(form.deliveryDraft || "").trim()}
                    onClick={() => {
                      submitDelivery(
                        editingTask,
                        form.deliveryDraft || "",
                        deliveryFeedback,
                        deliveryAttachments,
                      );
                      setForm({ ...form, deliveryDraft: "" });
                      setDeliveryFeedback({
                        wasClear: false,
                        neededHelp: false,
                      });
                      setDeliveryAttachments([]);
                    }}
                  >
                    Enviar entrega
                  </Button>
                </div>
              )}
            {editingTask &&
              editingTask.ownerId === db.user.id &&
              editingTask.missionStatus === "enviada_para_revisao" && (
                <Field label="Revisar entrega">
                  <p>
                    {
                      editingTask.deliveries?.[
                        editingTask.deliveries.length - 1
                      ]?.comment
                    }
                  </p>
                  <AttachmentList
                    attachments={
                      editingTask.deliveries?.[
                        editingTask.deliveries.length - 1
                      ]?.attachments
                    }
                  />
                  <div className="feedback-toggles">
                    <label className="cost-check">
                      <input
                        type="checkbox"
                        checked={reviewFeedback.followedInstructions}
                        onChange={(e) =>
                          setReviewFeedback((f) => ({
                            ...f,
                            followedInstructions: e.target.checked,
                          }))
                        }
                      />
                      <span>Seguiu as instruções</span>
                    </label>
                    <label className="cost-check">
                      <input
                        type="checkbox"
                        checked={reviewFeedback.autonomous}
                        onChange={(e) =>
                          setReviewFeedback((f) => ({
                            ...f,
                            autonomous: e.target.checked,
                          }))
                        }
                      />
                      <span>Demonstrou autonomia</span>
                    </label>
                  </div>
                  <div className="modal-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        reviewDelivery(
                          editingTask,
                          false,
                          "Ajuste solicitado pelo gestor",
                          reviewFeedback,
                        )
                      }
                    >
                      Solicitar correção
                    </Button>
                    <Button
                      type="button"
                      onClick={() =>
                        reviewDelivery(editingTask, true, "", reviewFeedback)
                      }
                    >
                      Aprovar entrega
                    </Button>
                  </div>
                </Field>
              )}
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" icon={Save}>
                {editing ? "Salvar alterações" : "Criar tarefa"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </PageTitle>
  );
}
