// Motor fiscal para transportadora: CT-e, MDF-e e NFS-e.
// Puro, sem efeitos colaterais, todo resultado reproduzível.
// Transmissão à SEFAZ desligada por ausência de certificado digital.

// ─── Constantes ──────────────────────────────────────────────

export const TIPOS_DOCUMENTO_FISCAL = Object.freeze({
  CTE: "cte",
  MDFE: "mdfe",
  NFSE: "nfse",
});

export const STATUS_FISCAL = Object.freeze({
  RASCUNHO: "rascunho",
  VALIDADO: "validado",
  ASSINADO: "assinado",
  TRANSMITIDO: "transmitido",
  AUTORIZADO: "autorizado",
  REJEITADO: "rejeitado",
  CANCELADO: "cancelado",
  INUTILIZADO: "inutilizado",
});

const TRANSICOES = Object.freeze({
  rascunho: ["validado", "cancelado"],
  validado: ["rascunho", "assinado", "cancelado"],
  assinado: ["transmitido", "cancelado"],
  transmitido: ["autorizado", "rejeitado"],
  autorizado: ["cancelado"],
  rejeitado: ["rascunho"],
  cancelado: [],
  inutilizado: [],
});

export const CODIGO_UF = Object.freeze({
  AC: 12, AL: 27, AP: 16, AM: 13, BA: 29, CE: 23, DF: 53, ES: 32,
  GO: 52, MA: 21, MT: 51, MS: 50, MG: 31, PA: 15, PB: 25, PR: 41,
  PE: 26, PI: 22, RJ: 33, RN: 24, RS: 43, RO: 11, RR: 14, SC: 42,
  SP: 35, SE: 28, TO: 17,
});

// ─── Utilitários ─────────────────────────────────────────────

function roundMoney(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
export { roundMoney as arredondarMoeda };

export const escaparXml = (valor) =>
  String(valor ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c],
  );

function soNumeros(v) {
  return String(v ?? "").replace(/\D/g, "");
}

// ─── ICMS interestadual ─────────────────────────────────────
// Resolução do Senado Federal 22/1989

const SUL_SUDESTE = new Set(["SP", "RJ", "MG", "PR", "SC", "RS"]);

export function aliquotaIcmsInterestadual(ufOrigem, ufDestino) {
  if (!ufOrigem || !ufDestino) return null;
  const o = ufOrigem.toUpperCase();
  const d = ufDestino.toUpperCase();
  if (o === d) return null;
  if (SUL_SUDESTE.has(o) && !SUL_SUDESTE.has(d)) return 7;
  return 12;
}

// ─── Simples Nacional ────────────────────────────────────────
// LC 123/2006, Anexo III (transporte) e Anexo V (serviços)

export const SIMPLES_TRANSPORTE = Object.freeze([
  { ate: 180_000, aliquota: 6.0, deducao: 0 },
  { ate: 360_000, aliquota: 11.2, deducao: 9_360 },
  { ate: 720_000, aliquota: 13.5, deducao: 17_640 },
  { ate: 1_800_000, aliquota: 16.0, deducao: 35_640 },
  { ate: 3_600_000, aliquota: 21.0, deducao: 125_640 },
  { ate: 4_800_000, aliquota: 33.0, deducao: 648_000 },
]);

export const SIMPLES_SERVICOS = Object.freeze([
  { ate: 180_000, aliquota: 15.5, deducao: 0 },
  { ate: 360_000, aliquota: 18.0, deducao: 4_500 },
  { ate: 720_000, aliquota: 19.5, deducao: 9_900 },
  { ate: 1_800_000, aliquota: 20.5, deducao: 17_100 },
  { ate: 3_600_000, aliquota: 23.0, deducao: 62_100 },
  { ate: 4_800_000, aliquota: 30.5, deducao: 540_000 },
]);

export function calcularSimplesNacional(valorServico, faturamento12m, anexo = "transporte") {
  if (!valorServico || valorServico <= 0 || !faturamento12m || faturamento12m <= 0) return null;
  const tabela = anexo === "transporte" ? SIMPLES_TRANSPORTE : SIMPLES_SERVICOS;
  const faixa = tabela.find((f) => faturamento12m <= f.ate);
  if (!faixa) return null;
  const efetiva = (faturamento12m * faixa.aliquota / 100 - faixa.deducao) / faturamento12m;
  return {
    faixa: tabela.indexOf(faixa) + 1,
    aliquotaNominal: faixa.aliquota,
    aliquotaEfetiva: Math.round(efetiva * 10000) / 100,
    valor: roundMoney(valorServico * efetiva),
  };
}

// ─── PIS e COFINS ────────────────────────────────────────────

export const PIS_COFINS = Object.freeze({
  cumulativo: { pis: 0.65, cofins: 3.0 },
  nao_cumulativo: { pis: 1.65, cofins: 7.6 },
});

export function calcularPisCofins(valor, regime) {
  if (!valor || valor <= 0) return { pisAliquota: 0, pisValor: 0, cofinsAliquota: 0, cofinsValor: 0 };
  if (regime === "simples") return { pisAliquota: 0, pisValor: 0, cofinsAliquota: 0, cofinsValor: 0 };
  const t = regime === "lucro_real" ? PIS_COFINS.nao_cumulativo : PIS_COFINS.cumulativo;
  return {
    pisAliquota: t.pis,
    pisValor: roundMoney(valor * t.pis / 100),
    cofinsAliquota: t.cofins,
    cofinsValor: roundMoney(valor * t.cofins / 100),
  };
}

// ─── ISS ─────────────────────────────────────────────────────

export function calcularIss(valor, aliquotaMunicipal) {
  if (!valor || valor <= 0 || !aliquotaMunicipal) return { issAliquota: 0, issValor: 0 };
  return {
    issAliquota: aliquotaMunicipal,
    issValor: roundMoney(valor * aliquotaMunicipal / 100),
  };
}

// ─── ICMS no CT-e ────────────────────────────────────────────

export function calcularIcmsCte(valorServico, opts = {}) {
  const { ufOrigem, ufDestino, regimeEmitente, aliquotaInterna, cstIcms = "00" } = opts;
  const zero = { icmsBase: 0, icmsAliquota: 0, icmsValor: 0, cstIcms };
  if (!valorServico || valorServico <= 0) return zero;

  if (regimeEmitente === "simples") {
    return { ...zero, cstIcms: "90", simplesNacional: true };
  }

  if (["40", "41", "51"].includes(cstIcms)) return { ...zero, cstIcms };

  let aliquota;
  if (!ufOrigem || !ufDestino || ufOrigem.toUpperCase() === ufDestino.toUpperCase()) {
    aliquota = aliquotaInterna || 18;
  } else {
    aliquota = aliquotaIcmsInterestadual(ufOrigem, ufDestino);
  }

  let base = valorServico;
  if (cstIcms === "20") base = roundMoney(valorServico * 0.8);

  return {
    icmsBase: base,
    icmsAliquota: aliquota,
    icmsValor: roundMoney(base * aliquota / 100),
    cstIcms,
  };
}

// ─── Cálculo completo para CT-e ─────────────────────────────

export function calcularImpostosCte(params) {
  const {
    valorServico, ufOrigem, ufDestino, regimeEmitente,
    faturamento12m, aliquotaInterna, cstIcms,
  } = params;

  const icms = calcularIcmsCte(valorServico, {
    ufOrigem, ufDestino, regimeEmitente, aliquotaInterna, cstIcms,
  });
  const pisCofins = calcularPisCofins(valorServico, regimeEmitente);
  const simples = regimeEmitente === "simples" && faturamento12m > 0
    ? calcularSimplesNacional(valorServico, faturamento12m, "transporte")
    : null;

  return { icms, pisCofins, simples, valorServico };
}

// ─── Cálculo completo para NFS-e ────────────────────────────

export function calcularImpostosNfse(params) {
  const { valorServico, regimeEmitente, faturamento12m, aliquotaIss } = params;

  const iss = regimeEmitente === "simples"
    ? { issAliquota: 0, issValor: 0 }
    : calcularIss(valorServico, aliquotaIss);
  const pisCofins = calcularPisCofins(valorServico, regimeEmitente);
  const simples = regimeEmitente === "simples" && faturamento12m > 0
    ? calcularSimplesNacional(valorServico, faturamento12m, "servicos")
    : null;

  return { iss, pisCofins, simples, valorServico };
}

// ─── Retenções ───────────────────────────────────────────────

export const RETENCOES = Object.freeze({
  irrf: { aliquota: 1.5, minimo: 10 },
  csll: { aliquota: 1.0, minimo: 10 },
  inss: { aliquota: 11.0, minimo: 10 },
  pisCofinsCsll: { pis: 0.65, cofins: 3.0, csll: 1.0, minimo: 10 },
});

export function calcularRetencoes(valorServico, flags = {}) {
  const r = {};
  if (!valorServico || valorServico <= 0) return r;
  if (flags.retIrrf) {
    const v = roundMoney(valorServico * RETENCOES.irrf.aliquota / 100);
    r.irrf = v >= RETENCOES.irrf.minimo ? v : 0;
  }
  if (flags.retCsll) {
    const v = roundMoney(valorServico * RETENCOES.csll.aliquota / 100);
    r.csll = v >= RETENCOES.csll.minimo ? v : 0;
  }
  if (flags.retInss) {
    const v = roundMoney(valorServico * RETENCOES.inss.aliquota / 100);
    r.inss = v >= RETENCOES.inss.minimo ? v : 0;
  }
  if (flags.retPisCofins) {
    const { pis, cofins, csll } = RETENCOES.pisCofinsCsll;
    const v = roundMoney(valorServico * (pis + cofins + csll) / 100);
    r.pisCofinsCsll = v >= RETENCOES.pisCofinsCsll.minimo ? v : 0;
  }
  return r;
}

// ─── Chave de acesso (44 dígitos) ───────────────────────────

function digitoVerificadorMod11(corpo) {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  for (let i = corpo.length - 1, p = 0; i >= 0; i--, p++) {
    soma += Number(corpo[i]) * pesos[p % pesos.length];
  }
  const resto = soma % 11;
  return resto < 2 ? "0" : String(11 - resto);
}

export function gerarChaveDeAcesso({ cuf, aamm, cnpj, mod, serie, numero, tpEmis = 1, codigo }) {
  const partes = [
    String(cuf).padStart(2, "0"),
    String(aamm).padStart(4, "0"),
    soNumeros(cnpj).padStart(14, "0"),
    String(mod).padStart(2, "0"),
    String(serie).padStart(3, "0"),
    String(numero).padStart(9, "0"),
    String(tpEmis),
    String(codigo).padStart(8, "0"),
  ];
  const semDv = partes.join("");
  if (semDv.length !== 43) return null;
  return semDv + digitoVerificadorMod11(semDv);
}

export function validarChaveDeAcesso(chave) {
  if (!chave || typeof chave !== "string") return false;
  const limpa = soNumeros(chave);
  if (limpa.length !== 44) return false;
  return digitoVerificadorMod11(limpa.slice(0, 43)) === limpa[43];
}

// ─── Validação de documentos ─────────────────────────────────

export function validarCte(doc) {
  const erros = [];
  if (!doc) return ["Documento não informado"];
  if (!(doc.valor_servico || doc.valorServico)) erros.push("Valor do serviço é obrigatório");
  if (!(doc.uf_inicio || doc.ufInicio)) erros.push("UF de início é obrigatória");
  if (!(doc.uf_fim || doc.ufFim)) erros.push("UF de fim é obrigatória");
  if (!(doc.tomador_id || doc.tomadorId)) erros.push("Tomador é obrigatório");
  if (!doc.cfop) erros.push("CFOP é obrigatório");
  return erros;
}

export function validarMdfe(doc) {
  const erros = [];
  if (!doc) return ["Documento não informado"];
  if (!(doc.uf_inicio || doc.ufInicio)) erros.push("UF de carregamento é obrigatória");
  if (!(doc.uf_fim || doc.ufFim)) erros.push("UF de descarregamento é obrigatória");
  if (!doc.placa) erros.push("Placa do veículo é obrigatória");
  if (!(doc.motorista_cpf || doc.motoristaCpf)) erros.push("CPF do motorista é obrigatório");
  const refs = doc.referencias || doc.refs || [];
  if (!refs.length) erros.push("MDF-e deve referenciar ao menos um CT-e");
  return erros;
}

export function validarNfse(doc) {
  const erros = [];
  if (!doc) return ["Documento não informado"];
  if (!(doc.valor_servico || doc.valorServico)) erros.push("Valor do serviço é obrigatório");
  if (!(doc.tomador_id || doc.tomadorId)) erros.push("Tomador é obrigatório");
  return erros;
}

// ─── Ciclo de vida ───────────────────────────────────────────

export function transicaoValida(statusAtual, statusNovo) {
  return (TRANSICOES[statusAtual] || []).includes(statusNovo);
}

// ─── CFOP padrão para CT-e ──────────────────────────────────

export function cfopPadraoCte(ufOrigem, ufDestino) {
  if (!ufOrigem || !ufDestino) return "";
  return ufOrigem.toUpperCase() === ufDestino.toUpperCase() ? "5353" : "6353";
}

// ─── Transmissão ─────────────────────────────────────────────

export function fiscalTransmissionEnabled(env) {
  return !!(env && env.NFE_CERT_PFX && env.NFE_CERT_PASSWORD);
}

// ─── XML CT-e (layout 4.00, modelo 57) ──────────────────────

function tagSe(nome, valor) {
  if (valor === undefined || valor === null || valor === "") return "";
  return `<${nome}>${escaparXml(valor)}</${nome}>`;
}

function tagEndereco(prefix, end) {
  if (!end) return "";
  return [
    `<${prefix}>`,
    tagSe("xLgr", end.logradouro),
    tagSe("nro", end.numero || "S/N"),
    tagSe("xCpl", end.complemento),
    tagSe("xBairro", end.bairro),
    tagSe("cMun", end.codigoMunicipio),
    tagSe("xMun", end.municipio),
    tagSe("CEP", soNumeros(end.cep)),
    tagSe("UF", end.uf),
    `</${prefix}>`,
  ].filter(Boolean).join("");
}

export function construirXmlCte({
  chaveAcesso, emitente, remetente, destinatario,
  ide = {}, valores = {}, impostos = {}, referencias = [],
  veiculo = {}, motorista = {},
}) {
  const e = escaparXml;
  const cuf = CODIGO_UF[ide.ufEmissao?.toUpperCase()] || "";
  const mod = "57";

  const xmlIde = [
    "<ide>",
    tagSe("cUF", cuf),
    tagSe("cCT", ide.codigo),
    tagSe("CFOP", ide.cfop),
    tagSe("natOp", ide.naturezaOperacao || "PRESTACAO DE SERVICO DE TRANSPORTE"),
    `<mod>${mod}</mod>`,
    tagSe("serie", ide.serie),
    tagSe("nCT", ide.numero),
    tagSe("dhEmi", ide.dataEmissao),
    "<tpImp>1</tpImp>",
    "<tpEmis>1</tpEmis>",
    tagSe("cDV", chaveAcesso ? chaveAcesso[43] : ""),
    `<tpAmb>${ide.ambiente || 2}</tpAmb>`,
    "<tpCTe>0</tpCTe>",
    "<procEmi>0</procEmi>",
    "<verProc>SeuFuncionario 1.0</verProc>",
    tagSe("cMunEnv", ide.codigoMunicipioEmissao),
    tagSe("xMunEnv", ide.municipioEmissao),
    tagSe("UFEnv", ide.ufEmissao),
    "<modal>01</modal>",
    `<tpServ>${ide.tipoServico || 0}</tpServ>`,
    tagSe("cMunIni", ide.codigoMunicipioInicio),
    tagSe("xMunIni", ide.municipioInicio),
    tagSe("UFIni", ide.ufInicio),
    tagSe("cMunFim", ide.codigoMunicipioFim),
    tagSe("xMunFim", ide.municipioFim),
    tagSe("UFFim", ide.ufFim),
    "</ide>",
  ].filter(Boolean).join("");

  const xmlEmit = [
    "<emit>",
    tagSe("CNPJ", soNumeros(emitente?.cnpj)),
    tagSe("IE", soNumeros(emitente?.inscricaoEstadual)),
    tagSe("xNome", emitente?.razaoSocial),
    tagSe("xFant", emitente?.nomeFantasia),
    tagEndereco("enderEmit", emitente),
    "</emit>",
  ].join("");

  const xmlRem = remetente ? [
    "<rem>",
    tagSe("CNPJ", soNumeros(remetente.cnpj)),
    tagSe("xNome", remetente.nome),
    tagEndereco("enderReme", remetente),
    "</rem>",
  ].join("") : "";

  const xmlDest = destinatario ? [
    "<dest>",
    tagSe("CNPJ", soNumeros(destinatario.cnpj)),
    tagSe("xNome", destinatario.nome),
    tagEndereco("enderDest", destinatario),
    "</dest>",
  ].join("") : "";

  const vTotal = valores.total ?? 0;
  const xmlVPrest = `<vPrest>${tagSe("vTPrest", vTotal.toFixed(2))}${tagSe("vRec", vTotal.toFixed(2))}</vPrest>`;

  const icms = impostos.icms || {};
  const cst = icms.cstIcms || "00";
  let xmlIcmsInner;
  if (cst === "00") {
    xmlIcmsInner = `<ICMS00><CST>${e(cst)}</CST>${tagSe("vBC", (icms.icmsBase || 0).toFixed(2))}${tagSe("pICMS", (icms.icmsAliquota || 0).toFixed(2))}${tagSe("vICMS", (icms.icmsValor || 0).toFixed(2))}</ICMS00>`;
  } else if (cst === "20") {
    xmlIcmsInner = `<ICMS20><CST>${e(cst)}</CST><pRedBC>20.00</pRedBC>${tagSe("vBC", (icms.icmsBase || 0).toFixed(2))}${tagSe("pICMS", (icms.icmsAliquota || 0).toFixed(2))}${tagSe("vICMS", (icms.icmsValor || 0).toFixed(2))}</ICMS20>`;
  } else if (["40", "41", "51"].includes(cst)) {
    xmlIcmsInner = `<ICMS45><CST>${e(cst)}</CST></ICMS45>`;
  } else if (cst === "90" && icms.simplesNacional) {
    xmlIcmsInner = `<ICMSOutraUF><CST>90</CST><pRedBCOutraUF>0.00</pRedBCOutraUF><vBCOutraUF>0.00</vBCOutraUF><pICMSOutraUF>0.00</pICMSOutraUF><vICMSOutraUF>0.00</vICMSOutraUF></ICMSOutraUF>`;
  } else {
    xmlIcmsInner = `<ICMS90><CST>${e(cst)}</CST>${tagSe("vBC", (icms.icmsBase || 0).toFixed(2))}${tagSe("pICMS", (icms.icmsAliquota || 0).toFixed(2))}${tagSe("vICMS", (icms.icmsValor || 0).toFixed(2))}</ICMS90>`;
  }

  const pc = impostos.pisCofins || {};
  const xmlImp = [
    "<imp>",
    `<ICMS>${xmlIcmsInner}</ICMS>`,
    `<vTotTrib>${((icms.icmsValor || 0) + (pc.pisValor || 0) + (pc.cofinsValor || 0)).toFixed(2)}</vTotTrib>`,
    "</imp>",
  ].join("");

  const xmlRefs = referencias.length
    ? `<infDoc>${referencias.map((r) => r.tipo === "cte" ? `<infCTe>${tagSe("chCTe", r.chave)}</infCTe>` : `<infNFe>${tagSe("chave", r.chave)}</infNFe>`).join("")}</infDoc>`
    : "";

  const xmlModal = [
    '<infModal versaoModal="4.00">',
    "<rodo>",
    tagSe("RNTRC", veiculo.rntrc),
    "</rodo>",
    "</infModal>",
  ].join("");

  const xmlNorm = `<infCTeNorm>${xmlRefs}${xmlModal}</infCTeNorm>`;

  const id = chaveAcesso ? `CTe${chaveAcesso}` : "";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CTe xmlns="http://www.portalfiscal.inf.br/cte">',
    `<infCte versao="4.00"${id ? ` Id="${e(id)}"` : ""}>`,
    xmlIde, xmlEmit, xmlRem, xmlDest, xmlVPrest, xmlImp, xmlNorm,
    "</infCte>",
    "</CTe>",
  ].join("");
}

// ─── XML MDF-e (layout 3.00, modelo 58) ─────────────────────

export function construirXmlMdfe({
  chaveAcesso, emitente, ide = {},
  veiculo = {}, motorista = {}, ctes = [], totais = {},
}) {
  const cuf = CODIGO_UF[ide.ufEmissao?.toUpperCase()] || "";

  const xmlIde = [
    "<ide>",
    tagSe("cUF", cuf),
    `<tpAmb>${ide.ambiente || 2}</tpAmb>`,
    "<tpEmit>1</tpEmit>",
    "<mod>58</mod>",
    tagSe("serie", ide.serie),
    tagSe("nMDF", ide.numero),
    tagSe("cMDF", ide.codigo),
    tagSe("cDV", chaveAcesso ? chaveAcesso[43] : ""),
    tagSe("dhEmi", ide.dataEmissao),
    "<tpEmis>1</tpEmis>",
    "<procEmi>0</procEmi>",
    "<verProc>SeuFuncionario 1.0</verProc>",
    tagSe("UFIni", ide.ufInicio),
    tagSe("UFFim", ide.ufFim),
    ide.codigoMunicipioCarrega
      ? `<infMunCarrega>${tagSe("cMunCarrega", ide.codigoMunicipioCarrega)}${tagSe("xMunCarrega", ide.municipioCarrega)}</infMunCarrega>`
      : "",
    "</ide>",
  ].filter(Boolean).join("");

  const xmlEmit = [
    "<emit>",
    tagSe("CNPJ", soNumeros(emitente?.cnpj)),
    tagSe("IE", soNumeros(emitente?.inscricaoEstadual)),
    tagSe("xNome", emitente?.razaoSocial),
    tagEndereco("enderEmit", emitente),
    "</emit>",
  ].join("");

  const xmlModal = [
    '<infModal versaoModal="3.00">',
    "<rodo>",
    `<infANTT>${tagSe("RNTRC", veiculo.rntrc)}</infANTT>`,
    "<veicTracao>",
    tagSe("placa", veiculo.placa),
    tagSe("UF", veiculo.uf),
    motorista.cpf
      ? `<condutor>${tagSe("xNome", motorista.nome)}${tagSe("CPF", soNumeros(motorista.cpf))}</condutor>`
      : "",
    "</veicTracao>",
    "</rodo>",
    "</infModal>",
  ].filter(Boolean).join("");

  const xmlDoc = ctes.length
    ? `<infDoc>${ctes.map((c) => `<infCTe>${tagSe("chCTe", c.chave)}${tagSe("SegCodBarra", "")}</infCTe>`).join("")}</infDoc>`
    : "";

  const xmlTot = [
    "<tot>",
    tagSe("qCTe", ctes.length),
    tagSe("vCarga", (totais.valorCarga || 0).toFixed(2)),
    "<cUnid>01</cUnid>",
    tagSe("qCarga", (totais.pesoCarga || 0).toFixed(4)),
    "</tot>",
  ].join("");

  const id = chaveAcesso ? `MDFe${chaveAcesso}` : "";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MDFe xmlns="http://www.portalfiscal.inf.br/mdfe">',
    `<infMDFe versao="3.00"${id ? ` Id="${escaparXml(id)}"` : ""}>`,
    xmlIde, xmlEmit, xmlModal, xmlDoc, xmlTot,
    "</infMDFe>",
    "</MDFe>",
  ].join("");
}

// ─── Resumo fiscal para exibição ─────────────────────────────

export function resumoFiscal(documentos) {
  if (!documentos || !documentos.length) {
    return { total: 0, porTipo: {}, porStatus: {}, icmsTotal: 0, valorTotal: 0 };
  }

  const porTipo = {};
  const porStatus = {};
  let icmsTotal = 0;
  let valorTotal = 0;

  for (const d of documentos) {
    porTipo[d.doc_type] = (porTipo[d.doc_type] || 0) + 1;
    porStatus[d.status] = (porStatus[d.status] || 0) + 1;
    icmsTotal += d.icms_valor || 0;
    valorTotal += d.valor_total || 0;
  }

  return {
    total: documentos.length,
    porTipo,
    porStatus,
    icmsTotal: roundMoney(icmsTotal),
    valorTotal: roundMoney(valorTotal),
  };
}

// ─── DACTE (dados para renderização) ─────────────────────────

export function dadosDacte(doc, emitente, remetente, destinatario, impostos) {
  return {
    tipo: "DACTE",
    modelo: "57",
    serie: doc.serie,
    numero: doc.numero,
    chaveAcesso: doc.chave_acesso || doc.chaveAcesso,
    dataEmissao: doc.data_emissao || doc.dataEmissao,
    emitente: {
      razaoSocial: emitente?.razaoSocial || emitente?.razao_social,
      cnpj: emitente?.cnpj,
      ie: emitente?.inscricaoEstadual || emitente?.inscricao_estadual,
      endereco: [emitente?.logradouro, emitente?.numero, emitente?.municipio, emitente?.uf]
        .filter(Boolean).join(", "),
    },
    remetente: { nome: remetente?.nome, cnpj: remetente?.cnpj },
    destinatario: { nome: destinatario?.nome, cnpj: destinatario?.cnpj },
    rota: {
      ufInicio: doc.uf_inicio || doc.ufInicio,
      municipioInicio: doc.municipio_inicio || doc.municipioInicio,
      ufFim: doc.uf_fim || doc.ufFim,
      municipioFim: doc.municipio_fim || doc.municipioFim,
    },
    valores: {
      servico: doc.valor_servico || doc.valorServico || 0,
      frete: doc.valor_frete || doc.valorFrete || 0,
      seguro: doc.valor_seguro || doc.valorSeguro || 0,
      pedagio: doc.valor_pedagio || doc.valorPedagio || 0,
      total: doc.valor_total || doc.valorTotal || 0,
    },
    impostos: {
      icmsBase: impostos?.icms?.icmsBase || 0,
      icmsAliquota: impostos?.icms?.icmsAliquota || 0,
      icmsValor: impostos?.icms?.icmsValor || 0,
      pisValor: impostos?.pisCofins?.pisValor || 0,
      cofinsValor: impostos?.pisCofins?.cofinsValor || 0,
    },
    cfop: doc.cfop,
    modal: doc.modal || "rodoviario",
    placa: doc.placa,
    motorista: doc.motorista_nome || doc.motoristaNome,
  };
}
