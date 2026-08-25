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
import { runWithFallback } from "./ai.js";
import { webSearchConfiguration } from "./web-search.js";
import { pesquisarEmpresa } from "./todogreen-client-intelligence.js";
import { pessoasAtribuiveis, resolverResponsavel } from "../../src/features/logistics/taskAssignmentDomain.js";
import { montarPauta } from "../../src/features/logistics/sementeBriefingDomain.js";

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

export function lerDecisao(texto) {
  const bruto = String(texto || "").trim();
  if (!bruto) return { resposta: "", consultar: null, acao: null };
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

  // pesquisar_empresa
  const { linha, ambiguidade } = escolherCliente(linhas, acao?.cliente);
  if (ambiguidade.length) return { erro: `Mais de uma conta corresponde: ${ambiguidade.join(", ")}.`, status: 409 };
  if (!linha) return { erro: "Conta não encontrada na sua carteira.", status: 404 };
  if (!webSearchConfiguration(env).configured)
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
  const cabecalho = [
    `Pessoa atendida: ${clean(user?.name, 120) || email || "usuária da To Do Green"}.`,
    `Tela em que a pessoa está: ${clean(body.tela, 60) || "não informada"}.`,
    emFoco ? `Conta aberta na tela agora: ${emFoco.name} (id ${emFoco.id}).` : "",
    `Carteira de ${email || "quem perguntou"}: ${indice.length} conta(s).`,
    `Pesquisa web neste ambiente: ${webSearchConfiguration(env).configured ? "configurada" : "NÃO configurada — não proponha pesquisar_empresa"}.`,
    "",
    catalogoTextual(),
    "",
    `ÍNDICE DA CARTEIRA (resumo; use as ferramentas para o detalhe):\n${JSON.stringify(indice.slice(0, 200), null, 1)}`,
    historico.length ? `\nCONVERSA ATÉ AQUI:\n${historico.join("\n")}` : "",
    `\nPERGUNTA: ${pergunta}`,
  ].join("\n");

  const primeira = await runWithFallback(env, { prompt: cabecalho, system: INSTRUCAO, deep: true });
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
    const segunda = await runWithFallback(env, {
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

  decisao = await garantirRespostaEmPortugues(env, decisao);

  return response({
    resposta: decisao.resposta || "Não consegui formular uma resposta com os dados desta carteira.",
    consultou,
    proposta: decisao.acao || null,
    carteira: indice.length,
  });
}
