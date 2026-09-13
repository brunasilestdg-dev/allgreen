// ===== Saúde do sistema (observabilidade) =====
// Camada PURA e DETERMINÍSTICA. Sem banco, sem rede, sem DOM.
//
// O worker COLETA fatos (D1 respondeu? quantas migrations aplicadas? qual SHA
// está servindo? a URL do Valhalla existe?) e este domínio DERIVA o panorama:
// estado canônico por componente/integração, comparação LOCAL × SERVIDOR ×
// D1 e os alertas que importam ("frontend novo com backend antigo",
// "backend novo com D1 antigo"). Regra da rodada: zero NÃO é erro, e
// "existe código" NÃO é "está conectado" — cada linha diz o que é de verdade.
//
// Estados de componente (seção 112):
//   OPERATIONAL         — respondeu agora e está íntegro
//   DEGRADED            — responde, mas fora do esperado (lento, defasado, parcial)
//   FALLBACK            — operando por contingência declarada
//   NOT_CONFIGURED      — binding/URL/credencial ausente: nem foi ligado
//   EXTERNAL_DEPENDENCY — configurado, aguardando algo fora do nosso controle
//   ERROR               — configurado e falhando de fato
//
// Para integrações reaproveita `deriveIntegrationStatus` (CONNECTED/…): é a
// MESMA régua do painel de Integrações — não uma segunda leitura.

import {
  deriveIntegrationStatus,
  INTEGRATION_STATES,
  integrationStateLabel,
} from "./integrationStatusDomain.js";

export const SYSTEM_STATES = Object.freeze({
  OPERATIONAL: "OPERATIONAL",
  DEGRADED: "DEGRADED",
  FALLBACK: "FALLBACK",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  EXTERNAL_DEPENDENCY: "EXTERNAL_DEPENDENCY",
  ERROR: "ERROR",
});

const LABEL_PT = {
  OPERATIONAL: "Operacional",
  DEGRADED: "Degradado",
  FALLBACK: "Contingência",
  NOT_CONFIGURED: "Não configurado",
  EXTERNAL_DEPENDENCY: "Aguardando externo",
  ERROR: "Com erro",
};
export const systemStateLabel = (state) => LABEL_PT[state] || integrationStateLabel(state) || String(state || "");

// Classificação honesta do que existe no código (seção 126). REAL só quando o
// caminho conectado existe de ponta a ponta; PARTIAL quando o núcleo é real mas
// há gate/persistência/UI faltando; PREPARED quando só há adaptador/seleção sem
// cliente real; NOT_IMPLEMENTED quando ainda não há caminho de código.
export const IMPLEMENTATION = Object.freeze({
  REAL: "REAL",
  PARTIAL: "PARTIAL",
  PREPARED: "PREPARED",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  EXTERNAL: "EXTERNAL",
});

const IMPLEMENTATION_PT = {
  REAL: "Real",
  PARTIAL: "Parcial",
  PREPARED: "Preparada (sem cliente real)",
  NOT_IMPLEMENTED: "Não implementada",
  EXTERNAL: "Depende de fornecedor externo",
};
export const implementationLabel = (value) => IMPLEMENTATION_PT[value] || String(value || "");

// Grupos do painel (seção 113). A ordem é a de leitura: infraestrutura antes de
// integração; roteirização antes de dado de mercado.
export const HEALTH_GROUPS = Object.freeze([
  { id: "plataforma", label: "Plataforma" },
  { id: "roteirizacao", label: "Roteirização e geodados" },
  { id: "operacao", label: "Operação e telemetria" },
  { id: "energia", label: "Energia e recarga" },
  { id: "pagamentos", label: "Pagamentos" },
  { id: "ia", label: "IA e busca" },
  { id: "mercado", label: "Mercado e licitações" },
  { id: "risco", label: "Risco viário" },
]);

const bool = (v) => v === true || v === 1 || v === "1" || v === "true";
const texto = (v, max = 400) => String(v ?? "").trim().slice(0, max);
const numero = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);

/**
 * Estado de um COMPONENTE de plataforma a partir de fatos.
 *   configured — o binding/URL existe
 *   ok         — respondeu ao teste (true/false); null = não foi testado
 *   error      — mensagem de falha quando houve
 *   fallback   — operando por contingência declarada
 *   external   — configurado mas aguardando terceiro
 *   degraded   — responde, mas fora do esperado (ex.: migrations defasadas)
 */
export function deriveComponentState({
  configured = true,
  ok = null,
  error = "",
  fallback = false,
  external = false,
  degraded = false,
} = {}) {
  if (!bool(configured)) return SYSTEM_STATES.NOT_CONFIGURED;
  if (texto(error) && ok !== true) return SYSTEM_STATES.ERROR;
  if (ok === false) return SYSTEM_STATES.ERROR;
  if (bool(external)) return SYSTEM_STATES.EXTERNAL_DEPENDENCY;
  if (bool(fallback)) return SYSTEM_STATES.FALLBACK;
  if (bool(degraded)) return SYSTEM_STATES.DEGRADED;
  return SYSTEM_STATES.OPERATIONAL;
}

/**
 * LOCAL × MAIN × PRODUÇÃO (seção 7). O ambiente vem, nesta ordem:
 *   1. `override` — variável de runtime do Worker (TDG_ENVIRONMENT), que é a
 *      configuração do próprio Worker onde o código está rodando;
 *   2. metadados de build — branch `main` publicada por CI = produção; outra
 *      branch em CI = prévia;
 *   3. sem manifesto de build (wrangler dev / vite dev) = local.
 * Nunca um literal escondido no código: outro Worker/D1/domínio define o seu.
 */
export function derivarAmbiente({ override = "", sha = "", branch = "", ci = "" } = {}) {
  const forcado = texto(override, 40).toLowerCase();
  if (forcado) return forcado;
  const versao = texto(sha, 64);
  if (!versao || versao === "local" || versao.startsWith("local-")) return "local";
  const ramo = texto(branch, 120);
  if (texto(ci)) return ramo === "main" || ramo === "master" ? "production" : "preview";
  return ramo === "main" || ramo === "master" ? "production" : "manual";
}

const AMBIENTE_PT = {
  production: "Produção",
  preview: "Prévia",
  staging: "Homologação",
  manual: "Publicação manual",
  local: "Local",
};
export const ambienteLabel = (ambiente) => AMBIENTE_PT[ambiente] || texto(ambiente, 40) || "Desconhecido";

/**
 * Compara o que o NAVEGADOR carregou (build do cliente), o que o SERVIDOR está
 * servindo (manifesto do Worker) e o que o D1 tem aplicado (migrations) com o
 * que o código espera. Gera alertas nomeados — são exatamente as combinações
 * da seção 15 ("frontend novo com backend antigo", "backend novo com D1 antigo").
 */
export function compararVersoes({
  clientSha = "",
  serverSha = "",
  expectedMigrations = null,
  appliedMigrations = null,
  expectedLastMigration = "",
  appliedLastMigration = "",
} = {}) {
  const cliente = texto(clientSha, 64);
  const servidor = texto(serverSha, 64);
  const alerts = [];

  const clientMatchesServer = cliente && servidor ? cliente === servidor : null;
  if (clientMatchesServer === false) {
    alerts.push({
      code: "CLIENT_SERVER_MISMATCH",
      severity: "warning",
      message: `O navegador carregou a versão ${cliente}, mas o servidor está em ${servidor}. Recarregue a página para alinhar.`,
    });
  }

  const esperadas = numero(expectedMigrations);
  const aplicadas = numero(appliedMigrations);
  let migrationsInSync = null;
  if (esperadas !== null && aplicadas !== null) {
    migrationsInSync = esperadas === aplicadas
      && (!expectedLastMigration || !appliedLastMigration || texto(expectedLastMigration) === texto(appliedLastMigration));
    if (aplicadas < esperadas) {
      alerts.push({
        code: "D1_BEHIND_CODE",
        severity: "error",
        message: `Backend novo com D1 antigo: o código espera ${esperadas} migrations e o banco tem ${aplicadas}. Aplique as pendentes antes de usar funções novas.`,
      });
    } else if (aplicadas > esperadas) {
      alerts.push({
        code: "D1_AHEAD_OF_CODE",
        severity: "warning",
        message: `O D1 tem ${aplicadas} migrations e este código conhece ${esperadas}: há migration aplicada fora deste build (branch não mergeada ou Worker antigo).`,
      });
    } else if (migrationsInSync === false) {
      alerts.push({
        code: "D1_LAST_MIGRATION_DIFFERS",
        severity: "warning",
        message: `Mesma contagem de migrations, mas a última difere (código: ${texto(expectedLastMigration)}; banco: ${texto(appliedLastMigration)}).`,
      });
    }
  }

  return { clientMatchesServer, migrationsInSync, alerts };
}

const ESTADO_INTEGRACAO_PARA_SISTEMA = {
  [INTEGRATION_STATES.CONNECTED]: SYSTEM_STATES.OPERATIONAL,
  [INTEGRATION_STATES.DEGRADED]: SYSTEM_STATES.DEGRADED,
  [INTEGRATION_STATES.FALLBACK]: SYSTEM_STATES.FALLBACK,
  [INTEGRATION_STATES.NOT_CONFIGURED]: SYSTEM_STATES.NOT_CONFIGURED,
  [INTEGRATION_STATES.EXTERNAL_DEPENDENCY]: SYSTEM_STATES.EXTERNAL_DEPENDENCY,
  [INTEGRATION_STATES.ERROR]: SYSTEM_STATES.ERROR,
};

/**
 * Normaliza UMA integração para a linha do painel (seção 114): estado
 * canônico + métricas (lastSuccessAt, lastErrorAt, latência, volume, stale).
 * Integração NOT_IMPLEMENTED nunca aparece como conectada, mesmo que alguém
 * passe `online: true` por engano — o código simplesmente não existe.
 */
export function normalizarIntegracao(item = {}, { now = Date.now(), staleMs } = {}) {
  const implementation = IMPLEMENTATION[item.implementation] || IMPLEMENTATION.PARTIAL;
  const naoImplementada = implementation === IMPLEMENTATION.NOT_IMPLEMENTED;
  const derivado = deriveIntegrationStatus(
    {
      integrationId: item.id,
      configured: naoImplementada ? false : item.configured,
      authenticated: naoImplementada ? false : item.authenticated,
      online: naoImplementada ? false : item.online,
      fallbackActive: item.fallbackActive,
      error: item.error,
      checkedAt: item.checkedAt,
      lastSuccessAt: item.lastSuccessAt,
      lastFailureAt: item.lastFailureAt,
    },
    { now, staleMs: numero(item.staleMs) ?? staleMs },
  );
  const state = ESTADO_INTEGRACAO_PARA_SISTEMA[derivado.state] || SYSTEM_STATES.NOT_CONFIGURED;
  // Configurada mas NUNCA testada: continua pedindo atenção (DEGRADED), só que
  // o rótulo diz a verdade — "sem verificação" — em vez de acusar uma queda
  // que ninguém mediu. O botão "Testar" resolve.
  const unverified = derivado.configured && !derivado.checkedAt && !derivado.error && !derivado.online;
  return {
    id: texto(item.id, 80),
    name: texto(item.name, 120) || texto(item.id, 80),
    group: texto(item.group, 40) || "plataforma",
    implementation,
    implementationLabel: implementationLabel(implementation),
    state,
    label: unverified && state === SYSTEM_STATES.DEGRADED ? "Configurado, sem verificação" : systemStateLabel(state),
    unverified,
    integrationState: derivado.state,
    configured: derivado.configured,
    authenticated: derivado.authenticated,
    online: derivado.online,
    fallback: derivado.fallbackActive,
    stale: derivado.stale,
    error: derivado.error,
    lastSuccessAt: derivado.lastSuccessAt,
    lastErrorAt: derivado.lastFailureAt,
    lastSyncAt: item.lastSyncAt ? texto(item.lastSyncAt, 40) : derivado.lastSuccessAt,
    checkedAt: derivado.checkedAt,
    latencyMs: numero(item.latencyMs),
    recordsProcessed: numero(item.recordsProcessed),
    detail: texto(item.detail, 400),
    requirement: texto(item.requirement, 300),
    nextAction: texto(item.nextAction, 300),
    canTest: bool(item.canTest),
  };
}

export function normalizarComponente(item = {}) {
  const state = item.state && SYSTEM_STATES[item.state] ? item.state : deriveComponentState(item);
  return {
    id: texto(item.id, 80),
    name: texto(item.name, 120) || texto(item.id, 80),
    group: texto(item.group, 40) || "plataforma",
    state,
    label: systemStateLabel(state),
    detail: texto(item.detail, 400),
    latencyMs: numero(item.latencyMs),
    checkedAt: item.checkedAt ? texto(item.checkedAt, 40) : null,
    meta: item.meta && typeof item.meta === "object" ? item.meta : undefined,
  };
}

const SAUDAVEL = new Set([SYSTEM_STATES.OPERATIONAL]);
const ATENCAO = new Set([SYSTEM_STATES.DEGRADED, SYSTEM_STATES.FALLBACK, SYSTEM_STATES.EXTERNAL_DEPENDENCY]);
const QUEBRADO = new Set([SYSTEM_STATES.ERROR]);

export function resumirEstados(linhas = []) {
  const counts = {};
  for (const linha of linhas) counts[linha.state] = (counts[linha.state] || 0) + 1;
  return {
    total: linhas.length,
    operational: linhas.filter((l) => SAUDAVEL.has(l.state)).length,
    attention: linhas.filter((l) => ATENCAO.has(l.state)).length,
    broken: linhas.filter((l) => QUEBRADO.has(l.state)).length,
    notConfigured: linhas.filter((l) => l.state === SYSTEM_STATES.NOT_CONFIGURED).length,
    counts,
  };
}

// Estado geral: o pior componente da plataforma manda (uma D1 em erro é um
// sistema em erro, mesmo com 20 integrações conectadas). Integração não
// configurada NÃO rebaixa o geral — é escolha, não falha.
export function estadoGeral(components = [], integrations = []) {
  const todos = [...components, ...integrations];
  if (components.some((c) => c.state === SYSTEM_STATES.ERROR)) return SYSTEM_STATES.ERROR;
  if (components.some((c) => c.state === SYSTEM_STATES.DEGRADED || c.state === SYSTEM_STATES.FALLBACK)) return SYSTEM_STATES.DEGRADED;
  if (todos.some((c) => c.state === SYSTEM_STATES.ERROR)) return SYSTEM_STATES.DEGRADED;
  return SYSTEM_STATES.OPERATIONAL;
}

/**
 * Monta o relatório inteiro que o painel "Administração → Saúde do sistema"
 * exibe. Entrada = fatos coletados; saída = derivada, estável e sem segredo.
 */
export function montarRelatorioDeSaude({
  version = {},
  components = [],
  integrations = [],
  now = Date.now(),
  staleMs = 24 * 60 * 60 * 1000,
} = {}) {
  const ambiente = derivarAmbiente({
    override: version.environmentOverride,
    sha: version.serverSha,
    branch: version.branch,
    ci: version.ci,
  });
  const comparacao = compararVersoes(version);
  const componentes = (Array.isArray(components) ? components : []).map(normalizarComponente);
  const integracoes = (Array.isArray(integrations) ? integrations : []).map((i) => normalizarIntegracao(i, { now, staleMs }));

  return {
    checkedAt: new Date(now).toISOString(),
    overall: estadoGeral(componentes, integracoes),
    version: {
      environment: ambiente,
      environmentLabel: ambienteLabel(ambiente),
      serverSha: texto(version.serverSha, 64) || null,
      clientSha: texto(version.clientSha, 64) || null,
      branch: texto(version.branch, 120) || null,
      buildTime: version.buildTime ? texto(version.buildTime, 40) : null,
      publishedBy: texto(version.publishedBy, 40) || null,
      expectedMigrations: numero(version.expectedMigrations),
      appliedMigrations: numero(version.appliedMigrations),
      expectedLastMigration: texto(version.expectedLastMigration, 160) || null,
      appliedLastMigration: texto(version.appliedLastMigration, 160) || null,
      clientMatchesServer: comparacao.clientMatchesServer,
      migrationsInSync: comparacao.migrationsInSync,
    },
    alerts: comparacao.alerts,
    components: componentes,
    integrations: integracoes,
    summary: {
      components: resumirEstados(componentes),
      integrations: resumirEstados(integracoes),
    },
    groups: HEALTH_GROUPS,
  };
}
