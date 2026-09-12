import { useMemo, useState } from "react";
import { BatteryCharging, MapPin, Plus, Trash2, Zap } from "lucide-react";
import {
  CONECTORES,
  OPERADORES_SUGERIDOS,
  STATUS_PONTO,
  TIPOS_CORRENTE,
  resumoPontos,
  servePesado,
  validarPontoRecarga,
} from "../chargingPointsDomain.js";
import "./TodoGreenPages.css";

const formVazio = {
  nome: "",
  operador: "",
  tipoCorrente: "DC",
  conector: "CCS2",
  potenciaKw: "",
  latitude: "",
  longitude: "",
  endereco: "",
  status: "ativo",
};

const rotuloStatus = { ativo: "Ativo", manutencao: "Em manutenção", inativo: "Inativo" };
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export default function ChargingPointsPage({ registros = [], criar, atualizar, arquivar, setToast }) {
  const [form, setForm] = useState(formVazio);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [filtro, setFiltro] = useState("ativos");

  const resumo = useMemo(() => resumoPontos(registros), [registros]);

  const lista = useMemo(() => {
    const ordenados = [...registros].sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
    if (filtro === "todos") return ordenados;
    if (filtro === "pesados") return ordenados.filter((p) => servePesado(p));
    return ordenados.filter((p) => (p.status || "ativo") === "ativo");
  }, [registros, filtro]);

  const salvar = async (event) => {
    event.preventDefault();
    const erro = validarPontoRecarga(form);
    if (erro) { setToast?.(erro); return; }
    setSalvando(true);
    try {
      await criar?.("pontosRecarga", form);
      setForm(formVazio);
      setAberto(false);
      setToast?.("Ponto de recarga cadastrado.");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setSalvando(false);
    }
  };

  const mudarStatus = async (ponto, status) => {
    try {
      await atualizar?.("pontosRecarga", ponto.id, { status, revision: ponto.revision });
      setToast?.(`Ponto marcado como "${rotuloStatus[status] || status}".`);
    } catch (razao) {
      setToast?.(razao.message);
    }
  };

  const remover = async (ponto) => {
    try {
      await arquivar?.("pontosRecarga", ponto.id);
      setToast?.("Ponto de recarga removido.");
    } catch (razao) {
      setToast?.(razao.message);
    }
  };

  return (
    <div className="tdg-page tdg-recarga-page">
      <header className="tdg-page-title">
        <div>
          <span>ELETRIFICAÇÃO</span>
          <h2>Pontos de recarga próprios</h2>
          <p>Cadastre os pontos que a operação instalou ou contratou (Ground, GreenOn, pátio próprio). Eles entram no mapa do roteirizador junto com a rede pública — o &ldquo;serve pesado&rdquo; é derivado da corrente e da potência, não digitado.</p>
        </div>
        <button className="tdg-action" type="button" onClick={() => setAberto((v) => !v)}>
          <Plus size={16} />Novo ponto
        </button>
      </header>

      <div className="tdg-recarga-metrics">
        <article><small>Ativos</small><strong>{resumo.ativos}</strong></article>
        <article><small>Servem pesado</small><strong>{resumo.servemPesado}</strong></article>
        <article className={resumo.emManutencao > 0 ? "risk" : ""}><small>Em manutenção</small><strong>{resumo.emManutencao}</strong></article>
        <article><small>Potência total</small><strong>{numero.format(resumo.potenciaTotalKw)} kW</strong></article>
        <article className={resumo.total > 0 && resumo.comCoordenada < resumo.total ? "risk" : ""}><small>No mapa</small><strong>{resumo.comCoordenada}/{resumo.total}</strong></article>
      </div>

      {aberto && (
        <form className="tdg-recarga-form tdg-panel" onSubmit={salvar}>
          <label className="tdg-recarga-wide"><span>Nome do ponto</span><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="ex.: Pátio Guarulhos — vaga 3" /></label>
          <label><span>Operador</span><input list="tdg-operadores" value={form.operador} onChange={(e) => setForm({ ...form, operador: e.target.value })} placeholder="Ground, GreenOn, próprio..." /><datalist id="tdg-operadores">{OPERADORES_SUGERIDOS.map((o) => <option key={o} value={o} />)}</datalist></label>
          <label><span>Corrente</span><select value={form.tipoCorrente} onChange={(e) => setForm({ ...form, tipoCorrente: e.target.value })}>{TIPOS_CORRENTE.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label><span>Conector</span><select value={form.conector} onChange={(e) => setForm({ ...form, conector: e.target.value })}>{CONECTORES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label><span>Potência (kW)</span><input type="number" min="0" inputMode="decimal" value={form.potenciaKw} onChange={(e) => setForm({ ...form, potenciaKw: e.target.value })} placeholder="ex.: 150" /></label>
          <label><span>Situação</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUS_PONTO.map((s) => <option key={s} value={s}>{rotuloStatus[s]}</option>)}</select></label>
          <label className="tdg-recarga-wide"><span>Endereço</span><input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} placeholder="Rua, número, cidade" /></label>
          <label><span>Latitude</span><input type="number" inputMode="decimal" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="-23.43" /></label>
          <label><span>Longitude</span><input type="number" inputMode="decimal" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="-46.47" /></label>
          <p className="tdg-recarga-dica">Sem latitude e longitude o ponto fica no cadastro, mas não aparece no mapa. Informe as duas juntas.</p>
          <div className="tdg-recarga-form-actions">
            <button type="button" onClick={() => { setAberto(false); setForm(formVazio); }}>Cancelar</button>
            <button className="tdg-action" type="submit" disabled={salvando}>{salvando ? "Salvando..." : "Cadastrar ponto"}</button>
          </div>
        </form>
      )}

      <div className="tdg-recarga-filtros" role="tablist" aria-label="Filtro de pontos de recarga">
        {[["ativos", "Ativos"], ["pesados", "Servem pesado"], ["todos", "Todos"]].map(([id, label]) => (
          <button type="button" className={filtro === id ? "active" : ""} onClick={() => setFiltro(id)} key={id}>{label}</button>
        ))}
      </div>

      <div className="tdg-recarga-lista">
        {lista.length === 0 && (
          <div className="tdg-empty-access"><BatteryCharging size={18} />Nenhum ponto {filtro === "ativos" ? "ativo" : filtro === "pesados" ? "que serve pesado" : "cadastrado"}.</div>
        )}
        {lista.map((p) => {
          const pesado = servePesado(p);
          const temMapa = p.latitude != null && p.longitude != null;
          return (
            <article className={`tdg-recarga-card status-${p.status || "ativo"}`} key={p.id}>
              <header>
                <span className="tdg-recarga-nome">
                  <strong><Zap size={15} />{p.nome}</strong>
                  <small>{p.operador || "Sem operador"} · {p.tipoCorrente}{p.conector ? ` · ${p.conector}` : ""} · {numero.format(Math.max(0, Number(p.potenciaKw) || 0))} kW</small>
                </span>
                <span className={pesado ? "tdg-recarga-tag pesado" : "tdg-recarga-tag leve"}>{pesado ? "Serve pesado" : "Leve/urbano"}</span>
              </header>
              {p.endereco && <p className="tdg-recarga-endereco"><MapPin size={13} />{p.endereco}</p>}
              <footer>
                <span className={temMapa ? "tdg-recarga-mapa ok" : "tdg-recarga-mapa off"}>{temMapa ? "No mapa" : "Sem coordenada"}</span>
                <div className="tdg-recarga-acoes">
                  <label>
                    <select value={p.status || "ativo"} onChange={(e) => mudarStatus(p, e.target.value)} aria-label={`Situação de ${p.nome}`}>
                      {STATUS_PONTO.map((s) => <option key={s} value={s}>{rotuloStatus[s]}</option>)}
                    </select>
                  </label>
                  <button type="button" className="tdg-recarga-remover" onClick={() => remover(p)} aria-label={`Remover ${p.nome}`}><Trash2 size={15} /></button>
                </div>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
