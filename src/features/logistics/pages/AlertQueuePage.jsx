import { useMemo, useState } from "react";
import { AlarmClock, ShieldAlert, Trash2 } from "lucide-react";
import {
  criarAlerta,
  transitar,
  priorizarFila,
  capPorOperador,
  slaRestanteMinutos,
  falsePositiveRate,
  SEVERIDADES,
  CRITICIDADES,
} from "../alertQueueDomain.js";
import "./TodoGreenPages.css";

// Fila de alertas dedicada (bloco 20). Severidade + SLA + histórico +
// teto por operador + taxa de falso positivo. Aqui a tela é a "torre
// de decisão" curta: cria alerta, prioriza, capa por operador e sinaliza
// regra ruim.

const formVazio = { titulo: "", descricao: "", severidade: "atencao", responsavel: "pendente-atribuir", origem: "sistema" };
const SEV_LABELS = { info: "Info", atencao: "Atenção", alto: "Alto", critico: "Crítico" };
const TONS = { critico: "critical", alto: "warning", atencao: "warning", info: "info" };

export default function AlertQueuePage() {
  const [form, setForm] = useState(formVazio);
  const [teto, setTeto] = useState("5");
  const [alertas, setAlertas] = useState([]);

  const fila = useMemo(() => capPorOperador(alertas, Number(teto) || 5), [alertas, teto]);
  const priorizada = useMemo(() => priorizarFila(alertas), [alertas]);
  const fp = useMemo(() => falsePositiveRate(alertas, "sistema", 24), [alertas]);

  const criar = (e) => {
    e.preventDefault();
    if (!form.titulo.trim()) return;
    setAlertas([...alertas, criarAlerta(form)]);
    setForm(formVazio);
  };

  const mudar = (id, para) => {
    setAlertas((cur) => cur.map((a) => (a.id === id ? transitar(a, para, { autor: "voce" }) : a)));
  };
  const remover = (id) => setAlertas((cur) => cur.filter((a) => a.id !== id));

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>TORRE · FILA DE AÇÃO</span>
          <h2>Alertas com SLA e teto por operador</h2>
          <p>Todo alerta nasce com severidade e prazo (SLA em minutos). Se um operador acumula mais que o teto, os não-críticos vão para <em>aguardando</em>. Regra que dispara falso-positivo com frequência é sinalizada — o operador afogado ignora tudo, então volume não é atenção.</p>
        </div>
      </header>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><ShieldAlert size={20} /></span><div><strong>SLA por severidade</strong><small>minutos padrão · sobrescreva por alerta</small></div></div>
        <div className="tdg-recarga-metrics">
          {SEVERIDADES.map((s) => (
            <article key={s}><small>{SEV_LABELS[s]}</small><strong>{CRITICIDADES[s]} min</strong></article>
          ))}
        </div>
      </article>

      <form className="tdg-recarga-form tdg-panel" onSubmit={criar}>
        <label><span>Título</span><input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="ex.: Bateria crítica no VE-047" /></label>
        <label><span>Severidade</span>
          <select value={form.severidade} onChange={(e) => setForm({ ...form, severidade: e.target.value })}>
            {SEVERIDADES.map((s) => <option key={s} value={s}>{SEV_LABELS[s]}</option>)}
          </select>
        </label>
        <label><span>Responsável</span><input value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })} /></label>
        <label className="tdg-recarga-wide"><span>Descrição</span><input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="opcional" /></label>
        <div className="tdg-recarga-form-actions">
          <button className="tdg-action" type="submit">Registrar alerta</button>
        </div>
      </form>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><AlarmClock size={20} /></span><div><strong>Fila priorizada</strong><small>{priorizada.length} ativo(s) · teto por operador: {teto || 5}</small></div></div>
        <div className="tdg-recarga-filtros"><label>Teto por operador <input type="number" min="1" max="50" value={teto} onChange={(e) => setTeto(e.target.value)} /></label></div>
        {fila.length === 0 ? (
          <p className="tdg-driver-nota">Sem alertas ativos. Use o formulário acima para simular.</p>
        ) : (
          <div className="tdg-tabela-frame">
            <table className="tdg-tabela">
              <thead><tr><th>Severidade</th><th>Título</th><th>Resp.</th><th>SLA restante</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {fila.map((a) => {
                  const restante = slaRestanteMinutos(a);
                  const atrasado = restante != null && restante < 0;
                  return (
                    <tr key={a.id}>
                      <td><span className={`tdg-alert-badge tdg-alert-${TONS[a.severidade] || "info"}`}>{SEV_LABELS[a.severidade] || a.severidade}</span></td>
                      <td><strong>{a.titulo}</strong>{a.descricao ? <><br /><small>{a.descricao}</small></> : null}</td>
                      <td>{a.responsavel}</td>
                      <td>{restante == null ? "—" : atrasado ? `−${Math.abs(restante)} min` : `${restante} min`}</td>
                      <td>{a.estado}</td>
                      <td>
                        <select value={a.estado} onChange={(e) => mudar(a.id, e.target.value)}>
                          <option value="aberto">aberto</option>
                          <option value="em-tratamento">em-tratamento</option>
                          <option value="resolvido">resolvido</option>
                          <option value="falso-positivo">falso-positivo</option>
                          <option value="aguardando">aguardando</option>
                        </select>{" "}
                        <button type="button" className="tdg-recarga-remover" onClick={() => remover(a.id)} aria-label="Remover alerta"><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {fp && (
        <article className="tdg-panel">
          <div className="tdg-work-area-heading"><span><ShieldAlert size={20} /></span><div><strong>Regra “sistema” nas últimas 24 h</strong><small>{fp.total} disparo(s) · {fp.falsosPositivos} falso(s) positivo(s)</small></div></div>
          <p className="tdg-driver-nota">{fp.recomendaDesligar ? `Taxa de falso positivo ${Math.round(fp.taxa * 100)}% — recomendação: desligar/rever a regra.` : `Taxa de falso positivo ${Math.round(fp.taxa * 100)}% — dentro do aceitável.`}</p>
        </article>
      )}
    </div>
  );
}
