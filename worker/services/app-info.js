// ===== O que o app informa publicamente sobre si mesmo =====
//
// Contrato
// - Recebe: `env` e `url` (a versão também recebe `request`, para o método).
// - Devolve: `handleConfig` — a configuração pública do cliente (login
//   Google, vídeo ligado, chave VAPID pública, e-mail de suporte);
//   `handleStatus` — a saúde básica (banco, versão publicada, busca web);
//   `handleSystemVersion` — o SHA publicado e o ambiente (só GET).
// - Quem chama: a tabela de rotas públicas (/api/config, /api/status e
//   /api/system/version).
// - Autorização: nenhuma, de propósito — são leituras sem dado de pessoa e
//   sem segredo; só a chave VAPID PÚBLICA sai daqui.

import { json } from "../lib/http.js";
import { pushEnabled } from "../mensageria/envio.js";
import {
  lerManifestoDeVersao,
  systemVersionPayload,
} from "./todogreen-system-health.js";
import { webSearchConfiguration } from "./web-search.js";

// Uma fonte só para "qual SHA está publicado": o manifesto version.json do
// build. /api/status, /api/system/version e a tela Saúde do sistema leem daqui.
const publishedVersion = (env, origin) => lerManifestoDeVersao(env, origin);

// Público e sem segredo: SHA publicado, hora do build e ambiente. É o que
// a auditoria compara com `git rev-parse HEAD` para dizer "produção = main".
export async function handleSystemVersion(request, env, url) {
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
  const manifesto = await publishedVersion(env, url.origin);
  return json(systemVersionPayload(env, manifesto));
}

export async function handleStatus(env, url) {
  let database = "indisponível";
  try {
    if (env.DB) {
      await env.DB.prepare("SELECT 1 AS ok").first();
      database = "operacional";
    }
  } catch {}
  const appVersion = await publishedVersion(env, url.origin);
  const clientVersion = url.searchParams.get("client") || "";
  const search = webSearchConfiguration(env);
  return json({
    status: database === "operacional" ? "operacional" : "degradado",
    database,
    version: appVersion?.version || "local",
    buildTime: appVersion?.buildTime || null,
    clientVersion,
    current: clientVersion
      ? clientVersion === (appVersion?.version || "local")
      : true,
    capabilities: {
      webSearch: {
        configured: search.configured,
        braveConfigured: search.providers.brave,
      },
    },
    roadmap: {
      complete: true,
      completedThrough: 27,
      nextItem: null,
    },
    checkedAt: new Date().toISOString(),
  });
}

export function handleConfig(env) {
  return json({
    googleClientId: env.GOOGLE_CLIENT_ID || "",
    videoEnabled: !!(env.VIDEO_AI_URL && env.VIDEO_AI_TOKEN),
    vapidPublicKey: pushEnabled(env) ? env.VAPID_PUBLIC_KEY : null,
    supportEmail: env.SUPPORT_EMAIL || env.MAIL_SENDER || "",
  });
}
