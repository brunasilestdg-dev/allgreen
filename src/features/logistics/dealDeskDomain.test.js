import { describe, expect, it } from "vitest";
import {
  ALCADAS,
  SITUACOES,
  alcadaNecessaria,
  desvioEmPontos,
  estaVencido,
  liberacaoDaProposta,
  montarPedido,
  podeDecidir,
  prazoDoPedido,
  resumirFila,
  revisarPedido,
  situacaoVisivel,
} from "./dealDeskDomain.js";

const AGORA = "2026-08-07T10:00:00.000Z";
const horas = (n) => n * 3600 * 1000;

describe("desvio em pontos, não em porcentagem do preço", () => {
  it("2% abaixo de um piso de 18% é desvio de 2 pontos", () => {
    expect(desvioEmPontos(16, 18)).toBe(2);
  });

  it("margem acima do piso não gera desvio negativo", () => {
    expect(desvioEmPontos(24, 18)).toBe(0);
  });

  it("valor ilegível conta como zero, não como NaN", () => {
    expect(desvioEmPontos("abc", 18)).toBe(18);
    expect(desvioEmPontos(10, "abc")).toBe(0);
  });
});

describe("alçada", () => {
  it("desvio pequeno e contrato pequeno param na gestão comercial", () => {
    const a = alcadaNecessaria({ margemPercent: 16, margemMinimaPercent: 18, valorContrato: 120000 });
    expect(a.id).toBe("gestao_comercial");
    expect(a.desvioPontos).toBe(2);
  });

  it("desvio grande sobe para a diretoria mesmo com contrato pequeno", () => {
    const a = alcadaNecessaria({ margemPercent: 12, margemMinimaPercent: 18, valorContrato: 90000 });
    expect(a.id).toBe("diretoria");
  });

  it("contrato grande sobe a alçada mesmo com a margem no piso", () => {
    // Margem boa, mas o tamanho do contrato por si já muda quem decide.
    const a = alcadaNecessaria({ margemPercent: 22, margemMinimaPercent: 18, valorContrato: 1500000 });
    expect(a.id).toBe("diretoria");
    expect(a.desvioPontos).toBe(0);
  });

  it("desvio ou valor fora de tudo vai para o conselho", () => {
    expect(alcadaNecessaria({ margemPercent: -5, margemMinimaPercent: 18, valorContrato: 10 }).id).toBe("conselho");
    expect(alcadaNecessaria({ margemPercent: 30, margemMinimaPercent: 18, valorContrato: 9000000 }).id).toBe("conselho");
  });

  it("o motivo fica escrito para quem ler seis meses depois", () => {
    const a = alcadaNecessaria({ margemPercent: 15.5, margemMinimaPercent: 18, valorContrato: 100000 });
    expect(a.motivo).toMatch(/2\.5 ponto/);
    expect(a.motivo).toMatch(/piso de 18\.0%/);
  });

  it("as alçadas estão em ordem crescente de exigência", () => {
    for (let i = 1; i < ALCADAS.length; i += 1) {
      expect(ALCADAS[i].desvioMaximoPontos).toBeGreaterThan(ALCADAS[i - 1].desvioMaximoPontos);
      expect(ALCADAS[i].prazoHoras).toBeGreaterThan(ALCADAS[i - 1].prazoHoras);
    }
  });
});

describe("quem pode decidir", () => {
  const pedido = {
    id: "p1",
    situacao: SITUACOES.pendente,
    alcadaId: "gestao_comercial",
    solicitanteId: "vendedor",
  };

  it("liderança comercial decide um pedido da própria alçada", () => {
    expect(
      podeDecidir(pedido, { userId: "chefe", role: "lideranca_comercial", permissions: ["deal:approve"] }).pode,
    ).toBe(true);
  });

  it("sem permissão de aprovação comercial, nem o papel certo decide", () => {
    const r = podeDecidir(pedido, { userId: "chefe", role: "lideranca_comercial", permissions: [] });
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/permissão/);
  });

  it("quem pede não decide o próprio pedido, com alçada ou sem", () => {
    const r = podeDecidir(pedido, { userId: "vendedor", role: "owner", permissions: ["*"] });
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/Quem pede não decide/);
  });

  it("papel abaixo da alçada não decide", () => {
    const alto = { ...pedido, alcadaId: "conselho" };
    expect(
      podeDecidir(alto, { userId: "chefe", role: "lideranca_comercial", permissions: ["deal:approve"] }).pode,
    ).toBe(false);
    expect(podeDecidir(alto, { userId: "dona", role: "owner", permissions: ["*"] }).pode).toBe(true);
  });

  it("pedido já encerrado não é decidido de novo", () => {
    const fechado = { ...pedido, situacao: SITUACOES.aprovado };
    expect(podeDecidir(fechado, { userId: "chefe", role: "admin", permissions: ["*"] }).pode).toBe(false);
  });

  it("permissão de aprovar não substitui a alçada", () => {
    // `deal:approve` diz que a pessoa participa da aprovação comercial, não que ela
    // libera qualquer desvio. Se substituísse, a escada não existiria.
    const r = podeDecidir(pedido, { userId: "x", role: "auditor", permissions: ["deal:approve"] });
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/alçada de Gestão comercial/);
  });
});

describe("prazo", () => {
  it("cada alçada tem o próprio prazo", () => {
    expect(prazoDoPedido("gestao_comercial", AGORA)).toBe(new Date(new Date(AGORA).getTime() + horas(24)).toISOString());
    expect(prazoDoPedido("conselho", AGORA)).toBe(new Date(new Date(AGORA).getTime() + horas(72)).toISOString());
  });

  it("vencido é diferente de recusado", () => {
    const pedido = { situacao: SITUACOES.pendente, prazoEm: AGORA };
    const depois = new Date(new Date(AGORA).getTime() + horas(1)).toISOString();
    expect(estaVencido(pedido, depois)).toBe(true);
    expect(situacaoVisivel(pedido, depois)).toBe(SITUACOES.expirado);
    // E o registro guardado continua dizendo "pendente": ninguém decidiu nada.
    expect(pedido.situacao).toBe(SITUACOES.pendente);
  });

  it("pedido já decidido não vence", () => {
    const depois = new Date(new Date(AGORA).getTime() + horas(100)).toISOString();
    expect(estaVencido({ situacao: SITUACOES.aprovado, prazoEm: AGORA }, depois)).toBe(false);
  });
});

describe("a proposta sai ou não sai", () => {
  const base = { cenarioId: "c1", alcadaId: "gestao_comercial", versao: 1, criadoEm: AGORA, prazoEm: new Date(new Date(AGORA).getTime() + horas(24)).toISOString() };

  it("sem pedido nenhum, sai — nem toda condição precisa de aprovação comercial", () => {
    expect(liberacaoDaProposta("c1", []).liberada).toBe(true);
  });

  it("com pedido pendente, não sai", () => {
    const r = liberacaoDaProposta("c1", [{ ...base, situacao: SITUACOES.pendente }], AGORA);
    expect(r.liberada).toBe(false);
    expect(r.motivo).toMatch(/Aguardando decisão/);
  });

  it("aprovado, sai apontando a versão aprovada", () => {
    const r = liberacaoDaProposta("c1", [{ ...base, situacao: SITUACOES.aprovado, versao: 2, decisorNome: "Renata" }], AGORA);
    expect(r.liberada).toBe(true);
    expect(r.motivo).toMatch(/Renata/);
    expect(r.motivo).toMatch(/versão 2/);
  });

  it("recusado, não sai, e a justificativa aparece", () => {
    const r = liberacaoDaProposta("c1", [{ ...base, situacao: SITUACOES.recusado, decisaoJustificativa: "margem insustentável" }], AGORA);
    expect(r.liberada).toBe(false);
    expect(r.motivo).toMatch(/margem insustentável/);
  });

  it("vencido não sai, e o texto cobra a fila em vez de culpar quem pediu", () => {
    const depois = new Date(new Date(AGORA).getTime() + horas(48)).toISOString();
    const r = liberacaoDaProposta("c1", [{ ...base, situacao: SITUACOES.pendente }], depois);
    expect(r.liberada).toBe(false);
    expect(r.motivo).toMatch(/venceu/);
  });

  it("o pedido mais recente é o que manda", () => {
    const antigo = { ...base, situacao: SITUACOES.recusado, criadoEm: "2026-08-01T10:00:00.000Z" };
    const novo = { ...base, situacao: SITUACOES.aprovado, criadoEm: "2026-08-06T10:00:00.000Z" };
    expect(liberacaoDaProposta("c1", [antigo, novo], AGORA).liberada).toBe(true);
  });

  it("pedido de outra simulação não bloqueia esta", () => {
    expect(liberacaoDaProposta("c1", [{ ...base, cenarioId: "outro", situacao: SITUACOES.pendente }], AGORA).liberada).toBe(true);
  });
});

describe("montar o pedido", () => {
  const resultado = { marginPercent: 15, recommendedPrice: 300000, approval: { triggers: ["margem abaixo do piso"] } };
  const regua = { minimumMarginPercent: 18 };

  it("simulação não salva não gera pedido", () => {
    const r = montarPedido({ resultado, regua, justificativa: "Cliente estratégico com volume garantido por 24 meses.", solicitanteId: "v1" });
    expect(r.valido).toBe(false);
    expect(r.problemas[0]).toMatch(/salva/);
  });

  it("justificativa curta não passa", () => {
    const r = montarPedido({ cenarioId: "c1", resultado, regua, justificativa: "cliente bom", solicitanteId: "v1" });
    expect(r.valido).toBe(false);
  });

  it("alçada, desvio, gatilhos e prazo são derivados, não digitados", () => {
    const r = montarPedido({
      cenarioId: "c1",
      resultado,
      regua,
      justificativa: "Cliente estratégico com volume garantido por 24 meses.",
      solicitanteId: "v1",
      agora: AGORA,
    });
    expect(r.valido).toBe(true);
    expect(r.pedido.alcadaId).toBe("gestao_comercial");
    expect(r.pedido.desvioPontos).toBe(3);
    expect(r.pedido.gatilhos).toEqual(["margem abaixo do piso"]);
    expect(r.pedido.situacao).toBe(SITUACOES.pendente);
    expect(r.pedido.versao).toBe(1);
    expect(r.pedido.prazoEm).toBe(new Date(new Date(AGORA).getTime() + horas(24)).toISOString());
  });
});

describe("revisar reabre", () => {
  const pedido = {
    id: "p1",
    cenarioId: "c1",
    situacao: SITUACOES.aprovado,
    versao: 1,
    alcadaId: "gestao_comercial",
    decisorId: "chefe",
    decisorNome: "Chefe",
    decisaoJustificativa: "ok",
    decididoEm: AGORA,
  };

  it("a versão sobe e a decisão anterior sai do registro corrente", () => {
    const r = revisarPedido(pedido, {
      resultado: { marginPercent: 17, recommendedPrice: 200000 },
      regua: { minimumMarginPercent: 18 },
      justificativa: "Cliente aceitou reduzir a janela de espera, o custo caiu.",
      agora: AGORA,
    });
    expect(r.valido).toBe(true);
    expect(r.pedido.versao).toBe(2);
    // Aprovação dada na versão 1 não pode continuar valendo para a versão 2.
    expect(r.pedido.situacao).toBe(SITUACOES.pendente);
    expect(r.pedido.decisorId).toBe("");
    expect(r.pedido.decisaoJustificativa).toBe("");
  });

  it("revisão sem explicar o que mudou não passa", () => {
    const r = revisarPedido(pedido, { resultado: {}, regua: {}, justificativa: "mudou" });
    expect(r.valido).toBe(false);
  });
});

describe("resumo da fila", () => {
  const prazoVencido = "2026-08-01T00:00:00.000Z";
  const prazoFuturo = "2026-12-01T00:00:00.000Z";

  it("separa pendente de vencido e calcula a taxa só sobre o que foi decidido", () => {
    const r = resumirFila(
      [
        { situacao: SITUACOES.pendente, prazoEm: prazoFuturo },
        { situacao: SITUACOES.pendente, prazoEm: prazoVencido },
        { situacao: SITUACOES.aprovado },
        { situacao: SITUACOES.aprovado },
        { situacao: SITUACOES.recusado },
      ],
      AGORA,
    );
    expect(r.pendentes).toBe(1);
    expect(r.vencidos).toBe(1);
    expect(r.aprovados).toBe(2);
    expect(r.recusados).toBe(1);
    expect(r.taxaAprovacaoPercent).toBe(66.7);
  });

  it("sem decisão nenhuma, a taxa não existe — e não é zero", () => {
    // Zero por cento diria que tudo foi recusado.
    expect(resumirFila([{ situacao: SITUACOES.pendente, prazoEm: prazoFuturo }], AGORA).taxaAprovacaoPercent).toBeNull();
  });
});
