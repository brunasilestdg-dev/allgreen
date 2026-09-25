import { Suspense, lazy } from "react";
import RouteErrorBoundary from "./RouteErrorBoundary.jsx";

const LogisticsVertical = lazy(() => import("../features/logistics/LogisticsVertical.jsx"));
const GreenOnVertical = lazy(() => import("../features/greenon/GreenOnVertical.jsx"));
const GreenmobVertical = lazy(() => import("../features/greenmob/GreenmobVertical.jsx"));
const CustomerPortal = lazy(() => import("../features/logistics/CustomerPortal.jsx"));
const TmsPortal = lazy(() => import("../features/logistics/TmsPortal.jsx"));
const ClientActivationPage = lazy(() => import("../features/logistics/ClientActivationPage.jsx"));
const TodoGreenAccessInvite = lazy(() => import("../features/logistics/TodoGreenAccessInvite.jsx"));
const DriverFleetCenterPage = lazy(() => import("../features/logistics/pages/DriverFleetCenterPage.jsx"));
const DriverPortalPage = lazy(() => import("../features/logistics/pages/DriverPortalPage.jsx"));
const ColaboradorPortalPage = lazy(() => import("../features/logistics/pages/ColaboradorPortalPage.jsx"));
// Galeria viva do design system (Onda 1 do redesign) — referência dos
// componentes novos antes de adotá-los nas telas.
const DesignSystemGallery = lazy(() => import("../design-system/DesignSystemGallery.jsx"));

export function resolvePrimaryRoute(pathname, authenticated) {
  const path = String(pathname || "/");
  const publicMatch = path.match(/^\/s\/([^/]+)(?:\/([^/]+))?/);
  if (publicMatch) return { kind: "public-site", slug: publicMatch[1], page: publicMatch[2] || "" };
  const inviteMatch = path.match(/^\/convite\/([^/]+)/);
  if (inviteMatch) return { kind: "invite", token: inviteMatch[1] };
  const todoGreenInviteMatch = path.match(/^\/todogreen\/convite\/([^/]+)/);
  if (todoGreenInviteMatch) return { kind: "todogreen-access-invite", token: todoGreenInviteMatch[1] };
  if (!authenticated) {
    // A raiz é a porta da To Do Green; TMS e vertical usam a mesma identidade,
    // mas cada portal preserva o contexto escolhido durante o login.
    if (/^\/portal-tms(?:\/|$)/.test(path)) return { kind: "tms-login" };
    if (path === "/" || /^\/todogreen(?:\/|$)/.test(path))
      return { kind: "todogreen-login" };
    if (/^\/portal-cliente(?:\/|$)/.test(path)) return { kind: "customer-login" };
    if (/^\/(?:portal-motorista|central-motorista)(?:\/|$)/.test(path))
      return { kind: "driver-login" };
    if (/^\/portal-colaborador(?:\/|$)/.test(path)) return { kind: "colaborador-login" };
    return { kind: "login" };
  }
  if (/^\/portal-cliente(?:\/|$)/.test(path)) return { kind: "customer-portal" };
  if (/^\/portal-tms(?:\/|$)/.test(path)) return { kind: "tms-portal" };
  // O portal DO motorista (celular, minhas viagens) é outra coisa que a
  // central DE frota (gestão interna). Antes as quatro rotas caíam na tela de
  // gestão — e o "portal do motorista" mostrava as operações de todo mundo.
  if (/^\/(?:portal-motorista|central-motorista)(?:\/|$)/.test(path))
    return { kind: "driver-portal" };
  if (/^\/(?:motorista-frota|central-frota)(?:\/|$)/.test(path))
    return { kind: "driver-fleet-portal" };
  if (/^\/portal-colaborador(?:\/|$)/.test(path)) return { kind: "colaborador-portal" };
  if (/^\/todogreen\/ativacao(?:\/|$)/.test(path)) return { kind: "todogreen-activation" };
  if (/^\/design-system(?:\/|$)/.test(path)) return { kind: "design-system" };
  if (/^\/greenon(?:\/|$)/.test(path)) return { kind: "greenon" };
  if (/^\/greenmob(?:\/|$)/.test(path)) return { kind: "greenmob" };
  if (/^\/todogreen(?:\/|$)/.test(path)) return { kind: "todogreen" };
  return { kind: "workspace" };
}

export default function PrimaryAppRouter(props) {
  // A falha fica contida no portal que falhou (ver RouteErrorBoundary): o app
  // não cai inteiro, e trocar de rota limpa o estado de erro.
  return (
    <RouteErrorBoundary chave={props.route?.kind}>
      <PortalDaRota {...props} />
    </RouteErrorBoundary>
  );
}

function PortalDaRota({
  route,
  db,
  update,
  setToast,
  authHeaders,
  onAuthenticated,
  workspaceServerWrite,
  PublicSite,
  AcceptInvite,
  Login,
}) {
  if (route.kind === "public-site")
    return <PublicSite site={db.sites.find((item) => item.slug === route.slug)} page={route.page} />;
  if (route.kind === "invite")
    return <AcceptInvite db={db} update={update} token={route.token} onAuthenticated={onAuthenticated} />;
  if (route.kind === "login") return <Login update={update} onAuthenticated={onAuthenticated} />;
  if (route.kind === "todogreen-login") return <Login update={update} vertical onAuthenticated={onAuthenticated} />;
  if (route.kind === "tms-login")
    return <Login update={update} entryPortal="tms" onAuthenticated={onAuthenticated} />;
  if (route.kind === "customer-login")
    return <Login update={update} entryPortal="cliente" onAuthenticated={onAuthenticated} />;
  if (route.kind === "driver-login")
    return <Login update={update} entryPortal="motorista" onAuthenticated={onAuthenticated} />;
  if (route.kind === "colaborador-login")
    return <Login update={update} entryPortal="colaborador" onAuthenticated={onAuthenticated} />;
  if (route.kind === "todogreen-access-invite")
    return (
      <Suspense fallback={<div className="inbox-loading">Abrindo seu convite...</div>}>
        <TodoGreenAccessInvite token={route.token} onAuthenticated={onAuthenticated} />
      </Suspense>
    );
  if (route.kind === "customer-portal")
    return (
      <Suspense fallback={<div className="inbox-loading">Abrindo seu portal...</div>}>
        <CustomerPortal />
      </Suspense>
    );
  if (route.kind === "tms-portal")
    return (
      <Suspense fallback={<div className="inbox-loading">Abrindo Portal TMS...</div>}>
        <TmsPortal />
      </Suspense>
    );
  if (route.kind === "driver-portal")
    return (
      <Suspense fallback={<div className="inbox-loading">Abrindo suas viagens...</div>}>
        <DriverPortalPage />
      </Suspense>
    );
  if (route.kind === "driver-fleet-portal")
    return (
      <Suspense fallback={<div className="inbox-loading">Abrindo Central do Motorista/Frota...</div>}>
        <DriverFleetCenterPage authHeaders={authHeaders} setToast={setToast} mode="driver-portal" />
      </Suspense>
    );
  if (route.kind === "colaborador-portal")
    return (
      <Suspense fallback={<div className="inbox-loading">Abrindo seu portal...</div>}>
        <ColaboradorPortalPage />
      </Suspense>
    );
  if (route.kind === "todogreen-activation")
    return (
      <Suspense fallback={<div className="inbox-loading">Carregando implantação...</div>}>
        <ClientActivationPage db={db} update={update} setToast={setToast} authHeaders={authHeaders} />
      </Suspense>
    );
  if (route.kind === "design-system")
    return (
      <Suspense fallback={<div className="inbox-loading">Carregando design system...</div>}>
        <DesignSystemGallery />
      </Suspense>
    );
  if (route.kind === "todogreen")
    return (
      <Suspense fallback={<div className="inbox-loading">Carregando To Do Green...</div>}>
        <LogisticsVertical db={db} update={update} setToast={setToast} authHeaders={authHeaders} workspaceServerWrite={workspaceServerWrite} />
      </Suspense>
    );
  if (route.kind === "greenon")
    return (
      <Suspense fallback={<div className="inbox-loading">Carregando Green On...</div>}>
        <GreenOnVertical db={db} update={update} setToast={setToast} authHeaders={authHeaders} />
      </Suspense>
    );
  if (route.kind === "greenmob")
    return (
      <Suspense fallback={<div className="inbox-loading">Carregando Greenmob...</div>}>
        <GreenmobVertical db={db} update={update} setToast={setToast} authHeaders={authHeaders} />
      </Suspense>
    );
  return null;
}
