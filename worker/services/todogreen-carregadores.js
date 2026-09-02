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
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const finite = (valor, fallback = 0) => (Number.isFinite(Number(valor)) ? Number(valor) : fallback);

async function buscarNoOverpass(latitude, longitude, raioMetros, limite) {
  const consulta = `[out:json][timeout:20];node["amenity"="charging_station"](around:${raioMetros},${latitude},${longitude});out ${limite};`;
  let ultimoErro = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort("timeout"), 15_000);
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
    } catch (erro) {
      ultimoErro = erro;
    } finally {
      clearTimeout(timer);
    }
  }
  throw ultimoErro || new Error("Overpass indisponível.");
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
