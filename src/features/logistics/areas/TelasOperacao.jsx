// Telas de Operação e das áreas que a sustentam: fretes, OS, ocorrências,
// roteirização, planejamento, frota e CIOT, qualidade, produtos e suprimentos.
import { Suspense, lazy } from "react";
import { LOGISTICS_PRODUCTS } from "../logisticsVerticalDomain.js";
import { navigate } from "../shell/rotas.js";
import { TransactionalSpinePage, EnterpriseAreaPage } from "./paginasCompartilhadas.js";

const StockPage = lazy(() => import("../pages/StockPage.jsx"));
const PurchasingPage = lazy(() => import("../pages/PurchasingPage.jsx"));
const OperationsPage = lazy(() => import("../pages/OperationsPage.jsx"));
const RoteirizacaoPage = lazy(() => import("../pages/RoteirizacaoPage.jsx"));
const OperationEnginePage = lazy(() => import("../pages/OperationEnginePage.jsx"));
const OccurrencesPage = lazy(() => import("../pages/OccurrencesPage.jsx"));
const QualityPage = lazy(() => import("../pages/QualityPage.jsx"));
const DriverFleetCenterPage = lazy(() => import("../pages/DriverFleetCenterPage.jsx"));

export default function TelasOperacao({ contexto }) {
  const {
    setToast, authHeaders, page, registros, criar, atualizar, registrarEventoOperacao,
    listarSubrecurso, clientes,
  } = contexto;
  return (<>
      {page === "estoque" && <Suspense fallback={<section className="tdg-panel">Carregando estoque...</section>}><StockPage authHeaders={authHeaders} setToast={setToast} registros={registros} /></Suspense>}
      {page === "compras" && <Suspense fallback={<section className="tdg-panel">Carregando compras...</section>}><PurchasingPage authHeaders={authHeaders} setToast={setToast} registros={registros} /></Suspense>}
      {page === "produtos" && <Suspense fallback={<section className="tdg-panel">Carregando produtos...</section>}><EnterpriseAreaPage area="products" products={LOGISTICS_PRODUCTS} onNavigate={navigate} /></Suspense>}
      {page === "motor-operacao" && <Suspense fallback={<section className="tdg-panel">Carregando o motor de HC e DRE...</section>}><OperationEnginePage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "planejamento" && <Suspense fallback={<section className="tdg-panel">Carregando planejamento...</section>}><EnterpriseAreaPage area="planning" products={LOGISTICS_PRODUCTS} onNavigate={navigate} /></Suspense>}
      {page === "operacoes" && <Suspense fallback={<section className="tdg-panel">Carregando operações...</section>}><OperationsPage operations={registros.operations} clients={clientes} contracts={registros.contracts} criar={criar} atualizar={atualizar} registrarEventoOperacao={registrarEventoOperacao} listarSubrecurso={listarSubrecurso} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "roteirizacao" && <Suspense fallback={<section className="tdg-panel">Carregando o mapa...</section>}><RoteirizacaoPage setToast={setToast} authHeaders={authHeaders} pontosProprios={registros.pontosRecarga} /></Suspense>}
      {page === "motorista-frota" && <Suspense fallback={<section className="tdg-panel">Carregando frota e motoristas...</section>}><DriverFleetCenterPage authHeaders={authHeaders} operations={registros.operations} onNavigate={navigate} setToast={setToast} /></Suspense>}
      {page === "ocorrencias" && <Suspense fallback={<section className="tdg-panel">Carregando ocorrências...</section>}><OccurrencesPage operations={registros.operations} clients={clientes} registrarEventoOperacao={registrarEventoOperacao} listarSubrecurso={listarSubrecurso} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "ordens-servico" && <Suspense fallback={<section className="tdg-panel">Carregando ordens de serviço...</section>}><TransactionalSpinePage mode="service-orders" authHeaders={authHeaders} clients={clientes} contracts={registros.contracts} operations={registros.operations} setToast={setToast} /></Suspense>}
      {page === "ciot" && <Suspense fallback={<section className="tdg-panel">Carregando CIOT...</section>}><TransactionalSpinePage mode="ciot" authHeaders={authHeaders} clients={clientes} contracts={registros.contracts} operations={registros.operations} setToast={setToast} /></Suspense>}
      {page === "qualidade" && <Suspense fallback={<section className="tdg-panel">Carregando qualidade...</section>}><QualityPage registros={registros.quality} clients={clientes} operations={registros.operations} criar={criar} atualizar={atualizar} setToast={setToast} /></Suspense>}
  </>);
}
