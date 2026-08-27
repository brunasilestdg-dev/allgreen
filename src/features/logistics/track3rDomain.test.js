import { describe, expect, it } from "vitest";
import {
  PERGUNTAS_AO_TRACK3R,
  casarEmbarcador,
  hashDoDocumento,
  mapearStatusParaEvento,
  normalizarDocumento,
  normalizeDate,
  normalizeDateTime,
  normalizeDocumentKind,
  projetarEvento,
  projetarOperacao,
  resumoDaImportacao,
  statusEncerrado,
  sugerirEmbarcador,
  validarDocumento,
} from "./track3rDomain.js";

// Uma linha como o relatório do TRACK3R provavelmente sai: cabeçalhos em
// português, com acento, data em dd/mm/aaaa.
const linhaDoRelatorio = (extra = {}) => ({
  "Nº do Documento": "TG-99001",
  "Serviço": "Coleta Reversa",
  "Embarcador": "Amazon Serviços de Varejo do Brasil",
  "Embarcador Agrupador": "AMAZON",
  "CNPJ": "11.222.333/0001-81",
  "Unidade Origem da Coleta": "Sorocaba",
  "Unidade Atual da Coleta": "Cajamar",
  "Produto": "Encomenda",
  "Status": "Entregue",
  "Ocorrência": "",
  "Número da Nota Fiscal": "554433",
  "Placa": "abc1d23",
  "Tipo de Veículo": "Sprinter",
  "Motorista": "João Silva",
  "Volumes": "12",
  "Peso": "1.250,50",
  "Distância": "48,3",
  "Previsão": "20/08/2026 18:00",
  "Data Altera": "19/08/2026 14:32",
  ...extra,
});

describe("normalização de uma linha do relatório", () => {
  it("lê os rótulos reais da tela, com acento e em dd/mm/aaaa", () => {
    const doc = normalizarDocumento(linhaDoRelatorio());
    expect(doc).toMatchObject({
      externalId: "TG-99001",
      kind: "coleta_reversa",
      shipperName: "Amazon Serviços de Varejo do Brasil",
      shipperGroup: "AMAZON",
      shipperDocument: "11222333000181",
      originUnit: "Sorocaba",
      currentUnit: "Cajamar",
      product: "Encomenda",
      status: "Entregue",
      invoiceNumber: "554433",
      vehiclePlate: "ABC1D23",
      vehicleClass: "van",
      driverName: "João Silva",
      packages: 12,
      occurredAt: "2026-08-19T14:32:00",
      promisedAt: "2026-08-20T18:00:00",
    });
  });

  it("entende número brasileiro no peso e na distância", () => {
    // Number() cru transformaria "1.250,50" em 1,25050.
    const doc = normalizarDocumento(linhaDoRelatorio());
    expect(doc.weightKg).toBeCloseTo(1250.5, 2);
    expect(doc.distanceKm).toBeCloseTo(48.3, 2);
  });

  it("Coleta Reversa é um tipo próprio, não coleta comum", () => {
    // Tratá-la como coleta faria o relatório somar o que saiu com o que voltou.
    expect(normalizeDocumentKind("Coleta Reversa")).toBe("coleta_reversa");
    expect(normalizeDocumentKind("Coleta")).toBe("coleta");
    expect(normalizeDocumentKind("Entrega")).toBe("entrega");
    expect(normalizeDocumentKind("Transferência")).toBe("transferencia");
    expect(normalizeDocumentKind("qualquer coisa")).toBe("");
  });

  it("descarta CNPJ inválido em vez de guardar chave de casamento falsa", () => {
    // Casar embarcador por CNPJ errado é pior que não casar.
    const doc = normalizarDocumento(linhaDoRelatorio({ CNPJ: "11.222.333/0001-82" }));
    expect(doc.shipperDocument).toBe("");
  });

  it("descarta chave de nota com tamanho errado", () => {
    expect(normalizarDocumento(linhaDoRelatorio({ "Chave da Nota Fiscal": "1".repeat(43) })).invoiceKey)
      .toBe("");
    expect(normalizarDocumento(linhaDoRelatorio({ "Chave da Nota Fiscal": "1".repeat(44) })).invoiceKey)
      .toHaveLength(44);
  });

  it("a classe do veículo vem de moto a carreta, e fica vazia quando não reconhece", () => {
    expect(normalizarDocumento(linhaDoRelatorio({ "Tipo de Veículo": "MOTOBOY" })).vehicleClass)
      .toBe("moto");
    expect(normalizarDocumento(linhaDoRelatorio({ "Tipo de Veículo": "CARRETA LS" })).vehicleClass)
      .toBe("carreta");
    expect(normalizarDocumento(linhaDoRelatorio({ "Tipo de Veículo": "BITRUCK" })).vehicleClass)
      .toBe("bitruck");
    // Nunca chuta: classificar carreta como van erraria custo e habilitação.
    expect(normalizarDocumento(linhaDoRelatorio({ "Tipo de Veículo": "XPTO" })).vehicleClass)
      .toBe("");
  });

  it("limpa a placa e mantém o payload bruto para auditoria", () => {
    const linha = linhaDoRelatorio({ Placa: "abc-1d23" });
    const doc = normalizarDocumento(linha);
    expect(doc.vehiclePlate).toBe("ABC1D23");
    expect(doc.payload).toBe(linha);
  });

  it("campo ausente fica vazio, sem inventar", () => {
    const doc = normalizarDocumento({ "Nº do Documento": "X1", "Data Altera": "01/02/2026" });
    expect(doc.shipperName).toBe("");
    expect(doc.packages).toBe(0);
    expect(doc.vehicleClass).toBe("");
    expect(doc.occurredAt).toBe("2026-02-01");
  });

  it("o mapa configurado entra na frente sem apagar os padrões", () => {
    // Ajustar um campo não pode quebrar os apelidos que já funcionavam.
    const linha = { CODIGO_INTERNO: "Z9", "Data Altera": "03/03/2026", Embarcador: "Shopee" };
    const doc = normalizarDocumento(linha, { externalId: "CODIGO_INTERNO" });
    expect(doc.externalId).toBe("Z9");
    expect(doc.shipperName).toBe("Shopee");
  });
});

describe("datas", () => {
  it("aceita dd/mm/aaaa e ISO", () => {
    expect(normalizeDate("19/08/2026")).toBe("2026-08-19");
    expect(normalizeDate("2026-08-19")).toBe("2026-08-19");
    expect(normalizeDate("2026-08-19T10:00:00Z")).toBe("2026-08-19");
  });

  it("recusa ano de dois dígitos e lixo, em vez de virar 1925", () => {
    expect(normalizeDate("19/08/26")).toBe("");
    expect(normalizeDate("ontem")).toBe("");
    expect(normalizeDate("")).toBe("");
  });

  it("guarda a hora quando vem, porque SLA se decide no horário", () => {
    expect(normalizeDateTime("19/08/2026 14:32")).toBe("2026-08-19T14:32:00");
    expect(normalizeDateTime("19/08/2026 14:32:07")).toBe("2026-08-19T14:32:07");
    expect(normalizeDateTime("19/08/2026")).toBe("2026-08-19");
  });
});

describe("status do TMS vira evento da linha do tempo", () => {
  it("mapeia para os valores que a operação já aceita", () => {
    expect(mapearStatusParaEvento("Entregue")).toBe("entrega");
    expect(mapearStatusParaEvento("Em trânsito")).toBe("transito");
    expect(mapearStatusParaEvento("Saiu para entrega")).toBe("transito");
    expect(mapearStatusParaEvento("Coletado")).toBe("coleta");
    expect(mapearStatusParaEvento("Chegada na base")).toBe("chegada");
    expect(mapearStatusParaEvento("Reagendado")).toBe("reagendamento");
  });

  it("insucesso, avaria e devolução são ocorrência, não entrega", () => {
    for (const status of [
      "Não entregue", "Tentativa de entrega", "Cliente recusou",
      "Avaria na carga", "Extravio", "Devolvido ao remetente",
    ]) {
      expect(mapearStatusParaEvento(status)).toBe("ocorrencia");
    }
  });

  it("aguardando coleta não é coleta feita", () => {
    // O mais específico vem primeiro justamente por isso.
    expect(mapearStatusParaEvento("Nova tentativa agendada")).toBe("reagendamento");
    expect(mapearStatusParaEvento("Não realizada")).toBe("ocorrencia");
  });

  it("status desconhecido devolve vazio, sem chutar entrega", () => {
    // Chutar registraria uma entrega que não houve.
    expect(mapearStatusParaEvento("XPTO")).toBe("");
    expect(mapearStatusParaEvento("")).toBe("");
  });

  it("statusEncerrado só é verdade na entrega", () => {
    expect(statusEncerrado("Entregue")).toBe(true);
    expect(statusEncerrado("Em trânsito")).toBe(false);
    expect(statusEncerrado("Não entregue")).toBe(false);
  });
});

describe("deduplicação", () => {
  it("usa o id do TRACK3R quando existe", () => {
    const doc = normalizarDocumento(linhaDoRelatorio());
    expect(hashDoDocumento(doc)).toBe("id:TG-99001");
  });

  it("o status FICA FORA do hash, para atualização não criar documento novo", () => {
    // A mesma coleta reaparece no relatório do dia seguinte com status novo.
    const antes = normalizarDocumento(linhaDoRelatorio({ Status: "Em trânsito" }));
    const depois = normalizarDocumento(linhaDoRelatorio({ Status: "Entregue" }));
    expect(hashDoDocumento(antes)).toBe(hashDoDocumento(depois));
  });

  it("sem id, identifica pela combinação prática do documento", () => {
    const base = linhaDoRelatorio({ "Nº do Documento": "" });
    expect(hashDoDocumento(normalizarDocumento(base)))
      .toBe(hashDoDocumento(normalizarDocumento({ ...base })));
    // Nota diferente é documento diferente.
    const outra = normalizarDocumento({ ...base, "Número da Nota Fiscal": "999" });
    expect(hashDoDocumento(normalizarDocumento(base))).not.toBe(hashDoDocumento(outra));
  });

  it("é determinístico: nada de hora do sistema nem aleatório", () => {
    const doc = normalizarDocumento(linhaDoRelatorio({ "Nº do Documento": "" }));
    expect(hashDoDocumento(doc)).toBe(hashDoDocumento(doc));
  });
});

describe("casamento do embarcador — sem forçar", () => {
  const clientes = [
    { id: "c-amz", name: "Amazon", legalName: "Amazon Serviços de Varejo do Brasil", document: "11222333000181" },
    { id: "c-shp", name: "Shopee", legalName: "Shopee Brasil", document: "52998224725" },
    { id: "c-sem", name: "Cliente sem CNPJ", legalName: "", document: "" },
  ];

  it("casa por CNPJ e diz o critério", () => {
    const doc = normalizarDocumento(linhaDoRelatorio());
    expect(casarEmbarcador(doc, clientes)).toEqual({ clientId: "c-amz", criterio: "cnpj" });
  });

  it("devolve null quando não há CNPJ que case — e isso é normal", () => {
    // Casar por nome parecido criaria vínculo falso que ninguém depois sabe que
    // é falso. Documento sem conta é estado legítimo.
    const semDoc = normalizarDocumento(linhaDoRelatorio({ CNPJ: "" }));
    expect(casarEmbarcador(semDoc, clientes)).toBeNull();

    const outroDoc = normalizarDocumento(linhaDoRelatorio({ CNPJ: "52.998.224/7250-00" }));
    expect(casarEmbarcador(outroDoc, clientes)).toBeNull();
  });

  it("nunca casa por nome, mesmo com nome idêntico", () => {
    const semDoc = normalizarDocumento(linhaDoRelatorio({ CNPJ: "" }));
    expect(casarEmbarcador(semDoc, clientes)).toBeNull();
  });

  it("sugere por nome e grupo, para uma pessoa escolher", () => {
    const semDoc = normalizarDocumento(linhaDoRelatorio({ CNPJ: "" }));
    const sugestoes = sugerirEmbarcador(semDoc, clientes);
    expect(sugestoes[0]).toMatchObject({ clientId: "c-amz" });
    expect(sugestoes[0].motivos).toContain("grupo do embarcador");
  });

  it("o grupo liga AMAZON DBA e AMAZON RETAIL à mesma conta", () => {
    // É o NUCLEO/GRUPO da carteira herdada.
    for (const grupo of ["AMAZON DBA", "AMAZON RETAIL"]) {
      const doc = normalizarDocumento(linhaDoRelatorio({
        CNPJ: "", Embarcador: grupo, "Embarcador Agrupador": "AMAZON",
      }));
      expect(sugerirEmbarcador(doc, clientes)[0].clientId).toBe("c-amz");
    }
  });

  it("sem nome nem grupo, não sugere nada", () => {
    expect(sugerirEmbarcador({ shipperName: "", shipperGroup: "" }, clientes)).toEqual([]);
  });
});

describe("projeção na operação", () => {
  it("monta a operação com referência, unidades e entrega", () => {
    const doc = { ...normalizarDocumento(linhaDoRelatorio()), id: "d1", clientId: "c-amz" };
    const operacao = projetarOperacao(doc);
    expect(operacao).toMatchObject({
      clientId: "c-amz",
      // `service_date` é a coluna real da tabela; o mês só acompanha para
      // relatório.
      serviceDate: "2026-08-19",
      referenceMonth: "2026-08",
      referencia: "554433",
      origem: "Sorocaba",
      destino: "Cajamar",
      vehiclePlate: "ABC1D23",
      status: "concluida",
      deliveredAt: "2026-08-19T14:32:00",
      incidentes: 0,
    });
    // Volume e peso não têm coluna em `todogreen_client_operations`: a migração
    // 0047 os consolidou em `fields_json`. Deixá-los no topo faria o INSERT
    // inventar coluna.
    expect(operacao.campos).toMatchObject({
      sourceTmsDocumentId: "d1", sourceTms: "track3r",
      service: "Coleta Reversa", vehicleClass: "van", shipperGroup: "AMAZON",
      packages: 12,
    });
  });

  it("só marca entrega quando o status DIZ entrega", () => {
    // Preencher com a data do evento em qualquer status faria toda ocorrência
    // contar como entregue.
    const doc = {
      ...normalizarDocumento(linhaDoRelatorio({ Status: "Não entregue" })),
      clientId: "c-amz",
    };
    const operacao = projetarOperacao(doc);
    expect(operacao.deliveredAt).toBeNull();
    expect(operacao.status).toBe("active");
  });

  it("devolve null sem cliente casado — não cria operação órfã", () => {
    const doc = normalizarDocumento(linhaDoRelatorio());
    expect(projetarOperacao({ ...doc, clientId: "" })).toBeNull();
  });

  it("devolve null sem data — operação que nenhum relatório de período acha", () => {
    const doc = normalizarDocumento(linhaDoRelatorio({ "Data Altera": "" }));
    expect(projetarOperacao({ ...doc, clientId: "c-amz" })).toBeNull();
  });

  it("aceita o cliente por opção quando o documento ainda não tem", () => {
    const doc = normalizarDocumento(linhaDoRelatorio());
    expect(projetarOperacao(doc, { clientId: "c-amz" }).clientId).toBe("c-amz");
  });

  it("o evento sai do status, e não sai quando o status é irreconhecível", () => {
    const entregue = normalizarDocumento(linhaDoRelatorio());
    expect(projetarEvento(entregue)).toMatchObject({
      kind: "entrega", titulo: "Entregue", local: "Cajamar", ocorridoEm: "2026-08-19T14:32:00",
    });
    expect(projetarEvento(normalizarDocumento(linhaDoRelatorio({ Status: "XPTO" })))).toBeNull();
  });

  it("a ocorrência viaja na descrição do evento", () => {
    const doc = normalizarDocumento(linhaDoRelatorio({
      Status: "Não entregue", "Ocorrência": "Endereço não localizado",
    }));
    expect(projetarEvento(doc)).toMatchObject({
      kind: "ocorrencia", descricao: "Endereço não localizado",
    });
  });
});

describe("validação e retrato", () => {
  it("aceita o documento com o mínimo para ser identificável", () => {
    expect(validarDocumento(normalizarDocumento(linhaDoRelatorio()))).toBe("");
  });

  it("recusa linha sem nada que a identifique", () => {
    expect(validarDocumento(normalizarDocumento({ "Data Altera": "19/08/2026" })))
      .toMatch(/não há como identificá-la/i);
  });

  it("recusa linha sem data reconhecível", () => {
    expect(validarDocumento(normalizarDocumento({ Embarcador: "Amazon" })))
      .toMatch(/data reconhecível/i);
  });

  it("aceita documento SEM cliente, sem veículo e sem operação", () => {
    // Faltar vínculo não é erro: os assuntos nem sempre se relacionam.
    const doc = normalizarDocumento({
      Embarcador: "Transportadora nova", "Data Altera": "19/08/2026",
    });
    expect(validarDocumento(doc)).toBe("");
    expect(doc.vehicleClass).toBe("");
    expect(casarEmbarcador(doc, [])).toBeNull();
  });

  it("o resumo conta o que ficou sem vínculo", () => {
    // Sem esse número a integração parece completa enquanto metade dos
    // documentos não chegou a lugar nenhum.
    const resumo = resumoDaImportacao([
      { kind: "coleta", clientId: "c1", vehicleClass: "van", operationId: "o1" },
      { kind: "coleta", clientId: "", vehicleClass: "", operationId: "" },
      { kind: "coleta_reversa", clientId: "c1", vehicleClass: "carreta", operationId: "" },
    ]);
    expect(resumo).toMatchObject({
      total: 3, semEmbarcador: 1, semClasseDeVeiculo: 1, semProjecao: 2,
    });
    expect(resumo.porTipo).toEqual({ coleta: 2, coleta_reversa: 1 });
    expect(resumo.porClasse).toEqual({ van: 1, carreta: 1, "(sem classe)": 1 });
  });

  it("as perguntas ao fornecedor estão registradas no código", () => {
    expect(PERGUNTAS_AO_TRACK3R.length).toBeGreaterThanOrEqual(6);
    expect(PERGUNTAS_AO_TRACK3R.join(" ")).toMatch(/API REST/);
    expect(PERGUNTAS_AO_TRACK3R.join(" ")).toMatch(/carreta/);
  });
});
