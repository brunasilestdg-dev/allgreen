// Telas do Comercial: painel, clientes, oportunidades, funil, precificação e
// parâmetros de preço, aceite de viagem, propostas, RFQ, aprovações, mercado,
// metas, performance e playbook.
import { Suspense, lazy } from "react";
import { podeAcessarFuncionalidade } from "../shell/navegacao.js";
import { produtoDaRota, navigate } from "../shell/rotas.js";
import PricingPanel from "../journeys/PricingPanel.jsx";
import ProposalPanel from "../journeys/ProposalPanel.jsx";

const PricingParametersPanel = lazy(() => import("../PricingParametersPanel.jsx"));
const GoalsPage = lazy(() => import("../pages/GoalsPage.jsx"));
const SalesPerformancePage = lazy(() => import("../pages/SalesPerformancePage.jsx"));
const ClientsPage = lazy(() => import("../pages/ClientsPage.jsx"));
const CentralRfqPage = lazy(() => import("../pages/CentralRfqPage.jsx"));
const OpportunitiesPage = lazy(() => import("../pages/OpportunitiesPage.jsx"));
const SalesFunnelPage = lazy(() => import("../pages/SalesFunnelPage.jsx"));
const TripViabilityPage = lazy(() => import("../pages/TripViabilityPage.jsx"));
const DealDeskPage = lazy(() => import("../pages/DealDeskPage.jsx"));
const CommercialPanelPage = lazy(() => import("../pages/CommercialPanelPage.jsx"));
const TodoGreenIntelligenceHub = lazy(() => import("../TodoGreenIntelligenceHub.jsx"));
const TodoGreenGuides = lazy(() => import("../TodoGreenGuides.jsx"));

export default function TelasComercial({ contexto }) {
  const {
    db, update, setToast, authHeaders, path, remoteAccess, role, page, registros, criar,
    atualizar, arquivar, pedidosDeAprovacao, clientes, setClientes, verticalData,
  } = contexto;
  return (<>
      {page === "metas" && <Suspense fallback={<section className="tdg-panel">Carregando metas...</section>}><GoalsPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "performance-comercial" && <Suspense fallback={<section className="tdg-panel">Carregando performance comercial...</section>}><SalesPerformancePage authHeaders={authHeaders} onNavigate={navigate} /></Suspense>}
      {page === "playbook-comercial" && <Suspense fallback={<section className="tdg-panel">Carregando playbook comercial...</section>}><TodoGreenGuides mode="playbook" onNavigate={navigate} /></Suspense>}
      {page === "central-rfq" && (
        <Suspense fallback={<section className="tdg-panel">Carregando a Central de RFQ...</section>}>
          <CentralRfqPage
            habilitacao={registros.habilitacao}
            habilitacaoKits={registros.habilitacaoKits}
            rfq={registros.rfq}
            clientes={clientes}
            onCriarDocumento={(registro) => criar("habilitacao", registro)}
            onAtualizarDocumento={(id, registro) => atualizar("habilitacao", id, registro)}
            onArquivarDocumento={(id) => arquivar("habilitacao", id)}
            onCriarKit={(registro) => criar("habilitacaoKits", registro)}
            onCriarRfq={(registro) => criar("rfq", registro)}
            onAtualizarRfq={(id, registro) => atualizar("rfq", id, registro)}
            podeEditar={podeAcessarFuncionalidade(role, remoteAccess.permissions, "compliance:manage")}
            authHeaders={authHeaders}
            setToast={setToast}
          />
        </Suspense>
      )}
      {page === "clientes" && <Suspense fallback={<section className="tdg-panel">Carregando clientes...</section>}><ClientsPage authHeaders={authHeaders} opportunities={verticalData.opportunities} contracts={registros.contracts} operations={registros.operations} financial={registros.financial} tasks={db?.tasks || []} comments={verticalData.comments} onComment={(registro) => criar("comments", registro)} interactions={verticalData.interactions} onInteraction={(registro) => criar("interactions", registro)} onNavigate={navigate} setToast={setToast} currentUserId={db?.user?.id} remetenteNome={db?.user?.name || ""} assinaturaEmail={db?.preferences?.assinaturaEmail || ""} espacoId={remoteAccess.ownerId || ""} onClientesChange={setClientes} onCreateTask={(task) => update?.((current) => ({ ...current, tasks: [task, ...(current.tasks || [])] }))} onCompletarTarefa={(taskId) => update?.((current) => ({ ...current, tasks: (current.tasks || []).map((t) => t.id === taskId ? { ...t, status: "Concluído" } : t) }))} /></Suspense>}
      {page === "oportunidades" && <Suspense fallback={<section className="tdg-panel">Carregando oportunidades...</section>}><OpportunitiesPage currentUserId={db?.user?.id} espacoId={remoteAccess.ownerId || ""} onCreateTask={(task) => update?.((current) => ({ ...current, tasks: [task, ...(current.tasks || [])] }))} clients={clientes} opportunities={verticalData.opportunities} scenarios={verticalData.pricingScenarios} comments={verticalData.comments} onComment={(registro) => criar("comments", registro)} interactions={verticalData.interactions} onInteraction={(registro) => criar("interactions", registro)} authHeaders={authHeaders} onCreate={(registro) => criar("opportunities", registro)} onUpdate={(id, alteracoes) => atualizar("opportunities", id, alteracoes)} onDelete={(id) => arquivar("opportunities", id)} onNavigate={navigate} setToast={setToast} /></Suspense>}
      {page === "funil" && <Suspense fallback={<section className="tdg-panel">Carregando o funil...</section>}><SalesFunnelPage opportunities={verticalData.opportunities} onNavigate={navigate} setToast={setToast} /></Suspense>}
      {page === "propostas" && <ProposalPanel data={verticalData} criar={criar} atualizar={atualizar} pedidosDeAprovacao={pedidosDeAprovacao} setToast={setToast} />}
      {page === "precificacao" && <PricingPanel key={`${produtoDaRota(path) || "nova"}:${new URLSearchParams(path.split("?")[1] || "").get("opportunity") || "nova"}`} role={role} criar={criar} db={db} authHeaders={authHeaders} setToast={setToast} opportunities={verticalData.opportunities} />}
      {page === "regua" && (
        <Suspense fallback={<section className="tdg-panel">Carregando parâmetros do simulador...</section>}>
          <PricingParametersPanel authHeaders={authHeaders} setToast={setToast} />
        </Suspense>
      )}
      {/* O simulador de aceite tem tela própria de novo: ele nasceu em
          Financeiro → Custos, foi parar no rodapé do Planejamento e o menu
          "Aceite" apontava para Ordens de Serviço — na prática, sumiu. */}
      {page === "aceite-viagens" && <Suspense fallback={<section className="tdg-panel">Carregando o simulador de aceite...</section>}><TripViabilityPage authHeaders={authHeaders} /></Suspense>}
      {page === "marketing" && <Suspense fallback={<section className="tdg-panel">Carregando inteligência de mercado...</section>}><TodoGreenIntelligenceHub verticalData={verticalData} onNavigate={navigate} authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "deal-desk" && (
        <Suspense fallback={<section className="tdg-panel">Carregando aprovações...</section>}>
          <DealDeskPage
            authHeaders={authHeaders}
            quem={{ userId: db?.user?.id || "", role, permissions: remoteAccess.permissions || [] }}
            setToast={setToast}
          />
        </Suspense>
      )}
      {page === "painel-comercial" && <Suspense fallback={<section className="tdg-panel">Carregando painel comercial...</section>}><CommercialPanelPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
  </>);
}
