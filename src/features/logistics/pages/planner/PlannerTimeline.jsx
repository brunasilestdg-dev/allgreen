import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SegmentedControl } from "../../../../design-system/index.js";
import {
  deslocarDias,
  diasDaJanela,
  linhaDoTempo,
  segundaDaSemana,
} from "../../plannerDomain.js";
import { Avatar } from "./plannerUi.jsx";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

const dataLonga = (ymd) => {
  const [a, m, d] = String(ymd).split("-");
  return `${d} de ${MESES[Number(m) - 1]} de ${a}`;
};

// Linha do tempo (Gantt simples): uma barra por tarefa com prazo, do início ao
// prazo, sobre uma régua de dias. Toda a conta de posição vem do domínio
// (`linhaDoTempo`, em dias); aqui é só CSS grid: coluna 1 = título (fixa à
// esquerda), colunas 2..N = dias. Fundo com fim de semana sombreado e a linha
// de "hoje". Tarefas sem prazo ficam listadas embaixo, para não sumirem.
export default function PlannerTimeline({ tarefas, hojeRef, onAbrir }) {
  const [inicio, setInicio] = useState(() => segundaDaSemana(hojeRef));
  const [dias, setDias] = useState(28);

  const { barras, semData } = useMemo(() => linhaDoTempo(tarefas, { inicio, dias }), [tarefas, inicio, dias]);
  const regua = useMemo(() => diasDaJanela(inicio, dias, { hoje: hojeRef }), [inicio, dias, hojeRef]);
  const meses = useMemo(() => {
    const grupos = [];
    for (const d of regua) {
      const chave = d.ymd.slice(0, 7);
      const ultimo = grupos[grupos.length - 1];
      if (ultimo?.chave === chave) ultimo.span++;
      else grupos.push({ chave, span: 1, label: `${MESES[Number(d.ymd.slice(5, 7)) - 1]} ${d.ymd.slice(0, 4)}` });
    }
    return grupos;
  }, [regua]);

  const fim = deslocarDias(inicio, dias - 1);
  const linhas = barras.length;
  // Linhas da grade: 1 = meses, 2 = régua, 3.. = tarefas (ou uma linha vazia).
  const totalLinhas = 2 + Math.max(1, linhas);

  return (
    <div className="plr-timeline">
      <div className="plr-timeline-nav">
        <button type="button" className="plr-icone" aria-label="Semana anterior" onClick={() => setInicio((i) => deslocarDias(i, -7))}><ChevronLeft size={16} /></button>
        <button type="button" className="plr-botao-suave" onClick={() => setInicio(segundaDaSemana(hojeRef))}>Hoje</button>
        <button type="button" className="plr-icone" aria-label="Próxima semana" onClick={() => setInicio((i) => deslocarDias(i, 7))}><ChevronRight size={16} /></button>
        <span className="plr-timeline-periodo">{dataLonga(inicio)} – {dataLonga(fim)}</span>
        <SegmentedControl
          size="sm"
          ariaLabel="Zoom da linha do tempo"
          value={dias}
          onChange={setDias}
          options={[{ value: 14, label: "2 semanas" }, { value: 28, label: "4 semanas" }, { value: 56, label: "8 semanas" }]}
        />
      </div>

      <div className="plr-gantt-wrap">
        <div
          className="plr-gantt"
          style={{ gridTemplateColumns: `minmax(200px, 260px) repeat(${dias}, var(--plr-dia))`, gridTemplateRows: `28px 34px repeat(${Math.max(1, linhas)}, 40px)` }}
        >
          {/* Fundo: uma célula por dia atravessando todas as linhas. */}
          {regua.map((d, i) => (
            <span
              key={`fundo-${d.ymd}`}
              className={`plr-gantt-dia${d.fimDeSemana ? " is-fds" : ""}${d.hoje ? " is-hoje" : ""}${d.inicioDeSemana ? " is-segunda" : ""}`}
              style={{ gridColumn: i + 2, gridRow: `1 / span ${totalLinhas}` }}
              aria-hidden="true"
            />
          ))}

          <div className="plr-gantt-canto" style={{ gridColumn: 1, gridRow: "1 / span 2" }}>Tarefa</div>
          {meses.map((m, i) => {
            const antes = meses.slice(0, i).reduce((s, x) => s + x.span, 0);
            return (
              <div key={m.chave} className="plr-gantt-mes" style={{ gridColumn: `${antes + 2} / span ${m.span}`, gridRow: 1 }}>{m.label}</div>
            );
          })}
          {regua.map((d, i) => (
            <div key={d.ymd} className={`plr-gantt-regua${d.hoje ? " is-hoje" : ""}`} style={{ gridColumn: i + 2, gridRow: 2 }} title={d.ymd}>
              <small>{DIAS_SEMANA[d.semana]}</small>
              <span>{d.dia}</span>
            </div>
          ))}

          {barras.length === 0 && (
            <p className="plr-gantt-vazio" style={{ gridColumn: `1 / span ${dias + 1}`, gridRow: 3 }}>
              Nenhuma tarefa com prazo neste período. Use as setas para navegar ou defina prazos nas tarefas.
            </p>
          )}

          {barras.map((b, i) => {
            const t = b.tarefa;
            const feita = t.progress === "concluida";
            return [
              <div key={`t-${t.id}`} className="plr-gantt-titulo" style={{ gridColumn: 1, gridRow: i + 3 }}>
                <button type="button" onClick={() => onAbrir(t)} title={t.title}>
                  <span className={`plr-gantt-ponto${feita ? " is-feita" : b.atrasada ? " is-atrasada" : ""}`} aria-hidden="true" />
                  <span className="plr-gantt-nome">{t.title}</span>
                </button>
              </div>,
              <div key={`b-${t.id}`} className="plr-gantt-celula" style={{ gridColumn: `2 / span ${dias}`, gridRow: i + 3 }} aria-hidden="true">
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${dias}, var(--plr-dia))`, height: "100%" }}>
                  <button
                    type="button"
                    className={`plr-gantt-barra${feita ? " is-feita" : ""}${b.atrasada ? " is-atrasada" : ""}${b.cortadaAntes ? " is-cortada-antes" : ""}${b.cortadaDepois ? " is-cortada-depois" : ""}`}
                    style={{ gridColumn: `${b.inicio + 1} / span ${b.largura}` }}
                    tabIndex={-1}
                    onClick={() => onAbrir(t)}
                    title={`${t.title} · ${t.startDate ? `${t.startDate} → ` : ""}${t.dueDate}`}
                  >
                    {b.largura >= 3 && <span className="plr-gantt-barra-texto">{t.title}</span>}
                    {t.assigneeLabel && b.largura >= 2 && <Avatar nome={t.assigneeLabel} tamanho={20} />}
                  </button>
                </div>
              </div>,
            ];
          })}
        </div>
      </div>

      {semData.length > 0 && (
        <div className="plr-timeline-semdata">
          <strong>Sem prazo <span>{semData.length}</span></strong>
          <p>Defina um prazo para a tarefa aparecer na linha do tempo.</p>
          <ul>
            {semData.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onAbrir(t)}>
                  <span className="plr-gantt-nome">{t.title}</span>
                  {t.assigneeLabel && <Avatar nome={t.assigneeLabel} tamanho={20} />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
