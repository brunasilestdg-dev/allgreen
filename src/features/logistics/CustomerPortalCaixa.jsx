import { useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, MessageSquare, Send, Sparkles, UserCog } from "lucide-react";
import { TIPOS_SOLICITACAO } from "./clientRequestDomain.js";

// A Central de Atendimento: uma porta só. O cliente escreve em linguagem livre
// e o servidor decide o caminho (triagem pura no backend). A tela só mostra o
// que aconteceu com a mensagem — respondida na hora, encaminhada para a equipe,
// ou uma orientação quando falta permissão. Não duplica a decisão: ela mora no
// worker (`/api/todogreen/portal/caixa`), aqui é só a conversa.

const rotuloTipo = (tipo) => TIPOS_SOLICITACAO[tipo]?.rotulo || "Atendimento";
const protocoloCurto = (id) => `#${String(id || "").slice(0, 8).toUpperCase()}`;

function Resultado({ item, onIr }) {
  if (item.tratamento === "respondido_ia") {
    return (
      <div className="cp-caixa-bolha cp-caixa-ia">
        <span className="cp-caixa-selo cp-caixa-selo-ia"><Sparkles size={13} /> Respondido na hora</span>
        <p>{item.resposta}</p>
      </div>
    );
  }
  if (item.tratamento === "escalado") {
    const t = item.triagem || {};
    return (
      <div className="cp-caixa-bolha cp-caixa-escalado">
        <span className="cp-caixa-selo cp-caixa-selo-equipe"><UserCog size={13} /> Encaminhado para a equipe</span>
        <p>
          Abrimos o protocolo <strong>{protocoloCurto(item.protocolo)}</strong> como{" "}
          <strong>{rotuloTipo(t.tipo)}</strong>
          {t.urgencia === "alta" ? " (urgência alta)" : ""}. A equipe To Do Green assume a partir daqui.
        </p>
        {item.motivo && <p className="cp-caixa-motivo">{item.motivo}</p>}
        {onIr && (
          <button type="button" className="cp-caixa-link" onClick={() => onIr("solicitacoes")}>
            Acompanhar em Solicitações <ArrowRight size={15} />
          </button>
        )}
      </div>
    );
  }
  // fora_escopo, sem_permissao, sem_resposta: uma orientação, não um silêncio.
  return (
    <div className="cp-caixa-bolha cp-caixa-aviso">
      <p>{item.resposta}</p>
      {item.tratamento === "sem_permissao" && onIr && (
        <button type="button" className="cp-caixa-link" onClick={() => onIr("solicitacoes")}>
          Ver as solicitações da conta <ArrowRight size={15} />
        </button>
      )}
    </div>
  );
}

export default function CaixaAtendimento({ enviar, setAviso, onIr }) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [conversa, setConversa] = useState([]);

  const mandar = async (evento) => {
    evento.preventDefault();
    const mensagem = texto.trim();
    if (!mensagem || enviando) return;
    setTexto("");
    setConversa((lista) => [...lista, { de: "cliente", texto: mensagem }]);
    setEnviando(true);
    try {
      const dados = await enviar("caixa", { mensagem });
      setConversa((lista) => [...lista, { de: "sistema", ...dados }]);
    } catch (erro) {
      setAviso?.(erro.message);
      setConversa((lista) => [
        ...lista,
        { de: "sistema", tratamento: "sem_resposta", resposta: "Não consegui processar agora. Tente de novo em instantes." },
      ]);
    } finally {
      setEnviando(false);
    }
  };

  const exemplos = [
    "Onde está a minha última entrega?",
    "Qual é o meu Green Score neste mês?",
    "Preciso incluir uma nova rota",
    "Minha carga chegou avariada",
  ];

  return (
    <div className="cp-bloco">
      <header>
        <h2><MessageSquare size={20} /> Central de atendimento</h2>
        <p>
          Escreva o que precisa em uma linha só. O que dá para responder na hora, respondemos;
          o que é para a equipe fazer, vira uma solicitação com prazo — sem você escolher formulário.
        </p>
      </header>

      {conversa.length === 0 && (
        <div className="cp-caixa-vazio">
          <Sparkles size={22} />
          <p>Conte o que você precisa. Alguns exemplos:</p>
          <div className="cp-caixa-exemplos">
            {exemplos.map((frase) => (
              <button type="button" key={frase} onClick={() => setTexto(frase)}>{frase}</button>
            ))}
          </div>
        </div>
      )}

      {conversa.length > 0 && (
        <ol className="cp-caixa-conversa">
          {conversa.map((item, indice) =>
            item.de === "cliente" ? (
              <li key={indice} className="cp-caixa-linha cp-caixa-minha">
                <div className="cp-caixa-bolha cp-caixa-cliente"><p>{item.texto}</p></div>
              </li>
            ) : (
              <li key={indice} className="cp-caixa-linha cp-caixa-deles">
                <Resultado item={item} onIr={onIr} />
              </li>
            ),
          )}
          {enviando && (
            <li className="cp-caixa-linha cp-caixa-deles">
              <div className="cp-caixa-bolha cp-caixa-ia">
                <Loader2 className="girando" size={16} /> <span>Analisando a sua mensagem...</span>
              </div>
            </li>
          )}
        </ol>
      )}

      <form className="cp-caixa-form" onSubmit={mandar}>
        <textarea
          rows={2}
          required
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: onde está a carga da NF 1234? / preciso de uma coleta extra amanhã"
        />
        <button type="submit" className="cp-botao" disabled={enviando || !texto.trim()}>
          {enviando ? <Loader2 className="girando" size={16} /> : <Send size={16} />} Enviar
        </button>
      </form>

      <p className="cp-caixa-nota">
        <CheckCircle2 size={14} /> Assuntos comerciais, contratos e ocorrências vão sempre para uma pessoa da equipe.
      </p>
    </div>
  );
}
