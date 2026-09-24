import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import {
  PLANNER_PRIORITIES,
  PLANNER_PROGRESS,
  dataCurta,
  normalizarRotulos,
} from "../../plannerDomain.js";
import { Avatar, IconePrioridade, LABEL_PRIORIDADE, Rotulo } from "./plannerUi.jsx";

const COLUNAS = [
  { id: "title", label: "Nome da tarefa" },
  { id: "bucket", label: "Balde" },
  { id: "progress", label: "Progresso" },
  { id: "priority", label: "Prioridade" },
  { id: "startDate", label: "Início" },
  { id: "dueDate", label: "Prazo" },
  { id: "assignee", label: "Atribuída a" },
];

const RANK_PROGRESSO = Object.fromEntries(PLANNER_PROGRESS.map((p) => [p.id, p.rank]));
const RANK_PRIORIDADE = Object.fromEntries(PLANNER_PRIORITIES.map((p) => [p.id, p.rank]));

// A vista "Tabela": as mesmas tarefas em linhas, ordenáveis por qualquer
// coluna. Progresso muda inline (é a edição mais frequente); o resto abre a
// tarefa. A ordem padrão é a do quadro (prioridade → prazo).
export default function PlannerTable({ tarefas, baldes, hojeRef, onAbrir, onConcluir, onMudarProgresso }) {
  const [ordem, setOrdem] = useState({ por: null, asc: true });
  const nomeBalde = useMemo(() => Object.fromEntries(baldes.map((b) => [b.id, b.nome])), [baldes]);

  const linhas = useMemo(() => {
    if (!ordem.por) return tarefas;
    const valor = (t) => {
      switch (ordem.por) {
        case "bucket": return nomeBalde[t.bucketId] || "";
        case "progress": return RANK_PROGRESSO[t.progress] ?? 0;
        case "priority": return RANK_PRIORIDADE[t.priority] ?? 2;
        case "assignee": return t.assigneeLabel || "";
        case "startDate": return t.startDate || "9999";
        case "dueDate": return t.dueDate || "9999";
        default: return t.title || "";
      }
    };
    return [...tarefas].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return ordem.asc ? cmp : -cmp;
    });
  }, [tarefas, ordem, nomeBalde]);

  const alternar = (id) => setOrdem((o) => (o.por === id ? { por: id, asc: !o.asc } : { por: id, asc: true }));

  return (
    <div className="plr-tabela-wrap">
      <table className="plr-tabela">
        <thead>
          <tr>
            <th scope="col" className="plr-th-check"><span className="plr-sr">Concluir</span></th>
            {COLUNAS.map((c) => (
              <th key={c.id} scope="col" aria-sort={ordem.por === c.id ? (ordem.asc ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => alternar(c.id)}>
                  {c.label}
                  {ordem.por === c.id && (ordem.asc ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((t) => {
            const feita = t.progress === "concluida";
            const atrasada = Boolean(t.dueDate) && t.dueDate < hojeRef && !feita;
            return (
              <tr key={t.id} className={feita ? "is-feita" : ""} onClick={() => onAbrir(t)} onKeyDown={(e) => { if (e.key === "Enter") onAbrir(t); }}>
                <td>
                  <button
                    type="button"
                    className="plr-check"
                    data-feito={feita}
                    aria-label={feita ? `Reabrir ${t.title}` : `Concluir ${t.title}`}
                    onClick={(e) => { e.stopPropagation(); onConcluir(t); }}
                  >
                    <Check size={12} strokeWidth={3} />
                  </button>
                </td>
                <td className="plr-td-titulo">
                  <div>
                    <span className="plr-td-nome">{t.title}</span>
                    {normalizarRotulos(t.labels).map((r) => <Rotulo key={r} texto={r} pequeno />)}
                  </div>
                </td>
                <td>{nomeBalde[t.bucketId] || <span className="plr-texto-vazio">—</span>}</td>
                <td>
                  <select
                    className="plr-select-inline"
                    data-progresso={t.progress}
                    value={t.progress}
                    aria-label={`Progresso de ${t.title}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onMudarProgresso(t, e.target.value)}
                  >
                    {PLANNER_PROGRESS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </td>
                <td><span className="plr-prio-texto"><IconePrioridade prioridade={t.priority} /> {LABEL_PRIORIDADE[t.priority]}</span></td>
                <td>{t.startDate ? dataCurta(t.startDate, { hoje: hojeRef }) : <span className="plr-texto-vazio">—</span>}</td>
                <td className={atrasada ? "is-atrasada" : ""}>{t.dueDate ? dataCurta(t.dueDate, { hoje: hojeRef }) : <span className="plr-texto-vazio">—</span>}</td>
                <td>
                  {t.assigneeLabel
                    ? <span className="plr-pessoa"><Avatar nome={t.assigneeLabel} tamanho={22} /> {t.assigneeLabel}</span>
                    : <span className="plr-texto-vazio">Sem responsável</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {linhas.length === 0 && <p className="plr-col-vazia">Nenhuma tarefa com estes filtros.</p>}
    </div>
  );
}
