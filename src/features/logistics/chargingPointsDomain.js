// ===== Pontos de recarga próprios (cadastro da eletrificação) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// O roteirizador já mostra carregadores PÚBLICOS (Open Charge Map / OSM), mas
// eles são efêmeros — consulta por raio, nada persiste. Faltava o cadastro dos
// pontos PRÓPRIOS: os que a operação instalou ou contratou (Ground, GreenOn,
// pátio próprio). Este é o núcleo testável desse cadastro — normalização,
// validação e o resumo da rede.
//
// Duas decisões de honestidade:
//  - "serve pesado" NÃO é dado gravado: deriva de corrente + potência, para não
//    guardar uma verdade que pode divergir do fato quando a potência muda;
//  - coordenada só existe se for válida — (0,0) no meio do Atlântico é ausência
//    de leitura, não um ponto; devolve null, nunca finge localização.

const num = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const texto = (valor, max = 500) => String(valor ?? "").trim().slice(0, max);

export const TIPOS_CORRENTE = Object.freeze(["AC", "DC"]);
export const CONECTORES = Object.freeze(["Type2", "CCS2", "CHAdeMO", "GB/T", "Tesla", "Outro"]);
export const STATUS_PONTO = Object.freeze(["ativo", "manutencao", "inativo"]);
// Operadores sugeridos na tela — não é lista fechada; o campo aceita texto livre.
export const OPERADORES_SUGERIDOS = Object.freeze(["Ground", "GreenOn", "Próprio", "Terceiro"]);

// Potência a partir da qual um DC atende caminhão pesado. Espelha a régua do
// roteirizador (distanciaRodoviariaDomain: pesados = DC rápido, potência ≥ 50).
export const POTENCIA_PESADO_KW = 50;

export const tipoCorrenteValido = (valor) =>
  TIPOS_CORRENTE.includes(texto(valor).toUpperCase()) ? texto(valor).toUpperCase() : "AC";

export const statusValido = (valor) =>
  STATUS_PONTO.includes(texto(valor)) ? texto(valor) : "ativo";

// Caminhão pesado só carrega em tempo hábil no DC rápido. AC (Type 2) não serve,
// por mais potente que o rótulo diga.
export const servePesado = ({ tipoCorrente, potenciaKw } = {}) =>
  tipoCorrenteValido(tipoCorrente) === "DC" && num(potenciaKw) >= POTENCIA_PESADO_KW;

// Coordenada válida = ambos finitos, dentro do globo, e não a origem (0,0), que
// no cadastro é sinal de campo em branco, não de um ponto no oceano.
export const coordenadaValida = (latitude, longitude) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
};

// Corpo da API → forma canônica normalizada. Devolve latitude/longitude null
// quando a coordenada não é válida (nunca 0,0 forjado).
export const normalizarPontoRecarga = (corpo = {}) => {
  const tipoCorrente = tipoCorrenteValido(corpo.tipoCorrente);
  const potenciaKw = Math.max(0, num(corpo.potenciaKw));
  const temCoord = coordenadaValida(corpo.latitude, corpo.longitude);
  return {
    nome: texto(corpo.nome, 200),
    operador: texto(corpo.operador, 120),
    tipoCorrente,
    conector: texto(corpo.conector, 40),
    potenciaKw,
    latitude: temCoord ? Number(corpo.latitude) : null,
    longitude: temCoord ? Number(corpo.longitude) : null,
    endereco: texto(corpo.endereco, 400),
    status: statusValido(corpo.status),
    servePesado: servePesado({ tipoCorrente, potenciaKw }),
  };
};

// Validação única — a mesma que a tela e o servidor usam, para o botão não
// liberar o que o servidor recusa.
export const validarPontoRecarga = (corpo = {}) => {
  if (!texto(corpo.nome)) return "Dê um nome ao ponto de recarga.";
  if (num(corpo.potenciaKw) < 0) return "A potência não pode ser negativa.";
  // "Preenchido" ignora o zero: (0,0) e o eixo em zero são o sentinela de campo
  // em branco (a operação real no Brasil tem lat/lng bem negativos), tratado
  // como "sem coordenada", não como erro.
  const preenchido = (v) => v != null && texto(v) !== "" && Number(v) !== 0;
  const temLat = preenchido(corpo.latitude);
  const temLng = preenchido(corpo.longitude);
  if (temLat !== temLng)
    return "Informe latitude e longitude juntas, ou deixe as duas em branco.";
  if (temLat && temLng && !coordenadaValida(corpo.latitude, corpo.longitude))
    return "Coordenada inválida: latitude entre -90 e 90, longitude entre -180 e 180.";
  return "";
};

// Resumo da rede de recarga própria — números derivados, nunca gravados.
export const resumoPontos = (pontos = []) => {
  const lista = Array.isArray(pontos) ? pontos : [];
  const ativos = lista.filter((p) => (p.status || "ativo") === "ativo");
  const porOperador = {};
  let potenciaTotalKw = 0;
  let servemPesado = 0;
  let comCoordenada = 0;
  for (const p of lista) {
    const op = texto(p.operador) || "Sem operador";
    porOperador[op] = (porOperador[op] || 0) + 1;
    potenciaTotalKw += Math.max(0, num(p.potenciaKw));
    if (servePesado({ tipoCorrente: p.tipoCorrente, potenciaKw: p.potenciaKw })) servemPesado += 1;
    if (coordenadaValida(p.latitude, p.longitude)) comCoordenada += 1;
  }
  return {
    total: lista.length,
    ativos: ativos.length,
    emManutencao: lista.filter((p) => p.status === "manutencao").length,
    inativos: lista.filter((p) => p.status === "inativo").length,
    servemPesado,
    comCoordenada,
    potenciaTotalKw: Math.round(potenciaTotalKw * 10) / 10,
    porOperador,
  };
};

// Só os pontos ativos e georreferenciados viram pino no mapa do roteirizador.
// Um ponto sem coordenada existe no cadastro, mas não tem onde ser desenhado.
export const pontosParaMapa = (pontos = []) =>
  (Array.isArray(pontos) ? pontos : [])
    .filter((p) => (p.status || "ativo") === "ativo" && coordenadaValida(p.latitude, p.longitude))
    .map((p) => ({
      id: p.id,
      nome: p.nome,
      operador: p.operador,
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      potenciaKw: Math.max(0, num(p.potenciaKw)),
      tipoCorrente: tipoCorrenteValido(p.tipoCorrente),
      servePesado: servePesado({ tipoCorrente: p.tipoCorrente, potenciaKw: p.potenciaKw }),
      proprio: true,
    }));
