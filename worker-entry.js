import appWorker from "./worker.js";
import { withInternalSessionAuthorization } from "./worker/auth/internal-session-request.js";
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
import { handleTodoGreenPurchasingParams } from "./worker/services/todogreen-purchasing-params.js";
import { handleTodoGreenFileVault } from "./worker/services/todogreen-file-vault.js";
import { handleTodoGreenTmsLocalBridge } from "./worker/services/todogreen-tms-local-bridge.js";
import { handleTodoGreenTmsApiKeys } from "./worker/services/todogreen-tms-api-keys.js";
import { handlePublicTodoGreenTmsApi } from "./worker/services/todogreen-public-tms-api.js";
import { handlePublicTodoGreenRoutingApi } from "./worker/services/todogreen-public-routing-api.js";
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

async function externalTmsOpenApi(request, env, url) {
  const response = await handlePublicTodoGreenTmsApi(request, env, url);
  if (!response.ok) return response;
  const spec = await response.json().catch(() => null);
  if (!spec?.paths) return response;
  spec.paths["/routes/optimize"] = {
    post: {
      summary: "Otimiza rotas usando VROOM + OSRM auto-hospedados",
      security: [{ tmsApiKey: [] }],
      description: "Requer routing:write. Aceita vehicles, jobs e shipments no formato VROOM e não persiste a solução.",
      responses: {
        200: { description: "Solução otimizada" },
        400: { description: "Problema de roteirização inválido" },
        403: { description: "Chave sem escopo routing:write" },
        503: { description: "Motor auto-hospedado ainda não conectado" },
        504: { description: "Timeout da otimização" },
      },
    },
  };
  spec.paths["/routes/electric-plan"] = {
    post: {
      summary: "Planeja recarga de veículo elétrico na rota",
      security: [{ tmsApiKey: [] }],
      description: "Requer routing:write. Considera SOC, reserva, consumo com carga, conectores, potência, desvio, acesso e categoria do veículo.",
      responses: {
        200: { description: "Plano energético com ou sem parada de recarga" },
        400: { description: "Perfil energético ou rota inválidos" },
        403: { description: "Chave sem escopo routing:write" },
      },
    },
  };
  return new Response(JSON.stringify(spec), {
    status: response.status,
    headers: response.headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // O motor viário e o planejador de recarga ficam desacoplados do restante
    // da API para poderem evoluir sem alterar shipments/tracking.
    if ([
      "/api/tms/v1/routes/optimize",
      "/api/tms/v1/routes/electric-plan",
    ].includes(url.pathname)) {
      try {
        return await handlePublicTodoGreenRoutingApi(request, env);
      } catch (error) {
        console.error("To Do Green routing API error", error);
        return new Response(JSON.stringify({
          error: "internal_error",
          message: "Não foi possível planejar a rota.",
        }), {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      }
    }

    if (url.pathname === "/api/tms/v1/openapi.json" && request.method === "GET") {
      try {
        return await externalTmsOpenApi(request, env, url);
      } catch (error) {
        console.error("To Do Green TMS OpenAPI error", error);
        return new Response(JSON.stringify({
          error: "internal_error",
          message: "Não foi possível gerar a documentação da API TMS.",
        }), {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      }
    }

    // API externa do TMS. Autentica por chave tdg_live_* e não por sessão do
    // ERP, por isso precisa ser resolvida antes do roteador interno da Vertical.
    if (url.pathname.startsWith("/api/tms/v1/")) {
      try {
        return await handlePublicTodoGreenTmsApi(request, env, url);
      } catch (error) {
        console.error("To Do Green public TMS API error", error);
        return new Response(JSON.stringify({
          error: "internal_error",
          message: "Não foi possível concluir a chamada da API TMS.",
        }), {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      }
    }

    if (url.pathname.startsWith("/api/todogreen/tms/local-bridge")) {
      return handleTodoGreenTmsLocalBridge(request, env);
    }
    if (url.pathname.startsWith("/api/todogreen/tms-api-keys")) {
      const resolved = await resolveInternal(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenTmsApiKeys(request, env, resolved.access, resolved.user, url);
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
    // Alçadas versionadas: vem ANTES de /purchasing porque `/purchasing-params`
    // também começa com `/purchasing` — senão o handler de compras o engole.
    if (url.pathname.startsWith("/api/todogreen/purchasing-params")) {
      const resolved = await resolveInternal(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenPurchasingParams(request, env, resolved.access, resolved.user);
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

    // Os handlers antigos ainda podem procurar Authorization por conta própria.
    // A credencial sai do cookie HttpOnly somente aqui, dentro do Worker, e não
    // volta ao JavaScript do navegador. Isto mantém compatibilidade enquanto os
    // serviços são consolidados na autenticação central.
    const internalRequest = withInternalSessionAuthorization(request);
    const todoGreenResponse = await routeTodoGreenApi(internalRequest, env, ctx);
    if (todoGreenResponse) return todoGreenResponse;
    return appWorker.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runTodoGreenTrackerScheduled(env));
    ctx.waitUntil(runTodoGreenEnterpriseWorkflowScheduled(env));
    if (typeof appWorker.scheduled === "function") return appWorker.scheduled(controller, env, ctx);
  },
};
