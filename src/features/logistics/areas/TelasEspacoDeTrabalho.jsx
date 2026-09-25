// Telas do Espaço de trabalho: o espaço (visão geral, visualizações, agentes),
// Planner, Implantação, Solicitações de clientes e Avanços da semana.
import { Suspense, lazy } from "react";
import { activeSpaceId as espacoAtivoDoApp } from "../../../session/armazenamento.js";
import { workspaceToolFromPath, navigate } from "../shell/rotas.js";

const PlannerPage = lazy(() => import("../pages/PlannerPage.jsx"));
const AvancosDaSemanaPage = lazy(() => import("../pages/AvancosDaSemanaPage.jsx"));
const ClientRequestsPage = lazy(() => import("../pages/ClientRequestsPage.jsx"));
const TodoGreenWorkspace = lazy(() => import("../TodoGreenWorkspace.jsx"));
const ClientActivationPage = lazy(() => import("../ClientActivationPage.jsx"));

export default function TelasEspacoDeTrabalho({ contexto }) {
  const {
    db, update, setToast, authHeaders, path, remoteAccess, role, page, ehDev, criar,
    clientes, verticalData, workspaceServerWrite,
  } = contexto;
  return (<>
      {/* Espaço de trabalho é a dona única de /espaco e do link legado
          /central-trabalho. O alias é resolvido antes desta renderização. */}
      {["espaco", "visualizacoes", "agentes-funcoes"].includes(page) && (
        <Suspense fallback={<section className="tdg-panel">Abrindo o espaço de trabalho...</section>}>
          <TodoGreenWorkspace
            key={`${page}:${workspaceToolFromPath(path)}`}
            db={db}
            update={update}
            verticalData={verticalData}
            setToast={setToast}
            onNavigate={navigate}
            authHeaders={authHeaders}
            mostrarIntegracoes={ehDev}
            initialTool={page === "visualizacoes" ? "visoes" : page === "agentes-funcoes" ? "agentes" : workspaceToolFromPath(path)}
          />
        </Suspense>
      )}
      {page === "solicitacoes" && <Suspense fallback={<section className="tdg-panel">Carregando solicitações...</section>}><ClientRequestsPage authHeaders={authHeaders} setToast={setToast} currentUserId={db?.user?.id} clientes={clientes} onCreateTask={(task) => update?.((current) => ({ ...current, tasks: [task, ...(current.tasks || [])] }))} /></Suspense>}
      {page === "implantacao" && (
        <Suspense fallback={<section className="tdg-panel">Carregando implantação...</section>}>
          <ClientActivationPage db={db} update={update} authHeaders={authHeaders} setToast={setToast} />
        </Suspense>
      )}
      {page === "planner" && <Suspense fallback={<section className="tdg-panel">Carregando o Planner...</section>}><PlannerPage
        authHeaders={authHeaders}
        setToast={setToast}
        currentUserId={db?.user?.id}
        role={role}
        permissions={remoteAccess.permissions}
        espacoId={remoteAccess.ownerId || ""}
        clientes={clientes}
        oportunidades={verticalData.opportunities}
        onNavigate={navigate}
        // As ações do plano são lidas e gravadas pelo servidor, no quadro do
        // DONO do espaço da vertical — assim quem vê o plano vê todas as
        // ações, esteja ou não no espaço do app da titular. `canonicalTasks` e
        // `onDeleteCanonicalTask` ficam só para resgatar ações antigas que
        // foram gravadas no workspace pessoal de quem as criou.
        canonicalTasks={db?.tasks || []}
        espacoDoApp={espacoAtivoDoApp() || db?.user?.id || ""}
        workspaceServerWrite={workspaceServerWrite}
        onDeleteCanonicalTask={(taskId) => update?.((current) => ({
          ...current,
          tasks: (current.tasks || []).filter((item) => item.id !== taskId),
        }))}
      /></Suspense>}
      {page === "avancos" && <Suspense fallback={<section className="tdg-panel">Carregando os avanços da semana...</section>}><AvancosDaSemanaPage opportunities={verticalData.opportunities} comments={verticalData.comments} interactions={verticalData.interactions} onComment={(registro) => criar("comments", registro)} onNavigate={navigate} setToast={setToast} /></Suspense>}
  </>);
}
