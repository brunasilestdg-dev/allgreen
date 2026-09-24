import { describe, expect, it } from "vitest";
import {
  STATUS_SOLICITACAO,
  TIPOS_LISTA,
  TIPOS_SOLICITACAO,
  aplicarTransicao,
  filaDaEquipe,
  indicadoresDaEquipe,
  prazoDaSolicitacao,
  resumoParaCliente,
  situacaoDoPrazo,
  tipoDaEncomendaPermitido,
  tiposDaEncomenda,
  tiposGerais,
  transicaoPermitida,
  validarSolicitacao,
} from "./clientRequestDomain.js";

const HORA = 3600000;
const AGORA = new Date("2026-03-10T12:00:00.000Z").getTime();

const pedido = (extra = {}) => ({
  id: "req-1",
  tipo: "nova_rota",
  status: "aberta",
  urgencia: "normal",
  prazoEm: new Date(AGORA + 24 * HORA).toISOString(),
  ...extra,
});

describe("solicitações amarradas à encomenda", () => {
  it("antes da entrega: oferece devolução e alteração de endereço, não acareação", () => {
    const ids = tiposDaEncomenda(false).map((t) => t.id);
    expect(ids).toEqual(["devolucao", "alteracao_endereco"]);
    expect(ids).not.toContain("acareacao");
  });

  it("depois da entrega: oferece só acareação", () => {
    const ids = tiposDaEncomenda(true).map((t) => t.id);
    expect(ids).toEqual(["acareacao"]);
  });

  it("a fase da encomenda decide o que é permitido — não confia no corpo enviado", () => {
    expect(tipoDaEncomendaPermitido("devolucao", false)).toBe(true);
    expect(tipoDaEncomendaPermitido("acareacao", false)).toBe(false); // entregue? não
    expect(tipoDaEncomendaPermitido("acareacao", true)).toBe(true);
    expect(tipoDaEncomendaPermitido("devolucao", true)).toBe(false); // já entregue
    // Tipo geral nunca é um pedido de encomenda.
    expect(tipoDaEncomendaPermitido("nova_rota", false)).toBe(false);
  });

  it("a caixa geral não oferece os tipos de encomenda", () => {
    const ids = tiposGerais().map((t) => t.id);
    expect(ids).not.toContain("devolucao");
    expect(ids).not.toContain("acareacao");
    expect(ids).toContain("nova_rota");
  });

  it("cada tipo de encomenda exige o campo que o torna respondível", () => {
    const devSemMotivo = validarSolicitacao({
      tipo: "devolucao", assunto: "Solicitação de devolução",
      descricao: "Quero devolver esta encomenda.", campos: {},
    });
    expect(devSemMotivo.valido).toBe(false);
    const devComMotivo = validarSolicitacao({
      tipo: "devolucao", assunto: "Solicitação de devolução",
      descricao: "Produto veio errado.", campos: { motivo: "Produto errado" },
    });
    expect(devComMotivo.valido).toBe(true);
    const endSemEndereco = validarSolicitacao({
      tipo: "alteracao_endereco", assunto: "Alteração de endereço",
      descricao: "Preciso mudar o endereço.", campos: {},
    });
    expect(endSemEndereco.valido).toBe(false);
  });
});

describe("catálogo de tipos", () => {
  it("todo tipo tem prazo, rótulo e explicação", () => {
    for (const tipo of TIPOS_LISTA) {
      expect(tipo.rotulo).toBeTruthy();
      expect(tipo.descricao).toBeTruthy();
      expect(tipo.prazoHoras).toBeGreaterThan(0);
    }
  });

  it("todo campo obrigatório tem rótulo em português para a mensagem de erro", () => {
    for (const tipo of TIPOS_LISTA) {
      for (const chave of tipo.obrigatorios) {
        expect(tipo.camposRotulo[chave]).toBeTruthy();
      }
    }
  });

  it("ocorrência é o pedido mais urgente do catálogo", () => {
    const prazos = TIPOS_LISTA.map((t) => t.prazoHoras);
    expect(TIPOS_SOLICITACAO.ocorrencia.prazoHoras).toBe(Math.min(...prazos));
  });
});

describe("abertura da solicitação", () => {
  const valida = {
    tipo: "nova_rota",
    assunto: "Incluir trecho Campinas → Ribeirão",
    descricao: "Precisamos atender a nova filial a partir de abril.",
    campos: { origem: "Campinas", destino: "Ribeirão Preto" },
  };

  it("aceita o pedido completo e devolve normalizado", () => {
    const r = validarSolicitacao(valida);
    expect(r.valido).toBe(true);
    expect(r.limpo.tipo).toBe("nova_rota");
    expect(r.limpo.urgencia).toBe("normal");
    expect(r.limpo.campos.origem).toBe("Campinas");
  });

  it("recusa nova rota sem origem e destino, com o nome que o cliente viu", () => {
    const r = validarSolicitacao({ ...valida, campos: {} });
    expect(r.valido).toBe(false);
    expect(r.erros.join(" ")).toMatch(/Origem é obrigatório/);
    expect(r.erros.join(" ")).toMatch(/Destino é obrigatório/);
    // Erro que cita "origem" a seco manda o cliente procurar um campo que não
    // tem esse nome na tela.
    expect(r.erros.join(" ")).toMatch(/nova rota/i);
  });

  it("descrição curta demais não vira solicitação", () => {
    const r = validarSolicitacao({ ...valida, descricao: "urgente" });
    expect(r.valido).toBe(false);
    expect(r.erros.join(" ")).toMatch(/pelo menos 10 caracteres/);
  });

  it("assunto vazio é recusado", () => {
    expect(validarSolicitacao({ ...valida, assunto: "  " }).valido).toBe(false);
  });

  it("tipo desconhecido vira 'outro' em vez de quebrar", () => {
    const r = validarSolicitacao({ ...valida, tipo: "hackeado", campos: {} });
    expect(r.limpo.tipo).toBe("outro");
    expect(r.valido).toBe(true);
  });

  it("urgência inventada volta para normal", () => {
    expect(validarSolicitacao({ ...valida, urgencia: "altíssima" }).limpo.urgencia).toBe(
      "normal",
    );
  });

  it("campo vazio não entra no registro", () => {
    const r = validarSolicitacao({
      ...valida,
      campos: { origem: "Campinas", destino: "Ribeirão", observacao: "   " },
    });
    expect(r.limpo.campos).not.toHaveProperty("observacao");
  });

  it("texto gigante é cortado, não recusado silenciosamente", () => {
    const r = validarSolicitacao({ ...valida, descricao: "a".repeat(5000) });
    expect(r.valido).toBe(false);
    expect(r.erros.join(" ")).toMatch(/4000/);
  });
});

describe("prazo", () => {
  it("nasce do tipo do pedido", () => {
    const prazo = prazoDaSolicitacao("ocorrencia", "normal", AGORA);
    expect(new Date(prazo).getTime() - AGORA).toBe(4 * HORA);
  });

  it("urgência alta corta o prazo pela metade", () => {
    const prazo = prazoDaSolicitacao("nova_rota", "alta", AGORA);
    expect(new Date(prazo).getTime() - AGORA).toBe(24 * HORA);
  });

  it("urgência baixa não estica o prazo", () => {
    const baixa = prazoDaSolicitacao("nova_rota", "baixa", AGORA);
    const normal = prazoDaSolicitacao("nova_rota", "normal", AGORA);
    expect(baixa).toBe(normal);
  });

  it("marca atraso sem ninguém precisar declarar", () => {
    const vencido = pedido({ prazoEm: new Date(AGORA - HORA).toISOString() });
    expect(situacaoDoPrazo(vencido, AGORA)).toMatchObject({
      estado: "atrasada",
      emAtraso: true,
    });
  });

  it("avisa antes de vencer", () => {
    const quase = pedido({ prazoEm: new Date(AGORA + 2 * HORA).toISOString() });
    expect(situacaoDoPrazo(quase, AGORA).estado).toBe("vencendo");
  });

  it("o relógio da equipe para quando a bola está com o cliente", () => {
    const esperando = pedido({
      status: "aguardando_cliente",
      prazoEm: new Date(AGORA - 10 * HORA).toISOString(),
    });
    // Cobrar a equipe pela demora do cliente destrói a confiança no indicador.
    expect(situacaoDoPrazo(esperando, AGORA).emAtraso).toBe(false);
    expect(situacaoDoPrazo(esperando, AGORA).estado).toBe("com-o-cliente");
  });

  it("pedido encerrado não acumula atraso para sempre", () => {
    const fechado = pedido({
      status: "concluida",
      prazoEm: new Date(AGORA - 500 * HORA).toISOString(),
    });
    expect(situacaoDoPrazo(fechado, AGORA).emAtraso).toBe(false);
  });
});

describe("máquina de estados", () => {
  it("o cliente não fecha o pedido como concluído antes de ser respondido", () => {
    expect(transicaoPermitida("cliente", "aberta", "concluida")).toBe(false);
    expect(transicaoPermitida("cliente", "respondida", "concluida")).toBe(true);
  });

  it("o cliente pode cancelar o que abriu", () => {
    expect(transicaoPermitida("cliente", "aberta", "cancelada")).toBe(true);
    expect(transicaoPermitida("cliente", "em_analise", "cancelada")).toBe(true);
  });

  it("a equipe não reabre pedido encerrado para zerar o relógio", () => {
    expect(transicaoPermitida("equipe", "concluida", "aberta")).toBe(false);
    expect(transicaoPermitida("equipe", "recusada", "em_analise")).toBe(false);
    expect(transicaoPermitida("equipe", "cancelada", "aberta")).toBe(false);
  });

  it("o cliente não empurra o pedido para dentro do fluxo da equipe", () => {
    expect(transicaoPermitida("cliente", "aberta", "em_analise")).toBe(false);
    expect(transicaoPermitida("cliente", "aberta", "respondida")).toBe(false);
  });

  it("transição negada explica em português o que foi tentado", () => {
    const r = aplicarTransicao(pedido(), { lado: "cliente", para: "concluida" });
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/Aberta/);
    expect(r.erro).toMatch(/Concluída/);
  });

  it("encerramento guarda quem encerrou e quando", () => {
    const r = aplicarTransicao(pedido({ status: "respondida" }), {
      lado: "cliente",
      para: "concluida",
      autor: "cliente@empresa.com",
    });
    expect(r.ok).toBe(true);
    expect(r.encerradoPor).toBe("cliente@empresa.com");
    expect(r.encerradoEm).toBeTruthy();
  });

  it("transição intermediária não marca encerramento", () => {
    const r = aplicarTransicao(pedido(), { lado: "equipe", para: "em_analise" });
    expect(r.ok).toBe(true);
    expect(r.encerradoEm).toBeNull();
  });

  it("lado desconhecido não move nada", () => {
    expect(aplicarTransicao(pedido(), { lado: "qualquer", para: "concluida" }).ok).toBe(false);
  });
});

describe("visão do cliente", () => {
  it("diz de quem é a vez, não só quantos pedidos existem", () => {
    const r = resumoParaCliente(
      [pedido({ status: "aguardando_cliente" }), pedido({ id: "r2", status: "em_analise" })],
      AGORA,
    );
    expect(r.abertas).toBe(2);
    expect(r.aguardandoVoce).toBe(1);
    expect(r.texto).toMatch(/esperando uma resposta sua/);
  });

  it("quando a bola é da equipe, o texto não cobra o cliente", () => {
    const r = resumoParaCliente([pedido({ status: "em_analise" })], AGORA);
    expect(r.aguardandoVoce).toBe(0);
    expect(r.texto).toMatch(/com a equipe To Do Green/);
  });

  it("sem pedido em aberto, diz isso claramente", () => {
    expect(resumoParaCliente([pedido({ status: "concluida" })], AGORA).texto).toMatch(
      /Nenhuma solicitação em aberto/,
    );
  });

  it("caixa vazia não quebra", () => {
    expect(resumoParaCliente([], AGORA).abertas).toBe(0);
  });
});

describe("fila da equipe", () => {
  const carteira = () => [
    pedido({ id: "no-prazo", prazoEm: new Date(AGORA + 40 * HORA).toISOString() }),
    pedido({ id: "atrasado", prazoEm: new Date(AGORA - 5 * HORA).toISOString() }),
    pedido({ id: "vencendo", prazoEm: new Date(AGORA + 2 * HORA).toISOString() }),
    pedido({ id: "com-cliente", status: "aguardando_cliente" }),
    pedido({ id: "fechado", status: "concluida" }),
  ];

  it("o que estourou vem primeiro, depois o que estoura antes", () => {
    const fila = filaDaEquipe(carteira(), AGORA).map((s) => s.id);
    expect(fila).toEqual(["atrasado", "vencendo", "no-prazo"]);
  });

  it("o que está com o cliente sai da fila da equipe", () => {
    expect(filaDaEquipe(carteira(), AGORA).map((s) => s.id)).not.toContain("com-cliente");
  });

  it("pedido encerrado não volta para a fila", () => {
    expect(filaDaEquipe(carteira(), AGORA).map((s) => s.id)).not.toContain("fechado");
  });

  it("pontualidade só existe quando há pedido encerrado medível", () => {
    // A carteira tem um pedido concluído sem data de encerramento: contá-lo
    // como atraso puniria a equipe por um registro incompleto.
    const indicadores = indicadoresDaEquipe(carteira(), AGORA);
    expect(indicadores.encerradas).toBe(1);
    expect(indicadores.semDataDeEncerramento).toBe(1);
    expect(indicadores.pontualidadePercent).toBeNull();
  });

  it("pontualidade compara o encerramento com o prazo que o pedido tinha", () => {
    const historico = [
      pedido({
        id: "a",
        status: "concluida",
        prazoEm: new Date(AGORA - 10 * HORA).toISOString(),
        encerradoEm: new Date(AGORA - 12 * HORA).toISOString(),
      }),
      pedido({
        id: "b",
        status: "concluida",
        prazoEm: new Date(AGORA - 10 * HORA).toISOString(),
        encerradoEm: new Date(AGORA - 2 * HORA).toISOString(),
      }),
    ];
    expect(indicadoresDaEquipe(historico, AGORA).pontualidadePercent).toBe(50);
  });

  it("conta o que está atrasado na fila", () => {
    expect(indicadoresDaEquipe(carteira(), AGORA).atrasadas).toBe(1);
  });
});

describe("status", () => {
  it("todo status tem rótulo legível para o cliente", () => {
    for (const status of Object.values(STATUS_SOLICITACAO)) {
      expect(status.rotulo).toBeTruthy();
      expect(status.rotulo).not.toMatch(/_/);
    }
  });
});
