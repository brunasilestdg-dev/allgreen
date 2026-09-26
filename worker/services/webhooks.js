// ===== Envio automático para outro sistema (webhook de saída) =====
//
// Quando acontece alguma coisa no negócio — pedido novo, contato novo,
// lançamento no caixa, tarefa concluída — o servidor avisa sozinho um endereço
// que a pessoa cadastrou. É o que liga o app a Zapier, Make, n8n, uma planilha
// do Google ou um canal do Discord, sem nenhum serviço pago no meio.
//
// POR QUE ISTO SAI DO SERVIDOR, E NÃO DO NAVEGADOR
// O navegador seria bloqueado por CORS na maioria dos destinos e, pior, o
// endereço secreto do canal ficaria guardado no aparelho de quem usa. Sair do
// servidor resolve os dois — e cria um risco novo, tratado abaixo.
//
// O RISCO: SSRF
// A partir do momento em que o nosso servidor busca um endereço escolhido por
// quem usa, ele vira uma ponte. Alguém pode pedir para ele chamar um endereço
// interno, a própria API do app, ou o serviço de metadados da nuvem — e receber
// de volta, ou provocar efeito, com a identidade do servidor. Por isso
// `validateWebhookUrl` é uma lista de permissão estreita, e não uma lista de
// bloqueio: só https, só porta padrão, e nada que resolva para dentro.
// A redireção também é recusada: um endereço público que responde 302 para
// 127.0.0.1 driblaria a checagem feita só na entrada.

import { isPrivateIpv6Literal } from "../lib/net.js";

const texto = (v) => String(v ?? "");

// ---------------------------------------------------------------------------
// O que pode ser avisado
// ---------------------------------------------------------------------------

// Catálogo fechado. Só o que está aqui é enviado, e só os campos listados —
// o corpo NUNCA leva o espaço de trabalho inteiro.
export const WEBHOOK_EVENTS = [
  {
    id: "pedido.novo",
    label: "Pedido novo",
    colecao: "orders",
    campos: ["id", "customer", "total", "status", "createdAt"],
  },
  {
    id: "contato.novo",
    label: "Contato novo",
    colecao: "contacts",
    campos: ["id", "name", "phone", "email", "source", "createdAt"],
  },
  {
    id: "lancamento.novo",
    label: "Lançamento no caixa",
    colecao: "transactions",
    campos: ["id", "type", "amount", "category", "description", "date"],
  },
  {
    id: "agendamento.novo",
    label: "Agendamento novo",
    colecao: "appointments",
    campos: ["id", "client", "service", "date", "status"],
  },
  {
    id: "tarefa.nova",
    label: "Tarefa nova",
    colecao: "tasks",
    campos: ["id", "title", "status", "dueDate", "assignee"],
  },
];

export const eventById = (id) => WEBHOOK_EVENTS.find((e) => e.id === id) || null;

export const isKnownEvent = (id) => !!eventById(id);

// ---------------------------------------------------------------------------
// Validação do endereço — a parte que segura o SSRF
// ---------------------------------------------------------------------------

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Faixas que nunca são um destino legítimo de webhook: elas só existem dentro
// da rede de quem hospeda.
export const isPrivateIpv4 = (host) => {
  const m = IPV4.exec(texto(host));
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => !Number.isInteger(n) || n > 255))
    return true; // número impossível: recusa em vez de tentar entender
  if (a === 10) return true; // rede privada
  if (a === 127) return true; // a própria máquina
  if (a === 0) return true; // "esta rede"
  if (a === 172 && b >= 16 && b <= 31) return true; // rede privada
  if (a === 192 && b === 168) return true; // rede privada
  if (a === 169 && b === 254) return true; // link-local E metadados da nuvem
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast e reservado
  return false;
};

export const isPrivateIpv6 = (host) => {
  const h = texto(host).toLowerCase().replace(/^\[|\]$/g, "");
  if (!h.includes(":")) return false;
  // A regra mora em worker/lib/net.js, a fonte única. Ela entende o IPv4
  // embutido também na forma que `new URL()` devolve: "::ffff:127.0.0.1" vira
  // "::ffff:7f00:1" antes de chegar aqui, e a regex antiga, que só procurava o
  // IPv4 pontuado, deixava esse endereço passar.
  return isPrivateIpv6Literal(h);
};

const NOMES_INTERNOS = [
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
];

const SUFIXOS_INTERNOS = [".local", ".internal", ".localdomain", ".home.arpa"];

export const validateWebhookUrl = (bruto, opcoes = {}) => {
  const cru = texto(bruto).trim();
  if (!cru) return { ok: false, motivo: "Informe o endereço." };
  if (cru.length > 400)
    return { ok: false, motivo: "Endereço longo demais." };

  let url;
  try {
    url = new URL(cru);
  } catch {
    return { ok: false, motivo: "Endereço inválido. Comece com https://" };
  }

  if (url.protocol !== "https:")
    return {
      ok: false,
      motivo:
        "Só aceitamos https. Em http o conteúdo trafega aberto e qualquer um no caminho lê o que o seu negócio enviou.",
    };

  if (url.username || url.password)
    return {
      ok: false,
      motivo: "Não coloque usuário e senha no endereço.",
    };

  // Porta fora da padrão quase sempre aponta para serviço interno.
  if (url.port && url.port !== "443")
    return { ok: false, motivo: "Use a porta padrão do https." };

  const host = url.hostname.toLowerCase();

  if (NOMES_INTERNOS.includes(host) || SUFIXOS_INTERNOS.some((s) => host.endsWith(s)))
    return { ok: false, motivo: "Esse endereço aponta para dentro da rede." };

  if (isPrivateIpv4(host) || isPrivateIpv6(host))
    return { ok: false, motivo: "Esse endereço aponta para dentro da rede." };

  // Apontar para o próprio app transformaria o nosso servidor numa ponte para
  // a nossa própria API, com a identidade dele.
  const proprio = texto(opcoes.selfHost).toLowerCase();
  if (proprio && (host === proprio || host.endsWith(`.${proprio}`)))
    return { ok: false, motivo: "Esse endereço é do próprio aplicativo." };

  return { ok: true, url: url.toString() };
};

// ---------------------------------------------------------------------------
// Corpo e assinatura
// ---------------------------------------------------------------------------

// Campos que nunca saem, mesmo que o evento os liste por engano no futuro.
const PROIBIDOS =
  /(senha|password|token|secret|segredo|apikey|api_key|authorization|cookie|cpf|cnpj)/i;

export const pickFields = (item, campos = []) => {
  const saida = {};
  for (const campo of campos) {
    if (PROIBIDOS.test(campo)) continue;
    const v = item?.[campo];
    if (v === undefined || v === null) continue;
    saida[campo] = typeof v === "object" ? JSON.stringify(v).slice(0, 500) : v;
  }
  return saida;
};

export const buildPayload = (eventoId, item, contexto = {}) => {
  const evento = eventById(eventoId);
  return {
    evento: eventoId,
    em: contexto.agora || new Date().toISOString(),
    negocio: contexto.negocio || null,
    dados: evento ? pickFields(item, evento.campos) : {},
  };
};

const hex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Assinatura com o carimbo de tempo junto: assinar só o corpo deixaria quem
// interceptasse reenviar a mesma mensagem para sempre.
export const signPayload = async (segredo, corpo, carimbo, cripto = crypto) => {
  const chave = await cripto.subtle.importKey(
    "raw",
    new TextEncoder().encode(texto(segredo)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = await cripto.subtle.sign(
    "HMAC",
    chave,
    new TextEncoder().encode(`${carimbo}.${texto(corpo)}`),
  );
  return hex(assinatura);
};

export const MAX_ENVIOS_POR_MINUTO = 30;
export const TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Descobrir o que é novo
// ---------------------------------------------------------------------------

// Compara o espaço de trabalho anterior com o novo e devolve o que apareceu.
// Fazer isso no servidor, no momento em que o espaço é gravado, é o que permite
// avisar sem precisar mexer em cada tela do app — e funciona igual venha o
// registro de onde vier.
export const diffNewItems = (anterior, atual, eventos = WEBHOOK_EVENTS) => {
  const achados = [];
  for (const evento of eventos) {
    const antes = Array.isArray(anterior?.[evento.colecao])
      ? anterior[evento.colecao]
      : [];
    const depois = Array.isArray(atual?.[evento.colecao])
      ? atual[evento.colecao]
      : [];
    if (!depois.length) continue;
    // Espaço novo, sem versão anterior: não dispara nada. Senão a primeira
    // gravação de quem já tem 300 contatos mandaria 300 avisos de uma vez.
    if (!anterior) continue;
    const jaVistos = new Set(antes.map((x) => x?.id).filter(Boolean));
    for (const item of depois) {
      if (!item?.id || jaVistos.has(item.id)) continue;
      achados.push({ evento: evento.id, item });
      // Teto por gravação: uma importação de planilha não pode virar uma
      // enxurrada de avisos.
      if (achados.length >= 20) return achados;
    }
  }
  return achados;
};

// ---------------------------------------------------------------------------
// Handlers HTTP
// ---------------------------------------------------------------------------

export function createWebhookHandlers({ json, allowed, randomHex }) {
  const schemaPronto = new WeakSet();

  async function ensureSchema(env) {
    if (schemaPronto.has(env)) return;
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_status TEXT,
        last_at TEXT,
        failures INTEGER NOT NULL DEFAULT 0
      )`,
    ).run();
    await env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_webhooks_owner ON webhooks (owner_id, enabled)",
    ).run();
    schemaPronto.add(env);
  }

  const publico = (linha) => ({
    id: linha.id,
    url: linha.url,
    label: linha.label || "",
    events: (() => {
      try {
        return JSON.parse(linha.events);
      } catch {
        return [];
      }
    })(),
    enabled: !!linha.enabled,
    createdAt: linha.created_at,
    lastStatus: linha.last_status || null,
    lastAt: linha.last_at || null,
    failures: linha.failures || 0,
  });

  // Entrega. Nunca lança: falha de webhook não pode derrubar a gravação do
  // espaço de trabalho de quem está usando.
  async function deliver(env, assinatura, corpoObj) {
    const corpo = JSON.stringify(corpoObj);
    const carimbo = String(Date.now());
    let status = "erro";
    try {
      const assinado = await signPayload(assinatura.secret, corpo, carimbo);
      const resposta = await fetch(assinatura.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "SeuFuncionario-Webhook/1",
          "x-seufuncionario-evento": corpoObj.evento || "",
          "x-seufuncionario-carimbo": carimbo,
          "x-seufuncionario-assinatura": `sha256=${assinado}`,
        },
        body: corpo,
        // Uma redireção para 127.0.0.1 driblaria a checagem do endereço, que
        // só acontece no cadastro.
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = String(resposta.status);
    } catch (erro) {
      // Endereço que não resolve, destino fora do ar, tempo esgotado: tudo cai
      // aqui e vira um registro, nunca uma exceção que suba até o pedido.
      status =
        erro?.name === "TimeoutError"
          ? "tempo esgotado"
          : erro?.name === "AbortError"
            ? "cancelado"
            : "erro";
    }
    const ok = /^2\d\d$/.test(status);
    try {
      await env.DB.prepare(
        `UPDATE webhooks SET last_status = ?, last_at = ?,
          failures = CASE WHEN ? THEN 0 ELSE failures + 1 END,
          enabled = CASE WHEN ? THEN enabled WHEN failures + 1 >= 20 THEN 0 ELSE enabled END
        WHERE id = ?`,
      )
        .bind(status, new Date().toISOString(), ok ? 1 : 0, ok ? 1 : 0, assinatura.id)
        .run();
    } catch {
      /* registrar o resultado é secundário: nunca vale derrubar o pedido */
    }
    return { ok, status };
  }

  // Chamado depois de gravar o espaço de trabalho. Só faz trabalho se a conta
  // realmente tiver algum envio cadastrado.
  async function notifyWorkspaceChange(env, ownerId, anterior, atual, negocio) {
    if (!env?.DB) return { enviados: 0 };
    await ensureSchema(env);
    const { results } = await env.DB.prepare(
      "SELECT * FROM webhooks WHERE owner_id = ? AND enabled = 1",
    )
      .bind(ownerId)
      .all();
    if (!results?.length) return { enviados: 0 };

    const novidades = diffNewItems(anterior, atual);
    if (!novidades.length) return { enviados: 0 };

    let enviados = 0;
    for (const assinatura of results) {
      let inscritos = [];
      try {
        inscritos = JSON.parse(assinatura.events) || [];
      } catch {
        inscritos = [];
      }
      for (const novidade of novidades) {
        if (!inscritos.includes(novidade.evento)) continue;
        if (!allowed(`webhook:${ownerId}`, MAX_ENVIOS_POR_MINUTO)) return { enviados };
        await deliver(
          env,
          assinatura,
          buildPayload(novidade.evento, novidade.item, { negocio }),
        );
        enviados++;
      }
    }
    return { enviados };
  }

  async function handleWebhooks(request, env, user, url) {
    if (!env?.DB) return json({ error: "Indisponível." }, 503);
    await ensureSchema(env);
    const ownerId = url.searchParams.get("owner") || user.id;
    // Envio automático mexe com dados do negócio saindo para fora: é decisão
    // de dono, não de colaborador convidado.
    if (ownerId !== user.id)
      return json({ error: "Só o dono do espaço configura o envio." }, 403);

    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM webhooks WHERE owner_id = ? ORDER BY created_at DESC",
      )
        .bind(ownerId)
        .all();
      return json({
        webhooks: (results || []).map(publico),
        eventos: WEBHOOK_EVENTS.map((e) => ({ id: e.id, label: e.label, campos: e.campos })),
      });
    }

    if (request.method === "POST") {
      if (!allowed(`webhook-cfg:${user.id}`, 12))
        return json({ error: "Muitas tentativas. Aguarde um minuto." }, 429);
      let corpo = {};
      try {
        corpo = await request.json();
      } catch {
        return json({ error: "Corpo inválido." }, 400);
      }

      const testeDe = texto(corpo.testar).trim();
      if (testeDe) {
        const linha = await env.DB.prepare(
          "SELECT * FROM webhooks WHERE id = ? AND owner_id = ?",
        )
          .bind(testeDe, ownerId)
          .first();
        if (!linha) return json({ error: "Envio não encontrado." }, 404);
        const r = await deliver(env, linha, {
          evento: "teste",
          em: new Date().toISOString(),
          negocio: texto(corpo.negocio) || null,
          dados: { mensagem: "Teste do Seu Funcionário. Está funcionando." },
        });
        return json(r);
      }

      const checagem = validateWebhookUrl(corpo.url, {
        selfHost: new URL(request.url).hostname,
      });
      if (!checagem.ok) return json({ error: checagem.motivo }, 400);

      const eventos = (Array.isArray(corpo.events) ? corpo.events : []).filter(
        isKnownEvent,
      );
      if (!eventos.length)
        return json({ error: "Escolha pelo menos um aviso para enviar." }, 400);

      const quantos = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM webhooks WHERE owner_id = ?",
      )
        .bind(ownerId)
        .first();
      if ((quantos?.n || 0) >= 10)
        return json({ error: "Limite de 10 envios por espaço." }, 400);

      const id = randomHex(16);
      const segredo = randomHex(32);
      await env.DB.prepare(
        `INSERT INTO webhooks (id, owner_id, url, secret, events, label, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      )
        .bind(
          id,
          ownerId,
          checagem.url,
          segredo,
          JSON.stringify(eventos),
          texto(corpo.label).slice(0, 60),
          new Date().toISOString(),
        )
        .run();

      // O segredo aparece UMA vez. Depois disso nem a nossa tela o mostra: se
      // ele vazasse do banco, qualquer um forjaria avisos para o destino.
      return json({
        id,
        secret: segredo,
        aviso:
          "Guarde este segredo agora. Ele serve para o outro sistema conferir que o aviso veio mesmo de nós, e não será mostrado de novo.",
      });
    }

    if (request.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      await env.DB.prepare("DELETE FROM webhooks WHERE id = ? AND owner_id = ?")
        .bind(id, ownerId)
        .run();
      return json({ ok: true });
    }

    return json({ error: "Método não permitido." }, 405);
  }

  return { handleWebhooks, notifyWorkspaceChange, ensureSchema };
}
