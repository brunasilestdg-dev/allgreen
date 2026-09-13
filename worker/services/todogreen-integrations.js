import { configuredAiProviders, probeAiProvider } from "./ai.js";
import { podeNaVertical } from "./todogreen-access.js";
import { probeWebSearch, webSearchConfiguration } from "./web-search.js";
import { envComChavesDeBuscaDoEspaco } from "./search-keys.js";
import { envComChavesDoEspaco } from "./ai-keys.js";
import { latestTodoGreenIntegrationHealth, recordTodoGreenIntegrationHealth } from "./todogreen-integration-health.js";
import {
  probeTodoGreenExternalIntegration,
  runTodoGreenExternalIntegration,
  todoGreenExternalIntegrationCatalog,
} from "./todogreen-integration-gateway.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const readiness = ({ configured = false, connected = false, external = false, error = false } = {}) => {
  if (error) return "error";
  if (connected) return "connected";
  if (configured) return "configured";
  if (external) return "external_dependency";
  return "requires_setup";
};

const withReadiness = (item, options = {}) => ({
  ...item,
  status: item.status || readiness({ configured: Boolean(item.configured), ...options }),
  canTest: Boolean(item.canTest),
  canConfigure: Boolean(item.canConfigure),
});

const nativeAutomations = (env) => {
  const configured = Boolean(env.DB);
  return [
    withReadiness({
      id: "cloudflare-cron",
      name: "Agendamentos da Cloudflare",
      configured,
      detail: "Execução automática a cada hora.",
    }, { connected: configured }),
    withReadiness({
      id: "tasks-reminders",
      name: "Tarefas e lembretes automáticos",
      configured,
      detail: "Executados no Worker e registrados no D1.",
    }, { connected: configured }),
    withReadiness({
      id: "custom-workflow-rules",
      name: "Regras configuráveis da Central",
      configured,
      detail: "Gatilhos, condições e ações definidos pela equipe e executados no servidor.",
    }, { connected: configured }),
    withReadiness({
      id: "weekly-summary",
      name: "Resumo semanal",
      configured,
      detail: "Processado toda segunda-feira pela infraestrutura da plataforma.",
    }, { connected: configured }),
  ];
};

const messagingIntegrations = (env = {}) => {
  const baseUrl = String(env.EVOLUTION_API_BASE_URL || "").trim();
  let validUrl = false;
  try {
    validUrl = ["http:", "https:"].includes(new URL(baseUrl).protocol);
  } catch {
    validUrl = false;
  }
  const configured = Boolean(validUrl && env.EVOLUTION_API_KEY && env.EVOLUTION_INSTANCE);
  return [
    withReadiness({
      id: "evolution-api",
      name: "WhatsApp · Evolution API",
      configured,
      detail: configured
        ? "URL, chave e instância cadastradas para envio pelo CRM. A conexão deve ser validada no provedor antes do uso em produção."
        : "Conector disponível. Requer URL, chave e nome da instância Evolution API.",
      requirement: configured ? "Validar sessão da instância" : "EVOLUTION_API_BASE_URL + chave + instância",
    }),
  ];
};

const communicationIntegrations = (env = {}) => {
  const emailConfigured = Boolean(env.BREVO_API_KEY && env.MAIL_SENDER);
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID);
  return [
    withReadiness({
      id: "transactional-email",
      name: "E-mail transacional",
      configured: emailConfigured,
      detail: emailConfigured
        ? "Remetente e provedor configurados para notificações do ERP."
        : "Requer chave do provedor e remetente verificado.",
      requirement: "BREVO_API_KEY + MAIL_SENDER",
    }),
    withReadiness({
      id: "google-account",
      name: "Google · login",
      configured: googleConfigured,
      detail: googleConfigured
        ? "OAuth de login Google configurado. Isto não equivale a integração completa com Gmail ou Agenda."
        : "OAuth Google ainda não configurado.",
      requirement: "GOOGLE_CLIENT_ID",
    }),
    withReadiness({
      id: "google-workspace-actions",
      name: "Google Workspace · Gmail e Agenda",
      configured: false,
      detail: "Ações de Gmail e Agenda ainda dependem de OAuth com escopos próprios, consentimento e armazenamento seguro de tokens por usuário.",
      requirement: "OAuth Google Workspace com escopos Gmail/Calendar",
    }, { external: true }),
    withReadiness({
      id: "microsoft-365",
      name: "Microsoft 365 · Outlook e Agenda",
      configured: false,
      detail: "Não há conector Microsoft Graph ativo no Worker. O hub mantém o requisito visível sem simular conexão.",
      requirement: "Aplicativo Entra ID + OAuth Microsoft Graph",
    }, { external: true }),
  ];
};

const marketIntegrations = (search) => [
  withReadiness({
    id: "web-search",
    name: "Pesquisa web pública",
    configured: Boolean(search.configured),
    detail: search.configured
      ? "Há ao menos uma fonte de pesquisa configurada. Use o teste para validar resposta e retorno de resultados."
      : "Nenhuma fonte de pesquisa web está configurada.",
    canTest: true,
    canConfigure: true,
  }),
  withReadiness({
    id: "linkedin",
    name: "LinkedIn · decisores e prospecção",
    configured: false,
    detail: "Não existe conector oficial ativo no Worker. Pesquisas públicas podem apoiar inteligência comercial, mas não são tratadas como integração LinkedIn.",
    requirement: "API/conta autorizada pelo LinkedIn ou provedor aprovado",
  }, { external: true }),
];

const managementIntegrations = () => [
  withReadiness({
    id: "monday",
    name: "monday.com",
    configured: false,
    detail: "Ainda não há conector monday.com ativo no backend desta vertical.",
    requirement: "OAuth/token monday.com + mapeamento de boards e eventos",
  }, { external: true }),
  withReadiness({
    id: "power-bi",
    name: "Power BI",
    configured: false,
    detail: "Ainda não há publicação ou leitura autenticada pelo Power BI no backend da vertical.",
    requirement: "Microsoft Entra ID + Power BI REST API ou dataset autorizado",
  }, { external: true }),
];

const ciotStatus = (env = {}) => {
  const certificate = Boolean(
    (env.TODOGREEN_ANTT_CIOT_CERTIFICATE_PFX && env.TODOGREEN_ANTT_CIOT_CERTIFICATE_PASSWORD) ||
    env.TODOGREEN_ANTT_CIOT_A3_CONNECTOR_URL,
  );
  const connector = Boolean(env.TODOGREEN_ANTT_CIOT_BASE_URL && env.TODOGREEN_ANTT_CIOT_CONNECTOR_URL);
  const configured = certificate && connector;
  return withReadiness({
    id: "antt-ciot-direct",
    name: "ANTT · CIOT direto",
    configured,
    detail: configured
      ? "Endpoint, conector e certificado foram informados. A emissão real ainda deve ser validada contra o serviço oficial antes de produção."
      : "O ERP está preparado, mas CIOT oficial depende do conector Windows/ANTT e certificado ICP-Brasil A1 ou A3.",
    requirement: "Conector ANTT + serviço Windows + certificado ICP-Brasil",
  }, { external: !configured });
};

async function ciotStatusForOwner(env, ownerId) {
  if (!env.DB || !ownerId) return ciotStatus(env);
  const row = await env.DB.prepare(
    `SELECT certificate_type,certificate_env_key,certificate_password_env_key,
            a3_connector_env_key,connector_url_env_key,base_url,status,last_test_at,
            last_error,config_json,credential_ciphertext,credential_iv
       FROM todogreen_ciot_integrations
      WHERE tenant_id='todogreen' AND workspace_owner_id=? AND mode='direct_api'
        AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1`,
  ).bind(ownerId).first().catch(() => null);
  if (!row) return ciotStatus(env);

  let config = {};
  try { config = JSON.parse(row.config_json || "{}"); } catch { config = {}; }
  const storedCertificate = Boolean(row.credential_ciphertext && row.credential_iv);
  const certificate = row.certificate_type === "A3"
    ? Boolean(env[row.a3_connector_env_key] || config.a3ConnectorUrl)
    : Boolean(storedCertificate || (env[row.certificate_env_key] && env[row.certificate_password_env_key]));
  const connector = Boolean(
    env[row.connector_url_env_key]
    || config.connectorUrl
    || (row.certificate_type === "A3" && (env[row.a3_connector_env_key] || config.a3ConnectorUrl)),
  );
  const configured = Boolean(row.base_url && certificate && connector);
  const failed = Boolean(row.last_error) || ["error", "failed"].includes(String(row.status || "").toLowerCase());
  const connected = configured && Boolean(row.last_test_at) && !failed;
  return withReadiness({
    id: "antt-ciot-direct",
    name: "ANTT · CIOT direto",
    configured,
    status: failed ? "error" : readiness({ configured, connected, external: !configured }),
    detail: failed
      ? `Configuração presente, mas o último teste registrou erro: ${String(row.last_error || row.status).slice(0, 140)}`
      : connected
        ? `Conector validado em ${row.last_test_at}. A emissão oficial ainda depende da homologação ANTT do ambiente selecionado.`
        : configured
          ? "Certificado, endpoint e conector disponíveis. Falta registrar um teste bem-sucedido antes de produção."
          : "A integração foi cadastrada, mas ainda falta certificado, endpoint oficial ou conector Windows.",
    requirement: configured ? "Teste real em homologação ANTT" : "Certificado ICP-Brasil + endpoint + conector Windows",
  });
}

const sefazStatus = (env = {}) => {
  const certificate = Boolean(env.NFE_CERT_PFX && env.NFE_CERT_PASSWORD);
  return withReadiness({
    id: "sefaz-fiscal",
    name: "SEFAZ · CT-e e MDF-e",
    configured: certificate,
    detail: certificate
      ? "Certificado fiscal disponível. O módulo pode assinar documentos, mas a transmissão deve permanecer sujeita à validação/homologação do serviço SEFAZ."
      : "Sem certificado digital o ERP mantém geração, cálculo e validação local, mas não transmite CT-e/MDF-e à SEFAZ.",
    requirement: "Certificado A1 + homologação/transmissão SEFAZ",
  }, { external: !certificate });
};

const sistemasTrackerDefaultStatus = () => withReadiness({
  id: "sistemas-tracker",
  name: "Sistemas Tracker · posição e telemetria",
  configured: false,
  detail: "A camada de posição e telemetria está pronta, mas este espaço ainda não comprovou conexão ativa com a Sistemas Tracker.",
  requirement: "Cadastro da integração + credencial de API/webhook + sincronização bem-sucedida",
});

async function trackerStatusForOwner(env, ownerId) {
  if (!env.DB || !ownerId) return sistemasTrackerDefaultStatus();
  const integration = await env.DB.prepare(
    `SELECT status, sync_mode, token_env_key, webhook_secret_env_key,
            last_success_at, last_error
       FROM todogreen_tracker_integrations
      WHERE workspace_owner_id = ?
        AND provider = 'sistemas_tracker'
        AND archived_at IS NULL
      LIMIT 1`,
  ).bind(ownerId).first().catch(() => null);

  if (!integration) return sistemasTrackerDefaultStatus();
  const apiCredential = Boolean(integration.token_env_key && env[integration.token_env_key]);
  const webhookCredential = Boolean(
    integration.webhook_secret_env_key && env[integration.webhook_secret_env_key],
  );
  const credentialReady = integration.sync_mode === "webhook"
    ? webhookCredential
    : integration.sync_mode === "hybrid"
      ? apiCredential && webhookCredential
      : apiCredential;
  const failed = Boolean(integration.last_error) || ["error", "failed"].includes(String(integration.status || "").toLowerCase());
  const connected = credentialReady && Boolean(integration.last_success_at) && !failed;

  return withReadiness({
    id: "sistemas-tracker",
    name: "Sistemas Tracker · posição e telemetria",
    configured: credentialReady,
    status: failed
      ? "error"
      : readiness({ configured: credentialReady, connected }),
    detail: failed
      ? `Integração cadastrada, mas a última execução registrou erro: ${String(integration.last_error || integration.status).slice(0, 140)}`
      : connected
        ? `Sincronização confirmada. Último sucesso: ${integration.last_success_at}.`
        : credentialReady
          ? "Credencial disponível, mas ainda não há sincronização bem-sucedida registrada."
          : "Integração cadastrada, porém a credencial exigida pelo modo de sincronização ainda não está disponível.",
    requirement: "Credencial segura + sincronização bem-sucedida",
  });
}

// Exportados para a tela "Saúde do sistema" reaproveitar a MESMA leitura do
// painel de Integrações (uma régua, não duas).
export { sefazStatus, ciotStatusForOwner, trackerStatusForOwner };

const track3rDefaultStatus = () => withReadiness({
  id: "track3r",
  name: "TRACK3R · documentos e ocorrências",
  configured: false,
  detail: "A importação por arquivo funciona sem credencial. API e webhook exigem configuração própria do TRACK3R.",
  requirement: "Integração cadastrada + arquivo validado ou credencial do modo API/webhook",
});

export async function track3rStatusForOwner(env, ownerId) {
  if (!env.DB || !ownerId) return track3rDefaultStatus();
  const integration = await env.DB.prepare(
    `SELECT sync_mode,token_env_key,webhook_secret_env_key,status,last_sync_at,last_error
       FROM todogreen_tms_integrations
      WHERE tenant_id='todogreen' AND workspace_owner_id=? AND provider='track3r'
        AND archived_at IS NULL LIMIT 1`,
  ).bind(ownerId).first().catch(() => null);
  if (!integration) return track3rDefaultStatus();
  const mode = String(integration.sync_mode || "arquivo");
  const credentialReady = mode === "arquivo"
    || (mode === "api" && Boolean(integration.token_env_key && env[integration.token_env_key]))
    || (mode === "webhook" && Boolean(integration.webhook_secret_env_key && env[integration.webhook_secret_env_key]));
  const failed = Boolean(integration.last_error) || integration.status === "erro";
  const connected = credentialReady && Boolean(integration.last_sync_at) && !failed;
  return withReadiness({
    id: "track3r",
    name: "TRACK3R · documentos e ocorrências",
    configured: credentialReady,
    status: failed ? "error" : readiness({ configured: credentialReady, connected }),
    detail: failed
      ? `Última sincronização com erro: ${String(integration.last_error).slice(0, 140)}`
      : connected
        ? `Modo ${mode} validado. Última sincronização: ${integration.last_sync_at}.`
        : credentialReady
          ? `Modo ${mode} configurado, aguardando uma sincronização bem-sucedida.`
          : `Modo ${mode} cadastrado, mas a credencial correspondente não está no cofre.`,
    requirement: mode === "arquivo" ? "Importar e validar um arquivo real" : `Credencial do modo ${mode} + teste real`,
  });
}

export const ocppStatus = () => withReadiness({
  id: "ocpp",
  name: "OCPP · recarga elétrica",
  configured: false,
  detail: "Os pontos de recarga podem ser cadastrados, mas não há sessão OCPP ativa para disponibilidade, medição e cobrança em tempo real.",
  requirement: "Central OCPP ou API da rede de recarga + credenciais + mapeamento dos carregadores",
}, { external: true });

const dataExchangeIntegrations = (env, activeWebhooks) => [
  withReadiness({
    id: "outbound-webhooks",
    name: "Webhooks de saída",
    configured: activeWebhooks > 0,
    detail: activeWebhooks > 0
      ? `${activeWebhooks} webhook(s) ativo(s) neste espaço.`
      : "Motor disponível, mas ainda não há destino ativo neste espaço.",
  }, { connected: activeWebhooks > 0 }),
  withReadiness({
    id: "public-api",
    name: "API pública com idempotência",
    configured: Boolean(env.DB),
    detail: "Compartilha a infraestrutura da plataforma, com chaves, escopo e proteção contra duplicidade.",
  }, { connected: Boolean(env.DB) }),
];

// Ids do catálogo de gateways externos (APIs públicas + stack self-hosted), para
// o handler distinguir uma consulta de gateway de um teste de provedor de IA.
const externalIds = (env) => new Set(
  Object.values(todoGreenExternalIntegrationCatalog(env)).flat().map((item) => item.id),
);

export function todoGreenIntegrationStatus(env = {}, { activeWebhooks = 0 } = {}) {
  const search = webSearchConfiguration(env);
  return {
    ai: configuredAiProviders(env).map((item) => withReadiness({
      ...item,
      canTest: true,
      canConfigure: true,
    })),
    search: {
      configured: search.configured,
      providers: Object.entries(search.providers).map(([id, configured]) => ({ id, configured })),
    },
    market: marketIntegrations(search),
    messaging: messagingIntegrations(env),
    communication: communicationIntegrations(env),
    operational: [track3rDefaultStatus(), sistemasTrackerDefaultStatus(), sefazStatus(env), ciotStatus(env), ocppStatus()],
    management: managementIntegrations(),
    dataExchange: dataExchangeIntegrations(env, activeWebhooks),
    automation: nativeAutomations(env),
    // Gateway de APIs públicas gratuitas (CEP, IBGE, Bacen, ANTT, ANEEL, Open
    // Charge Map) e stack logística self-hosted (OSRM, Nominatim, VROOM, IA local).
    external: todoGreenExternalIntegrationCatalog(env),
    automationEngine: {
      id: "cloudflare-native",
      name: "Cloudflare Worker + Cron + D1",
      configured: Boolean(env.DB),
      status: readiness({ configured: Boolean(env.DB), connected: Boolean(env.DB) }),
      requiresExternalServer: false,
    },
    exclusions: [
      { id: "whisper", name: "Transcrição Whisper", reason: "Não faz parte da operação To Do Green." },
      { id: "image-generation", name: "Geração de imagens", reason: "Não faz parte da operação To Do Green." },
    ],
  };
}

export async function handleTodoGreenIntegrations(request, env, access) {
  // As DUAS famílias de chave do espaço entram na conferência: as de IA
  // (workspace_ai_keys — as mesmas que o Plantû usa) e as de busca. Antes só a
  // busca entrava, e a tela dizia "inativa" para uma IA que estava ativa e
  // respondendo — a titular via todos os provedores dela como desligados
  // ("as IAs constam inativas", 31/08). O teste de conexão sofria do mesmo:
  // provava a chave do cofre global em vez da chave que o espaço realmente usa.
  const envIa = await envComChavesDoEspaco(env, access.ownerId);
  const envBusca = await envComChavesDeBuscaDoEspaco(envIa, access.ownerId);
  if (request.method === "GET") {
    const activeWebhooks = env.DB
      ? await env.DB.prepare(
          "SELECT COUNT(*) AS total FROM webhooks WHERE owner_id=? AND enabled=1",
        ).bind(access.ownerId).first().then((row) => Number(row?.total || 0)).catch(() => 0)
      : 0;
    const status = todoGreenIntegrationStatus(envBusca, { activeWebhooks });
    status.health = await latestTodoGreenIntegrationHealth(envBusca, access.ownerId);
    status.operational = [
      await track3rStatusForOwner(envBusca, access.ownerId),
      await trackerStatusForOwner(envBusca, access.ownerId),
      sefazStatus(envBusca),
      await ciotStatusForOwner(envBusca, access.ownerId),
      ocppStatus(),
    ];
    return json(status);
  }
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!podeNaVertical(access, "integration:manage"))
    return json({ error: "Seu papel não pode testar integrações." }, 403);
  const body = await request.json().catch(() => ({}));
  const provider = String(body.provider || "").trim().slice(0, 80);
  const action = String(body.action || "").trim().slice(0, 80);
  if (!provider) return json({ error: "Informe a integração." }, 400);
  try {
    // Gateway externo: uma AÇÃO executa a consulta (ex.: CEP, carregadores);
    // sem ação é só o teste de conexão, que também alimenta o integration-health.
    if (externalIds(envBusca).has(provider)) {
      if (action) {
        return json({
          provider, action,
          result: await runTodoGreenExternalIntegration(envBusca, provider, action, body.input || {}),
          checkedAt: new Date().toISOString(),
        });
      }
      const integrationTest = await probeTodoGreenExternalIntegration(envBusca, provider);
      const online = Boolean(integrationTest?.ok);
      await recordTodoGreenIntegrationHealth(envBusca, {
        ownerId: access.ownerId, integrationId: provider, configured: true,
        authenticated: online, online,
        error: online ? "" : "O gateway não respondeu ao teste.",
        nextAction: online ? "" : "Confirme a URL/credencial e rode o teste novamente.",
        latencyMs: integrationTest?.latencyMs,
      });
      return json({ integrationTest, checkedAt: new Date().toISOString() });
    }
    if (provider === "web-search") {
      const searchTest = await probeWebSearch(envBusca);
      const online = Boolean(searchTest?.providers?.length);
      await recordTodoGreenIntegrationHealth(envBusca, {
        ownerId: access.ownerId, integrationId: provider, configured: true, authenticated: online, online,
        error: online ? "" : (searchTest?.failures || []).map((item) => item.error).filter(Boolean).join(" · "),
        nextAction: online ? "" : "Revise a fonte configurada e rode o teste novamente.",
        latencyMs: searchTest?.latencyMs,
        recordsProcessed: searchTest?.resultCount,
      });
      return json({ searchTest, checkedAt: new Date().toISOString() });
    }
    const test = await probeAiProvider(envBusca, provider);
    await recordTodoGreenIntegrationHealth(envBusca, {
      ownerId: access.ownerId, integrationId: provider, configured: true,
      authenticated: Boolean(test.ok), online: Boolean(test.ok),
      error: test.ok ? "" : "O provedor não respondeu ao teste técnico.",
      nextAction: test.ok ? "" : "Revise a credencial e rode o teste novamente.",
      latencyMs: test?.latencyMs,
    });
    return json({ test, checkedAt: new Date().toISOString() });
  } catch (error) {
    const message = String(error?.message || "Falha no teste do provedor").slice(0, 180);
    await recordTodoGreenIntegrationHealth(envBusca, {
      ownerId: access.ownerId, integrationId: provider || "desconhecida", configured: true,
      authenticated: false, online: false, error: message,
      nextAction: "Revise a configuração e execute um novo teste.",
    });
    return json({ error: message, provider }, 502);
  }
}
