import { ArrowRight, BadgeCheck, Boxes, BriefcaseBusiness, CheckCircle2, FileText, Gauge, Megaphone, Route, Scale, Settings, Target, TrendingUp, Users } from "lucide-react";

const cards = {
  products: {
    kicker: "PRODUTOS",
    title: "Produtos logísticos",
    description: "A área define o que pode ser vendido e executado: first mile, middle mile, last mile, operação dedicada, transferência, coletas em fornecedores e projetos especiais.",
    icon: Boxes,
    actions: [
      ["Abrir precificação", "/todogreen/precificacao"],
      ["Parâmetros do simulador", "/todogreen/parametros-simulador"],
    ],
    responsibilities: [
      "Governar escopo, SLA, unidade de cobrança e restrições de cada produto.",
      "Definir premissas comerciais antes de proposta, aceite e execução.",
      "Manter margem alvo, indicadores operacionais e evidências ESG por serviço.",
    ],
    handoff: [
      ["Comercial vende com escopo correto", "Comercial"],
      ["Planejamento usa o produto para aceitar a OS", "Planejamento"],
      ["Operação executa dentro do SLA definido", "Operação"],
    ],
  },
  planning: {
    kicker: "PLANEJAMENTO",
    title: "Aceite de viagem e liberação de OS",
    description: "Planejamento e Produtos decidem se a viagem ou OS pode ser aceita, já preparando CIOT quando a operação exigir TRC. Financeiro entra depois, quando a operação concluída vira fila fiscal e recebível.",
    icon: Route,
    actions: [
      ["Abrir OS e aceite", "/todogreen/ordens-servico"],
      ["Preparar CIOT", "/todogreen/ciot"],
    ],
    responsibilities: [
      "Validar contrato, produto, capacidade, janela, risco, SLA, margem e CIOT antes de liberar.",
      "Bloquear preparação quando o frete declarado estiver abaixo do piso mínimo informado.",
      "Separar aceite de execução: Operação inicia depois da OS liberada.",
      "Manter rastreabilidade entre solicitação, contrato, OS, CIOT, operação e faturamento.",
    ],
    handoff: [
      ["Comercial entrega contrato aprovado", "Comercial"],
      ["Produtos confirma o serviço contratado", "Produtos"],
      ["Operação recebe somente o que foi aceito", "Operação"],
    ],
  },
  dp: {
    kicker: "DEPARTAMENTO PESSOAL",
    title: "Colaboradores, vínculos e documentação",
    description: "DP concentra colaboradores, contratos, documentos, férias, afastamentos, vencimentos e dados sensíveis, separado de clientes e contatos comerciais.",
    icon: BriefcaseBusiness,
    actions: [
      ["Cadastro de colaboradores", "/todogreen/cadastros"],
      ["Ver RH", "/todogreen/rh"],
    ],
    responsibilities: [
      "Controlar colaboradores, vínculos, documentos, vencimentos e dados cadastrais sensíveis.",
      "Apoiar admissões, desligamentos, férias, afastamentos e obrigações recorrentes.",
      "Separar pessoa interna de contato de cliente, fornecedor ou parceiro.",
    ],
    handoff: [
      ["RH acompanha capacidade e escala", "RH"],
      ["Operação consulta disponibilidade liberada", "Operação"],
      ["Administração governa acesso aos dados sensíveis", "Administração"],
    ],
  },
  hr: {
    kicker: "RH",
    title: "Capacidade, escalas e desenvolvimento",
    description: "RH acompanha disponibilidade, escala, treinamento, capacidade e alocação. Motorista em rota e veículo operacional ficam na Central de Frota.",
    icon: Users,
    actions: [
      ["Abrir Frota e motoristas", "/todogreen/motorista-frota"],
      ["Ver metas", "/todogreen/metas"],
    ],
    responsibilities: [
      "Planejar escala, disponibilidade, capacidade e alocação de colaboradores.",
      "Acompanhar treinamento, metas e planos de desenvolvimento.",
      "Consultar motoristas operacionais pela Central de Frota, sem tratá-los como contatos de cliente.",
    ],
    handoff: [
      ["Planejamento consulta capacidade humana", "Planejamento"],
      ["Operação usa escala e alocação", "Operação"],
      ["Gestão acompanha metas e planos", "Gestão"],
    ],
  },
  quality: {
    kicker: "QUALIDADE",
    title: "Qualidade, SLA e melhoria contínua",
    description: "Qualidade acompanha SLA, BSC, não conformidades, planos de ação e reincidências operacionais.",
    icon: BadgeCheck,
    actions: [
      ["Ver ocorrências", "/todogreen/ocorrencias"],
      ["Ver indicadores", "/todogreen/indicadores"],
    ],
    responsibilities: [
      "Medir cumprimento de SLA e registrar não conformidades.",
      "Tratar causa raiz, recorrência, plano de ação e dono da correção.",
      "Conectar qualidade ao contrato, ao cliente e ao frete afetado.",
    ],
    handoff: [
      ["Operação registra a ocorrência", "Operação"],
      ["Qualidade define tratamento e prevenção", "Qualidade"],
      ["Indicadores consolidam SLA e recorrência", "Indicadores"],
    ],
  },
  marketing: {
    kicker: "MARKETING",
    title: "Campanhas, marca e materiais comerciais",
    description: "Marketing transforma provas operacionais e ESG em demanda, relacionamento, materiais e campanhas por segmento e produto.",
    icon: TrendingUp,
    actions: [
      ["Ver documentos ESG", "/todogreen/documentos"],
      ["Ver relatórios", "/todogreen/relatorios"],
    ],
    responsibilities: [
      "Planejar campanhas por produto, segmento, cliente e objetivo comercial.",
      "Manter narrativa, materiais e evidências alinhados com Comercial e ESG.",
      "Acompanhar demandas geradas e aprendizados para Produto e Comercial.",
    ],
    handoff: [
      ["ESG fornece evidências auditáveis", "ESG"],
      ["Comercial usa materiais e campanhas", "Comercial"],
      ["Produtos ajusta oferta com o retorno do mercado", "Produtos"],
    ],
  },
  legal: {
    kicker: "JURÍDICO",
    title: "Contratos, riscos e formalizações",
    description: "Jurídico organiza minutas, aprovações, riscos, anexos, vigências, aditivos e evidências formais ligadas ao cliente e à operação.",
    icon: Scale,
    actions: [
      ["Ver propostas e contratos", "/todogreen/propostas"],
      ["Ver documentos", "/todogreen/documentos"],
    ],
    responsibilities: [
      "Acompanhar versão, aprovação, assinatura, vigência e reajuste contratual.",
      "Formalizar riscos, exceções, anexos e condições especiais.",
      "Garantir que implantação e faturamento só avancem com base contratual válida.",
    ],
    handoff: [
      ["Comercial negocia condição", "Comercial"],
      ["Jurídico formaliza e controla risco", "Jurídico"],
      ["Implantação usa o contrato como gate", "Implantação"],
    ],
  },
  indicators: {
    kicker: "INDICADORES",
    title: "KPIs e painéis executivos",
    description: "Indicadores consolida KPIs comerciais, operacionais, financeiros, ESG, qualidade, implantação e produtividade.",
    icon: Gauge,
    actions: [
      ["Criar painel", "/todogreen/dashboards"],
      ["Ver relatórios", "/todogreen/relatorios"],
    ],
    responsibilities: [
      "Consolidar dados de múltiplas áreas sem duplicar origem.",
      "Separar indicador real, estimativa, pendência e dado demonstrativo.",
      "Dar visão executiva de margem, SLA, receita, implantação, fretes e impacto ESG.",
    ],
    handoff: [
      ["Áreas registram na fonte transacional", "Áreas"],
      ["Indicadores consolida e compara", "Indicadores"],
      ["Administração audita permissões e rastreabilidade", "Administração"],
    ],
  },
  admin: {
    kicker: "ADMINISTRAÇÃO",
    title: "Governança da vertical",
    description: "Administração concentra acessos, permissões, integrações, auditoria, configurações e regras de governança da vertical.",
    icon: Settings,
    actions: [
      ["Usuários e acessos", "/todogreen/acessos"],
      ["Integrações", "/todogreen/integracoes"],
    ],
    responsibilities: [
      "Controlar perfis, permissões e segregação por área.",
      "Auditar alterações relevantes em cliente, contrato, frete, financeiro e ESG.",
      "Manter integrações e configurações sem expor credenciais ao usuário final.",
    ],
    handoff: [
      ["Todas as áreas usam permissões por papel", "Áreas"],
      ["Administração governa acesso e auditoria", "Administração"],
      ["Indicadores acompanha aderência e risco", "Indicadores"],
    ],
  },
  communication: {
    kicker: "COMUNICAÇÃO INTERNA",
    title: "Alinhamentos, conhecimento e trabalho",
    description: "Comunicação interna organiza documentos, comunicados, quadros, decisões e contexto compartilhado da To Do Green.",
    icon: Megaphone,
    actions: [
      ["Abrir espaço de trabalho", "/todogreen/espaco"],
      ["Abrir quadros", "/todogreen/central-trabalho"],
    ],
    responsibilities: [
      "Manter decisões, materiais internos e contexto de projetos acessíveis.",
      "Evitar que alinhamentos comerciais, operacionais e financeiros se percam em mensagens soltas.",
      "Conectar tarefas, responsáveis e documentos ao processo certo.",
    ],
    handoff: [
      ["Áreas registram decisões e pendências", "Áreas"],
      ["Comunicação organiza contexto", "Comunicação"],
      ["Gestores acompanham execução", "Indicadores"],
    ],
  },
};

const rasciDefaults = {
  products: ["Produtos", "Comercial", "Planejamento", "Operação, Financeiro, ESG", "Gestão"],
  planning: ["Planejamento", "Produtos", "Comercial, Operação", "Financeiro, Jurídico", "Gestão"],
  dp: ["DP", "Administração", "RH", "Operação, Financeiro", "Gestores"],
  hr: ["RH", "Gestão", "DP", "Operação", "Gestores"],
  quality: ["Qualidade", "Operação", "Indicadores", "Comercial, Cliente", "Gestão"],
  marketing: ["Marketing", "Comercial", "ESG, Produtos", "Operação, Jurídico", "Gestão"],
  legal: ["Jurídico", "Administração", "Comercial", "Financeiro, Implantação", "Gestão"],
  indicators: ["Indicadores", "Gestão", "Todas as áreas", "Administração", "Diretoria"],
  admin: ["Administração", "Titular", "Tecnologia", "Áreas", "Gestão"],
  communication: ["Comunicação", "Gestores", "Todas as áreas", "Administração", "Times"],
};

function RasciTable({ area }) {
  const values = rasciDefaults[area] || ["Área dona", "Gestão", "Áreas de apoio", "Áreas impactadas", "Times envolvidos"];
  const rows = [
    ["R", "Executa", values[0]],
    ["A", "Aprova", values[1]],
    ["S", "Apoia", values[2]],
    ["C", "Consulta", values[3]],
    ["I", "Informa", values[4]],
  ];
  return (
    <article className="tdg-work-area tdg-rasci-card">
      <div className="tdg-work-area-heading"><span><Gauge size={20} /></span><div><strong>RASCI</strong><small>Papel de cada área</small></div></div>
      <div className="tdg-rasci-table">
        {rows.map(([letter, role, owner]) => (
          <div key={letter}>
            <b>{letter}</b>
            <span>{role}</span>
            <strong>{owner}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function ProductStrip({ products = [] }) {
  if (!products.length) return null;
  return (
    <div className="tdg-product-strip">
      {products.slice(0, 6).map((product) => (
        <article className="tdg-product-card" key={product.id}>
          <span>{product.code}</span>
          <strong>{product.name}</strong>
          <small>{product.modality} · cobrança por {product.billingUnit}</small>
        </article>
      ))}
    </div>
  );
}

export default function EnterpriseAreaPage({ area, products = [], onNavigate }) {
  const config = cards[area] || cards.planning;
  const Icon = config.icon;
  return (
    <section className="tdg-panel tdg-enterprise-area-page">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">{config.kicker}</span>
          <h2>{config.title}</h2>
          <p>{config.description}</p>
        </div>
        <Icon size={28} />
      </div>

      <div className="tdg-work-area-grid tdg-enterprise-area-grid">
        <article className="tdg-work-area">
          <div className="tdg-work-area-heading"><span><CheckCircle2 size={20} /></span><div><strong>Responsabilidades</strong><small>O que esta área decide</small></div></div>
          <ul className="tdg-work-area-list">
            {config.responsibilities.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </article>
        <article className="tdg-work-area">
          <div className="tdg-work-area-heading"><span><FileText size={20} /></span><div><strong>Passagem entre áreas</strong><small>Como fecha a cadeia</small></div></div>
          <ul className="tdg-work-area-list">
            {config.handoff.map(([label, owner]) => <li key={label}><strong>{owner}</strong> {label}</li>)}
          </ul>
        </article>
        <article className="tdg-work-area">
          <div className="tdg-work-area-heading"><span><Target size={20} /></span><div><strong>Próximas ações</strong><small>Entrar no trabalho</small></div></div>
          <div className="tdg-work-area-links">
            {config.actions.map(([label, route]) => <button type="button" onClick={() => onNavigate?.(route)} key={route}>{label}<ArrowRight size={14} /></button>)}
          </div>
        </article>
        <RasciTable area={area} />
      </div>

      {area === "products" && <ProductStrip products={products} />}
    </section>
  );
}
