// ===== Despacho: motor de roteirização (VRP) rodando dentro do Worker =====
//
// Antes, atribuir motorista+veículo a uma operação era só escrever texto
// livre em dois campos (driver_id, vehicle_plate) — sem checar disponibilidade
// nem calcular a melhor ordem de visita. Este serviço monta o problema de
// roteirização a partir dos dados que já existem (operações pendentes,
// motoristas disponíveis, veículos disponíveis), resolve com um solver
// genético real (worker/vrp/, ver README ali) e devolve uma PRÉVIA — quem vê
// o painel decide se aplica antes de qualquer gravação.
//
// Sem matriz de rota externa: quando `matrices` vai vazio, o próprio solver
// calcula distância por Haversine a partir das coordenadas dos jobs. Zero
// serviço pago, zero dependência de rede.

import { podeNaVertical } from "./todogreen-access.js";

// Import dinâmico de propósito: o `.wasm` (2,7MB) só deve entrar em memória
// quando o despacho é de fato chamado. Estático, ele é resolvido no import
// deste arquivo inteiro — e o build do Vite usado pelos testes unitários (que
// não é o bundler do Workers) tenta processar o `.wasm` com o loader errado e
// quebra qualquer teste que só encoste transitivamente neste módulo.
//
// `--target web` (não `bundler`): testado em wrangler dev real, o `bundler`
// não expõe `__wbindgen_start` corretamente no workerd. Ver worker/vrp/README.md.
let vrpReady = null;
const ensureVrp = () => {
  if (!vrpReady) {
    vrpReady = Promise.all([
      import("../vrp/vrp_cli.js"),
      // @ts-ignore — import de módulo .wasm: o Workers entrega um WebAssembly.Module já compilado.
      import("../vrp/vrp_cli_bg.wasm"),
    ]).then(([{ default: init }, { default: wasmModule }]) => init({ module_or_path: wasmModule }));
  }
  return vrpReady;
};

const solvePragmatic = async (...args) => {
  await ensureVrp();
  const { solve_pragmatic } = await import("../vrp/vrp_cli.js");
  return solve_pragmatic(...args);
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const canDispatch = (access) =>
  ["operations:manage", "operation:manage", "planning:manage", "fleet:manage"].some((permissao) =>
    podeNaVertical(access, permissao));

const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};
const parse = (valor, fallback) => { try { return JSON.parse(valor || ""); } catch { return fallback; } };

const DEFAULT_SPEED_MS = 40 / 3.6; // 40 km/h em m/s — velocidade média urbana/mista, ajustável depois por perfil
const DEFAULT_SHIFT_HOURS = 8;
const DEFAULT_STOP_DURATION_S = 600; // 10 min por parada — coleta ou entrega

const carregarCandidatos = async (env, access) => {
  const [operacoes, motoristas, veiculos] = await Promise.all([
    env.DB.prepare(
      `SELECT o.id, o.client_id, o.driver_id, o.vehicle_plate, o.delivery_lat, o.delivery_lng,
              o.pickup_lat, o.pickup_lng, o.fields_json, c.name AS client_name
         FROM todogreen_client_operations o
         LEFT JOIN todogreen_clients c ON c.id = o.client_id AND c.workspace_owner_id = o.workspace_owner_id
        WHERE o.workspace_owner_id = ? AND o.archived_at IS NULL AND o.delivered_at IS NULL
          AND (o.driver_id = '' OR o.driver_id IS NULL)
        ORDER BY o.created_at ASC LIMIT 200`,
    ).bind(access.ownerId).all(),
    env.DB.prepare(
      `SELECT id, full_name, availability_status FROM todogreen_drivers
        WHERE workspace_owner_id = ? AND status = 'active' AND availability_status = 'available'
        ORDER BY full_name ASC LIMIT 100`,
    ).bind(access.ownerId).all(),
    env.DB.prepare(
      `SELECT id, prefix, plate, pallet_capacity, payload_kg FROM todogreen_fleet_vehicles
        WHERE workspace_owner_id = ? AND status = 'available' AND archived_at IS NULL
        ORDER BY prefix ASC LIMIT 100`,
    ).bind(access.ownerId).all(),
  ]);

  const todasOperacoes = operacoes.results || [];
  const comCoordenadas = todasOperacoes.filter((op) => op.delivery_lat != null && op.delivery_lng != null);
  const semCoordenadas = todasOperacoes.length - comCoordenadas.length;

  return {
    operacoes: comCoordenadas,
    semCoordenadas,
    motoristas: motoristas.results || [],
    veiculos: veiculos.results || [],
  };
};

// Monta o problema no formato "pragmatic" do solver: um job por operação
// (entrega, e coleta quando a operação tiver uma), um "tipo de veículo" por
// veículo disponível (cada um só alcança a si mesmo — não queremos o solver
// decidindo entre dois caminhões que na prática têm capacidades diferentes).
const montarProblema = ({ operacoes, veiculos, depot, agora }) => {
  const jobs = operacoes.map((op) => {
    const demanda = Math.max(1, Number(parse(op.fields_json, {}).pacotes) || 1);
    const job = { id: op.id, deliveries: [{
      places: [{ location: { lat: op.delivery_lat, lng: op.delivery_lng }, duration: DEFAULT_STOP_DURATION_S }],
      demand: [demanda],
    }] };
    if (op.pickup_lat != null && op.pickup_lng != null) {
      job.pickups = [{
        places: [{ location: { lat: op.pickup_lat, lng: op.pickup_lng }, duration: DEFAULT_STOP_DURATION_S }],
        demand: [demanda],
      }];
    }
    return job;
  });

  const inicioTurno = agora.toISOString();
  const fimTurno = new Date(agora.getTime() + DEFAULT_SHIFT_HOURS * 3_600_000).toISOString();

  const vehicles = veiculos.map((veiculo) => ({
    typeId: `veiculo-${veiculo.id}`,
    vehicleIds: [veiculo.id],
    profile: { matrix: "padrao" },
    costs: { fixed: 0, distance: 0.0002, time: 0.001 },
    shifts: [{
      start: { earliest: inicioTurno, location: depot },
      end: { latest: fimTurno, location: depot },
    }],
    capacity: [Math.max(1, Number(veiculo.pallet_capacity) || 999)],
  }));

  return {
    plan: { jobs },
    fleet: { vehicles, profiles: [{ name: "padrao", speed: DEFAULT_SPEED_MS }] },
  };
};

// Sem um depósito cadastrado, o ponto de partida vira o centro geográfico das
// próprias entregas — não é perfeito, mas dá um ponto de partida plausível em
// vez de recusar rodar o solver.
const calcularDepotPadrao = (operacoes) => {
  const total = operacoes.length;
  const soma = operacoes.reduce((acc, op) => ({
    lat: acc.lat + op.delivery_lat, lng: acc.lng + op.delivery_lng,
  }), { lat: 0, lng: 0 });
  return { lat: soma.lat / total, lng: soma.lng / total };
};

export async function handleTodoGreenDispatch(request, env, access, user) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/todogreen/dispatch")) return null;
  if (!canDispatch(access)) return json({ error: "Sem permissão para operar o despacho." }, 403);

  const parts = url.pathname.split("/").filter(Boolean);
  const acao = parts[3] || "";

  if (request.method === "GET" && acao === "candidatos") {
    const { operacoes, semCoordenadas, motoristas, veiculos } = await carregarCandidatos(env, access);
    return json({
      operacoes: operacoes.map((op) => ({
        id: op.id, clienteId: op.client_id, cliente: op.client_name || op.client_id || "",
        entregaLat: op.delivery_lat, entregaLng: op.delivery_lng,
        coletaLat: op.pickup_lat, coletaLng: op.pickup_lng,
      })),
      semCoordenadas,
      motoristas: motoristas.map((m) => ({ id: m.id, nome: m.full_name })),
      veiculos: veiculos.map((v) => ({ id: v.id, prefixo: v.prefix, placa: v.plate })),
    });
  }

  if (request.method === "POST" && acao === "otimizar") {
    const corpo = await request.json().catch(() => ({}));
    const { operacoes: todasOperacoes, motoristas, veiculos } = await carregarCandidatos(env, access);
    const idsFiltro = Array.isArray(corpo.operationIds) && corpo.operationIds.length
      ? new Set(corpo.operationIds.map(String)) : null;
    const operacoes = idsFiltro ? todasOperacoes.filter((op) => idsFiltro.has(op.id)) : todasOperacoes;

    if (!operacoes.length) return json({ error: "Nenhuma operação pendente com coordenada de entrega para despachar." }, 400);
    if (!veiculos.length) return json({ error: "Nenhum veículo disponível para o despacho." }, 400);

    const depot = corpo.depot && numero(corpo.depot.lat) != null && numero(corpo.depot.lng) != null
      ? { lat: numero(corpo.depot.lat), lng: numero(corpo.depot.lng) }
      : calcularDepotPadrao(operacoes);

    const problema = montarProblema({ operacoes, veiculos, depot, agora: new Date() });
    const maxTime = Math.min(Math.max(numero(corpo.maxTimeSeconds) || 8, 2), 30);

    let solucao;
    try {
      solucao = JSON.parse(await solvePragmatic(problema, [], { termination: { maxTime } }));
    } catch (erro) {
      console.error("To Do Green dispatch solve error", erro);
      return json({ error: "Não foi possível calcular a roteirização." }, 502);
    }

    // O solver decide a sequência por VEÍCULO; motorista é atribuído 1:1 na
    // ordem de chegada, entre quem está disponível agora.
    const filaMotoristas = [...motoristas];
    const tours = (solucao.tours || []).map((tour) => {
      const veiculoId = tour.vehicleId;
      const veiculo = veiculos.find((v) => v.id === veiculoId);
      const motorista = filaMotoristas.shift() || null;
      const paradas = (tour.stops || [])
        .flatMap((stop) => (stop.activities || []).map((a) => a.jobId))
        .filter((jobId) => jobId && jobId !== "departure" && jobId !== "arrival");
      return {
        veiculoId, placa: veiculo?.plate || "", prefixo: veiculo?.prefix || "",
        motoristaId: motorista?.id || "", motoristaNome: motorista?.full_name || "",
        operacoes: [...new Set(paradas)],
      };
    });

    return json({
      tours,
      naoAtribuidas: (solucao.unassigned || []).map((u) => u.jobId),
      estatistica: solucao.statistic,
    });
  }

  if (request.method === "POST" && acao === "aplicar") {
    const corpo = await request.json().catch(() => ({}));
    const atribuicoes = Array.isArray(corpo.atribuicoes) ? corpo.atribuicoes : [];
    if (!atribuicoes.length) return json({ error: "Nenhuma atribuição para aplicar." }, 400);

    const agora = new Date().toISOString();
    let aplicados = 0;
    for (const item of atribuicoes) {
      const operationId = String(item.operationId || "");
      if (!operationId) continue;
      const resultado = await env.DB.prepare(
        `UPDATE todogreen_client_operations
            SET driver_id = ?, driver_name = ?, vehicle_plate = ?, updated_at = ?
          WHERE id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
      ).bind(
        String(item.driverId || ""), String(item.driverName || ""), String(item.vehiclePlate || ""),
        agora, operationId, access.ownerId,
      ).run();
      if (resultado.meta.changes > 0) aplicados += 1;
    }

    return json({ aplicados });
  }

  return json({ error: "Rota de despacho não encontrada." }, 404);
}
