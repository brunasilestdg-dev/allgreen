import { describe, expect, it } from "vitest";
import { TODO_GREEN_MODULE_CATALOG } from "./logisticsVerticalDomain.js";
import { MODULE_IMPLEMENTATION } from "./shell/catalogoDeModulos.js";
import { NOMES_DOS_ESPECIALISTAS, especialistaDaVertical } from "./todoGreenAiSpecialists.js";
import {
  ESPECIALISTA_POR_TELA,
  HABILIDADES,
  SEMENTE,
  atalhosDaTela,
  corpoDaPergunta,
  especialistaDaTela,
  textoDaProposta,
} from "./sementeDomain.js";

// O universo real de telas da vertical vem de duas fontes que já existem: o
// catálogo de módulos (que declara para onde cada item leva) e o mapa de
// implementação das telas (./shell/catalogoDeModulos.js). O mapa é dado puro,
// então entra por import — antes era lido como texto de dentro do componente,
// que arrastaria a árvore inteira para o teste.
const telasDoComponente = Object.keys(MODULE_IMPLEMENTATION);
const telasDoCatalogo = TODO_GREEN_MODULE_CATALOG.map((modulo) =>
  String(modulo.workspaceRoute || modulo.route).replace("/todogreen/", ""),
);
const TELAS_REAIS = new Set([...telasDoComponente, ...telasDoCatalogo]);

describe("quem responde por cada tela", () => {
  it("não mapeia tela que não existe na vertical", () => {
    // Um apelido inventado aqui não quebra nada visivelmente: a pessoa só
    // recebe o especialista errado, calada. Por isso o mapa é conferido contra
    // as telas reais em vez de contra si mesmo.
    const inventadas = Object.keys(ESPECIALISTA_POR_TELA).filter(
      (tela) => !TELAS_REAIS.has(tela),
    );
    expect(inventadas).toEqual([]);
  });

  it("todo especialista escolhido existe no registro da vertical", () => {
    // Nome fora do registro cai no "Consultor" genérico, e a resposta perde a
    // vertical — o defeito que a Central de Trabalho tinha.
    const foraDoRegistro = [...new Set(Object.values(ESPECIALISTA_POR_TELA))].filter(
      (nome) => !especialistaDaVertical(nome),
    );
    expect(foraDoRegistro).toEqual([]);
  });

  it("qualquer tela real resolve para um especialista registrado", () => {
    for (const tela of TELAS_REAIS) {
      expect(NOMES_DOS_ESPECIALISTAS).toContain(especialistaDaTela(tela));
    }
  });

  it("leva o assunto da tela, não um generalista", () => {
    expect(especialistaDaTela("precificacao")).toBe("Especialista em Precificação Logística");
    expect(especialistaDaTela("deal-desk")).toBe("Especialista em Precificação Logística");
    expect(especialistaDaTela("central-esg")).toBe("Especialista ESG");
    expect(especialistaDaTela("motorista-frota")).toBe("Especialista em Operações Logísticas");
    expect(especialistaDaTela("receita")).toBe("Especialista Financeiro");
  });

  it("sem tela conhecida atende o ERP, não só o comercial", () => {
    expect(especialistaDaTela(undefined)).toBe("Especialista em Operações Logísticas");
    expect(especialistaDaTela("")).toBe("Especialista em Operações Logísticas");
    expect(especialistaDaTela("tela-que-nao-existe")).toBe("Especialista em Operações Logísticas");
    expect(especialistaDaTela("  precificacao  ")).toBe("Especialista em Precificação Logística");
  });
});

describe("atalhos de abertura", () => {
  it("toda tela real abre com perguntas, não com campo vazio", () => {
    for (const tela of TELAS_REAIS) {
      const atalhos = atalhosDaTela(tela);
      expect(atalhos.length).toBeGreaterThanOrEqual(3);
      for (const atalho of atalhos) expect(atalho.trim().length).toBeGreaterThan(10);
    }
  });

  it("os atalhos mudam com o especialista", () => {
    expect(atalhosDaTela("precificacao")).not.toEqual(atalhosDaTela("esg"));
  });
});

describe("o corpo que vai para /api/todogreen/semente", () => {
  const base = { pergunta: "Onde a margem caiu?", tela: "precificacao" };

  it("recusa pergunta curta demais para significar alguma coisa", () => {
    expect(corpoDaPergunta({ pergunta: "oi" }).valido).toBe(false);
    expect(corpoDaPergunta({ pergunta: "  " }).corpo).toBeNull();
    expect(corpoDaPergunta().valido).toBe(false);
  });

  it("leva pergunta, tela e o cliente em foco quando há um", () => {
    const { valido, corpo } = corpoDaPergunta({ ...base, clienteId: "cli-9" });
    expect(valido).toBe(true);
    expect(corpo.pergunta).toBe("Onde a margem caiu?");
    expect(corpo.tela).toBe("precificacao");
    expect(corpo.clienteId).toBe("cli-9");
  });

  it("sem cliente em foco não inventa um", () => {
    expect(corpoDaPergunta(base).corpo.clienteId).toBeUndefined();
    expect(corpoDaPergunta({ ...base, clienteId: "  " }).corpo.clienteId).toBeUndefined();
  });

  it("leva a conversa anterior, senão cada pergunta nasce amnésica", () => {
    const { corpo } = corpoDaPergunta({
      ...base,
      historico: [
        { de: "voce", texto: "Quais contratos estão abaixo do piso?" },
        { de: "semente", texto: "Três: Alfa, Beta e Gama." },
      ],
    });
    expect(corpo.historico).toEqual([
      { role: "user", content: "Quais contratos estão abaixo do piso?" },
      { role: "assistant", content: "Três: Alfa, Beta e Gama." },
    ]);
  });

  it("não reenvia mensagem de erro como se fosse fala da assistente", () => {
    const { corpo } = corpoDaPergunta({
      ...base,
      historico: [
        { de: "voce", texto: "Pergunta que falhou" },
        { de: "semente", texto: "Cota mensal de IA esgotada.", falhou: true },
      ],
    });
    expect(corpo.historico.map((item) => item.content)).not.toContain(
      "Cota mensal de IA esgotada.",
    );
  });

  it("corta o histórico no limite combinado com o servidor", () => {
    const historico = Array.from({ length: 40 }, (_, indice) => ({
      de: indice % 2 === 0 ? "voce" : "semente",
      texto: `mensagem ${indice}`,
    }));
    expect(corpoDaPergunta({ ...base, historico }).corpo.historico).toHaveLength(8);
  });
});

describe("a proposta dita em português", () => {
  it("quem confirma lê exatamente o que vai acontecer", () => {
    // Botão "Confirmar" embaixo de um objeto ilegível é assinatura em branco.
    expect(
      textoDaProposta({ tipo: "criar_tarefa", titulo: "Ligar para compras", cliente: "Rede Alfa", prazo: "2026-08-20" }),
    ).toBe('Criar tarefa: "Ligar para compras" para Rede Alfa até 2026-08-20');
    expect(
      textoDaProposta({ tipo: "definir_proxima_acao", cliente: "Rede Alfa", acao: "Enviar proposta" }),
    ).toBe('Definir próxima ação de Rede Alfa: "Enviar proposta"');
    expect(textoDaProposta({ tipo: "pesquisar_empresa", cliente: "Rede Alfa" })).toBe(
      "Pesquisar Rede Alfa na web agora",
    );
  });

  it("abrir oportunidade lê o negócio, a conta e os números que a pessoa deu", () => {
    expect(
      textoDaProposta({ tipo: "criar_oportunidade", titulo: "Transferência CD Cajamar", cliente: "Rede Alfa" }),
    ).toBe('Abrir oportunidade "Transferência CD Cajamar" para Rede Alfa em Prospecção');
    const comNumeros = textoDaProposta({
      tipo: "criar_oportunidade",
      titulo: "Last mile SP",
      cliente: "Rede Alfa",
      valorMensal: 40000,
      distanciaKm: 120,
      viagensMes: 22,
      tipoVeiculo: "elétrico",
    });
    expect(comNumeros).toContain('Abrir oportunidade "Last mile SP" para Rede Alfa em Prospecção');
    expect(comNumeros).toContain("R$ 40000/mês");
    expect(comNumeros).toContain("120 km");
    expect(comNumeros).toContain("22 viagens/mês");
    expect(comNumeros).toContain("elétrico");
  });

  it("avançar oportunidade mostra de onde para onde ela vai no funil", () => {
    expect(
      textoDaProposta({ tipo: "avancar_oportunidade", cliente: "Rede Alfa", estagio: "Negociação", titulo: "Last mile SP" }),
    ).toBe('Avançar "Last mile SP" de Rede Alfa para Negociação');
    expect(
      textoDaProposta({ tipo: "avancar_oportunidade", cliente: "Rede Alfa", estagio: "Apresentação" }),
    ).toBe("Avançar a oportunidade de Rede Alfa para Apresentação");
  });

  it("o aprendizado mostra o texto INTEIRO que vai virar conhecimento", () => {
    // Nas outras ações confere-se um título; nesta a pessoa autoriza o
    // assistente a AFIRMAR aquilo para todo o espaço. Resumir seria pedir
    // assinatura no que ela não leu.
    const texto = textoDaProposta({
      tipo: "aprender",
      titulo: "Nova base em Curitiba",
      conteudo: "A base de Curitiba abriu em agosto de 2026 com 12 vans elétricas.",
      fonte: "Paula, na reunião de 31/08",
      sigilo: "interno",
    });
    expect(texto).toContain("Guardar no dossiê da To Do Green");
    expect(texto).toContain("A base de Curitiba abriu em agosto de 2026 com 12 vans elétricas.");
    expect(texto).toContain("fonte: Paula, na reunião de 31/08");
    expect(texto).toContain("sigilo: interno");
    expect(texto).not.toBe("Ação desconhecida — não confirme.");
  });

  it("tipo desconhecido manda não confirmar em vez de fingir que entendeu", () => {
    expect(textoDaProposta({ tipo: "apagar_tudo" })).toBe("Ação desconhecida — não confirme.");
    expect(textoDaProposta()).toBe("Ação desconhecida — não confirme.");
  });
});

describe("identidade do Todô", () => {
  it("carrega o nome, a assinatura e o lema da marca", () => {
    expect(SEMENTE.nome).toBe("Todô");
    expect(SEMENTE.assinatura).toBe("Assistente da plataforma");
    expect(SEMENTE.lema.length).toBeGreaterThan(10);
    expect(SEMENTE.saudacao.length).toBeGreaterThan(40);
  });

  it("anuncia só o que ela realmente faz", () => {
    expect(HABILIDADES).toContain("Preço");
    expect(HABILIDADES).toContain("Operação");
    expect(HABILIDADES).toContain("Notícias/RFQs");
    expect(HABILIDADES.length).toBe(6);
  });
});
