import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), "utf8");

const credentials = () => ler("./features/logistics/LogisticsVerticalCredentials.js");
const invite = () => ler("./features/logistics/TodoGreenAccessInvite.jsx");
const inviteService = () => ler("../worker/services/todogreen-access-invites.js");
const storage = () => ler("./session/armazenamento.js");

describe("sessão protegida da vertical To Do Green", () => {
  it("login privado não grava token de autenticação no localStorage", () => {
    const fonte = credentials();
    expect(fonte).not.toContain("localStorage.setItem(LEGACY_AUTH_TOKEN_KEY");
    expect(fonte).toContain("localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY)");
    expect(fonte).toContain("startUserSession(payload.user)");
  });

  it("aceite de convite não grava token de autenticação no localStorage", () => {
    const fonte = invite();
    expect(fonte).not.toContain('localStorage.setItem("seu-funcionario-auth-token"');
    expect(fonte).toContain("startUserSession(body.user)");
  });

  it("aceite de convite emite a sessão HttpOnly pelo servidor", () => {
    const fonte = inviteService();
    expect(fonte).toContain("withSessionCookie");
    expect(fonte).toMatch(/const sessionToken = await createSession\(env, userId\)/);
    expect(fonte).toMatch(/return withSessionCookie\(/);
  });

  it("nova sessão remove Bearer legado e logout funciona somente com cookie", () => {
    const fonte = storage();
    expect(fonte).toMatch(/startUserSession[\s\S]*removeItem\(AUTH_TOKEN_KEY\)/);
    expect(fonte).toMatch(/fetch\("\/api\/auth\/session"[\s\S]*method: "DELETE"/);
    expect(fonte).not.toMatch(/if \(token\)\s*fetch\("\/api\/auth\/session"/);
  });
});
