// ===== Saúde do sistema (Administração → Saúde do sistema) =====
//
// Este serviço só COLETA fatos: a D1 respondeu? em quantos ms? quantas
// migrations estão aplicadas? qual SHA os assets publicados carregam? a URL do
// Valhalla existe no cofre? A DERIVAÇÃO (estado canônico, LOCAL × SERVIDOR ×
// BANCO, alertas) mora no domínio puro `systemHealthDomain.js`, testável sem
// Worker. Regra: nada aqui inventa "conectado" — sem evidência (teste ou
// sincronização registrada em `todogreen_integration_health_events`) a
// integração aparece como "configurada, sem verificação".
//
// Segredos NUNCA saem daqui: só nomes de variáveis (para a pessoa saber o que
// cadastrar) e booleanos de presença.

import { json } from "../lib/http.js";
import { podeNaVertical } from "./todogreen-access.js";
import { configuredAiProviders } from "./ai.js";
import { webSearchConfiguration } from "./web-search.js";
import { envComChavesDeBuscaDoEspaco } from "./search-keys.js";
import { envComChavesDoEspaco } from "./ai-keys.js";
import { todoGreenExternalIntegrationCatalog } from "./todogreen-integration-gateway.js";
import { latestTodoGreenIntegrationHealth } from "./todogreen-integration-health.js";
import { ENERGY_LIMITS, estadoDasReferenciasDeEnergia } from "./todogreen-energy-reference.js";
import { R2_BUCKET_BINDING } from "./todogreen-file-store.js";
import {
  ciotStatusForOwner,
  ocppStatus,
  sefazStatus,
  track3rStatusForOwner,
  trackerStatusForOwner,
} from "./todogreen-integrations.js";
import {
  derivarAmbiente,
  IMPLEMENTATION,
  montarRelatorioDeSaude,
} from "../../src/features/logistics/systemHealthDomain.js";
import { motoresDisponiveis } from "../../src/features/logistics/routingProvidersDomain.js";

const texto = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const urlValida = (value) => {
  const raw = texto(value, 400);
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

// Lê o manifesto que o build (vite.config.js) publica junto dos assets. É a
// ÚNICA fonte do "SHA em produção": `/api/status`, `/api/system/version` e a
// tela de saúde leem daqui — não há segunda verdade.
export async function lerManifestoDeVersao(env, origin) {
  try {
    if (!env?.ASSETS?.fetch) return null;
    const response = await env.ASSETS.fetch(
      new Request(`${origin}/version.json`, { headers: { "cache-control": "no-store" } }),
    );
    if (!response.ok) return null;
    const data = await response.json();
    const migrations = data.migrations && typeof data.migrations === "object"
      ? {
          count: Number.isFinite(Number(data.migrations.count)) && data.migrations.count !== null ? Number(data.migrations.count) : null,
          last: data.migrations.last ? texto(data.migrations.last, 160) : null,
        }
      : null;
    return {
      version: texto(data.version, 64),
      buildTime: data.buildTime || null,
      branch: data.branch ? texto(data.branch, 120) : null,
      ci: data.ci ? texto(data.ci, 60) : null,
      publishedBy: data.publishedBy ? texto(data.publishedBy, 60) : null,
      migrations,
    };
  } catch {
    return null;
  }
}

// GET /api/system/version — público, sem segredo. `sha` é o mesmo `version`
// de `/api/status` (mantido como alias para não quebrar quem já lê).
export function systemVersionPayload(env = {}, manifesto = null) {
  const sha = manifesto?.version || "local";
  const environment = derivarAmbiente({
    override: env.TDG_ENVIRONMENT,
    sha,
    branch: manifesto?.branch,
    ci: manifesto?.ci,
  });
  return {
    sha,
    version: sha,
    buildTime: manifesto?.buildTime || null,
    environment,
    branch: manifesto?.branch || null,
    publishedBy: manifesto?.publishedBy || (manifesto ? "manual" : "local"),
    migrations: manifesto?.migrations
      ? { expected: manifesto.migrations.count, last: manifesto.migrations.last }
      : null,
    checkedAt: new Date().toISOString(),
  };
}

const medir = async (fn) => {
  const inicio = Date.now();
  try {
    const value = await fn();
    return { ok: true, value, latencyMs: Date.now() - inicio };
  } catch (error) {
    return { ok: false, error: texto(error?.message || error, 200), latencyMs: Date.now() - inicio };
  }
};

const semSql = (nome) => texto(nome, 160).replace(/\.sql$/i, "");

async function fatosDoBanco(env) {
  if (!env?.DB) return { configured: false };
  const ping = await medir(() => env.DB.prepare("SELECT 1 AS ok").first());
  const migrations = await medir(() =>
    env.DB.prepare("SELECT COUNT(*) AS total, MAX(name) AS last FROM d1_migrations").first(),
  );
  const tabelas = await medir(() =>
    env.DB.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name LIKE 'todogreen%'").first(),
  );
  return {
    configured: true,
    ok: ping.ok,
    error: ping.ok ? "" : ping.error,
    latencyMs: ping.latencyMs,
    appliedMigrations: migrations.ok ? Number(migrations.value?.total ?? 0) : null,
    appliedLastMigration: migrations.ok ? semSql(migrations.value?.last || "") || null : null,
    tables: tabelas.ok ? Number(tabelas.value?.total ?? 0) : null,
  };
}

// Traduz a leitura do painel de Integrações (connected/configured/requires_setup/
// external_dependency/error) para os FATOS que o domínio de saúde consome.
const deReadiness = (item, extra = {}, now = new Date().toISOString()) => {
  const status = texto(item?.status, 40);
  const conectada = status === "connected";
  const comErro = status === "error";
  return {
    id: item.id,
    name: item.name,
    configured: status !== "requires_setup" && (Boolean(item.configured) || status === "external_dependency" || conectada || comErro || status === "configured"),
    authenticated: conectada || comErro || status === "configured",
    online: conectada,
    error: comErro ? texto(item.detail, 300) : "",
    checkedAt: conectada || comErro ? now : null,
    detail: texto(item.detail, 400),
    requirement: texto(item.requirement, 300),
    ...extra,
  };
};

// Item do gateway (catálogo externo) + último evento de saúde registrado.
const doCatalogo = (item, saude, extra = {}) => ({
  id: item.id,
  name: item.name,
  configured: Boolean(item.configured),
  // APIs públicas e self-hosted não têm login: "autenticado" = "utilizável".
  authenticated: Boolean(item.configured),
  online: Boolean(saude?.online),
  error: saude?.error || "",
  checkedAt: saude?.checkedAt || null,
  lastSuccessAt: saude?.lastSuccessAt || null,
  lastFailureAt: saude?.lastFailureAt || null,
  latencyMs: saude?.latencyMs ?? null,
  recordsProcessed: saude?.recordsProcessed ?? null,
  detail: texto(item.detail, 400),
  requirement: texto(item.requirement, 300),
  canTest: Boolean(item.configured),
  ...extra,
});

const dataCurta = (iso) => (iso ? String(iso).slice(0, 16).replace("T", " ") : "—");

// Referência pública em cache (ANEEL/ANP/ONS): a linha mostra a data da FONTE e
// da última ingestão. Nunca sincronizou → vale o último "Testar" (probe) ou
// "sem verificação"; falhou sem nunca ter dado → ERROR; velho → STALE/DEGRADED.
const linhaDeReferencia = (item, fonte, saudeProbe, { staleMs, detalheOk, detalheSem }) => {
  const f = fonte || { status: "never", configured: true };
  const jaSincronizou = Boolean(f.lastSuccessAt);
  const saude = jaSincronizou || f.status === "error"
    ? {
        online: jaSincronizou,
        error: f.status === "error" ? f.error : "",
        checkedAt: f.lastAttemptAt || null,
        lastSuccessAt: f.lastSuccessAt || null,
        lastFailureAt: f.status === "error" ? f.lastAttemptAt || null : null,
        latencyMs: f.latencyMs ?? null,
        recordsProcessed: f.records ?? null,
      }
    : saudeProbe;
  let detail = detalheSem;
  if (jaSincronizou) detail = `${detalheOk(f)}${f.stale ? " Fonte sem atualização dentro do prazo esperado (STALE)." : ""}`;
  else if (f.status === "error") detail = `Última tentativa falhou: ${texto(f.error, 160)}. ${detalheSem}`;
  return doCatalogo({ ...item, configured: f.configured !== false, requirement: f.requirement || item.requirement || "" }, saude, {
    group: "energia",
    implementation: IMPLEMENTATION.REAL,
    canTest: true,
    staleMs,
    detail,
    lastSyncAt: f.lastSuccessAt || null,
    sourceUpdatedAt: f.sourceUpdatedAt || null,
  });
};

const naoImplementada = (id, name, group, detail, requirement) => ({
  id, name, group, detail, requirement,
  implementation: IMPLEMENTATION.NOT_IMPLEMENTED,
  configured: false,
  canTest: false,
});

/**
 * Coleta tudo que a tela mostra. `clientSha` é o build que o NAVEGADOR
 * carregou (o front manda `?client=`), para o alerta "frontend novo com
 * backend antigo" — o mesmo par que `/api/status?client=` já compara.
 */
export async function coletarSaudeDoSistema(env, { access, origin, clientSha = "" } = {}) {
  const agora = new Date().toISOString();
  const ownerId = access?.ownerId || "";

  const [manifesto, banco, envIa] = await Promise.all([
    lerManifestoDeVersao(env, origin),
    fatosDoBanco(env),
    envComChavesDoEspaco(env, ownerId).catch(() => env),
  ]);
  const envBusca = await envComChavesDeBuscaDoEspaco(envIa, ownerId).catch(() => envIa);
  const saudeRegistrada = await latestTodoGreenIntegrationHealth(env, ownerId);
  const saudePorId = new Map(saudeRegistrada.map((row) => [row.integrationId, row]));
  const energia = await estadoDasReferenciasDeEnergia(env, ownerId).catch(() => null);

  const versao = systemVersionPayload(env, manifesto);
  const catalogo = todoGreenExternalIntegrationCatalog(envBusca);
  const doGateway = (id) => Object.values(catalogo).flat().find((item) => item.id === id) || null;

  const esperadas = manifesto?.migrations?.count ?? null;
  const defasagem = esperadas !== null && banco.appliedMigrations !== null && esperadas !== banco.appliedMigrations;

  // ---- Componentes de plataforma ----
  const components = [
    {
      id: "worker",
      name: "Worker (API)",
      configured: true,
      ok: true,
      detail: `Respondendo · ambiente ${versao.environment} · SHA ${versao.sha}${versao.branch ? ` · branch ${versao.branch}` : ""}`,
      checkedAt: agora,
      meta: { sha: versao.sha, environment: versao.environment, branch: versao.branch, publishedBy: versao.publishedBy },
    },
    manifesto
      ? {
          id: "app",
          name: "App (assets publicados)",
          configured: true,
          ok: true,
          detail: `Build ${manifesto.version}${manifesto.buildTime ? ` de ${manifesto.buildTime}` : ""} · publicado por ${versao.publishedBy}`,
          checkedAt: agora,
        }
      : {
          id: "app",
          name: "App (assets publicados)",
          configured: true,
          ok: null,
          degraded: true,
          detail: "Manifesto de versão (version.json) não encontrado: build local ou assets ainda não publicados.",
          checkedAt: agora,
        },
    {
      id: "d1",
      name: "Banco D1",
      configured: banco.configured,
      ok: banco.configured ? banco.ok : null,
      error: banco.error || "",
      degraded: defasagem,
      latencyMs: banco.latencyMs ?? null,
      detail: !banco.configured
        ? "Binding DB ausente."
        : banco.ok
          ? `SELECT 1 em ${banco.latencyMs} ms · ${banco.appliedMigrations ?? "?"} migrations aplicadas${esperadas !== null ? ` (código espera ${esperadas})` : ""}${banco.tables !== null ? ` · ${banco.tables} tabelas todogreen` : ""}`
          : `Falha ao consultar: ${banco.error}`,
      checkedAt: agora,
      meta: {
        appliedMigrations: banco.appliedMigrations,
        appliedLastMigration: banco.appliedLastMigration,
        expectedMigrations: esperadas,
        expectedLastMigration: manifesto?.migrations?.last || null,
        tables: banco.tables,
      },
    },
    env?.[R2_BUCKET_BINDING]
      ? {
          id: "r2",
          name: "Arquivos (R2)",
          configured: true,
          ok: true,
          detail: `Bucket ligado no binding ${R2_BUCKET_BINDING}.`,
          checkedAt: agora,
        }
      : {
          id: "r2",
          name: "Arquivos (R2)",
          state: "FALLBACK",
          detail: `Sem bucket R2 (binding ${R2_BUCKET_BINDING}); arquivos internos e POD ficam no D1 — contingência declarada.`,
          checkedAt: agora,
        },
    (() => {
      const provedores = configuredAiProviders(envIa).map((p) => texto(p.id || p.name, 40)).filter(Boolean);
      const workersAi = Boolean(env?.AI);
      const configured = provedores.length > 0 || workersAi;
      return {
        id: "ai",
        name: "IA (provedores)",
        configured,
        ok: configured ? true : null,
        detail: configured
          ? `${provedores.length} provedor(es) com chave${workersAi ? " + Workers AI" : ""}${provedores.length ? `: ${provedores.join(", ")}` : ""}`
          : "Nenhum provedor de IA configurado.",
        checkedAt: agora,
      };
    })(),
    (() => {
      const busca = webSearchConfiguration(envBusca);
      const comChave = Object.entries(busca.providers || {}).filter(([, on]) => on).map(([id]) => id);
      return comChave.length
        ? {
            id: "search",
            name: "Busca web",
            configured: true,
            ok: true,
            detail: `${comChave.length} fonte(s) com chave: ${comChave.join(", ")} · reserva gratuita ativa.`,
            checkedAt: agora,
          }
        : {
            id: "search",
            name: "Busca web",
            state: busca.configured ? "FALLBACK" : "NOT_CONFIGURED",
            detail: busca.configured
              ? "Só a reserva gratuita sem chave (DuckDuckGo, Wikidata, Wikipédia) — funciona, com cota e qualidade limitadas."
              : "Busca web desligada (SEM_BUSCA_GRATUITA).",
            checkedAt: agora,
          };
    })(),
  ];

  // ---- Integrações (seção 113) ----
  const motores = motoresDisponiveis(env);
  const osrm = doGateway("osrm");
  const osrmSelfHosted = motores.osrm.configured;
  const vroom = doGateway("vroom");
  const vroomSelfHosted = Boolean(vroom?.configured) || urlValida(env?.TDG_ROUTING_URL);
  const valhalla = doGateway("valhalla");
  const nominatim = doGateway("nominatim");
  const clima = doGateway("open-meteo");
  const aneel = doGateway("aneel-open-data");
  const ons = doGateway("ons-open-data");
  const anp = doGateway("anp-open-data");
  const antt = doGateway("antt-open-data");
  const ocm = doGateway("open-charge-map");
  const busca = webSearchConfiguration(envBusca);

  const [track3r, tracker, ciot] = await Promise.all([
    track3rStatusForOwner(env, ownerId).catch(() => null),
    trackerStatusForOwner(env, ownerId).catch(() => null),
    ciotStatusForOwner(env, ownerId).catch(() => null),
  ]);

  const integrations = [
    // Roteirização e geodados
    osrm && {
      ...doCatalogo(osrm, saudePorId.get("osrm"), {
        group: "roteirizacao",
        implementation: IMPLEMENTATION.REAL,
        configured: true,
        authenticated: true,
        fallbackActive: !osrmSelfHosted,
        detail: osrmSelfHosted
          ? "OSRM próprio: distância, tempo, matriz e geometria para veículos leves."
          : "Sem servidor próprio: usando o endpoint público do OSRM (contingência). Produção deve priorizar TODOGREEN_OSRM_BASE_URL.",
      }),
    },
    vroom && {
      ...doCatalogo(vroom, saudePorId.get("vroom"), {
        group: "roteirizacao",
        implementation: IMPLEMENTATION.REAL,
        configured: true,
        authenticated: true,
        fallbackActive: !vroomSelfHosted,
        detail: vroomSelfHosted
          ? "VROOM próprio: alocação veículo/motorista, sequência, capacidade, janelas."
          : "Sem servidor VROOM (TDG_ROUTING_URL / TODOGREEN_VROOM_BASE_URL): despacho usa o VRP local (WASM) — contingência.",
      }),
    },
    valhalla && {
      ...doCatalogo(valhalla, saudePorId.get("valhalla"), {
        group: "roteirizacao",
        implementation: IMPLEMENTATION.REAL,
        configured: motores.valhalla.configured,
        authenticated: motores.valhalla.configured,
        canTest: motores.valhalla.configured,
        detail: motores.valhalla.configured
          ? "Cliente real: pesados e veículos com restrição roteiam por truck costing (altura/largura/comprimento/peso/eixos). Teste lê /status."
          : "Sem TDG_VALHALLA_BASE_URL. Pesados (VUC/truck/carreta) NÃO caem em OSRM perfil de carro: o backend responde NO_SAFE_ROUTING_ENGINE até o Valhalla existir (infra/tms-routing).",
        requirement: "TDG_VALHALLA_BASE_URL (self-hosted, infra/tms-routing) + TDG_ROUTING_TOKEN no gateway",
      }),
    },
    nominatim && {
      ...doCatalogo(nominatim, saudePorId.get("nominatim"), { group: "roteirizacao", implementation: IMPLEMENTATION.REAL }),
    },
    naoImplementada("postgis", "PostGIS (restrições OSM, índice geográfico)", "roteirizacao",
      "Sem grafo OSM/PostGIS carregado: restrições viárias (maxheight/maxweight/hgv) são avaliadas só quando as tags chegam pelo chamador.",
      "TODOGREEN_POSTGIS_URL (reservado) + ingestão batch de extracts OSM"),
    {
      id: "elevation",
      name: "Elevação (DEM aberto via Valhalla /height)",
      group: "roteirizacao",
      implementation: IMPLEMENTATION.REAL,
      configured: motores.valhalla.configured,
      authenticated: motores.valhalla.configured,
      online: Boolean(saudePorId.get("valhalla")?.online),
      checkedAt: saudePorId.get("valhalla")?.checkedAt || null,
      lastSuccessAt: saudePorId.get("valhalla")?.lastSuccessAt || null,
      lastFailureAt: saudePorId.get("valhalla")?.lastFailureAt || null,
      detail: motores.valhalla.configured
        ? "Perfil de elevação (ganho/perda) pelo /height do Valhalla, cache local de 30 dias (todogreen_geo_cache). Sem relevo nos tiles, o modelo assume plano e reduz a confiança."
        : "Sem fonte DEM: o modelo de energia assume perfil plano e diz isso (ELEVATION_NOT_AVAILABLE). Configure TDG_VALHALLA_BASE_URL com tiles de relevo (infra/tms-routing).",
      requirement: "TDG_VALHALLA_BASE_URL (tiles com build_elevation)",
      canTest: false,
    },

    // Operação e telemetria
    {
      id: "tms-api",
      name: "TMS · API pública (/api/tms/v1)",
      group: "operacao",
      implementation: IMPLEMENTATION.REAL,
      configured: Boolean(env?.DB),
      authenticated: Boolean(env?.DB),
      online: Boolean(env?.DB),
      checkedAt: env?.DB ? agora : null,
      detail: "Chaves por espaço, escopo e idempotência; electric-plan devolve energyEstimate, routingEngineSelection e preflight.",
      canTest: false,
    },
    track3r && deReadiness(track3r, { group: "operacao", implementation: IMPLEMENTATION.PARTIAL, canTest: false }, agora),
    tracker && deReadiness(tracker, { group: "operacao", implementation: IMPLEMENTATION.PARTIAL, canTest: false }, agora),
    ciot && deReadiness(ciot, { group: "operacao", implementation: IMPLEMENTATION.EXTERNAL, canTest: false }, agora),
    deReadiness(sefazStatus(env), { group: "operacao", implementation: IMPLEMENTATION.EXTERNAL, canTest: false }, agora),

    // Energia e recarga — referências públicas em cache (P4). Sem perfil de
    // energia a ANEEL fica NOT_CONFIGURED e diz o que falta; ONS/ANP não pedem
    // configuração (dados abertos) e o cron as mantém frescas.
    aneel && linhaDeReferencia(aneel, energia?.aneel, saudePorId.get("aneel-open-data"), {
      staleMs: 400 * 24 * 60 * 60 * 1000,
      detalheOk: (f) => `Tarifas homologadas (Tarifa de Aplicação) de ${energia?.perfil?.distribuidora || "—"} ${energia?.perfil?.subgrupo || ""} ${energia?.perfil?.modalidade || ""}: ${f.records} linha(s); fonte gerada em ${f.sourceUpdatedAt || "—"}, ingerida em ${dataCurta(f.lastSuccessAt)}. Alimenta a hierarquia contrato > informada > ANEEL > fallback.`,
      detalheSem: "Sem perfil de energia (distribuidora/subgrupo/modalidade) a tarifa de referência não é buscada: o custo usa contrato > informada > fallback declarado.",
    }),
    ons && linhaDeReferencia(ons, energia?.ons, saudePorId.get("ons-open-data"), {
      staleMs: ENERGY_LIMITS.onsFrescorMs,
      detalheOk: (f) => `Curva de carga horária do SIN (subsistema ${energia?.perfil?.subsistemaOns || "SE"}): ${f.records} leituras; último instante da fonte ${f.sourceUpdatedAt || "—"}, ingerida em ${dataCurta(f.lastSuccessAt)}. Dá a janela ENERGÉTICA de recarga (proxy de sistema leve, não medição de carbono).`,
      detalheSem: "Sem ingestão do ONS a janela energética fica ONS_NOT_AVAILABLE e a recomendada iguala a financeira — nada de 'hora verde' inventada.",
    }),
    anp && linhaDeReferencia(anp, energia?.anp, saudePorId.get("anp-open-data"), {
      staleMs: ENERGY_LIMITS.anpFrescorMs,
      detalheOk: (f) => `Levantamento semanal de preços (diesel/diesel S10): ${f.records} coletas agregadas por município/UF/região/país; última coleta ${f.sourceUpdatedAt || "—"}, ingerida em ${dataCurta(f.lastSuccessAt)}. Alimenta o TCO pela hierarquia contrato > frota > ANP município > UF > região > país > fallback.`,
      detalheSem: "Sem ingestão da ANP o TCO usa contrato > frota informada > fallback, sem referência municipal/estadual.",
    }),
    clima && {
      ...doCatalogo(clima, saudePorId.get("open-meteo"), {
        group: "energia",
        implementation: IMPLEMENTATION.REAL,
        detail: "Temperatura na hora de saída para o modelo de energia (Open-Meteo, licença aberta), cache local de 1 h. Sem dado → WEATHER_NOT_AVAILABLE e confiança reduzida — nunca temperatura inventada.",
      }),
    },
    ocm && {
      ...doCatalogo(ocm, saudePorId.get("open-charge-map"), {
        group: "energia",
        implementation: IMPLEMENTATION.REAL,
        detail: `${texto(ocm.detail, 200)} Descoberta pública (PUBLIC_DISCOVERY): não é disponibilidade em tempo real.`,
      }),
    },
    deReadiness(ocppStatus(), { group: "energia", implementation: IMPLEMENTATION.PREPARED, canTest: false }, agora),

    // Pagamentos
    {
      id: "greenpay",
      name: "GreenPay (razão interno)",
      group: "pagamentos",
      implementation: IMPLEMENTATION.REAL,
      configured: Boolean(env?.DB),
      authenticated: Boolean(env?.DB),
      online: Boolean(env?.DB),
      checkedAt: env?.DB ? agora : null,
      detail: "Ganho derivado da entrega; ciclo pendente → aprovado → pago no ledger interno.",
      canTest: false,
    },
    {
      id: "syspag",
      name: "SysPag (repasse PIX)",
      group: "pagamentos",
      implementation: IMPLEMENTATION.EXTERNAL,
      configured: Boolean(env?.SYSPAG_API_TOKEN),
      authenticated: Boolean(env?.SYSPAG_API_TOKEN),
      online: false,
      checkedAt: saudePorId.get("syspag")?.checkedAt || null,
      lastSuccessAt: saudePorId.get("syspag")?.lastSuccessAt || null,
      lastFailureAt: saudePorId.get("syspag")?.lastFailureAt || null,
      error: saudePorId.get("syspag")?.error || "",
      detail: env?.SYSPAG_API_TOKEN
        ? "Segredo presente: o lote só é marcado como pago se o provedor confirmar o repasse."
        : "Dormente (sem SYSPAG_API_TOKEN): 'pago' é apenas o razão interno; nenhum dinheiro sai por aqui.",
      requirement: "SYSPAG_API_TOKEN",
      canTest: false,
    },

    // Mercado e licitações
    {
      id: "pncp",
      name: "PNCP (licitações)",
      group: "mercado",
      implementation: IMPLEMENTATION.PARTIAL,
      configured: Boolean(busca.configured),
      authenticated: Boolean(busca.configured),
      online: false,
      fallbackActive: true,
      detail: "Coberto pela busca web (site:pncp.gov.br) — a API estruturada do PNCP (processo, órgão, itens, prazos) ainda não está ligada.",
      requirement: "Adaptador da API pública do PNCP + dedupe por fingerprint",
      canTest: false,
    },
    naoImplementada("compras-gov", "Compras.gov.br", "mercado",
      "Sem adaptador: oportunidades públicas federais só chegam pela busca web.",
      "API pública Compras.gov + normalização junto ao PNCP"),
    naoImplementada("gdelt", "GDELT (sinais de mercado)", "mercado",
      "Sem ingestão: nenhum market_signal é gerado a partir de notícias globais.",
      "GDELT DOC 2.0 API + entidade market_signal com score explicável"),

    // Risco viário
    antt && {
      ...doCatalogo(antt, saudePorId.get("antt-open-data"), {
        group: "risco",
        implementation: IMPLEMENTATION.REAL,
        detail: `${texto(antt.detail, 200)} Ingestão histórica de acidentes para o Risk Map ainda não implementada.`,
      }),
    },
    naoImplementada("prf", "PRF (acidentes)", "risco",
      "Sem ingestão dos dados abertos da PRF: o risco por segmento não é calculado; rotas não recebem custo de risco.",
      "Dados abertos PRF + índice geográfico local"),
  ].filter(Boolean);

  return montarRelatorioDeSaude({
    version: {
      environmentOverride: env?.TDG_ENVIRONMENT || "",
      serverSha: versao.sha,
      clientSha,
      branch: versao.branch,
      ci: manifesto?.ci || "",
      buildTime: versao.buildTime,
      publishedBy: versao.publishedBy,
      expectedMigrations: esperadas,
      appliedMigrations: banco.appliedMigrations,
      expectedLastMigration: manifesto?.migrations?.last || "",
      appliedLastMigration: banco.appliedLastMigration || "",
    },
    components,
    integrations,
  });
}

export async function handleTodoGreenSystemHealth(request, env, access, url) {
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
  // Leitura administrativa: quem gerencia integrações ou audita. A tela só
  // esconde o botão; a permissão é conferida AQUI.
  if (!podeNaVertical(access, "integration:manage") && !podeNaVertical(access, "audit:read"))
    return json({ error: "Seu papel não pode ver a saúde do sistema." }, 403);
  const relatorio = await coletarSaudeDoSistema(env, {
    access,
    origin: url.origin,
    clientSha: texto(url.searchParams.get("client") || "", 64),
  });
  return json(relatorio);
}
