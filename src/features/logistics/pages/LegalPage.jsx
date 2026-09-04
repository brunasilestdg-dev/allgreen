import { useMemo, useState } from "react";
import { FileCheck2, Plus, ScrollText, ShieldAlert } from "lucide-react";
import {
  JURIDICO_RISCOS,
  JURIDICO_SITUACOES,
  JURIDICO_TIPOS,
  resumoJuridico,
  rotuloRisco,
  rotuloSituacaoJuridica,
  rotuloTipoJuridico,
  situacaoJuridicaEncerrada,
  validarDocumentoJuridico,
} from "../legalDomain.js";
import "./TodoGreenPages.css";

const formVazio = {
  titulo: "",
  clientId: "",
  contraparte: "",
  tipo: "minuta",
  risco: "medio",
  inicioVigencia: "",
  fimVigencia: "",
  observacoes: "",
  situacao: "rascunho",
};

const dataBR = (valor) => {
  if (!valor) return "—";
  const d = new Date(String(valor).length <= 10 ? `${valor}T00:00:00` : valor);
  return Number.isNaN(d.getTime()) ? valor : d.toLocaleDateString("pt-BR");
};

export default function LegalPage({ registros = [], clients = [], criar, atualizar, setToast }) {
  const [form, setForm] = useState(formVazio);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [filtro, setFiltro] = useState("abertos");

  const resumo = useMemo(() => resumoJuridico(registros), [registros]);
  const nomeCliente = (id) => clients.find((c) => c.id === id)?.name || "";

  const lista = useMemo(() => {
    const ordenados = [...registros].sort((a, b) => String(b.atualizadoEm || "").localeCompare(String(a.atualizadoEm || "")));
    if (filtro === "todos") return ordenados;
    if (filtro === "encerrados") return ordenados.filter((r) => situacaoJuridicaEncerrada(r.situacao));
    return ordenados.filter((r) => !situacaoJuridicaEncerrada(r.situacao));
  }, [registros, filtro]);

  const salvar = async (event) => {
    event.preventDefault();
    const erro = validarDocumentoJuridico(form);
    if (erro) { setToast?.(erro); return; }
    setSalvando(true);
    try {
      await criar?.("legal", form);
      setForm(formVazio);
      setAberto(false);
      setToast?.("Documento jurídico registrado.");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setSalvando(false);
    }
  };

  const mudarSituacao = async (registro, situacao) => {
    try {
      await atualizar?.("legal", registro.id, { situacao, revision: registro.revision });
      setToast?.(`Situação atualizada para "${rotuloSituacaoJuridica(situacao)}".`);
    } catch (razao) {
      setToast?.(razao.message);
    }
  };

  return (
    <div className="tdg-page tdg-legal-page">
      <header className="tdg-page-title">
        <div>
          <span>JURÍDICO</span>
          <h2>Minutas, contratos e riscos</h2>
          <p>Registre o documento com tipo, risco, vigência e responsável, e conduza a situação até a assinatura. É aqui que a minuta vira contrato válido antes de implantação e faturamento avançarem.</p>
        </div>
        <button className="tdg-action" type="button" onClick={() => setAberto((v) => !v)}>
          <Plus size={16} />Novo documento
        </button>
      </header>

      <div className="tdg-legal-metrics">
        <article><small>Em análise</small><strong>{resumo.emAnalise}</strong></article>
        <article><small>Aguardando assinatura</small><strong>{resumo.aguardandoAssinatura}</strong></article>
        <article className={resumo.riscoAlto > 0 ? "risk" : ""}><small>Risco alto em aberto</small><strong>{resumo.riscoAlto}</strong></article>
        <article className={resumo.vencidos > 0 ? "risk" : ""}><small>Vigência vencida</small><strong>{resumo.vencidos}</strong></article>
        <article><small>Assinados</small><strong>{resumo.assinados}</strong></article>
      </div>

      {aberto && (
        <form className="tdg-legal-form tdg-panel" onSubmit={salvar}>
          <label className="tdg-legal-wide"><span>Documento</span><input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: Contrato de operação · Rede Alfa" /></label>
          <label><span>Tipo</span><select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>{JURIDICO_TIPOS.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}</select></label>
          <label><span>Risco jurídico</span><select value={form.risco} onChange={(e) => setForm({ ...form, risco: e.target.value })}>{JURIDICO_RISCOS.map((r) => <option key={r.id} value={r.id}>{r.rotulo}</option>)}</select></label>
          <label><span>Cliente</span><select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Sem cliente</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label><span>Contraparte</span><input value={form.contraparte} onChange={(e) => setForm({ ...form, contraparte: e.target.value })} placeholder="Quem assina do outro lado" /></label>
          <label><span>Início da vigência</span><input type="date" value={form.inicioVigencia} onChange={(e) => setForm({ ...form, inicioVigencia: e.target.value })} /></label>
          <label><span>Fim da vigência</span><input type="date" value={form.fimVigencia} onChange={(e) => setForm({ ...form, fimVigencia: e.target.value })} /></label>
          <label className="tdg-legal-wide"><span>Observações, riscos e ressalvas</span><textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Pontos em discussão, exceções, anexos e o que falta para liberar a assinatura" /></label>
          <div className="tdg-legal-form-actions">
            <button type="button" onClick={() => { setAberto(false); setForm(formVazio); }}>Cancelar</button>
            <button className="tdg-action" type="submit" disabled={salvando}>{salvando ? "Salvando..." : "Registrar documento"}</button>
          </div>
        </form>
      )}

      <div className="tdg-legal-filtros" role="tablist" aria-label="Filtro de documentos jurídicos">
        {[["abertos", "Em aberto"], ["encerrados", "Encerrados"], ["todos", "Todos"]].map(([id, label]) => (
          <button type="button" className={filtro === id ? "active" : ""} onClick={() => setFiltro(id)} key={id}>{label}</button>
        ))}
      </div>

      <div className="tdg-legal-lista">
        {lista.length === 0 && (
          <div className="tdg-empty-access"><FileCheck2 size={18} />Nenhum documento {filtro === "abertos" ? "em aberto" : filtro === "encerrados" ? "encerrado" : "registrado"}.</div>
        )}
        {lista.map((r) => (
          <article className={`tdg-legal-card risco-${r.risco}`} key={r.id}>
            <header>
              <span className="tdg-legal-nome">
                <strong><ScrollText size={15} />{r.titulo}</strong>
                <small>
                  {rotuloTipoJuridico(r.tipo)}
                  {nomeCliente(r.clientId) ? ` · ${nomeCliente(r.clientId)}` : ""}
                  {r.contraparte ? ` · ${r.contraparte}` : ""}
                </small>
              </span>
              <span className={`tdg-legal-risco r-${r.risco}`}>{r.risco === "alto" && <ShieldAlert size={13} />}Risco {rotuloRisco(r.risco).toLowerCase()}</span>
            </header>
            {(r.inicioVigencia || r.fimVigencia || r.observacoes) && (
              <dl className="tdg-legal-detalhe">
                {(r.inicioVigencia || r.fimVigencia) && <div><dt>Vigência</dt><dd>{dataBR(r.inicioVigencia)} → {dataBR(r.fimVigencia)}</dd></div>}
                {r.observacoes && <div><dt>Observações</dt><dd>{r.observacoes}</dd></div>}
              </dl>
            )}
            <footer>
              <span className="tdg-legal-prazo">{r.fimVigencia ? `Vence ${dataBR(r.fimVigencia)}` : "Sem vigência definida"}</span>
              <label className="tdg-legal-situacao">
                <select value={r.situacao} onChange={(e) => mudarSituacao(r, e.target.value)} aria-label={`Situação de ${r.titulo}`}>
                  {JURIDICO_SITUACOES.map((s) => <option key={s.id} value={s.id}>{s.rotulo}</option>)}
                </select>
              </label>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
