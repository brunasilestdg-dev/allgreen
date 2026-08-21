import { describe, expect, it } from "vitest";
import {
  TABELAS_2025,
  calcularAdicionalNoturno,
  calcularDecimoTerceiro,
  calcularDsr,
  calcularFerias,
  calcularFgts,
  calcularFolha,
  calcularHorasExtras,
  calcularInss,
  calcularIrrf,
  mascararCpf,
  resumoFolha,
  salarioHora,
  validarColaborador,
  validarCpf,
} from "./payrollDomain.js";

describe("INSS progressivo", () => {
  it("primeira faixa: 7,5% sobre o salário", () => {
    const r = calcularInss(1000);
    expect(r.valor).toBe(75);
    expect(r.faixa).toBe(1);
  });

  it("exatamente no topo da primeira faixa não invade a segunda", () => {
    // R$ 1.518,00 é a fronteira. Um centavo a mais mudaria a alíquota marginal.
    const r = calcularInss(1518.00);
    expect(r.valor).toBe(113.85);
    expect(r.faixa).toBe(1);
  });

  it("um centavo acima da fronteira já toca a segunda faixa", () => {
    const r = calcularInss(1518.01);
    expect(r.faixa).toBe(2);
    // 113,85 + 0,01×9% = 113,85 (arredondado)
    expect(r.valor).toBeCloseTo(113.85, 2);
  });

  it("salário no teto rende a contribuição máxima", () => {
    const r = calcularInss(8157.41);
    expect(r.valor).toBe(951.63);
    expect(r.faixa).toBe(4);
  });

  it("acima do teto não passa da contribuição máxima e marca teto", () => {
    const r = calcularInss(20000);
    expect(r.valor).toBe(951.63);
    expect(r.teto).toBe(true);
    expect(r.base).toBe(8157.41);
  });

  it("salário no meio da terceira faixa soma as faixas anteriores", () => {
    // 1518×7,5% + (2793,88−1518)×9% + (3500−2793,88)×12%
    const r = calcularInss(3500);
    const esperado = 1518 * 0.075 + (2793.88 - 1518) * 0.09 + (3500 - 2793.88) * 0.12;
    expect(r.valor).toBeCloseTo(Math.round(esperado * 100) / 100, 2);
    expect(r.faixa).toBe(3);
  });

  it("base zero ou negativa não gera contribuição", () => {
    expect(calcularInss(0).valor).toBe(0);
    expect(calcularInss(-100).valor).toBe(0);
  });
});

describe("IRRF com dedução por faixa", () => {
  it("salário na faixa de isenção não retém", () => {
    const r = calcularIrrf(2000, { inss: 150, dependentes: 0, simplificado: false });
    expect(r.valor).toBe(0);
    expect(r.faixa).toBe(1);
  });

  it("aplica alíquota menos a parcela a deduzir", () => {
    // base 3000 → faixa 15%, dedução 394,16 → 3000×15% − 394,16
    const r = calcularIrrf(3000, { inss: 0, dependentes: 0, simplificado: false });
    expect(r.valor).toBe(Math.round((3000 * 0.15 - 394.16) * 100) / 100);
    expect(r.aliquota).toBe(15);
  });

  it("dependentes reduzem a base", () => {
    const semDependente = calcularIrrf(3500, { inss: 300, dependentes: 0, simplificado: false });
    const comDependentes = calcularIrrf(3500, { inss: 300, dependentes: 2, simplificado: false });
    expect(comDependentes.valor).toBeLessThan(semDependente.valor);
  });

  it("escolhe o desconto simplificado quando ele reduz mais a base", () => {
    // Sem INSS informado, o simplificado (607,20) supera a dedução legal.
    const r = calcularIrrf(3000, { inss: 0, dependentes: 0, simplificado: "auto" });
    expect(r.modelo).toBe("simplificado");
    expect(r.base).toBe(3000 - 607.20);
  });

  it("nunca retém valor negativo", () => {
    const r = calcularIrrf(2430, { inss: 200, dependentes: 0, simplificado: false });
    expect(r.valor).toBeGreaterThanOrEqual(0);
  });
});

describe("FGTS", () => {
  it("8% sobre a base, encargo do empregador", () => {
    const r = calcularFgts(2000);
    expect(r.valor).toBe(160);
    expect(r.aliquota).toBe(8);
  });
});

describe("salário-hora e adicionais", () => {
  it("salário-hora usa 220 horas por padrão", () => {
    expect(salarioHora(2200)).toBe(10);
  });

  it("hora extra 50% em dia útil", () => {
    const r = calcularHorasExtras(2200, 10, 50);
    // (2200/220)×1,5×10 = 150
    expect(r.valor).toBe(150);
  });

  it("hora extra 100% em domingo", () => {
    const r = calcularHorasExtras(2200, 10, 100);
    expect(r.valor).toBe(200);
  });

  it("adicional noturno de 20% sobre a hora", () => {
    const r = calcularAdicionalNoturno(2200, 10);
    // 10×20%×10 = 20
    expect(r.valor).toBe(20);
    expect(r.percentual).toBe(20);
  });
});

describe("13º e férias", () => {
  it("13º proporcional aos meses trabalhados", () => {
    expect(calcularDecimoTerceiro(3000, 6).bruto).toBe(1500);
    expect(calcularDecimoTerceiro(3000, 12).bruto).toBe(3000);
  });

  it("férias somam o terço constitucional", () => {
    const r = calcularFerias(3000, 30);
    expect(r.proporcional).toBe(3000);
    expect(r.tercoConstitucional).toBe(1000);
    expect(r.bruto).toBe(4000);
  });

  it("férias proporcionais a 15 dias", () => {
    const r = calcularFerias(3000, 15);
    expect(r.proporcional).toBe(1500);
    expect(r.bruto).toBe(2000);
  });
});

describe("DSR", () => {
  it("rateia as variáveis pelos dias úteis sobre domingos e feriados", () => {
    // 300/25×4 = 48
    expect(calcularDsr(300, 25, 4).valor).toBe(48);
  });

  it("sem dias úteis não calcula", () => {
    expect(calcularDsr(300, 0, 4).valor).toBe(0);
  });
});

describe("folha consolidada", () => {
  it("o líquido é proventos menos descontos, com INSS e IRRF derivados", () => {
    const folha = calcularFolha({ salarioBase: 3000, dependentes: 0 });
    expect(folha.proventos[0].valor).toBe(3000);
    expect(folha.descontos.some((d) => d.codigo === "inss")).toBe(true);
    expect(folha.liquido).toBe(folha.totalProventos - folha.totalDescontos);
    expect(folha.liquido).toBeLessThan(3000);
    expect(folha.versaoTabela).toBe("2025.1");
  });

  it("evento tributável entra na base do INSS/IRRF", () => {
    const sem = calcularFolha({ salarioBase: 3000 });
    const com = calcularFolha({ salarioBase: 3000, dependentes: 0 }, {
      eventos: [{ codigo: "he50", descricao: "Horas extras", valor: 500, tributavel: true }],
    });
    expect(com.inss.valor).toBeGreaterThan(sem.inss.valor);
    expect(com.totalProventos).toBe(3500);
  });

  it("desconto avulso reduz o líquido sem mexer na base tributável", () => {
    const folha = calcularFolha({ salarioBase: 3000 }, {
      eventos: [{ codigo: "vale", descricao: "Vale", tipo: "desconto", valor: 200 }],
    });
    expect(folha.descontos.some((d) => d.codigo === "vale")).toBe(true);
  });
});

describe("mudar a tabela não reescreve o passado", () => {
  it("uma versão nova produz outro número e diz de qual versão veio", () => {
    const nova = {
      ...TABELAS_2025,
      versao: "2026.1",
      inss: { ...TABELAS_2025.inss, faixas: [{ ate: 2000, aliquota: 8 }, ...TABELAS_2025.inss.faixas.slice(1)] },
    };
    const antigo = calcularInss(1000, TABELAS_2025);
    const novo = calcularInss(1000, nova);
    expect(antigo.valor).toBe(75);
    expect(novo.valor).toBe(80);
  });
});

describe("CPF e dado sensível", () => {
  it("valida CPF real e recusa inválido", () => {
    expect(validarCpf("111.444.777-35")).toBe(true);
    expect(validarCpf("111.444.777-00")).toBe(false);
    expect(validarCpf("00000000000")).toBe(false);
    expect(validarCpf("123")).toBe(false);
  });

  it("mascara o CPF mostrando só o fim", () => {
    expect(mascararCpf("111.444.777-35")).toBe("***.***.777-35");
    expect(mascararCpf("abc")).toBe("");
  });
});

describe("validação de colaborador", () => {
  it("exige nome, CPF válido, salário e admissão", () => {
    const erros = validarColaborador({ nome: "", cpf: "123", salarioBase: 0, admissaoEm: "" });
    expect(erros.length).toBe(4);
  });

  it("aceita um cadastro completo", () => {
    const erros = validarColaborador({
      nome: "Maria", cpf: "111.444.777-35", salarioBase: 2500, admissaoEm: "2026-01-10",
    });
    expect(erros).toEqual([]);
  });
});

describe("resumo da folha", () => {
  it("soma proventos, descontos, líquido e encargos", () => {
    const r = resumoFolha([
      { totalProventos: 3000, totalDescontos: 500, liquido: 2500, fgtsValor: 240, inssValor: 300, irrfValor: 50 },
      { totalProventos: 2000, totalDescontos: 200, liquido: 1800, fgtsValor: 160, inssValor: 150, irrfValor: 0 },
    ]);
    expect(r.colaboradores).toBe(2);
    expect(r.totalLiquido).toBe(4300);
    expect(r.totalFgts).toBe(400);
  });

  it("lista vazia devolve zeros", () => {
    expect(resumoFolha([]).colaboradores).toBe(0);
  });
});
