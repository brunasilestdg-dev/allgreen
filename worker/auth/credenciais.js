// ===== Credenciais e sessão =====
//
// Hash de senha, comparação em tempo constante, token de sessão. É o núcleo
// mais sensível do worker, e morava no meio de oito mil linhas junto de rotas
// de formulário e de site público.
//
// `sameHash` compara byte a byte SEM sair no primeiro que difere. Uma
// comparação que retorna cedo vaza, pelo tempo de resposta, quantos caracteres
// do hash o atacante já acertou — é o tipo de detalhe que precisa estar num
// arquivo que alguém consiga ler inteiro.

export const encoder = new TextEncoder();
export const hex = (bytes) =>
  [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
export const unhex = (value) =>
  new Uint8Array(value.match(/.{2}/g).map((byte) => parseInt(byte, 16)));
export const randomHex = (size) => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return hex(bytes);
};

export const SESSION_COOKIE_NAME = "__Host-sf_session";
export const SESSION_TTL_SECONDS = 24 * 60 * 60;

function cookieValue(request, name) {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    return item.slice(separator + 1).trim();
  }
  return "";
}

export function sessionToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || cookieValue(request, SESSION_COOKIE_NAME);
}

function responseWithCookie(response, cookie) {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withSessionCookie(response, token) {
  const expires = new Date(
    Date.now() + SESSION_TTL_SECONDS * 1000,
  ).toUTCString();
  return responseWithCookie(
    response,
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}; Expires=${expires}`,
  );
}

export function withClearedSessionCookie(response) {
  return responseWithCookie(
    response,
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );
}

export async function sha256(value) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const result = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: unhex(salt), iterations: 100000 },
    key,
    256,
  );
  return hex(result);
}

export function sameHash(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function createSession(env, userId) {
  const token = randomHex(32);
  const id = crypto.randomUUID();
  // 24 horas, absoluto. Era 30 dias — uma máquina esquecida logada ficava
  // um mês inteiro como porta aberta para a conta. Login diário é o custo.
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_SECONDS * 1000,
  ).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, userId, await sha256(token), expiresAt, new Date().toISOString())
    .run();
  return token;
}

export async function sessionUser(request, env) {
  if (!env.DB) return { id: "local" };
  const token = sessionToken(request);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT users.id, users.name, users.email FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first();
}
