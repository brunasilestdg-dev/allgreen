// ===== AI Gateway da Cloudflare na frente da cascata de IA =====
//
// Grátis no plano Free: painel com pedidos, tokens, erros e latência por
// provedor, cache e limite de taxa configurados no próprio gateway
// (developers.cloudflare.com/ai-gateway, conferido em 24/09/2026).
//
// Liga com AI_GATEWAY_ID (nome do gateway). "default" é criado sozinho no
// primeiro pedido feito pelo binding; qualquer outro nome precisa ser criado
// antes no painel. O que passa por ele:
//   • Workers AI, pelo binding — basta o AI_GATEWAY_ID;
//   • Gemini, Groq, Cerebras, Mistral, OpenAI e Claude, por URL — só com o
//     AI_GATEWAY_TOKEN também, porque o gateway autenticado (o "default" já
//     nasce assim) recusa chamada por URL sem ele. O binding já é autenticado.
//
// Privacidade: o gateway guarda prompt e resposta por padrão. Aqui ele nunca
// guarda o conteúdo — Workers AI vai com `collectLog: false` e as chamadas
// por URL com `cf-aig-collect-log-payload: false` (fica só modelo, tokens,
// tempo e status). Pedido da rota sensível (LGPD) não gera log nem usa cache.
//
// Custo: a chave do provedor segue em cada pedido e `cf-aig-no-wholesale`
// impede que algo sem chave caia no faturamento da Cloudflare (Unified
// Billing) — sem chave, o gateway devolve 400 em vez de cobrar.
//
// Se o próprio gateway falhar (token errado, gateway inexistente, fora do
// ar), o provedor é chamado direto e o gateway fica de lado por 10 minutos
// nesta instância. A cascata nunca para por causa dele.

const ID_VALIDO = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const PAUSA_APOS_FALHA_MS = 10 * 60 * 1000;

const texto = (valor) => String(valor ?? "").trim();

export function gatewayConfig(env) {
  const id = texto(env?.AI_GATEWAY_ID);
  if (!id || !ID_VALIDO.test(id)) return null;
  return { id, token: texto(env?.AI_GATEWAY_TOKEN) };
}

// ===== Disjuntor por provedor =====
const pausados = new Map();

function pausado(provedor) {
  const ate = pausados.get(provedor) || 0;
  if (ate > Date.now()) return true;
  pausados.delete(provedor);
  return false;
}

function pausar(provedor, motivo) {
  if (!pausado(provedor))
    console.warn(`ai-gateway: ${provedor} volta a ir direto por 10 min (${motivo})`);
  pausados.set(provedor, Date.now() + PAUSA_APOS_FALHA_MS);
}

// Só para os testes: limpa o estado entre um caso e outro.
export function reiniciarDisjuntoresDoGateway() {
  pausados.clear();
  bases.clear();
}

const metadados = (sensivel) =>
  JSON.stringify({ app: "allgreen", rota: sensivel ? "sensivel" : "padrao" });

// ===== Workers AI (binding) =====
// Terceiro argumento de `env.AI.run`. Sem gateway, objeto vazio: a chamada
// fica idêntica à de antes.
export function opcoesDoWorkersAi(env, { sensivel = false, cacheTtl = 0 } = {}) {
  const config = gatewayConfig(env);
  if (!config || pausado("workers-ai")) return {};
  const gateway = {
    id: config.id,
    // O binding não tem a opção "só metadados": sem log nenhum, o conteúdo
    // do pedido nunca fica guardado no gateway.
    collectLog: false,
    metadata: { app: "allgreen", rota: sensivel ? "sensivel" : "padrao" },
  };
  if (sensivel) gateway.skipCache = true;
  else if (cacheTtl >= 60) gateway.cacheTtl = Math.floor(cacheTtl);
  return { gateway };
}

// Roda o Workers AI pelo gateway; se o gateway recusar, repete sem ele.
export async function rodarWorkersAi(env, modelo, entrada, opcoes = {}) {
  const extra = opcoesDoWorkersAi(env, opcoes);
  if (!extra.gateway) return env.AI.run(modelo, entrada);
  try {
    return await env.AI.run(modelo, entrada, extra);
  } catch (erro) {
    // Cota diária de neurons (3036) ou capacidade (3040) falhariam sem o
    // gateway também: o erro segue para a cascata. O resto pode ser do
    // gateway — uma tentativa direta a mais é barata perto de perder o
    // provedor.
    if (/\b30(36|40)\b|neurons|capacity/i.test(String(erro?.message || ""))) throw erro;
    pausar("workers-ai", erro?.message || "erro");
    return env.AI.run(modelo, entrada);
  }
}

// ===== Provedores por URL =====
const bases = new Map();

// Endereço do gateway para um provedor, sem barra no fim. Vem do binding
// (`env.AI.gateway(id).getUrl(provedor)`), que já sabe o ID da conta; sem
// binding, usa CLOUDFLARE_ACCOUNT_ID se existir.
async function baseDoGateway(env, provedor) {
  const config = gatewayConfig(env);
  if (!config?.token || pausado(provedor)) return "";
  const chave = `${config.id}:${provedor}`;
  if (bases.has(chave)) return bases.get(chave);
  let base = "";
  try {
    if (env?.AI?.gateway) base = texto(await env.AI.gateway(config.id).getUrl(provedor));
  } catch (erro) {
    console.warn("ai-gateway: getUrl falhou", erro?.message || erro);
  }
  const conta = texto(env?.CLOUDFLARE_ACCOUNT_ID);
  if (!base && /^[a-f0-9]{32}$/i.test(conta))
    base = `https://gateway.ai.cloudflare.com/v1/${conta}/${config.id}/${provedor}`;
  base = base.replace(/\/+$/, "");
  if (!base.startsWith("https://gateway.ai.cloudflare.com/")) base = "";
  bases.set(chave, base);
  return base;
}

export function cabecalhosDoGateway(env, { sensivel = false, cacheTtl = 0 } = {}) {
  const config = gatewayConfig(env);
  if (!config?.token) return {};
  const cabecalhos = {
    "cf-aig-authorization": `Bearer ${config.token}`,
    "cf-aig-collect-log-payload": "false",
    "cf-aig-no-wholesale": "true",
    "cf-aig-metadata": metadados(sensivel),
  };
  if (sensivel) {
    cabecalhos["cf-aig-collect-log"] = "false";
    cabecalhos["cf-aig-skip-cache"] = "true";
  } else if (cacheTtl >= 60) {
    cabecalhos["cf-aig-cache-ttl"] = String(Math.floor(cacheTtl));
  }
  return cabecalhos;
}

// Erro com a cara do gateway (formato da API da Cloudflare: `success: false`
// e uma LISTA de erros) ou 404. Erro do provedor (cota, chave dele, modelo)
// vem no formato do provedor — com `error` como objeto — e segue para a
// cascata como sempre.
async function falhaDoGateway(resposta) {
  if (resposta.ok) return false;
  if (resposta.status === 404) return true;
  if (![400, 401, 403].includes(resposta.status)) return false;
  const corpo = await resposta.clone().json().catch(() => null);
  return (
    corpo?.success === false &&
    (Array.isArray(corpo?.errors) || Array.isArray(corpo?.error))
  );
}

// `rota`: { provedor, caminho, sensivel, cacheTtl }. `direto`: a URL de
// sempre do provedor. `init`: o mesmo RequestInit da chamada direta.
export async function fetchPeloGateway(env, rota, direto, init = {}) {
  const base = await baseDoGateway(env, rota.provedor);
  if (!base) return fetch(direto, init);
  const headers = { ...(init.headers || {}), ...cabecalhosDoGateway(env, rota) };
  let resposta;
  try {
    resposta = await fetch(`${base}${rota.caminho}`, { ...init, headers });
  } catch (erro) {
    // Tempo esgotado é do pedido inteiro, não só do gateway: segue o erro.
    if (erro?.name === "AbortError") throw erro;
    pausar(rota.provedor, erro?.message || "rede");
    return fetch(direto, init);
  }
  if (await falhaDoGateway(resposta)) {
    pausar(rota.provedor, `status ${resposta.status}`);
    return fetch(direto, init);
  }
  return resposta;
}

export function statusDoGateway(env) {
  const config = gatewayConfig(env);
  return {
    configured: Boolean(config),
    provedoresExternos: Boolean(config?.token),
  };
}
