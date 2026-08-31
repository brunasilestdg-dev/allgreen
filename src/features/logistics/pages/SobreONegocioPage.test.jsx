/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SobreONegocioPage from "./SobreONegocioPage.jsx";

afterEach(cleanup);

const fato = (extra = {}) => ({
  id: "ctx-1",
  chave: "quem-somos",
  categoria: "identidade",
  titulo: "Nascemos elétricos",
  conteudo: "A To Do Green opera 100% elétrica desde 2021.",
  fonte: "Apresentação Comercial VF2",
  vigenteEm: "2026-08-15",
  sigilo: "publico",
  origem: "cadastrado",
  fixado: true,
  revision: 3,
  ...extra,
});

describe("Sobre o negócio", () => {
  it("mostra o fato com a fonte à vista — número sem procedência é o começo de número inventado", () => {
    render(<SobreONegocioPage businessContext={[fato()]} podeEditar />);
    expect(screen.getByText("Nascemos elétricos")).toBeInTheDocument();
    expect(screen.getByText(/Fonte: Apresentação Comercial VF2/)).toBeInTheDocument();
    expect(screen.getByText(/Posição em 2026-08-15/)).toBeInTheDocument();
  });

  it("quem não pode ensinar lê e não vê botão de escrita", () => {
    render(<SobreONegocioPage businessContext={[fato()]} podeEditar={false} />);
    expect(screen.getByText("Nascemos elétricos")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ensinar algo novo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Corrigir" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remover/ })).not.toBeInTheDocument();
  });

  it("corrigir manda a revisão junto — sem ela duas pessoas se sobrescrevem em silêncio", async () => {
    const onUpdate = vi.fn().mockResolvedValue({});
    render(<SobreONegocioPage businessContext={[fato()]} podeEditar onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Nascemos elétricos, não viramos" } });
    fireEvent.click(screen.getByRole("button", { name: /Gravar/ }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    const [id, corpo] = onUpdate.mock.calls[0];
    expect(id).toBe("ctx-1");
    expect(corpo.titulo).toBe("Nascemos elétricos, não viramos");
    expect(corpo.revision).toBe(3);
  });

  it("o que falta do dossiê é oferecido para acrescentar, nunca para sobrescrever o que ela escreveu", () => {
    render(<SobreONegocioPage businessContext={[fato()]} podeEditar />);
    // A semente tem 18 pontos; um já está cadastrado, então faltam 17.
    expect(screen.getByRole("button", { name: /Acrescentar 17 ponto\(s\) do dossiê/ })).toBeInTheDocument();
  });

  it("o painel diz o tamanho real do que a IA lê a cada pergunta", () => {
    render(<SobreONegocioPage businessContext={[fato()]} podeEditar />);
    expect(screen.getByText("caracteres por pergunta")).toBeInTheDocument();
  });
});
