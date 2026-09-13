// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVerticalRecords, descreverAreasComErro } from "./useVerticalRecords.js";

// Antes, criar/atualizar/arquivar terminavam chamando um recarregamento da
// vertical inteira — cinco coleções e as simulações de novo, por uma escrita
// que mudou uma linha. Estes testes existem para travar o contrário: o
// servidor já devolve o registro que mudou, e é ele que atualiza a memória.

function response(data, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

const VAZIO_DO_SERVIDOR = {
  opportunities: [{ id: "op-1", cliente: "Cliente 1", revision: 1 }],
  proposals: [],
  operations: [],
  financial: [],
  scenarios: [],
};

// Referência estável entre renders — do jeito que a tela real recebe, já
// memoizada. Uma função nova a cada chamada faria o efeito de carga rodar
// sem fim, e isso não é o que este arquivo está testando.
const authHeaders = () => ({});

describe("useVerticalRecords", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn((url, opcoes = {}) => {
      const metodo = opcoes.method || "GET";
      if (metodo === "GET") return response(VAZIO_DO_SERVIDOR);
      if (metodo === "POST")
        return response({ registro: { id: "op-2", cliente: "Cliente novo", revision: 1 } }, 201);
      if (metodo === "PATCH")
        return response({ registro: { id: "op-1", cliente: "Cliente 1 editado", revision: 2 } });
      if (metodo === "DELETE") return response({ ok: true });
      throw new Error(`método inesperado: ${metodo}`);
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("carrega a vertical inteira uma vez ao montar", async () => {
    const { result } = renderHook(() => useVerticalRecords(authHeaders));
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(result.current.dados.opportunities).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("criar adiciona o registro devolvido sem recarregar a vertical", async () => {
    const { result } = renderHook(() => useVerticalRecords(authHeaders));
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.criar("opportunities", { cliente: "Cliente novo" });
    });

    // Só a chamada de escrita — nenhum GET adicional.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(result.current.dados.opportunities.map((r) => r.id)).toEqual(["op-2", "op-1"]);
  });

  it("atualizar substitui só o registro que mudou, sem recarregar a vertical", async () => {
    const { result } = renderHook(() => useVerticalRecords(authHeaders));
    await waitFor(() => expect(result.current.carregando).toBe(false));

    await act(async () => {
      await result.current.atualizar("opportunities", "op-1", { cliente: "Cliente 1 editado" });
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
    expect(result.current.dados.opportunities).toEqual([
      { id: "op-1", cliente: "Cliente 1 editado", revision: 2 },
    ]);
  });

  it("arquivar remove o registro localmente, sem recarregar a vertical", async () => {
    const { result } = renderHook(() => useVerticalRecords(authHeaders));
    await waitFor(() => expect(result.current.carregando).toBe(false));

    await act(async () => {
      await result.current.arquivar("opportunities", "op-1");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
    expect(result.current.dados.opportunities).toEqual([]);
  });
});

describe("descreverAreasComErro", () => {
  it("nomeia a área afetada com rótulo amigável (não o nome técnico)", () => {
    expect(descreverAreasComErro({ financial: {} })).toBe("Financeiro");
  });
  it("junta duas e três áreas com 'e'", () => {
    expect(descreverAreasComErro({ financial: {}, operations: {} })).toBe("Financeiro e Operações");
    expect(descreverAreasComErro({ opportunities: {}, proposals: {}, financial: {} })).toBe(
      "Oportunidades, Propostas e Financeiro",
    );
  });
  it("vazio quando não há erro", () => {
    expect(descreverAreasComErro({})).toBe("");
    expect(descreverAreasComErro()).toBe("");
  });
});

describe("useVerticalRecords — falha parcial e total", () => {
  const authHeaders = () => ({});
  afterEach(() => vi.restoreAllMocks());

  it("falha PARCIAL: financeiro indisponível não zera oportunidades (erros, não erro)", async () => {
    global.fetch = vi.fn(() =>
      response({
        opportunities: [{ id: "op-1", cliente: "Cliente 1", revision: 1 }],
        proposals: [],
        contracts: [],
        operations: [],
        financial: [],
        scenarios: [],
        errors: { financial: { code: "read_failed", message: "Não foi possível ler esta coleção agora." } },
        totals: { opportunities: 1, financial: 0 },
      }),
    );
    const { result } = renderHook(() => useVerticalRecords(authHeaders));
    await waitFor(() => expect(result.current.carregando).toBe(false));
    // O que leu, ficou.
    expect(result.current.dados.opportunities).toHaveLength(1);
    // A que falhou é sinalizada — não como erro fatal.
    expect(result.current.erros.financial).toBeTruthy();
    expect(result.current.erro).toBe("");
    expect(result.current.desatualizado).toBe(false);
  });

  it("falha TOTAL: mantém desatualizado e não vira zero silencioso", async () => {
    global.fetch = vi.fn(() => response({ error: "Falha geral" }, 500));
    const { result } = renderHook(() => useVerticalRecords(authHeaders));
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(result.current.erro).toBeTruthy();
    expect(result.current.desatualizado).toBe(true);
    // dados segue VAZIO (primeira carga), e a tela usa `erro` para mostrar
    // "indisponível" — não zero real.
    expect(result.current.dados.opportunities).toEqual([]);
  });
});
