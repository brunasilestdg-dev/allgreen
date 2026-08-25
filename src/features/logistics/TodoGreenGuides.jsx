import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  CircleHelp,
  FileCheck2,
  Gauge,
  Handshake,
  Leaf,
  Route,
  Search,
  Users,
  Workflow,
} from "lucide-react";

const PLAYBOOK = [
  { title: "1. Priorizar a conta", text: "Confirme segmento, potencial, aderência à logística elétrica e próxima ação.", route: "/todogreen/clientes", action: "Abrir carteira" },
  { title: "2. Mapear decisores", text: "Registre Procurement, Logística, Operação, ESG e Financeiro. Não avance com um único contato.", route: "/todogreen/clientes", action: "Abrir contatos" },
  { title: "3. Fazer diagnóstico", text: "Levante rotas, perfil de veículo, volumes, frequência, SLA, restrições e situação atual da operação.", route: "/todogreen/oportunidades", action: "Criar oportunidade" },
  { title: "4. Construir o preço", text: "Calcule custo carregado, margem mínima, preço recomendado, risco e impacto ambiental.", route: "/todogreen/precificacao", action: "Abrir precificação" },
  { title: "5. Aprovar a condição", text: "Condições abaixo da régua passam pela aprovação comercial com justificativa e histórico.", route: "/todogreen/deal-desk", action: "Abrir aprovações" },
  { title: "6. Enviar e acompanhar", text: "Gere proposta, registre objeções, mantenha o próximo passo com data e atualize o pipeline.", route: "/todogreen/propostas", action: "Abrir propostas" },
  { title: "7. Implantar e comprovar", text: "Conecte operação, entregas, SLA e evidências ambientais ao que foi vendido.", route: "/todogreen/operacoes", action: "Abrir operação" },
];

const HELP_LINKS = [
  { icon: BarChart3, title: "Visão geral", text: "Indicadores, riscos e prioridades reais.", route: "/todogreen/dashboard" },
  { icon: Users, title: "Clientes e contatos", text: "Contas, decisores, histórico e inteligência externa.", route: "/todogreen/clientes" },
  { icon: Handshake, title: "Oportunidades", text: "Pipeline, forecast e próximos passos.", route: "/todogreen/oportunidades" },
  { icon: Gauge, title: "Precificação", text: "Custos, margens e preços recomendados.", route: "/todogreen/precificacao" },
  { icon: FileCheck2, title: "Propostas", text: "Condições comerciais e contratos.", route: "/todogreen/propostas" },
  { icon: Route, title: "Operação", text: "Rotas, viagens, frota, entregas e ocorrências.", route: "/todogreen/operacoes" },
  { icon: Route, title: "Gestão operacional de frota", text: "Jornada, veículo, telemetria disponível e alertas.", route: "/todogreen/motorista-frota" },
  { icon: Leaf, title: "ESG", text: "CO₂ evitado, Green Score, método e evidências.", route: "/todogreen/central-esg" },
  { icon: Workflow, title: "Central de implementação", text: "Implantações, projetos, tarefas, marcos, dependências e automações.", route: "/todogreen/central-trabalho" },
];

function Playbook({ onNavigate }) {
  return <section className="tdg-guide">
    <header className="tdg-intelligence-hero"><div><span className="tdg-kicker">PLAYBOOK COMERCIAL</span><h2>Da conta à operação</h2><p>O caminho padrão para vender sem perder contexto entre cliente, preço, proposta, operação e ESG.</p></div><BookOpenCheck size={28} /></header>
    <div className="tdg-playbook-list">
      {PLAYBOOK.map((item) => <article key={item.title}><span><strong>{item.title}</strong><p>{item.text}</p></span><button type="button" onClick={() => onNavigate?.(item.route)}>{item.action}<ArrowRight size={15} /></button></article>)}
    </div>
    <section className="tdg-playbook-rule"><strong>Regra mínima de avanço</strong><p>Uma oportunidade só deveria avançar quando tiver responsável, valor estimado, próxima ação com data, decisores mapeados e premissas operacionais suficientes para precificação. O sistema não inventa o que estiver faltando.</p></section>
  </section>;
}

function Help({ onNavigate }) {
  return <section className="tdg-guide">
    <header className="tdg-intelligence-hero"><div><span className="tdg-kicker">CENTRAL DE AJUDA</span><h2>Encontre o que precisa sem treinamento</h2><p>Atalhos para as rotinas da To Do Green e orientação sobre onde cada informação fica.</p></div><CircleHelp size={28} /></header>
    <div className="tdg-help-grid">
      {HELP_LINKS.map(({ icon: Icon, ...item }) => <button type="button" onClick={() => onNavigate?.(item.route)} key={item.title}><Icon size={19} /><span><strong>{item.title}</strong><small>{item.text}</small></span><ArrowRight size={15} /></button>)}
    </div>
    <section className="tdg-help-answers">
      <details><summary>Onde vejo notícias, RFQs e portais de fornecedores?</summary><p>Em Espaço, abra Notícias e inteligência. Os itens vêm das pesquisas realizadas nas contas e sempre mantêm o link da fonte.</p></details>
      <details><summary>Onde ficam os contatos?</summary><p>O Espaço mostra uma agenda rápida. O cadastro completo, mapa de relacionamento, histórico e atualização de contatos continuam em Clientes.</p></details>
      <details><summary>Onde acompanho implantações, tarefas e automações?</summary><p>A Central de implementação concentra implantações de clientes, projetos, tarefas, marcos e dependências. No Espaço, a aba Automações permite criar, ativar, pausar e acompanhar regras.</p></details>
      <details><summary>Como encontro uma rotina que não aparece no menu?</summary><p>Use Buscar ferramenta no topo da To Do Green. A busca inclui as rotinas do ERP sem lotar o menu principal.</p></details>
    </section>
    <button type="button" className="tdg-help-search" onClick={() => onNavigate?.("/todogreen/dashboard?ferramentas=1")}><Search size={16} />Buscar todas as ferramentas</button>
  </section>;
}

export default function TodoGreenGuides({ mode = "playbook", onNavigate }) {
  return mode === "ajuda" ? <Help onNavigate={onNavigate} /> : <Playbook onNavigate={onNavigate} />;
}
