import { ArrowRight } from "lucide-react";
import { accountWorkTasks, taskWorkRoute } from "./accountWorkDomain.js";

export default function AccountWorkOverview({ client, contacts = [], interactions = [], tasks = [], onTab, onNavigate }) {
  const linkedTasks = accountWorkTasks(tasks, client.id);
  const conversations = interactions.filter((item) => item.clientId === client.id);
  const pending = linkedTasks.filter((task) => task.status !== "Concluído");
  return <section className="tdg-account-work tdg-account-panel tdg-account-summary tdg-account-next" aria-label="Pessoas, conversas e próximos passos">
    <header><div><strong>Trabalho desta conta</strong><small>Comece com uma pista e aprofunde o mesmo cadastro conforme souber mais.</small></div></header>
    {client.notes && <div className="tdg-account-clue"><strong>O que já sabemos</strong><p>{client.notes}</p></div>}
    <nav className="tdg-account-work-routes" aria-label="Resumo do trabalho da conta">
      <button type="button" onClick={() => onTab("relationship")}><strong>Pessoas</strong><span>{contacts.length} no mapa ativo</span><small>Quem trabalha no cliente e como falar.</small><ArrowRight size={15}/></button>
      <button type="button" onClick={() => onTab("activity")}><strong>Conversas realizadas</strong><span>{conversations.length} registro(s)</span><small>Reuniões, ligações, e-mails e retornos.</small><ArrowRight size={15}/></button>
      <button type="button" onClick={() => onTab("next")}><strong>Próximos passos</strong><span>{pending.length} em aberto</span><small>O que fazer, responsável e prazo.</small><ArrowRight size={15}/></button>
    </nav>
    <div className="tdg-account-work-preview">
      <header><strong>Tarefas vinculadas</strong><small>O status vem da tarefa existente, inclusive quando ela está no Planner.</small></header>
      {linkedTasks.length ? linkedTasks.slice(0, 5).map((task) => <button type="button" key={task.id} onClick={() => onNavigate?.(taskWorkRoute(task))}>
        <span><strong>{task.title || "Tarefa sem título"}</strong><small>{task.status || "A fazer"} · {task.assignee || "Sem responsável"} · {task.due || "Sem prazo"}</small></span><b>Abrir tarefa <ArrowRight size={13}/></b>
      </button>) : <p>Nenhuma tarefa vinculada. Você pode definir um próximo passo sem informar CNPJ, valor ou volume.</p>}
    </div>
  </section>;
}
