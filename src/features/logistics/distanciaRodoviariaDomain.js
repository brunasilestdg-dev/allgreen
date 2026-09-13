// ===== Distância rodoviária real, sem chave e sem custo =====
//
// A calculadora pede `distanceKm` como campo obrigatório digitado à mão em
// Middle Mile, Last Mile, Transferência e Coleta em fornecedores. Enquanto
// isso, o app já sabe traçar rota: o `RouterModal` usa Nominatim (endereço →
// coordenada) e OSRM (coordenadas → rota). Com sessão autenticada, ambos passam
// pelo gateway próprio; os endpoints públicos ficam apenas como contingência.
//
// Km digitado à mão é a premissa mais frágil da conta inteira: ele multiplica
// custo de combustível, pedágio, tempo de motorista e emissão de CO2. Errar
// 40 km numa operação de 44 viagens/mês erra o preço do contrato.
//
// Duas decisões que este módulo assume:
//
// 1) A DISTÂNCIA VEM COMO SUGESTÃO, NUNCA COMO IMPOSIÇÃO. Quem precifica pode
//    ter motivo para usar outro número — rota que o cliente exige, desvio de
//    restrição de circulação, trecho que a operação faz diferente do que o
//    roteirizador acha. A tela oferece e a pessoa aceita; não sobrescreve o
//    que ela digitou.
//
// 2) FALHA É SILENCIOSA PARA O CÁLCULO, VISÍVEL PARA A PESSOA. Endereço que
//    não geocodifica, serviço fora do ar, rota inexistente — nada disso pode
//    travar a precificação. Devolve o motivo em português e a pessoa segue
//    digitando o km na mão, como fazia antes.
//
// Camada pura no sentido que importa: recebe o `fetch` por parâmetro, então o
// teste exercita a lógica sem tocar a rede.

import { descreverMotor } from "./routingProvidersDomain.js";

const texto = (valor) => String(valor ?? "").trim();

// O OSM pede identificação de quem chama. Sem isso o Nominatim recusa em
// volume, e a recusa vem como 403 sem explicação.
const IDENTIFICACAO = "SeuFuncionario/1.0 (ERP logistico; contato via app)";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const MAPS_GEOCODE = "/api/todogreen/maps/geocode";
const MAPS_ROUTE = "/api/todogreen/maps/route";

const usarGatewayInterno = (headers) =>
  Boolean(headers?.authorization || headers?.Authorization);

async function consultarOSRM(coordenadas, {
  fetcher = fetch,
  sinal,
  headers = {},
  geometria = false,
  veiculo = null,
} = {}) {
  if (usarGatewayInterno(headers)) {
    // O veículo vai junto: é o backend que escolhe OSRM × Valhalla por classe e
    // restrições (seção 32) — a tela nunca fala com um motor.
    return fetcher(MAPS_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
      body: JSON.stringify({ coordinates: coordenadas, geometry: geometria, ...(veiculo ? { vehicle: veiculo } : {}) }),
      signal: sinal,
    });
  }

  const textoCoords = coordenadas.map(([lon, lat]) => `${lon},${lat}`).join(";");
  const params = geometria ? "?overview=full&geometries=geojson" : "?overview=false";
  return fetcher(`${OSRM}/${textoCoords}${params}`, {
    headers: { accept: "application/json" },
    signal: sinal,
  });
}

export const MOTIVOS = Object.freeze({
  incompleto: "Informe origem e destino para calcular a distância.",
  curto: "Endereço curto demais para localizar. Use cidade e estado, por exemplo \"Santos SP\".",
  origemNaoEncontrada: "Não encontrei a origem no mapa. Tente incluir a cidade e o estado.",
  destinoNaoEncontrado: "Não encontrei o destino no mapa. Tente incluir a cidade e o estado.",
  semRota: "Não há rota rodoviária entre esses dois pontos.",
  indisponivel: "O serviço de mapas não respondeu agora. Digite a distância manualmente.",
  semMotorSeguro: "Veículo pesado ou com restrição exige o motor Valhalla; sem ele a rota não é traçada por perfil de carro.",
});

// Rota recusada pelo backend por FALTA DE MOTOR SEGURO (seção 33) não é
// "serviço fora do ar": é uma decisão, e a tela precisa dizer isso.
async function recusaDeMotor(resposta) {
  const erro = await resposta.json().catch(() => null);
  if (erro?.code === "NO_SAFE_ROUTING_ENGINE" || erro?.code === "NO_ROUTING_ENGINE")
    return { ok: false, motivo: texto(erro.message) || MOTIVOS.semMotorSeguro, codigo: erro.code, motorNecessario: texto(erro.requiredEngine) };
  return null;
}

const fonteDaRota = (dados) =>
  `OpenStreetMap · Nominatim + ${descreverMotor(dados) || "OSRM"} (sem trânsito ao vivo)`;

/**
 * Endereço → coordenada. Devolve `null` quando não acha, nunca lança:
 * quem chama precisa distinguir origem de destino na mensagem.
 */
export async function geocodificar(
  endereco,
  { fetcher = fetch, sinal, headers = {} } = {},
) {
  const termo = texto(endereco);
  if (termo.length < 3) return null;

  let resposta;
  if (usarGatewayInterno(headers)) {
    resposta = await fetcher(MAPS_GEOCODE, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
      body: JSON.stringify({ q: termo, limit: 5 }),
      signal: sinal,
    });
  } else {
    const url = new URL(NOMINATIM);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "5");
    url.searchParams.set("countrycodes", "br");
    url.searchParams.set("q", termo);
    resposta = await fetcher(url, {
      headers: { accept: "application/json", "user-agent": IDENTIFICACAO },
      signal: sinal,
    });
  }

  if (!resposta.ok) throw new Error(`Nominatim indisponível (${resposta.status})`);
  const lista = await resposta.json();
  const primeiro = (Array.isArray(lista) ? lista : []).find((item) => item?.lat && item?.lon);
  if (!primeiro) return null;
  return {
    latitude: Number(primeiro.lat),
    longitude: Number(primeiro.lon),
    rotulo: texto(primeiro.display_name).slice(0, 200),
  };
}

/**
 * Resolve as coordenadas de COLETA (origem) e ENTREGA (destino) de uma operação
 * para o despacho, geocodificando os endereços. É o que faz uma operação criada
 * na mão virar roteirizável — sem coordenada de entrega ela nunca aparece como
 * candidata no roteirizador.
 *
 * Best-effort e NUNCA lança: se um endereço não geocodifica ou o serviço cai,
 * mantém a coordenada `base` que já existia (em edição) ou fica sem (em criação).
 * A operação é salva de todo jeito — só não entra no roteirizador enquanto não
 * tiver coordenada de entrega. `entregaLocalizada` diz à tela se deve avisar.
 *
 * Devolve { coletaLat, coletaLng, entregaLat, entregaLng, entregaLocalizada }.
 */
export async function resolverCoordenadasDaOperacao(
  { origem, destino, base = {} } = {},
  { fetcher = fetch, sinal, headers = {} } = {},
) {
  const num = (valor) => (valor === "" || valor == null ? null : Number(valor));
  const resultado = {
    coletaLat: num(base.coletaLat), coletaLng: num(base.coletaLng),
    entregaLat: num(base.entregaLat), entregaLng: num(base.entregaLng),
  };
  const resolver = async (endereco) => {
    const termo = texto(endereco);
    if (termo.length < 3) return null;
    try { return await geocodificar(termo, { fetcher, sinal, headers }); }
    catch { return null; }
  };

  const entrega = await resolver(destino);
  if (entrega) { resultado.entregaLat = entrega.latitude; resultado.entregaLng = entrega.longitude; }
  const coleta = await resolver(origem);
  if (coleta) { resultado.coletaLat = coleta.latitude; resultado.coletaLng = coleta.longitude; }

  resultado.entregaLocalizada = resultado.entregaLat != null && resultado.entregaLng != null;
  return resultado;
}

/**
 * Distância rodoviária entre origem e destino.
 *
 * Devolve sempre um objeto com `ok`, nunca lança — a precificação não pode
 * quebrar porque um serviço externo caiu.
 *
 * `idaEVolta` dobra o trecho: em Middle Mile a viagem é o ciclo completo, e
 * cobrar só a ida é o erro que aparece na margem no fim do mês.
 */
export async function calcularDistancia(
  { origem, destino, idaEVolta = false, veiculo = null } = {},
  { fetcher = fetch, sinal, headers = {} } = {},
) {
  const de = texto(origem);
  const para = texto(destino);
  if (!de || !para) return { ok: false, motivo: MOTIVOS.incompleto };
  if (de.length < 3 || para.length < 3) return { ok: false, motivo: MOTIVOS.curto };

  try {
    // Mantemos sequência para funcionar também no fallback público e evitar
    // rajadas desnecessárias de geocodificação.
    const pontoOrigem = await geocodificar(de, { fetcher, sinal, headers });
    if (!pontoOrigem) return { ok: false, motivo: MOTIVOS.origemNaoEncontrada };
    const pontoDestino = await geocodificar(para, { fetcher, sinal, headers });
    if (!pontoDestino) return { ok: false, motivo: MOTIVOS.destinoNaoEncontrado };

    const coordenadas = [
      [pontoOrigem.longitude, pontoOrigem.latitude],
      [pontoDestino.longitude, pontoDestino.latitude],
    ];
    const resposta = await consultarOSRM(coordenadas, {
      fetcher, sinal, headers, geometria: false, veiculo,
    });
    if (!resposta.ok) {
      const recusa = await recusaDeMotor(resposta);
      if (recusa) return recusa;
      throw new Error(`OSRM indisponível (${resposta.status})`);
    }
    const dados = await resposta.json();
    const rota = Array.isArray(dados?.routes) ? dados.routes[0] : null;
    if (!rota || !Number.isFinite(Number(rota.distance))) return { ok: false, motivo: MOTIVOS.semRota };

    const kmTrecho = Math.round((Number(rota.distance) / 1000) * 10) / 10;
    const minutosTrecho = Math.round(Number(rota.duration || 0) / 60);
    return {
      ok: true,
      // O que vai para o campo: já dobrado quando o produto é ida e volta.
      distanciaKm: idaEVolta ? Math.round(kmTrecho * 2 * 10) / 10 : kmTrecho,
      // As partes ficam disponíveis porque a tela precisa explicar de onde
      // veio o número — "260 km ida e volta" é diferente de "260 km de trecho".
      kmTrecho,
      idaEVolta,
      minutosTrecho,
      origem: pontoOrigem.rotulo,
      destino: pontoDestino.rotulo,
      // Sem trânsito: o OSRM devolve tempo livre. Dizer isso evita a tela
      // prometer previsão de chegada que ela não tem como cumprir.
      fonte: fonteDaRota(dados),
      motor: dados?.engine || "osrm",
      perfilMotor: dados?.profile || "",
      contingencia: Boolean(dados?.fallback || dados?.publicFallback),
    };
  } catch (erro) {
    if (erro?.name === "AbortError") return { ok: false, motivo: MOTIVOS.indisponivel, cancelado: true };
    return { ok: false, motivo: MOTIVOS.indisponivel, detalhe: texto(erro?.message).slice(0, 200) };
  }
}

/**
 * Rota rodoviária COM geometria, para desenhar no mapa. Mesma base do
 * `calcularDistancia` (Nominatim + OSRM, sem chave), mas pede a linha completa
 * (`overview=full`, GeoJSON) e devolve os pontos já na ordem [lat, lon] que o
 * Leaflet espera. Nunca lança: devolve `{ ok:false, motivo }` como a irmã.
 *
 * Aceita duas formas: `{ origem, destino }` (dois pontos) ou
 * `{ paradas: ["A", "B", "C", ...] }` (rota com quantas paradas quiser — o OSRM
 * roteiriza a sequência inteira). A titular pediu vários endereços.
 */
export async function tracarRota(
  { origem, destino, paradas, veiculo = null } = {},
  { fetcher = fetch, sinal, headers = {} } = {},
) {
  // Normaliza para uma lista de {endereco, coord?}. Cada parada pode ser uma
  // string ou um objeto com a coordenada já resolvida pela sugestão escolhida —
  // aí não geocodifica de novo, e o endereço completo entra sem depender de o
  // Nominatim acertar o texto livre.
  const lista = (Array.isArray(paradas) ? paradas : [origem, destino])
    .map((p) => {
      if (p && typeof p === "object") {
        const endereco = texto(p.endereco || p.rotulo);
        const coord = Array.isArray(p.coord) && p.coord.length === 2
          ? [Number(p.coord[0]), Number(p.coord[1])]
          : null;
        return { endereco, coord: coord && coord.every(Number.isFinite) ? coord : null };
      }
      return { endereco: texto(p), coord: null };
    })
    .filter((p) => p.endereco.length > 0);
  if (lista.length < 2) return { ok: false, motivo: MOTIVOS.incompleto };
  if (lista.some((p) => p.endereco.length < 3)) return { ok: false, motivo: MOTIVOS.curto };

  try {
    // Sequencial para preservar compatibilidade com o fallback público.
    const pontos = [];
    for (let i = 0; i < lista.length; i += 1) {
      const item = lista[i];
      let ponto;
      if (item.coord) {
        ponto = { latitude: item.coord[0], longitude: item.coord[1], rotulo: item.endereco };
      } else {
        ponto = await geocodificar(item.endereco, { fetcher, sinal, headers });
      }
      if (!ponto) {
        const motivo = i === 0
          ? MOTIVOS.origemNaoEncontrada
          : i === lista.length - 1
            ? MOTIVOS.destinoNaoEncontrado
            : `Não encontrei a parada "${item.endereco}" no mapa. Tente incluir a cidade e o estado.`;
        return { ok: false, motivo, paradaFalha: i };
      }
      pontos.push({ ...ponto, coord: [ponto.latitude, ponto.longitude] });
    }

    const coordenadas = pontos.map((p) => [p.longitude, p.latitude]);
    const resposta = await consultarOSRM(coordenadas, {
      fetcher, sinal, headers, geometria: true, veiculo,
    });
    if (!resposta.ok) {
      const recusa = await recusaDeMotor(resposta);
      if (recusa) return recusa;
      throw new Error(`OSRM indisponível (${resposta.status})`);
    }
    const dados = await resposta.json();
    const rota = Array.isArray(dados?.routes) ? dados.routes[0] : null;
    const linha = rota?.geometry?.coordinates;
    if (!rota || !Array.isArray(linha) || !linha.length) return { ok: false, motivo: MOTIVOS.semRota };

    // GeoJSON é [lon, lat]; o Leaflet quer [lat, lon]. Invertemos aqui, uma vez.
    const linhaMapa = linha
      .filter((par) => Array.isArray(par) && par.length >= 2)
      .map(([lon, lat]) => [Number(lat), Number(lon)]);
    if (!linhaMapa.length) return { ok: false, motivo: MOTIVOS.semRota };

    return {
      ok: true,
      pontos: linhaMapa,
      // `paradas`: cada endereço resolvido, na ordem, com coordenada e rótulo.
      paradas: pontos.map((p) => ({ coord: p.coord, rotulo: p.rotulo, latitude: p.latitude, longitude: p.longitude })),
      // `origem`/`destino` seguem existindo (primeira e última) para quem já usa.
      origem: pontos[0],
      destino: pontos[pontos.length - 1],
      distanciaKm: Math.round((Number(rota.distance || 0) / 1000) * 10) / 10,
      minutos: Math.round(Number(rota.duration || 0) / 60),
      fonte: fonteDaRota(dados),
      motor: dados?.engine || "osrm",
      perfilMotor: dados?.profile || "",
      contingencia: Boolean(dados?.fallback || dados?.publicFallback),
    };
  } catch (erro) {
    if (erro?.name === "AbortError") return { ok: false, motivo: MOTIVOS.indisponivel, cancelado: true };
    return { ok: false, motivo: MOTIVOS.indisponivel, detalhe: texto(erro?.message).slice(0, 200) };
  }
}

// Distância em linha reta (Haversine, km) — barata, só para ORDENAR paradas.
// A distância rodoviária real continua vindo do OSRM depois de reordenar.
const kmEntre = ([lat1, lon1], [lat2, lon2]) => {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// 2-opt: enquanto houver, desfaz o par de arestas que se cruza (troca que mais
// encurta a rota), invertendo o trecho entre elas. Origem (0) e destino (n-1)
// ficam fixos. É o passo que o vizinho-mais-próximo não faz: NN escolhe sempre
// o mais perto AGORA e deixa cruzamentos que saltam aos olhos de 8 paradas pra
// cima; o 2-opt limpa isso. O(n²) por passada — cap de nós e de passadas para
// não travar em listas patológicas (rota manual não passa disso na prática).
const CAP_2OPT = 60;
function refinar2opt(nos) {
  if (nos.length > CAP_2OPT) return nos;
  const custo = (a, b) => kmEntre(a.coord, b.coord);
  let seq = nos;
  let melhorou = true;
  let passadas = 0;
  while (melhorou && passadas < 40) {
    melhorou = false;
    passadas += 1;
    for (let i = 1; i < seq.length - 2; i += 1) {
      for (let j = i + 1; j < seq.length - 1; j += 1) {
        const atual = custo(seq[i - 1], seq[i]) + custo(seq[j], seq[j + 1]);
        const trocado = custo(seq[i - 1], seq[j]) + custo(seq[i], seq[j + 1]);
        if (trocado + 1e-9 < atual) {
          seq = [...seq.slice(0, i), ...seq.slice(i, j + 1).reverse(), ...seq.slice(j + 1)];
          melhorou = true;
        }
      }
    }
  }
  return seq;
}

/**
 * Otimiza a ORDEM das paradas do meio, mantendo origem (primeira) e destino
 * (última) fixos. Recebe [{endereco, coord:[lat,lon]}] e devolve a lista de
 * endereços na ordem otimizada. Duas etapas: vizinho-mais-próximo dá uma ordem
 * inicial; o 2-opt então desfaz os cruzamentos que o NN deixa. Rota dinâmica
 * sem servidor: a régua é aproximada (linha reta), mas suficiente para tirar o
 * "zigue-zague"; o OSRM recalcula a distância real depois.
 */
export function otimizarOrdemDeParadas(paradas) {
  const lista = Array.isArray(paradas) ? paradas.filter((p) => Array.isArray(p?.coord)) : [];
  if (lista.length <= 3) return lista.map((p) => p.endereco);
  const origem = lista[0];
  const destino = lista[lista.length - 1];
  const restantes = lista.slice(1, -1);
  const ordem = [];
  let atual = origem;
  while (restantes.length) {
    let melhor = 0;
    let melhorKm = Infinity;
    restantes.forEach((p, i) => {
      const d = kmEntre(atual.coord, p.coord);
      if (d < melhorKm) { melhorKm = d; melhor = i; }
    });
    atual = restantes[melhor];
    ordem.push(atual);
    restantes.splice(melhor, 1);
  }
  return refinar2opt([origem, ...ordem, destino]).map((p) => p.endereco);
}

/**
 * Sugestão de endereço enquanto a pessoa digita (#95/#96). Usa o mesmo
 * Nominatim público de sempre, só que pedindo até 5 candidatos em vez de 1.
 * Devolve [{rotulo, latitude, longitude}] — a tela alimenta um <datalist>.
 * Nunca lança: em erro ou consulta curta devolve lista vazia, então digitar
 * à mão continua funcionando exatamente como antes.
 */
export async function sugerirEnderecos(
  termo,
  { fetcher = fetch, sinal, limite = 5, headers = {} } = {},
) {
  const busca = texto(termo);
  if (busca.length < 3) return [];
  try {
    let resposta;
    if (usarGatewayInterno(headers)) {
      resposta = await fetcher(MAPS_GEOCODE, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...headers },
        body: JSON.stringify({ q: busca, limit: Math.min(10, Math.max(1, limite)) }),
        signal: sinal,
      });
    } else {
      const url = new URL(NOMINATIM);
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", String(Math.min(10, Math.max(1, limite))));
      url.searchParams.set("countrycodes", "br");
      url.searchParams.set("addressdetails", "0");
      url.searchParams.set("q", busca);
      resposta = await fetcher(url, {
        headers: { accept: "application/json", "user-agent": IDENTIFICACAO },
        signal: sinal,
      });
    }
    if (!resposta.ok) return [];
    const lista = await resposta.json();
    if (!Array.isArray(lista)) return [];
    return lista
      .filter((item) => item?.lat && item?.lon && item?.display_name)
      .map((item) => ({
        rotulo: texto(item.display_name).slice(0, 200),
        latitude: Number(item.lat),
        longitude: Number(item.lon),
      }));
  } catch {
    return [];
  }
}

// Tipos de conector mais comuns por ConnectionTypeID do Open Charge Map. O foco
// da To Do Green é pesado elétrico, então o que importa é distinguir a recarga
// rápida em corrente contínua (CCS2, CHAdeMO) do carregador lento AC (Type 2).
const TIPOS_CONECTOR = Object.freeze({
  2: "CHAdeMO",
  25: "Type 2",
  27: "Tesla (proprietário)",
  32: "CCS (Type 1)",
  33: "CCS (Type 2)",
  1036: "Type 2 (cabo)",
  1050: "NACS / Tesla",
});

/**
 * Normaliza a resposta do Open Charge Map (via gateway) em pontos prontos para o
 * mapa (#90). Puro e testável: recebe a lista de POIs e devolve
 * [{id, nome, cidade, coord:[lat,lon], potenciaKw, tipos:[...], pesados}].
 *
 * `pesados = true` quando há recarga em corrente contínua de alta potência
 * (>= 50 kW): é o que serve caminhão elétrico, o foco pedido pela titular.
 */
export function normalizarCarregadores(lista) {
  const pois = Array.isArray(lista) ? lista : [];
  return pois
    .map((poi) => {
      const info = poi?.AddressInfo || {};
      const lat = Number(info.Latitude);
      const lon = Number(info.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const conexoes = Array.isArray(poi?.Connections) ? poi.Connections : [];
      const potencias = conexoes
        .map((c) => Number(c?.PowerKW))
        .filter((kw) => Number.isFinite(kw) && kw > 0);
      const potenciaKw = potencias.length ? Math.max(...potencias) : null;
      const tipos = [
        ...new Set(
          conexoes
            .map((c) => TIPOS_CONECTOR[Number(c?.ConnectionTypeID)])
            .filter(Boolean),
        ),
      ];
      return {
        id: String(poi?.ID ?? poi?.UUID ?? `${lat},${lon}`),
        nome: texto(info.Title).slice(0, 120) || "Ponto de recarga",
        cidade: texto(info.Town || info.StateOrProvince).slice(0, 80),
        coord: [lat, lon],
        potenciaKw,
        tipos,
        pesados: potenciaKw !== null && potenciaKw >= 50,
      };
    })
    .filter(Boolean);
}

// Sockets de corrente contínua (recarga rápida) no esquema de tags do OSM.
// Presença de qualquer um marca a estação como "serve pesado" mesmo sem a
// potência declarada — é a leitura conservadora para caminhão elétrico.
const SOCKETS_DC_OSM = ["socket:ccs", "socket:chademo", "socket:type2_combo", "socket:tesla_supercharger", "socket:nacs"];

/**
 * Normaliza estações de recarga do OpenStreetMap (via Overpass, sem chave) no
 * mesmo formato de `normalizarCarregadores` — para o mapa não saber de onde
 * veio o dado. Fonte gratuita usada quando não há chave do Open Charge Map.
 * Cada elemento é um node `amenity=charging_station` com `tags`.
 */
export function normalizarCarregadoresOSM(elementos) {
  const nodes = Array.isArray(elementos) ? elementos : [];
  return nodes
    .map((node) => {
      // Nós trazem lat/lon no topo; ways/relations (estação mapeada como área,
      // via `out center`) trazem o ponto em node.center. Aceita os dois.
      const lat = Number(node?.lat ?? node?.center?.lat);
      const lon = Number(node?.lon ?? node?.center?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const tags = node?.tags && typeof node.tags === "object" ? node.tags : {};
      // Potência: procura um número em kW em qualquer tag de saída/potência.
      let potenciaKw = null;
      for (const [chave, valor] of Object.entries(tags)) {
        if (!/output|maxpower|:power$|^power$/i.test(chave)) continue;
        const m = String(valor).match(/([\d.,]+)\s*k?w/i);
        if (!m) continue;
        const kw = Number(m[1].replace(/\./g, "").replace(",", "."));
        if (Number.isFinite(kw) && kw > 0 && (potenciaKw === null || kw > potenciaKw)) potenciaKw = kw;
      }
      const temDC = SOCKETS_DC_OSM.some((k) => tags[k] && String(tags[k]).toLowerCase() !== "no");
      const tipos = [];
      if (tags["socket:type2"] || tags["socket:type2_cable"]) tipos.push("Type 2");
      if (tags["socket:ccs"] || tags["socket:type2_combo"]) tipos.push("CCS");
      if (tags["socket:chademo"]) tipos.push("CHAdeMO");
      if (tags["socket:tesla_supercharger"] || tags["socket:nacs"]) tipos.push("Tesla / NACS");
      return {
        id: String(node?.id ?? `${lat},${lon}`),
        nome: texto(tags.name || tags.operator || "Ponto de recarga").slice(0, 120),
        cidade: texto(tags["addr:city"] || "").slice(0, 80),
        coord: [lat, lon],
        potenciaKw,
        tipos: [...new Set(tipos)],
        pesados: (potenciaKw !== null && potenciaKw >= 50) || temDC,
      };
    })
    .filter(Boolean);
}

/**
 * Texto curto para a tela, a partir do resultado. Existe para a mensagem ser
 * a mesma onde quer que a distância apareça.
 */
export const resumoDaDistancia = (resultado) => {
  if (!resultado?.ok) return "";
  const horas = Math.floor(resultado.minutosTrecho / 60);
  const minutos = resultado.minutosTrecho % 60;
  const tempo = horas > 0 ? `${horas}h${String(minutos).padStart(2, "0")}` : `${minutos} min`;
  const trecho = resultado.idaEVolta
    ? `${resultado.distanciaKm} km ida e volta (${resultado.kmTrecho} km por trecho)`
    : `${resultado.kmTrecho} km`;
  return `${trecho} · ${tempo} de viagem por trecho, sem trânsito`;
};

// #93 — ordem sugerida pela IA. A IA recebe as paradas numeradas e as
// restrições (janela, prioridade) e devolve a nova ordem das paradas DO MEIO
// (origem e destino são fixos, como no otimizador geométrico). Aqui só
// aplicamos se a resposta for uma permutação EXATA dos índices do meio — a IA
// pode alucinar, repetir ou inventar índice, e nesse caso não mexemos em nada
// (devolve null e a tela avisa), nunca perdendo ou duplicando uma parada.
export function aplicarOrdemDoMeio(paradas, ordemDoMeio) {
  const lista = Array.isArray(paradas) ? paradas : [];
  const n = lista.length;
  if (n <= 3) return null; // sem meio para reordenar
  const meio = [];
  for (let i = 1; i < n - 1; i += 1) meio.push(i);
  const nova = (Array.isArray(ordemDoMeio) ? ordemDoMeio : [])
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x));
  const esperado = new Set(meio);
  const recebido = new Set(nova);
  if (nova.length !== meio.length || recebido.size !== meio.length) return null;
  for (const i of nova) if (!esperado.has(i)) return null;
  return [lista[0], ...nova.map((i) => lista[i]), lista[n - 1]];
}
