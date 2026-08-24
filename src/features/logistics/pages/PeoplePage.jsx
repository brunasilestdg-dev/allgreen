import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Lock, RefreshCw, UserPlus, Users } from "lucide-react";
import "./TodoGreenPages.css";

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
      avisar(`Folha fechada: ${r.colaboradores} colaboradores, líquido ${dinheiro(r.totalLiquido)}.`, "sucesso");
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
          <p>Cadastro de colaboradores, ponto, férias e fechamento de folha. CPF e salário são dados sensíveis — só o RH vê.</p>
        </div>
        <div className="tdg-page-actions">
          <button className="tdg-action" type="button" onClick={carregar}><RefreshCw size={16} />Atualizar</button>
          <button className="tdg-action" type="button" onClick={() => setMostrarForm((v) => !v)}><UserPlus size={16} />{mostrarForm ? "Fechar" : "Novo colaborador"}</button>
        </div>
      </header>

      {erro && <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{erro}</span></div>}

      <section className="tdg-metrics">
        <article className="tdg-metric"><span>Colaboradores ativos</span><strong>{resumo?.colaboradoresAtivos || 0}</strong><small><Users size={13} /> na folha</small></article>
        <article className="tdg-metric"><span>Folha base (salários)</span><strong>{dinheiro(resumo?.folhaBase)}</strong><small>soma dos salários base</small></article>
        <article className="tdg-metric"><span>Último fechamento</span><strong>{resumo?.ultimoFechamento?.competencia || "—"}</strong><small>{resumo?.ultimoFechamento ? dinheiro(resumo.ultimoFechamento.totalLiquido) : "nenhum ainda"}</small></article>
        <article className="tdg-metric"><span>eSocial</span><strong>{resumo?.transmissaoEsocialHabilitada ? "Pronto" : "Pendente"}</strong><small>{resumo?.transmissaoEsocialHabilitada ? "certificado no cofre" : "aguarda certificado"}</small></article>
      </section>

      {mostrarForm && (
        <form className="tdg-panel tdg-form" onSubmit={criarColaborador}>
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
      )}

      <div className="tdg-workviews-switch" role="tablist" aria-label="Seções">
        <button type="button" role="tab" aria-selected={aba === "pessoas"} className={aba === "pessoas" ? "active" : ""} onClick={() => setAba("pessoas")}><Users size={15} />Colaboradores</button>
        <button type="button" role="tab" aria-selected={aba === "folha"} className={aba === "folha" ? "active" : ""} onClick={() => setAba("folha")}><CalendarClock size={15} />Folha</button>
      </div>

      {aba === "pessoas" && (
        <section className="tdg-panel">
          {!colaboradores.length
            ? <p className="tdg-empty">Nenhum colaborador ainda. Cadastre o primeiro.</p>
            : (
              <div className="tdg-table-wrap">
                <table className="tdg-table">
                  <thead><tr><th>Nome</th><th>CPF</th><th>Cargo</th><th>Vínculo</th><th>Salário base</th><th>Status</th></tr></thead>
                  <tbody>
                    {colaboradores.map((c) => (
                      <tr key={c.id}>
                        <td>{c.nome}</td>
                        <td>{c.cpf || "—"}</td>
                        <td>{c.cargo || "—"}</td>
                        <td>{c.vinculo?.toUpperCase()}</td>
                        <td>{dinheiro(c.salarioBase)}</td>
                        <td>{NOME_STATUS[c.status] || c.status}</td>
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
                        <td>{NOME_RUN[r.status] || r.status}</td>
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
