import { useMemo, useRef, useState } from "react";
import {
  CheckSquare,
  Download,
  Eraser,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  PEN_COLORS,
  PEN_TOOLS,
  REACTIONS,
  applyRuler,
  eraseAt,
  makeNote,
  makeStroke,
  makeWhiteboard,
  notesToTasks,
  reactionCount,
  recognizeShape,
  shapeToPoints,
  simplifyStroke,
  strokeToPath,
  toggleReaction,
  toolSpec,
  whiteboardToSvg,
} from "./whiteboardDomain.js";

const newId = () => `w-${Math.random().toString(36).slice(2, 10)}`;

export default function QuickWhiteboard({ db, update, business, setToast }) {
  const [selecionadoId, setSelecionadoId] = useState(null);
  const [ferramenta, setFerramenta] = useState("caneta");
  const [cor, setCor] = useState(PEN_COLORS[0]);
  const [reconhecer, setReconhecer] = useState(true);
  const [emCurso, setEmCurso] = useState(null);
  const areaRef = useRef(null);
  const desenhando = useRef(false);

  const quadros = useMemo(
    () =>
      (db.whiteboards || []).filter(
        (q) => !business || q.businessId === business.id,
      ),
    [db.whiteboards, business],
  );
  const quadro = quadros.find((q) => q.id === selecionadoId) || quadros[0] || null;
  const strokes = quadro?.strokes || [];
  const notes = quadro?.notes || [];

  // Salva a cada traço concluído: quadro de reunião não pode depender de
  // ninguém lembrar de salvar.
  const patch = (campos) =>
    update((prev) => ({
      ...prev,
      whiteboards: (prev.whiteboards || []).map((q) =>
        q.id === quadro.id
          ? { ...q, ...campos, updatedAt: new Date().toISOString() }
          : q,
      ),
    }));

  const criar = () => {
    const q = makeWhiteboard(newId(), {
      businessId: business?.id || null,
      ownerId: db.user?.id || null,
    });
    update((prev) => ({
      ...prev,
      whiteboards: [q, ...(prev.whiteboards || [])],
    }));
    setSelecionadoId(q.id);
  };

  const excluir = (id) => {
    if (!window.confirm("Excluir este quadro e o que está desenhado nele?")) return;
    update((prev) => ({
      ...prev,
      whiteboards: (prev.whiteboards || []).filter((q) => q.id !== id),
    }));
    setSelecionadoId(null);
  };

  const posicao = (event) => {
    const caixa = areaRef.current?.getBoundingClientRect();
    const toque = event.touches?.[0];
    const cx = toque ? toque.clientX : event.clientX;
    const cy = toque ? toque.clientY : event.clientY;
    return { x: cx - (caixa?.left || 0), y: cy - (caixa?.top || 0) };
  };

  const comecar = (event) => {
    if (!quadro) return;
    const ponto = posicao(event);
    if (ferramenta === "borracha") {
      desenhando.current = true;
      patch({ strokes: eraseAt(strokes, ponto, 14) });
      return;
    }
    desenhando.current = true;
    setEmCurso({ tool: ferramenta, color: cor, points: [ponto] });
  };

  const mover = (event) => {
    if (!desenhando.current || !quadro) return;
    const ponto = posicao(event);
    if (ferramenta === "borracha") {
      patch({ strokes: eraseAt(strokes, ponto, 14) });
      return;
    }
    event.preventDefault?.();
    setEmCurso((atual) =>
      atual ? { ...atual, points: [...atual.points, ponto] } : atual,
    );
  };

  const terminar = () => {
    desenhando.current = false;
    if (!emCurso || !quadro) {
      setEmCurso(null);
      return;
    }
    let pontos = emCurso.points;
    let avisou = "";
    if (emCurso.tool === "regua") pontos = applyRuler(pontos);
    else if (reconhecer) {
      const forma = recognizeShape(pontos);
      if (forma) {
        pontos = shapeToPoints(forma);
        avisou = forma.kind;
      } else pontos = simplifyStroke(pontos, 1.5);
    } else pontos = simplifyStroke(pontos, 1.5);

    patch({
      strokes: [
        ...strokes,
        makeStroke({
          id: newId(),
          tool: emCurso.tool === "regua" ? "caneta" : emCurso.tool,
          color: emCurso.color,
          points: pontos,
        }),
      ],
    });
    setEmCurso(null);
    if (avisou) setToast(`Virou ${avisou}`);
  };

  const desfazer = () => {
    if (strokes.length === 0) return;
    patch({ strokes: strokes.slice(0, -1) });
  };

  const adicionarNota = () => {
    patch({
      notes: [
        ...notes,
        makeNote({ id: newId(), x: 30 + notes.length * 20, y: 40 + notes.length * 30 }),
      ],
    });
  };

  const reagir = (noteId, emoji) =>
    patch({
      notes: notes.map((n) =>
        n.id === noteId ? toggleReaction(n, emoji, db.user?.id || "eu") : n,
      ),
    });

  const criarTarefas = () => {
    const tarefas = notesToTasks(notes, { boardName: quadro?.name });
    if (tarefas.length === 0) {
      setToast("Escreva algo nas notas antes de criar tarefas.");
      return;
    }
    update((prev) => ({
      ...prev,
      tasks: [
        ...tarefas.map((t) => ({
          id: newId(),
          title: t.title,
          status: "pendente",
          due: "",
          notes: t.notes,
          businessId: business?.id || null,
          ownerId: db.user?.id || null,
          whiteboardId: quadro.id,
        })),
        ...(prev.tasks || []),
      ],
    }));
    setToast(
      `${tarefas.length} ${tarefas.length === 1 ? "tarefa criada" : "tarefas criadas"}`,
    );
  };

  const exportarSvg = () => {
    const svg = whiteboardToSvg(strokes, notes);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(quadro.name || "quadro").replace(/[^\w-]+/g, "-")}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
    setToast("Quadro exportado em SVG");
  };

  if (!quadro)
    return (
      <section className="qwb">
        <header className="qwb-head">
          <div>
            <h2>Quadro rápido</h2>
            <p>
              Para rabiscar durante uma reunião: caneta, marca-texto, régua e
              borracha. O que você desenha torto vira forma limpa.
            </p>
          </div>
          <button className="btn" onClick={criar}>
            <Plus size={16} /> Novo quadro
          </button>
        </header>
        <div className="qwb-empty">
          <h3>Nenhum quadro rápido ainda</h3>
          <p>
            Diferente do Quadro visual, este é para desenhar à mão livre — com o
            dedo, o mouse ou a caneta do tablet. Salva sozinho a cada traço.
          </p>
        </div>
      </section>
    );

  return (
    <section className="qwb">
      <header className="qwb-head">
        <div className="qwb-picker">
          <select
            aria-label="Quadro rápido"
            value={quadro.id}
            onChange={(e) => setSelecionadoId(e.target.value)}
          >
            {quadros.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
          <input
            aria-label="Nome do quadro rápido"
            value={quadro.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
          <button className="btn ghost sm" onClick={criar}>
            <Plus size={14} /> Novo
          </button>
          <button
            className="btn ghost sm danger"
            onClick={() => excluir(quadro.id)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <div className="qwb-tools">
        {PEN_TOOLS.map((t) => (
          <button
            key={t.id}
            className={ferramenta === t.id ? "active" : ""}
            onClick={() => setFerramenta(t.id)}
          >
            {t.id === "borracha" ? <Eraser size={14} /> : null}
            {t.label}
          </button>
        ))}
        <span className="qwb-sep" />
        <div className="qwb-colors">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              style={{ background: c }}
              className={cor === c ? "active" : ""}
              aria-label={`Cor ${c}`}
              onClick={() => setCor(c)}
            />
          ))}
        </div>
        <span className="qwb-sep" />
        <label className="qwb-recognize">
          <input
            type="checkbox"
            checked={reconhecer}
            onChange={(e) => setReconhecer(e.target.checked)}
          />
          <Sparkles size={13} /> Endireitar formas
        </label>
        <button className="btn ghost sm" onClick={desfazer}>
          <Undo2 size={14} /> Desfazer
        </button>
        <button className="btn ghost sm" onClick={adicionarNota}>
          <StickyNote size={14} /> Nota
        </button>
        <button className="btn ghost sm" onClick={criarTarefas}>
          <CheckSquare size={14} /> Virar tarefas
        </button>
        <button className="btn ghost sm" onClick={exportarSvg}>
          <Download size={14} /> SVG
        </button>
      </div>

      <div
        className="qwb-area"
        ref={areaRef}
        role="button"
        tabIndex={0}
        aria-label="Quadro branco"
        onKeyDown={(event) => {
          if (event.key === "Escape") terminar();
        }}
        onMouseDown={comecar}
        onMouseMove={mover}
        onMouseUp={terminar}
        onMouseLeave={terminar}
        onTouchStart={comecar}
        onTouchMove={mover}
        onTouchEnd={terminar}
      >
        <svg className="qwb-canvas" aria-label="Área de desenho">
          {strokes.map((s) => {
            const spec = toolSpec(s.tool);
            return (
              <path
                key={s.id}
                d={strokeToPath(s.points)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width || spec.width}
                strokeOpacity={spec.opacity}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
          {emCurso && (
            <path
              d={strokeToPath(emCurso.points)}
              fill="none"
              stroke={emCurso.color}
              strokeWidth={toolSpec(emCurso.tool).width}
              strokeOpacity={toolSpec(emCurso.tool).opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
        {notes.map((n) => (
          <div
            key={n.id}
            className="qwb-note"
            style={{ left: n.x, top: n.y }}
            role="button"
            tabIndex={0}
            aria-label="Cartão da nota"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <textarea
              aria-label="Nota do quadro"
              value={n.text}
              placeholder="Anotação"
              onChange={(e) =>
                patch({
                  notes: notes.map((x) =>
                    x.id === n.id ? { ...x, text: e.target.value } : x,
                  ),
                })
              }
            />
            <div className="qwb-reactions">
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => reagir(n.id, emoji)}
                  aria-label={`Reagir ${emoji}`}
                >
                  {emoji}
                  {reactionCount(n, emoji) > 0 && (
                    <em>{reactionCount(n, emoji)}</em>
                  )}
                </button>
              ))}
              <button
                className="qwb-note-del"
                aria-label="Excluir nota"
                onClick={() =>
                  patch({ notes: notes.filter((x) => x.id !== n.id) })
                }
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="qwb-hint">
        Salva sozinho a cada traço, então dá para retomar depois.{" "}
        <strong>Reconhecimento de escrita à mão não está incluído</strong> ainda,
        nem a edição simultânea entre pessoas: o quadro é de uma pessoa por vez.
      </p>
    </section>
  );
}
