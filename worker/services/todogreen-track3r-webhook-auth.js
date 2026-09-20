// Autenticacao dos webhooks TRACK3R. NUNCA colocar os valores dos tokens no banco,
// no kit enviado ao fornecedor, em respostas de API ou em logs.
import { sameHash } from "../auth/credenciais.js";
import { TRACK3R_WEBHOOKS } from "../../src/features/logistics/track3rWebhookDomain.js";

export const TRACK3R_WEBHOOK_TOKEN_KEYS = Object.freeze(
  Object.fromEntries(TRACK3R_WEBHOOKS.map(([tipo]) => [
    tipo,
    `TODOGREEN_TRACK3R_TOKEN_${tipo.toUpperCase().replace(/-/g, "_")}`,
  ])),
);

export const estadoTokensWebhookTrack3r = (env, integracao) => {
  const individuais = Object.values(TRACK3R_WEBHOOK_TOKEN_KEYS)
    .filter((chave) => Boolean(env?.[chave])).length;
  const nomeLegado = String(integracao?.webhook_secret_env_key || "TODOGREEN_TRACK3R_WEBHOOK_SECRET");
  return {
    individual: individuais > 0,
    configurados: individuais,
    total: TRACK3R_WEBHOOKS.length,
    disponivel: individuais > 0 || Boolean(env?.[nomeLegado]),
  };
};

// A partir do PRIMEIRO token individual, desliga o fallback compartilhado para
// TODOS os endpoints: de outro modo o mesmo segredo continuaria abrindo outra
// porta. Webhooks ainda sem seu token individual retornam 503 (sem aceitar dados).
export const autenticarTokenWebhookTrack3r = (env, integracao, tipo, recebido) => {
  const modo = estadoTokensWebhookTrack3r(env, integracao);
  const nome = modo.individual
    ? TRACK3R_WEBHOOK_TOKEN_KEYS[tipo]
    : String(integracao?.webhook_secret_env_key || "TODOGREEN_TRACK3R_WEBHOOK_SECRET");
  if (!nome) return { nome: "", configurado: false, autorizado: false };
  const esperado = String(env?.[nome] || "");
  if (!esperado) return { nome, configurado: false, autorizado: false };

  // Tokens individuais precisam ser realmente distintos. Configuracao repetida
  // falha fechada em vez de permitir um Token de outro tipo de evento.
  if (modo.individual && Object.entries(TRACK3R_WEBHOOK_TOKEN_KEYS)
    .some(([outroTipo, chave]) => outroTipo !== tipo
      && String(env?.[chave] || "") === esperado)) {
    return { nome, configurado: false, autorizado: false };
  }
  return {
    nome,
    configurado: true,
    autorizado: Boolean(recebido) && sameHash(String(recebido), esperado),
  };
};
