import { sessionToken } from "./credenciais.js";

// Compatibilidade exclusivamente do lado do servidor.
//
// A sessão principal já vive no cookie HttpOnly. Alguns serviços antigos da
// vertical ainda procuram `Authorization: Bearer ...` dentro do próprio
// handler. Em vez de obrigar o navegador a guardar a credencial novamente,
// o Worker converte o cookie em header somente na cópia interna da Request.
// O token continua inacessível ao JavaScript do navegador.
export function withInternalSessionAuthorization(request) {
  if (request.headers.has("authorization")) return request;
  const token = sessionToken(request);
  if (!token) return request;

  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(request, { headers });
}
