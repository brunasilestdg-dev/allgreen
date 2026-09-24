// Telas do Green Tech Core: as 11 telas do roadmap All Green reunidas numa
// área só no menu.
import { Suspense, lazy } from "react";

// Páginas das 6 lacunas dos 26 blocos (aprimoramentos aditivos).
const TenantAccessPage = lazy(() => import("../pages/TenantAccessPage.jsx"));
const CorporateAccountPage = lazy(() => import("../pages/CorporateAccountPage.jsx"));
const RoamingPage = lazy(() => import("../pages/RoamingPage.jsx"));
const EnergyPeakSavingsPage = lazy(() => import("../pages/EnergyPeakSavingsPage.jsx"));
const AlertQueuePage = lazy(() => import("../pages/AlertQueuePage.jsx"));
const GreenmobRentalPage = lazy(() => import("../pages/GreenmobRentalPage.jsx"));
const SaasBillingPage = lazy(() => import("../pages/SaasBillingPage.jsx"));
// Páginas do roadmap P0/P1/P2 (rodada seguinte, também aditiva).
const GroupEntitiesPage = lazy(() => import("../pages/GroupEntitiesPage.jsx"));
const OcppConsolePage = lazy(() => import("../pages/OcppConsolePage.jsx"));
const GreenOnAppPage = lazy(() => import("../pages/GreenOnAppPage.jsx"));
const PhysicalSafetyPage = lazy(() => import("../pages/PhysicalSafetyPage.jsx"));

export default function TelasGreenTechCore({ contexto }) {
  const { page } = contexto;
  return (<>
      {page === "tenant-acessos" && <Suspense fallback={<section className="tdg-panel">Carregando perfis...</section>}><TenantAccessPage /></Suspense>}
      {page === "green-on-empresa" && <Suspense fallback={<section className="tdg-panel">Carregando conta corporativa...</section>}><CorporateAccountPage /></Suspense>}
      {page === "roaming-ocpi" && <Suspense fallback={<section className="tdg-panel">Carregando roaming...</section>}><RoamingPage /></Suspense>}
      {page === "energia-peak" && <Suspense fallback={<section className="tdg-panel">Carregando BESS e pico...</section>}><EnergyPeakSavingsPage /></Suspense>}
      {page === "fila-alertas" && <Suspense fallback={<section className="tdg-panel">Carregando fila de alertas...</section>}><AlertQueuePage /></Suspense>}
      {page === "greenmob-locacao" && <Suspense fallback={<section className="tdg-panel">Carregando Greenmob...</section>}><GreenmobRentalPage /></Suspense>}
      {page === "saas-billing" && <Suspense fallback={<section className="tdg-panel">Carregando billing...</section>}><SaasBillingPage /></Suspense>}
      {page === "core-grupo" && <Suspense fallback={<section className="tdg-panel">Carregando Core All Green...</section>}><GroupEntitiesPage /></Suspense>}
      {page === "ocpp-console" && <Suspense fallback={<section className="tdg-panel">Carregando OCPP...</section>}><OcppConsolePage /></Suspense>}
      {page === "green-on-app" && <Suspense fallback={<section className="tdg-panel">Carregando Green On App...</section>}><GreenOnAppPage /></Suspense>}
      {page === "seguranca-fisica" && <Suspense fallback={<section className="tdg-panel">Carregando segurança...</section>}><PhysicalSafetyPage /></Suspense>}
  </>);
}
