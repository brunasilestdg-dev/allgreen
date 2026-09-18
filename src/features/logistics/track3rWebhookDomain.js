// Contrato público dos webhooks TRACK3R documentados.
// O token nunca entra aqui: este módulo só monta os endpoints que podem ser
// entregues ao fornecedor.

export const TRACK3R_WEBHOOKS = Object.freeze([
  ["ocorrencias", "Envio de ocorrências"],
  ["encomendas", "Envio de encomendas"],
  ["valores-encomendas", "Envio de valores das encomendas"],
  ["embarcadores", "Alterações de embarcador"],
  ["tomadores", "Alterações de tomador"],
  ["ctes", "Envio de CT-es"],
  ["unidades", "Alterações das unidades"],
  ["averbacoes", "Envio de averbação"],
  ["cotacoes", "Envio de cotações"],
  ["faturas", "Envio de faturas"],
  ["faturas-motorista", "Envio de faturas motorista"],
  ["faturas-rede-terceira", "Envio de faturas rede terceira"],
  ["listas", "Envio de listas / romaneios"],
]);

const limparBase = (value) => String(value || "").replace(/\/+$/, "");

export const montarKitWebhookTrack3r = ({ origin = "", integrationId = "" } = {}) => {
  const base = limparBase(origin);
  const id = String(integrationId || "").trim();
  if (!base || !id) return null;
  const prefix = `${base}/api/todogreen/tms/webhook/${encodeURIComponent(id)}`;
  return {
    integrationId: id,
    method: "POST",
    authHeader: "Token",
    contentType: "application/json",
    endpoints: TRACK3R_WEBHOOKS.map(([type, label]) => ({
      type,
      label,
      url: `${prefix}/${type}`,
    })),
  };
};
