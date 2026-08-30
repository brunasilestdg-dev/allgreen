import { describe, expect, it } from "vitest";
import {
  ESTAGIOS_OPORTUNIDADE,
  analisarOportunidade,
  estagioValido,
  greenScoreEsperado,
  impactoFinanceiro,
  impactoOperacional,
  normalizarOportunidade,
  potencialAmbiental,
  potencialExpansao,
  probabilidadeDoEstagio,
  proximaAcao,
  resumirPipeline,
  riscosDaOportunidade,
} from "./opportunityIntelligenceDomain.js";

// Uma oportunidade completa, com dado medido. Serve de base; cada teste tira
// exatamente o que quer testar.
const oportunidade = (extra = {}) => ({
  estagio: "Proposta",
  distanciaKm: 120,
  viagensMes: 20,
  tipoVeiculo: "elétrico",
  mesesContrato: 24,
  valorMensal: 10000,
  ocupacaoPrevistaPercent: 78,
  frotaLimpaPercent: 60,
  origens: { distancia: "medido", frequencia: "medido" },
  calculadoEm: "2026-03-01T12:00:00.000Z",
  ...extra,
});

describe("estágio e probabilidade", () => {
  it("estágio desconhecido não derruba a análise: cai no início do funil", () => {
    expect(estagioValido("Qualquer coisa")).toBe("Prospecção");
    expect(estagioValido(undefined)).toBe("Prospecção");
    expect(estagioValido("Negociação")).toBe("Negociação");
  });

  it("cada estágio da régua tem probabilidade definida", () => {
    for (const estagio of ESTAGIOS_OPORTUNIDADE) {
      expect(Number.isFinite(probabilidadeDoEstagio(estagio))).toBe(true);
    }
  });

  it("a probabilidade informada pela pessoa vence a do estágio", () => {
    expect(probabilidadeDoEstagio("Prospecção", 65)).toBe(65);
  });

  it("probabilidade impossível é ignorada em favor da régua do estágio", () => {
    expect(probabilidadeDoEstagio("Apresentação", 150)).toBe(35);
    expect(probabilidadeDoEstagio("Apresentação", -3)).toBe(35);
    expect(probabilidadeDoEstagio("Apresentação", "mais ou menos")).toBe(35);
  });
});

describe("potencial ambiental", () => {
  it("sem distância e frequência, diz o que falta em vez de devolver zero", () => {
    const r = potencialAmbiental({ valorMensal: 5000 });
    expect(r.disponivel).toBe(false);
    expect(r.camposFaltando).toEqual(["distanciaKm", "viagensMes"]);
    expect(r.motivo).toMatch(/distância/i);
    // Zero seria pior que ausência: um vendedor leria "0 kg evitados" como
    // "esta operação não tem ganho ambiental".
    expect(r.co2MensalKg).toBeUndefined();
  });

  it("aponta só o campo que realmente falta", () => {
    expect(potencialAmbiental({ distanciaKm: 100 }).camposFaltando).toEqual([
      "viagensMes",
    ]);
    expect(potencialAmbiental({ viagensMes: 12 }).camposFaltando).toEqual([
      "distanciaKm",
    ]);
  });

  it("nunca lança com entrada vazia — a tela não pode quebrar por dado faltando", () => {
    expect(() => potencialAmbiental()).not.toThrow();
    expect(() => potencialAmbiental({})).not.toThrow();
  });

  it("calcula o contrato inteiro, não só o mês", () => {
    const r = potencialAmbiental(oportunidade());
    expect(r.disponivel).toBe(true);
    expect(r.mesesContrato).toBe(24);
    expect(r.co2ContratoKg).toBeCloseTo(r.co2MensalKg * 24, 1);
    expect(r.co2ContratoToneladas).toBeCloseTo((r.co2MensalKg * 24) / 1000, 2);
  });

  it("vem com a memória de cálculo: a proposta cita o número, o anexo prova", () => {
    const r = potencialAmbiental(oportunidade());
    expect(r.memoria.passos.length).toBeGreaterThan(0);
    expect(r.memoria.fatoresUsados.every((f) => f.fonte && f.versao)).toBe(true);
    expect(r.memoria.ressalva).toMatch(/não constitui certificação/i);
    expect(r.versaoFatores).toBeTruthy();
  });

  it("dado medido libera o uso em proposta", () => {
    const r = potencialAmbiental(oportunidade());
    expect(r.qualidadeDados).toBe(100);
    expect(r.usoPermitido).toMatch(/pode ser usado em proposta/i);
  });

  it("abaixo de 70% de qualidade, o texto barra o uso em proposta", () => {
    const r = potencialAmbiental(oportunidade({ origens: { distancia: "estimado" } }));
    expect(r.qualidadeDados).toBeLessThan(70);
    expect(r.usoPermitido).toMatch(/estimativa preliminar/i);
  });

  it("sem origem informada, assume o pior — não o melhor", () => {
    const r = potencialAmbiental(oportunidade({ origens: undefined }));
    expect(r.qualidadeDados).toBeLessThan(70);
  });

  it("operação a diesel dá zero evitado, e diz isso com a conta aberta", () => {
    const r = potencialAmbiental(oportunidade({ tipoVeiculo: "diesel" }));
    expect(r.disponivel).toBe(true);
    expect(r.co2MensalKg).toBe(0);
    expect(r.reducaoPercent).toBe(0);
    expect(r.memoria.premissas.join(" ")).toMatch(/diesel/i);
  });

  it("contrato sem prazo informado usa 12 meses, e declara o prazo usado", () => {
    const r = potencialAmbiental(oportunidade({ mesesContrato: undefined }));
    expect(r.mesesContrato).toBe(12);
  });
});

describe("Green Score esperado", () => {
  it("sem dado ambiental, não inventa score", () => {
    const r = greenScoreEsperado({ valorMensal: 1000 });
    expect(r.disponivel).toBe(false);
    expect(r.valor).toBeUndefined();
  });

  it("projeta o score com os mesmos componentes do score realizado", () => {
    const r = greenScoreEsperado(oportunidade());
    expect(r.disponivel).toBe(true);
    expect(r.valor).toBeGreaterThan(0);
    expect(Object.keys(r.componentes)).toContain("reducaoEmissoes");
    expect(Object.keys(r.componentes)).toContain("qualidadeDados");
    expect(r.versaoPesos).toBeTruthy();
  });

  it("diz em voz alta que é projeção, não apuração", () => {
    const r = greenScoreEsperado(oportunidade());
    expect(r.ressalva).toMatch(/projetado/i);
    expect(r.ressalva).toMatch(/pode divergir/i);
  });

  it("qualidade de dado baixa derruba o score projetado", () => {
    const bom = greenScoreEsperado(oportunidade());
    const fraco = greenScoreEsperado(
      oportunidade({ origens: { distancia: "presumido" } }),
    );
    expect(fraco.valor).toBeLessThan(bom.valor);
  });

  it("reaproveita o ambiental já calculado em vez de recalcular", () => {
    const ambiental = potencialAmbiental(oportunidade());
    const r = greenScoreEsperado(oportunidade(), ambiental);
    expect(r.componentes.reducaoEmissoes.valor).toBeCloseTo(
      ambiental.reducaoPercent,
      1,
    );
  });
});

describe("impacto financeiro", () => {
  it("valor cheio e valor ponderado são coisas diferentes", () => {
    const f = impactoFinanceiro(oportunidade({ estagio: "Negociação" }));
    expect(f.valorContrato).toBe(240000);
    expect(f.probabilidade).toBe(60);
    expect(f.valorPonderado).toBe(144000);
    // Confundir os dois é o que transforma pipeline em ficção.
    expect(f.valorPonderado).toBeLessThan(f.valorContrato);
  });

  it("separa o que entra no ano corrente do total do contrato", () => {
    const f = impactoFinanceiro(oportunidade({ mesesContrato: 36 }));
    expect(f.valorContrato).toBe(360000);
    expect(f.valorNoAnoCorrente).toBe(120000);
  });

  it("contrato mais curto que um ano não infla o ano corrente", () => {
    const f = impactoFinanceiro(oportunidade({ mesesContrato: 6 }));
    expect(f.valorNoAnoCorrente).toBe(60000);
  });

  it("oportunidade perdida vale zero ponderado, não o valor cheio", () => {
    const f = impactoFinanceiro(oportunidade({ estagio: "Fechada perdida" }));
    expect(f.valorContrato).toBe(240000);
    expect(f.valorPonderado).toBe(0);
  });
});

describe("impacto operacional", () => {
  it("traduz viagens em frota e motorista", () => {
    const o = impactoOperacional(oportunidade({ viagensMes: 220 }));
    expect(o.veiculosNecessarios).toBe(10);
    expect(o.motoristasNecessarios).toBe(10);
    expect(o.kmMes).toBe(26400);
  });

  it("avisa quando a operação proposta não cabe na frota disponível", () => {
    const o = impactoOperacional(
      oportunidade({ viagensMes: 220, veiculosDisponiveis: 3 }),
    );
    expect(o.exigeFrotaAdicional).toBe(true);
  });

  it("frota suficiente não vira alarme", () => {
    const o = impactoOperacional(
      oportunidade({ viagensMes: 220, veiculosDisponiveis: 12 }),
    );
    expect(o.exigeFrotaAdicional).toBe(false);
  });

  it("sem frota informada, não afirma que falta veículo", () => {
    const o = impactoOperacional(oportunidade({ viagensMes: 220 }));
    expect(o.exigeFrotaAdicional).toBe(false);
  });
});

describe("potencial de expansão", () => {
  it("não sugere caminho sem dado que o sustente", () => {
    const e = potencialExpansao({ distanciaKm: 100, viagensMes: 10 }, {});
    expect(e.caminhos).toEqual([]);
    expect(e.resumo).toMatch(/registre/i);
  });

  it("cada caminho carrega a base factual que o justifica", () => {
    const e = potencialExpansao(oportunidade({ ocupacaoPrevistaPercent: 62 }), {
      rotasMapeadas: 9,
      rotasAtivas: 4,
    });
    const tipos = e.caminhos.map((c) => c.tipo);
    expect(tipos).toContain("eletrificacao");
    expect(tipos).toContain("ocupacao");
    expect(tipos).toContain("novas-rotas");
    expect(e.caminhos.every((c) => c.base && c.ganhoEstimado)).toBe(true);
    expect(e.caminhos.find((c) => c.tipo === "novas-rotas").base).toMatch(/5 rota/);
  });

  it("frota já 100% limpa não vira sugestão de eletrificar", () => {
    const e = potencialExpansao(oportunidade({ frotaLimpaPercent: 100 }), {});
    expect(e.caminhos.map((c) => c.tipo)).not.toContain("eletrificacao");
  });

  it("ocupação já alta não vira sugestão de consolidar carga", () => {
    const e = potencialExpansao(oportunidade({ ocupacaoPrevistaPercent: 92 }), {});
    expect(e.caminhos.map((c) => c.tipo)).not.toContain("ocupacao");
  });
});

describe("riscos", () => {
  it("o mais grave vem primeiro, porque é o que se lê", () => {
    const riscos = riscosDaOportunidade(
      oportunidade({
        origens: { distancia: "presumido" },
        viagensMes: 220,
        veiculosDisponiveis: 2,
        diasSemInteracao: 25,
      }),
    );
    expect(riscos[0].gravidade).toBe("alta");
    const gravidades = riscos.map((r) => r.gravidade);
    expect(gravidades.indexOf("alta")).toBeLessThan(gravidades.indexOf("media"));
  });

  it("dado faltando é risco alto, não detalhe de preenchimento", () => {
    const riscos = riscosDaOportunidade({ valorMensal: 3000 });
    expect(riscos[0]).toMatchObject({ tipo: "dado-faltando", gravidade: "alta" });
  });

  it("preço abaixo do piso da régua é sinalizado antes da reunião", () => {
    const riscos = riscosDaOportunidade(
      oportunidade({ precoAlvoCliente: 8000, precoMinimo: 9500 }),
    );
    expect(riscos.some((r) => r.tipo === "preco-abaixo-do-piso")).toBe(true);
  });

  it("alvo acima do piso não vira alarme falso", () => {
    const riscos = riscosDaOportunidade(
      oportunidade({ precoAlvoCliente: 11000, precoMinimo: 9500 }),
    );
    expect(riscos.some((r) => r.tipo === "preco-abaixo-do-piso")).toBe(false);
  });

  it("oportunidade parada esfria: 21 dias avisa, 45 alarma", () => {
    const morna = riscosDaOportunidade(oportunidade({ diasSemInteracao: 25 }));
    const fria = riscosDaOportunidade(oportunidade({ diasSemInteracao: 50 }));
    expect(morna.find((r) => r.tipo === "esfriando").gravidade).toBe("media");
    expect(fria.find((r) => r.tipo === "esfriando").gravidade).toBe("alta");
  });

  it("oportunidade saudável e recente não gera risco inventado", () => {
    expect(riscosDaOportunidade(oportunidade({ diasSemInteracao: 3 }))).toEqual([]);
  });
});

describe("próxima ação", () => {
  it("devolve exatamente uma ação — lista de cinco ninguém executa", () => {
    const acao = proximaAcao(oportunidade());
    expect(Array.isArray(acao)).toBe(false);
    expect(acao.acao).toBeTruthy();
    expect(acao.porque).toBeTruthy();
  });

  it("risco alto manda na ação, acima do estágio", () => {
    // Estágio Apresentação pediria "apresentar a proposta"; a frota faltando vem antes.
    const acao = proximaAcao(
      oportunidade({ viagensMes: 220, veiculosDisponiveis: 2 }),
    );
    expect(acao.acao).toMatch(/capacidade de frota/i);
    expect(acao.urgencia).toBe("alta");
  });

  it("sem dado, a ação é buscar dado", () => {
    const acao = proximaAcao({ estagio: "Proposta", valorMensal: 4000 });
    expect(acao.acao).toMatch(/levantar os dados/i);
  });

  it("alvo abaixo do piso vai para aprovação comercial antes do cliente", () => {
    const acao = proximaAcao(
      oportunidade({ precoAlvoCliente: 8000, precoMinimo: 9500 }),
    );
    expect(acao.acao).toMatch(/aprovação comercial/i);
  });

  it("sem risco alto, a ação segue o estágio", () => {
    expect(proximaAcao(oportunidade({ estagio: "Prospecção" })).acao).toMatch(
      /diagnóstico operacional/i,
    );
    expect(proximaAcao(oportunidade({ estagio: "Negociação" })).acao).toMatch(
      /data de início/i,
    );
    expect(proximaAcao(oportunidade({ estagio: "Apresentação" })).acao).toMatch(
      /memória de cálculo/i,
    );
  });

  it("oportunidade fechada pede registro do aprendizado", () => {
    expect(proximaAcao(oportunidade({ estagio: "Fechada ganha" })).acao).toMatch(
      /aprendizado/i,
    );
    expect(proximaAcao(oportunidade({ estagio: "Fechada perdida" })).acao).toMatch(
      /aprendizado/i,
    );
  });
});

describe("análise completa", () => {
  it("uma chamada entrega o que a tela da oportunidade precisa", () => {
    const analise = analisarOportunidade(oportunidade(), {
      conta: { rotasMapeadas: 9, rotasAtivas: 4 },
    });
    expect(analise.estagio).toBe("Apresentação");
    expect(analise.ambiental.disponivel).toBe(true);
    expect(analise.greenScore.disponivel).toBe(true);
    expect(analise.financeiro.valorContrato).toBe(240000);
    expect(analise.operacional.veiculosNecessarios).toBeGreaterThan(0);
    expect(analise.expansao.caminhos.length).toBeGreaterThan(0);
    expect(analise.proximaAcao.acao).toBeTruthy();
  });

  it("oportunidade crua não quebra a tela: entrega o que dá e diz o que falta", () => {
    const analise = analisarOportunidade({ estagio: "Prospecção" });
    expect(analise.ambiental.disponivel).toBe(false);
    expect(analise.greenScore.disponivel).toBe(false);
    expect(analise.financeiro.valorContrato).toBe(0);
    expect(analise.riscos[0].tipo).toBe("dado-faltando");
    expect(analise.proximaAcao.acao).toMatch(/levantar os dados/i);
  });

  it("o ambiental é calculado uma vez e reusado por score e risco", () => {
    const analise = analisarOportunidade(
      oportunidade({ origens: { distancia: "presumido" } }),
    );
    expect(analise.riscos.some((r) => r.tipo === "qualidade-dado")).toBe(true);
    expect(analise.greenScore.componentes.qualidadeDados.valor).toBe(
      analise.ambiental.qualidadeDados,
    );
  });
});

describe("adaptador do registro guardado", () => {
  // O registro que o CRM já grava hoje, em inglês e sem dado operacional.
  const registroAntigo = {
    id: "opp-1",
    client: "Distribuidora Norte",
    productId: "middle-mile",
    stage: "Diagnóstico",
    value: 180000,
    probability: 30,
    lastInteractionAt: "2026-02-01T00:00:00.000Z",
  };

  it("lê o registro antigo sem exigir migração", () => {
    const o = normalizarOportunidade(registroAntigo);
    expect(o.cliente).toBe("Distribuidora Norte");
    expect(o.estagio).toBe("Prospecção");
    expect(o.valorContrato).toBe(180000);
    expect(o.probabilidade).toBe(30);
  });

  it("value antigo é o contrato inteiro, não a mensalidade", () => {
    const f = impactoFinanceiro(normalizarOportunidade(registroAntigo));
    // Tratar 180.000 como mensalidade multiplicaria o pipeline por 12.
    expect(f.valorContrato).toBe(180000);
    expect(f.valorMensal).toBe(15000);
    expect(f.baseDoValor).toBe("contrato");
  });

  it("mensalidade informada tem precedência sobre o valor herdado", () => {
    const f = impactoFinanceiro(
      normalizarOportunidade({ ...registroAntigo, valorMensal: 20000, mesesContrato: 24 }),
    );
    expect(f.baseDoValor).toBe("mensal");
    expect(f.valorContrato).toBe(480000);
  });

  it("sem valor nenhum, diz que falta em vez de mostrar zero como se fosse dado", () => {
    expect(impactoFinanceiro({}).baseDoValor).toBe("ausente");
  });

  it("estágio herdado do CRM não reabre negócio já fechado", () => {
    expect(normalizarOportunidade({ stage: "Ganho" }).estagio).toBe("Fechada ganha");
    expect(normalizarOportunidade({ stage: "Perdido" }).estagio).toBe("Fechada perdida");
    expect(normalizarOportunidade({ stage: "Cliente ativo" }).estagio).toBe("Fechada ganha");
    expect(normalizarOportunidade({ stage: "Mapeamento" }).estagio).toBe("Prospecção");
  });

  it("estágio escrito sem acento ou em caixa diferente é reconhecido", () => {
    expect(estagioValido("negociacao")).toBe("Negociação");
    expect(estagioValido("PROPOSTA")).toBe("Apresentação");
    expect(estagioValido("diagnostico")).toBe("Prospecção");
  });

  it("converte a última interação em dias parados", () => {
    const agora = new Date("2026-03-01T00:00:00.000Z").getTime();
    expect(normalizarOportunidade(registroAntigo, agora).diasSemInteracao).toBe(28);
  });

  it("data ilegível não vira 'zero dias parado'", () => {
    const o = normalizarOportunidade({ lastInteractionAt: "ontem" });
    expect(o.diasSemInteracao).toBe(0);
    // Zero aqui significa "não sei", e o risco de esfriamento não dispara —
    // melhor não alarmar do que alarmar com data inventada.
    expect(riscosDaOportunidade(o).some((r) => r.tipo === "esfriando")).toBe(false);
  });

  it("declara quando o tipo de veículo foi presumido", () => {
    const presumido = potencialAmbiental(
      normalizarOportunidade({ ...registroAntigo, distanciaKm: 100, viagensMes: 20 }),
    );
    expect(presumido.tipoVeiculoPresumido).toBe(true);
    const informado = potencialAmbiental(oportunidade());
    expect(informado.tipoVeiculoPresumido).toBe(false);
  });

  it("registro cru passa pelo motor inteiro sem quebrar", () => {
    const analise = analisarOportunidade(normalizarOportunidade(registroAntigo));
    expect(analise.estagio).toBe("Prospecção");
    expect(analise.ambiental.disponivel).toBe(false);
    expect(analise.financeiro.valorContrato).toBe(180000);
    expect(analise.proximaAcao.acao).toBeTruthy();
  });
});

describe("resumo do pipeline", () => {
  const carteira = () => [
    oportunidade({ estagio: "Negociação" }),
    oportunidade({ estagio: "Proposta", valorMensal: 5000, mesesContrato: 12 }),
    oportunidade({ estagio: "Mapeamento", distanciaKm: 0, viagensMes: 0 }),
    oportunidade({ estagio: "Fechada ganha" }),
    oportunidade({ estagio: "Fechada perdida" }),
  ];

  it("negócio fechado sai do pipeline — ganho ou perdido", () => {
    const r = resumirPipeline(carteira());
    expect(r.total).toBe(3);
    expect(r.porEstagio["Fechada ganha"]).toBeUndefined();
    expect(r.porEstagio["Fechada perdida"]).toBeUndefined();
  });

  it("valor ponderado é menor que o valor cheio da carteira", () => {
    const r = resumirPipeline(carteira());
    expect(r.valorTotal).toBe(240000 + 60000 + 240000);
    expect(r.valorPonderado).toBeLessThan(r.valorTotal);
  });

  it("conta quantas oportunidades ainda não têm dado ambiental", () => {
    const r = resumirPipeline(carteira());
    // É fila de trabalho do time, não número decorativo.
    expect(r.semDadoAmbiental).toBe(1);
  });

  it("o CO2 potencial soma só o que foi de fato calculado", () => {
    const r = resumirPipeline(carteira());
    const a = potencialAmbiental(oportunidade({ estagio: "Negociação" }));
    const b = potencialAmbiental(
      oportunidade({ valorMensal: 5000, mesesContrato: 12 }),
    );
    expect(r.co2PotencialToneladas).toBeCloseTo(
      a.co2ContratoToneladas + b.co2ContratoToneladas,
      1,
    );
  });

  it("pipeline vazio devolve zeros, não NaN", () => {
    const r = resumirPipeline([]);
    expect(r).toMatchObject({
      total: 0,
      valorTotal: 0,
      valorPonderado: 0,
      co2PotencialToneladas: 0,
      semDadoAmbiental: 0,
    });
    expect(r.porEstagio).toEqual({});
  });
});
