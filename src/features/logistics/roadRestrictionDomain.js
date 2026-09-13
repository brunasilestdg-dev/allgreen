// ===== Restrições viárias (OpenStreetMap) x veículo =====
// Camada PURA e DETERMINÍSTICA. Sem banco, sem rede, sem DOM, sem IA.
//
// Seção 2: a malha viária não é só desenho de mapa — ela carrega restrições
// (maxheight, maxweight, maxwidth, maxlength, hgv, access, bridge, tunnel).
// Estas tags precisam influenciar roteirização, viabilidade e pré-flight. O
// sistema tem de conseguir dizer "a rota mais curta é INCOMPATÍVEL com este
// veículo" e escolher uma alternativa, REGISTRANDO O MOTIVO (altura, peso,
// ponte, HGV proibido...).
//
// Este módulo é o núcleo dessa decisão: dado o perfil físico do veículo e os
// segmentos de uma rota (com suas tags OSM), diz o que é compatível e por quê.
// Não consulta Overpass por entrega (seção 2): recebe segmentos já resolvidos
// (grafo local / PostGIS / lote) e decide em memória.
//
// Convenção de unidades OSM: maxheight/maxwidth/maxlength em METROS; maxweight
// em TONELADAS. Aceitamos valores com unidade textual ("3.5 m", "7.5 t") e
// convertemos peso para kg internamente para comparar com o PBT do veículo.

const finite = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Extrai o número de uma tag OSM que pode vir "3.5", "3.5 m", "12'6\"" (raro).
// Só tratamos metros/toneladas numéricos (o comum no Brasil); com unidade
// imperial explícita, devolvemos null (não chutamos conversão).
export function parseOsmMeasure(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  if (s.includes("'") || s.includes('"') || s.includes("ft") || s.includes("lb")) return null;
  const m = s.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  return Number(m[0].replace(",", "."));
}

const truthyNo = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "no" || s === "private" || s === "false" || s === "0";
};

// Perfil físico do veículo (o que a malha restringe).
export function vehiclePhysical(vehicle = {}) {
  const weightKg = finite(vehicle.grossWeightKg ?? vehicle.pbtKg ?? vehicle.maxWeightKg ?? vehicle.pesoBrutoKg);
  return {
    heightM: finite(vehicle.heightM ?? vehicle.alturaM ?? vehicle.maxHeightM),
    widthM: finite(vehicle.widthM ?? vehicle.larguraM ?? vehicle.maxWidthM),
    lengthM: finite(vehicle.lengthM ?? vehicle.comprimentoM ?? vehicle.maxLengthM),
    weightKg,
    hazmat: vehicle.hazmat === true,
    isHgv: ["truck", "caminhao", "caminhão", "carreta", "vuc", "toco", "bitruck", "semi"]
      .includes(String(vehicle.category ?? vehicle.classe ?? "").trim().toLowerCase())
      || vehicle.isHgv === true,
  };
}

/**
 * Compatibilidade de UM segmento com o veículo. Devolve { compatible, reasons }.
 * reasons: height_exceeded, weight_exceeded, width_exceeded, length_exceeded,
 * hgv_forbidden, access_forbidden, hazmat_forbidden.
 */
export function checkSegment(vehicle, segment = {}) {
  const v = vehiclePhysical(vehicle);
  const tags = segment.tags || segment;
  const reasons = [];

  const maxHeight = parseOsmMeasure(tags.maxheight);
  if (v.heightM !== null && maxHeight !== null && v.heightM > maxHeight)
    reasons.push({ code: "height_exceeded", limit: maxHeight, value: v.heightM, unit: "m" });

  const maxWidth = parseOsmMeasure(tags.maxwidth);
  if (v.widthM !== null && maxWidth !== null && v.widthM > maxWidth)
    reasons.push({ code: "width_exceeded", limit: maxWidth, value: v.widthM, unit: "m" });

  const maxLength = parseOsmMeasure(tags.maxlength);
  if (v.lengthM !== null && maxLength !== null && v.lengthM > maxLength)
    reasons.push({ code: "length_exceeded", limit: maxLength, value: v.lengthM, unit: "m" });

  const maxWeightT = parseOsmMeasure(tags.maxweight);
  if (v.weightKg !== null && maxWeightT !== null && v.weightKg > maxWeightT * 1000)
    reasons.push({ code: "weight_exceeded", limit: maxWeightT * 1000, value: v.weightKg, unit: "kg" });

  // hgv=no proíbe caminhão/HGV. access=no/private proíbe qualquer um.
  if (v.isHgv && truthyNo(tags.hgv))
    reasons.push({ code: "hgv_forbidden" });
  if (truthyNo(tags.access) || truthyNo(tags.motor_vehicle))
    reasons.push({ code: "access_forbidden" });
  if (v.hazmat && truthyNo(tags.hazmat))
    reasons.push({ code: "hazmat_forbidden" });

  return { compatible: reasons.length === 0, reasons };
}

/**
 * Compatibilidade da ROTA (lista de segmentos). Devolve a viabilidade e, quando
 * incompatível, as violações por segmento com motivo — o que a viabilidade e o
 * pré-flight mostram ao operador.
 */
export function checkRoute(vehicle, segments = []) {
  const violations = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const r = checkSegment(vehicle, segment);
    if (!r.compatible)
      violations.push({ segmentId: segment.id ?? segment.wayId ?? "", reasons: r.reasons });
  }
  return { compatible: violations.length === 0, violations };
}

/**
 * Escolhe a rota mais curta COMPATÍVEL entre candidatas ordenáveis por
 * distância, registrando por que as mais curtas foram rejeitadas.
 * `routes`: [{ id, distanceKm, segments }]. Devolve { chosen, rejected }.
 */
export function chooseCompatibleRoute(vehicle, routes = []) {
  const ordered = (Array.isArray(routes) ? [...routes] : [])
    .sort((a, b) => (finite(a.distanceKm) ?? Infinity) - (finite(b.distanceKm) ?? Infinity));
  const rejected = [];
  for (const route of ordered) {
    const r = checkRoute(vehicle, route.segments || []);
    if (r.compatible) {
      return {
        chosen: { id: route.id ?? "", distanceKm: finite(route.distanceKm) },
        rejected,
      };
    }
    rejected.push({
      id: route.id ?? "",
      distanceKm: finite(route.distanceKm),
      reasons: r.violations.flatMap((v) => v.reasons.map((x) => x.code)),
    });
  }
  return { chosen: null, rejected };
}

const REASON_LABEL_PT = {
  height_exceeded: "altura acima do limite",
  width_exceeded: "largura acima do limite",
  length_exceeded: "comprimento acima do limite",
  weight_exceeded: "peso acima do limite",
  hgv_forbidden: "via proibida para caminhão",
  access_forbidden: "acesso proibido",
  hazmat_forbidden: "carga perigosa proibida",
};
export const describeReason = (code) => REASON_LABEL_PT[code] || code;
