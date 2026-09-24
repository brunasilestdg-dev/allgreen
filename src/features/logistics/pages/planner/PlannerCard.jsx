import { AlignLeft, CalendarDays, Check, ListChecks, UserRound } from "lucide-react";
import {
  dataCurta,
  duracaoDaTarefa,
  normalizarRotulos,
  progressoNumerico,
  rotuloDuracao,
  sinaisDaTarefa,
} from "../../plannerDomain.js";
import { Avatar, IconePrioridade, Rotulo } from "./plannerUi.jsx";

// Cartão de tarefa do quadro, no desenho do Planner da Microsoft: rótulos
// coloridos em cima, círculo de concluir + título, "N dias · 50%" e um rodapé
// com prioridade, prazo, checklist e o avatar de quem executa. Arrastável — o
// quadro cuida do que acontece ao soltar.
export default function PlannerCard({
  tarefa,
  hojeRef,
  onAbrir,
  onConcluir,
  arrastando = false,
  onDragStart,
  onDragEnd,
}) {
  const feita = tarefa.progress === "concluida";
  const pct = progressoNumerico(tarefa);
  const dias = duracaoDaTarefa(tarefa);
  const sinal = sinaisDaTarefa(tarefa, { hoje: hojeRef })[0];
  const atrasada = Boolean(tarefa.dueDate) && tarefa.dueDate < hojeRef && !feita;
  const breve = !atrasada && (sinal?.tipo === "vence_hoje" || sinal?.tipo === "vence_breve");
  const rotulos = normalizarRotulos(tarefa.labels);
  const checklist = Array.isArray(tarefa.checklist) ? tarefa.checklist : [];
  const feitos = checklist.filter((i) => i?.feito || i?.done).length;

  return (
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */
    <article
      className={`plr-card${feita ? " is-feita" : ""}${arrastando ? " is-arrastando" : ""}`}
      draggable
      aria-label={`Tarefa ${tarefa.title}`}
      data-prioridade={tarefa.priority}
      onDragStart={(e) => { try { e.dataTransfer?.setData("text/plain", tarefa.id); e.dataTransfer.effectAllowed = "move"; } catch { /* jsdom */ } onDragStart?.(tarefa); }}
      onDragEnd={() => onDragEnd?.()}
      onClick={() => onAbrir(tarefa)}
    >
      {rotulos.length > 0 && (
        <div className="plr-card-rotulos">
          {rotulos.map((r) => <Rotulo key={r} texto={r} pequeno />)}
        </div>
      )}
      <div className="plr-card-linha">
        <button
          type="button"
          className="plr-check"
          data-feito={feita}
          aria-label={feita ? `Reabrir ${tarefa.title}` : `Concluir ${tarefa.title}`}
          title={feita ? "Reabrir" : "Concluir"}
          onClick={(e) => { e.stopPropagation(); onConcluir(tarefa); }}
        >
          <Check size={12} strokeWidth={3} />
        </button>
        {/* O título é um botão de verdade: é ele que dá acesso por teclado ao
            detalhe (o cartão inteiro responde ao clique do mouse). */}
        <button type="button" className="plr-card-titulo" onClick={(e) => { e.stopPropagation(); onAbrir(tarefa); }}>{tarefa.title}</button>
      </div>
      {(dias != null || pct > 0) && !feita && (
        <div className="plr-card-progresso">
          {dias != null && <span>{rotuloDuracao(dias)}</span>}
          {pct > 0 && <span>{pct}%</span>}
          {pct > 0 && <span className="plr-card-barra" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>}
        </div>
      )}
      <footer className="plr-card-rodape">
        <IconePrioridade prioridade={tarefa.priority} />
        {tarefa.dueDate && (
          <span className={`plr-chip plr-chip--data${atrasada ? " is-atrasada" : breve ? " is-breve" : ""}`} title={atrasada ? sinal?.rotulo : `Prazo ${tarefa.dueDate}`}>
            <CalendarDays size={13} /> {dataCurta(tarefa.dueDate, { hoje: hojeRef })}
          </span>
        )}
        {checklist.length > 0 && (
          <span className="plr-chip" title="Checklist"><ListChecks size={13} /> {feitos}/{checklist.length}</span>
        )}
        {tarefa.notes && <span className="plr-chip plr-chip--icone" title="Tem notas"><AlignLeft size={13} /></span>}
        <span className="plr-card-espaco" />
        {tarefa.assigneeLabel
          ? <Avatar nome={tarefa.assigneeLabel} tamanho={26} />
          : <span className="plr-avatar plr-avatar--vazio" title="Sem responsável" aria-label="Sem responsável" role="img"><UserRound size={13} /></span>}
      </footer>
    </article>
  );
}
