// Telas de Principal e Indicadores: o início do ERP, os painéis, os KPIs por
// área e os relatórios.
import { Suspense, lazy } from "react";
import { LOGISTICS_PRODUCTS } from "../logisticsVerticalDomain.js";
import ErpHome from "../ErpHome.jsx";
import { navigate } from "../shell/rotas.js";
import { EnterpriseAreaPage } from "./paginasCompartilhadas.js";

const DashboardBuilderPage = lazy(() => import("../pages/DashboardBuilderPage.jsx"));
const ReportsPage = lazy(() => import("../pages/ReportsPage.jsx"));

export default function TelasPrincipal({ contexto }) {
  const {
    db, setToast, authHeaders, role, page, registros, verticalData, dashboard,
    saveHomePreferences,
  } = contexto;
  return (<>
      {page === "dashboard" && <ErpHome role={role} user={db?.user || {}} data={verticalData} dashboard={dashboard} tasks={db?.tasks || []} products={LOGISTICS_PRODUCTS} preferences={db?.preferences?.todoGreenHome} onSave={saveHomePreferences} onNavigate={navigate} />}
      {page === "dashboards" && <Suspense fallback={<section className="tdg-panel">Carregando seus painéis...</section>}><DashboardBuilderPage authHeaders={authHeaders} summary={dashboard} data={registros} setToast={setToast} /></Suspense>}
      {page === "indicadores" && <Suspense fallback={<section className="tdg-panel">Carregando indicadores...</section>}><EnterpriseAreaPage area="indicators" onNavigate={navigate} /></Suspense>}
      {page === "relatorios" && <Suspense fallback={<section className="tdg-panel">Carregando relatórios...</section>}><ReportsPage dashboard={dashboard} data={verticalData} authHeaders={authHeaders} setToast={setToast} /></Suspense>}
  </>);
}
