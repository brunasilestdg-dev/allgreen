import { useMemo, useState } from "react";
import { AlertTriangle, Clock3, MapPin, PackageCheck, Plus, Route, Truck } from "lucide-react";
import { LOGISTICS_PRODUCTS } from "../logisticsVerticalDomain.js";

const agoraLocal = () => new Date().toISOString().slice(0, 16);
const EVENT_TYPES = ["coleta", "transito", "chegada", "entrega", "ocorrencia", "reagendamento", "documento"];
const STATUS = ["planned", "active", "in_transit", "delivered", "cancelled"];

const slaEfetivo = (operation, now = new Date()) => {
  if (operation.sla) return operation.sla;
  if (!operation.prometidoEm) return "sem prazo";
  const deadline = new Date(operation.prometidoEm);
  const delivered = operation.entregueEm ? new Date(operation.entregueEm) : null;
  if (delivered) return delivered <= deadline ? "no prazo" : "atrasado";
  return now <= deadline ? "em curso" : "atrasado";
};
const isLate = (operation) => slaEfetivo(operation) === "atrasado";

export default function OperationsPage({ operations = [], clients = [], contracts = [], criar, registrarEventoOperacao, listarSubrecurso, setToast, mode = "operations" }) {
  const empty = { clientId: "", contractId: "", productId: "middle-mile", reference: "", serviceDate: "", origin: "", destination: "", promisedAt: "", etaAt: "", plate: "", driver: "", trips: "", deliveries: "", packages: "", distanceKm: "", occupancyPercent: "", status: "planned" };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState([]);
  const [event, setEvent] = useState({ tipo: "transito", titulo: "", descricao: "", local: "", ocorridoEm: agoraLocal(), recebedor: "", comprovanteUrl: "" });
  const totals = useMemo(() => operations.reduce((sum, item) => ({
    trips: sum.trips + Number(item.viagens || 0), deliveries: sum.deliveries + Number(item.entregas || 0),
    incidents: sum.incidents + Number(item.ocorrencias || 0), distance: sum.distance + Number(item.distanciaKm || 0),
  }), { trips: 0, deliveries: 0, incidents: 0, distance: 0 }), [operations]);
  const isIncidents = mode === "incidents";
  const visibleOperations = useMemo(
    () => isIncidents
      ? operations.filter((operation) => Number(operation.ocorrencias || 0) > 0 || isLate(operation))
      : operations,
    [isIncidents, operations],
  );

  const save = async (submitEvent) => {
    submitEvent.preventDefault();
    setSaving(true);
    try {
      await criar("operations", {
        clientId: form.clientId, contratoId: form.contractId, produtoId: form.productId,
        referencia: form.reference, dataServico: form.serviceDate, origem: form.origin, destino: form.destination,
        prometidoEm: form.promisedAt, etaEm: form.etaAt, placa: form.plate, motorista: form.driver,
        viagens: Number(form.trips), entregas: Number(form.deliveries), pacotes: Number(form.packages),
        distanciaKm: Number(form.distanceKm), ocupacaoPercent: Number(form.occupancyPercent), situacao: form.status,
      });
      setForm(empty);
      setToast?.("Operação registrada na mesma fonte do portal");
    } catch (error) { setToast?.(error.message); }
    finally { setSaving(false); }
  };

  const openEvents = async (operation) => {
    setSelected(operation);
    try {
      const result = await listarSubrecurso("operations", operation.id, "events");
      setEvents(result.eventos || []);
    } catch (error) { setEvents([]); setToast?.(error.message); }
  };

  const saveEvent = async (submitEvent) => {
    submitEvent.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const result = await registrarEventoOperacao(selected.id, event);
      setEvents((current) => [result.evento, ...current]);
      setSelected(result.registro || selected);
      setEvent({ tipo: "transito", titulo: "", descricao: "", local: "", ocorridoEm: agoraLocal(), recebedor: "", comprovanteUrl: "" });
      setToast?.("Evento operacional registrado");
    } catch (error) { setToast?.(error.message); }
    finally { setSaving(false); }
  };

  return (
    <section className="tdg-panel tdg-enterprise-operations">
      <div className="tdg-section-head"><div><span className="tdg-kicker">{isIncidents ? "OCORRÊNCIAS" : "EXECUÇÃO OPERACIONAL"}</span><h2>{isIncidents ? "Ocorrências e exceções operacionais" : "Operação, SLA, frota e execução"}</h2><p>{isIncidents ? "Acompanhe atrasos, insucessos, reentregas, documentos e eventos críticos vinculados à operação." : "A equipe interna escreve na mesma operação que o cliente acompanha no portal."}</p></div><strong>{isIncidents ? `${visibleOperations.length} em atenção` : `${operations.length} operação(ões)`}</strong></div>
      <div className="tdg-result"><article className="tdg-metric"><span>Viagens</span><strong>{totals.trips.toLocaleString("pt-BR")}</strong><small>volume registrado</small></article><article className="tdg-metric good"><span>Entregas</span><strong>{totals.deliveries.toLocaleString("pt-BR")}</strong><small>execução consolidada</small></article><article className={`tdg-metric ${totals.incidents ? "risk" : ""}`}><span>Ocorrências</span><strong>{totals.incidents}</strong><small>eventos operacionais</small></article><article className="tdg-metric"><span>Distância</span><strong>{totals.distance.toLocaleString("pt-BR")} km</strong><small>base para custo e ESG</small></article></div>
      {!isIncidents && <form className="tdg-access-form tdg-enterprise-form" onSubmit={save}>
        <label><span>Cliente</span><select required value={form.clientId} onChange={(e) => setForm((v) => ({ ...v, clientId: e.target.value }))}><option value="">Selecione</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name || client.nome || client.id}</option>)}</select></label>
        <label><span>Contrato</span><select value={form.contractId} onChange={(e) => setForm((v) => ({ ...v, contractId: e.target.value }))}><option value="">Sem contrato</option>{contracts.filter((contract) => !form.clientId || contract.clientId === form.clientId).map((contract) => <option key={contract.id} value={contract.id}>{contract.titulo || contract.title}</option>)}</select></label>
        <label><span>Referência</span><input required value={form.reference} onChange={(e) => setForm((v) => ({ ...v, reference: e.target.value }))} placeholder="Carga, rota ou pedido" /></label>
        <label><span>Data de serviço</span><input type="date" required value={form.serviceDate} onChange={(e) => setForm((v) => ({ ...v, serviceDate: e.target.value }))} /></label>
        <label><span>Origem</span><input value={form.origin} onChange={(e) => setForm((v) => ({ ...v, origin: e.target.value }))} /></label>
        <label><span>Destino</span><input value={form.destination} onChange={(e) => setForm((v) => ({ ...v, destination: e.target.value }))} /></label>
        <label><span>Prazo prometido</span><input type="datetime-local" value={form.promisedAt} onChange={(e) => setForm((v) => ({ ...v, promisedAt: e.target.value }))} /></label>
        <label><span>ETA atual</span><input type="datetime-local" value={form.etaAt} onChange={(e) => setForm((v) => ({ ...v, etaAt: e.target.value }))} /></label>
        <label><span>Placa</span><input value={form.plate} onChange={(e) => setForm((v) => ({ ...v, plate: e.target.value }))} /></label>
        <label><span>Motorista</span><input value={form.driver} onChange={(e) => setForm((v) => ({ ...v, driver: e.target.value }))} /></label>
        <label><span>Viagens</span><input type="number" min="0" value={form.trips} onChange={(e) => setForm((v) => ({ ...v, trips: e.target.value }))} /></label>
        <label><span>Entregas</span><input type="number" min="0" value={form.deliveries} onChange={(e) => setForm((v) => ({ ...v, deliveries: e.target.value }))} /></label>
        <label><span>Pacotes</span><input type="number" min="0" value={form.packages} onChange={(e) => setForm((v) => ({ ...v, packages: e.target.value }))} /></label>
        <label><span>Distância km</span><input type="number" min="0" step="0.1" value={form.distanceKm} onChange={(e) => setForm((v) => ({ ...v, distanceKm: e.target.value }))} /></label>
        <label><span>Ocupação %</span><input type="number" min="0" max="100" value={form.occupancyPercent} onChange={(e) => setForm((v) => ({ ...v, occupancyPercent: e.target.value }))} /></label>
        <label><span>Situação</span><select value={form.status} onChange={(e) => setForm((v) => ({ ...v, status: e.target.value }))}>{STATUS.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
        <label><span>Produto</span><select value={form.productId} onChange={(e) => setForm((v) => ({ ...v, productId: e.target.value }))}>{LOGISTICS_PRODUCTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button className="tdg-action" type="submit" disabled={saving}><Plus size={17} />{saving ? "Salvando..." : "Registrar operação"}</button>
      </form>}
      <div className="tdg-operation-grid">{visibleOperations.length === 0 && <div className="tdg-empty-access">{isIncidents ? "Nenhuma ocorrência ou atraso em aberto." : "Nenhuma operação real registrada."}</div>}{visibleOperations.map((operation) => <article className="tdg-operation-card" key={operation.id}><div><Route size={18} /><span><strong>{operation.referencia || "Operação sem referência"}</strong><small>{operation.origem || "origem pendente"} → {operation.destino || "destino pendente"}</small></span><span className={`tdg-ledger-status ${slaEfetivo(operation) === "atrasado" ? "overdue" : "pending"}`}>{slaEfetivo(operation) === "atrasado" && <AlertTriangle size={14} />}{slaEfetivo(operation)}</span></div><dl><div><dt><Truck size={14} /> Frota</dt><dd>{operation.placa || "sem placa"} · {operation.motorista || "sem motorista"}</dd></div><div><dt><Clock3 size={14} /> Prometido</dt><dd>{operation.prometidoEm || "não informado"}</dd></div><div><dt><PackageCheck size={14} /> Volume</dt><dd>{Number(operation.entregas || 0)} entregas · {Number(operation.pacotes || 0)} pacotes</dd></div><div><dt><MapPin size={14} /> Última posição</dt><dd>{operation.ultimaPosicaoEm || "não informada"}</dd></div></dl><button type="button" onClick={() => openEvents(operation)}>{isIncidents ? "Tratar ocorrência" : "Linha do tempo"} · {Number(operation.ocorrencias || 0)} ocorrência(s)</button></article>)}</div>
      {selected && <div className="tdg-operation-timeline"><form className="tdg-inline-editor" onSubmit={saveEvent}><div><strong>Evento em {selected.referencia}</strong><small>Histórico append-only: o evento não pode ser reescrito depois.</small></div><label><span>Tipo</span><select value={event.tipo} onChange={(e) => setEvent((v) => ({ ...v, tipo: e.target.value }))}>{EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label><span>Título</span><input value={event.titulo} onChange={(e) => setEvent((v) => ({ ...v, titulo: e.target.value }))} /></label><label><span>Local</span><input value={event.local} onChange={(e) => setEvent((v) => ({ ...v, local: e.target.value }))} /></label><label><span>Quando ocorreu</span><input type="datetime-local" value={event.ocorridoEm} onChange={(e) => setEvent((v) => ({ ...v, ocorridoEm: e.target.value }))} /></label><label><span>Descrição</span><input value={event.descricao} onChange={(e) => setEvent((v) => ({ ...v, descricao: e.target.value }))} /></label>{event.tipo === "entrega" && <><label><span>Quem recebeu</span><input value={event.recebedor} onChange={(e) => setEvent((v) => ({ ...v, recebedor: e.target.value }))} placeholder="Nome do recebedor" /></label><label><span>Comprovante (link do canhoto/foto)</span><input value={event.comprovanteUrl} onChange={(e) => setEvent((v) => ({ ...v, comprovanteUrl: e.target.value }))} placeholder="https://..." /></label></>}<button className="tdg-action" type="submit" disabled={saving}>Registrar evento</button><button type="button" onClick={() => setSelected(null)}>Fechar</button></form><div className="tdg-timeline-list">{events.length === 0 && <small>Nenhum evento registrado.</small>}{events.map((item) => <article key={item.id}><span>{item.tipo}</span><strong>{item.titulo || item.descricao}</strong><small>{item.local || "sem local"} · {item.ocorridoEm}</small></article>)}</div></div>}
    </section>
  );
}
