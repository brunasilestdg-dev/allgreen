// ===== Turnstile: anti-robô da Cloudflare (grátis) =====
//
// Cadastro, login, recuperação de senha, pedido de acesso e os formulários
// públicos (formulário, site, agenda, atendimento) pedem o token do widget —
// mas só quando as DUAS chaves existem: TURNSTILE_SITE_KEY (pública, vai para a
// tela pelo /api/config e pelo HTML das páginas públicas) e
// TURNSTILE_SECRET_KEY (segredo, só aqui no servidor). Com uma só, nada muda:
// ligar pela metade trancaria o cadastro de todo mundo.
//
// O token vale uma vez e por 300 s. Quem confere é o siteverify da Cloudflare;
// o Worker nunca tenta validar o token sozinho.

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_ORIGEM = "https://challenges.cloudflare.com";
export const TURNSTILE_SCRIPT = `${TURNSTILE_ORIGEM}/turnstile/v0/api.js`;

// O token tem no máximo 2048 caracteres; o nome da ação, 32 (letras, números,
// "_" e "-"). Valores fora disso nem são enviados.
const TOKEN_MAXIMO = 2048;
const ACAO_VALIDA = /^[a-z0-9_-]{1,32}$/i;

const texto = (valor) => String(valor ?? "").trim();

export function turnstileAtivo(env) {
  return Boolean(texto(env?.TURNSTILE_SITE_KEY) && texto(env?.TURNSTILE_SECRET_KEY));
}

// Chave pública para a tela. Vazia quando o Turnstile não está ligado — a tela
// usa isso para decidir se desenha o widget.
export function turnstileSiteKey(env) {
  return turnstileAtivo(env) ? texto(env.TURNSTILE_SITE_KEY) : "";
}

// O widget grava o token no campo `cf-turnstile-response` do formulário (HTML
// puro, como a agenda) e o app manda `turnstileToken` no JSON.
export function tokenDoTurnstile(corpo, request) {
  const bruto =
    corpo?.turnstileToken ??
    corpo?.["cf-turnstile-response"] ??
    request?.headers?.get?.("cf-turnstile-response") ??
    "";
  const token = typeof bruto === "string" ? bruto.trim() : "";
  return token.length <= TOKEN_MAXIMO ? token : "";
}

// Resultado: { ok, motivo?, codigos? }. Quando o siteverify não responde (rede
// ou 5xx), o pedido segue: o limite de tentativas por IP e por conta continua
// valendo, e trancar todo cadastro porque um serviço externo oscilou seria
// pior que deixar passar alguns minutos sem o anti-robô. Recusa explícita
// (success: false) sempre barra.
export async function verificarTurnstile(
  env,
  token,
  { ip = null, acao = "", fetcher = fetch } = {},
) {
  if (!turnstileAtivo(env)) return { ok: true, desligado: true };
  if (!token) return { ok: false, motivo: "ausente" };
  const corpo = new URLSearchParams();
  corpo.set("secret", texto(env.TURNSTILE_SECRET_KEY));
  corpo.set("response", token);
  if (ip) corpo.set("remoteip", ip);
  let resposta;
  try {
    resposta = await fetcher(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: corpo.toString(),
      signal: AbortSignal.timeout(5000),
    });
  } catch (erro) {
    console.warn("turnstile: siteverify sem resposta", erro?.message || erro);
    return { ok: true, indisponivel: true };
  }
  if (resposta.status >= 500) {
    console.warn("turnstile: siteverify fora do ar", resposta.status);
    return { ok: true, indisponivel: true };
  }
  const dados = await resposta.json().catch(() => ({}));
  const codigos = Array.isArray(dados?.["error-codes"]) ? dados["error-codes"] : [];
  if (dados?.success !== true) {
    // Chave secreta errada é problema de configuração, não do visitante: fica
    // no log para quem administra achar, e o pedido é barrado do mesmo jeito.
    if (codigos.some((codigo) => /secret/.test(codigo)))
      console.error("turnstile: TURNSTILE_SECRET_KEY recusada", codigos);
    return { ok: false, motivo: "recusado", codigos };
  }
  // A ação amarra o token ao formulário: um token tirado no cadastro não serve
  // para abrir chamado. Só confere quando os dois lados têm ação.
  if (acao && ACAO_VALIDA.test(acao) && dados.action && dados.action !== acao)
    return { ok: false, motivo: "acao", codigos };
  return { ok: true };
}

export const MENSAGEM_TURNSTILE =
  "Confirme a verificação anti-robô e tente de novo.";

// Devolve null quando pode seguir, ou a resposta de erro pronta. `responder`
// é a função JSON de quem chama (cada serviço tem a sua).
export async function exigirTurnstile(
  request,
  env,
  corpo,
  { acao = "", responder, fetcher } = {},
) {
  if (!turnstileAtivo(env)) return null;
  const ip = request?.headers?.get?.("cf-connecting-ip") || null;
  const resultado = await verificarTurnstile(env, tokenDoTurnstile(corpo, request), {
    ip,
    acao,
    ...(fetcher ? { fetcher } : {}),
  });
  if (resultado.ok) return null;
  return responder(
    { error: MENSAGEM_TURNSTILE, turnstile: true },
    resultado.motivo === "ausente" ? 400 : 403,
  );
}

// ===== Páginas públicas renderizadas no servidor =====
//
// Formulário, agenda e atendimento são HTML com CSP estrita. O widget precisa
// do script e do iframe de challenges.cloudflare.com; fora isso nada muda.

const escaparAtributo = (valor) =>
  String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Script do widget com o nonce da página (quando a CSP usa nonce).
export function scriptDoTurnstile(env, nonce = "") {
  if (!turnstileAtivo(env)) return "";
  return `<script src="${TURNSTILE_SCRIPT}" async defer${nonce ? ` nonce="${escaparAtributo(nonce)}"` : ""}></script>`;
}

// Caixa do widget. Dentro de um <form>, o próprio widget cria o campo
// `cf-turnstile-response` que segue junto no envio.
export function caixaDoTurnstile(env, acao) {
  if (!turnstileAtivo(env)) return "";
  const acaoSegura = ACAO_VALIDA.test(acao || "") ? acao : "";
  return `<div class="cf-turnstile" data-sitekey="${escaparAtributo(turnstileSiteKey(env))}"${acaoSegura ? ` data-action="${acaoSegura}"` : ""} data-language="pt-br" data-size="flexible"></div>`;
}

// Acrescenta a origem do Turnstile às diretivas de script e de iframe. Sem o
// Turnstile ligado a CSP volta exatamente como veio.
export function cspComTurnstile(csp, env) {
  if (!turnstileAtivo(env)) return csp;
  const diretivas = String(csp)
    .split(";")
    .map((parte) => parte.trim())
    .filter(Boolean);
  const indice = (nome) => diretivas.findIndex((d) => d.split(/\s+/)[0] === nome);
  const acrescentar = (nome) => {
    const i = indice(nome);
    if (i < 0) diretivas.push(`${nome} ${TURNSTILE_ORIGEM}`);
    else if (!diretivas[i].includes(TURNSTILE_ORIGEM))
      diretivas[i] = `${diretivas[i]} ${TURNSTILE_ORIGEM}`;
  };
  acrescentar("script-src");
  acrescentar("frame-src");
  return diretivas.join("; ");
}
