import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Normaliza CRLF→LF: as asserções abaixo casam blocos com `\n` e o git pode
// entregar o fonte com CRLF no Windows (core.autocrlf). Um teste que varre
// código-fonte não pode depender do estilo de quebra de linha do checkout.
const ler = (caminho) =>
  readFileSync(new URL(caminho, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const credentials = () => ler("./features/logistics/LogisticsVerticalCredentials.js");
const invite = () => ler("./features/logistics/TodoGreenAccessInvite.jsx");
const inviteService = () => ler("../worker/services/todogreen-access-invites.js");
const storage = () => ler("./session/armazenamento.js");

describe("sessão protegida da vertical To Do Green", () => {
  it("login privado mantém token legado enquanto o gate global ainda depende dele", () => {
    const fonte = credentials();
    expect(fonte).toContain("localStorage.setItem(LEGACY_AUTH_TOKEN_KEY, payload.token)");
    expect(fonte).toContain("startUserSession(payload.user)");
    expect(fonte).not.toContain("clearLegacyTokenWhenCookieIsValid");
  });

  it("aceite de convite mantém token legado para não quebrar o acesso", () => {
    const fonte = invite();
    expect(fonte).toContain('localStorage.setItem("seu-funcionario-auth-token", body.token)');
    expect(fonte).toContain("startUserSession(body.user)");
  });

  it("aceite de convite também emite a sessão HttpOnly pelo servidor", () => {
    const fonte = inviteService();
    expect(fonte).toContain("withSessionCookie");
    expect(fonte).toMatch(/const sessionToken = await createSession\(env, userId\)/);
    expect(fonte).toMatch(/return withSessionCookie\(/);
  });

  it("startUserSession não apaga o token antes da migração do App", () => {
    const fonte = storage();
    const bloco = fonte.match(/export function startUserSession[\s\S]*?\n}\n/)?.[0] || "";
    expect(bloco).not.toContain("removeItem(AUTH_TOKEN_KEY)");
    expect(bloco).toContain("localStorage.setItem(ACTIVE_USER_KEY, user.id)");
  });

  it("logout continua revogando a sessão e limpando o token", () => {
    const fonte = storage();
    expect(fonte).toMatch(/endSession[\s\S]*removeItem\(AUTH_TOKEN_KEY\)/);
    expect(fonte).toMatch(/fetch\("\/api\/auth\/session"[\s\S]*method: "DELETE"/);
  });
});
