import "./TodoGreenPages.css";

// ===== Matriz RASCI — uma aba, todas as áreas =====
//
// Antes o RASCI aparecia repetido no rodapé de cada área (Produtos,
// Planejamento, DP, RH, Qualidade, Marketing, Jurídico, Indicadores,
// Administração), cada um mostrando só a própria linha. Quem queria a foto
// inteira — quem responde pelo quê — tinha de abrir nove telas e montar de
// cabeça. Aqui é a matriz completa num lugar só.

const AREAS = [
  { id: "products", nome: "Produtos", valores: ["Produtos", "Comercial", "Planejamento", "Operação, Financeiro, ESG", "Gestão"] },
  { id: "planning", nome: "Planejamento", valores: ["Planejamento", "Produtos", "Comercial, Operação", "Financeiro, Jurídico", "Gestão"] },
  { id: "commercial", nome: "Comercial", valores: ["Comercial", "Liderança comercial", "Produtos, Precificação", "Financeiro, Operação", "Gestão"] },
  { id: "operations", nome: "Operação", valores: ["Operação", "Planejamento", "Frota, Motoristas", "Comercial, Cliente", "Gestão"] },
  { id: "finance", nome: "Financeiro", valores: ["Financeiro", "Gestão", "Fiscal, Tesouraria", "Operação, Comercial", "Diretoria"] },
  { id: "dp", nome: "DP", valores: ["DP", "Administração", "RH", "Operação, Financeiro", "Gestores"] },
  { id: "hr", nome: "RH", valores: ["RH", "Gestão", "DP", "Operação", "Gestores"] },
  { id: "quality", nome: "Qualidade", valores: ["Qualidade", "Operação", "Indicadores", "Comercial, Cliente", "Gestão"] },
  { id: "marketing", nome: "Marketing", valores: ["Marketing", "Comercial", "ESG, Produtos", "Operação, Jurídico", "Gestão"] },
  { id: "legal", nome: "Jurídico", valores: ["Jurídico", "Administração", "Comercial", "Financeiro, Implantação", "Gestão"] },
  { id: "indicators", nome: "Indicadores", valores: ["Indicadores", "Gestão", "Todas as áreas", "Administração", "Diretoria"] },
  { id: "communication", nome: "Espaço de trabalho", valores: ["Comunicação", "Gestores", "Todas as áreas", "Administração", "Times"] },
  { id: "admin", nome: "Administração", valores: ["Administração", "Titular", "Tecnologia", "Áreas", "Gestão"] },
];

const COLUNAS = [
  { letra: "R", papel: "Executa", dica: "Responsible" },
  { letra: "A", papel: "Aprova", dica: "Accountable" },
  { letra: "S", papel: "Apoia", dica: "Support" },
  { letra: "C", papel: "Consulta", dica: "Consulted" },
  { letra: "I", papel: "Informa", dica: "Informed" },
];

export default function RasciMatrixPage() {
  return (
    <section className="tdg-panel tdg-page">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">GOVERNANÇA · RESPONSABILIDADES</span>
          <h2>Matriz RASCI</h2>
          <p>Quem executa, aprova, apoia, consulta e é informado em cada área — a foto inteira num lugar só, não espalhada por cada menu.</p>
        </div>
        <strong>{AREAS.length} áreas</strong>
      </div>

      <div className="tdg-rasci-legend">
        {COLUNAS.map((col) => (
          <span key={col.letra}><b>{col.letra}</b> {col.papel} <small>{col.dica}</small></span>
        ))}
      </div>

      <div className="tdg-table-scroll">
        <table className="tdg-table tdg-rasci-matrix">
          <thead>
            <tr>
              <th>Área</th>
              {COLUNAS.map((col) => <th key={col.letra}>{col.letra} · {col.papel}</th>)}
            </tr>
          </thead>
          <tbody>
            {AREAS.map((area) => (
              <tr key={area.id}>
                <th scope="row">{area.nome}</th>
                {area.valores.map((valor, i) => (
                  <td key={COLUNAS[i].letra}>{valor}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
