import { ScrollText } from "lucide-react";
import { TODO_GREEN_MODULE_CATALOG } from "../logisticsVerticalDomain.js";

// Manual VIVO: é gerado a partir do catálogo de módulos (TODO_GREEN_MODULE_CATALOG).
// Toda vez que um módulo é criado ou alterado lá, o manual reflete a mudança
// sozinho — não há texto duplicado para manter em dia à mão.

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
  const grupos = agruparPorArea();
  const totalModulos = TODO_GREEN_MODULE_CATALOG.length;
  return (
    <section className="tdg-panel tdg-manual-page">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">MANUAL DO ERP</span>
          <h2>Manual do ERP</h2>
          <p>O que cada módulo faz e a permissão que ele exige. Este manual é gerado do catálogo de módulos — sempre que um módulo muda, ele se atualiza sozinho. {totalModulos} módulos em {grupos.length} áreas.</p>
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
              {grupo.modulos.map((modulo) => (
                <article className="tdg-manual-modulo" key={modulo.id}>
                  <header>
                    <strong>{modulo.name}</strong>
                    <span className="tdg-manual-perm">{permissaoDoModulo(modulo.permissions)}</span>
                  </header>
                  <p>{modulo.description || "Sem descrição cadastrada."}</p>
                  {onNavigate && modulo.workspaceRoute && (
                    <button type="button" onClick={() => onNavigate(modulo.workspaceRoute)}>Abrir módulo</button>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
