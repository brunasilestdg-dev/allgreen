import { describe, expect, it } from "vitest";
import {
  ANP_PRODUTOS,
  agregarPrecosAnp,
  niveisAnpParaResolver,
  parseAnpPrecosCsv,
  resolveDieselPrice,
  semanaDeColeta,
} from "./anpDieselPriceDomain.js";

const CABECALHO = "Regiao - Sigla;Estado - Sigla;Municipio;Revenda;CNPJ da Revenda;Nome da Rua;Numero Rua;Complemento;Bairro;Cep;Produto;Data da Coleta;Valor de Venda;Valor de Compra;Unidade de Medida;Bandeira";
const linha = (regiao, uf, mun, produto, data, valor) => `${regiao};${uf};${mun};POSTO X; 08.220.930/0001-62;RUA;1;;BAIRRO;69915-630;${produto};${data};${valor};;R$ / litro;VIBRA`;
const CSV = [
  `\uFEFF${CABECALHO}`,
  linha("SE", "SP", "SAO PAULO", "DIESEL S10", "12/08/2026", "6,19"),
  linha("SE", "SP", "SAO PAULO", "DIESEL S10", "12/08/2026", "6,39"),
  linha("SE", "SP", "SAO PAULO", "DIESEL S10", "13/08/2026", "6,29"),
  linha("SE", "SP", "CAMPINAS", "DIESEL S10", "12/08/2026", "6,09"),
  linha("SE", "SP", "SAO PAULO", "DIESEL", "12/08/2026", "5,99"),
  linha("SE", "MG", "BELO HORIZONTE", "DIESEL S10", "12/08/2026", "6,49"),
  linha("N", "AC", "RIO BRANCO", "DIESEL S10", "12/08/2026", "7,99"),
  linha("SE", "SP", "SAO PAULO", "GASOLINA", "12/08/2026", "6,59"),
  linha("SE", "SP", "SAO PAULO", "DIESEL S10", "05/08/2026", "6,49"), // semana anterior
  linha("SE", "SP", "SAO PAULO", "DIESEL S10", "12/08/2026", ""),     // sem preço → ignorado
].join("\r\n");

describe("parseAnpPrecosCsv", () => {
  it("lê o layout oficial (BOM, ';', vírgula decimal, dd/mm/aaaa) e filtra os dieseis", () => {
    const r = parseAnpPrecosCsv(CSV);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(10);
    expect(r.ignorados).toBe(2); // gasolina + sem preço
    expect(r.registros).toHaveLength(8);
    expect(r.registros[0]).toEqual({ regiao: "SE", uf: "SP", municipio: "SAO PAULO", produto: "diesel_s10", coleta: "2026-08-12", valorVenda: 6.19 });
    expect(r.registros.find((x) => x.produto === "diesel")).toBeTruthy();
  });

  it("normaliza acentos/caixa do município e aceita outro conjunto de produtos", () => {
    const r = parseAnpPrecosCsv(`${CABECALHO}\n${linha("SE", "sp", "São José dos Campos", "gasolina", "01/09/2026", "6,10")}`, { produtos: ["gasolina"] });
    expect(r.registros[0]).toMatchObject({ uf: "SP", municipio: "SAO JOSE DOS CAMPOS", produto: "gasolina" });
    expect(ANP_PRODUTOS["DIESEL S10"]).toBe("diesel_s10");
  });

  it("é honesto sobre arquivo vazio, cabeçalho desconhecido e ausência dos produtos", () => {
    expect(parseAnpPrecosCsv("")).toMatchObject({ ok: false, reason: "ANP_CSV_VAZIO" });
    expect(parseAnpPrecosCsv("a;b;c\n1;2;3")).toMatchObject({ ok: false, reason: "ANP_CSV_CABECALHO_DESCONHECIDO" });
    expect(parseAnpPrecosCsv(`${CABECALHO}\n${linha("SE", "SP", "SAO PAULO", "GASOLINA", "12/08/2026", "6,59")}`)).toMatchObject({ ok: false, reason: "ANP_SEM_REGISTROS_DOS_PRODUTOS", total: 1 });
  });
});

describe("agregação por semana e nível", () => {
  it("semanaDeColeta é a segunda-feira ISO", () => {
    expect(semanaDeColeta("2026-08-12")).toBe("2026-08-10"); // quarta → segunda
    expect(semanaDeColeta("2026-08-10")).toBe("2026-08-10");
    expect(semanaDeColeta("2026-08-16")).toBe("2026-08-10"); // domingo
    expect(semanaDeColeta("x")).toBe("");
  });

  it("mediana por município/UF/região/país, sem reter posto ou CNPJ", () => {
    const ag = agregarPrecosAnp(parseAnpPrecosCsv(CSV).registros);
    const sp = ag.find((a) => a.nivel === "municipal" && a.chave === "SP/SAO PAULO" && a.produto === "diesel_s10" && a.semana === "2026-08-10");
    expect(sp).toMatchObject({ mediana: 6.29, amostras: 3, minimo: 6.19, maximo: 6.39, coletaInicio: "2026-08-12", coletaFim: "2026-08-13" });
    const spEstado = ag.find((a) => a.nivel === "estadual" && a.chave === "SP" && a.produto === "diesel_s10" && a.semana === "2026-08-10");
    expect(spEstado).toMatchObject({ amostras: 4, mediana: 6.24 });
    expect(ag.find((a) => a.nivel === "regional" && a.chave === "SE" && a.produto === "diesel_s10" && a.semana === "2026-08-10").amostras).toBe(5);
    expect(ag.find((a) => a.nivel === "nacional" && a.produto === "diesel_s10" && a.semana === "2026-08-10")).toMatchObject({ chave: "BR", amostras: 6 });
    // semana anterior preservada separadamente
    expect(ag.find((a) => a.nivel === "municipal" && a.chave === "SP/SAO PAULO" && a.semana === "2026-08-03")).toMatchObject({ mediana: 6.49, amostras: 1 });
    expect(JSON.stringify(ag)).not.toContain("POSTO X");
    expect(JSON.stringify(ag)).not.toContain("08.220.930");
  });

  it("niveisAnpParaResolver usa a semana mais recente de cada chave e alimenta a hierarquia", () => {
    const ag = agregarPrecosAnp(parseAnpPrecosCsv(CSV).registros);
    const niveis = niveisAnpParaResolver(ag, { produto: "diesel_s10", uf: "SP", municipio: "São Paulo", regiao: "SE" });
    expect(niveis.anp_municipal).toMatchObject({ price: 6.29, date: "2026-08-13", amostras: 3, semana: "2026-08-10" });
    expect(niveis.anp_state.price).toBe(6.24);
    expect(niveis.anp_region.amostras).toBe(5);
    expect(niveis.anp_national.chave).toBe("BR");
    const resolvido = resolveDieselPrice(niveis, { now: Date.parse("2026-08-20T00:00:00Z"), staleMs: 21 * 24 * 3600 * 1000 });
    expect(resolvido).toMatchObject({ resolved: true, tier: "anp_municipal", priceRs: 6.29, stale: false });
    expect(resolvido.provenance).toMatchObject({ measurementType: "EXTERNAL", provider: "ANP", capturedAt: "2026-08-13" });

    // Município fora do levantamento cai para a UF; sem UF, para o nacional.
    const semMun = niveisAnpParaResolver(ag, { uf: "SP", municipio: "Bauru" });
    expect(semMun.anp_municipal).toBeUndefined();
    expect(resolveDieselPrice(semMun).tier).toBe("anp_state");
    expect(resolveDieselPrice(niveisAnpParaResolver(ag, {})).tier).toBe("anp_national");
  });

  it("agregados velhos ficam stale na resolução (ANP é semanal)", () => {
    const ag = agregarPrecosAnp(parseAnpPrecosCsv(CSV).registros);
    const r = resolveDieselPrice(niveisAnpParaResolver(ag, { uf: "SP" }), { now: Date.parse("2026-10-01T00:00:00Z"), staleMs: 21 * 24 * 3600 * 1000 });
    expect(r.stale).toBe(true);
  });
});
