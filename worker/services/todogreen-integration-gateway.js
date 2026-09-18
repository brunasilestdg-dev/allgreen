import { urlCurvaCargaOns, urlPrecosAnp } from "./todogreen-energy-reference.js";
import { urlBuscaPncp, urlContratacoesComprasGov, urlGdelt } from "./todogreen-market-signals.js";
import { urlPacoteAntt } from "./todogreen-road-risk.js";

const DEFAULT_TIMEOUT_MS = 7_000;

const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const digits = (value) => String(value ?? "").replace(/\D/g, "");
const finite = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const configuredUrl = (value) => {
  const raw = text(value, 2_000);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol)
      ? parsed.toString().replace(/\/$/, "")
      : "";
  } catch {
    return "";
  }
};

const withTimeout = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const jsonFrom = async (url, options = {}, label = "Integração") => {
  const startedAt = Date.now();
  const response = await withTimeout(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || data?.error || data?.detail || `${label} respondeu HTTP ${response.status}`;
    throw new Error(text(message, 220));
  }
  return { data, latencyMs: Date.now() - startedAt, status: response.status };
};

const probeUrl = async (url, options = {}, label = "Integração") => {
  const startedAt = Date.now();
  const response = await withTimeout(url, options);
  if (!response.ok) throw new Error(`${label} respondeu HTTP ${response.status}`);
  return { ok: true, latencyMs: Date.now() - startedAt, status: response.status };
};

const item = ({
  id,
  name,
  category,
  mode,
  configured = true,
  canTest = true,
  detail,
  requirement = "",
  capabilities = [],
}) => ({
  id,
  name,
  category,
  mode,
  configured,
  canTest,
  detail,
  requirement,
  capabilities,
  status: configured ? "configured" : "requires_setup",
});

const selfHosted = (env, { id, name, category, envKey, tokenKey = "", detail, capabilities = [] }) => {
  const baseUrl = configuredUrl(env?.[envKey]);
  const tokenOk = !tokenKey || Boolean(env?.[tokenKey]);
  const configured = Boolean(baseUrl && tokenOk);
  return item({
    id,
    name,
    category,
    mode: "self-hosted",
    configured,
    detail: configured
      ? `Servidor próprio configurado em ${new URL(baseUrl).host}.`
      : baseUrl
        ? `Servidor cadastrado; falta a credencial ${tokenKey}.`
        : `${detail} Configure ${envKey} para ativar.`,
    requirement: tokenKey ? `${envKey} + ${tokenKey}` : envKey,
    capabilities,
  });
};

export function todoGreenExternalIntegrationCatalog(env = {}) {
  return {
    registration: [
      item({
        id: "opencep",
        name: "OpenCEP",
        category: "registration",
        mode: "public-free",
        detail: "Consulta de CEP pelo backend, sem expor chamadas no navegador.",
        capabilities: ["cep"],
      }),
      item({
        id: "viacep",
        name: "ViaCEP",
        category: "registration",
        mode: "public-free",
        detail: "Fallback gratuito para consulta de CEP.",
        capabilities: ["cep"],
      }),
      item({
        id: "brasilapi",
        name: "BrasilAPI",
        category: "registration",
        mode: "public-free",
        detail: "Enriquecimento de CEP, CNPJ, bancos e feriados.",
        capabilities: ["cep", "cnpj", "banks", "holidays"],
      }),
      item({
        id: "ibge",
        name: "IBGE",
        category: "registration",
        mode: "official-public",
        detail: "Estados, municípios e códigos oficiais para cadastros e cobertura.",
        capabilities: ["states", "municipalities"],
      }),
    ],
    intelligence: [
      item({
        id: "open-meteo",
        name: "Open-Meteo",
        category: "intelligence",
        mode: "public-free",
        detail: "Clima operacional por latitude e longitude.",
        capabilities: ["forecast"],
      }),
      item({
        id: "bcb",
        name: "Banco Central",
        category: "intelligence",
        mode: "official-public",
        detail: "Séries econômicas para pricing e financeiro.",
        capabilities: ["series"],
      }),
      item({
        id: "antt-open-data",
        name: "ANTT Dados Abertos",
        category: "intelligence",
        mode: "official-public",
        detail: "Pesquisa de datasets de transporte e RNTRC.",
        capabilities: ["search"],
      }),
      item({
        id: "aneel-open-data",
        name: "ANEEL Dados Abertos",
        category: "intelligence",
        mode: "official-public",
        detail: "Tarifas homologadas (Tarifa de Aplicação) por distribuidora/subgrupo/modalidade — cache tarifário operacional — e pesquisa de datasets.",
        capabilities: ["search", "tariffs"],
      }),
      item({
        id: "ons-open-data",
        name: "ONS Dados Abertos (curva de carga)",
        category: "intelligence",
        mode: "official-public",
        detail: "Curva de carga horária do SIN por subsistema — perfil médio das 24 h para a janela energética de recarga.",
        capabilities: ["load-curve"],
      }),
      item({
        id: "anp-open-data",
        name: "ANP Dados Abertos (preços de combustíveis)",
        category: "intelligence",
        mode: "official-public",
        detail: "Levantamento semanal de preços por revenda, agregado em mediana por município/UF/região/país para o TCO.",
        capabilities: ["fuel-prices"],
      }),
      item({
        id: "pncp",
        name: "PNCP (API pública de licitações)",
        category: "intelligence",
        mode: "official-public",
        detail: "Editais recebendo proposta por termos de transporte/logística → sinais de mercado com score explicável.",
        capabilities: ["search"],
      }),
      item({
        id: "compras-gov",
        name: "Compras.gov.br (dados abertos)",
        category: "intelligence",
        mode: "official-public",
        detail: "Contratações da Lei 14.133 publicadas no PNCP (pregão/concorrência), normalizadas junto ao PNCP.",
        capabilities: ["contracts"],
      }),
      item({
        id: "gdelt",
        name: "GDELT (notícias do setor)",
        category: "intelligence",
        mode: "official-public",
        detail: "Notícias em fontes brasileiras sobre frota elétrica e transporte de cargas (DOC 2.0; 1 consulta a cada 5 s).",
        capabilities: ["news"],
      }),
      item({
        id: "open-charge-map",
        name: "Open Charge Map",
        category: "intelligence",
        mode: "credentialed-public",
        configured: Boolean(env.OPENCHARGEMAP_API_KEY),
        detail: env.OPENCHARGEMAP_API_KEY
          ? "Chave configurada para consulta de pontos de recarga."
          : "Conector pronto; falta OPENCHARGEMAP_API_KEY.",
        requirement: "OPENCHARGEMAP_API_KEY",
        capabilities: ["nearby"],
      }),
    ],
    routing: [
      item({
        id: "geoapify",
        name: "Geoapify Cloud",
        category: "routing",
        mode: "credentialed-public",
        configured: Boolean(env.GEOAPIFY_API_KEY),
        detail: env.GEOAPIFY_API_KEY
          ? "Cloud routing configurado no Worker: geocodificação e rotas para leves e pesados."
          : "Conector cloud pronto; falta GEOAPIFY_API_KEY no cofre do Worker.",
        requirement: "GEOAPIFY_API_KEY",
        capabilities: ["search", "route", "truck-routing"],
      }),
      selfHosted(env, {
        id: "osrm",
        name: "OSRM",
        category: "routing",
        envKey: "TODOGREEN_OSRM_BASE_URL",
        detail: "Roteamento rodoviário próprio, sem custo por chamada.",
        capabilities: ["route", "table"],
      }),
      selfHosted(env, {
        id: "nominatim",
        name: "Nominatim próprio",
        category: "routing",
        envKey: "TODOGREEN_NOMINATIM_BASE_URL",
        detail: "Geocodificação própria para endereços e coordenadas.",
        capabilities: ["search", "reverse"],
      }),
      selfHosted(env, {
        id: "vroom",
        name: "VROOM",
        category: "routing",
        envKey: "TODOGREEN_VROOM_BASE_URL",
        detail: "Otimização de sequência de entregas, capacidade e janelas.",
        capabilities: ["optimize"],
      }),
      // Pesados (VUC, truck, carreta) e veículos com restrição física roteiam
      // por truck costing. Sem ele, o backend responde NO_SAFE_ROUTING_ENGINE
      // em vez de um perfil de carro (seção 33).
      selfHosted(env, {
        id: "valhalla",
        name: "Valhalla (pesados / restrições viárias)",
        category: "routing",
        envKey: "TDG_VALHALLA_BASE_URL",
        detail: "Rota para pesados com altura, largura, comprimento, peso e eixos (truck costing); elevação via /height quando os tiles têm relevo.",
        capabilities: ["route", "height", "status"],
      }),
    ],
    localAi: [
      selfHosted(env, {
        id: "ollama",
        name: "Ollama",
        category: "localAi",
        envKey: "TODOGREEN_OLLAMA_BASE_URL",
        detail: "IA local para classificação, resumo e automações.",
        capabilities: ["chat"],
      }),
      selfHosted(env, {
        id: "vllm",
        name: "vLLM",
        category: "localAi",
        envKey: "TODOGREEN_VLLM_BASE_URL",
        tokenKey: "TODOGREEN_VLLM_API_KEY",
        detail: "Servidor OpenAI-compatible para IA local de maior escala.",
        capabilities: ["chat"],
      }),
    ],
  };
}

const flatCatalog = (env) => Object.values(todoGreenExternalIntegrationCatalog(env)).flat();
const connectorById = (env, id) => flatCatalog(env).find((connector) => connector.id === id) || null;

const selfHostedBase = (env, id) => {
  const map = {
    osrm: "TODOGREEN_OSRM_BASE_URL",
    nominatim: "TODOGREEN_NOMINATIM_BASE_URL",
    vroom: "TODOGREEN_VROOM_BASE_URL",
    valhalla: "TDG_VALHALLA_BASE_URL",
    ollama: "TODOGREEN_OLLAMA_BASE_URL",
    vllm: "TODOGREEN_VLLM_BASE_URL",
  };
  return configuredUrl(env?.[map[id]]);
};

export async function probeTodoGreenExternalIntegration(env = {}, provider) {
  const id = text(provider, 80);
  const connector = connectorById(env, id);
  if (!connector) throw new Error("Integração desconhecida.");
  if (!connector.configured) {
    return {
      provider: id,
      ok: false,
      configured: false,
      skipped: true,
      detail: connector.detail,
    };
  }

  let result;
  switch (id) {
    case "opencep":
      result = await jsonFrom("https://opencep.com/v1/01001000", {}, "OpenCEP");
      break;
    case "viacep":
      result = await jsonFrom("https://viacep.com.br/ws/01001000/json/", {}, "ViaCEP");
      break;
    case "brasilapi":
      result = await jsonFrom("https://brasilapi.com.br/api/cep/v2/01001000", {}, "BrasilAPI");
      break;
    case "ibge":
      result = await jsonFrom("https://servicodados.ibge.gov.br/api/v1/localidades/estados/SP", {}, "IBGE");
      break;
    case "open-meteo":
      result = await jsonFrom(
        "https://api.open-meteo.com/v1/forecast?latitude=-23.5505&longitude=-46.6333&current=temperature_2m",
        {},
        "Open-Meteo",
      );
      break;
    case "bcb":
      result = await jsonFrom(
        "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1178/dados/ultimos/1?formato=json",
        {},
        "Banco Central",
      );
      break;
    case "aneel-open-data":
      result = await jsonFrom(
        "https://dadosabertos.aneel.gov.br/api/3/action/package_search?q=tarifa&rows=1",
        {},
        "ANEEL",
      );
      break;
    // ONS/ANP publicam arquivos (CSV): o teste pede só os primeiros bytes.
    case "ons-open-data":
      result = await probeUrl(urlCurvaCargaOns(env, new Date().getUTCFullYear()), { headers: { range: "bytes=0-255" } }, "ONS");
      break;
    case "anp-open-data":
      result = await probeUrl(urlPrecosAnp(env), { headers: { range: "bytes=0-255" } }, "ANP");
      break;
    case "pncp":
      result = await jsonFrom(urlBuscaPncp(env, "transporte", { tamanho: 10 }), {}, "PNCP");
      break;
    case "compras-gov": {
      const hoje = new Date().toISOString().slice(0, 10);
      result = await jsonFrom(urlContratacoesComprasGov(env, { inicio: hoje, fim: hoje, modalidade: 5, tamanho: 10 }), {}, "Compras.gov.br");
      break;
    }
    case "gdelt":
      result = await jsonFrom(urlGdelt(env, '"frota elétrica"', { maxrecords: 5, timespan: "1d" }), {}, "GDELT");
      break;
    case "antt-open-data":
      result = await jsonFrom(urlPacoteAntt(env), {}, "ANTT");
      break;
    case "open-charge-map":
      result = await jsonFrom(
        `https://api.openchargemap.io/v3/poi/?output=json&maxresults=1&countrycode=BR&key=${encodeURIComponent(env.OPENCHARGEMAP_API_KEY)}`,
        {},
        "Open Charge Map",
      );
      break;
    case "geoapify":
      result = await jsonFrom(
        `https://api.geoapify.com/v1/geocode/search?text=Avenida%20Paulista%201000%2C%20Sao%20Paulo%20SP&format=json&limit=1&filter=countrycode%3Abr&apiKey=${encodeURIComponent(env.GEOAPIFY_API_KEY)}`,
        {},
        "Geoapify",
      );
      if (!Array.isArray(result?.data?.results) || !result.data.results.length)
        throw new Error("Geoapify respondeu sem resultados.");
      break;
    case "osrm": {
      const base = selfHostedBase(env, id);
      result = await jsonFrom(
        `${base}/route/v1/driving/-46.6333,-23.5505;-46.6500,-23.5600?overview=false`,
        {},
        "OSRM",
      );
      break;
    }
    case "nominatim": {
      const base = selfHostedBase(env, id);
      result = await jsonFrom(
        `${base}/search?format=json&limit=1&countrycodes=br&q=Sao%20Paulo%20SP`,
        { headers: { "user-agent": "ToDoGreenERP/1.0" } },
        "Nominatim",
      );
      break;
    }
    case "vroom": {
      const base = selfHostedBase(env, id);
      result = await probeUrl(base, {}, "VROOM");
      break;
    }
    case "valhalla": {
      const base = selfHostedBase(env, id);
      result = await jsonFrom(`${base}/status`, {}, "Valhalla");
      break;
    }
    case "ollama": {
      const base = selfHostedBase(env, id);
      result = await jsonFrom(`${base}/api/tags`, {}, "Ollama");
      break;
    }
    case "vllm": {
      const base = selfHostedBase(env, id);
      result = await jsonFrom(
        `${base}/v1/models`,
        { headers: { authorization: `Bearer ${env.TODOGREEN_VLLM_API_KEY}` } },
        "vLLM",
      );
      break;
    }
    default:
      throw new Error("Integração sem teste implementado.");
  }

  return {
    provider: id,
    ok: true,
    configured: true,
    latencyMs: result?.latencyMs ?? 0,
    status: result?.status || 200,
  };
}

const requireAction = (action, allowed) => {
  if (!allowed.includes(action)) throw new Error(`Ação inválida. Use: ${allowed.join(", ")}.`);
};

const requireCep = (value) => {
  const cep = digits(value);
  if (cep.length !== 8) throw new Error("CEP inválido.");
  return cep;
};

const requireCnpj = (value) => {
  const cnpj = digits(value);
  if (cnpj.length !== 14) throw new Error("CNPJ inválido.");
  return cnpj;
};

export async function runTodoGreenExternalIntegration(env = {}, provider, action, input = {}) {
  const id = text(provider, 80);
  const op = text(action, 80);
  const connector = connectorById(env, id);
  if (!connector) throw new Error("Integração desconhecida.");
  if (!connector.configured) throw new Error(connector.detail || "Integração não configurada.");

  if (id === "opencep" || id === "viacep") {
    requireAction(op, ["cep"]);
    const cep = requireCep(input.cep);
    const url = id === "opencep"
      ? `https://opencep.com/v1/${cep}`
      : `https://viacep.com.br/ws/${cep}/json/`;
    return (await jsonFrom(url, {}, id === "opencep" ? "OpenCEP" : "ViaCEP")).data;
  }

  if (id === "brasilapi") {
    requireAction(op, ["cep", "cnpj", "banks", "holidays"]);
    if (op === "cep") {
      const cep = requireCep(input.cep);
      return (await jsonFrom(`https://brasilapi.com.br/api/cep/v2/${cep}`, {}, "BrasilAPI")).data;
    }
    if (op === "cnpj") {
      const cnpj = requireCnpj(input.cnpj);
      return (await jsonFrom(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {}, "BrasilAPI")).data;
    }
    if (op === "banks") return (await jsonFrom("https://brasilapi.com.br/api/banks/v1", {}, "BrasilAPI")).data;
    const year = Math.min(2100, Math.max(2000, Math.trunc(finite(input.year, new Date().getFullYear()))));
    return (await jsonFrom(`https://brasilapi.com.br/api/feriados/v1/${year}`, {}, "BrasilAPI")).data;
  }

  if (id === "ibge") {
    requireAction(op, ["states", "municipalities"]);
    if (op === "states") {
      return (await jsonFrom("https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome", {}, "IBGE")).data;
    }
    const uf = text(input.uf, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf)) throw new Error("UF inválida.");
    return (
      await jsonFrom(
        `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`,
        {},
        "IBGE",
      )
    ).data;
  }

  if (id === "open-meteo") {
    requireAction(op, ["forecast"]);
    const latitude = finite(input.latitude);
    const longitude = finite(input.longitude);
    if (latitude === null || latitude < -90 || latitude > 90) throw new Error("Latitude inválida.");
    if (longitude === null || longitude < -180 || longitude > 180) throw new Error("Longitude inválida.");
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: "temperature_2m,precipitation,rain,wind_speed_10m,weather_code",
      hourly: "temperature_2m,precipitation_probability,precipitation,rain,wind_speed_10m",
      timezone: text(input.timezone, 80) || "America/Sao_Paulo",
      forecast_days: String(Math.min(7, Math.max(1, Math.trunc(finite(input.days, 2))))),
    });
    return (await jsonFrom(`https://api.open-meteo.com/v1/forecast?${params}`, {}, "Open-Meteo")).data;
  }

  if (id === "bcb") {
    requireAction(op, ["series"]);
    const series = Math.max(1, Math.trunc(finite(input.series, 1178)));
    const limit = Math.min(100, Math.max(1, Math.trunc(finite(input.limit, 10))));
    return (
      await jsonFrom(
        `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados/ultimos/${limit}?formato=json`,
        {},
        "Banco Central",
      )
    ).data;
  }

  if (id === "antt-open-data" || id === "aneel-open-data") {
    requireAction(op, ["search"]);
    const q = text(input.q, 160);
    if (q.length < 2) throw new Error("Informe ao menos 2 caracteres.");
    const base = id === "aneel-open-data" ? "https://dadosabertos.aneel.gov.br" : "https://dados.antt.gov.br";
    const rows = Math.min(50, Math.max(1, Math.trunc(finite(input.limit, 10))));
    return (
      await jsonFrom(
        `${base}/api/3/action/package_search?q=${encodeURIComponent(q)}&rows=${rows}`,
        {},
        connector.name,
      )
    ).data;
  }

  if (id === "open-charge-map") {
    requireAction(op, ["nearby"]);
    const latitude = finite(input.latitude);
    const longitude = finite(input.longitude);
    if (latitude === null || longitude === null) throw new Error("Latitude e longitude são obrigatórias.");
    const distance = Math.min(200, Math.max(1, finite(input.distanceKm, 25)));
    const maxresults = Math.min(100, Math.max(1, Math.trunc(finite(input.limit, 20))));
    const params = new URLSearchParams({
      output: "json",
      latitude: String(latitude),
      longitude: String(longitude),
      distance: String(distance),
      distanceunit: "KM",
      maxresults: String(maxresults),
      countrycode: "BR",
      compact: "true",
      verbose: "false",
      key: env.OPENCHARGEMAP_API_KEY,
    });
    return (await jsonFrom(`https://api.openchargemap.io/v3/poi/?${params}`, {}, "Open Charge Map")).data;
  }

  if (id === "nominatim") {
    requireAction(op, ["search", "reverse"]);
    const base = selfHostedBase(env, id);
    if (op === "search") {
      const q = text(input.q, 300);
      if (q.length < 3) throw new Error("Endereço curto demais.");
      const params = new URLSearchParams({
        format: "json",
        limit: String(Math.min(10, Math.max(1, Math.trunc(finite(input.limit, 5))))),
        countrycodes: text(input.countrycodes, 20) || "br",
        q,
      });
      return (
        await jsonFrom(
          `${base}/search?${params}`,
          { headers: { "user-agent": "ToDoGreenERP/1.0" } },
          "Nominatim",
        )
      ).data;
    }
    const latitude = finite(input.latitude);
    const longitude = finite(input.longitude);
    if (latitude === null || longitude === null) throw new Error("Latitude e longitude são obrigatórias.");
    return (
      await jsonFrom(
        `${base}/reverse?format=json&lat=${latitude}&lon=${longitude}`,
        { headers: { "user-agent": "ToDoGreenERP/1.0" } },
        "Nominatim",
      )
    ).data;
  }

  if (id === "osrm") {
    requireAction(op, ["route", "table"]);
    const base = selfHostedBase(env, id);
    const points = Array.isArray(input.points) ? input.points.slice(0, 100) : [];
    if (points.length < 2) throw new Error("Informe ao menos dois pontos.");
    const coords = points.map((point) => {
      const latitude = finite(point?.latitude);
      const longitude = finite(point?.longitude);
      if (latitude === null || longitude === null) throw new Error("Coordenada inválida.");
      return `${longitude},${latitude}`;
    }).join(";");
    const endpoint = op === "table" ? "table" : "route";
    const suffix = op === "route" ? "?overview=false&steps=false" : "?annotations=distance,duration";
    return (await jsonFrom(`${base}/${endpoint}/v1/driving/${coords}${suffix}`, {}, "OSRM")).data;
  }

  if (id === "vroom") {
    requireAction(op, ["optimize"]);
    const base = selfHostedBase(env, id);
    const payload = input?.payload && typeof input.payload === "object" ? input.payload : input;
    return (
      await jsonFrom(
        base,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
        "VROOM",
      )
    ).data;
  }

  if (id === "ollama") {
    requireAction(op, ["chat"]);
    const base = selfHostedBase(env, id);
    const model = text(input.model, 120);
    if (!model) throw new Error("Modelo Ollama obrigatório.");
    const messages = Array.isArray(input.messages) ? input.messages.slice(0, 100) : [];
    return (
      await jsonFrom(
        `${base}/api/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, messages, stream: false }),
        },
        "Ollama",
      )
    ).data;
  }

  if (id === "vllm") {
    requireAction(op, ["chat"]);
    const base = selfHostedBase(env, id);
    const model = text(input.model, 160);
    if (!model) throw new Error("Modelo vLLM obrigatório.");
    const messages = Array.isArray(input.messages) ? input.messages.slice(0, 100) : [];
    return (
      await jsonFrom(
        `${base}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${env.TODOGREEN_VLLM_API_KEY}`,
          },
          body: JSON.stringify({ model, messages, temperature: finite(input.temperature, 0.2) }),
        },
        "vLLM",
      )
    ).data;
  }

  throw new Error("Integração sem ação de negócio implementada.");
}

// ===== CEP normalizado (autofill de endereço nos cadastros) =====
// Cada provedor devolve um formato diferente; aqui reduzimos a um só e caímos
// de OpenCEP para ViaCEP para BrasilAPI quando um não responde. Sem chave: são
// APIs públicas gratuitas, já `configured: true` no catálogo.
export function normalizarEnderecoCep(dados, cep) {
  if (!dados || dados.erro) return null;
  const logradouro = text(dados.logradouro || dados.street || "", 200);
  const bairro = text(dados.bairro || dados.neighborhood || "", 120);
  const cidade = text(dados.localidade || dados.city || "", 120);
  const uf = text(dados.uf || dados.state || "", 2).toUpperCase();
  if (!logradouro && !cidade && !uf) return null;
  return { cep, logradouro, bairro, cidade, uf };
}

export async function consultarCepNormalizado(env, cepBruto) {
  const cep = requireCep(cepBruto);
  let ultimoErro = null;
  for (const provider of ["opencep", "viacep", "brasilapi"]) {
    try {
      const dados = await runTodoGreenExternalIntegration(env, provider, "cep", { cep });
      const endereco = normalizarEnderecoCep(dados, cep);
      if (endereco) return endereco;
    } catch (erro) {
      ultimoErro = erro;
    }
  }
  if (ultimoErro) throw ultimoErro;
  throw new Error("CEP não encontrado.");
}
