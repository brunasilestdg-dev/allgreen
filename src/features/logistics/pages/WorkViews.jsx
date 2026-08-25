import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  GanttChartSquare,
  LayoutList,
  RefreshCw,
  Users,
} from "lucide-react";
import { authHeaders } from "../../../session/armazenamento.js";
import {
  agruparPorGrupo,
  caminhoCritico,
  cargaPorResponsavel,
  isConcluido,
  itensNoCalendario,
  montarGantt,
  resumoDoTrabalho,
} from "../workManagementDomain.js";
import "./TodoGreenPages.css";

// As visualizações que faltavam para o Espaço chegar ao nível Monday: Gantt,
// Timeline, Calendário, Workload e Gráfico — todas derivadas dos MESMOS
// work_items, sem uma segunda fonte de verdade. A lógica mora em
// workManagementDomain.js (puro e testado); aqui é só desenho.

const API = "/api/todogreen/work-center";

async function carregar(boardId) {
  const url = boardId ? `${API}?board=${encodeURIComponent(boardId)}&limit=500` : `${API}?limit=500`;
  const resposta = await fetch(url, { headers: { ...authHeaders() } });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.error || "Não foi possível carregar o quadro.");
  return corpo;
}

async function carregarGrupos(boardId) {
  const resposta = await fetch(`${API}/groups?board=${encodeURIComponent(boardId)}`, { headers: { ...authHeaders() } });
  const corpo = await resposta.json().catch(() => ({}));
  return resposta.ok ? (corpo.groups || []) : [];
}

const VIEWS = [
  { id: "gantt", label: "Gantt", icon: GanttChartSquare },
  { id: "timeline", label: "Timeline", icon: LayoutList },
  { id: "calendario", label: "Calendário", icon: CalendarDays },
  { id: "workload", label: "Workload", icon: Users },
  { id: "grafico", label: "Gráfico", icon: BarChart3 },
];

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dataCurta = (iso) => {
  const s = String(iso || "").slice(0, 10);
  if (!s) return "—";
  const [, m, d] = s.split("-");
  return `${d}/${MES[Number(m) - 1] || "?"}`;
};

export default function WorkViews({ setToast, profiles = [] }) {
  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState("");
  const [itens, setItens] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [view, setView] = useState("gantt");
  const [ocupado, setOcupado] = useState("carregando");
  const [erro, setErro] = useState("");

  const recarregar = async (alvo) => {
    setOcupado("carregando");
    setErro("");
    try {
      const dados = await carregar(alvo);
      setBoards(dados.boards || []);
      const board = alvo || dados.boards?.[0]?.id || "";
      setBoardId(board);
      // Normaliza para o formato que as visões esperam: o Work Center unificado
      // guarda grupo, início, marco e recorrência dentro de `fields`. Subir para
      // o topo faz Gantt, Timeline, Calendário e Workload funcionarem sem tocar
      // no resto do componente nem no domínio.
      const itensNorm = (dados.items || []).map((i) => ({
        ...i,
        groupId: i.groupId || i.fields?.groupId || "",
        parentItemId: i.parentItemId || i.fields?.parentId || "",
        startDate: i.startDate || i.fields?.startDate || "",
        isMilestone: i.isMilestone ?? i.fields?.milestone ?? false,
      }));
      setItens(itensNorm.filter((i) => !i.parentItemId));
      if (board) setGrupos(await carregarGrupos(board));
      setOcupado("");
    } catch (motivo) {
      setErro(motivo.message);
      setOcupado("");
    }
  };

  useEffect(() => { recarregar(""); }, []);

  const trocarBoard = async (id) => { setBoardId(id); await recarregar(id); };

  const resumo = useMemo(() => resumoDoTrabalho(itens), [itens]);
  const gantt = useMemo(() => montarGantt(itens), [itens]);
  const critico = useMemo(() => {
    try { return caminhoCritico(itens); } catch { return { duracaoTotal: 0, itensCriticos: [] }; }
  }, [itens]);
  const calendario = useMemo(() => itensNoCalendario(itens), [itens]);
  // Capacidade real vem dos perfis do planejamento (capacityDomain): a carga é
  // comparada com as horas semanais de cada pessoa, por id e por nome, para
  // casar tanto o item que guarda o userId quanto o que só tem o rótulo.
  const capacidades = useMemo(() => {
    const mapa = {};
    for (const p of profiles) {
      const horas = Number(p?.weeklyHours) || 0;
      if (!horas) continue;
      if (p.userId) mapa[p.userId] = horas;
      if (p.name) mapa[p.name] = horas;
    }
    return mapa;
  }, [profiles]);
  const carga = useMemo(() => cargaPorResponsavel(itens, { capacidades }), [itens, capacidades]);
  const porGrupo = useMemo(() => agruparPorGrupo(itens, grupos), [itens, grupos]);

  if (ocupado === "carregando") {
    return <div className="tdg-page"><section className="tdg-panel">Carregando visualizações...</section></div>;
  }

  return (
    <div className="tdg-page tdg-workviews">
      <header className="tdg-page-title">
        <div>
          <span>ESPAÇO · VISUALIZAÇÕES</span>
          <h2>Gantt, Timeline, Calendário, Workload e Gráfico</h2>
          <p>Mesma base do quadro: Gantt e Workload.</p>
        </div>
        <div className="tdg-page-actions">
          {boards.length > 1 && (
            <select className="tdg-action" value={boardId} onChange={(e) => trocarBoard(e.target.value)} aria-label="Quadro">
              {boards.map((b) => <option value={b.id} key={b.id}>{b.name}</option>)}
            </select>
          )}
          <button className="tdg-action" type="button" onClick={() => recarregar(boardId)}><RefreshCw size={16} />Atualizar</button>
        </div>
      </header>

      {erro && <div className="tdg-alert" role="alert"><span>{erro}</span></div>}

      <section className="tdg-metrics">
        <article className="tdg-metric"><span>Itens abertos</span><strong>{resumo.abertos}</strong><small>{resumo.concluidos} concluídos</small></article>
        <article className="tdg-metric"><span>Com prazo</span><strong>{resumo.comPrazo}</strong><small>na timeline</small></article>
        <article className="tdg-metric"><span>Marcos</span><strong>{resumo.marcos}</strong><small>balizam o Gantt</small></article>
        <article className={`tdg-metric ${critico.itensCriticos.length ? "warn" : ""}`}><span>Caminho crítico</span><strong>{critico.duracaoTotal}d</strong><small>{critico.itensCriticos.length} itens sem folga</small></article>
      </section>

      <div className="tdg-workviews-switch" role="tablist" aria-label="Visualização">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          return (
            <button type="button" role="tab" aria-selected={view === v.id} className={view === v.id ? "active" : ""} onClick={() => setView(v.id)} key={v.id}>
              <Icon size={15} />{v.label}
            </button>
          );
        })}
      </div>

      {!itens.length && <p className="tdg-empty">Este quadro ainda não tem itens. Crie tarefas na aba Estrutura para vê-las aqui.</p>}

      {itens.length > 0 && view === "gantt" && (
        <section className="tdg-panel tdg-gantt">
          {!gantt.barras.length && <p className="tdg-empty">Nenhum item com data. Defina início e prazo para desenhar o Gantt.</p>}
          {gantt.barras.length > 0 && (
            <>
              <div className="tdg-gantt-scale"><span>{dataCurta(gantt.inicio)}</span><span>{gantt.totalDias} dias</span><span>{dataCurta(gantt.fim)}</span></div>
              <div className="tdg-gantt-rows">
                {gantt.barras.map((b) => (
                  <div className="tdg-gantt-row" key={b.id}>
                    <span className="tdg-gantt-label" title={b.titulo}>{b.titulo || "(sem título)"}</span>
                    <div className="tdg-gantt-track">
                      {b.marco ? (
                        <span className="tdg-gantt-milestone" style={{ left: `${(b.offsetDias / gantt.totalDias) * 100}%` }} title={`Marco · ${dataCurta(gantt.inicio)}`}>◆</span>
                      ) : (
                        <span
                          className={`tdg-gantt-bar ${b.critico ? "critico" : ""} ${isConcluido(b.status) ? "feito" : ""}`}
                          style={{ left: `${(b.offsetDias / gantt.totalDias) * 100}%`, width: `${Math.max(2, (b.duracaoDias / gantt.totalDias) * 100)}%` }}
                          title={`${b.duracaoDias}d${b.critico ? " · caminho crítico" : ""}`}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {itens.length > 0 && view === "timeline" && (
        <section className="tdg-panel">
          <ol className="tdg-timeline">
            {[...itens]
              .filter((i) => i.dueDate || i.startDate)
              .sort((a, b) => String(a.startDate || a.dueDate).localeCompare(String(b.startDate || b.dueDate)))
              .map((i) => (
                <li key={i.id} className={critico.itensCriticos.includes(i.id) ? "critico" : ""}>
                  <span className="tdg-timeline-date">{dataCurta(i.startDate || i.dueDate)}</span>
                  <span className="tdg-timeline-dot" />
                  <span className="tdg-timeline-body">
                    <strong>{i.title}</strong>
                    <small>{i.responsible || "sem responsável"} · {i.status}{i.isMilestone ? " · marco" : ""}</small>
                  </span>
                </li>
              ))}
          </ol>
        </section>
      )}

      {itens.length > 0 && view === "calendario" && (
        <section className="tdg-panel tdg-cal">
          {Object.keys(calendario).sort().map((dia) => (
            <div className="tdg-cal-day" key={dia}>
              <header>{dataCurta(dia)}</header>
              <ul>{calendario[dia].map((i) => <li key={i.id} className={isConcluido(i.status) ? "feito" : ""}>{i.title}</li>)}</ul>
            </div>
          ))}
          {!Object.keys(calendario).length && <p className="tdg-empty">Nenhum item com data de vencimento.</p>}
        </section>
      )}

      {itens.length > 0 && view === "workload" && (
        <section className="tdg-panel tdg-workload">
          {carga.map((c) => {
            const largura = Math.min(100, c.capacidade ? c.utilizacao : Math.min(100, c.horas));
            return (
              <div className="tdg-workload-row" key={c.chave}>
                <span className="tdg-workload-name">{c.nome}</span>
                <div className="tdg-workload-bar"><span className={c.sobrecarregado ? "over" : ""} style={{ width: `${largura}%` }} /></div>
                <span className="tdg-workload-num">{c.itens} itens · {c.horas}h{c.capacidade ? ` / ${c.capacidade}h` : ""}{c.sobrecarregado ? " ⚠" : ""}</span>
              </div>
            );
          })}
          {!carga.length && <p className="tdg-empty">Nenhum item aberto atribuído.</p>}
        </section>
      )}

      {itens.length > 0 && view === "grafico" && (
        <section className="tdg-panel tdg-workchart">
          <h3>Itens por grupo</h3>
          {(() => {
            const max = Math.max(1, ...porGrupo.map((g) => g.itens.length));
            return porGrupo.map((g) => (
              <div className="tdg-chart-row" key={g.grupo.id || "sem"}>
                <span className="tdg-chart-label">{g.grupo.name}</span>
                <div className="tdg-chart-bar"><span style={{ width: `${(g.itens.length / max) * 100}%`, background: g.grupo.color || "var(--tdg-green)" }} /></div>
                <span className="tdg-chart-num">{g.itens.length}</span>
              </div>
            ));
          })()}
          <h3 style={{ marginTop: "1.2rem" }}>Distribuição por status</h3>
          {(() => {
            const porStatus = {};
            for (const i of itens) porStatus[i.status || "sem status"] = (porStatus[i.status || "sem status"] || 0) + 1;
            const max = Math.max(1, ...Object.values(porStatus));
            return Object.entries(porStatus).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
              <div className="tdg-chart-row" key={s}>
                <span className="tdg-chart-label">{s}</span>
                <div className="tdg-chart-bar"><span style={{ width: `${(n / max) * 100}%` }} /></div>
                <span className="tdg-chart-num">{n}</span>
              </div>
            ));
          })()}
        </section>
      )}
    </div>
  );
}
