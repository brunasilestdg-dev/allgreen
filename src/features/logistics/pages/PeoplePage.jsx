import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Clock, Lock, Plane, RefreshCw, UserPlus, Users } from "lucide-react";
import "./TodoGreenPages.css";
import Modal from "../../../components/Modal.jsx";
import { comRotulo } from "../rotulosDomain.js";

// Pessoas e folha. Dado sensível: o servidor só entrega isto a quem tem
// hr:manage (rh/admin/owner) — a tela nem tenta esconder o que o back não manda.
// Vocabulário "colaborador", nunca "funcionário".

const request = async (path, authHeaders, options = {}) => {
  const resposta = await fetch(`/api/todogreen/payroll${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(authHeaders?.() || {}), ...(options.headers || {}) },
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(corpo.error || "Não foi possível acessar pessoas e folha.");
    erro.detalhes = corpo.erros || [];
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
};

const dinheiro = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const NOME_STATUS = { ativo: "Ativo", afastado: "Afastado", ferias: "Férias", desligado: "Desligado" };
const NOME_RUN = { aberta: "Aberta", fechada: "Fechada", reaberta: "Reaberta" };

const COLABORADOR_VAZIO = {
  nome: "", cpf: "", cargo: "", vinculo: "clt", salarioBase: "", dependentes: 0, admissaoEm: "",
};

export default function PeoplePage({ authHeaders, setToast }) {
  const [aba, setAba] = useState("pessoas");
  const [colaboradores, setColaboradores] = useState([]);
  const [folhas, setFolhas] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [ocupado, setOcupado] = useState("carregando");
  const [erro, setErro] = useState("");
  const [semAcesso, setSemAcesso] = useState(false);
  const [form, setForm] = useState(COLABORADOR_VAZIO);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [competencia, setCompetencia] = useState("");
  const [pontos, setPontos] = useState([]);
  const [ferias, setFerias] = useState([]);
  const hojeISO = new Date().toISOString().slice(0, 10);
  const [formPonto, setFormPonto] = useState({ employeeId: "", dia: hojeISO, entrada: "", saida: "", horasExtras: "", horasNoturnas: "", falta: false, observacao: "" });
  const [formFerias, setFormFerias] = useState({ employeeId: "", periodoAquisitivoInicio: "", periodoAquisitivoFim: "", gozoInicio: "", gozoFim: "", dias: 30, abonoPecuniario: false, adiantarDecimo: false });
  const [rescForm, setRescForm] = useState(null); // { id, nome, revision, desligamentoEm, saldoFgts, diasFeriasVencidas }

  const avisar = (mensagem, tom = "info") => (setToast ? setToast({ mensagem, tom }) : undefined);

  const carregar = async () => {
    setOcupado("carregando");
    setErro("");
    try {
      const [pessoas, runs, res] = await Promise.all([
        request("/colaboradores?limit=200", authHeaders),
        request("/folhas", authHeaders),
        request("/resumo", authHeaders),
      ]);
      setColaboradores(pessoas.registros || []);
      setFolhas(runs.registros || []);
      setResumo(res || null);
      setOcupado("");
    } catch (motivo) {
      if (motivo.status === 403) { setSemAcesso(true); setOcupado(""); return; }
      setErro(motivo.message);
      setOcupado("");
    }
  };

  useEffect(() => { carregar(); }, []);

  const criarColaborador = async (evento) => {
    evento.preventDefault();
    setOcupado("salvando");
    try {
      await request("/colaboradores", authHeaders, { method: "POST", body: JSON.stringify(form) });
      avisar("Colaborador cadastrado.", "sucesso");
      setForm(COLABORADOR_VAZIO);
      setMostrarForm(false);
      await carregar();
    } catch (motivo) {
      const detalhe = (motivo.detalhes || []).join(" · ");
      avisar(detalhe ? `${motivo.message} ${detalhe}` : motivo.message, "erro");
      setOcupado("");
    }
  };

  const abrirFolha = async () => {
    if (!/^\d{4}-\d{2}$/.test(competencia)) { avisar("Informe a competência (AAAA-MM).", "erro"); return; }
    try {
      await request("/folhas", authHeaders, { method: "POST", body: JSON.stringify({ competencia, tipo: "mensal" }) });
      avisar("Folha aberta.", "sucesso");
      setCompetencia("");
      await carregar();
    } catch (motivo) { avisar(motivo.message, "erro"); }
  };

  const fecharFolha = async (run) => {
    try {
      const r = await request(`/folhas/${run.id}/fechar`, authHeaders, { method: "POST" });
      avisar(`Folha fechada: ${r.colaboradores} colaboradores, líquido ${dinheiro(r.totalLiquido)}.${r.pendentesSalario ? ` ${r.pendentesSalario} sem salário cadastrado (ignorado(s)).` : ""}`, "sucesso");
      await carregar();
    } catch (motivo) { avisar(motivo.message, "erro"); }
  };

  const reabrirFolha = async (run) => {
    try {
      await request(`/folhas/${run.id}/reabrir`, authHeaders, { method: "POST" });
      avisar("Folha reaberta.", "sucesso");
      await carregar();
    } catch (motivo) { avisar(motivo.message, "erro"); }
  };

  const carregarPonto = async () => {
    try { setPontos((await request("/ponto", authHeaders)).registros || []); }
    catch (motivo) { avisar(motivo.message, "erro"); }
  };
  const carregarFerias = async () => {
    try { setFerias((await request("/ferias", authHeaders)).registros || []); }
    catch (motivo) { avisar(motivo.message, "erro"); }
  };

  const registrarPonto = async (evento) => {
    evento.preventDefault();
    if (!formPonto.employeeId) { avisar("Escolha o colaborador.", "erro"); return; }
    try {
      await request("/ponto", authHeaders, { method: "POST", body: JSON.stringify(formPonto) });
      avisar("Ponto registrado.", "sucesso");
      setFormPonto((f) => ({ ...f, entrada: "", saida: "", horasExtras: "", horasNoturnas: "", falta: false, observacao: "" }));
      await carregarPonto();
    } catch (motivo) { avisar([motivo.message, ...(motivo.detalhes || [])].join(" · "), "erro"); }
  };

  const criarFerias = async (evento) => {
    evento.preventDefault();
    if (!formFerias.employeeId) { avisar("Escolha o colaborador.", "erro"); return; }
    try {
      await request("/ferias", authHeaders, { method: "POST", body: JSON.stringify(formFerias) });
      avisar("Férias registradas.", "sucesso");
      setFormFerias((f) => ({ ...f, gozoInicio: "", gozoFim: "" }));
      await carregarFerias();
    } catch (motivo) { avisar([motivo.message, ...(motivo.detalhes || [])].join(" · "), "erro"); }
  };

  const pagarFerias = async (f) => {
    if (!f.gozoInicio) { avisar("Informe o início do gozo antes de pagar.", "erro"); return; }
    try {
      const res = await request(`/ferias/${f.id}/pagar`, authHeaders, {
        method: "POST", body: JSON.stringify({ revision: f.revision }),
      });
      avisar(`Férias pagas: líquido ${dinheiro(res.holerite?.liquido)} · ${res.lancamentosFinanceiros} lançamento(s) no razão.`, "sucesso");
      await carregarFerias();
    } catch (motivo) { avisar(motivo.message, "erro"); }
  };

  const confirmarRescisao = async (evento) => {
    evento.preventDefault();
    if (!rescForm?.desligamentoEm) { avisar("Informe a data de desligamento.", "erro"); return; }
    try {
      const res = await request(`/colaboradores/${rescForm.id}/rescindir`, authHeaders, {
        method: "POST",
        body: JSON.stringify({
          revision: rescForm.revision,
          desligamentoEm: rescForm.desligamentoEm,
          diasFeriasVencidas: rescForm.diasFeriasVencidas || 0,
          saldoFgts: rescForm.saldoFgts === "" ? undefined : rescForm.saldoFgts,
        }),
      });
      avisar(`Rescisão calculada: líquido ${dinheiro(res.rescisao?.liquido)} · ${res.lancamentosFinanceiros} lançamento(s) no razão.`, "sucesso");
      setRescForm(null);
      await carregar();
    } catch (motivo) { avisar(motivo.message, "erro"); }
  };

  const nomeColaborador = (id) => colaboradores.find((c) => c.id === id)?.nome || id || "—";

  useEffect(() => {
    if (aba === "ponto" && !pontos.length) carregarPonto();
    if (aba === "ferias" && !ferias.length) carregarFerias();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba]);

  if (ocupado === "carregando") {
    return <div className="tdg-page"><section className="tdg-panel">Carregando pessoas e folha...</section></div>;
  }

  if (semAcesso) {
    return (
      <div className="tdg-page">
        <section className="tdg-panel">
          <div className="tdg-alert" role="status">
            <Lock size={18} />
            <span>Pessoas e folha guardam dado sensível (CPF, salário). O acesso é restrito ao RH — fale com quem administra os papéis da vertical.</span>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="tdg-page tdg-people">
      <header className="tdg-page-title">
        <div>
          <span>DP/RH</span>
          <h2>Pessoas e folha</h2>
          <p>Colaboradores, ponto, férias e folha (só o RH vê).</p>
        </div>
        <div className="tdg-page-actions">
          <button className="tdg-action" type="button" onClick={carregar}><RefreshCw size={16} />Atualizar</button>
          <button className="tdg-action" type="button" onClick={() => setMostrarForm(true)}><UserPlus size={16} />Novo colaborador</button>
        </div>
      </header>

      {erro && <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{erro}</span></div>}

      <section className="tdg-metrics">
        <article className="tdg-metric"><span>Colaboradores ativos</span><strong>{resumo?.colaboradoresAtivos || 0}</strong><small><Users size={13} /> na folha</small></article>
        <article className="tdg-metric"><span>Folha base (salários)</span><strong>{dinheiro(resumo?.folhaBase)}</strong><small>soma dos salários base</small></article>
        <article className="tdg-metric"><span>Último fechamento</span><strong>{resumo?.ultimoFechamento?.competencia || "—"}</strong><small>{resumo?.ultimoFechamento ? dinheiro(resumo.ultimoFechamento.totalLiquido) : "nenhum ainda"}</small></article>
        <article className="tdg-metric"><span>eSocial</span><strong>{resumo?.transmissaoEsocialHabilitada ? "Pronto" : "Pendente"}</strong><small>{resumo?.transmissaoEsocialHabilitada ? "certificado no cofre" : "aguarda certificado"}</small></article>
      </section>

      {/* Cadastro em janela própria: o formulário não empurra mais a barra
          de abas para fora da tela (rodada "nada corta a tela", 30/08). */}
      {mostrarForm && (
        <Modal title="Novo colaborador" onClose={() => setMostrarForm(false)} wide>
        <form className="tdg-form tdg-form-em-modal" onSubmit={criarColaborador}>
          <label><span>Nome *</span><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required /></label>
          <label><span>CPF *</span><input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} placeholder="000.000.000-00" required /></label>
          <label><span>Cargo</span><input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} /></label>
          <label>
            <span>Vínculo</span>
            <select value={form.vinculo} onChange={(e) => setForm({ ...form, vinculo: e.target.value })}>
              <option value="clt">CLT</option><option value="pj">PJ</option><option value="estagio">Estágio</option>
              <option value="temporario">Temporário</option><option value="aprendiz">Aprendiz</option><option value="autonomo">Autônomo</option>
            </select>
          </label>
          <label><span>Salário base *</span><input type="number" step="0.01" min="0" value={form.salarioBase} onChange={(e) => setForm({ ...form, salarioBase: e.target.value })} required /></label>
          <label><span>Dependentes</span><input type="number" min="0" value={form.dependentes} onChange={(e) => setForm({ ...form, dependentes: e.target.value })} /></label>
          <label><span>Admissão *</span><input type="date" value={form.admissaoEm} onChange={(e) => setForm({ ...form, admissaoEm: e.target.value })} required /></label>
          <div className="tdg-form-actions full">
            <button className="tdg-action" type="submit" disabled={ocupado === "salvando"}>{ocupado === "salvando" ? "Salvando..." : "Cadastrar"}</button>
            <button type="button" onClick={() => setMostrarForm(false)}>Cancelar</button>
          </div>
        </form>
        </Modal>
      )}

      <div className="tdg-workviews-switch" role="tablist" aria-label="Seções">
        <button type="button" role="tab" aria-selected={aba === "pessoas"} className={aba === "pessoas" ? "active" : ""} onClick={() => setAba("pessoas")}><Users size={15} />Colaboradores</button>
        <button type="button" role="tab" aria-selected={aba === "ponto"} className={aba === "ponto" ? "active" : ""} onClick={() => setAba("ponto")}><Clock size={15} />Ponto</button>
        <button type="button" role="tab" aria-selected={aba === "ferias"} className={aba === "ferias" ? "active" : ""} onClick={() => setAba("ferias")}><Plane size={15} />Férias</button>
        <button type="button" role="tab" aria-selected={aba === "folha"} className={aba === "folha" ? "active" : ""} onClick={() => setAba("folha")}><CalendarClock size={15} />Folha</button>
      </div>

      {aba === "pessoas" && (
        <section className="tdg-panel">
          {!colaboradores.length
            ? <p className="tdg-empty">Nenhum colaborador ainda. Cadastre o primeiro.</p>
            : (
              <div className="tdg-table-wrap">
                <table className="tdg-table">
                  <thead><tr><th>Nome</th><th>CPF</th><th>Cargo</th><th>Vínculo</th><th>Salário base</th><th>Status</th><th>Ações</th></tr></thead>
                  <tbody>
                    {colaboradores.map((c) => (
                      <tr key={c.id}>
                        <td>{c.nome}</td>
                        <td>{c.cpf || "—"}</td>
                        <td>{c.cargo || "—"}</td>
                        <td>{c.vinculo?.toUpperCase()}</td>
                        <td>{dinheiro(c.salarioBase)}</td>
                        <td>{comRotulo(NOME_STATUS, c.status)}</td>
                        <td className="tdg-fiscal-acoes">
                          <button type="button" disabled={c.status === "desligado"}
                            onClick={() => setRescForm({ id: c.id, nome: c.nome, revision: c.revision, desligamentoEm: hojeISO, saldoFgts: "", diasFeriasVencidas: 0 })}>
                            Rescindir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          {/* Rescisão em janela própria — dado sensível não fica exposto no
              meio da lista de pessoas. */}
          {rescForm && (
            <Modal title={`Rescisão de ${rescForm.nome}`} onClose={() => setRescForm(null)}>
            <form className="tdg-form tdg-people-subform tdg-form-em-modal" onSubmit={confirmarRescisao}>
              <p className="full"><strong>Rescisão de {rescForm.nome}</strong> — dispensa sem justa causa. O motor cobre as verbas federais do caso comum; confira antes de homologar.</p>
              <label><span>Desligamento *</span><input type="date" value={rescForm.desligamentoEm} onChange={(e) => setRescForm({ ...rescForm, desligamentoEm: e.target.value })} required /></label>
              <label><span>Dias de férias vencidas</span><input type="number" min="0" max="30" value={rescForm.diasFeriasVencidas} onChange={(e) => setRescForm({ ...rescForm, diasFeriasVencidas: e.target.value })} /></label>
              <label><span>Saldo FGTS depositado (p/ multa 40%)</span><input type="number" min="0" step="0.01" value={rescForm.saldoFgts} onChange={(e) => setRescForm({ ...rescForm, saldoFgts: e.target.value })} placeholder="opcional" /></label>
              <div className="tdg-form-actions full">
                <button type="button" onClick={() => setRescForm(null)}>Cancelar</button>
                <button className="tdg-action" type="submit">Calcular rescisão</button>
              </div>
            </form>
            </Modal>
          )}
        </section>
      )}

      {aba === "ponto" && (
        <section className="tdg-panel">
          <form className="tdg-form tdg-people-subform" onSubmit={registrarPonto}>
            <label><span>Colaborador *</span>
              <select value={formPonto.employeeId} onChange={(e) => setFormPonto({ ...formPonto, employeeId: e.target.value })} required>
                <option value="">— selecione —</option>
                {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
            <label><span>Dia *</span><input type="date" value={formPonto.dia} onChange={(e) => setFormPonto({ ...formPonto, dia: e.target.value })} required /></label>
            <label><span>Entrada</span><input type="time" value={formPonto.entrada} onChange={(e) => setFormPonto({ ...formPonto, entrada: e.target.value })} /></label>
            <label><span>Saída</span><input type="time" value={formPonto.saida} onChange={(e) => setFormPonto({ ...formPonto, saida: e.target.value })} /></label>
            <label><span>Horas extras</span><input type="number" min="0" step="0.5" value={formPonto.horasExtras} onChange={(e) => setFormPonto({ ...formPonto, horasExtras: e.target.value })} /></label>
            <label><span>Horas noturnas</span><input type="number" min="0" step="0.5" value={formPonto.horasNoturnas} onChange={(e) => setFormPonto({ ...formPonto, horasNoturnas: e.target.value })} /></label>
            <label className="tdg-check-field"><input type="checkbox" checked={formPonto.falta} onChange={(e) => setFormPonto({ ...formPonto, falta: e.target.checked })} /><span>Falta</span></label>
            <label><span>Observação</span><input value={formPonto.observacao} onChange={(e) => setFormPonto({ ...formPonto, observacao: e.target.value })} /></label>
            <div className="tdg-form-actions full"><button className="tdg-action" type="submit">Registrar ponto</button></div>
          </form>
          {!pontos.length
            ? <p className="tdg-empty">Nenhum ponto registrado ainda.</p>
            : (
              <div className="tdg-table-wrap">
                <table className="tdg-table">
                  <thead><tr><th>Colaborador</th><th>Dia</th><th>Entrada</th><th>Saída</th><th>Extras</th><th>Noturnas</th><th>Falta</th></tr></thead>
                  <tbody>
                    {pontos.map((p) => (
                      <tr key={p.id}>
                        <td>{nomeColaborador(p.employeeId)}</td><td>{p.dia}</td><td>{p.entrada || "—"}</td><td>{p.saida || "—"}</td>
                        <td>{p.horasExtras || 0}</td><td>{p.horasNoturnas || 0}</td><td>{p.falta ? "Sim" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      )}

      {aba === "ferias" && (
        <section className="tdg-panel">
          <form className="tdg-form tdg-people-subform" onSubmit={criarFerias}>
            <label><span>Colaborador *</span>
              <select value={formFerias.employeeId} onChange={(e) => setFormFerias({ ...formFerias, employeeId: e.target.value })} required>
                <option value="">— selecione —</option>
                {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
            <label><span>Aquisitivo início</span><input type="date" value={formFerias.periodoAquisitivoInicio} onChange={(e) => setFormFerias({ ...formFerias, periodoAquisitivoInicio: e.target.value })} /></label>
            <label><span>Aquisitivo fim</span><input type="date" value={formFerias.periodoAquisitivoFim} onChange={(e) => setFormFerias({ ...formFerias, periodoAquisitivoFim: e.target.value })} /></label>
            <label><span>Gozo início</span><input type="date" value={formFerias.gozoInicio} onChange={(e) => setFormFerias({ ...formFerias, gozoInicio: e.target.value })} /></label>
            <label><span>Gozo fim</span><input type="date" value={formFerias.gozoFim} onChange={(e) => setFormFerias({ ...formFerias, gozoFim: e.target.value })} /></label>
            <label><span>Dias</span><input type="number" min="1" max="30" value={formFerias.dias} onChange={(e) => setFormFerias({ ...formFerias, dias: e.target.value })} /></label>
            <label className="tdg-check-field"><input type="checkbox" checked={formFerias.abonoPecuniario} onChange={(e) => setFormFerias({ ...formFerias, abonoPecuniario: e.target.checked })} /><span>Abono pecuniário (vender 1/3)</span></label>
            <label className="tdg-check-field"><input type="checkbox" checked={formFerias.adiantarDecimo} onChange={(e) => setFormFerias({ ...formFerias, adiantarDecimo: e.target.checked })} /><span>Adiantar 13º</span></label>
            <div className="tdg-form-actions full"><button className="tdg-action" type="submit">Registrar férias</button></div>
          </form>
          {!ferias.length
            ? <p className="tdg-empty">Nenhuma férias programada ainda.</p>
            : (
              <div className="tdg-table-wrap">
                <table className="tdg-table">
                  <thead><tr><th>Colaborador</th><th>Aquisitivo</th><th>Gozo</th><th>Dias</th><th>Abono</th><th>Status</th><th>Pago</th><th>Ações</th></tr></thead>
                  <tbody>
                    {ferias.map((f) => (
                      <tr key={f.id}>
                        <td>{nomeColaborador(f.employeeId)}</td>
                        <td>{f.periodoAquisitivoInicio || "—"} a {f.periodoAquisitivoFim || "—"}</td>
                        <td>{f.gozoInicio ? `${f.gozoInicio} a ${f.gozoFim || "?"}` : "a programar"}</td>
                        <td>{f.dias}</td><td>{f.abonoPecuniario ? "Sim" : "—"}</td><td>{f.status}</td>
                        <td>{f.pagamento ? dinheiro(f.pagamento.liquido) : "—"}</td>
                        <td className="tdg-fiscal-acoes">
                          <button type="button" disabled={!f.gozoInicio || f.status === "cancelada"} onClick={() => pagarFerias(f)}>
                            {f.pagamento ? "Recalcular" : "Pagar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      )}

      {aba === "folha" && (
        <section className="tdg-panel">
          <div className="tdg-people-folha-abrir">
            <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} aria-label="Competência" />
            <button className="tdg-action" type="button" onClick={abrirFolha}>Abrir folha da competência</button>
          </div>
          {!folhas.length
            ? <p className="tdg-empty">Nenhuma folha ainda. Abra uma competência para calcular.</p>
            : (
              <div className="tdg-table-wrap">
                <table className="tdg-table">
                  <thead><tr><th>Competência</th><th>Tipo</th><th>Status</th><th>Líquido</th><th>INSS</th><th>FGTS</th><th>Ações</th></tr></thead>
                  <tbody>
                    {folhas.map((r) => (
                      <tr key={r.id}>
                        <td>{r.competencia}</td>
                        <td>{r.tipo}</td>
                        <td>{comRotulo(NOME_RUN, r.status)}</td>
                        <td>{dinheiro(r.totalLiquido)}</td>
                        <td>{dinheiro(r.totalInss)}</td>
                        <td>{dinheiro(r.totalFgts)}</td>
                        <td className="tdg-fiscal-acoes">
                          {r.status !== "fechada"
                            ? <button type="button" onClick={() => fecharFolha(r)}>Fechar e calcular</button>
                            : <button type="button" onClick={() => reabrirFolha(r)}>Reabrir</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          <p className="tdg-fiscal-nota">
            O motor cobre INSS e IRRF progressivos, FGTS, férias, 13º, horas extras, DSR e adicional noturno pela tabela
            versionada de 2025. eSocial e FGTS ficam como geração de arquivo — a transmissão aguarda certificado, no mesmo
            espírito do fiscal. Não substitui a contabilidade.
          </p>
        </section>
      )}
    </div>
  );
}
