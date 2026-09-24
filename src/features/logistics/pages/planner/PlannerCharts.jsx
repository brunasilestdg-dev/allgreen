import { useMemo } from "react";
import { AlertTriangle, Zap } from "lucide-react";
import {
  graficosDoPlano,
  prioridadesDoPlano,
  resumoInteligente,
  resumoPlano,
} from "../../plannerDomain.js";
import { Avatar, COR_PRIORIDADE, IconePrioridade } from "./plannerUi.jsx";

const COR_STATUS = {
  nao_iniciada: "#9aaab3",
  em_andamento: "#2f8bd6",
  concluida: "#2c7a5b",
};

// A aba "Gráficos", como no Planner da Microsoft: status em rosca, tarefas por
// balde (empilhadas por status), prioridade e membros — e a camada inteligente
// que já existia (radar + "Faça agora"), agora com um lugar próprio em vez de
// um botão de "ver análise" escondido. Tudo derivado; nada aqui é digitado.
export default function PlannerCharts({ tarefas, baldes, hojeRef, onAbrir }) {
  const resumo = useMemo(() => resumoPlano(tarefas), [tarefas]);
  const g = useMemo(() => graficosDoPlano(tarefas, { baldes, hoje: hojeRef }), [tarefas, baldes, hojeRef]);
  const radar = useMemo(() => resumoInteligente(tarefas, { hoje: hojeRef }), [tarefas, hojeRef]);
  const foco = useMemo(() => prioridadesDoPlano(tarefas, { hoje: hojeRef, limite: 8 }), [tarefas, hojeRef]);

  const total = Math.max(1, g.total);
  let acumulado = 0;
  const fatias = g.porStatus.map((s) => {
    const de = (acumulado / total) * 360;
    acumulado += s.total;
    const ate = (acumulado / total) * 360;
    return `${COR_STATUS[s.id]} ${de}deg ${ate}deg`;
  });
  const rosca = g.total ? `conic-gradient(${fatias.join(", ")})` : "conic-gradient(var(--tdg-line) 0deg 360deg)";
  const maiorBalde = Math.max(1, ...g.porBalde.map((b) => b.total));
  const maiorPrioridade = Math.max(1, ...g.porPrioridade.map((p) => p.total));
  const maiorPessoa = Math.max(1, ...g.porResponsavel.map((p) => p.total));

  return (
    <div className="plr-graficos">
      <div className="plr-metricas">
        <div className="plr-metrica"><strong>{resumo.total}</strong><span>Tarefas</span></div>
        <div className="plr-metrica"><strong>{resumo.naoIniciadas}</strong><span>Não iniciadas</span></div>
        <div className="plr-metrica"><strong>{resumo.emAndamento}</strong><span>Em andamento</span></div>
        <div className="plr-metrica"><strong>{resumo.concluidas}</strong><span>Concluídas</span></div>
        <div className={`plr-metrica${g.atrasadas ? " is-risco" : ""}`}><strong>{g.atrasadas}</strong><span>Atrasadas</span></div>
        <div className="plr-metrica"><strong>{resumo.progressoMedio}%</strong><span>Progresso médio</span></div>
      </div>

      <div className="plr-graficos-grade">
        <section className="plr-grafico" aria-label="Tarefas por status">
          <h3>Status</h3>
          <div className="plr-rosca-wrap">
            <div className="plr-rosca" style={{ background: rosca }} role="img" aria-label={g.porStatus.map((s) => `${s.label}: ${s.total}`).join(", ")}>
              <span><strong>{g.total}</strong><small>tarefas</small></span>
            </div>
            <ul className="plr-legenda">
              {g.porStatus.map((s) => (
                <li key={s.id}><i style={{ background: COR_STATUS[s.id] }} /> {s.label} <b>{s.total}</b></li>
              ))}
            </ul>
          </div>
        </section>

        <section className="plr-grafico" aria-label="Tarefas por balde">
          <h3>Balde</h3>
          {g.porBalde.length === 0 ? <p className="plr-col-vazia">Sem baldes.</p> : (
            <ul className="plr-barras">
              {g.porBalde.map((b) => (
                <li key={b.id}>
                  <span className="plr-barras-rotulo" title={b.label}>{b.label}</span>
                  <span className="plr-barras-trilha" title={b.porStatus.map((s) => `${COR_STATUS[s.id] ? s.id.replace("_", " ") : s.id}: ${s.total}`).join(" · ")}>
                    {b.porStatus.filter((s) => s.total > 0).map((s) => (
                      <i key={s.id} style={{ width: `${(s.total / maiorBalde) * 100}%`, background: COR_STATUS[s.id] }} />
                    ))}
                  </span>
                  <b>{b.total}</b>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="plr-grafico" aria-label="Tarefas abertas por prioridade">
          <h3>Prioridade <small>tarefas abertas</small></h3>
          <ul className="plr-barras">
            {g.porPrioridade.map((p) => (
              <li key={p.id}>
                <span className="plr-barras-rotulo"><IconePrioridade prioridade={p.id} /> {p.label}</span>
                <span className="plr-barras-trilha"><i style={{ width: `${(p.total / maiorPrioridade) * 100}%`, background: COR_PRIORIDADE[p.id] }} /></span>
                <b>{p.total}</b>
              </li>
            ))}
          </ul>
        </section>

        <section className="plr-grafico" aria-label="Tarefas por pessoa">
          <h3>Membros</h3>
          {g.porResponsavel.length === 0 ? <p className="plr-col-vazia">Nenhuma tarefa ainda.</p> : (
            <ul className="plr-barras plr-barras--pessoas">
              {g.porResponsavel.map((p) => (
                <li key={p.id}>
                  <span className="plr-barras-rotulo plr-pessoa">
                    {p.id === "__sem__" ? <span className="plr-avatar plr-avatar--vazio" aria-hidden="true">?</span> : <Avatar nome={p.label} tamanho={22} />}
                    {p.label}
                  </span>
                  <span className="plr-barras-trilha" title={`${p.concluidas} concluída(s) · ${p.atrasadas} atrasada(s)`}>
                    <i style={{ width: `${(p.concluidas / maiorPessoa) * 100}%`, background: COR_STATUS.concluida }} />
                    <i style={{ width: `${((p.total - p.concluidas - p.atrasadas) / maiorPessoa) * 100}%`, background: COR_STATUS.em_andamento }} />
                    <i style={{ width: `${(p.atrasadas / maiorPessoa) * 100}%`, background: "#c0392b" }} />
                  </span>
                  <b>{p.total}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="plr-foco" aria-label="O que pede ação agora">
        <header>
          <Zap size={16} />
          <h3>Faça agora</h3>
          <span>O que este plano precisa que alguém resolva primeiro — pelo prazo, prioridade e responsável.</span>
        </header>
        {radar.emRisco > 0 && (
          <div className="plr-radar" role="status">
            {radar.atrasadas > 0 && <span className="plr-sinal risco"><AlertTriangle size={12} /> {radar.atrasadas} atrasada(s)</span>}
            {radar.venceHoje > 0 && <span className="plr-sinal atencao">{radar.venceHoje} vence(m) hoje</span>}
            {radar.venceEmBreve > 0 && <span className="plr-sinal atencao">{radar.venceEmBreve} vence(m) em breve</span>}
            {radar.semResponsavel > 0 && <span className="plr-sinal atencao">{radar.semResponsavel} sem responsável</span>}
          </div>
        )}
        {foco.length === 0 ? (
          <p className="plr-col-vazia">Nada pede ação imediata. Plano tranquilo.</p>
        ) : (
          <ul className="plr-foco-lista">
            {foco.map(({ tarefa, sinais }) => (
              <li key={tarefa.id}>
                <button type="button" onClick={() => onAbrir(tarefa)}>
                  <IconePrioridade prioridade={tarefa.priority} />
                  <span className="plr-foco-titulo">{tarefa.title}</span>
                  <span className="plr-foco-sinais">
                    {sinais.map((s) => <em key={s.tipo} className={`plr-sinal ${s.severidade}`}>{s.rotulo}</em>)}
                  </span>
                  {tarefa.assigneeLabel
                    ? <Avatar nome={tarefa.assigneeLabel} tamanho={24} />
                    : <span className="plr-avatar plr-avatar--vazio" title="Sem responsável" aria-label="Sem responsável" role="img">?</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
