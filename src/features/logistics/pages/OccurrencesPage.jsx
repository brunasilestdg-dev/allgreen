import { useMemo, useState } from "react";
import { AlertTriangle, Clock3, MapPin, Plus, Route } from "lucide-react";

const agoraLocal = () => new Date().toISOString().slice(0, 16);

const clienteDaOperacao = (operation, clients) =>
  clients.find((client) => client.id === (operation.clientId || operation.clienteId))?.name || "Cliente não informado";

const prazoDaOperacao = (operation, now = new Date()) => {
  if (!operation.prometidoEm) return "sem SLA informado";
  const deadline = new Date(operation.prometidoEm);
  const delivered = operation.entregueEm ? new Date(operation.entregueEm) : null;
  if (delivered) return delivered <= deadline ? "entregue no prazo" : "entregue com atraso";
  return now <= deadline ? "em curso" : "SLA violado";
};

export default function OccurrencesPage({
  operations = [],
  clients = [],
  registrarEventoOperacao,
  listarSubrecurso,
  setToast,
}) {
  const [operationId, setOperationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({
    titulo: "",
    descricao: "",
    local: "",
    ocorridoEm: agoraLocal(),
  });

  const operationsWithOccurrences = useMemo(
    () => operations.filter((operation) => Number(operation.ocorrencias || operation.incidents || 0) > 0),
    [operations],
  );

  const totals = useMemo(() => ({
    fretes: operations.length,
    comOcorrencia: operationsWithOccurrences.length,
    ocorrencias: operations.reduce((sum, item) => sum + Number(item.ocorrencias || item.incidents || 0), 0),
    atrasados: operations.filter((item) => /violado|atras/i.test(prazoDaOperacao(item))).length,
  }), [operations, operationsWithOccurrences.length]);

  const openEvents = async (operation) => {
    setSelected(operation);
    setOperationId(operation.id);
    try {
      const result = await listarSubrecurso?.("operations", operation.id, "events");
      setEvents((result?.eventos || []).filter((item) => item.tipo === "ocorrencia"));
    } catch (error) {
      setEvents([]);
      setToast?.(error.message);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (!operationId) return;
    setSaving(true);
    try {
      const result = await registrarEventoOperacao(operationId, {
        tipo: "ocorrencia",
        titulo: form.titulo,
        descricao: form.descricao,
        local: form.local,
        ocorridoEm: form.ocorridoEm,
      });
      setEvents((current) => [result?.evento, ...current].filter(Boolean));
      setSelected(result?.registro || selected);
      setForm({ titulo: "", descricao: "", local: "", ocorridoEm: agoraLocal() });
      setToast?.("Ocorrência registrada no frete.");
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="tdg-panel tdg-occurrences-page">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">OCORRÊNCIAS</span>
          <h2>Ocorrências operacionais</h2>
          <p>Registro separado para tratar falhas, atrasos, insucessos, desvios e evidências sem tirar o frete da ficha operacional.</p>
        </div>
        <strong>{totals.ocorrencias} ocorrência(s)</strong>
      </div>

      <div className="tdg-result">
        <article className="tdg-metric"><span>Fretes</span><strong>{totals.fretes}</strong><small>base operacional</small></article>
        <article className={`tdg-metric ${totals.comOcorrencia ? "risk" : "good"}`}><span>Com ocorrência</span><strong>{totals.comOcorrencia}</strong><small>exigem tratamento</small></article>
        <article className={`tdg-metric ${totals.atrasados ? "risk" : ""}`}><span>SLA crítico</span><strong>{totals.atrasados}</strong><small>atrasado ou violado</small></article>
      </div>

      <form className="tdg-access-form tdg-enterprise-form" onSubmit={save}>
        <label>
          <span>Frete / operação</span>
          <select required value={operationId} onChange={(e) => setOperationId(e.target.value)}>
            <option value="">Selecione</option>
            {operations.map((operation) => (
              <option key={operation.id} value={operation.id}>
                {operation.referencia || operation.reference || operation.id} · {clienteDaOperacao(operation, clients)}
              </option>
            ))}
          </select>
        </label>
        <label><span>Título</span><input required value={form.titulo} onChange={(e) => setForm((v) => ({ ...v, titulo: e.target.value }))} placeholder="Ex.: Insucesso na entrega" /></label>
        <label><span>Local</span><input value={form.local} onChange={(e) => setForm((v) => ({ ...v, local: e.target.value }))} /></label>
        <label><span>Quando ocorreu</span><input type="datetime-local" value={form.ocorridoEm} onChange={(e) => setForm((v) => ({ ...v, ocorridoEm: e.target.value }))} /></label>
        <label className="full"><span>Descrição</span><input value={form.descricao} onChange={(e) => setForm((v) => ({ ...v, descricao: e.target.value }))} placeholder="O que aconteceu, impacto e ação tomada" /></label>
        <button className="tdg-action" type="submit" disabled={saving}><Plus size={17} />{saving ? "Registrando..." : "Registrar ocorrência"}</button>
      </form>

      <div className="tdg-operation-grid">
        {operationsWithOccurrences.length === 0 && <div className="tdg-empty-access">Nenhuma ocorrência registrada.</div>}
        {operationsWithOccurrences.map((operation) => (
          <article className="tdg-operation-card" key={operation.id}>
            <div>
              <AlertTriangle size={18} />
              <span>
                <strong>{operation.referencia || "Frete sem referência"}</strong>
                <small>{clienteDaOperacao(operation, clients)}</small>
              </span>
              <span className="tdg-ledger-status overdue">{Number(operation.ocorrencias || operation.incidents || 0)} ocorrência(s)</span>
            </div>
            <dl>
              <div><dt><Route size={14} /> Rota</dt><dd>{operation.origem || "origem pendente"} → {operation.destino || "destino pendente"}</dd></div>
              <div><dt><Clock3 size={14} /> SLA</dt><dd>{prazoDaOperacao(operation)}</dd></div>
              <div><dt><MapPin size={14} /> Última posição</dt><dd>{operation.ultimaPosicaoEm || "não informada"}</dd></div>
            </dl>
            <button type="button" onClick={() => openEvents(operation)}>Abrir histórico</button>
          </article>
        ))}
      </div>

      {selected && (
        <div className="tdg-operation-timeline">
          <div className="tdg-inline-editor">
            <div>
              <strong>Histórico de ocorrências · {selected.referencia}</strong>
              <small>Eventos operacionais preservados na linha do tempo do frete.</small>
            </div>
            <button type="button" onClick={() => { setSelected(null); setEvents([]); }}>Fechar</button>
          </div>
          <div className="tdg-timeline-list">
            {events.length === 0 && <small>Nenhuma ocorrência detalhada encontrada.</small>}
            {events.map((item) => (
              <article key={item.id}>
                <span>{item.tipo}</span>
                <strong>{item.titulo || item.descricao}</strong>
                <small>{item.local || "sem local"} · {item.ocorridoEm}</small>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
