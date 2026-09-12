// ===== Adaptador de despacho multi-veículo para VROOM =====
//
// Mantém IDs internos do VROOM numéricos e preserva os IDs reais do ERP em
// mapas locais. As capacidades usam quatro dimensões: peso, volume, pallets e
// pacotes. Métrica sem capacidade cadastrada não bloqueia a solução.

const UNKNOWN_CAPACITY = 1_000_000_000;
const DEFAULT_STOP_DURATION_S = 600;
const DEFAULT_SHIFT_HOURS = 8;

const positivo = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const parseFields = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const primeiraPositiva = (...values) => {
  for (const value of values) {
    const n = positivo(value);
    if (n > 0) return n;
  }
  return 0;
};

const inteiroEscalado = (value, factor = 1) =>
  Math.max(0, Math.round(positivo(value) * factor));

export function demandaDaOperacao(op) {
  const fields = parseFields(op?.fields_json ?? op?.fields);
  const weightKg = primeiraPositiva(
    fields.weightKg, fields.pesoKg, fields.peso_kg, fields.peso,
  );
  const volumeM3 = primeiraPositiva(
    fields.volumeM3, fields.volume_m3, fields.cubagemM3, fields.cubagem,
  );
  const pallets = primeiraPositiva(
    fields.pallets, fields.paletes, fields.pallet,
  );
  const packages = primeiraPositiva(
    fields.packages, fields.pacotes, fields.volumes,
  );

  // Peso em gramas e volume em litros para não perder casas decimais, pois
  // quantidades do VROOM são inteiras.
  return [
    inteiroEscalado(weightKg, 1000),
    inteiroEscalado(volumeM3, 1000),
    inteiroEscalado(pallets),
    Math.max(1, inteiroEscalado(packages)),
  ];
}

export function capacidadeDoVeiculo(vehicle) {
  const payloadKg = positivo(vehicle?.payload_kg ?? vehicle?.payloadKg);
  const volumeM3 = positivo(vehicle?.volume_m3 ?? vehicle?.volumeM3);
  const pallets = positivo(vehicle?.pallet_capacity ?? vehicle?.palletCapacity);

  return [
    payloadKg > 0 ? inteiroEscalado(payloadKg, 1000) : UNKNOWN_CAPACITY,
    volumeM3 > 0 ? inteiroEscalado(volumeM3, 1000) : UNKNOWN_CAPACITY,
    pallets > 0 ? inteiroEscalado(pallets) : UNKNOWN_CAPACITY,
    UNKNOWN_CAPACITY,
  ];
}

// ===== Habilidades (skills): casar veículo ↔ carga =====
//
// Capacidade (peso/volume/pallets) já barra carga grande demais. Mas muita
// carga exige um TIPO de veículo — refrigerado, baú, moto para expresso — que
// nenhuma dimensão numérica captura. O VROOM resolve isso com `skills`
// inteiras: um veículo só atende uma parada se possuir TODAS as habilidades
// que a parada exige. Aqui a restrição é DORMENTE: só entra quando a operação
// declara explicitamente uma exigência (nada declarado ⇒ qualquer veículo
// serve, sem regressão). Assim não depende de migração nem de recadastro —
// a exigência vive no fields_json que já existe, e a habilidade do veículo sai
// da `category` cadastrada + fields_json.skills.

const semAcento = (valor) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

const tokensDeLista = (valor) => {
  if (Array.isArray(valor)) return valor.map(semAcento).filter(Boolean);
  if (typeof valor === "string") return valor.split(/[,;/|]+/).map(semAcento).filter(Boolean);
  return [];
};

// O que a CARGA exige — apenas exigências explícitas nos campos da operação.
export function habilidadesExigidas(op) {
  const fields = parseFields(op?.fields_json ?? op?.fields);
  const tokens = new Set([
    ...tokensDeLista(fields.requiredSkills ?? fields.habilidadesExigidas),
    ...tokensDeLista(fields.requiredVehicleClass ?? fields.vehicleClass ?? fields.classeVeiculo),
  ]);
  if (fields.requiresRefrigeration === true || fields.refrigerado === true) tokens.add("refrigerado");
  return [...tokens];
}

// O que o VEÍCULO sabe fazer — união da categoria cadastrada com as skills
// declaradas no fields_json. Ser generoso aqui é seguro: skill sobrando no
// veículo não muda nada; skill faltando é o que restringe.
export function habilidadesDoVeiculo(vehicle) {
  const fields = parseFields(vehicle?.fields_json ?? vehicle?.fields);
  const tokens = new Set([
    ...tokensDeLista(fields.skills ?? fields.habilidades),
    ...tokensDeLista(vehicle?.category),
  ]);
  return [...tokens];
}

// Registro string→inteiro compartilhado no MESMO problema: o VROOM exige ids
// inteiros e o casamento só funciona se veículo e parada usarem o mesmo id
// para o mesmo token. Ordem de atribuição não importa — só a consistência.
const criarRegistroHabilidades = () => {
  const mapa = new Map();
  return (token) => {
    if (!mapa.has(token)) mapa.set(token, mapa.size + 1);
    return mapa.get(token);
  };
};

const coord = (lat, lng) => {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return [longitude, latitude];
};

const epochSeconds = (date) => Math.floor(date.getTime() / 1000);

// O prazo de entrega (promised_at) vira uma JANELA DE TEMPO por parada:
// [início do turno, prazo], limitada ao fim do turno. Sem prazo — ou prazo já
// vencido em relação ao início — não impõe janela (a parada continua
// roteirizável, em vez de sumir do plano). É o que faz "entregar até as 12h"
// ser respeitado no despacho, em vez de ignorado.
export const janelaDeEntrega = (op, inicio, fim) => {
  const bruto = op?.promised_at ?? op?.promisedAt;
  if (!bruto) return null;
  const prazo = new Date(bruto);
  if (!Number.isFinite(prazo.getTime())) return null;
  const limite = epochSeconds(prazo);
  if (limite <= inicio) return null;
  return [[inicio, Math.min(limite, fim)]];
};

export function montarProblemaVroomDespacho({
  operacoes = [],
  veiculos = [],
  depot,
  agora = new Date(),
} = {}) {
  const depotCoord = coord(depot?.lat, depot?.lng);
  if (!depotCoord) return { ok: false, motivo: "Depósito inválido para roteirização." };
  if (!Array.isArray(operacoes) || !operacoes.length)
    return { ok: false, motivo: "Nenhuma operação para roteirizar." };
  if (!Array.isArray(veiculos) || !veiculos.length)
    return { ok: false, motivo: "Nenhum veículo disponível." };

  const startAt = agora instanceof Date ? agora : new Date(agora);
  if (!Number.isFinite(startAt.getTime()))
    return { ok: false, motivo: "Horário de início inválido." };
  const inicio = epochSeconds(startAt);
  const fim = inicio + DEFAULT_SHIFT_HOURS * 3600;

  const idDaHabilidade = criarRegistroHabilidades();

  const vehicleByVroomId = new Map();
  const operationByTaskId = new Map();
  const vehicles = veiculos.map((vehicle, index) => {
    const id = index + 1;
    vehicleByVroomId.set(id, vehicle);
    const skills = habilidadesDoVeiculo(vehicle).map(idDaHabilidade);
    return {
      id,
      description: String(vehicle.id || vehicle.plate || id),
      start: depotCoord,
      end: depotCoord,
      capacity: capacidadeDoVeiculo(vehicle),
      time_window: [inicio, fim],
      ...(skills.length ? { skills } : {}),
    };
  });

  let taskId = 1;
  const jobs = [];
  const shipments = [];

  for (const operation of operacoes) {
    const delivery = coord(operation.delivery_lat, operation.delivery_lng);
    if (!delivery) continue;

    const operationId = String(operation.id || "");
    const demand = demandaDaOperacao(operation);
    const pickup = coord(operation.pickup_lat, operation.pickup_lng);
    const janela = janelaDeEntrega(operation, inicio, fim);
    const skills = habilidadesExigidas(operation).map(idDaHabilidade);
    const restricao = skills.length ? { skills } : {};

    if (pickup) {
      const pickupId = taskId++;
      const deliveryId = taskId++;
      operationByTaskId.set(pickupId, { operationId, tipo: "coleta" });
      operationByTaskId.set(deliveryId, { operationId, tipo: "entrega" });
      shipments.push({
        amount: demand,
        ...restricao,
        pickup: {
          id: pickupId,
          location: pickup,
          service: DEFAULT_STOP_DURATION_S,
          description: operationId,
        },
        delivery: {
          id: deliveryId,
          location: delivery,
          service: DEFAULT_STOP_DURATION_S,
          description: operationId,
          ...(janela ? { time_windows: janela } : {}),
        },
      });
    } else {
      const id = taskId++;
      operationByTaskId.set(id, { operationId, tipo: "entrega" });
      jobs.push({
        id,
        location: delivery,
        service: DEFAULT_STOP_DURATION_S,
        delivery: demand,
        description: operationId,
        ...restricao,
        ...(janela ? { time_windows: janela } : {}),
      });
    }
  }

  if (!jobs.length && !shipments.length)
    return { ok: false, motivo: "Nenhuma operação possui coordenadas válidas." };

  return {
    ok: true,
    payload: { vehicles, jobs, shipments },
    contexto: { vehicleByVroomId, operationByTaskId },
  };
}

const unique = (values) => [...new Set(values.filter(Boolean))];

export function interpretarDespachoVroom({
  resposta,
  contexto,
  motoristas = [],
} = {}) {
  if (!resposta || Number(resposta.code || 0) !== 0) {
    return {
      ok: false,
      motivo: resposta?.error || "O VROOM não devolveu uma solução válida.",
    };
  }

  const routes = Array.isArray(resposta.routes) ? resposta.routes : [];
  const unassigned = Array.isArray(resposta.unassigned) ? resposta.unassigned : [];
  const vehicleByVroomId = contexto?.vehicleByVroomId;
  const operationByTaskId = contexto?.operationByTaskId;
  if (!(vehicleByVroomId instanceof Map) || !(operationByTaskId instanceof Map))
    return { ok: false, motivo: "Contexto interno da otimização inválido." };

  const filaMotoristas = [...motoristas];
  const tours = routes
    .map((route) => {
      const vehicle = vehicleByVroomId.get(Number(route.vehicle));
      if (!vehicle) return null;
      const paradas = [];
      const vistas = new Set();
      for (const step of Array.isArray(route.steps) ? route.steps : []) {
        if (!["job", "pickup", "delivery"].includes(step?.type)) continue;
        const taskId = Number(step.id ?? step.job);
        const metadata = operationByTaskId.get(taskId);
        const operationId = metadata?.operationId || String(step.description || "");
        const tipo = metadata?.tipo || (step.type === "pickup" ? "coleta" : "entrega");
        const chave = `${operationId}:${tipo}`;
        if (!operationId || vistas.has(chave)) continue;
        vistas.add(chave);
        paradas.push({ operationId, tipo });
      }
      const operations = unique(paradas.map((parada) => parada.operationId));
      if (!operations.length) return null;

      const driver = filaMotoristas.shift() || null;
      return {
        veiculoId: vehicle.id,
        placa: vehicle.plate || "",
        prefixo: vehicle.prefix || "",
        motoristaId: driver?.id || "",
        motoristaNome: driver?.full_name || "",
        operacoes: operations,
        paradas,
        distanciaKm: Number.isFinite(Number(route.distance))
          ? Math.round((Number(route.distance) / 1000) * 10) / 10
          : null,
        duracaoMin: Number.isFinite(Number(route.duration))
          ? Math.round(Number(route.duration) / 60)
          : null,
        custoOtimizacao: Number(route.cost || 0),
      };
    })
    .filter(Boolean);

  const naoAtribuidas = unique(
    unassigned.map((task) => {
      const taskId = Number(task?.id ?? task?.job);
      return operationByTaskId.get(taskId)?.operationId || String(task?.description || "");
    }),
  );

  return {
    ok: true,
    tours,
    naoAtribuidas,
    estatistica: resposta.summary || {},
    motor: "vroom",
    provider: "self_hosted",
  };
}
