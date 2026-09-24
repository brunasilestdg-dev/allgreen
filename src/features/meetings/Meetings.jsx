import { useMemo, useRef, useState } from "react";
import {
  CheckSquare,
  Mic,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import Modal from "../../components/Modal.jsx";
import {
  allTags,
  buildMinutesPrompt,
  filterMeetings,
  makeMeeting,
  minutesToTasks,
  parseMinutes,
  parseTranscript,
  renameSpeaker,
  searchTranscript,
  speakerStats,
  transcriptionHint,
} from "./meetingDomain.js";

const newId = () => `mt-${Math.random().toString(36).slice(2, 10)}`;

const falasParaTexto = (falas) =>
  falas
    .map(
      (f) =>
        `${f.at ? `[${f.at}] ` : ""}${f.speaker ? `${f.speaker}: ` : ""}${f.text}`,
    )
    .join("\n");

export default function Meetings({ db, update, business, setToast }) {
  const [modal, setModal] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [busca, setBusca] = useState("");
  const [tag, setTag] = useState("");
  const [buscaTranscricao, setBuscaTranscricao] = useState("");
  const [gravando, setGravando] = useState(false);
  const [ocupado, setOcupado] = useState("");
  const gravador = useRef(null);
  const pedacos = useRef([]);
  const arquivoRef = useRef(null);

  const reunioes = useMemo(
    () =>
      (db.meetings || []).filter(
        (m) => !business || m.businessId === business.id,
      ),
    [db.meetings, business],
  );
  const lista = filterMeetings(reunioes, { term: busca, tag });
  const etiquetas = allTags(reunioes);
  const selecionada = reunioes.find((m) => m.id === aberta) || null;
  const falas = useMemo(
    () => parseTranscript(selecionada?.transcript || ""),
    [selecionada?.transcript],
  );
  const achados = searchTranscript(falas, buscaTranscricao);
  const participantes = speakerStats(falas);

  const patch = (id, campos) =>
    update((prev) => ({
      ...prev,
      meetings: (prev.meetings || []).map((m) =>
        m.id === id ? { ...m, ...campos } : m,
      ),
    }));

  const salvar = (reuniao) => {
    if (!reuniao.title.trim()) return;
    update((prev) => ({
      ...prev,
      meetings: (prev.meetings || []).some((m) => m.id === reuniao.id)
        ? (prev.meetings || []).map((m) => (m.id === reuniao.id ? reuniao : m))
        : [reuniao, ...(prev.meetings || [])],
    }));
    setModal(null);
    setAberta(reuniao.id);
    setToast("Reunião salva");
  };

  const excluir = (id) => {
    if (!window.confirm("Excluir esta reunião, a transcrição e a ata?")) return;
    update((prev) => ({
      ...prev,
      meetings: (prev.meetings || []).filter((m) => m.id !== id),
    }));
    if (aberta === id) setAberta(null);
    setToast("Reunião excluída");
  };

  // Envia o áudio ao Worker, que transcreve com Whisper.
  const transcrever = async (blob) => {
    setOcupado("transcrevendo");
    try {
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binario = "";
      for (let i = 0; i < bytes.length; i += 1)
        binario += String.fromCharCode(bytes[i]);
      const resposta = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          audio: btoa(binario),
          hint: transcriptionHint(selecionada),
        }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        setToast(dados?.error || "Não foi possível transcrever.");
        return;
      }
      const anterior = selecionada?.transcript || "";
      patch(selecionada.id, {
        transcript: anterior ? `${anterior}\n${dados.text}` : dados.text,
      });
      setToast("Transcrição adicionada");
    } catch {
      setToast("Não foi possível transcrever este áudio.");
    } finally {
      setOcupado("");
    }
  };

  const iniciarGravacao = async () => {
    if (!selecionada?.consent) {
      setToast("Marque o consentimento de gravação antes de gravar.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      pedacos.current = [];
      rec.ondataavailable = (e) => {
        if (e.data?.size > 0) pedacos.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(pedacos.current, { type: "audio/webm" });
        if (blob.size > 0) await transcrever(blob);
      };
      gravador.current = rec;
      rec.start();
      setGravando(true);
    } catch {
      setToast("Não foi possível acessar o microfone.");
    }
  };

  const pararGravacao = () => {
    gravador.current?.stop();
    gravador.current = null;
    setGravando(false);
  };

  // Gera a ata com a IA e a interpreta nas seções conhecidas.
  const gerarAta = async () => {
    if (falas.length === 0) {
      setToast("Adicione a transcrição antes de gerar a ata.");
      return;
    }
    setOcupado("ata");
    try {
      const resposta = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: buildMinutesPrompt(selecionada, falas),
        }),
      });
      const dados = await resposta.json();
      const texto = dados?.text || dados?.reply || dados?.result || "";
      if (!resposta.ok || !texto) {
        setToast(dados?.error || "A IA não conseguiu gerar a ata.");
        return;
      }
      patch(selecionada.id, { minutes: parseMinutes(texto) });
      setToast("Ata gerada");
    } catch {
      setToast("Não foi possível gerar a ata agora.");
    } finally {
      setOcupado("");
    }
  };

  // Automação pós-reunião: as tarefas da ata viram tarefas de verdade.
  const criarTarefas = () => {
    const tarefas = minutesToTasks(selecionada?.minutes, {
      referencia: selecionada?.date,
    });
    if (tarefas.length === 0) {
      setToast("A ata não tem tarefas para criar.");
      return;
    }
    update((prev) => ({
      ...prev,
      tasks: [
        ...tarefas.map((t) => ({
          id: newId(),
          title: t.title,
          status: "pendente",
          due: t.dueDate || "",
          notes: [
            `Da reunião "${selecionada.title}"`,
            t.owner ? `Responsável apontado: ${t.owner}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          project: selecionada.project || "",
          businessId: business?.id || null,
          ownerId: db.user?.id || null,
          meetingId: selecionada.id,
        })),
        ...(prev.tasks || []),
      ],
    }));
    setToast(
      `${tarefas.length} ${tarefas.length === 1 ? "tarefa criada" : "tarefas criadas"}`,
    );
  };

  const corrigirNome = (de) => {
    const para = window.prompt(`Como se escreve o nome de "${de}"?`, de);
    if (!para || para === de) return;
    patch(selecionada.id, {
      transcript: falasParaTexto(renameSpeaker(falas, de, para)),
    });
  };

  const abrirNova = () =>
    setModal(
      makeMeeting(newId(), {
        businessId: business?.id || null,
        ownerId: db.user?.id || null,
      }),
    );

  return (
    <section className="mtg">
      <header className="mtg-head">
        <div>
          <h2>
            <Mic size={20} /> Reuniões
          </h2>
          <p>
            Grave ou envie o áudio, receba a transcrição e transforme a conversa
            em ata com decisões, prazos e tarefas de verdade.
          </p>
        </div>
        <button className="btn" onClick={abrirNova}>
          <Plus size={16} /> Nova reunião
        </button>
      </header>

      <div className="mtg-toolbar">
        <div className="search">
          <Search size={15} />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título, participante ou o que foi dito"
          />
        </div>
        {etiquetas.length > 0 && (
          <select
            aria-label="Filtrar por etiqueta"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          >
            <option value="">Todas as etiquetas</option>
            {etiquetas.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>

      {lista.length === 0 ? (
        <div className="mtg-empty">
          <Mic size={28} />
          <h3>
            {reunioes.length === 0
              ? "Nenhuma reunião registrada"
              : "Nada encontrado com esse filtro"}
          </h3>
          <p>
            Crie a reunião, grave o áudio pelo navegador ou envie um arquivo. A
            transcrição e a ata saem daí — e as tarefas combinadas viram tarefas
            no app.
          </p>
          {reunioes.length === 0 && (
            <button className="btn" onClick={abrirNova}>
              <Plus size={16} /> Criar a primeira
            </button>
          )}
        </div>
      ) : (
        <div className="mtg-layout">
          <ul className="mtg-list">
            {lista.map((m) => (
              <li key={m.id}>
                <button
                  className={aberta === m.id ? "active" : ""}
                  onClick={() => setAberta(m.id)}
                >
                  <strong>{m.title}</strong>
                  <small>{m.date}</small>
                  {m.client && <small>{m.client}</small>}
                  <span className="mtg-badges">
                    {m.transcript ? <em>transcrita</em> : null}
                    {m.minutes ? <em className="ok">com ata</em> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mtg-detail">
            {!selecionada ? (
              <p className="mtg-hint">Escolha uma reunião para ver os detalhes.</p>
            ) : (
              <>
                <header className="mtg-detail-head">
                  <div>
                    <h3>{selecionada.title}</h3>
                    <small>
                      {selecionada.date}
                      {selecionada.client ? ` · ${selecionada.client}` : ""}
                    </small>
                  </div>
                  <div className="mtg-detail-actions">
                    <button
                      className="btn ghost sm"
                      onClick={() => setModal(selecionada)}
                    >
                      Editar
                    </button>
                    <button
                      className="btn ghost sm danger"
                      onClick={() => excluir(selecionada.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </header>

                <label className="mtg-consent">
                  <input
                    type="checkbox"
                    checked={!!selecionada.consent}
                    onChange={(e) =>
                      patch(selecionada.id, { consent: e.target.checked })
                    }
                  />
                  <span>
                    Todos os participantes foram avisados e concordaram com a
                    gravação. Gravar sem avisar pode ser ilegal.
                  </span>
                </label>

                <div className="mtg-capture">
                  {gravando ? (
                    <button className="btn danger" onClick={pararGravacao}>
                      <Square size={15} /> Parar e transcrever
                    </button>
                  ) : (
                    <button
                      className="btn"
                      onClick={iniciarGravacao}
                      disabled={!!ocupado}
                    >
                      <Mic size={15} /> Gravar pelo navegador
                    </button>
                  )}
                  <button
                    className="btn ghost"
                    onClick={() => arquivoRef.current?.click()}
                    disabled={!!ocupado}
                  >
                    <Upload size={15} /> Enviar áudio
                  </button>
                  <input
                    ref={arquivoRef}
                    type="file"
                    accept="audio/*"
                    hidden
                    onChange={(e) => {
                      const arquivo = e.target.files?.[0];
                      e.target.value = "";
                      if (arquivo) transcrever(arquivo);
                    }}
                  />
                  {ocupado === "transcrevendo" && (
                    <small className="mtg-busy">Transcrevendo o áudio...</small>
                  )}
                </div>

                <label className="mtg-field">
                  Transcrição
                  <textarea
                    rows={8}
                    placeholder={
                      'Cole ou digite no formato "Nome: o que foi dito", uma fala por linha.'
                    }
                    value={selecionada.transcript}
                    onChange={(e) =>
                      patch(selecionada.id, { transcript: e.target.value })
                    }
                  />
                </label>

                {falas.length > 0 && (
                  <>
                    <div className="mtg-speakers">
                      <h4>
                        <Users size={14} /> Quem falou
                      </h4>
                      <ul>
                        {participantes.map((p) => (
                          <li key={p.speaker}>
                            <button
                              className="mtg-rename"
                              onClick={() => corrigirNome(p.speaker)}
                              title="Corrigir o nome em toda a transcrição"
                            >
                              {p.speaker}
                            </button>
                            <small>
                              {p.turns} {p.turns === 1 ? "fala" : "falas"} ·{" "}
                              {p.share}% do que foi dito
                            </small>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mtg-search-transcript">
                      <input
                        aria-label="Buscar na transcrição"
                        placeholder="Buscar dentro da transcrição"
                        value={buscaTranscricao}
                        onChange={(e) => setBuscaTranscricao(e.target.value)}
                      />
                      {buscaTranscricao && (
                        <small>
                          {achados.length}{" "}
                          {achados.length === 1
                            ? "fala encontrada"
                            : "falas encontradas"}
                        </small>
                      )}
                      {achados.length > 0 && (
                        <ul className="mtg-hits">
                          {achados.slice(0, 8).map(({ fala, index }) => (
                            <li key={index}>
                              {fala.at && <em>[{fala.at}]</em>}
                              <strong>{fala.speaker || "—"}</strong>
                              <span>{fala.text}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="mtg-ata-actions">
                      <button
                        className="btn"
                        onClick={gerarAta}
                        disabled={!!ocupado}
                      >
                        <Sparkles size={15} />
                        {ocupado === "ata" ? "Gerando ata..." : "Gerar ata com IA"}
                      </button>
                      {selecionada.minutes && (
                        <button className="btn ghost" onClick={criarTarefas}>
                          <CheckSquare size={15} /> Criar as tarefas da ata
                        </button>
                      )}
                    </div>
                  </>
                )}

                {selecionada.minutes && (
                  <div className="mtg-minutes">
                    <h4>Ata</h4>
                    {selecionada.minutes.resumo && (
                      <p className="mtg-resumo">{selecionada.minutes.resumo}</p>
                    )}
                    {[
                      ["Decisões", selecionada.minutes.decisoes],
                      ["Tarefas", selecionada.minutes.tarefas],
                      ["Riscos", selecionada.minutes.riscos],
                      ["Perguntas pendentes", selecionada.minutes.pendencias],
                    ].map(([titulo, itens]) =>
                      (itens || []).length > 0 ? (
                        <section key={titulo}>
                          <h5>{titulo}</h5>
                          <ul>
                            {itens.map((item, i) => (
                              <li key={`${titulo}-${i}`}>{item}</li>
                            ))}
                          </ul>
                        </section>
                      ) : null,
                    )}
                    {(selecionada.minutes.temas || []).length > 0 && (
                      <div className="mtg-temas">
                        {selecionada.minutes.temas.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {modal && (
        <Modal
          title={
            (db.meetings || []).some((m) => m.id === modal.id)
              ? "Editar reunião"
              : "Nova reunião"
          }
          onClose={() => setModal(null)}
        >
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              salvar(modal);
            }}
          >
            <label className="mtg-field">
              Assunto da reunião
              <input
                required
                autoFocus
                placeholder="Ex.: alinhamento de go-live da operação com o embarcador"
                value={modal.title}
                onChange={(e) => setModal({ ...modal, title: e.target.value })}
              />
            </label>
            <div className="mtg-field-row">
              <label className="mtg-field">
                Data
                <input
                  type="date"
                  value={modal.date}
                  onChange={(e) => setModal({ ...modal, date: e.target.value })}
                />
              </label>
              <label className="mtg-field">
                Cliente (opcional)
                <input
                  value={modal.client}
                  onChange={(e) => setModal({ ...modal, client: e.target.value })}
                />
              </label>
            </div>
            <label className="mtg-field">
              Participantes (separados por vírgula)
              <input
                value={(modal.participants || []).join(", ")}
                onChange={(e) =>
                  setModal({
                    ...modal,
                    participants: e.target.value
                      .split(",")
                      .map((p) => p.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <label className="mtg-field">
              Etiquetas (separadas por vírgula)
              <input
                value={(modal.tags || []).join(", ")}
                onChange={(e) =>
                  setModal({
                    ...modal,
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <footer className="modal-foot">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setModal(null)}
              >
                Cancelar
              </button>
              <button className="btn" type="submit">
                Salvar
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
