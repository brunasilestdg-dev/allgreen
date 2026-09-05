import { useEffect, useState } from "react";
import { ThumbsDown, ThumbsUp, Sparkles, PencilLine } from "lucide-react";
import { leituraDaAvaliacao } from "./avaliacaoTodoDomain.js";

// Painel de qualidade do Todô (#128, fase 2): a gestão vê onde ele ajuda e onde
// é corrigido. Ele mesmo se esconde para quem não é gestão (o servidor devolve
// 403 e o painel não renderiza), então pode ser montado sem gate na tela.
const lerToken = () => {
  try {
    const token = localStorage.getItem("seu-funcionario-auth-token") || "";
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

const dataCurta = (iso) => {
  const texto = String(iso || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto.split("-").reverse().join("/") : "";
};

export default function AvaliacaoTodoPanel() {
  const [dados, setDados] = useState(null);
  const [fase, setFase] = useState("carregando"); // carregando | pronto | oculto

  useEffect(() => {
    let ativo = true;
    fetch("/api/todogreen/semente", {
      method: "POST",
      headers: { "content-type": "application/json", ...lerToken() },
      body: JSON.stringify({ avaliacao: true }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((corpo) => { if (ativo) { setDados(corpo); setFase("pronto"); } })
      .catch(() => { if (ativo) setFase("oculto"); });
    return () => { ativo = false; };
  }, []);

  // Só a gestão vê (403 → oculto); enquanto carrega, nada pisca na tela.
  if (fase !== "pronto" || !dados) return null;

  const leitura = leituraDaAvaliacao(dados);

  return (
    <section className="tdg-avaliacao-todo" aria-label="Avaliação do Todô">
      <header>
        <div>
          <span className="tdg-kicker">QUALIDADE DO TODÔ</span>
          <h3>Como o assistente está indo</h3>
        </div>
        <p className={`tdg-avaliacao-leitura tom-${leitura.tom}`}>{leitura.frase}</p>
      </header>

      <div className="tdg-avaliacao-numeros">
        <article><small>Respostas</small><strong>{dados.total}</strong><span>no total</span></article>
        <article className="util"><small><ThumbsUp size={13} /> Úteis</small><strong>{dados.uteis}</strong><span>marcadas 👍</span></article>
        <article className="nao-util"><small><ThumbsDown size={13} /> Não ajudaram</small><strong>{dados.naoUteis}</strong><span>marcadas 👎</span></article>
        <article><small><PencilLine size={13} /> Corrigidas</small><strong>{dados.corrigidas}</strong><span>com resposta certa ensinada</span></article>
        <article><small>Aprovação</small><strong>{dados.taxaUtil === null ? "—" : `${dados.taxaUtil}%`}</strong><span>entre as avaliadas</span></article>
      </div>

      {dados.correcoesRecentes?.length > 0 && (
        <div className="tdg-avaliacao-correcoes">
          <strong><Sparkles size={14} /> Correções recentes — o Todô já aprende com elas</strong>
          <ul>
            {dados.correcoesRecentes.map((item, indice) => (
              <li key={indice}>
                {item.pergunta && <span className="tdg-avaliacao-pergunta">“{item.pergunta}”</span>}
                <span className="tdg-avaliacao-correcao">✅ {item.correcao}</span>
                {item.em && <small>{dataCurta(item.em)}</small>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
