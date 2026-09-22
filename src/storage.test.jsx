// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadInitialDb, readUserDb, startUserSession } from "./App";

describe("isolamento local por conta", () => {
  beforeEach(() => localStorage.clear());

  it("não entrega os projetos de uma conta para outra", () => {
    localStorage.setItem(
      "seu-funcionario-v2:alice",
      JSON.stringify({
        user: { id: "alice", name: "Alice" },
        businesses: [{ id: "segredo-alice", name: "Negócio Alice" }],
      }),
    );

    const bob = startUserSession({ id: "bob", name: "Bob" });

    expect(bob.user.id).toBe("bob");
    expect(bob.businesses).toEqual([]);
    expect(readUserDb({ id: "alice", name: "Alice" }).businesses).toHaveLength(
      1,
    );
  });

  it("persiste o usuário antes do reload para restaurar a sessão", () => {
    startUserSession({ id: "renata", name: "Renata", email: "renata@example.com" });

    expect(localStorage.getItem("seu-funcionario-active-user")).toBe("renata");
    const saved = JSON.parse(localStorage.getItem("seu-funcionario-v2:renata"));
    expect(saved.user).toMatchObject({ id: "renata", email: "renata@example.com" });
    expect(loadInitialDb().user).toMatchObject({ id: "renata", email: "renata@example.com" });
  });

  it("ignora cache corrompido sem misturar dados", () => {
    localStorage.setItem("seu-funcionario-v2:bob", "{inválido");
    const bob = readUserDb({ id: "bob", name: "Bob" });
    expect(bob.user.id).toBe("bob");
    expect(bob.sites).toEqual([]);
  });
});
