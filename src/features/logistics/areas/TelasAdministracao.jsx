// Telas de Administração e Configurações: governança, cadastros, sobre o
// negócio, RASCI, saúde do sistema, compliance (auditoria, manual, fluxos),
// jurídico, documentos, acessos, integrações e conectores.
import { Suspense, lazy } from "react";
import { hasTodoGreenPermission } from "../logisticsVerticalDomain.js";
import { AREA_DO_CADASTRO, podeAcessarFuncionalidade } from "../shell/navegacao.js";
import { navigate } from "../shell/rotas.js";
import AccessPanel from "../journeys/AccessPanel.jsx";
import { EnterpriseAreaPage } from "./paginasCompartilhadas.js";

const ErpRegistriesPage = lazy(() => import("../pages/ErpRegistriesPage.jsx"));
const SobreONegocioPage = lazy(() => import("../pages/SobreONegocioPage.jsx"));
const DocumentVaultPage = lazy(() => import("../pages/DocumentVaultPage.jsx"));
const IntegrationsPage = lazy(() => import("../pages/IntegrationsPage.jsx"));
const BusinessConnectorsPage = lazy(() => import("../pages/BusinessConnectorsPage.jsx"));
const SystemHealthPage = lazy(() => import("../pages/SystemHealthPage.jsx"));
// TDG LegalPage (antigo) permanece disponível como fallback do fluxo legado
// (aba "Fluxo antigo" dentro do LegalHub, se voltar). O menu do ERP passou
// a montar a Central Jurídica nova (`LegalHub`) por cima da mesma tabela
// canônica `todogreen_legal_records`. UM Jurídico só.
const LegalPage = lazy(() => import("../pages/LegalPage.jsx")); // eslint-disable-line no-unused-vars
const LegalHub = lazy(() => import("../../legal/LegalHub.jsx"));
const GovernancePage = lazy(() => import("../pages/GovernancePage.jsx"));
const RasciMatrixPage = lazy(() => import("../pages/RasciMatrixPage.jsx"));
const FluxosPage = lazy(() => import("../pages/FluxosPage.jsx"));
const ErpManualPage = lazy(() => import("../pages/ErpManualPage.jsx"));

export default function TelasAdministracao({ contexto }) {
  const {
    db, update, setToast, authHeaders, remoteAccess, role, page, secaoDeCadastro,
    primaryNavigation, registros, criar, atualizar, arquivar, clientes,
  } = contexto;
  return (<>
      {page === "cadastros" && <Suspense fallback={<section className="tdg-panel">Carregando cadastros...</section>}><ErpRegistriesPage registros={registros} criar={criar} atualizar={atualizar} arquivar={arquivar} setToast={setToast} secao={secaoDeCadastro} areaLabel={AREA_DO_CADASTRO[secaoDeCadastro] ? primaryNavigation.label : ""} /></Suspense>}
      {page === "sobre-o-negocio" && (
        <Suspense fallback={<section className="tdg-panel">Carregando o dossiê do negócio...</section>}>
          <SobreONegocioPage
            businessContext={registros.businessContext}
            onCreate={(registro) => criar("businessContext", registro)}
            onUpdate={(id, registro) => atualizar("businessContext", id, registro)}
            onArchive={(id) => arquivar("businessContext", id)}
            podeEditar={podeAcessarFuncionalidade(role, remoteAccess.permissions, "business:teach")}
            setToast={setToast}
          />
        </Suspense>
      )}
      {page === "rasci" && <Suspense fallback={<section className="tdg-panel">Carregando matriz RASCI...</section>}><RasciMatrixPage /></Suspense>}
      {page === "fluxos" && <Suspense fallback={<section className="tdg-panel">Carregando fluxos...</section>}><FluxosPage onNavigate={navigate} /></Suspense>}
      {page === "manual" && <Suspense fallback={<section className="tdg-panel">Carregando manual do ERP...</section>}><ErpManualPage onNavigate={navigate} /></Suspense>}
      {page === "juridico" && (
        <Suspense fallback={<section className="tdg-panel">Carregando jurídico...</section>}>
          <LegalHub
            db={db}
            update={update}
            business={db?.businesses?.find?.((b) => b.id === db?.activeBusiness) || null}
            setToast={setToast}
            authHeaders={authHeaders}
            tdgAvailable
            // Cada sub-item da sidebar do ERP aponta para /juridico?aba=xxx;
            // lemos a query aqui para abrir a Central na aba certa. Se não
            // vier query, o LegalHub cai no default (dashboard/solicitar).
            initialTab={(() => {
              if (typeof window === "undefined") return undefined;
              try {
                return new URL(window.location.href).searchParams.get("aba") || undefined;
              } catch {
                return undefined;
              }
            })()}
            viewer={{
              userId: db?.user?.id,
              name: db?.user?.name,
              // O jurídico canônico do TDG usa `compliance:manage` para saber
              // quem valida/aprova. Aqui traduzimos para o papel que a nova
              // UI entende (head_juridico = fila completa + aprovar).
              role: hasTodoGreenPermission(role, "compliance:manage", remoteAccess.permissions)
                ? "head_juridico"
                : hasTodoGreenPermission(role, "compliance:read", remoteAccess.permissions)
                  ? "juridico"
                  : "solicitante",
              isOwner: role === "owner",
            }}
          />
        </Suspense>
      )}
      {page === "administracao" && <Suspense fallback={<section className="tdg-panel">Carregando administração...</section>}><EnterpriseAreaPage area="admin" onNavigate={navigate} /></Suspense>}
      {page === "documentos" && (
        <Suspense fallback={<section className="tdg-panel">Carregando os documentos...</section>}>
          <DocumentVaultPage authHeaders={authHeaders} clientes={clientes} setToast={setToast} />
        </Suspense>
      )}
      {page === "auditoria" && <Suspense fallback={<section className="tdg-panel">Carregando auditoria...</section>}><GovernancePage role={role} permissions={remoteAccess.permissions || []} authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "acessos" && <AccessPanel role={role} permissions={remoteAccess.permissions} authHeaders={authHeaders} setToast={setToast} />}
      {page === "integracoes" && <Suspense fallback={<section className="tdg-panel">Carregando integrações...</section>}><IntegrationsPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "conectores" && <Suspense fallback={<section className="tdg-panel">Carregando conectores...</section>}><BusinessConnectorsPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
      {page === "saude-sistema" && <Suspense fallback={<section className="tdg-panel">Carregando saúde do sistema...</section>}><SystemHealthPage authHeaders={authHeaders} setToast={setToast} /></Suspense>}
  </>);
}
