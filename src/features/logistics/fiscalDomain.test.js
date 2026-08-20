import { describe, expect, it } from "vitest";
import {
  CODIGO_UF,
  PIS_COFINS,
  RETENCOES,
  SIMPLES_SERVICOS,
  SIMPLES_TRANSPORTE,
  STATUS_FISCAL,
  TIPOS_DOCUMENTO_FISCAL,
  aliquotaIcmsInterestadual,
  arredondarMoeda,
  calcularIcmsCte,
  calcularImpostosCte,
  calcularImpostosNfse,
  calcularIss,
  calcularPisCofins,
  calcularRetencoes,
  calcularSimplesNacional,
  cfopPadraoCte,
  construirXmlCte,
  construirXmlMdfe,
  dadosDacte,
  escaparXml,
  fiscalTransmissionEnabled,
  gerarChaveDeAcesso,
  resumoFiscal,
  transicaoValida,
  validarChaveDeAcesso,
  validarCte,
  validarMdfe,
  validarNfse,
} from "./fiscalDomain.js";

describe("ICMS interestadual — Resolução do Senado 22/1989", () => {
  it("de SP para BA (Sul/Sudeste → Norte/Nordeste): 7%", () => {
    expect(aliquotaIcmsInterestadual("SP", "BA")).toBe(7);
    expect(aliquotaIcmsInterestadual("RJ", "CE")).toBe(7);
    expect(aliquotaIcmsInterestadual("MG", "AM")).toBe(7);
    expect(aliquotaIcmsInterestadual("PR", "GO")).toBe(7);
    expect(aliquotaIcmsInterestadual("RS", "ES")).toBe(7);
  });

  it("de BA para SP (qualquer outro interestadual): 12%", () => {
    expect(aliquotaIcmsInterestadual("BA", "SP")).toBe(12);
    expect(aliquotaIcmsInterestadual("GO", "MG")).toBe(12);
    expect(aliquotaIcmsInterestadual("CE", "BA")).toBe(12);
  });

  it("de SP para RJ (Sul/Sudeste → Sul/Sudeste): 12%", () => {
    expect(aliquotaIcmsInterestadual("SP", "RJ")).toBe(12);
    expect(aliquotaIcmsInterestadual("PR", "SC")).toBe(12);
  });

  it("mesmo estado: null (usa alíquota interna)", () => {
    expect(aliquotaIcmsInterestadual("SP", "SP")).toBeNull();
    expect(aliquotaIcmsInterestadual("BA", "BA")).toBeNull();
  });

  it("sem UF: null", () => {
    expect(aliquotaIcmsInterestadual("", "SP")).toBeNull();
    expect(aliquotaIcmsInterestadual("SP", "")).toBeNull();
    expect(aliquotaIcmsInterestadual(null, "SP")).toBeNull();
  });
});

describe("Simples Nacional — LC 123/2006", () => {
  it("1ª faixa transporte: alíquota efetiva 6%", () => {
    const r = calcularSimplesNacional(1000, 150_000, "transporte");
    expect(r.faixa).toBe(1);
    expect(r.aliquotaEfetiva).toBe(6);
    expect(r.valor).toBe(60);
  });

  it("3ª faixa transporte: dedução reduz a alíquota efetiva", () => {
    const r = calcularSimplesNacional(2000, 500_000, "transporte");
    expect(r.faixa).toBe(3);
    expect(r.aliquotaNominal).toBe(13.5);
    expect(r.aliquotaEfetiva).toBe(9.97);
    expect(r.valor).toBe(199.44);
  });

  it("serviços usa Anexo V, alíquota mais alta", () => {
    const transporte = calcularSimplesNacional(1000, 150_000, "transporte");
    const servicos = calcularSimplesNacional(1000, 150_000, "servicos");
    expect(servicos.aliquotaEfetiva).toBeGreaterThan(transporte.aliquotaEfetiva);
    expect(servicos.aliquotaEfetiva).toBe(15.5);
  });

  it("acima do teto (R$ 4.800.000): null", () => {
    expect(calcularSimplesNacional(1000, 5_000_000)).toBeNull();
  });

  it("valor ou faturamento zero: null", () => {
    expect(calcularSimplesNacional(0, 100_000)).toBeNull();
    expect(calcularSimplesNacional(1000, 0)).toBeNull();
    expect(calcularSimplesNacional(-1, 100_000)).toBeNull();
  });

  it("as seis faixas de transporte são progressivas", () => {
    for (let i = 1; i < SIMPLES_TRANSPORTE.length; i++) {
      expect(SIMPLES_TRANSPORTE[i].aliquota).toBeGreaterThan(SIMPLES_TRANSPORTE[i - 1].aliquota);
    }
  });
});

describe("PIS e COFINS", () => {
  it("lucro presumido (cumulativo): PIS 0.65%, COFINS 3.0%", () => {
    const r = calcularPisCofins(10_000, "lucro_presumido");
    expect(r.pisAliquota).toBe(0.65);
    expect(r.pisValor).toBe(65);
    expect(r.cofinsAliquota).toBe(3.0);
    expect(r.cofinsValor).toBe(300);
  });

  it("lucro real (não cumulativo): PIS 1.65%, COFINS 7.6%", () => {
    const r = calcularPisCofins(10_000, "lucro_real");
    expect(r.pisAliquota).toBe(1.65);
    expect(r.pisValor).toBe(165);
    expect(r.cofinsAliquota).toBe(7.6);
    expect(r.cofinsValor).toBe(760);
  });

  it("simples: zero — PIS e COFINS inclusos no DAS", () => {
    const r = calcularPisCofins(10_000, "simples");
    expect(r.pisValor).toBe(0);
    expect(r.cofinsValor).toBe(0);
  });

  it("valor zero ou negativo: tudo zero", () => {
    expect(calcularPisCofins(0, "lucro_presumido").pisValor).toBe(0);
    expect(calcularPisCofins(-100, "lucro_real").cofinsValor).toBe(0);
  });
});

describe("ISS", () => {
  it("calcula sobre alíquota municipal", () => {
    const r = calcularIss(5000, 3.0);
    expect(r.issAliquota).toBe(3.0);
    expect(r.issValor).toBe(150);
  });

  it("sem alíquota: zero", () => {
    expect(calcularIss(5000, 0).issValor).toBe(0);
    expect(calcularIss(5000, null).issValor).toBe(0);
  });
});

describe("ICMS no CT-e", () => {
  it("mesmo estado com alíquota interna de 18%", () => {
    const r = calcularIcmsCte(10_000, { ufOrigem: "SP", ufDestino: "SP", aliquotaInterna: 18 });
    expect(r.icmsAliquota).toBe(18);
    expect(r.icmsValor).toBe(1800);
    expect(r.icmsBase).toBe(10_000);
  });

  it("interestadual SP → BA: 7%", () => {
    const r = calcularIcmsCte(10_000, { ufOrigem: "SP", ufDestino: "BA" });
    expect(r.icmsAliquota).toBe(7);
    expect(r.icmsValor).toBe(700);
  });

  it("simples nacional: ICMS zero, CST 90", () => {
    const r = calcularIcmsCte(10_000, { ufOrigem: "SP", ufDestino: "BA", regimeEmitente: "simples" });
    expect(r.icmsValor).toBe(0);
    expect(r.cstIcms).toBe("90");
    expect(r.simplesNacional).toBe(true);
  });

  it("isento (CST 40): base zero, valor zero", () => {
    const r = calcularIcmsCte(10_000, { ufOrigem: "SP", ufDestino: "SP", cstIcms: "40" });
    expect(r.icmsValor).toBe(0);
    expect(r.cstIcms).toBe("40");
  });

  it("base reduzida (CST 20): 80% do valor de serviço", () => {
    const r = calcularIcmsCte(10_000, { ufOrigem: "SP", ufDestino: "SP", aliquotaInterna: 18, cstIcms: "20" });
    expect(r.icmsBase).toBe(8000);
    expect(r.icmsValor).toBe(1440);
  });

  it("sem valor: tudo zero", () => {
    const r = calcularIcmsCte(0, { ufOrigem: "SP", ufDestino: "BA" });
    expect(r.icmsValor).toBe(0);
  });
});

describe("impostos completos do CT-e", () => {
  it("lucro presumido: ICMS + PIS/COFINS, sem Simples", () => {
    const r = calcularImpostosCte({
      valorServico: 5000,
      ufOrigem: "SP",
      ufDestino: "RJ",
      regimeEmitente: "lucro_presumido",
    });
    expect(r.icms.icmsAliquota).toBe(12);
    expect(r.icms.icmsValor).toBe(600);
    expect(r.pisCofins.pisValor).toBe(32.5);
    expect(r.pisCofins.cofinsValor).toBe(150);
    expect(r.simples).toBeNull();
  });

  it("simples: sem ICMS separado, Simples calculado", () => {
    const r = calcularImpostosCte({
      valorServico: 3000,
      ufOrigem: "SP",
      ufDestino: "MG",
      regimeEmitente: "simples",
      faturamento12m: 300_000,
    });
    expect(r.icms.icmsValor).toBe(0);
    expect(r.pisCofins.pisValor).toBe(0);
    expect(r.simples).not.toBeNull();
    expect(r.simples.faixa).toBe(2);
    expect(r.simples.valor).toBeGreaterThan(0);
  });
});

describe("impostos da NFS-e", () => {
  it("ISS + PIS/COFINS para lucro presumido", () => {
    const r = calcularImpostosNfse({
      valorServico: 2000,
      regimeEmitente: "lucro_presumido",
      aliquotaIss: 5.0,
    });
    expect(r.iss.issValor).toBe(100);
    expect(r.pisCofins.pisValor).toBe(13);
    expect(r.pisCofins.cofinsValor).toBe(60);
    expect(r.simples).toBeNull();
  });

  it("simples: ISS incluso no DAS, Simples calculado", () => {
    const r = calcularImpostosNfse({
      valorServico: 1000,
      regimeEmitente: "simples",
      faturamento12m: 100_000,
      aliquotaIss: 3.0,
    });
    expect(r.iss.issValor).toBe(0);
    expect(r.simples).not.toBeNull();
    expect(r.simples.aliquotaEfetiva).toBe(15.5);
  });
});

describe("retenções", () => {
  it("IRRF sobre frete: 1.5%", () => {
    const r = calcularRetencoes(10_000, { retIrrf: true });
    expect(r.irrf).toBe(150);
  });

  it("abaixo do mínimo (R$ 10): não retém", () => {
    const r = calcularRetencoes(500, { retIrrf: true });
    expect(r.irrf).toBe(0);
  });

  it("valor de R$ 1.000 com IRRF: retém 15 (acima do mínimo); CSLL de 10: retém", () => {
    const r = calcularRetencoes(1000, { retIrrf: true, retCsll: true });
    expect(r.irrf).toBe(15);
    expect(r.csll).toBe(10);
  });

  it("sem flags: objeto vazio", () => {
    expect(calcularRetencoes(10_000)).toEqual({});
  });

  it("todas as retenções de uma vez", () => {
    const r = calcularRetencoes(10_000, { retIrrf: true, retCsll: true, retInss: true, retPisCofins: true });
    expect(r.irrf).toBe(150);
    expect(r.csll).toBe(100);
    expect(r.inss).toBe(1100);
    expect(r.pisCofinsCsll).toBe(465);
  });
});

describe("chave de acesso — 44 dígitos, mod 11", () => {
  const params = {
    cuf: 35,
    aamm: "2601",
    cnpj: "12345678000199",
    mod: 57,
    serie: 1,
    numero: 1,
    tpEmis: 1,
    codigo: "00000001",
  };

  it("gera exatamente 44 dígitos", () => {
    const chave = gerarChaveDeAcesso(params);
    expect(chave).toHaveLength(44);
    expect(/^\d{44}$/.test(chave)).toBe(true);
  });

  it("a própria chave gerada passa na validação", () => {
    const chave = gerarChaveDeAcesso(params);
    expect(validarChaveDeAcesso(chave)).toBe(true);
  });

  it("chave com dígito trocado é inválida", () => {
    const chave = gerarChaveDeAcesso(params);
    const errada = chave.slice(0, 43) + ((Number(chave[43]) + 1) % 10);
    expect(validarChaveDeAcesso(errada)).toBe(false);
  });

  it("chave curta ou longa é inválida", () => {
    expect(validarChaveDeAcesso("1234567890")).toBe(false);
    expect(validarChaveDeAcesso("1".repeat(45))).toBe(false);
  });

  it("null, vazio ou tipo errado: false", () => {
    expect(validarChaveDeAcesso(null)).toBe(false);
    expect(validarChaveDeAcesso("")).toBe(false);
    expect(validarChaveDeAcesso(12345)).toBe(false);
  });

  it("modelo 58 (MDF-e) também funciona", () => {
    const chave = gerarChaveDeAcesso({ ...params, mod: 58 });
    expect(chave).toHaveLength(44);
    expect(validarChaveDeAcesso(chave)).toBe(true);
  });
});

describe("validação de documentos", () => {
  it("CT-e exige valor, UFs, tomador e CFOP", () => {
    const erros = validarCte({});
    expect(erros).toContain("Valor do serviço é obrigatório");
    expect(erros).toContain("UF de início é obrigatória");
    expect(erros).toContain("UF de fim é obrigatória");
    expect(erros).toContain("Tomador é obrigatório");
    expect(erros).toContain("CFOP é obrigatório");
    expect(erros).toHaveLength(5);
  });

  it("CT-e completo não tem erros", () => {
    expect(validarCte({
      valor_servico: 1000, uf_inicio: "SP", uf_fim: "RJ",
      tomador_id: "t1", cfop: "6353",
    })).toEqual([]);
  });

  it("MDF-e exige UFs, placa, CPF e referências", () => {
    const erros = validarMdfe({});
    expect(erros.length).toBe(5);
    expect(erros.some((e) => /placa/i.test(e))).toBe(true);
    expect(erros.some((e) => /CT-e/i.test(e))).toBe(true);
  });

  it("NFS-e exige valor e tomador", () => {
    expect(validarNfse({})).toHaveLength(2);
    expect(validarNfse({ valor_servico: 100, tomador_id: "t1" })).toEqual([]);
  });

  it("documento null retorna erro", () => {
    expect(validarCte(null)).toHaveLength(1);
    expect(validarMdfe(null)).toHaveLength(1);
    expect(validarNfse(null)).toHaveLength(1);
  });
});

describe("transições de status", () => {
  it("rascunho → validado: sim", () => {
    expect(transicaoValida("rascunho", "validado")).toBe(true);
  });

  it("rascunho → autorizado: não (pula etapas)", () => {
    expect(transicaoValida("rascunho", "autorizado")).toBe(false);
  });

  it("autorizado → cancelado: sim", () => {
    expect(transicaoValida("autorizado", "cancelado")).toBe(true);
  });

  it("cancelado não vai a lugar nenhum", () => {
    expect(transicaoValida("cancelado", "rascunho")).toBe(false);
    expect(transicaoValida("cancelado", "validado")).toBe(false);
  });

  it("rejeitado volta para rascunho (corrigir e reenviar)", () => {
    expect(transicaoValida("rejeitado", "rascunho")).toBe(true);
    expect(transicaoValida("rejeitado", "validado")).toBe(false);
  });

  it("inutilizado é terminal", () => {
    expect(transicaoValida("inutilizado", "rascunho")).toBe(false);
  });
});

describe("CFOP padrão para CT-e", () => {
  it("mesmo estado: 5353 (intraestadual)", () => {
    expect(cfopPadraoCte("SP", "SP")).toBe("5353");
  });

  it("estados diferentes: 6353 (interestadual)", () => {
    expect(cfopPadraoCte("SP", "RJ")).toBe("6353");
  });

  it("sem UF: vazio", () => {
    expect(cfopPadraoCte("", "SP")).toBe("");
    expect(cfopPadraoCte("SP", "")).toBe("");
  });
});

describe("transmissão desligada por ausência de certificado", () => {
  it("habilitada com certificado e senha", () => {
    expect(fiscalTransmissionEnabled({ NFE_CERT_PFX: "cert.pfx", NFE_CERT_PASSWORD: "s3cr3t" })).toBe(true);
  });

  it("desabilitada sem certificado", () => {
    expect(fiscalTransmissionEnabled({})).toBe(false);
    expect(fiscalTransmissionEnabled({ NFE_CERT_PFX: "cert.pfx" })).toBe(false);
    expect(fiscalTransmissionEnabled(null)).toBe(false);
  });
});

describe("XML do CT-e (layout 4.00)", () => {
  const xml = construirXmlCte({
    chaveAcesso: gerarChaveDeAcesso({
      cuf: 35, aamm: "2601", cnpj: "12345678000199",
      mod: 57, serie: 1, numero: 42, tpEmis: 1, codigo: "00000042",
    }),
    emitente: {
      cnpj: "12.345.678/0001-99",
      inscricaoEstadual: "123456789",
      razaoSocial: "To Do Green Transportes",
      nomeFantasia: "To Do Green",
      logradouro: "Rua Teste", numero: "100", bairro: "Centro",
      codigoMunicipio: "3550308", municipio: "São Paulo", uf: "SP", cep: "01001-000",
    },
    remetente: { cnpj: "11222333000144", nome: "Remetente LTDA" },
    destinatario: { cnpj: "55666777000188", nome: "Destinatário S/A" },
    ide: {
      cfop: "6353", serie: 1, numero: 42, dataEmissao: "2026-01-15T10:00:00-03:00",
      ufEmissao: "SP", codigoMunicipioEmissao: "3550308", municipioEmissao: "São Paulo",
      ufInicio: "SP", codigoMunicipioInicio: "3550308", municipioInicio: "São Paulo",
      ufFim: "RJ", codigoMunicipioFim: "3304557", municipioFim: "Rio de Janeiro",
      codigo: "00000042",
    },
    valores: { total: 5000 },
    impostos: {
      icms: { icmsBase: 5000, icmsAliquota: 12, icmsValor: 600, cstIcms: "00" },
      pisCofins: { pisValor: 32.5, cofinsValor: 150 },
    },
    referencias: [{ chave: "3".repeat(44) }],
    veiculo: { rntrc: "12345678" },
  });

  it("contém o namespace e versão corretos", () => {
    expect(xml).toContain('xmlns="http://www.portalfiscal.inf.br/cte"');
    expect(xml).toContain('versao="4.00"');
  });

  it("contém o modelo 57 (CT-e)", () => {
    expect(xml).toContain("<mod>57</mod>");
  });

  it("contém os dados do emitente com escape XML", () => {
    expect(xml).toContain("<xNome>To Do Green Transportes</xNome>");
    expect(xml).toContain("<xFant>To Do Green</xFant>");
    expect(xml).toContain("São Paulo");
  });

  it("contém ICMS com CST 00", () => {
    expect(xml).toContain("<ICMS00>");
    expect(xml).toContain("<CST>00</CST>");
    expect(xml).toContain("<vBC>5000.00</vBC>");
    expect(xml).toContain("<vICMS>600.00</vICMS>");
  });

  it("referencia a NF-e transportada", () => {
    expect(xml).toContain("<infNFe>");
    expect(xml).toContain("3".repeat(44));
  });

  it("contém RNTRC no modal rodoviário", () => {
    expect(xml).toContain("<RNTRC>12345678</RNTRC>");
  });
});

describe("XML do MDF-e (layout 3.00)", () => {
  const xml = construirXmlMdfe({
    chaveAcesso: gerarChaveDeAcesso({
      cuf: 35, aamm: "2601", cnpj: "12345678000199",
      mod: 58, serie: 1, numero: 1, tpEmis: 1, codigo: "00000001",
    }),
    emitente: {
      cnpj: "12345678000199", inscricaoEstadual: "123456789",
      razaoSocial: "To Do Green", logradouro: "Rua X", numero: "1",
      bairro: "Centro", codigoMunicipio: "3550308", municipio: "São Paulo",
      uf: "SP", cep: "01001000",
    },
    ide: {
      serie: 1, numero: 1, dataEmissao: "2026-01-15T10:00:00-03:00",
      ufEmissao: "SP", ufInicio: "SP", ufFim: "RJ", codigo: "00000001",
    },
    veiculo: { rntrc: "12345678", placa: "ABC1D23", uf: "SP" },
    motorista: { nome: "João Silva", cpf: "12345678900" },
    ctes: [{ chave: "5".repeat(44) }, { chave: "6".repeat(44) }],
    totais: { valorCarga: 50_000, pesoCarga: 12_500 },
  });

  it("contém namespace e modelo 58", () => {
    expect(xml).toContain('xmlns="http://www.portalfiscal.inf.br/mdfe"');
    expect(xml).toContain("<mod>58</mod>");
  });

  it("referencia os dois CT-es", () => {
    expect(xml).toContain("5".repeat(44));
    expect(xml).toContain("6".repeat(44));
    expect(xml).toContain("<qCTe>2</qCTe>");
  });

  it("contém veículo e motorista", () => {
    expect(xml).toContain("<placa>ABC1D23</placa>");
    expect(xml).toContain("<CPF>12345678900</CPF>");
    expect(xml).toContain("João Silva");
  });

  it("contém totais de carga", () => {
    expect(xml).toContain("<vCarga>50000.00</vCarga>");
    expect(xml).toContain("<qCarga>12500.0000</qCarga>");
  });
});

describe("escapar XML", () => {
  it("escapa os cinco caracteres especiais", () => {
    expect(escaparXml('A & B < C > D "E" \'F\'')).toBe(
      "A &amp; B &lt; C &gt; D &quot;E&quot; &apos;F&apos;",
    );
  });

  it("null e undefined viram string vazia", () => {
    expect(escaparXml(null)).toBe("");
    expect(escaparXml(undefined)).toBe("");
  });
});

describe("resumo fiscal", () => {
  it("agrupa por tipo e status", () => {
    const docs = [
      { doc_type: "cte", status: "autorizado", icms_valor: 100, valor_total: 1000 },
      { doc_type: "cte", status: "rascunho", icms_valor: 50, valor_total: 500 },
      { doc_type: "nfse", status: "autorizado", icms_valor: 0, valor_total: 2000 },
    ];
    const r = resumoFiscal(docs);
    expect(r.total).toBe(3);
    expect(r.porTipo.cte).toBe(2);
    expect(r.porTipo.nfse).toBe(1);
    expect(r.porStatus.autorizado).toBe(2);
    expect(r.icmsTotal).toBe(150);
    expect(r.valorTotal).toBe(3500);
  });

  it("lista vazia: tudo zero", () => {
    expect(resumoFiscal([]).total).toBe(0);
    expect(resumoFiscal(null).total).toBe(0);
  });
});

describe("dados do DACTE", () => {
  it("extrai os campos necessários para renderização", () => {
    const d = dadosDacte(
      { serie: 1, numero: 42, chave_acesso: "1".repeat(44), data_emissao: "2026-01-15",
        uf_inicio: "SP", municipio_inicio: "São Paulo", uf_fim: "RJ", municipio_fim: "Rio",
        valor_servico: 5000, valor_total: 5000, cfop: "6353", modal: "rodoviario",
        placa: "ABC1D23", motorista_nome: "João" },
      { razaoSocial: "TDG", cnpj: "12345678000199", inscricaoEstadual: "123", logradouro: "Rua X",
        numero: "1", municipio: "SP", uf: "SP" },
      { nome: "Remetente", cnpj: "111" },
      { nome: "Destinatário", cnpj: "222" },
      { icms: { icmsBase: 5000, icmsAliquota: 12, icmsValor: 600 }, pisCofins: { pisValor: 32.5, cofinsValor: 150 } },
    );
    expect(d.tipo).toBe("DACTE");
    expect(d.numero).toBe(42);
    expect(d.rota.ufInicio).toBe("SP");
    expect(d.impostos.icmsValor).toBe(600);
    expect(d.emitente.razaoSocial).toBe("TDG");
  });
});

describe("constantes", () => {
  it("CODIGO_UF cobre os 27 estados", () => {
    expect(Object.keys(CODIGO_UF)).toHaveLength(27);
    expect(CODIGO_UF.SP).toBe(35);
    expect(CODIGO_UF.DF).toBe(53);
  });

  it("tipos de documento fiscal", () => {
    expect(TIPOS_DOCUMENTO_FISCAL.CTE).toBe("cte");
    expect(TIPOS_DOCUMENTO_FISCAL.MDFE).toBe("mdfe");
    expect(TIPOS_DOCUMENTO_FISCAL.NFSE).toBe("nfse");
  });

  it("arredondamento monetário: duas casas", () => {
    expect(arredondarMoeda(10.005)).toBe(10.01);
    expect(arredondarMoeda(10.004)).toBe(10);
    expect(arredondarMoeda(0.1 + 0.2)).toBe(0.3);
  });
});
