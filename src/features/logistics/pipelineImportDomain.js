import { estagioValido } from "./opportunityIntelligenceDomain.js";

// ===== Importação em massa do pipeline (export do quadro de Novos Negócios) =====
//
// A titular mantém o pipeline num quadro externo cujo export tem duas abas:
//
//   1. os PROJETOS, agrupados por seção ("Projetos em Andamento - Amazon",
//      "em Stand-by", "Concluídos", "Cancelados / Não Ganhos"), cada grupo com
//      sua própria linha de cabeçalho, sub-tabelas de subitens e uma linha de
//      totais no fim;
//   2. os UPDATES, um por linha, com autor, data e texto — inclusive respostas.
//
// Nada aqui inventa dado: o que a planilha não traz fica vazio, e o que não dá
// para encaixar vira aviso na prévia em vez de entrar torto. A conversão é pura
// para poder ser testada linha a linha; quem lê o arquivo e quem grava são
// outros.

const texto = (valor) => String(valor ?? "").replace(/\s+/g, " ").trim();
const cru = (valor) => String(valor ?? "").replace(/\r\n/g, "\n").trim();
const semAcento = (valor) => texto(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const numero = (valor) => {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  const limpo = texto(valor).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
};

// A planilha traz data como Date (xlsx), como "2026-09-01 00:00:00" e, nos
// updates, como "26/August/2026 05:10:40 PM". Sempre sai AAAA-MM-DD, e o que
// não for data vira "" — nunca a data de hoje, que faria um registro antigo
// parecer recente.
const MESES = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  janeiro: "01", fevereiro: "02", marco: "03", abril: "04", maio: "05", junho: "06",
  julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
};

export const dataDaPlanilha = (valor) => {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString().slice(0, 10);
  const bruto = texto(valor);
  if (!bruto) return "";
  const iso = bruto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const porExtenso = bruto.match(/^(\d{1,2})\/([A-Za-zçÇ]+)\/(\d{4})/);
  if (porExtenso) {
    const mes = MESES[semAcento(porExtenso[2])];
    if (mes) return `${porExtenso[3]}-${mes}-${porExtenso[1].padStart(2, "0")}`;
    return "";
  }
  const br = bruto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  return "";
};

// O funil do quadro externo, traduzido para o funil da titular. "Proposta /
// BID" passa pelo mesmo apelido que a régua do produto já conhece, para o
// quadro externo e a tela não discordarem sobre onde a oportunidade está.
const FUNIL_EXTERNO = {
  "prospecao": "Prospecção",
  "prospeccao": "Prospecção",
  "apresentacao": "Apresentação",
  "proposta / bid": "proposta",
  "proposta/bid": "proposta",
  "proposta": "proposta",
  "negociacao": "Negociação",
  "homologacao": "Homologação",
  "fechamento": "Fechamento",
};

export const estagioDoFunilExterno = (funil) => {
  const chave = semAcento(funil);
  if (!chave || chave === "sem classificacao") return "";
  return estagioValido(FUNIL_EXTERNO[chave] || funil);
};

// Status do quadro que FECHA a oportunidade. O status manda no grupo: um
// projeto marcado "Feito" é ganho mesmo listado fora dos concluídos.
const STATUS_QUE_FECHA = {
  feito: "Fechada ganha",
  ganho: "Fechada ganha",
  "nao ganhado": "Fechada perdida",
  "nao ganho": "Fechada perdida",
  perdido: "Fechada perdida",
  cancelado: "Fechada perdida",
};

const GRUPO_QUE_FECHA = {
  concluidos: "Fechada ganha",
  "cancelados / nao ganhos": "Fechada perdida",
};

const grupoNormalizado = (titulo) => semAcento(titulo)
  .replace(/^projetos?\s+(em\s+)?/, "")
  .replace(/\s*-\s*.*$/, (trecho) => (semAcento(titulo).startsWith("projetos em andamento") ? trecho : ""))
  .trim();

// "Projetos em Andamento - Amazon" diz que TODA linha daquele grupo é da conta
// Amazon; "Projetos em Andamento - Novos Clientes" não nomeia conta nenhuma.
const GRUPOS_SEM_CONTA = new Set(["novos clientes", "novos negocios", "geral"]);

export const contaDoGrupo = (titulo) => {
  const partes = texto(titulo).split(/\s+-\s+/);
  if (partes.length < 2) return "";
  const candidata = texto(partes.slice(1).join(" - "));
  return GRUPOS_SEM_CONTA.has(semAcento(candidata)) ? "" : candidata;
};

// Sufixo que descreve a FRENTE, não a empresa: "Mercado Livre Middle Mile" e
// "Loreal Retomada" são a mesma conta que "Mercado Livre" e "L'Oreal". A lista
// é curta e explícita de propósito — normalizar demais junta contas que são
// mesmo diferentes.
const SUFIXOS_DE_FRENTE = /\s+(middle mile|last mile|first mile|retomada|on\/off|on off|spot)$/i;

// O nome do projeto carrega a conta: "Projeto Magalog" → Magalog; "Projeto
// Maersk - On Running" → Maersk; "Projeto DHL (LH - Mercado Livre)" → DHL.
export const contaDoProjeto = (nome) => {
  const semPrefixo = texto(nome)
    .replace(/^(projeto|proposta|bid|implementar|implementacao do|implementação do)\s+/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ");
  const primeiro = texto(semPrefixo.split(/\s+-\s+/)[0]).replace(SUFIXOS_DE_FRENTE, "");
  return texto(primeiro) || texto(nome);
};

// Linha que não é oportunidade de cliente: trabalho interno que o quadro
// guarda junto (definir TMS, precificar praça, implantar sistema). Reconhece-se
// por não ter prefixo de projeto/proposta, não pertencer a um grupo de conta e
// não ter etapa de funil. Entra como registro, mas sem criar conta de cliente
// no CRM — conta inventada suja a carteira para sempre.
export const ehTrabalhoInterno = ({ nome, conta, estagioDoFunil }) =>
  !/^(projeto|proposta)\s+/i.test(texto(nome)) && !conta && !estagioDoFunil;

const ehCabecalho = (linha) => semAcento(linha[0]) === "nome";
const ehSubtabela = (linha) => semAcento(linha[0]) === "subitems" || semAcento(linha[1]) === "name";
const ehTotais = (linha) => !texto(linha[0]) && (numero(linha[6]) > 0 || numero(linha[7]) > 0 || texto(linha[8]));
const ehTituloDeGrupo = (linha) => Boolean(texto(linha[0])) && linha.slice(1).every((celula) => !texto(celula));

const PRIORIDADES = { critico: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };
const prioridadeLegivel = (valor) => PRIORIDADES[semAcento(valor).replace(/[^a-z]/g, "")] || texto(valor);

const responsaveis = (valor) => texto(valor).split(/\s*,\s*/).filter(Boolean);

/**
 * Converte as linhas da aba de projetos em contas e oportunidades.
 * Recebe linhas cruas (array de arrays), como o leitor de xlsx devolve.
 */
export const interpretarProjetos = (linhas = []) => {
  const oportunidades = [];
  const avisos = [];
  let grupo = "";
  let contaDoGrupoAtual = "";
  let dentroDeSubtabela = false;

  for (const linhaCrua of linhas) {
    const linha = Array.isArray(linhaCrua) ? linhaCrua : [];
    const nome = texto(linha[0]);

    if (ehSubtabela(linha)) { dentroDeSubtabela = true; continue; }
    if (ehCabecalho(linha)) { dentroDeSubtabela = false; continue; }
    if (ehTotais(linha)) { dentroDeSubtabela = false; continue; }
    if (!nome) { if (!texto(linha[1])) dentroDeSubtabela = false; continue; }
    if (dentroDeSubtabela) continue;

    if (ehTituloDeGrupo(linha)) {
      // O título do quadro e a linha de instrução não são grupo.
      if (/dashboard|gerencie qualquer tipo/i.test(nome)) continue;
      grupo = nome;
      contaDoGrupoAtual = contaDoGrupo(nome);
      continue;
    }
    if (!grupo) continue;

    const status = texto(linha[5]);
    const fechamento = STATUS_QUE_FECHA[semAcento(status)]
      || GRUPO_QUE_FECHA[grupoNormalizado(grupo)]
      || "";
    const doFunil = estagioDoFunilExterno(linha[3]);
    const interno = ehTrabalhoInterno({ nome, conta: contaDoGrupoAtual, estagioDoFunil: doFunil });
    if (!doFunil && !fechamento && !interno) {
      avisos.push(`"${nome}" veio sem classificação de funil e entrou em Prospecção.`);
    }
    if (interno) avisos.push(`"${nome}" parece trabalho interno: entrou sem criar conta de cliente.`);
    const conta = interno ? "" : (contaDoGrupoAtual || contaDoProjeto(nome));

    oportunidades.push({
      nome,
      conta,
      interno,
      estagio: fechamento || doFunil || "Prospecção",
      grupo,
      situacao: status,
      prioridade: prioridadeLegivel(linha[4]),
      responsaveis: responsaveis(linha[2]),
      subelementos: texto(linha[1]),
      valorAnual: numero(linha[6]),
      valorMensal: numero(linha[7]),
      inicioEm: dataDaPlanilha(linha[8]),
      propostaEm: dataDaPlanilha(linha[9]),
      fimEm: dataDaPlanilha(linha[10]),
      resumo: cru(linha[11]),
    });
  }

  return { oportunidades, avisos };
};

// Que tipo de interação é aquele update? A classificação sai do texto, com a
// regra explícita — e cai em "outro" quando o texto não diz, em vez de chutar
// uma reunião que nunca houve.
const PADROES_DE_TIPO = [
  ["reuniao", /reuni|apresenta[cç]|call\b|encontro|agenda(?:da|mos|mento)?\b/i],
  ["proposta", /proposta|bid\b|or[cç]amento|tabela de pre[cç]o|cota[cç][aã]o/i],
  ["tentativa", /sem retorno|tentativa|n[aã]o retornou|aguardando retorno|sem resposta/i],
  ["email", /e-?mail|enviei o material|encaminhei/i],
  ["whatsapp", /whats|zap\b/i],
  ["visita", /visita|in loco|fomos at[eé]/i],
  ["ligacao", /liga[cç][aã]o|liguei|telefone|contato telef/i],
];

export const classificarTipoDaInteracao = (conteudo) => {
  const alvo = texto(conteudo);
  for (const [tipo, padrao] of PADROES_DE_TIPO) if (padrao.test(alvo)) return tipo;
  return "outro";
};

const assuntoDoUpdate = (conteudo) => {
  const primeira = cru(conteudo).split("\n").map((linha) => texto(linha)).find(Boolean) || "Atualização do projeto";
  return primeira.length > 140 ? `${primeira.slice(0, 137)}...` : primeira;
};

/**
 * Converte a aba de updates em interações, ligando cada uma ao projeto pelo
 * nome. Update de subitem entra no projeto que o contém (a planilha lista o
 * subitem em "Subelementos"), e o que não encontra dono vira aviso.
 */
export const interpretarUpdates = (linhas = [], oportunidades = []) => {
  const porNome = new Map();
  for (const oportunidade of oportunidades) {
    porNome.set(semAcento(oportunidade.nome), oportunidade.nome);
    for (const subelemento of texto(oportunidade.subelementos).split(/\s*,\s*/).filter(Boolean)) {
      if (!porNome.has(semAcento(subelemento))) porNome.set(semAcento(subelemento), oportunidade.nome);
    }
  }

  const interacoes = [];
  const semDono = new Set();
  for (const linhaCrua of linhas) {
    const linha = Array.isArray(linhaCrua) ? linhaCrua : [];
    const projeto = texto(linha[1]);
    const conteudo = cru(linha[6]);
    if (!projeto || !conteudo) continue;
    if (semAcento(projeto) === "item name") continue;

    const dono = porNome.get(semAcento(projeto));
    if (!dono) { semDono.add(projeto); continue; }

    const quando = dataDaPlanilha(linha[5]);
    if (!quando) continue;
    const resposta = semAcento(linha[3]) === "reply" || Boolean(texto(linha[10]));

    interacoes.push({
      projeto: dono,
      // Um update de subitem diz no assunto de qual frente ele é.
      assunto: dono === projeto ? assuntoDoUpdate(conteudo) : `${projeto}: ${assuntoDoUpdate(conteudo)}`,
      ata: conteudo,
      participantes: texto(linha[4]),
      tipo: classificarTipoDaInteracao(conteudo),
      ocorridaEm: quando,
      resposta,
    });
  }

  const avisos = [...semDono].map((nome) => `Os updates de "${nome}" não encontraram projeto correspondente e ficaram de fora.`);
  return { interacoes, avisos };
};

/**
 * A leitura completa do export: projetos + updates viram o plano de importação,
 * com o resumo que a prévia mostra antes de gravar qualquer coisa.
 */
export const planoDeImportacao = ({ projetos = [], updates = [] } = {}) => {
  const { oportunidades, avisos: avisosDeProjeto } = interpretarProjetos(projetos);
  const { interacoes, avisos: avisosDeUpdate } = interpretarUpdates(updates, oportunidades);
  const contas = [...new Map(
    oportunidades
      .filter((item) => item.conta)
      .map((item) => [semAcento(item.conta).replace(/[^a-z0-9]/g, ""), item.conta]),
  ).values()];

  return {
    contas,
    oportunidades,
    interacoes,
    avisos: [...avisosDeProjeto, ...avisosDeUpdate],
    resumo: {
      contas: contas.length,
      oportunidades: oportunidades.length,
      interacoes: interacoes.length,
      valorMensal: oportunidades.reduce((soma, item) => soma + item.valorMensal, 0),
      valorAnual: oportunidades.reduce((soma, item) => soma + item.valorAnual, 0),
      abertas: oportunidades.filter((item) => !item.estagio.startsWith("Fechada")).length,
    },
  };
};

// O que sobra da planilha e não tem coluna própria continua no registro, em vez
// de ser descartado: grupo do quadro, prioridade, responsáveis por nome, datas
// de proposta e término e o resumo do acompanhamento.
export const oportunidadeParaRegistro = (item, clientId = "") => ({
  cliente: item.conta || item.nome,
  clientId,
  estagio: item.estagio,
  valorMensal: item.valorMensal,
  valorContrato: item.valorAnual,
  ultimaInteracaoEm: item.propostaEm || item.inicioEm || "",
  campos: {
    nomeDoProjeto: item.nome,
    grupoNoQuadro: item.grupo,
    situacaoNoQuadro: item.situacao,
    prioridade: item.prioridade,
    responsaveis: item.responsaveis,
    subelementos: item.subelementos,
    inicioEm: item.inicioEm,
    propostaEm: item.propostaEm,
    fimEm: item.fimEm,
    resumoDoAcompanhamento: item.resumo,
    origem: "Importação do quadro de Novos Negócios",
  },
});

// Reimportar o mesmo arquivo não pode duplicar: a oportunidade é reconhecida
// pelo nome do projeto e a interação pelo trio projeto + data + assunto.
export const chaveDaOportunidade = (registro = {}) =>
  // O prefixo "Projeto"/"Proposta" cai fora da chave: a oportunidade que já
  // existe no CRM com o nome da empresa é a MESMA que o quadro chama de
  // "Projeto <empresa>". Sem isso, a primeira importação criaria uma segunda
  // oportunidade ao lado da que a equipe já acompanhava.
  semAcento(registro.campos?.nomeDoProjeto || registro.nomeDoProjeto || registro.cliente || "")
    .replace(/^(projeto|proposta)\s+/, "");

export const chaveDaInteracao = (registro = {}) =>
  `${semAcento(registro.assunto)}|${texto(registro.ocorridaEm)}`;
