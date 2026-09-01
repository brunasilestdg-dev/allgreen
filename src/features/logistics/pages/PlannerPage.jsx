import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  LayoutGrid,
  ListChecks,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import {
  PLANNER_PRIORITIES,
  PLANNER_PROGRESS,
  agruparTarefas,
  minhasTarefas,
  normalizarBaldes,
  progressoNumerico,
  resumoDoCompartilhamento,
  resumoPlano,
  tarefaAtendeBusca,
} from "../plannerDomain.js";
import "./TodoGreenPages.css";

// Planner estilo Microsoft Planner: planos com baldes e tarefas, privados ou
// compartilhados com o espaço. O progresso da barra é sempre derivado (status +
// checklist) — a tela nunca digita um número solto. O servidor é a autoridade
// da visibilidade; aqui a tela só desenha o que ele entrega.

const request = async (path, authHeaders, options = {}) => {
  const resposta = await fetch(`/api/todogreen/planner${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(authHeaders?.() || {}), ...(options.headers || {}) },
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(corpo.error || "Não foi possível abrir o Planner.");
    erro.detalhes = corpo.erros || [];
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
};

const CORTES = [
  { id: "balde", label: "Balde", icon: LayoutGrid },
  { id: "progresso", label: "Progresso", icon: ListChecks },
  { id: "responsavel", label: "Responsável", icon: Users },
];

// Os três jeitos de compartilhar, na tela. O banco só conhece private/shared;
// "Pessoas específicas" é privado + a lista de membros (pedido da titular,
// 30/08). O mapeamento acontece no envio.
const MODOS_DE_PARTILHA = [
  { id: "privado", label: "Privado", ajuda: "Só você vê este plano." },
  { id: "pessoas", label: "Pessoas específicas", ajuda: "Você escolhe quem vê e trabalha nas tarefas." },
  { id: "espaco", label: "Todo o espaço", ajuda: "Todo o espaço de trabalho vê." },
];

const modoDoPlano = (plano) => {
  if (plano?.visibility === "shared") return "espaco";
  return (plano?.members || []).length > 0 ? "pessoas" : "privado";
};

const partilhaParaEnvio = (modo, members) => ({
  visibility: modo === "espaco" ? "shared" : "private",
  members: modo === "pessoas" ? members : [],
});

const COR_PRIORIDADE = {
  urgente: "#b42318",
  alta: "#c4700b",
  media: "#2c7a5b",
  baixa: "#5b6b78",
};
const LABEL_PRIORIDADE = Object.fromEntries(PLANNER_PRIORITIES.map((p) => [p.id, p.label]));
const LABEL_PROGRESSO = Object.fromEntries(PLANNER_PROGRESS.map((p) => [p.id, p.label]));

const hoje = () => new Date().toISOString().slice(0, 10);

const tarefaVazia = (bucketId = "") => ({
  title: "",
  notes: "",
  bucketId,
  assigneeUserId: "",
  assigneeLabel: "",
  priority: "media",
  progress: "nao_iniciada",
  startDate: "",
  dueDate: "",
  checklist: [],
  labels: [],
});

export default function PlannerPage({ authHeaders, setToast, currentUserId, role, espacoId = "" }) {
  const [planos, setPlanos] = useState([]);
  const [planoAtivoId, setPlanoAtivoId] = useState("");
  const [tarefas, setTarefas] = useState([]);
  // Pessoas da plataforma para sugerir como responsável: o dono do espaço e os
  // membros ativos, da mesma lista que o /api/collab já serve ao app inteiro.
  // Se a chamada falhar, o campo continua aceitando texto livre — sugestão é
  // conveniência, nunca condição.
  const [pessoas, setPessoas] = useState([]);
  const [corte, setCorte] = useState("balde");
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState("carregando");
  const [erro, setErro] = useState("");
  const [semAcesso, setSemAcesso] = useState(false);
  const [vendoMinhas, setVendoMinhas] = useState(false);
  const [minhas, setMinhas] = useState([]);
  const [modalPlano, setModalPlano] = useState(false);
  const [formPlano, setFormPlano] = useState({ name: "", modo: "privado", description: "", members: [] });
  const [partilhaEmEdicao, setPartilhaEmEdicao] = useState(null);
  const [tarefaEmEdicao, setTarefaEmEdicao] = useState(null);
  const [rascunhoRapido, setRascunhoRapido] = useState({});

  const avisar = (mensagem, tom = "info") => (setToast ? setToast({ mensagem, tom }) : undefined);

  const planoAtivo = useMemo(
    () => planos.find((p) => p.id === planoAtivoId) || null,
    [planos, planoAtivoId],
  );
  // Só o criador (ou a administração) mexe na estrutura do plano.
  const souDono = Boolean(
    planoAtivo && (["owner", "admin"].includes(role) || planoAtivo.ownerUserId === currentUserId),
  );

  const carregarPlanos = async (selecionar) => {
    setOcupado("carregando");
    setErro("");
    try {
      const { registros } = await request("/planos", authHeaders);
      setPlanos(registros || []);
      const proximo = selecionar || planoAtivoId || (registros?.[0]?.id ?? "");
      setPlanoAtivoId(registros?.some((p) => p.id === proximo) ? proximo : registros?.[0]?.id || "");
      setOcupado("");
    } catch (motivo) {
      if (motivo.status === 403) { setSemAcesso(true); setOcupado(""); return; }
      setErro(motivo.message);
      setOcupado("");
    }
  };

  const carregarTarefas = async (planId) => {
    if (!planId) { setTarefas([]); return; }
    try {
      const { registros } = await request(`/planos/${planId}/tarefas`, authHeaders);
      setTarefas(registros || []);
    } catch (motivo) {
      if (motivo.status === 404) { setTarefas([]); await carregarPlanos(); return; }
      avisar(motivo.message, "erro");
    }
  };

  const carregarMinhas = async () => {
    try {
      const { registros } = await request("/minhas-tarefas", authHeaders);
      setMinhas(registros || []);
    } catch (motivo) {
      avisar(motivo.message, "erro");
    }
  };

  useEffect(() => { carregarPlanos(); }, []);
  useEffect(() => { if (planoAtivoId) carregarTarefas(planoAtivoId); }, [planoAtivoId]);
  useEffect(() => { if (vendoMinhas) carregarMinhas(); }, [vendoMinhas]);
  useEffect(() => {
    if (!espacoId) return undefined;
    let ativo = true;
    fetch(`/api/collab?owner=${encodeURIComponent(espacoId)}`, { headers: authHeaders?.() || {} })
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo) => {
        if (!ativo || !corpo) return;
        const candidatos = [corpo.owner, ...(corpo.members || []).filter((m) => m.status === "ativo")];
        const unicos = [];
        for (const pessoa of candidatos) {
          if (pessoa?.id && pessoa?.name && !unicos.some((p) => p.id === pessoa.id)) unicos.push(pessoa);
        }
        setPessoas(unicos);
      })
      .catch(() => {});
    return () => { ativo = false; };
  }, [espacoId, authHeaders]);

  const criarPlano = async (evento) => {
    evento.preventDefault();
    if (!formPlano.name.trim()) { avisar("Dê um nome ao plano.", "erro"); return; }
    setOcupado("salvando");
    try {
      const corpo = {
        name: formPlano.name,
        description: formPlano.description,
        ...partilhaParaEnvio(formPlano.modo, formPlano.members),
      };
      const novo = await request("/planos", authHeaders, { method: "POST", body: JSON.stringify(corpo) });
      setModalPlano(false);
      setFormPlano({ name: "", modo: "privado", description: "", members: [] });
      await carregarPlanos(novo.id);
      avisar("Plano criado.", "sucesso");
    } catch (motivo) {
      avisar([motivo.message, ...(motivo.detalhes || [])].join(" · "), "erro");
      setOcupado("");
    }
  };

  // O compartilhamento de um plano existente muda por PATCH, com a revision
  // que a tela leu — edição simultânea recebe 409 e recarrega, nunca atropela.
  const salvarPartilha = async ({ modo, members }) => {
    if (!partilhaEmEdicao) return;
    try {
      await request(`/planos/${partilhaEmEdicao.id}`, authHeaders, {
        method: "PATCH",
        body: JSON.stringify({ revision: partilhaEmEdicao.revision, ...partilhaParaEnvio(modo, members) }),
      });
      setPartilhaEmEdicao(null);
      await carregarPlanos(partilhaEmEdicao.id);
      avisar("Compartilhamento atualizado.", "sucesso");
    } catch (motivo) {
      if (motivo.status === 409) { avisar("O plano mudou em outra tela. Recarreguei.", "erro"); setPartilhaEmEdicao(null); await carregarPlanos(); return; }
      avisar(motivo.message, "erro");
    }
  };

  const arquivarPlano = async () => {
    if (!planoAtivo || !souDono) return;
    if (typeof window !== "undefined" && !window.confirm(`Arquivar o plano "${planoAtivo.name}" e suas tarefas?`)) return;
    try {
      await request(`/planos/${planoAtivo.id}`, authHeaders, { method: "DELETE" });
      setPlanoAtivoId("");
      await carregarPlanos();
      avisar("Plano arquivado.", "sucesso");
    } catch (motivo) {
      avisar(motivo.message, "erro");
    }
  };

  const adicionarRapida = async (bucketId) => {
    const titulo = (rascunhoRapido[bucketId] || "").trim();
    if (!titulo || !planoAtivo) return;
    try {
      await request(`/planos/${planoAtivo.id}/tarefas`, authHeaders, {
        method: "POST",
        body: JSON.stringify({ title: titulo, bucketId }),
      });
      setRascunhoRapido((r) => ({ ...r, [bucketId]: "" }));
      await carregarTarefas(planoAtivo.id);
    } catch (motivo) {
      avisar([motivo.message, ...(motivo.detalhes || [])].join(" · "), "erro");
    }
  };

  const salvarTarefa = async (tarefa) => {
    if (!planoAtivo) return;
    const corpo = JSON.stringify(tarefa);
    try {
      if (tarefa.id) {
        await request(`/planos/${planoAtivo.id}/tarefas/${tarefa.id}`, authHeaders, { method: "PATCH", body: corpo });
      } else {
        await request(`/planos/${planoAtivo.id}/tarefas`, authHeaders, { method: "POST", body: corpo });
      }
      setTarefaEmEdicao(null);
      await carregarTarefas(planoAtivo.id);
      if (vendoMinhas) await carregarMinhas();
      avisar("Tarefa salva.", "sucesso");
    } catch (motivo) {
      if (motivo.status === 409) { avisar("A tarefa mudou em outra tela. Recarreguei.", "erro"); setTarefaEmEdicao(null); await carregarTarefas(planoAtivo.id); return; }
      avisar([motivo.message, ...(motivo.detalhes || [])].join(" · "), "erro");
    }
  };

  const arquivarTarefa = async (tarefa) => {
    if (!planoAtivo) return;
    try {
      await request(`/planos/${planoAtivo.id}/tarefas/${tarefa.id}`, authHeaders, { method: "DELETE" });
      setTarefaEmEdicao(null);
      await carregarTarefas(planoAtivo.id);
      avisar("Tarefa arquivada.", "sucesso");
    } catch (motivo) {
      avisar(motivo.message, "erro");
    }
  };

  // Mudança rápida de status a partir do cartão, sem abrir o modal.
  const mudarProgresso = async (tarefa, progress) => {
    await salvarTarefa({ ...tarefa, progress });
  };

  const tarefasFiltradas = useMemo(
    () => tarefas.filter((t) => tarefaAtendeBusca(t, busca)),
    [tarefas, busca],
  );
  const colunas = useMemo(
    () => agruparTarefas(tarefasFiltradas, corte, { baldes: planoAtivo?.buckets || [] }),
    [tarefasFiltradas, corte, planoAtivo],
  );
  const resumo = useMemo(() => resumoPlano(tarefas), [tarefas]);
  const minhasFiltradas = useMemo(
    () => minhasTarefas(minhas, currentUserId, { incluirConcluidas: true }),
    [minhas, currentUserId],
  );

  if (semAcesso) {
    return (
      <section className="tdg-page">
        <div className="tdg-page-title"><div><span>Planner</span><h2>Planner</h2></div></div>
        <div className="tdg-panel tdg-empty">
          <Lock size={22} />
          <p>Você não tem permissão para gerir o Planner. Fale com quem administra o espaço.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="tdg-page tdg-planner">
      <div className="tdg-page-title">
        <div>
          <span>Produtividade</span>
          <h2>Planner</h2>
          <p>Planos com tarefas, prazo, prioridade e checklist.</p>
        </div>
        <div className="tdg-page-actions">
          <button type="button" className="tdg-planner-toggle" data-ativo={vendoMinhas} onClick={() => setVendoMinhas((v) => !v)}>
            <ListChecks size={15} /> Minhas tarefas
          </button>
          <button type="button" className="tdg-action" onClick={() => setModalPlano(true)}>
            <Plus size={16} /> Novo plano
          </button>
        </div>
      </div>

      {erro && <div className="tdg-page-error">{erro}</div>}

      {vendoMinhas ? (
        <div className="tdg-panel">
          <div className="tdg-section-head">
            <h3><ListChecks size={16} /> Minhas tarefas</h3>
            <button type="button" className="tdg-planner-icon" onClick={carregarMinhas} title="Atualizar"><RefreshCw size={15} /></button>
          </div>
          {minhasFiltradas.length === 0 ? (
            <div className="tdg-empty"><p>Nenhuma tarefa atribuída a você nos planos que alcança.</p></div>
          ) : (
            <ul className="tdg-planner-mytasks">
              {minhasFiltradas.map((t) => {
                const plano = planos.find((p) => p.id === t.planId);
                return (
                  <li key={t.id}>
                    <button type="button" onClick={() => { if (plano) { setVendoMinhas(false); setPlanoAtivoId(t.planId); setTimeout(() => setTarefaEmEdicao(t), 0); } }}>
                      <span className="tdg-planner-prio" style={{ background: COR_PRIORIDADE[t.priority] }} />
                      <strong>{t.title}</strong>
                      <em>{plano?.name || "—"}</em>
                      {t.dueDate && <span className="tdg-planner-due"><CalendarClock size={13} /> {t.dueDate}</span>}
                      <span className="tdg-planner-status" data-status={t.progress}>{LABEL_PROGRESSO[t.progress]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="tdg-planner-bar">
            <div className="tdg-planner-plans">
              {ocupado === "carregando" && planos.length === 0 ? (
                <span className="tdg-planner-loading">Carregando planos…</span>
              ) : planos.length === 0 ? (
                <span className="tdg-planner-loading">Nenhum plano ainda. Crie o primeiro.</span>
              ) : (
                planos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="tdg-planner-plan"
                    data-ativo={p.id === planoAtivoId}
                    onClick={() => setPlanoAtivoId(p.id)}
                    title={resumoDoCompartilhamento(p)}
                  >
                    <span className="tdg-planner-dot" style={{ background: p.color }} />
                    {p.name}
                    {p.visibility === "shared" || (p.members || []).length > 0 ? <Users size={12} /> : <Lock size={12} />}
                  </button>
                ))
              )}
            </div>
          </div>

          {planoAtivo && (
            <>
              <div className="tdg-planner-head">
                <div className="tdg-metrics tdg-planner-metrics">
                  <div className="tdg-metric"><strong>{resumo.total}</strong><span>Tarefas</span></div>
                  <div className="tdg-metric"><strong>{resumo.concluidas}</strong><span>Concluídas</span></div>
                  <div className="tdg-metric"><strong>{resumo.emAndamento}</strong><span>Em andamento</span></div>
                  <div className="tdg-metric"><strong>{resumo.atrasadas(hoje())}</strong><span>Atrasadas</span></div>
                  <div className="tdg-metric"><strong>{resumo.progressoMedio}%</strong><span>Progresso</span></div>
                </div>
                <div className="tdg-planner-controls">
                  <input
                    type="search"
                    placeholder="Buscar tarefa…"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="tdg-planner-search"
                  />
                  <div className="tdg-planner-cortes">
                    {CORTES.map((c) => {
                      const Icone = c.icon;
                      return (
                        <button key={c.id} type="button" data-ativo={corte === c.id} onClick={() => setCorte(c.id)} title={`Agrupar por ${c.label.toLowerCase()}`}>
                          <Icone size={14} /> {c.label}
                        </button>
                      );
                    })}
                  </div>
                  {souDono && (
                    <button type="button" className="tdg-planner-icon" onClick={() => setPartilhaEmEdicao(planoAtivo)} title="Compartilhar plano">
                      <Users size={15} />
                    </button>
                  )}
                  {souDono && (
                    <button type="button" className="tdg-planner-icon tdg-planner-danger" onClick={arquivarPlano} title="Arquivar plano">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>

              <div className="tdg-planner-board">
                {colunas.map((coluna) => (
                  <div className="tdg-planner-col" key={coluna.chave}>
                    <header>
                      <strong>{coluna.titulo}</strong>
                      <span>{coluna.tarefas.length}</span>
                    </header>
                    <div className="tdg-planner-col-body">
                      {coluna.tarefas.map((t) => (
                        <article className="tdg-planner-card" key={t.id} onClick={() => setTarefaEmEdicao(t)}>
                          <span className="tdg-planner-prio-bar" style={{ background: COR_PRIORIDADE[t.priority] }} />
                          <div className="tdg-planner-card-top">
                            <button
                              type="button"
                              className="tdg-planner-check"
                              data-feito={t.progress === "concluida"}
                              title={t.progress === "concluida" ? "Reabrir" : "Concluir"}
                              onClick={(e) => { e.stopPropagation(); mudarProgresso(t, t.progress === "concluida" ? "em_andamento" : "concluida"); }}
                            >
                              <Check size={13} />
                            </button>
                            <p>{t.title}</p>
                          </div>
                          <div className="tdg-planner-bararea">
                            <span className="tdg-planner-bar-track"><span style={{ width: `${progressoNumerico(t)}%` }} /></span>
                          </div>
                          <div className="tdg-planner-card-meta">
                            <span className="tdg-planner-tag" style={{ color: COR_PRIORIDADE[t.priority] }}>{LABEL_PRIORIDADE[t.priority]}</span>
                            {t.dueDate && <span className={`tdg-planner-tag${t.dueDate < hoje() && t.progress !== "concluida" ? " atrasada" : ""}`}><CalendarClock size={12} /> {t.dueDate}</span>}
                            {Array.isArray(t.checklist) && t.checklist.length > 0 && (
                              <span className="tdg-planner-tag"><ListChecks size={12} /> {t.checklist.filter((i) => i.feito).length}/{t.checklist.length}</span>
                            )}
                            {t.assigneeLabel && <span className="tdg-planner-assignee">{t.assigneeLabel}</span>}
                          </div>
                        </article>
                      ))}
                      {corte === "balde" && coluna.chave !== "__sem__" && (
                        <div className="tdg-planner-quick">
                          <input
                            type="text"
                            placeholder="+ Adicionar tarefa"
                            value={rascunhoRapido[coluna.chave] || ""}
                            onChange={(e) => setRascunhoRapido((r) => ({ ...r, [coluna.chave]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") adicionarRapida(coluna.chave); }}
                          />
                        </div>
                      )}
                      {coluna.tarefas.length === 0 && corte !== "balde" && (
                        <p className="tdg-planner-col-empty">Sem tarefas.</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {!planoAtivo && planos.length === 0 && ocupado !== "carregando" && (
            <div className="tdg-panel tdg-empty">
              <LayoutGrid size={22} />
              <p>Crie um plano para começar. Ele pode ser privado (só você) ou compartilhado com o espaço.</p>
              <button type="button" className="tdg-action" onClick={() => setModalPlano(true)}><Plus size={16} /> Novo plano</button>
            </div>
          )}
        </>
      )}

      {modalPlano && (
        <Modal title="Novo plano" onClose={() => setModalPlano(false)}>
          <form className="tdg-planner-form" onSubmit={criarPlano}>
            <label>
              Nome do plano
              <input autoFocus value={formPlano.name} onChange={(e) => setFormPlano((f) => ({ ...f, name: e.target.value }))} maxLength={120} />
            </label>
            <label>
              Descrição
              <textarea rows={2} value={formPlano.description} onChange={(e) => setFormPlano((f) => ({ ...f, description: e.target.value }))} maxLength={2000} />
            </label>
            <PartilhaCampos
              modo={formPlano.modo}
              members={formPlano.members}
              pessoas={pessoas}
              currentUserId={currentUserId}
              onChange={(patch) => setFormPlano((f) => ({ ...f, ...patch }))}
            />
            <div className="tdg-form-actions">
              <button type="button" onClick={() => setModalPlano(false)}>Cancelar</button>
              <button type="submit" className="tdg-action" disabled={ocupado === "salvando"}>Criar plano</button>
            </div>
          </form>
        </Modal>
      )}

      {tarefaEmEdicao && (
        <TarefaModal
          tarefa={tarefaEmEdicao}
          baldes={normalizarBaldes(planoAtivo?.buckets || [])}
          pessoas={pessoas}
          onFechar={() => setTarefaEmEdicao(null)}
          onSalvar={salvarTarefa}
          onArquivar={arquivarTarefa}
        />
      )}

      {partilhaEmEdicao && (
        <PartilhaModal
          plano={partilhaEmEdicao}
          pessoas={pessoas}
          currentUserId={currentUserId}
          onFechar={() => setPartilhaEmEdicao(null)}
          onSalvar={salvarPartilha}
        />
      )}
    </section>
  );
}

function TarefaModal({ tarefa, baldes, pessoas = [], onFechar, onSalvar, onArquivar }) {
  const [form, setForm] = useState({ ...tarefaVazia(baldes[0]?.id), ...tarefa });
  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  // Escolher uma pessoa da lista grava o vínculo de verdade (assigneeUserId) —
  // é ele que faz a tarefa aparecer em "Minhas tarefas" de quem foi atribuído.
  // Texto que não bate com ninguém vale como rótulo solto (gente de fora).
  const definirResponsavel = (valor) => {
    const pessoa = pessoas.find((p) => p.name === valor);
    setForm((f) => ({ ...f, assigneeLabel: valor, assigneeUserId: pessoa?.id || "" }));
  };

  const alterarItem = (i, patch) =>
    setForm((f) => ({ ...f, checklist: f.checklist.map((item, idx) => (idx === i ? { ...item, ...patch } : item)) }));
  const adicionarItem = () => setForm((f) => ({ ...f, checklist: [...(f.checklist || []), { texto: "", feito: false }] }));
  const removerItem = (i) => setForm((f) => ({ ...f, checklist: f.checklist.filter((_, idx) => idx !== i) }));

  const submeter = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSalvar({ ...form, checklist: (form.checklist || []).filter((i) => (i.texto || "").trim()) });
  };

  return (
    <Modal title={tarefa.id ? "Tarefa" : "Nova tarefa"} onClose={onFechar} wide>
      <form className="tdg-planner-form tdg-planner-taskform" onSubmit={submeter}>
        <label>
          Título
          <input autoFocus value={form.title} onChange={set("title")} maxLength={200} />
        </label>
        <div className="tdg-planner-grid3">
          <label>
            Balde
            <select value={form.bucketId} onChange={set("bucketId")}>
              {baldes.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          </label>
          <label>
            Prioridade
            <select value={form.priority} onChange={set("priority")}>
              {PLANNER_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label>
            Progresso
            <select value={form.progress} onChange={set("progress")}>
              {PLANNER_PROGRESS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
        </div>
        <div className="tdg-planner-grid3">
          <label>
            Responsável
            <input
              list="tdg-planner-pessoas"
              value={form.assigneeLabel}
              onChange={(e) => definirResponsavel(e.target.value)}
              placeholder="Nome de quem executa"
              maxLength={160}
            />
            <datalist id="tdg-planner-pessoas">
              {pessoas.map((p) => <option value={p.name} key={p.id}>{p.email}</option>)}
            </datalist>
            {form.assigneeUserId
              ? <small className="tdg-planner-vinculo">Pessoa da plataforma — entra em “Minhas tarefas” dela.</small>
              : null}
          </label>
          <label>
            Início
            <input type="date" value={form.startDate || ""} onChange={set("startDate")} />
          </label>
          <label>
            Prazo
            <input type="date" value={form.dueDate || ""} onChange={set("dueDate")} />
          </label>
        </div>
        <label>
          Notas
          <textarea rows={3} value={form.notes} onChange={set("notes")} maxLength={4000} />
        </label>

        <div className="tdg-planner-checklist">
          <div className="tdg-section-head">
            <h3><ListChecks size={15} /> Checklist</h3>
            <button type="button" className="tdg-planner-icon" onClick={adicionarItem}><Plus size={14} /></button>
          </div>
          {(form.checklist || []).map((item, i) => (
            <div className="tdg-planner-checkrow" key={i}>
              <input type="checkbox" checked={Boolean(item.feito)} onChange={(e) => alterarItem(i, { feito: e.target.checked })} />
              <input type="text" value={item.texto || ""} onChange={(e) => alterarItem(i, { texto: e.target.value })} placeholder="Item do checklist" maxLength={300} />
              <button type="button" className="tdg-planner-icon" onClick={() => removerItem(i)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div className="tdg-form-actions tdg-planner-taskactions">
          {tarefa.id && (
            <button type="button" className="tdg-planner-danger" onClick={() => onArquivar(tarefa)}>
              <Trash2 size={15} /> Arquivar
            </button>
          )}
          <span className="tdg-planner-spacer" />
          <button type="button" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="tdg-action">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}

// Os campos de compartilhamento, usados no plano novo e no modal de
// compartilhar um plano existente — uma tela só para a mesma decisão.
// Escolher um nome da lista adiciona a pessoa na hora; o servidor revalida
// cada id contra o espaço antes de gravar.
function PartilhaCampos({ modo, members, pessoas, currentUserId, onChange }) {
  const [busca, setBusca] = useState("");
  const adicionar = (valor) => {
    setBusca(valor);
    const pessoa = pessoas.find((p) => p.name === valor);
    if (!pessoa || members.includes(pessoa.id)) return;
    onChange({ members: [...members, pessoa.id] });
    setBusca("");
  };
  return (
    <fieldset className="tdg-planner-visibility">
      <legend>Compartilhamento</legend>
      {MODOS_DE_PARTILHA.map((m) => (
        <label
          key={m.id}
          className="tdg-planner-radio"
          data-ativo={modo === m.id}
          htmlFor={`tdg-planner-partilha-${m.id}`}
          aria-label={`${m.label}. ${m.ajuda}`}
        >
          <input
            id={`tdg-planner-partilha-${m.id}`}
            type="radio"
            name="partilha"
            checked={modo === m.id}
            onChange={() => onChange({ modo: m.id })}
          />
          <span className="tdg-planner-radio-copy" aria-hidden="true">
            <span>{m.id === "privado" ? <Lock size={14} /> : <Users size={14} />} <strong>{m.label}</strong></span>
            <small>{m.ajuda}</small>
          </span>
        </label>
      ))}
      {modo === "pessoas" && (
        <div className="tdg-planner-membros">
          <label>
            Quem participa
            <input
              list="tdg-planner-pessoas-plano"
              value={busca}
              onChange={(e) => adicionar(e.target.value)}
              placeholder="Digite o nome para adicionar"
              aria-label="Adicionar pessoa ao plano"
            />
            <datalist id="tdg-planner-pessoas-plano">
              {pessoas
                .filter((p) => !members.includes(p.id) && p.id !== currentUserId)
                .map((p) => <option value={p.name} key={p.id}>{p.email}</option>)}
            </datalist>
          </label>
          <div className="tdg-planner-chips">
            {members.map((id) => {
              const pessoa = pessoas.find((p) => p.id === id);
              return (
                <span className="tdg-planner-chip" key={id}>
                  {pessoa?.name || id}
                  <button
                    type="button"
                    aria-label={`Remover ${pessoa?.name || id}`}
                    onClick={() => onChange({ members: members.filter((m) => m !== id) })}
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })}
            {members.length === 0 && <small>Ninguém escolhido ainda — até adicionar alguém, o plano fica só com você.</small>}
          </div>
        </div>
      )}
    </fieldset>
  );
}

function PartilhaModal({ plano, pessoas, currentUserId, onFechar, onSalvar }) {
  const [modo, setModo] = useState(() => modoDoPlano(plano));
  const [members, setMembers] = useState(() => plano.members || []);
  return (
    <Modal title={`Compartilhar · ${plano.name}`} onClose={onFechar}>
      <form
        className="tdg-planner-form"
        onSubmit={(e) => { e.preventDefault(); onSalvar({ modo, members }); }}
      >
        <PartilhaCampos
          modo={modo}
          members={members}
          pessoas={pessoas}
          currentUserId={currentUserId}
          onChange={(patch) => {
            if (patch.modo !== undefined) setModo(patch.modo);
            if (patch.members !== undefined) setMembers(patch.members);
          }}
        />
        <p className="tdg-planner-partilha-resumo">
          {resumoDoCompartilhamento({ ...plano, ...partilhaParaEnvio(modo, members) })}
        </p>
        <div className="tdg-form-actions">
          <button type="button" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="tdg-action">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}
