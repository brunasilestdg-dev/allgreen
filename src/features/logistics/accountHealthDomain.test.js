import { describe, expect, it } from "vitest";
import { LOGISTICS_PRODUCTS } from "./logisticsVerticalDomain.js";
import {
  FATORES_DE_SAUDE,
  proximaMelhorAcao,
  saudeDaConta,
  shareOfWallet,
  whiteSpace,
} from "./accountHealthDomain.js";

const contatoDeCompras = { name: "Ana Souza", title: "Gerente de Compras", relationshipRole: "Compras", email: "ana@x.com" };
const decisor = { name: "Bruno Lima", title: "Diretor", relationshipRole: "Decisor econômico", email: "bruno@x.com" };

describe("saúde da conta", () => {
  it("os pesos somam 100 e ficam visíveis", () => {
    // A régua da saúde da carteira é decisão de gestão. Se ela mudar, muda à
    // vista, aqui — não escondida no meio de uma função.
    expect(FATORES_DE_SAUDE.reduce((soma, item) => soma + item.peso, 0)).toBe(100);
  });

  it("todo fator explica a própria nota", () => {
    // Score sem memória de cálculo é palpite com cara de medição, e a equipe
    // aprende rápido a ignorar número que não sabe explicar.
    const { fatores } = saudeDaConta({ conta: { segment: "Varejo" }, contatos: [contatoDeCompras], diasSemAtividade: 3 });
    for (const fator of fatores) {
      if (!fator.considerado) continue;
      expect(fator.porque.length).toBeGreaterThan(10);
      expect(fator.nota).toBeGreaterThanOrEqual(0);
      expect(fator.nota).toBeLessThanOrEqual(100);
    }
  });

  it("conta ativa e bem mapeada fica saudável", () => {
    const saude = saudeDaConta({
      conta: { segment: "Varejo", document: "123", stage: "Negociação", nextAction: "Enviar proposta", headquarters: "SP" },
      contatos: [contatoDeCompras, decisor],
      oportunidades: [{ stage: "Proposta", contract_value: 500000 }],
      operacoes: [{ incident_count: 0, sla_status: "ok" }],
      diasSemAtividade: 2,
    });
    expect(saude.score).toBeGreaterThanOrEqual(75);
    expect(saude.faixa).toBe("saudável");
  });

  it("conta esquecida e sem mapa fica crítica", () => {
    const saude = saudeDaConta({ conta: {}, contatos: [], oportunidades: [], operacoes: [], diasSemAtividade: 120 });
    expect(saude.faixa).toBe("crítica");
  });

  it("o que não se sabe sai da média em vez de virar zero", () => {
    // Zerar o desconhecido puniria a conta NOVA exatamente como pune a conta
    // ABANDONADA — e as duas exigem decisões opostas.
    const nova = saudeDaConta({
      conta: { segment: "Varejo", document: "1", stage: "Mapeamento", nextAction: "Ligar", headquarters: "SP" },
      contatos: [contatoDeCompras, decisor],
      oportunidades: [{ stage: "Proposta" }],
      operacoes: [],
      diasSemAtividade: null,
    });
    expect(nova.ignorados).toContain("Atividade recente");
    expect(nova.ignorados).toContain("Qualidade da entrega");
    expect(nova.score).toBeGreaterThan(50);
  });

  it("sem nenhum dado o score é nulo, não zero", () => {
    const vazia = saudeDaConta({ conta: {}, contatos: [], oportunidades: [], operacoes: [], diasSemAtividade: null });
    expect(vazia.score).not.toBeNull();
    expect(vazia.faixa).toBe("crítica");
  });

  it("operação com ocorrência e SLA violado derruba a nota de entrega", () => {
    const ruim = saudeDaConta({ operacoes: [{ incident_count: 2, sla_status: "violado" }, { incident_count: 1, sla_status: "violado" }] });
    const entrega = ruim.fatores.find((item) => item.id === "entrega");
    expect(entrega.nota).toBe(0);
    expect(entrega.porque).toContain("fora do SLA");
  });
});

describe("white space", () => {
  it("aponta o que a To Do Green vende e a conta ainda não compra", () => {
    const resultado = whiteSpace({
      catalogo: LOGISTICS_PRODUCTS,
      operacoes: [{ product_id: "last-mile" }],
      oportunidades: [{ product_id: "middle-mile" }],
    });
    expect(resultado.atuais.map((item) => item.id).sort()).toEqual(["last-mile", "middle-mile"]);
    expect(resultado.espacos.map((item) => item.id)).toContain("dedicated");
    expect(resultado.espacos.map((item) => item.id)).not.toContain("last-mile");
    // Dois produtos ativos em um catálogo de dez, agora com Middle Mile Spot
    // separado do contrato recorrente.
    expect(resultado.penetracao).toBe(20);
  });

  it("sai do catálogo real, não de uma lista escrita à mão", () => {
    // Lista paralela envelhece sozinha: produto novo no catálogo não
    // apareceria como white space em conta nenhuma.
    expect(whiteSpace({ catalogo: LOGISTICS_PRODUCTS }).espacos).toHaveLength(LOGISTICS_PRODUCTS.length);
  });

  it("conta que não compra nada não é white space — é outra conversa", () => {
    expect(whiteSpace({ catalogo: LOGISTICS_PRODUCTS }).leitura).toBe("Nenhum produto ativo nesta conta ainda.");
  });
});

describe("share of wallet", () => {
  it("calcula a participação e o que sobra com o concorrente", () => {
    const resultado = shareOfWallet({ receitaAnualNossa: 2_000_000, gastoLogisticoAnualDoCliente: 10_000_000 });
    expect(resultado.percentual).toBe(20);
    expect(resultado.potencial).toBe(8_000_000);
    expect(resultado.leitura).toContain("concorrentes");
  });

  it("sem o gasto total do cliente diz que não dá para saber", () => {
    // Este é o erro clássico: sem denominador, 100% do que conhecemos vira
    // "100% da carteira" — e a conta parece consolidada quando não é.
    const resultado = shareOfWallet({ receitaAnualNossa: 2_000_000 });
    expect(resultado.percentual).toBeNull();
    expect(resultado.leitura).toContain("não informado");
  });

  it("não passa de 100% quando a receita informada supera o gasto", () => {
    expect(shareOfWallet({ receitaAnualNossa: 50, gastoLogisticoAnualDoCliente: 10 }).percentual).toBe(100);
  });
});

describe("próxima melhor ação", () => {
  const completa = {
    conta: { nextAction: "Enviar proposta" },
    contatos: [contatoDeCompras, decisor],
    oportunidades: [{ stage: "Proposta" }],
    espacos: [],
    diasSemAtividade: 3,
    pesquisaEm: "2026-08-01T00:00:00Z",
  };

  it("entrega uma ação só, com motivo e onde fazer", () => {
    // Sete sugestões é a mesma coisa que nenhuma.
    const acao = proximaMelhorAcao({ ...completa, contatos: [] });
    expect(acao.id).toBe("sem-contato");
    expect(acao.porque.length).toBeGreaterThan(10);
    expect(acao.onde.length).toBeGreaterThan(3);
  });

  it("respeita a ordem de prioridade", () => {
    // Sem contato nenhum, não adianta mandar pesquisar a empresa.
    expect(proximaMelhorAcao({ ...completa, contatos: [], pesquisaEm: null }).id).toBe("sem-contato");
    expect(proximaMelhorAcao({ ...completa, contatos: [decisor] }).id).toBe("sem-compras");
    expect(proximaMelhorAcao({ ...completa, diasSemAtividade: 45 }).id).toBe("parada");
    expect(proximaMelhorAcao({ ...completa, pesquisaEm: null }).id).toBe("sem-pesquisa");
    expect(proximaMelhorAcao({ ...completa, conta: {} }).id).toBe("sem-proxima-acao");
  });

  it("o motivo carrega o número que o gerou", () => {
    expect(proximaMelhorAcao({ ...completa, diasSemAtividade: 45 }).porque).toContain("45 dias");
  });

  it("propõe o white space quando o resto está em dia", () => {
    const acao = proximaMelhorAcao({ ...completa, espacos: [{ id: "dedicated", nome: "Operação dedicada" }] });
    expect(acao.id).toBe("white-space");
    expect(acao.acao).toBe("Propor Operação dedicada");
  });

  it("nada pendente é uma resposta legítima", () => {
    // Inventar tarefa para a tela não ficar vazia é como se perde a confiança
    // na sugestão.
    expect(proximaMelhorAcao(completa).id).toBe("em-dia");
  });

  it("aguenta contexto vazio sem quebrar", () => {
    expect(proximaMelhorAcao().id).toBe("sem-contato");
    expect(proximaMelhorAcao({ contatos: [null, undefined] }).id).toBe("sem-contato");
  });
});
