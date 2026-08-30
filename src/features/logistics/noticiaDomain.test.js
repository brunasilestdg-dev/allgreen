import { describe, expect, it } from "vitest";
import {
  extrairDataDaNoticia,
  limparResumoDeBusca,
  temaDaNoticia,
} from "./noticiaDomain.js";

describe("limparResumoDeBusca", () => {
  it("remove prefixos de raspagem, markdown e restos de pipeline de imagem", () => {
    const cru = "Title: Gás Verde lança frota | Exame # Gás Verde ## Empresa adquire 100 caminhões " +
      "a **biometano** (Gás Verde/Divulgação):format(webp)) e amplia [logística verde](https://x.y).";
    const limpo = limparResumoDeBusca(cru);
    expect(limpo).not.toMatch(/Title:|##|\*\*|:format\(|\]\(/);
    expect(limpo).toContain("biometano");
    expect(limpo).toContain("logística verde");
  });

  it("não inventa texto quando já está limpo", () => {
    expect(limparResumoDeBusca("Frota elétrica cresce 20% em São Paulo.")).toBe(
      "Frota elétrica cresce 20% em São Paulo.",
    );
  });
});

describe("extrairDataDaNoticia", () => {
  it("lê data numérica, ISO e por extenso", () => {
    expect(extrairDataDaNoticia("Publicado em 12/08/2026 às 9h")).toBe("2026-08-12");
    expect(extrairDataDaNoticia("data: 2026-03-05 no diário")).toBe("2026-03-05");
    expect(extrairDataDaNoticia("São Paulo, 3 de agosto de 2026")).toBe("2026-08-03");
  });

  it("devolve vazio quando a fonte não menciona data — nunca um chute", () => {
    expect(extrairDataDaNoticia("Empresa amplia frota de caminhões elétricos")).toBe("");
    expect(extrairDataDaNoticia("versão 31/13/2026 inválida")).toBe("");
  });
});

describe("temaDaNoticia", () => {
  it("cliente vence ESG, e ESG vence transportes", () => {
    const clientes = ["Magazine Aurora", "Fazendas Reunidas"];
    expect(temaDaNoticia({ title: "Magazine Aurora abre CD com frota elétrica" }, clientes)).toBe("clientes");
    expect(temaDaNoticia({ company: "Qualquer Empresa", title: "expande" }, [])).toBe("clientes");
    expect(temaDaNoticia({ title: "Descarbonização do transporte pesado avança" }, clientes)).toBe("esg");
    expect(temaDaNoticia({ title: "Novo centro de distribuição em Cajamar" }, clientes)).toBe("transportes");
  });

  it("nome curto de cliente não classifica sozinho", () => {
    expect(temaDaNoticia({ title: "Via de acesso liberada" }, ["Via"])).toBe("transportes");
  });
});
