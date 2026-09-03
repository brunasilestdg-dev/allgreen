import { useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, ClipboardList, Plus, RefreshCw } from "lucide-react";
import {
  QUALIDADE_GRAVIDADES,
  QUALIDADE_SITUACOES,
  QUALIDADE_TIPOS,
  resumoQualidade,
  rotuloGravidade,
  rotuloSituacaoQualidade,
  rotuloTipoQualidade,
  situacaoEncerrada,
  validarNaoConformidade,
} from "../qualityDomain.js";
import "./TodoGreenPages.css";

const formVazio = {
  titulo: "",
  clientId: "",
  operacaoId: "",
  tipo: "processo",
  gravidade: "media",
  causaRaiz: "",
  planoAcao: "",
  prazo: "",
  situacao: "aberta",
};

const dataBR = (valor) => {
  if (!valor) return "sem prazo";
  const d = new Date(String(valor).length <= 10 ? `${valor}T00:00:00` : valor);
  return Number.isNaN(d.getTime()) ? valor : d.toLocaleDateString("pt-BR");
};

export default function QualityPage({ registros = [], clients = [], operations = [], criar, atualizar, setToast }) {
  const [form, setForm] = useState(formVazio);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [filtro, setFiltro] = useState("abertas");

  const resumo = useMemo(() => resumoQualidade(registros), [registros]);
  const nomeCliente = (id) => clients.find((c) => c.id === id)?.name || "";
  const refOperacao = (id) => {
    const op = operations.find((o) => o.id === id);
    return op ? op.referencia || op.id : "";
  };

  const lista = useMemo(() => {
    const ordenadas = [...registros].sort((a, b) => String(b.atualizadoEm || "").localeCompare(String(a.atualizadoEm || "")));
    if (filtro === "todas") return ordenadas;
    if (filtro === "encerradas") return ordenadas.filter((r) => situacaoEncerrada(r.situacao));
    return ordenadas.filter((r) => !situacaoEncerrada(r.situacao));
  }, [registros, filtro]);

  const salvar = async (event) => {
    event.preventDefault();
    const erro = validarNaoConformidade(form);
    if (erro) { setToast?.(erro); return; }
    setSalvando(true);
    try {
      await criar?.("quality", form);
      setForm(formVazio);
      setAberto(false);
      setToast?.("Não conformidade registrada.");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setSalvando(false);
    }
  };

  const mudarSituacao = async (registro, situacao) => {
    try {
      await atualizar?.("quality", registro.id, { situacao, revision: registro.revision });
      setToast?.(`Situação atualizada para "${rotuloSituacaoQualidade(situacao)}".`);
    } catch (razao) {
      setToast?.(razao.message);
    }
  };

  return (
    <div className="tdg-page tdg-quality-page">
      <header className="tdg-page-title">
        <div>
          <span>QUALIDADE</span>
          <h2>Não conformidades e planos de ação</h2>
          <p>Registre a não conformidade, a causa raiz e o plano de ação com dono e prazo. SLA e ocorrências viram tratativa aqui, não só número no painel.</p>
        </div>
        <button className="tdg-action" type="button" onClick={() => setAberto((v) => !v)}>
          <Plus size={16} />Nova não conformidade
        </button>
      </header>

      <div className="tdg-quality-metrics">
        <article><small>Abertas</small><strong>{resumo.abertas}</strong></article>
        <article className={resumo.criticas > 0 ? "risk" : ""}><small>Críticas abertas</small><strong>{resumo.criticas}</strong></article>
        <article className={resumo.atrasadas > 0 ? "risk" : ""}><small>Atrasadas</small><strong>{resumo.atrasadas}</strong></article>
        <article className={resumo.reincidentes > 0 ? "risk" : ""}><small>Reincidentes</small><strong>{resumo.reincidentes}</strong></article>
        <article><small>Resolvidas</small><strong>{resumo.resolvidas}</strong></article>
      </div>

      {aberto && (
        <form className="tdg-quality-form tdg-panel" onSubmit={salvar}>
          <label className="tdg-quality-wide"><span>Não conformidade</span><input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="O que saiu do padrão" /></label>
          <label><span>Cliente</span><select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Sem cliente</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label><span>Operação</span><select value={form.operacaoId} onChange={(e) => setForm({ ...form, operacaoId: e.target.value })}><option value="">Sem operação</option>{operations.map((o) => <option key={o.id} value={o.id}>{o.referencia || o.id}</option>)}</select></label>
          <label><span>Tipo</span><select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>{QUALIDADE_TIPOS.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}</select></label>
          <label><span>Gravidade</span><select value={form.gravidade} onChange={(e) => setForm({ ...form, gravidade: e.target.value })}>{QUALIDADE_GRAVIDADES.map((g) => <option key={g.id} value={g.id}>{g.rotulo}</option>)}</select></label>
          <label><span>Prazo da correção</span><input type="date" value={form.prazo} onChange={(e) => setForm({ ...form, prazo: e.target.value })} /></label>
          <label className="tdg-quality-wide"><span>Causa raiz</span><textarea value={form.causaRaiz} onChange={(e) => setForm({ ...form, causaRaiz: e.target.value })} placeholder="Por que aconteceu" /></label>
          <label className="tdg-quality-wide"><span>Plano de ação</span><textarea value={form.planoAcao} onChange={(e) => setForm({ ...form, planoAcao: e.target.value })} placeholder="O que será feito para não repetir" /></label>
          <div className="tdg-quality-form-actions">
            <button type="button" onClick={() => { setAberto(false); setForm(formVazio); }}>Cancelar</button>
            <button className="tdg-action" type="submit" disabled={salvando}>{salvando ? "Salvando..." : "Registrar não conformidade"}</button>
          </div>
        </form>
      )}

      <div className="tdg-quality-filtros" role="tablist" aria-label="Filtro de não conformidades">
        {[["abertas", "Abertas"], ["encerradas", "Encerradas"], ["todas", "Todas"]].map(([id, label]) => (
          <button type="button" className={filtro === id ? "active" : ""} onClick={() => setFiltro(id)} key={id}>{label}</button>
        ))}
      </div>

      <div className="tdg-quality-lista">
        {lista.length === 0 && (
          <div className="tdg-empty-access"><BadgeCheck size={18} />Nenhuma não conformidade {filtro === "abertas" ? "aberta" : filtro === "encerradas" ? "encerrada" : "registrada"}.</div>
        )}
        {lista.map((r) => (
          <article className={`tdg-quality-card grav-${r.gravidade}`} key={r.id}>
            <header>
              <span className="tdg-quality-nome">
                <strong><ClipboardList size={15} />{r.titulo}</strong>
                <small>
                  {rotuloTipoQualidade(r.tipo)}
                  {nomeCliente(r.clientId) ? ` · ${nomeCliente(r.clientId)}` : ""}
                  {refOperacao(r.operacaoId) ? ` · ${refOperacao(r.operacaoId)}` : ""}
                </small>
              </span>
              <span className={`tdg-quality-grav g-${r.gravidade}`}>{(r.gravidade === "critica" || r.gravidade === "alta") && <AlertTriangle size={13} />}{rotuloGravidade(r.gravidade)}</span>
            </header>
            {(r.causaRaiz || r.planoAcao) && (
              <dl className="tdg-quality-detalhe">
                {r.causaRaiz && <div><dt>Causa raiz</dt><dd>{r.causaRaiz}</dd></div>}
                {r.planoAcao && <div><dt>Plano de ação</dt><dd>{r.planoAcao}</dd></div>}
              </dl>
            )}
            <footer>
              <span className="tdg-quality-prazo">Prazo: {dataBR(r.prazo)}</span>
              <label className="tdg-quality-situacao">
                <select value={r.situacao} onChange={(e) => mudarSituacao(r, e.target.value)} aria-label={`Situação de ${r.titulo}`}>
                  {QUALIDADE_SITUACOES.map((s) => <option key={s.id} value={s.id}>{s.rotulo}</option>)}
                </select>
              </label>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
