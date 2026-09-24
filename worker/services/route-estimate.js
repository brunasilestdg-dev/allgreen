// ===== Estimativa de tempo e distância do Roteirizador (app geral) =====
//
// O Roteirizador das Ferramentas calculava o tempo no NAVEGADOR com o Nominatim
// público (endereço → coordenada) e o servidor de demonstração do OSRM. As duas
// políticas proíbem esse uso: o Nominatim veda autocompletar/uso por aplicação
// cuja função é geocodificar e exige instância própria para app de rastreio
// (operations.osmfoundation.org/policies/nominatim/); o OSRM demo é só para
// "reasonable, non-commercial use-cases" (wiki do projeto).
//
// Aqui o cálculo passa pelo servidor e usa só o Geoapify — o plano gratuito
// permite uso comercial ("You can use the Free plan for commercial websites,
// apps, and business projects, including in production", geoapify.com/pricing)
// — com a chave no cofre, nunca no navegador. Sem a chave, a resposta diz que
// o tempo aparece ao abrir a rota no Maps: nada de cair num serviço público
// que proíbe este uso.

import { json } from "../lib/http.js";
import { geocodificarGeoapify, rotearGeoapify } from "./geoapify-provider.js";

const MAX_PARADAS = 12;
export const ATRIBUICAO_ROTA = "Rota: Geoapify · © colaboradores do OpenStreetMap";

const texto = (valor, max = 300) => String(valor ?? "").trim().slice(0, max);

export async function handleRouteEstimate(request, env, { fetcher = fetch } = {}) {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return json({ error: "Envio inválido." }, 400);
  }
  const paradas = (Array.isArray(corpo?.stops) ? corpo.stops : [])
    .map((parada) => texto(parada, 300))
    .filter(Boolean);
  if (paradas.length < 2) return json({ error: "Informe ao menos origem e destino." }, 400);
  if (paradas.length > MAX_PARADAS)
    return json({ error: `Use no máximo ${MAX_PARADAS} paradas.` }, 400);
  if (!texto(env?.GEOAPIFY_API_KEY))
    return json(
      {
        error: "Tempo e distância aparecem ao abrir a rota no Maps.",
        semProvedor: true,
      },
      503,
    );
  try {
    const coordenadas = [];
    for (const parada of paradas) {
      const achado = await geocodificarGeoapify(parada, env, { limit: 1, fetcher });
      const primeiro = achado?.items?.[0];
      if (!primeiro)
        return json({ error: `Endereço não encontrado: ${parada.slice(0, 40)}` }, 422);
      coordenadas.push([Number(primeiro.lon), Number(primeiro.lat)]);
    }
    const rota = await rotearGeoapify({ coordinates: coordenadas, geometry: false }, env, { fetcher });
    const principal = rota?.routes?.[0];
    if (!principal) return json({ error: "Não foi possível traçar a rota." }, 422);
    return json({
      distanceMeters: principal.distance,
      durationSeconds: principal.duration,
      attribution: ATRIBUICAO_ROTA,
    });
  } catch (erro) {
    console.error("Route estimate error", erro);
    return json({ error: "Não foi possível calcular agora. Abra a rota no Maps." }, 502);
  }
}
