import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Send, ThumbsDown, ThumbsUp, X } from "lucide-react";
import SementeAvatar from "./SementeAvatar.jsx";
import {
  SEMENTE,
  corpoDaPergunta,
  textoDaProposta,
} from "./sementeDomain.js";
import { pontosDeAtencaoAltos } from "./sementeBriefingDomain.js";
import "./Semente.css";

// A Semente na tela.
//
// Recolhida por padrão, num botão pequeno no canto. Quem trabalha na vertical
// veio resolver alguma coisa — um painel aberto por cima do conteúdo, sem
// pedir, atrapalha em vez de ajudar. Ela aparece, fica à mão, e só ocupa
// espaço quando alguém chama. A escolha de fechar é lembrada entre telas.
//
// Ela fala com /api/todogreen/semente, não com o /api/ai genérico. A diferença
// não é o modelo — é a mesma cadeia de provedores por baixo — e sim o que
// chega junto da pergunta: a carteira real de quem perguntou, as ferramentas
// de consulta ao CRM e à pesquisa externa, e o direito de propor uma ação.
// Perguntar "o que está parado?" para um endpoint que só recebe o resumo do
// painel devolve conselho de logística; para este, devolve os nomes das contas.
//
// Ação proposta NÃO é ação executada. A resposta pode vir com uma proposta, e
// a proposta vira um botão. Quem clica é a pessoa. Modelo que grava no banco
// sozinho, a partir de texto livre, é injeção de prompt com permissão de
// escrita — e o dado do cliente é que paga.

const CHAVE_ABERTA = "todogreen:semente:aberta";
const CHAVE_OCULTA = "todogreen:semente:oculta";

let contador = 0;
const proximoId = () => (contador += 1);

const partesInline = (texto, prefixo) => {
  const partes = [];
  const padrao = /(\*\*[^*\n]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let inicio = 0;
  let achado;
  while ((achado = padrao.exec(texto)) !== null) {
    if (achado.index > inicio) partes.push(texto.slice(inicio, achado.index));
    const token = achado[0];
    if (token.startsWith("**")) {
      partes.push(<strong key={`${prefixo}-strong-${achado.index}`}>{token.slice(2, -2)}</strong>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      partes.push(<a key={`${prefixo}-link-${achado.index}`} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>);
    }
    inicio = achado.index + token.length;
  }
  if (inicio < texto.length) partes.push(texto.slice(inicio));
  return partes;
};

// Renderiza o subconjunto de Markdown que a IA usa, com elementos React. Sem
// HTML injetado: símbolos viram formatação, mas o texto do modelo continua
// incapaz de inserir marcação executável na página.
function MensagemSemente({ texto, classe }) {
  const linhas = String(texto || "").split(/\r?\n/);
  const blocos = [];
  for (let indice = 0; indice < linhas.length;) {
    const linha = linhas[indice].trim();
    if (!linha) { indice += 1; continue; }
    const titulo = linha.match(/^#{1,6}\s+(.+)$/);
    if (titulo) {
      blocos.push(<strong className="semente-msg-titulo" key={`titulo-${indice}`}>{partesInline(titulo[1], `titulo-${indice}`)}</strong>);
      indice += 1;
      continue;
    }
    const marcador = linha.match(/^[-*]\s+(.+)$/);
    if (marcador) {
      const itens = [];
      while (indice < linhas.length) {
        const item = linhas[indice].trim().match(/^[-*]\s+(.+)$/);
        if (!item) break;
        itens.push(<li key={`item-${indice}`}>{partesInline(item[1], `item-${indice}`)}</li>);
        indice += 1;
      }
      blocos.push(<ul key={`lista-${indice}`}>{itens}</ul>);
      continue;
    }
    const numerado = linha.match(/^\d+[.)]\s+(.+)$/);
    if (numerado) {
      const itens = [];
      while (indice < linhas.length) {
        const item = linhas[indice].trim().match(/^\d+[.)]\s+(.+)$/);
        if (!item) break;
        itens.push(<li key={`numero-${indice}`}>{partesInline(item[1], `numero-${indice}`)}</li>);
        indice += 1;
      }
      blocos.push(<ol key={`numerada-${indice}`}>{itens}</ol>);
      continue;
    }
    blocos.push(<p key={`paragrafo-${indice}`}>{partesInline(linha, `paragrafo-${indice}`)}</p>);
    indice += 1;
  }
  return <div className={classe}>{blocos}</div>;
}

export default function Semente({ pagina, clienteId, authHeaders, aoAgir }) {
  const [aberta, setAberta] = useState(false);
  // Esconder o Todô (pedido da titular: "poder esconder esse botão"). Fica
  // guardado por navegador; escondido, sobra um ponto discreto para trazer de
  // volta — o assistente continua existindo, só sai da frente.
  const [oculta, setOculta] = useState(() => {
    try { return localStorage.getItem(CHAVE_OCULTA) === "1"; } catch { return false; }
  });
  const ocultar = useCallback((valor) => {
    setOculta(valor);
    try { localStorage.setItem(CHAVE_OCULTA, valor ? "1" : "0"); } catch { /* ok */ }
  }, []);
  const [pergunta, setPergunta] = useState("");
  const [mensagens, setMensagens] = useState([]);
  const [pensando, setPensando] = useState(false);
  const [executando, setExecutando] = useState("");
  const [pauta, setPauta] = useState(null);
  const conversa = useRef(null);

  useEffect(() => {
    try {
      setAberta(localStorage.getItem(CHAVE_ABERTA) === "1");
    } catch {
      // localStorage bloqueado (janela anônima, política do navegador): a
      // Semente segue funcionando, só não lembra da escolha.
    }
  }, []);

  const alternar = useCallback((proximo) => {
    setAberta(proximo);
    try {
      localStorage.setItem(CHAVE_ABERTA, proximo ? "1" : "0");
    } catch {
      // Ver acima.
    }
  }, []);

  // Rola a própria conversa, não a página. `scrollIntoView` num painel fixo
  // arrasta o conteúdo atrás dele junto — quem está lendo a tela perderia o
  // lugar toda vez que a Semente respondesse, que é o oposto de não atrapalhar.
  useEffect(() => {
    const caixa = conversa.current;
    if (aberta && caixa) caixa.scrollTop = caixa.scrollHeight;
  }, [aberta, mensagens, pensando]);

  const chamar = useCallback(
    async (corpo) => {
      const resposta = await fetch("/api/todogreen/semente", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify(corpo),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(dados.error || "Não consegui responder agora.");
      return dados;
    },
    [authHeaders],
  );

  // Na PRIMEIRA vez que a Semente abre, traz a conversa guardada (0091) para
  // retomar de onde parou em vez de começar do zero a cada reload. Só ao abrir
  // (nunca antes: fechada, ela não fala com o servidor), uma vez, e sem pisar
  // numa conversa já em tela. Melhor-esforço: se falhar, segue com a tela vazia.
  const historicoHidratado = useRef(false);
  useEffect(() => {
    if (!aberta || historicoHidratado.current) return;
    historicoHidratado.current = true;
    chamar({ historicoPersistido: true })
      .then((dados) => {
        const guardadas = Array.isArray(dados?.mensagens) ? dados.mensagens : [];
        if (!guardadas.length) return;
        setMensagens((atual) => (atual.length
          ? atual
          : guardadas.map((m) => ({
            id: `hist-${proximoId()}`,
            de: m.de,
            texto: m.texto,
            mensagemId: m.id || null,
            avaliacao: m.avaliacao ?? null,
          }))));
      })
      .catch(() => {});
  }, [aberta, chamar]);

  const perguntar = useCallback(
    async (texto) => {
      const { valido, corpo } = corpoDaPergunta({
        pergunta: texto,
        tela: pagina,
        clienteId,
        historico: mensagens,
      });
      if (!valido || pensando) return;
      setMensagens((atual) => [...atual, { id: `voce-${proximoId()}`, de: "voce", texto }]);
      setPergunta("");
      setPensando(true);
      try {
        const dados = await chamar(corpo);
        setMensagens((atual) => [
          ...atual,
          {
            id: `semente-${proximoId()}`,
            de: "semente",
            texto: dados.resposta,
            consultou: dados.consultou || null,
            proposta: dados.proposta || null,
            mensagemId: dados.mensagemId || null,
            avaliacao: null,
          },
        ]);
      } catch (erro) {
        setMensagens((atual) => [
          ...atual,
          { id: `erro-${proximoId()}`, de: "semente", texto: erro.message, falhou: true },
        ]);
      } finally {
        setPensando(false);
      }
    },
    [chamar, clienteId, mensagens, pagina, pensando],
  );

  // Avaliação 👍/👎 de uma resposta. Otimista: reflete o voto na hora; clicar
  // no mesmo tira o voto; se o servidor recusar, volta ao anterior.
  const avaliar = useCallback(
    async (mensagemId, nota) => {
      const alvo = mensagens.find((m) => m.mensagemId === mensagemId);
      if (!alvo) return;
      const nova = alvo.avaliacao === nota ? null : nota;
      const anterior = alvo.avaliacao ?? null;
      setMensagens((atual) => atual.map((m) => (m.mensagemId === mensagemId ? { ...m, avaliacao: nova } : m)));
      try {
        await chamar({ avaliar: { mensagemId, nota: nova === null ? 0 : nova } });
      } catch {
        setMensagens((atual) => atual.map((m) => (m.mensagemId === mensagemId ? { ...m, avaliacao: anterior } : m)));
      }
    },
    [chamar, mensagens],
  );

  // Correção assistida: depois de um 👎, a pessoa escreve qual era a resposta
  // certa. Fica guardado e volta como aprendizado nas próximas perguntas.
  const [corrigindoId, setCorrigindoId] = useState(null);
  const [textoCorrecao, setTextoCorrecao] = useState("");
  const [salvandoCorrecao, setSalvandoCorrecao] = useState(false);
  const corrigir = useCallback(
    async (mensagemId) => {
      const texto = textoCorrecao.trim();
      if (!texto || salvandoCorrecao) return;
      setSalvandoCorrecao(true);
      try {
        await chamar({ corrigir: { mensagemId, texto } });
        setMensagens((atual) => atual.map((m) => (m.mensagemId === mensagemId ? { ...m, corrigida: true, avaliacao: -1 } : m)));
        setCorrigindoId(null);
        setTextoCorrecao("");
      } catch {
        /* mantém o texto para a pessoa tentar de novo */
      } finally {
        setSalvandoCorrecao(false);
      }
    },
    [chamar, textoCorrecao, salvandoCorrecao],
  );

  const executar = useCallback(
    async (mensagemId, proposta) => {
      setExecutando(mensagemId);
      try {
        const dados = await chamar({ executar: proposta });
        setMensagens((atual) =>
          atual.map((item) =>
            item.id === mensagemId ? { ...item, proposta: null, feito: dados.resumo } : item,
          ),
        );
        aoAgir?.(dados);
      } catch (erro) {
        setMensagens((atual) =>
          atual.map((item) => (item.id === mensagemId ? { ...item, falhaDaAcao: erro.message } : item)),
        );
      } finally {
        setExecutando("");
      }
    },
    [aoAgir, chamar],
  );

  // A pauta é buscada UMA vez, ao montar — não só ao abrir. É o "falar
  // primeiro": o lançador acende um selo com quantos pontos de alta urgência a
  // carteira tem, para o operador ver que algo mudou sem precisar abrir. A
  // consulta é barata (agregação no banco, sem modelo), então cabe no load.
  useEffect(() => {
    if (pauta) return undefined;
    let ativo = true;
    chamar({ briefing: true })
      .then((dados) => { if (ativo) setPauta(dados); })
      .catch(() => { if (ativo) setPauta({ pautas: [], leitura: "" }); });
    return () => { ativo = false; };
  }, [chamar, pauta]);
  const alertasAltos = pontosDeAtencaoAltos(pauta);

  // Escondido: só um ponto discreto para reabrir. Continua existindo.
  if (oculta && !aberta) {
    return (
      <button
        type="button"
        className="semente-launcher semente-launcher--min"
        onClick={() => ocultar(false)}
        aria-label={alertasAltos ? `Mostrar ${SEMENTE.nome} — ${alertasAltos} ponto(s) de atenção` : `Mostrar ${SEMENTE.nome}`}
        title={alertasAltos ? `${alertasAltos} ponto(s) de atenção na sua carteira` : `Mostrar ${SEMENTE.nome}`}
      >
        <SementeAvatar estado="calma" tamanho={18} />
        {alertasAltos > 0 && <span className="semente-selo" aria-hidden="true">{alertasAltos > 9 ? "9+" : alertasAltos}</span>}
      </button>
    );
  }
  if (!aberta) {
    return (
      <div className="semente-launcher-wrap">
        <button
          type="button"
          className="semente-launcher"
          onClick={() => alternar(true)}
          aria-label={alertasAltos ? `Abrir ${SEMENTE.nome} — ${alertasAltos} ponto(s) de atenção na sua carteira` : `Abrir ${SEMENTE.nome}, ${SEMENTE.assinatura}`}
        >
          <SementeAvatar estado="calma" tamanho={28} />
          <span>{SEMENTE.nome}</span>
          {alertasAltos > 0 && <span className="semente-selo" aria-hidden="true">{alertasAltos > 9 ? "9+" : alertasAltos}</span>}
        </button>
        <button
          type="button"
          className="semente-launcher-ocultar"
          onClick={() => ocultar(true)}
          aria-label={`Esconder ${SEMENTE.nome}`}
          title={`Esconder ${SEMENTE.nome}`}
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <aside className="semente" aria-label={`${SEMENTE.nome} — ${SEMENTE.assinatura}`}>
      <header className="semente-topo">
        <SementeAvatar estado={pensando ? "pensando" : "calma"} tamanho={34} />
        <div>
          <strong>{SEMENTE.nome}</strong>
          <small>{pensando ? "Analisando..." : SEMENTE.assinatura}</small>
        </div>
        <button type="button" onClick={() => alternar(false)} aria-label={`Fechar o ${SEMENTE.nome}`}>
          <X size={17} />
        </button>
      </header>

      <div className="semente-conversa" role="log" aria-live="polite" ref={conversa}>
        {/* Sem chips de sugestão: o Todô abre a conversa sozinho com uma
            saudação. Se o briefing trouxe uma leitura da rotina, ela entra
            junto — senão, só o "Oie, como posso ajudar?". */}
        {mensagens.length === 0 && (
          <div className="semente-bloco semente-bloco--semente">
            <MensagemSemente
              texto={pauta?.leitura ? `${SEMENTE.saudacao}\n\n${pauta.leitura}` : SEMENTE.saudacao}
              classe="semente-msg semente-msg--semente"
            />
          </div>
        )}

        {mensagens.map((item) => (
          <div className={`semente-bloco semente-bloco--${item.de}`} key={item.id}>
            {/* Dizer o que ela foi buscar não é enfeite: é como alguém confere
                se a resposta veio do dado certo ou de um palpite. */}
            {item.consultou && (
              <small className="semente-consulta">Consultei: {item.consultou.ferramenta}</small>
            )}
            {item.de === "semente" && !item.falhou
              ? <MensagemSemente texto={item.texto} classe="semente-msg semente-msg--semente" />
              : <p className={`semente-msg semente-msg--${item.de}${item.falhou ? " semente-msg--erro" : ""}`}>{item.texto}</p>}
            {item.proposta && (
              <div className="semente-proposta">
                <strong>{textoDaProposta(item.proposta)}</strong>
                <small>Nada foi gravado ainda. Confirme para executar.</small>
                <button
                  type="button"
                  onClick={() => executar(item.id, item.proposta)}
                  disabled={executando === item.id}
                >
                  <Check size={14} />
                  {executando === item.id ? "Executando..." : "Confirmar e executar"}
                </button>
              </div>
            )}
            {item.feito && <small className="semente-feito">{item.feito}</small>}
            {item.falhaDaAcao && <small className="semente-aviso">{item.falhaDaAcao}</small>}
            {item.de === "semente" && !item.falhou && item.mensagemId && (
              <div className="semente-avaliar" role="group" aria-label="Esta resposta ajudou?">
                <button
                  type="button"
                  className={item.avaliacao === 1 ? "ativo" : ""}
                  onClick={() => avaliar(item.mensagemId, 1)}
                  aria-pressed={item.avaliacao === 1}
                  aria-label="Ajudou"
                  title="Ajudou"
                ><ThumbsUp size={13} /></button>
                <button
                  type="button"
                  className={item.avaliacao === -1 ? "ativo" : ""}
                  onClick={() => avaliar(item.mensagemId, -1)}
                  aria-pressed={item.avaliacao === -1}
                  aria-label="Não ajudou"
                  title="Não ajudou"
                ><ThumbsDown size={13} /></button>
                {item.corrigida
                  ? <small className="semente-corrigida"><Check size={12} /> correção registrada</small>
                  : <button type="button" className="semente-corrigir-abrir"
                      onClick={() => { setCorrigindoId(corrigindoId === item.mensagemId ? null : item.mensagemId); setTextoCorrecao(""); }}
                      title="Ensinar a resposta certa">Corrigir</button>}
              </div>
            )}
            {item.mensagemId && corrigindoId === item.mensagemId && !item.corrigida && (
              <div className="semente-corrigir">
                <textarea value={textoCorrecao} onChange={(e) => setTextoCorrecao(e.target.value)} rows={2}
                  placeholder={`Qual era a resposta certa? O ${SEMENTE.nome} aprende com isso e não repete o erro.`} maxLength={2000} />
                <div className="semente-corrigir-acoes">
                  <button type="button" onClick={() => { setCorrigindoId(null); setTextoCorrecao(""); }}>Cancelar</button>
                  <button type="button" className="principal" disabled={salvandoCorrecao || !textoCorrecao.trim()} onClick={() => corrigir(item.mensagemId)}>{salvandoCorrecao ? "Salvando..." : "Salvar correção"}</button>
                </div>
              </div>
            )}
          </div>
        ))}

        {pensando && (
          <p className="semente-msg semente-msg--semente semente-msg--pensando">Analisando...</p>
        )}
      </div>

      <form
        className="semente-campo"
        onSubmit={(evento) => {
          evento.preventDefault();
          perguntar(pergunta);
        }}
      >
        <input
          value={pergunta}
          onChange={(evento) => setPergunta(evento.target.value)}
          placeholder="Escreva sua mensagem..."
          aria-label={`Perguntar para o ${SEMENTE.nome}`}
        />
        <button
          type="submit"
          disabled={pensando || pergunta.trim().length < 3}
          aria-label="Enviar pergunta"
        >
          <Send size={16} />
        </button>
      </form>
    </aside>
  );
}
