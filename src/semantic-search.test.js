import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DIMENSOES,
  deBase64,
  fundirResultados,
  paraBase64,
  quantizar,
  rankearPorSignificado,
  similaridade,
  textoParaVetor,
} from "./features/knowledge/semanticDomain.js";
import { buscarPorSignificado, limparMemoriaDaBusca } from "./features/knowledge/semanticSearch.js";

// Vetor de 1.024 dimensões apontando para um eixo (com um pouco de ruído).
const eixo = (n, peso = 1) => Array.from({ length: DIMENSOES }, (_, i) => (i === n ? peso : 0.001));

describe("busca por significado: regras puras", () => {
  it("int8 em base64 vai e volta sem perder o cosseno", () => {
    const a = Array.from({ length: DIMENSOES }, (_, i) => Math.sin(i / 7));
    const b = Array.from({ length: DIMENSOES }, (_, i) => Math.sin(i / 7 + 0.4));
    const volta = (v) => deBase64(paraBase64(quantizar(v)));
    expect(volta(a)).toHaveLength(DIMENSOES);
    expect(Math.abs(similaridade(volta(a), volta(b)) - similaridade(a, b))).toBeLessThan(0.01);
    expect(similaridade(volta(a), volta(a))).toBeCloseTo(1, 5);
  });

  it("monta o texto do item com título e corpo, sem estourar o tamanho", () => {
    expect(textoParaVetor({ title: "Contrato", body: "  pagamento\n em 30 dias " })).toBe("Contrato pagamento em 30 dias");
    expect(textoParaVetor({ title: "x", body: "y".repeat(5000) })).toHaveLength(1500);
  });

  it("só traz o que é parecido de verdade, perto do melhor resultado", () => {
    const docs = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const vetores = {
      a: quantizar(eixo(0)),
      // cosseno ~0,9 com a consulta: entra; o eixo 2 (cosseno ~0) fica fora.
      b: quantizar([...eixo(0, 0.9)].map((v, i) => (i === 1 ? 0.43 : v))),
      c: quantizar(eixo(2)),
    };
    const ranking = rankearPorSignificado(docs, (doc) => vetores[doc.id], quantizar(eixo(0)));
    expect(ranking.map((r) => r.doc.id)).toEqual(["a", "b"]);
    expect(rankearPorSignificado(docs, (doc) => vetores[doc.id], null)).toEqual([]);
  });

  it("funde por posição e diz de onde veio cada resultado", () => {
    const porPalavra = [{ id: "x", snippet: "«nota» fiscal" }, { id: "y" }];
    const porSignificado = [{ id: "z" }, { id: "x", snippet: "sem marca" }];
    const fundidos = fundirResultados(porPalavra, porSignificado);
    expect(fundidos[0]).toMatchObject({ id: "x", origem: "ambos", snippet: "«nota» fiscal" });
    expect(fundidos.find((r) => r.id === "y").origem).toBe("palavra");
    expect(fundidos.find((r) => r.id === "z").origem).toBe("significado");
  });
});

describe("busca por significado no aparelho", () => {
  beforeEach(() => limparMemoriaDaBusca());

  const docs = (quantos) =>
    Array.from({ length: quantos }, (_, i) => ({
      id: `documents:${i}`,
      sourceId: "documents",
      sourceLabel: "Documentos",
      itemId: String(i),
      title: `Documento ${i}`,
      body: i === 0 ? "Prazo de pagamento do cliente em 30 dias" : `Assunto diferente número ${i}`,
    }));

  // Servidor falso: o documento 0 fica no mesmo eixo da consulta.
  const servidor = () =>
    vi.fn(async (_url, init) => {
      const corpo = JSON.parse(init.body);
      const vetores = Object.fromEntries(
        corpo.itens.map((item) => [item.h, paraBase64(quantizar(eixo(item.t.includes("Prazo de pagamento") ? 0 : 5)))]),
      );
      return {
        ok: true,
        json: async () => ({
          vetores,
          ...(corpo.consulta ? { consulta: paraBase64(quantizar(eixo(0))) } : {}),
        }),
      };
    });

  it("indexa em lotes de 64, manda a consulta no primeiro e acha pelo significado", async () => {
    const fetcher = servidor();
    const achado = await buscarPorSignificado(docs(130), "quando o cliente paga?", { userId: "u1", fetcher });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const pedidos = fetcher.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(pedidos.map((p) => p.itens.length)).toEqual([64, 64, 2]);
    expect(pedidos[0].consulta).toBe("quando o cliente paga?");
    expect(pedidos[1].consulta).toBeUndefined();
    expect(achado.resultados[0]).toMatchObject({ id: "documents:0", sourceLabel: "Documentos" });
    expect(achado).toMatchObject({ indexados: 130, total: 130 });
  });

  it("a mesma busca de novo não gasta nada: vetores e consulta ficam guardados", async () => {
    const fetcher = servidor();
    await buscarPorSignificado(docs(3), "quando o cliente paga?", { userId: "u1", fetcher });
    await buscarPorSignificado(docs(3), "quando o cliente paga?", { userId: "u1", fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("servidor sem IA vira erro marcado, para a tela ficar só com a busca por palavra", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "A busca por significado não está disponível agora.", indisponivel: true }),
    }));
    await expect(buscarPorSignificado(docs(2), "pagamento", { fetcher })).rejects.toMatchObject({ indisponivel: true });
  });
});
