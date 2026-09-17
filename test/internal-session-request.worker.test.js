import { describe, expect, it } from "vitest";
import { withInternalSessionAuthorization } from "../worker/auth/internal-session-request.js";

describe("ponte interna da sessão HttpOnly", () => {
  it("transforma o cookie em Authorization apenas na Request interna", () => {
    const original = new Request("https://app.test/api/todogreen/portal", {
      headers: { cookie: "__Host-sf_session=sessao-cookie; outro=1" },
    });

    const interna = withInternalSessionAuthorization(original);

    expect(original.headers.get("authorization")).toBeNull();
    expect(interna.headers.get("authorization")).toBe("Bearer sessao-cookie");
    expect(interna.headers.get("cookie")).toContain("__Host-sf_session=sessao-cookie");
  });

  it("não sobrescreve Authorization que já veio explicitamente", () => {
    const original = new Request("https://app.test/api/todogreen/portal", {
      headers: {
        cookie: "__Host-sf_session=sessao-cookie",
        authorization: "Bearer sessao-explicita",
      },
    });

    const interna = withInternalSessionAuthorization(original);
    expect(interna.headers.get("authorization")).toBe("Bearer sessao-explicita");
  });

  it("não inventa credencial quando não existe sessão", () => {
    const original = new Request("https://app.test/api/todogreen/portal");
    const interna = withInternalSessionAuthorization(original);
    expect(interna.headers.get("authorization")).toBeNull();
  });
});
