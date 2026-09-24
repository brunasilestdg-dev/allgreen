// Telas de recarga: pontos próprios, sessões, reservas de carregador e
// cobrança por kWh.
import { Suspense, lazy } from "react";

const ChargingPointsPage = lazy(() => import("../pages/ChargingPointsPage.jsx"));
const ChargingSessionsPage = lazy(() => import("../pages/ChargingSessionsPage.jsx"));
const ChargerReservationsPage = lazy(() => import("../pages/ChargerReservationsPage.jsx"));
const ChargingBillingPage = lazy(() => import("../pages/ChargingBillingPage.jsx"));

export default function TelasRecarga({ contexto }) {
  const { setToast, authHeaders, page, registros, criar, atualizar, arquivar, clientes } = contexto;
  return (<>
      {page === "pontos-recarga" && <Suspense fallback={<section className="tdg-panel">Carregando pontos de recarga...</section>}><ChargingPointsPage registros={registros.pontosRecarga} criar={criar} atualizar={atualizar} arquivar={arquivar} setToast={setToast} /></Suspense>}
      {page === "sessoes-recarga" && <Suspense fallback={<section className="tdg-panel">Carregando sessões de recarga...</section>}><ChargingSessionsPage registros={registros.chargingSessions} pontos={registros.pontosRecarga} clientes={clientes} criar={criar} atualizar={atualizar} arquivar={arquivar} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "reservas-recarga" && <Suspense fallback={<section className="tdg-panel">Carregando reservas...</section>}><ChargerReservationsPage registros={registros.chargerReservations} pontos={registros.pontosRecarga} criar={criar} atualizar={atualizar} arquivar={arquivar} setToast={setToast} authHeaders={authHeaders} /></Suspense>}
      {page === "cobranca-recarga" && <Suspense fallback={<section className="tdg-panel">Carregando cobrança de recarga...</section>}><ChargingBillingPage regras={registros.chargingPrices} sessoes={registros.chargingSessions} clientes={clientes} criar={criar} arquivar={arquivar} setToast={setToast} /></Suspense>}
  </>);
}
