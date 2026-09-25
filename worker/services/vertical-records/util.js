// ===== Registros da vertical: utilitários =====
//
// Contrato: funções puras, sem estado e sem D1. `json` é a resposta HTTP de
// toda a API de registros (no-store, nosniff); `texto`, `numero`, `parse` e
// `objeto` saneiam o que chega do corpo e do banco — nunca lançam e sempre
// devolvem um valor do tipo esperado (texto cortado, número finito, objeto).

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

export const texto = (valor, max = 500) => String(valor ?? "").trim().slice(0, max);
export const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
export const parse = (valor, alternativa) => {
  try {
    return JSON.parse(valor || "");
  } catch {
    return alternativa;
  }
};
export const objeto = (valor) => (valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {});
