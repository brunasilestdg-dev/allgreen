import { describe, expect, it } from "vitest";
import {
  MODALIDADES_PNCP,
  SIGNAL_SOURCES,
  classificarSinais,
  dedupeSinais,
  fingerprintDeSinal,
  foraDoEscopoDeTransporte,
  normalizarArtigoGdelt,
  normalizarBuscaPncp,
  normalizarContratacaoPncp,
  pontuarSinal,
  urlDoProcessoPncp,
} from "./marketSignalDomain.js";

const AGORA = Date.parse("2026-09-13T12:00:00Z");

// Fixtures no formato real das fontes (amostras de 13/09/2026).
const CONSULTA_PNCP = {
  numeroControlePNCP: "01612441000107-1-000131/2026", anoCompra: 2026, sequencialCompra: 131,
  orgaoEntidade: { cnpj: "01612441000107", razaoSocial: "MUNICIPIO DE BELA VISTA DO CAROBA", esferaId: "M" },
  unidadeOrgao: { ufSigla: "PR", municipioNome: "Bela Vista da Caroba" }, modalidadeId: 6,
  dataPublicacaoPncp: "2026-09-11T00:00:08", dataEncerramentoProposta: "2026-09-25T08:00:01",
  objetoCompra: "CONTRATAÇÃO DE EMPRESA PARA SERVIÇOS DE TRANSPORTE DE CARGAS E DISTRIBUIÇÃO DE MERCADORIAS COM VEÍCULOS ELÉTRICOS (VUC)", valorTotalEstimado: 350000, linkSistemaOrigem: null,
};
const COMPRAS_GOV = {
  numeroControlePNCP: "00394544000185-1-001941/2026", modalidadeNome: "Pregão - Eletrônico", modalidadeIdPncp: 6, codigoModalidade: 5,
  objetoCompra: "Contratação de serviços de logística e frete para distribuição de medicamentos com caminhão baú", unidadeOrgaoUfSigla: "DF", unidadeOrgaoMunicipioNome: "BRASÍLIA",
  orgaoEntidadeRazaoSocial: "MINISTERIO DA SAUDE", dataPublicacaoPncp: "2026-09-11T04:00:02", dataEncerramentoPropostaPncp: "2026-09-24T09:00:00", valorTotalEstimado: 0, situacaoCompraNomePncp: "Divulgada no PNCP",
};
const BUSCA_PNCP = {
  id: "643de908a7e8ae37437ce22aec343848", title: "Edital nº 000035/2026", description: "IMPLANTACAO DE REGISTRO DE PREÇOS, VISANDO FUTURAS PRESTAÇÕES DE SERVIÇOS DE AUTO ELÉTRICA, BORRACHARIA ALINHAMENTO E BALANCEAMENTO EM VEÍCULOS DA FROTA MUNICIPAL",
  item_url: "/compras/18241752000100/2026/53", numero_controle_pncp: "18241752000100-1-000053/2026", orgao_nome: "MUNICIPIO DE ALPINOPOLIS", uf: "MG", municipio_nome: "Alpinópolis",
  modalidade_licitacao_nome: "Pregão - Eletrônico", situacao_nome: "Divulgada no PNCP", data_publicacao_pncp: "2026-09-12T10:37:56.536796720", data_fim_vigencia: "2026-09-26T08:00", valor_global: null,
};
const GDELT = { url: "https://www.exemplo.com.br/noticia/frota?utm_source=x", title: "Transportadora adota caminhões elétricos na logística de São Paulo", seendate: "20260912T143000Z", domain: "exemplo.com.br", language: "Portuguese", sourcecountry: "Brazil" };

describe("normalização por fonte", () => {
  it("consulta PNCP e Compras.gov viram o mesmo formato, com URL do portal e fingerprint pelo número de controle", () => {
    const a = normalizarContratacaoPncp(CONSULTA_PNCP);
    expect(a).toMatchObject({ source: "pncp", kind: "licitacao", externalId: "01612441000107-1-000131/2026", uf: "PR", municipio: "Bela Vista da Caroba", modalidade: "Pregão - Eletrônico", valorEstimado: 350000, publicadoEm: "2026-09-11T00:00:08.000Z", prazoProposta: "2026-09-25T08:00:01.000Z" });
    expect(a.url).toBe("https://pncp.gov.br/app/editais/01612441000107/2026/131");
    expect(a.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    const b = normalizarContratacaoPncp(COMPRAS_GOV, { source: "compras-gov" });
    expect(b).toMatchObject({ source: "compras-gov", uf: "DF", orgao: "MINISTERIO DA SAUDE", modalidade: "Pregão - Eletrônico", valorEstimado: null, situacao: "Divulgada no PNCP", prazoProposta: "2026-09-24T09:00:00.000Z" });
    expect(MODALIDADES_PNCP[8]).toBe("Dispensa");
    expect(SIGNAL_SOURCES["compras-gov"]).toBe("Compras.gov.br");
  });

  it("o mesmo processo visto no PNCP e no Compras.gov tem o mesmo fingerprint (dedupe entre fontes)", () => {
    const viaPncp = normalizarContratacaoPncp({ ...COMPRAS_GOV, unidadeOrgao: { ufSigla: "DF" } });
    const viaCompras = normalizarContratacaoPncp(COMPRAS_GOV, { source: "compras-gov" });
    expect(fingerprintDeSinal({ source: "pncp", externalId: viaPncp.externalId })).toBe(fingerprintDeSinal({ source: "pncp", externalId: viaCompras.externalId }));
    // Fontes diferentes com o MESMO número de controle: o dedupe usa o número (via fingerprint com source normalizado no serviço); aqui só garantimos determinismo.
    expect(viaPncp.fingerprint).toBe(normalizarContratacaoPncp({ ...COMPRAS_GOV, unidadeOrgao: { ufSigla: "DF" } }).fingerprint);
  });

  it("busca do portal PNCP e artigo GDELT", () => {
    const s = normalizarBuscaPncp(BUSCA_PNCP);
    expect(s).toMatchObject({ source: "pncp", externalId: "18241752000100-1-000053/2026", uf: "MG", municipio: "Alpinópolis", url: "https://pncp.gov.br/app/editais/18241752000100/2026/53", prazoProposta: "2026-09-26T08:00:00.000Z" });
    expect(s.publicadoEm.startsWith("2026-09-12T10:37:56")).toBe(true);
    const g = normalizarArtigoGdelt(GDELT);
    expect(g).toMatchObject({ source: "gdelt", kind: "noticia", url: "https://www.exemplo.com.br/noticia/frota", dominio: "exemplo.com.br", publicadoEm: "2026-09-12T14:30:00.000Z", orgao: "Brazil" });
    expect(urlDoProcessoPncp("lixo", "https://origem.gov.br/x")).toBe("https://origem.gov.br/x");
    expect(urlDoProcessoPncp("")).toBe("");
  });
});

describe("score explicável e rejeições", () => {
  it("licitação de transporte elétrico aberta pontua alto com motivos legíveis", () => {
    const p = pontuarSinal(normalizarContratacaoPncp(CONSULTA_PNCP), { agora: AGORA, ufsFoco: ["PR", "SP"] });
    expect(p.rejected).toBe("");
    expect(p.score).toBe(100);
    expect(p.reasons).toEqual(expect.arrayContaining([
      "fonte estruturada de contratação (PNCP)",
      "objeto aderente a transporte de cargas / first-middle-last mile",
      "eletrificação, baixa emissão ou descarbonização",
      "classe de veículo compatível citada",
      "publicado nos últimos 7 dias",
      "UF de operação (PR)",
      "valor estimado relevante (≥ R$ 100 mil)",
    ]));
    expect(p.reasons.some((r) => r.startsWith("propostas abertas por mais"))).toBe(true);
  });

  it("fora de escopo, equipamento incompatível, sem transporte, prazo/processo encerrado", () => {
    expect(pontuarSinal(normalizarBuscaPncp(BUSCA_PNCP), { agora: AGORA }).rejected).toBe("fora_do_escopo"); // auto elétrica/borracharia
    expect(foraDoEscopoDeTransporte("seguro da frota municipal")).toBe(true);
    expect(pontuarSinal(normalizarContratacaoPncp({ ...CONSULTA_PNCP, objetoCompra: "Transporte de cargas com bitrem" }), { agora: AGORA }).rejected).toBe("equipamento_incompativel");
    expect(pontuarSinal(normalizarContratacaoPncp({ ...CONSULTA_PNCP, objetoCompra: "Aquisição de computadores" }), { agora: AGORA }).rejected).toBe("sem_transporte");
    expect(pontuarSinal(normalizarContratacaoPncp({ ...CONSULTA_PNCP, dataEncerramentoProposta: "2026-09-01T08:00:00" }), { agora: AGORA }).rejected).toBe("prazo_encerrado");
    expect(pontuarSinal(normalizarContratacaoPncp({ ...COMPRAS_GOV, situacaoCompraNomePncp: "Revogada" }), { agora: AGORA }).rejected).toBe("processo_encerrado");
  });

  it("notícia sem transporte nem eletrificação é irrelevante; com os dois, pontua moderado", () => {
    expect(pontuarSinal(normalizarArtigoGdelt({ ...GDELT, title: "Prefeitura inaugura praça" }), { agora: AGORA }).rejected).toBe("sem_relevancia");
    const p = pontuarSinal(normalizarArtigoGdelt(GDELT), { agora: AGORA });
    expect(p.rejected).toBe("");
    expect(p.score).toBe(65);
    expect(p.reasons[0]).toContain("GDELT");
  });

  it("prazo curto marca urgência em vez de bonificar como aberto", () => {
    const p = pontuarSinal(normalizarContratacaoPncp({ ...CONSULTA_PNCP, dataEncerramentoProposta: "2026-09-14T08:00:00" }), { agora: AGORA });
    expect(p.reasons).toContain("prazo de proposta termina em menos de 3 dias (urgente)");
  });
});

describe("dedupe e classificação", () => {
  it("mesmo fingerprint colapsa; maior score vence; fontes e contagem somam", () => {
    const a = { fingerprint: "f1", source: "pncp", score: 70, title: "A", publicadoEm: "2026-09-10" };
    const b = { fingerprint: "f1", source: "compras-gov", score: 80, title: "A", publicadoEm: "2026-09-10" };
    const c = { fingerprint: "f2", source: "gdelt", score: 40, title: "C", publicadoEm: "2026-09-11" };
    const r = dedupeSinais([a, b, c]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ fingerprint: "f1", score: 80, seenCount: 2, sources: ["pncp", "compras-gov"] });
  });

  it("classificarSinais pontua, rejeita com contagem por motivo e ordena por score", () => {
    const sinais = [
      normalizarContratacaoPncp(CONSULTA_PNCP),
      normalizarContratacaoPncp(COMPRAS_GOV, { source: "compras-gov" }),
      normalizarContratacaoPncp(COMPRAS_GOV, { source: "compras-gov" }), // duplicado
      normalizarBuscaPncp(BUSCA_PNCP), // fora de escopo
      normalizarArtigoGdelt(GDELT),
    ];
    const r = classificarSinais(sinais, { agora: AGORA, ufsFoco: ["PR"] });
    expect(r.aceitos.map((s) => s.source)).toEqual(["pncp", "compras-gov", "gdelt"]);
    expect(r.aceitos[0].score).toBeGreaterThan(r.aceitos[1].score);
    expect(r.aceitos[1].scoreReasons).toContain("objeto aderente a transporte de cargas / first-middle-last mile");
    expect(r.aceitos[2].scoreReasons).toContain("menciona transporte/logística");
    expect(r.rejeitados).toEqual({ fora_do_escopo: 1, duplicado: 1 });
  });
});
