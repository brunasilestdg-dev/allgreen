// ===== Seleção de motor de roteamento (OSRM x Valhalla) =====
// Camada PURA. Sem banco, sem rede, sem DOM, sem IA.
//
// Arquitetura de motores especializados (seção 1):
//
//  - VROOM fica ACIMA: decide QUEM atende, em QUE sequência, com QUAL veículo
//    (otimização de frota). Não é escolhido aqui.
//  - O MOTOR DE ROTA decide POR ONDE passar. É o que este arquivo seleciona.
//
// Regra de seleção:
//    moto / carro         -> OSRM (perfil genérico basta)
//    van                  -> OSRM, salvo restrição física -> Valhalla
//    VUC / 3-4 / toco /
//    truck / carreta      -> Valhalla (truck costing, restrições viárias)
//
// A UI NUNCA chama OSRM/Valhalla direto. Ela pede uma rota ao backend, e é o
// backend que resolve o motor com esta função — trocando o provider sem tocar
// na tela. Por isso a seleção é pura e independente de rede/infra.
//
// Fallback seguro (seção 34): Valhalla fora do ar só cai para outro motor se
// for TECNICAMENTE SEGURO. Um pesado que precisa de restrições viárias NÃO
// pode cair num perfil genérico de carro — isso mandaria um caminhão por uma
// ponte de 2,2 m. Nesse caso a resposta é "sem motor seguro", com o motivo,
// para o operador decidir — nunca uma rota silenciosamente insegura.

export const ROUTING_ENGINES = Object.freeze({ OSRM: "osrm", VALHALLA: "valhalla" });

const LIGHT = new Set(["moto", "motorcycle", "moped", "bike", "car", "carro", "hatch", "sedan", "suv", "pickup", "utilitario"]);
const VAN = new Set(["van", "furgao", "furgão", "kombi", "fiorino"]);
const HEAVY = new Set([
  "vuc", "3/4", "34", "tres_quartos", "toco", "truck", "caminhao", "caminhão",
  "truck34", "bitruck", "carreta", "semi", "cavalo", "romeu", "julieta", "bitrem", "rodotrem",
]);

const norm = (v) => String(v ?? "").trim().toLowerCase().replaceAll(" ", "_");

export function classifyVehicle(vehicle = {}) {
  const cat = norm(vehicle.category ?? vehicle.classe ?? vehicle.class ?? vehicle.type);
  if (HEAVY.has(cat)) return "heavy";
  if (VAN.has(cat)) return "van";
  if (LIGHT.has(cat)) return "light";
  return "unknown";
}

// O veículo precisa de roteamento CIENTE DE RESTRIÇÕES quando é pesado ou
// quando declara qualquer limite físico relevante para a malha viária.
export function requiresRestrictionAware(vehicle = {}) {
  if (classifyVehicle(vehicle) === "heavy") return true;
  const n = (x) => {
    const v = Number(x);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const hasDimension = n(vehicle.heightM ?? vehicle.maxHeightM)
    || n(vehicle.widthM ?? vehicle.maxWidthM)
    || n(vehicle.lengthM ?? vehicle.maxLengthM)
    || n(vehicle.grossWeightKg ?? vehicle.pbtKg ?? vehicle.maxWeightKg);
  if (hasDimension) return true;
  return vehicle.hazmat === true || vehicle.requiresRestrictionAware === true;
}

// Motor preferido, ignorando disponibilidade.
export function preferredRoutingEngine(vehicle = {}) {
  const klass = classifyVehicle(vehicle);
  if (klass === "heavy") return ROUTING_ENGINES.VALHALLA;
  if (requiresRestrictionAware(vehicle)) return ROUTING_ENGINES.VALHALLA;
  // van sem restrição, light e unknown: OSRM (perfil genérico é seguro).
  return ROUTING_ENGINES.OSRM;
}

// Perfil/costing por motor + veículo.
function profileFor(engine, vehicle) {
  if (engine === ROUTING_ENGINES.VALHALLA) {
    return requiresRestrictionAware(vehicle) ? "truck" : "auto";
  }
  const klass = classifyVehicle(vehicle);
  if (klass === "light" && ["moto", "motorcycle", "moped"].includes(norm(vehicle.category)))
    return "motorcycle";
  return "driving";
}

/**
 * Resolve o motor de rota para um veículo, dado o conjunto de motores
 * DISPONÍVEIS (saudáveis/configurados). `available` é uma lista/set de ids
 * (ROUTING_ENGINES). Devolve o motor, o perfil, se é ciente de restrições,
 * se houve fallback e o motivo.
 */
export function selectRoutingEngine(vehicle = {}, options = {}) {
  const availableList = options.available ?? [ROUTING_ENGINES.OSRM, ROUTING_ENGINES.VALHALLA];
  const available = new Set(Array.isArray(availableList) ? availableList : [...availableList]);
  const requested = preferredRoutingEngine(vehicle);
  const restrictionAware = requiresRestrictionAware(vehicle);

  const build = (engine, { fallback = false, reason = "" } = {}) => ({
    engine,
    profile: engine ? profileFor(engine, vehicle) : "",
    requested,
    restrictionAware,
    fallback,
    reason,
    vehicleClass: classifyVehicle(vehicle),
  });

  if (available.has(requested)) return build(requested);

  // Preferido indisponível — decidir fallback SEGURO.
  if (requested === ROUTING_ENGINES.VALHALLA) {
    // Só é seguro cair para OSRM se o veículo NÃO precisar de restrições.
    if (!restrictionAware && available.has(ROUTING_ENGINES.OSRM))
      return build(ROUTING_ENGINES.OSRM, { fallback: true, reason: "valhalla_indisponivel_osrm_seguro" });
    return {
      engine: null,
      profile: "",
      requested,
      restrictionAware,
      fallback: false,
      reason: "sem_motor_seguro_para_restricoes",
      vehicleClass: classifyVehicle(vehicle),
    };
  }

  // Preferido era OSRM (veículo leve/van sem restrição). Valhalla atende o
  // caso genérico com segurança (é um superconjunto), então é fallback válido.
  if (available.has(ROUTING_ENGINES.VALHALLA))
    return build(ROUTING_ENGINES.VALHALLA, { fallback: true, reason: "osrm_indisponivel_valhalla_seguro" });

  return {
    engine: null,
    profile: "",
    requested,
    restrictionAware,
    fallback: false,
    reason: "nenhum_motor_disponivel",
    vehicleClass: classifyVehicle(vehicle),
  };
}

export const __test__ = { LIGHT, VAN, HEAVY, profileFor };
