import { useEffect, useState } from "react";
import { Activity, Save } from "lucide-react";
import { PESOS_DA_SAUDE, REGRA_DA_SAUDE } from "../todoGreenCrmDomain.js";

// ===== Saúde da conta: a regra na cara e as notas editáveis aqui mesmo =====
//
// Pedido da titular (30/08): "as regras de health do crm nao estao claras, e
// informações precisam ser editaveis". Antes a tela mostrava um número e uma
// lista de seis notas sem dizer quanto cada uma pesa, como viram um número só,
// nem por que a conta caiu em Crítica — e para mudar qualquer nota era preciso
// abrir o formulário inteiro da conta.
//
// Agora a régua vem do domínio (PESOS_DA_SAUDE / REGRA_DA_SAUDE, os mesmos que
// o cálculo usa: não há como a explicação discordar da conta) e as notas, a
// próxima ação e o prazo se editam no próprio painel.

const CLASSES = {
  healthy: "Saudável",
  attention: "Atenção",
  critical: "Crítica",
};

const nota = (valor) => {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  return Math.min(100, Math.max(0, Math.round(numero)));
};

export default function SaudeDaContaPanel({ conta = {}, explicacao, podeEditar = false, onSalvar, setToast }) {
  const crm = conta.crm || {};
  const valoresDaConta = () => ({
    ...Object.fromEntries(PESOS_DA_SAUDE.map((item) => [item.id, crm[item.id] ?? ""])),
    nextAction: crm.nextAction || "",
    nextActionAt: crm.nextActionAt || "",
  });
  const [form, setForm] = useState(valoresDaConta);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Trocar de conta com o painel aberto não pode carregar as notas da anterior.
  useEffect(() => {
    setForm(valoresDaConta());
    setEditando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conta.id, conta.revision]);

  const campo = (chave, valor) => setForm((atual) => ({ ...atual, [chave]: valor }));

  const salvar = async (evento) => {
    evento.preventDefault();
    if (!onSalvar) return;
    setSalvando(true);
    try {
      await onSalvar({
        ...Object.fromEntries(
          PESOS_DA_SAUDE.map((item) => [item.id, form[item.id] === "" ? "" : nota(form[item.id])]),
        ),
        nextAction: String(form.nextAction || "").trim(),
        nextActionAt: form.nextActionAt || "",
      });
      setEditando(false);
    } catch (erro) {
      // A edição continua aberta com o que foi digitado.
      setToast?.(erro?.message || "Não foi possível salvar a avaliação.");
    } finally {
      setSalvando(false);
    }
  };

  if (!explicacao) return null;

  return (
    <section className="tdg-saude-conta">
      <header>
        <strong><Activity size={15} />Saúde da conta</strong>
        <b className={explicacao.classificacao}>{explicacao.score}</b>
        <span className={`tdg-saude-classe ${explicacao.classificacao}`}>{CLASSES[explicacao.classificacao] || "Atenção"}</span>
        {podeEditar && !editando && (
          <button type="button" onClick={() => setEditando(true)}>Avaliar esta conta</button>
        )}
      </header>

      <p className="tdg-saude-motivo"><strong>Por que está assim:</strong> {explicacao.motivo}</p>
      {explicacao.semAvaliacao && (
        <p className="tdg-saude-aviso">{REGRA_DA_SAUDE.semNota}</p>
      )}

      <details className="tdg-saude-regra">
        <summary>Como a saúde é calculada</summary>
        <p>{REGRA_DA_SAUDE.formula}</p>
        <p>{REGRA_DA_SAUDE.cobertura}</p>
        <ul>{REGRA_DA_SAUDE.classificacao.map((linha) => <li key={linha}>{linha}</li>)}</ul>
      </details>

      {editando ? (
        <form className="tdg-saude-form" onSubmit={salvar}>
          {PESOS_DA_SAUDE.map((item) => (
            <label key={item.id}>
              <span>{item.rotulo} <em>peso {item.peso}%</em></span>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={form[item.id] ?? ""}
                onChange={(evento) => campo(item.id, evento.target.value)}
                aria-label={`${item.rotulo} (0 a 100)`}
              />
              <small>{item.ajuda}</small>
            </label>
          ))}
          <label className="full">
            <span>Próxima ação</span>
            <input
              value={form.nextAction}
              onChange={(evento) => campo("nextAction", evento.target.value)}
              placeholder="O que a equipe faz a seguir nesta conta"
              maxLength={300}
            />
          </label>
          <label>
            <span>Prazo da próxima ação</span>
            <input type="date" value={String(form.nextActionAt || "").slice(0, 10)} onChange={(evento) => campo("nextActionAt", evento.target.value)} />
          </label>
          <div className="tdg-form-actions full">
            <button type="button" onClick={() => { setForm(valoresDaConta()); setEditando(false); }}>Cancelar</button>
            <button className="tdg-action" type="submit" disabled={salvando}>
              <Save size={15} />{salvando ? "Salvando..." : "Salvar avaliação"}
            </button>
          </div>
        </form>
      ) : (
        <ul className="tdg-saude-notas">
          {explicacao.linhas.map((linha) => (
            <li key={linha.id}>
              <span>{linha.rotulo}{linha.invertido ? " (quanto menor, melhor)" : ""}</span>
              <b>{linha.preenchida ? `${linha.nota}/100` : "sem nota"}</b>
              <em>peso {linha.peso}% · contribui {linha.contribuicao} pt</em>
            </li>
          ))}
          <li className="tdg-saude-total">
            <span>Média das notas</span><b>{explicacao.notaDasAvaliacoes}</b><em>vale 70% da saúde</em>
          </li>
          <li className="tdg-saude-total">
            <span>Cobertura de decisores</span><b>{explicacao.cobertura}%</b><em>vale 30% da saúde</em>
          </li>
        </ul>
      )}

      {explicacao.alertas.length > 0 && (
        <ul className="tdg-saude-alertas" aria-label="Pontos de atenção da conta">
          {explicacao.alertas.map((alerta) => <li key={alerta}>{alerta}</li>)}
        </ul>
      )}
    </section>
  );
}
