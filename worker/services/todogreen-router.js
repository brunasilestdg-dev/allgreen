import { handleTodoGreenWorkCenter } from "./todogreen-work-center.js";
import { exigirAcessoTodoGreen } from "./todogreen-access.js";
import { handleTodoGreenFleet } from "./todogreen-fleet.js";
import { handleTodoGreenTracker } from "./todogreen-tracker.js";
import { handleTodoGreenTrackerReadiness } from "./todogreen-tracker-readiness.js";
import { handleTodoGreenClientActivation } from "./todogreen-client-activation.js";
import {
  handleTodoGreenCustomerPortal,
  handleTodoGreenClientPortalPreview,
  handleTodoGreenClients,
  handleTodoGreenClientAssignments,
} from "./todogreen-customer-portal.js";
import { handleTodoGreenEsg } from "./todogreen-esg.js";
import { handleTodoGreenPricingParameters } from "./todogreen-pricing-parameters.js";
import { handleTodoGreenDashboards } from "./todogreen-dashboards.js";
import { handleTodoGreenRequests } from "./todogreen-requests.js";
import { handleTodoGreenVerticalRecords } from "./todogreen-vertical-records.js";
import { handleTodoGreenStock } from "./todogreen-stock.js";
import { handleTodoGreenPurchasing } from "./todogreen-purchasing.js";
import { handleTodoGreenTransactions } from "./todogreen-transactions.js";
import { handleTodoGreenDealDesk } from "./todogreen-deal-desk.js";
import { entregarArquivo, handleTodoGreenEvidences } from "./todogreen-evidences.js";
import { handleTodoGreenClientIntelligence } from "./todogreen-client-intelligence.js";
import { handleTodoGreenSemente } from "./todogreen-semente.js";
import { handleTodoGreenTimeline } from "./todogreen-timeline.js";
import { handleTodoGreenIntegrations } from "./todogreen-integrations.js";
import { handleTodoGreenPricingPerformance } from "./todogreen-pricing-performance.js";
import { handleTodoGreenGovernance } from "./todogreen-governance.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const guarded = async (label, message, handler) => {
  try { return await handler(); }
  catch (error) {
    console.error(label, error);
    return json({ error: message }, 500);
  }
};

const internalAccess = (request, env) => exigirAcessoTodoGreen(request, env);

export async function routeTodoGreenApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/todogreen/")) return null;

  if (path === "/api/todogreen/arquivo") {
    return guarded("To Do Green document error", "Não foi possível entregar o documento.", () =>
      entregarArquivo(env, url.searchParams.get("t") || ""),
    );
  }

  if (path.startsWith("/api/todogreen/evidencias")) {
    return guarded("To Do Green evidences error", "Não foi possível carregar os documentos.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenEvidences(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/client-portal-preview")) {
    return guarded("To Do Green portal preview error", "Não foi possível montar a prévia do portal.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenClientPortalPreview(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/client-activation")) {
    return guarded("To Do Green client activation error", "Não foi possível processar a implantação do cliente.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenClientActivation(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/portal"))
    return guarded("To Do Green customer portal error", "Não foi possível abrir o portal do cliente.",
      () => handleTodoGreenCustomerPortal(request, env));
  if (path.startsWith("/api/todogreen/work-center"))
    return guarded("To Do Green work center error", "Não foi possível sincronizar a Central de Trabalho.",
      () => handleTodoGreenWorkCenter(request, env, ctx));
  if (path.startsWith("/api/todogreen/pricing-parameters"))
    return guarded("To Do Green pricing parameters error", "Não foi possível carregar os parâmetros comerciais.",
      () => handleTodoGreenPricingParameters(request, env));
  if (path.startsWith("/api/todogreen/pricing-performance")) {
    return guarded("To Do Green pricing performance error", "Não foi possível comparar preço e operação.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenPricingPerformance(request, env, resolved.access, resolved.user);
    });
  }
  if (path.startsWith("/api/todogreen/dashboards"))
    return guarded("To Do Green dashboards error", "Não foi possível carregar os painéis.",
      () => handleTodoGreenDashboards(request, env));
  if (path.startsWith("/api/todogreen/esg"))
    return guarded("To Do Green ESG error", "Não foi possível processar o cálculo ambiental.",
      () => handleTodoGreenEsg(request, env));
  if (path.startsWith("/api/todogreen/tracker/")) {
    const readiness = await guarded(
      "To Do Green Tracker readiness error",
      "Não foi possível carregar o diagnóstico do rastreamento.",
      () => handleTodoGreenTrackerReadiness(request, env),
    );
    if (readiness) return readiness;
  }
  if (path.startsWith("/api/todogreen/tracker"))
    return guarded("To Do Green Tracker error", "Não foi possível processar o rastreamento veicular.",
      () => handleTodoGreenTracker(request, env));
  if (path.startsWith("/api/todogreen/fleet")) {
    return guarded("To Do Green fleet error", "Não foi possível sincronizar a frota.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenFleet(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/deal-desk")) {
    return guarded("To Do Green deal desk error", "Não foi possível processar a aprovação comercial.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenDealDesk(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/records")) {
    return guarded("To Do Green records error", "Não foi possível carregar os registros da To Do Green.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenVerticalRecords(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/stock")) {
    return guarded("To Do Green stock error", "Não foi possível movimentar o estoque.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenStock(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/purchasing")) {
    return guarded("To Do Green purchasing error", "Não foi possível processar a compra.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenPurchasing(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/transactions")) {
    return guarded("To Do Green transactions error", "Não foi possível processar a transação.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenTransactions(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/requests")) {
    return guarded("To Do Green requests error", "Não foi possível carregar as solicitações.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenRequests(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/clients") || path.startsWith("/api/todogreen/client-assignments")) {
    return guarded("To Do Green clients error", "Não foi possível carregar os clientes.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return path.startsWith("/api/todogreen/client-assignments")
        ? handleTodoGreenClientAssignments(request, env, resolved.access, resolved.user)
        : handleTodoGreenClients(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/timeline")) {
    return guarded("To Do Green timeline error", "Não foi possível montar a linha do tempo da conta.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenTimeline(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/semente")) {
    return guarded("To Do Green Plantû error", "O Plantû não conseguiu responder agora.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenSemente(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/integrations")) {
    return guarded("To Do Green integrations error", "Não foi possível carregar as integrações.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenIntegrations(request, env, resolved.access);
    });
  }

  if (path.startsWith("/api/todogreen/governance")) {
    return guarded("To Do Green governance error", "Não foi possível carregar a auditoria.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenGovernance(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/client-intelligence")) {
    return guarded("To Do Green client intelligence error", "Não foi possível pesquisar a empresa.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenClientIntelligence(request, env, resolved.access, resolved.user);
    });
  }

  return null;
}
