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

import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { optimizeTodoGreenRouting } from "./todogreen-public-routing-api.js";
import {
  interpretarDespachoVroom,
  montarProblemaVroomDespacho,
} from "./todogreen-dispatch-vroom.js";

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
const texto = (valor, max = 500) => String(valor ?? "").trim().slice(0, max);
const coordenada = (valor) => valor === null || valor === undefined || valor === "" ? null : numero(valor);
const parse = (valor, fallback) => { try { return JSON.parse(valor || ""); } catch { return fallback; } };

const DEFAULT_SPEED_MS = 40 / 3.6; // 40 km/h em m/s — velocidade média urbana/mista, ajustável depois por perfil
const DEFAULT_SHIFT_HOURS = 8;
const DEFAULT_STOP_DURATION_S = 600; // 10 min por parada — coleta ou entrega

const carregarCandidatos = async (env, access) => {
  const [operacoes, motoristas, veiculos] = await Promise.all([
    env.DB.prepare(
      `SELECT o.id, o.client_id, o.driver_id, o.vehicle_plate, o.delivery_lat, o.delivery_lng,
              o.pickup_lat, o.pickup_lng, o.reference, o.service_date, o.origin, o.destination,
              o.fields_json, c.name AS client_name
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
      `SELECT id, prefix, plate, pallet_capacity, payload_kg, volume_m3 FROM todogreen_fleet_vehicles
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
    const campos = parse(op.fields_json, {});
    const demanda = Math.max(1, Number(campos.packages ?? campos.pacotes) || 1);
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

const tipoDaAtividade = (atividade) => {
  const tipo = texto(atividade?.type, 30).toLowerCase();
  if (tipo.includes("pickup")) return "coleta";
  if (tipo.includes("delivery")) return "entrega";
  return "entrega";
};

// Preserva a sequência real devolvida pelo solver. Antes ela era achatada em
// ids de operação e perdia a diferença entre coleta e entrega, o que tornava
// impossível a rota acompanhar os eventos feitos pelo motorista.
export const paradasDaTour = (tour, operacoes = []) => {
  const porId = new Map(operacoes.map((op) => [String(op.id), op]));
  const paradas = [];
  for (const stop of tour?.stops || []) {
    for (const atividade of stop?.activities || []) {
      const operationId = texto(atividade?.jobId, 120);
      const operacao = porId.get(operationId);
      if (!operationId || !operacao) continue;
      const tipo = tipoDaAtividade(atividade);
      const coleta = tipo === "coleta";
      const lat = coordenada(coleta ? operacao.pickup_lat : operacao.delivery_lat);
      const lng = coordenada(coleta ? operacao.pickup_lng : operacao.delivery_lng);
      const referencia = texto(operacao.reference || operacao.client_name || operationId, 200);
      const endereco = texto(coleta ? operacao.origin : operacao.destination, 300);
      paradas.push({
        ordem: paradas.length + 1,
        operationId,
        tipo,
        rotulo: `${coleta ? "Coleta" : "Entrega"} · ${referencia}`,
        endereco: endereco || referencia,
        lat,
        lng,
        recarga: false,
        concluida: false,
      });
    }
  }
  return paradas;
};

const idsDaTour = (tour) => [...new Set([
  ...(Array.isArray(tour?.operacoes) ? tour.operacoes : []),
  ...(Array.isArray(tour?.paradas) ? tour.paradas.map((p) => p?.operationId) : []),
].map((id) => texto(id, 120)).filter(Boolean))];

const idDaRota = async (ownerId, planId, indice) => {
  const bytes = new TextEncoder().encode(`${ownerId}:${planId}:${indice}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `dispatch-${hex.slice(0, 32)}`;
};

const paradasAutoritativas = (tour, operacoes) => {
  const porId = new Map(operacoes.map((op) => [String(op.id), op]));
  const vistas = new Set();
  const candidatas = Array.isArray(tour?.paradas) ? tour.paradas : [];
  const origem = candidatas.length
    ? candidatas
    : idsDaTour(tour).map((operationId) => ({ operationId, tipo: "entrega" }));
  const paradas = [];
  for (const candidata of origem) {
    const operationId = texto(candidata?.operationId, 120);
    const operacao = porId.get(operationId);
    const tipo = texto(candidata?.tipo, 30).toLowerCase() === "coleta" ? "coleta" : "entrega";
    const chave = `${operationId}:${tipo}`;
    if (!operacao || vistas.has(chave)) continue;
    vistas.add(chave);
    const coleta = tipo === "coleta";
    const referencia = texto(operacao.reference || operacao.client_name || operationId, 200);
    const endereco = texto(coleta ? operacao.origin : operacao.destination, 300);
    paradas.push({
      ordem: paradas.length + 1,
      operationId,
      tipo,
      rotulo: `${coleta ? "Coleta" : "Entrega"} · ${referencia}`,
      endereco: endereco || referencia,
      lat: coordenada(coleta ? operacao.pickup_lat : operacao.delivery_lat),
      lng: coordenada(coleta ? operacao.pickup_lng : operacao.delivery_lng),
      recarga: false,
      concluida: false,
    });
  }
  return paradas;
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
        referencia: op.reference || "", dataServico: op.service_date || "",
        origem: op.origin || "", destino: op.destination || "",
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
    const operacoes = idsFiltro ? todasOperacoes.filter((op) => idsFiltro.has(String(op.id))) : todasOperacoes;

    if (!operacoes.length) return json({ error: "Nenhuma operação pendente com coordenada de entrega para despachar." }, 400);
    if (!veiculos.length) return json({ error: "Nenhum veículo disponível para o despacho." }, 400);

    const depot = corpo.depot && numero(corpo.depot.lat) != null && numero(corpo.depot.lng) != null
      ? { lat: numero(corpo.depot.lat), lng: numero(corpo.depot.lng) }
      : calcularDepotPadrao(operacoes);

    const agora = new Date();
    const problemaVroom = montarProblemaVroomDespacho({
      operacoes,
      veiculos,
      depot,
      agora,
    });

    if (problemaVroom.ok) {
      try {
        const respostaVroom = await optimizeTodoGreenRouting(problemaVroom.payload, env);
        const corpoVroom = await respostaVroom.json().catch(() => null);
        if (respostaVroom.ok && corpoVroom) {
          const interpretada = interpretarDespachoVroom({
            resposta: corpoVroom,
            contexto: problemaVroom.contexto,
            motoristas,
          });
          if (interpretada.ok) {
            return json({ ...interpretada, planId: crypto.randomUUID() });
          }
          console.warn("To Do Green VROOM dispatch invalid solution", interpretada.motivo);
        } else {
          console.warn(
            "To Do Green VROOM dispatch unavailable",
            respostaVroom.status,
            corpoVroom?.error || corpoVroom?.message || "",
          );
        }
      } catch (erro) {
        console.warn("To Do Green VROOM dispatch fallback", erro);
      }
    } else {
      console.warn("To Do Green VROOM dispatch input fallback", problemaVroom.motivo);
    }

    // Contingência sem dependência de rede: preserva o solver WASM quando o
    // host VROOM não estiver configurado ou ficar temporariamente indisponível.
    const problema = montarProblema({ operacoes, veiculos, depot, agora });
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
      const paradas = paradasDaTour(tour, operacoes);
      const ids = [...new Set(paradas.map((parada) => parada.operationId))];
      const distanciaMetros = Math.max(0, numero(tour.statistic?.distance) || 0);
      const duracaoSegundos = Math.max(0, numero(tour.statistic?.duration) || 0);
      return {
        veiculoId, placa: veiculo?.plate || "", prefixo: veiculo?.prefix || "",
        motoristaId: motorista?.id || "", motoristaNome: motorista?.full_name || "",
        operacoes: ids,
        paradas,
        distanciaKm: Math.round((distanciaMetros / 1000) * 100) / 100,
        duracaoMin: Math.round(duracaoSegundos / 60),
      };
    });

    return json({
      planId: crypto.randomUUID(),
      tours,
      naoAtribuidas: (solucao.unassigned || []).map((u) => u.jobId),
      estatistica: solucao.statistic,
      motor: "worker_vrp_fallback",
      provider: "native",
    });
  }

  if (request.method === "POST" && acao === "aplicar") {
    const corpo = await request.json().catch(() => ({}));
    const tours = Array.isArray(corpo.tours)
      ? corpo.tours.filter((tour) => texto(tour?.motoristaId, 120) && idsDaTour(tour).length)
      : [];

    // Fluxo novo: o plano vira rota persistida e reserva motorista + veículo
    // no MESMO batch que liga as operações. A UI antiga ainda pode mandar
    // `atribuicoes` logo abaixo, para uma atualização sem janela de quebra.
    if (tours.length) {
      const planId = texto(corpo.planId, 80);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(planId))
        return json({ error: "Plano de despacho inválido. Otimize as rotas novamente." }, 400);

      const rotasIds = await Promise.all(tours.map((_, indice) => idDaRota(access.ownerId, planId, indice)));
      const existentes = [];
      for (const rotaId of rotasIds) {
        existentes.push(await env.DB.prepare(
          "SELECT id, workspace_owner_id FROM todogreen_routes WHERE id = ?",
        ).bind(rotaId).first());
      }
      const existentesNoEspaco = existentes.filter((rota) => rota?.workspace_owner_id === access.ownerId);
      if (existentesNoEspaco.length === tours.length) {
        return json({
          aplicados: tours.reduce((total, tour) => total + idsDaTour(tour).length, 0),
          rotasCriadas: 0,
          rotas: rotasIds,
          reaplicado: true,
        });
      }
      if (existentes.some(Boolean))
        return json({ error: "O plano ficou inconsistente. Otimize as rotas novamente." }, 409);

      const motoristasUsados = new Set();
      const veiculosUsados = new Set();
      const operacoesUsadas = new Set();
      const preparadas = [];

      for (let indice = 0; indice < tours.length; indice += 1) {
        const tour = tours[indice];
        const motoristaId = texto(tour.motoristaId, 120);
        const veiculoId = texto(tour.veiculoId, 120);
        if (motoristasUsados.has(motoristaId) || veiculosUsados.has(veiculoId))
          return json({ error: "Motorista ou veículo repetido em mais de uma rota do plano." }, 409);
        motoristasUsados.add(motoristaId);
        veiculosUsados.add(veiculoId);

        const motorista = await env.DB.prepare(
          `SELECT id, full_name FROM todogreen_drivers
            WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND status = 'active'
              AND availability_status = 'available' AND archived_at IS NULL`,
        ).bind(motoristaId, TENANT_ID, access.ownerId).first();
        if (!motorista) return json({ error: "Um motorista do plano não está mais disponível. Otimize novamente." }, 409);

        const veiculo = await env.DB.prepare(
          `SELECT id, prefix, plate FROM todogreen_fleet_vehicles
            WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND status = 'available'
              AND archived_at IS NULL`,
        ).bind(veiculoId, TENANT_ID, access.ownerId).first();
        if (!veiculo) return json({ error: "Um veículo do plano não está mais disponível. Otimize novamente." }, 409);

        const ids = idsDaTour(tour);
        const operacoes = [];
        for (const operationId of ids) {
          if (operacoesUsadas.has(operationId))
            return json({ error: "A mesma operação apareceu em mais de uma rota do plano." }, 409);
          operacoesUsadas.add(operationId);
          const operacao = await env.DB.prepare(
            `SELECT o.*, c.name AS client_name FROM todogreen_client_operations o
              LEFT JOIN todogreen_clients c ON c.id = o.client_id AND c.workspace_owner_id = o.workspace_owner_id
              WHERE o.id = ? AND o.tenant_id = ? AND o.workspace_owner_id = ? AND o.archived_at IS NULL
                AND o.delivered_at IS NULL AND (o.driver_id = '' OR o.driver_id IS NULL)
                AND (o.route_id = '' OR o.route_id IS NULL)`,
          ).bind(operationId, TENANT_ID, access.ownerId).first();
          if (!operacao)
            return json({ error: "Uma operação do plano já foi atribuída ou não está mais disponível. Otimize novamente." }, 409);
          operacoes.push(operacao);
        }

        const paradas = paradasAutoritativas(tour, operacoes);
        if (!paradas.length || ids.some((operationId) => !paradas.some((p) => p.operationId === operationId)))
          return json({ error: "A sequência de uma rota não corresponde às operações do plano." }, 400);
        const datas = operacoes.map((op) => texto(op.service_date, 10)).filter(Boolean).sort();
        preparadas.push({
          id: rotasIds[indice],
          motorista,
          veiculo,
          operacoes,
          paradas,
          dataServico: datas[0] || new Date().toISOString().slice(0, 10),
          distanciaKm: Math.max(0, numero(tour.distanciaKm) || 0),
          duracaoMin: Math.max(0, numero(tour.duracaoMin) || 0),
        });
      }

      const agora = new Date().toISOString();
      const instrucoes = [];
      for (const rota of preparadas) {
        const primeira = rota.paradas[0];
        const ultima = rota.paradas[rota.paradas.length - 1];
        instrucoes.push(env.DB.prepare(
          `INSERT INTO todogreen_routes
             (id,tenant_id,workspace_owner_id,name,driver_id,driver_name,vehicle_plate,service_date,status,
              origin,destination,distance_km,duration_min,toll_total,stops_json,notes,revision,
              created_by,updated_by,created_at,updated_at,archived_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'',1,?,?,?,?,NULL)`,
        ).bind(
          rota.id, TENANT_ID, access.ownerId,
          `Despacho ${rota.dataServico} · ${rota.motorista.full_name}`,
          rota.motorista.id, rota.motorista.full_name, rota.veiculo.plate, rota.dataServico, "planejada",
          primeira.endereco, ultima.endereco, rota.distanciaKm, rota.duracaoMin, 0,
          JSON.stringify(rota.paradas), user.id, user.id, agora, agora,
        ));
        for (const operacao of rota.operacoes) {
          const ordem = rota.paradas.find((parada) => parada.operationId === operacao.id)?.ordem || null;
          instrucoes.push(env.DB.prepare(
            `UPDATE todogreen_client_operations
                SET route_id = ?, route_stop_order = ?, driver_id = ?, driver_name = ?, vehicle_plate = ?,
                    revision = revision + 1, updated_by = ?, updated_at = ?
              WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
                AND (driver_id = '' OR driver_id IS NULL) AND (route_id = '' OR route_id IS NULL)`,
          ).bind(
            rota.id, ordem, rota.motorista.id, rota.motorista.full_name, rota.veiculo.plate,
            user.id, agora, operacao.id, TENANT_ID, access.ownerId,
          ));
        }
        instrucoes.push(env.DB.prepare(
          `UPDATE todogreen_drivers
              SET availability_status = 'allocated', revision = revision + 1, updated_by = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND availability_status = 'available'`,
        ).bind(user.id, agora, rota.motorista.id, TENANT_ID, access.ownerId));
        instrucoes.push(env.DB.prepare(
          `UPDATE todogreen_fleet_vehicles
              SET status = 'in-operation', revision = revision + 1, updated_by = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND status = 'available'`,
        ).bind(user.id, agora, rota.veiculo.id, TENANT_ID, access.ownerId));
      }
      await env.DB.batch(instrucoes);
      return json({
        aplicados: operacoesUsadas.size,
        rotasCriadas: preparadas.length,
        rotas: preparadas.map((rota) => rota.id),
      });
    }

    const atribuicoes = Array.isArray(corpo.atribuicoes) ? corpo.atribuicoes : [];
    if (!atribuicoes.length) return json({ error: "Nenhuma atribuição para aplicar." }, 400);

    const agora = new Date().toISOString();
    let aplicados = 0;
    for (const item of atribuicoes) {
      const operationId = String(item.operationId || "");
      if (!operationId) continue;
      const resultado = await env.DB.prepare(
        `UPDATE todogreen_client_operations
            SET driver_id = ?, driver_name = ?, vehicle_plate = ?, revision = revision + 1,
                updated_by = ?, updated_at = ?
          WHERE id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
      ).bind(
        String(item.driverId || ""), String(item.driverName || ""), String(item.vehiclePlate || ""),
        user.id, agora, operationId, access.ownerId,
      ).run();
      if (resultado.meta.changes > 0) aplicados += 1;
    }

    return json({ aplicados });
  }

  return json({ error: "Rota de despacho não encontrada." }, 404);
}
