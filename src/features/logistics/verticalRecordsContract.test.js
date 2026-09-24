import { describe, expect, it } from "vitest";
import { COLECOES, nomeDaColecao } from "../../../worker/services/vertical-records/colecoes/index.js";
import {
  CAMPOS_DO_DESCRITOR,
  COLUNAS_DA_ESTEIRA,
  problemasDoDescritor,
} from "../../../worker/services/vertical-records/colecoes/descritor.js";
import * as cadastros from "../../../worker/services/vertical-records/colecoes/cadastros.js";
import * as centralRfq from "../../../worker/services/vertical-records/colecoes/central-rfq.js";
import * as cofre from "../../../worker/services/vertical-records/colecoes/cofre.js";
import * as comercial from "../../../worker/services/vertical-records/colecoes/comercial.js";
import * as conhecimento from "../../../worker/services/vertical-records/colecoes/conhecimento.js";
import * as energia from "../../../worker/services/vertical-records/colecoes/energia.js";
import * as financeiro from "../../../worker/services/vertical-records/colecoes/financeiro.js";
import * as juridico from "../../../worker/services/vertical-records/colecoes/juridico.js";
import * as operacao from "../../../worker/services/vertical-records/colecoes/operacao.js";
import * as qualidade from "../../../worker/services/vertical-records/colecoes/qualidade.js";
import { TODO_GREEN_PERMISSIONS, TODO_GREEN_PERMISSION_KEYS } from "./logisticsVerticalDomain.js";

// O contrato do descritor de coleção de /api/todogreen/records/<nome>
// (worker/services/vertical-records/colecoes/descritor.js), conferido em TODAS
// as coleções do registro. A esteira genérica confia nesse formato sem checar
// nada em tempo de execução: um campo com nome errado seria ignorado calado, e
// um `colunas` que não reproduz a linha faria todo PATCH parcial reescrever o
// que ninguém mudou.

// Defeitos que JÁ existiam quando o registro foi dividido em módulos. A
// refatoração foi pura e não os corrigiu; eles ficam listados aqui para não
// crescerem. Cada lista precisa bater EXATAMENTE com o que o teste encontra:
// quem corrigir um defeito tira a entrada daqui, e um defeito novo reprova.
const DEFEITOS_CONHECIDOS = {
  // `rotas` (sem `client_id`) não declarava `escopoDeCarteira: false` e dava
  // 500 para planejamento e auditor — corrigido em 24/09/2026.
  recorteSemClientId: [],
  // `chargingPrices.daLinha` não devolvia `campos`, e um PATCH sem `campos`
  // apagava `fields_json` — corrigido em 24/09/2026.
  semIdaEVolta: {},
  // `business:teach` e `compliance:manage` faltavam no catálogo da tela de
  // acesso, pelo qual o servidor filtra a permissão personalizada — corrigido
  // em 24/09/2026.
  foraDoCatalogo: [],
};

// A ordem é contrato: o GET agregado devolve as coleções nesta ordem.
const ORDEM_DO_REGISTRO = [
  "opportunities", "comments", "interactions", "documentFolders", "habilitacao",
  "habilitacaoKits", "rfq", "businessContext", "proposals", "contracts", "operations",
  "rotas", "pontosRecarga", "chargingSessions", "chargerReservations", "chargingPrices",
  "importTemplates", "financial", "items", "warehouses", "parties", "accounts",
  "costCenters", "bankAccounts", "quality", "legal",
];

const MODULOS_DE_DOMINIO = {
  cadastros, centralRfq, cofre, comercial, conhecimento, energia, financeiro, juridico, operacao, qualidade,
};

// Um corpo realista o bastante para quase toda coluna sair do valor padrão —
// senão a ida e volta passaria só porque os dois lados caem no mesmo padrão.
const AMOSTRA = {
  clientId: "cli-alfa", cliente: "Distribuidora Alfa", clienteId: "cli-alfa", clienteNome: "Distribuidora Alfa",
  opportunityId: "opp-1", oportunidadeId: "opp-1", cenarioId: "cen-1", propostaId: "prop-1", contratoId: "ctr-1",
  produtoId: "middle-mile", operacaoId: "op-1", partyId: "party-1", accountId: "acc-1", costCenterId: "cc-1",
  bankAccountId: "bank-1", responsavelId: "user-2", motoristaId: "drv-1", motorista: "Carla Motorista",
  motoristaNome: "Carla Motorista", veiculoId: "veh-1", veiculoRotulo: "Van elétrica 01", rotaId: "rota-1",
  pontoId: "pt-1", pontoNome: "Pátio Norte", autorEmail: "autora@todogreen.com.br",
  titulo: "Middle mile Alfa", nome: "Norte", descricao: "Descrição do registro", comentario: "Cliente pediu revisão.",
  assunto: "Kick-off", ata: "Alinhamos escopo e prazos.", participantes: "Ana, Bruno", resultado: "Avançou",
  proximoPasso: "Enviar proposta", proximoPassoEm: "2026-09-30", ocorridaEm: "2026-09-20T14:00:00.000Z",
  observacao: "Observação", observacoes: "Observações", notas: "Notas da rota", texto: "Texto da proposta",
  termos: "Termos do contrato", condicoes: "30 dias", riscos: "Pico de fim de ano", escopo: "cliente",
  estagio: "Negociação", valorMensal: 42000, valorContrato: 504000, valorTotal: 504000, distanciaKm: 120,
  viagensMes: 40, tipoVeiculo: "VUC elétrico", ultimaInteracaoEm: "2026-09-19", campos: { origemDoTeste: "contrato" },
  situacao: "inativo", status: "concluida", tipo: "revenue", kind: "poupanca", categoria: "habilitacao",
  inicioEm: "2026-10-01T08:00:00.000Z", fimEm: "2026-10-01T09:30:00.000Z", assinatura: "sent",
  renovacao: "automatic", avisoRenovacaoEm: "2027-08-01", diaFaturamento: 10, antecedenciaAvisoDias: 90,
  servicoId: "svc-1", tabelaPrecoId: "tab-1", sla: { otd: 98 }, condicoesComerciais: { prazo: 30 },
  impostos: { iss: 5 }, regrasFaturamento: { corte: 25 }, indiceReajuste: "IPCA", dataBaseReajuste: "2026-10-01",
  compromissoMinimo: 1000, aprovacao: "rejected",
  referencia: "REF-1", dataServico: "2026-09-21", origem: "CD Guarulhos", destino: "Hub Barueri",
  prometidoEm: "2026-09-21T18:00:00.000Z", entregueEm: "2026-09-21T17:40:00.000Z", etaEm: "2026-09-21T17:30:00.000Z",
  placa: "abc1d23", ordemNaRota: 2, ocorrencias: 1, comprovanteUrl: "/api/todogreen/arquivo?t=1",
  comprovanteHash: "hash-1", ultimaPosicaoEm: "2026-09-21T17:00:00.000Z", latitude: -23.5, longitude: -46.6,
  coletaLat: -23.4, coletaLng: -46.5, entregaLat: -23.51, entregaLng: -46.87, entregas: 12, pacotes: 30,
  viagens: 2, ocupacaoPercent: 80, paradas: [{ ordem: 1, endereco: "A" }, { ordem: 2, endereco: "B" }],
  duracaoMin: 95, pedagioTotal: 18.4, preflightId: "pf-1", paradasTexto: "A\nB",
  valor: 1500, mesReferencia: "2026-09", vencimentoEm: "2026-10-10", contraparte: "Alfa",
  numeroDocumento: "NF-10", centroCusto: "Operação", codigoOrcamento: "ORC-1", meioPagamento: "pix",
  competenciaEm: "2026-09-01", statusFinanceiro: "partial", multaPercent: 2, jurosMesPercent: 1,
  codigo: "mat-01", unidade: "KG", ncm: "8544.49.00", cest: "12.001.00", custoReferencia: 12.5, estoqueMinimo: 3,
  endereco: "Rua das Flores, 10", razaoSocial: "Alfa Distribuição Ltda", nomeFantasia: "Alfa",
  documento: "11.222.333/0001-81", papeis: ["cliente", "fornecedor"], inscricaoEstadual: "123", inscricaoMunicipal: "456",
  regimeTributario: "lucro_presumido", prazoPagamentoDias: 28, email: "financeiro@alfa.com.br", telefone: "+55 11 99999-0000",
  natureza: "receita", analitica: false, conta: "12345-6", agencia: "0001", bancoCodigo: "341",
  chavePix: "financeiro@alfa.com.br", saldoInicial: -250, aberturaEm: "2026-01-01",
  gravidade: "alta", causaRaiz: "Janela de doca", planoAcao: "Agendar doca", prazo: "2026-10-15",
  risco: "alto", inicioVigencia: "2026-10-01", fimVigencia: "2027-09-30",
  numero: "123", orgao: "Receita Federal", cnpj: "11222333000181", emitidoEm: "2026-08-01",
  venceEm: "2026-12-01", permanente: false, diasAceitaveis: 30, arquivoId: "arq-1",
  arquivoUrl: "/api/todogreen/arquivo?t=2", arquivoNome: "certidao.pdf",
  chave: "kit-licitacao", tipos: ["cnpj", "cnd"], etapa: "enviado", canal: "e-mail", solicitante: "Compras Alfa",
  pedido: "Enviar certidões", kit: "kit-licitacao", enviadoEm: "2026-09-10", enviados: ["cnpj.pdf"],
  conteudo: "A To Do Green opera frota elétrica.", fonte: "Apresentação 2026",
  vigenteEm: "2026-09-01", sigilo: "publico", fixado: true,
  operador: "GreenOn", tipoCorrente: "DC", conector: "CCS2", potenciaKw: 60, medidorInicial: 100,
  medidorFinal: 140, energiaKwh: 40, segmento: "b2b", precoPorKwh: 1.9,
  visibilidade: "shared", membros: ["colega@todogreen.com.br"],
};

// O que a esteira grava sozinha numa linha nova.
const DA_ESTEIRA = {
  id: "reg-1", tenant_id: "todogreen", workspace_owner_id: "dono", revision: 3,
  created_by: "u1", updated_by: "u1",
  created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-02T00:00:00.000Z", archived_at: null,
};

const contexto = (novo) => ({
  email: "sessao@todogreen.com.br", access: { ownerId: "dono", role: "admin", permissions: ["*"] },
  user: { id: "u1", email: "sessao@todogreen.com.br" }, novo,
});

const NOMES = Object.keys(COLECOES);
const cadaColecao = NOMES.map((nome) => [nome, COLECOES[nome]]);

const valorDeColunaValido = (valor) =>
  valor === null || typeof valor === "string" || (typeof valor === "number" && Number.isFinite(valor));

describe("o registro de coleções", () => {
  it("é explícito: as mesmas chaves, na ordem em que o GET agregado as devolve", () => {
    expect(NOMES).toEqual(ORDEM_DO_REGISTRO);
  });

  it("cada descritor mora num módulo de domínio e entra no registro uma vez, pelo MESMO objeto", () => {
    // A esteira compara por identidade (`colecao === COLECOES.contracts`): uma
    // cópia no índice desligaria as travas daquela coleção em silêncio.
    const doDominio = Object.values(MODULOS_DE_DOMINIO).flatMap((modulo) =>
      Object.values(modulo).flatMap((grupo) => Object.values(grupo)));
    expect(doDominio).toHaveLength(NOMES.length);
    for (const [nome, descritor] of cadaColecao)
      expect(doDominio.filter((item) => item === descritor), nome).toHaveLength(1);
  });

  it("o nome de cada coleção volta pelo descritor — é o resourceType da auditoria", () => {
    for (const [nome, descritor] of cadaColecao) expect(nomeDaColecao(descritor)).toBe(nome);
    expect(nomeDaColecao({})).toBe("record");
  });
});

describe("o formato do descritor, em todas as coleções", () => {
  it.each(cadaColecao)("%s cumpre o contrato", (_, descritor) => {
    expect(problemasDoDescritor(descritor)).toEqual([]);
  });

  it("o validador reprova descritor torto (e não só aprova tudo)", () => {
    const base = COLECOES.items;
    expect(problemasDoDescritor({ ...base, filtraLeitura: () => [] })).toEqual([
      'campo desconhecido "filtraLeitura" — a esteira o ignoraria em silêncio',
    ]);
    const { tabela: _tabela, ...semTabela } = base;
    expect(problemasDoDescritor(semTabela)).toEqual(['falta "tabela"']);
    expect(problemasDoDescritor({ ...base, escopoDeCarteira: true })).toHaveLength(1);
    expect(problemasDoDescritor({ ...base, permissoesLeitura: [] })).toHaveLength(2);
    expect(problemasDoDescritor({ ...base, ordem: "name; DROP TABLE x" })).toHaveLength(1);
    expect(problemasDoDescritor({ ...base, daLinha: (a, b) => ({ a, b }) })).toHaveLength(1);
    expect(problemasDoDescritor(null)).toHaveLength(1);
    expect(Object.keys(CAMPOS_DO_DESCRITOR)).toEqual(expect.arrayContaining(["guardaDeEscrita", "filtrarLeitura"]));
  });

  it.each(cadaColecao)("%s: colunas é total e só produz texto, número finito ou null — nunca coluna da esteira", (_, descritor) => {
    for (const corpo of [{}, AMOSTRA]) {
      const valores = descritor.colunas(corpo, contexto(true));
      expect(Object.keys(valores).length).toBeGreaterThan(0);
      for (const [coluna, valor] of Object.entries(valores)) {
        expect(COLUNAS_DA_ESTEIRA, coluna).not.toContain(coluna);
        expect(valorDeColunaValido(valor), `${coluna}=${JSON.stringify(valor)}`).toBe(true);
      }
    }
  });

  it.each(cadaColecao)("%s: exigido recusa o corpo vazio com uma mensagem", (_, descritor) => {
    const motivo = descritor.exigido({});
    expect(typeof motivo).toBe("string");
    expect(motivo.length).toBeGreaterThan(0);
  });

  it.each(cadaColecao)("%s: daLinha devolve id, revision e os carimbos da esteira", (_, descritor) => {
    const registro = descritor.daLinha({ ...descritor.colunas(AMOSTRA, contexto(true)), ...DA_ESTEIRA });
    expect(registro).toMatchObject({
      id: DA_ESTEIRA.id,
      revision: DA_ESTEIRA.revision,
      criadoEm: DA_ESTEIRA.created_at,
      atualizadoEm: DA_ESTEIRA.updated_at,
    });
  });

  it.each(cadaColecao)("%s: PATCH parcial não reescreve o que não mudou — colunas(daLinha(linha)) reproduz a linha", (nome, descritor) => {
    const linha = descritor.colunas(AMOSTRA, contexto(true));
    // Do jeito que `atualizar` monta: o registro atual por baixo do corpo, que
    // aqui vem vazio. E outra sessão editando — o dono anterior permanece.
    const regravada = descritor.colunas(
      { ...descritor.daLinha({ ...linha, ...DA_ESTEIRA }) },
      { ...contexto(false), email: "outra@todogreen.com.br" },
    );
    const mudaram = Object.keys(linha).filter((coluna) => JSON.stringify(linha[coluna]) !== JSON.stringify(regravada[coluna]));
    expect(mudaram).toEqual(DEFEITOS_CONHECIDOS.semIdaEVolta[nome] || []);
  });
});

describe("as invariantes de autorização do descritor", () => {
  it("coleção com recorte de carteira grava client_id — o recorte referencia t.client_id", () => {
    const semColuna = cadaColecao
      .filter(([, descritor]) => descritor.escopoDeCarteira !== false)
      .filter(([, descritor]) => !Object.hasOwn(descritor.colunas(AMOSTRA, contexto(true)), "client_id"))
      .map(([nome]) => nome);
    expect(semColuna).toEqual(DEFEITOS_CONHECIDOS.recorteSemClientId);
  });

  it("toda capacidade exigida é concedida por algum papel da vertical além do curinga", () => {
    const papeis = Object.entries(TODO_GREEN_PERMISSIONS).filter(([, lista]) => !lista.includes("*"));
    for (const [nome, descritor] of cadaColecao)
      for (const permissao of [descritor.permissao, ...(descritor.permissoesLeitura || [])])
        expect(papeis.some(([, lista]) => lista.includes(permissao)), `${nome}: ${permissao}`).toBe(true);
  });

  it("toda capacidade exigida existe no catálogo da tela de acesso", () => {
    const catalogo = new Set(TODO_GREEN_PERMISSION_KEYS);
    const exigidas = new Set(cadaColecao.flatMap(([, d]) => [d.permissao, ...(d.permissoesLeitura || [])]));
    expect([...exigidas].filter((permissao) => !catalogo.has(permissao)).sort()).toEqual(DEFEITOS_CONHECIDOS.foraDoCatalogo);
  });

  it("filtrarLeitura é exceção: só as pastas filtram fora do SQL", () => {
    const comFiltro = cadaColecao.filter(([, d]) => d.filtrarLeitura).map(([nome]) => nome);
    expect(comFiltro).toEqual(["documentFolders"]);
  });

  it("filtrarLeitura só tira registro, nunca acrescenta", () => {
    const pastas = [
      { id: "p1", paiId: "", nome: "Minha", visibilidade: "private", membros: [], permissaoDaArea: "", donoEmail: "eu@todogreen.com.br" },
      { id: "p2", paiId: "", nome: "Alheia", visibilidade: "private", membros: [], permissaoDaArea: "", donoEmail: "outra@todogreen.com.br" },
      { id: "p3", paiId: "", nome: "Do espaço", visibilidade: "shared", membros: [], permissaoDaArea: "", donoEmail: "outra@todogreen.com.br" },
    ];
    const vistas = COLECOES.documentFolders.filtrarLeitura(pastas, {
      access: { role: "vendedor", permissions: ["read", "evidence:manage"] },
      email: "eu@todogreen.com.br",
    });
    expect(vistas.every((pasta) => pastas.includes(pasta))).toBe(true);
    expect(vistas.map((pasta) => pasta.id)).not.toContain("p2");
  });
});
