import { useState } from "react";
import { Link2, ListChecks, Plus, Tag, Trash2 } from "lucide-react";
import Modal from "../../../../components/Modal.jsx";
import {
  PLANNER_PRIORITIES,
  PLANNER_PROGRESS,
  normalizarRotulos,
  progressoNumerico,
} from "../../plannerDomain.js";
import { Avatar, Rotulo, tarefaVazia } from "./plannerUi.jsx";

// O detalhe da tarefa: título, balde, progresso (com a barra derivada), prazo,
// responsável, rótulos coloridos, contexto comercial opcional, notas e
// checklist. Os nomes de classe `tdg-planner-form`/`tdg-planner-taskform`
// ficam porque o tema escuro do modal (LogisticsVerticalRecovery.css) e as
// regras de formulário já se apoiam neles.
export default function PlannerTaskModal({
  tarefa,
  baldes,
  pessoas = [],
  clientes = [],
  oportunidades = [],
  sugestoesRotulos = [],
  onFechar,
  onSalvar,
  onArquivar,
}) {
  const [form, setForm] = useState({
    ...tarefaVazia(baldes[0]?.id),
    ...tarefa,
    labels: normalizarRotulos(tarefa.labels),
    campos: { ...tarefaVazia().campos, ...(tarefa.campos || {}) },
  });
  const [novoRotulo, setNovoRotulo] = useState("");
  const oportunidadesDoCliente = oportunidades.filter(
    (oportunidade) => !form.campos.clientId || oportunidade.clientId === form.campos.clientId,
  );
  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  // Escolher uma pessoa da lista grava o vínculo de verdade (assigneeUserId) —
  // é ele que faz a tarefa aparecer em "Minhas tarefas" de quem foi atribuído.
  // Texto que não bate com ninguém vale como rótulo solto (gente de fora).
  const definirResponsavel = (valor) => {
    const pessoa = pessoas.find((p) => p.name === valor);
    setForm((f) => ({ ...f, assigneeLabel: valor, assigneeUserId: pessoa?.id || "" }));
  };

  const adicionarRotulo = (valor) => {
    const limpo = String(valor || "").trim();
    if (!limpo) return;
    setForm((f) => ({ ...f, labels: normalizarRotulos([...(f.labels || []), limpo]) }));
    setNovoRotulo("");
  };
  const removerRotulo = (rotulo) => setForm((f) => ({ ...f, labels: (f.labels || []).filter((r) => r !== rotulo) }));

  const alterarItem = (i, patch) =>
    setForm((f) => ({ ...f, checklist: f.checklist.map((item, idx) => (idx === i ? { ...item, ...patch } : item)) }));
  const adicionarItem = () => setForm((f) => ({ ...f, checklist: [...(f.checklist || []), { texto: "", feito: false }] }));
  const removerItem = (i) => setForm((f) => ({ ...f, checklist: f.checklist.filter((_, idx) => idx !== i) }));

  const submeter = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSalvar({ ...form, checklist: (form.checklist || []).filter((i) => (i.texto || "").trim()) });
  };

  const pct = progressoNumerico(form);
  const sugestoes = sugestoesRotulos.filter((r) => !(form.labels || []).includes(r));

  return (
    <Modal title={tarefa.id ? "Tarefa" : "Nova tarefa"} onClose={onFechar} wide>
      <form className="tdg-planner-form tdg-planner-taskform plr-form" onSubmit={submeter}>
        <label>
          Título
          <input autoFocus value={form.title} onChange={set("title")} maxLength={200} placeholder="O que precisa ser feito?" />
        </label>

        <div className="plr-form-progresso">
          <div className="tdg-planner-grid3">
            <label>
              Balde
              <select value={form.bucketId} onChange={set("bucketId")}>
                {baldes.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
            </label>
            <label>
              Progresso
              <select value={form.progress} onChange={set("progress")}>
                {PLANNER_PROGRESS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label>
              Prioridade
              <select value={form.priority} onChange={set("priority")}>
                {PLANNER_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          </div>
          <div className="plr-form-barra" aria-label={`Progresso derivado: ${pct}%`}>
            <span style={{ width: `${pct}%` }} />
            <small>{pct}% · calculado pelo status e pelo checklist</small>
          </div>
        </div>

        <div className="tdg-planner-grid3">
          <label>
            Responsável
            <div className="plr-form-responsavel">
              {form.assigneeLabel && <Avatar nome={form.assigneeLabel} tamanho={28} />}
              <input
                list="tdg-planner-pessoas"
                value={form.assigneeLabel}
                onChange={(e) => definirResponsavel(e.target.value)}
                placeholder="Nome de quem executa"
                maxLength={160}
              />
            </div>
            <datalist id="tdg-planner-pessoas">
              {pessoas.map((p) => <option value={p.name} key={p.id}>{p.email}</option>)}
            </datalist>
            {form.assigneeUserId
              ? <small className="tdg-planner-vinculo">Pessoa da plataforma — entra em “Minhas tarefas” dela.</small>
              : null}
          </label>
          <label>
            Início
            <input type="date" value={form.startDate || ""} onChange={set("startDate")} />
          </label>
          <label>
            Prazo
            <input type="date" value={form.dueDate || ""} onChange={set("dueDate")} />
          </label>
        </div>

        <fieldset className="plr-form-rotulos">
          <legend><Tag size={14} /> Rótulos</legend>
          <div className="plr-form-rotulos-lista">
            {(form.labels || []).map((r) => <Rotulo key={r} texto={r} onRemover={() => removerRotulo(r)} />)}
            {(form.labels || []).length === 0 && <small>Sem rótulos. Use para marcar canal, cliente ou tipo de trabalho.</small>}
          </div>
          <div className="plr-form-rotulos-novo">
            <input
              list="plr-rotulos-sugestoes"
              value={novoRotulo}
              maxLength={40}
              placeholder="Novo rótulo (Enter para adicionar)"
              aria-label="Novo rótulo"
              onChange={(e) => setNovoRotulo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarRotulo(novoRotulo); } }}
            />
            <datalist id="plr-rotulos-sugestoes">
              {sugestoes.map((r) => <option key={r} value={r} />)}
            </datalist>
            <button type="button" className="plr-botao-suave" onClick={() => adicionarRotulo(novoRotulo)} disabled={!novoRotulo.trim()}>Adicionar</button>
          </div>
          {sugestoes.length > 0 && (
            <div className="plr-form-rotulos-sugestoes">
              <small>Usados neste plano:</small>
              {sugestoes.slice(0, 8).map((r) => (
                <button type="button" key={r} onClick={() => adicionarRotulo(r)} aria-label={`Adicionar rótulo ${r}`}>
                  <Rotulo texto={r} pequeno />
                </button>
              ))}
            </div>
          )}
        </fieldset>

        <label>
          Notas
          <textarea rows={3} value={form.notes} onChange={set("notes")} maxLength={4000} placeholder="Contexto, links, o que já foi combinado…" />
        </label>

        <div className="tdg-planner-checklist">
          <div className="tdg-section-head">
            <h3><ListChecks size={15} /> Checklist {form.checklist?.length ? <small>{form.checklist.filter((i) => i.feito).length}/{form.checklist.length}</small> : null}</h3>
            <button type="button" className="tdg-planner-icon" onClick={adicionarItem} aria-label="Adicionar item ao checklist"><Plus size={14} /></button>
          </div>
          {(form.checklist || []).map((item, i) => (
            <div className="tdg-planner-checkrow" key={i}>
              <input type="checkbox" checked={Boolean(item.feito)} onChange={(e) => alterarItem(i, { feito: e.target.checked })} aria-label={`Concluir item ${i + 1}`} />
              <input type="text" value={item.texto || ""} onChange={(e) => alterarItem(i, { texto: e.target.value })} placeholder="Item do checklist" maxLength={300} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarItem(); } }} />
              <button type="button" className="tdg-planner-icon" onClick={() => removerItem(i)} aria-label={`Remover item ${i + 1}`}><Trash2 size={14} /></button>
            </div>
          ))}
          {(form.checklist || []).length === 0 && <small className="plr-form-dica">Quebre a tarefa em passos: o progresso da barra acompanha o que for marcado.</small>}
        </div>

        <details className="tdg-planner-business-context plr-form-contexto" open={Boolean(form.campos.clientId || form.campos.opportunityId)}>
          <summary><Link2 size={14} /> Contexto comercial opcional</summary>
          <p>Use apenas quando a tarefa estiver ligada ao CRM. Projetos de marketing, operação e outras áreas continuam independentes.</p>
          <div className="tdg-planner-grid3">
            <label>
              Cliente
              <select
                value={form.campos.clientId}
                onChange={(e) => setForm((atual) => ({
                  ...atual,
                  campos: { clientId: e.target.value, opportunityId: "" },
                }))}
              >
                <option value="">Sem vínculo com cliente</option>
                {clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.name}</option>)}
              </select>
            </label>
            <label>
              Oportunidade
              <select
                value={form.campos.opportunityId}
                disabled={!form.campos.clientId}
                onChange={(e) => setForm((atual) => ({
                  ...atual,
                  campos: { ...atual.campos, opportunityId: e.target.value },
                }))}
              >
                <option value="">Sem vínculo com oportunidade</option>
                {oportunidadesDoCliente.map((oportunidade) => (
                  <option key={oportunidade.id} value={oportunidade.id}>
                    {oportunidade.titulo || oportunidade.title || oportunidade.nome || oportunidade.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>

        <div className="tdg-form-actions tdg-planner-taskactions">
          {tarefa.id && (
            <button type="button" className="tdg-planner-danger" onClick={() => onArquivar(tarefa)}>
              <Trash2 size={15} /> Arquivar
            </button>
          )}
          <span className="tdg-planner-spacer" />
          <button type="button" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="tdg-action">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}
