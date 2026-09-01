import { useMemo, useRef, useState } from "react";
import { Bot, Send, Sparkles } from "lucide-react";
import { specialistData } from "../../domain/especialistas.js";
import Markdown from "../../components/Markdown.jsx";
import { NOMES_DOS_ESPECIALISTAS } from "./todoGreenAiSpecialists.js";

// ===== Especialistas dentro da vertical =====
//
// A grade de especialistas é o coração do Seu Funcionário e não aparecia na
// To Do Green. Aqui ela entra inteira — reuso do dado puro e do /api/ai que o
// app já usa — adaptada à transportadora: os seis especialistas da casa (com
// instrução logística profunda no worker) vêm primeiro, e todos os demais
// recebem o contexto fixo do negócio no pedido. Fora da grade ficam só os que
// não têm papel numa transportadora B2B (loja virtual e marketplace).

const FORA_DO_NEGOCIO = new Set(["E-commerce", "Marketplace"]);

// O contexto que transforma o especialista genérico num especialista DA
// To Do Green. Vai no corpo do pedido; o worker soma o contexto do workspace.
const CONTEXTO_TDG =
  "Contexto fixo do negócio: você atende a To Do Green, transportadora B2B com " +
  "frota 100% elétrica (da moto à carreta), produtos middle mile, last mile e " +
  "operação dedicada, clientes de e-commerce, varejo e indústria no Brasil. O " +
  "diferencial comercial é ESG mensurável (CO₂ evitado, Green Score). Adapte " +
  "toda resposta a esse negócio e não invente números que não foram informados.";

export default function TodoGreenEspecialistas({ authHeaders, setToast }) {
  const [selecionado, setSelecionado] = useState("");
  const [pergunta, setPergunta] = useState("");
  const [conversa, setConversa] = useState([]);
  const [pensando, setPensando] = useState(false);
  const [busca, setBusca] = useState("");
  const chatRef = useRef(null);

  const daCasa = useMemo(
    () => NOMES_DOS_ESPECIALISTAS.map((nome) => ({
      nome,
      descricao: "Especialista da To Do Green, com a régua e o vocabulário da operação elétrica.",
      daCasa: true,
    })),
    [],
  );
  const gerais = useMemo(
    () => specialistData
      .filter(([nome]) => !FORA_DO_NEGOCIO.has(nome))
      .map(([nome, , descricao]) => ({ nome, descricao, daCasa: false })),
    [],
  );
  const todos = useMemo(() => [...daCasa, ...gerais], [daCasa, gerais]);
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    if (!termo) return todos;
    return todos.filter((item) => `${item.nome} ${item.descricao}`.toLocaleLowerCase("pt-BR").includes(termo));
  }, [busca, todos]);

  const perguntar = async (evento) => {
    evento.preventDefault();
    const texto = pergunta.trim();
    if (!texto || !selecionado || pensando) return;
    setPensando(true);
    setConversa((atual) => [...atual, { de: "voce", texto }]);
    setPergunta("");
    try {
      const resposta = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({ prompt: `${CONTEXTO_TDG}\n\nPedido: ${texto}`, specialist: selecionado }),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.error || "O especialista não respondeu agora.");
      setConversa((atual) => [...atual, { de: "especialista", texto: corpo.content || "Sem conteúdo na resposta." }]);
      chatRef.current?.scrollTo?.({ top: chatRef.current.scrollHeight });
    } catch (erro) {
      setToast?.(erro.message);
      setConversa((atual) => [...atual, { de: "especialista", texto: `Não consegui responder: ${erro.message}` }]);
    } finally {
      setPensando(false);
    }
  };

  const abrir = (nome) => {
    setSelecionado(nome);
    setConversa([]);
  };

  return (
    <section className="tdg-especialistas">
      <header className="tdg-intelligence-hero">
        <div>
          <span className="tdg-kicker">ESPECIALISTAS</span>
          <h2>Um especialista por área, falando a língua da To Do Green</h2>
          <p>Os seis da casa conhecem a operação elétrica a fundo; os demais chegam do Seu Funcionário já com o contexto da transportadora. Escolha um e pergunte.</p>
        </div>
        <Sparkles size={26} />
      </header>

      {!selecionado && (
        <>
          <label className="tdg-intelligence-search">
            <Bot size={17} />
            <input
              aria-label="Buscar especialista"
              placeholder="Buscar por área: compras, jurídico, marketing, reuniões..."
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
            />
          </label>
          <div className="tdg-esp-grade">
            {visiveis.map((item) => (
              <button type="button" className={item.daCasa ? "da-casa" : ""} onClick={() => abrir(item.nome)} key={item.nome}>
                <strong>{item.nome}</strong>
                <small>{item.descricao}</small>
                {item.daCasa && <em>da casa</em>}
              </button>
            ))}
            {!visiveis.length && <p className="tdg-esp-vazio">Nenhum especialista com esse termo.</p>}
          </div>
        </>
      )}

      {selecionado && (
        <div className="tdg-esp-chat">
          <header>
            <button type="button" onClick={() => setSelecionado("")}>← Todos os especialistas</button>
            <strong>{selecionado}</strong>
          </header>
          <div className="tdg-esp-mensagens" ref={chatRef}>
            {conversa.length === 0 && (
              <p className="tdg-esp-vazio">Faça o primeiro pedido. Exemplos: “monte a pauta da reunião semanal de operação”, “reveja este e-mail para o cliente”, “quais riscos deste contrato?”.</p>
            )}
            {conversa.map((mensagem, indice) => (
              <article className={mensagem.de === "voce" ? "voce" : "especialista"} key={indice}>
                <span>{mensagem.de === "voce" ? "Você" : selecionado}</span>
                <div>{mensagem.de === "voce" ? mensagem.texto : <Markdown text={mensagem.texto} />}</div>
              </article>
            ))}
            {pensando && <p className="tdg-esp-vazio">{selecionado} está analisando...</p>}
          </div>
          <form onSubmit={perguntar}>
            <input
              aria-label={`Pergunta para ${selecionado}`}
              placeholder={`Pergunte ao ${selecionado}...`}
              value={pergunta}
              onChange={(evento) => setPergunta(evento.target.value)}
            />
            <button type="submit" className="tdg-action" disabled={pensando || !pergunta.trim()}>
              <Send size={15} />{pensando ? "Analisando..." : "Enviar"}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
