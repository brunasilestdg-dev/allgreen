// ===== API pública v1 por chave (/api/public/v1/*) =====
//
// Contrato
// - Recebe: `request`, `env` e `url`. Autentica por `Authorization: Bearer
//   sf_live_...` (a chave criada dentro do app), não por sessão.
// - Devolve: JSON com CORS aberto (`publicApiJson`): `/openapi.json` (sem
//   chave), `/me` e GET/POST das coleções de `PUBLIC_API_COLLECTIONS`.
// - Quem chama: a tabela de rotas públicas; `publicApiJson` também monta
//   as respostas de banco indisponível e de falha dessa rota.
// - Autorização: a chave (guardada só como hash, revogável) define o espaço
//   e o escopo; escrever exige escopo `read-write` e `Idempotency-Key`.
//   Limite de 120 chamadas por minuto por chave. Campos de
//   compartilhamento e visibilidade nunca saem.

import { sha256 } from "../auth/credenciais.js";
import { cleanText } from "../lib/format.js";
import { allowed } from "../lib/http.js";

const apiCorsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, content-type, idempotency-key",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400",
};

export function publicApiJson(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...apiCorsHeaders,
      ...extraHeaders,
    },
  });
}

const PUBLIC_API_COLLECTIONS = new Set([
  "tasks",
  "contacts",
  "opportunities",
  "transactions",
]);

function publicApiOpenApi(origin) {
  const paths = {
    "/api/public/v1/me": {
      get: {
        summary: "Identifica o espaço da chave",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Espaço autenticado" } },
      },
    },
  };
  for (const collection of PUBLIC_API_COLLECTIONS) {
    paths[`/api/public/v1/${collection}`] = {
      get: {
        summary: `Lista ${collection}`,
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: "query",
            name: "limit",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
          { in: "query", name: "businessId", schema: { type: "string" } },
        ],
        responses: { 200: { description: "Lista paginada" } },
      },
      ...(collection === "tasks" || collection === "contacts"
        ? {
            post: {
              summary: `Cria um item em ${collection}`,
              security: [{ bearerAuth: [] }],
              parameters: [
                {
                  in: "header",
                  name: "Idempotency-Key",
                  required: true,
                  schema: { type: "string" },
                },
              ],
              responses: {
                201: { description: "Item criado" },
                409: { description: "Conflito de atualização" },
              },
            },
          }
        : {}),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Seu Funcionário Public API",
      version: "1.0.0",
      description:
        "API gratuita e versionada para integrar dados do espaço. Chaves são criadas dentro do aplicativo.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "sf_live" },
      },
    },
    paths,
  };
}

async function publicApiCredentials(request, env) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!token.startsWith("sf_live_")) return null;
  const row = await env.DB.prepare(
    `SELECT id, workspace_owner_id, scope FROM public_api_keys
     WHERE key_hash = ? AND revoked_at IS NULL`,
  )
    .bind(await sha256(token))
    .first();
  if (!row) return null;
  if (!allowed(`public-api:${row.id}`, 120)) return { rateLimited: true };
  await env.DB.prepare(
    "UPDATE public_api_keys SET last_used_at = ? WHERE id = ?",
  )
    .bind(new Date().toISOString(), row.id)
    .run();
  return row;
}

function publicApiRecord(record) {
  if (!record || typeof record !== "object") return null;
  const safe = { ...record };
  for (const field of [
    "ownerId",
    "sharedWith",
    "sharedTeams",
    "editors",
    "sharingPermission",
    "visibility",
  ])
    delete safe[field];
  return safe;
}

const publicWritableFields = {
  tasks: [
    "title",
    "description",
    "status",
    "priority",
    "dueDate",
    "businessId",
    "project",
    "tags",
  ],
  contacts: [
    "name",
    "email",
    "phone",
    "company",
    "role",
    "notes",
    "businessId",
    "tags",
  ],
};

function buildPublicRecord(collection, body, ownerId) {
  const record = {
    id: crypto.randomUUID(),
    ownerId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "public-api",
  };
  for (const field of publicWritableFields[collection] || []) {
    if (body[field] === undefined) continue;
    record[field] = Array.isArray(body[field])
      ? body[field].slice(0, 20).map((value) => cleanText(value, 80))
      : cleanText(
          body[field],
          field === "description" || field === "notes" ? 2_000 : 200,
        );
  }
  if (!record.name && !record.title) return null;
  if (collection === "tasks") {
    record.status = record.status || "pendente";
    record.priority = record.priority || "media";
  }
  return record;
}

export async function handlePublicApi(request, env, url) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: apiCorsHeaders });
  if (url.pathname === "/api/public/v1/openapi.json") {
    if (request.method !== "GET")
      return publicApiJson({ error: "Método não permitido." }, 405);
    return publicApiJson(publicApiOpenApi(url.origin));
  }
  const credentials = await publicApiCredentials(request, env);
  if (credentials?.rateLimited)
    return publicApiJson(
      { error: "Limite de 120 chamadas por minuto excedido." },
      429,
      { "retry-after": "60" },
    );
  if (!credentials)
    return publicApiJson({ error: "Chave ausente, inválida ou revogada." }, 401);
  if (url.pathname === "/api/public/v1/me") {
    if (request.method !== "GET")
      return publicApiJson({ error: "Método não permitido." }, 405);
    return publicApiJson({
      workspaceId: credentials.workspace_owner_id,
      scope: credentials.scope,
      version: "v1",
    });
  }
  const collection = url.pathname.split("/").filter(Boolean)[3] || "";
  if (!PUBLIC_API_COLLECTIONS.has(collection))
    return publicApiJson({ error: "Recurso não encontrado." }, 404);
  const workspace = await env.DB.prepare(
    "SELECT data, revision FROM workspaces WHERE user_id = ?",
  )
    .bind(credentials.workspace_owner_id)
    .first();
  let data;
  try {
    data = workspace ? JSON.parse(workspace.data) : {};
  } catch {
    return publicApiJson({ error: "Dados do espaço indisponíveis." }, 503);
  }
  if (request.method === "GET") {
    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50,
      ),
    );
    const businessId = cleanText(url.searchParams.get("businessId"), 80);
    const records = (Array.isArray(data[collection]) ? data[collection] : [])
      .filter((record) => !businessId || record?.businessId === businessId)
      .slice(0, limit)
      .map(publicApiRecord)
      .filter(Boolean);
    return publicApiJson({ data: records, count: records.length, limit });
  }
  if (request.method !== "POST")
    return publicApiJson({ error: "Método não permitido." }, 405);
  if (credentials.scope !== "read-write")
    return publicApiJson({ error: "Esta chave permite somente leitura." }, 403);
  if (!publicWritableFields[collection])
    return publicApiJson({ error: "Este recurso não aceita criação." }, 405);
  const idempotencyKey = cleanText(
    request.headers.get("idempotency-key"),
    100,
  );
  if (!idempotencyKey)
    return publicApiJson(
      { error: "Envie o cabeçalho Idempotency-Key." },
      400,
    );
  const prior = await env.DB.prepare(
    `SELECT response_json FROM public_api_idempotency
     WHERE api_key_id = ? AND request_key = ?`,
  )
    .bind(credentials.id, idempotencyKey)
    .first();
  if (prior) return publicApiJson(JSON.parse(prior.response_json), 200);
  let body;
  try {
    body = await request.json();
  } catch {
    return publicApiJson({ error: "Corpo JSON inválido." }, 400);
  }
  const record = buildPublicRecord(
    collection,
    body && typeof body === "object" ? body : {},
    credentials.workspace_owner_id,
  );
  if (!record)
    return publicApiJson(
      {
        error:
          collection === "tasks" ? "Informe o título." : "Informe o nome.",
      },
      400,
    );
  data[collection] = [
    ...(Array.isArray(data[collection]) ? data[collection] : []),
    record,
  ];
  const updated = JSON.stringify(data);
  if (updated.length > 900_000)
    return publicApiJson({ error: "O espaço de dados está cheio." }, 413);
  const revision = Number.isInteger(workspace?.revision)
    ? workspace.revision
    : 0;
  const result = await env.DB.prepare(
    `UPDATE workspaces SET data = ?, updated_at = ?, revision = revision + 1
     WHERE user_id = ? AND revision = ?`,
  )
    .bind(
      updated,
      new Date().toISOString(),
      credentials.workspace_owner_id,
      revision,
    )
    .run();
  if (!result.meta?.changes)
    return publicApiJson(
      {
        error:
          "Os dados mudaram durante a operação. Repita com a mesma chave de idempotência.",
      },
      409,
    );
  const responseBody = { data: publicApiRecord(record) };
  await env.DB.prepare(
    `INSERT INTO public_api_idempotency
      (id, api_key_id, request_key, response_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      credentials.id,
      idempotencyKey,
      JSON.stringify(responseBody),
      new Date().toISOString(),
    )
    .run();
  return publicApiJson(responseBody, 201);
}
