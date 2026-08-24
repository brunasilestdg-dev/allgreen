import { ArrowRight, Boxes, CheckCircle2, FileText, Route, Target, TrendingUp, Users } from "lucide-react";

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
  hr: {
    kicker: "DP/RH",
    title: "Pessoas, motoristas e escalas",
    description: "DP/RH fica separado de Financeiro porque dados de pessoal, folha, documentos e disponibilidade exigem governança própria.",
    icon: Users,
    actions: [
      ["Ver metas", "/todogreen/metas"],
      ["Ver operações", "/todogreen/operacoes"],
    ],
    responsibilities: [
      "Gerir motoristas, equipes, documentos, disponibilidade e dados sensíveis.",
      "Apoiar escalas e alocação por operação, janela, produto e capacidade.",
      "Conectar metas, treinamentos e planos de ação sem expor remuneração indevida.",
    ],
    handoff: [
      ["Planejamento consulta capacidade humana", "Planejamento"],
      ["Operação usa escala e alocação", "Operação"],
      ["Gestão acompanha metas e planos", "Gestão"],
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
};

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
      </div>

      {area === "products" && <ProductStrip products={products} />}
    </section>
  );
}
