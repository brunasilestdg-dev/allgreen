// Telas de Pessoas: Departamento Pessoal e Recursos Humanos.
import { Suspense, lazy } from "react";
import { navigate } from "../shell/rotas.js";
import { EnterpriseAreaPage } from "./paginasCompartilhadas.js";

const PeoplePage = lazy(() => import("../pages/PeoplePage.jsx"));

export default function TelasPessoas({ contexto }) {
  const { setToast, authHeaders, page } = contexto;
  return (<>
      {page === "dp-rh" && <Suspense fallback={<section className="tdg-panel">Carregando DP...</section>}><EnterpriseAreaPage area="dp" onNavigate={navigate} /></Suspense>}
      {page === "rh" && <Suspense fallback={<section className="tdg-panel">Carregando DP/RH...</section>}><PeoplePage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
  </>);
}
