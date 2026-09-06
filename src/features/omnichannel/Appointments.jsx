import { useEffect, useState } from "react";
import {
  CalendarDays,
  Edit3,
  MessageSquareText,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import Modal from "../../components/Modal.jsx";
import { Button, Empty, Field, PageTitle } from "../../components/ui.jsx";
import { contactLinks, today, uid } from "../../domain.js";

export default function Appointments({
  db,
  update,
  business,
  setToast,
  SharingFields,
  createGoogleCalendarEventReal,
  googleCalendarUrl,
  upsertContact,
  useWhatsappSender,
}) {
  const isEmployeeMode = (db.preferences.mode || "business") === "employee";
  const wa = useWhatsappSender({ db, setToast });
  const [modal, setModal] = useState(false),
    [editing, setEditing] = useState(null),
    [view, setView] = useState("dia"),
    [day, setDay] = useState(today()),
    [search, setSearch] = useState(""),
    [googleId, setGoogleId] = useState("");
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => setGoogleId(d.googleClientId || ""))
      .catch(() => {});
  }, []);
  const blankAppointment = {
    title: "",
    clientName: "",
    clientContact: "",
    date: day,
    time: "09:00",
    durationMinutes: 60,
    professional: "",
    status: "Confirmado",
    notes: "",
    visibility: "espaco_todo",
    sharedWith: [],
    sharedTeams: [],
  };
  const [form, setForm] = useState(blankAppointment);
  const statuses = ["Confirmado", "Concluído", "Cancelado", "Faltou"];
  const all = (db.appointments || []).filter(
    (a) => !business || a.businessId === business.id,
  );
  const scoped = all
    .filter(
      (a) =>
        !search ||
        `${a.title} ${a.clientName}`.toLowerCase().includes(search.toLowerCase()),
    )
    .filter((a) => view !== "dia" || a.date === day)
    .filter((a) => view !== "proximos" || a.date >= today())
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const openAppointment = (item = null) => {
    setEditing(item?.id || null);
    setForm(item ? { ...blankAppointment, ...item } : { ...blankAppointment, date: day });
    setModal(true);
  };
  const save = (e) => {
    e.preventDefault();
    if (
      !form.title.trim() ||
      (!isEmployeeMode && !form.clientName.trim()) ||
      !form.date
    )
      return;
    const now = new Date().toISOString();
    const item = {
      ...form,
      title: form.title.trim(),
      clientName: form.clientName.trim(),
      id: editing || uid(),
      businessId: business?.id || null,
      ownerId: form.ownerId || db.user.id,
      visibility: form.visibility || "espaco_todo",
      sharedWith: Array.isArray(form.sharedWith) ? form.sharedWith : [],
      sharedTeams: Array.isArray(form.sharedTeams) ? form.sharedTeams : [],
      createdAt: form.createdAt || now,
      updatedAt: now,
    };
    update((d) => ({
      ...d,
      appointments: editing
        ? (d.appointments || []).map((a) => (a.id === editing ? item : a))
        : [item, ...(d.appointments || [])],
      contacts: upsertContact(d.contacts || [], {
        name: item.clientName,
        contact: item.clientContact,
        businessId: item.businessId,
        ownerId: db.user.id,
      }),
    }));
    setModal(false);
    setToast(editing ? "Agendamento atualizado" : "Agendamento criado");
  };
  const removeAppointment = (id) => {
    if (!confirm("Excluir este agendamento?")) return;
    update((d) => ({
      ...d,
      appointments: (d.appointments || []).filter((a) => a.id !== id),
    }));
  };
  const changeStatus = (item, status) =>
    update((d) => ({
      ...d,
      appointments: (d.appointments || []).map((a) =>
        a.id === item.id
          ? { ...a, status, updatedAt: new Date().toISOString() }
          : a,
      ),
    }));
  const remindWhatsapp = (item) => {
    const { phone } = contactLinks(item.clientContact);
    const when = new Date(`${item.date}T12:00`).toLocaleDateString("pt-BR");
    wa.open({
      phone,
      category: "Agendamento",
      vars: {
        nome: item.clientName || "",
        negocio: business?.name || "",
        servico: item.title || "",
        data: when,
        hora: item.time || "",
      },
    });
  };
  const addToCalendar = async (item) => {
    const task = {
      title: item.clientName ? `${item.title} - ${item.clientName}` : item.title,
      due: item.date,
      time: item.time,
      durationMinutes: item.durationMinutes,
      description: item.notes,
      assignee: item.professional,
    };
    try {
      await createGoogleCalendarEventReal(googleId, task);
      setToast("Adicionado à sua Google Agenda");
    } catch {
      window.open(googleCalendarUrl(task), "_blank", "noopener");
    }
  };
  return (
    <PageTitle
      eyebrow="AGENDAMENTOS"
      title="Sua agenda de atendimentos"
      text="Marque horários, confirme por WhatsApp e sincronize com a Google Agenda."
      action={
        <Button icon={Plus} onClick={() => openAppointment()}>
          Novo agendamento
        </Button>
      }
    >
      <div className="toolbar">
        <div className="search">
          <Search />
          <input
            type="search"
            placeholder="Buscar por serviço ou cliente"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar agendamentos"
          />
        </div>
        <div className="view-toggle">
          <button
            className={view === "dia" ? "active" : ""}
            onClick={() => setView("dia")}
          >
            Dia
          </button>
          <button
            className={view === "proximos" ? "active" : ""}
            onClick={() => setView("proximos")}
          >
            Próximos
          </button>
          <button
            className={view === "todos" ? "active" : ""}
            onClick={() => setView("todos")}
          >
            Todos
          </button>
        </div>
        {view === "dia" && (
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            aria-label="Escolher dia"
          />
        )}
      </div>
      {scoped.length === 0 ? (
        <Empty
          icon={CalendarDays}
          title="Nenhum agendamento aqui"
          text="Marque o primeiro horário e confirme com o cliente pelo WhatsApp."
          action="Novo agendamento"
          onAction={() => openAppointment()}
        />
      ) : (
        <div className="data-list">
          {scoped.map((item) => (
            <article key={item.id}>
              <span className={`status-dot ${item.status.toLowerCase()}`} />
              <span>
                <strong>{item.title}</strong>
                <small>
                  {new Date(`${item.date}T12:00`).toLocaleDateString("pt-BR")} ·{" "}
                  {item.time}
                  {item.clientName && ` · ${item.clientName}`}
                  {item.professional && ` · ${item.professional}`}
                </small>
              </span>
              <select
                value={item.status}
                onChange={(e) => changeStatus(item, e.target.value)}
              >
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <span className="task-actions">
                {contactLinks(item.clientContact).phone && (
                  <button
                    className="icon-button"
                    aria-label={`Confirmar por WhatsApp${item.clientName ? ` com ${item.clientName}` : ""}`}
                    title="Confirmar por WhatsApp"
                    onClick={() => remindWhatsapp(item)}
                  >
                    <MessageSquareText />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Adicionar "${item.title}" à Google Agenda`}
                  title="Adicionar à Google Agenda"
                  onClick={() => addToCalendar(item)}
                >
                  <CalendarDays />
                </button>
                <button
                  className="icon-button"
                  aria-label="Editar agendamento"
                  onClick={() => openAppointment(item)}
                >
                  <Edit3 />
                </button>
                <button
                  className="icon-button danger"
                  aria-label="Excluir agendamento"
                  onClick={() => removeAppointment(item.id)}
                >
                  <Trash2 />
                </button>
              </span>
            </article>
          ))}
        </div>
      )}
      {modal && (
        <Modal
          title={editing ? "Editar agendamento" : "Novo agendamento"}
          onClose={() => setModal(false)}
        >
          <form className="modal-body" onSubmit={save}>
            <Field label="Serviço ou motivo">
              <input
                required
                autoFocus
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Ex.: Coleta programada, Janela de entrega dedicada"
              />
            </Field>
            <div className="form-grid">
              <Field label={isEmployeeMode ? "Com quem (opcional)" : "Cliente"}>
                <input
                  required={!isEmployeeMode}
                  value={form.clientName}
                  onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                  placeholder={
                    isEmployeeMode ? "Pessoa, empresa ou deixe em branco" : ""
                  }
                />
              </Field>
              <Field label="WhatsApp ou e-mail">
                <input
                  value={form.clientContact}
                  onChange={(e) =>
                    setForm({ ...form, clientContact: e.target.value })
                  }
                  placeholder="(11) 98888-7777"
                />
              </Field>
              <Field label="Data">
                <input
                  required
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </Field>
              <Field label="Horário">
                <input
                  required
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                />
              </Field>
              <Field label="Duração (minutos)">
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={form.durationMinutes}
                  onChange={(e) =>
                    setForm({ ...form, durationMinutes: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Profissional (opcional)">
                <input
                  value={form.professional}
                  onChange={(e) =>
                    setForm({ ...form, professional: e.target.value })
                  }
                />
              </Field>
              <Field label="Status">
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {statuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Observações">
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
            <SharingFields
              value={{
                visibility: form.visibility,
                sharedWith: form.sharedWith,
                sharedTeams: form.sharedTeams,
              }}
              onChange={(next) => setForm({ ...form, ...next })}
              teams={db.teams}
            />
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" icon={Save}>
                {editing ? "Salvar alterações" : "Salvar agendamento"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {wa.modal}
    </PageTitle>
  );
}
