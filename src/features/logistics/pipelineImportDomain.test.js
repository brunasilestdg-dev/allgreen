import { describe, expect, it } from "vitest";
import {
  chaveDaInteracao,
  chaveDaOportunidade,
  classificarTipoDaInteracao,
  contaDoGrupo,
  contaDoProjeto,
  dataDaPlanilha,
  ehTrabalhoInterno,
  estagioDoFunilExterno,
  interpretarProjetos,
  interpretarUpdates,
  oportunidadeParaRegistro,
  planoDeImportacao,
} from "./pipelineImportDomain.js";

// Linhas no formato exato do export do quadro: título, instrução, grupos com
// cabeçalho próprio, sub-tabela de subitens e linha de totais no fim.
const PROJETOS = [
  ["Dashboard - Novos Negocios & Projetos"],
  ["Gerencie qualquer tipo de projeto. Atribua responsáveis."],
  [],
  ["Projetos em Andamento - Amazon"],
  ["Nome", "Subelementos", "Responsável", "Funil", "Prioridade", "Status", "Faturamento Anual Esperado", "Faturamento Mensal Esperado", "Data Inicio", "Data Proposta", "Data Finalização", "Update Summary"],
  ["AMXL ABC", "", "Claudio Jannini Mano", "Negociação", "Alta", "Em andamento", 1480000, 370000, "2026-09-01 00:00:00", "2026-08-13 00:00:00", "", ""],
  ["Same Day", "", "Claudio Jannini Mano", "Proposta / BID", "Crítico ⚠️️", "Em andamento", 1600000, 400000, "", "", "", ""],
  ["", "", "", "", "", "", 3080000, 770000, "2026-09-01", "2026-08-13", "", ""],
  [],
  ["Projetos em Andamento - Novos Clientes"],
  ["Nome", "Subelementos", "Responsável", "Funil", "Prioridade", "Status", "Faturamento Anual Esperado", "Faturamento Mensal Esperado", "Data Inicio", "Data Proposta", "Data Finalização", "Update Summary"],
  ["Projeto Maersk - On Running", "Projeto Crocs", "JEBERSON DE ARAUJO PIRES, Bruna de Paula Siles", "Fechamento", "Alta", "Feito", 1800000, 150000, "2025-07-08 00:00:00", "", "2026-02-20 00:00:00", "Resumo do acompanhamento"],
  ["Subitems", "Name", "Responsável", "Status", "Data Finalização", "Descrição", "Números", "Item ID (auto generated)"],
  ["", "Projeto Crocs", "Claudio Jannini Mano", "A começar", "", "", "", "12467246255"],
  ["Projeto DHL", "Bid Rede", "Valentin Manfrin", "Homologação", "Alta", "Em andamento", 3600000, 300000, "2026-04-07 00:00:00", "", "2026-09-30 00:00:00", ""],
  ["", "", "", "", "", "", 5400000, 450000, "", "", "", ""],
  [],
  ["Projetos Concluídos"],
  ["Nome", "Subelementos", "Responsável", "Funil", "Prioridade", "Status", "Faturamento Anual Esperado", "Faturamento Mensal Esperado", "Data Inicio", "Data Proposta", "Data Finalização"],
  ["Implementação do TMS", "Definir TMS", "Laercio David Benedito Junior", "Sem Classificação", "Média", "Feito", "", "", "2026-01-13 00:00:00", "", "2026-03-31 00:00:00"],
  [],
  ["Projetos Cancelados / Não Ganhos"],
  ["Nome", "Subelementos", "Responsável", "Funil", "Prioridade", "Status", "Faturamento Anual Esperado", "Faturamento Mensal Esperado", "Data Inicio", "Data Proposta", "Data Finalização"],
  ["Projeto Natura", "", "Valentin Manfrin", "Negociação", "Alta", "Não Ganhado", 3600000, 300000, "2026-05-12 00:00:00", "", ""],
];

const UPDATES = [
  ["Dashboard - Novos Negocios & Projetos", "Updates"],
  ["Item ID", "Item Name", "Content Type", "Content Type", "User", "Created At", "Update Content", "Likes Count", "Asset IDs", "Post ID", "Parent Post ID"],
  ["1", "Projeto DHL", "Update", "", "Valentin Manfrin", "03/March/2026  05:56:21 PM", "Reunião de apresentação dia 18/03", 0, "", "4975236090", ""],
  ["1", "Projeto DHL", "", "Reply", "Valentin Manfrin", "22/April/2026  02:30:21 PM", "Próximos passos com o Procurement", 0, "", "5124242102", "4975236090"],
  ["2", "Bid Rede", "Update", "", "Claudio Jannini Mano", "07/July/2026  03:04:50 PM", "Proposta enviada para o bid da rede", 0, "", "5353337893", ""],
  ["3", "Projeto Fantasma", "Update", "", "Alguém", "07/July/2026  03:04:50 PM", "Update de projeto que não está na lista", 0, "", "1", ""],
];

describe("leitura das datas do quadro", () => {
  it("entende o formato da planilha, o do update e o brasileiro", () => {
    expect(dataDaPlanilha("2026-09-01 00:00:00")).toBe("2026-09-01");
    expect(dataDaPlanilha("26/August/2026  05:10:40 PM")).toBe("2026-08-26");
    expect(dataDaPlanilha("13/08/2026")).toBe("2026-08-13");
    expect(dataDaPlanilha(new Date("2026-02-20T12:00:00Z"))).toBe("2026-02-20");
  });

  it("o que não é data vira vazio, nunca a data de hoje", () => {
    expect(dataDaPlanilha("")).toBe("");
    expect(dataDaPlanilha("em breve")).toBe("");
    expect(dataDaPlanilha("13/Setembro-ish/2026")).toBe("");
  });
});

describe("funil do quadro externo no funil da titular", () => {
  it("traduz cada etapa, inclusive Proposta / BID", () => {
    expect(estagioDoFunilExterno("Prospeção")).toBe("Prospecção");
    expect(estagioDoFunilExterno("Proposta / BID")).toBe("Apresentação");
    expect(estagioDoFunilExterno("Negociação")).toBe("Negociação");
    expect(estagioDoFunilExterno("Homologação")).toBe("Homologação");
    expect(estagioDoFunilExterno("Fechamento")).toBe("Fechamento");
  });

  it("sem classificação não vira etapa nenhuma", () => {
    expect(estagioDoFunilExterno("Sem Classificação")).toBe("");
    expect(estagioDoFunilExterno("")).toBe("");
  });
});

describe("de que conta é o projeto", () => {
  it("o grupo nomeia a conta quando ele tem dona", () => {
    expect(contaDoGrupo("Projetos em Andamento - Amazon")).toBe("Amazon");
    expect(contaDoGrupo("Projetos em Andamento - Novos Clientes")).toBe("");
    expect(contaDoGrupo("Projetos em Stand-by")).toBe("");
  });

  it("o nome do projeto entrega a empresa", () => {
    expect(contaDoProjeto("Projeto Magalog")).toBe("Magalog");
    expect(contaDoProjeto("Projeto Maersk - On Running")).toBe("Maersk");
    expect(contaDoProjeto("Projeto DHL (LH - Mercado Livre)")).toBe("DHL");
    expect(contaDoProjeto("Proposta Kim Pães")).toBe("Kim Pães");
  });

  it("sufixo de frente não cria uma segunda conta da mesma empresa", () => {
    expect(contaDoProjeto("Projeto Mercado Livre Middle Mile")).toBe("Mercado Livre");
    expect(contaDoProjeto("Projeto Renner ON/OFF")).toBe("Renner");
  });

  it("trabalho interno não vira cliente", () => {
    expect(ehTrabalhoInterno({ nome: "Implementação do TMS", conta: "", estagioDoFunil: "" })).toBe(true);
    expect(ehTrabalhoInterno({ nome: "Projeto Natura", conta: "", estagioDoFunil: "" })).toBe(false);
    expect(ehTrabalhoInterno({ nome: "Same Day", conta: "Amazon", estagioDoFunil: "" })).toBe(false);
    expect(ehTrabalhoInterno({ nome: "Logan express", conta: "", estagioDoFunil: "Negociação" })).toBe(false);
  });
});

describe("projetos viram oportunidades", () => {
  const { oportunidades, avisos } = interpretarProjetos(PROJETOS);

  it("lê só as linhas de projeto — cabeçalho, subitem e total ficam de fora", () => {
    expect(oportunidades.map((item) => item.nome)).toEqual([
      "AMXL ABC",
      "Same Day",
      "Projeto Maersk - On Running",
      "Projeto DHL",
      "Implementação do TMS",
      "Projeto Natura",
    ]);
  });

  it("o grupo com dona carimba a conta em todas as linhas dele", () => {
    expect(oportunidades[0]).toMatchObject({ conta: "Amazon", estagio: "Negociação", valorMensal: 370000 });
    expect(oportunidades[1]).toMatchObject({ conta: "Amazon", estagio: "Apresentação" });
  });

  it("status Feito ganha e Não Ganhado perde, seja qual for o funil", () => {
    expect(oportunidades[2].estagio).toBe("Fechada ganha");
    expect(oportunidades[5].estagio).toBe("Fechada perdida");
  });

  it("guarda datas, prioridade, responsáveis e resumo sem inventar nada", () => {
    expect(oportunidades[2]).toMatchObject({
      prioridade: "Alta",
      responsaveis: ["JEBERSON DE ARAUJO PIRES", "Bruna de Paula Siles"],
      inicioEm: "2025-07-08",
      fimEm: "2026-02-20",
      propostaEm: "",
      resumo: "Resumo do acompanhamento",
    });
  });

  it("avisa sobre o que entrou sem conta em vez de inventar cliente", () => {
    expect(oportunidades[4]).toMatchObject({ conta: "", interno: true, estagio: "Fechada ganha" });
    expect(avisos.some((aviso) => aviso.includes("Implementação do TMS"))).toBe(true);
  });
});

describe("updates viram interações", () => {
  const { oportunidades } = interpretarProjetos(PROJETOS);
  const { interacoes, avisos } = interpretarUpdates(UPDATES, oportunidades);

  it("liga cada update ao projeto e preserva autor e data originais", () => {
    expect(interacoes[0]).toMatchObject({
      projeto: "Projeto DHL",
      participantes: "Valentin Manfrin",
      ocorridaEm: "2026-03-03",
      tipo: "reuniao",
      resposta: false,
    });
    expect(interacoes[1]).toMatchObject({ ocorridaEm: "2026-04-22", resposta: true });
  });

  it("update de subitem entra no projeto que o contém, dizendo de qual frente é", () => {
    expect(interacoes[2].projeto).toBe("Projeto DHL");
    expect(interacoes[2].assunto).toContain("Bid Rede:");
    expect(interacoes[2].tipo).toBe("proposta");
  });

  it("update órfão fica de fora com aviso, em vez de entrar em qualquer conta", () => {
    expect(interacoes.some((item) => item.ata.includes("não está na lista"))).toBe(false);
    expect(avisos.some((aviso) => aviso.includes("Projeto Fantasma"))).toBe(true);
  });

  it("o cabeçalho da aba de updates não vira interação", () => {
    expect(interacoes.some((item) => item.assunto === "Update Content")).toBe(false);
  });
});

describe("classificação do tipo pelo texto", () => {
  it("reconhece reunião, proposta, tentativa e cai em outro quando o texto não diz", () => {
    expect(classificarTipoDaInteracao("Reuniões semanais com todas as áreas")).toBe("reuniao");
    expect(classificarTipoDaInteracao("Proposta enviada em 06/06")).toBe("proposta");
    expect(classificarTipoDaInteracao("Sem retorno da Lais")).toBe("tentativa");
    expect(classificarTipoDaInteracao("NDA assinado")).toBe("outro");
  });
});

describe("plano de importação", () => {
  const plano = planoDeImportacao({ projetos: PROJETOS, updates: UPDATES });

  it("resume o que vai entrar antes de gravar qualquer coisa", () => {
    expect(plano.resumo).toMatchObject({
      contas: 4,
      oportunidades: 6,
      interacoes: 3,
      abertas: 3,
    });
    expect(plano.contas).toEqual(["Amazon", "Maersk", "DHL", "Natura"]);
  });

  it("o registro leva para o CRM o que não tem coluna própria", () => {
    const registro = oportunidadeParaRegistro(plano.oportunidades[3], "cli-dhl");
    expect(registro).toMatchObject({ cliente: "DHL", clientId: "cli-dhl", estagio: "Homologação", valorMensal: 300000 });
    expect(registro.campos).toMatchObject({
      nomeDoProjeto: "Projeto DHL",
      grupoNoQuadro: "Projetos em Andamento - Novos Clientes",
      prioridade: "Alta",
      fimEm: "2026-09-30",
    });
  });

  it("as chaves de dedupe não deixam a reimportação duplicar", () => {
    const registro = oportunidadeParaRegistro(plano.oportunidades[3], "cli-dhl");
    // O prefixo do quadro sai da chave: "Projeto DHL" e a oportunidade "DHL"
    // que já existia no CRM são a mesma coisa.
    expect(chaveDaOportunidade(registro)).toBe("dhl");
    expect(chaveDaOportunidade({ cliente: "DHL" })).toBe("dhl");
    expect(chaveDaInteracao({ assunto: "Reunião de apresentação dia 18/03", ocorridaEm: "2026-03-03" }))
      .toBe("reuniao de apresentacao dia 18/03|2026-03-03");
  });
});
