import { describe, expect, it } from "vitest";
import {
  CATALOGO_DE_HABILITACAO,
  KITS_PADRAO,
  codigoDaUnidade,
  documentosQueFaltam,
  nomeDoArquivo,
  problemasDoNome,
  prontidaoDoKit,
  resumoDoAcervo,
  situacaoDoDocumento,
  situacaoDoRfq,
} from "./habilitacaoDomain.js";

const HOJE = "2026-08-31";

describe("semáforo do documento", () => {
  it("os cinco estados da régua da titular", () => {
    const doc = (extra) => situacaoDoDocumento({ numero: "1", ...extra }, HOJE).estado;
    expect(doc({ venceEm: "2026-08-13" })).toBe("vencido");
    expect(doc({ venceEm: "2026-09-20" })).toBe("critico");   // 20 dias
    expect(doc({ venceEm: "2026-10-30" })).toBe("atencao");   // 60 dias
    expect(doc({ venceEm: "2027-02-01" })).toBe("valido");    // 154 dias
    expect(doc({ emitidoEm: "2026-01-10" })).toBe("reemitir"); // sem validade, velho
    expect(doc({ emitidoEm: "2026-08-20" })).toBe("valido");   // sem validade, recente
    expect(doc({ permanente: true })).toBe("permanente");
  });

  it("as fronteiras exatas: 0, 30, 31, 90 e 91 dias", () => {
    // É aqui que uma régua mal escrita mente. 30 dias ainda é CRÍTICO, 31 já é
    // ATENÇÃO, 90 ainda é ATENÇÃO, 91 é VÁLIDO.
    const em = (data) => situacaoDoDocumento({ numero: "1", venceEm: data }, HOJE).estado;
    expect(em("2026-08-31")).toBe("critico");  // vence hoje
    expect(em("2026-09-30")).toBe("critico");  // 30
    expect(em("2026-10-01")).toBe("atencao");  // 31
    expect(em("2026-11-29")).toBe("atencao");  // 90
    expect(em("2026-11-30")).toBe("valido");   // 91
  });

  it("documento sem nenhuma data não se apresenta como válido", () => {
    // Indeterminado que passa por válido é como o comprador descobre por nós.
    const s = situacaoDoDocumento({ numero: "1", arquivoUrl: "https://x/y.pdf" }, HOJE);
    expect(s.estado).toBe("reemitir");
    expect(s.motivo).toMatch(/Sem data/);
  });

  it("linha sem arquivo e sem número é ausência, não documento", () => {
    expect(situacaoDoDocumento({ titulo: "CND Federal" }, HOJE).estado).toBe("ausente");
  });

  it("cada tipo pode apertar o próprio prazo de reemissão", () => {
    // A DHL pede CNPJ e SINTEGRA com consulta de até 2 meses; o padrão é 90.
    const emitido = { numero: "1", emitidoEm: "2026-07-15" }; // 47 dias
    expect(situacaoDoDocumento(emitido, HOJE).estado).toBe("valido");
    expect(situacaoDoDocumento({ ...emitido, diasAceitaveis: 30 }, HOJE).estado).toBe("reemitir");
  });

  it("permanente não é derrubado por uma emissão antiga", () => {
    expect(situacaoDoDocumento({ numero: "NIRE", emitidoEm: "2025-10-03", permanente: true }, HOJE).estado)
      .toBe("permanente");
  });
});

describe("nome de arquivo", () => {
  it("reproduz o padrão da titular, letra por letra", () => {
    expect(nomeDoArquivo({
      categoria: "licencas", tipo: "CLCB-BOMBEIROS", unidade: "MATRIZ-SP", venceEm: "2027-02-01",
    })).toBe("02-LIC_CLCB-BOMBEIROS_MATRIZ-SP_V2027-02-01.pdf");
  });

  it("prefixo E quando não há validade — a data é a da emissão", () => {
    expect(nomeDoArquivo({
      categoria: "societario", tipo: "CARTAO-CNPJ", unidade: "MATRIZ-SP", emitidoEm: "2026-05-04",
    })).toBe("01-SOC_CARTAO-CNPJ_MATRIZ-SP_E2026-05-04.pdf");
  });

  it("tira acento, cedilha e espaço sem precisar que ninguém lembre", () => {
    expect(nomeDoArquivo({
      categoria: "certidoes", tipo: "Certidão de falência", unidade: "EMPRESA", emitidoEm: "2026-08-31",
    })).toBe("04-CND_CERTIDAO-DE-FALENCIA_EMPRESA_E2026-08-31.pdf");
  });

  it("acusa os nomes que a auditoria pegou", () => {
    expect(problemasDoNome("Contrato Social — TO DO GREEN 031025.pdf")).toEqual(
      expect.arrayContaining([expect.stringMatching(/espaço/), expect.stringMatching(/6 dígitos/)]),
    );
    expect(problemasDoNome("1. CLI Definitivo — São Paulo — Galpão.pdf")).toEqual(
      expect.arrayContaining([expect.stringMatching(/definitivo/i)]),
    );
    // O nome canônico não pode ser acusado de nada — em particular, o `V2027`
    // da data não é a palavra proibida "v2".
    expect(problemasDoNome("02-LIC_CLCB-BOMBEIROS_MATRIZ-SP_V2027-02-01.pdf")).toEqual([]);
    expect(problemasDoNome("01-SOC_CARTAO-CNPJ_MATRIZ-SP_E2026-05-04.pdf")).toEqual([]);
    // Mas "v2" de verdade continua sendo pego.
    expect(problemasDoNome("01-SOC_CARTAO-CNPJ_MATRIZ-SP_V2.pdf")).toEqual(
      expect.arrayContaining([expect.stringMatching(/v2/i)]),
    );
  });
});

describe("código da unidade", () => {
  it("acompanha o número do CNPJ", () => {
    expect(codigoDaUnidade({ cnpj: "41.385.427/0001-32", cidade: "São Paulo", uf: "SP", matriz: true })).toBe("MATRIZ-SP");
    expect(codigoDaUnidade({ cnpj: "41.385.427/0002-13", cidade: "Sorocaba", uf: "SP" })).toBe("F02-SOROCABA-SP");
    expect(codigoDaUnidade({ cnpj: "41.385.427/0023-48", cidade: "Belo Horizonte", uf: "MG" })).toBe("F23-BELO-HORIZONTE-MG");
  });
});

describe("prontidão do kit", () => {
  const doc = (tipo, extra = {}) => ({ tipo, numero: "1", emitidoEm: "2026-08-20", ...extra });

  it("essencial vencido TRAVA o envio — mandar assim é pior que não mandar", () => {
    const kit = { chave: "k", nome: "K", tipos: ["APOLICE-RCTR-C", "CARTAO-CNPJ"] };
    const pronto = prontidaoDoKit(kit, [
      doc("APOLICE-RCTR-C", { venceEm: "2026-08-13", emitidoEm: "" }),
      doc("CARTAO-CNPJ"),
    ], HOJE);
    expect(pronto.liberado).toBe(false);
    expect(pronto.bloqueios.map((item) => item.tipo)).toContain("APOLICE-RCTR-C");
  });

  it("o que nunca entrou no acervo aparece como faltando, não desaparece", () => {
    const kit = { chave: "k", nome: "K", tipos: ["CND-FEDERAL", "CARTAO-CNPJ"] };
    const pronto = prontidaoDoKit(kit, [doc("CARTAO-CNPJ")], HOJE);
    const cnd = pronto.itens.find((item) => item.tipo === "CND-FEDERAL");
    expect(cnd.situacao.estado).toBe("ausente");
    expect(cnd.documento).toBeNull();
    expect(pronto.liberado).toBe(false);
  });

  it("entre duas vias do mesmo tipo vale a menos grave", () => {
    // Reemitir o cartão CNPJ não pode continuar aparecendo como pendência
    // depois de reemitido, só porque a via velha continua arquivada.
    const kit = { chave: "k", nome: "K", tipos: ["CARTAO-CNPJ"] };
    const pronto = prontidaoDoKit(kit, [
      doc("CARTAO-CNPJ", { emitidoEm: "2023-05-25" }),
      doc("CARTAO-CNPJ", { emitidoEm: "2026-08-20" }),
    ], HOJE);
    expect(pronto.itens[0].situacao.estado).toBe("valido");
    expect(pronto.liberado).toBe(true);
  });

  it("kit com tudo em ordem libera e conta o que está pronto", () => {
    const kit = { chave: "k", nome: "K", tipos: ["CARTAO-CNPJ", "CONTRATO-SOCIAL-CONSOLIDADO"] };
    const pronto = prontidaoDoKit(kit, [
      doc("CARTAO-CNPJ"),
      doc("CONTRATO-SOCIAL-CONSOLIDADO", { permanente: true }),
    ], HOJE);
    expect(pronto.liberado).toBe(true);
    expect(pronto.prontos).toBe(2);
    expect(pronto.total).toBe(2);
  });

  it("os kits padrão só usam tipos que existem no catálogo", () => {
    const conhecidos = new Set(CATALOGO_DE_HABILITACAO.map((item) => item.tipo));
    for (const kit of KITS_PADRAO)
      for (const tipo of kit.tipos) expect(conhecidos.has(tipo)).toBe(true);
  });
});

describe("o acervo em números", () => {
  it("conta o que trava um RFQ agora e o que falta cadastrar", () => {
    const resumo = resumoDoAcervo([
      { tipo: "APOLICE-RCTR-C", numero: "1", venceEm: "2026-08-13" },
      { tipo: "CARTAO-CNPJ", numero: "1", emitidoEm: "2026-08-20" },
    ], HOJE);
    expect(resumo.total).toBe(2);
    expect(resumo.vencido).toBe(1);
    expect(resumo.valido).toBe(1);
    expect(resumo.travando).toBeGreaterThan(0);
    expect(resumo.faltando).toBe(CATALOGO_DE_HABILITACAO.length - 2);
  });

  it("o que falta vem com o essencial primeiro", () => {
    const faltando = documentosQueFaltam([]);
    expect(faltando).toHaveLength(CATALOGO_DE_HABILITACAO.length);
    expect(faltando[0].essencial).toBe(true);
    expect(faltando[faltando.length - 1].essencial).toBeFalsy();
  });
});

describe("ciclo do RFQ", () => {
  it("prazo estourado em pedido aberto é a única urgência da tela", () => {
    expect(situacaoDoRfq({ etapa: "montando", prazo: "2026-08-25" }, HOJE).atrasado).toBe(true);
    expect(situacaoDoRfq({ etapa: "montando", prazo: "2026-09-10" }, HOJE).atrasado).toBe(false);
    // Fechado não fica atrasado para sempre.
    expect(situacaoDoRfq({ etapa: "ganho", prazo: "2026-08-25", motivo: "preço" }, HOJE).atrasado).toBe(false);
  });

  it("fechado sem motivo é sinalizado", () => {
    expect(situacaoDoRfq({ etapa: "perdido" }, HOJE).faltaMotivo).toBe(true);
    expect(situacaoDoRfq({ etapa: "perdido", motivo: "preço 12% acima" }, HOJE).faltaMotivo).toBe(false);
    expect(situacaoDoRfq({ etapa: "enviado" }, HOJE).faltaMotivo).toBe(false);
  });
});
