import EnergyPanel from "./EnergyPanel.jsx";
import "./TodoGreenPages.css";

// Página própria de Energia. O conteúdo mora no EnergyPanel (reaproveitado
// também dentro da Central ESG), então aqui é só o embrulho da página.
export default function EnergyPage({ authHeaders }) {
  return (
    <div className="tdg-page tdg-energia-page">
      <EnergyPanel authHeaders={authHeaders} />
    </div>
  );
}
