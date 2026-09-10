import { useMemo, useState } from "react";
import { AlarmClock, Building2, CalendarClock, FileCheck2, MessagesSquare, Paperclip, PenLine, Plus, ScrollText, ShieldAlert } from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import AnexosContexto from "./AnexosContexto.jsx";
import {
  JURIDICO_RISCOS,
  JURIDICO_TIPOS,
  acoesJuridicasDisponiveis,
  diasParaVencer,
  documentosVencendo,
  resumoJuridico,
  rotuloRisco,
  rotuloSituacaoJuridica,
  rotuloTipoJuridico,
  situacaoJuridicaEncerrada,
  validarDocumentoJuridico,
} from "../legalDomain.js";
import "./TodoGreenPages.css";

const ROTULO_EVENTO = {
  submissao: "Enviado ao Jurídico", reenvio: "Reenviado", validado: "Validado",
  reprovado: "Reprovado", ajuste_solicitado: "Ajustes solicitados", comentario: "Comentário",
  assinatura: "Assinado", arquivamento: "Arquivado", conclusao: "Concluído",
};
const dataHoraBR = (valor) => { const d = new Date(valor); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR"); };

const formVazio = {
  titulo: "",
  clientId: "",
  contraparte: "",
  cnpj: "",
  signatario: "",
  signatarioEmail: "",
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

// Só dígitos e no máximo 14; o CNPJ é opcional, mas quando vem, guarda limpo.
const soDigitos = (valor) => String(valor || "").replace(/\D/g, "").slice(0, 14);
const formatarCnpj = (valor) => {
  const d = soDigitos(valor);
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

// O texto e o tom do aviso de vigência a partir dos dias que faltam. É o que
// transforma "fimVigencia: 2026-09-20" em "Vence em 10 dias" com a cor certa.
const alertaDeVencimento = (dias) => {
  if (dias === null || dias === undefined) return null;
  if (dias < 0) return { tom: "vencido", texto: dias === -1 ? "Venceu ontem" : `Vencido há ${Math.abs(dias)} dias` };
  if (dias === 0) return { tom: "vencido", texto: "Vence hoje" };
  if (dias === 1) return { tom: "urgente", texto: "Vence amanhã" };
  if (dias <= 30) return { tom: "urgente", texto: `Vence em ${dias} dias` };
  if (dias <= 90) return { tom: "atencao", texto: `Vence em ${dias} dias` };
  return null;
};

export default function LegalPage({ registros = [], clients = [], criar, setToast, authHeaders, listarSubrecurso, recarregar, juridico = false }) {
  const [form, setForm] = useState(formVazio);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [filtro, setFiltro] = useState("abertos");
  // O vai-e-volta do documento: qual está aberto, a linha do tempo, e o envio.
  const [fluxo, setFluxo] = useState(null); // registro selecionado
  const [eventos, setEventos] = useState([]);
  const [situacaoFluxo, setSituacaoFluxo] = useState("");
  const [envio, setEnvio] = useState({ mensagem: "", anexoUrl: "", anexoNome: "" });
  const [agindo, setAgindo] = useState(false);

  const carregarFluxo = async (registro) => {
    setFluxo(registro);
    setEventos([]);
    setSituacaoFluxo(registro.situacao);
    setEnvio({ mensagem: "", anexoUrl: "", anexoNome: "" });
    try {
      const r = await listarSubrecurso?.("legal", registro.id, "events");
      setEventos(r?.eventos || []);
      setSituacaoFluxo(r?.situacao || registro.situacao);
    } catch (e) { setToast?.(e.message); }
  };

  const agir = async (acaoId) => {
    if (!fluxo) return;
    setAgindo(true);
    try {
      const headers = { ...(authHeaders?.() || {}), "content-type": "application/json" };
      const r = await fetch(`/api/todogreen/records/legal/${encodeURIComponent(fluxo.id)}/events`, {
        method: "POST", headers,
        body: JSON.stringify({ acao: acaoId, mensagem: envio.mensagem, anexoUrl: envio.anexoUrl, anexoNome: envio.anexoNome }),
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(p.error || "Não foi possível registrar a ação.");
      setEventos(p.eventos || []);
      setSituacaoFluxo(p.situacao || situacaoFluxo);
      setEnvio({ mensagem: "", anexoUrl: "", anexoNome: "" });
      setToast?.("Ação registrada no fluxo jurídico.");
      recarregar?.();
    } catch (e) { setToast?.(e.message); }
    finally { setAgindo(false); }
  };

  const resumo = useMemo(() => resumoJuridico(registros), [registros]);
  // Documentos em aberto que vencem (ou já venceram) dentro de 90 dias — a
  // agenda de renovação, do mais urgente ao menos, para não perder a data.
  const vencendo = useMemo(() => documentosVencendo(registros, { dias: 90 }), [registros]);
  const nomeCliente = (id) => clients.find((c) => c.id === id)?.name || "";
  const contraparteDe = (r) => r.contraparte || nomeCliente(r.clientId) || r.titulo;

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
      // Contraparte estruturada (CNPJ e signatário) viaja em `campos`, sem
      // migração — o worker grava em fields_json e devolve em `campos`.
      const { cnpj, signatario, signatarioEmail, ...base } = form;
      await criar?.("legal", { ...base, campos: { cnpj: soDigitos(cnpj), signatario: signatario.trim(), signatarioEmail: signatarioEmail.trim() } });
      setForm(formVazio);
      setAberto(false);
      setToast?.("Documento jurídico registrado.");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="tdg-page tdg-legal-page">
      <header className="tdg-page-title">
        <div>
          <span>JURÍDICO</span>
          <h2>Minutas, contratos e riscos</h2>
          <p>Registre o documento com contraparte, risco, vigência e responsável, e conduza a situação até a assinatura. É aqui que a minuta vira contrato válido antes de implantação e faturamento avançarem.</p>
        </div>
        <button className="tdg-action" type="button" onClick={() => setAberto((v) => !v)}>
          <Plus size={16} />Novo documento
        </button>
      </header>

      <div className="tdg-legal-metrics">
        <article><small>Em análise</small><strong>{resumo.emAnalise}</strong></article>
        <article><small>Aguardando assinatura</small><strong>{resumo.aguardandoAssinatura}</strong></article>
        <article className={resumo.vencendo > 0 ? "warn" : ""}><small>Vencendo em 30 dias</small><strong>{resumo.vencendo}</strong></article>
        <article className={resumo.riscoAlto > 0 ? "risk" : ""}><small>Risco alto em aberto</small><strong>{resumo.riscoAlto}</strong></article>
        <article className={resumo.vencidos > 0 ? "risk" : ""}><small>Vigência vencida</small><strong>{resumo.vencidos}</strong></article>
        <article><small>Assinados</small><strong>{resumo.assinados}</strong></article>
      </div>

      {vencendo.length > 0 && (
        <section className="tdg-legal-alertas" aria-label="Documentos a renovar">
          <header><AlarmClock size={16} /><strong>Renove antes de vencer</strong><small>{vencendo.length} documento{vencendo.length > 1 ? "s" : ""} em aberto com vigência terminando</small></header>
          <ul>
            {vencendo.map((r) => {
              const aviso = alertaDeVencimento(r.diasParaVencer);
              return (
                <li key={r.id}>
                  <button type="button" className={`tdg-legal-alerta tom-${aviso?.tom || "atencao"}`} onClick={() => carregarFluxo(r)}>
                    <span className="tdg-legal-alerta-titulo"><ScrollText size={14} />{r.titulo}</span>
                    <span className="tdg-legal-alerta-meta">{contraparteDe(r)} · vence {dataBR(r.fimVigencia)}</span>
                    <span className={`tdg-legal-vencimento tom-${aviso?.tom || "atencao"}`}><CalendarClock size={12} />{aviso?.texto}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {aberto && (
        <form className="tdg-legal-form tdg-panel" onSubmit={salvar}>
          <label className="tdg-legal-wide"><span>Documento</span><input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: Contrato de operação · Rede Alfa" /></label>
          <label><span>Tipo</span><select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>{JURIDICO_TIPOS.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}</select></label>
          <label><span>Risco jurídico</span><select value={form.risco} onChange={(e) => setForm({ ...form, risco: e.target.value })}>{JURIDICO_RISCOS.map((r) => <option key={r.id} value={r.id}>{r.rotulo}</option>)}</select></label>
          <label><span>Cliente</span><select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Sem cliente</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label><span>Contraparte (razão social)</span><input value={form.contraparte} onChange={(e) => setForm({ ...form, contraparte: e.target.value })} placeholder="Empresa que assina do outro lado" /></label>
          <label><span>CNPJ da contraparte</span><input value={form.cnpj} inputMode="numeric" onChange={(e) => setForm({ ...form, cnpj: soDigitos(e.target.value) })} placeholder="Só números" /></label>
          <label><span>Signatário (quem assina)</span><input value={form.signatario} onChange={(e) => setForm({ ...form, signatario: e.target.value })} placeholder="Nome de quem assina pela contraparte" /></label>
          <label><span>E-mail do signatário</span><input type="email" value={form.signatarioEmail} onChange={(e) => setForm({ ...form, signatarioEmail: e.target.value })} placeholder="Para envio da assinatura" /></label>
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
        {lista.map((r) => {
          const encerrado = situacaoJuridicaEncerrada(r.situacao);
          const aviso = encerrado ? null : alertaDeVencimento(diasParaVencer(r.fimVigencia));
          const cnpj = r.campos?.cnpj ? formatarCnpj(r.campos.cnpj) : "";
          const signatario = r.campos?.signatario || "";
          return (
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
              {(r.inicioVigencia || r.fimVigencia || cnpj || signatario || r.observacoes) && (
                <dl className="tdg-legal-detalhe">
                  {cnpj && <div><dt><Building2 size={11} />CNPJ</dt><dd>{cnpj}</dd></div>}
                  {signatario && <div><dt><PenLine size={11} />Signatário</dt><dd>{signatario}{r.campos?.signatarioEmail ? ` · ${r.campos.signatarioEmail}` : ""}</dd></div>}
                  {(r.inicioVigencia || r.fimVigencia) && <div><dt>Vigência</dt><dd>{dataBR(r.inicioVigencia)} → {dataBR(r.fimVigencia)}</dd></div>}
                  {r.observacoes && <div><dt>Observações</dt><dd>{r.observacoes}</dd></div>}
                </dl>
              )}
              <footer>
                <button type="button" className="tdg-legal-fluxo-btn" onClick={() => carregarFluxo(r)}><MessagesSquare size={14} />Abrir fluxo · {rotuloSituacaoJuridica(r.situacao)}</button>
                {aviso && <span className={`tdg-legal-vencimento tom-${aviso.tom}`}><CalendarClock size={12} />{aviso.texto}</span>}
              </footer>
            </article>
          );
        })}
      </div>

      {fluxo && (
        <Modal title={`Fluxo jurídico · ${fluxo.titulo}`} onClose={() => setFluxo(null)} wide>
          <div className="tdg-legal-fluxo">
            <p className="tdg-legal-fluxo-situacao">Situação atual: <strong>{rotuloSituacaoJuridica(situacaoFluxo)}</strong></p>
            <div className="tdg-legal-timeline">
              {eventos.length === 0 && <small>Sem movimentações ainda. Envie o documento ou uma solicitação ao Jurídico para começar.</small>}
              {eventos.map((ev) => (
                <article className={`tdg-legal-ev ev-${ev.tipo}`} key={ev.id}>
                  <header><strong>{ROTULO_EVENTO[ev.tipo] || ev.tipo}</strong><small>{ev.autor} · {dataHoraBR(ev.criadoEm)}</small></header>
                  {ev.mensagem && <p>{ev.mensagem}</p>}
                  {ev.anexoUrl && <a href={ev.anexoUrl} target="_blank" rel="noreferrer noopener"><Paperclip size={13} />{ev.anexoNome || "Anexo"}</a>}
                </article>
              ))}
            </div>
            {/* Contrato de verdade: arquivo no cofre interno, versionado por nome.
                Reenviar o mesmo nome cria uma nova versão (v2, v3…). */}
            <div className="tdg-legal-arquivos">
              <AnexosContexto contextType="legal" contextId={fluxo.id} titulo="Contrato e anexos (arquivos)" setToast={setToast} />
            </div>
            {situacaoJuridicaEncerrada(situacaoFluxo) ? (
              <p className="tdg-legal-fluxo-fim">Documento encerrado ({rotuloSituacaoJuridica(situacaoFluxo)}). Não há mais tratativa em aberto.</p>
            ) : (
              <div className="tdg-legal-envio">
                <label><span>Mensagem / solicitação redigida</span><textarea value={envio.mensagem} onChange={(e) => setEnvio((v) => ({ ...v, mensagem: e.target.value }))} placeholder="Descreva o pedido, o parecer ou os ajustes necessários" /></label>
                <div className="tdg-legal-anexo">
                  <label><span>Anexo — link do arquivo</span><input value={envio.anexoUrl} onChange={(e) => setEnvio((v) => ({ ...v, anexoUrl: e.target.value }))} placeholder="https://... (minuta, parecer, contrato)" /></label>
                  <label><span>Nome do anexo</span><input value={envio.anexoNome} onChange={(e) => setEnvio((v) => ({ ...v, anexoNome: e.target.value }))} placeholder="Ex.: Minuta v2" /></label>
                </div>
                <div className="tdg-legal-fluxo-acoes">
                  {acoesJuridicasDisponiveis(situacaoFluxo, { juridico }).map((acao) => {
                    const faltaMensagem = acao.exigeMensagem && !envio.mensagem.trim();
                    const faltaConteudo = acao.exigeConteudo && !envio.mensagem.trim() && !envio.anexoUrl.trim();
                    return (
                      <button key={acao.id} type="button" className={acao.juridico ? "tdg-action" : ""} disabled={agindo || faltaMensagem || faltaConteudo} onClick={() => agir(acao.id)} title={faltaConteudo ? "Envie o arquivo (link) ou escreva a solicitação" : faltaMensagem ? "Escreva a mensagem" : ""}>{acao.rotulo}</button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
