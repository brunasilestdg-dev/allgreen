import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckSquare,
  Clock3,
  Plus,
  Wand2,
} from "lucide-react";
import {
  DEFAULT_WORK_HOURS,
  PRIORITIES,
  addDays,
  autoSchedule,
  dayLoad,
  detectConflicts,
  formatDuration,
  freeSlots,
  isTaskCompleted,
  minutesToTime,
  parseTaskInput,
  rescheduleOverdue,
} from "./plannerDomain.js";

const newId = () => `p-${Math.random().toString(36).slice(2, 10)}`;
const hoje = () => new Date().toISOString().slice(0, 10);
const diaSemana = (iso) =>
  ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][
    new Date(`${iso}T00:00:00Z`).getUTCDay()
  ];

export default function DayPlanner({ db, update, business, setToast }) {
  const [entrada, setEntrada] = useState("");
  const [plano, setPlano] = useState(null);
  const [dias, setDias] = useState(5);

  const jornada = { ...DEFAULT_WORK_HOURS, ...(db.workHours || {}) };

  const tarefas = useMemo(
    () =>
      (db.tasks || []).filter(
        (t) =>
          (!business || t.businessId === business.id) &&
          !isTaskCompleted(t.status),
      ),
    [db.tasks, business],
  );
  const projetos = useMemo(
    () => [
      ...new Set([
        ...(db.projects || []).map((p) => p.name),
        ...(db.tasks || []).map((t) => t.project).filter(Boolean),
      ]),
    ],
    [db.projects, db.tasks],
  );

  // Compromissos da agenda, no formato que o planejador entende.
  const compromissos = useMemo(
    () =>
      (db.appointments || [])
        .filter((a) => !business || a.businessId === business.id)
        .map((a) => ({
          date: String(a.date || "").slice(0, 10),
          start: a.time || a.start || "",
          end: a.end || "",
          durationMinutes: Number(a.durationMinutes) || 60,
          title: a.title || a.client || "Compromisso",
        }))
        .filter((a) => a.date && a.start),
    [db.appointments, business],
  );

  const previa = entrada.trim()
    ? parseTaskInput(entrada, { today: hoje(), projects: projetos })
    : null;
  const conflitos = detectConflicts(compromissos);
  const atrasadas = tarefas.filter((t) => t.due && t.due < hoje());
  const cargas = Array.from({ length: dias }, (_, i) =>
    dayLoad(compromissos, addDays(hoje(), i), jornada),
  );

  const criar = () => {
    if (!previa || !previa.title) return;
    const tarefa = {
      id: newId(),
      title: previa.title,
      status: "A fazer",
      due: previa.due || "",
      time: previa.time || "",
      durationMinutes: previa.durationMinutes || null,
      priority: previa.priority || "",
      project: previa.project || "",
      assignee: previa.assignee || "",
      recurrence: previa.recurrence || "",
      businessId: business?.id || null,
      ownerId: db.user?.id || null,
    };
    update((prev) => ({ ...prev, tasks: [tarefa, ...(prev.tasks || [])] }));
    setEntrada("");
    setToast("Tarefa criada");
  };

  const planejar = () => {
    const resultado = autoSchedule(tarefas, compromissos, {
      from: hoje(),
      days: dias,
      workHours: jornada,
    });
    setPlano(resultado);
    if (resultado.placements.length === 0 && resultado.unplaced.length === 0)
      setToast("Nenhuma tarefa em aberto para encaixar.");
  };

  const aplicarPlano = () => {
    if (!plano || plano.placements.length === 0) return;
    const porTarefa = new Map(plano.placements.map((p) => [p.taskId, p]));
    update((prev) => ({
      ...prev,
      tasks: (prev.tasks || []).map((t) =>
        porTarefa.has(t.id)
          ? {
              ...t,
              due: porTarefa.get(t.id).date,
              time: minutesToTime(porTarefa.get(t.id).start),
              agendadaAutomaticamente: true,
            }
          : t,
      ),
    }));
    setToast(`${plano.placements.length} tarefa(s) encaixadas na agenda`);
    setPlano(null);
  };

  const puxarAtrasadas = () => {
    if (atrasadas.length === 0) return;
    update((prev) => ({
      ...prev,
      tasks: rescheduleOverdue(prev.tasks || [], hoje(), jornada),
    }));
    setToast(`${atrasadas.length} tarefa(s) atrasadas trazidas para hoje`);
  };

  const salvarJornada = (campos) =>
    update((prev) => ({ ...prev, workHours: { ...jornada, ...campos } }));

  return (
    <section className="plan">
      <header className="plan-head">
        <div>
          <h2>
            <CalendarClock size={20} /> Planejar o dia
          </h2>
          <p>
            Escreva a tarefa como você falaria. O app entende a data, a hora, a
            duração e a prioridade — e encaixa o que falta fazer nos horários
            que sobraram na sua agenda.
          </p>
        </div>
      </header>

      <div className="plan-capture">
        <input
          aria-label="Escrever tarefa em linguagem natural"
          placeholder="ligar pro fornecedor sexta às 15h por 30min !alta #compras"
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") criar();
          }}
        />
        <button className="btn" onClick={criar} disabled={!previa?.title}>
          <Plus size={16} /> Criar
        </button>
      </div>

      {previa && (
        <div className="plan-preview">
          <strong>{previa.title || "(sem título)"}</strong>
          {previa.due && (
            <span>
              {previa.due} ({diaSemana(previa.due)})
            </span>
          )}
          {previa.time && <span>às {previa.time}</span>}
          {previa.durationMinutes && (
            <span>{formatDuration(previa.durationMinutes)}</span>
          )}
          {previa.priority && (
            <span className={`plan-prio ${previa.priority}`}>
              {PRIORITIES.find((p) => p.id === previa.priority)?.label}
            </span>
          )}
          {previa.project && <span>#{previa.project}</span>}
          {previa.assignee && <span>@{previa.assignee}</span>}
          {previa.recurrence && <span>repete: {previa.recurrence}</span>}
          {previa.understood.length === 0 && (
            <small>Nada de data ou hora reconhecido — vai entrar sem prazo.</small>
          )}
        </div>
      )}

      <div className="plan-work">
        <label>
          Começo
          <input
            type="time"
            value={jornada.start}
            onChange={(e) => salvarJornada({ start: e.target.value })}
          />
        </label>
        <label>
          Fim
          <input
            type="time"
            value={jornada.end}
            onChange={(e) => salvarJornada({ end: e.target.value })}
          />
        </label>
        <label>
          Almoço
          <input
            type="time"
            value={jornada.lunchStart}
            onChange={(e) => salvarJornada({ lunchStart: e.target.value })}
          />
        </label>
        <label>
          Volta
          <input
            type="time"
            value={jornada.lunchEnd}
            onChange={(e) => salvarJornada({ lunchEnd: e.target.value })}
          />
        </label>
        <label>
          Dias à frente
          <input
            type="number"
            min="1"
            max="14"
            value={dias}
            onChange={(e) => setDias(Math.max(1, Math.min(14, Number(e.target.value) || 5)))}
          />
        </label>
        <button className="btn" onClick={planejar}>
          <Wand2 size={16} /> Encaixar tarefas
        </button>
      </div>

      {conflitos.length > 0 && (
        <div className="plan-alert">
          <AlertTriangle size={15} />
          <div>
            <strong>Compromissos em cima um do outro</strong>
            <ul>
              {conflitos.slice(0, 4).map((c, i) => (
                <li key={`${c.date}-${i}`}>
                  {c.date}: “{c.a}” e “{c.b}” se sobrepõem por{" "}
                  {formatDuration(c.overlapMinutes)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {atrasadas.length > 0 && (
        <div className="plan-alert warn">
          <Clock3 size={15} />
          <div>
            <strong>
              {atrasadas.length}{" "}
              {atrasadas.length === 1 ? "tarefa atrasada" : "tarefas atrasadas"}
            </strong>
            <p>Ficaram para trás. Dá para trazer todas para o próximo dia útil.</p>
          </div>
          <button className="btn ghost sm" onClick={puxarAtrasadas}>
            Trazer para hoje
          </button>
        </div>
      )}

      <div className="plan-days">
        {cargas.map((carga) => (
          <article
            key={carga.date}
            className={carga.overloaded ? "over" : carga.capacityMinutes === 0 ? "off" : ""}
          >
            <header>
              <strong>{diaSemana(carga.date)}</strong>
              <small>{carga.date.slice(8, 10)}/{carga.date.slice(5, 7)}</small>
            </header>
            {carga.capacityMinutes === 0 ? (
              <p className="plan-off">Fora da jornada</p>
            ) : (
              <>
                <div className="plan-bar">
                  <span style={{ width: `${Math.min(100, carga.usage)}%` }} />
                </div>
                <small>
                  {formatDuration(carga.busyMinutes)} de{" "}
                  {formatDuration(carga.capacityMinutes)}
                </small>
                <small className="plan-free">
                  livre: {formatDuration(carga.freeMinutes)}
                </small>
                {carga.overloaded && (
                  <small className="plan-over">acima da jornada</small>
                )}
              </>
            )}
            <ul className="plan-slots">
              {freeSlots(compromissos, carga.date, jornada, 30)
                .slice(0, 3)
                .map((v) => (
                  <li key={`${v.date}-${v.start}`}>
                    {minutesToTime(v.start)}–{minutesToTime(v.end)}
                  </li>
                ))}
            </ul>
          </article>
        ))}
      </div>

      {plano && (
        <div className="plan-result">
          <header>
            <h3>Encaixe proposto</h3>
            {plano.placements.length > 0 && (
              <button className="btn" onClick={aplicarPlano}>
                <CheckSquare size={15} /> Aplicar na agenda
              </button>
            )}
          </header>
          {plano.placements.length > 0 ? (
            <ul className="plan-placements">
              {plano.placements.map((p) => (
                <li key={p.taskId}>
                  <span className="plan-when">
                    {diaSemana(p.date)} {p.date.slice(8, 10)}/{p.date.slice(5, 7)} ·{" "}
                    {minutesToTime(p.start)}–{minutesToTime(p.end)}
                  </span>
                  <span>{p.title}</span>
                  {p.fixed && <em>hora pedida</em>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="plan-hint">Nada foi encaixado.</p>
          )}
          {plano.unplaced.length > 0 && (
            <div className="plan-unplaced">
              <strong>Não caberam:</strong>
              <ul>
                {plano.unplaced.map((p) => (
                  <li key={p.taskId}>
                    {p.title} — {p.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
