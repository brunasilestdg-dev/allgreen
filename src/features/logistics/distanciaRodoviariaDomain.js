// ===== Distância rodoviária real, sem chave e sem custo =====
//
// A calculadora pede `distanceKm` como campo obrigatório digitado à mão em
// Middle Mile, Last Mile, Transferência e Coleta em fornecedores. Enquanto
// isso, o app já sabe traçar rota: o `RouterModal` usa Nominatim (endereço →
// coordenada) e OSRM (coordenadas → rota), os dois do OpenStreetMap, sem chave,
// sem cota e sem cartão.
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

const texto = (valor) => String(valor ?? "").trim();

// O OSM pede identificação de quem chama. Sem isso o Nominatim recusa em
// volume, e a recusa vem como 403 sem explicação.
const IDENTIFICACAO = "SeuFuncionario/1.0 (ERP logistico; contato via app)";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";

export const MOTIVOS = Object.freeze({
  incompleto: "Informe origem e destino para calcular a distância.",
  curto: "Endereço curto demais para localizar. Use cidade e estado, por exemplo \"Santos SP\".",
  origemNaoEncontrada: "Não encontrei a origem no mapa. Tente incluir a cidade e o estado.",
  destinoNaoEncontrado: "Não encontrei o destino no mapa. Tente incluir a cidade e o estado.",
  semRota: "Não há rota rodoviária entre esses dois pontos.",
  indisponivel: "O serviço de mapas não respondeu agora. Digite a distância manualmente.",
});

/**
 * Endereço → coordenada. Devolve `null` quando não acha, nunca lança:
 * quem chama precisa distinguir origem de destino na mensagem.
 */
export async function geocodificar(endereco, { fetcher = fetch, sinal } = {}) {
  const termo = texto(endereco);
  if (termo.length < 3) return null;
  const url = new URL(NOMINATIM);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  // A operação é brasileira. Restringir o país evita o caso clássico de
  // "Santos" virar Santos de Portugal e a rota sair com 9.000 km.
  url.searchParams.set("countrycodes", "br");
  url.searchParams.set("q", termo);
  const resposta = await fetcher(url, {
    headers: { accept: "application/json", "user-agent": IDENTIFICACAO },
    signal: sinal,
  });
  if (!resposta.ok) throw new Error(`Nominatim indisponível (${resposta.status})`);
  const lista = await resposta.json();
  const primeiro = Array.isArray(lista) ? lista[0] : null;
  if (!primeiro?.lat || !primeiro?.lon) return null;
  return {
    latitude: Number(primeiro.lat),
    longitude: Number(primeiro.lon),
    rotulo: texto(primeiro.display_name).slice(0, 200),
  };
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
  { origem, destino, idaEVolta = false } = {},
  { fetcher = fetch, sinal } = {},
) {
  const de = texto(origem);
  const para = texto(destino);
  if (!de || !para) return { ok: false, motivo: MOTIVOS.incompleto };
  if (de.length < 3 || para.length < 3) return { ok: false, motivo: MOTIVOS.curto };

  try {
    // Sequencial, não em paralelo: o Nominatim público pede no máximo uma
    // consulta por segundo, e disparar as duas juntas é o caminho para o 429.
    const pontoOrigem = await geocodificar(de, { fetcher, sinal });
    if (!pontoOrigem) return { ok: false, motivo: MOTIVOS.origemNaoEncontrada };
    const pontoDestino = await geocodificar(para, { fetcher, sinal });
    if (!pontoDestino) return { ok: false, motivo: MOTIVOS.destinoNaoEncontrado };

    const coordenadas = [
      `${pontoOrigem.longitude},${pontoOrigem.latitude}`,
      `${pontoDestino.longitude},${pontoDestino.latitude}`,
    ].join(";");
    const resposta = await fetcher(`${OSRM}/${coordenadas}?overview=false`, {
      headers: { accept: "application/json" },
      signal: sinal,
    });
    if (!resposta.ok) throw new Error(`OSRM indisponível (${resposta.status})`);
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
      fonte: "OpenStreetMap · Nominatim + OSRM (sem trânsito)",
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
 */
export async function tracarRota(
  { origem, destino } = {},
  { fetcher = fetch, sinal } = {},
) {
  const de = texto(origem);
  const para = texto(destino);
  if (!de || !para) return { ok: false, motivo: MOTIVOS.incompleto };
  if (de.length < 3 || para.length < 3) return { ok: false, motivo: MOTIVOS.curto };

  try {
    const pontoOrigem = await geocodificar(de, { fetcher, sinal });
    if (!pontoOrigem) return { ok: false, motivo: MOTIVOS.origemNaoEncontrada };
    const pontoDestino = await geocodificar(para, { fetcher, sinal });
    if (!pontoDestino) return { ok: false, motivo: MOTIVOS.destinoNaoEncontrado };

    const coordenadas = [
      `${pontoOrigem.longitude},${pontoOrigem.latitude}`,
      `${pontoDestino.longitude},${pontoDestino.latitude}`,
    ].join(";");
    const resposta = await fetcher(`${OSRM}/${coordenadas}?overview=full&geometries=geojson`, {
      headers: { accept: "application/json" },
      signal: sinal,
    });
    if (!resposta.ok) throw new Error(`OSRM indisponível (${resposta.status})`);
    const dados = await resposta.json();
    const rota = Array.isArray(dados?.routes) ? dados.routes[0] : null;
    const linha = rota?.geometry?.coordinates;
    if (!rota || !Array.isArray(linha) || !linha.length) return { ok: false, motivo: MOTIVOS.semRota };

    // GeoJSON é [lon, lat]; o Leaflet quer [lat, lon]. Invertemos aqui, uma vez.
    const pontos = linha
      .filter((par) => Array.isArray(par) && par.length >= 2)
      .map(([lon, lat]) => [Number(lat), Number(lon)]);
    if (!pontos.length) return { ok: false, motivo: MOTIVOS.semRota };

    return {
      ok: true,
      pontos,
      origem: { ...pontoOrigem, coord: [pontoOrigem.latitude, pontoOrigem.longitude] },
      destino: { ...pontoDestino, coord: [pontoDestino.latitude, pontoDestino.longitude] },
      distanciaKm: Math.round((Number(rota.distance || 0) / 1000) * 10) / 10,
      minutos: Math.round(Number(rota.duration || 0) / 60),
      fonte: "OpenStreetMap · Nominatim + OSRM (sem trânsito)",
    };
  } catch (erro) {
    if (erro?.name === "AbortError") return { ok: false, motivo: MOTIVOS.indisponivel, cancelado: true };
    return { ok: false, motivo: MOTIVOS.indisponivel, detalhe: texto(erro?.message).slice(0, 200) };
  }
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
