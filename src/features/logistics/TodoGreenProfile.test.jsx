// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodoGreenProfile from "./TodoGreenProfile.jsx";

const TOKEN = "tdg-token-abcdef-123456";

describe("Meu perfil da To Do Green — extensão do navegador", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("seu-funcionario-auth-token", TOKEN);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const abrirPerfil = () => {
    const setToast = vi.fn();
    render(
      <TodoGreenProfile
        db={{ user: { id: "u1", name: "Renata", email: "renata@example.com" }, preferences: {} }}
        update={vi.fn()}
        authHeaders={() => ({})}
        setToast={setToast}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Abrir meu perfil/ }));
    const secao = screen.getByRole("heading", { name: "Extensão do navegador" }).closest("section");
    return { secao, setToast };
  };

  // A Central de Integrações da vertical é só do perfil técnico: o token e o
  // pacote precisam estar onde toda a equipe chega.
  it("mostra o pacote para baixar e o token mascarado", () => {
    const { secao } = abrirPerfil();
    const baixar = within(secao).getByRole("link", { name: /Baixar a extensão/ });
    expect(baixar).toHaveAttribute("href", "/extensao-todogreen.zip");
    expect(baixar).toHaveAttribute("download");
    const campo = within(secao).getByLabelText("Token de acesso");
    expect(campo.value).not.toBe(TOKEN);
    expect(campo.value.startsWith(TOKEN.slice(0, 6))).toBe(true);
    fireEvent.click(within(secao).getByRole("button", { name: "Mostrar" }));
    expect(within(secao).getByLabelText("Token de acesso").value).toBe(TOKEN);
  });

  it("copia o token inteiro para colar na extensão", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { secao, setToast } = abrirPerfil();
    fireEvent.click(within(secao).getByRole("button", { name: "Copiar token" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TOKEN));
    expect(setToast).toHaveBeenCalledWith("Token copiado — cole na extensão");
  });

  it("sem sessão, não oferece copiar um token vazio", () => {
    localStorage.clear();
    const { secao } = abrirPerfil();
    expect(within(secao).getByRole("button", { name: "Copiar token" })).toBeDisabled();
  });
});
