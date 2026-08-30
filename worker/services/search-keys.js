// ===== Traga sua própria busca =====
//
// A cascata de `web-search.js` já resolve o problema de cota: quando
// `SEARXNG_BASE_URL` existe, a instância própria de SearXNG atende tudo sem
// cota e nenhum provedor pago é tocado. O que faltava era um jeito de LIGAR
// essa variável sem terminal — ela vivia só no cofre do Worker, e cadastrar
// segredo lá exige `wrangler`, que quem administra o ERP não tem.
//
// Este módulo é o par do `ai-keys.js`, só que para busca: guarda por espaço a
// URL do SearXNG (e as chaves dos provedores pagos que a pessoa quiser como
// reserva), cifradas no mesmo cofre, e monta o `env` que a cascata recebe. A
// diferença de forma é uma só: o SearXNG se liga por URL + token OPCIONAL, não
// por uma chave; por isso ele tem campo próprio na tela e no banco.
//
// Precedência: o que o espaço cadastrou entra no `env` por cima do cofre. Para
// a busca não é questão de custo (como nas chaves de IA) e sim de intenção —
// quem apontou o ERP para o próprio SearXNG quer que a pesquisa saia por ele.

import { searchWeb } from "./web-search.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

const texto = (valor, max = 500) => String(valor ?? "").trim().slice(0, max);

const safeUrl = (valor) => {
  try {
    const url = new URL(String(valor || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};

// ===== Catálogo do que a pessoa pode plugar =====
//
// `envKey` é o nome da variável que `web-search.js` já lê. É por ele que a
// configuração do espaço entra na cascata sem que a busca precise saber que
// existe um banco: ela continua lendo `env.SERPER_API_KEY`, só que o valor pode
// ter vindo daqui. `tipo: "url"` marca o SearXNG, que guarda URL + token; os
// demais são `tipo: "chave"`.
export const PROVEDORES_DE_BUSCA = Object.freeze([
  {
    id: "searxng",
    nome: "SearXNG (busca ilimitada)",
    tipo: "url",
    envKey: "SEARXNG_BASE_URL",
    tokenEnvKey: "SEARXNG_TOKEN",
    prefixoEsperado: "",
    onde: "A URL da sua instância de SearXNG (ex.: hospedada na PikaPods ou Elestio). No settings.yml dela, ligue \"json\" em search.formats e \"limiter: false\".",
    descricao: "Sua própria instância de busca, sem cota nenhuma. Fica na frente de todos os outros: quando responde, nenhum provedor pago é usado.",
  },
  {
    id: "serper",
    nome: "Serper",
    tipo: "chave",
    envKey: "SERPER_API_KEY",
    prefixoEsperado: "",
    onde: "serper.dev → API Key (2.500 buscas grátis).",
    descricao: "Resultados do Google. Boa reserva atrás do SearXNG.",
  },
  {
    id: "brave",
    nome: "Brave Search",
    tipo: "chave",
    envKey: "BRAVE_SEARCH_API_KEY",
    prefixoEsperado: "",
    onde: "api-dashboard.search.brave.com → Subscriptions → API Keys.",
    descricao: "Índice próprio da Brave, com faixa gratuita mensal.",
  },
  {
    id: "tavily",
    nome: "Tavily",
    tipo: "chave",
    envKey: "TAVILY_API_KEY",
    prefixoEsperado: "tvly-",
    onde: "app.tavily.com → API Keys.",
    descricao: "Busca pensada para IA, com faixa gratuita.",
  },
  {
    id: "exa",
    nome: "Exa",
    tipo: "chave",
    envKey: "EXA_API_KEY",
    prefixoEsperado: "",
    onde: "dashboard.exa.ai → API Keys.",
    descricao: "Busca semântica, com créditos gratuitos no cadastro.",
  },
  {
    id: "jina",
    nome: "Jina Search",
    tipo: "chave",
    envKey: "JINA_API_KEY",
    prefixoEsperado: "jina_",
    onde: "jina.ai → API (faixa gratuita).",
    descricao: "Busca com leitura de página, faixa gratuita.",
  },
  {
    id: "firecrawl",
    nome: "Firecrawl",
    tipo: "chave",
    envKey: "FIRECRAWL_API_KEY",
    prefixoEsperado: "fc-",
    onde: "firecrawl.dev → API Keys (créditos gratuitos).",
    descricao: "Busca com rastreamento de site, créditos gratuitos.",
  },
  {
    id: "search1",
    nome: "Search1API",
    tipo: "chave",
    envKey: "SEARCH1_API_KEY",
    prefixoEsperado: "",
    onde: "search1api.com → Dashboard (cota gratuita mensal).",
    descricao: "Resultados do Google, cota gratuita mensal.",
  },
  {
    id: "you",
    nome: "You.com",
    tipo: "chave",
    envKey: "YOU_API_KEY",
    prefixoEsperado: "",
    onde: "api.you.com → Developer (cota gratuita).",
    descricao: "Busca com cota gratuita para desenvolvedor.",
  },
  {
    id: "serpapi",
    nome: "SerpApi",
    tipo: "chave",
    envKey: "SERPAPI_API_KEY",
    prefixoEsperado: "",
    onde: "serpapi.com → API Key (100 buscas grátis/mês).",
    descricao: "Resultados do Google, 100 buscas gratuitas por mês.",
  },
]);

const porId = (id) => PROVEDORES_DE_BUSCA.find((item) => item.id === texto(id, 40)) || null;

// ===== Cofre =====
//
// Mesmo cofre do `ai-keys.js`: a chave de cifra é derivada de
// WORKSPACE_AI_VAULT_KEY, e NÃO do SESSION_SECRET — rotacionar sessão não pode
// tornar ilegível o que o espaço guardou.
const chaveDoCofre = async (env) => {
  const segredo = String(env.WORKSPACE_AI_VAULT_KEY || "");
  if (segredo.length < 32)
    throw new Error("Cofre indisponível: configure WORKSPACE_AI_VAULT_KEY.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(segredo));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
};

const paraBase64 = (bytes) => {
  let valor = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    valor += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(valor);
};
const deBase64 = (valor) => Uint8Array.from(atob(String(valor || "")), (c) => c.charCodeAt(0));

const cifrar = async (env, segredo) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await chaveDoCofre(env),
    new TextEncoder().encode(segredo),
  );
  return { ciphertext: paraBase64(new Uint8Array(cifrado)), iv: paraBase64(iv) };
};

const decifrar = async (env, linha) => {
  if (!linha?.secret_ciphertext || !linha?.secret_iv) return "";
  const aberto = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: deBase64(linha.secret_iv) },
    await chaveDoCofre(env),
    deBase64(linha.secret_ciphertext),
  );
  return new TextDecoder().decode(aberto);
};

// O que a tela pode ver. Nunca o segredo — no máximo o prefixo e a URL, que
// não é segredo.
const paraTela = (linha) => {
  const provedor = porId(linha.provider);
  return {
    provedor: linha.provider,
    nome: provedor?.nome || linha.provider,
    rotulo: linha.label || "",
    url: linha.base_url || "",
    temToken: Boolean(linha.secret_ciphertext),
    prefixo: linha.secret_prefix || "",
    ativa: linha.status === "active",
    testadaEm: linha.last_test_at || "",
    testeOk: linha.last_test_ok === 1,
    testeErro: linha.last_test_error || "",
    atualizadaEm: linha.updated_at,
  };
};

/**
 * A configuração de busca ativa do espaço, pronta para entrar num `env`.
 *
 * Devolve um objeto vazio quando não há nenhuma — o caminho mais comum, e o
 * que precisa custar menos.
 */
export async function chavesDeBuscaDoEspaco(env, ownerId) {
  if (!env?.DB || !ownerId) return {};
  const { results } = await env.DB.prepare(
    `SELECT provider, base_url, secret_ciphertext, secret_iv
       FROM workspace_search_keys
      WHERE workspace_owner_id = ? AND status = 'active'`,
  ).bind(ownerId).all().catch(() => ({ results: [] }));
  if (!results?.length) return {};

  const chaves = {};
  for (const linha of results) {
    const provedor = porId(linha.provider);
    if (!provedor) continue;
    try {
      if (provedor.tipo === "url") {
        const url = safeUrl(linha.base_url);
        if (!url) continue;
        chaves[provedor.envKey] = url;
        const token = await decifrar(env, linha);
        if (token && provedor.tokenEnvKey) chaves[provedor.tokenEnvKey] = token;
      } else {
        const segredo = await decifrar(env, linha);
        if (!segredo) continue;
        chaves[provedor.envKey] = segredo;
      }
    } catch (erro) {
      // Uma linha ilegível não pode derrubar as outras: o cofre pode ter sido
      // rotacionado depois do cadastro.
      console.error("search-keys: configuração ilegível", linha.provider, erro?.message);
    }
  }
  return chaves;
}

/**
 * O `env` que a cascata de busca deve receber quando a chamada acontece dentro
 * de um espaço de trabalho. Sobrepõe, nunca apaga: um provedor que o espaço não
 * trouxe continua valendo pelo cofre.
 */
export async function envComChavesDeBuscaDoEspaco(env, ownerId) {
  const chaves = await chavesDeBuscaDoEspaco(env, ownerId);
  return Object.keys(chaves).length ? { ...env, ...chaves } : env;
}

// ===== Teste de conexão =====
//
// Cadastrar sem saber se funciona é o estado que faz a pessoa desistir da tela.
// O teste exercita o CAMINHO REAL: monta um `env` só com este provedor (e com
// os gratuitos sem chave desligados, para não mascarar a falha dele) e chama a
// mesma `searchWeb` que a pesquisa de empresa usa. Testar por um atalho próprio
// provaria que o atalho funciona, não que a busca funciona.
const testarBusca = async (env, provedor, { url = "", token = "", chave = "" }) => {
  const ambiente = { SEM_BUSCA_GRATUITA: "1" };
  if (provedor.tipo === "url") {
    ambiente[provedor.envKey] = url;
    if (token && provedor.tokenEnvKey) ambiente[provedor.tokenEnvKey] = token;
  } else {
    ambiente[provedor.envKey] = chave;
  }
  try {
    const busca = await searchWeb(ambiente, "transporte rodoviário de carga Brasil");
    if (busca.results.length) return { ok: true, erro: "" };
    // Respondeu sem resultado OU falhou: a mensagem do provedor (ex.: o aviso
    // de "ligue json em search.formats" do SearXNG) é o que ajuda a corrigir.
    const falha = (busca.failures || [])[0];
    return {
      ok: false,
      erro: falha?.error
        || "O provedor respondeu, mas não trouxe nenhum resultado para a busca de teste.",
    };
  } catch (erro) {
    return { ok: false, erro: `Não foi possível testar: ${texto(erro?.message || erro, 200)}` };
  }
};

/**
 * `/api/search-keys` — a tela de configuração de busca do espaço.
 *
 * `ownerId` é o espaço de trabalho da sessão, resolvido por quem chama. Não sai
 * da requisição: repetir o furo do `?owner=` deixaria alguém ler a instância de
 * busca de outra empresa.
 */
export async function handleSearchKeys(request, env, { ownerId, userId }) {
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);
  if (!ownerId || !userId) return json({ error: "Sessão inválida." }, 401);

  const url = new URL(request.url);
  const provedorPedido = texto(url.pathname.split("/").filter(Boolean)[2], 40);

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM workspace_search_keys WHERE workspace_owner_id = ? ORDER BY provider",
    ).bind(ownerId).all().catch(() => ({ results: [] }));
    const cadastradas = new Map((results || []).map((linha) => [linha.provider, paraTela(linha)]));
    return json({
      cofreDisponivel: String(env.WORKSPACE_AI_VAULT_KEY || "").length >= 32,
      provedores: PROVEDORES_DE_BUSCA.map((provedor) => ({
        id: provedor.id,
        nome: provedor.nome,
        tipo: provedor.tipo,
        descricao: provedor.descricao,
        onde: provedor.onde,
        // A chave do cofre da plataforma continua servindo de reserva quando o
        // espaço não trouxe a própria.
        reservaDaPlataforma: provedor.tipo === "url"
          ? Boolean(env[provedor.envKey])
          : Boolean(env[provedor.envKey]),
        minha: cadastradas.get(provedor.id) || null,
      })),
    });
  }

  const provedor = porId(provedorPedido);
  if (!provedor) return json({ error: "Provedor de busca desconhecido." }, 404);

  if (request.method === "DELETE") {
    await env.DB.prepare(
      "DELETE FROM workspace_search_keys WHERE workspace_owner_id = ? AND provider = ?",
    ).bind(ownerId, provedor.id).run();
    return json({ ok: true });
  }

  if (request.method !== "POST" && request.method !== "PUT")
    return json({ error: "Método não permitido." }, 405);

  const corpo = await request.json().catch(() => ({}));

  if (corpo.acao === "ativar" || corpo.acao === "desativar") {
    const meta = await env.DB.prepare(
      "UPDATE workspace_search_keys SET status=?, updated_at=? WHERE workspace_owner_id=? AND provider=?",
    ).bind(corpo.acao === "ativar" ? "active" : "inactive", new Date().toISOString(), ownerId, provedor.id).run();
    if (!meta?.meta?.changes) return json({ error: "Configuração não cadastrada." }, 404);
    return json({ ok: true });
  }

  if (corpo.acao === "testar") {
    const linha = await env.DB.prepare(
      "SELECT * FROM workspace_search_keys WHERE workspace_owner_id=? AND provider=?",
    ).bind(ownerId, provedor.id).first();
    if (!linha) return json({ error: "Configuração não cadastrada." }, 404);
    let token = "";
    try { token = await decifrar(env, linha); }
    catch (erro) { return json({ error: erro.message }, 503); }
    const resultado = await testarBusca(env, provedor, {
      url: linha.base_url, token, chave: token,
    });
    await env.DB.prepare(
      "UPDATE workspace_search_keys SET last_test_at=?, last_test_ok=?, last_test_error=?, updated_at=? WHERE id=?",
    ).bind(new Date().toISOString(), resultado.ok ? 1 : 0, texto(resultado.erro, 400), new Date().toISOString(), linha.id).run();
    return json({ ok: resultado.ok, erro: resultado.erro });
  }

  // Cadastrar ou trocar.
  let baseUrl = "";
  let segredo = "";
  if (provedor.tipo === "url") {
    baseUrl = safeUrl(corpo.url);
    if (!baseUrl)
      return json({ error: "Informe a URL completa da sua instância (começando com https://)." }, 400);
    segredo = String(corpo.token || "").trim();
  } else {
    segredo = String(corpo.chave || "").trim();
    if (segredo.length < 8) return json({ error: "Cole a chave completa do provedor." }, 400);
    if (provedor.prefixoEsperado && !segredo.startsWith(provedor.prefixoEsperado))
      return json({
        error: `A chave do ${provedor.nome} começa com "${provedor.prefixoEsperado}". Confira se copiou a chave certa.`,
      }, 400);
  }

  // Testa ANTES de guardar. Guardar algo que não funciona é criar um problema
  // que só aparece quando alguém precisa da pesquisa.
  const resultado = await testarBusca(env, provedor, { url: baseUrl, token: segredo, chave: segredo });
  if (!resultado.ok && corpo.salvarMesmoAssim !== true)
    return json({
      error: provedor.tipo === "url"
        ? "A instância não respondeu à busca de teste."
        : "A chave não foi aceita pelo provedor.",
      detalhe: resultado.erro,
      podeSalvarMesmoAssim: true,
    }, 400);

  // Só cifra se houver segredo: SearXNG sem token não tem o que guardar cifrado.
  let ciphertext = null;
  let iv = null;
  let prefixo = "";
  if (segredo) {
    try {
      const cifrado = await cifrar(env, segredo);
      ciphertext = cifrado.ciphertext;
      iv = cifrado.iv;
      prefixo = `${segredo.slice(0, 5)}…`;
    } catch (erro) { return json({ error: erro.message }, 503); }
  }

  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspace_search_keys
       (id, workspace_owner_id, provider, label, base_url, secret_ciphertext, secret_iv,
        secret_prefix, status, last_test_at, last_test_ok, last_test_error, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'active', ?,?,?,?,?,?)
     ON CONFLICT(workspace_owner_id, provider) DO UPDATE SET
       label=excluded.label, base_url=excluded.base_url,
       secret_ciphertext=excluded.secret_ciphertext, secret_iv=excluded.secret_iv,
       secret_prefix=excluded.secret_prefix, status='active', last_test_at=excluded.last_test_at,
       last_test_ok=excluded.last_test_ok, last_test_error=excluded.last_test_error,
       updated_at=excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), ownerId, provedor.id, texto(corpo.rotulo, 120), baseUrl,
    ciphertext, iv, prefixo, agora, resultado.ok ? 1 : 0, texto(resultado.erro, 400), userId, agora, agora,
  ).run();

  return json({ ok: true, testeOk: resultado.ok, testeErro: resultado.erro }, 201);
}
