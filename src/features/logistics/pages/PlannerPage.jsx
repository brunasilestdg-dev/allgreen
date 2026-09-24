import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Filter,
  GanttChart,
  KanbanSquare,
  LayoutGrid,
  ListChecks,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import { RadioCards } from "../../../design-system/index.js";
import {
  FILTROS_VAZIOS,
  PLANNER_PRIORITIES,
  PLANNER_PROGRESS,
  adicionarBalde,
  agruparTarefas,
  dataCurta,
  filtrarTarefas,
  filtrosAtivos,
  minhasTarefas,
  moverBalde,
  normalizarBaldes,
  removerBalde,
  renomearBalde,
  resumoDoCompartilhamento,
  rotulosDoPlano,
} from "../plannerDomain.js";
import {
  tarefaCanonicaPertenceAoPlano,
  tarefaTodoParaPlanner,
} from "../plannerIntegrationDomain.js";
import PlannerBoard from "./planner/PlannerBoard.jsx";
import PlannerCharts from "./planner/PlannerCharts.jsx";
import PlannerSidebar from "./planner/PlannerSidebar.jsx";
import PlannerTable from "./planner/PlannerTable.jsx";
import PlannerTaskModal from "./planner/PlannerTaskModal.jsx";
import PlannerTimeline from "./planner/PlannerTimeline.jsx";
import {
  Avatar,
  CORES_PLANO,
  IconePrioridade,
  LABEL_PROGRESSO,
  MODOS_DE_PARTILHA,
  PlanoIcone,
  Rotulo,
  gerarIdDeTarefa,
  hoje,
  modoDoPlano,
  partilhaParaEnvio,
  rotuloPartilha,
  tarefaVazia,
} from "./planner/plannerUi.jsx";
import "./TodoGreenPages.css";
import "./planner/planner.css";

// Planner no formato do Microsoft Planner: rail de planos à esquerda, trilha
// "Meus planos › Plano" no topo, abas Quadro / Tabela / Linha do tempo /
// Gráficos, barra de filtros e "Agrupar por". O quadro tem baldes editáveis,
// arrastar-e-soltar, "+ Adicionar tarefa" no topo de cada coluna e as
// concluídas dobradas. As tarefas continuam sendo a task canônica
// (`db.tasks`) — o servidor só guarda planos, baldes, membros e visibilidade.

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

const VISTAS = [
  { id: "quadro", label: "Quadro", icon: KanbanSquare },
  { id: "tabela", label: "Tabela", icon: Table2 },
  { id: "linha", label: "Linha do tempo", icon: GanttChart },
  { id: "graficos", label: "Gráficos", icon: BarChart3 },
];

const CORTES = [
  { id: "balde", label: "Balde" },
  { id: "progresso", label: "Progresso" },
  { id: "responsavel", label: "Responsável" },
];

const TODOS_STATUS = PLANNER_PROGRESS.map((p) => p.id);

// Preferências por navegador (vista, filtros, rail). Nunca travam a tela: sem
// storage, vale o padrão.
const ler = (chave, padrao) => {
  try {
    const bruto = window.localStorage.getItem(chave);
    return bruto == null ? padrao : JSON.parse(bruto);
  } catch { return padrao; }
};
const gravar = (chave, valor) => {
  try { window.localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* ok */ }
};

const filtrosIniciais = () => {
  const salvo = ler("todogreen-planner-filtros", null);
  if (salvo && typeof salvo === "object") return { ...FILTROS_VAZIOS, ...salvo, busca: "" };
  // Migração do filtro antigo, que guardava só os status marcados.
  const antigos = ler("todogreen-planner-status", null);
  if (Array.isArray(antigos)) {
    const ids = antigos.filter((id) => TODOS_STATUS.includes(id));
    return { ...FILTROS_VAZIOS, status: ids.length && ids.length < TODOS_STATUS.length ? ids : [] };
  }
  return { ...FILTROS_VAZIOS };
};

export default function PlannerPage({
  authHeaders,
  setToast,
  currentUserId,
  role,
  espacoId = "",
  clientes = [],
  oportunidades = [],
  onNavigate,
  canonicalTasks = [],
  onUpsertCanonicalTask,
  onDeleteCanonicalTask,
  onDetachCanonicalPlanTasks,
}) {
  const [planos, setPlanos] = useState([]);
  const [planoAtivoId, setPlanoAtivoId] = useState("");
  const [pessoas, setPessoas] = useState([]);
  const [vista, setVista] = useState(() => {
    const v = ler("todogreen-planner-vista", "quadro");
    return VISTAS.some((x) => x.id === v) ? v : "quadro";
  });
  const [corte, setCorte] = useState("balde");
  const [filtros, setFiltros] = useState(filtrosIniciais);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [railAberto, setRailAberto] = useState(() => ler("todogreen-planner-rail", true) !== false);
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [menuPlano, setMenuPlano] = useState(false);
  const [ocupado, setOcupado] = useState("carregando");
  const [erro, setErro] = useState("");
  const [semAcesso, setSemAcesso] = useState(false);
  const [vendoMinhas, setVendoMinhas] = useState(false);
  const [modalPlano, setModalPlano] = useState(null);
  const [partilhaEmEdicao, setPartilhaEmEdicao] = useState(null);
  const [tarefaEmEdicao, setTarefaEmEdicao] = useState(null);

  const avisar = (mensagem, tom = "info") => (setToast ? setToast({ mensagem, tom }) : undefined);
  const hojeRef = hoje();

  const escolherVista = (v) => { setVista(v); gravar("todogreen-planner-vista", v); };
  const alternarRail = () => setRailAberto((a) => { gravar("todogreen-planner-rail", !a); return !a; });
  const atualizarFiltros = (patch) => setFiltros((f) => {
    const proximo = { ...f, ...patch };
    const { busca: _busca, ...persistente } = proximo;
    gravar("todogreen-planner-filtros", persistente);
    return proximo;
  });
  const limparFiltros = () => atualizarFiltros({ ...FILTROS_VAZIOS, busca: filtros.busca });

  // Menus flutuantes fecham ao clicar fora.
  useEffect(() => {
    if (!filtrosAbertos && !seletorAberto && !menuPlano) return undefined;
    const fechar = (e) => {
      if (!e.target.closest?.(".plr-menu-ancora")) { setFiltrosAbertos(false); setSeletorAberto(false); setMenuPlano(false); }
    };
    const esc = (e) => { if (e.key === "Escape") { setFiltrosAbertos(false); setSeletorAberto(false); setMenuPlano(false); } };
    document.addEventListener("mousedown", fechar);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fechar); document.removeEventListener("keydown", esc); };
  }, [filtrosAbertos, seletorAberto, menuPlano]);

  const planoAtivo = useMemo(
    () => planos.find((p) => p.id === planoAtivoId) || null,
    [planos, planoAtivoId],
  );
  const baldes = useMemo(() => normalizarBaldes(planoAtivo?.buckets || []), [planoAtivo]);
  const tarefas = useMemo(
    () => canonicalTasks
      .filter((task) => tarefaCanonicaPertenceAoPlano(task, planoAtivoId))
      .map((task) => tarefaTodoParaPlanner(task)),
    [canonicalTasks, planoAtivoId],
  );
  const minhas = useMemo(() => {
    const planosVisiveis = new Set(planos.map((plano) => plano.id));
    return canonicalTasks
      .filter((task) =>
        task?.plannerPlanId &&
        planosVisiveis.has(task.plannerPlanId) &&
        task?.archived !== true &&
        task?.deleted !== true
      )
      .map((task) => tarefaTodoParaPlanner(task));
  }, [canonicalTasks, planos]);
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

  useEffect(() => { carregarPlanos(); }, []);
  useEffect(() => {
    let ativo = true;
    // Duas portas de "gente do espaço", exatamente as que o servidor aceita
    // como responsável/membro: colaboradores do app (memberships, via
    // /api/collab) E vínculos diretos da vertical (tenant_users, via
    // /planner/pessoas). Unimos as duas por id, sem duplicar.
    const juntar = (listas) => {
      const unicos = [];
      const vistos = new Set();
      for (const pessoa of listas.flat()) {
        if (pessoa?.id && pessoa?.name && !vistos.has(pessoa.id)) {
          vistos.add(pessoa.id);
          unicos.push({ id: pessoa.id, name: pessoa.name, email: pessoa.email || "" });
        }
      }
      return unicos;
    };
    const daVertical = request("/pessoas", authHeaders)
      .then((corpo) => corpo?.registros || [])
      .catch(() => []);
    const doCollab = espacoId
      ? fetch(`/api/collab?owner=${encodeURIComponent(espacoId)}`, { headers: authHeaders?.() || {} })
        .then((resposta) => (resposta.ok ? resposta.json() : null))
        .then((corpo) => (corpo ? [corpo.owner, ...(corpo.members || []).filter((m) => m.status === "ativo")] : []))
        .catch(() => [])
      : Promise.resolve([]);
    Promise.all([daVertical, doCollab]).then(([vertical, collab]) => {
      if (!ativo) return;
      setPessoas(juntar([vertical, collab]));
    });
    return () => { ativo = false; };
  }, [espacoId, authHeaders]);

  // ----- Planos -----
  const salvarPlano = async (form) => {
    if (!form.name.trim()) { avisar("Dê um nome ao plano.", "erro"); return; }
    setOcupado("salvando");
    try {
      if (modalPlano?.modo === "editar" && modalPlano.plano) {
        await request(`/planos/${modalPlano.plano.id}`, authHeaders, {
          method: "PATCH",
          body: JSON.stringify({ revision: modalPlano.plano.revision, name: form.name, description: form.description, color: form.color }),
        });
        setModalPlano(null);
        await carregarPlanos(modalPlano.plano.id);
        avisar("Plano atualizado.", "sucesso");
      } else {
        const corpo = {
          name: form.name,
          description: form.description,
          color: form.color,
          ...partilhaParaEnvio(form.modo, form.members),
        };
        const novo = await request("/planos", authHeaders, { method: "POST", body: JSON.stringify(corpo) });
        setModalPlano(null);
        setVendoMinhas(false);
        await carregarPlanos(novo.id);
        avisar("Plano criado.", "sucesso");
      }
    } catch (motivo) {
      if (motivo.status === 409) { avisar("O plano mudou em outra tela. Recarreguei.", "erro"); setModalPlano(null); await carregarPlanos(); return; }
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
    if (typeof window !== "undefined" && !window.confirm(`Arquivar o plano "${planoAtivo.name}"? As tarefas continuarão disponíveis no To Do.`)) return;
    try {
      await request(`/planos/${planoAtivo.id}`, authHeaders, { method: "DELETE" });
      onDetachCanonicalPlanTasks?.(planoAtivo.id);
      setPlanoAtivoId("");
      await carregarPlanos();
      avisar("Plano arquivado.", "sucesso");
    } catch (motivo) {
      avisar(motivo.message, "erro");
    }
  };

  // ----- Baldes (estrutura do plano, PATCH com revision) -----
  const salvarBaldes = async (novos) => {
    if (!planoAtivo || !souDono) return false;
    try {
      const atualizado = await request(`/planos/${planoAtivo.id}`, authHeaders, {
        method: "PATCH",
        body: JSON.stringify({ revision: planoAtivo.revision, buckets: novos }),
      });
      setPlanos((lista) => lista.map((p) => (p.id === atualizado.id ? atualizado : p)));
      return true;
    } catch (motivo) {
      if (motivo.status === 409) { avisar("O plano mudou em outra tela. Recarreguei.", "erro"); await carregarPlanos(); return false; }
      avisar(motivo.message, "erro");
      return false;
    }
  };
  const aoAdicionarBalde = (nome) => salvarBaldes(adicionarBalde(baldes, nome));
  const aoRenomearBalde = (id, nome) => salvarBaldes(renomearBalde(baldes, id, nome));
  const aoMoverBalde = (id, direcao) => salvarBaldes(moverBalde(baldes, id, direcao));
  const aoRemoverBalde = async (coluna) => {
    const restantes = removerBalde(baldes, coluna.chave);
    if (restantes.length === baldes.length) return;
    const orfas = tarefas.filter((t) => t.bucketId === coluna.chave);
    const destino = restantes[0];
    const pergunta = orfas.length
      ? `Excluir o balde "${coluna.titulo}"? As ${orfas.length} tarefa(s) dele passam para "${destino.nome}".`
      : `Excluir o balde "${coluna.titulo}"?`;
    if (typeof window !== "undefined" && !window.confirm(pergunta)) return;
    const ok = await salvarBaldes(restantes);
    if (!ok) return;
    for (const t of orfas) gravarTarefa({ ...t, bucketId: destino.id });
    avisar("Balde excluído.", "sucesso");
  };

  // ----- Tarefas (task canônica) -----
  const gravarTarefa = (tarefa) => {
    if (!planoAtivo) return;
    const id = tarefa.rawTaskId || tarefa.id || gerarIdDeTarefa();
    onUpsertCanonicalTask?.({ ...tarefa, id, rawTaskId: id, canonicalTaskId: tarefa.canonicalTaskId || id, planId: planoAtivo.id }, planoAtivo);
  };

  const adicionarRapida = (bucketId, titulo) => {
    if (!titulo || !planoAtivo) return;
    const id = gerarIdDeTarefa();
    onUpsertCanonicalTask?.({ ...tarefaVazia(bucketId), id, rawTaskId: id, canonicalTaskId: id, title: titulo, planId: planoAtivo.id }, planoAtivo);
  };

  const salvarTarefa = (tarefa) => {
    gravarTarefa(tarefa);
    setTarefaEmEdicao(null);
    avisar("Tarefa salva.", "sucesso");
  };

  const arquivarTarefa = (tarefa) => {
    if (!planoAtivo) return;
    onDeleteCanonicalTask?.(tarefa.rawTaskId || tarefa.id);
    setTarefaEmEdicao(null);
    avisar("Tarefa arquivada.", "sucesso");
  };

  const mudarProgresso = (tarefa, progress) => gravarTarefa({ ...tarefa, progress });
  const alternarConcluida = (tarefa) => mudarProgresso(tarefa, tarefa.progress === "concluida" ? "em_andamento" : "concluida");

  // Soltar um cartão em outra coluna: o que muda depende do corte ativo.
  const moverTarefa = (tarefaId, coluna) => {
    const tarefa = tarefas.find((t) => t.id === tarefaId);
    if (!tarefa) return;
    if (corte === "balde") {
      if (coluna.chave === "__sem__" || tarefa.bucketId === coluna.chave) return;
      gravarTarefa({ ...tarefa, bucketId: coluna.chave });
    } else if (corte === "progresso") {
      if (tarefa.progress === coluna.chave) return;
      gravarTarefa({ ...tarefa, progress: coluna.chave });
    } else if (corte === "responsavel") {
      if (coluna.chave === "__sem__") {
        if (!tarefa.assigneeUserId && !tarefa.assigneeLabel) return;
        gravarTarefa({ ...tarefa, assigneeUserId: "", assigneeLabel: "" });
      } else {
        if (tarefa.assigneeUserId === coluna.chave) return;
        gravarTarefa({ ...tarefa, assigneeUserId: coluna.chave, assigneeLabel: coluna.titulo });
      }
    }
  };

  // ----- Derivados da vista -----
  const tarefasFiltradas = useMemo(
    () => filtrarTarefas(tarefas, filtros, { hoje: hojeRef, userId: currentUserId }),
    [tarefas, filtros, hojeRef, currentUserId],
  );
  const colunas = useMemo(
    () => agruparTarefas(tarefasFiltradas, corte, { baldes }),
    [tarefasFiltradas, corte, baldes],
  );
  const rotulosSugeridos = useMemo(() => rotulosDoPlano(tarefas), [tarefas]);
  const nFiltros = filtrosAtivos(filtros);
  const minhasFiltradas = useMemo(
    () => minhasTarefas(minhas, currentUserId, { incluirConcluidas: true }),
    [minhas, currentUserId],
  );

  const alternarStatus = (id) => {
    const atual = filtros.status.length ? filtros.status : TODOS_STATUS;
    let proximo = atual.includes(id) ? atual.filter((s) => s !== id) : [...atual, id];
    // Nunca deixar tudo desmarcado — isso esconderia o plano inteiro e
    // pareceria um bug. Desmarcar o último volta a marcar todos.
    if (!proximo.length || proximo.length === TODOS_STATUS.length) proximo = [];
    atualizarFiltros({ status: proximo });
  };
  const alternarLista = (campo, id) => {
    const atual = filtros[campo] || [];
    atualizarFiltros({ [campo]: atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id] });
  };

  const abrirTarefaDeOutroPlano = (t) => {
    const plano = planos.find((p) => p.id === t.planId);
    if (!plano) return;
    setVendoMinhas(false);
    setPlanoAtivoId(t.planId);
    setTimeout(() => setTarefaEmEdicao(t), 0);
  };

  if (semAcesso) {
    return (
      <section className="tdg-page tdg-planner">
        <div className="tdg-panel tdg-empty">
          <Lock size={22} />
          <p>Você não tem permissão para gerir o Planner. Fale com quem administra o espaço.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`tdg-page tdg-planner plr${railAberto ? "" : " is-rail-recolhido"}`}>
      <PlannerSidebar
        planos={planos}
        planoAtivoId={planoAtivoId}
        vendoMinhas={vendoMinhas}
        aberto={railAberto}
        carregando={ocupado === "carregando"}
        onEscolherPlano={(id) => { setVendoMinhas(false); setPlanoAtivoId(id); }}
        onMinhas={() => setVendoMinhas(true)}
        onNovoPlano={() => setModalPlano({ modo: "novo" })}
        onAlternar={alternarRail}
      />

      <div className="plr-principal">
        {erro && <div className="tdg-page-error">{erro}</div>}

        {vendoMinhas ? (
          <>
            <header className="plr-topo">
              <div className="plr-trilha">
                <ListChecks size={18} className="plr-trilha-icone" />
                <h2>Minhas tarefas</h2>
              </div>
              <div className="plr-topo-acoes">
                <button type="button" className="plr-botao-suave" onClick={() => carregarPlanos(planoAtivoId)} title="Atualizar"><RefreshCw size={15} /> Atualizar</button>
                <button type="button" className="plr-botao-suave" onClick={() => onNavigate?.("/todogreen/espaco?ferramenta=tarefas")} title="Ver todas as tarefas no quadro To Do">
                  <LayoutGrid size={15} /> Quadro To Do
                </button>
              </div>
            </header>
            <p className="plr-subtitulo">Tudo o que está atribuído a você nos planos que alcança, do prazo mais próximo ao mais distante.</p>
            {minhasFiltradas.length === 0 ? (
              <div className="plr-vazio">
                <ListChecks size={26} />
                <p>Nenhuma tarefa atribuída a você nos planos que alcança.</p>
              </div>
            ) : (
              <ul className="plr-minhas">
                {minhasFiltradas.map((t) => {
                  const plano = planos.find((p) => p.id === t.planId);
                  const atrasada = t.dueDate && t.dueDate < hojeRef && t.progress !== "concluida";
                  return (
                    <li key={t.id}>
                      <button type="button" onClick={() => abrirTarefaDeOutroPlano(t)} className={t.progress === "concluida" ? "is-feita" : ""}>
                        <IconePrioridade prioridade={t.priority} />
                        <span className="plr-minhas-titulo">{t.title}</span>
                        {plano && <span className="plr-minhas-plano"><PlanoIcone plano={plano} tamanho={16} /> {plano.name}</span>}
                        {t.dueDate && <span className={`plr-chip plr-chip--data${atrasada ? " is-atrasada" : ""}`}><CalendarRange size={13} /> {dataCurta(t.dueDate, { hoje: hojeRef })}</span>}
                        <span className="plr-status" data-status={t.progress}>{LABEL_PROGRESSO[t.progress]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : planoAtivo ? (
          <>
            <header className="plr-topo">
              <div className="plr-trilha">
                <button type="button" className="plr-trilha-link" onClick={() => setSeletorAberto(true)}>Meus planos</button>
                <ChevronRight size={15} className="plr-trilha-sep" aria-hidden="true" />
                <div className="plr-menu-ancora">
                  <button
                    type="button"
                    className="plr-seletor-plano"
                    aria-haspopup="listbox"
                    aria-expanded={seletorAberto}
                    onClick={() => setSeletorAberto((a) => !a)}
                    title={planoAtivo.description || resumoDoCompartilhamento(planoAtivo)}
                  >
                    <PlanoIcone plano={planoAtivo} tamanho={26} />
                    <h2>{planoAtivo.name}</h2>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                  {seletorAberto && (
                    <ul className="plr-menu plr-menu--planos" role="listbox" aria-label="Trocar de plano">
                      {planos.map((p) => (
                        <li key={p.id}>
                          <button type="button" role="option" aria-selected={p.id === planoAtivoId} onClick={() => { setPlanoAtivoId(p.id); setSeletorAberto(false); }}>
                            <PlanoIcone plano={p} tamanho={20} />
                            <span>{p.name}</span>
                            {p.visibility === "shared" || (p.members || []).length > 0 ? <Users size={12} /> : <Lock size={12} />}
                          </button>
                        </li>
                      ))}
                      <li className="plr-menu-sep" role="presentation" />
                      <li>
                        <button type="button" onClick={() => { setSeletorAberto(false); setModalPlano({ modo: "novo" }); }}>
                          <Plus size={15} /> <span>Novo plano</span>
                        </button>
                      </li>
                    </ul>
                  )}
                </div>
              </div>
              <div className="plr-topo-acoes">
                {/* Ponte para o lugar único de tarefas. Toda tarefa do Planner
                    já aparece lá; o botão torna isso visível em vez de a pessoa
                    sentir que há dois mundos de tarefa. */}
                <button type="button" className="plr-botao-suave" onClick={() => onNavigate?.("/todogreen/espaco?ferramenta=tarefas")} title="Ver todas as tarefas no quadro To Do">
                  <LayoutGrid size={15} /> Quadro To Do
                </button>
                {souDono && (
                  <button type="button" className="plr-botao-suave" onClick={() => setPartilhaEmEdicao(planoAtivo)} title="Escolher com quem compartilhar este plano">
                    {modoDoPlano(planoAtivo) === "privado" ? <Lock size={14} /> : <Users size={14} />}
                    Compartilhar · {rotuloPartilha(planoAtivo)}
                  </button>
                )}
                {souDono && (
                  <div className="plr-menu-ancora">
                    <button type="button" className="plr-icone" aria-label="Mais opções do plano" aria-haspopup="menu" aria-expanded={menuPlano} onClick={() => setMenuPlano((m) => !m)}>
                      <MoreHorizontal size={17} />
                    </button>
                    {menuPlano && (
                      <div className="plr-menu plr-menu--direita" role="menu">
                        <button type="button" role="menuitem" onClick={() => { setMenuPlano(false); setModalPlano({ modo: "editar", plano: planoAtivo }); }}>
                          <Pencil size={14} /> Editar plano
                        </button>
                        <button type="button" role="menuitem" className="is-perigo" onClick={() => { setMenuPlano(false); arquivarPlano(); }}>
                          <Trash2 size={14} /> Arquivar plano
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </header>

            <div className="plr-abas" role="tablist" aria-label="Vistas do plano">
              {VISTAS.map((v) => {
                const Icone = v.icon;
                return (
                  <button key={v.id} type="button" role="tab" aria-selected={vista === v.id} data-ativo={vista === v.id} onClick={() => escolherVista(v.id)}>
                    <Icone size={16} aria-hidden="true" /> {v.label}
                  </button>
                );
              })}
            </div>

            <div className="plr-toolbar">
              <label className="plr-busca">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Filtrar por palavra-chave"
                  aria-label="Buscar tarefa"
                  value={filtros.busca}
                  onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                />
              </label>
              <span className="plr-toolbar-espaco" />
              {(nFiltros > 0 || filtros.busca) && (
                <span className="plr-toolbar-resumo">{tarefasFiltradas.length} de {tarefas.length}</span>
              )}
              <div className="plr-menu-ancora">
                <button type="button" className="plr-botao-suave" aria-expanded={filtrosAbertos} aria-haspopup="dialog" onClick={() => setFiltrosAbertos((a) => !a)}>
                  <Filter size={15} /> Filtros {nFiltros > 0 && <b className="plr-badge">{nFiltros}</b>}
                </button>
                {filtrosAbertos && (
                  <div className="plr-popover" role="dialog" aria-label="Filtros">
                    <section>
                      <strong>Progresso</strong>
                      <div className="plr-chips">
                        {PLANNER_PROGRESS.map((p) => {
                          const marcado = !filtros.status.length || filtros.status.includes(p.id);
                          return (
                            <button key={p.id} type="button" className="plr-chip-filtro" aria-pressed={marcado} data-ativo={marcado} onClick={() => alternarStatus(p.id)}>{p.label}</button>
                          );
                        })}
                      </div>
                    </section>
                    <section>
                      <strong>Prioridade</strong>
                      <div className="plr-chips">
                        {PLANNER_PRIORITIES.map((p) => {
                          const marcado = filtros.prioridades.includes(p.id);
                          return (
                            <button key={p.id} type="button" className="plr-chip-filtro" aria-pressed={marcado} data-ativo={marcado} onClick={() => alternarLista("prioridades", p.id)}><IconePrioridade prioridade={p.id} /> {p.label}</button>
                          );
                        })}
                      </div>
                    </section>
                    {rotulosSugeridos.length > 0 && (
                      <section>
                        <strong>Rótulos</strong>
                        <div className="plr-chips">
                          {rotulosSugeridos.map((r) => {
                            const marcado = filtros.rotulos.includes(r);
                            return (
                              <button key={r} type="button" className="plr-chip-filtro plr-chip-filtro--rotulo" aria-pressed={marcado} data-ativo={marcado} onClick={() => alternarLista("rotulos", r)}><Rotulo texto={r} pequeno /></button>
                            );
                          })}
                        </div>
                      </section>
                    )}
                    <section>
                      <strong>Mais</strong>
                      <div className="plr-chips">
                        <button type="button" className="plr-chip-filtro" aria-pressed={filtros.minhas} data-ativo={filtros.minhas} onClick={() => atualizarFiltros({ minhas: !filtros.minhas })}>Atribuídas a mim</button>
                        <button type="button" className="plr-chip-filtro" aria-pressed={filtros.semResponsavel} data-ativo={filtros.semResponsavel} onClick={() => atualizarFiltros({ semResponsavel: !filtros.semResponsavel })}>Sem responsável</button>
                        <button type="button" className="plr-chip-filtro" aria-pressed={filtros.atrasadas} data-ativo={filtros.atrasadas} onClick={() => atualizarFiltros({ atrasadas: !filtros.atrasadas })}>Atrasadas</button>
                      </div>
                    </section>
                    <footer>
                      <button type="button" className="plr-botao-suave" onClick={limparFiltros} disabled={nFiltros === 0}><X size={14} /> Limpar</button>
                      <button type="button" className="tdg-action" onClick={() => setFiltrosAbertos(false)}>Pronto</button>
                    </footer>
                  </div>
                )}
              </div>
              {vista === "quadro" && (
                <label className="plr-agrupar">
                  <span>Agrupar por</span>
                  <select aria-label="Agrupar por" value={corte} onChange={(e) => setCorte(e.target.value)}>
                    {CORTES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
              )}
            </div>

            {vista === "quadro" && (
              <PlannerBoard
                colunas={colunas}
                corte={corte}
                hojeRef={hojeRef}
                souDono={souDono}
                onAbrir={setTarefaEmEdicao}
                onConcluir={alternarConcluida}
                onMover={moverTarefa}
                onAdicionarRapida={adicionarRapida}
                onAdicionarBalde={aoAdicionarBalde}
                onRenomearBalde={aoRenomearBalde}
                onRemoverBalde={aoRemoverBalde}
                onMoverBalde={aoMoverBalde}
              />
            )}
            {vista === "tabela" && (
              <PlannerTable
                tarefas={tarefasFiltradas}
                baldes={baldes}
                hojeRef={hojeRef}
                onAbrir={setTarefaEmEdicao}
                onConcluir={alternarConcluida}
                onMudarProgresso={mudarProgresso}
              />
            )}
            {vista === "linha" && (
              <PlannerTimeline tarefas={tarefasFiltradas} hojeRef={hojeRef} onAbrir={setTarefaEmEdicao} />
            )}
            {vista === "graficos" && (
              <PlannerCharts tarefas={tarefasFiltradas} baldes={baldes} hojeRef={hojeRef} onAbrir={setTarefaEmEdicao} />
            )}
          </>
        ) : (
          <>
            <header className="plr-topo">
              <div className="plr-trilha">
                <KanbanSquare size={18} className="plr-trilha-icone" />
                <h2>Meus planos</h2>
              </div>
              <div className="plr-topo-acoes">
                <button type="button" className="plr-botao-suave" onClick={() => onNavigate?.("/todogreen/espaco?ferramenta=tarefas")} title="Ver todas as tarefas no quadro To Do">
                  <LayoutGrid size={15} /> Quadro To Do
                </button>
              </div>
            </header>
            <div className="plr-vazio plr-vazio--hero">
              {ocupado === "carregando" ? (
                <p>Carregando planos…</p>
              ) : (
                <>
                  <KanbanSquare size={30} />
                  <h2>Crie o primeiro plano</h2>
                  <p>Um plano reúne tarefas em baldes, com prazo, prioridade, rótulos e checklist. Pode ser privado, para pessoas específicas ou para todo o espaço.</p>
                  <button type="button" className="tdg-action" onClick={() => setModalPlano({ modo: "novo" })}><Plus size={16} /> Novo plano</button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {modalPlano && (
        <PlanoModal
          modo={modalPlano.modo}
          plano={modalPlano.plano}
          pessoas={pessoas}
          currentUserId={currentUserId}
          ocupado={ocupado === "salvando"}
          onFechar={() => setModalPlano(null)}
          onSalvar={salvarPlano}
        />
      )}

      {tarefaEmEdicao && (
        <PlannerTaskModal
          tarefa={tarefaEmEdicao}
          baldes={baldes}
          pessoas={pessoas}
          clientes={clientes}
          oportunidades={oportunidades}
          sugestoesRotulos={rotulosSugeridos}
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

// Criar ou editar um plano: nome, descrição e cor (o ícone do rail). O
// compartilhamento entra aqui só na criação — depois muda pelo botão próprio.
function PlanoModal({ modo, plano, pessoas, currentUserId, ocupado, onFechar, onSalvar }) {
  const [form, setForm] = useState(() => ({
    name: plano?.name || "",
    description: plano?.description || "",
    color: plano?.color || CORES_PLANO[0],
    modo: "privado",
    members: [],
  }));
  const editar = modo === "editar";
  return (
    <Modal title={editar ? "Editar plano" : "Novo plano"} onClose={onFechar}>
      <form className="tdg-planner-form plr-form" onSubmit={(e) => { e.preventDefault(); onSalvar(form); }}>
        <div className="plr-form-plano-nome">
          <PlanoIcone plano={{ name: form.name || "Plano", color: form.color }} tamanho={44} />
          <label>
            Nome do plano
            <input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={120} placeholder="Ex.: Marketing, Implantação DHL" />
          </label>
        </div>
        <fieldset className="plr-form-cores">
          <legend>Cor</legend>
          <div role="radiogroup" aria-label="Cor do plano">
            {CORES_PLANO.map((cor) => (
              <button
                key={cor}
                type="button"
                role="radio"
                aria-checked={form.color === cor}
                aria-label={`Cor ${cor}`}
                className="plr-form-cor"
                style={{ background: cor }}
                onClick={() => setForm((f) => ({ ...f, color: cor }))}
              />
            ))}
          </div>
        </fieldset>
        <label>
          Descrição
          <textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={2000} placeholder="Para que serve este plano" />
        </label>
        {!editar && (
          <PartilhaCampos
            modo={form.modo}
            members={form.members}
            pessoas={pessoas}
            currentUserId={currentUserId}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          />
        )}
        <div className="tdg-form-actions">
          <button type="button" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="tdg-action" disabled={ocupado}>{editar ? "Salvar" : "Criar plano"}</button>
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
      <RadioCards
        name="partilha"
        value={modo}
        onChange={(valor) => onChange({ modo: valor })}
        options={MODOS_DE_PARTILHA.map((m) => ({
          value: m.id,
          label: m.label,
          description: m.ajuda,
          icon: m.id === "privado" ? Lock : Users,
        }))}
      />
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
          <div className="tdg-planner-chips plr-membros">
            {members.map((id) => {
              const pessoa = pessoas.find((p) => p.id === id);
              return (
                <span className="tdg-planner-chip plr-membro" key={id}>
                  <Avatar nome={pessoa?.name || id} tamanho={20} />
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
        className="tdg-planner-form plr-form"
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
