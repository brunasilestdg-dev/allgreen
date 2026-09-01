import { describe, expect, it } from "vitest";
import { buildExtensionPrompt } from "../extension/prompt.js";

const ctx = {
  url: "https://exemplo.com/artigo",
  title: "Artigo",
  pageText: "Conteúdo completo da página com muitos detalhes.",
  selection: "trecho selecionado",
  question: "qual o prazo?",
};

describe("buildExtensionPrompt", () => {
  it("resumo usa o texto da página e a URL", () => {
    const p = buildExtensionPrompt("summary", ctx);
    expect(p).toContain("Resuma");
    expect(p).toContain("https://exemplo.com/artigo");
    expect(p).toContain("Conteúdo completo da página");
  });

  it("tradução prioriza a seleção quando existe", () => {
    const p = buildExtensionPrompt("translate", ctx);
    expect(p).toContain("traduza para o português");
    expect(p).toContain("trecho selecionado");
    expect(p).not.toContain("Conteúdo completo da página");
  });

  it("resposta a mensagem inclui a instrução adicional (pergunta)", () => {
    const p = buildExtensionPrompt("reply", ctx);
    expect(p).toContain("resposta profissional");
    expect(p).toContain("qual o prazo?");
    expect(p).toContain("trecho selecionado");
  });

  it("modo tarefa pede criação de tarefa dentro do ERP", () => {
    const p = buildExtensionPrompt("task", ctx);
    expect(p).toContain("criar_tarefa");
    expect(p).toContain("Central de Implantação");
    expect(p).toContain("trecho selecionado");
  });

  it("modo próxima ação pede atualização do CRM", () => {
    const p = buildExtensionPrompt("next-action", ctx);
    expect(p).toContain("definir_proxima_acao");
    expect(p).toContain("CRM");
    expect(p).toContain("trecho selecionado");
  });

  it("perguntar usa a pergunta e restringe ao conteúdo (não inventar)", () => {
    const p = buildExtensionPrompt("ask", ctx);
    expect(p).toContain("qual o prazo?");
    expect(p).toContain("não consta");
  });

  it("cai no modo perguntar por padrão e trunca textos longos", () => {
    const big = "a".repeat(9000);
    const p = buildExtensionPrompt("qualquer", {
      pageText: big,
      question: "x",
    });
    // texto truncado em 6000 chars
    expect(p).toContain("a".repeat(6000));
    expect(p).not.toContain("a".repeat(6001));
  });

  it("sem seleção, usa o texto da página nos modos de trecho", () => {
    const p = buildExtensionPrompt("explain", {
      pageText: "somente pagina",
    });
    expect(p).toContain("somente pagina");
  });
});
