import { configuredAiProviders, probeAiProvider } from "./ai.js";
import { podeNaVertical } from "./todogreen-access.js";
import { probeWebSearch, webSearchConfiguration } from "./web-search.js";
import { envComChavesDeBuscaDoEspaco } from "./search-keys.js";

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

const trackerDefaultStatus = () => withReadiness({
  id: "track3r",
  name: "Track3r / Sistemas Tracker",
  configured: false,
  detail: "A vertical possui camada própria de integração e sincronização, mas este workspace ainda não comprovou conexão ativa.",
  requirement: "Cadastro da integração + credencial de API/webhook + sincronização bem-sucedida",
});

async function trackerStatusForOwner(env, ownerId) {
  if (!env.DB || !ownerId) return trackerDefaultStatus();
  const integration = await env.DB.prepare(
    `SELECT status, sync_mode, token_env_key, webhook_secret_env_key,
            last_success_at, last_error
       FROM todogreen_tracker_integrations
      WHERE workspace_owner_id = ?
        AND provider = 'sistemas_tracker'
        AND archived_at IS NULL
      LIMIT 1`,
  ).bind(ownerId).first().catch(() => null);

  if (!integration) return trackerDefaultStatus();
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
    id: "track3r",
    name: "Track3r / Sistemas Tracker",
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
    operational: [trackerDefaultStatus(), sefazStatus(env), ciotStatus(env)],
    management: managementIntegrations(),
    dataExchange: dataExchangeIntegrations(env, activeWebhooks),
    automation: nativeAutomations(env),
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
  const envBusca = await envComChavesDeBuscaDoEspaco(env, access.ownerId);
  if (request.method === "GET") {
    const activeWebhooks = env.DB
      ? await env.DB.prepare(
          "SELECT COUNT(*) AS total FROM webhooks WHERE owner_id=? AND enabled=1",
        ).bind(access.ownerId).first().then((row) => Number(row?.total || 0)).catch(() => 0)
      : 0;
    const status = todoGreenIntegrationStatus(envBusca, { activeWebhooks });
    status.operational = [
      await trackerStatusForOwner(envBusca, access.ownerId),
      sefazStatus(envBusca),
      ciotStatus(envBusca),
    ];
    return json(status);
  }
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!podeNaVertical(access, "integration:manage"))
    return json({ error: "Seu papel não pode testar integrações." }, 403);
  const body = await request.json().catch(() => ({}));
  const provider = String(body.provider || "").trim().slice(0, 40);
  try {
    if (provider === "web-search")
      return json({ searchTest: await probeWebSearch(envBusca), checkedAt: new Date().toISOString() });
    return json({ test: await probeAiProvider(envBusca, provider), checkedAt: new Date().toISOString() });
  } catch (error) {
    return json({ error: String(error?.message || "Falha no teste do provedor").slice(0, 180), provider }, 502);
  }
}
