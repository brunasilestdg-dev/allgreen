import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BrainCog,
  Copy,
  Download,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  MEMORY_SCOPES,
  detectSensitive,
  exportMemories,
  findConflicts,
  isStale,
  makeMemory,
  staleMemories,
} from "./memoryDomain.js";
import {
  SEARCHABLE_SOURCES,
  buildAnswerPrompt,
  buildIndex,
  findDuplicates,
  makeGlossaryEntry,
  searchWorkspace,
  staleContent,
} from "./searchDomain.js";
import { fundirResultados } from "./semanticDomain.js";
import { buscarPorSignificado } from "./semanticSearch.js";

const newId = () => `k-${Math.random().toString(36).slice(2, 10)}`;
const hoje = () => new Date().toISOString().slice(0, 10);

// Realça as marcas «» que o trecho traz da busca.
const Trecho = ({ texto }) => (
  <span className="kc-snippet">
    {String(texto || "")
      .split(/(«[^»]*»)/g)
      .map((parte, i) =>
        parte.startsWith("«") ? (
          <mark key={i}>{parte.slice(1, -1)}</mark>
        ) : (
          <span key={i}>{parte}</span>
        ),
      )}
  </span>
);

export default function KnowledgeCenter({ db, update, business, setToast, go }) {
  const [aba, setAba] = useState("busca");
  const [consulta, setConsulta] = useState("");
  const [fonteFiltro, setFonteFiltro] = useState("");
  const [resposta, setResposta] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [nova, setNova] = useState({ text: "", scope: "empresa", scopeRef: "", required: false });
  const [novoTermo, setNovoTermo] = useState({ term: "", synonyms: "" });

  const glossario = useMemo(() => db.glossary || [], [db.glossary]);
  const memorias = useMemo(
    () =>
      (db.memories || []).filter(
        (m) => !business || !m.businessId || m.businessId === business.id,
      ),
    [db.memories, business],
  );

  const busca = useMemo(
    () =>
      consulta.trim()
        ? searchWorkspace(db, consulta, {
            businessId: business?.id || null,
            userId: db.user?.id || null,
            glossary: glossario,
            sources: fonteFiltro ? [fonteFiltro] : [],
            limit: 25,
          })
        : { results: [], tokens: [], total: 0 },
    [db, consulta, business, glossario, fonteFiltro],
  );

  // Busca por significado (bge-m3): roda um instante depois que a pessoa para
  // de digitar e soma ao resultado por palavra. Sem ela (servidor sem IA,
  // cota do dia), a tela fica exatamente como era.
  const [significado, setSignificado] = useState({ estado: "ocioso" });
  const dbRef = useRef(db);
  useEffect(() => {
    dbRef.current = db;
  }, [db]);
  const businessId = business?.id || null;
  useEffect(() => {
    const pergunta = consulta.trim();
    if (pergunta.length < 3) return undefined;
    let ativo = true;
    const espera = setTimeout(async () => {
      setSignificado({ estado: "buscando", consulta: pergunta, fonte: fonteFiltro });
      try {
        const atual = dbRef.current;
        let docs = buildIndex(atual, { businessId, userId: atual.user?.id || null });
        if (fonteFiltro) docs = docs.filter((d) => d.sourceId === fonteFiltro);
        const achado = await buscarPorSignificado(docs, pergunta, { userId: atual.user?.id || "anonimo" });
        if (ativo) setSignificado({ estado: "pronto", consulta: pergunta, fonte: fonteFiltro, ...achado });
      } catch {
        if (ativo) setSignificado({ estado: "indisponivel", consulta: pergunta, fonte: fonteFiltro });
      }
    }, 700);
    return () => {
      ativo = false;
      clearTimeout(espera);
    };
  }, [consulta, fonteFiltro, businessId]);

  // Resposta de uma consulta (ou área) que já mudou não vale mais: em vez de
  // zerar o estado a cada tecla, a tela só usa o que é da busca atual.
  const significadoAtual =
    significado.consulta === consulta.trim() && significado.fonte === fonteFiltro
      ? significado
      : { estado: "ocioso" };
  const resultados = useMemo(
    () =>
      significadoAtual.estado === "pronto"
        ? fundirResultados(busca.results, significadoAtual.resultados, { limite: 25 })
        : busca.results,
    [busca.results, significadoAtual.estado, significadoAtual.resultados],
  );
  const soPorSignificado = resultados.filter((r) => r.origem === "significado").length;

  const conflitos = useMemo(() => findConflicts(memorias), [memorias]);
  const vencidas = useMemo(() => staleMemories(memorias, hoje()), [memorias]);
  const duplicados = useMemo(
    () => findDuplicates(db, { businessId: business?.id || null }).slice(0, 8),
    [db, business],
  );
  const velhos = useMemo(
    () =>
      staleContent(db, hoje(), { businessId: business?.id || null, days: 180 }).slice(0, 8),
    [db, business],
  );
  const sensiveisNaNova = detectSensitive(nova.text);

  const salvarMemoria = () => {
    if (!nova.text.trim()) return;
    const m = makeMemory(newId(), {
      ...nova,
      businessId: business?.id || null,
      ownerId: db.user?.id || null,
    });
    update((prev) => ({ ...prev, memories: [m, ...(prev.memories || [])] }));
    setNova({ text: "", scope: "empresa", scopeRef: "", required: false });
    setToast(
      m.approved
        ? "Memória guardada"
        : "Memória guardada, mas precisa da sua aprovação por conter dado sensível",
    );
  };

  const patchMemoria = (id, campos) =>
    update((prev) => ({
      ...prev,
      memories: (prev.memories || []).map((m) =>
        m.id === id ? { ...m, ...campos } : m,
      ),
    }));

  const apagarMemoria = (id) => {
    if (!window.confirm("Apagar esta memória? A IA deixa de considerá-la.")) return;
    update((prev) => ({
      ...prev,
      memories: (prev.memories || []).filter((m) => m.id !== id),
    }));
    setToast("Memória apagada");
  };

  const exportar = () => {
    const blob = new Blob([exportMemories(memorias)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "memorias-seu-funcionario.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setToast("Memórias exportadas");
  };

  const adicionarTermo = () => {
    if (!novoTermo.term.trim()) return;
    const entrada = makeGlossaryEntry(newId(), {
      term: novoTermo.term,
      synonyms: novoTermo.synonyms.split(",").map((s) => s.trim()).filter(Boolean),
    });
    update((prev) => ({ ...prev, glossary: [...(prev.glossary || []), entrada] }));
    setNovoTermo({ term: "", synonyms: "" });
    setToast("Termo adicionado ao glossário");
  };

  const perguntarComCitacoes = async () => {
    if (resultados.length === 0) {
      setToast("Busque algo primeiro — a resposta só usa o que está no seu workspace.");
      return;
    }
    setOcupado(true);
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: buildAnswerPrompt(consulta, resultados),
        }),
      });
      const dados = await r.json();
      // /api/ai responde `content` (publicAiResult). Ler só text/reply/result
      // fazia o botão dizer sempre que a IA não tinha conseguido responder.
      const texto = dados?.content || dados?.text || dados?.reply || dados?.result || "";
      if (!r.ok || !texto) {
        setToast(dados?.error || "A IA não conseguiu responder agora.");
        return;
      }
      setResposta({ texto, fontes: resultados.slice(0, 6) });
    } catch {
      setToast("Não foi possível falar com a IA agora.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="kc">
      <header className="kc-head">
        <div>
          <h2>
            <BrainCog size={20} /> Memória e busca
          </h2>
          <p>
            Busca por significado em tudo o que está no app, com a fonte de cada
            resultado. E o controle do que a IA lembra sobre você e o negócio —
            para ver, corrigir e apagar.
          </p>
        </div>
        <div className="kc-tabs">
          <button
            className={aba === "busca" ? "active" : ""}
            onClick={() => setAba("busca")}
          >
            Busca
          </button>
          <button
            className={aba === "memoria" ? "active" : ""}
            onClick={() => setAba("memoria")}
          >
            Memória da IA
          </button>
          <button
            className={aba === "saude" ? "active" : ""}
            onClick={() => setAba("saude")}
          >
            Saúde do conteúdo
          </button>
        </div>
      </header>

      {aba === "busca" && (
        <>
          <div className="kc-search">
            <Search size={16} />
            <input
              aria-label="Buscar no workspace"
              placeholder="O que você procura? Ex.: pagamento do cliente, nota fiscal"
              value={consulta}
              onChange={(e) => {
                setConsulta(e.target.value);
                setResposta(null);
              }}
            />
            <select
              aria-label="Filtrar por área"
              value={fonteFiltro}
              onChange={(e) => setFonteFiltro(e.target.value)}
            >
              <option value="">Todas as áreas</option>
              {SEARCHABLE_SOURCES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <button
              className="btn"
              onClick={perguntarComCitacoes}
              disabled={ocupado || resultados.length === 0}
            >
              <Sparkles size={15} />
              {ocupado ? "Pensando..." : "Responder com citações"}
            </button>
          </div>

          {resposta && (
            <div className="kc-answer">
              <p>{resposta.texto}</p>
              <ol>
                {resposta.fontes.map((f) => (
                  <li key={f.id}>
                    <button onClick={() => go?.(f.sourcePage || "memoria-busca")}>
                      {f.sourceLabel} — {f.title}
                    </button>
                  </li>
                ))}
              </ol>
              <small>
                A resposta só pode usar estes trechos. Se a informação não estava
                aqui, ela diz que não encontrou em vez de inventar.
              </small>
            </div>
          )}

          {consulta.trim() && (
            <p className="kc-count">
              {busca.total === 0 && soPorSignificado === 0
                ? significadoAtual.estado === "buscando"
                  ? "Procurando também pelo significado..."
                  : "Nada encontrado no seu workspace."
                : `${busca.total + soPorSignificado} ${busca.total + soPorSignificado === 1 ? "resultado" : "resultados"}`}
              {soPorSignificado > 0 &&
                ` · ${soPorSignificado} ${soPorSignificado === 1 ? "achado" : "achados"} pelo significado`}
            </p>
          )}
          {significadoAtual.estado === "pronto" &&
            significadoAtual.indexados < significadoAtual.total && (
              <p className="kc-hint">
                Preparando a busca por significado: {significadoAtual.indexados} de{" "}
                {significadoAtual.total} itens prontos. Os demais entram nas próximas buscas.
              </p>
            )}

          <ul className="kc-results">
            {resultados.map((r) => (
              <li key={r.id}>
                <header>
                  <span className="kc-source">{r.sourceLabel}</span>
                  <strong>{r.title}</strong>
                  {r.origem === "significado" && (
                    <span className="kc-origem" title="Não tem a palavra buscada, mas fala do mesmo assunto">
                      pelo significado
                    </span>
                  )}
                </header>
                <Trecho texto={r.snippet} />
                <footer>
                  <button className="btn ghost sm" onClick={() => go?.(r.sourcePage || "memoria-busca")}>
                    Abrir {r.sourceLabel}
                  </button>
                  {r.updatedAt && <small>{String(r.updatedAt).slice(0, 10)}</small>}
                </footer>
              </li>
            ))}
          </ul>

          <div className="kc-glossary">
            <h3>Glossário da empresa</h3>
            <p className="kc-hint">
              Ensine as siglas do seu negócio. Se NF significa nota fiscal, a
              busca encontra também o que está escrito por extenso.
            </p>
            <div className="kc-glossary-form">
              <input
                aria-label="Termo"
                placeholder="nota fiscal"
                value={novoTermo.term}
                onChange={(e) => setNovoTermo({ ...novoTermo, term: e.target.value })}
              />
              <input
                aria-label="Sinônimos separados por vírgula"
                placeholder="NF, nfe, notinha"
                value={novoTermo.synonyms}
                onChange={(e) =>
                  setNovoTermo({ ...novoTermo, synonyms: e.target.value })
                }
              />
              <button className="btn ghost sm" onClick={adicionarTermo}>
                <Plus size={14} /> Adicionar
              </button>
            </div>
            <ul className="kc-terms">
              {glossario.map((g) => (
                <li key={g.id}>
                  <strong>{g.term}</strong>
                  <span>{(g.synonyms || []).join(", ")}</span>
                  <button
                    className="btn ghost sm danger"
                    aria-label={`Remover ${g.term}`}
                    onClick={() =>
                      update((prev) => ({
                        ...prev,
                        glossary: (prev.glossary || []).filter((x) => x.id !== g.id),
                      }))
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {aba === "memoria" && (
        <>
          <div className="kc-new-memory">
            <textarea
              aria-label="Nova memória"
              rows={2}
              placeholder="Ex.: Coletas fechadas até as 14h saem para entrega no mesmo dia útil."
              value={nova.text}
              onChange={(e) => setNova({ ...nova, text: e.target.value })}
            />
            <div className="kc-new-row">
              <label>
                Vale para
                <select
                  value={nova.scope}
                  onChange={(e) => setNova({ ...nova, scope: e.target.value })}
                >
                  {MEMORY_SCOPES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {["projeto", "cliente", "especialista"].includes(nova.scope) && (
                <label>
                  Qual
                  <input
                    value={nova.scopeRef}
                    onChange={(e) => setNova({ ...nova, scopeRef: e.target.value })}
                  />
                </label>
              )}
              <label className="kc-check">
                <input
                  type="checkbox"
                  checked={nova.required}
                  onChange={(e) => setNova({ ...nova, required: e.target.checked })}
                />
                Sempre considerar
              </label>
              <button className="btn" onClick={salvarMemoria} disabled={!nova.text.trim()}>
                <Plus size={15} /> Guardar
              </button>
            </div>
            {sensiveisNaNova.length > 0 && (
              <p className="kc-sensitive">
                <AlertTriangle size={14} /> Isso contém{" "}
                {sensiveisNaNova.map((s) => s.label).join(", ")}. Vai ficar
                guardado como <strong>pendente</strong> e a IA não usa até você
                aprovar.
              </p>
            )}
          </div>

          {conflitos.length > 0 && (
            <div className="kc-conflicts">
              <strong>
                <AlertTriangle size={14} /> Memórias que se batem
              </strong>
              <ul>
                {conflitos.slice(0, 5).map((c) => {
                  const a = memorias.find((m) => m.id === c.a);
                  const b = memorias.find((m) => m.id === c.b);
                  if (!a || !b) return null;
                  return (
                    <li key={`${c.a}-${c.b}`}>
                      <em>
                        {c.kind === "contradicao"
                          ? "Contradição"
                          : c.kind === "duplicada"
                            ? "Repetida"
                            : "Parecida"}
                      </em>
                      “{a.text}” × “{b.text}”
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {vencidas.length > 0 && (
            <p className="kc-hint">
              {vencidas.length}{" "}
              {vencidas.length === 1 ? "memória passou" : "memórias passaram"} da
              data de revisão. Elas continuam valendo — só vale conferir se ainda
              são verdade.
            </p>
          )}

          <div className="kc-memory-actions">
            <button className="btn ghost sm" onClick={exportar}>
              <Download size={14} /> Exportar minhas memórias
            </button>
          </div>

          {memorias.length === 0 ? (
            <div className="kc-empty">
              <h3>A IA ainda não guardou nada</h3>
              <p>
                Escreva acima o que ela deve levar em conta sempre. Nada é
                memorizado sem você mandar.
              </p>
            </div>
          ) : (
            <ul className="kc-memories">
              {memorias.map((m) => (
                <li key={m.id} className={m.approved ? "" : "pendente"}>
                  <div className="kc-memory-text">
                    <textarea
                      aria-label={`Memória: ${m.text.slice(0, 30)}`}
                      value={m.text}
                      rows={2}
                      onChange={(e) => patchMemoria(m.id, { text: e.target.value })}
                    />
                    <div className="kc-memory-meta">
                      <span>
                        {MEMORY_SCOPES.find((s) => s.id === m.scope)?.label || m.scope}
                        {m.scopeRef ? `: ${m.scopeRef}` : ""}
                      </span>
                      <span>origem: {m.source}</span>
                      {m.reviewAt && (
                        <span className={isStale(m, hoje()) ? "kc-stale" : ""}>
                          revisar em {m.reviewAt}
                        </span>
                      )}
                      {m.required && <span className="kc-req">sempre</span>}
                    </div>
                  </div>
                  <div className="kc-memory-buttons">
                    {!m.approved && (
                      <button
                        className="btn sm"
                        onClick={() => patchMemoria(m.id, { approved: true })}
                      >
                        Aprovar
                      </button>
                    )}
                    <button
                      className="btn ghost sm"
                      onClick={() => patchMemoria(m.id, { required: !m.required })}
                    >
                      {m.required ? "Não fixar" : "Fixar"}
                    </button>
                    <button
                      className="btn ghost sm danger"
                      onClick={() => apagarMemoria(m.id)}
                      aria-label={`Apagar memória ${m.text.slice(0, 20)}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {aba === "saude" && (
        <div className="kc-health">
          <section>
            <h3>
              <Copy size={15} /> Possível conteúdo repetido
            </h3>
            {duplicados.length === 0 ? (
              <p className="kc-hint">Nada parecido demais por aqui.</p>
            ) : (
              <ul>
                {duplicados.map((d, i) => (
                  <li key={`${d.a.id}-${d.b.id}-${i}`}>
                    <span className="kc-source">{d.sourceLabel}</span>
                    “{d.a.title}” × “{d.b.title}”
                    <em>{Math.round(d.similarity * 100)}% parecido</em>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>Conteúdo sem mexer há mais de seis meses</h3>
            {velhos.length === 0 ? (
              <p className="kc-hint">Tudo relativamente recente.</p>
            ) : (
              <ul>
                {velhos.map((v) => (
                  <li key={`${v.sourceLabel}-${v.itemId}`}>
                    <span className="kc-source">{v.sourceLabel}</span>
                    {v.title}
                    <em>{v.updatedAt}</em>
                  </li>
                ))}
              </ul>
            )}
            <p className="kc-hint">
              Nada é apagado por conta própria — isto é só um aviso para você
              decidir.
            </p>
          </section>
        </div>
      )}
    </section>
  );
}
