import "./TodoGreenPages.css";
import { ScrollText, ChevronRight } from "lucide-react";
import { useState } from "react";
import { TODO_GREEN_MODULE_CATALOG } from "../logisticsVerticalDomain.js";

// Manual VIVO: é gerado a partir do catálogo de módulos (TODO_GREEN_MODULE_CATALOG).
// Toda vez que um módulo é criado ou alterado lá, o manual reflete a mudança
// sozinho — não há texto duplicado para manter em dia à mão.

// Guias operacionais detalhados por módulo.
const MODULO_GUIAS = {
  dashboard: {
    titulo: "Como usar o Dashboard",
    passos: [
      { numero: 1, titulo: "Acessar", desc: "Clique em 'Dashboard' no menu. Esta é sua tela inicial." },
      { numero: 2, titulo: "Ver sua fila", desc: "Na seção 'Minha Fila', veja tarefas, aprovações e documentos que precisam da sua ação." },
      { numero: 3, titulo: "Customizar", desc: "Clique em 'Personalizar' para escolher quais indicadores e atalhos aparecem." },
    ],
  },
  clientes: {
    titulo: "Como gerenciar Clientes",
    passos: [
      { numero: 1, titulo: "Listar", desc: "Clique em 'Clientes'. Use filtros: região, segmento, faturamento, data do contrato." },
      { numero: 2, titulo: "Abrir ficha", desc: "Clique no cliente para ver: dados, contatos, produtos contratados, operações recentes." },
      { numero: 3, titulo: "Ações rápidas", desc: "Na ficha: enviar comunicado, criar proposta, registrar operação, anexar documentos." },
      { numero: 4, titulo: "Novo cliente", desc: "Clique '+Cliente'. Preenchaa: razão social, CNPJ, contato, endereço. Salve." },
    ],
  },
  oportunidades: {
    titulo: "Como trabalhar Oportunidades",
    passos: [
      { numero: 1, titulo: "Criar", desc: "Clique '+Oportunidade'. Escolha cliente, nome, valor estimado, produto." },
      { numero: 2, titulo: "Avançar", desc: "Arraste entre estágios: Prospect → Qualificado → Proposta → Negociação → Ganho." },
      { numero: 3, titulo: "Registrar atividade", desc: "Clique '+Atividade' para marcar: reunião, ligação, email. Sistema avisa próxima ação." },
      { numero: 4, titulo: "Usar Playbook", desc: "Abra a oportunidade e siga o Playbook: critérios de avanço, próximo passo, ferramentas." },
    ],
  },
  propostas: {
    titulo: "Como criar e enviar Propostas",
    passos: [
      { numero: 1, titulo: "Criar", desc: "Clique '+Proposta'. Escolha oportunidade. Sistema preenche: cliente, contato, produto, data." },
      { numero: 2, titulo: "Detalhar", desc: "Seção 'Escopo': o que será entregue. Seção 'Financeiro': preço, custo, margem." },
      { numero: 3, titulo: "Simular", desc: "Clique 'Simular preço' para testar diferentes composições. Sistema recalcula margem em tempo real." },
      { numero: 4, titulo: "Aprovar", desc: "Se desconto/margem sair do padrão, clique 'Solicitar aprovação'. Liderança revisa." },
      { numero: 5, titulo: "Enviar", desc: "Após aprovado, clique 'Enviar' para cliente. Proposta fica com status 'Enviada'." },
    ],
  },
  operacoes: {
    titulo: "Como gerenciar Operações (Fretes)",
    passos: [
      { numero: 1, titulo: "Criar manualmente", desc: "Clique '+Operação'. Escolha cliente, origem, destino, peso, motorista, veículo." },
      { numero: 2, titulo: "Acompanhar", desc: "Na ficha: posição (se rastreado), motorista, próximo destino, histórico, eventos de risco." },
      { numero: 3, titulo: "Registrar entrega", desc: "Clique 'Entregue'. Anexe foto e assinatura. Sistema gera POD (comprovante)." },
      { numero: 4, titulo: "Registrar ocorrência", desc: "Se problema: clique '+Ocorrência'. Tipo, descrição, responsabilização." },
    ],
  },
  precificacao: {
    titulo: "Como gerenciar Parâmetros de Preço",
    passos: [
      { numero: 1, titulo: "Acessar", desc: "Clique em 'Precificação'. Você vê tabela com custos vigentes (veículo, motorista, combustível, etc)." },
      { numero: 2, titulo: "Simular", desc: "Antes de enviar proposta, clique 'Simulador'. Digite volume, frequência, SLA. Sistema calcula preço." },
      { numero: 3, titulo: "Editar parâmetros", desc: "Clique 'Editar'. Altere um custo. Sistema mostra: quem alterou, quando, versão anterior." },
      { numero: 4, titulo: "Histórico", desc: "Abra 'Histórico' para ver todas as versões de régua de preço." },
    ],
  },
  receita: {
    titulo: "Como registrar Receita",
    passos: [
      { numero: 1, titulo: "Faturar", desc: "Após entrega confirmada, clique 'Faturar'. Sistema cria fatura automática. Clique 'Emitir'." },
      { numero: 2, titulo: "Registrar pagamento", desc: "Quando cliente pagar, clique '+Pagamento'. Escolha fatura, data, forma (TED, cheque)." },
      { numero: 3, titulo: "Acompanhar", desc: "Em 'Recebimento', veja faturas pendentes, prazo, valor, cliente." },
    ],
  },
  metas: {
    titulo: "Como gerenciar Metas",
    passos: [
      { numero: 1, titulo: "Criar", desc: "Clique '+Meta'. Tipo (receita, clientes novos, conversão), período, alvo, responsável." },
      { numero: 2, titulo: "Registrar progresso", desc: "Mês a mês, clique '+Check-in'. Escreva o que foi feito. Sistema soma automaticamente." },
      { numero: 3, titulo: "Fechar", desc: "No fim do período, clique 'Fechar'. Sistema marca: atingida, não atingida, acima." },
      { numero: 4, titulo: "Plano de ação", desc: "Se não atingir, abra 'Plano de ação' com as causas e próximas medidas." },
    ],
  },
  dashboards: {
    titulo: "Como criar Painéis Personalizados",
    passos: [
      { numero: 1, titulo: "Novo painel", desc: "Clique '+Criar painel'. Nome descritivo (ex: 'Metas da semana')." },
      { numero: 2, titulo: "Adicionar indicadores", desc: "Clique '+Indicador'. Escolha dados (receita, ocupação, CO2). Customize filtros." },
      { numero: 3, titulo: "Salvar e compartilhar", desc: "Clique 'Salvar'. Use 'Compartilhar' para enviar visão para equipe." },
    ],
  },
  "rastreamento": {
    titulo: "Como rastrear Frota em Tempo Real",
    passos: [
      { numero: 1, titulo: "Abrir Tracker", desc: "Clique em 'TMS Tracker'. Você vê mapa com todos os veículos posicionados em tempo real." },
      { numero: 2, titulo: "Clicar em veículo", desc: "Clique num veículo no mapa. Abre painel com: posição, velocidade, rota esperada, eventos (frenagem, desvio)." },
      { numero: 3, titulo: "Alertas", desc: "Sistema avisa em tempo real: entrada em zona proibida, velocidade acima do limite, parada não autorizada." },
      { numero: 4, titulo: "Investigar", desc: "Se evento é esperado (parada para almoço), clique 'Aceitar'. Se suspeito, clique 'Investigar' para abrir conversa com motorista." },
    ],
  },
  "custos": {
    titulo: "Como registrar e acompanhar Custos",
    passos: [
      { numero: 1, titulo: "Registrar custo", desc: "Clique '+Custo'. Tipo: combustível, pneu, manutenção, motorista. Veículo/motorista associado, valor, data." },
      { numero: 2, titulo: "Classificar", desc: "Sistema classifica automaticamente para rota, viagem e cliente. Você vê onde o dinheiro saiu." },
      { numero: 3, titulo: "Acompanhar desvios", desc: "Em 'Custos', compare custo real vs. estimado. Se acima, clique para ver quais viagens tiveram desvios." },
      { numero: 4, titulo: "Margem", desc: "Clique em 'Margem' para ver: receita - custo = lucro. Por período, cliente, rota." },
    ],
  },
  "usuarios": {
    titulo: "Como gerenciar Usuários e Permissões",
    passos: [
      { numero: 1, titulo: "Acessar administração", desc: "Clique em 'Configurações' (ícone ⚙️). Vá a 'Usuários'." },
      { numero: 2, titulo: "Listar usuários", desc: "Você vê: nome, email, papel (owner, admin, vendedor, motorista, etc), último acesso." },
      { numero: 3, titulo: "Adicionar usuário", desc: "Clique '+Usuário'. Escolha email, papel padrão. Sistema envia convite por email." },
      { numero: 4, titulo: "Customizar permissões", desc: "Se papel padrão não bate, clique no usuário e customize: quais funções ele pode fazer (ler, editar, aprovar, configurar)." },
    ],
  },
  "central-trabalho": {
    titulo: "Como usar Central de Trabalho (Projetos & Tarefas)",
    passos: [
      { numero: 1, titulo: "Criar board", desc: "Clique '+Projeto'. Nome: 'Implantação Cliente X'. Template: Kanban ou Gantt." },
      { numero: 2, titulo: "Adicionar tarefa", desc: "No board, clique '+Tarefa'. Título, responsável, prazo, descrição." },
      { numero: 3, titulo: "Acompanhar", desc: "Arraste tarefa entre colunas: A fazer → Fazendo → Feito. Sistema notifica responsável e observadores." },
      { numero: 4, titulo: "Conversar", desc: "Na tarefa, clique 'Comentários'. Converse inline com o responsável. Mencione @pessoa para avisar." },
    ],
  },
  "implantacao": {
    titulo: "Como fazer Go-live de Cliente",
    passos: [
      { numero: 1, titulo: "Iniciar implantação", desc: "Quando contrato é assinado, clique 'Começar implantação'. Sistema mostra checklist de 15 itens." },
      { numero: 2, titulo: "Itens do checklist", desc: "Contato do cliente, criar espaço no portal, testar rastreamento, ativar faturamento, documentos enviados, etc." },
      { numero: 3, titulo: "Marcar progresso", desc: "Conforme avança, clique 'Feito' em cada item. Sistema marca data e quem finalizou." },
      { numero: 4, titulo: "Go-live", desc: "Quando tudo pronto, clique 'Go-live'. Cliente está ativo e pode começar a operar." },
    ],
  },
  "dp-rh": {
    titulo: "Como administrar Pessoal e Folha",
    passos: [
      { numero: 1, titulo: "Cadastrar funcionário", desc: "Clique '+Funcionário'. Preench: nome, CPF, data nasc., endereço, função, salário." },
      { numero: 2, titulo: "Documentos", desc: "Anexe: CPF, CNH (motoristas), dependentes (IRRF). Sistema guarda seguro (dado sensível LGPD)." },
      { numero: 3, titulo: "Criar escala", desc: "Clique '+Escala'. Escolha semana. Arraste motoristas/equipes para rotas. Respeita jornada (máx 10h/dia)." },
      { numero: 4, titulo: "Publicar escala", desc: "Revise se legal. Clique 'Publicar'. Motoristas recebem notificação e veem no portal." },
    ],
  },
  "dashboard-esg": {
    titulo: "Como acompanhar ESG e Impacto Ambiental",
    passos: [
      { numero: 1, titulo: "Abrir Dashboard ESG", desc: "Clique em 'Dashboard ESG'. Escolha período (mês, trimestre, ano)." },
      { numero: 2, titulo: "Ver indicadores", desc: "Você vê: CO2 evitado (ton), diesel não queimado (litros), árvores plantadas equivalentes." },
      { numero: 3, titulo: "Drilla-down", desc: "Clique em número para ver detalhe: qual cliente, qual produto, qual rota gerou esse impacto." },
      { numero: 4, titulo: "Gerar narrativa", desc: "Clique 'Tradutor ESG'. Sistema monta texto para proposta: 'nesta rota você economiza 50 ton CO2/ano'." },
    ],
  },
  "fiscal": {
    titulo: "Como emitir Documentos Fiscais",
    passos: [
      { numero: 1, titulo: "Emitir CT-e", desc: "Na operação faturada, clique 'Emitir CT-e'. Sistema monta XML, envia à SEFAZ, recebe número." },
      { numero: 2, titulo: "Acompanhar", desc: "Em 'Fiscal', veja lista de CT-e emitidos, status na SEFAZ, DACTE gerado, impostos retidos." },
      { numero: 3, titulo: "MDF-e", desc: "Se tem múltiplas operações numa viagem (lotação), clique 'Gerar MDF-e' para englobar todos num único documento." },
      { numero: 4, titulo: "Obrigações", desc: "Sistema lista: SPED enviado, declaração IR, CND válida (calendário de obrigações acessórias)." },
    ],
  },
  "planejamento": {
    titulo: "Como aceitar ou recusar Operações",
    passos: [
      { numero: 1, titulo: "Nova operação proposta", desc: "Cliente solicita frete → Sistema mostra: produto, origem, destino, peso, prazo, preço." },
      { numero: 2, titulo: "Verificar capacidade", desc: "Clique 'Aceito' se tem frota/motorista disponível. Sistema reserva capacidade." },
      { numero: 3, titulo: "Ou recusar", desc: "Se não pode, clique 'Não posso'. Escolha motivo: frota indisponível, SLA incompatível, margem negativa." },
      { numero: 4, titulo: "Simular antes", desc: "Antes de aceitar, clique 'Simular aceite'. Sistema mostra custo vs. preço. Se negativo, apareça 'Recuso, não fecha'." },
    ],
  },
};

const AREA_LABELS = {
  principal: "Visão geral",
  cadastros: "Cadastros",
  comercial: "Comercial",
  operacao: "Operação",
  ocorrencias: "Ocorrências",
  implantacao: "Implantação",
  financeiro: "Financeiro",
  suprimentos: "Suprimentos",
  produtos: "Produtos",
  rh: "Pessoas e folha",
  dp: "Pessoas e folha",
  esg: "ESG",
  documentos: "Documentos",
  indicadores: "Indicadores",
  qualidade: "Qualidade",
  juridico: "Jurídico",
  marketing: "Marketing",
  "comunicacao-interna": "Espaço de trabalho",
  produtividade: "Produtividade",
  administracao: "Administração",
};

const AREA_ORDER = [
  "principal", "cadastros", "comercial", "operacao", "ocorrencias", "implantacao",
  "financeiro", "suprimentos", "produtos", "rh", "dp", "esg", "documentos",
  "indicadores", "qualidade", "juridico", "marketing", "comunicacao-interna",
  "produtividade", "administracao",
];

const PERMISSAO_LABELS = {
  read: "Leitura",
  "esg:manage": "Gestão ESG",
  "crm:manage": "Gestão comercial",
  "finance:manage": "Gestão financeira",
  "operations:manage": "Gestão de operação",
  "fleet:manage": "Gestão de frota",
  "work:manage": "Central de trabalho",
  "hr:manage": "RH (dado sensível)",
  "stock:manage": "Estoque",
  "purchase:manage": "Compras",
  "fiscal:manage": "Fiscal",
};

const permissaoDoModulo = (permissions = []) => {
  const gestao = permissions.find((p) => p !== "read");
  return PERMISSAO_LABELS[gestao] || (gestao ? gestao : "Leitura");
};

const agruparPorArea = () => {
  const grupos = new Map();
  for (const modulo of TODO_GREEN_MODULE_CATALOG) {
    const chave = modulo.area || "administracao";
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(modulo);
  }
  const chaves = [...grupos.keys()].sort((a, b) => {
    const ia = AREA_ORDER.indexOf(a); const ib = AREA_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return chaves.map((chave) => ({
    chave,
    label: AREA_LABELS[chave] || chave,
    modulos: grupos.get(chave).slice().sort((a, b) => (a.order || 100) - (b.order || 100)),
  }));
};

export default function ErpManualPage({ onNavigate }) {
  const [expandido, setExpandido] = useState(null);
  const grupos = agruparPorArea();
  const totalModulos = TODO_GREEN_MODULE_CATALOG.length;

  const toggleDetalhes = (moduloId) => {
    setExpandido(expandido === moduloId ? null : moduloId);
  };

  return (
    <section className="tdg-panel tdg-manual-page">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">MANUAL DO ERP</span>
          <h2>Manual do ERP</h2>
          <p>O que cada módulo faz, como usar, e a permissão que ele exige. Este manual é gerado automaticamente do catálogo de módulos. {totalModulos} módulos em {grupos.length} áreas.</p>
        </div>
        <ScrollText size={28} />
      </div>

      <nav className="tdg-manual-indice" aria-label="Índice do manual">
        {grupos.map((grupo) => (
          <a href={`#manual-${grupo.chave}`} key={grupo.chave}>{grupo.label}</a>
        ))}
      </nav>

      <div className="tdg-manual-areas">
        {grupos.map((grupo) => (
          <section className="tdg-manual-area" id={`manual-${grupo.chave}`} key={grupo.chave}>
            <h3>{grupo.label}</h3>
            <div className="tdg-manual-modulos">
              {grupo.modulos.map((modulo) => {
                const temGuia = MODULO_GUIAS[modulo.id];
                const estaExpandido = expandido === modulo.id;
                return (
                  <article className="tdg-manual-modulo" key={modulo.id}>
                    <header>
                      <strong>{modulo.name}</strong>
                      <span className="tdg-manual-perm">{permissaoDoModulo(modulo.permissions)}</span>
                    </header>
                    <p>{modulo.description || "Sem descrição cadastrada."}</p>
                    <div className="tdg-manual-acoes">
                      {temGuia && (
                        <button
                          type="button"
                          className="tdg-manual-guia-btn"
                          onClick={() => toggleDetalhes(modulo.id)}
                          aria-expanded={estaExpandido}
                        >
                          <ChevronRight size={16} style={{ transform: estaExpandido ? 'rotate(90deg)' : 'rotate(0)' }} />
                          {estaExpandido ? 'Fechar guia' : 'Ver guia passo a passo'}
                        </button>
                      )}
                      {onNavigate && modulo.workspaceRoute && (
                        <button type="button" onClick={() => onNavigate(modulo.workspaceRoute)}>Abrir módulo</button>
                      )}
                    </div>
                    {estaExpandido && temGuia && (
                      <div className="tdg-manual-guia">
                        <h4>{temGuia.titulo}</h4>
                        <ol className="tdg-manual-passos">
                          {temGuia.passos.map((passo) => (
                            <li key={passo.numero}>
                              <strong>Passo {passo.numero}: {passo.titulo}</strong>
                              <p>{passo.desc}</p>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
