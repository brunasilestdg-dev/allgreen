import { describe, expect, it } from "vitest";
import {
  avancoDaOrdem,
  consumoParaMovimento,
  custoDaMaoDeObra,
  custoDaOrdem,
  custoDoMaterial,
  devolucaoParaMovimento,
  horasApontadas,
  podeMudarStatus,
  prazoDaOrdem,
  resumoDasOrdens,
  validateMaterialConsumption,
  validateServiceOrder,
  validateTimeEntry,
} from "./serviceOrderDomain.js";

const ordem = (extra = {}) => ({
  id: extra.id || "os-1",
  documentNumber: extra.documentNumber || "OS-1-000001",
  title: extra.title || "Instalação de carregador",
  status: extra.status || "em_execucao",
  warehouseId: extra.warehouseId || "matriz",
  estimatedHours: extra.estimatedHours,
  estimatedCost: extra.estimatedCost,
  scheduledStart: extra.scheduledStart,
  scheduledEnd: extra.scheduledEnd,
  finishedAt: extra.finishedAt,
  custo: extra.custo,
});

const material = (quantity, unitCost, extra = {}) => ({
  id: extra.id || "m1",
  itemId: extra.itemId || "cabo",
  quantity,
  unitCost,
  warehouseId: extra.warehouseId,
  consumedAt: extra.consumedAt || "2026-03-10",
});

const hora = (hours, hourlyCost, extra = {}) => ({
  id: extra.id || "h1",
  userId: extra.userId || "u1",
  personName: extra.personName || "",
  hours,
  hourlyCost,
  workedOn: extra.workedOn || "2026-03-10",
});

describe("máquina de estados", () => {
  it("segue o caminho declarado", () => {
    expect(podeMudarStatus("aberta", "em_execucao")).toBe(true);
    expect(podeMudarStatus("em_execucao", "pausada")).toBe(true);
    expect(podeMudarStatus("pausada", "em_execucao")).toBe(true);
    expect(podeMudarStatus("em_execucao", "concluida")).toBe(true);
  });

  it("não pula de aberta direto para concluída", () => {
    expect(podeMudarStatus("aberta", "concluida")).toBe(false);
  });

  it("concluída pode reabrir, porque apontar hora esquecida é rotina", () => {
    // Travar isso empurraria o apontamento para uma OS nova e quebraria o
    // histórico de custo do serviço. Quem trava o passado é o fechamento de
    // período, no financeiro.
    expect(podeMudarStatus("concluida", "em_execucao")).toBe(true);
    expect(podeMudarStatus("concluida", "pausada")).toBe(false);
  });

  it("status desconhecido não abre caminho", () => {
    expect(podeMudarStatus("inventado", "aberta")).toBe(false);
  });
});

describe("custo realizado", () => {
  it("soma material por quantidade × custo unitário", () => {
    expect(custoDoMaterial([material(10, 25), material(2, 100, { id: "m2" })])).toBe(450);
  });

  it("soma mão de obra por horas × custo hora", () => {
    expect(custoDaMaoDeObra([hora(8, 50), hora(4, 75, { id: "h2" })])).toBe(700);
  });

  it("quantidade e custo negativos não geram crédito", () => {
    expect(custoDoMaterial([material(-10, 25)])).toBe(250);
    expect(custoDoMaterial([material(10, -25)])).toBe(0);
    expect(custoDaMaoDeObra([hora(8, -50)])).toBe(0);
  });

  it("soma as horas apontadas com duas casas", () => {
    expect(horasApontadas([hora(1.5, 0), hora(2.25, 0, { id: "h2" })])).toBe(3.75);
    expect(horasApontadas([])).toBe(0);
  });

  it("compara realizado com previsto e aponta o estouro", () => {
    const custo = custoDaOrdem(ordem({ estimatedCost: 1000 }), [material(10, 60)], [hora(8, 50)]);
    expect(custo).toMatchObject({
      material: 600, maoDeObra: 400, realizado: 1000, previsto: 1000, desvio: 0, estourou: false,
    });

    const estourada = custoDaOrdem(ordem({ estimatedCost: 500 }), [material(10, 60)], [hora(8, 50)]);
    expect(estourada).toMatchObject({ desvio: 500, desvioPercent: 100, estourou: true });
  });

  it("sem estimativa, desvio é null e nunca estourou", () => {
    // Comparar contra nada e devolver 100% mentiria.
    const custo = custoDaOrdem(ordem(), [material(10, 60)], []);
    expect(custo).toMatchObject({ realizado: 600, previsto: null, desvio: null, desvioPercent: null, estourou: false });
  });

  it("estimativa zero não é o mesmo que ausente", () => {
    const comZero = custoDaOrdem(ordem({ estimatedCost: 0 }), [material(1, 10)], []);
    expect(comZero.previsto).toBe(0);
    // Percentual sobre zero seria infinito, então fica null — mas o desvio é real.
    expect(comZero.desvio).toBe(10);
    expect(comZero.desvioPercent).toBeNull();
  });
});

describe("avanço derivado", () => {
  it("sai das horas apontadas contra as previstas", () => {
    expect(avancoDaOrdem(ordem({ estimatedHours: 20 }), [hora(5, 0)]))
      .toMatchObject({ percentual: 25, horas: 5, horasPrevistas: 20, limitado: false });
  });

  it("passa de 100% e a barra para, mas avisa", () => {
    // Esconder isso faria a OS parecer no prazo.
    expect(avancoDaOrdem(ordem({ estimatedHours: 10 }), [hora(15, 0)]))
      .toMatchObject({ percentual: 100, horas: 15, limitado: true });
  });

  it("sem estimativa de horas, percentual é null — não zero", () => {
    // A tela mostra "sem estimativa" em vez de uma barra que finge saber.
    expect(avancoDaOrdem(ordem(), [hora(5, 0)]).percentual).toBeNull();
    expect(avancoDaOrdem(ordem({ estimatedHours: 0 }), [hora(5, 0)]).percentual).toBeNull();
  });

  it("concluída sem estimativa é 100%: a decisão de gente resolve", () => {
    expect(avancoDaOrdem(ordem({ status: "concluida" }), []).percentual).toBe(100);
  });

  it("nenhum apontamento é zero por cento, não null, quando há estimativa", () => {
    expect(avancoDaOrdem(ordem({ estimatedHours: 10 }), []).percentual).toBe(0);
  });
});

describe("prazo", () => {
  it("aponta atraso de quem ainda não entregou", () => {
    expect(prazoDaOrdem(ordem({ scheduledEnd: "2026-03-10" }), "2026-03-15"))
      .toMatchObject({ dias: 5, situacao: "atrasada" });
  });

  it("no prazo enquanto a data não passou", () => {
    expect(prazoDaOrdem(ordem({ scheduledEnd: "2026-03-20" }), "2026-03-15"))
      .toMatchObject({ situacao: "no_prazo" });
  });

  it("entrega depois do prazo continua sendo atraso", () => {
    // O fato não deixa de ser verdade porque o trabalho acabou.
    expect(prazoDaOrdem(
      ordem({ status: "concluida", scheduledEnd: "2026-03-10", finishedAt: "2026-03-14" }),
      "2026-04-01",
    )).toMatchObject({ dias: 4, situacao: "entregue_com_atraso" });
  });

  it("entrega dentro do prazo é registrada como tal", () => {
    expect(prazoDaOrdem(
      ordem({ status: "concluida", scheduledEnd: "2026-03-10", finishedAt: "2026-03-08" }),
      "2026-04-01",
    )).toMatchObject({ situacao: "entregue_no_prazo" });
  });

  it("sem prazo declarado, devolve null — não pode estar atrasada", () => {
    expect(prazoDaOrdem(ordem(), "2026-03-15")).toBeNull();
    expect(prazoDaOrdem(ordem({ scheduledEnd: "10/03/2026" }), "2026-03-15")).toBeNull();
  });
});

describe("consumo → movimento de estoque", () => {
  it("gera saída sem declarar custo", () => {
    // A saída consome o custo médio do estoque; declarar custo aqui permitiria
    // baixar caro o que entrou barato.
    expect(consumoParaMovimento(material(4, 25, { id: "c1" }), ordem())).toMatchObject({
      itemId: "cabo", warehouseId: "matriz", kind: "saida", quantity: 4, unitCost: 0,
      originType: "ordem_servico", originId: "c1", originNumber: "OS-1-000001",
    });
  });

  it("o depósito do consumo tem precedência sobre o da ordem", () => {
    expect(consumoParaMovimento(material(1, 10, { warehouseId: "filial" }), ordem()).warehouseId)
      .toBe("filial");
  });

  it("sem material ou sem quantidade, não movimenta", () => {
    expect(consumoParaMovimento(material(0, 10), ordem())).toBeNull();
    expect(consumoParaMovimento({ quantity: 5 }, ordem())).toBeNull();
  });

  it("devolução volta ao depósito com o custo com que saiu", () => {
    // Devolver a custo zero baixaria a média do estoque sem razão.
    expect(devolucaoParaMovimento(material(10, 25), ordem(), 3)).toMatchObject({
      kind: "entrada", quantity: 3, unitCost: 25, originType: "ordem_servico_devolucao",
    });
  });

  it("não devolve mais do que foi consumido", () => {
    expect(devolucaoParaMovimento(material(10, 25), ordem(), 11)).toBeNull();
    expect(devolucaoParaMovimento(material(10, 25), ordem(), 0)).toBeNull();
  });
});

describe("resumo da carteira", () => {
  it("conta por status e soma o custo", () => {
    const resumo = resumoDasOrdens([
      ordem({ id: "a", status: "aberta", custo: { realizado: 100 } }),
      ordem({ id: "b", status: "em_execucao", custo: { realizado: 200 }, estimatedCost: 500 }),
      ordem({ id: "c", status: "concluida", custo: { realizado: 300 }, estimatedCost: 250 }),
    ]);
    expect(resumo).toMatchObject({
      total: 3, abertas: 1, emExecucao: 1, concluidas: 1,
      custoRealizado: 600, custoPrevisto: 750, ordensComPrevisao: 2,
    });
  });

  it("não soma zero pelos sem estimativa", () => {
    // Somar zero faria o previsto total parecer menor que o realizado sempre.
    const resumo = resumoDasOrdens([ordem({ custo: { realizado: 900 } })]);
    expect(resumo.custoPrevisto).toBe(0);
    expect(resumo.ordensComPrevisao).toBe(0);
  });

  it("conta as atrasadas", () => {
    const resumo = resumoDasOrdens(
      [ordem({ status: "em_execucao", scheduledEnd: "2026-03-01" })],
      "2026-03-10",
    );
    expect(resumo.atrasadas).toBe(1);
  });
});

describe("validação", () => {
  it("ordem exige título e datas coerentes", () => {
    expect(validateServiceOrder({ title: "Instalar" })).toBe("");
    expect(validateServiceOrder({})).toMatch(/precisa ser feito/i);
    expect(validateServiceOrder({ title: "X", scheduledStart: "2026-03-10", scheduledEnd: "2026-03-01" }))
      .toMatch(/antes do início/i);
  });

  it("ordem recusa estimativa negativa mas aceita ausente", () => {
    expect(validateServiceOrder({ title: "X", estimatedHours: -1 })).toMatch(/negativas/i);
    expect(validateServiceOrder({ title: "X", estimatedCost: -1 })).toMatch(/negativo/i);
    expect(validateServiceOrder({ title: "X" })).toBe("");
    expect(validateServiceOrder({ title: "X", estimatedHours: 0 })).toBe("");
  });

  it("consumo exige material, quantidade e data", () => {
    const ok = { itemId: "cabo", quantity: 2, consumedAt: "2026-03-10" };
    expect(validateMaterialConsumption(ok)).toBe("");
    expect(validateMaterialConsumption({ ...ok, itemId: "" })).toMatch(/material/i);
    expect(validateMaterialConsumption({ ...ok, quantity: 0 })).toMatch(/maior que zero/i);
    expect(validateMaterialConsumption({ ...ok, consumedAt: "" })).toMatch(/data/i);
  });

  it("apontamento aceita nome livre para quem não tem login", () => {
    // Terceirizado e prestador apontam hora e não têm conta.
    const semLogin = { personName: "Prestador Alfa", hours: 8, workedOn: "2026-03-10" };
    expect(validateTimeEntry(semLogin)).toBe("");
    expect(validateTimeEntry({ hours: 8, workedOn: "2026-03-10" })).toMatch(/quem trabalhou/i);
  });

  it("apontamento recusa mais de 24 horas num dia", () => {
    // 240 por erro de digitação estragaria o custo sem ninguém notar.
    const base = { userId: "u1", workedOn: "2026-03-10" };
    expect(validateTimeEntry({ ...base, hours: 24 })).toBe("");
    expect(validateTimeEntry({ ...base, hours: 240 })).toMatch(/24 horas/i);
    expect(validateTimeEntry({ ...base, hours: 0 })).toMatch(/maiores que zero/i);
    expect(validateTimeEntry({ ...base, hours: 8, hourlyCost: -1 })).toMatch(/negativo/i);
  });
});
