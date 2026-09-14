import { describe, expect, it } from "vitest";
import {
  GREEN_ON_TEMAS_DE_NOTICIA,
  createGreenOnNoticia,
  filtrarFeedGreenOn,
  foraDoEscopoGreenOn,
  resumirFeedGreenOn,
  temaDaNoticiaGreenOn,
} from "./greenOnNoticiaDomain.js";

describe("Green On — notícias focadas no core", () => {
  it("expõe os temas do core (Recarga, Energia, E-mobilidade, Regulatório)", () => {
    const chaves = GREEN_ON_TEMAS_DE_NOTICIA.map(([k]) => k);
    expect(chaves).toEqual(["todas", "regulatorio", "recarga", "energia", "e-mobilidade", "outros"]);
  });

  it("classifica notícia sobre eletroposto como Recarga", () => {
    const tema = temaDaNoticiaGreenOn({
      title: "Novo hub de recarga rápida em SP",
      summary: "Empresa instala 8 eletropostos com carregadores DC de 150kW",
    });
    expect(tema).toBe("recarga");
  });

  it("classifica notícia da ANEEL como Regulatório (não Energia)", () => {
    const tema = temaDaNoticiaGreenOn({
      title: "ANEEL abre consulta pública sobre tarifa branca",
      summary: "Resolução normativa regula a operação de eletropostos",
    });
    expect(tema).toBe("regulatorio");
  });

  it("classifica notícia sobre BESS como Energia", () => {
    const tema = temaDaNoticiaGreenOn({
      title: "BESS de 20 MWh entra em operação no NE",
      summary: "Sistema de armazenamento estacionário integra geração distribuída",
    });
    expect(tema).toBe("energia");
  });

  it("classifica notícia sobre BYD/veículo elétrico como E-mobilidade", () => {
    const tema = temaDaNoticiaGreenOn({
      title: "BYD lança novo modelo elétrico no Brasil",
      summary: "Autonomia de 500 km com bateria de LiFePO4",
    });
    expect(tema).toBe("e-mobilidade");
  });

  it("notícia sem termo do core cai em 'outros', sem forçar", () => {
    const tema = temaDaNoticiaGreenOn({
      title: "Mercado financeiro fecha em alta",
      summary: "Dólar recua ante o real",
    });
    expect(tema).toBe("outros");
  });

  it("notícia de logística pura é marcada como fora de escopo Green On", () => {
    expect(foraDoEscopoGreenOn({
      title: "Transportadora anuncia expansão do last mile",
      summary: "Nova frota terceirizada para carga fracionada",
    })).toBe(true);
  });

  it("notícia sem título nem resumo é descartada do feed", () => {
    const feed = filtrarFeedGreenOn([
      createGreenOnNoticia({ title: "", summary: "" }),
      createGreenOnNoticia({ title: "Nova estação de recarga em SP", source: "Radar" }),
    ]);
    expect(feed).toHaveLength(1);
    expect(feed[0].tema).toBe("recarga");
  });

  it("feed ordena as notícias mais recentes primeiro pela data de publicação", () => {
    const feed = filtrarFeedGreenOn([
      createGreenOnNoticia({ title: "A", publishedAt: "2026-01-01" }),
      createGreenOnNoticia({ title: "B", publishedAt: "2026-03-01" }),
      createGreenOnNoticia({ title: "C", publishedAt: "2026-02-01" }),
    ]);
    expect(feed.map((n) => n.title)).toEqual(["B", "C", "A"]);
  });

  it("resumo do feed conta por tema, últimos 7 dias e destacadas", () => {
    const agora = new Date("2026-09-14T00:00:00Z");
    const seteDiasAntes = new Date(agora.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const noticias = [
      createGreenOnNoticia({ title: "ANEEL amplia tarifa branca", publishedAt: seteDiasAntes, highlighted: true }),
      createGreenOnNoticia({ title: "Nova estação de recarga", publishedAt: seteDiasAntes }),
      createGreenOnNoticia({ title: "Bateria de LiFePO4 chega ao Brasil", publishedAt: "2020-01-01" }),
      createGreenOnNoticia({ title: "Transportadora expande frota", publishedAt: seteDiasAntes }), // fora de escopo
    ];
    const resumo = resumirFeedGreenOn(noticias, agora);
    expect(resumo.total).toBe(3); // fora-de-escopo excluído
    expect(resumo.ultimos7dias).toBe(2);
    expect(resumo.destacadas).toBe(1);
    expect(resumo.porTema.regulatorio).toBe(1);
    expect(resumo.porTema.recarga).toBe(1);
    expect(resumo.porTema["e-mobilidade"]).toBe(1);
  });

  it("criar notícia limpa markdown/prefixos do título (reusando limparResumoDeBusca)", () => {
    const noticia = createGreenOnNoticia({
      title: "Title: ## **Nova estação** de recarga",
      summary: "![img](x.jpg) resumo em texto puro",
    });
    expect(noticia.title).toBe("Nova estação de recarga");
    expect(noticia.summary).toContain("resumo em texto puro");
  });
});
