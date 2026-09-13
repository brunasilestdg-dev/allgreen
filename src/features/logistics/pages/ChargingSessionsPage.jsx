import { useEffect, useMemo, useState } from "react";
import { BatteryCharging, Gauge, Plus, Trash2, Zap } from "lucide-react";
import {
  STATUS_SESSAO,
  TARIFA_BASE_PADRAO,
  custoDaSessao,
  resumoSessoes,
  validarSessao,
} from "../chargingSessionDomain.js";
import "./TodoGreenPages.css";

// Sessão real de recarga: a energia MEDIDA de cada recarga (não a estimada pelo
// hodômetro). Ponto vem do cadastro; veículo e cliente do cadastro quando dá,
// para o consumo casar com a frota e a cobrança com o cliente. O custo é
// derivado da tarifa na hora do início — a tela mostra de onde sai o número.

const formVazio = {
  pontoId: "",
  veiculoId: "",
  clienteId: "",
  segmento: "",
  motoristaNome: "",
  inicioEm: "",
  fimEm: "",
  energiaKwh: "",
  status: "concluida",
  observacao: "",
};

const rotuloStatus = { em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada" };
const rotuloFaixa = { "fora-ponta": "fora de ponta", intermediario: "intermediário", ponta: "ponta" };
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export default function ChargingSessionsPage({ registros = [], pontos = [], clientes = [], criar, atualizar, arquivar, setToast, authHeaders }) {
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
    () => (pontos || []).filter((p) => (p.status || "ativo") !== "inativo"),
    [pontos],
  );
  const resumo = useMemo(() => resumoSessoes(registros, { base: TARIFA_BASE_PADRAO }), [registros]);

  const rotuloVeiculo = (v) => v.prefix || v.plate || v.id;
  const rotuloCliente = (c) => c.nome || c.razaoSocial || c.name || c.id;

  const salvar = async (event) => {
    event.preventDefault();
    const ponto = pontosAtivos.find((p) => p.id === form.pontoId);
    const veiculo = veiculos.find((v) => v.id === form.veiculoId);
    const cliente = (clientes || []).find((c) => c.id === form.clienteId);
    const corpo = {
      ...form,
      pontoNome: ponto?.nome || "",
      veiculoRotulo: veiculo ? rotuloVeiculo(veiculo) : "",
      clienteNome: cliente ? rotuloCliente(cliente) : "",
      fonte: "manual",
    };
    const erro = validarSessao(corpo);
    if (erro) { setToast?.(erro); return; }
    setSalvando(true);
    try {
      await criar?.("chargingSessions", corpo);
      setForm(formVazio);
      setAberto(false);
      setToast?.("Sessão de recarga registrada.");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setSalvando(false);
    }
  };

  const mudarStatus = async (sessao, status) => {
    try {
      await atualizar?.("chargingSessions", sessao.id, { status, revision: sessao.revision });
      setToast?.(`Sessão marcada como "${rotuloStatus[status] || status}".`);
    } catch (razao) { setToast?.(razao.message); }
  };

  const remover = async (sessao) => {
    try {
      await arquivar?.("chargingSessions", sessao.id);
      setToast?.("Sessão removida.");
    } catch (razao) { setToast?.(razao.message); }
  };

  const lista = useMemo(
    () => [...registros].sort((a, b) => String(b.inicioEm || "").localeCompare(String(a.inicioEm || ""))),
    [registros],
  );

  return (
    <div className="tdg-page tdg-recarga-page">
      <header className="tdg-page-title">
        <div>
          <span>ELETRIFICAÇÃO · ENERGIA</span>
          <h2>Sessões de recarga</h2>
          <p>Registre cada recarga com a energia <strong>medida</strong> (kWh). É o consumo real, ao lado da estimativa do hodômetro — e a base da cobrança por kWh quando há cliente. O custo é calculado pela tarifa na hora do início (régua padrão {numero.format(TARIFA_BASE_PADRAO)} R$/kWh). Fonte automática por OCPP fica pronta para quando a central for ligada.</p>
        </div>
        <button className="tdg-action" type="button" onClick={() => setAberto((v) => !v)}>
          <Plus size={16} />Nova sessão
        </button>
      </header>

      <div className="tdg-recarga-metrics">
        <article><small>Energia medida</small><strong>{numero.format(resumo.energiaKwh)} kWh</strong></article>
        <article><small>Custo estimado</small><strong>{moeda.format(resumo.custoEstimado)}</strong></article>
        <article><small>Sessões medidas</small><strong>{resumo.medidas}</strong></article>
        <article className={resumo.emAndamento > 0 ? "risk" : ""}><small>Em andamento</small><strong>{resumo.emAndamento}</strong></article>
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
              <option value="">— (uso geral)</option>
              {veiculos.map((v) => <option key={v.id} value={v.id}>{rotuloVeiculo(v)}</option>)}
            </select>
          </label>
          <label><span>Motorista</span><input value={form.motoristaNome} onChange={(e) => setForm({ ...form, motoristaNome: e.target.value })} placeholder="opcional" /></label>
          <label><span>Cliente (para cobrar)</span>
            <select value={form.clienteId} onChange={(e) => setForm({ ...form, clienteId: e.target.value })}>
              <option value="">— uso interno (não cobra)</option>
              {(clientes || []).map((c) => <option key={c.id} value={c.id}>{rotuloCliente(c)}</option>)}
            </select>
          </label>
          <label><span>Segmento</span>
            <select value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })} disabled={!form.clienteId}>
              <option value="">—</option>
              <option value="b2b">B2B</option>
              <option value="b2c">B2C</option>
            </select>
          </label>
          <label><span>Início</span><input type="datetime-local" value={form.inicioEm} onChange={(e) => setForm({ ...form, inicioEm: e.target.value })} /></label>
          <label><span>Fim</span><input type="datetime-local" value={form.fimEm} onChange={(e) => setForm({ ...form, fimEm: e.target.value })} /></label>
          <label><span>Energia medida (kWh)</span><input type="number" min="0" step="0.01" inputMode="decimal" value={form.energiaKwh} onChange={(e) => setForm({ ...form, energiaKwh: e.target.value })} placeholder="ex.: 120" /></label>
          <label><span>Situação</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUS_SESSAO.map((s) => <option key={s} value={s}>{rotuloStatus[s]}</option>)}</select></label>
          <label className="tdg-recarga-wide"><span>Observação</span><input value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} placeholder="opcional" /></label>
          <p className="tdg-recarga-dica">Uma recarga <strong>concluída</strong> precisa da energia medida — é o que a diferencia da estimativa. Sem cliente, a sessão é uso da própria frota (vira custo na Gestão de Energia, não cobrança).</p>
          <div className="tdg-recarga-form-actions">
            <button type="button" onClick={() => { setAberto(false); setForm(formVazio); }}>Cancelar</button>
            <button className="tdg-action" type="submit" disabled={salvando}>{salvando ? "Salvando..." : "Registrar sessão"}</button>
          </div>
        </form>
      )}

      <div className="tdg-recarga-lista">
        {lista.length === 0 && (
          <div className="tdg-empty-access"><BatteryCharging size={18} />Nenhuma sessão registrada ainda. Registre a primeira recarga para começar a medir o consumo real.</div>
        )}
        {lista.map((s) => {
          const custo = custoDaSessao(s, { base: TARIFA_BASE_PADRAO });
          return (
            <article className={`tdg-recarga-card status-${s.status === "concluida" ? "ativo" : s.status === "cancelada" ? "inativo" : "manutencao"}`} key={s.id}>
              <header>
                <span className="tdg-recarga-nome">
                  <strong><Zap size={15} />{s.pontoNome || "Ponto"}</strong>
                  <small>{(s.inicioEm || "").replace("T", " ").slice(0, 16)}{s.veiculoRotulo ? ` · ${s.veiculoRotulo}` : ""}{s.clienteNome ? ` · ${s.clienteNome}` : " · uso interno"}</small>
                </span>
                <span className="tdg-recarga-tag pesado">{numero.format(s.energiaKwh)} kWh</span>
              </header>
              <p className="tdg-recarga-endereco"><Gauge size={13} />{custo.energiaKwh > 0 ? `${moeda.format(custo.custo)} · ${moeda.format(custo.tarifaKwh)}/kWh (${rotuloFaixa[custo.faixa]})` : "Sem energia medida"}</p>
              <footer>
                <span className={s.fonte === "ocpp" ? "tdg-recarga-mapa ok" : "tdg-recarga-mapa off"}>{s.fonte === "ocpp" ? "OCPP" : "Manual"}</span>
                <div className="tdg-recarga-acoes">
                  <label>
                    <select value={s.status} onChange={(e) => mudarStatus(s, e.target.value)} aria-label={`Situação da sessão em ${s.pontoNome}`}>
                      {STATUS_SESSAO.map((st) => <option key={st} value={st}>{rotuloStatus[st]}</option>)}
                    </select>
                  </label>
                  <button type="button" className="tdg-recarga-remover" onClick={() => remover(s)} aria-label="Remover sessão"><Trash2 size={15} /></button>
                </div>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
