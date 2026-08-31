import appWorker from "./worker.js";
import {
  runTodoGreenTrackerScheduled,
} from "./worker/services/todogreen-tracker.js";
import { exigirAcessoTodoGreen } from "./worker/services/todogreen-access.js";
import { handleTodoGreenMarketRadar } from "./worker/services/todogreen-market-radar.js";
import {
  handleTodoGreenEnterpriseWorkflows,
  runTodoGreenEnterpriseWorkflowScheduled,
} from "./worker/services/todogreen-enterprise-workflows.js";
import { handleTodoGreenPurchasingEnterprise } from "./worker/services/todogreen-purchasing-enterprise.js";
import { handleTodoGreenFileVault } from "./worker/services/todogreen-file-vault.js";
import { handleTodoGreenTmsLocalBridge } from "./worker/services/todogreen-tms-local-bridge.js";
import { routeTodoGreenApi } from "./worker/services/todogreen-router.js";

const forbiddenDriver = () => new Response(JSON.stringify({ error: "Este recurso é restrito ao portal interno." }), {
  status: 403,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const resolveInternal = async (request, env) => {
  const resolved = await exigirAcessoTodoGreen(request, env);
  if (resolved.response) return resolved;
  if (resolved.access?.role === "motorista") return { ...resolved, response: forbiddenDriver() };
  return resolved;
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Ponte temporária do TMS TRACK3R: a máquina local entra aqui sem sessão do
    // ERP e autentica com segredo próprio. Fica antes do router porque o bloco
    // normal de /tms exige sessão humana. API/webhook oficiais continuam ativos.
    if (url.pathname.startsWith("/api/todogreen/tms/local-bridge")) {
      return handleTodoGreenTmsLocalBridge(request, env);
    }
    if (url.pathname.startsWith("/api/todogreen/market-radar")) {
      const resolved = await resolveInternal(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenMarketRadar(request, env, resolved.access);
    }
    if (url.pathname.startsWith("/api/todogreen/enterprise-workflows")) {
      const resolved = await resolveInternal(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenEnterpriseWorkflows(request, env, resolved.access, resolved.user);
    }
    if (url.pathname.startsWith("/api/todogreen/purchasing")) {
      const resolved = await resolveInternal(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenPurchasingEnterprise(request, env, resolved.access, resolved.user);
    }
    if (url.pathname.startsWith("/api/todogreen/file-vault")) {
      const resolved = await resolveInternal(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenFileVault(request, env, resolved.access, resolved.user);
    }
    const todoGreenResponse = await routeTodoGreenApi(request, env, ctx);
    if (todoGreenResponse) return todoGreenResponse;
    return appWorker.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runTodoGreenTrackerScheduled(env));
    ctx.waitUntil(runTodoGreenEnterpriseWorkflowScheduled(env));
    if (typeof appWorker.scheduled === "function") return appWorker.scheduled(controller, env, ctx);
  },
};
