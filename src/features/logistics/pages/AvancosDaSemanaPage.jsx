import "./TodoGreenPages.css";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { avancosDaSemana } from "../avancosDaSemanaDomain.js";

// ===== Avanços da semana =====
//
// O mockup da titular, campo a campo: cartão com o selo de valor, o nome do
// cliente e o avanço concreto — que é o comentário mais recente da
// oportunidade (ou o próximo passo registrado). Quem esfriou aparece no
// rodapé de atenção, nunca escondida no meio de uma lista.

const BRL_COMPACTO = (valor) => {
  const n = Number(valor) || 0;
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MM`;
  if (Math.abs(n) >= 1_000) return `R$ ${Math.round(n / 1_000).toLocaleString("pt-BR")} mil`;
  return `R$ ${n.toLocaleString("pt-BR")}`;
};

export default function AvancosDaSemanaPage({ opportunities = [], comments = [], interactions = [], onComment, onNavigate, setToast }) {
  const { avancos, totalMensal, frios } = useMemo(
    () => avancosDaSemana({ oportunidades: opportunities, comentarios: comments, interacoes: interactions }),
    [opportunities, comments, interactions],
  );

  const oportunidadesOrdenadas = useMemo(
    () => [...opportunities].sort((a, b) => String(a.title || a.cliente || "").localeCompare(String(b.title || b.cliente || ""))),
    [opportunities],
  );
  const [oportunidadeId, setOportunidadeId] = useState("");
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);

  const registrarAvanco = async (event) => {
    event.preventDefault();
    const nota = texto.trim();
    if (!oportunidadeId || nota.length < 2) return;
    const oportunidade = opportunities.find((item) => item.id === oportunidadeId);
    setSalvando(true);
    try {
      // O avanço é um comentário na própria oportunidade: entra na timeline da
      // conta e realimenta esta tela sozinho, atualizando a oportunidade/cliente.
      await onComment?.({ clientId: oportunidade?.clientId || "", opportunityId: oportunidadeId, comentario: nota });
      setTexto("");
      setToast?.("Avanço registrado na oportunidade.");
    } catch (erro) {
      setToast?.(erro?.message || "Não foi possível registrar o avanço.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="tdg-panel tdg-page tdg-avancos-page">
      <header className="tdg-page-title">
        <div>
          <span>NOVOS NEGÓCIOS · PIPELINE</span>
          <h2>Avanços da semana</h2>
          <p>
            {avancos.length} oportunidade(s) com movimento concreto esta semana
            {totalMensal > 0 ? `, somando ${BRL_COMPACTO(totalMensal)}/mês` : ""} — ordenadas por
            potencial de receita. O avanço de cada cartão é o último comentário registrado na
            oportunidade.
          </p>
        </div>
      </header>

      {onComment && (
        <form className="tdg-avanco-registro" onSubmit={registrarAvanco}>
          <div className="tdg-avanco-registro-campos">
            <label>
              <span>Oportunidade</span>
              <select value={oportunidadeId} onChange={(event) => setOportunidadeId(event.target.value)} required>
                <option value="">Selecione a oportunidade</option>
                {oportunidadesOrdenadas.map((item) => (
                  <option key={item.id} value={item.id}>{item.title || item.cliente || item.clientName || "Oportunidade sem título"}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Avanço desta semana</span>
              <input
                value={texto}
                onChange={(event) => setTexto(event.target.value)}
                placeholder="Ex.: fechou a homologação da frota, aguarda assinatura"
                required
              />
            </label>
          </div>
          <button type="submit" className="tdg-action" disabled={salvando || !oportunidadeId || texto.trim().length < 2}>
            <Plus size={16} />{salvando ? "Registrando..." : "Registrar avanço"}
          </button>
        </form>
      )}

      {avancos.length === 0 && (
        <div className="tdg-empty-access">
          Nenhum movimento registrado nos últimos sete dias. Registre o avanço acima (ou comente
          na oportunidade) e os cartões aparecem aqui sozinhos.
        </div>
      )}

      <div className="tdg-avancos-grid">
        {avancos.map((item) => (
          <button
            type="button"
            className="tdg-avanco-cartao"
            key={item.id}
            title={`${item.cliente} · ${item.estagio}`}
            onClick={() => onNavigate?.(item.clientId ? `/todogreen/clientes?client=${encodeURIComponent(item.clientId)}` : "/todogreen/oportunidades")}
          >
            <span className="tdg-avanco-valor">{BRL_COMPACTO(item.valor)}</span>
            <strong>{item.cliente}</strong>
            <p>{item.nota || "Sem nota — registre um comentário na oportunidade."}</p>
          </button>
        ))}
      </div>

      {frios.length > 0 && (
        <p className="tdg-avancos-atencao">
          <strong>Atenção:</strong>{" "}
          {frios
            .map((item) => `${item.cliente} esfriou (${item.diasParado === null ? "sem registro de contato" : `${item.diasParado} dias sem movimento`})`)
            .join(" · ")}{" "}
          — candidata(s) a reforço de follow-up.
        </p>
      )}
    </section>
  );
}
