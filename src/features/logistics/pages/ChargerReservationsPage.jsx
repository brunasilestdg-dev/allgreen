import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, Trash2, Zap } from "lucide-react";
import {
  STATUS_RESERVA,
  conflitoDeReserva,
  proximasReservas,
  resumoReservas,
  validarReserva,
} from "../chargerReservationDomain.js";
import "./TodoGreenPages.css";

// Reserva de carregador: garante a tomada num horário. A tela avisa o conflito
// ANTES de salvar (mesma regra do servidor, chargerReservationDomain) — duas
// reservas ativas não ocupam o mesmo ponto em horários que se cruzam.

const formVazio = {
  pontoId: "",
  veiculoId: "",
  motoristaNome: "",
  inicioEm: "",
  fimEm: "",
  status: "reservada",
  observacao: "",
};

const rotuloStatus = { reservada: "Reservada", em_uso: "Em uso", concluida: "Concluída", cancelada: "Cancelada" };
const quando = (iso) => (iso || "").replace("T", " ").slice(0, 16);

export default function ChargerReservationsPage({ registros = [], pontos = [], criar, atualizar, arquivar, setToast, authHeaders }) {
  const [form, setForm] = useState(formVazio);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [veiculos, setVeiculos] = useState([]);

  useEffect(() => {
    let vivo = true;
    fetch("/api/todogreen/fleet", { headers: authHeaders?.() || {} })
      .then((r) => (r.ok ? r.json() : { vehicles: [] }))
      .catch(() => ({ vehicles: [] }))
      .then((d) => { if (vivo) setVeiculos(d.vehicles || []); });
    return () => { vivo = false; };
  }, [authHeaders]);

  const pontosAtivos = useMemo(
    () => (pontos || []).filter((p) => (p.status || "ativo") === "ativo"),
    [pontos],
  );
  const resumo = useMemo(() => resumoReservas(registros), [registros]);
  const agenda = useMemo(() => proximasReservas(registros), [registros]);
  const rotuloVeiculo = (v) => v.prefix || v.plate || v.id;

  // Conflito ao vivo com o que a pessoa está digitando — o mesmo que o servidor
  // recusaria, mostrado antes do clique.
  const conflito = useMemo(() => {
    if (!form.pontoId || !form.inicioEm || !form.fimEm) return null;
    const ponto = pontosAtivos.find((p) => p.id === form.pontoId);
    return conflitoDeReserva(registros, { ...form, pontoNome: ponto?.nome || "" });
  }, [form, registros, pontosAtivos]);

  const salvar = async (event) => {
    event.preventDefault();
    const ponto = pontosAtivos.find((p) => p.id === form.pontoId);
    const veiculo = veiculos.find((v) => v.id === form.veiculoId);
    const corpo = { ...form, pontoNome: ponto?.nome || "", veiculoRotulo: veiculo ? rotuloVeiculo(veiculo) : "" };
    const erro = validarReserva(corpo);
    if (erro) { setToast?.(erro); return; }
    if (conflitoDeReserva(registros, corpo)) { setToast?.("Este ponto já está reservado num horário que cruza com o pedido."); return; }
    setSalvando(true);
    try {
      await criar?.("chargerReservations", corpo);
      setForm(formVazio);
      setAberto(false);
      setToast?.("Reserva registrada.");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setSalvando(false);
    }
  };

  const mudarStatus = async (reserva, status) => {
    try {
      await atualizar?.("chargerReservations", reserva.id, { status, revision: reserva.revision });
      setToast?.(`Reserva marcada como "${rotuloStatus[status] || status}".`);
    } catch (razao) { setToast?.(razao.message); }
  };

  const remover = async (reserva) => {
    try {
      await arquivar?.("chargerReservations", reserva.id);
      setToast?.("Reserva removida.");
    } catch (razao) { setToast?.(razao.message); }
  };

  return (
    <div className="tdg-page tdg-recarga-page">
      <header className="tdg-page-title">
        <div>
          <span>ELETRIFICAÇÃO</span>
          <h2>Reservas de carregador</h2>
          <p>Garanta a tomada para um veículo num horário. O sistema recusa duas reservas ativas no mesmo ponto em horários que se cruzam — antes da viagem, não na fila do carregador.</p>
        </div>
        <button className="tdg-action" type="button" onClick={() => setAberto((v) => !v)}>
          <Plus size={16} />Nova reserva
        </button>
      </header>

      <div className="tdg-recarga-metrics">
        <article><small>Ativas</small><strong>{resumo.ativas}</strong></article>
        <article><small>Em uso agora</small><strong>{resumo.emUso}</strong></article>
        <article><small>Futuras</small><strong>{resumo.futuras}</strong></article>
        <article><small>Concluídas</small><strong>{resumo.concluidas}</strong></article>
      </div>

      {aberto && (
        <form className="tdg-recarga-form tdg-panel" onSubmit={salvar}>
          <label className="tdg-recarga-wide"><span>Ponto de recarga</span>
            <select value={form.pontoId} onChange={(e) => setForm({ ...form, pontoId: e.target.value })}>
              <option value="">Escolha o ponto…</option>
              {pontosAtivos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.operador ? ` · ${p.operador}` : ""}</option>)}
            </select>
          </label>
          <label><span>Veículo</span>
            <select value={form.veiculoId} onChange={(e) => setForm({ ...form, veiculoId: e.target.value })}>
              <option value="">—</option>
              {veiculos.map((v) => <option key={v.id} value={v.id}>{rotuloVeiculo(v)}</option>)}
            </select>
          </label>
          <label><span>Motorista</span><input value={form.motoristaNome} onChange={(e) => setForm({ ...form, motoristaNome: e.target.value })} placeholder="opcional" /></label>
          <label><span>Situação</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUS_RESERVA.map((s) => <option key={s} value={s}>{rotuloStatus[s]}</option>)}</select></label>
          <label><span>Início</span><input type="datetime-local" value={form.inicioEm} onChange={(e) => setForm({ ...form, inicioEm: e.target.value })} /></label>
          <label><span>Fim</span><input type="datetime-local" value={form.fimEm} onChange={(e) => setForm({ ...form, fimEm: e.target.value })} /></label>
          <label className="tdg-recarga-wide"><span>Observação</span><input value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} placeholder="opcional" /></label>
          {conflito && (
            <p className="tdg-recarga-dica" style={{ color: "#c0392b" }}>
              Conflito com a reserva de {quando(conflito.inicioEm)} → {quando(conflito.fimEm)} neste ponto. Ajuste o horário ou o ponto.
            </p>
          )}
          <div className="tdg-recarga-form-actions">
            <button type="button" onClick={() => { setAberto(false); setForm(formVazio); }}>Cancelar</button>
            <button className="tdg-action" type="submit" disabled={salvando || !!conflito}>{salvando ? "Salvando..." : "Reservar"}</button>
          </div>
        </form>
      )}

      <div className="tdg-recarga-lista">
        {agenda.length === 0 && (
          <div className="tdg-empty-access"><CalendarClock size={18} />Nenhuma reserva ativa. As reservas futuras aparecem aqui em ordem de horário.</div>
        )}
        {agenda.map((r) => (
          <article className={`tdg-recarga-card status-${r.status === "cancelada" ? "inativo" : r.status === "concluida" ? "ativo" : "manutencao"}`} key={r.id}>
            <header>
              <span className="tdg-recarga-nome">
                <strong><Zap size={15} />{r.pontoNome || "Ponto"}</strong>
                <small>{quando(r.inicioEm)} → {quando(r.fimEm)}{r.veiculoRotulo ? ` · ${r.veiculoRotulo}` : ""}{r.motoristaNome ? ` · ${r.motoristaNome}` : ""}</small>
              </span>
              <span className="tdg-recarga-tag leve">{rotuloStatus[r.status] || r.status}</span>
            </header>
            <footer>
              <span className="tdg-recarga-mapa off">{r.observacao || " "}</span>
              <div className="tdg-recarga-acoes">
                <label>
                  <select value={r.status} onChange={(e) => mudarStatus(r, e.target.value)} aria-label={`Situação da reserva em ${r.pontoNome}`}>
                    {STATUS_RESERVA.map((s) => <option key={s} value={s}>{rotuloStatus[s]}</option>)}
                  </select>
                </label>
                <button type="button" className="tdg-recarga-remover" onClick={() => remover(r)} aria-label="Remover reserva"><Trash2 size={15} /></button>
              </div>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
