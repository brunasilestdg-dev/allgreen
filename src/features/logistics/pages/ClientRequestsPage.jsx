import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Inbox, ListPlus, Lock, PhoneIncoming, Send } from "lucide-react";
import {
  STATUS_SOLICITACAO,
  TIPOS_SOLICITACAO,
} from "../clientRequestDomain.js";
import Modal from "../../../components/Modal.jsx";
import "./TodoGreenPages.css";

// A outra metade da caixa de entrada do portal. Sem esta tela, o cliente
// escreveria confiando que alguém lê — e ninguém leria.

const api = async (caminho, authHeaders, options = {}) => {
  const resultado = await fetch(`/api/todogreen/${caminho}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(authHeaders?.() || {}),
      ...(options.headers || {}),
    },
  });
  const payload = await resultado.json().catch(() => ({}));
  if (!resultado.ok) throw new Error(payload.error || "Não foi possível concluir a ação.");
  return payload;
};

const rotuloStatus = (id) => STATUS_SOLICITACAO[id]?.rotulo || id;
const rotuloTipo = (id) => TIPOS_SOLICITACAO[id]?.rotulo || id;

// O prazo em palavras. "-3.2h" não diz nada a quem está com dez pedidos na
// fila; "atrasada há 3h" diz.
const prazoEmPalavras = (prazo) => {
  if (!prazo) return "";
  if (prazo.estado === "encerrado") return "encerrada";
  if (prazo.estado === "com-o-cliente") return "aguardando o cliente";
  if (prazo.estado === "sem-prazo") return "sem prazo definido";
  const horas = Math.abs(prazo.horasRestantes || 0);
  const texto = horas >= 24 ? `${Math.round(horas / 24)}d` : `${Math.round(horas)}h`;
  return prazo.emAtraso ? `atrasada há ${texto}` : `vence em ${texto}`;
};

export default function ClientRequestsPage({ authHeaders, setToast, onCreateTask, currentUserId, clientes = [] }) {
  const [dados, setDados] = useState(null);
  const [abertaId, setAbertaId] = useState("");
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState("");
  const [interna, setInterna] = useState(false);
  const [filtro, setFiltro] = useState("pendentes");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [registroAberto, setRegistroAberto] = useState(false);
  const [registro, setRegistro] = useState({
    clienteId: "", tipo: "outro", assunto: "", descricao: "",
    urgencia: "normal", canal: "telefone", campos: {},
  });

  const carregar = useCallback(
    async (id = "") => {
      setCarregando(true);
      setErro("");
      try {
        const d = await api(`requests${id ? `?id=${encodeURIComponent(id)}` : ""}`, authHeaders);
        setDados(d);
        if (id) setMensagens(d.mensagens || []);
      } catch (razao) {
        setErro(razao.message);
      } finally {
        setCarregando(false);
      }
    },
    [authHeaders],
  );

  useEffect(() => {
    carregar();
  }, [carregar]);

  const mudarRegistro = (chave) => (evento) =>
    setRegistro((atual) => ({ ...atual, [chave]: evento.target.value }));
  const mudarCampoDoTipo = (chave) => (evento) =>
    setRegistro((atual) => ({ ...atual, campos: { ...atual.campos, [chave]: evento.target.value } }));

  // Registrar em NOME do cliente: o pedido chegou por telefone, WhatsApp ou
  // e-mail e precisa entrar na mesma fila (mesmo prazo, mesma régua) do que
  // chega pelo portal — senão o pedido falado fura a fila ou some.
  const registrarSolicitacao = async (evento) => {
    evento.preventDefault();
    setEnviando(true);
    try {
      const { id } = await api("requests", authHeaders, {
        method: "POST",
        body: JSON.stringify(registro),
      });
      setRegistroAberto(false);
      setRegistro({ clienteId: "", tipo: "outro", assunto: "", descricao: "", urgencia: "normal", canal: "telefone", campos: {} });
      setToast?.("Solicitação registrada na fila, com o mesmo prazo do portal.");
      await carregar(id);
      setAbertaId(id);
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setEnviando(false);
    }
  };

  const lista = useMemo(() => {
    const todas = dados?.solicitacoes || [];
    if (filtro === "todas") return todas;
    if (filtro === "atrasadas") return todas.filter((s) => s.prazo?.emAtraso);
    // Pendentes é o padrão porque é o que exige ação: o encerrado só interessa
    // quando alguém vai procurar histórico.
    return todas.filter((s) => !STATUS_SOLICITACAO[s.status]?.encerrado);
  }, [dados, filtro]);

  const abrir = async (id) => {
    if (abertaId === id) {
      setAbertaId("");
      setMensagens([]);
      return;
    }
    setAbertaId(id);
    setMensagens([]);
    setTexto("");
    setInterna(false);
    await carregar(id);
  };

  const responder = async (evento) => {
    evento.preventDefault();
    setEnviando(true);
    try {
      await api("requests", authHeaders, {
        method: "POST",
        body: JSON.stringify({ id: abertaId, mensagem: texto, interna }),
      });
      setTexto("");
      setToast?.(interna ? "Nota interna registrada." : "Resposta enviada ao cliente.");
      await carregar(abertaId);
    } catch (razao) {
      setErro(razao.message);
    } finally {
      setEnviando(false);
    }
  };

  const acao = async (id, corpo, aviso) => {
    setEnviando(true);
    try {
      await api("requests", authHeaders, { method: "PATCH", body: JSON.stringify({ id, ...corpo }) });
      setToast?.(aviso);
      await carregar(abertaId === id ? id : "");
    } catch (razao) {
      setErro(razao.message);
    } finally {
      setEnviando(false);
    }
  };

  // Ligar o portal ao trabalho interno: a solicitação vira uma tarefa na
  // central, já vinculada ao cliente, sem redigitar. O atendimento no portal
  // continua sendo a fonte do status para o cliente; a tarefa é o braço interno.
  const [tarefasCriadas, setTarefasCriadas] = useState({});
  const virarTarefa = async (s) => {
    if (!onCreateTask) { setToast?.("Não foi possível criar a tarefa: central de trabalho indisponível."); return; }
    setEnviando(true);
    try {
      await onCreateTask({
        id: crypto.randomUUID(),
        title: `Solicitação do cliente · ${s.assunto}`,
        description: `${s.clienteNome} · ${rotuloTipo(s.tipo)}\n\n${s.descricao || ""}`.trim(),
        priority: s.prazo?.emAtraso ? "Alta" : "Média",
        status: "A fazer", due: "", area: "Atendimento",
        assigneeType: "real", assignee: "", assigneeId: currentUserId || "", project: "",
        isMission: false, distribution: "atribuida", difficulty: "Simples", slots: "1",
        points: "", reward: "", approvalMode: "imediata", allowWithdrawal: true,
        assignees: [], interested: [], missionStatus: "", deliveries: [], attachments: [],
        visibility: "privado", sharedWith: [], sharedTeams: [], subtasks: [], dependsOn: [],
        recurrence: { frequency: "none" }, ownerId: currentUserId || null,
        clientId: s.clienteId || "", clientName: s.clienteNome || "",
        source: "todogreen-solicitacao", requestId: s.id, businessId: "todogreen",
        createdAt: new Date().toISOString(),
      });
      setTarefasCriadas((atual) => ({ ...atual, [s.id]: true }));
      setToast?.("Tarefa criada na central e vinculada ao cliente.");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setEnviando(false);
    }
  };

  const indicadores = dados?.indicadores;

  return (
    <section className="tdg-panel tdg-page tdg-req-page">
      <header className="tdg-page-title">
        <div>
          <span>ATENDIMENTO AO CLIENTE</span>
          <h2>Solicitações</h2>
          <p>
            O que os clientes pediram pelo portal. A fila vem ordenada pelo que já estourou o
            prazo e depois pelo que estoura antes — não por data de abertura.
            {dados && !dados.carteiraCompleta
              ? " Você está vendo apenas os clientes da sua carteira."
              : ""}
          </p>
        </div>
        <button type="button" className="tdg-action" onClick={() => setRegistroAberto(true)}>
          <PhoneIncoming size={16} /> Registrar solicitação
        </button>
      </header>

      {registroAberto && (
        <Modal title="Registrar solicitação em nome do cliente" onClose={() => setRegistroAberto(false)} wide>
          <form className="tdg-client-admin-form tdg-form-em-modal" onSubmit={registrarSolicitacao}>
            <p className="tdg-req-registro-nota">
              Para o pedido que chegou por telefone, WhatsApp ou e-mail. Ele entra na mesma fila e
              com o mesmo prazo do portal, e a conversa diz que foi a equipe quem registrou.
            </p>
            <div className="tdg-form-row">
              <label>
                <span>Cliente</span>
                <select required value={registro.clienteId} onChange={mudarRegistro("clienteId")}>
                  <option value="">Selecione o cliente</option>
                  {clientes.map((cliente) => (
                    <option value={cliente.id} key={cliente.id}>{cliente.nome || cliente.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Como chegou</span>
                <select value={registro.canal} onChange={mudarRegistro("canal")}>
                  <option value="telefone">Telefone</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">E-mail</option>
                  <option value="reuniao">Reunião</option>
                  <option value="presencial">Presencial</option>
                  <option value="outro">Outro</option>
                </select>
              </label>
            </div>
            <div className="tdg-form-row">
              <label>
                <span>Tipo</span>
                <select value={registro.tipo} onChange={mudarRegistro("tipo")}>
                  {Object.values(TIPOS_SOLICITACAO).map((tipo) => (
                    <option value={tipo.id} key={tipo.id}>{tipo.rotulo}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Urgência</span>
                <select value={registro.urgencia} onChange={mudarRegistro("urgencia")}>
                  <option value="baixa">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="alta">Alta</option>
                </select>
              </label>
            </div>
            <label>
              <span>Assunto</span>
              <input required minLength={4} maxLength={160} value={registro.assunto} onChange={mudarRegistro("assunto")} />
            </label>
            {/* Os campos que o TIPO exige — os mesmos do portal, para o pedido
                falado não entrar mais raso do que o digitado. */}
            {(TIPOS_SOLICITACAO[registro.tipo]?.obrigatorios || []).map((chave) => (
              <label key={chave}>
                <span>{TIPOS_SOLICITACAO[registro.tipo].camposRotulo[chave] || chave}</span>
                <input required value={registro.campos[chave] || ""} onChange={mudarCampoDoTipo(chave)} />
              </label>
            ))}
            <label>
              <span>O que o cliente pediu</span>
              <textarea
                required
                minLength={10}
                rows={5}
                value={registro.descricao}
                onChange={mudarRegistro("descricao")}
                placeholder="Escreva como o cliente pediu, sem resumir."
              />
            </label>
            <div className="tdg-form-actions">
              <button type="button" onClick={() => setRegistroAberto(false)} disabled={enviando}>Cancelar</button>
              <button type="submit" className="tdg-action" disabled={enviando}>
                <Send size={16} /> {enviando ? "Registrando..." : "Registrar na fila"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {erro && <div className="tdg-page-error">{erro}</div>}

      {indicadores && (
        <div className="tdg-req-indicadores">
          <article>
            <small>Na fila</small>
            <strong>{indicadores.naFila}</strong>
            <span>esperando a equipe</span>
          </article>
          <article className={indicadores.atrasadas > 0 ? "alerta" : ""}>
            <small>Atrasadas</small>
            <strong>{indicadores.atrasadas}</strong>
            <span>já passaram do prazo</span>
          </article>
          <article>
            <small>Encerradas</small>
            <strong>{indicadores.encerradas}</strong>
            <span>
              {indicadores.semDataDeEncerramento > 0
                ? `${indicadores.semDataDeEncerramento} sem data registrada`
                : "com histórico completo"}
            </span>
          </article>
          <article>
            <small>Pontualidade</small>
            <strong>
              {indicadores.pontualidadePercent === null
                ? "—"
                : `${indicadores.pontualidadePercent}%`}
            </strong>
            <span>
              {indicadores.pontualidadePercent === null
                ? "sem pedido encerrado para medir"
                : "encerradas dentro do prazo"}
            </span>
          </article>
        </div>
      )}

      <div className="tdg-req-filtros" role="group" aria-label="Filtrar solicitações">
        {[
          ["pendentes", "Pendentes"],
          ["atrasadas", "Atrasadas"],
          ["todas", "Todas"],
        ].map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            className={filtro === id ? "ativo" : ""}
            onClick={() => setFiltro(id)}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {carregando && !dados && <p>Carregando solicitações...</p>}

      {dados && lista.length === 0 && (
        <p className="tdg-req-vazio">
          <Inbox size={18} />
          {filtro === "pendentes"
            ? "Nenhuma solicitação esperando a equipe."
            : filtro === "atrasadas"
              ? "Nenhuma solicitação fora do prazo."
              : "Nenhuma solicitação registrada até agora."}
        </p>
      )}

      <div className="tdg-req-lista">
        {lista.map((s) => (
          <article key={s.id} className={`tdg-req-card${abertaId === s.id ? " aberta" : ""}`}>
            <button type="button" className="tdg-req-head" onClick={() => abrir(s.id)}>
              <span className="tdg-req-nome">
                <strong>{s.assunto}</strong>
                <small>
                  {s.clienteNome} · {rotuloTipo(s.tipo)}
                  {s.responsavel ? ` · ${s.responsavel}` : " · sem responsável"}
                </small>
              </span>
              <span className={`tdg-req-status s-${s.status}`}>{rotuloStatus(s.status)}</span>
              <span className={`tdg-req-prazo${s.prazo?.emAtraso ? " atrasado" : ""}`}>
                {s.prazo?.emAtraso ? <AlertTriangle size={13} /> : <Clock size={13} />}
                {prazoEmPalavras(s.prazo)}
              </span>
            </button>

            {abertaId === s.id && (
              <div className="tdg-req-corpo">
                <p className="tdg-req-descricao">{s.descricao}</p>

                {Object.entries(s.campos || {}).length > 0 && (
                  <dl className="tdg-req-campos">
                    {Object.entries(s.campos).map(([chave, valor]) => (
                      <div key={chave}>
                        <dt>{TIPOS_SOLICITACAO[s.tipo]?.camposRotulo?.[chave] || chave}</dt>
                        <dd>{valor}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                <ol className="tdg-req-conversa">
                  {mensagens.map((m) => (
                    <li
                      key={m.id}
                      className={`${m.lado === "equipe" ? "equipe" : "cliente"}${m.interna ? " interna" : ""}`}
                    >
                      <strong>
                        {m.autor}
                        {m.interna && (
                          <em>
                            <Lock size={11} /> nota interna
                          </em>
                        )}
                      </strong>
                      <p>{m.texto}</p>
                      <small>{new Date(m.criadaEm).toLocaleString("pt-BR")}</small>
                    </li>
                  ))}
                </ol>

                {!STATUS_SOLICITACAO[s.status]?.encerrado && (
                  <>
                    <form className="tdg-req-resposta" onSubmit={responder}>
                      <textarea
                        required
                        rows={3}
                        aria-label="Mensagem"
                        placeholder={
                          interna
                            ? "Nota interna: o cliente não vê este texto."
                            : "Resposta ao cliente"
                        }
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                      />
                      <div className="tdg-req-resposta-acoes">
                        <label className="tdg-req-interna">
                          <input
                            type="checkbox"
                            checked={interna}
                            onChange={(e) => setInterna(e.target.checked)}
                          />
                          <span>Nota interna (o cliente não vê)</span>
                        </label>
                        <button type="submit" className="tdg-action" disabled={enviando}>
                          <Send size={15} />
                          {interna ? "Registrar nota" : "Responder ao cliente"}
                        </button>
                      </div>
                    </form>

                    <div className="tdg-req-acoes">
                      {!s.responsavel && (
                        <button
                          type="button"
                          className="tdg-action"
                          disabled={enviando}
                          onClick={() => acao(s.id, { assumir: true }, "Solicitação assumida.")}
                        >
                          Assumir
                        </button>
                      )}
                      {onCreateTask && (
                        <button
                          type="button"
                          className="tdg-action"
                          disabled={enviando || tarefasCriadas[s.id]}
                          onClick={() => virarTarefa(s)}
                        >
                          <ListPlus size={15} />
                          {tarefasCriadas[s.id] ? "Tarefa criada" : "Transformar em tarefa"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="tdg-danger-action"
                        disabled={enviando}
                        onClick={() =>
                          acao(s.id, { status: "aguardando_cliente" }, "Pedido devolvido ao cliente.")
                        }
                      >
                        Pedir informação ao cliente
                      </button>
                      <button
                        type="button"
                        className="tdg-danger-action"
                        disabled={enviando}
                        onClick={() => acao(s.id, { status: "concluida" }, "Solicitação concluída.")}
                      >
                        Concluir
                      </button>
                      <button
                        type="button"
                        className="tdg-danger-action"
                        disabled={enviando}
                        onClick={() => acao(s.id, { status: "recusada" }, "Solicitação encerrada como não atendida.")}
                      >
                        Não atender
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
