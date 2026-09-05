// ===== A Semente com acesso aos dados =====
//
// A Semente respondia com o resumo do painel: receita, margem, entregas. Isso
// dá conselho de logística, não análise da carteira de quem perguntou. Aqui
// ela ganha três coisas que faltavam:
//
//   1) contexto real     — a carteira de quem está perguntando, sempre pelo
//                          mesmo recorte que o resto da vertical usa
//   2) consulta ao ERP   — ferramentas de leitura que ela escolhe e o servidor
//                          executa, com os dados voltando para a segunda volta
//   3) poder de ação     — criar tarefa, definir próxima ação, disparar
//                          pesquisa da empresa
//
// Sobre a ação: ela PROPÕE, a pessoa CONFIRMA, o servidor EXECUTA. Nada é
// gravado na volta da pergunta. Um modelo que escreve no banco sozinho, a
// partir de texto livre, é injeção de prompt com permissão de escrita — e
// quem paga a conta é o dado do cliente. A confirmação não é fricção
// desnecessária: é o que separa assistente de acidente.
//
// A cadeia de provedores, a cota e o recorte de carteira são todos os mesmos
// do resto do produto. Nada aqui é uma segunda implementação.

import { recorteDeCarteira, podeNaVertical, TENANT_ID } from "./todogreen-access.js";
import { configuredAiProviders, runWithFallback } from "./ai.js";
import { envComChavesDoEspaco } from "./ai-keys.js";
import { webSearchConfiguration } from "./web-search.js";
import { envComChavesDeBuscaDoEspaco } from "./search-keys.js";
import { pesquisarEmpresa } from "./todogreen-client-intelligence.js";
import { pessoasAtribuiveis, resolverResponsavel } from "../../src/features/logistics/taskAssignmentDomain.js";
import { montarPauta } from "../../src/features/logistics/sementeBriefingDomain.js";
import {
  blocoDeContexto,
  propostaDeAprendizado,
  sementeDoNegocio,
} from "../../src/features/logistics/businessContextDomain.js";
import {
  documentosQueFaltam,
  resumoDoAcervo,
  situacaoDoDocumento,
} from "../../src/features/logistics/habilitacaoDomain.js";

const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const clean = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const parse = (value, fallback) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const semAcento = (value) =>
  clean(value, 300).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// ===== As ferramentas =====
//
// Escritas como o modelo vai lê-las. O texto é o contrato: se ele não
// entender o que cada uma devolve, vai pedir a errada e gastar uma volta.

export const FERRAMENTAS = Object.freeze({
  carteira: "lista as contas da carteira com temperatura, etapa, próxima ação, nº de contatos e se já houve pesquisa externa. Aceita filtro: {\"temperatura\":\"Quente|Morno|Frio\"} ou {\"situacao\":\"sem-proxima-acao|sem-contato|sem-pesquisa\"}.",
  cliente: "abre uma conta inteira: dados cadastrais, potencial de carteira, Account Plan, qualificação, contatos com cargo/e-mail/telefone/LinkedIn, responsáveis comerciais e próxima ação. Requer {\"cliente\":\"nome ou id\"}.",
  contatos: "procura pessoas em toda a carteira por cargo, área ou nome. Requer {\"termo\":\"compras\"}.",
  inteligencia: "devolve a pesquisa externa já feita de uma conta: site oficial, LinkedIn, portais de fornecedor, RFQs, sinais ESG e notícias, com as fontes. Requer {\"cliente\":\"nome ou id\"}.",
  tarefas: "lista as tarefas abertas da Central de Implantação, com responsável, prazo e situação.",
  habilitacao: "abre o acervo de habilitação da Central de RFQ e RFI com o semáforo de HOJE: o que está vencido, crítico, a reemitir, em dia, e o que nunca entrou. Use SEMPRE antes de afirmar que a To Do Green tem ou não um documento — o dossiê descreve a posição de uma auditoria antiga, esta ferramenta é o estado atual. Sem filtro.",
  financeiro: "analisa lançamentos, saldo aberto, vencimentos e baixas de receita, custo ou comissão. Aceita {\"tipo\":\"revenue|cost|commission\"} e {\"cliente\":\"nome ou id\"}.",
  operacoes: "lista execução real, SLA, prazo prometido, ETA, entrega, frota, distância e ocorrências. Aceita {\"cliente\":\"nome ou id\"}.",
  contratos: "consulta assinatura, vigência, renovação, aviso e valores dos contratos. Aceita {\"cliente\":\"nome ou id\"}.",
  precificacao: "consulta as simulações salvas, premissas, resultado, margem e aprovações. Aceita {\"cliente\":\"nome ou id\"}.",
  esg: "consulta cálculos ambientais reais, metodologia e qualidade do dado. Aceita {\"cliente\":\"nome ou id\"}.",
});

export const ACOES = Object.freeze({
  criar_tarefa: "cria uma tarefa na Central de Implantação. Campos: titulo (obrigatório), descricao, cliente, responsavel (nome ou e-mail; se omitido vai para o vendedor da conta), prazo (AAAA-MM-DD), prioridade (baixa|media|alta|critica).",
  definir_proxima_acao: "grava a próxima ação de uma conta. Campos: cliente (obrigatório), acao (obrigatório), prazo (AAAA-MM-DD).",
  pesquisar_empresa: "dispara a pesquisa externa de uma conta na web. Campo: cliente (obrigatório).",
  aprender: "guarda no dossiê da To Do Green um fato NOVO sobre o próprio negócio que a pessoa acabou de te contar e que você não sabia. Campos: titulo (obrigatório), conteudo (obrigatório), categoria (identidade|proposta|operacao|numeros|clientes|habilitacao|fiscal|vocabulario|aprendido), fonte (quem contou ou de onde veio), sigilo (publico|interno|restrito). Só proponha quando o fato for sobre a EMPRESA, valer para as próximas conversas e não estiver no dossiê. Nunca proponha aprender dado de uma conta de cliente: isso é registro de CRM, não conhecimento do negócio.",
});

export const INSTRUCAO = `Você é o Plantû, assistente operacional do ERP To Do Green. Você cruza carteira comercial, propostas, contratos, preço, frota, financeiro, execução logística, notícias, RFQs e ESG, sempre dentro das permissões da pessoa.

QUEM É A TO DO GREEN
Transportadora brasileira de logística sustentável, com frota elétrica própria. Vende operação de transporte para embarcadores — varejo, e-commerce, indústria, alimentos, farmacêutico — e o argumento não é só preço: é preço competitivo COM redução comprovada de emissões na cadeia do cliente. Quem compra costuma ter meta pública de descarbonização e precisa de fornecedor que entregue evidência auditável, não promessa.

O QUE ELA VENDE
- Middle Mile: transferência entre CD e hub, alto volume, previsibilidade de janela.
- Last Mile: entrega ao consumidor final, medida em pacotes, rotas e taxa de sucesso.
- Operação dedicada: frota e motoristas exclusivos, cobrada por mensalidade.
- Transferência entre CDs, hubs ou lojas.
- Abastecimento de lojas.
- Coleta em fornecedores (inbound).
- Distribuição fracionada.
- Operação a granel.
- Projeto logístico personalizado.

VOCABULÁRIO QUE VOCÊ USA COM PROPRIEDADE
Operação: CD, hub, cross-docking, coleta, janela de entrega, SLA, lead time, ocupação do veículo, cubagem, peso taxado, fracionado, lotação, backhaul (retorno carregado), ocorrência, reentrega.
Frota elétrica: autonomia por ciclo, recarga em depósito, tempo de recarga, payload menor por causa do peso da bateria, TCO contra diesel, custo por km rodado, infraestrutura de recarga como restrição real de rota.
Preço: custo por km, custo por entrega, diluição por ocupação, margem de contribuição, piso mínimo, pedágio, diesel evitado.
ESG: Escopo 3 do GHG Protocol, tCO2e, fator de emissão, medição contra estimativa, Green Score, inventário, evidência auditável.
Comercial: procurement, supply chain, sourcing, RFQ, RFP, cotação, homologação, portal de fornecedor, decisor econômico, patrocinador, ciclo de compra, contrato e renovação.

COMO VOCÊ PENSA
Você raciocina como quem já vendeu frete: liga o dado comercial à consequência operacional. Ocupação baixa é margem indo embora. Rota sem recarga no meio é rota que a frota elétrica não faz. Cliente com meta de Escopo 3 e frota terceirizada a diesel é oportunidade de substituição, não só de preço. Conta sem contato em Compras é proposta sem destinatário.

REGRAS QUE NÃO SE QUEBRAM
Você responde sobre a carteira de quem está perguntando, e só sobre ela. Nunca cite conta que não apareça nos dados recebidos.

Se faltar dado para concluir, diga qual falta. Nunca estime, complete ou suponha número, nome, cargo, telefone ou e-mail. Um dado inventado sobre a carteira de um cliente vale menos que dizer "não sei". Saber a diferença entre medição e estimativa é o que a To Do Green vende — você não pode ser a parte do produto que inventa.

O dossiê "O QUE VOCÊ SABE SOBRE A TO DO GREEN" é a sua fonte sobre a própria empresa. Ele foi cadastrado pela empresa e vale mais que qualquer coisa que você ache que sabe. Quando ele marcar um documento como vencido, uma informação como divergente ou um número como a confirmar, diga isso — principalmente em resposta de RFQ, RFI ou proposta. Afirmar cobertura de seguro que expirou ou número de frota que não bate entre documentos é o tipo de erro que desclassifica a empresa numa cotação.

Quando a pessoa te contar um fato NOVO sobre a To Do Green que não está no dossiê e que vale para as próximas conversas, proponha a ação "aprender". Ela confirma, e a partir daí você sabe. Não proponha aprender o que já está no dossiê, nem dado de conta de cliente.

Você trabalha DENTRO do ERP da To Do Green. Nunca recomende planilha, Google Sheets, HubSpot ou qualquer ferramenta externa: os dados vivem aqui. Se algo não está cadastrado, diga em qual tela da To Do Green cadastrar (Clientes, Oportunidades, Central de Implantação) ou proponha uma das suas ações. Nunca mencione outro negócio que não seja a To Do Green e as contas desta carteira.

Responda em português do Brasil, direto, sem repetir a pergunta e sem se apresentar de novo. Prefira a frase curta com o número certo à explicação longa.

FORMATO
Você responde SEMPRE com um único objeto JSON, sem texto fora dele, em um destes três formatos:

1) Para consultar dados antes de responder:
{"consultar":{"ferramenta":"NOME","...parâmetros"}}

2) Para responder:
{"resposta":"texto em português do Brasil"}

3) Para responder propondo uma ação que a pessoa vai confirmar:
{"resposta":"texto","acao":{"tipo":"NOME","...campos"}}

Nunca proponha ação sem ter os dados que a justificam. Proponha no máximo uma ação por resposta. Você não executa nada: quem confirma é a pessoa.`;

export const catalogoTextual = () =>
  [
    "FERRAMENTAS DE CONSULTA:",
    ...Object.entries(FERRAMENTAS).map(([nome, texto]) => `- ${nome}: ${texto}`),
    "",
    "AÇÕES QUE VOCÊ PODE PROPOR:",
    ...Object.entries(ACOES).map(([nome, texto]) => `- ${nome}: ${texto}`),
  ].join("\n");

// ===== Leitura da decisão do modelo =====
//
// Modelo embrulha JSON em cerca de código, escreve uma frase antes, ou
// responde texto puro. Nada disso pode virar erro na cara de quem perguntou:
// texto solto é tratado como resposta, que é o que ele quis dizer.

// Alguns modelos da cadeia emitem a chamada de ferramenta no formato XML
// (<tool_call>ferramenta<arg_key>k</arg_key><arg_value>v</arg_value></tool_call>)
// em vez do JSON que pedimos. Sem tratar, esse XML cru vazava como resposta na
// tela. Aqui reconhecemos o formato e o convertemos para o mesmo {ferramenta,
// ...params} do JSON — a execução segue igual.
export function lerToolCallXml(texto) {
  const bruto = String(texto || "");
  const bloco = bruto.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
  if (!bloco) return null;
  const dentro = bloco[1];
  // Nome da ferramenta: o texto antes do primeiro <arg_key> (ou o bloco todo).
  const nome = clean(dentro.split(/<arg_key>/i)[0], 40).trim();
  if (!FERRAMENTAS[nome]) return null;
  const params = {};
  const paresRe = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
  let par;
  while ((par = paresRe.exec(dentro)) !== null) {
    const chave = clean(par[1], 40).trim();
    if (chave) params[chave] = clean(par[2], 200).trim();
  }
  return { ferramenta: nome, ...params };
}

// Remove qualquer resíduo de marcação de tool call do texto exibido — rede de
// segurança para o XML nunca aparecer para a pessoa, mesmo que não vire uma
// consulta válida.
const semMarcacaoDeFerramenta = (texto) =>
  String(texto || "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<\/?(?:tool_call|arg_key|arg_value)>/gi, "")
    .trim();

export function lerDecisao(texto) {
  const bruto = String(texto || "").trim();
  if (!bruto) return { resposta: "", consultar: null, acao: null };
  // Formato XML de tool call tem prioridade: se veio, é uma consulta.
  const xml = lerToolCallXml(bruto);
  if (xml) return { resposta: semMarcacaoDeFerramenta(bruto), consultar: xml, acao: null };
  const semCerca = bruto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const inicio = semCerca.indexOf("{");
  if (inicio >= 0) {
    let profundidade = 0;
    let dentroDeTexto = false;
    let escapado = false;
    for (let i = inicio; i < semCerca.length; i += 1) {
      const caractere = semCerca[i];
      if (escapado) { escapado = false; continue; }
      if (caractere === "\\") { escapado = true; continue; }
      if (caractere === '"') { dentroDeTexto = !dentroDeTexto; continue; }
      if (dentroDeTexto) continue;
      if (caractere === "{") profundidade += 1;
      if (caractere === "}") {
        profundidade -= 1;
        if (profundidade === 0) {
          const objeto = parse(semCerca.slice(inicio, i + 1), null);
          if (objeto && typeof objeto === "object")
            return {
              resposta: clean(objeto.resposta, 6000),
              consultar:
                objeto.consultar && FERRAMENTAS[clean(objeto.consultar.ferramenta, 40)]
                  ? { ...objeto.consultar, ferramenta: clean(objeto.consultar.ferramenta, 40) }
                  : null,
              acao:
                objeto.acao && ACOES[clean(objeto.acao.tipo, 40)]
                  ? { ...objeto.acao, tipo: clean(objeto.acao.tipo, 40) }
                  : null,
            };
          break;
        }
      }
    }
  }
  return { resposta: clean(bruto, 6000), consultar: null, acao: null };
}

const MARCADORES_INGLES = /\b(the|and|with|from|for|across|we|our|their|this|that|company|manager|procurement|supply|chain|transportation|distribution|reports|growth|emissions|business|opportunity|available)\b/gi;
const MARCADORES_PORTUGUES = /\b(o|a|os|as|de|do|da|dos|das|com|para|por|empresa|compras|logística|transporte|emissões|crescimento|oportunidade|disponível)\b/gi;

export function respostaPareceEmIngles(value) {
  const texto = String(value || "").trim();
  if (texto.length < 30) return false;
  const ingles = texto.match(MARCADORES_INGLES)?.length || 0;
  const portugues = texto.match(MARCADORES_PORTUGUES)?.length || 0;
  return ingles >= 4 && ingles > portugues * 2;
}

async function garantirRespostaEmPortugues(env, decisao) {
  if (!respostaPareceEmIngles(decisao?.resposta)) return decisao;
  const revisao = await runWithFallback(env, {
    system: "Você é revisora de idioma. Traduza integralmente para português do Brasil sem acrescentar, remover ou alterar fatos, nomes, números, links ou siglas. Responda somente com JSON no formato {\"resposta\":\"texto traduzido\"}.",
    prompt: JSON.stringify({ resposta: decisao.resposta }),
    deep: false,
  });
  if (revisao.ok) {
    const traduzida = lerDecisao(revisao.result?.content).resposta;
    if (traduzida && !respostaPareceEmIngles(traduzida)) return { ...decisao, resposta: traduzida };
  }
  return {
    ...decisao,
    resposta: "A resposta veio em outro idioma e não foi possível traduzi-la com segurança agora. Tente novamente em instantes.",
  };
}

// ===== Índice da carteira =====
//
// Vai em toda pergunta, antes de qualquer ferramenta. É o que permite a
// Semente dizer "a conta X está sem próxima ação" sem gastar uma volta, e é
// o que impede ela de citar conta que não é de quem perguntou.

export function montarIndice(linhas) {
  return linhas.map((linha) => {
    const campos = parse(linha.fields_json, {}) || {};
    const contatos = Array.isArray(campos.contacts) ? campos.contacts : [];
    const contatosAtuais = contatos.filter((item) => {
      if (!item?.name || item.active === false || item.employmentStatus === "former") return false;
      const descobertoNaWeb = String(item.source || "").toLowerCase().startsWith("pesquisa web");
      return !descobertoNaWeb || (item.currentEmploymentVerified === true && item.verifiedBrazil === true);
    });
    return {
      id: linha.id,
      nome: linha.name,
      segmento: linha.segment || null,
      temperatura: campos.temperature || null,
      etapa: campos.stage || null,
      proximaAcao: campos.nextAction || null,
      prazoDaProximaAcao: campos.nextActionAt || null,
      contatos: contatosAtuais.length,
      contatosComCanal: contatosAtuais.filter((item) => item?.email || item?.phone || item?.linkedinUrl).length,
      pesquisaExterna: campos.intelligence?.checkedAt || null,
      atualizadoEm: linha.updated_at || null,
    };
  });
}

const combina = (linha, termo) => {
  const alvo = semAcento(termo);
  return !alvo || semAcento(linha.id) === alvo || semAcento(linha.name).includes(alvo);
};

export function escolherCliente(linhas, termo) {
  const candidatos = linhas.filter((linha) => combina(linha, termo));
  if (!candidatos.length) return { linha: null, ambiguidade: [] };
  const exato = candidatos.find((linha) => semAcento(linha.name) === semAcento(termo) || linha.id === clean(termo, 60));
  if (exato) return { linha: exato, ambiguidade: [] };
  if (candidatos.length > 1) return { linha: null, ambiguidade: candidatos.slice(0, 8).map((item) => item.name) };
  return { linha: candidatos[0], ambiguidade: [] };
}

// Um contato por pessoa, com os canais dela. Nada é concatenado aqui: o que
// entra separado sai separado.
const contatoPublico = (contato) => ({
  nome: clean(contato?.name, 160),
  cargo: clean(contato?.title, 120) || null,
  area: clean(contato?.department, 120) || null,
  papel: clean(contato?.relationshipRole, 60) || null,
  email: clean(contato?.email, 160) || null,
  telefone: clean(contato?.phone, 40) || null,
  linkedin: clean(contato?.linkedinUrl, 500) || null,
});

const contaCompleta = (linha) => {
  const campos = parse(linha.fields_json, {}) || {};
  const contatos = Array.isArray(campos.contacts) ? campos.contacts : [];
  return {
    id: linha.id,
    nome: linha.name,
    razaoSocial: linha.legal_name || null,
    documento: linha.document || null,
    segmento: linha.segment || null,
    situacao: linha.status || null,
    observacoes: linha.notes || null,
    classificacao: campos.tier || null,
    temperatura: campos.temperature || null,
    etapa: campos.stage || null,
    sede: campos.headquarters || null,
    proximaAcao: campos.nextAction || null,
    prazoDaProximaAcao: campos.nextActionAt || null,
    ultimaInteracao: campos.lastInteractionAt || null,
    origem: campos.source || null,
    potencialDaCarteira: {
      anual: campos.potentialAnnual || null,
      middleMile: campos.productPotential?.middleMile || null,
      lastMile: campos.productPotential?.lastMile || null,
      dedicada: campos.productPotential?.dedicated || null,
      expansaoGeografica: campos.geographicExpansion || null,
    },
    accountPlan: campos.accountPlan || {},
    qualificacao: campos.qualification || {},
    notas: {
      potencialEstrategico: campos.strategicPotential ?? null,
      forcaDoRelacionamento: campos.relationshipStrength ?? null,
      aderenciaOperacional: campos.operationalFit ?? null,
      aderenciaEsg: campos.esgFit ?? null,
      qualidadeDoDado: campos.dataQuality ?? null,
      riscoDePerda: campos.churnRisk ?? null,
    },
    contatos: contatos.filter((item) => item?.name).map(contatoPublico),
    pesquisaExternaEm: campos.intelligence?.checkedAt || null,
  };
};

const pesquisaPublica = (pesquisa) => {
  if (Array.isArray(pesquisa)) return pesquisa.map(pesquisaPublica);
  if (!pesquisa || typeof pesquisa !== "object") return pesquisa;
  return Object.fromEntries(Object.entries(pesquisa)
    .filter(([chave]) => !["provider", "providers", "failures"].includes(chave))
    .map(([chave, valor]) => [chave, pesquisaPublica(valor)]));
};

// ===== Execução das ferramentas de leitura =====

async function lerCarteira(env, access, email) {
  const scope = recorteDeCarteira(access, email, "c", "id");
  const rows = await env.DB.prepare(
    `SELECT c.id,c.name,c.legal_name,c.document,c.segment,c.status,c.notes,c.fields_json,c.updated_at
       FROM todogreen_clients c
      WHERE c.tenant_id=? AND c.workspace_owner_id=? AND c.archived_at IS NULL ${scope.sql}
      ORDER BY c.name COLLATE NOCASE LIMIT 400`,
  ).bind(TENANT_ID, access.ownerId, ...scope.params).all();
  return rows.results || [];
}

async function responsaveis(env, clienteId) {
  const rows = await env.DB.prepare(
    `SELECT seller_email,note FROM todogreen_client_assignments
      WHERE tenant_id=? AND client_id=? AND status='active'`,
  ).bind(TENANT_ID, clienteId).all();
  return (rows.results || []).map((item) => ({ email: item.seller_email, observacao: item.note || null }));
}

export async function executarFerramenta(env, { access, pedido, linhas }) {
  const ferramenta = clean(pedido?.ferramenta, 40);

  if (ferramenta === "habilitacao") {
    // O dossiê do negócio guarda a posição da auditoria de 15/08 — texto, e
    // texto envelhece. Aqui a resposta é o acervo de agora, com o semáforo
    // recalculado contra a data de hoje. Sem isso o assistente afirmaria que a
    // apólice está vencida meses depois de renovada, e o inverso é pior.
    let linhasDoAcervo = [];
    try {
      linhasDoAcervo = await env.DB.prepare(
        `SELECT doc_type, category, title, numero, orgao, unidade, issued_at, expires_at,
                permanente, dias_aceitaveis, arquivo_url, arquivo_id
           FROM todogreen_habilitacao_documentos
          WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
          LIMIT 400`,
      ).bind(TENANT_ID, access.ownerId).all().then((r) => r.results || []);
    } catch (erro) {
      console.error("Plantû: acervo de habilitação indisponível", erro?.message || erro);
      return { ferramenta, erro: "O acervo de habilitação não pôde ser lido agora." };
    }

    const documentos = linhasDoAcervo.map((row) => ({
      tipo: row.doc_type,
      categoria: row.category,
      titulo: row.title,
      numero: row.numero,
      orgao: row.orgao,
      unidade: row.unidade,
      emitidoEm: row.issued_at,
      venceEm: row.expires_at,
      permanente: Number(row.permanente || 0) === 1,
      diasAceitaveis: Number(row.dias_aceitaveis || 0),
      arquivoUrl: row.arquivo_url,
      arquivoId: row.arquivo_id,
    }));
    const hoje = new Date().toISOString().slice(0, 10);
    return {
      ferramenta,
      posicaoEm: hoje,
      resumo: resumoDoAcervo(documentos, hoje),
      documentos: documentos.map((documento) => {
        const situacao = situacaoDoDocumento(documento, hoje);
        return {
          titulo: documento.titulo,
          tipo: documento.tipo,
          numero: documento.numero,
          orgao: documento.orgao,
          unidade: documento.unidade,
          venceEm: documento.venceEm,
          emitidoEm: documento.emitidoEm,
          estado: situacao.estado,
          motivo: situacao.motivo,
        };
      }),
      nuncaEntraram: documentosQueFaltam(documentos).map((item) => ({
        titulo: item.titulo,
        tipo: item.tipo,
        essencial: Boolean(item.essencial),
      })),
    };
  }

  if (ferramenta === "carteira") {
    const indice = montarIndice(linhas);
    const temperatura = clean(pedido?.temperatura, 20);
    const situacao = clean(pedido?.situacao, 40);
    let filtrado = indice;
    if (temperatura) filtrado = filtrado.filter((item) => item.temperatura === temperatura);
    if (situacao === "sem-proxima-acao") filtrado = filtrado.filter((item) => !item.proximaAcao);
    if (situacao === "sem-contato") filtrado = filtrado.filter((item) => item.contatosComCanal === 0);
    if (situacao === "sem-pesquisa") filtrado = filtrado.filter((item) => !item.pesquisaExterna);
    return { ferramenta, total: filtrado.length, contas: filtrado.slice(0, 120) };
  }

  if (ferramenta === "cliente" || ferramenta === "inteligencia") {
    const { linha, ambiguidade } = escolherCliente(linhas, pedido?.cliente);
    if (ambiguidade.length)
      return { ferramenta, erro: "Mais de uma conta corresponde a esse nome.", candidatas: ambiguidade };
    if (!linha) return { ferramenta, erro: "Nenhuma conta da carteira corresponde a esse nome." };
    if (ferramenta === "cliente")
      return { ferramenta, conta: contaCompleta(linha), responsaveis: await responsaveis(env, linha.id) };
    const campos = parse(linha.fields_json, {}) || {};
    if (!campos.intelligence)
      return {
        ferramenta,
        conta: linha.name,
        pesquisa: null,
        observacao: "Esta conta nunca foi pesquisada na web. Proponha a ação pesquisar_empresa se a pesquisa ajudar a responder.",
      };
    return { ferramenta, conta: linha.name, pesquisa: pesquisaPublica(campos.intelligence) };
  }

  if (ferramenta === "contatos") {
    const termo = semAcento(pedido?.termo);
    if (!termo) return { ferramenta, erro: "Informe o termo a procurar entre os contatos." };
    const achados = [];
    for (const linha of linhas) {
      const campos = parse(linha.fields_json, {}) || {};
      for (const contato of Array.isArray(campos.contacts) ? campos.contacts : []) {
        if (!contato?.name) continue;
        const alvo = semAcento(`${contato.name} ${contato.title || ""} ${contato.department || ""} ${contato.relationshipRole || ""}`);
        if (alvo.includes(termo)) achados.push({ conta: linha.name, ...contatoPublico(contato) });
      }
    }
    return { ferramenta, termo: clean(pedido?.termo, 80), total: achados.length, contatos: achados.slice(0, 60) };
  }

  if (ferramenta === "tarefas") {
    const rows = await env.DB.prepare(
      `SELECT title,status,priority,responsible_label,client_label,due_date
         FROM todogreen_work_items
        WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL AND status <> 'concluido'
        ORDER BY COALESCE(due_date,'9999-12-31') LIMIT 80`,
    ).bind(TENANT_ID, access.ownerId).all();
    return {
      ferramenta,
      tarefas: (rows.results || []).map((item) => ({
        titulo: item.title,
        situacao: item.status,
        prioridade: item.priority,
        responsavel: item.responsible_label || null,
        cliente: item.client_label || null,
        prazo: item.due_date || null,
      })),
    };
  }

  const clientePedido = clean(pedido?.cliente, 200);
  let clienteId = "";
  if (clientePedido) {
    const { linha, ambiguidade } = escolherCliente(linhas, clientePedido);
    if (ambiguidade.length) return { ferramenta, erro: "Mais de uma conta corresponde a esse nome.", candidatas: ambiguidade };
    if (!linha) return { ferramenta, erro: "Nenhuma conta da carteira corresponde a esse nome." };
    clienteId = linha.id;
  }

  if (ferramenta === "financeiro") {
    const scope = recorteDeCarteira(access, access.email, "f");
    const tipo = ["revenue", "cost", "commission"].includes(clean(pedido?.tipo, 20)) ? clean(pedido?.tipo, 20) : "";
    const clauses = ["f.tenant_id=?", "f.workspace_owner_id=?", "f.archived_at IS NULL"];
    const params = [TENANT_ID, access.ownerId];
    if (tipo) { clauses.push("f.kind=?"); params.push(tipo); }
    if (clienteId) { clauses.push("f.client_id=?"); params.push(clienteId); }
    const rows = await env.DB.prepare(
      `SELECT f.kind,f.client_id,f.category,f.description,f.amount,f.paid_amount,f.due_date,
              f.invoice_status,f.counterparty,f.document_number,f.cost_center,f.contract_id
         FROM todogreen_financial_entries f
        WHERE ${clauses.join(" AND ")} ${scope.sql}
        ORDER BY COALESCE(f.due_date,'9999-12-31'),f.updated_at DESC LIMIT 120`,
    ).bind(...params, ...scope.params).all();
    return { ferramenta, lancamentos: rows.results || [] };
  }

  if (ferramenta === "operacoes") {
    const scope = recorteDeCarteira(access, access.email, "o");
    const clienteClause = clienteId ? "AND o.client_id=?" : "";
    const rows = await env.DB.prepare(
      `SELECT o.id,o.client_id,o.reference,o.status,o.service_date,o.origin,o.destination,
              o.promised_at,o.delivered_at,o.eta_at,o.vehicle_plate,o.driver_name,o.distance_km,
              o.incident_count,o.sla_status,o.updated_at
         FROM todogreen_client_operations o
        WHERE o.tenant_id=? AND o.workspace_owner_id=? AND o.archived_at IS NULL
              ${clienteClause} ${scope.sql}
        ORDER BY o.updated_at DESC LIMIT 120`,
    ).bind(TENANT_ID, access.ownerId, ...(clienteId ? [clienteId] : []), ...scope.params).all();
    return { ferramenta, operacoes: rows.results || [] };
  }

  if (ferramenta === "contratos") {
    const scope = recorteDeCarteira(access, access.email, "c");
    const clienteClause = clienteId ? "AND c.client_id=?" : "";
    const rows = await env.DB.prepare(
      `SELECT c.id,c.client_id,c.client_name,c.title,c.start_date,c.end_date,c.monthly_value,
              c.total_value,c.status,c.signature_status,c.signed_at,c.renewal_type,
              c.renewal_notice_date,c.billing_day,c.notice_days,c.version
         FROM todogreen_contracts c
        WHERE c.tenant_id=? AND c.workspace_owner_id=? AND c.archived_at IS NULL
              ${clienteClause} ${scope.sql}
        ORDER BY COALESCE(c.renewal_notice_date,c.end_date,'9999-12-31') LIMIT 120`,
    ).bind(TENANT_ID, access.ownerId, ...(clienteId ? [clienteId] : []), ...scope.params).all();
    return { ferramenta, contratos: rows.results || [] };
  }

  if (ferramenta === "precificacao" || ferramenta === "esg") {
    const table = ferramenta === "precificacao" ? "pricing_scenarios" : "environmental_calculations";
    const alias = "p";
    const scope = recorteDeCarteira(access, access.email, alias);
    const clienteClause = clienteId ? `AND ${alias}.client_id=?` : "";
    const rows = await env.DB.prepare(
      `SELECT ${alias}.* FROM ${table} ${alias}
        WHERE ${alias}.tenant_id=? AND ${alias}.workspace_owner_id=? ${clienteClause} ${scope.sql}
        ORDER BY ${alias}.created_at DESC LIMIT 80`,
    ).bind(TENANT_ID, access.ownerId, ...(clienteId ? [clienteId] : []), ...scope.params).all();
    return {
      ferramenta,
      registros: (rows.results || []).map((row) => ({
        id: row.id, clienteId: row.client_id, produtoId: row.product_id,
        regraOuMetodologia: row.rule_version || row.methodology_version,
        entradas: parse(row.inputs_json, {}), resultado: parse(row.result_json, {}),
        aprovacoes: parse(row.approvals_json, {}), qualidadeDoDado: row.data_quality ?? null,
        situacao: row.status || null, criadoEm: row.created_at,
      })),
    };
  }

  return { ferramenta, erro: "Ferramenta desconhecida." };
}

// ===== Execução das ações, já confirmadas pela pessoa =====

const podeEscrever = (access) =>
  podeNaVertical(access, "work:manage") ||
  podeNaVertical(access, "work:item:write") ||
  ["owner", "admin"].includes(access.role);

export async function executarAcao(env, { access, user, email, acao, linhas }) {
  const tipo = clean(acao?.tipo, 40);
  if (!ACOES[tipo]) return { erro: "Ação desconhecida.", status: 400 };
  const agora = new Date().toISOString();

  if (tipo === "criar_tarefa") {
    if (!podeEscrever(access)) return { erro: "Seu papel não cria itens na Central de Implantação.", status: 403 };
    const titulo = clean(acao?.titulo, 240);
    if (titulo.length < 3) return { erro: "A tarefa precisa de um título.", status: 400 };
    const quadro = await env.DB.prepare(
      `SELECT id FROM todogreen_work_boards
        WHERE workspace_owner_id=? AND status='active' ORDER BY display_order LIMIT 1`,
    ).bind(access.ownerId).first();
    if (!quadro)
      return { erro: "Não há fluxo ativo na Central de Implantação para receber a tarefa.", status: 409 };

    // A tarefa vai para o dono da conta na carteira, não para quem pediu.
    // Antes ela era sempre atribuída a quem falou com a Semente — e o
    // vendedor da conta descobria a tarefa dele no nome de outra pessoa.
    const contaDaTarefa = escolherCliente(linhas, acao?.cliente).linha;
    const vendedores = contaDaTarefa ? await responsaveis(env, contaDaTarefa.id) : [];
    // O e-mail mora em `users`; `memberships` só guarda o vínculo. E o status
    // ativo é 'ativo' em português — foi assim que a coluna nasceu.
    const membros = await env.DB.prepare(
      `SELECT u.id AS userId, u.name, u.email
         FROM memberships m JOIN users u ON u.id = m.member_id
        WHERE m.owner_id=? AND m.status='ativo' LIMIT 200`,
    ).bind(access.ownerId).all().then((r) => r.results || []);
    const atribuicao = resolverResponsavel({
      informado: acao?.responsavel,
      vendedoresDaConta: vendedores,
      criador: { userId: user.id, email },
      pessoas: pessoasAtribuiveis({ membros, vendedores }),
    });

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO todogreen_work_items
       (id, tenant_id, workspace_owner_id, board_id, type, title, description, status,
        priority, responsible_user_id, responsible_label, client_label, due_date,
        fields_json, relations_json, dependencies_json, revision, created_by, updated_by,
        created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, 'tarefa', ?, ?, 'novo', ?, ?, ?, ?, ?, '{}', '[]', '[]', 1, ?, ?, ?, ?, NULL)`,
    ).bind(
      id, TENANT_ID, access.ownerId, quadro.id, titulo,
      clean(acao?.descricao, 4000), clean(acao?.prioridade, 40) || "media",
      atribuicao.userId || null, atribuicao.label || null, clean(acao?.cliente, 200) || null,
      /^\d{4}-\d{2}-\d{2}$/.test(clean(acao?.prazo, 20)) ? clean(acao?.prazo, 20) : null,
      user.id, user.id, agora, agora,
    ).run();
    return {
      ok: true,
      tipo,
      // Quem confirmou precisa saber para quem a tarefa foi, e por quê —
      // senão a atribuição volta a ser invisível.
      resumo: `Tarefa "${titulo}" criada${atribuicao.label ? ` para ${atribuicao.label}` : " sem responsável"}. ${atribuicao.motivo}`,
      id,
      atribuicao,
    };
  }

  if (tipo === "definir_proxima_acao") {
    const { linha, ambiguidade } = escolherCliente(linhas, acao?.cliente);
    if (ambiguidade.length) return { erro: `Mais de uma conta corresponde: ${ambiguidade.join(", ")}.`, status: 409 };
    if (!linha) return { erro: "Conta não encontrada na sua carteira.", status: 404 };
    const proxima = clean(acao?.acao, 500);
    if (proxima.length < 3) return { erro: "Descreva a próxima ação.", status: 400 };
    const campos = parse(linha.fields_json, {}) || {};
    const prazo = /^\d{4}-\d{2}-\d{2}$/.test(clean(acao?.prazo, 20)) ? clean(acao?.prazo, 20) : "";
    const atualizados = { ...campos, nextAction: proxima, nextActionAt: prazo || campos.nextActionAt || "" };
    const { meta } = await env.DB.prepare(
      `UPDATE todogreen_clients SET fields_json=?,revision=revision+1,updated_by=?,updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
    ).bind(JSON.stringify(atualizados), user.id, agora, linha.id, TENANT_ID, access.ownerId).run();
    if (!meta?.changes) return { erro: "Não foi possível gravar a próxima ação.", status: 409 };
    return {
      ok: true,
      tipo,
      resumo: `Próxima ação de ${linha.name}: ${proxima}${prazo ? ` (até ${prazo})` : ""}.`,
      id: linha.id,
    };
  }

  if (tipo === "aprender") {
    // Ensinar o assistente é ato de quem responde por discurso institucional.
    // Sem essa trava, qualquer pessoa que conversa com ele mudaria o que ele
    // afirma para todo mundo do espaço — inclusive dentro de uma proposta.
    if (!podeNaVertical(access, "business:teach"))
      return { erro: "Seu papel não edita o que a IA sabe sobre a To Do Green.", status: 403 };
    const { valida, motivo, fato } = propostaDeAprendizado({
      titulo: acao?.titulo,
      conteudo: acao?.conteudo,
      categoria: acao?.categoria,
      fonte: acao?.fonte,
      sigilo: acao?.sigilo,
    });
    if (!valida) return { erro: motivo, status: 400 };

    // Mesma chave = mesmo fato: reensinar CORRIGE em vez de empilhar duas
    // versões contraditórias que o modelo leria juntas na próxima pergunta.
    const existente = await env.DB.prepare(
      `SELECT id FROM todogreen_business_context
        WHERE tenant_id=? AND workspace_owner_id=? AND fact_key=? AND archived_at IS NULL LIMIT 1`,
    ).bind(TENANT_ID, access.ownerId, fato.chave).first();

    if (existente?.id) {
      await env.DB.prepare(
        `UPDATE todogreen_business_context
            SET category=?, title=?, content=?, source=?, effective_at=?, secrecy=?,
                origin='aprendido', revision=revision+1, updated_by=?, updated_at=?
          WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
      ).bind(
        fato.categoria, fato.titulo, fato.conteudo, fato.fonte, agora.slice(0, 10),
        fato.sigilo, user.id, agora, existente.id, TENANT_ID, access.ownerId,
      ).run();
      return { ok: true, tipo, resumo: `Aprendido (corrigindo o que eu sabia): ${fato.titulo}.`, id: existente.id };
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO todogreen_business_context
       (id, tenant_id, workspace_owner_id, fact_key, category, title, content, source,
        effective_at, secrecy, origin, pinned, revision, created_by, updated_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'aprendido', 0, 1, ?,?,?,?)`,
    ).bind(
      id, TENANT_ID, access.ownerId, fato.chave, fato.categoria, fato.titulo, fato.conteudo,
      fato.fonte, agora.slice(0, 10), fato.sigilo, user.id, user.id, agora, agora,
    ).run();
    return {
      ok: true,
      tipo,
      resumo: `Aprendido: ${fato.titulo}. A partir de agora eu sei disso — dá para revisar e corrigir em Sobre o negócio.`,
      id,
    };
  }

  // pesquisar_empresa
  const { linha, ambiguidade } = escolherCliente(linhas, acao?.cliente);
  if (ambiguidade.length) return { erro: `Mais de uma conta corresponde: ${ambiguidade.join(", ")}.`, status: 409 };
  if (!linha) return { erro: "Conta não encontrada na sua carteira.", status: 404 };
  if (!webSearchConfiguration(await envComChavesDeBuscaDoEspaco(env, access.ownerId)).configured)
    return {
      erro: "Pesquisa web indisponível. A integração precisa ser revisada por um administrador.",
      status: 503,
    };
  const pesquisa = await pesquisarEmpresa(env, {
    linha,
    ownerId: access.ownerId,
    userId: user.id,
    forcar: true,
  });
  if (pesquisa.erro) return { erro: pesquisa.erro, status: pesquisa.status || 502 };
  const enriquecimento = pesquisa.enrichment || {};
  const detalhes = [
    enriquecimento.segmentFilled ? "segmento preenchido pela pesquisa" : "",
    enriquecimento.contactsAdded ? `${enriquecimento.contactsAdded} contato(s) público(s) adicionados com fonte` : "",
  ].filter(Boolean);
  return {
    ok: true,
    tipo,
    resumo: `Pesquisa externa de ${linha.name} concluída${detalhes.length ? ` — ${detalhes.join("; ")}` : ""}.`,
    id: linha.id,
  };
}

// ===== O dossiê do negócio =====
//
// O que o Plantû sabe sobre a To Do Green deixou de ser texto fixo no código e
// virou linha de banco. Na PRIMEIRA leitura de um espaço que ainda não tem
// dossiê, a semente auditada é gravada — assim o assistente já nasce sabendo, e
// a partir dali quem manda é o que estiver na tela, não o que está aqui.
//
// A semeadura é oportunista de propósito: se o INSERT falhar (corrida entre
// duas perguntas simultâneas, tabela ainda não migrada), a pergunta continua
// com o dossiê em memória em vez de virar erro na cara de quem perguntou.
export async function dossieDoEspaco(env, access, user) {
  let linhas = [];
  try {
    linhas = await env.DB.prepare(
      `SELECT fact_key, category, title, content, source, effective_at, secrecy, origin, pinned
         FROM todogreen_business_context
        WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
        ORDER BY pinned DESC, updated_at DESC LIMIT 300`,
    ).bind(TENANT_ID, access.ownerId).all().then((r) => r.results || []);
  } catch (erro) {
    console.error("Plantû: dossiê do negócio indisponível", erro?.message || erro);
    return sementeDoNegocio();
  }

  if (!linhas.length) {
    const agora = new Date().toISOString();
    const semente = sementeDoNegocio();
    try {
      await env.DB.batch(semente.map((fato) => env.DB.prepare(
        `INSERT INTO todogreen_business_context
         (id, tenant_id, workspace_owner_id, fact_key, category, title, content, source,
          effective_at, secrecy, origin, pinned, revision, created_by, updated_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`,
      ).bind(
        crypto.randomUUID(), TENANT_ID, access.ownerId, fato.chave, fato.categoria,
        fato.titulo, fato.conteudo, fato.fonte, fato.vigenteEm, fato.sigilo,
        fato.origem, fato.fixado ? 1 : 0, user?.id || "sistema", user?.id || "sistema", agora, agora,
      )));
    } catch (erro) {
      console.error("Plantû: não foi possível semear o dossiê do negócio", erro?.message || erro);
    }
    return semente;
  }

  return linhas.map((row) => ({
    chave: row.fact_key,
    categoria: row.category,
    titulo: row.title,
    conteudo: row.content,
    fonte: row.source,
    vigenteEm: row.effective_at,
    sigilo: row.secrecy,
    origem: row.origin,
    fixado: Number(row.pinned || 0) === 1,
  }));
}

// ===== Memória conversacional (0091) =====
//
// A conversa do Plantû deixa de morrer no reload: cada turno vira duas linhas
// (pergunta + resposta) em todogreen_ai_messages, escopadas por espaço e por
// pessoa. Tudo aqui é MELHOR-ESFORÇO: gravar/ler o histórico nunca pode
// derrubar a resposta em si.
const CHAVE_ASSISTENTE = "plantu";
const LIMITE_HISTORICO = 40;

const carregarHistoricoDoPlantu = async (env, access, user) => {
  const { results } = await env.DB.prepare(
    `SELECT id, role, content, client_id, created_at, rating FROM todogreen_ai_messages
      WHERE tenant_id = ? AND workspace_owner_id = ? AND user_id = ? AND assistente = ?
        AND archived_at IS NULL
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?`,
  ).bind(TENANT_ID, access.ownerId, user.id, CHAVE_ASSISTENTE, LIMITE_HISTORICO)
    .all().catch(() => ({ results: [] }));
  // Volta em ordem cronológica (a query pega os mais recentes; invertemos).
  return (results || []).reverse().map((row) => ({
    id: row.role === "assistant" ? row.id : undefined,
    de: row.role === "user" ? "voce" : "semente",
    texto: row.content,
    clienteId: row.client_id || "",
    em: row.created_at,
    // Voto só faz sentido na resposta do assistente.
    avaliacao: row.role === "assistant" ? (row.rating ?? null) : undefined,
  }));
};

// Memória por cliente: quando a pessoa abre uma conta e pergunta, o Plantû
// lembra o que ELA já conversou com ele sobre ESSA conta em sessões passadas —
// não só o fio da conversa aberta agora. Mesmo escopo do histórico: tenant +
// espaço + a própria pessoa (privado de quem perguntou) + esta conta. Só
// leitura, melhor-esforço — nunca derruba a resposta.
const LIMITE_MEMORIA_CLIENTE = 16;

export const carregarMemoriaDoCliente = async (env, access, user, clienteId, podeVerRestrito = false) => {
  const id = clean(clienteId, 60);
  if (!id) return [];
  // Quem não tem finance:manage não recebe de volta turnos montados com dado
  // restrito no contexto — a lembrança não pode furar a guarda do dossiê.
  const veRestrito = podeVerRestrito ? 1 : 0;
  const { results } = await env.DB.prepare(
    `SELECT role, content, created_at FROM todogreen_ai_messages
      WHERE tenant_id = ? AND workspace_owner_id = ? AND user_id = ? AND assistente = ?
        AND client_id = ? AND archived_at IS NULL
        AND (restricted_context = 0 OR ? = 1)
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?`,
  ).bind(TENANT_ID, access.ownerId, user.id, CHAVE_ASSISTENTE, id, veRestrito, LIMITE_MEMORIA_CLIENTE)
    .all().catch(() => ({ results: [] }));
  // Cronológico (a query pega os mais recentes; invertemos).
  return (results || []).reverse().map((row) => ({
    de: row.role === "user" ? "Pessoa" : "Plantû",
    texto: row.content,
    em: row.created_at,
  }));
};

const gravarTurnoDoPlantu = async (env, access, user, { pergunta, resposta, clienteId, restritoNoContexto }) => {
  const agora = new Date().toISOString();
  const idResposta = crypto.randomUUID();
  // Marca o turno se os fatos restritos do dossiê estavam no contexto: assim a
  // memória por cliente pode escondê-lo de quem hoje não tem finance:manage.
  const restrito = restritoNoContexto ? 1 : 0;
  const linha = (id, role, content) => env.DB.prepare(
    `INSERT INTO todogreen_ai_messages
       (id, tenant_id, workspace_owner_id, user_id, assistente, role, content, client_id, created_at, archived_at, restricted_context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).bind(id, TENANT_ID, access.ownerId, user.id, CHAVE_ASSISTENTE, role, content, clienteId || null, agora, restrito);
  try {
    await env.DB.batch([
      linha(crypto.randomUUID(), "user", clean(pergunta, 2000)),
      linha(idResposta, "assistant", clean(resposta, 8000)),
    ]);
    // Devolve o id da resposta para a tela poder avaliá-la (👍/👎).
    return idResposta;
  } catch (erro) {
    // Persistir a conversa é secundário: nunca falhar a resposta por causa disso.
    console.error("Plantû: não consegui gravar o histórico da conversa", erro);
    return null;
  }
};

// Avaliação de uma resposta (👍/👎), escopada ao dono e à pessoa: ninguém
// avalia a mensagem de outro. nota: 1 (útil), -1 (não ajudou), 0/null limpa.
const avaliarRespostaDoPlantu = async (env, access, user, { mensagemId, nota }) => {
  const id = clean(mensagemId, 60);
  if (!id) return { erro: "Informe qual resposta avaliar.", status: 400 };
  const valor = nota === 1 || nota === -1 ? nota : null;
  const r = await env.DB.prepare(
    `UPDATE todogreen_ai_messages SET rating = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND user_id = ?
        AND assistente = ? AND role = 'assistant' AND archived_at IS NULL`,
  ).bind(valor, id, TENANT_ID, access.ownerId, user.id, CHAVE_ASSISTENTE)
    .run().catch(() => null);
  // 404 e não 403: a mensagem de outra pessoa "não existe" para esta.
  if (!r || (r.meta && r.meta.changes === 0)) return { erro: "Resposta não encontrada.", status: 404 };
  return { ok: true, avaliacao: valor };
};

// Correção assistida: a pessoa escreve qual era a resposta certa. Guarda a
// correção na própria resposta (e marca 👎, porque corrigir é dizer que não
// serviu). Escopo do dono e da pessoa — ninguém corrige a resposta de outra.
const corrigirRespostaDoPlantu = async (env, access, user, { mensagemId, texto }) => {
  const id = clean(mensagemId, 60);
  const correcao = clean(texto, 2000);
  if (!id) return { erro: "Informe qual resposta corrigir.", status: 400 };
  if (!correcao) return { erro: "Escreva qual era a resposta certa.", status: 400 };
  const r = await env.DB.prepare(
    `UPDATE todogreen_ai_messages SET correction = ?, rating = -1
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND user_id = ?
        AND assistente = ? AND role = 'assistant' AND archived_at IS NULL`,
  ).bind(correcao, id, TENANT_ID, access.ownerId, user.id, CHAVE_ASSISTENTE)
    .run().catch(() => null);
  if (!r || (r.meta && r.meta.changes === 0)) return { erro: "Resposta não encontrada.", status: 404 };
  return { ok: true, correcao };
};

// As últimas correções que a pessoa ensinou — para o Plantû não repetir o erro.
// Mesmo escopo do histórico + a guarda de restrito: uma correção sobre uma
// resposta com dado restrito no contexto só volta para quem tem finance:manage.
const LIMITE_CORRECOES = 12;

export const carregarCorrecoesDoPlantu = async (env, access, user, podeVerRestrito = false) => {
  const veRestrito = podeVerRestrito ? 1 : 0;
  // Traz também a PERGUNTA que gerou a resposta corrigida (a mensagem 'user'
  // imediatamente anterior, mesmo turno) — sem ela o modelo sabe o certo mas não
  // sabe QUANDO aplicar. A subconsulta pega o maior rowid de 'user' abaixo do da
  // resposta, dentro do mesmo escopo.
  const { results } = await env.DB.prepare(
    `SELECT a.content AS respondi, a.correction AS correcao,
        (SELECT u.content FROM todogreen_ai_messages u
          WHERE u.tenant_id = a.tenant_id AND u.workspace_owner_id = a.workspace_owner_id
            AND u.user_id = a.user_id AND u.assistente = a.assistente
            AND u.role = 'user' AND u.rowid < a.rowid
          ORDER BY u.rowid DESC LIMIT 1) AS pergunta
       FROM todogreen_ai_messages a
      WHERE a.tenant_id = ? AND a.workspace_owner_id = ? AND a.user_id = ? AND a.assistente = ?
        AND a.correction IS NOT NULL AND a.correction <> '' AND a.archived_at IS NULL
        AND (a.restricted_context = 0 OR ? = 1)
      ORDER BY a.created_at DESC, a.rowid DESC
      LIMIT ?`,
  ).bind(TENANT_ID, access.ownerId, user.id, CHAVE_ASSISTENTE, veRestrito, LIMITE_CORRECOES)
    .all().catch(() => ({ results: [] }));
  return (results || []).map((row) => ({ pergunta: row.pergunta || "", respondi: row.respondi, correcao: row.correcao }));
};

// ===== A porta =====

export async function handleTodoGreenSemente(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  if (request.method !== "POST") return response({ error: "Método não permitido." }, 405);
  if (!podeNaVertical(access, "read")) return response({ error: "Você não tem acesso à To Do Green." }, 403);

  const body = await request.json().catch(() => ({}));
  const email = String(user?.email || "").trim().toLowerCase();
  const linhas = await lerCarteira(env, access, email);

  // A pauta do dia: a Semente falando antes de ser perguntada. Não passa por
  // modelo nenhum — é leitura direta da carteira, então abre instantânea e
  // não gasta cota de IA para dizer o que os dados já dizem.
  if (body.briefing) {
    const vencidas = await env.DB.prepare(
      `SELECT title FROM todogreen_work_items
        WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL
          AND status <> 'concluido' AND due_date IS NOT NULL AND due_date < ?
          AND (lower(responsible_label)=lower(?) OR responsible_user_id=?)
        ORDER BY due_date LIMIT 40`,
    ).bind(TENANT_ID, access.ownerId, new Date().toISOString().slice(0, 10), email, user.id)
      .all().then((r) => (r.results || []).map((item) => ({ titulo: item.title })));
    return response(montarPauta({ indice: montarIndice(linhas), tarefasVencidas: vencidas }));
  }

  // Hidratação: ao abrir, a tela pede a conversa guardada para não começar do
  // zero. Só leitura, sem modelo.
  if (body.historicoPersistido) {
    return response({ mensagens: await carregarHistoricoDoPlantu(env, access, user) });
  }

  // Avaliação (👍/👎) de uma resposta: só grava o voto, sem modelo.
  if (body.avaliar) {
    const r = await avaliarRespostaDoPlantu(env, access, user, {
      mensagemId: body.avaliar.mensagemId,
      nota: Number(body.avaliar.nota),
    });
    if (r.erro) return response({ error: r.erro }, r.status || 400);
    return response({ avaliacao: r.avaliacao });
  }

  // Correção assistida: a pessoa ensina qual era a resposta certa. Só grava, sem
  // modelo — a correção volta como contexto nas próximas perguntas.
  if (body.corrigir) {
    const r = await corrigirRespostaDoPlantu(env, access, user, {
      mensagemId: body.corrigir.mensagemId,
      texto: body.corrigir.texto,
    });
    if (r.erro) return response({ error: r.erro }, r.status || 400);
    return response({ corrigida: true });
  }

  // Caminho da execução: a pessoa já leu a proposta e clicou. Nenhum modelo é
  // consultado aqui — o texto que gerou a proposta não decide mais nada.
  if (body.executar) {
    const resultado = await executarAcao(env, { access, user, email, acao: body.executar, linhas });
    if (resultado.erro) return response({ error: resultado.erro }, resultado.status || 400);
    return response(resultado);
  }

  const pergunta = clean(body.pergunta, 2000);
  if (pergunta.length < 3) return response({ error: "Explique um pouco mais sobre o que precisa." }, 400);

  const indice = montarIndice(linhas);
  const historico = (Array.isArray(body.historico) ? body.historico : [])
    .filter((item) => ["user", "assistant"].includes(item?.role) && typeof item.content === "string")
    .slice(-8)
    .map((item) => `${item.role === "user" ? "Pessoa" : "Plantû"}: ${clean(item.content, 1200)}`);

  // A conta aberta na tela entra no cabeçalho: "essa empresa" numa página de
  // cliente quer dizer aquela empresa, e obrigar a pessoa a repetir o nome é
  // fazer o produto esquecer o que está na frente dele.
  const emFoco = linhas.find((linha) => linha.id === clean(body.clienteId, 60)) || null;
  // Mesma guarda do dossiê: quem tem finance:manage vê o restrito. Vale para o
  // que entra no prompt AGORA e para a memória por cliente (que não pode
  // reexpor pela lembrança o que a guarda esconde).
  const podeVerRestrito = podeNaVertical(access, "finance:manage");
  // Memória por cliente: com uma conta aberta, retoma o que já se conversou
  // sobre ELA antes (privado desta pessoa). Só entra quando há conta em foco.
  // Tira o que já está em "CONVERSA ATÉ AQUI" (a sessão viva chega em
  // body.historico) para o mesmo diálogo não aparecer duas vezes no prompt.
  const chaveDeTurno = (texto) => clean(texto, 8000).slice(0, 200);
  const turnosVivos = new Set(
    (Array.isArray(body.historico) ? body.historico : [])
      .filter((item) => typeof item?.content === "string")
      .map((item) => chaveDeTurno(item.content)),
  );
  const memoriaConta = emFoco
    ? (await carregarMemoriaDoCliente(env, access, user, emFoco.id, podeVerRestrito))
      .filter((m) => !turnosVivos.has(chaveDeTurno(m.texto)))
    : [];
  // Correção assistida: o que a pessoa já corrigiu volta como aprendizado.
  const correcoes = await carregarCorrecoesDoPlantu(env, access, user, podeVerRestrito);
  const envIa = await envComChavesDoEspaco(env, access.ownerId);
  const envBusca = await envComChavesDeBuscaDoEspaco(envIa, access.ownerId);
  if (!configuredAiProviders(envIa).some((provider) => provider.configured))
    return response({ error: "Plantû está sem provedor de IA. Um administrador precisa conectar GPT, Claude, Gemini ou outro provedor em Integrações." }, 503);
  // O dossiê entra no cabeçalho, não no `system`: o system é o mesmo para todo
  // espaço e fica em cache; o dossiê é de UM espaço e muda quando ela edita.
  const dossie = blocoDeContexto(await dossieDoEspaco(env, access, user), {
    // Quem tem `finance:manage` (ou é dona/admin) vê o que está marcado como
    // restrito — conta bancária, documento de pessoa. Os outros nem sabem que
    // existe: o fato não entra no prompt, então não há o que vazar na resposta.
    incluirRestrito: podeVerRestrito,
  });
  const cabecalho = [
    `Pessoa atendida: ${clean(user?.name, 120) || email || "usuária da To Do Green"}.`,
    `Tela em que a pessoa está: ${clean(body.tela, 60) || "não informada"}.`,
    emFoco ? `Conta aberta na tela agora: ${emFoco.name} (id ${emFoco.id}).` : "",
    `Carteira de ${email || "quem perguntou"}: ${indice.length} conta(s).`,
    `Pesquisa web neste ambiente: ${webSearchConfiguration(envBusca).configured ? "configurada" : "NÃO configurada — não proponha pesquisar_empresa"}.`,
    "",
    catalogoTextual(),
    "",
    dossie,
    "",
    `ÍNDICE DA CARTEIRA (resumo; use as ferramentas para o detalhe):\n${JSON.stringify(indice.slice(0, 200), null, 1)}`,
    correcoes.length
      ? `\nCORREÇÕES QUE VOCÊ JÁ RECEBEU DESTA PESSOA (o certo é a correção; quando a pergunta for parecida, siga a correção e não repita o erro):\n${correcoes.map((c) => `• ${c.pergunta ? `Perguntaram: "${clean(c.pergunta, 200)}" · ` : ""}Você respondeu: "${clean(c.respondi, 300)}" → O certo: "${clean(c.correcao, 600)}"`).join("\n")}`
      : "",
    memoriaConta.length
      ? `\nMEMÓRIA DESTA CONTA (o que você já conversou com esta pessoa sobre ${emFoco.name} em outras ocasiões; use como contexto e confirme o que pode ter mudado):\n${memoriaConta.map((m) => `${m.de}: ${clean(m.texto, 800)}`).join("\n")}`
      : "",
    historico.length ? `\nCONVERSA ATÉ AQUI:\n${historico.join("\n")}` : "",
    `\nPERGUNTA: ${pergunta}`,
  ].join("\n");

  const primeira = await runWithFallback(envIa, { prompt: cabecalho, system: INSTRUCAO, deep: true });
  if (!primeira.ok) {
    // O motivo de CADA provedor ter falhado ia para o lixo aqui — cota
    // estourada, chave inválida, tempo esgotado, tudo virava a mesma frase
    // genérica na tela e nada no log. "A Semente não está funcionando" ficava
    // impossível de diagnosticar sem reproduzir. O assistente do portal já
    // registra isso (todogreen-customer-portal.js); a Semente não registrava.
    console.error("Plantû: todos os provedores de IA falharam", primeira.errors);
    return response({ error: "Plantû não respondeu agora. Tente novamente em instantes." }, 502);
  }

  let decisao = lerDecisao(primeira.result?.content);
  let consultou = null;

  // Uma volta de ferramenta, não um laço aberto. Duas chamadas ao modelo por
  // pergunta é o teto: laço sem teto vira conta de provedor sem teto.
  if (decisao.consultar) {
    const dados = await executarFerramenta(env, { access, pedido: decisao.consultar, linhas });
    consultou = { ferramenta: dados.ferramenta, pedido: decisao.consultar };
    const segunda = await runWithFallback(envIa, {
      prompt: [
        cabecalho,
        `\nVocê pediu a ferramenta "${dados.ferramenta}". Resultado real, vindo do banco:`,
        JSON.stringify(dados, null, 1),
        "\nAgora responda. Não peça outra ferramenta: responda com o que tem e diga o que falta, se faltar.",
      ].join("\n"),
      system: INSTRUCAO,
      deep: true,
    });
    if (segunda.ok) {
      const nova = lerDecisao(segunda.result?.content);
      decisao = { ...nova, consultar: null };
    } else {
      // Cair para a primeira resposta é de propósito: é melhor responder com o
      // que já se tem do que devolver erro depois de a ferramenta ter rodado.
      // Mas cair em silêncio esconde uma resposta pior — a pessoa recebe algo
      // que ignora o dado que o banco acabou de entregar, e nada indica isso.
      console.error("Plantû: segunda chamada falhou, respondendo sem o resultado da ferramenta", segunda.errors);
    }
  }

  decisao = await garantirRespostaEmPortugues(envIa, decisao);

  const resposta = decisao.resposta || "Não consegui formular uma resposta com os dados desta carteira.";
  // Guarda o turno para a conversa sobreviver ao reload (melhor-esforço) e
  // devolve o id da resposta para a tela poder avaliá-la.
  // Etiqueta o turno com a conta VALIDADA (emFoco, que casou com a carteira da
  // pessoa) — não com o clienteId cru do corpo. Assim a memória por cliente não
  // fica marcada com uma conta que não é da carteira.
  const mensagemId = await gravarTurnoDoPlantu(env, access, user, {
    pergunta, resposta, clienteId: emFoco?.id || null, restritoNoContexto: podeVerRestrito,
  });

  return response({
    resposta,
    mensagemId,
    consultou,
    proposta: decisao.acao || null,
    carteira: indice.length,
  });
}
