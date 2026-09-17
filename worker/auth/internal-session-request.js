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

  // Criar uma Request diretamente a partir da original pode transferir o
  // stream do corpo para a cópia interna. Isso deixa a Request original sem
  // corpo e quebra rotas POST que são encaminhadas depois, como /api/auth/login.
  // Clonar primeiro mantém os dois fluxos independentes: a vertical recebe a
  // cópia interna com Authorization e o app principal continua podendo ler o
  // JSON original normalmente.
  return new Request(request.clone(), { headers });
}
