import { useMemo, useState } from "react";
import {
  Activity,
  Columns3,
  LayoutGrid,
  List,
  Search,
  UsersRound,
} from "lucide-react";
import {
  PROJECT_AREAS,
  PROJECT_STATUSES,
  projectArea,
  projectMetrics,
} from "../projects/projectDomain.js";
import "./ProjectPortfolioViews.css";

const today = () => new Date().toISOString().slice(0, 10);
const brDate = (value) => (value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—");
const clean = (value) => String(value || "").trim();

const HEALTHS = ["Saudável", "Em risco", "Bloqueado", "Concluído"];
const TASK_STATUSES = ["A fazer", "Em andamento", "Em revisão", "Concluído"];

const healthTone = (health) =>
  health === "Concluído"
    ? "done"
    : health === "Bloqueado"
      ? "blocked"
      : health === "Em risco"
        ? "risk"
        : "healthy";

function ProjectCard({ item, onPatch, draggable, onDragStart }) {
  const { project, metrics } = item;
  return (
    <article
      className={`pv-card health-${healthTone(metrics.health)}`}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      <header>
        <span>
          <strong>{project.name || "Projeto sem nome"}</strong>
          <small>{projectArea(project)} · {project.priority || "Média"}</small>
        </span>
        <b>{metrics.progress}%</b>
      </header>
      <div className="pv-progress" aria-label={`${metrics.progress}% concluído`}>
        <span style={{ width: `${Math.max(0, Math.min(100, metrics.progress))}%` }} />
      </div>
      <dl>
        <div><dt>Saúde</dt><dd>{metrics.health}</dd></div>
        <div><dt>Tarefas</dt><dd>{metrics.completedTasks}/{metrics.tasks}</dd></div>
        <div><dt>Prazo</dt><dd>{brDate(project.dueDate)}</dd></div>
      </dl>
      <footer>
        <label>
          <span>Status</span>
          <select
            value={project.status || "Planejamento"}
            onChange={(event) => onPatch(project.id, { status: event.target.value })}
          >
            {PROJECT_STATUSES.map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
        <label>
          <span>Área</span>
          <select
            value={projectArea(project)}
            onChange={(event) => onPatch(project.id, { area: event.target.value })}
          >
            {[...new Set([...PROJECT_AREAS, projectArea(project)])].map((area) => <option key={area}>{area}</option>)}
          </select>
        </label>
      </footer>
    </article>
  );
}

function TaskCard({ task, projectName, onPatch }) {
  const overdue = task.status !== "Concluído" && task.due && task.due < today();
  return (
    <article className={`pv-task-card ${overdue ? "overdue" : ""}`}>
      <strong>{task.title || "Tarefa sem título"}</strong>
      <small>{projectName}{task.priority ? ` · ${task.priority}` : ""}</small>
      {task.due && <span>Prazo {brDate(task.due)}</span>}
      <select
        aria-label={`Status de ${task.title || "tarefa"}`}
        value={task.status || "A fazer"}
        onChange={(event) => onPatch(task.id, { status: event.target.value })}
      >
        {[...new Set([...TASK_STATUSES, task.status].filter(Boolean))].map((status) => <option key={status}>{status}</option>)}
      </select>
    </article>
  );
}

export default function ProjectPortfolioViews({ db, update, business }) {
  const [view, setView] = useState("kanban");
  const [boardMode, setBoardMode] = useState("projects");
  const [groupBy, setGroupBy] = useState("status");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState("all");
  const [draggingId, setDraggingId] = useState("");

  const businessId = business?.id || "";
  const projects = useMemo(
    () => (db.projects || []).filter((project) => !businessId || !project.businessId || project.businessId === businessId),
    [businessId, db.projects],
  );
  const tasks = useMemo(
    () => (db.tasks || []).filter((task) => !businessId || !task.businessId || task.businessId === businessId),
    [businessId, db.tasks],
  );

  const rows = useMemo(
    () => projects.map((project) => ({ project, metrics: projectMetrics(project, tasks, today()) })),
    [projects, tasks],
  );
  const areas = useMemo(
    () => [...new Set([...PROJECT_AREAS, ...projects.map(projectArea)])].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [projects],
  );
  const managers = useMemo(
    () => [...new Set(projects.map((project) => clean(project.manager)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [projects],
  );

  const filtered = useMemo(() => rows.filter(({ project, metrics }) => {
    const haystack = `${project.name || ""} ${project.description || ""} ${project.objective || ""} ${projectArea(project)} ${project.manager || ""} ${project.sponsor || ""}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) &&
      (statusFilter === "all" || project.status === statusFilter) &&
      (areaFilter === "all" || projectArea(project) === areaFilter) &&
      (managerFilter === "all" || (managerFilter === "unassigned" ? !clean(project.manager) : project.manager === managerFilter)) &&
      (healthFilter === "all" || metrics.health === healthFilter);
  }), [areaFilter, healthFilter, managerFilter, query, rows, statusFilter]);

  const patchProject = (id, patch) =>
    update((current) => ({
      ...current,
      projects: (current.projects || []).map((project) =>
        project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project,
      ),
    }));

  const patchTask = (id, patch) =>
    update((current) => ({
      ...current,
      tasks: (current.tasks || []).map((task) =>
        task.id === id ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task,
      ),
    }));

  const groups = useMemo(() => {
    if (groupBy === "area") return areas;
    if (groupBy === "manager") return [...managers, "Sem responsável"];
    if (groupBy === "health") return HEALTHS;
    return PROJECT_STATUSES;
  }, [areas, groupBy, managers]);

  const groupValue = (item) => {
    if (groupBy === "area") return projectArea(item.project);
    if (groupBy === "manager") return clean(item.project.manager) || "Sem responsável";
    if (groupBy === "health") return item.metrics.health;
    return item.project.status || "Planejamento";
  };

  const taskColumns = useMemo(() => filtered.map(({ project }) => ({
    project,
    tasks: tasks.filter((task) =>
      task.projectId === project.id || (!task.projectId && task.project && task.project === project.name)),
  })), [filtered, tasks]);

  const filteredIds = new Set(filtered.map((item) => item.project.id));
  const orphanTasks = tasks.filter((task) =>
    !task.projectId && !task.project &&
    `${task.title || ""} ${task.description || ""}`.toLowerCase().includes(query.toLowerCase()),
  );

  const dropStatus = (status) => {
    if (!draggingId || groupBy !== "status") return;
    patchProject(draggingId, { status });
    setDraggingId("");
  };

  if (!projects.length) {
    return (
      <div className="pv-empty">
        <Columns3 />
        <strong>Nenhum projeto cadastrado</strong>
        <p>Projetos podem pertencer a qualquer área. Quando forem criados, este portfólio reúne todos numa única visão.</p>
      </div>
    );
  }

  return (
    <div className="pv-root">
      <div className="pv-toolbar">
        <div className="pv-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar projeto, área ou responsável" />
        </div>
        <div className="pv-view-switch" aria-label="Visualização dos projetos">
          <button type="button" className={view === "kanban" ? "active" : ""} onClick={() => setView("kanban")}><Columns3 size={15} />Kanban</button>
          <button type="button" className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}><LayoutGrid size={15} />Cards</button>
          <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}><List size={15} />Tabela</button>
        </div>
      </div>

      <div className="pv-filters">
        <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option>{PROJECT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label><span>Área</span><select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}><option value="all">Todas</option>{areas.map((area) => <option key={area}>{area}</option>)}</select></label>
        <label><span>Responsável</span><select value={managerFilter} onChange={(event) => setManagerFilter(event.target.value)}><option value="all">Todos</option><option value="unassigned">Sem responsável</option>{managers.map((manager) => <option key={manager}>{manager}</option>)}</select></label>
        <label><span>Saúde</span><select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value)}><option value="all">Toda saúde</option>{HEALTHS.map((health) => <option key={health}>{health}</option>)}</select></label>
      </div>

      {view === "kanban" && (
        <>
          <div className="pv-board-controls">
            <div className="pv-mode-switch">
              <button type="button" className={boardMode === "projects" ? "active" : ""} onClick={() => setBoardMode("projects")}><Activity size={15} />Projetos</button>
              <button type="button" className={boardMode === "tasks" ? "active" : ""} onClick={() => setBoardMode("tasks")}><UsersRound size={15} />Tarefas por projeto</button>
            </div>
            {boardMode === "projects" && <label className="pv-group-select"><span>Agrupar por</span><select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="status">Status</option><option value="area">Área</option><option value="manager">Responsável</option><option value="health">Saúde</option></select></label>}
          </div>

          {boardMode === "projects" ? (
            <div className="pv-kanban" aria-label={`Projetos agrupados por ${groupBy}`}>
              {groups.map((group) => {
                const items = filtered.filter((item) => groupValue(item) === group);
                return (
                  <section
                    className="pv-column"
                    key={group}
                    onDragOver={groupBy === "status" ? (event) => event.preventDefault() : undefined}
                    onDrop={groupBy === "status" ? () => dropStatus(group) : undefined}
                  >
                    <header><strong>{group}</strong><span>{items.length}</span></header>
                    <div className="pv-column-body">
                      {!items.length && <p>Sem projetos.</p>}
                      {items.map((item) => <ProjectCard key={item.project.id} item={item} onPatch={patchProject} draggable={groupBy === "status"} onDragStart={() => setDraggingId(item.project.id)} />)}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="pv-kanban pv-task-board" aria-label="Tarefas agrupadas por projeto">
              {taskColumns.map(({ project, tasks: projectTasks }) => (
                <section className="pv-column" key={project.id}>
                  <header><span><strong>{project.name}</strong><small>{projectArea(project)}</small></span><span>{projectTasks.length}</span></header>
                  <div className="pv-column-body">
                    {!projectTasks.length && <p>Sem tarefas vinculadas.</p>}
                    {projectTasks.map((task) => <TaskCard key={task.id} task={task} projectName={project.name} onPatch={patchTask} />)}
                  </div>
                </section>
              ))}
              {orphanTasks.length > 0 && <section className="pv-column"><header><strong>Sem projeto</strong><span>{orphanTasks.length}</span></header><div className="pv-column-body">{orphanTasks.map((task) => <TaskCard key={task.id} task={task} projectName="Sem projeto" onPatch={patchTask} />)}</div></section>}
            </div>
          )}
        </>
      )}

      {view === "cards" && <div className="pv-card-grid">{filtered.map((item) => <ProjectCard key={item.project.id} item={item} onPatch={patchProject} />)}</div>}

      {view === "table" && (
        <div className="pv-table-wrap">
          <table className="pv-table">
            <thead><tr><th>Projeto</th><th>Área</th><th>Responsável</th><th>Status</th><th>Saúde</th><th>Progresso</th><th>Prazo</th></tr></thead>
            <tbody>
              {filtered.map(({ project, metrics }) => (
                <tr key={project.id}>
                  <td><strong>{project.name}</strong><small>{project.priority || "Média"}</small></td>
                  <td><select aria-label={`Área de ${project.name}`} value={projectArea(project)} onChange={(event) => patchProject(project.id, { area: event.target.value })}>{[...new Set([...areas, projectArea(project)])].map((area) => <option key={area}>{area}</option>)}</select></td>
                  <td>{project.manager || "Sem responsável"}</td>
                  <td><select aria-label={`Status de ${project.name}`} value={project.status || "Planejamento"} onChange={(event) => patchProject(project.id, { status: event.target.value })}>{PROJECT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></td>
                  <td><span className={`pv-health ${healthTone(metrics.health)}`}>{metrics.health}</span></td>
                  <td>{metrics.progress}%</td>
                  <td>{brDate(project.dueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!filtered.length && <p className="pv-no-results">Nenhum projeto corresponde aos filtros.</p>}
    </div>
  );
}
