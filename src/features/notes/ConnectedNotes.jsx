import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  BookOpen,
  CalendarDays,
  Download,
  Layers,
  Link2,
  Network,
  NotebookPen,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  CARD_GRADES,
  backlinksFor,
  buildGraph,
  cardStats,
  cardsFromNote,
  dueCards,
  duplicateTitles,
  ensureDailyNote,
  exportAll,
  localGraph,
  makeNote,
  normalize,
  orphanNotes,
  parseTags,
  resolveTransclusions,
  reviewCard,
  suggestConnections,
  unlinkedMentions,
} from "./notesDomain.js";

const newId = () => `nt-${Math.random().toString(36).slice(2, 10)}`;
const hoje = () => new Date().toISOString().slice(0, 10);

// Desenha o grafo local num SVG simples, em círculo. Nada de biblioteca de
// grafo: são poucas dezenas de nós e o que importa é enxergar quem puxa quem.
// O desenho é só imagem: quem navega vai pela lista de botões abaixo dele.
// Círculo de 9px não é alvo de toque, e leitor de tela não lê <g> como botão.
const GraphView = ({ graph, centerId }) => {
  const { nodes, edges } = graph;
  if (!nodes.length) return null;
  const L = 300;
  const raio = 110;
  const centro = { x: L / 2, y: L / 2 };
  const volta = nodes.filter((n) => n.id !== centerId);
  const pos = new Map([[centerId, centro]]);
  volta.forEach((n, i) => {
    const ang = (2 * Math.PI * i) / Math.max(1, volta.length) - Math.PI / 2;
    pos.set(n.id, {
      x: centro.x + raio * Math.cos(ang),
      y: centro.y + raio * Math.sin(ang),
    });
  });

  return (
    <svg className="nt-graph" viewBox={`0 0 ${L} ${L}`} role="img" aria-label="Grafo de ligações">
      {edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className={e.missing ? "nt-edge ausente" : "nt-edge"}
          />
        );
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id);
        if (!p) return null;
        const atual = n.id === centerId;
        return (
          <g
            key={n.id}
            transform={`translate(${p.x},${p.y})`}
            className={`nt-node${atual ? " atual" : ""}${n.missing ? " ausente" : ""}`}
          >
            <circle r={atual ? 13 : 9} />
            <text y={atual ? 30 : 25}>{(n.title || "").slice(0, 18)}</text>
          </g>
        );
      })}
    </svg>
  );
};

export default function ConnectedNotes({ db, update, business, setToast, initialNoteId = "", onNavigate }) {
  const [aba, setAba] = useState("notas");
  const [selecionada, setSelecionada] = useState(initialNoteId);
  const [busca, setBusca] = useState("");
  const [rascunho, setRascunho] = useState(null);
  const [revendo, setRevendo] = useState(null);
  const [mostrandoVerso, setMostrandoVerso] = useState(false);

  const notas = useMemo(
    () =>
      (db.notes || []).filter(
        (n) => !business || !n.businessId || n.businessId === business.id,
      ),
    [db.notes, business],
  );
  const cartoes = useMemo(
    () =>
      (db.flashcards || []).filter(
        (c) => !business || !c.businessId || c.businessId === business.id,
      ),
    [db.flashcards, business],
  );

  const selecionadaId = selecionada || notas[0]?.id || "";
  const atual = useMemo(
    () => notas.find((n) => n.id === selecionadaId) || null,
    [notas, selecionadaId],
  );
  const draft =
    rascunho || (atual ? { title: atual.title, content: atual.content } : null);

  useEffect(() => {
    const id = setTimeout(
      () =>
        setRascunho(
          atual ? { title: atual.title, content: atual.content } : null,
        ),
      0,
    );
    return () => clearTimeout(id);
  }, [atual]);

  const filtradas = useMemo(() => {
    const q = normalize(busca);
    if (!q) return notas;
    return notas.filter(
      (n) => normalize(n.title).includes(q) || normalize(n.content).includes(q),
    );
  }, [notas, busca]);

  const salvarNotas = (proximas) => update({ ...db, notes: proximas });

  const criarNota = () => {
    const nova = makeNote(newId(), {
      title: "Nota sem título",
      content: "",
      businessId: business?.id || "",
    });
    salvarNotas([...(db.notes || []), nova]);
    setSelecionada(nova.id);
    setAba("notas");
  };

  const abrirDiario = () => {
    const r = ensureDailyNote(db.notes || [], hoje(), business?.id || "");
    if (r.created) {
      salvarNotas(r.notes);
      setToast?.("Nota do dia criada.");
    }
    setSelecionada(r.note.id);
    setAba("notas");
  };

  const gravarRascunho = () => {
    if (!atual || !draft) return;
    if (draft.title === atual.title && draft.content === atual.content) return;
    salvarNotas(
      (db.notes || []).map((n) =>
        n.id === atual.id
          ? {
              ...n,
              title: draft.title.trim() || "Nota sem título",
              content: draft.content,
              tags: parseTags(draft.content),
              updatedAt: new Date().toISOString(),
            }
          : n,
      ),
    );
  };

  const apagarNota = (id) => {
    if (!window.confirm("Apagar esta nota? As ligações para ela viram 'a criar'."))
      return;
    salvarNotas((db.notes || []).filter((n) => n.id !== id));
    if (selecionadaId === id) setSelecionada("");
  };

  // Cria a nota que ainda não existe, já com o título que foi citado.
  const criarAusente = (titulo) => {
    const nova = makeNote(newId(), {
      title: titulo,
      content: "",
      businessId: business?.id || "",
    });
    salvarNotas([...(db.notes || []), nova]);
    setSelecionada(nova.id);
    setToast?.(`Nota "${titulo}" criada.`);
  };

  // Transforma a menção solta em ligação de verdade, no texto de quem citou.
  const vincularMencao = (origemId, titulo) => {
    salvarNotas(
      (db.notes || []).map((n) => {
        if (n.id !== origemId) return n;
        const re = new RegExp(
          `(?<![\\p{L}\\p{N}\\[])(${titulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\p{L}\\p{N}\\]])`,
          "iu",
        );
        if (!re.test(n.content)) return n;
        return {
          ...n,
          content: n.content.replace(re, `[[$1]]`),
          updatedAt: new Date().toISOString(),
        };
      }),
    );
    setToast?.(`Ligação criada para "${titulo}".`);
  };

  const ligarNotas = (destinoTitulo) => {
    if (!atual) return;
    const texto = `${rascunho?.content || atual.content}\n\n[[${destinoTitulo}]]`;
    setRascunho((r) => ({ ...(r || {}), content: texto }));
    salvarNotas(
      (db.notes || []).map((n) =>
        n.id === atual.id
          ? { ...n, content: texto, updatedAt: new Date().toISOString() }
          : n,
      ),
    );
    setToast?.(`Ligada a "${destinoTitulo}".`);
  };

  const gerarCartoes = () => {
    if (!atual) return;
    const novos = cardsFromNote(atual, db.flashcards || []);
    if (!novos.length) {
      setToast?.('Escreva linhas no formato "pergunta :: resposta" na nota.');
      return;
    }
    update({ ...db, flashcards: [...(db.flashcards || []), ...novos] });
    setToast?.(`${novos.length} cartão(ões) criado(s).`);
  };

  const responder = (grade) => {
    if (!revendo) return;
    const atualizado = reviewCard(revendo, grade, hoje());
    update({
      ...db,
      flashcards: (db.flashcards || []).map((c) =>
        c.id === revendo.id ? atualizado : c,
      ),
    });
    setMostrandoVerso(false);
    const restantes = dueCards(
      (db.flashcards || []).map((c) => (c.id === revendo.id ? atualizado : c)),
      hoje(),
    ).filter((c) => c.id !== revendo.id);
    setRevendo(restantes[0] || null);
  };

  const exportarTudo = () => {
    const arquivos = exportAll(notas);
    if (!arquivos.length) {
      setToast?.("Não há notas para exportar.");
      return;
    }
    const juntos = arquivos
      .map((a) => `<!-- ${a.filename} -->\n${a.content}`)
      .join("\n\n---\n\n");
    const blob = new Blob([juntos], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `notas-${hoje()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setToast?.(`${arquivos.length} nota(s) exportada(s) em markdown.`);
  };

  const backlinks = useMemo(
    () => (atual ? backlinksFor(atual.id, notas) : []),
    [atual, notas],
  );
  const mencoes = useMemo(
    () => (atual ? unlinkedMentions(atual.id, notas) : []),
    [atual, notas],
  );
  const sugestoes = useMemo(
    () => (atual ? suggestConnections(atual.id, notas) : []),
    [atual, notas],
  );
  const grafoLocal = useMemo(
    () => (atual ? localGraph(atual.id, notas, 1) : { nodes: [], edges: [] }),
    [atual, notas],
  );
  const previa = useMemo(
    () =>
      atual
        ? resolveTransclusions(draft?.content ?? atual.content, notas)
        : { text: "", warnings: [] },
    [atual, draft?.content, notas],
  );
  const ausentes = useMemo(
    () => buildGraph(notas).nodes.filter((n) => n.missing),
    [notas],
  );
  const orfas = useMemo(() => orphanNotes(notas), [notas]);
  const repetidas = useMemo(() => duplicateTitles(notas), [notas]);
  const stats = useMemo(() => cardStats(cartoes, hoje()), [cartoes]);

  const abas = [
    ["notas", "Notas", BookOpen],
    ["grafo", "Rede de ideias", Network],
    ["revisao", "Revisão", Layers],
    ["saude", "Saúde da rede", ArrowLeftRight],
  ];

  return (
    <section className="section nt">
      <header className="section-head">
        <div>
          <h2>Conhecimento conectado</h2>
          <p className="muted">
            Suas anotações formam uma rede: cite uma nota dentro da outra — pelo
            botão “Citar nota” — e as duas passam a se enxergar, nos dois sentidos.
          </p>
        </div>
        <div className="nt-actions">
          <button type="button" className="btn" onClick={abrirDiario}>
            <CalendarDays size={16} /> Nota de hoje
          </button>
          <button type="button" className="btn primary" onClick={criarNota}>
            <NotebookPen size={16} /> Nova nota
          </button>
        </div>
      </header>

      <div className="nt-tabs" role="tablist">
        {abas.map(([id, rotulo, Icone]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aba === id}
            className={aba === id ? "active" : ""}
            onClick={() => setAba(id)}
          >
            <Icone size={15} /> {rotulo}
          </button>
        ))}
      </div>

      {aba === "notas" && (
        <div className="nt-layout">
          <aside className="nt-list">
            <label className="nt-search">
              <Search size={15} />
              <input
                aria-label="Buscar nota"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar nota"
              />
            </label>
            {!filtradas.length && (
              <p className="muted nt-empty">
                {notas.length
                  ? "Nenhuma nota com esse termo."
                  : "Ainda não há notas. Comece pela nota de hoje."}
              </p>
            )}
            <ul>
              {filtradas.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={n.id === selecionadaId ? "active" : ""}
                    onClick={() => {
                      gravarRascunho();
                      setSelecionada(n.id);
                    }}
                  >
                    <strong>{n.title}</strong>
                    {n.kind === "diaria" && <span className="nt-chip">diário</span>}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="nt-editor">
            {!atual && <p className="muted">Escolha ou crie uma nota.</p>}
            {atual && draft && (
              <>
                <input
                  className="nt-title"
                  aria-label="Título da nota"
                  value={draft.title}
                  onChange={(e) =>
                    setRascunho((r) => ({ ...r, title: e.target.value }))
                  }
                  onBlur={gravarRascunho}
                />
                {(atual.linkedEntities || []).length > 0 && (
                  <div className="nt-linked-entities" aria-label="Registros conectados">
                    <Link2 size={15} />
                    {(atual.linkedEntities || []).map((entity) => (
                      <button
                        type="button"
                        onClick={() => entity.route && onNavigate?.(entity.route)}
                        disabled={!entity.route || !onNavigate}
                        key={`${entity.type}-${entity.id}`}
                      >
                        {entity.type === "client" ? "Cliente" : "Oportunidade"}: {entity.name || entity.id}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  className="nt-body"
                  aria-label="Conteúdo da nota"
                  rows={14}
                  value={draft.content}
                  onChange={(e) =>
                    setRascunho((r) => ({ ...r, content: e.target.value }))
                  }
                  onBlur={gravarRascunho}
                  placeholder={
                    "Escreva livremente.\n\nPara ligar esta anotação a outra, use “Citar nota” aqui embaixo.\n#etiqueta organiza os assuntos.\nUma linha “pergunta :: resposta” vira cartão de revisão."
                  }
                />
                <div className="nt-editor-actions">
                  <label className="nt-citar">
                    <Link2 size={15} />
                    <select
                      aria-label="Citar outra nota"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) ligarNotas(e.target.value);
                      }}
                    >
                      <option value="">Citar nota…</option>
                      {notas
                        .filter((n) => n.id !== atual.id)
                        .map((n) => (
                          <option key={n.id} value={n.title}>
                            {n.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button type="button" className="btn" onClick={gerarCartoes}>
                    <Layers size={15} /> Gerar cartões desta nota
                  </button>
                  <button type="button" className="btn" onClick={exportarTudo}>
                    <Download size={15} /> Baixar todas as notas
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => apagarNota(atual.id)}
                  >
                    <Trash2 size={15} /> Apagar
                  </button>
                </div>

                {previa.warnings.length > 0 && (
                  <div className="nt-warn">
                    {previa.warnings.map((w, i) => (
                      <p key={i}>
                        {w.type === "ciclo" &&
                          `A nota "${w.title}" embute a si mesma. Parei ali para a tela não travar.`}
                        {w.type === "ausente" &&
                          `A nota "${w.title}" ainda não existe.`}
                        {w.type === "bloco-ausente" &&
                          `O bloco "${w.anchor}" não existe em "${w.title}".`}
                      </p>
                    ))}
                  </div>
                )}

                <div className="nt-panels">
                  <section>
                    <h3>
                      <Link2 size={15} /> Citada em ({backlinks.length})
                    </h3>
                    {!backlinks.length && (
                      <p className="muted">Nenhuma nota aponta para esta ainda.</p>
                    )}
                    <ul className="nt-refs">
                      {backlinks.map(({ note, excerpt }) => (
                        <li key={note.id}>
                          <button type="button" onClick={() => setSelecionada(note.id)}>
                            {note.title}
                          </button>
                          <span className="muted">{excerpt}</span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section>
                    <h3>Citada sem ligação ({mencoes.length})</h3>
                    {!mencoes.length && (
                      <p className="muted">
                        Nenhuma nota escreve este nome sem ligar.
                      </p>
                    )}
                    <ul className="nt-refs">
                      {mencoes.map(({ note, excerpt }) => (
                        <li key={note.id}>
                          <button type="button" onClick={() => setSelecionada(note.id)}>
                            {note.title}
                          </button>
                          <span className="muted">{excerpt}</span>
                          <button
                            type="button"
                            className="btn tiny"
                            onClick={() => vincularMencao(note.id, atual.title)}
                          >
                            Ligar
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section>
                    <h3>
                      <Sparkles size={15} /> Pode ter a ver ({sugestoes.length})
                    </h3>
                    {!sugestoes.length && (
                      <p className="muted">
                        Escreva mais e a rede começa a sugerir ligações sozinha.
                      </p>
                    )}
                    <ul className="nt-refs">
                      {sugestoes.map(({ note, shared }) => (
                        <li key={note.id}>
                          <button type="button" onClick={() => setSelecionada(note.id)}>
                            {note.title}
                          </button>
                          <span className="muted">
                            em comum: {shared.join(", ")}
                          </span>
                          <button
                            type="button"
                            className="btn tiny"
                            onClick={() => ligarNotas(note.title)}
                          >
                            Ligar
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {aba === "grafo" && (
        <div className="nt-graph-wrap">
          {!atual && <p className="muted">Escolha uma nota para ver a rede dela.</p>}
          {atual && (
            <>
              <p className="muted">
                A rede em volta de <strong>{atual.title}</strong>. Círculo vazado é
                nota citada que ainda não existe.
              </p>
              <GraphView graph={grafoLocal} centerId={atual.id} />
              <ul className="nt-graph-links">
                {grafoLocal.nodes
                  .filter((n) => n.id !== atual.id)
                  .map((n) =>
                    n.missing ? (
                      <li key={n.id}>
                        <span className="muted">{n.title} — ainda não existe</span>
                        <button
                          type="button"
                          className="btn tiny"
                          onClick={() => criarAusente(n.title)}
                        >
                          Criar
                        </button>
                      </li>
                    ) : (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelecionada(n.id);
                            setAba("notas");
                          }}
                        >
                          {n.title}
                        </button>
                      </li>
                    ),
                  )}
                {grafoLocal.nodes.length <= 1 && (
                  <li className="muted">
                    Esta nota ainda não se liga a nenhuma outra.
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}

      {aba === "revisao" && (
        <div className="nt-review">
          <div className="nt-cards-stats">
            <article>
              <small>Total</small>
              <strong>{stats.total}</strong>
            </article>
            <article>
              <small>Para hoje</small>
              <strong>{stats.paraHoje}</strong>
            </article>
            <article>
              <small>Nunca revisados</small>
              <strong>{stats.novos}</strong>
            </article>
            <article>
              <small>Difíceis</small>
              <strong>{stats.dificeis}</strong>
            </article>
          </div>

          {!stats.total && (
            <p className="muted">
              Nenhum cartão ainda. Numa nota, escreva uma linha no formato
              “pergunta :: resposta” e use “Gerar cartões desta nota”.
            </p>
          )}

          {stats.total > 0 && !revendo && (
            <button
              type="button"
              className="btn primary"
              disabled={!stats.paraHoje}
              onClick={() => {
                setRevendo(dueCards(cartoes, hoje())[0] || null);
                setMostrandoVerso(false);
              }}
            >
              {stats.paraHoje
                ? `Revisar ${stats.paraHoje} cartão(ões)`
                : "Nada para revisar hoje"}
            </button>
          )}

          {revendo && (
            <div className="nt-card">
              <p className="nt-card-front">{revendo.front}</p>
              {!mostrandoVerso && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setMostrandoVerso(true)}
                >
                  Mostrar resposta
                </button>
              )}
              {mostrandoVerso && (
                <>
                  <p className="nt-card-back">{revendo.back}</p>
                  <div className="nt-grades">
                    {CARD_GRADES.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        className="btn"
                        onClick={() => responder(g.id)}
                        title={g.hint}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {aba === "saude" && (
        <div className="nt-health">
          <section>
            <h3>Citadas mas ainda não escritas ({ausentes.length})</h3>
            <p className="muted">
              Você mencionou estas notas em algum texto. Elas ainda não existem.
            </p>
            <ul className="nt-refs">
              {ausentes.map((n) => (
                <li key={n.id}>
                  <span>{n.title}</span>
                  <button
                    type="button"
                    className="btn tiny"
                    onClick={() => criarAusente(n.title)}
                  >
                    Criar
                  </button>
                </li>
              ))}
            </ul>
            {!ausentes.length && <p className="muted">Nenhuma pendente.</p>}
          </section>

          <section>
            <h3>Soltas na rede ({orfas.length})</h3>
            <p className="muted">
              Ninguém cita e elas não citam ninguém. Não é erro, é só um aviso de
              que ficaram fora da rede.
            </p>
            <ul className="nt-refs">
              {orfas.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => { setSelecionada(n.id); setAba("notas"); }}>
                    {n.title}
                  </button>
                </li>
              ))}
            </ul>
            {!orfas.length && <p className="muted">Nenhuma solta.</p>}
          </section>

          <section>
            <h3>Títulos repetidos ({repetidas.length})</h3>
            <p className="muted">
              Título repetido deixa a ligação ambígua: quem cita esse nome não
              sabe para qual das duas notas ir.
            </p>
            <ul className="nt-refs">
              {repetidas.map((r) => (
                <li key={r.key}>
                  <span>
                    {r.title} — {r.notes.length} notas
                  </span>
                </li>
              ))}
            </ul>
            {!repetidas.length && <p className="muted">Nenhum repetido.</p>}
          </section>
        </div>
      )}
    </section>
  );
}
