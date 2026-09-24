// ===== Portal do Cliente: API =====
//
// Regra única deste arquivo: o cliente da sessão sai do banco, nunca da
// requisição. Não existe parâmetro `client` em endpoint nenhum daqui. Quem
// tentar passar um é ignorado, porque não há onde ele entrar.
//
// A autenticação, a sessão, os usuários, a auditoria e o banco são os mesmos
// do resto do Seu Funcionário. Isto é outra experiência, não outro sistema.
//
// A API interna de clientes, a carteira comercial e o envio de e-mail moram
// em `todogreen-clients.js`, e a normalização dos campos do CRM em
// `crm-fields.js` — não são portal. Continuam exportados daqui para quem já
// importava deste caminho.

import {
  filtrarOperacoes,
  ocorrenciasDaLinha,
  ordenarLinhaDoTempo,
  paginar,
  previsaoContraCombinado,
  resumirOperacoes,
  slaDaOperacao,
} from "../../src/features/logistics/operationTrackingDomain.js";
import {
  clientCan,
  menuForAccess,
  normalizeEmail,
  permissionsForRole,
  clientPortalRole,
  resolveClientScope,
  scopedWhere,
} from "../../src/features/logistics/customerPortalDomain.js";
import {
  STATUS_SOLICITACAO,
  TIPOS_LISTA,
  aplicarTransicao,
  prazoDaSolicitacao,
  resumoParaCliente,
  statusValido,
  validarSolicitacao,
} from "../../src/features/logistics/clientRequestDomain.js";
import {
  calcularNPS,
  causasDeInsatisfacao,
  classificarNPS,
  faixaNPS,
  precisaOcorrencia,
} from "../../src/features/logistics/npsDomain.js";
import { allowed as limitarTaxa } from "../lib/http.js";
import {
  INSTRUCAO_ASSISTENTE,
  RESPOSTA_FORA_DE_ESCOPO,
  foraDoEscopoDoCliente,
  montarContextoDoCliente,
  validarContexto,
} from "../../src/features/logistics/customerAssistantDomain.js";
import {
  LIMITE_MENSAGEM,
  triagemAtendimento,
} from "../../src/features/logistics/atendimentoAutomatizadoDomain.js";
import { runWithFallback } from "./ai.js";
import { envComChavesDoEspaco } from "./ai-keys.js";
import { blocoDeContexto as blocoDeContextoDoNegocio } from "../../src/features/logistics/businessContextDomain.js";
import { TENANT_ID, clean, parse, response } from "./todogreen-client-helpers.js";

export { handleTodoGreenClientAssignments, handleTodoGreenClients, handleTodoGreenSendEmail } from "./todogreen-clients.js";
export { mergeImportedCrm } from "./crm-fields.js";

const MAX_LIMIT = 100;

// ===== O perfil público da To Do Green no portal =====
//
// Lê APENAS as linhas com sigilo 'publico'. O corte é no SQL, de propósito: um
// filtro depois da leitura deixaria o dado interno passar por variável de
// aplicação, e basta um `JSON.stringify` distraído para ele acabar num log ou
// num payload. Aqui o que é interno nunca sai do banco.
const dossiePublicoDoEspaco = async (env, workspaceOwnerId) => {
  try {
    const { results } = await env.DB.prepare(
      `SELECT fact_key, category, title, content, source, effective_at, secrecy, pinned
         FROM todogreen_business_context
        WHERE tenant_id='todogreen' AND workspace_owner_id=? AND archived_at IS NULL
          AND secrecy='publico'
        ORDER BY pinned DESC, updated_at DESC LIMIT 60`,
    ).bind(workspaceOwnerId).all();
    return (results || []).map((row) => ({
      chave: row.fact_key,
      categoria: row.category,
      titulo: row.title,
      conteudo: row.content,
      fonte: row.source,
      vigenteEm: row.effective_at,
      sigilo: "publico",
      fixado: Number(row.pinned || 0) === 1,
    }));
  } catch (erro) {
    // Sem perfil o assistente responde só sobre a operação do cliente, como
    // fazia antes. Perder o perfil não pode derrubar o portal.
    console.error("portal: perfil público indisponível", erro?.message || erro);
    return [];
  }
};

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// Mesma sessão do resto do produto: o portal não tem login próprio.
async function authenticatedUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !env.DB) return null;
  return env.DB.prepare(
    `SELECT u.id, u.name, u.email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first()
    .catch(() => null);
}


// O ponto onde o isolamento acontece. Uma consulta, pelo e-mail da sessão.
// O resultado carrega o cliente; nada além dele é alcançável depois.
// As empresas que este e-mail alcança. Antes a consulta terminava em `LIMIT 1`
// porque a restrição do banco garantia que só havia uma — e era essa restrição
// que deixava de fora grupo empresarial, consultoria, auditor e gestor de
// subsidiárias, que são justamente quem tem várias empresas e um e-mail só.
async function vinculosDaSessao(env, user) {
  if (!user?.email) return [];
  const { results } = await env.DB.prepare(
    `SELECT v.tenant_id, v.client_id, v.email, v.role, v.status,
            c.name AS client_name, c.status AS client_status,
            c.portal_enabled, c.workspace_owner_id
       FROM todogreen_client_users v
       JOIN todogreen_clients c ON c.id = v.client_id AND c.tenant_id = v.tenant_id
      WHERE v.tenant_id = ? AND v.email = ?
      ORDER BY c.name COLLATE NOCASE
      LIMIT 50`,
  )
    .bind(TENANT_ID, normalizeEmail(user.email))
    .all()
    .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
  return (results || []).map(resolveClientScope).filter(Boolean);
}

// A empresa da requisição sai SEMPRE da lista que a sessão alcança. Aceitar o
// id que veio na query string sem confrontar seria o mesmo furo do `?owner=`
// que já foi fechado no lado interno: trocar o parâmetro e operar dado alheio.
async function clientScopeForSession(env, user, clientePedido = "") {
  const vinculos = await vinculosDaSessao(env, user);
  if (!vinculos.length) return null;
  const pedido = clean(clientePedido, 120);
  if (pedido) return vinculos.find((v) => v.clientId === pedido) || null;
  // Sem escolha explícita, a primeira em ordem alfabética — determinística, e
  // não "a que o banco devolveu primeiro".
  return vinculos[0];
}

// Campos livres que PODEM sair para o cliente. O fields_json é escrito pela
// equipe interna sem validação de chave: se um operador digitar "margem",
// "custoPorKm" ou um CPF num campo livre, isso NÃO pode vazar no portal. O
// assistente já filtra por lista (CAMPOS_PROIBIDOS); o payload cru não
// filtrava nada — este allowlist fecha o buraco. Só entra o que é operacional
// e do interesse legítimo do embarcador.
const CAMPOS_LIBERADOS_AO_CLIENTE = new Set([
  "deliveries", "entregas", "packages", "pacotes", "trips", "viagens",
  "distanceKm", "occupancyPercent", "dataQuality", "energyKwh",
  "weightKg", "tons", "pallets", "successRate",
  // Prova de entrega: quem recebeu e em que condição. Nome e tipo do recebedor
  // são o que o embarcador legitimamente acompanha; o documento pessoal do
  // recebedor nunca entra em `fields_json`, então não há o que vazar aqui.
  "receiverName", "receiverKind",
]);
const camposParaCliente = (bruto) =>
  Object.fromEntries(
    Object.entries(bruto && typeof bruto === "object" ? bruto : {})
      .filter(([chave, valor]) => CAMPOS_LIBERADOS_AO_CLIENTE.has(chave) && typeof valor !== "object"),
  );

// Uma linha da tabela vira uma operação com os nomes que o domínio entende.
// A tradução fica num lugar só: espalhá-la faria a lista e o detalhe divergirem
// justamente nos campos de prazo, que é onde a divergência custa caro.
const operacaoDoBanco = (linha) => ({
  id: linha.id,
  referencia: linha.reference,
  situacao: linha.status,
  dataServico: linha.service_date,
  origem: linha.origin,
  destino: linha.destination,
  prometidoEm: linha.promised_at || "",
  entregueEm: linha.delivered_at || "",
  previsaoEm: linha.eta_at || "",
  placa: linha.vehicle_plate || "",
  // O NOME DO MOTORISTA não sai para o embarcador: é dado pessoal de quem
  // dirige, sem interesse legítimo do cliente na prova de entrega. Fica gravado
  // na operação (uso interno) e é omitido aqui, na fronteira com o portal.
  distanciaKm: linha.distance_km || 0,
  // A prova de entrega e a assinatura saem por link temporário (endpoints
  // dedicados); aqui vai só o SINAL de que existem, para a lista/tela decidir o
  // que oferecer sem expor a URL de origem.
  temComprovante: Boolean(linha.proof_url),
  temAssinatura: Boolean(linha.signature_url),
  ocorrencias: Number(linha.ocorrencias || linha.incident_count || 0),
  ultimaPosicao:
    linha.last_position_at && linha.last_position_lat !== null
      ? {
          em: linha.last_position_at,
          latitude: linha.last_position_lat,
          longitude: linha.last_position_lng,
        }
      : null,
  campos: camposParaCliente(parse(linha.fields_json, {})),
});

async function logPortalEvent(env, escopo, user, action, target = "", details = "") {
  await env.DB.prepare(
    `INSERT INTO todogreen_client_portal_events
       (id, tenant_id, workspace_owner_id, client_id, user_id, email, action, target, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      escopo.tenantId,
      escopo.workspaceOwnerId,
      escopo.clientId,
      user?.id || null,
      escopo.email,
      clean(action, 80),
      clean(target, 200),
      clean(details, 500),
      new Date().toISOString(),
    )
    .run()
    .catch(() => {});
}

// ----- Indicadores do cliente -----
//
// Cada número abaixo é lido das tabelas da vertical, sempre com o cliente da
// sessão amarrado na condição. Sem registro, o número não é inventado: vem
// zero e a tela diz que não há dado.
async function clientOverview(env, escopo) {
  const { sql, params } = scopedWhere(escopo);

  const operacoes = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CAST(json_extract(fields_json, '$.deliveries') AS REAL)), 0) AS entregas,
            COALESCE(SUM(CAST(json_extract(fields_json, '$.distanceKm') AS REAL)), 0) AS km,
            COALESCE(AVG(CAST(json_extract(fields_json, '$.occupancyPercent') AS REAL)), 0) AS ocupacao
       FROM todogreen_client_operations
      WHERE ${sql} AND lower(status) != 'rascunho'`,
  )
    .bind(...params)
    .first()
    .catch(() => null);

  // Reusa a tabela que a vertical já grava; os números moram no resultado em
  // JSON, com os mesmos nomes que o motor ambiental produz.
  const ambiental = await env.DB.prepare(
    `SELECT COALESCE(SUM(CAST(json_extract(result_json, '$.impact.co2AvoidedKg') AS REAL)), 0) AS co2,
            COALESCE(SUM(CAST(json_extract(result_json, '$.impact.dieselAvoidedLiters') AS REAL)), 0) AS diesel,
            -- Cenário convencional × operação real: os dois lados da comparação
            -- que a tela promete e que o motor já grava. As chaves são as que o
            -- motor ambiental emite (co2ReferenciaKg/co2ExecutadoKg) — antes esta
            -- consulta lia referenceEmissionsKg/actualEmissionsKg, que não existem
            -- no result_json, então convencional/realizado vinham sempre 0 e o
            -- bloco "Comparação de cenários" nunca renderizava.
            COALESCE(SUM(CAST(json_extract(result_json, '$.impact.co2ReferenciaKg') AS REAL)), 0) AS convencional,
            COALESCE(SUM(CAST(json_extract(result_json, '$.impact.co2ExecutadoKg') AS REAL)), 0) AS realizado,
            COALESCE(AVG(CAST(json_extract(result_json, '$.impact.reductionPercent') AS REAL)), 0) AS reducao,
            COALESCE(AVG(data_quality), 0) AS qualidade,
            COUNT(*) AS calculos
       FROM environmental_calculations
      WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ?`,
  )
    .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId)
    .first()
    .catch(() => null);

  // As duas notas mais recentes: a atual e a anterior. A tela mostra a
  // composição (components_json) e a variação (atual − anterior) — antes o
  // /resumo só devolvia valor/versão/data, então "Composição da nota" caía
  // sempre no texto de fallback e a variação nunca aparecia.
  const scores = await env.DB.prepare(
    `SELECT score, weights_version, components_json, calculated_at
       FROM todogreen_green_scores
      WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND scope_type = 'cliente'
      ORDER BY calculated_at DESC LIMIT 2`,
  )
    .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId)
    .all()
    .catch(() => null);

  const scoreRows = scores?.results || [];
  const score = scoreRows[0] || null;
  const scoreAnterior = scoreRows[1] || null;

  return {
    operacoes: {
      total: operacoes?.total || 0,
      entregas: operacoes?.entregas || 0,
      distanciaKm: operacoes?.km || 0,
      ocupacaoMedia: operacoes?.ocupacao || 0,
    },
    ambiental: {
      co2EvitadoKg: ambiental?.co2 || 0,
      dieselEvitadoL: ambiental?.diesel || 0,
      // A comparação de cenários do portal lê estes dois campos (antes vinham
      // sempre 0, então o bloco nunca renderizava).
      emissaoConvencionalKg: ambiental?.convencional || 0,
      emissaoTodogreenKg: ambiental?.realizado || 0,
      reducaoPercent: ambiental?.reducao || 0,
      qualidadeDados: ambiental?.qualidade || 0,
      calculos: ambiental?.calculos || 0,
    },
    greenScore: score
      ? {
          valor: score.score,
          versaoPesos: score.weights_version,
          calculadoEm: score.calculated_at,
          componentes: parse(score.components_json, {}),
          anterior: scoreAnterior ? scoreAnterior.score : null,
        }
      : null,
    // Sem dado é sem dado. A tela mostra convite para cadastrar, não número
    // bonito que ninguém pode auditar.
    semDados:
      !(operacoes?.total || 0) && !(ambiental?.calculos || 0) && !score,
  };
}

// Prévia interna e somente leitura. Ela monta o mesmo escopo e o mesmo menu
// usados pelo portal, mas não cria uma sessão de cliente nem grava eventos em
// nome dele. O id ainda passa pela regra da carteira do usuário interno.
export async function handleTodoGreenClientPortalPreview(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  if (request.method !== "GET") return response({ error: "Método não permitido." }, 405);
  const url = new URL(request.url);
  const clientId = clean(url.pathname.split("/").filter(Boolean)[3], 60);
  if (!clientId) return response({ error: "Informe o cliente." }, 400);
  const canManageInternal = ["owner", "admin"].includes(access?.role) ||
    access?.permissions?.includes("*") || access?.permissions?.includes("clients:manage");
  const sessionEmail = normalizeEmail(user?.email);
  const client = await env.DB.prepare(
    `SELECT c.id,c.name,c.status,c.portal_enabled,c.workspace_owner_id
       FROM todogreen_clients c
      WHERE c.id=? AND c.tenant_id=? AND c.workspace_owner_id=? AND c.archived_at IS NULL
        AND (?=1 OR EXISTS (
          SELECT 1 FROM todogreen_client_assignments a
           WHERE a.tenant_id=c.tenant_id AND a.client_id=c.id
             AND a.status='active' AND lower(a.seller_email)=?
        ))`,
  ).bind(clientId, TENANT_ID, access.ownerId, canManageInternal ? 1 : 0, sessionEmail).first();
  if (!client) return response({ error: "Cliente não encontrado na sua carteira." }, 404);

  const usersResult = await env.DB.prepare(
    `SELECT email,role,status,updated_at AS updatedAt
       FROM todogreen_client_users
      WHERE tenant_id=? AND client_id=? AND status='active'
      ORDER BY email`,
  ).bind(TENANT_ID, client.id).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
  const users = usersResult.results || [];
  const requestedRole = clientPortalRole(url.searchParams.get("role") || users[0]?.role);
  const previewScope = {
    tenantId: TENANT_ID, clientId: client.id, clientName: client.name,
    workspaceOwnerId: client.workspace_owner_id, email: sessionEmail,
    role: requestedRole, permissions: permissionsForRole(requestedRole), status: "active",
  };
  const { sql, params } = scopedWhere(previewScope);
  const [summary, recent, documents, requests] = await Promise.all([
    clientOverview(env, previewScope),
    env.DB.prepare(
      `SELECT id,reference,status,service_date AS serviceDate,origin,destination
         FROM todogreen_client_operations WHERE ${sql} AND lower(status) != 'rascunho'
        ORDER BY service_date DESC,created_at DESC LIMIT 5`,
    ).bind(...params).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] })),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM todogreen_evidences WHERE ${sql}`)
      .bind(...params).first().catch(() => ({ total: 0 })),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM todogreen_client_requests WHERE ${sql}`)
      .bind(...params).first().catch(() => ({ total: 0 })),
  ]);
  return response({
    preview: true,
    client: { id: client.id, name: client.name },
    portal: {
      enabled: client.portal_enabled === 1,
      role: requestedRole,
      permissions: previewScope.permissions,
      menu: menuForAccess(previewScope),
    },
    users: users.map((item) => ({ email: item.email, role: clientPortalRole(item.role), updatedAt: item.updatedAt })),
    summary,
    recentOperations: recent.results || [],
    counts: {
      operations: Number(summary?.operacoes?.total || 0),
      documents: Number(documents?.total || 0),
      requests: Number(requests?.total || 0),
    },
  });
}

// Núcleo do assistente: recusa fora de escopo, monta o contexto só do cliente
// da sessão e roda a MESMA cascata de IA do produto. Devolve um resultado
// discriminado; quem chama decide o formato da resposta e o que registra na
// trilha. Reusado pelo endpoint /assistente e pela caixa automatizada — uma só
// regra de contexto e de recusa, nunca duas versões que divergem.
async function gerarRespostaDoAssistente(env, escopo, pergunta) {
  if (foraDoEscopoDoCliente(pergunta)) return { estado: "fora_escopo" };

  const resumo = await clientOverview(env, escopo);
  const { sql, params } = scopedWhere(escopo);
  const recentes = await env.DB.prepare(
    `SELECT reference, status, service_date, origin, destination, fields_json
       FROM todogreen_client_operations
      WHERE ${sql}
      ORDER BY service_date DESC LIMIT 20`,
  )
    .bind(...params)
    .all()
    .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

  let contexto;
  try {
    contexto = montarContextoDoCliente({
      cliente: { id: escopo.clientId, nome: escopo.clientName },
      resumo,
      greenScore: resumo.greenScore,
      operacoes: (recentes.results || []).map((linha) => ({
        referencia: linha.reference,
        data: linha.service_date,
        origem: linha.origin,
        destino: linha.destination,
        status: linha.status,
        campos: camposParaCliente(parse(linha.fields_json, {})),
      })),
    });
    // Se algum campo interno escapou para o contexto, a chamada cai aqui em vez
    // de sair pela rede.
    validarContexto(contexto);
  } catch (erro) {
    console.error("contexto do assistente", erro);
    return { estado: "erro_contexto" };
  }

  try {
    const envIa = await envComChavesDoEspaco(env, escopo.workspaceOwnerId);
    // Entra só o que está marcado como PÚBLICO no dossiê da transportadora — o
    // conteúdo que a empresa já publica em apresentação comercial. Interno e
    // restrito não chegam ao modelo, então não há o que a resposta possa vazar.
    const perfilPublico = blocoDeContextoDoNegocio(
      await dossiePublicoDoEspaco(env, escopo.workspaceOwnerId),
      { incluirRestrito: false },
    );
    const { ok, result, errors } = await runWithFallback(envIa, {
      prompt: [
        perfilPublico,
        `Dados do cliente (únicos disponíveis):\n${JSON.stringify(contexto, null, 2)}`,
        `Pergunta: ${pergunta}`,
      ].filter(Boolean).join("\n\n"),
      system: INSTRUCAO_ASSISTENTE,
    });
    if (!ok) {
      console.error("assistente do portal: todos os provedores falharam", errors);
      return { estado: "indisponivel" };
    }
    const texto = String(result?.content || "").trim();
    if (!texto) return { estado: "vazio" };
    return { estado: "ok", resposta: texto };
  } catch (erro) {
    console.error("assistente do portal", erro);
    return { estado: "indisponivel" };
  }
}

// Escalonamento da caixa: a mensagem vira o MESMO chamado que a equipe já trata
// (todogreen_client_requests), já classificado pela triagem e com prazo. A
// validação de campos obrigatórios do formulário NÃO se aplica aqui de
// propósito: a caixa é a porta em que uma pessoa completa o que faltar — o que
// não pode é a mensagem se perder. O cliente do chamado vem do escopo da
// sessão, nunca do corpo.
async function abrirChamadoAutomatico(env, escopo, user, { triagem, mensagem }) {
  const agora = new Date().toISOString();
  const id = crypto.randomUUID();
  const tipo = triagem.tipo;
  const urgencia = triagem.urgencia;
  const assunto = String(triagem.assunto || "").slice(0, 160) || "Atendimento";
  const campos = {
    // Marca a origem para a fila da equipe saber que veio da caixa automática,
    // e guarda o porquê da triagem para a pessoa não recomeçar do zero.
    origem: "caixa-automatizada",
    triagemMotivo: String(triagem.motivo || "").slice(0, 300),
  };
  await env.DB.prepare(
    `INSERT INTO todogreen_client_requests
       (id, tenant_id, client_id, workspace_owner_id, type, subject, description,
        urgency, status, fields_json, due_at, opened_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      escopo.tenantId,
      escopo.clientId,
      escopo.workspaceOwnerId || "",
      tipo,
      assunto,
      mensagem,
      urgencia,
      JSON.stringify(campos),
      prazoDaSolicitacao(tipo, urgencia, agora),
      escopo.email,
      agora,
      agora,
    )
    .run();
  // A mensagem vira a primeira linha da conversa — a thread não começa no meio.
  await inserirMensagem(env, escopo, id, {
    lado: "cliente",
    email: escopo.email,
    nome: user?.name || escopo.email,
    texto: mensagem,
  });
  await logPortalEvent(env, escopo, user, "caixa_escalada", id, assunto);
  return id;
}

export async function handleTodoGreenCustomerPortal(request, env) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);

  const url = new URL(request.url);
  const caminho = url.pathname
    .replace(/^\/api\/todogreen\/portal\/?/, "")
    .split("/")
    .filter(Boolean);
  const resource = caminho[0] || "";
  // /portal/evidencias/<id>/link
  const documentoPedido = String(caminho[1] || "").slice(0, 120);
  const subresource = String(caminho[2] || "").slice(0, 40);

  const user = await authenticatedUser(request, env);
  if (!user) return response({ error: "Sessão inválida." }, 401);

  const empresaPedida = url.searchParams.get("empresa") || "";
  const empresas = await vinculosDaSessao(env, user);
  const escopo = await clientScopeForSession(env, user, empresaPedida);
  if (!escopo)
    return response(
      {
        error: empresas.length
          // Mesma resposta para empresa inexistente e para empresa de outra
          // pessoa: distinguir contaria que ela existe.
          ? "Você não tem acesso a esta empresa."
          : "Esta conta não está vinculada a nenhum cliente da To Do Green.",
      },
      403,
    );

  // Limite de taxa por cliente/ação: o portal é superfície EXTERNA e o
  // assistente consome a MESMA cota de IA do espaço da transportadora. Sem teto,
  // um cliente autenticado queima a cota (e o custo) do dono ou infla a fila de
  // solicitações/NPS. É defesa contra rajada, por sessão e por ação.
  const excedeuLimite = (acao, teto) =>
    !limitarTaxa(`portal:${acao}:${user.id}:${escopo.clientId}`, teto);

  // Sessão — quem sou eu, o que posso ver, qual é o meu menu.
  if (request.method === "GET" && (resource === "" || resource === "sessao")) {
    await logPortalEvent(env, escopo, user, "portal_aberto");
    return response({
      cliente: { id: escopo.clientId, nome: escopo.clientName },
      papel: escopo.role,
      permissoes: escopo.permissions,
      menu: menuForAccess(escopo),
      usuario: { nome: user.name, email: escopo.email },
      // A lista vai junto na abertura: sem ela o portal não teria como oferecer
      // a troca, e um grupo empresarial ficaria preso na primeira empresa.
      empresas: empresas.map((v) => ({ id: v.clientId, nome: v.clientName, papel: v.role })),
    });
  }

  if (request.method === "GET" && resource === "resumo") {
    return response({ resumo: await clientOverview(env, escopo) });
  }

  // A lista de operações. Era referência, status, data, origem e destino, sem
  // busca, filtro, prazo, ocorrência nem paginação — e o cliente entra no
  // portal justamente para acompanhar a carga.
  //
  // Busca, filtro e paginação acontecem no domínio, com o mesmo código que a
  // tela usa: duas implementações da mesma pergunta produzem dois "atrasado"
  // diferentes.
  if (request.method === "GET" && resource === "operacoes" && !documentoPedido) {
    const { sql, params } = scopedWhere(escopo);
    const linhas = await env.DB.prepare(
      `SELECT o.id, o.reference, o.status, o.service_date, o.origin, o.destination,
              o.fields_json, o.created_at, o.promised_at, o.delivered_at, o.eta_at,
              o.vehicle_plate, o.distance_km, o.proof_url, o.proof_hash,
              o.signature_url,
              o.last_position_at, o.last_position_lat, o.last_position_lng,
              (SELECT COUNT(*) FROM todogreen_client_operation_events e
                WHERE e.operation_id = o.id AND e.kind = 'ocorrencia') AS ocorrencias
         FROM todogreen_client_operations o
        WHERE ${sql} AND lower(o.status) != 'rascunho'
        ORDER BY o.service_date DESC, o.created_at DESC
        LIMIT ?`,
    )
      .bind(...params, MAX_LIMIT)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    const todas = (linhas.results || []).map(operacaoDoBanco);
    const filtradas = filtrarOperacoes(todas, {
      busca: url.searchParams.get("busca") || "",
      situacao: url.searchParams.get("situacao") || "",
      de: url.searchParams.get("de") || "",
      ate: url.searchParams.get("ate") || "",
    });
    const pagina = paginar(filtradas, {
      pagina: Number(url.searchParams.get("pagina")) || 1,
      porPagina: Math.min(Number(url.searchParams.get("porPagina")) || 20, 100),
    });

    return response({
      // O SLA vai junto de cada linha: calcular de novo na tela seria uma
      // segunda implementação da mesma pergunta, e duas implementações
      // produzem dois "atrasado" diferentes.
      //
      // A posição viva (last_position) NÃO viaja na lista: a tabela nunca a
      // desenha — ela só aparece no DETALHE, e lá com a janela LGPD de 6h e só
      // em trânsito. Deixá-la em toda linha (inclusive entregue/cancelada)
      // furava essa mesma proteção pela lista. Minimização de dados.
      operacoes: pagina.itens.map((operacao) => {
        const linha = { ...operacao, sla: slaDaOperacao(operacao) };
        delete linha.ultimaPosicao;
        return linha;
      }),
      paginacao: {
        pagina: pagina.pagina,
        paginas: pagina.paginas,
        total: pagina.total,
        primeiro: pagina.primeiro,
        ultimo: pagina.ultimo,
      },
      // O resumo é da seleção filtrada, não da carteira inteira: um filtro que
      // muda a lista e não muda o indicador faz a tela contar duas histórias.
      resumo: (({ lista, ...resto }) => resto)(resumirOperacoes(filtradas)),
    });
  }

  // Faturas do cliente: títulos a receber DELE, com vencimento, saldo e a
  // 2ª via do documento fiscal quando existir. Nenhum número interno (margem,
  // custo, comissão) passa por aqui — a consulta lê títulos filtrados pelo
  // cliente da sessão, e o valor de face é exatamente o que ele já recebeu na
  // fatura.
  if (request.method === "GET" && resource === "financeiro" && !documentoPedido) {
    if (!clientCan(escopo, "portal:document:download"))
      return response({ error: "Seu papel no portal não vê faturas." }, 403);
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.number, t.issue_date, t.due_date, t.original_amount, t.open_amount, t.status,
              f.id AS fiscal_id, f.doc_type AS fiscal_tipo, f.numero AS fiscal_numero,
              f.chave_acesso AS fiscal_chave, f.status AS fiscal_status,
              CASE WHEN COALESCE(f.xml_content, '') <> '' THEN 1 ELSE 0 END AS xml_disponivel
         FROM todogreen_financial_titles t
         LEFT JOIN todogreen_fiscal_documents f
           ON f.tenant_id = t.tenant_id AND f.workspace_owner_id = t.workspace_owner_id
          AND f.invoice_id = t.invoice_id AND f.invoice_id <> '' AND f.archived_at IS NULL
        WHERE t.tenant_id = ? AND t.workspace_owner_id = ? AND t.client_id = ?
          AND t.kind = 'receivable' AND t.archived_at IS NULL
        ORDER BY t.due_date DESC
        LIMIT 200`,
    ).bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    const titulos = (results || []).map((linha) => ({
      id: linha.id,
      numero: linha.number,
      emitidoEm: linha.issue_date,
      venceEm: linha.due_date,
      valor: linha.original_amount,
      emAberto: linha.open_amount,
      status: linha.status,
      documento: linha.fiscal_id ? {
        tipo: linha.fiscal_tipo,
        numero: linha.fiscal_numero,
        chave: linha.fiscal_chave || "",
        status: linha.fiscal_status,
        xmlDisponivel: linha.xml_disponivel === 1,
      } : null,
    }));
    await logPortalEvent(env, escopo, user, "billing_viewed");
    return response({
      titulos,
      totais: titulos.reduce((soma, titulo) => ({
        emAberto: Math.round((soma.emAberto + (["open", "partial", "overdue"].includes(titulo.status) ? titulo.emAberto : 0)) * 100) / 100,
        quitado: Math.round((soma.quitado + (titulo.status === "settled" ? titulo.valor : 0)) * 100) / 100,
      }), { emAberto: 0, quitado: 0 }),
    });
  }

  // 2ª via do XML do documento fiscal de um título do próprio cliente.
  if (request.method === "GET" && resource === "financeiro" && documentoPedido && subresource === "xml") {
    if (!clientCan(escopo, "portal:document:download"))
      return response({ error: "Seu papel no portal não baixa documentos." }, 403);
    const linha = await env.DB.prepare(
      `SELECT f.xml_content, f.doc_type, f.numero
         FROM todogreen_financial_titles t
         JOIN todogreen_fiscal_documents f
           ON f.tenant_id = t.tenant_id AND f.workspace_owner_id = t.workspace_owner_id
          AND f.invoice_id = t.invoice_id AND f.invoice_id <> '' AND f.archived_at IS NULL
        WHERE t.id = ? AND t.tenant_id = ? AND t.workspace_owner_id = ? AND t.client_id = ?
          AND t.kind = 'receivable' AND t.archived_at IS NULL`,
    ).bind(documentoPedido, escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId).first().catch(() => null);
    if (!linha || !linha.xml_content) return response({ error: "Documento não encontrado." }, 404);
    await logPortalEvent(env, escopo, user, "invoice_xml_downloaded", documentoPedido);
    return new Response(linha.xml_content, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="${linha.doc_type}-${linha.numero || "documento"}.xml"`,
        "cache-control": "no-store",
      },
    });
  }

  // O detalhe de uma operação: linha do tempo, ocorrências, prazo prometido
  // contra realizado, veículo, última posição e comprovante de entrega.
  if (request.method === "GET" && resource === "operacoes" && documentoPedido) {
    const { sql, params } = scopedWhere(escopo);
    const linha = await env.DB.prepare(
      `SELECT * FROM todogreen_client_operations WHERE ${sql} AND id = ? LIMIT 1`,
    )
      .bind(...params, documentoPedido)
      .first()
      .catch(() => null);
    if (!linha) return response({ error: "Operação não encontrada." }, 404);

    const eventos = await env.DB.prepare(
      `SELECT id, kind, titulo, descricao, local, ocorrido_em, created_at
         FROM todogreen_client_operation_events
        WHERE operation_id = ? AND tenant_id = ? AND client_id = ?
        ORDER BY ocorrido_em ASC
        LIMIT 300`,
    )
      .bind(documentoPedido, escopo.tenantId, escopo.clientId)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    const linhaDoTempo = ordenarLinhaDoTempo(
      (eventos.results || []).map((e) => ({
        id: e.id,
        tipo: e.kind,
        titulo: e.titulo,
        descricao: e.descricao,
        local: e.local,
        ocorridoEm: e.ocorrido_em,
        registradoEm: e.created_at,
      })),
    );

    const operacao = operacaoDoBanco(linha);

    // Rastreio de verdade: sem posição lançada à mão, a última posição vem do
    // TRACKER, casando a placa da operação com o vínculo de rastreamento. O
    // dado já era coletado por veículo e nunca chegava à operação do cliente.
    //
    // LGPD/limite de escopo: a posição do veículo só pode chegar ao embarcador
    // ENQUANTO a operação dele está em trânsito. Depois de entregue/cancelada o
    // caminhão pode estar rodando a rota de OUTRO cliente — mostrar o GPS vivo
    // ali vazaria localização de motorista para fora da operação. Por isso só
    // aplicamos o fallback se a operação não foi entregue nem cancelada e se a
    // posição é recente (janela de 6h); caso contrário fica "sem posição".
    const operacaoEmCurso = !linha.delivered_at && linha.status !== "cancelled";
    const recenteDesde = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    if (!operacao.ultimaPosicao && linha.vehicle_plate && operacaoEmCurso) {
      const rastreada = await env.DB.prepare(
        `SELECT p.latitude, p.longitude, p.recorded_at, p.address
           FROM todogreen_tracker_positions p
           JOIN todogreen_tracker_vehicle_links l ON l.id = p.vehicle_link_id
          WHERE p.workspace_owner_id = ? AND l.active = 1
            AND UPPER(REPLACE(l.plate, '-', '')) = UPPER(REPLACE(?, '-', ''))
            AND p.recorded_at >= ?
          ORDER BY p.recorded_at DESC
          LIMIT 1`,
      ).bind(escopo.workspaceOwnerId, linha.vehicle_plate, recenteDesde).first().catch(() => null);
      if (rastreada) {
        operacao.ultimaPosicao = {
          em: rastreada.recorded_at,
          latitude: rastreada.latitude,
          longitude: rastreada.longitude,
          endereco: rastreada.address || "",
          origem: "rastreador",
        };
      }
    }

    return response({
      operacao,
      sla: slaDaOperacao(operacao),
      previsao: previsaoContraCombinado(operacao),
      linhaDoTempo,
      ocorrencias: ocorrenciasDaLinha(linhaDoTempo),
      // O comprovante sai pelo mesmo link temporário dos documentos: endereço
      // de origem não chega ao navegador do cliente.
      comprovante: linha.proof_url
        ? { disponivel: true, impressaoDigital: linha.proof_hash }
        : { disponivel: false, motivo: "O comprovante ainda não foi anexado a esta entrega." },
      // A assinatura digital sai pelo mesmo link temporário do comprovante.
      assinatura: linha.signature_url
        ? { disponivel: true, impressaoDigital: linha.signature_hash || "" }
        : { disponivel: false, motivo: "A assinatura ainda não foi anexada a esta entrega." },
    });
  }

  if (request.method === "GET" && resource === "trilha") {
    if (!clientCan(escopo, "portal:user:manage"))
      return response({ error: "Sem permissão para ver a trilha." }, 403);
    const linhas = await env.DB.prepare(
      `SELECT action, target, details, email, created_at
         FROM todogreen_client_portal_events
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ?
        ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    return response({ eventos: linhas.results || [] });
  }

  // Dados para o relatório. O portal devolve o material bruto e a montagem do
  // documento acontece no navegador, com o mesmo código que a tela interna usa
  // — assim não existem duas versões do mesmo relatório.
  if (request.method === "GET" && resource === "relatorio") {
    if (!clientCan(escopo, "portal:report:export"))
      return response({ error: "Seu acesso não permite exportar relatórios." }, 403);

    const inicio = clean(url.searchParams.get("inicio"), 10);
    const fim = clean(url.searchParams.get("fim"), 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim))
      return response({ error: "Informe início e fim no formato AAAA-MM-DD." }, 400);

    const { sql, params } = scopedWhere(escopo, "service_date BETWEEN ? AND ?");
    const operacoes = await env.DB.prepare(
      `SELECT id, reference, status, service_date, origin, destination, fields_json
         FROM todogreen_client_operations
        WHERE ${sql}
        ORDER BY service_date`,
    )
      .bind(...params, inicio, fim)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    const calculos = await env.DB.prepare(
      `SELECT id, result_json, methodology_version, data_quality, created_at
         FROM environmental_calculations
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ?
          AND substr(created_at, 1, 10) BETWEEN ? AND ?
        ORDER BY created_at`,
    )
      .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, inicio, fim)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    const score = await env.DB.prepare(
      `SELECT score, weights_version, components_json, calculated_at
         FROM todogreen_green_scores
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND scope_type = 'cliente'
        ORDER BY calculated_at DESC LIMIT 1`,
    )
      .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId)
      .first()
      .catch(() => null);

    await logPortalEvent(env, escopo, user, "relatorio_gerado", `${inicio}..${fim}`);

    return response({
      cliente: { nome: escopo.clientName },
      periodo: { inicio, fim },
      operacoes: (operacoes.results || []).map((l) => ({
        id: l.id,
        referencia: l.reference,
        data: l.service_date,
        campos: camposParaCliente(parse(l.fields_json, {})),
      })),
      calculos: (calculos.results || []).map((l, i) => ({
        ...parse(l.result_json, {}),
        referencia: `Cálculo ${i + 1}`,
        qualidadeDados: l.data_quality,
        versaoFatores: l.methodology_version,
      })),
      greenScore: score
        ? {
            score: score.score,
            versaoPesos: score.weights_version,
            componentes: parse(score.components_json, {}),
          }
        : null,
    });
  }

  // Cofre de evidências: os documentos que sustentam os números do período.
  if (request.method === "GET" && resource === "evidencias") {
    if (!clientCan(escopo, "portal:document:download"))
      return response({ error: "Seu acesso não permite ver documentos." }, 403);
    const { sql, params } = scopedWhere(escopo);
    const linhas = await env.DB.prepare(
      `SELECT id, titulo, tipo, referencia, emitido_em, arquivo_nome, arquivo_bytes, hash_conteudo, created_at
         FROM todogreen_evidences
        WHERE ${sql}
        ORDER BY emitido_em DESC, created_at DESC
        LIMIT ?`,
    )
      .bind(...params, MAX_LIMIT)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    return response({
      evidencias: (linhas.results || []).map((l) => ({
        id: l.id,
        titulo: l.titulo,
        tipo: l.tipo,
        referencia: l.referencia,
        emitidoEm: l.emitido_em,
        arquivoNome: l.arquivo_nome,
        arquivoBytes: l.arquivo_bytes,
        // A impressão digital do conteúdo é o que permite provar depois que o
        // documento não mudou desde a emissão.
        impressaoDigital: l.hash_conteudo,
      })),
    });
  }

  // O comprovante de entrega sai pelo mesmo mecanismo dos documentos: link
  // temporário, endereço de origem escondido, cada abertura registrada.
  if (request.method === "POST" && resource === "operacoes" && subresource === "comprovante") {
    const { sql, params } = scopedWhere(escopo);
    const linha = await env.DB.prepare(
      `SELECT id, client_id, proof_url FROM todogreen_client_operations
        WHERE ${sql} AND id = ? LIMIT 1`,
    )
      .bind(...params, documentoPedido)
      .first()
      .catch(() => null);
    if (!linha) return response({ error: "Operação não encontrada." }, 404);
    if (!linha.proof_url)
      return response({ error: "O comprovante ainda não foi anexado a esta entrega." }, 409);

    const { emitirConcessaoDeArquivo } = await import("./todogreen-evidences.js");
    const concessao = await emitirConcessaoDeArquivo(env, {
      url: linha.proof_url,
      clientId: linha.client_id,
      ownerId: escopo.workspaceOwnerId,
      para: user?.id || "",
      nome: `comprovante-${linha.id}`,
    });
    await logPortalEvent(env, escopo, user, "comprovante_link_emitido", linha.id, "");
    return response(
      { url: `/api/todogreen/arquivo?t=${concessao.token}`, expiraEm: concessao.expiraEm },
      201,
    );
  }

  // A assinatura digital da entrega — mesmo mecanismo do comprovante: link
  // temporário, origem escondida, cada abertura registrada.
  if (request.method === "POST" && resource === "operacoes" && subresource === "assinatura") {
    const { sql, params } = scopedWhere(escopo);
    const linha = await env.DB.prepare(
      `SELECT id, client_id, signature_url FROM todogreen_client_operations
        WHERE ${sql} AND id = ? LIMIT 1`,
    )
      .bind(...params, documentoPedido)
      .first()
      .catch(() => null);
    if (!linha) return response({ error: "Operação não encontrada." }, 404);
    if (!linha.signature_url)
      return response({ error: "A assinatura ainda não foi anexada a esta entrega." }, 409);

    const { emitirConcessaoDeArquivo } = await import("./todogreen-evidences.js");
    const concessao = await emitirConcessaoDeArquivo(env, {
      url: linha.signature_url,
      clientId: linha.client_id,
      ownerId: escopo.workspaceOwnerId,
      para: user?.id || "",
      nome: `assinatura-${linha.id}`,
    });
    await logPortalEvent(env, escopo, user, "assinatura_link_emitido", linha.id, "");
    return response(
      { url: `/api/todogreen/arquivo?t=${concessao.token}`, expiraEm: concessao.expiraEm },
      201,
    );
  }

  // O link de download. Até aqui a aba listava metadado e a permissão se
  // chamava `portal:document:download` — prometia um arquivo e entregava uma
  // linha de tabela.
  //
  // O link é temporário porque link de documento é credencial: quem tem, abre.
  // Um endereço permanente sobrevive em histórico, em print e em e-mail
  // encaminhado, e continua valendo.
  if (request.method === "POST" && resource === "evidencias" && subresource === "link") {
    if (!clientCan(escopo, "portal:document:download"))
      return response({ error: "Seu acesso não permite baixar documentos." }, 403);
    const { sql, params } = scopedWhere(escopo);
    const doc = await env.DB.prepare(
      `SELECT id, client_id, arquivo_url FROM todogreen_evidences
        WHERE ${sql} AND id = ? LIMIT 1`,
    )
      .bind(...params, documentoPedido)
      .first()
      .catch(() => null);
    // 404 e não 403: o escopo já respondeu que não é dele.
    if (!doc) return response({ error: "Documento não encontrado." }, 404);
    if (!doc.arquivo_url)
      return response(
        { error: "Este documento está catalogado, mas o arquivo ainda não foi anexado pela equipe." },
        409,
      );

    const { emitirConcessao } = await import("./todogreen-evidences.js");
    const concessao = await emitirConcessao(env, {
      evidenceId: doc.id,
      clientId: doc.client_id,
      ownerId: escopo.workspaceOwnerId,
      para: user?.id || "",
    });
    await logPortalEvent(env, escopo, user, "documento_link_emitido", doc.id, "");
    return response(
      { url: `/api/todogreen/arquivo?t=${concessao.token}`, expiraEm: concessao.expiraEm },
      201,
    );
  }

  // Assistente. Reusa a IA já configurada no Worker; o que muda é o contexto,
  // montado aqui com o cliente da sessão e mais nada.
  if (request.method === "POST" && resource === "assistente") {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }
    const pergunta = clean(body.pergunta ?? body.question, 2000);
    if (pergunta.length < 2)
      return response({ error: "Escreva a sua pergunta." }, 400);
    // Teto por cliente: o assistente gasta a cota de IA do espaço do dono.
    if (excedeuLimite("assistente", 20))
      return response({ error: "Muitas perguntas em pouco tempo. Aguarde um instante e tente de novo." }, 429);

    // O núcleo (recusa fora de escopo + contexto isolado + cascata de IA) está
    // em `gerarRespostaDoAssistente`, compartilhado com a caixa automatizada.
    // Aqui fica só o formato da resposta e o registro na trilha.
    const r = await gerarRespostaDoAssistente(env, escopo, pergunta);
    if (r.estado === "fora_escopo") {
      await logPortalEvent(env, escopo, user, "assistente_fora_escopo", "", pergunta.slice(0, 120));
      return response({ resposta: RESPOSTA_FORA_DE_ESCOPO, foraDeEscopo: true });
    }
    if (r.estado === "erro_contexto")
      return response({ error: "Não foi possível preparar o assistente." }, 500);
    if (r.estado === "vazio")
      return response({ error: "O assistente não respondeu. Tente de novo." }, 502);
    if (r.estado !== "ok")
      return response({ error: "O assistente está indisponível agora." }, 502);
    await logPortalEvent(env, escopo, user, "assistente_pergunta", "", pergunta.slice(0, 120));
    return response({ resposta: r.resposta, foraDeEscopo: false });
  }

  // ----- Central de atendimento automatizada -----
  //
  // Uma porta só. O cliente escreve em linguagem livre; a triagem (pura) decide
  // o caminho e a caixa OU responde na hora com a IA (mesma cadeia e mesmo
  // isolamento do Assistente) OU abre o chamado já classificado, com prazo,
  // para a equipe. Nada some: quando a IA não dá conta, cai para o chamado;
  // quando falta permissão de abrir chamado, a caixa diz o que fazer em vez de
  // engolir a mensagem. O cliente vem do escopo da sessão, nunca do corpo.
  if (request.method === "POST" && resource === "caixa") {
    if (excedeuLimite("caixa", 15))
      return response({ error: "Muitas mensagens em pouco tempo. Aguarde um instante e tente de novo." }, 429);
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }
    const mensagem = clean(body.mensagem ?? body.pergunta ?? body.texto, LIMITE_MENSAGEM);
    if (mensagem.length < 2) return response({ error: "Escreva a sua mensagem." }, 400);

    // Fora de escopo (outro cliente, concorrente): mesma recusa do Assistente,
    // antes de qualquer roteamento.
    if (foraDoEscopoDoCliente(mensagem)) {
      await logPortalEvent(env, escopo, user, "caixa_fora_escopo", "", mensagem.slice(0, 120));
      return response({ tratamento: "fora_escopo", resposta: RESPOSTA_FORA_DE_ESCOPO, foraDeEscopo: true });
    }

    const triagem = triagemAtendimento(mensagem);
    const podeAbrir = clientCan(escopo, "portal:request:create");

    // Caminho 1: dá para responder na hora, com os dados do próprio cliente.
    if (triagem.autoRespondivel) {
      const r = await gerarRespostaDoAssistente(env, escopo, mensagem);
      if (r.estado === "ok") {
        await logPortalEvent(env, escopo, user, "caixa_resposta_ia", "", mensagem.slice(0, 120));
        return response({ tratamento: "respondido_ia", resposta: r.resposta, triagem });
      }
      // A IA não respondeu: em vez de deixar a mensagem no vácuo, escala — se a
      // pessoa puder abrir chamado. Nada é engolido.
      if (podeAbrir) {
        const id = await abrirChamadoAutomatico(env, escopo, user, { triagem, mensagem });
        return response(
          {
            tratamento: "escalado",
            protocolo: id,
            triagem,
            motivo: "O assistente não conseguiu responder agora; uma pessoa vai assumir.",
          },
          201,
        );
      }
      return response({
        tratamento: "sem_resposta",
        triagem,
        resposta: "Não consegui responder agora. Peça a um gestor da sua conta para abrir uma solicitação.",
      });
    }

    // Caminho 2: escala para uma pessoa (ação da equipe ou assunto sensível).
    if (!podeAbrir)
      return response({
        tratamento: "sem_permissao",
        triagem,
        resposta: "Isso precisa virar uma solicitação para a equipe. Peça a um gestor da sua conta, que tem permissão para abrir.",
      });

    const id = await abrirChamadoAutomatico(env, escopo, user, { triagem, mensagem });
    return response({ tratamento: "escalado", protocolo: id, triagem }, 201);
  }

  // ----- Solicitações -----
  //
  // A porta que a aba prometia. O cliente da solicitação vem do escopo da
  // sessão; não existe caminho para o corpo da requisição escolher outro.
  if (resource === "solicitacoes") {
    if (!clientCan(escopo, "portal:request:create") && request.method !== "GET")
      return response({ error: "Seu acesso não permite abrir solicitações." }, 403);

    if (request.method === "GET") {
      const { sql, params } = scopedWhere(escopo);
      const linhas = await env.DB.prepare(
        `SELECT id, type, subject, description, urgency, status, fields_json,
                due_at, opened_by, closed_at, created_at, updated_at
           FROM todogreen_client_requests
          WHERE ${sql}
          ORDER BY created_at DESC
          LIMIT ?`,
      )
        .bind(...params, MAX_LIMIT)
        .all()
        .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

      const solicitacoes = (linhas.results || []).map(linhaParaSolicitacao);
      const detalhe = clean(url.searchParams.get("id"), 60);
      let mensagens = [];
      if (detalhe) {
        // Mensagem interna da equipe não sai daqui. Filtrada no SQL, não na
        // tela — esconder no navegador é entregar o dado e pedir para não olhar.
        const conversa = await env.DB.prepare(
          `SELECT id, author_side, author_name, body, created_at
            FROM todogreen_client_request_messages
            WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND request_id = ? AND internal = 0
            ORDER BY created_at`,
        )
          .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, detalhe)
          .all()
          .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
        mensagens = (conversa.results || []).map((m) => ({
          id: m.id,
          lado: m.author_side,
          autor: m.author_name,
          texto: m.body,
          criadaEm: m.created_at,
        }));
      }

      return response({
        solicitacoes,
        mensagens,
        resumo: resumoParaCliente(solicitacoes),
        tipos: TIPOS_LISTA.map((t) => ({
          id: t.id,
          rotulo: t.rotulo,
          descricao: t.descricao,
          prazoHoras: t.prazoHoras,
          obrigatorios: t.obrigatorios,
          camposRotulo: t.camposRotulo,
        })),
      });
    }

    if (request.method === "POST") {
      if (excedeuLimite("solicitacao", 30))
        return response({ error: "Muitas solicitações em pouco tempo. Aguarde um instante." }, 429);
      let body = {};
      try {
        body = await request.json();
      } catch {
        return response({ error: "Corpo JSON inválido." }, 400);
      }

      // Uma nova mensagem numa solicitação existente.
      const emResposta = clean(body.solicitacaoId, 60);
      if (emResposta) return responderSolicitacao(env, escopo, user, emResposta, body);

      const validacao = validarSolicitacao(body);
      if (!validacao.valido)
        return response({ error: validacao.erros[0], erros: validacao.erros }, 400);

      const agora = new Date().toISOString();
      const id = crypto.randomUUID();
      const { tipo, assunto, descricao, urgencia, campos } = validacao.limpo;
      await env.DB.prepare(
        `INSERT INTO todogreen_client_requests
           (id, tenant_id, client_id, workspace_owner_id, type, subject, description,
            urgency, status, fields_json, due_at, opened_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          escopo.tenantId,
          escopo.clientId,
          escopo.workspaceOwnerId || "",
          tipo,
          assunto,
          descricao,
          urgencia,
          JSON.stringify(campos),
          prazoDaSolicitacao(tipo, urgencia, agora),
          escopo.email,
          agora,
          agora,
        )
        .run();

      // A descrição vira a primeira mensagem da conversa: sem isso a thread
      // começaria no meio, sem o que foi pedido originalmente.
      await inserirMensagem(env, escopo, id, {
        lado: "cliente",
        email: escopo.email,
        nome: user?.name || escopo.email,
        texto: descricao,
      });

      await logPortalEvent(env, escopo, user, "solicitacao_aberta", id, assunto);
      return response({ ok: true, id }, 201);
    }

    if (request.method === "PATCH") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return response({ error: "Corpo JSON inválido." }, 400);
      }
      const id = clean(body.id, 60);
      if (!id) return response({ error: "Informe a solicitação." }, 400);

      const atual = await env.DB.prepare(
        `SELECT id, status FROM todogreen_client_requests
          WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
      )
        .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, id)
        .first();
      if (!atual) return response({ error: "Solicitação não encontrada." }, 404);

      const movimento = aplicarTransicao(atual, {
        lado: "cliente",
        para: clean(body.status, 30),
        autor: escopo.email,
      });
      if (!movimento.ok) return response({ error: movimento.erro }, 409);

      await env.DB.prepare(
        `UPDATE todogreen_client_requests
            SET status = ?, closed_at = ?, closed_by = ?, updated_at = ?
          WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
      )
        .bind(
          movimento.status,
          movimento.encerradoEm,
          movimento.encerradoPor,
          new Date().toISOString(),
          escopo.tenantId,
          escopo.workspaceOwnerId,
          escopo.clientId,
          id,
        )
        .run();

      await logPortalEvent(env, escopo, user, "solicitacao_status", id, movimento.status);
      return response({ ok: true, status: movimento.status });
    }

    return response({ error: "Método não permitido." }, 405);
  }

  // ----- Sua avaliação (NPS) -----
  //
  // A voz do cliente que fecha ciclo. Ele responde de 0 a 10; a nota de
  // detrator (0..6) abre automaticamente uma ocorrência com prazo — a mesma
  // todogreen_client_requests type='ocorrencia' que a equipe já trata. NPS que
  // não vira ação é enquete. O cliente da resposta vem do escopo da sessão,
  // nunca do corpo.
  if (resource === "nps") {
    if (request.method === "GET") {
      const { sql, params } = scopedWhere(escopo);
      const linhas = await env.DB.prepare(
        `SELECT id, operation_id, nota, classe, motivo, comentario,
                incident_request_id, created_at
           FROM todogreen_client_nps
          WHERE ${sql}
          ORDER BY created_at DESC
          LIMIT ?`,
      )
        .bind(...params, MAX_LIMIT)
        .all()
        .catch((erro) => (console.error("Portal do cliente: consulta NPS falhou", erro?.message || erro), { results: [] }));

      const respostas = (linhas.results || []).map((l) => ({
        id: l.id,
        operacaoId: l.operation_id || null,
        nota: l.nota,
        classe: l.classe,
        motivo: l.motivo || "",
        comentario: l.comentario || "",
        ocorrenciaId: l.incident_request_id || null,
        respondidoEm: l.created_at,
      }));

      const resumo = calcularNPS(respostas);
      return response({
        respostas,
        resumo: { ...resumo, faixa: faixaNPS(resumo.nps) },
        causas: causasDeInsatisfacao(respostas),
        // A última avaliação orienta a tela: já respondi? o que respondi?
        ultima: respostas[0] || null,
      });
    }

    if (request.method === "POST") {
      if (excedeuLimite("nps", 10))
        return response({ error: "Muitas respostas em pouco tempo. Aguarde um instante." }, 429);
      let body = {};
      try {
        body = await request.json();
      } catch {
        return response({ error: "Corpo JSON inválido." }, 400);
      }

      const classe = classificarNPS(body.nota);
      if (classe == null)
        return response({ error: "Informe uma nota de 0 a 10." }, 400);
      const nota = Number(body.nota);
      const motivo = clean(body.motivo, 120);
      const comentario = clean(body.comentario, 500);
      // A operação avaliada é opcional, mas se vier tem de ser do cliente da
      // sessão — nunca aceito um id de operação de outra carteira.
      let operationId = clean(body.operacaoId, 60) || null;
      if (operationId) {
        const dono = await env.DB.prepare(
          `SELECT 1 FROM todogreen_client_operations
            WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
        )
          .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, operationId)
          .first()
          .catch(() => null);
        if (!dono) operationId = null;
      }

      const agora = new Date().toISOString();
      const id = crypto.randomUUID();

      // A ponte que fecha o ciclo: detrator abre ocorrência com responsável e
      // prazo. Mesma tabela, mesmo motor da fila da equipe. Sem isso, uma nota
      // baixa some — e NPS que não trata detrator é enquete, não gestão.
      // Nota de detrator abre ocorrência — mas isso é criar um chamado, então
      // exige a permissão de criar solicitação. Um perfil só-leitura registra a
      // nota (feedback é sempre bem-vindo) sem, por essa via, abrir ocorrência
      // que ele não poderia abrir direto.
      let incidentId = null;
      if (precisaOcorrencia(nota) && clientCan(escopo, "portal:request:create")) {
        incidentId = crypto.randomUUID();
        const assunto = `Avaliação baixa (nota ${nota})`;
        const descricao = motivo || comentario
          ? `${motivo ? `Motivo: ${motivo}. ` : ""}${comentario}`.trim()
          : "Cliente registrou nota de detrator na pesquisa de satisfação.";
        await env.DB.prepare(
          `INSERT INTO todogreen_client_requests
             (id, tenant_id, client_id, workspace_owner_id, type, subject, description,
              urgency, status, fields_json, due_at, opened_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ocorrencia', ?, ?, 'alta', 'aberta', ?, ?, ?, ?, ?)`,
        )
          .bind(
            incidentId,
            escopo.tenantId,
            escopo.clientId,
            escopo.workspaceOwnerId || "",
            assunto,
            descricao,
            JSON.stringify(operationId ? { origemNps: id, operacaoId: operationId } : { origemNps: id }),
            prazoDaSolicitacao("ocorrencia", "alta", agora),
            escopo.email,
            agora,
            agora,
          )
          .run();
      }

      await env.DB.prepare(
        `INSERT INTO todogreen_client_nps
           (id, tenant_id, workspace_owner_id, client_id, operation_id, nota, classe,
            motivo, comentario, incident_request_id, respondido_por, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          escopo.tenantId,
          escopo.workspaceOwnerId || "",
          escopo.clientId,
          operationId,
          nota,
          classe,
          motivo,
          comentario,
          incidentId,
          escopo.email,
          agora,
        )
        .run();

      await logPortalEvent(env, escopo, user, "nps_respondido", id, `nota ${nota} (${classe})`);
      return response({ ok: true, id, classe, ocorrenciaId: incidentId }, 201);
    }

    return response({ error: "Método não permitido." }, 405);
  }

  return response({ error: "Rota do portal não encontrada." }, 404);
}

const linhaParaSolicitacao = (linha) => ({
  id: linha.id,
  tipo: linha.type,
  assunto: linha.subject,
  descricao: linha.description,
  urgencia: linha.urgency,
  status: linha.status,
  campos: parse(linha.fields_json, {}),
  prazoEm: linha.due_at,
  abertaPor: linha.opened_by,
  encerradaEm: linha.closed_at,
  criadaEm: linha.created_at,
  atualizadaEm: linha.updated_at,
});

async function inserirMensagem(env, escopo, requestId, { lado, email, nome, texto, interna = 0 }) {
  await env.DB.prepare(
    `INSERT INTO todogreen_client_request_messages
       (id, tenant_id, workspace_owner_id, client_id, request_id, author_side, author_email, author_name,
        body, internal, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      escopo.tenantId,
      escopo.workspaceOwnerId,
      escopo.clientId,
      requestId,
      lado,
      clean(email, 160),
      clean(nome, 120),
      clean(texto, 4000),
      interna ? 1 : 0,
      new Date().toISOString(),
    )
    .run();
}

async function responderSolicitacao(env, escopo, user, id, body) {
  const texto = clean(body.mensagem ?? body.texto, 4000);
  if (texto.length < 2) return response({ error: "Escreva a sua mensagem." }, 400);

  const atual = await env.DB.prepare(
    `SELECT id, status FROM todogreen_client_requests
      WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
  )
    .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, id)
    .first();
  if (!atual) return response({ error: "Solicitação não encontrada." }, 404);
  if (STATUS_SOLICITACAO[statusValido(atual.status)].encerrado)
    return response(
      { error: "Esta solicitação já foi encerrada. Abra uma nova para retomar o assunto." },
      409,
    );

  await inserirMensagem(env, escopo, id, {
    lado: "cliente",
    email: escopo.email,
    nome: user?.name || escopo.email,
    texto,
  });

  // Cliente respondeu: a bola volta para a equipe e o relógio dela volta a
  // correr. Deixar em "aguardando cliente" esconderia o pedido da fila.
  const proximo = statusValido(atual.status) === "aguardando_cliente" ? "em_analise" : atual.status;
  await env.DB.prepare(
    `UPDATE todogreen_client_requests SET status = ?, updated_at = ?
      WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
  )
    .bind(proximo, new Date().toISOString(), escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, id)
    .run();

  await logPortalEvent(env, escopo, user, "solicitacao_mensagem", id, texto.slice(0, 120));
  return response({ ok: true, status: proximo });
}
