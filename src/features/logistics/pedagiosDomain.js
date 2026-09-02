// #94 (versão gratuita): praças de pedágio da rota a partir dos dados abertos
// da ANTT (dataset "Praça de Pedágio": coordenada, rodovia, concessionária,
// situação). A ANTT NÃO publica a tarifa por eixo num dataset — só a
// localização — então aqui trazemos QUAIS e QUANTAS praças a rota cruza (isso
// é preciso e gratuito) e deixamos o total como estimativa que o usuário
// controla, informando a tarifa média por praça do seu caminhão. Nada de
// tarifa inventada: número errado num orçamento de frete é pior do que não ter.
//
// Cobertura: só concessões FEDERAIS (BR-xxx). Pedágios de concessão estadual
// (ex.: muitas rodovias SP da ARTESP) não estão nos dados abertos da ANTT.

const num = (valor) => {
  const bruto = String(valor ?? "").trim().replace(",", ".");
  if (!bruto) return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
};

const texto = (valor, max = 200) => String(valor ?? "").trim().slice(0, max);

// Haversine em km — mesma conta usada para ordenar paradas na roteirização.
export function kmEntrePontos([lat1, lon1], [lat2, lon2]) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Normaliza o dataset da ANTT (aceita o objeto {"praca-de-pedagio":[...]} ou a
// lista direta) para praças ATIVAS com coordenada válida.
export function normalizarPracas(bruto) {
  const lista = Array.isArray(bruto)
    ? bruto
    : Array.isArray(bruto?.["praca-de-pedagio"])
      ? bruto["praca-de-pedagio"]
      : [];
  const pracas = [];
  for (const linha of lista) {
    const situacao = texto(linha?.situacao, 40).toLowerCase();
    if (situacao && situacao !== "ativo") continue;
    const lat = num(linha?.latitude);
    const lon = num(linha?.longitude);
    if (lat === null || lon === null) continue;
    if (lat < -34 || lat > 6 || lon < -75 || lon > -32) continue; // fora do Brasil
    pracas.push({
      praca: texto(linha?.praca_de_pedagio || linha?.praca, 160),
      concessionaria: texto(linha?.concessionaria, 160),
      rodovia: texto(linha?.rodovia, 40),
      uf: texto(linha?.uf, 2).toUpperCase(),
      km: texto(linha?.km_m || linha?.km, 20),
      municipio: texto(linha?.municipio, 120),
      lat,
      lon,
    });
  }
  return pracas;
}

// Distância (km) de um ponto ao vértice mais próximo da polyline, com o índice
// desse vértice — o índice serve para ordenar as praças na ordem da viagem.
function maisProximaDaLinha(lat, lon, polyline) {
  let melhor = Infinity;
  let indice = -1;
  for (let i = 0; i < polyline.length; i += 1) {
    const par = polyline[i];
    if (!Array.isArray(par) || par.length < 2) continue;
    const d = kmEntrePontos([lat, lon], [Number(par[0]), Number(par[1])]);
    if (d < melhor) {
      melhor = d;
      indice = i;
    }
  }
  return { distancia: melhor, indice };
}

// Praças a até `raioKm` da rota (polyline [[lat,lon],...]). Deduplica por
// praça+rodovia e devolve na ordem da viagem (do começo ao fim da linha).
export function pracasNaRota(pracas, polyline, raioKm = 1.5) {
  const linha = Array.isArray(polyline) ? polyline : [];
  if (linha.length < 2) return [];
  const vistos = new Set();
  const achadas = [];
  for (const praca of Array.isArray(pracas) ? pracas : []) {
    const { distancia, indice } = maisProximaDaLinha(praca.lat, praca.lon, linha);
    if (indice < 0 || distancia > raioKm) continue;
    const chave = `${praca.praca}|${praca.rodovia}|${praca.km}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    achadas.push({ ...praca, distanciaKm: Math.round(distancia * 100) / 100, ordem: indice });
  }
  achadas.sort((a, b) => a.ordem - b.ordem);
  return achadas.map(({ ordem, ...resto }) => resto);
}

// Total ESTIMADO: o usuário informa a tarifa média por praça do seu caminhão.
// Sem tarifa, devolve null (nunca 0 forjado).
export function estimarTotalPedagios(quantidade, tarifaMediaPorPraca) {
  const q = Math.max(0, Math.trunc(Number(quantidade) || 0));
  const t = num(tarifaMediaPorPraca);
  if (t === null || t < 0) return null;
  return Math.round(q * t * 100) / 100;
}
