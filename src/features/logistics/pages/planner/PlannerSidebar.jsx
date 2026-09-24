import { ListChecks, Lock, PanelLeftClose, PanelLeftOpen, Plus, Users } from "lucide-react";
import { resumoDoCompartilhamento } from "../../plannerDomain.js";
import { PlanoIcone } from "./plannerUi.jsx";

// O rail da esquerda, como no Planner da Microsoft: "Minhas tarefas" e a lista
// "Meus planos" com o ícone colorido de cada plano. Recolhível — a escolha fica
// por navegador. Em telas estreitas vira uma faixa horizontal (CSS).
export default function PlannerSidebar({
  planos,
  planoAtivoId,
  vendoMinhas,
  aberto,
  carregando,
  onEscolherPlano,
  onMinhas,
  onNovoPlano,
  onAlternar,
}) {
  return (
    <nav className={`plr-rail${aberto ? "" : " is-recolhido"}`} aria-label="Planos">
      <div className="plr-rail-topo">
        {aberto && <strong>Planner</strong>}
        <button type="button" className="plr-icone" onClick={onAlternar} aria-label={aberto ? "Recolher lista de planos" : "Mostrar lista de planos"} aria-expanded={aberto}>
          {aberto ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>
      </div>

      <button type="button" className="plr-rail-item plr-rail-item--fixo" data-ativo={vendoMinhas} onClick={onMinhas} title="Minhas tarefas">
        <span className="plr-rail-icone"><ListChecks size={16} /></span>
        {aberto && <span className="plr-rail-nome">Minhas tarefas</span>}
      </button>

      <div className="plr-rail-secao">
        {aberto && <span>Meus planos</span>}
        <button type="button" className="plr-icone" onClick={onNovoPlano} aria-label="Novo plano" title="Novo plano"><Plus size={16} /></button>
      </div>

      <ul className="plr-rail-lista">
        {carregando && planos.length === 0 && <li className="plr-rail-vazio">{aberto ? "Carregando planos…" : "…"}</li>}
        {!carregando && planos.length === 0 && aberto && <li className="plr-rail-vazio">Nenhum plano ainda.</li>}
        {planos.map((p) => {
          const compartilhado = p.visibility === "shared" || (p.members || []).length > 0;
          return (
            <li key={p.id}>
              <button
                type="button"
                className="plr-rail-item"
                data-ativo={!vendoMinhas && p.id === planoAtivoId}
                aria-current={!vendoMinhas && p.id === planoAtivoId ? "page" : undefined}
                onClick={() => onEscolherPlano(p.id)}
                title={`${p.name} · ${resumoDoCompartilhamento(p)}`}
              >
                <PlanoIcone plano={p} tamanho={24} />
                {aberto && <span className="plr-rail-nome">{p.name}</span>}
                {aberto && (compartilhado ? <Users size={13} className="plr-rail-partilha" aria-label="Compartilhado" /> : <Lock size={13} className="plr-rail-partilha" aria-label="Privado" />)}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
