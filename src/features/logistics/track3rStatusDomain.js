// De-para oficial de status da Track3r → categoria canônica para os KPIs.
// Os códigos/descrições vêm de track3rStatusData.js (planilha oficial do Lucas).
// A encomenda grava o TEXTO do status (descricao_status); então a consulta é por
// descrição, com fallback por código.
import { TRACK3R_STATUS_CODES } from "./track3rStatusData.js";

const norm = (s) => String(s ?? "")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

const POR_DESCRICAO = new Map();
const POR_CODIGO = new Map();
for (const s of TRACK3R_STATUS_CODES) {
  if (s?.descricao) POR_DESCRICAO.set(norm(s.descricao), s.categoria);
  if (s?.codigo != null) POR_CODIGO.set(String(s.codigo), s.categoria);
}

// Categorias que representam FALHA de entrega para os indicadores (insucesso).
export const CATEGORIAS_INSUCESSO = Object.freeze(["insucesso", "avaria", "extravio"]);

// Retorna a categoria canônica de um status (texto da descrição OU código).
// "" quando o status não está na tabela oficial (ex.: dado do artefato antigo).
export function categoriaStatusTrack3r(statusOuCodigo) {
  const raw = String(statusOuCodigo ?? "").trim();
  if (!raw) return "";
  if (POR_CODIGO.has(raw)) return POR_CODIGO.get(raw);
  const d = norm(raw);
  return POR_DESCRICAO.get(d) || "";
}

export const ehStatusEntregue = (status) => categoriaStatusTrack3r(status) === "entregue";
export const ehStatusInsucesso = (status) =>
  CATEGORIAS_INSUCESSO.includes(categoriaStatusTrack3r(status));
