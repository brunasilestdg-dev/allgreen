// ===== Conta do cliente: utilitários compartilhados =====
//
// Contrato: o vocabulário comum de quem responde sobre a conta do cliente — o
// Portal do Cliente (externo), a API interna de clientes e a normalização dos
// campos do CRM. `TENANT_ID` é o tenant fixo da vertical; `response` é a
// resposta JSON (no-store, nosniff); `clean` apara e corta texto; `parse` lê
// JSON e devolve a alternativa em vez de lançar. Puro: sem D1, sem estado.

export const TENANT_ID = "todogreen";

export const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

export const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);

export const parse = (value, fallback) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
};
