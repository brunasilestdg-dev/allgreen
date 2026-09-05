import {
  normalizarCarregadores,
  normalizarCarregadoresOSM,
} from "../../src/features/logistics/distanciaRodoviariaDomain.js";
import { runTodoGreenExternalIntegration } from "./todogreen-integration-gateway.js";

// #90 (correção): carregadores elétricos no mapa. O Open Charge Map passou a
// EXIGIR chave (403 sem ela), então a busca deixou de funcionar. Aqui a fonte
// vira o OpenStreetMap (via Overpass, gratuito e sem chave) quando não há chave
// do OCM; com a chave configurada, usa o OCM (dados de potência mais ricos).
// O resultado sai no mesmo formato canônico, então o mapa não sabe a origem.
// Vários espelhos do Overpass: o público (overpass-api.de) vive saturado e
// devolve 429/504; girar entre espelhos é o que mantém a busca de pesos
// funcionando. kumi e a fr são mais folgados. A ordem tenta primeiro os mais
// estáveis para a maioria dos casos cair no primeiro acerto.
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
// A janela do servidor Overpass (timeout:N) tem de ser MENOR que o abort do
// fetch — senão o cliente mata uma resposta lenta porém válida antes de a
// consulta terminar (o bug antigo: fetch 15s < timeout:20s). Agora
// timeout:18s no servidor e 24s no cliente, com folga.
// Os espelhos públicos do Overpass têm disponibilidade irregular: um pode
// pendurar por minutos enquanto outro responde em segundos. O bug antigo era
// tentá-los EM SÉRIE com um abort longo (24s cada) — se o primeiro pendurava, o
// Worker estourava o próprio orçamento de tempo antes de chegar num espelho
// bom, e a tela ficava sem carregadores. Agora a consulta vai para TODOS ao
// mesmo tempo e o primeiro que responder válido vence; timeout curto por
// espelho, e o do servidor Overpass menor que o abort do cliente.
const OVERPASS_QUERY_TIMEOUT = 8;
const FETCH_ABORT_MS = 10_000;
const finite = (valor, fallback = 0) => (Number.isFinite(Number(valor)) ? Number(valor) : fallback);

async function consultarEspelho(endpoint, consulta) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort("timeout"), FETCH_ABORT_MS);
  try {
    const resposta = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: `data=${encodeURIComponent(consulta)}`,
      signal: controlador.signal,
    });
    if (!resposta.ok) throw new Error(`Overpass respondeu HTTP ${resposta.status}`);
    const dados = await resposta.json();
    return Array.isArray(dados?.elements) ? dados.elements : [];
  } finally {
    clearTimeout(timer);
  }
}

async function buscarNoOverpass(latitude, longitude, raioMetros, limite) {
  // `nwr` pega nós e polígonos (estações mapeadas como área); `out center` dá
  // um ponto para cada; `qt` ordena por proximidade e acelera a resposta.
  const consulta = `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT}];nwr["amenity"="charging_station"](around:${raioMetros},${latitude},${longitude});out center ${limite} qt;`;
  try {
    // Corrida: o primeiro espelho a responder com sucesso vence; os demais são
    // abortados pelo próprio timeout. Só falha se TODOS falharem.
    return await Promise.any(OVERPASS_ENDPOINTS.map((endpoint) => consultarEspelho(endpoint, consulta)));
  } catch (erro) {
    const causa = erro?.errors?.[erro.errors.length - 1] || erro;
    throw causa instanceof Error ? causa : new Error("Overpass indisponível.");
  }
}

export async function consultarCarregadores(env, entrada = {}) {
  const latitude = finite(entrada.latitude, null);
  const longitude = finite(entrada.longitude, null);
  if (latitude === null || longitude === null) throw new Error("Latitude e longitude são obrigatórias.");
  const distanceKm = Math.min(200, Math.max(1, finite(entrada.distanceKm, 25)));
  const limite = Math.min(100, Math.max(1, Math.trunc(finite(entrada.limit, 60))));

  // Com chave: Open Charge Map (potência/soquete detalhados). Se falhar, cai
  // para o OSM em vez de deixar a tela sem carregadores.
  if (env.OPENCHARGEMAP_API_KEY) {
    try {
      const bruto = await runTodoGreenExternalIntegration(env, "open-charge-map", "nearby", {
        latitude, longitude, distanceKm, limit: limite,
      });
      return { pontos: normalizarCarregadores(bruto), fonte: "Open Charge Map" };
    } catch {
      /* cai para o OSM abaixo */
    }
  }

  const elementos = await buscarNoOverpass(latitude, longitude, Math.round(distanceKm * 1000), limite);
  return { pontos: normalizarCarregadoresOSM(elementos).slice(0, limite), fonte: "OpenStreetMap" };
}
