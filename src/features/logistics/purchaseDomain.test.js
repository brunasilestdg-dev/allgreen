import { describe, expect, it } from "vitest";
import {
  aprovacaoAindaVale,
  previsaoDeCompra,
  exigeAprovacao,
  linhasDoPedidoDaRequisicao,
  podeMudarStatusDaRequisicao,
  podeMudarStatusDoPedido,
  recebidoPorLinha,
  recebimentoParaConta,
  recebimentoParaMovimentos,
  recepcaoDoPedido,
  somarDias,
  totalDaLinha,
  totalDoPedido,
  validarLinhasDoRecebimento,
  validateOrder,
  validateReceipt,
  validateRequest,
} from "./purchaseDomain.js";

const linha = (id, quantity, unitPrice, extra = {}) => ({
  id,
  itemId: extra.itemId ?? `mat-${id}`,
  description: extra.description ?? "",
  unit: "UN",
  quantity,
  unitPrice,
  lineNumber: extra.lineNumber ?? 1,
});

const recebimento = (id, linhas, extra = {}) => ({
  id,
  orderId: extra.orderId || "po-1",
  warehouseId: extra.warehouseId || "matriz",
  kind: extra.kind || "recebimento",
  linhas,
  receivedAt: extra.receivedAt || "2026-03-10",
  documentNumber: extra.documentNumber || "",
  invoiceNumber: extra.invoiceNumber || "",
  archivedAt: extra.archivedAt,
});

describe("máquina de estados", () => {
  it("o pedido segue o caminho declarado", () => {
    expect(podeMudarStatusDoPedido("rascunho", "aprovado")).toBe(true);
    expect(podeMudarStatusDoPedido("aprovado", "enviado")).toBe(true);
    expect(podeMudarStatusDoPedido("enviado", "encerrado")).toBe(true);
  });

  it("encerrado e cancelado são terminais", () => {
    // Sem isso, um pedido já recebido e pago voltaria para rascunho.
    expect(podeMudarStatusDoPedido("encerrado", "rascunho")).toBe(false);
    expect(podeMudarStatusDoPedido("encerrado", "enviado")).toBe(false);
    expect(podeMudarStatusDoPedido("cancelado", "aprovado")).toBe(false);
  });

  it("não pula etapa: rascunho não vai direto a enviado", () => {
    expect(podeMudarStatusDoPedido("rascunho", "enviado")).toBe(false);
  });

  it("aprovado pode voltar a rascunho, para corrigir antes de enviar", () => {
    expect(podeMudarStatusDoPedido("aprovado", "rascunho")).toBe(true);
  });

  it("status desconhecido não abre caminho nenhum", () => {
    expect(podeMudarStatusDoPedido("inventado", "aprovado")).toBe(false);
    expect(podeMudarStatusDoPedido("rascunho", "inventado")).toBe(false);
  });

  it("a requisição recusada volta a rascunho, mas atendida é terminal", () => {
    expect(podeMudarStatusDaRequisicao("pendente", "aprovada")).toBe(true);
    expect(podeMudarStatusDaRequisicao("recusada", "rascunho")).toBe(true);
    expect(podeMudarStatusDaRequisicao("atendida", "rascunho")).toBe(false);
  });

  it("Suprimentos pode devolver, recusar ou direcionar à gestão o que está pendente", () => {
    expect(podeMudarStatusDaRequisicao("pendente", "devolvida")).toBe(true);
    expect(podeMudarStatusDaRequisicao("pendente", "em_gestao")).toBe(true);
    expect(podeMudarStatusDaRequisicao("pendente", "recusada")).toBe(true);
    // A devolvida volta ao requisitante, que reenvia; não vira aprovada direto.
    expect(podeMudarStatusDaRequisicao("devolvida", "pendente")).toBe(true);
    expect(podeMudarStatusDaRequisicao("devolvida", "aprovada")).toBe(false);
    // A gestão decide o que foi direcionado.
    expect(podeMudarStatusDaRequisicao("em_gestao", "aprovada")).toBe(true);
    expect(podeMudarStatusDaRequisicao("em_gestao", "devolvida")).toBe(true);
    expect(podeMudarStatusDaRequisicao("em_gestao", "recusada")).toBe(true);
  });
});

describe("totais", () => {
  it("soma linhas, frete e impostos e abate desconto", () => {
    const linhas = [linha("a", 10, 100), linha("b", 2, 50)];
    expect(totalDoPedido({ freight: 80, taxes: 20, discount: 100 }, linhas)).toMatchObject({
      subtotal: 1100, frete: 80, impostos: 20, desconto: 100, total: 1100,
    });
  });

  it("aceita número brasileiro em texto", () => {
    // "1.234,56" precisa valer mil duzentos e trinta e quatro, não 1,23456.
    expect(totalDaLinha({ quantity: "2", unitPrice: "1.234,56" })).toBeCloseTo(2469.12, 2);
    expect(totalDoPedido({ freight: "R$ 1.000,00" }, []).frete).toBe(1000);
  });

  it("total nunca é negativo, mesmo com desconto absurdo", () => {
    // Um total negativo viraria receita no financeiro.
    expect(totalDoPedido({ discount: 99999 }, [linha("a", 1, 10)]).total).toBe(0);
  });

  it("quantidade e preço negativos não geram crédito", () => {
    expect(totalDaLinha({ quantity: -5, unitPrice: 10 })).toBe(0);
    expect(totalDaLinha({ quantity: 5, unitPrice: -10 })).toBe(0);
  });

  it("pedido sem linhas soma zero", () => {
    expect(totalDoPedido({}, []).total).toBe(0);
  });
});

describe("aprovação por alçada", () => {
  it("exige aprovação acima do limite", () => {
    expect(exigeAprovacao(1000, 500)).toBe(true);
    expect(exigeAprovacao(400, 500)).toBe(false);
    expect(exigeAprovacao(500, 500)).toBe(false);
  });

  it("limite ausente exige aprovação — o padrão seguro", () => {
    // Campo vazio não pode virar "libera tudo".
    expect(exigeAprovacao(10, null)).toBe(true);
    expect(exigeAprovacao(10, undefined)).toBe(true);
    expect(exigeAprovacao(10, "")).toBe(true);
  });

  it("limite zero é escolha explícita de não exigir", () => {
    expect(exigeAprovacao(10, 0)).toBe(true);
    expect(exigeAprovacao(0, 0)).toBe(false);
  });

  it("limite inválido cai no seguro", () => {
    expect(exigeAprovacao(10, -1)).toBe(true);
    expect(exigeAprovacao(10, "abacaxi")).toBe(true);
  });

  it("editar o pedido depois de aprovado derruba a aprovação", () => {
    // Sem isso, aprovar R$ 1.000 e editar para R$ 50.000 passaria pela alçada.
    const linhas = [linha("a", 10, 100)];
    const pedido = { approvalStatus: "aprovada", approvedTotal: 1000 };
    expect(aprovacaoAindaVale(pedido, linhas)).toBe(true);
    expect(aprovacaoAindaVale(pedido, [linha("a", 500, 100)])).toBe(false);
  });

  it("tolera centavo de arredondamento, mas não diferença real", () => {
    const pedido = { approvalStatus: "aprovada", approvedTotal: 1000.005 };
    expect(aprovacaoAindaVale(pedido, [linha("a", 10, 100)])).toBe(true);
    expect(aprovacaoAindaVale({ approvalStatus: "aprovada", approvedTotal: 1000 }, [linha("a", 10, 100.1)])).toBe(false);
  });

  it("pedido não aprovado nunca vale como aprovado", () => {
    expect(aprovacaoAindaVale({ approvalStatus: "pendente", approvedTotal: 1000 }, [linha("a", 10, 100)])).toBe(false);
  });
});

describe("recebimento derivado", () => {
  const linhas = [linha("l1", 10, 100), linha("l2", 5, 20)];

  it("nada recebido é pendente, com percentual zero", () => {
    const recepcao = recepcaoDoPedido(linhas, []);
    expect(recepcao.situacao).toBe("pendente");
    expect(recepcao.totalRecebido).toBe(0);
    expect(recepcao.percentual).toBe(0);
  });

  it("recebimento parcial soma e aponta o que falta", () => {
    const recepcao = recepcaoDoPedido(linhas, [
      recebimento("r1", [{ orderItemId: "l1", quantidade: 4 }]),
    ]);
    expect(recepcao.situacao).toBe("parcial");
    expect(recepcao.linhas.find((l) => l.orderItemId === "l1")).toMatchObject({ recebida: 4, pendente: 6 });
    expect(recepcao.percentual).toBe(27);
  });

  it("vários recebimentos somam até fechar", () => {
    const recepcao = recepcaoDoPedido(linhas, [
      recebimento("r1", [{ orderItemId: "l1", quantidade: 6 }]),
      recebimento("r2", [{ orderItemId: "l1", quantidade: 4 }, { orderItemId: "l2", quantidade: 5 }]),
    ]);
    expect(recepcao.situacao).toBe("completo");
    expect(recepcao.percentual).toBe(100);
  });

  it("excedente é informado, não escondido", () => {
    const recepcao = recepcaoDoPedido(linhas, [
      recebimento("r1", [{ orderItemId: "l1", quantidade: 12 }]),
    ]);
    expect(recepcao.situacao).toBe("excedente");
    expect(recepcao.linhas.find((l) => l.orderItemId === "l1")).toMatchObject({ excedente: 2, pendente: 0 });
  });

  it("devolução abate o recebido", () => {
    const recepcao = recepcaoDoPedido(linhas, [
      recebimento("r1", [{ orderItemId: "l1", quantidade: 10 }]),
      recebimento("r2", [{ orderItemId: "l1", quantidade: 3 }], { kind: "devolucao" }),
    ]);
    expect(recepcao.linhas.find((l) => l.orderItemId === "l1")).toMatchObject({ recebida: 7, pendente: 3 });
  });

  it("recebimento arquivado não conta", () => {
    const recepcao = recepcaoDoPedido(linhas, [
      recebimento("r1", [{ orderItemId: "l1", quantidade: 10 }], { archivedAt: "2026-04-01" }),
    ]);
    expect(recepcao.totalRecebido).toBe(0);
  });

  it("percentual é null quando não há o que receber, não zero", () => {
    // Zero diria "nada chegou"; null diz "não se aplica".
    expect(recepcaoDoPedido([], []).percentual).toBeNull();
  });

  it("recebidoPorLinha ignora linha sem id", () => {
    const mapa = recebidoPorLinha([recebimento("r1", [{ quantidade: 5 }, { orderItemId: "l1", quantidade: 2 }])]);
    expect(mapa.get("")).toBeUndefined();
    expect(mapa.get("l1")).toBe(2);
  });
});

describe("validação do recebimento contra o pedido", () => {
  const linhas = [linha("l1", 10, 100)];

  it("recusa receber mais do que falta", () => {
    const erro = validarLinhasDoRecebimento([{ orderItemId: "l1", quantidade: 11 }], linhas, []);
    expect(erro).toMatch(/pendente/i);
  });

  it("aceita exatamente o que falta", () => {
    expect(validarLinhasDoRecebimento([{ orderItemId: "l1", quantidade: 10 }], linhas, [])).toBe("");
  });

  it("considera o que já foi recebido antes", () => {
    const anteriores = [recebimento("r1", [{ orderItemId: "l1", quantidade: 7 }])];
    expect(validarLinhasDoRecebimento([{ orderItemId: "l1", quantidade: 3 }], linhas, anteriores)).toBe("");
    expect(validarLinhasDoRecebimento([{ orderItemId: "l1", quantidade: 4 }], linhas, anteriores)).toMatch(/pendente/i);
  });

  it("recusa devolver mais do que foi recebido", () => {
    // Devolver mais do que chegou criaria estoque negativo a partir de uma
    // correção.
    const anteriores = [recebimento("r1", [{ orderItemId: "l1", quantidade: 4 }])];
    expect(validarLinhasDoRecebimento([{ orderItemId: "l1", quantidade: 5 }], linhas, anteriores, "devolucao"))
      .toMatch(/devolver/i);
    expect(validarLinhasDoRecebimento([{ orderItemId: "l1", quantidade: 4 }], linhas, anteriores, "devolucao"))
      .toBe("");
  });

  it("recusa linha que não é do pedido", () => {
    expect(validarLinhasDoRecebimento([{ orderItemId: "outra", quantidade: 1 }], linhas, []))
      .toMatch(/não pertence/i);
  });

  it("exige ao menos uma quantidade informada", () => {
    expect(validarLinhasDoRecebimento([{ orderItemId: "l1", quantidade: 0 }], linhas, []))
      .toMatch(/ao menos um/i);
    expect(validarLinhasDoRecebimento([], linhas, [])).toMatch(/ao menos um/i);
  });
});

describe("recebimento → movimentos de estoque", () => {
  const linhas = [linha("l1", 10, 100), linha("l2", 5, 20, { itemId: "", description: "Serviço de instalação" })];

  it("gera entrada com o custo do pedido", () => {
    const movimentos = recebimentoParaMovimentos(
      recebimento("r1", [{ orderItemId: "l1", quantidade: 4 }]),
      linhas,
    );
    expect(movimentos).toHaveLength(1);
    expect(movimentos[0]).toMatchObject({
      itemId: "mat-l1", kind: "entrada", quantity: 4, unitCost: 100,
      originType: "recebimento", originId: "r1", occurredAt: "2026-03-10",
    });
  });

  it("linha de serviço não movimenta estoque", () => {
    // Forçar movimento criaria saldo de algo que não existe fisicamente.
    const movimentos = recebimentoParaMovimentos(
      recebimento("r1", [{ orderItemId: "l2", quantidade: 5 }]),
      linhas,
    );
    expect(movimentos).toHaveLength(0);
  });

  it("devolução vira saída sem custo", () => {
    const movimentos = recebimentoParaMovimentos(
      recebimento("r1", [{ orderItemId: "l1", quantidade: 2 }], { kind: "devolucao" }),
      linhas,
    );
    expect(movimentos[0]).toMatchObject({ kind: "saida", quantity: 2, unitCost: 0 });
  });

  it("ignora quantidade zero", () => {
    expect(recebimentoParaMovimentos(recebimento("r1", [{ orderItemId: "l1", quantidade: 0 }]), linhas))
      .toHaveLength(0);
  });
});

describe("recebimento → conta a pagar", () => {
  const linhas = [linha("l1", 10, 100)];
  const pedido = { id: "po-1", supplierName: "Transportes Alfa", paymentTermDays: 30, costCenterId: "cc-1" };

  it("monta o título com vencimento contado do recebimento", () => {
    const conta = recebimentoParaConta(
      recebimento("r1", [{ orderItemId: "l1", quantidade: 4 }], { invoiceNumber: "12345" }),
      pedido,
      linhas,
    );
    expect(conta).toMatchObject({
      kind: "cost",
      categoria: "Compras",
      valor: 400,
      contraparte: "Transportes Alfa",
      numeroDocumento: "12345",
      centroCusto: "cc-1",
      vencimentoEm: "2026-04-09",
      mesReferencia: "2026-03",
      statusFinanceiro: "pending",
    });
    expect(conta.campos).toMatchObject({ sourceReceiptId: "r1", sourcePurchaseOrderId: "po-1" });
  });

  it("sem prazo, vence no dia do recebimento", () => {
    const conta = recebimentoParaConta(
      recebimento("r1", [{ orderItemId: "l1", quantidade: 1 }]),
      { ...pedido, paymentTermDays: 0 },
      linhas,
    );
    expect(conta.vencimentoEm).toBe("2026-03-10");
  });

  it("devolução não gera título automático", () => {
    // O abatimento é decisão de quem confere a fatura, não crédito automático.
    expect(recebimentoParaConta(
      recebimento("r1", [{ orderItemId: "l1", quantidade: 2 }], { kind: "devolucao" }),
      pedido,
      linhas,
    )).toBeNull();
  });

  it("valor zero não gera título", () => {
    expect(recebimentoParaConta(
      recebimento("r1", [{ orderItemId: "l1", quantidade: 1 }]),
      pedido,
      [linha("l1", 10, 0)],
    )).toBeNull();
  });
});

describe("somarDias", () => {
  it("vira o mês e o ano", () => {
    expect(somarDias("2026-01-31", 1)).toBe("2026-02-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("aceita data com hora e recusa lixo", () => {
    expect(somarDias("2026-03-10T15:00:00.000Z", 5)).toBe("2026-03-15");
    expect(somarDias("", 5)).toBe("");
    expect(somarDias("10/03/2026", 5)).toBe("");
  });

  it("aceita dias zero e negativo", () => {
    expect(somarDias("2026-03-10", 0)).toBe("2026-03-10");
    expect(somarDias("2026-03-10", -10)).toBe("2026-02-28");
  });
});

describe("requisição → linhas do pedido", () => {
  it("copia material, quantidade e unidade, e deixa o preço em branco", () => {
    // Preço é decisão da cotação; preenchê-lo aqui inventaria número.
    const linhas = linhasDoPedidoDaRequisicao({
      items: [
        { itemId: "mat-1", quantidade: 10, unidade: "UN" },
        { descricao: "Serviço", quantidade: "2" },
      ],
    });
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ itemId: "mat-1", quantity: 10, unitPrice: 0, lineNumber: 1 });
    expect(linhas[1]).toMatchObject({ description: "Serviço", quantity: 2, lineNumber: 2 });
  });

  it("descarta item sem quantidade ou sem identificação", () => {
    expect(linhasDoPedidoDaRequisicao({
      items: [{ itemId: "mat-1", quantidade: 0 }, { quantidade: 5 }],
    })).toHaveLength(0);
  });
});

describe("validação de cadastro", () => {
  it("requisição exige título e item válido", () => {
    expect(validateRequest({ title: "Pneus", items: [{ itemId: "m", quantidade: 4 }] })).toBe("");
    expect(validateRequest({ items: [{ itemId: "m", quantidade: 4 }] })).toMatch(/pedido/i);
    expect(validateRequest({ title: "Pneus", items: [] })).toMatch(/ao menos um item/i);
    expect(validateRequest({ title: "Pneus", items: [{ quantidade: 0 }] })).toMatch(/quantidade/i);
  });

  it("pedido exige fornecedor e linhas consistentes", () => {
    const linhas = [linha("l1", 10, 100)];
    expect(validateOrder({ supplierPartyId: "p1" }, linhas)).toBe("");
    expect(validateOrder({}, linhas)).toMatch(/fornecedor/i);
    expect(validateOrder({ supplierPartyId: "p1" }, [])).toMatch(/ao menos um item/i);
    expect(validateOrder({ supplierPartyId: "p1" }, [linha("l1", 0, 100)])).toMatch(/quantidade/i);
    expect(validateOrder({ supplierPartyId: "p1" }, [{ id: "x", quantity: 1 }])).toMatch(/descrição/i);
    expect(validateOrder({ supplierPartyId: "p1", paymentTermDays: -1 }, linhas)).toMatch(/prazo/i);
  });

  it("recebimento exige pedido, depósito e data", () => {
    const ok = { orderId: "po", warehouseId: "m", receivedAt: "2026-03-10" };
    expect(validateReceipt(ok)).toBe("");
    expect(validateReceipt({ ...ok, orderId: "" })).toMatch(/pedido/i);
    expect(validateReceipt({ ...ok, warehouseId: "" })).toMatch(/depósito/i);
    expect(validateReceipt({ ...ok, receivedAt: "" })).toMatch(/data/i);
  });

  it("recebimento recusa chave de NF-e com tamanho errado", () => {
    // 43 dígitos só apareceriam como problema meses depois, quando o XML não
    // casasse.
    const ok = { orderId: "po", warehouseId: "m", receivedAt: "2026-03-10" };
    expect(validateReceipt({ ...ok, invoiceKey: "1".repeat(43) })).toMatch(/44/);
    expect(validateReceipt({ ...ok, invoiceKey: "1".repeat(44) })).toBe("");
    expect(validateReceipt({ ...ok, invoiceKey: "" })).toBe("");
  });
});

describe("previsaoDeCompra", () => {
  const itens = [
    { id: "i1", nome: "Pneu 295/80", estoqueMinimo: 10, custoReferencia: 1500 },
    { id: "i2", nome: "Óleo lubrificante", estoqueMinimo: 20, custoReferencia: 50 },
    { id: "i3", nome: "Filtro de ar", estoqueMinimo: 5, custoReferencia: 80 },
  ];
  // Saldos por movimento: i1=2 (baixo), i2=0 (sem estoque), i3=30 (normal).
  const movimentos = [
    { itemId: "i1", kind: "entrada", quantity: 2 },
    { itemId: "i3", kind: "entrada", quantity: 30 },
  ];

  it("sugere reposição só para itens abaixo do mínimo, com custo estimado", () => {
    const previsao = previsaoDeCompra(itens, movimentos);
    expect(previsao.itens).toBe(2); // i1 e i2; i3 está normal
    const ids = previsao.linhas.map((linha) => linha.id);
    expect(ids).not.toContain("i3");

    const pneu = previsao.linhas.find((linha) => linha.id === "i1");
    // sugestão = 2*mínimo - saldo = 2*10 - 2 = 18; custo = 18 * 1500
    expect(pneu.sugerido).toBe(18);
    expect(pneu.custoEstimado).toBe(18 * 1500);

    const oleo = previsao.linhas.find((linha) => linha.id === "i2");
    // 2*20 - 0 = 40; custo = 40 * 50
    expect(oleo.sugerido).toBe(40);
    expect(oleo.custoEstimado).toBe(40 * 50);

    // Total = maior custo primeiro; soma dos dois.
    expect(previsao.linhas[0].id).toBe("i1");
    expect(previsao.totalEstimado).toBe(18 * 1500 + 40 * 50);
  });

  it("devolve vazio quando não há itens nem movimentos", () => {
    expect(previsaoDeCompra([], [])).toEqual({ linhas: [], itens: 0, totalEstimado: 0 });
  });
});
