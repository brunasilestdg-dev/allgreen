// ===== Traga sua própria chave de IA =====
//
// Onze provedores viviam só no cofre do Worker. Quem usa o produto não tinha
// onde plugar a própria conta de Claude, GPT ou Google, e todo o consumo saía
// da conta de quem hospeda.
//
// Este módulo guarda a chave do espaço de trabalho, cifrada, e monta o `env`
// que a cascata do `ai.js` recebe. A regra de precedência é uma só e é
// deliberada: **a chave do espaço vem NA FRENTE da do cofre**. Quem trouxe a
// própria conta quer que ela seja usada; deixá-la de reserva seria cobrar a
// assinatura de alguém e não gastar.
//
// A chave nunca volta para a tela. Sai o prefixo e a data do último teste;
// para trocar, cadastra de novo.

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

const texto = (valor, max = 500) => String(valor ?? "").trim().slice(0, max);

// ===== Catálogo do que a pessoa pode plugar =====
//
// `envKey` é o nome da variável que o `ai.js` já lê. É por ele que a chave do
// espaço entra na cascata sem que o `ai.js` precise saber que existe um banco:
// ele continua lendo `env.GEMINI_API_KEY`, só que o valor pode ter vindo daqui.
export const PROVEDORES_DE_IA = Object.freeze([
  {
    id: "anthropic",
    nome: "Claude (Anthropic)",
    envKey: "ANTHROPIC_API_KEY",
    modeloEnvKey: "ANTHROPIC_MODEL",
    modeloPadrao: "claude-opus-5",
    prefixoEsperado: "sk-ant-",
    onde: "console.anthropic.com → Settings → API keys",
    descricao: "Modelos Claude. É o mais forte para texto longo, análise e redação.",
  },
  {
    id: "openai",
    nome: "ChatGPT (OpenAI)",
    envKey: "OPENAI_API_KEY",
    modeloEnvKey: "OPENAI_MODEL",
    modeloPadrao: "gpt-5",
    prefixoEsperado: "sk-",
    onde: "platform.openai.com → API keys",
    descricao: "Modelos GPT.",
  },
  {
    id: "google",
    nome: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    modeloEnvKey: "GEMINI_MODEL",
    modeloPadrao: "",
    prefixoEsperado: "",
    onde: "aistudio.google.com → Get API key",
    descricao: "Modelos Gemini e Gemma. Tem faixa gratuita generosa.",
  },
  {
    id: "groq",
    nome: "Groq",
    envKey: "GROQ_API_KEY",
    modeloEnvKey: "GROQ_MODEL",
    modeloPadrao: "",
    prefixoEsperado: "gsk_",
    onde: "console.groq.com → API Keys",
    descricao: "Resposta muito rápida, faixa gratuita.",
  },
  {
    id: "mistral",
    nome: "Mistral",
    envKey: "MISTRAL_API_KEY",
    modeloEnvKey: "MISTRAL_MODEL",
    modeloPadrao: "",
    prefixoEsperado: "",
    onde: "console.mistral.ai → API Keys",
    descricao: "Modelos europeus, faixa gratuita.",
  },
  {
    id: "openrouter",
    nome: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    modeloEnvKey: "OPENROUTER_MODEL",
    modeloPadrao: "",
    prefixoEsperado: "sk-or-",
    onde: "openrouter.ai → Keys",
    descricao: "Uma chave só que alcança dezenas de modelos de vários fornecedores.",
  },
]);

const porId = (id) => PROVEDORES_DE_IA.find((item) => item.id === texto(id, 40)) || null;

// ===== Cofre =====
//
// Mesmo desenho do cofre do certificado CIOT, com uma diferença que importa:
// aqui a chave de cifra NÃO cai no `SESSION_SECRET`. Reaproveitar o segredo de
// sessão amarra duas coisas de ciclo de vida diferente — rotacionar sessão
// tornaria ilegível a chave de IA de todo mundo.
const chaveDoCofre = async (env) => {
  const segredo = String(env.WORKSPACE_AI_VAULT_KEY || "");
  if (segredo.length < 32)
    throw new Error("Cofre de chaves de IA indisponível: configure WORKSPACE_AI_VAULT_KEY.");
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

// O que a tela pode ver. Nunca o segredo.
const paraTela = (linha) => {
  const provedor = porId(linha.provider);
  return {
    provedor: linha.provider,
    nome: provedor?.nome || linha.provider,
    rotulo: linha.label || "",
    prefixo: linha.secret_prefix || "",
    modelo: linha.model || "",
    ativa: linha.status === "active",
    testadaEm: linha.last_test_at || "",
    testeOk: linha.last_test_ok === 1,
    testeErro: linha.last_test_error || "",
    atualizadaEm: linha.updated_at,
  };
};

/**
 * As chaves ativas do espaço, prontas para entrar num `env`.
 *
 * Devolve um objeto vazio quando não há nenhuma — o caminho mais comum, e o
 * que precisa custar menos.
 */
export async function chavesDoEspaco(env, ownerId) {
  if (!env?.DB || !ownerId) return {};
  const { results } = await env.DB.prepare(
    `SELECT provider, secret_ciphertext, secret_iv, model
       FROM workspace_ai_keys
      WHERE workspace_owner_id = ? AND status = 'active'`,
  ).bind(ownerId).all().catch(() => ({ results: [] }));
  if (!results?.length) return {};

  const chaves = {};
  for (const linha of results) {
    const provedor = porId(linha.provider);
    if (!provedor) continue;
    try {
      const segredo = await decifrar(env, linha);
      if (!segredo) continue;
      chaves[provedor.envKey] = segredo;
      if (linha.model) chaves[provedor.modeloEnvKey] = linha.model;
      // Marca para a cascata saber que esta veio do espaço e deve ir na frente.
      chaves[`__DO_ESPACO_${provedor.envKey}`] = "1";
    } catch (erro) {
      // Uma chave que não abre não pode derrubar as outras: o cofre pode ter
      // sido rotacionado depois do cadastro.
      console.error("ai-keys: chave ilegível", linha.provider, erro?.message);
    }
  }
  return chaves;
}

/**
 * O `env` que a cascata do `ai.js` deve receber quando a chamada acontece
 * dentro de um espaço de trabalho.
 *
 * Sobrepõe, nunca apaga: um provedor que o espaço não trouxe continua valendo
 * pelo cofre, e a cascata segue tendo para onde cair.
 */
export async function envComChavesDoEspaco(env, ownerId) {
  const chaves = await chavesDoEspaco(env, ownerId);
  return Object.keys(chaves).length ? { ...env, ...chaves } : env;
}

// ===== Teste de conexão =====
//
// Cadastrar sem saber se funciona é o estado que faz a pessoa desistir da tela.
// O teste é a menor chamada possível de cada provedor.
const testarChave = async (provedorId, segredo, modelo) => {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), 12000);
  try {
    if (provedorId === "anthropic") {
      const resposta = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controle.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": segredo,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelo || "claude-opus-5",
          max_tokens: 16,
          messages: [{ role: "user", content: "Responda somente OK." }],
        }),
      });
      if (!resposta.ok) {
        const corpo = await resposta.text().catch(() => "");
        return { ok: false, erro: `Anthropic ${resposta.status}: ${corpo.slice(0, 200)}` };
      }
      return { ok: true, erro: "" };
    }

    if (provedorId === "google") {
      const alvo = modelo || "gemini-flash-lite-latest";
      const resposta = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(alvo)}:generateContent`,
        {
          method: "POST",
          signal: controle.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": segredo },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Responda somente OK." }] }] }),
        },
      );
      if (!resposta.ok) {
        const corpo = await resposta.text().catch(() => "");
        return { ok: false, erro: `Google ${resposta.status}: ${corpo.slice(0, 200)}` };
      }
      return { ok: true, erro: "" };
    }

    // Os demais falam o dialeto OpenAI.
    const endpoints = {
      openai: "https://api.openai.com/v1/chat/completions",
      groq: "https://api.groq.com/openai/v1/chat/completions",
      mistral: "https://api.mistral.ai/v1/chat/completions",
      openrouter: "https://openrouter.ai/api/v1/chat/completions",
    };
    const modelosPadrao = {
      openai: "gpt-5",
      groq: "openai/gpt-oss-120b",
      mistral: "mistral-small-latest",
      openrouter: "openai/gpt-oss-20b:free",
    };
    const endpoint = endpoints[provedorId];
    if (!endpoint) return { ok: false, erro: "Provedor desconhecido." };
    const resposta = await fetch(endpoint, {
      method: "POST",
      signal: controle.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${segredo}` },
      body: JSON.stringify({
        model: modelo || modelosPadrao[provedorId],
        max_tokens: 16,
        messages: [{ role: "user", content: "Responda somente OK." }],
      }),
    });
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => "");
      return { ok: false, erro: `${provedorId} ${resposta.status}: ${corpo.slice(0, 200)}` };
    }
    return { ok: true, erro: "" };
  } catch (erro) {
    return {
      ok: false,
      erro: erro?.name === "AbortError"
        ? "O provedor não respondeu em 12 segundos."
        : `Não foi possível falar com o provedor: ${erro?.message || erro}`,
    };
  } finally {
    clearTimeout(relogio);
  }
};

/**
 * `/api/ai-keys` — a tela de integrações de IA do usuário.
 *
 * `ownerId` é o espaço de trabalho da sessão, resolvido por quem chama. Não sai
 * da requisição: repetir aqui o furo do `?owner=` que a vertical já fechou
 * seria deixar alguém ler a chave de outra empresa.
 */
export async function handleAiKeys(request, env, { ownerId, userId }) {
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);
  if (!ownerId || !userId) return json({ error: "Sessão inválida." }, 401);

  const url = new URL(request.url);
  const provedorPedido = texto(url.pathname.split("/").filter(Boolean)[2], 40);

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM workspace_ai_keys WHERE workspace_owner_id = ? ORDER BY provider",
    ).bind(ownerId).all().catch(() => ({ results: [] }));
    const cadastradas = new Map((results || []).map((linha) => [linha.provider, paraTela(linha)]));
    return json({
      cofreDisponivel: String(env.WORKSPACE_AI_VAULT_KEY || "").length >= 32,
      provedores: PROVEDORES_DE_IA.map((provedor) => ({
        id: provedor.id,
        nome: provedor.nome,
        descricao: provedor.descricao,
        onde: provedor.onde,
        modeloPadrao: provedor.modeloPadrao,
        // A chave do cofre da plataforma continua servindo de reserva quando o
        // espaço não trouxe a própria. Dizer isso na tela evita a pergunta
        // "se eu não cadastrar, para de funcionar?".
        reservaDaPlataforma: Boolean(env[provedor.envKey]),
        minha: cadastradas.get(provedor.id) || null,
      })),
    });
  }

  const provedor = porId(provedorPedido);
  if (!provedor) return json({ error: "Provedor de IA desconhecido." }, 404);

  if (request.method === "DELETE") {
    await env.DB.prepare(
      "DELETE FROM workspace_ai_keys WHERE workspace_owner_id = ? AND provider = ?",
    ).bind(ownerId, provedor.id).run();
    return json({ ok: true });
  }

  if (request.method !== "POST" && request.method !== "PUT")
    return json({ error: "Método não permitido." }, 405);

  const corpo = await request.json().catch(() => ({}));

  // Ativar/desativar sem reenviar a chave.
  if (corpo.acao === "ativar" || corpo.acao === "desativar") {
    const meta = await env.DB.prepare(
      "UPDATE workspace_ai_keys SET status=?, updated_at=? WHERE workspace_owner_id=? AND provider=?",
    ).bind(corpo.acao === "ativar" ? "active" : "inactive", new Date().toISOString(), ownerId, provedor.id).run();
    if (!meta?.meta?.changes) return json({ error: "Chave não cadastrada." }, 404);
    return json({ ok: true });
  }

  // Testar a chave já cadastrada, sem reenviá-la.
  if (corpo.acao === "testar") {
    const linha = await env.DB.prepare(
      "SELECT * FROM workspace_ai_keys WHERE workspace_owner_id=? AND provider=?",
    ).bind(ownerId, provedor.id).first();
    if (!linha) return json({ error: "Chave não cadastrada." }, 404);
    let segredo = "";
    try { segredo = await decifrar(env, linha); }
    catch (erro) { return json({ error: erro.message }, 503); }
    const resultado = await testarChave(provedor.id, segredo, linha.model);
    await env.DB.prepare(
      "UPDATE workspace_ai_keys SET last_test_at=?, last_test_ok=?, last_test_error=?, updated_at=? WHERE id=?",
    ).bind(new Date().toISOString(), resultado.ok ? 1 : 0, texto(resultado.erro, 400), new Date().toISOString(), linha.id).run();
    return json({ ok: resultado.ok, erro: resultado.erro });
  }

  // Cadastrar ou trocar a chave.
  const segredo = String(corpo.chave || "").trim();
  if (segredo.length < 12) return json({ error: "Cole a chave completa do provedor." }, 400);
  if (provedor.prefixoEsperado && !segredo.startsWith(provedor.prefixoEsperado))
    return json({
      error: `A chave do ${provedor.nome} começa com "${provedor.prefixoEsperado}". Confira se copiou a chave certa.`,
    }, 400);

  const modelo = texto(corpo.modelo, 80);
  // Testa ANTES de guardar. Guardar uma chave que não funciona é criar um
  // problema que só aparece quando alguém precisa da IA.
  const resultado = await testarChave(provedor.id, segredo, modelo);
  if (!resultado.ok && corpo.salvarMesmoAssim !== true)
    return json({
      error: "A chave não foi aceita pelo provedor.",
      detalhe: resultado.erro,
      // A tela oferece guardar assim mesmo: às vezes é cota momentânea, não
      // chave errada, e obrigar a recomeçar seria pior.
      podeSalvarMesmoAssim: true,
    }, 400);

  let cifrado;
  try { cifrado = await cifrar(env, segredo); }
  catch (erro) { return json({ error: erro.message }, 503); }

  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspace_ai_keys
       (id, workspace_owner_id, provider, label, secret_ciphertext, secret_iv, secret_prefix,
        model, status, last_test_at, last_test_ok, last_test_error, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'active', ?,?,?,?,?,?)
     ON CONFLICT(workspace_owner_id, provider) DO UPDATE SET
       label=excluded.label, secret_ciphertext=excluded.secret_ciphertext,
       secret_iv=excluded.secret_iv, secret_prefix=excluded.secret_prefix,
       model=excluded.model, status='active', last_test_at=excluded.last_test_at,
       last_test_ok=excluded.last_test_ok, last_test_error=excluded.last_test_error,
       updated_at=excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), ownerId, provedor.id, texto(corpo.rotulo, 120),
    cifrado.ciphertext, cifrado.iv, `${segredo.slice(0, 7)}…`,
    modelo, agora, resultado.ok ? 1 : 0, texto(resultado.erro, 400), userId, agora, agora,
  ).run();

  return json({ ok: true, testeOk: resultado.ok, testeErro: resultado.erro }, 201);
}
