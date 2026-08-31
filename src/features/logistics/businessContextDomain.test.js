import { describe, expect, it } from "vitest";
import {
  CATEGORIAS_DO_NEGOCIO,
  blocoDeContexto,
  fatosQueFaltam,
  normalizarFato,
  podeVerSigilo,
  propostaDeAprendizado,
  sementeDoNegocio,
} from "./businessContextDomain.js";

describe("dossiê do negócio", () => {
  it("a semente cobre as categorias que sustentam uma resposta de RFI", () => {
    const semente = sementeDoNegocio();
    const categorias = new Set(semente.map((fato) => fato.categoria));
    for (const obrigatoria of ["identidade", "proposta", "operacao", "numeros", "habilitacao", "fiscal"])
      expect(categorias.has(obrigatoria)).toBe(true);
    // Chave duplicada faria a semeadura gravar dois fatos e o modelo ler duas
    // versões do mesmo assunto na mesma pergunta.
    expect(new Set(semente.map((fato) => fato.chave)).size).toBe(semente.length);
    expect(semente.every((fato) => fato.fonte)).toBe(true);
  });

  it("nenhum fato da semente carrega CPF, conta bancária ou CNH", () => {
    // A regra da titular vale aqui sem exceção: dado de pessoa e dado bancário
    // não moram no código. Eles se cadastram na tela, com sigilo restrito.
    const tudo = sementeDoNegocio().map((fato) => `${fato.titulo} ${fato.conteudo}`).join("\n");
    expect(tudo).not.toMatch(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/); // CPF
    expect(tudo).not.toMatch(/ag[êe]ncia\s*\d/i);
    expect(tudo).not.toMatch(/conta\s+corrente\s*\d/i);
    expect(sementeDoNegocio().every((fato) => fato.sigilo !== "restrito")).toBe(true);
  });

  it("registra o que está vencido em vez de esconder", () => {
    // Um assistente que afirma cobertura de seguro expirada numa resposta de
    // RFQ desclassifica a empresa. O fato ruim precisa estar no dossiê.
    const habilitacao = sementeDoNegocio().find((fato) => fato.chave === "habilitacao-pendente");
    expect(habilitacao.conteudo).toMatch(/venceram em 13\/08\/2026/);
    expect(habilitacao.fixado).toBe(true);
  });

  it("o bloco do prompt corta o excedente mas nunca um fato fixado", () => {
    const fatos = [
      { chave: "a", titulo: "Fixado", conteudo: "x".repeat(400), sigilo: "publico", fixado: true, categoria: "vocabulario" },
      { chave: "b", titulo: "Solto", conteudo: "y".repeat(400), sigilo: "publico", categoria: "identidade" },
    ];
    const bloco = blocoDeContexto(fatos, { teto: 100 });
    expect(bloco).toContain("Fixado");
    expect(bloco).not.toContain("Solto");
  });

  it("o restrito só entra quando quem pergunta pode ver", () => {
    const fatos = [{ chave: "banco", titulo: "Banco", conteudo: "dado sensível da empresa", sigilo: "restrito" }];
    expect(blocoDeContexto(fatos)).toBe("");
    expect(blocoDeContexto(fatos, { incluirRestrito: true })).toContain("Banco");
    expect(podeVerSigilo("restrito", { papel: "vendedor", permissoes: ["crm:manage"] })).toBe(false);
    expect(podeVerSigilo("restrito", { papel: "owner", permissoes: [] })).toBe(true);
    expect(podeVerSigilo("restrito", { papel: "financeiro", permissoes: ["finance:manage"] })).toBe(true);
    expect(podeVerSigilo("interno", { papel: "vendedor", permissoes: [] })).toBe(true);
  });

  it("o perfil que vai ao portal do cliente é só o público", () => {
    // O portal fala com gente de fora. Interno e restrito não podem chegar ao
    // modelo lá — a confidencialidade é cumprida pelo que NÃO é enviado, não
    // pela obediência do modelo à instrução.
    const publicos = sementeDoNegocio().filter((fato) => fato.sigilo === "publico");
    const bloco = blocoDeContexto(publicos);
    expect(bloco).toContain("45 milhões de entregas");
    for (const interno of sementeDoNegocio().filter((fato) => fato.sigilo !== "publico"))
      expect(bloco).not.toContain(interno.titulo);
    // E o que sustenta a regra: nada de RFQ, divergência cadastral ou ficha
    // fiscal está marcado como público na semente.
    const chavesPublicas = publicos.map((fato) => fato.chave);
    for (const jamais of ["habilitacao-pendente", "divergencias-cadastrais", "ficha-cadastral", "seguros", "alcada-societaria"])
      expect(chavesPublicas).not.toContain(jamais);
  });

  it("sigilo e categoria inválidos caem no padrão mais restritivo, não no mais aberto", () => {
    const fato = normalizarFato({ titulo: "x", conteudo: "y", sigilo: "qualquer", categoria: "inventada" });
    expect(fato.sigilo).toBe("interno");
    expect(CATEGORIAS_DO_NEGOCIO.some((item) => item.id === fato.categoria)).toBe(true);
  });

  it("reaplicar a semente não repete o que já existe", () => {
    const semente = sementeDoNegocio();
    expect(fatosQueFaltam(semente)).toHaveLength(0);
    expect(fatosQueFaltam(semente.slice(2))).toHaveLength(2);
  });

  it("aprendizado sem conteúdo é recusado, e o válido nasce com chave e fonte", () => {
    expect(propostaDeAprendizado({ titulo: "Sem corpo", conteudo: "" }).valida).toBe(false);
    expect(propostaDeAprendizado({ conteudo: "texto suficiente aqui" }).valida).toBe(false);
    const { valida, fato } = propostaDeAprendizado({
      titulo: "Nova base em Curitiba",
      conteudo: "A base de Curitiba abriu em agosto de 2026 com 12 vans.",
    });
    expect(valida).toBe(true);
    expect(fato.chave).toBe("aprendido-nova-base-em-curitiba");
    expect(fato.origem).toBe("aprendido");
    expect(fato.fonte).toBeTruthy();
  });
});
