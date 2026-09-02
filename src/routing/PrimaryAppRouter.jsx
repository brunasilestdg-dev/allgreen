import { Suspense, lazy } from "react";

const LogisticsVertical = lazy(() => import("../features/logistics/LogisticsVertical.jsx"));
const CustomerPortal = lazy(() => import("../features/logistics/CustomerPortal.jsx"));
const ClientActivationPage = lazy(() => import("../features/logistics/ClientActivationPage.jsx"));
const TodoGreenAccessInvite = lazy(() => import("../features/logistics/TodoGreenAccessInvite.jsx"));
const DriverFleetCenterPage = lazy(() => import("../features/logistics/pages/DriverFleetCenterPage.jsx"));
const DriverPortalPage = lazy(() => import("../features/logistics/pages/DriverPortalPage.jsx"));

export function resolvePrimaryRoute(pathname, authenticated) {
  const path = String(pathname || "/");
  const publicMatch = path.match(/^\/s\/([^/]+)(?:\/([^/]+))?/);
  if (publicMatch) return { kind: "public-site", slug: publicMatch[1], page: publicMatch[2] || "" };
  const inviteMatch = path.match(/^\/convite\/([^/]+)/);
  if (inviteMatch) return { kind: "invite", token: inviteMatch[1] };
  const todoGreenInviteMatch = path.match(/^\/todogreen\/convite\/([^/]+)/);
  if (todoGreenInviteMatch) return { kind: "todogreen-access-invite", token: todoGreenInviteMatch[1] };
  if (!authenticated) {
    // A raiz é a porta da To Do Green; cada público entra no seu próprio
    // contexto e não volta ao produto genérico depois de se autenticar.
    if (path === "/" || /^\/todogreen(?:\/|$)/.test(path)) return { kind: "todogreen-login" };
    if (/^\/portal-cliente(?:\/|$)/.test(path)) return { kind: "customer-login" };
    if (/^\/(?:portal-motorista|central-motorista)(?:\/|$)/.test(path))
      return { kind: "driver-login" };
    return { kind: "login" };
  }
  if (/^\/portal-cliente(?:\/|$)/.test(path)) return { kind: "customer-portal" };
  // O portal DO motorista (celular, minhas viagens) é outra coisa que a
  // central DE frota (gestão interna). Antes as quatro rotas caíam na tela de
  // gestão — e o "portal do motorista" mostrava as operações de todo mundo.
  if (/^\/(?:portal-motorista|central-motorista)(?:\/|$)/.test(path))
    return { kind: "driver-portal" };
  if (/^\/(?:motorista-frota|central-frota)(?:\/|$)/.test(path))
    return { kind: "driver-fleet-portal" };
  if (/^\/todogreen\/ativacao(?:\/|$)/.test(path)) return { kind: "todogreen-activation" };
  if (/^\/todogreen(?:\/|$)/.test(path)) return { kind: "todogreen" };
  return { kind: "workspace" };
}

export default function PrimaryAppRouter({
  route,
  db,
  update,
  setToast,
  authHeaders,
  onAuthenticated,
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
  if (route.kind === "customer-login")
    return <Login update={update} entryPortal="cliente" onAuthenticated={onAuthenticated} />;
  if (route.kind === "driver-login")
    return <Login update={update} entryPortal="motorista" onAuthenticated={onAuthenticated} />;
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
  if (route.kind === "todogreen-activation")
    return (
      <Suspense fallback={<div className="inbox-loading">Carregando implantação...</div>}>
        <ClientActivationPage db={db} update={update} setToast={setToast} authHeaders={authHeaders} />
      </Suspense>
    );
  if (route.kind === "todogreen")
    return (
      <Suspense fallback={<div className="inbox-loading">Carregando To Do Green...</div>}>
        <LogisticsVertical db={db} update={update} setToast={setToast} authHeaders={authHeaders} />
      </Suspense>
    );
  return null;
}
