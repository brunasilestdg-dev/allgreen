import { configuredAiProviders, probeAiProvider } from "./ai.js";
import { podeNaVertical } from "./todogreen-access.js";
import { probeWebSearch, webSearchConfiguration } from "./web-search.js";
import { envComChavesDeBuscaDoEspaco } from "./search-keys.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const nativeAutomations = (env) => {
  const configured = Boolean(env.DB);
  return [
    {
      id: "cloudflare-cron",
      name: "Agendamentos da Cloudflare",
      configured,
      detail: "Execução automática a cada hora.",
    },
    {
      id: "tasks-reminders",
      name: "Tarefas e lembretes automáticos",
      configured,
      detail: "Executados no Worker e registrados no D1.",
    },
    {
      id: "custom-workflow-rules",
      name: "Regras configuráveis da Central",
      configured,
      detail: "Gatilhos, condições e ações definidos pela equipe e executados no servidor.",
    },
    {
      id: "weekly-summary",
      name: "Resumo semanal",
      configured,
      detail: "Processado toda segunda-feira pela infraestrutura da plataforma.",
    },
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
  const configured = Boolean(
    validUrl && env.EVOLUTION_API_KEY && env.EVOLUTION_INSTANCE,
  );
  return [
    {
      id: "evolution-api",
      name: "Evolution API",
      configured,
      detail: configured
        ? "Credenciais da instância cadastradas para envio pelo CRM."
        : "Conector pronto. Requer URL, chave e nome da instância conectada.",
    },
  ];
};

export function todoGreenIntegrationStatus(env = {}, { activeWebhooks = 0 } = {}) {
  const search = webSearchConfiguration(env);
  return {
    ai: configuredAiProviders(env),
    search: {
      configured: search.configured,
      providers: Object.entries(search.providers).map(([id, configured]) => ({ id, configured })),
    },
    automation: nativeAutomations(env),
    messaging: messagingIntegrations(env),
    communication: [
      {
        id: "transactional-email",
        name: "E-mail transacional",
        configured: Boolean(env.BREVO_API_KEY && env.MAIL_SENDER),
        detail: env.BREVO_API_KEY && env.MAIL_SENDER
          ? "Remetente e provedor configurados para notificações do produto."
          : "Requer chave do provedor e remetente verificado.",
      },
      {
        id: "google-account",
        name: "Conta Google",
        configured: Boolean(env.GOOGLE_CLIENT_ID),
        detail: env.GOOGLE_CLIENT_ID
          ? "Login Google configurado. Gmail e Agenda só agem com confirmação da pessoa."
          : "Login Google não configurado; links de composição continuam disponíveis.",
      },
    ],
    dataExchange: [
      {
        id: "outbound-webhooks",
        name: "Webhooks de saída",
        configured: activeWebhooks > 0,
        detail: activeWebhooks > 0
          ? `${activeWebhooks} webhook(s) ativo(s) neste espaço.`
          : "Motor disponível, sem destino ativo neste espaço.",
      },
      {
        id: "public-api",
        name: "API pública com idempotência",
        configured: Boolean(env.DB),
        detail: "Compartilha a infraestrutura da plataforma, com chaves, escopo e proteção contra duplicidade.",
      },
      {
        id: "antt-ciot-direct",
        name: "ANTT CIOT direto sem IPEF",
        configured: Boolean(
          env.TODOGREEN_ANTT_CIOT_BASE_URL &&
          env.TODOGREEN_ANTT_CIOT_CONNECTOR_URL &&
          ((env.TODOGREEN_ANTT_CIOT_CERTIFICATE_PFX && env.TODOGREEN_ANTT_CIOT_CERTIFICATE_PASSWORD) ||
            env.TODOGREEN_ANTT_CIOT_A3_CONNECTOR_URL)
        ),
        detail: "Conector preparado para ETC/frota própria com certificado ICP-Brasil A1 ou A3 e retorno do código CIOT de 12 dígitos.",
      },
    ],
    automationEngine: {
      id: "cloudflare-native",
      name: "Cloudflare Worker + Cron + D1",
      configured: Boolean(env.DB),
      requiresExternalServer: false,
    },
    exclusions: [
      { id: "whisper", name: "Transcrição Whisper", reason: "Não faz parte da operação To Do Green." },
      { id: "image-generation", name: "Geração de imagens", reason: "Não faz parte da operação To Do Green." },
    ],
  };
}

export async function handleTodoGreenIntegrations(request, env, access) {
  // A busca configurada por ESTE espaço (SearXNG próprio, chaves de reserva)
  // precisa aparecer como "ligada" na tela e ser o que o botão "Testar"
  // exercita — senão o campo que a titular acabou de preencher não teria eco.
  const envBusca = await envComChavesDeBuscaDoEspaco(env, access.ownerId);
  if (request.method === "GET") {
    const activeWebhooks = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM webhooks WHERE owner_id=? AND enabled=1",
    ).bind(access.ownerId).first().then((row) => Number(row?.total || 0)).catch(() => 0);
    return json(todoGreenIntegrationStatus(envBusca, { activeWebhooks }));
  }
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!podeNaVertical(access, "integration:manage"))
    return json({ error: "Seu papel não pode testar integrações." }, 403);
  const body = await request.json().catch(() => ({}));
  const provider = String(body.provider || "").trim().slice(0, 40);
  try {
    // A busca web não é um provedor da cascata de IA: ela tem vários
    // provedores próprios e falha de jeitos que "respondeu/não respondeu" não
    // descreve. Por isso tem teste próprio, que devolve quem respondeu, quem
    // falhou e por quê, e quantos resultados vieram.
    if (provider === "web-search")
      return json({ searchTest: await probeWebSearch(envBusca), checkedAt: new Date().toISOString() });
    return json({ test: await probeAiProvider(env, provider), checkedAt: new Date().toISOString() });
  } catch (error) {
    return json({ error: String(error?.message || "Falha no teste do provedor").slice(0, 180), provider }, 502);
  }
}
