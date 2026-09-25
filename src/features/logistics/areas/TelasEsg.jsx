// Telas de ESG: Central ESG, ESG operacional, energia e metodologia.
import { Suspense, lazy } from "react";
import { navigate } from "../shell/rotas.js";
import EsgPanel, { MethodologyPanel } from "../journeys/EsgPanel.jsx";

const EsgCenter = lazy(() => import("../EsgCenter.jsx"));
const EnergyPage = lazy(() => import("../pages/EnergyPage.jsx"));

export default function TelasEsg({ contexto }) {
  const { setToast, authHeaders, page, verticalData, dashboard } = contexto;
  return (<>
      {page === "esg" && <EsgPanel dashboard={dashboard} data={verticalData} onNavigate={navigate} />}
      {page === "energia" && <Suspense fallback={<section className="tdg-panel">Carregando energia...</section>}><EnergyPage authHeaders={authHeaders} /></Suspense>}
      {page === "central-esg" && (
        <Suspense fallback={<section className="tdg-panel">Carregando Central ESG...</section>}>
          <EsgCenter authHeaders={authHeaders} setToast={setToast} />
        </Suspense>
      )}
      {page === "metodologia" && <MethodologyPanel authHeaders={authHeaders} setToast={setToast} />}
  </>);
}
