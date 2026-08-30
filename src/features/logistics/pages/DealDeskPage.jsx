import "./TodoGreenPages.css";
import { AlertTriangle, Check, Clock, MessageSquare, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SITUACOES,
  alcadaPorId,
  podeDecidir,
  resumirFila,
  situacaoVisivel,
} from "../dealDeskDomain.js";
import { comRotulo } from "../rotulosDomain.js";

// A fila de aprovação comercial.
//
// Antes esta tela não existia: havia um alerta na calculadora dizendo que a
// condição precisava de aprovação, e nada acontecia. O pedido não tinha dono,
// nem prazo, nem alguém a quem cobrar.

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const dataHora = (valor) => {
  if (!valor) return "—";
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

const ROTULO_SITUACAO = {
  [SITUACOES.pendente]: "Aguardando decisão",
  [SITUACOES.aprovado]: "Aprovado",
  [SITUACOES.recusado]: "Recusado",
  [SITUACOES.cancelado]: "Cancelado",
  [SITUACOES.expirado]: "Venceu sem resposta",
};

const api = async (caminho, authHeaders, opcoes = {}) => {
  const resposta = await fetch(`/api/todogreen/deal-desk${caminho}`, {
    method: opcoes.method || "GET",
    headers: {
      ...(opcoes.body ? { "content-type": "application/json" } : {}),
      ...(authHeaders?.() || {}),
    },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.error || "Não foi possível falar com o servidor.");
  return corpo;
};

function Historico({ eventos }) {
  const TITULO = {
    abertura: "Pedido aberto",
    revisao: "Condição revisada",
    comentario: "Comentário",
    decisao: "Decisão",
    cancelamento: "Cancelado",
  };
  return (
    <ol className="tdg-dd-historico">
      {eventos.map((evento) => (
        <li key={evento.id}>
          <div>
            <strong>{comRotulo(TITULO, evento.tipo)}</strong>
            <small>
              versão {evento.versao} · {evento.autorNome || evento.autorId} · {dataHora(evento.criadoEm)}
            </small>
          </div>
          {evento.texto && <p>{evento.texto}</p>}
        </li>
      ))}
    </ol>
  );
}

function Pedido({ pedido, quem, authHeaders, aoMudar, setToast }) {
  const [aberto, setAberto] = useState(false);
  const [historico, setHistorico] = useState([]);
  const [comentario, setComentario] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [ocupado, setOcupado] = useState("");

  const situacao = situacaoVisivel(pedido);
  const nivel = alcadaPorId(pedido.alcadaId);
  const veredito = podeDecidir(pedido, quem);

  const carregarHistorico = useCallback(async () => {
    try {
      const d = await api(`/${pedido.id}/historico`, authHeaders);
      setHistorico(d.historico || []);
    } catch (razao) {
      setToast?.(razao.message);
    }
  }, [authHeaders, pedido.id, setToast]);

  useEffect(() => {
    if (aberto) carregarHistorico();
  }, [aberto, carregarHistorico]);

  const agir = async (rotulo, caminho, corpo) => {
    setOcupado(rotulo);
    try {
      await api(caminho, authHeaders, { method: "POST", body: corpo });
      setComentario("");
      setJustificativa("");
      await aoMudar();
      await carregarHistorico();
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setOcupado("");
    }
  };

  return (
    <article className={`tdg-dd-card tdg-dd-${situacao}`}>
      <header>
        <div>
          <strong>{pedido.cliente || "Cliente não informado"}</strong>
          <small>
            {nivel?.nome || pedido.alcadaId} · versão {pedido.versao} · prazo {dataHora(pedido.prazoEm)}
          </small>
        </div>
        <span className="tdg-dd-situacao">{comRotulo(ROTULO_SITUACAO, situacao)}</span>
      </header>

      <p className="tdg-dd-motivo">{pedido.motivoDaAlcada}</p>
      {pedido.gatilhos.length > 0 && (
        <ul className="tdg-dd-gatilhos">
          {pedido.gatilhos.map((gatilho) => (
            <li key={gatilho}>{gatilho}</li>
          ))}
        </ul>
      )}
      <p className="tdg-dd-justificativa">{pedido.justificativa}</p>

      {situacao === SITUACOES.aprovado && (
        <p className="tdg-dd-decisao good">
          <Check size={15} />Aprovado em {dataHora(pedido.decididoEm)}: {pedido.decisaoJustificativa}
        </p>
      )}
      {situacao === SITUACOES.recusado && (
        <p className="tdg-dd-decisao risk">
          <X size={15} />Recusado em {dataHora(pedido.decididoEm)}: {pedido.decisaoJustificativa}
        </p>
      )}
      {situacao === SITUACOES.expirado && (
        <p className="tdg-dd-decisao risk">
          <Clock size={15} />O prazo venceu sem ninguém decidir. Isto é cobrança de fila, não recusa.
        </p>
      )}

      {situacao === SITUACOES.pendente && (
        <div className="tdg-dd-acoes">
          {veredito.pode ? (
            <>
              <label>
                <span>Justificativa da decisão</span>
                <input
                  value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value)}
                  placeholder="Por que aprovar ou recusar"
                />
              </label>
              <button
                type="button"
                className="tdg-action"
                disabled={Boolean(ocupado)}
                onClick={() => agir("aprovar", `/${pedido.id}/decisao`, { decisao: "aprovar", justificativa })}
              >
                <Check size={15} />Aprovar
              </button>
              <button
                type="button"
                className="tdg-action tdg-action-secundaria"
                disabled={Boolean(ocupado)}
                onClick={() => agir("recusar", `/${pedido.id}/decisao`, { decisao: "recusar", justificativa })}
              >
                <X size={15} />Recusar
              </button>
            </>
          ) : (
            // O motivo aparece em vez de o botão sumir sem explicação: quem não
            // pode decidir precisa saber a quem cobrar.
            <p className="tdg-dd-bloqueio">
              <ShieldCheck size={15} />
              {veredito.motivo}
            </p>
          )}
        </div>
      )}

      <button type="button" className="tdg-dd-abrir" onClick={() => setAberto((v) => !v)}>
        {aberto ? "Fechar histórico" : "Ver histórico e comentários"}
      </button>

      {aberto && (
        <div className="tdg-dd-detalhe">
          <Historico eventos={historico} />
          <div className="tdg-dd-acoes">
            <label>
              <span>Comentário</span>
              <input value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Pergunte ou registre uma informação" />
            </label>
            <button
              type="button"
              className="tdg-action tdg-action-secundaria"
              disabled={!comentario.trim() || Boolean(ocupado)}
              onClick={() => agir("comentar", `/${pedido.id}/comentario`, { texto: comentario })}
            >
              <MessageSquare size={15} />Comentar
            </button>
            {situacao !== SITUACOES.cancelado && (
              <button
                type="button"
                className="tdg-action tdg-action-secundaria"
                disabled={Boolean(ocupado)}
                onClick={() => agir("revisar", `/${pedido.id}/revisao`, { justificativa: comentario })}
                title="Revisar cria a versão seguinte e reabre o pedido"
              >
                <RefreshCw size={15} />Revisar condição
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export default function DealDeskPage({ authHeaders, quem = {}, setToast }) {
  const [pedidos, setPedidos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("abertos");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const d = await api("", authHeaders);
      setPedidos(d.pedidos || []);
      setErro("");
    } catch (razao) {
      setPedidos([]);
      setErro(razao.message);
    } finally {
      setCarregando(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const fila = useMemo(() => resumirFila(pedidos), [pedidos]);
  const visiveis = useMemo(() => {
    if (filtro === "todos") return fila.lista;
    if (filtro === "abertos")
      return fila.lista.filter((p) => [SITUACOES.pendente, SITUACOES.expirado].includes(p.situacaoVisivel));
    return fila.lista.filter((p) => p.situacaoVisivel === filtro);
  }, [fila, filtro]);

  return (
    <section className="tdg-panel tdg-page tdg-dd-page">
      <header className="tdg-page-title">
        <div>
          <span>APROVAÇÃO COMERCIAL</span>
          <h2>Aprovação de condição comercial</h2>
          <p>
            Toda condição fora da régua passa por aqui antes de virar proposta. A alçada, o prazo e o
            desvio são calculados a partir da simulação e da régua vigente — não são escolhidos por
            quem pede.
          </p>
        </div>
      </header>

      {erro && <div className="tdg-page-error">{erro}</div>}

      <div className="tdg-metrics" aria-label="Situação da fila">
        <div className="tdg-metric"><span>Aguardando</span><strong>{fila.pendentes}</strong></div>
        <div className="tdg-metric"><span>Venceram sem resposta</span><strong>{fila.vencidos}</strong></div>
        <div className="tdg-metric"><span>Aprovados</span><strong>{fila.aprovados}</strong></div>
        <div className="tdg-metric"><span>Recusados</span><strong>{fila.recusados}</strong></div>
        <div className="tdg-metric">
          <span>Taxa de aprovação</span>
          {/* Sem decisão nenhuma a taxa não existe. Mostrar 0% diria que tudo
              foi recusado. */}
          <strong>{fila.taxaAprovacaoPercent === null ? "—" : `${fila.taxaAprovacaoPercent}%`}</strong>
        </div>
      </div>

      <div className="tdg-dd-filtros" role="group" aria-label="Filtrar pedidos">
        {[
          ["abertos", "Abertos"],
          [SITUACOES.aprovado, "Aprovados"],
          [SITUACOES.recusado, "Recusados"],
          ["todos", "Todos"],
        ].map(([id, rotulo]) => (
          <button key={id} type="button" className={filtro === id ? "active" : ""} onClick={() => setFiltro(id)}>
            {rotulo}
          </button>
        ))}
      </div>

      {carregando && <p className="tdg-dd-vazio">Carregando a fila...</p>}
      {!carregando && visiveis.length === 0 && (
        <p className="tdg-dd-vazio">
          <AlertTriangle size={16} />
          Nenhum pedido nesta visão. Pedidos aparecem aqui quando uma simulação fora da régua é
          enviada para aprovação na tela de precificação.
        </p>
      )}

      <div className="tdg-dd-lista">
        {visiveis.map((pedido) => (
          <Pedido
            key={pedido.id}
            pedido={pedido}
            quem={quem}
            authHeaders={authHeaders}
            aoMudar={carregar}
            setToast={setToast}
          />
        ))}
      </div>
    </section>
  );
}

export const formatarMoeda = BRL.format;
