import { describe, expect, it } from "vitest";
import {
  BLOCOS_DO_BRIEFING,
  NAO_SE_APLICA,
  TODOS_OS_CAMPOS,
  avaliarBriefing,
  normalizarBriefing,
  resumoComercialDoBriefing,
} from "./clientBriefingDomain.js";

describe("o briefing cobre o que foi pedido", () => {
  // A lista que originou este módulo, item por item. O teste existe para que
  // apagar um campo por engano quebre aqui, e não numa reunião.
  it("tem campo para cada item da lista do chefe", () => {
    const ids = new Set(TODOS_OS_CAMPOS.map((campo) => campo.id));
    for (const esperado of [
      "cidades", "bases", "volumeDia", "motoristasDia",
      "coleta", "processamento", "entrega", "horarios",
      "hcColeta", "hcProcessamento", "hcEntrega",
      "hcAcompanhamentoColeta", "hcAtendimentoCx", "dedicados",
      "reguaTipo", "reguaIndicadores", "formalizacao",
      "integracao", "bipagem", "smartlabel", "roteirizacao",
      "deParaStatus", "envioTracking", "insucesso",
      "documento", "modeloPagamento", "preco", "prazoPagamento", "conemb",
      "ticketMedio", "margem",
      "canalOcorrencia", "portalCliente",
      "responsavel", "aprovador", "suporte", "consultado", "informado",
    ]) expect(ids, `faltou o campo ${esperado}`).toContain(esperado);
  });

  it("a régua aceita SLA ou BSC, como foi pedido", () => {
    const regua = TODOS_OS_CAMPOS.find((campo) => campo.id === "reguaTipo");
    expect(regua.opcoes).toEqual(["SLA", "BSC", "SLA e BSC"]);
  });

  it("todo campo declara bloco, rótulo e tipo — a tela depende disso", () => {
    for (const campo of TODOS_OS_CAMPOS) {
      expect(campo.rotulo.length).toBeGreaterThan(2);
      expect(campo.bloco).toBeTruthy();
      expect(["texto", "numero", "lista", "escolha", "sim-nao", "moeda", "percentual"]).toContain(campo.tipo);
    }
  });
});

describe("normalizarBriefing", () => {
  it("só aceita campo que existe no catálogo", () => {
    const limpo = normalizarBriefing({ cidades: "São Paulo", margemInterna: 42, senhaDoBanco: "x" });
    expect(limpo.cidades).toEqual(["São Paulo"]);
    expect(limpo).not.toHaveProperty("margemInterna");
    expect(limpo).not.toHaveProperty("senhaDoBanco");
  });

  it("lista aceita vírgula, ponto e vírgula ou uma por linha", () => {
    expect(normalizarBriefing({ cidades: "Santos, Guarujá;Cubatão\nPraia Grande" }).cidades)
      .toEqual(["Santos", "Guarujá", "Cubatão", "Praia Grande"]);
  });

  it("escolha fora da lista é descartada, não gravada", () => {
    // Gravar um estado que ninguém sabe ler é pior do que não gravar.
    expect(normalizarBriefing({ documento: "Boleto" })).not.toHaveProperty("documento");
    expect(normalizarBriefing({ documento: "CT-e" }).documento).toBe("CT-e");
  });

  it("sim-não só aceita booleano — string 'não' não vira true", () => {
    expect(normalizarBriefing({ conemb: false }).conemb).toBe(false);
    expect(normalizarBriefing({ conemb: "não" })).not.toHaveProperty("conemb");
  });

  it("'não se aplica' só entra onde faz sentido", () => {
    // Operação sem processamento intermediário existe.
    expect(normalizarBriefing({ processamento: NAO_SE_APLICA }).processamento).toBe(NAO_SE_APLICA);
    // Toda operação entrega alguma coisa.
    expect(normalizarBriefing({ entrega: NAO_SE_APLICA })).not.toHaveProperty("entrega");
  });

  it("número negativo é recusado — não existe menos três motoristas", () => {
    expect(normalizarBriefing({ motoristasDia: -3 })).not.toHaveProperty("motoristasDia");
    expect(normalizarBriefing({ motoristasDia: 0 }).motoristasDia).toBe(0);
  });
});

describe("avaliarBriefing", () => {
  it("briefing vazio é 0% e lista tudo o que falta", () => {
    const avaliacao = avaliarBriefing({});
    expect(avaliacao.percentual).toBe(0);
    expect(avaliacao.completo).toBe(false);
    expect(avaliacao.faltando.length).toBe(avaliacao.total);
    // Cada pendência diz de qual bloco veio: "72% pronto" não diz onde ir.
    expect(avaliacao.faltando[0]).toHaveProperty("blocoTitulo");
  });

  it("mede por bloco, não só no total", () => {
    const avaliacao = avaliarBriefing({ cidades: ["Santos"], bases: ["CD Cubatão"], volumeDia: 900, motoristasDia: 12 });
    const abrangencia = avaliacao.blocos.find((bloco) => bloco.id === "abrangencia");
    expect(abrangencia.completo).toBe(true);
    expect(abrangencia.percentual).toBe(100);
    expect(avaliacao.completo).toBe(false);
  });

  it("'não se aplica' conta como respondido", () => {
    const semNaoSeAplica = avaliarBriefing({ coleta: "Diária no CD", entrega: "D+1", horarios: "corte 14h" });
    const comNaoSeAplica = avaliarBriefing({
      coleta: "Diária no CD", entrega: "D+1", horarios: "corte 14h", processamento: NAO_SE_APLICA,
    });
    const bloco = (a) => a.blocos.find((b) => b.id === "modelo-operacional");
    expect(bloco(semNaoSeAplica).completo).toBe(false);
    expect(bloco(comNaoSeAplica).completo).toBe(true);
  });

  it("campo não essencial não segura o bloco", () => {
    const avaliacao = avaliarBriefing({ responsavel: "Ana", aprovador: "Diretoria" });
    expect(avaliacao.blocos.find((bloco) => bloco.id === "responsaveis").completo).toBe(true);
  });

  it("preenchido inteiro chega a 100%", () => {
    const cheio = {};
    for (const campo of TODOS_OS_CAMPOS) {
      if (!campo.essencial) continue;
      if (campo.tipo === "sim-nao") cheio[campo.id] = true;
      else if (["numero", "moeda", "percentual"].includes(campo.tipo)) cheio[campo.id] = 7;
      else if (campo.tipo === "lista") cheio[campo.id] = ["um"];
      else if (campo.tipo === "escolha") cheio[campo.id] = campo.opcoes[0];
      else cheio[campo.id] = "preenchido";
    }
    const avaliacao = avaliarBriefing(normalizarBriefing(cheio));
    expect(avaliacao.percentual).toBe(100);
    expect(avaliacao.completo).toBe(true);
    expect(avaliacao.faltando).toEqual([]);
  });

  it("nenhum bloco devolve NaN, mesmo sem campo essencial", () => {
    for (const bloco of avaliarBriefing({}).blocos)
      expect(Number.isFinite(bloco.percentual)).toBe(true);
  });
});

describe("resumoComercialDoBriefing", () => {
  it("devolve null para o que não foi preenchido, nunca zero", () => {
    // Zero é uma margem possível. Confundir os dois faz a tela afirmar o que
    // não sabe.
    const resumo = resumoComercialDoBriefing({});
    expect(resumo.ticketMedio).toBeNull();
    expect(resumo.margemPercentual).toBeNull();
    expect(resumo.receitaMensalEstimada).toBeNull();
  });

  it("margem zero é zero, não ausência", () => {
    expect(resumoComercialDoBriefing({ margem: 0 }).margemPercentual).toBe(0);
  });

  it("só estima receita quando ticket e volume existem", () => {
    expect(resumoComercialDoBriefing({ ticketMedio: 18.5 }).receitaMensalEstimada).toBeNull();
    expect(resumoComercialDoBriefing({ ticketMedio: 18.5, volumeDia: 900 }).receitaMensalEstimada)
      .toBe(366300);
  });

  it("conta cidades e bases a partir da lista", () => {
    const resumo = resumoComercialDoBriefing({ cidades: ["Santos", "Guarujá"], bases: ["CD"] });
    expect(resumo.cidades).toBe(2);
    expect(resumo.bases).toBe(1);
  });
});

describe("os blocos batem com o que a tela desenha", () => {
  it("todo bloco tem id, título e ao menos um campo", () => {
    for (const bloco of BLOCOS_DO_BRIEFING) {
      expect(bloco.id).toBeTruthy();
      expect(bloco.titulo).toBeTruthy();
      expect(bloco.campos.length).toBeGreaterThan(0);
    }
  });

  it("não existe id de campo repetido entre blocos", () => {
    const ids = TODOS_OS_CAMPOS.map((campo) => campo.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
