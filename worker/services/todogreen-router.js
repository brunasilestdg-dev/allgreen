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
  handleTodoGreenSendEmail,
} from "./todogreen-customer-portal.js";
import { handleTodoGreenEsg } from "./todogreen-esg.js";
import { handleTodoGreenPricingParameters } from "./todogreen-pricing-parameters.js";
import { handleTodoGreenEnvironmentalParameters } from "./todogreen-environmental-parameters.js";
import { handleTodoGreenOperationParams } from "./todogreen-operation-params.js";
import { handleTodoGreenDashboards } from "./todogreen-dashboards.js";
import { handleTodoGreenRequests } from "./todogreen-requests.js";
import { handleTodoGreenVerticalRecords } from "./todogreen-vertical-records.js";
import { handleTodoGreenStock } from "./todogreen-stock.js";
import { handleTodoGreenPurchasing } from "./todogreen-purchasing.js";
import { handleTodoGreenPurchasingParams } from "./todogreen-purchasing-params.js";
import { handleTodoGreenTransactions } from "./todogreen-transactions.js";
import { handleTodoGreenTreasury } from "./todogreen-treasury.js";
import { handleTodoGreenDriverPortal } from "./todogreen-driver-portal.js";
import { handleTodoGreenEmployeePortal } from "./todogreen-employee-portal.js";
import { handleTodoGreenGreenPay } from "./todogreen-greenpay.js";
import { handleTodoGreenFiscal } from "./todogreen-fiscal.js";
import { handleTodoGreenPayroll } from "./todogreen-payroll.js";
import { handleTodoGreenPlanner } from "./todogreen-planner.js";
import { handleTodoGreenTms, receberOcorrenciaTrack3r } from "./todogreen-tms.js";
import { receberSolicitacaoDeAcesso } from "./todogreen-access-requests.js";
import { handleTodoGreenDealDesk } from "./todogreen-deal-desk.js";
import { entregarArquivo, handleTodoGreenEvidences } from "./todogreen-evidences.js";
import { handleTodoGreenClientIntelligence } from "./todogreen-client-intelligence.js";
import { handleTodoGreenMarketIntelligence } from "./todogreen-market-intelligence.js";
import { handleTodoGreenSemente } from "./todogreen-semente.js";
import { handleTodoGreenTimeline } from "./todogreen-timeline.js";
import { handleTodoGreenIntegrations } from "./todogreen-integrations.js";
import { handleTodoGreenSystemHealth } from "./todogreen-system-health.js";
import { handleTodoGreenEnergy } from "./todogreen-energy-reference.js";
import { handleTodoGreenMarketRadar } from "./todogreen-market-radar.js";
import { handleTodoGreenMarketSignals } from "./todogreen-market-signals.js";
import { handleTodoGreenRoadRisk } from "./todogreen-road-risk.js";
import { handleTodoGreenViability } from "./todogreen-viability.js";
import { handleTodoGreenPreflight } from "./todogreen-preflight.js";
import { handleTodoGreenMcpConnections } from "./mcp-connections.js";
import { handleTodoGreenPricingPerformance } from "./todogreen-pricing-performance.js";
import { handleTodoGreenGovernance } from "./todogreen-governance.js";
import { handleTodoGreenDispatch } from "./todogreen-dispatch.js";
import { handleTodoGreenTmsManual } from "./todogreen-tms-manual.js";
import { consultarCepNormalizado } from "./todogreen-integration-gateway.js";
import { consultarPedagiosDaRota } from "./todogreen-pedagios.js";
import { consultarCarregadores } from "./todogreen-carregadores.js";
import { optimizeTodoGreenRouting } from "./todogreen-public-routing-api.js";
import { handleTodoGreenRoutingMaps } from "./todogreen-routing-maps.js";

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

// O papel `motorista` só alcança o próprio portal. Este é o único choke
// point — sem ele, cada handler GET precisaria repetir a checagem, e o
// primeiro que esquecesse viraria a porta pela qual um motorista lê a
// carteira, a folha ou o financeiro inteiros. O corte é pelo PAPEL (não pela
// permissão "read"): listas estreitadas de outros papéis continuam valendo.
const internalReadAccess = async (request, env) => {
  const resolved = await exigirAcessoTodoGreen(request, env);
  if (resolved.response) return resolved;
  if (resolved.access?.role === "motorista")
    return {
      response: new Response(
        JSON.stringify({ error: "Motoristas usam o portal do motorista (/portal-motorista)." }),
        { status: 403, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
      ),
    };
  return resolved;
};

export async function routeTodoGreenApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/todogreen/")) return null;

  if (path === "/api/todogreen/arquivo") {
    return guarded("To Do Green document error", "Não foi possível entregar o documento.", () =>
      entregarArquivo(env, url.searchParams.get("t") || ""),
    );
  }

  // Porta pública do login: um visitante sem conta pede acesso. Fica aqui, antes
  // de qualquer checagem de sessão, porque quem pede ainda não tem sessão.
  if (path === "/api/todogreen/solicitar-acesso") {
    return guarded("To Do Green access request error", "Não foi possível registrar o pedido de acesso.", () =>
      receberSolicitacaoDeAcesso(request, env),
    );
  }

  if (path.startsWith("/api/todogreen/maps/")) {
    return guarded("To Do Green maps error", "Não foi possível consultar o motor de mapas.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenRoutingMaps(request, env);
    });
  }

  if (path === "/api/todogreen/routing/optimize") {
    return guarded("To Do Green routing error", "Não foi possível otimizar a rota.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      if (request.method !== "POST")
        return json({ error: "Use POST para otimizar a rota." }, 405);
      const body = await request.json().catch(() => null);
      return optimizeTodoGreenRouting(body, env);
    });
  }

  if (path.startsWith("/api/todogreen/evidencias")) {
    return guarded("To Do Green evidences error", "Não foi possível carregar os documentos.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenEvidences(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/client-portal-preview")) {
    return guarded("To Do Green portal preview error", "Não foi possível montar a prévia do portal.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenClientPortalPreview(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/client-activation")) {
    return guarded("To Do Green client activation error", "Não foi possível processar a implantação do cliente.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenClientActivation(request, env, resolved.access, resolved.user);
    });
  }

  // Portal do cliente: sessão de um CLIENTE (via e-mail vinculado em
  // todogreen_client_users), não de um funcionário da To Do Green — por isso
  // não passa pelo choke point de motorista, que só faz sentido para papéis
  // internos (exigirAcessoTodoGreen barra quem não está autenticado; o
  // handler resolve por dentro se o e-mail está de fato vinculado a um
  // cliente ativo). Aplicar internalReadAccess aqui bloqueava o cliente de
  // ver a própria conta (SEG-01 aplicado à rota errada).
  if (path.startsWith("/api/todogreen/portal")) {
    return guarded("To Do Green customer portal error", "Não foi possível abrir o portal do cliente.", () =>
      handleTodoGreenCustomerPortal(request, env),
    );
  }
  if (path.startsWith("/api/todogreen/work-center")) {
    return guarded("To Do Green work center error", "Não foi possível sincronizar a Central de Trabalho.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenWorkCenter(request, env, ctx);
    });
  }
  if (path.startsWith("/api/todogreen/pricing-parameters")) {
    return guarded("To Do Green pricing parameters error", "Não foi possível carregar os parâmetros comerciais.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenPricingParameters(request, env);
    });
  }
  if (path.startsWith("/api/todogreen/environmental-parameters")) {
    return guarded("To Do Green environmental parameters error", "Não foi possível carregar a régua ESG.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenEnvironmentalParameters(request, env);
    });
  }
  if (path.startsWith("/api/todogreen/operation-params")) {
    return guarded("To Do Green operation params error", "Não foi possível carregar a régua de operação.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenOperationParams(request, env);
    });
  }
  if (path.startsWith("/api/todogreen/tms-manual")) {
    return guarded("To Do Green TMS manual error", "Não foi possível processar o cadastro manual do TMS.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenTmsManual(request, env, resolved.access, resolved.user);
    });
  }
  if (path.startsWith("/api/todogreen/dispatch")) {
    return guarded("To Do Green dispatch error", "Não foi possível processar o despacho.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenDispatch(request, env, resolved.access, resolved.user);
    });
  }
  if (path.startsWith("/api/todogreen/pricing-performance")) {
    return guarded("To Do Green pricing performance error", "Não foi possível comparar preço e operação.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenPricingPerformance(request, env, resolved.access, resolved.user);
    });
  }
  if (path.startsWith("/api/todogreen/dashboards")) {
    return guarded("To Do Green dashboards error", "Não foi possível carregar os painéis.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenDashboards(request, env);
    });
  }
  if (path.startsWith("/api/todogreen/esg")) {
    return guarded("To Do Green ESG error", "Não foi possível processar o cálculo ambiental.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenEsg(request, env);
    });
  }
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
  // Radar por busca web (a tela "RFQs / RFIs" chama este endpoint; estava sem
  // rota no roteador) e sinais estruturados (PNCP · Compras.gov · GDELT).
  if (path === "/api/todogreen/market-radar") {
    return guarded("To Do Green market radar error", "Não foi possível pesquisar RFQs, RFIs e licitações agora.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenMarketRadar(request, env, resolved.access);
    });
  }
  if (path.startsWith("/api/todogreen/market-signals")) {
    return guarded("To Do Green market signals error", "Não foi possível carregar os sinais de mercado.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenMarketSignals(request, env, resolved.access, resolved.user, url);
    });
  }
  // Risk Map (P6): risco viário histórico (PRF/ANTT) por traçado e ingestão.
  if (path.startsWith("/api/todogreen/risk")) {
    return guarded("To Do Green road risk error", "Não foi possível calcular o risco viário.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenRoadRisk(request, env, resolved.access, resolved.user, url);
    });
  }

  // Energia (P4): perfil do espaço, referências públicas (ANEEL/ANP/ONS) e o
  // plano composto (tarifa → melhor hora → recarga por veículo → diesel).
  if (path.startsWith("/api/todogreen/energy")) {
    return guarded("To Do Green energy error", "Não foi possível montar o plano de energia.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenEnergy(request, env, resolved.access, resolved.user, url);
    });
  }

  if (path.startsWith("/api/todogreen/fleet")) {
    return guarded("To Do Green fleet error", "Não foi possível sincronizar a frota.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenFleet(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/deal-desk")) {
    return guarded("To Do Green deal desk error", "Não foi possível processar a aprovação comercial.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenDealDesk(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/records")) {
    return guarded("To Do Green records error", "Não foi possível carregar os registros da To Do Green.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenVerticalRecords(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/stock")) {
    return guarded("To Do Green stock error", "Não foi possível movimentar o estoque.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenStock(request, env, resolved.access, resolved.user);
    });
  }

  // Alçadas de compras (régua versionada). Vem ANTES de /purchasing porque
  // `/purchasing-params` também começa com `/purchasing` — o genérico engoliria a rota.
  if (path.startsWith("/api/todogreen/purchasing-params")) {
    return guarded("To Do Green purchasing params error", "Não foi possível carregar as alçadas de compras.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenPurchasingParams(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/purchasing")) {
    return guarded("To Do Green purchasing error", "Não foi possível processar a compra.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenPurchasing(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/transactions")) {
    return guarded("To Do Green transactions error", "Não foi possível processar a transação.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenTransactions(request, env, resolved.access, resolved.user);
    });
  }

  // Portal do motorista: sessão pelo e-mail do cadastro, "minhas viagens" e
  // eventos da rua (chegada, entrega com POD/GPS, ocorrência).
  if (path.startsWith("/api/todogreen/driver-portal")) {
    return guarded("To Do Green driver portal error", "Não foi possível abrir o portal do motorista.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenDriverPortal(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/greenpay")) {
    return guarded("To Do Green GreenPay error", "Não foi possível abrir o GreenPay.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenGreenPay(request, env, resolved.access, resolved.user);
    });
  }

  // Portal do colaborador: sessão pelo e-mail do cadastro. PJ imputa NF e chave
  // PIX; CLT só lê. Gestão (RH/financeiro) analisa e paga em /gestao/*.
  if (path.startsWith("/api/todogreen/employee-portal")) {
    return guarded("To Do Green employee portal error", "Não foi possível abrir o portal do colaborador.", async () => {
      const resolved = await internalAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenEmployeePortal(request, env, resolved.access, resolved.user);
    });
  }

  // Tesouraria: importar extrato (em lote, com dedup), conciliar (duas tabelas
  // numa gravação) e fechar período (trava que vale para outro handler).
  if (path.startsWith("/api/todogreen/treasury")) {
    return guarded("To Do Green treasury error", "Não foi possível processar a tesouraria.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenTreasury(request, env, resolved.access, resolved.user);
    });
  }

  // Receptor de ocorrências do TRACK3R. Vem ANTES do bloco do TMS de propósito:
  // aquele exige sessão, e o fornecedor não tem sessão nem papel. Aqui quem
  // autoriza é o header `Token` conferido contra o cofre do Worker, e o id da
  // integração na URL diz de qual espaço é a chamada.
  if (path.startsWith("/api/todogreen/tms/webhook")) {
    return guarded(
      "To Do Green TMS webhook error",
      "Não foi possível receber a ocorrência do TRACK3R.",
      () => receberOcorrenciaTrack3r(request, env),
    );
  }

  // TMS TRACK3R. Não confundir com `/tracker`, que é a Sistemas Tracker — outro
  // fornecedor, outro assunto: o TRACK3R traz o DOCUMENTO (o que foi coletado e
  // entregue), a Sistemas Tracker traz a POSIÇÃO (onde o veículo está).
  if (path.startsWith("/api/todogreen/tms")) {
    return guarded("To Do Green TMS error", "Não foi possível falar com a integração do TMS.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenTms(request, env, resolved.access, resolved.user);
    });
  }

  // Fiscal da transportadora: CT-e (modelo 57), MDF-e (modelo 58) e NFS-e — não
  // NF-e, que é de quem vende mercadoria. O documento tem ciclo de vida, os
  // impostos são calculados no servidor e o XML é gerado localmente; a
  // transmissão à SEFAZ fica desligada por ausência de certificado digital.
  if (path.startsWith("/api/todogreen/fiscal")) {
    return guarded("To Do Green fiscal error", "Não foi possível processar o documento fiscal.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenFiscal(request, env, resolved.access, resolved.user);
    });
  }

  // Pessoas e folha. Dado sensível (CPF, salário): o módulo inteiro exige
  // hr:manage, que só rh/admin/owner têm — quem não é do RH nem chega ao handler.
  if (path.startsWith("/api/todogreen/payroll")) {
    return guarded("To Do Green payroll error", "Não foi possível processar a folha.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenPayroll(request, env, resolved.access, resolved.user);
    });
  }

  // Planner (estilo Microsoft Planner): planos privados ou compartilhados, com
  // baldes e tarefas. A visibilidade é imposta no handler, em SQL.
  if (path.startsWith("/api/todogreen/planner")) {
    return guarded("To Do Green planner error", "Não foi possível abrir o Planner.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenPlanner(request, env, resolved.access);
    });
  }

  if (path.startsWith("/api/todogreen/requests")) {
    return guarded("To Do Green requests error", "Não foi possível carregar as solicitações.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenRequests(request, env, resolved.access, resolved.user);
    });
  }

  if (path === "/api/todogreen/send-email") {
    return guarded("To Do Green send-email error", "Não foi possível enviar o e-mail.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenSendEmail(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/clients") || path.startsWith("/api/todogreen/client-assignments")) {
    return guarded("To Do Green clients error", "Não foi possível carregar os clientes.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return path.startsWith("/api/todogreen/client-assignments")
        ? handleTodoGreenClientAssignments(request, env, resolved.access, resolved.user)
        : handleTodoGreenClients(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/timeline")) {
    return guarded("To Do Green timeline error", "Não foi possível montar a linha do tempo da conta.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenTimeline(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/semente")) {
    return guarded("To Do Green Plantû error", "O Plantû não conseguiu responder agora.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenSemente(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/mcp-connections")) {
    return guarded("To Do Green MCP connection error", "Não foi possível gerenciar a conexão MCP.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenMcpConnections(request, env, resolved.access, resolved.user);
    });
  }

  if (path === "/api/todogreen/cep") {
    return guarded("To Do Green CEP error", "Não foi possível consultar o CEP.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      const cep = new URL(request.url).searchParams.get("cep") || "";
      try {
        return json(await consultarCepNormalizado(env, cep));
      } catch (erro) {
        return json({ error: erro.message || "CEP não encontrado." }, 400);
      }
    });
  }

  if (path === "/api/todogreen/pedagios") {
    return guarded("To Do Green pedágios error", "Não foi possível consultar os pedágios.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      let corpo = {};
      try {
        corpo = await request.json();
      } catch {
        corpo = {};
      }
      try {
        return json(await consultarPedagiosDaRota(corpo.polyline));
      } catch (erro) {
        return json({ error: erro.message || "Pedágios indisponíveis." }, 400);
      }
    });
  }

  if (path === "/api/todogreen/carregadores") {
    return guarded("To Do Green carregadores error", "Não foi possível buscar os carregadores.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      let corpo = {};
      try {
        corpo = await request.json();
      } catch {
        corpo = {};
      }
      try {
        return json(await consultarCarregadores(env, corpo));
      } catch (erro) {
        return json({ error: erro.message || "Carregadores indisponíveis agora." }, 400);
      }
    });
  }

  // Pré-flight persistido (P2): rodar, consultar e autorizar WARNING; é o que
  // a coleção `rotas` exige antes de atribuir a rota ao motorista.
  if (path.startsWith("/api/todogreen/preflight")) {
    return guarded("To Do Green preflight error", "Não foi possível rodar o pré-flight.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenPreflight(request, env, resolved.access, resolved.user, url);
    });
  }

  if (path === "/api/todogreen/viability-snapshots") {
    return guarded("To Do Green viability error", "Não foi possível registrar a viabilidade.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenViability(request, env, resolved.access, resolved.user, url);
    });
  }

  if (path === "/api/todogreen/system-health") {
    return guarded("To Do Green system health error", "Não foi possível ler a saúde do sistema.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenSystemHealth(request, env, resolved.access, url);
    });
  }

  if (path.startsWith("/api/todogreen/integrations")) {
    return guarded("To Do Green integrations error", "Não foi possível carregar as integrações.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenIntegrations(request, env, resolved.access);
    });
  }

  if (path.startsWith("/api/todogreen/governance")) {
    return guarded("To Do Green governance error", "Não foi possível carregar a auditoria.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenGovernance(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/client-intelligence")) {
    return guarded("To Do Green client intelligence error", "Não foi possível pesquisar a empresa.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenClientIntelligence(request, env, resolved.access, resolved.user);
    });
  }

  if (path.startsWith("/api/todogreen/market-intelligence")) {
    return guarded("To Do Green market intelligence error", "Não foi possível pesquisar o mercado.", async () => {
      const resolved = await internalReadAccess(request, env);
      if (resolved.response) return resolved.response;
      return handleTodoGreenMarketIntelligence(request, env, resolved.access, resolved.user);
    });
  }

  return null;
}
