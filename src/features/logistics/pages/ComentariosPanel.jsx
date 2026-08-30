import { useState } from "react";
import { MessageSquareText } from "lucide-react";

// ===== Comentários do comercial =====
//
// Um painel só para conta e oportunidade — a diferença é o ALCANCE, definido
// pela titular (30/08): comentário na conta aparece em todas as oportunidades
// dela; comentário na oportunidade fica só nela, mesmo atrelada ao cliente.
// Quem monta a lista e o corpo do envio é a tela que sabe o próprio escopo;
// este painel só desenha, ordena e envia.

const quando = (valor) => {
  if (!valor) return "";
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR");
};

export default function ComentariosPanel({ comentarios = [], aviso, placeholder, podeComentar = true, onEnviar, setToast }) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  const ordenados = [...comentarios].sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));

  const enviar = async (evento) => {
    evento.preventDefault();
    const corpo = texto.trim();
    if (!corpo || !onEnviar) return;
    setEnviando(true);
    try {
      await onEnviar(corpo);
      setTexto("");
    } catch (erro) {
      setToast?.(erro?.message || "Não foi possível registrar o comentário.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section className="tdg-comentarios">
      <header>
        <strong><MessageSquareText size={15} /> Comentários</strong>
        {aviso && <small>{aviso}</small>}
      </header>
      <ul>
        {ordenados.map((item) => (
          <li key={item.id} data-origem={item.opportunityId ? "oportunidade" : "conta"}>
            <span>
              {item.autorEmail || "alguém do espaço"} · {quando(item.criadoEm) || "agora"}
              {!item.opportunityId && " · comentário da conta"}
            </span>
            <p>{item.comentario}</p>
          </li>
        ))}
        {ordenados.length === 0 && <li className="tdg-comentarios-vazio">Nenhum comentário ainda.</li>}
      </ul>
      {podeComentar && (
        <form onSubmit={enviar}>
          <textarea
            rows={2}
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            placeholder={placeholder || "Escreva um comentário"}
            maxLength={4000}
            aria-label={placeholder || "Escreva um comentário"}
          />
          <button className="tdg-action" type="submit" disabled={enviando || !texto.trim()}>
            {enviando ? "Registrando..." : "Comentar"}
          </button>
        </form>
      )}
    </section>
  );
}
