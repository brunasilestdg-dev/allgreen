// ===== Otimização profissional de rota: VROOM + OSRM =====
//
// Traduz o estado atual do roteirizador para o contrato do VROOM e a solução
// de volta para o formato que a tela já usa. Assim a UI não fica acoplada ao
// solver e o fallback local continua disponível.

const inteiro = (valor) => Math.trunc(Number(valor));
const coordValida = (coord) =>
  Array.isArray(coord) &&
  coord.length >= 2 &&
  Number.isFinite(Number(coord[0])) &&
  Number.isFinite(Number(coord[1]));

const paraVroom = (coord) => [Number(coord[1]), Number(coord[0])];
const segundos = (data) => Math.floor(data.getTime() / 1000);

function dataBaseLocal(partida) {
  const data = partida ? new Date(partida) : new Date();
  return Number.isFinite(data.getTime()) ? data : new Date();
}

function horarioNaData(base, hhmm) {
  const match = String(hhmm || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hora = Number(match[1]);
  const minuto = Number(match[2]);
  if (hora > 23 || minuto > 59) return null;
  const data = new Date(base);
  data.setHours(hora, minuto, 0, 0);
  return data;
}

export function janelaVroom(janela, partida = "") {
  const inicioTexto = janela?.inicio || "";
  const fimTexto = janela?.fim || "";
  if (!inicioTexto && !fimTexto) return null;

  const base = dataBaseLocal(partida);
  const inicio = horarioNaData(base, inicioTexto || "00:00");
  const fim = horarioNaData(base, fimTexto || "23:59");
  if (!inicio || !fim) return null;
  if (fim.getTime() < inicio.getTime()) fim.setDate(fim.getDate() + 1);
  return [segundos(inicio), segundos(fim)];
}

export function montarProblemaVroom({ resultado, janelas = [], partida = "" } = {}) {
  const stops = Array.isArray(resultado?.paradas) ? resultado.paradas : [];
  const enderecos = Array.isArray(resultado?.enderecos) ? resultado.enderecos : [];
  if (stops.length < 2 || stops.length !== enderecos.length || stops.some((p) => !coordValida(p?.coord))) {
    return { ok: false, motivo: "Trace uma rota válida antes de otimizar." };
  }

  const inicioPartida = partida ? dataBaseLocal(partida) : null;
  const vehicle = {
    id: 1,
    start: paraVroom(stops[0].coord),
    end: paraVroom(stops[stops.length - 1].coord),
  };
  if (inicioPartida && Number.isFinite(inicioPartida.getTime())) {
    const inicio = segundos(inicioPartida);
    vehicle.time_window = [inicio, inicio + (24 * 60 * 60)];
  }

  const jobs = stops.slice(1, -1).map((stop, offset) => {
    const indiceOriginal = offset + 1;
    const job = {
      id: indiceOriginal,
      location: paraVroom(stop.coord),
      description: String(enderecos[indiceOriginal] || stop.rotulo || "").slice(0, 240),
    };
    const janela = janelaVroom(janelas[indiceOriginal], partida);
    if (janela) job.time_windows = [janela];
    return job;
  });

  return {
    ok: true,
    payload: {
      vehicles: [vehicle],
      jobs,
      shipments: [],
      geometry: true,
    },
  };
}

export function decodificarPolyline(encoded, precision = 5) {
  const input = String(encoded || "");
  if (!input) return [];
  const factor = 10 ** precision;
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const nextValue = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      if (index >= input.length) return null;
      byte = input.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return (result & 1) ? ~(result >> 1) : (result >> 1);
  };

  while (index < input.length) {
    const dLat = nextValue();
    const dLon = nextValue();
    if (dLat === null || dLon === null) return [];
    lat += dLat;
    lon += dLon;
    coordinates.push([lat / factor, lon / factor]);
  }
  return coordinates;
}

function ordemDeJobs(route, quantidadeMeio) {
  const ids = (Array.isArray(route?.steps) ? route.steps : [])
    .filter((step) => step?.type === "job")
    .map((step) => inteiro(step.id ?? step.job))
    .filter((id) => Number.isInteger(id));
  const esperados = Array.from({ length: quantidadeMeio }, (_, i) => i + 1);
  if (ids.length !== esperados.length) return null;
  if (new Set(ids).size !== ids.length) return null;
  if (ids.some((id) => !esperados.includes(id))) return null;
  return ids;
}

export function interpretarSolucaoVroom({ resultadoAtual, resposta } = {}) {
  const stops = Array.isArray(resultadoAtual?.paradas) ? resultadoAtual.paradas : [];
  const enderecos = Array.isArray(resultadoAtual?.enderecos) ? resultadoAtual.enderecos : [];
  const routes = Array.isArray(resposta?.routes) ? resposta.routes : [];
  const unassigned = Array.isArray(resposta?.unassigned) ? resposta.unassigned : [];

  if (unassigned.length) {
    return {
      ok: false,
      motivo: String(unassigned.length) + " parada(s) ficaram sem alocação. A rota atual foi mantida.",
      unassigned,
    };
  }
  if (!routes.length || stops.length < 2 || enderecos.length !== stops.length) {
    return { ok: false, motivo: "O VROOM não devolveu uma rota utilizável." };
  }

  const route = routes[0];
  const ordem = ordemDeJobs(route, Math.max(0, stops.length - 2));
  if (!ordem) return { ok: false, motivo: "O VROOM devolveu uma sequência incompleta ou inválida." };

  const indices = [0, ...ordem, stops.length - 1];
  const paradas = indices.map((indice) => stops[indice]);
  const novosEnderecos = indices.map((indice) => enderecos[indice]);
  const geometry = decodificarPolyline(route.geometry);
  const distance = Number(route.distance ?? resposta?.summary?.distance ?? 0);
  const duration = Number(route.duration ?? resposta?.summary?.duration ?? 0);

  return {
    ok: true,
    resultado: {
      ...resultadoAtual,
      pontos: geometry.length >= 2 ? geometry : resultadoAtual.pontos,
      paradas,
      enderecos: novosEnderecos,
      distanciaKm: Number.isFinite(distance) && distance > 0
        ? Math.round((distance / 1000) * 10) / 10
        : resultadoAtual.distanciaKm,
      minutos: Number.isFinite(duration) && duration > 0
        ? Math.round(duration / 60)
        : resultadoAtual.minutos,
      fonte: "OpenStreetMap · VROOM + OSRM auto-hospedados",
      motor: "vroom",
      custoOtimizacao: Number(route.cost ?? resposta?.summary?.cost ?? 0) || 0,
    },
    ordem: novosEnderecos,
  };
}
