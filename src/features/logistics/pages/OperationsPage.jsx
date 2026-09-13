import "./TodoGreenPages.css";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock3, MapPin, PackageCheck, Plus, Route, Truck, Upload } from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import { LOGISTICS_PRODUCTS } from "../logisticsVerticalDomain.js";
import { VEHICLE_CLASSES } from "../vehicleClassDomain.js";
import { resolverCoordenadasDaOperacao } from "../distanciaRodoviariaDomain.js";
import {
  LIMITE_PARADAS_IMPORTACAO,
  excedenteDeParadas,
  parseParadasEmMassa,
  resumoDaImportacao,
} from "../operationsImportDomain.js";

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

const ehRascunho = (operation) => String(operation?.situacao || "").toLowerCase() === "rascunho";

export default function OperationsPage({ operations = [], clients = [], contracts = [], criar, atualizar, registrarEventoOperacao, listarSubrecurso, setToast, mode = "operations", authHeaders }) {
  // Motoristas do cadastro mestre: o vínculo por ID é o que liga a operação ao
  // portal do motorista (0070). Texto livre continua valendo como fallback
  // para quem ainda não cadastrou a equipe.
  const [motoristas, setMotoristas] = useState([]);
  useEffect(() => {
    if (!authHeaders) return;
    fetch("/api/todogreen/master-data/drivers", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMotoristas(d?.records || d?.registros || []))
      .catch(() => {});
  }, [authHeaders]);

  const empty = { clientId: "", contractId: "", productId: "middle-mile", reference: "", serviceDate: "", origin: "", destination: "", promisedAt: "", etaAt: "", plate: "", driver: "", driverId: "", trips: "", deliveries: "", packages: "", distanceKm: "", occupancyPercent: "", status: "planned", requiredVehicleClass: "" };
  const [form, setForm] = useState(empty);
  // Demais campos livres (fields_json) da operação em edição — preservados no
  // save para a exigência de veículo não apagar o que outros fluxos gravaram.
  const [camposBase, setCamposBase] = useState({});
  // Coordenadas já resolvidas da operação em edição — a base que a
  // geocodificação preserva quando o endereço não muda ou o serviço cai.
  const [coordsBase, setCoordsBase] = useState({});
  const [saving, setSaving] = useState(false);
  // Registro em janela própria (rodada "nada corta a tela", 30/08).
  const [novaAberta, setNovaAberta] = useState(false);
  // Quando não é null, o modal está CONFIRMANDO um rascunho pré-cadastrado pelo
  // go-live (Onda 3, costura 2): mesma janela, mas salva por cima do rascunho e
  // tira o "rascunho" — a operação passa a valer e libera o gate de go-live.
  const [confirmando, setConfirmando] = useState(null);
  const abrirConfirmacao = (operation) => {
    setForm({
      clientId: operation.clientId || "", contractId: operation.contratoId || "",
      productId: operation.produtoId || "middle-mile", reference: operation.referencia || "",
      serviceDate: operation.dataServico || "", origin: operation.origem || "", destination: operation.destino || "",
      promisedAt: operation.prometidoEm || "", etaAt: operation.etaEm || "", plate: operation.placa || "",
      driver: operation.motorista || "", driverId: operation.motoristaId || "",
      trips: operation.viagens || "", deliveries: operation.entregas || "", packages: operation.pacotes || "",
      distanceKm: operation.distanciaKm || "", occupancyPercent: operation.ocupacaoPercent || "",
      requiredVehicleClass: operation.campos?.requiredVehicleClass || "",
      // Sai do rascunho: 'planned' é o começo natural de uma operação confirmada.
      status: "planned",
    });
    setCamposBase(operation.campos && typeof operation.campos === "object" ? operation.campos : {});
    setCoordsBase({
      coletaLat: operation.coletaLat, coletaLng: operation.coletaLng,
      entregaLat: operation.entregaLat, entregaLng: operation.entregaLng,
    });
    setConfirmando({ id: operation.id, revision: operation.revision });
    setNovaAberta(true);
  };
  const fecharModal = () => { setNovaAberta(false); setConfirmando(null); setForm(empty); setCamposBase({}); setCoordsBase({}); };
  // Importação de paradas em massa (uma por linha) — o caminho rápido para pôr
  // um dia inteiro de entregas no roteirizador sem o formulário de 17 campos.
  const [importAberta, setImportAberta] = useState(false);
  const [importClientId, setImportClientId] = useState("");
  const [importData, setImportData] = useState("");
  const [importTexto, setImportTexto] = useState("");
  const [importando, setImportando] = useState(false);
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
    // Geocodifica origem→coleta e destino→entrega para a operação virar
    // roteirizável (o despacho só enxerga quem tem coordenada de entrega).
    // Best-effort: nunca bloqueia o salvamento; sem entrega localizada, avisa.
    const coords = await resolverCoordenadasDaOperacao(
      { origem: form.origin, destino: form.destination, base: coordsBase },
      { headers: authHeaders?.() || {} },
    );
    const payload = {
      clientId: form.clientId, contratoId: form.contractId, produtoId: form.productId,
      referencia: form.reference, dataServico: form.serviceDate, origem: form.origin, destino: form.destination,
      prometidoEm: form.promisedAt, etaEm: form.etaAt, placa: form.plate, motorista: form.driver, motoristaId: form.driverId,
      viagens: Number(form.trips), entregas: Number(form.deliveries), pacotes: Number(form.packages),
      distanciaKm: Number(form.distanceKm), ocupacaoPercent: Number(form.occupancyPercent), situacao: form.status,
      coletaLat: coords.coletaLat, coletaLng: coords.coletaLng,
      entregaLat: coords.entregaLat, entregaLng: coords.entregaLng,
      // Exigência de classe de veículo vai no fields_json (campos), preservando
      // o que já estava lá. Vazio → remove a exigência (undefined some no JSON).
      campos: { ...camposBase, requiredVehicleClass: form.requiredVehicleClass || undefined },
    };
    // Sem coordenada de entrega a operação não entra no roteirizador — avisa
    // em vez de deixar a pessoa achar que a colocou no despacho.
    const aviso = !coords.entregaLocalizada && String(form.destination || "").trim()
      ? " Não localizei o destino no mapa — ela não entra no roteirizador até ter endereço reconhecível."
      : "";
    try {
      if (confirmando) {
        await atualizar("operations", confirmando.id, { ...payload, revision: confirmando.revision });
        setToast?.(`Operação confirmada. O gate de go-live está liberado.${aviso}`);
      } else {
        await criar("operations", payload);
        setToast?.(`Operação registrada na mesma fonte do portal.${aviso}`);
      }
      fecharModal();
    } catch (error) { setToast?.(error.message); }
    finally { setSaving(false); }
  };

  const importarEmMassa = async () => {
    if (!importClientId) { setToast?.("Escolha o cliente do lote antes de importar."); return; }
    const paradas = parseParadasEmMassa(importTexto);
    if (!paradas.length) { setToast?.("Cole ao menos uma parada — uma por linha."); return; }
    setImportando(true);
    const headers = authHeaders?.() || {};
    let criadas = 0; let semCoordenada = 0; let falhas = 0;
    for (const parada of paradas) {
      try {
        // Geocodifica cada endereço para a operação já entrar roteirizável.
        // Best-effort: sem coordenada ela é criada mesmo assim e conta como
        // "sem coordenada" no resumo — o planejador localiza depois.
        const coords = await resolverCoordenadasDaOperacao({ destino: parada.destino }, { headers });
        await criar("operations", {
          clientId: importClientId,
          referencia: parada.referencia,
          destino: parada.destino,
          dataServico: importData || undefined,
          situacao: "planned",
          entregaLat: coords.entregaLat, entregaLng: coords.entregaLng,
        });
        criadas += 1;
        if (!coords.entregaLocalizada) semCoordenada += 1;
      } catch { falhas += 1; }
    }
    setImportando(false);
    setToast?.(resumoDaImportacao({ criadas, semCoordenada, falhas }));
    setImportAberta(false); setImportTexto("");
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
      <div className="tdg-section-head"><div><span className="tdg-kicker">{isIncidents ? "OCORRÊNCIAS" : "EXECUÇÃO OPERACIONAL"}</span><h2>{isIncidents ? "Ocorrências e exceções operacionais" : "Operação, SLA, frota e execução"}</h2><p>{isIncidents ? "Acompanhe atrasos, insucessos, reentregas, documentos e eventos críticos vinculados à operação." : "A equipe interna escreve na mesma operação que o cliente acompanha no portal."}</p></div><div className="tdg-page-actions"><strong>{isIncidents ? `${visibleOperations.length} em atenção` : `${operations.length} operação(ões)`}</strong>{!isIncidents && <button type="button" onClick={() => setImportAberta(true)}><Upload size={16} />Importar em massa</button>}{!isIncidents && <button type="button" className="tdg-action" onClick={() => setNovaAberta(true)}><Plus size={16} />Nova operação</button>}</div></div>
      <div className="tdg-result"><article className="tdg-metric"><span>Viagens</span><strong>{totals.trips.toLocaleString("pt-BR")}</strong><small>volume registrado</small></article><article className="tdg-metric good"><span>Entregas</span><strong>{totals.deliveries.toLocaleString("pt-BR")}</strong><small>execução consolidada</small></article><article className={`tdg-metric ${totals.incidents ? "risk" : ""}`}><span>Ocorrências</span><strong>{totals.incidents}</strong><small>eventos operacionais</small></article><article className="tdg-metric"><span>Distância</span><strong>{totals.distance.toLocaleString("pt-BR")} km</strong><small>base para custo e ESG</small></article></div>
      {/* Registro em janela própria: o formulário de 17 campos não empurra
          mais a grade de operações (rodada "nada corta a tela", 30/08). */}
      {!isIncidents && novaAberta && <Modal title={confirmando ? "Confirmar operação do contrato" : "Nova operação"} onClose={fecharModal} wide><form className="tdg-access-form tdg-enterprise-form tdg-form-em-modal" onSubmit={save}>
        {confirmando && <p className="tdg-esg-nota">Rascunho pré-cadastrado pelo go-live a partir do contrato. Confira os dados e confirme — a operação passa a valer e o gate de implantação é liberado.</p>}
        <label><span>Cliente</span><select required value={form.clientId} onChange={(e) => setForm((v) => ({ ...v, clientId: e.target.value }))}><option value="">Selecione</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name || client.nome || client.id}</option>)}</select></label>
        <label><span>Contrato</span><select value={form.contractId} onChange={(e) => setForm((v) => ({ ...v, contractId: e.target.value }))}><option value="">Sem contrato</option>{contracts.filter((contract) => !form.clientId || contract.clientId === form.clientId).map((contract) => <option key={contract.id} value={contract.id}>{contract.titulo || contract.title}</option>)}</select></label>
        <label><span>Referência</span><input required value={form.reference} onChange={(e) => setForm((v) => ({ ...v, reference: e.target.value }))} placeholder="Carga, rota ou pedido" /></label>
        <label><span>Data de serviço</span><input type="date" required value={form.serviceDate} onChange={(e) => setForm((v) => ({ ...v, serviceDate: e.target.value }))} /></label>
        <label><span>Origem</span><input value={form.origin} onChange={(e) => setForm((v) => ({ ...v, origin: e.target.value }))} /></label>
        <label><span>Destino</span><input value={form.destination} onChange={(e) => setForm((v) => ({ ...v, destination: e.target.value }))} /></label>
        <label><span>Prazo prometido</span><input type="datetime-local" value={form.promisedAt} onChange={(e) => setForm((v) => ({ ...v, promisedAt: e.target.value }))} /></label>
        <label><span>ETA atual</span><input type="datetime-local" value={form.etaAt} onChange={(e) => setForm((v) => ({ ...v, etaAt: e.target.value }))} /></label>
        <label><span>Placa</span><input value={form.plate} onChange={(e) => setForm((v) => ({ ...v, plate: e.target.value }))} /></label>
        <label><span>Motorista</span>{motoristas.length ? <select value={form.driverId} onChange={(e) => { const escolhido = motoristas.find((m) => m.id === e.target.value); setForm((v) => ({ ...v, driverId: e.target.value, driver: escolhido?.fullName || v.driver })); }}><option value="">Selecionar do cadastro</option>{motoristas.map((m) => <option key={m.id} value={m.id}>{m.fullName}{m.availabilityStatus === "available" ? "" : ` (${m.availabilityStatus})`}</option>)}</select> : <input value={form.driver} onChange={(e) => setForm((v) => ({ ...v, driver: e.target.value }))} placeholder="Cadastre motoristas em Cadastros" />}</label>
        <label><span>Viagens</span><input type="number" min="0" value={form.trips} onChange={(e) => setForm((v) => ({ ...v, trips: e.target.value }))} /></label>
        <label><span>Entregas</span><input type="number" min="0" value={form.deliveries} onChange={(e) => setForm((v) => ({ ...v, deliveries: e.target.value }))} /></label>
        <label><span>Pacotes</span><input type="number" min="0" value={form.packages} onChange={(e) => setForm((v) => ({ ...v, packages: e.target.value }))} /></label>
        <label><span>Distância km</span><input type="number" min="0" step="0.1" value={form.distanceKm} onChange={(e) => setForm((v) => ({ ...v, distanceKm: e.target.value }))} /></label>
        <label><span>Ocupação %</span><input type="number" min="0" max="100" value={form.occupancyPercent} onChange={(e) => setForm((v) => ({ ...v, occupancyPercent: e.target.value }))} /></label>
        <label><span>Situação</span><select value={form.status} onChange={(e) => setForm((v) => ({ ...v, status: e.target.value }))}>{STATUS.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
        <label><span>Produto</span><select value={form.productId} onChange={(e) => setForm((v) => ({ ...v, productId: e.target.value }))}>{LOGISTICS_PRODUCTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {/* Exigência de veículo: o roteirizador só atribui esta carga a um veículo
            da classe escolhida (casamento por habilidade). Vazio = qualquer veículo. */}
        <label><span>Tipo de veículo exigido</span><select value={form.requiredVehicleClass} onChange={(e) => setForm((v) => ({ ...v, requiredVehicleClass: e.target.value }))}><option value="">Qualquer veículo</option>{VEHICLE_CLASSES.map((classe) => <option key={classe.id} value={classe.id}>{classe.name}</option>)}</select></label>
        <div className="tdg-form-actions"><button type="button" onClick={fecharModal}>Cancelar</button><button className="tdg-action" type="submit" disabled={saving}><Plus size={17} />{saving ? "Salvando..." : confirmando ? "Confirmar operação" : "Registrar operação"}</button></div>
      </form></Modal>}
      {!isIncidents && importAberta && <Modal title="Importar paradas em massa" onClose={() => !importando && setImportAberta(false)} wide>
        <div className="tdg-access-form tdg-form-em-modal">
          <p className="tdg-esg-nota">Uma parada por linha. O primeiro campo é a <strong>referência</strong> (NF, pedido); o resto é o <strong>endereço de entrega</strong>. Separe por <code>;</code>, <code>|</code> ou tab. O endereço é geocodificado para a operação já entrar no roteirizador — endereço não reconhecido é criado mesmo assim, só fica de fora do despacho até você localizá-lo.</p>
          <label><span>Cliente do lote</span><select required value={importClientId} onChange={(e) => setImportClientId(e.target.value)}><option value="">Selecione</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name || client.nome || client.id}</option>)}</select></label>
          <label><span>Data de serviço (opcional)</span><input type="date" value={importData} onChange={(e) => setImportData(e.target.value)} /></label>
          <label><span>Paradas</span><textarea rows={8} value={importTexto} onChange={(e) => setImportTexto(e.target.value)} placeholder={"NF 1001; Rua das Flores, 100, São Paulo SP\nNF 1002; Av. Brasil, 200, Santos SP"} /></label>
          {(() => {
            const total = parseParadasEmMassa(importTexto).length;
            const excedente = excedenteDeParadas(importTexto);
            return <small>{total} parada(s) reconhecida(s){excedente > 0 ? ` · ${excedente} além do limite de ${LIMITE_PARADAS_IMPORTACAO} ficam de fora` : ""}.</small>;
          })()}
          <div className="tdg-form-actions"><button type="button" onClick={() => setImportAberta(false)} disabled={importando}>Cancelar</button><button className="tdg-action" type="button" onClick={importarEmMassa} disabled={importando || !importClientId || !parseParadasEmMassa(importTexto).length}><Upload size={17} />{importando ? "Importando…" : "Importar paradas"}</button></div>
        </div>
      </Modal>}
      <div className="tdg-operation-grid">{visibleOperations.length === 0 && <div className="tdg-empty-access">{isIncidents ? "Nenhuma ocorrência ou atraso em aberto." : "Nenhuma operação real registrada."}</div>}{visibleOperations.map((operation) => <article className="tdg-operation-card" key={operation.id}><div><Route size={18} /><span><strong>{operation.referencia || "Operação sem referência"}</strong><small>{operation.origem || "origem pendente"} → {operation.destino || "destino pendente"}</small></span><span className={`tdg-ledger-status ${ehRascunho(operation) || slaEfetivo(operation) === "atrasado" ? "overdue" : "pending"}`}>{(ehRascunho(operation) || slaEfetivo(operation) === "atrasado") && <AlertTriangle size={14} />}{ehRascunho(operation) ? "rascunho · confirmar" : slaEfetivo(operation)}</span></div><dl><div><dt><Truck size={14} /> Frota</dt><dd>{operation.placa || "sem placa"} · {operation.motorista || "sem motorista"}</dd></div><div><dt><Clock3 size={14} /> Prometido</dt><dd>{operation.prometidoEm || "não informado"}</dd></div><div><dt><PackageCheck size={14} /> Volume</dt><dd>{Number(operation.entregas || 0)} entregas · {Number(operation.pacotes || 0)} pacotes</dd></div><div><dt><MapPin size={14} /> Última posição</dt><dd>{operation.ultimaPosicaoEm || "não informada"}</dd></div></dl><div className="tdg-operation-card-actions">{!isIncidents && ehRascunho(operation) && <button type="button" className="tdg-action" onClick={() => abrirConfirmacao(operation)}>Confirmar operação</button>}<button type="button" onClick={() => openEvents(operation)}>{isIncidents ? "Tratar ocorrência" : "Linha do tempo"} · {Number(operation.ocorrencias || 0)} ocorrência(s)</button></div></article>)}</div>
      {/* Linha do tempo em janela própria: antes o formulário de evento
          nascia depois da grade inteira, fora da tela em carteiras grandes. */}
      {selected && <Modal title={`Linha do tempo · ${selected.referencia}`} onClose={() => setSelected(null)} wide><div className="tdg-operation-timeline tdg-form-em-modal"><form className="tdg-inline-editor" onSubmit={saveEvent}><div><strong>Evento em {selected.referencia}</strong><small>Histórico append-only: o evento não pode ser reescrito depois.</small></div><label><span>Tipo</span><select value={event.tipo} onChange={(e) => setEvent((v) => ({ ...v, tipo: e.target.value }))}>{EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label><span>Título</span><input value={event.titulo} onChange={(e) => setEvent((v) => ({ ...v, titulo: e.target.value }))} /></label><label><span>Local</span><input value={event.local} onChange={(e) => setEvent((v) => ({ ...v, local: e.target.value }))} /></label><label><span>Quando ocorreu</span><input type="datetime-local" value={event.ocorridoEm} onChange={(e) => setEvent((v) => ({ ...v, ocorridoEm: e.target.value }))} /></label><label><span>Descrição</span><input value={event.descricao} onChange={(e) => setEvent((v) => ({ ...v, descricao: e.target.value }))} /></label>{event.tipo === "entrega" && <><label><span>Quem recebeu</span><input value={event.recebedor} onChange={(e) => setEvent((v) => ({ ...v, recebedor: e.target.value }))} placeholder="Nome do recebedor" /></label><label><span>Comprovante (link do canhoto/foto)</span><input value={event.comprovanteUrl} onChange={(e) => setEvent((v) => ({ ...v, comprovanteUrl: e.target.value }))} placeholder="https://..." /></label></>}<button className="tdg-action" type="submit" disabled={saving}>Registrar evento</button><button type="button" onClick={() => setSelected(null)}>Fechar</button></form><div className="tdg-timeline-list">{events.length === 0 && <small>Nenhum evento registrado.</small>}{events.map((item) => <article key={item.id}><span>{item.tipo}</span><strong>{item.titulo || item.descricao}</strong><small>{item.local || "sem local"} · {item.ocorridoEm}</small></article>)}</div></div></Modal>}
    </section>
  );
}
