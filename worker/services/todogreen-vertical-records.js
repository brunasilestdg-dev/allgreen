// ===== Registros da vertical =====
//
// Simulações, propostas, oportunidades, operações, receitas, custos e comissões
// moravam no estado genérico do espaço de trabalho — um JSON por usuário,
// gravado inteiro a cada alteração. O preço disso aparecia em quatro lugares:
//
//   • duas pessoas no mesmo espaço sobrescreviam o trabalho uma da outra;
//   • o portal do cliente não enxergava nada escrito por dentro;
//   • auditoria e versionamento valiam para metade da vertical;
//   • o painel somava fontes diferentes, com identificadores que não casavam.
//
// Aqui é a outra metade indo para o mesmo lugar onde clientes, carteiras,
// solicitações, ESG e Tracker já estavam.
//
// Duas decisões que valem explicação:
//
// 1) O escopo é da LINHA, não da consulta. Todo SELECT e todo UPDATE carregam
//    `workspace_owner_id = ?` vindo do vínculo da sessão, nunca do corpo do
//    pedido. Um handler que esquecesse o filtro devolveria a tabela inteira, e
//    é exatamente esse esquecimento que o formato abaixo torna difícil.
//
// 2) Escrita concorrente é resolvida por `revision`, não por "quem chegou
//    depois vence". O UPDATE exige a revisão que o cliente leu; se ela mudou,
//    a resposta é 409 e a tela recarrega — em vez de apagar em silêncio o que
//    a outra pessoa acabou de escrever, que é o defeito do JSON único.

import { TENANT_ID, paginacao, podeNaVertical, recorteDeCarteira } from "./todogreen-access.js";
import { notificarPortalDoCliente } from "./todogreen-notify.js";
// A validação e a normalização dos cadastros vêm do domínio, não daqui: é a
// mesma regra que a tela aplica, e uma segunda cópia no worker seria a
// divergência entre o botão liberado e a resposta recusada.
import {
  normalizeDocument,
  normalizePartyRoles,
  normalizeSku,
  normalizeUnit,
  validateAccount,
  validateCostCenter,
  validateItem,
  validateParty,
  validateWarehouse,
} from "../../src/features/logistics/erpCoreDomain.js";
import {
  bloqueioPorFechamento,
  validateBankAccount,
} from "../../src/features/logistics/treasuryDomain.js";
import { doBanco as pedidoDoBanco } from "./todogreen-deal-desk.js";
import { liberacaoDaProposta } from "../../src/features/logistics/dealDeskDomain.js";
import {
  normalizarGravidade,
  normalizarSituacaoQualidade,
  normalizarTipo,
  validarNaoConformidade,
} from "../../src/features/logistics/qualityDomain.js";
import {
  normalizarRisco,
  normalizarSituacaoJuridica,
  normalizarTipoJuridico,
  resolverAcaoJuridica,
  validarDocumentoJuridico,
} from "../../src/features/logistics/legalDomain.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import { normalizarFato } from "../../src/features/logistics/businessContextDomain.js";
import {
  criaCiclo,
  nomeDisponivel,
  normalizarPasta,
  pastasVisiveis,
  podeVerPasta as podeVerPastaNaLinhagem,
} from "../../src/features/logistics/pastasDomain.js";
import {
  categoriaValida as categoriaDeHabilitacaoValida,
  doCatalogo as doCatalogoDeHabilitacao,
  etapaDoRfqValida,
} from "../../src/features/logistics/habilitacaoDomain.js";
// POD do motorista (#120b): a foto/assinatura chega como data URL reduzido e é
// guardada no cofre; a URL de download entra no comprovante da entrega.
import { armazenarImagemBase64, descartarArquivos } from "./todogreen-file-store.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const texto = (valor, max = 500) => String(valor ?? "").trim().slice(0, max);
const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const parse = (valor, alternativa) => {
  try {
    return JSON.parse(valor || "");
  } catch {
    return alternativa;
  }
};
const objeto = (valor) => (valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {});
const etapaGanha = (valor) => texto(valor, 80).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === "fechada ganha";
export const deveCriarHandoff = (anterior, proxima) => !etapaGanha(anterior) && etapaGanha(proxima);

const criarHandoffOperacional = async (env, access, user, oportunidade) => {
  const agora = new Date().toISOString();
  const boardId = `todogreen-handoff-${access.ownerId}`;
  const itemId = `todogreen-handoff-opportunity-${oportunidade.id}`;
  const prazo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_work_boards
       (id,tenant_id,workspace_owner_id,name,description,specialist,object_types_json,
        permissions_json,status,display_order,created_by,created_at,updated_at)
     VALUES (?,? ,?, 'Implantação de contratos',
       'Transição automática do comercial para operação após oportunidade ganha.',
       'operations','["oportunidade","cliente","contrato"]','{}','active',30,?,?,?)`,
  ).bind(boardId, TENANT_ID, access.ownerId, user.id, agora, agora).run();
  const relations = [
    { type: "opportunity", id: oportunidade.id },
    ...(oportunidade.clientId ? [{ type: "client", id: oportunidade.clientId }] : []),
  ];
  const { meta } = await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_work_items
       (id,tenant_id,workspace_owner_id,board_id,type,title,description,status,priority,
        responsible_user_id,responsible_label,client_label,due_date,fields_json,relations_json,
        dependencies_json,revision,created_by,updated_by,created_at,updated_at,archived_at)
     VALUES (?,?,?,?, 'handoff', ?, ?, 'novo','alta',NULL,'Operações',?,?,?,?,'[]',1,?,?,?,?,NULL)`,
  ).bind(
    itemId, TENANT_ID, access.ownerId, boardId,
    `Implantar operação de ${oportunidade.cliente || "cliente"}`,
    "Validar contrato, kick-off, responsáveis, integrações, frota, indicadores e data de início.",
    oportunidade.cliente || "", prazo,
    JSON.stringify({ source: "opportunity_won", opportunityId: oportunidade.id, clientId: oportunidade.clientId || "" }),
    JSON.stringify(relations), user.id, user.id, agora, agora,
  ).run();
  if (meta?.changes) await env.DB.prepare(
    `INSERT INTO todogreen_work_item_events
       (id,workspace_owner_id,board_id,item_id,actor_user_id,action,before_json,after_json,created_at)
     VALUES (?,?,?,?,?,'created_from_won_opportunity','{}',?,?)`,
  ).bind(crypto.randomUUID(), access.ownerId, boardId, itemId, user.id, JSON.stringify({ opportunityId: oportunidade.id }), agora).run();
};

// Oportunidade aberta é conversa viva: uma conta Fria (ou ainda sem
// classificação) que ganha oportunidade vinculada vira "Morno" sozinha —
// pedido da titular (30/08). A régua só esquenta: nunca rebaixa "Morno" ou
// "Quente" que a equipe classificou à mão. A escrita respeita a trava de
// revision do cliente; se alguém salvou a conta no meio, o aquecimento cede
// a vez em silêncio — é conveniência, não pode brigar com edição humana.
const aquecerContaPorOportunidade = async (env, access, user, clientId) => {
  const conta = await env.DB.prepare(
    `SELECT id, fields_json, revision FROM todogreen_clients
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(texto(clientId, 120), TENANT_ID, access.ownerId).first();
  if (!conta) return false;
  let campos = {};
  try { campos = JSON.parse(conta.fields_json || "{}") || {}; } catch { campos = {}; }
  const atual = typeof campos.temperature === "string" ? campos.temperature : "";
  if (atual && atual !== "Frio") return false;
  const { meta } = await env.DB.prepare(
    `UPDATE todogreen_clients
        SET fields_json=?, revision=revision+1, updated_by=?, updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`,
  ).bind(
    JSON.stringify({ ...campos, temperature: "Morno" }), user.id, new Date().toISOString(),
    conta.id, TENANT_ID, access.ownerId, conta.revision,
  ).run();
  if (!meta?.changes) return false;
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "updated", resourceType: "clients", resourceId: conta.id,
    clientId: conta.id,
    before: { temperature: atual },
    after: { temperature: "Morno", motivo: "oportunidade vinculada à conta" },
  });
  return true;
};

// Registrar interação é dizer "falei com o cliente em tal dia" — e é essa data
// que a saúde da conta e os Avanços da semana leem para saber o que esfriou.
// Por isso a interação carimba a última interação na oportunidade (coluna
// própria) e na conta (campo do CRM), em vez de exigir que alguém edite a data
// à mão depois de cada reunião. Só avança no tempo: uma ata antiga registrada
// hoje não faz a conta parecer mais quente do que está.
const carimbarUltimaInteracao = async (env, access, user, interacao) => {
  const quando = texto(interacao.ocorridaEm, 40);
  if (!quando) return;
  const maisRecente = (anterior) => !anterior || String(anterior) < quando;
  const agora = new Date().toISOString();

  const opportunityId = texto(interacao.opportunityId, 120);
  if (opportunityId) {
    const oportunidade = await env.DB.prepare(
      `SELECT id, last_interaction_at, revision FROM todogreen_opportunities
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
    ).bind(opportunityId, TENANT_ID, access.ownerId).first();
    if (oportunidade && maisRecente(oportunidade.last_interaction_at)) {
      await env.DB.prepare(
        `UPDATE todogreen_opportunities
            SET last_interaction_at=?, revision=revision+1, updated_by=?, updated_at=?
          WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`,
      ).bind(quando, user.id, agora, oportunidade.id, TENANT_ID, access.ownerId, oportunidade.revision).run();
    }
  }

  const clientId = texto(interacao.clientId, 120);
  if (!clientId) return;
  const conta = await env.DB.prepare(
    `SELECT id, fields_json, revision FROM todogreen_clients
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(clientId, TENANT_ID, access.ownerId).first();
  if (!conta) return;
  let campos = {};
  try { campos = JSON.parse(conta.fields_json || "{}") || {}; } catch { campos = {}; }
  if (!maisRecente(campos.lastInteractionAt)) return;
  await env.DB.prepare(
    `UPDATE todogreen_clients
        SET fields_json=?, revision=revision+1, updated_by=?, updated_at=?
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?`,
  ).bind(
    JSON.stringify({ ...campos, lastInteractionAt: quando }), user.id, agora,
    conta.id, TENANT_ID, access.ownerId, conta.revision,
  ).run();
};

// Cada coleção declara como uma linha vira registro e como um registro vira
// linha. Sem essa tabela, cada endpoint reescreveria o mesmo mapeamento com
// uma diferença sutil — e a diferença sutil é o que faz o painel somar errado.
// Campos da oportunidade que têm coluna própria. O que sobra é guardado como
// payload em vez de descartado — é ali que estão ocupação prevista, frota de
// baixa emissão, veículos disponíveis, meses de contrato e probabilidade, que
// a análise de oportunidade usa e esta tabela não precisa indexar.
const COLUNAS_DA_OPORTUNIDADE = new Set([
  "id", "clientId", "cliente", "clientName", "estagio", "stage",
  "valorMensal", "valorContrato", "distanciaKm", "viagensMes", "tipoVeiculo",
  "responsavelId", "ultimaInteracaoEm", "lastInteractionAt", "campos",
  "revision", "criadoEm", "atualizadoEm",
]);

const extrasDaOportunidade = (corpo) =>
  Object.fromEntries(
    Object.entries(corpo).filter(
      ([chave, valor]) => !COLUNAS_DA_OPORTUNIDADE.has(chave) && valor !== undefined,
    ),
  );

// Tipos de interação aceitos. Um tipo desconhecido vira "reuniao" em vez de
// entrar cru: a coluna é filtrada e somada, e lixo nela quebra o corte.
const TIPOS_DE_INTERACAO = new Set([
  "reuniao", "ligacao", "email", "visita", "whatsapp", "tentativa", "proposta", "outro",
]);

const COLECOES = {
  opportunities: {
    tabela: "todogreen_opportunities",
    permissao: "crm:manage",
    permissoesLeitura: ["crm:manage", "clients:manage", "audit:read"],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      // O que não tem coluna própria volta primeiro, e as colunas mandam por
      // cima. A tela de oportunidades manda mais campos do que esta tabela
      // indexa — ocupação prevista, frota limpa, veículos disponíveis, meses
      // de contrato, probabilidade — e todos alimentam a análise. Descartá-los
      // no caminho faria a oportunidade voltar do servidor mais pobre do que
      // saiu, com a análise mudando sozinha depois de recarregar a página.
      ...parse(row.fields_json, {}),
      id: row.id,
      clientId: row.client_id,
      // O negócio tem nome próprio desde a 0081. Sem ele, uma conta com três
      // frentes abertas devolvia três registros indistinguíveis.
      titulo: row.title || "",
      cliente: row.client_name,
      estagio: row.stage,
      valorMensal: row.monthly_value,
      valorContrato: row.contract_value,
      distanciaKm: row.distance_km,
      viagensMes: row.trips_per_month,
      tipoVeiculo: row.vehicle_type,
      responsavelId: row.owner_user_id || "",
      ultimaInteracaoEm: row.last_interaction_at || "",
      // O motor de oportunidade lê `lastInteractionAt`. Devolver os dois nomes
      // evita um adaptador a mais entre a API e o domínio.
      lastInteractionAt: row.last_interaction_at || "",
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      title: texto(corpo.titulo || corpo.title, 200),
      client_name: texto(corpo.cliente || corpo.clientName, 200),
      stage: texto(corpo.estagio || corpo.stage, 60) || "Prospecção",
      monthly_value: numero(corpo.valorMensal),
      contract_value: numero(corpo.valorContrato),
      distance_km: numero(corpo.distanciaKm),
      trips_per_month: numero(corpo.viagensMes),
      vehicle_type: texto(corpo.tipoVeiculo, 120),
      owner_user_id: texto(corpo.responsavelId, 120) || null,
      last_interaction_at: texto(corpo.ultimaInteracaoEm || corpo.lastInteractionAt, 40) || null,
      fields_json: JSON.stringify({ ...objeto(corpo.campos), ...extrasDaOportunidade(corpo) }),
    }),
    exigido: (corpo) => (texto(corpo.cliente || corpo.clientName) ? "" : "Informe o cliente da oportunidade."),
  },

  // Comentários do comercial (0078). A regra de alcance da titular mora nos
  // dois campos: clientId sem opportunityId = comentário da conta, visível em
  // todas as oportunidades dela; opportunityId preenchido = fica só naquela
  // oportunidade. Quem escreve oportunidade escreve comentário — as mesmas
  // permissões.
  comments: {
    tabela: "todogreen_crm_comments",
    permissao: "crm:manage",
    permissoesLeitura: ["crm:manage", "clients:manage", "audit:read"],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id || "",
      opportunityId: row.opportunity_id || "",
      comentario: row.body,
      autorEmail: row.author_email || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      opportunity_id: texto(corpo.opportunityId, 120),
      body: texto(corpo.comentario || corpo.body, 4000),
      author_email: texto(corpo.autorEmail, 200),
    }),
    exigido: (corpo) => {
      if (!texto(corpo.comentario || corpo.body)) return "Escreva o comentário.";
      if (!texto(corpo.clientId) && !texto(corpo.opportunityId))
        return "Vincule o comentário a uma conta ou a uma oportunidade.";
      return "";
    },
  },

  // Interações do comercial (0079): reunião com ata, ligação, e-mail, visita,
  // WhatsApp, proposta enviada e TENTATIVA de contato — a tentativa que não deu
  // certo também é registro, é ela que mostra o cliente que não retorna.
  // Mesma regra de alcance dos comentários: conta espelha nas oportunidades
  // dela, oportunidade fica só nela.
  interactions: {
    tabela: "todogreen_crm_interactions",
    permissao: "crm:manage",
    permissoesLeitura: ["crm:manage", "clients:manage", "audit:read"],
    ordem: "occurred_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id || "",
      opportunityId: row.opportunity_id || "",
      tipo: row.kind || "reuniao",
      assunto: row.subject || "",
      ata: row.notes || "",
      participantes: row.participants || "",
      resultado: row.outcome || "",
      proximoPasso: row.next_step || "",
      ocorridaEm: row.occurred_at || "",
      proximoPassoEm: row.next_step_at || "",
      autorEmail: row.author_email || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      opportunity_id: texto(corpo.opportunityId, 120),
      kind: TIPOS_DE_INTERACAO.has(texto(corpo.tipo)) ? texto(corpo.tipo) : "reuniao",
      subject: texto(corpo.assunto, 200),
      notes: texto(corpo.ata, 8000),
      participants: texto(corpo.participantes, 500),
      outcome: texto(corpo.resultado, 300),
      next_step: texto(corpo.proximoPasso, 500),
      occurred_at: texto(corpo.ocorridaEm, 40),
      next_step_at: texto(corpo.proximoPassoEm, 40),
      author_email: texto(corpo.autorEmail, 200),
    }),
    exigido: (corpo) => {
      if (!texto(corpo.clientId) && !texto(corpo.opportunityId))
        return "Vincule a interação a uma conta ou a uma oportunidade.";
      if (!texto(corpo.assunto) && !texto(corpo.ata))
        return "Escreva o assunto ou a ata da interação.";
      if (!texto(corpo.ocorridaEm)) return "Informe quando a interação aconteceu.";
      return "";
    },
  },

  // ===== Pastas do cofre de documentos =====
  //
  // Privadas, da área e do espaço. Escrever é aberto a quem já escreve no cofre
  // (`evidence:manage`) — criar pasta é organizar o próprio trabalho, não um
  // ato de governança. O que protege não é a permissão de escrita e sim a
  // LEITURA: `filtrarLeitura` aplica a linhagem inteira, então uma subpasta
  // "do espaço" dentro de uma privada continua invisível.
  documentFolders: {
    tabela: "todogreen_document_folders",
    permissao: "evidence:manage",
    permissoesLeitura: [
      "evidence:manage", "crm:manage", "clients:manage", "proposal:manage",
      "operations:manage", "finance:manage", "compliance:manage", "audit:read",
    ],
    escopoDeCarteira: false,
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      paiId: row.parent_id || "",
      nome: row.name || "",
      descricao: row.descricao || "",
      visibilidade: row.visibility || "private",
      membros: parse(row.members_json, []) || [],
      permissaoDaArea: row.area_permission || "",
      donoEmail: row.owner_email || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo, { email, novo } = {}) => {
      const pasta = normalizarPasta(corpo);
      const daSessao = texto(email, 200).toLowerCase();
      return {
        parent_id: pasta.paiId,
        name: pasta.nome,
        descricao: pasta.descricao,
        visibility: pasta.visibilidade,
        members_json: JSON.stringify(pasta.membros),
        area_permission: pasta.permissaoDaArea,
        // Na CRIAÇÃO o dono sai da sessão e o corpo é ignorado: senão qualquer
        // pessoa cria pasta privada no nome de outra e se põe como membro.
        // Na EDIÇÃO o dono ANTERIOR permanece — carimbar a sessão aqui faria a
        // dona do espaço virar dona de toda pasta privada que ela abrisse para
        // arrumar, tirando o acesso de quem criou. Mesmo cuidado que o autor de
        // comentário já tem.
        owner_email: novo ? daSessao : (pasta.donoEmail || daSessao),
      };
    },
    exigido: (corpo) => {
      const pasta = normalizarPasta(corpo);
      if (!pasta.nome) return "Dê um nome à pasta.";
      if (pasta.visibilidade === "area" && !pasta.permissaoDaArea)
        return "Escolha de qual área é a pasta — sem isso ninguém além de você a veria.";
      return "";
    },
    guardaDeEscrita: async (env, { access, email, corpo, id }) => {
      const { results } = await env.DB.prepare(
        `SELECT id, parent_id, name, visibility, members_json, area_permission, owner_email
           FROM todogreen_document_folders
          WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL LIMIT 500`,
      ).bind(TENANT_ID, access.ownerId).all();
      const pastas = (results || []).map((row) => ({
        id: row.id,
        paiId: row.parent_id || "",
        nome: row.name || "",
        visibilidade: row.visibility || "private",
        membros: parse(row.members_json, []) || [],
        permissaoDaArea: row.area_permission || "",
        donoEmail: row.owner_email || "",
      }));
      const quem = {
        email,
        papel: access?.role,
        permissoes: Array.isArray(access?.permissions) ? access.permissions : [],
      };

      // Editar pasta que a pessoa não vê é editar às cegas — e no caso de uma
      // privada de terceiro, é invadir. O 409 vale aqui porque a lista já
      // devolveu 404 para o que ela não vê: chegar a PATCH nesse id significa
      // que ela sabe o id de outra forma.
      if (id && !podeVerPastaNaLinhagem(pastas, id, quem))
        return "Esta pasta não é sua.";

      const paiId = texto(corpo.paiId || corpo.parentId, 120);
      // O pai também tem que ser visível: mover uma pasta para dentro de algo
      // que a pessoa não vê esconderia o conteúdo dela de si mesma.
      if (paiId && !podeVerPastaNaLinhagem(pastas, paiId, quem))
        return "A pasta de destino não existe aqui.";
      if (id && paiId && criaCiclo(pastas, id, paiId))
        return "Uma pasta não pode ficar dentro de si mesma nem de uma subpasta dela.";
      if (!nomeDisponivel(pastas, { id, paiId, nome: texto(corpo.nome || corpo.name, 160) }))
        return "Já existe uma pasta com esse nome no mesmo lugar.";
      return "";
    },
    filtrarLeitura: (registros, { access, email }) => pastasVisiveis(registros, {
      email,
      papel: access?.role,
      permissoes: Array.isArray(access?.permissions) ? access.permissions : [],
    }),
  },

  // ===== Central de RFQ e RFI =====
  //
  // Três coleções: o acervo de habilitação, os kits e o ciclo do pedido.
  //
  // Nenhuma delas grava STATUS. O semáforo do documento e a prontidão do kit
  // são derivados na leitura (`habilitacaoDomain.js`), sempre contra a data de
  // hoje — status gravado é status que envelhece calado, e o preço disso é
  // mandar ao comprador uma apólice vencida confiando na etiqueta.
  //
  // O acervo é da EMPRESA, não da carteira de ninguém: `escopoDeCarteira: false`.
  habilitacao: {
    tabela: "todogreen_habilitacao_documentos",
    permissao: "compliance:manage",
    permissoesLeitura: [
      "compliance:manage", "crm:manage", "clients:manage", "proposal:manage",
      "operations:manage", "finance:manage", "audit:read",
    ],
    escopoDeCarteira: false,
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      tipo: row.doc_type || "",
      categoria: row.category || "societario",
      titulo: row.title || "",
      numero: row.numero || "",
      orgao: row.orgao || "",
      unidade: row.unidade || "EMPRESA",
      cnpj: row.cnpj || "",
      emitidoEm: row.issued_at || "",
      venceEm: row.expires_at || "",
      permanente: Number(row.permanente || 0) === 1,
      diasAceitaveis: Number(row.dias_aceitaveis || 0),
      arquivoId: row.arquivo_id || "",
      arquivoUrl: row.arquivo_url || "",
      arquivoNome: row.arquivo_nome || "",
      observacao: row.observacao || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => {
      const tipo = texto(corpo.tipo, 80).toUpperCase();
      const definicao = doCatalogoDeHabilitacao(tipo);
      const permanente = corpo.permanente === undefined
        ? Boolean(definicao?.permanente)
        : Boolean(corpo.permanente);
      return {
        doc_type: tipo,
        category: categoriaDeHabilitacaoValida(corpo.categoria || definicao?.categoria),
        title: texto(corpo.titulo, 200) || definicao?.titulo || tipo,
        numero: texto(corpo.numero, 120),
        orgao: texto(corpo.orgao, 160) || texto(definicao?.orgao, 160),
        unidade: texto(corpo.unidade, 60).toUpperCase() || "EMPRESA",
        cnpj: texto(corpo.cnpj, 30),
        issued_at: texto(corpo.emitidoEm, 10),
        // Documento permanente não guarda vencimento: guardar os dois deixaria
        // a tela ter que escolher qual acreditar.
        expires_at: permanente ? "" : texto(corpo.venceEm, 10),
        permanente: permanente ? 1 : 0,
        dias_aceitaveis: numero(corpo.diasAceitaveis) || numero(definicao?.diasAceitaveis),
        arquivo_id: texto(corpo.arquivoId, 120),
        arquivo_url: texto(corpo.arquivoUrl, 1000),
        arquivo_nome: texto(corpo.arquivoNome, 300),
        observacao: texto(corpo.observacao, 2000),
      };
    },
    exigido: (corpo) => {
      if (!texto(corpo.tipo)) return "Escolha o tipo do documento.";
      if (!texto(corpo.titulo) && !doCatalogoDeHabilitacao(texto(corpo.tipo, 80).toUpperCase()))
        return "Dê um título ao documento.";
      if (!corpo.permanente && !texto(corpo.emitidoEm) && !texto(corpo.venceEm))
        return "Informe a emissão ou o vencimento — sem data não há semáforo, e sem semáforo o documento vence calado.";
      return "";
    },
  },

  habilitacaoKits: {
    tabela: "todogreen_habilitacao_kits",
    permissao: "compliance:manage",
    permissoesLeitura: [
      "compliance:manage", "crm:manage", "clients:manage", "proposal:manage", "audit:read",
    ],
    escopoDeCarteira: false,
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      chave: row.kit_key || "",
      nome: row.nome || "",
      descricao: row.descricao || "",
      tipos: parse(row.tipos_json, []) || [],
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      kit_key: texto(corpo.chave, 60).toLowerCase(),
      nome: texto(corpo.nome, 160),
      descricao: texto(corpo.descricao, 500),
      tipos_json: JSON.stringify(
        (Array.isArray(corpo.tipos) ? corpo.tipos : [])
          .map((item) => texto(item, 80).toUpperCase())
          .filter(Boolean)
          .slice(0, 80),
      ),
    }),
    exigido: (corpo) => {
      if (!texto(corpo.nome)) return "Dê um nome ao kit.";
      if (!Array.isArray(corpo.tipos) || !corpo.tipos.length)
        return "Um kit vazio não anexa nada — escolha os documentos que ele reúne.";
      return "";
    },
  },

  rfq: {
    tabela: "todogreen_rfq_pedidos",
    permissao: "crm:manage",
    permissoesLeitura: [
      "crm:manage", "clients:manage", "proposal:manage", "compliance:manage", "audit:read",
    ],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id || "",
      cliente: row.client_name || "",
      opportunityId: row.opportunity_id || "",
      titulo: row.titulo || "",
      etapa: row.etapa || "recebido",
      canal: row.canal || "",
      solicitante: row.solicitante || "",
      pedido: row.pedido || "",
      kit: row.kit_key || "",
      prazo: row.prazo || "",
      enviadoEm: row.enviado_em || "",
      enviados: parse(row.enviados_json, []) || [],
      resultadoEm: row.resultado_em || "",
      motivo: row.motivo || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      client_name: texto(corpo.cliente, 200),
      opportunity_id: texto(corpo.opportunityId, 120),
      titulo: texto(corpo.titulo, 200),
      etapa: etapaDoRfqValida(corpo.etapa),
      canal: texto(corpo.canal, 120),
      solicitante: texto(corpo.solicitante, 200),
      // O texto do pedido entra CRU, sem resumir: é o que responde "mandaram o
      // quê mesmo?" três meses depois.
      pedido: texto(corpo.pedido, 8000),
      kit_key: texto(corpo.kit, 60).toLowerCase(),
      prazo: texto(corpo.prazo, 10),
      enviado_em: texto(corpo.enviadoEm, 30),
      enviados_json: JSON.stringify(
        (Array.isArray(corpo.enviados) ? corpo.enviados : [])
          .map((item) => texto(item, 300))
          .filter(Boolean)
          .slice(0, 120),
      ),
      resultado_em: texto(corpo.resultadoEm, 30),
      motivo: texto(corpo.motivo, 2000),
    }),
    exigido: (corpo) => {
      if (!texto(corpo.titulo)) return "Diga do que é este RFQ.";
      if (!texto(corpo.clientId) && !texto(corpo.cliente)) return "Informe de quem veio o pedido.";
      // Fechar sem motivo joga fora a única inteligência comercial que um ano
      // de cotações produz.
      if (["ganho", "perdido", "sem-resposta"].includes(etapaDoRfqValida(corpo.etapa)) && !texto(corpo.motivo))
        return "Registre o motivo do resultado — é o que vira material de inteligência comercial.";
      return "";
    },
  },

  // ===== O dossiê do próprio negócio =====
  //
  // É o que o Plantû lê antes de responder qualquer coisa sobre a To Do Green.
  // Escrever exige `admin:manage` de propósito: quem edita isto muda o que o
  // assistente afirma para todo mundo do espaço, inclusive dentro de proposta.
  // Ler é aberto a quem já entra na vertical — um vendedor precisa saber a
  // história da casa para responder um RFI sem inventar.
  businessContext: {
    tabela: "todogreen_business_context",
    permissao: "business:teach",
    // O dossiê é da EMPRESA, não da carteira de ninguém. Sem isto, o recorte
    // de carteira procuraria `client_id` numa tabela que não tem essa coluna e
    // a vendedora receberia 500 ao abrir a tela.
    escopoDeCarteira: false,
    permissoesLeitura: [
      "business:teach", "crm:manage", "clients:manage", "proposal:manage",
      "operations:manage", "finance:manage", "audit:read",
    ],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      chave: row.fact_key || "",
      categoria: row.category || "identidade",
      titulo: row.title || "",
      conteudo: row.content || "",
      fonte: row.source || "",
      vigenteEm: row.effective_at || "",
      sigilo: row.secrecy || "interno",
      origem: row.origin || "cadastrado",
      fixado: Number(row.pinned || 0) === 1,
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => {
      const fato = normalizarFato(corpo);
      return {
        fact_key: fato.chave,
        category: fato.categoria,
        title: fato.titulo,
        content: fato.conteudo,
        source: fato.fonte,
        effective_at: fato.vigenteEm,
        secrecy: fato.sigilo,
        origin: fato.origem,
        pinned: fato.fixado ? 1 : 0,
      };
    },
    exigido: (corpo) => {
      if (!texto(corpo.titulo || corpo.title)) return "Dê um título ao que a IA precisa saber.";
      if (texto(corpo.conteudo || corpo.content, 8000).length < 10)
        return "Escreva o que a IA precisa saber sobre esse ponto.";
      return "";
    },
  },

  proposals: {
    tabela: "todogreen_proposals",
    permissao: "proposal:manage",
    permissoesLeitura: ["proposal:create", "proposal:manage", "deal:review", "deal:approve", "audit:read"],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id,
      cliente: row.client_name,
      oportunidadeId: row.opportunity_id,
      cenarioId: row.scenario_id,
      titulo: row.title,
      escopo: row.scope,
      condicoes: row.commercial_terms,
      riscos: row.risks,
      texto: row.proposal_text,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      client_name: texto(corpo.cliente || corpo.clientName, 200),
      opportunity_id: texto(corpo.oportunidadeId, 120),
      scenario_id: texto(corpo.cenarioId, 120),
      title: texto(corpo.titulo, 240),
      scope: texto(corpo.escopo, 4000),
      commercial_terms: texto(corpo.condicoes, 4000),
      risks: texto(corpo.riscos, 4000),
      proposal_text: texto(corpo.texto, 8000),
      status: texto(corpo.situacao, 40) || "draft",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    // Uma proposta sem simulação por trás é preço sem conta. O vínculo é
    // exigido aqui, no servidor, e não só no botão da tela.
    exigido: (corpo) =>
      texto(corpo.cenarioId)
        ? ""
        : "A proposta precisa apontar para a simulação que gerou o preço.",
  },

  contracts: {
    tabela: "todogreen_contracts",
    permissao: "proposal:manage",
    permissoesLeitura: ["proposal:manage", "deal:review", "deal:approve", "audit:read"],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id,
      cliente: row.client_name,
      oportunidadeId: row.opportunity_id,
      propostaId: row.proposal_id,
      cenarioId: row.scenario_id,
      titulo: row.title,
      inicioEm: row.start_date || "",
      fimEm: row.end_date || "",
      valorMensal: row.monthly_value,
      valorTotal: row.total_value,
      situacao: row.status,
      termos: row.terms,
      assinatura: row.signature_status || "pending",
      assinadoEm: row.signed_at || "",
      renovacao: row.renewal_type || "manual",
      avisoRenovacaoEm: row.renewal_notice_date || "",
      diaFaturamento: row.billing_day || null,
      responsavelId: row.responsible_user_id || "",
      antecedenciaAvisoDias: row.notice_days || 60,
      versao: row.version || 1,
      servicoId: row.service_id || "",
      tabelaPrecoId: row.price_table_id || "",
      sla: parse(row.sla_json, {}),
      condicoesComerciais: parse(row.commercial_terms_json, {}),
      impostos: parse(row.taxes_json, {}),
      regrasFaturamento: parse(row.billing_rules_json, {}),
      indiceReajuste: row.adjustment_index || "",
      dataBaseReajuste: row.adjustment_base_date || "",
      compromissoMinimo: row.minimum_commitment || 0,
      aprovacao: row.approval_status || "pending",
      aprovadoPor: row.approved_by || "",
      aprovadoEm: row.approved_at || "",
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      client_name: texto(corpo.cliente || corpo.clientName, 200),
      opportunity_id: texto(corpo.oportunidadeId, 120),
      proposal_id: texto(corpo.propostaId, 120),
      scenario_id: texto(corpo.cenarioId, 120),
      title: texto(corpo.titulo, 240),
      start_date: texto(corpo.inicioEm, 20) || null,
      end_date: texto(corpo.fimEm, 20) || null,
      monthly_value: numero(corpo.valorMensal),
      total_value: numero(corpo.valorTotal),
      status: texto(corpo.situacao, 40) || "draft",
      terms: texto(corpo.termos, 8000),
      signature_status: ["pending", "sent", "signed", "rejected", "expired"].includes(texto(corpo.assinatura, 40))
        ? texto(corpo.assinatura, 40) : "pending",
      signed_at: texto(corpo.assinadoEm, 40) || null,
      renewal_type: ["manual", "automatic", "none"].includes(texto(corpo.renovacao, 40))
        ? texto(corpo.renovacao, 40) : "manual",
      renewal_notice_date: texto(corpo.avisoRenovacaoEm, 20) || null,
      billing_day: Math.min(31, Math.max(1, Math.trunc(numero(corpo.diaFaturamento)))) || null,
      responsible_user_id: texto(corpo.responsavelId, 120) || null,
      notice_days: Math.min(365, Math.max(0, Math.trunc(numero(corpo.antecedenciaAvisoDias) || 60))),
      service_id: texto(corpo.servicoId, 120),
      price_table_id: texto(corpo.tabelaPrecoId, 120),
      sla_json: JSON.stringify(objeto(corpo.sla)),
      commercial_terms_json: JSON.stringify(objeto(corpo.condicoesComerciais)),
      taxes_json: JSON.stringify(objeto(corpo.impostos)),
      billing_rules_json: JSON.stringify(objeto(corpo.regrasFaturamento)),
      adjustment_index: texto(corpo.indiceReajuste, 80),
      adjustment_base_date: texto(corpo.dataBaseReajuste, 20) || null,
      minimum_commitment: Math.max(0, numero(corpo.compromissoMinimo)),
      approval_status: ["pending", "approved", "rejected"].includes(texto(corpo.aprovacao, 40))
        ? texto(corpo.aprovacao, 40) : "pending",
      approved_by: texto(corpo.aprovadoPor, 120) || null,
      approved_at: texto(corpo.aprovadoEm, 40) || null,
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      !texto(corpo.clientId)
        ? "O contrato precisa de um cliente."
        : !texto(corpo.propostaId)
          ? "O contrato precisa apontar para a proposta aceita."
          : !texto(corpo.titulo)
            ? "Informe o título do contrato."
            : "",
  },

  operations: {
    // Fonte canônica compartilhada com o Portal do Cliente. Antes o painel
    // escrevia em todogreen_operations e o cliente lia outra tabela.
    tabela: "todogreen_client_operations",
    permissao: "operations:manage",
    permissoesLeitura: ["operations:manage", "planning:manage", "tms:manage", "evidence:manage", "audit:read"],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id,
      produtoId: row.product_id,
      mesReferencia: row.service_date ? row.service_date.slice(0, 7) : "",
      referencia: row.reference,
      contratoId: row.contract_id || "",
      dataServico: row.service_date || "",
      origem: row.origin || "",
      destino: row.destination || "",
      prometidoEm: row.promised_at || "",
      entregueEm: row.delivered_at || "",
      etaEm: row.eta_at || "",
      placa: row.vehicle_plate || "",
      motorista: row.driver_name || "",
      motoristaId: row.driver_id || "",
      sla: row.sla_status || "",
      comprovanteUrl: row.proof_url || "",
      comprovanteHash: row.proof_hash || "",
      ultimaPosicaoEm: row.last_position_at || "",
      latitude: row.last_position_lat,
      longitude: row.last_position_lng,
      entregas: numero(parse(row.fields_json, {}).deliveries),
      pacotes: numero(parse(row.fields_json, {}).packages),
      viagens: numero(parse(row.fields_json, {}).trips),
      distanciaKm: numero(row.distance_km || parse(row.fields_json, {}).distanceKm),
      ocupacaoPercent: numero(parse(row.fields_json, {}).occupancyPercent),
      ocorrencias: numero(row.incident_count),
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      product_id: texto(corpo.produtoId, 120),
      contract_id: texto(corpo.contratoId, 120),
      reference: texto(corpo.referencia || corpo.rota, 200),
      service_date: /^\d{4}-\d{2}-\d{2}$/.test(texto(corpo.dataServico, 10))
        ? texto(corpo.dataServico, 10)
        : /^\d{4}-\d{2}$/.test(texto(corpo.mesReferencia, 10))
          ? `${texto(corpo.mesReferencia, 10)}-01`
          : null,
      origin: texto(corpo.origem, 200),
      destination: texto(corpo.destino, 200),
      promised_at: texto(corpo.prometidoEm, 40) || null,
      delivered_at: texto(corpo.entregueEm, 40) || null,
      eta_at: texto(corpo.etaEm, 40) || null,
      vehicle_plate: texto(corpo.placa, 20).toUpperCase(),
      driver_name: texto(corpo.motorista, 160),
      // O motorista como dado: o id liga a operação ao cadastro (0070) e é o
      // recorte do portal do motorista. O nome continua como rótulo.
      driver_id: texto(corpo.motoristaId, 120),
      distance_km: numero(corpo.distanciaKm),
      incident_count: numero(corpo.ocorrencias),
      sla_status: texto(corpo.sla, 40),
      proof_url: texto(corpo.comprovanteUrl, 2000),
      proof_hash: texto(corpo.comprovanteHash, 160),
      last_position_at: texto(corpo.ultimaPosicaoEm, 40) || null,
      last_position_lat: corpo.latitude === "" || corpo.latitude == null ? null : numero(corpo.latitude),
      last_position_lng: corpo.longitude === "" || corpo.longitude == null ? null : numero(corpo.longitude),
      status: texto(corpo.situacao, 40) || "active",
      fields_json: JSON.stringify({
        ...objeto(corpo.campos),
        deliveries: numero(corpo.entregas),
        packages: numero(corpo.pacotes),
        trips: numero(corpo.viagens),
        distanceKm: numero(corpo.distanciaKm),
        occupancyPercent: numero(corpo.ocupacaoPercent),
      }),
    }),
    exigido: (corpo) => (texto(corpo.clientId) ? "" : "Informe o cliente da operação."),
  },

  // #139: rota do dia planejada no roteirizador e atribuída a um motorista. O
  // cabeçalho vive em colunas próprias (motorista, veículo, data, resumo, status)
  // e as paradas ORDENADAS em stops_json — lidas/gravadas sempre com a rota. O
  // app do motorista lê pelo driver_id (mesmo recorte das viagens).
  rotas: {
    tabela: "todogreen_routes",
    permissao: "operations:manage",
    permissoesLeitura: ["operations:manage", "planning:manage", "tms:manage", "fleet:manage", "audit:read"],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      nome: row.name || "",
      motoristaId: row.driver_id || "",
      motorista: row.driver_name || "",
      placa: row.vehicle_plate || "",
      dataServico: row.service_date || "",
      status: row.status || "planejada",
      origem: row.origin || "",
      destino: row.destination || "",
      distanciaKm: numero(row.distance_km),
      duracaoMin: numero(row.duration_min),
      pedagioTotal: numero(row.toll_total),
      paradas: parse(row.stops_json, []),
      notas: row.notes || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      name: texto(corpo.nome, 200),
      driver_id: texto(corpo.motoristaId, 120),
      driver_name: texto(corpo.motorista, 160),
      vehicle_plate: texto(corpo.placa, 20).toUpperCase(),
      service_date: /^\d{4}-\d{2}-\d{2}$/.test(texto(corpo.dataServico, 10)) ? texto(corpo.dataServico, 10) : null,
      status: texto(corpo.status, 40) || "planejada",
      origin: texto(corpo.origem, 300),
      destination: texto(corpo.destino, 300),
      distance_km: numero(corpo.distanciaKm),
      duration_min: numero(corpo.duracaoMin),
      toll_total: numero(corpo.pedagioTotal),
      stops_json: JSON.stringify(Array.isArray(corpo.paradas) ? corpo.paradas.slice(0, 200) : []),
      notes: texto(corpo.notas, 1000),
    }),
    exigido: (corpo) => {
      if (!texto(corpo.motoristaId)) return "Escolha o motorista que vai receber a rota.";
      if (!Array.isArray(corpo.paradas) || corpo.paradas.length < 2)
        return "A rota precisa de pelo menos duas paradas (origem e destino).";
      return "";
    },
  },

  financial: {
    tabela: "todogreen_financial_entries",
    permissao: "finance:manage",
    permissoesLeitura: ["finance:manage", "revenue:manage", "cost:manage", "commission:manage", "audit:read"],
    ordem: "reference_month DESC, updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      tipo: row.kind,
      clientId: row.client_id,
      produtoId: row.product_id,
      cenarioId: row.scenario_id,
      categoria: row.category,
      descricao: row.description,
      valor: row.amount,
      mesReferencia: row.reference_month,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      vencimentoEm: row.due_date || "",
      pagoEm: row.paid_at || "",
      valorPago: row.paid_amount || 0,
      contraparte: row.counterparty || "",
      // Contraparte por referência (costura 4): o id da parte é o que concilia
      // com o fornecedor do pedido; `contraparte` fica como rótulo legível.
      partyId: row.party_id || "",
      numeroDocumento: row.document_number || "",
      centroCusto: row.cost_center || "",
      codigoOrcamento: row.budget_code || "",
      meioPagamento: row.payment_method || "",
      competenciaEm: row.competence_date || "",
      contratoId: row.contract_id || "",
      statusFinanceiro: row.invoice_status || "pending",
      // Eixos do relatório (migração 0056). As colunas de texto `categoria` e
      // `centroCusto` continuam valendo como detalhe livre; estas apontam para o
      // cadastro e é por elas que o relatório soma sem depender de grafia.
      accountId: row.account_id || "",
      costCenterId: row.cost_center_id || "",
      bankAccountId: row.bank_account_id || "",
      multaPercent: row.late_fee_percent || 0,
      jurosMesPercent: row.late_interest_month_percent || 0,
      conciliadoEm: row.reconciled_at || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      kind: ["revenue", "cost", "commission"].includes(texto(corpo.tipo)) ? texto(corpo.tipo) : "cost",
      client_id: texto(corpo.clientId, 120),
      product_id: texto(corpo.produtoId, 120),
      scenario_id: texto(corpo.cenarioId, 120),
      category: texto(corpo.categoria, 120),
      description: texto(corpo.descricao, 500),
      amount: numero(corpo.valor),
      reference_month: texto(corpo.mesReferencia, 10),
      status: texto(corpo.situacao, 40) || "confirmed",
      due_date: texto(corpo.vencimentoEm, 20) || null,
      paid_at: texto(corpo.pagoEm, 40) || null,
      paid_amount: Math.max(0, numero(corpo.valorPago)),
      counterparty: texto(corpo.contraparte, 200),
      party_id: texto(corpo.partyId, 120),
      document_number: texto(corpo.numeroDocumento, 120),
      cost_center: texto(corpo.centroCusto, 120),
      budget_code: texto(corpo.codigoOrcamento, 120),
      payment_method: texto(corpo.meioPagamento, 80),
      competence_date: texto(corpo.competenciaEm, 20) || null,
      contract_id: texto(corpo.contratoId, 120),
      invoice_status: ["pending", "partial", "paid", "overdue", "cancelled"].includes(texto(corpo.statusFinanceiro, 40))
        ? texto(corpo.statusFinanceiro, 40) : "pending",
      account_id: texto(corpo.accountId, 120),
      cost_center_id: texto(corpo.costCenterId, 120),
      bank_account_id: texto(corpo.bankAccountId, 120),
      // Percentual negativo não gera crédito; o encargo do atraso só pode
      // aumentar o que se deve.
      late_fee_percent: Math.max(0, numero(corpo.multaPercent)),
      late_interest_month_percent: Math.max(0, numero(corpo.jurosMesPercent)),
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      ["revenue", "cost", "commission"].includes(texto(corpo.tipo))
        ? numero(corpo.valor) > 0
          ? ""
          : "Informe o valor do lançamento."
        : "Informe se o lançamento é receita, custo ou comissão.",
  },

  // ===== Cadastros de base do ERP (migração 0053) =====
  //
  // Os cinco entram pelo caminho genérico porque são CRUD puro: nenhum tem
  // efeito colateral, cálculo de saldo ou máquina de estados. O que tem regra
  // — movimento de estoque, apuração de imposto, fechamento de folha — ganha
  // handler próprio justamente por não caber aqui.
  //
  // Todos são `escopoDeCarteira: false`: cadastro da empresa não pertence à
  // carteira de vendedor nenhum, e a validação vem de `erpCoreDomain.js`, a
  // mesma que a tela usa — para o botão não liberar o que o servidor recusa.

  items: {
    tabela: "todogreen_items",
    permissao: "stock:manage",
    permissoesLeitura: ["stock:manage", "purchase:manage", "operations:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "name ASC",
    daLinha: (row) => ({
      id: row.id,
      codigo: row.code,
      nome: row.name,
      unidade: row.unit,
      categoria: row.category,
      ncm: row.ncm,
      cest: row.cest,
      custoReferencia: row.standard_cost,
      estoqueMinimo: row.min_stock,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      code: normalizeSku(corpo.codigo),
      name: texto(corpo.nome, 200),
      // A unidade já vem validada por `exigido`; normalizar de novo aqui evita
      // que "kg" e "KG" virem dois saldos do mesmo material.
      unit: normalizeUnit(corpo.unidade),
      category: texto(corpo.categoria, 120),
      ncm: texto(corpo.ncm, 8).replace(/\D+/g, ""),
      cest: texto(corpo.cest, 7).replace(/\D+/g, ""),
      standard_cost: Math.max(0, numero(corpo.custoReferencia)),
      min_stock: Math.max(0, numero(corpo.estoqueMinimo)),
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      validateItem({
        name: corpo.nome,
        unit: corpo.unidade,
        ncm: corpo.ncm,
        standardCost: corpo.custoReferencia,
        minStock: corpo.estoqueMinimo,
      }),
  },

  warehouses: {
    tabela: "todogreen_warehouses",
    permissao: "stock:manage",
    permissoesLeitura: ["stock:manage", "purchase:manage", "operations:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "name ASC",
    daLinha: (row) => ({
      id: row.id,
      codigo: row.code,
      nome: row.name,
      tipo: row.kind,
      veiculoId: row.vehicle_id,
      endereco: row.address,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      code: texto(corpo.codigo, 40).toUpperCase(),
      name: texto(corpo.nome, 200),
      kind: ["proprio", "terceiro", "veiculo", "transito"].includes(texto(corpo.tipo))
        ? texto(corpo.tipo)
        : "proprio",
      vehicle_id: texto(corpo.veiculoId, 120),
      address: texto(corpo.endereco, 400),
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      validateWarehouse({ name: corpo.nome, kind: corpo.tipo, vehicleId: corpo.veiculoId }),
  },

  parties: {
    tabela: "todogreen_parties",
    // Escrita é de compras: é quem cadastra fornecedor. A conta comercial
    // continua sendo escrita em `todogreen_clients`, com a carteira valendo lá.
    permissao: "purchase:manage",
    permissoesLeitura: ["purchase:manage", "finance:manage", "clients:manage", "audit:read"],
    // A parte tem `client_id`, mas o recorte de carteira aqui esconderia todo
    // fornecedor (client_id vazio) de operações e financeiro — exatamente de
    // quem precisa dele. O que é sensível por carteira (score, pipeline,
    // forecast, responsável) nunca esteve nesta tabela; aqui há só dado
    // cadastral e fiscal.
    escopoDeCarteira: false,
    ordem: "legal_name ASC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id,
      documento: row.document,
      razaoSocial: row.legal_name,
      nomeFantasia: row.trade_name,
      papeis: parse(row.roles_json, []),
      inscricaoEstadual: row.state_registration,
      inscricaoMunicipal: row.city_registration,
      regimeTributario: row.tax_regime,
      endereco: parse(row.address_json, {}),
      prazoPagamentoDias: row.payment_term_days,
      email: row.email,
      telefone: row.phone,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      // Só dígitos: duas grafias do mesmo CNPJ viram dois fornecedores, e o
      // índice único não pegaria porque as strings diferem.
      document: normalizeDocument(corpo.documento),
      legal_name: texto(corpo.razaoSocial, 240),
      trade_name: texto(corpo.nomeFantasia, 240),
      roles_json: JSON.stringify(normalizePartyRoles(corpo.papeis)),
      state_registration: texto(corpo.inscricaoEstadual, 40),
      city_registration: texto(corpo.inscricaoMunicipal, 40),
      tax_regime: texto(corpo.regimeTributario, 60),
      address_json: JSON.stringify(objeto(corpo.endereco)),
      payment_term_days: Math.max(0, Math.trunc(numero(corpo.prazoPagamentoDias))),
      email: texto(corpo.email, 200),
      phone: texto(corpo.telefone, 60),
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) =>
      validateParty({
        legalName: corpo.razaoSocial,
        roles: corpo.papeis,
        document: corpo.documento,
        paymentTermDays: corpo.prazoPagamentoDias,
      }),
  },

  accounts: {
    tabela: "todogreen_chart_of_accounts",
    permissao: "finance:manage",
    permissoesLeitura: ["finance:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "code ASC, name ASC",
    daLinha: (row) => ({
      id: row.id,
      codigo: row.code,
      nome: row.name,
      natureza: row.kind,
      paiId: row.parent_id,
      analitica: row.analytical === 1,
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      code: texto(corpo.codigo, 40),
      name: texto(corpo.nome, 200),
      kind: ["receita", "despesa", "ativo", "passivo", "resultado"].includes(texto(corpo.natureza))
        ? texto(corpo.natureza)
        : "despesa",
      parent_id: texto(corpo.paiId, 120),
      analytical: corpo.analitica === false ? 0 : 1,
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validateAccount({ name: corpo.nome, kind: corpo.natureza }),
  },

  costCenters: {
    tabela: "todogreen_cost_centers",
    permissao: "finance:manage",
    permissoesLeitura: ["finance:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "code ASC, name ASC",
    daLinha: (row) => ({
      id: row.id,
      codigo: row.code,
      nome: row.name,
      paiId: row.parent_id,
      responsavelId: row.owner_user_id || "",
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      code: texto(corpo.codigo, 40),
      name: texto(corpo.nome, 200),
      parent_id: texto(corpo.paiId, 120),
      owner_user_id: texto(corpo.responsavelId, 120) || null,
      status: texto(corpo.situacao, 40) || "ativo",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validateCostCenter({ name: corpo.nome }),
  },

  // Conta bancária é CRUD puro; o que tem regra — importar extrato, conciliar,
  // fechar período — mora em `todogreen-treasury.js`. O saldo NÃO fica aqui:
  // `opening_balance` é o saldo inicial (premissa), e o saldo de hoje é ele mais
  // o que foi conciliado, calculado por `saldoDaConta`.
  bankAccounts: {
    tabela: "todogreen_treasury_accounts",
    permissao: "finance:manage",
    permissoesLeitura: ["finance:manage"],
    escopoDeCarteira: false,
    ordem: "name ASC",
    daLinha: (row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      bancoCodigo: row.bank_code,
      agencia: row.branch,
      conta: row.account_number,
      chavePix: row.pix_key,
      saldoInicial: row.opening_balance,
      aberturaEm: row.opening_date || "",
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      name: texto(corpo.name ?? corpo.nome, 200),
      kind: ["corrente", "poupanca", "caixa", "aplicacao", "cartao"].includes(texto(corpo.kind))
        ? texto(corpo.kind)
        : "corrente",
      bank_code: texto(corpo.bancoCodigo, 20),
      branch: texto(corpo.agencia, 20),
      account_number: texto(corpo.conta, 40),
      pix_key: texto(corpo.chavePix, 200),
      // Saldo inicial pode ser negativo: conta com limite usado começa no
      // vermelho, e forçar zero mentiria sobre a posição de caixa.
      opening_balance: numero(corpo.saldoInicial),
      opening_date: texto(corpo.aberturaEm, 20) || null,
      status: texto(corpo.situacao, 40) || "ativa",
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validateBankAccount({ name: corpo.name ?? corpo.nome, kind: corpo.kind }),
  },

  // Qualidade: não conformidades com causa raiz, plano de ação, dono e prazo.
  // Não é escopo de carteira — Qualidade enxerga a operação inteira, não só a
  // carteira de um vendedor.
  quality: {
    tabela: "todogreen_quality_records",
    permissao: "operations:manage",
    escopoDeCarteira: false,
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      titulo: row.title,
      clientId: row.client_id || "",
      operacaoId: row.operation_id || "",
      tipo: row.kind,
      gravidade: row.severity,
      causaRaiz: row.root_cause || "",
      planoAcao: row.action_plan || "",
      responsavelId: row.owner_user_id || "",
      prazo: row.due_date || "",
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      title: texto(corpo.titulo || corpo.title, 240),
      client_id: texto(corpo.clientId, 120),
      operation_id: texto(corpo.operacaoId, 120),
      kind: normalizarTipo(texto(corpo.tipo || corpo.kind, 40)),
      severity: normalizarGravidade(texto(corpo.gravidade || corpo.severity, 40)),
      root_cause: texto(corpo.causaRaiz || corpo.rootCause, 2000),
      action_plan: texto(corpo.planoAcao || corpo.actionPlan, 2000),
      owner_user_id: texto(corpo.responsavelId, 120) || null,
      due_date: texto(corpo.prazo || corpo.dueDate, 40) || null,
      status: normalizarSituacaoQualidade(texto(corpo.situacao || corpo.status, 40)),
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validarNaoConformidade({ titulo: corpo.titulo || corpo.title }),
  },

  // Jurídico: minutas, contratos, aditivos e afins com risco, vigência e
  // situação. Não é escopo de carteira — o Jurídico enxerga a operação inteira.
  legal: {
    tabela: "todogreen_legal_records",
    permissao: "proposal:manage",
    escopoDeCarteira: false,
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      titulo: row.title,
      clientId: row.client_id || "",
      contraparte: row.counterparty || "",
      tipo: row.kind,
      risco: row.risk,
      inicioVigencia: row.effective_start || "",
      fimVigencia: row.effective_end || "",
      responsavelId: row.owner_user_id || "",
      observacoes: row.notes || "",
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      title: texto(corpo.titulo || corpo.title, 240),
      client_id: texto(corpo.clientId, 120),
      counterparty: texto(corpo.contraparte || corpo.counterparty, 240),
      kind: normalizarTipoJuridico(texto(corpo.tipo || corpo.kind, 40)),
      risk: normalizarRisco(texto(corpo.risco || corpo.risk, 40)),
      effective_start: texto(corpo.inicioVigencia || corpo.effectiveStart, 40) || null,
      effective_end: texto(corpo.fimVigencia || corpo.effectiveEnd, 40) || null,
      owner_user_id: texto(corpo.responsavelId, 120) || null,
      notes: texto(corpo.observacoes || corpo.notes, 4000),
      status: normalizarSituacaoJuridica(texto(corpo.situacao || corpo.status, 40)),
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => validarDocumentoJuridico({ titulo: corpo.titulo || corpo.title }),
  },
};

const nomeDaColecao = (colecao) =>
  Object.entries(COLECOES).find(([, configuracao]) => configuracao === colecao)?.[0] || "record";

// `read` abre a vertical, não o razão financeiro inteiro. Cada coleção
// declara pelo menos uma capacidade funcional que dá acesso ao seu conteúdo.
// A regra é "qualquer uma", porque auditoria pode consultar sem administrar.
const podeLerColecao = (access, colecao) =>
  (colecao.permissoesLeitura || [colecao.permissao]).some((permissao) =>
    podeNaVertical(access, permissao));

const podeLerCenarios = (access) =>
  ["pricing:simulate", "pricing:manage", "deal:review", "deal:approve", "audit:read"]
    .some((permissao) => podeNaVertical(access, permissao));

const validarFinanceiro = (corpo, atual = null) => {
  const valor = numero(corpo.valor);
  const pago = Math.max(0, numero(corpo.valorPago));
  if (pago > valor + 0.0001) return "O valor pago não pode superar o valor do lançamento.";
  if (!atual && pago > 0)
    return "Crie o lançamento e use a ação de baixa para registrar o pagamento com histórico.";
  if (
    atual
    && Object.prototype.hasOwnProperty.call(corpo, "valorPago")
    && Math.abs(pago - numero(atual.paid_amount)) > 0.0001
  ) return "O valor pago só pode mudar por uma baixa financeira.";
  return "";
};

const registrarEventoContrato = async (env, access, user, contractId, action, before, after, note = "") => {
  await env.DB.prepare(
    `INSERT INTO todogreen_contract_events
       (id,tenant_id,workspace_owner_id,contract_id,action,before_json,after_json,note,actor_user_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    crypto.randomUUID(), TENANT_ID, access.ownerId, contractId, action,
    JSON.stringify(before || {}), JSON.stringify(after || {}), texto(note, 1000), user.id,
    new Date().toISOString(),
  ).run();
};

// A simulação é um retrato, não um cadastro: ela registra o que a régua e as
// premissas diziam no momento em que alguém calculou. Editar uma simulação
// salva seria reescrever o passado — então ela nasce e não muda. Quem precisa
// de outro número faz outra simulação.
//
// Por isso `pricing_scenarios` não tem revision nem archived_at, e por isso
// esta coleção não passa pelo caminho genérico de atualizar e arquivar.
const CENARIOS = {
  daLinha: (row) => ({
    id: row.id,
    productId: row.product_id,
    clientId: row.client_id,
    opportunityId: row.opportunity_id,
    ruleVersion: row.rule_version,
    inputs: parse(row.inputs_json, {}),
    result: parse(row.result_json, {}),
    approvals: parse(row.approvals_json, {}),
    premissas: parse(row.premises_json, {}),
    status: row.status,
    criadoPor: row.created_by,
    criadoEm: row.created_at,
  }),
};

const listarCenarios = async (env, access, email, { clienteId = "", limit = 200, offset = 0 } = {}) => {
  const recorte = recorteDeCarteira(access, email, "pricing_scenarios");
  const filtroCliente = clienteId ? "AND pricing_scenarios.client_id = ?" : "";
  const paramsFiltro = clienteId ? [clienteId] : [];
  const base = `FROM pricing_scenarios
      WHERE tenant_id = ? AND workspace_owner_id = ? ${filtroCliente} ${recorte.sql}`;
  const params = [TENANT_ID, access.ownerId, ...paramsFiltro, ...recorte.params];
  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(`SELECT * ${base} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);
  return { registros: (results || []).map(CENARIOS.daLinha), total: totalRow?.total || 0 };
};

const criarCenario = async (env, access, user, corpo) => {
  const produto = texto(corpo.productId, 80);
  if (!produto) return json({ error: "Informe o produto da simulação." }, 400);
  const resultado = objeto(corpo.result);
  if (!Object.keys(resultado).length)
    return json({ error: "A simulação precisa do resultado calculado." }, 400);

  const id = texto(corpo.id, 120) || crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO pricing_scenarios
       (id, tenant_id, workspace_owner_id, product_id, client_id, opportunity_id, created_by,
        rule_version, inputs_json, result_json, approvals_json, premises_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      TENANT_ID,
      access.ownerId,
      produto,
      texto(corpo.clientId, 120),
      texto(corpo.opportunityId, 120),
      user.id,
      texto(corpo.ruleVersion, 60) || "padrao",
      JSON.stringify(objeto(corpo.inputs)),
      JSON.stringify(resultado),
      JSON.stringify(objeto(corpo.approvals)),
      JSON.stringify(objeto(corpo.premissas)),
      texto(corpo.status, 40) || "draft",
      agora,
    )
    .run();

  const row = await env.DB.prepare(
    "SELECT * FROM pricing_scenarios WHERE id = ? AND workspace_owner_id = ?",
  )
    .bind(id, access.ownerId)
    .first();
  const registro = CENARIOS.daLinha(row);
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "created", resourceType: "scenario", resourceId: id,
    clientId: registro.clientId, after: registro,
  });
  return json({ registro }, 201);
};

// O recorte de carteira só faz sentido em coleção que pertence a um cliente.
// Um cadastro da empresa — material, depósito, plano de contas, centro de custo,
// fornecedor — não tem dono comercial, e essas tabelas não têm sequer a coluna
// `client_id` que o recorte referencia. Sem esta saída, o SQL do recorte
// quebraria a leitura para todo papel que não vê a carteira inteira e, pior,
// faria `noAlcanceDaCarteira` devolver 404 em silêncio (ele engole o erro no
// `.catch`), o que pareceria "registro não encontrado" em vez de defeito.
//
// Quem declara `escopoDeCarteira: false` está dizendo "isto é cadastro da
// empresa, não carteira de ninguém" — e continua protegido pelos outros dois
// cortes, tenant e espaço, que valem sempre.
const recorteDaColecao = (colecao, access, email) =>
  colecao.escopoDeCarteira === false
    ? { sql: "", params: [] }
    : recorteDeCarteira(access, email, "t");

// A leitura carrega o recorte de carteira além do escopo de espaço. São dois
// cortes diferentes: o espaço separa empresas, a carteira separa vendedores
// dentro da mesma empresa. Sem o segundo, um vendedor lista as oportunidades
// dos colegas.
const listar = async (env, colecao, access, email, { clienteId = "", limit = 500, offset = 0 } = {}) => {
  const recorte = recorteDaColecao(colecao, access, email);
  const porCliente = clienteId && colecao.escopoDeCarteira !== false;
  const filtroCliente = porCliente ? "AND t.client_id = ?" : "";
  const paramsFiltro = porCliente ? [clienteId] : [];
  const base = `FROM ${colecao.tabela} t
      WHERE t.tenant_id = ? AND t.workspace_owner_id = ? AND t.archived_at IS NULL ${filtroCliente} ${recorte.sql}`;
  const params = [TENANT_ID, access.ownerId, ...paramsFiltro, ...recorte.params];
  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(
      `SELECT t.* ${base}
        ORDER BY ${colecao.ordem.replace(/\b(updated_at|reference_month)\b/g, "t.$1")}
        LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);
  const registros = (results || []).map(colecao.daLinha);
  // Corte que o SQL não sabe fazer. Só as pastas usam isto, e por um motivo
  // específico: a visibilidade de uma pasta depende de TODA a linhagem dela, o
  // que é uma consulta recursiva sobre um conjunto pequeno. Filtrar depois da
  // leitura é aceitável AQUI porque os três cortes de escopo (tenant, espaço,
  // arquivado) continuam no SQL — este é um quarto corte, dentro do próprio
  // espaço, sobre dados que a pessoa já podia ler o suficiente para saber que
  // existem.
  //
  // Não generalizar: para qualquer outra coleção, filtro fora do SQL é dado
  // sensível passando por variável de aplicação.
  if (typeof colecao.filtrarLeitura === "function") {
    const permitidos = colecao.filtrarLeitura(registros, { access, email });
    // O total precisa acompanhar o filtro, senão a paginação do gancho pede
    // páginas que nunca chegam e a tela fica carregando para sempre.
    return { registros: permitidos, total: permitidos.length };
  }
  return { registros, total: totalRow?.total || 0 };
};

// Confirma que o registro está na carteira de quem pede, ANTES de escrever.
// 404 e não 403 quando está fora: dizer "existe mas não é sua" já entrega que
// o registro existe.
const noAlcanceDaCarteira = async (env, colecao, access, email, id) => {
  const recorte = recorteDaColecao(colecao, access, email);
  return env.DB
    .prepare(
      `SELECT t.id FROM ${colecao.tabela} t
        WHERE t.id = ? AND t.tenant_id = ? AND t.workspace_owner_id = ? AND t.archived_at IS NULL ${recorte.sql}
        LIMIT 1`,
    )
    .bind(id, TENANT_ID, access.ownerId, ...recorte.params)
    .first()
    .catch(() => null);
};

// A tela já recusa gerar a proposta quando o Deal Desk não liberou a
// simulação — "Guarda no código, não só no `disabled`", diz o comentário lá.
// Só que o guarda estava no componente React, e qualquer chamada direta a
// este endpoint passava por cima dele. A régua é a mesma (liberacaoDaProposta,
// de dealDeskDomain.js); o que muda é onde ela é aplicada.
const proposalLiberada = async (env, access, cenarioId) => {
  const { results } = await env.DB.prepare(
    "SELECT * FROM todogreen_deal_desk_requests WHERE workspace_owner_id = ? AND scenario_id = ?",
  )
    .bind(access.ownerId, cenarioId)
    .all();
  return liberacaoDaProposta(cenarioId, (results || []).map(pedidoDoBanco));
};

// A trava do fechamento de período (migração 0056). Um mês fechado não aceita
// lançamento novo, alteração nem arquivamento — é o que faz um resultado
// publicado continuar valendo. Sem isso, o resultado de janeiro poderia mudar em
// dezembro e nenhum relatório emitido antes continuaria verdadeiro.
//
// Vale para as DUAS competências numa alteração: a de onde o lançamento está e a
// para onde ele iria. Checar só uma permitiria tirar um lançamento de um mês
// fechado (mudando o resultado dele) ou empurrar um lançamento para dentro dele.
const bloqueioDeCompetencia = async (env, access, ...entradas) => {
  const { results } = await env.DB.prepare(
    `SELECT reference_month AS referenceMonth, status FROM todogreen_financial_periods
      WHERE tenant_id = ? AND workspace_owner_id = ? AND status = 'fechado'`,
  ).bind(TENANT_ID, access.ownerId).all();
  const periodos = results || [];
  if (!periodos.length) return "";
  for (const entrada of entradas) {
    if (!entrada) continue;
    const bloqueio = bloqueioPorFechamento(entrada, periodos);
    if (bloqueio) return bloqueio;
  }
  return "";
};

// Gate do Jurídico (regra da titular: todo contrato passa pelo Jurídico antes
// de ser aprovado ou assinado). A validação jurídica vive em
// todogreen_enterprise_workflows (domínio "legal"), amarrada ao contrato pelo
// data_json.contractId (ou proposalId, quando o contrato ainda não existe no
// momento da criação). "Concluído" = a etapa `juridico` recebeu decisão
// aprovada ou aprovada com ressalva.
const juridicoConcluido = async (env, access, { contractId = "", proposalId = "" }) => {
  const cid = texto(contractId, 120);
  const pid = texto(proposalId, 120);
  if (!cid && !pid) return false;
  const { results } = await env.DB
    .prepare(
      `SELECT data_json, approval_json FROM todogreen_enterprise_workflows
        WHERE tenant_id=? AND workspace_owner_id=? AND domain='legal' AND archived_at IS NULL`,
    )
    .bind(TENANT_ID, access.ownerId)
    .all()
    .catch(() => ({ results: [] }));
  for (const row of results || []) {
    let data = {};
    let approval = {};
    try { data = JSON.parse(row.data_json || "{}"); } catch { data = {}; }
    try { approval = JSON.parse(row.approval_json || "{}"); } catch { approval = {}; }
    const refereEsteContrato =
      (cid && texto(data.contractId, 120) === cid) ||
      (pid && texto(data.proposalId, 120) === pid);
    if (!refereEsteContrato) continue;
    const aprovacoes = Array.isArray(approval.approvals) ? approval.approvals : [];
    if (aprovacoes.some((a) => a.stepId === "juridico" && ["approved", "ressalva"].includes(a.decision)))
      return true;
  }
  return false;
};

// Gate da assinatura: não se marca um contrato como assinado sem a evidência
// do documento assinado. O documento é anexado ao fluxo jurídico do contrato
// (EnterpriseWorkflowPanel → "Contrato e documentos", cofre interno com
// context_type='workflow'). Aqui exigimos ao menos um anexo num fluxo legal
// amarrado a este contrato.
const documentoDeAssinaturaVinculado = async (env, access, { contractId = "", proposalId = "" }) => {
  const cid = texto(contractId, 120);
  const pid = texto(proposalId, 120);
  if (!cid && !pid) return false;
  const { results } = await env.DB
    .prepare(
      `SELECT id, data_json FROM todogreen_enterprise_workflows
        WHERE tenant_id=? AND workspace_owner_id=? AND domain='legal' AND archived_at IS NULL`,
    )
    .bind(TENANT_ID, access.ownerId)
    .all()
    .catch(() => ({ results: [] }));
  const ids = [];
  for (const row of results || []) {
    let data = {};
    try { data = JSON.parse(row.data_json || "{}"); } catch { data = {}; }
    if ((cid && texto(data.contractId, 120) === cid) || (pid && texto(data.proposalId, 120) === pid))
      ids.push(row.id);
  }
  if (!ids.length) return false;
  const marcadores = ids.map(() => "?").join(",");
  const anexo = await env.DB
    .prepare(
      `SELECT id FROM todogreen_internal_files
        WHERE tenant_id=? AND workspace_owner_id=? AND context_type='workflow'
          AND context_id IN (${marcadores}) AND archived_at IS NULL LIMIT 1`,
    )
    .bind(TENANT_ID, access.ownerId, ...ids)
    .first()
    .catch(() => null);
  return Boolean(anexo);
};

const criar = async (env, colecao, access, user, corpo, email = "") => {
  const erro = colecao.exigido(corpo);
  if (erro) return json({ error: erro }, 400);

  // O autor do comentário é a sessão, nunca o corpo — assinatura não se
  // escolhe pelo navegador.
  if (colecao === COLECOES.comments || colecao === COLECOES.interactions)
    corpo = { ...corpo, autorEmail: texto(user.email, 200) };
  if (colecao === COLECOES.financial) {
    const erroFinanceiro = validarFinanceiro(corpo);
    if (erroFinanceiro) return json({ error: erroFinanceiro }, 400);
    const travado = await bloqueioDeCompetencia(env, access, corpo);
    if (travado) return json({ error: travado }, 409);
  }

  if (colecao === COLECOES.proposals) {
    const liberacao = await proposalLiberada(env, access, texto(corpo.cenarioId, 120));
    if (!liberacao.liberada) return json({ error: liberacao.motivo }, 409);
  }

  if (colecao === COLECOES.contracts) {
    const propostaId = texto(corpo.propostaId, 120);
    const proposta = await env.DB.prepare(
      `SELECT id,client_id,client_name,opportunity_id,scenario_id,status
         FROM todogreen_proposals
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
    ).bind(propostaId, TENANT_ID, access.ownerId).first();
    if (!proposta) return json({ error: "Proposta não encontrada neste espaço." }, 404);
    if (!new Set(["accepted", "approved", "aceita", "aprovada"]).has(texto(proposta.status).toLowerCase()))
      return json({ error: "Aceite a proposta antes de gerar o contrato." }, 409);
    if (texto(corpo.clientId) !== texto(proposta.client_id))
      return json({ error: "O cliente do contrato não corresponde ao da proposta." }, 409);
    const existente = await env.DB.prepare(
      `SELECT id FROM todogreen_contracts
        WHERE tenant_id=? AND workspace_owner_id=? AND proposal_id=? AND archived_at IS NULL`,
    ).bind(TENANT_ID, access.ownerId, propostaId).first();
    if (existente) return json({ error: "Esta proposta já possui contrato ativo." }, 409);
    // Nasce aprovado/assinado? Só com o Jurídico concluído. Na criação, o
    // contrato ainda não tem id, então amarramos pela proposta.
    if (texto(corpo.aprovacao, 40) === "approved" || texto(corpo.assinatura, 40) === "signed") {
      if (!(await juridicoConcluido(env, access, { proposalId: propostaId })))
        return json({ error: "Este contrato precisa da validação do Jurídico concluída antes de ser aprovado ou assinado." }, 409);
    }
    if (texto(corpo.assinatura, 40) === "signed") {
      if (!(await documentoDeAssinaturaVinculado(env, access, { proposalId: propostaId })))
        return json({ error: "Anexe o contrato assinado ao fluxo jurídico antes de marcar a assinatura como concluída." }, 409);
    }
    corpo = {
      ...corpo,
      cliente: corpo.cliente || proposta.client_name,
      oportunidadeId: corpo.oportunidadeId || proposta.opportunity_id,
      cenarioId: corpo.cenarioId || proposta.scenario_id,
      aprovadoPor: texto(corpo.aprovacao, 40) === "approved" ? user.id : "",
      aprovadoEm: texto(corpo.aprovacao, 40) === "approved" ? new Date().toISOString() : "",
    };
  }

  if (colecao === COLECOES.operations) {
    const cliente = await env.DB.prepare(
      `SELECT id FROM todogreen_clients
        WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ?
          AND archived_at IS NULL AND status = 'ativo'`,
    ).bind(TENANT_ID, access.ownerId, texto(corpo.clientId, 120)).first();
    if (!cliente) return json({ error: "Cliente não encontrado neste espaço." }, 404);
  }

  // Guarda que precisa do BANCO para decidir (linhagem de pastas, dono de
  // pasta privada). Fica no servidor porque um ciclo travaria a leitura
  // recursiva do próprio servidor, e porque dono é regra de acesso.
  if (typeof colecao.guardaDeEscrita === "function") {
    const impedimento = await colecao.guardaDeEscrita(env, { access, email, corpo, id: "" });
    if (impedimento) return json({ error: impedimento }, impedimento.status || 409);
  }

  const valores = colecao.colunas(corpo, { email, access, user, novo: true });
  const campos = Object.keys(valores);
  const agora = new Date().toISOString();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO ${colecao.tabela}
       (id, tenant_id, workspace_owner_id, ${campos.join(", ")},
        revision, created_by, updated_by, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ${campos.map(() => "?").join(", ")}, 1, ?, ?, ?, ?, NULL)`,
  )
    .bind(id, TENANT_ID, access.ownerId, ...campos.map((c) => valores[c]), user.id, user.id, agora, agora)
    .run();

  const row = await env.DB.prepare(
    `SELECT * FROM ${colecao.tabela} WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  )
    .bind(id, TENANT_ID, access.ownerId)
    .first();
  const registro = colecao.daLinha(row);
  const tipo = nomeDaColecao(colecao);
  if (colecao === COLECOES.opportunities && texto(registro.clientId))
    await aquecerContaPorOportunidade(env, access, user, registro.clientId);
  if (colecao === COLECOES.interactions)
    await carimbarUltimaInteracao(env, access, user, registro);
  if (colecao === COLECOES.contracts)
    await registrarEventoContrato(env, access, user, id, "created", {}, registro, texto(corpo.nota, 1000));
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "created", resourceType: tipo, resourceId: id,
    clientId: registro.clientId, after: registro,
  });
  return json({ registro }, 201);
};

const atualizar = async (env, colecao, access, user, id, corpo, email = "") => {
  const atual = await env.DB.prepare(
    `SELECT * FROM ${colecao.tabela}
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  )
    .bind(id, TENANT_ID, access.ownerId)
    .first();
  // 404 e não 403: dizer "existe, mas não é seu" já entrega que existe. Vale
  // tanto para registro de outro espaço quanto para cliente fora da carteira.
  if (!atual) return json({ error: "Registro não encontrado." }, 404);
  if (!(await noAlcanceDaCarteira(env, colecao, access, user.email, id)))
    return json({ error: "Registro não encontrado." }, 404);

  // A revisão vem de quem edita, não do banco. Se viesse do banco, o UPDATE
  // sempre casaria e a trava de concorrência não travaria nada — que é o
  // mesmo comportamento do JSON único que esta tabela veio substituir.
  const revisaoEsperada = Number(corpo.revision);
  if (!Number.isFinite(revisaoEsperada) || revisaoEsperada <= 0)
    return json({ error: "Informe a revisão do registro que você leu." }, 400);

  const proximo = { ...colecao.daLinha(atual), ...corpo };
  // Editar um comentário não troca a assinatura: o autor original permanece.
  if (colecao === COLECOES.comments || colecao === COLECOES.interactions)
    proximo.autorEmail = atual.author_email || "";
  if (colecao === COLECOES.contracts && texto(corpo.aprovacao, 40)) {
    proximo.aprovadoPor = texto(corpo.aprovacao, 40) === "approved" ? user.id : "";
    proximo.aprovadoEm = texto(corpo.aprovacao, 40) === "approved" ? new Date().toISOString() : "";
  }
  if (colecao === COLECOES.contracts) {
    // Gate do Jurídico só na TRANSIÇÃO para approved/signed (não a cada PATCH
    // posterior de um contrato que já está nesse estado).
    const vaiAprovar = texto(proximo.aprovacao, 40) === "approved" && texto(atual.approval_status, 40) !== "approved";
    const vaiAssinar = texto(proximo.assinatura, 40) === "signed" && texto(atual.signature_status, 40) !== "signed";
    if (vaiAprovar || vaiAssinar) {
      const ok = await juridicoConcluido(env, access, {
        contractId: id,
        proposalId: texto(atual.proposal_id, 120),
      });
      if (!ok)
        return json({ error: "Este contrato precisa da validação do Jurídico concluída antes de ser aprovado ou assinado." }, 409);
    }
    if (vaiAssinar) {
      const temDoc = await documentoDeAssinaturaVinculado(env, access, {
        contractId: id,
        proposalId: texto(atual.proposal_id, 120),
      });
      if (!temDoc)
        return json({ error: "Anexe o contrato assinado ao fluxo jurídico antes de marcar a assinatura como concluída." }, 409);
    }
  }
  const erro = colecao.exigido(proximo);
  if (erro) return json({ error: erro }, 400);
  if (colecao === COLECOES.financial) {
    const erroFinanceiro = validarFinanceiro(corpo, atual);
    if (erroFinanceiro) return json({ error: erroFinanceiro }, 400);
    // As duas competências: de onde sai e para onde vai.
    const travado = await bloqueioDeCompetencia(env, access, colecao.daLinha(atual), proximo);
    if (travado) return json({ error: travado }, 409);
  }

  if (colecao === COLECOES.operations) {
    const cliente = await env.DB.prepare(
      `SELECT id FROM todogreen_clients
        WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ?
          AND archived_at IS NULL AND status = 'ativo'`,
    ).bind(TENANT_ID, access.ownerId, texto(proximo.clientId, 120)).first();
    if (!cliente) return json({ error: "Cliente não encontrado neste espaço." }, 404);
  }

  if (typeof colecao.guardaDeEscrita === "function") {
    const impedimento = await colecao.guardaDeEscrita(env, { access, email, corpo: proximo, id });
    if (impedimento) return json({ error: impedimento }, 409);
  }

  const valores = colecao.colunas(proximo, { email, access, user, novo: false });
  const campos = Object.keys(valores);
  const agora = new Date().toISOString();

  const { meta } = await env.DB.prepare(
    `UPDATE ${colecao.tabela}
        SET ${campos.map((c) => `${c} = ?`).join(", ")},
            revision = revision + 1${colecao === COLECOES.contracts ? ", version = version + 1" : ""},
            updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND revision = ?`,
  )
    .bind(...campos.map((c) => valores[c]), user.id, agora, id, TENANT_ID, access.ownerId, revisaoEsperada)
    .run();

  // Alguém salvou entre a leitura e a escrita. Sobrescrever aqui seria repetir
  // o defeito do JSON único, que é justamente o motivo desta tabela existir.
  if (!meta?.changes)
    return json(
      { error: "Este registro mudou enquanto você editava. Recarregue para ver a versão atual." },
      409,
    );

  const row = await env.DB.prepare(
    `SELECT * FROM ${colecao.tabela} WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  )
    .bind(id, TENANT_ID, access.ownerId)
    .first();
  const antes = colecao.daLinha(atual);
  const depois = colecao.daLinha(row);
  if (colecao === COLECOES.opportunities && deveCriarHandoff(atual.stage, row.stage))
    await criarHandoffOperacional(env, access, user, depois);
  if (colecao === COLECOES.opportunities && !texto(antes.clientId) && texto(depois.clientId))
    await aquecerContaPorOportunidade(env, access, user, depois.clientId);
  if (colecao === COLECOES.contracts)
    await registrarEventoContrato(env, access, user, id, "updated", antes, depois, texto(corpo.nota, 1000));
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "updated", resourceType: nomeDaColecao(colecao), resourceId: id,
    clientId: depois.clientId, before: antes, after: depois,
  });
  return json({ registro: depois });
};

const arquivar = async (env, colecao, access, user, id) => {
  if (!(await noAlcanceDaCarteira(env, colecao, access, user.email, id)))
    return json({ error: "Registro não encontrado." }, 404);
  const atual = await env.DB.prepare(
    `SELECT * FROM ${colecao.tabela}
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, access.ownerId).first();

  // Arquivar um lançamento de mês fechado mudaria um resultado já publicado.
  if (colecao === COLECOES.financial && atual) {
    const travado = await bloqueioDeCompetencia(env, access, colecao.daLinha(atual));
    if (travado) return json({ error: travado }, 409);
  }

  const agora = new Date().toISOString();
  // Arquiva em vez de apagar: o histórico é a única defesa quando alguém
  // pergunta, meses depois, de onde veio um número.
  const { meta } = await env.DB.prepare(
    `UPDATE ${colecao.tabela}
        SET archived_at = ?, updated_by = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  )
    .bind(agora, user.id, agora, id, TENANT_ID, access.ownerId)
    .run();
  if (!meta?.changes) return json({ error: "Registro não encontrado." }, 404);
  const antes = atual ? colecao.daLinha(atual) : {};
  if (colecao === COLECOES.contracts)
    await registrarEventoContrato(env, access, user, id, "archived", antes, {}, "Contrato arquivado.");
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "archived", resourceType: nomeDaColecao(colecao), resourceId: id,
    clientId: antes.clientId, before: antes,
  });
  return json({ ok: true });
};

const listarEventosOperacao = async (env, access, user, operationId) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.operations, access, user.email, operationId)))
    return json({ error: "Operação não encontrada." }, 404);
  const { results } = await env.DB.prepare(
    `SELECT id,kind,titulo,descricao,local,ocorrido_em,registrado_por,created_at
       FROM todogreen_client_operation_events
      WHERE tenant_id=? AND workspace_owner_id=? AND operation_id=?
      ORDER BY ocorrido_em DESC, created_at DESC LIMIT 300`,
  ).bind(TENANT_ID, access.ownerId, operationId).all();
  return json({
    eventos: (results || []).map((row) => ({
      id: row.id, tipo: row.kind, titulo: row.titulo, descricao: row.descricao,
      local: row.local, ocorridoEm: row.ocorrido_em, registradoPor: row.registrado_por,
      criadoEm: row.created_at,
    })),
  });
};

// ===== Jurídico como fluxo: o vai-e-volta do documento =====
// Quem é "o Jurídico" (valida/reprova/pede ajuste): owner/admin ou quem tem
// compliance:manage. Os demais com proposal:manage submetem e comentam.
const ehJuridico = (access) =>
  access.role === "owner" || access.role === "admin" ||
  access.permissions.includes("*") || access.permissions.includes("compliance:manage");

const documentoJuridicoNoEspaco = async (env, ownerId, legalId) =>
  env.DB.prepare(
    `SELECT id,status,revision,title FROM todogreen_legal_records
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(legalId, TENANT_ID, ownerId).first();

const listarEventosJuridicos = async (env, access, legalId) => {
  const doc = await documentoJuridicoNoEspaco(env, access.ownerId, legalId);
  if (!doc) return json({ error: "Documento jurídico não encontrado." }, 404);
  const { results } = await env.DB.prepare(
    `SELECT id,kind,message,attachment_url,attachment_name,from_status,to_status,actor_label,created_at
       FROM todogreen_legal_events
      WHERE tenant_id=? AND workspace_owner_id=? AND legal_id=?
      ORDER BY created_at ASC LIMIT 300`,
  ).bind(TENANT_ID, access.ownerId, legalId).all();
  return json({
    situacao: doc.status,
    eventos: (results || []).map((row) => ({
      id: row.id, tipo: row.kind, mensagem: row.message,
      anexoUrl: row.attachment_url, anexoNome: row.attachment_name,
      de: row.from_status, para: row.to_status, autor: row.actor_label, criadoEm: row.created_at,
    })),
  });
};

// Aplica uma ação do fluxo: valida (máquina de estados no domínio), grava o
// evento imutável e move a situação do documento na mesma ida ao banco.
const registrarEventoJuridico = async (env, access, user, legalId, corpo) => {
  const doc = await documentoJuridicoNoEspaco(env, access.ownerId, legalId);
  if (!doc) return json({ error: "Documento jurídico não encontrado." }, 404);
  const situacao = normalizarSituacaoJuridica(doc.status);
  const acaoId = texto(corpo.acao, 40);
  const mensagem = texto(corpo.mensagem, 4000);
  const anexoUrl = texto(corpo.anexoUrl, 2000);
  const anexoNome = texto(corpo.anexoNome, 240);
  const decisao = resolverAcaoJuridica(situacao, acaoId, {
    juridico: ehJuridico(access),
    temTexto: Boolean(mensagem),
    temAnexo: Boolean(anexoUrl),
  });
  if (!decisao.ok) return json({ error: decisao.erro }, 400);

  const agora = new Date().toISOString();
  const novaSituacao = decisao.para || situacao;
  const rotulo = texto(user.name || user.email, 200);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO todogreen_legal_events
         (id,tenant_id,workspace_owner_id,legal_id,kind,message,attachment_url,attachment_name,
          from_status,to_status,actor_user_id,actor_label,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(crypto.randomUUID(), TENANT_ID, access.ownerId, legalId, decisao.kind, mensagem,
      anexoUrl, anexoNome, situacao, novaSituacao, user.id, rotulo, agora),
    // Comentar não move a situação (para = null); as demais movem.
    ...(decisao.para
      ? [env.DB.prepare(
          `UPDATE todogreen_legal_records SET status=?,revision=revision+1,updated_at=?
            WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
        ).bind(novaSituacao, agora, legalId, TENANT_ID, access.ownerId)]
      : []),
  ]);
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "todogreen_juridico_evento", resourceType: "legal_record",
    resourceId: legalId, after: { acao: acaoId, de: situacao, para: novaSituacao },
  });
  return listarEventosJuridicos(env, access, legalId);
};

// O núcleo do evento operacional, compartilhado entre a tela interna e o
// portal do motorista: são o MESMO fato (a carga chegou, a entrega aconteceu,
// houve ocorrência) — duas implementações produziriam dois delivered_at e
// dois PODs diferentes. Quem chama já validou o alcance (carteira interna ou
// vínculo do motorista); aqui só se aplica.
// Devolve, no formato que aplicarEventoOperacional retorna, o evento já gravado
// com esta chave de idempotência — ou null se não existe. É como um reenvio da
// fila offline recebe de volta o que já foi registrado, sem duplicar.
const eventoPelaChave = async (env, ownerId, operationId, idempotencyKey) => {
  const linha = await env.DB.prepare(
    `SELECT * FROM todogreen_client_operation_events
      WHERE tenant_id = ? AND workspace_owner_id = ? AND operation_id = ? AND idempotency_key = ?`,
  ).bind(TENANT_ID, ownerId, operationId, idempotencyKey).first();
  if (!linha) return null;
  const atualizada = await env.DB.prepare(
    `SELECT * FROM todogreen_client_operations WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(operationId, TENANT_ID, ownerId).first();
  return {
    evento: {
      id: linha.id, tipo: linha.kind, titulo: linha.titulo, descricao: linha.descricao,
      local: linha.local, ocorridoEm: linha.ocorrido_em, registradoPor: linha.registrado_por, criadoEm: linha.created_at,
    },
    tipo: linha.kind, titulo: linha.titulo, descricao: linha.descricao, atualizada, duplicada: true,
  };
};

export const aplicarEventoOperacional = async (env, { ownerId, operacao, userId, corpo, origem = "" }) => {
  const tipos = new Set(["coleta", "transito", "chegada", "entrega", "ocorrencia", "reagendamento", "documento"]);
  const tipo = tipos.has(texto(corpo.tipo, 40)) ? texto(corpo.tipo, 40) : "transito";
  const titulo = texto(corpo.titulo, 200);
  const descricao = texto(corpo.descricao, 3000);
  if (!titulo && !descricao) return { erro: "Informe o título ou a descrição do evento." };
  const operationId = operacao.id;
  // Idempotência (#132): a fila offline do motorista reenvia com uma chave
  // estável por gesto. Se essa chave já entrou nesta operação, devolvemos o
  // evento que já existe — sem gravar de novo, sem POD duplicado, sem notificar
  // o cliente outra vez. O índice único (0094) fecha a corrida de dois reenvios.
  const idempotencyKey = texto(corpo.idempotencyKey, 100) || null;
  if (idempotencyKey) {
    const repetido = await eventoPelaChave(env, ownerId, operationId, idempotencyKey);
    if (repetido) return repetido;
  }
  const ocorridoEm = texto(corpo.ocorridoEm, 40) || new Date().toISOString();
  const agora = new Date().toISOString();
  const eventoId = crypto.randomUUID();
  const atualizacaoIncidente = tipo === "ocorrencia" ? ", incident_count = incident_count + 1" : "";
  // O evento "entrega" é o fato que fecha o ciclo: carimba delivered_at,
  // guarda o comprovante que o portal do cliente baixa e registra o POD que a
  // régua de faturamento exige (trigger da 0062). Antes, o evento era só uma
  // linha na timeline — a operação nunca "entregava" e a OS nunca faturava.
  const recebedor = tipo === "entrega" ? texto(corpo.recebedor, 200) : "";
  // Comprovante e assinatura da entrega: ou já vêm como URL (retrocompatível:
  // link colado, upload prévio), ou vêm como data URL de imagem capturada no
  // celular (câmera do canhoto, assinatura na tela — #120b). Nesse caso a imagem
  // é guardada no cofre AQUI e vira a URL de download. Só na entrega.
  let comprovanteUrl = tipo === "entrega" ? texto(corpo.comprovanteUrl, 800) : "";
  let comprovanteHash = tipo === "entrega" ? texto(corpo.comprovanteHash, 200) : "";
  let assinaturaUrl = tipo === "entrega" ? texto(corpo.assinaturaUrl, 800) : "";
  let assinaturaHash = tipo === "entrega" ? texto(corpo.assinaturaHash, 200) : "";
  // Ids das imagens guardadas no cofre — para limpar se o evento não entrar.
  const arquivosGuardados = [];
  if (tipo === "entrega") {
    try {
      if (!comprovanteUrl && corpo.comprovanteBase64) {
        const g = await armazenarImagemBase64(env, {
          ownerId, clientId: operacao.client_id, contextId: operationId,
          dataUrl: corpo.comprovanteBase64, createdBy: userId, prefixoNome: "comprovante",
        });
        comprovanteUrl = g.url; comprovanteHash = g.hash; arquivosGuardados.push(g.id);
      }
      if (!assinaturaUrl && corpo.assinaturaBase64) {
        const g = await armazenarImagemBase64(env, {
          ownerId, clientId: operacao.client_id, contextId: operationId,
          dataUrl: corpo.assinaturaBase64, createdBy: userId, prefixoNome: "assinatura",
        });
        assinaturaUrl = g.url; assinaturaHash = g.hash; arquivosGuardados.push(g.id);
      }
    } catch (erroImagem) {
      // Imagem inválida ou grande demais: recusa clara (vira 400 no chamador),
      // não grava a entrega pela metade. O front sempre reduz e valida a imagem
      // antes de mandar — isto é a defesa do servidor.
      return { erro: erroImagem?.message || "Comprovante inválido." };
    }
  }
  const atualizacaoEntrega = tipo === "entrega"
    ? `, delivered_at = COALESCE(delivered_at, ?)${comprovanteUrl ? ", proof_url = ?, proof_hash = ?" : ""}${assinaturaUrl ? ", signature_url = ?, signature_hash = ?" : ""}`
    : "";
  const paramsEntrega = tipo === "entrega"
    ? [ocorridoEm, ...(comprovanteUrl ? [comprovanteUrl, comprovanteHash] : []), ...(assinaturaUrl ? [assinaturaUrl, assinaturaHash] : [])]
    : [];
  const instrucoes = [
    env.DB.prepare(
      `INSERT INTO todogreen_client_operation_events
         (id,tenant_id,operation_id,client_id,workspace_owner_id,kind,titulo,descricao,local,
          ocorrido_em,registrado_por,created_at,idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      eventoId, TENANT_ID, operationId, operacao.client_id, ownerId, tipo, titulo,
      descricao, texto(corpo.local, 300), ocorridoEm, userId, agora, idempotencyKey,
    ),
    env.DB.prepare(
      `UPDATE todogreen_client_operations
          SET updated_at=?, updated_by=?, revision=revision+1${atualizacaoIncidente}${atualizacaoEntrega}
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
    ).bind(agora, userId, ...paramsEntrega, operationId, TENANT_ID, ownerId),
  ];
  if (tipo === "entrega") {
    // POD para toda OS amarrada a esta operação. INSERT direto com subselect:
    // se não houver OS vinculada, nada acontece; se houver, o gate de
    // faturamento passa a enxergar o comprovante.
    const latitude = Number(corpo.latitude);
    const longitude = Number(corpo.longitude);
    instrucoes.push(env.DB.prepare(
      `INSERT INTO todogreen_proofs_of_delivery
         (id, tenant_id, workspace_owner_id, service_order_id, kind, occurred_at,
          recipient_name, document_url, document_hash, latitude, longitude,
          signature_url, signature_hash, fields_json, created_by, created_at)
       SELECT lower(hex(randomblob(16))), os.tenant_id, os.workspace_owner_id, os.id, 'delivery', ?,
              ?, ?, ?, ?, ?, ?, ?, json_object('operationId', ?, 'eventId', ?), ?, ?
         FROM todogreen_service_orders os
        WHERE os.tenant_id = ? AND os.workspace_owner_id = ? AND os.operation_id = ?
          AND os.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM todogreen_proofs_of_delivery p
             WHERE p.tenant_id = os.tenant_id AND p.workspace_owner_id = os.workspace_owner_id
               AND p.service_order_id = os.id
          )`,
    ).bind(
      ocorridoEm, recebedor, comprovanteUrl, comprovanteHash,
      Number.isFinite(latitude) ? latitude : null, Number.isFinite(longitude) ? longitude : null,
      assinaturaUrl || null, assinaturaHash || null,
      operationId, eventoId, userId, agora,
      TENANT_ID, ownerId, operationId,
    ));
  }
  try {
    await env.DB.batch(instrucoes);
  } catch (erro) {
    // O evento não entrou: as imagens guardadas antes dele ficariam órfãs no
    // cofre (sem proof_url/signature_url apontando para elas). Limpa-as. Vale
    // tanto para a corrida do idempotente quanto para qualquer falha do batch.
    if (arquivosGuardados.length) await descartarArquivos(env, ownerId, arquivosGuardados).catch(() => {});
    // Corrida: dois reenvios com a mesma chave chegaram juntos e o outro gravou
    // primeiro. O índice único (0094) barra o segundo — aqui devolvemos o que já
    // ficou, em vez de estourar um erro numa entrega que na verdade foi gravada.
    if (idempotencyKey) {
      const repetido = await eventoPelaChave(env, ownerId, operationId, idempotencyKey);
      if (repetido) return repetido;
    }
    throw erro;
  }
  const atualizada = await env.DB.prepare(
    `SELECT * FROM todogreen_client_operations
      WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(operationId, TENANT_ID, ownerId).first();
  const evento = { id: eventoId, tipo, titulo, descricao, local: texto(corpo.local, 300), ocorridoEm, registradoPor: userId, criadoEm: agora };
  // Entrega e ocorrência são os dois eventos que o embarcador quer saber na
  // hora — os demais ele acompanha pela linha do tempo quando quiser.
  if (tipo === "entrega" || tipo === "ocorrencia") {
    await notificarPortalDoCliente(env, operacao.client_id, {
      assunto: tipo === "entrega"
        ? `Entrega concluída — ${operacao.reference || "operação"}`
        : `Ocorrência registrada — ${operacao.reference || "operação"}`,
      titulo: tipo === "entrega" ? "Sua carga foi entregue" : "Registramos uma ocorrência",
      corpo: `${operacao.reference || "A operação"}: ${titulo || descricao || tipo}. Detalhes e comprovante na linha do tempo do portal.`,
      origem,
    });
  }
  return { evento, tipo, titulo, descricao, atualizada };
};

const registrarEventoOperacao = async (env, access, user, operationId, corpo, origem = "") => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.operations, access, user.email, operationId)))
    return json({ error: "Operação não encontrada." }, 404);
  const operacao = await env.DB.prepare(
    `SELECT * FROM todogreen_client_operations
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(operationId, TENANT_ID, access.ownerId).first();
  const resultado = await aplicarEventoOperacional(env, {
    ownerId: access.ownerId, operacao, userId: user.id, corpo, origem,
  });
  if (resultado.erro) return json({ error: resultado.erro }, 400);
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "event_added", resourceType: "operations", resourceId: operationId,
    clientId: operacao.client_id, before: COLECOES.operations.daLinha(operacao),
    after: COLECOES.operations.daLinha(resultado.atualizada),
    details: `${resultado.tipo}: ${resultado.titulo || resultado.descricao}`,
  });
  return json({ evento: resultado.evento, registro: COLECOES.operations.daLinha(resultado.atualizada) }, 201);
};

const listarPagamentos = async (env, access, user, entryId) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.financial, access, user.email, entryId)))
    return json({ error: "Lançamento não encontrado." }, 404);
  const { results } = await env.DB.prepare(
    `SELECT id,amount,paid_at,payment_method,reference,notes,created_by,created_at
       FROM todogreen_financial_payments
      WHERE tenant_id=? AND workspace_owner_id=? AND entry_id=?
      ORDER BY paid_at DESC, created_at DESC LIMIT 300`,
  ).bind(TENANT_ID, access.ownerId, entryId).all();
  return json({
    pagamentos: (results || []).map((row) => ({
      id: row.id, valor: row.amount, pagoEm: row.paid_at, meioPagamento: row.payment_method,
      referencia: row.reference, observacoes: row.notes, criadoPor: row.created_by, criadoEm: row.created_at,
    })),
  });
};

const registrarPagamento = async (env, access, user, entryId, corpo) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.financial, access, user.email, entryId)))
    return json({ error: "Lançamento não encontrado." }, 404);
  const lancamento = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(entryId, TENANT_ID, access.ownerId).first();
  // Recebível que nasceu de um título faturado (ponte 0069, id 'entry-<titleId>')
  // tem baixa SÓ pela via do título (Faturamento › Títulos): dar baixa aqui no
  // razão não reduziria o open_amount do título e abriria dupla baixa do mesmo
  // recebível. Receita avulsa (sem título) segue baixável normalmente aqui.
  if (typeof entryId === "string" && entryId.startsWith("entry-") && lancamento?.kind === "revenue") {
    const titulo = await env.DB.prepare(
      "SELECT status FROM todogreen_financial_titles WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL",
    ).bind(entryId.slice(6), TENANT_ID, access.ownerId).first();
    if (titulo && ["open", "partial", "overdue"].includes(titulo.status))
      return json({ error: "Este recebível vem de um título faturado. Dê a baixa em Faturamento › Títulos; o razão é atualizado sozinho." }, 409);
  }
  const revisao = Number(corpo.revision);
  if (!Number.isFinite(revisao) || revisao !== Number(lancamento.revision))
    return json({ error: "O lançamento mudou. Recarregue antes de registrar a baixa." }, 409);
  if (lancamento.invoice_status === "cancelled")
    return json({ error: "Um lançamento cancelado não pode receber baixa." }, 409);
  const valor = numero(corpo.valor);
  const restante = Math.max(0, numero(lancamento.amount) - numero(lancamento.paid_amount));
  if (valor <= 0) return json({ error: "Informe um valor de baixa maior que zero." }, 400);
  if (valor > restante + 0.0001)
    return json({ error: `A baixa supera o saldo aberto de ${restante.toFixed(2)}.` }, 409);
  const pagoEm = texto(corpo.pagoEm, 40) || new Date().toISOString();
  const novoPago = numero(lancamento.paid_amount) + valor;
  const novoStatus = novoPago >= numero(lancamento.amount) - 0.0001 ? "paid" : "partial";
  const agora = new Date().toISOString();
  const pagamentoId = crypto.randomUUID();
  const [updateResult, insertResult] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE todogreen_financial_entries
          SET paid_amount=?, paid_at=?, payment_method=?, invoice_status=?, revision=revision+1,
              updated_by=?, updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=? AND archived_at IS NULL`,
    ).bind(
      novoPago, novoStatus === "paid" ? pagoEm : lancamento.paid_at,
      texto(corpo.meioPagamento, 80), novoStatus, user.id, agora,
      entryId, TENANT_ID, access.ownerId, revisao,
    ),
    env.DB.prepare(
      `INSERT INTO todogreen_financial_payments
         (id,tenant_id,workspace_owner_id,entry_id,amount,paid_at,payment_method,reference,notes,created_by,created_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?
        WHERE EXISTS (
          SELECT 1 FROM todogreen_financial_entries
           WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND revision=?
        )`,
    ).bind(
      pagamentoId, TENANT_ID, access.ownerId, entryId, valor, pagoEm,
      texto(corpo.meioPagamento, 80), texto(corpo.referencia, 160), texto(corpo.observacoes, 1000),
      user.id, agora, entryId, TENANT_ID, access.ownerId, revisao + 1,
    ),
  ]);
  if (!updateResult?.meta?.changes || !insertResult?.meta?.changes)
    return json({ error: "O lançamento mudou. Recarregue antes de registrar a baixa." }, 409);
  const atualizada = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries
      WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(entryId, TENANT_ID, access.ownerId).first();
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "payment_added", resourceType: "financial", resourceId: entryId,
    clientId: lancamento.client_id, before: COLECOES.financial.daLinha(lancamento),
    after: COLECOES.financial.daLinha(atualizada), details: `Baixa ${pagamentoId}`,
  });
  return json({
    pagamento: {
      id: pagamentoId, valor, pagoEm, meioPagamento: texto(corpo.meioPagamento, 80),
      referencia: texto(corpo.referencia, 160), observacoes: texto(corpo.observacoes, 1000),
    },
    registro: COLECOES.financial.daLinha(atualizada),
  }, 201);
};

// Estornar uma baixa. O razão é imutável: não se apaga o pagamento, lança-se um
// compensatório negativo que referencia o original e reabre o saldo. É como se
// ajusta um lançamento sem corromper o histórico — a mesma filosofia do estoque
// e do deal desk. Estornar duas vezes o mesmo pagamento é recusado.
//
// Sobre o fechamento de competência: o estorno NÃO chama `bloqueioDeCompetencia`,
// de propósito e em paridade com `registrarPagamento` — a baixa também não chama.
// A trava congela a competência (o accrual, o valor reconhecido no resultado),
// não o lado caixa. Pagar um título cuja competência já fechou é rotina; poder
// pagar mas não poder estornar seria a assimetria errada. O `amount` do
// lançamento (o que a trava protege) não é tocado aqui — só `paid_amount`/status.
const estornarPagamento = async (env, access, user, entryId, paymentId) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.financial, access, user.email, entryId)))
    return json({ error: "Lançamento não encontrado." }, 404);
  const pagamento = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_payments
      WHERE id=? AND entry_id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(paymentId, entryId, TENANT_ID, access.ownerId).first();
  if (!pagamento) return json({ error: "Baixa não encontrada." }, 404);
  if (numero(pagamento.amount) < 0)
    return json({ error: "Este lançamento já é um estorno." }, 409);
  const jaEstornado = await env.DB.prepare(
    `SELECT 1 FROM todogreen_financial_payments
      WHERE entry_id=? AND tenant_id=? AND workspace_owner_id=? AND reference=?`,
  ).bind(entryId, TENANT_ID, access.ownerId, `estorno:${paymentId}`).first();
  if (jaEstornado) return json({ error: "Esta baixa já foi estornada." }, 409);

  const lancamento = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(entryId, TENANT_ID, access.ownerId).first();
  if (!lancamento) return json({ error: "Lançamento não encontrado." }, 404);

  const valor = numero(pagamento.amount);
  const novoPago = Math.max(0, numero(lancamento.paid_amount) - valor);
  const novoStatus = novoPago <= 0.0001 ? "pending" : "partial";
  const agora = new Date().toISOString();
  const estornoId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE todogreen_financial_entries
          SET paid_amount=?, invoice_status=?, revision=revision+1, updated_by=?, updated_at=?
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
    ).bind(novoPago, novoStatus, user.id, agora, entryId, TENANT_ID, access.ownerId),
    env.DB.prepare(
      `INSERT INTO todogreen_financial_payments
         (id,tenant_id,workspace_owner_id,entry_id,amount,paid_at,payment_method,reference,notes,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      estornoId, TENANT_ID, access.ownerId, entryId, -valor, agora,
      pagamento.payment_method || "", `estorno:${paymentId}`,
      `Estorno da baixa ${paymentId}`, user.id, agora,
    ),
  ]);
  const atualizada = await env.DB.prepare(
    `SELECT * FROM todogreen_financial_entries WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(entryId, TENANT_ID, access.ownerId).first();
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "payment_reversed", resourceType: "financial", resourceId: entryId,
    clientId: lancamento.client_id, before: COLECOES.financial.daLinha(lancamento),
    after: COLECOES.financial.daLinha(atualizada), details: `Estorno ${estornoId} da baixa ${paymentId}`,
  });
  return json({ estorno: { id: estornoId, valor: -valor, referencia: `estorno:${paymentId}` }, registro: COLECOES.financial.daLinha(atualizada) }, 201);
};

const listarEventosContrato = async (env, access, user, contractId) => {
  if (!(await noAlcanceDaCarteira(env, COLECOES.contracts, access, user.email, contractId)))
    return json({ error: "Contrato não encontrado." }, 404);
  const { results } = await env.DB.prepare(
    `SELECT id,action,before_json,after_json,note,actor_user_id,created_at
       FROM todogreen_contract_events
      WHERE tenant_id=? AND workspace_owner_id=? AND contract_id=?
      ORDER BY created_at DESC LIMIT 300`,
  ).bind(TENANT_ID, access.ownerId, contractId).all();
  return json({
    eventos: (results || []).map((row) => ({
      id: row.id, acao: row.action, antes: parse(row.before_json, {}), depois: parse(row.after_json, {}),
      nota: row.note, atorId: row.actor_user_id, criadoEm: row.created_at,
    })),
  });
};

export async function handleTodoGreenVerticalRecords(request, env, access, user) {
  const url = new URL(request.url);
  const partes = url.pathname.split("/").filter(Boolean); // api, todogreen, records, [colecao], [id]
  const nome = partes[3] || "";
  const id = texto(partes[4], 120);
  const subrecurso = texto(partes[5], 80);
  const subId = texto(partes[6], 120);

  // Sem coleção na URL: a vertical inteira de uma vez, sem filtro nem
  // página — é a carga do painel, que precisa do total para somar, não de um
  // recorte dele. Filtro e paginação são de quem abre UMA coleção por vez.
  if (!nome) {
    if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
    const nomes = Object.keys(COLECOES);
    const permitidas = nomes.filter((n) => podeLerColecao(access, COLECOES[n]));
    const [listas, cenarios] = await Promise.all([
      Promise.all(permitidas.map((n) => listar(env, COLECOES[n], access, user.email))),
      podeLerCenarios(access)
        ? listarCenarios(env, access, user.email)
        : Promise.resolve({ registros: [], total: 0 }),
    ]);
    const porNome = Object.fromEntries(permitidas.map((n, i) => [n, listas[i]]));
    const payload = {
      ...Object.fromEntries(nomes.map((n) => [n, porNome[n]?.registros || []])),
      scenarios: cenarios.registros,
    };
    if (url.searchParams.get("includeTotals") === "1" || request.headers.get("x-todogreen-include-totals") === "1") payload.totals = {
        ...Object.fromEntries(nomes.map((n) => [n, porNome[n]?.total || 0])),
        scenarios: cenarios.total,
      };
    return json(payload);
  }

  if (nome === "scenarios") {
    if (request.method === "GET") {
      if (!podeLerCenarios(access))
        return json({ error: "Seu papel não pode consultar simulações." }, 403);
      const { limit, offset } = paginacao(url);
      const clienteId = texto(url.searchParams.get("cliente"), 120);
      const resultado = await listarCenarios(env, access, user.email, { clienteId, limit, offset });
      return json({ ...resultado, limit, offset });
    }
    if (request.method === "POST") {
      if (!podeNaVertical(access, "pricing:simulate"))
        return json({ error: "Seu papel não pode salvar simulações." }, 403);
      return criarCenario(env, access, user, await request.json().catch(() => ({})));
    }
    return json({ error: "A simulação salva não muda. Faça outra simulação." }, 405);
  }

  const colecao = COLECOES[nome];
  if (!colecao) return json({ error: "Coleção desconhecida." }, 404);

  if (request.method === "GET" && !podeLerColecao(access, colecao))
    return json({ error: "Seu papel não pode consultar estes registros." }, 403);

  if (id && subrecurso === "events" && colecao === COLECOES.operations) {
    if (request.method === "GET") return listarEventosOperacao(env, access, user, id);
    if (request.method === "POST") {
      if (!podeNaVertical(access, colecao.permissao))
        return json({ error: "Seu papel não pode registrar eventos operacionais." }, 403);
      return registrarEventoOperacao(env, access, user, id, await request.json().catch(() => ({})), new URL(request.url).origin);
    }
    return json({ error: "Método não permitido." }, 405);
  }

  if (id && subrecurso === "payments" && colecao === COLECOES.financial) {
    if (request.method === "GET") return listarPagamentos(env, access, user, id);
    if (request.method === "POST") {
      if (!podeNaVertical(access, colecao.permissao))
        return json({ error: "Seu papel não pode registrar baixas." }, 403);
      return registrarPagamento(env, access, user, id, await request.json().catch(() => ({})));
    }
    // Estorno de uma baixa específica: DELETE .../payments/:paymentId — lança o
    // compensatório, não apaga o histórico.
    if (request.method === "DELETE" && subId) {
      if (!podeNaVertical(access, colecao.permissao))
        return json({ error: "Seu papel não pode estornar baixas." }, 403);
      return estornarPagamento(env, access, user, id, subId);
    }
    return json({ error: "Método não permitido." }, 405);
  }

  if (id && subrecurso === "events" && colecao === COLECOES.contracts) {
    if (request.method === "GET") return listarEventosContrato(env, access, user, id);
    return json({ error: "O histórico contratual é gerado pelas alterações do contrato." }, 405);
  }

  // Jurídico como fluxo: a linha do tempo do documento (submissão → análise →
  // validar/reprovar/pedir ajuste → reenvio → conclusão). A permissão de papel
  // (submeter vs. decidir) é resolvida dentro do handler pela máquina de estados.
  if (id && subrecurso === "events" && colecao === COLECOES.legal) {
    if (request.method === "GET") return listarEventosJuridicos(env, access, id);
    if (request.method === "POST") {
      if (!podeNaVertical(access, colecao.permissao))
        return json({ error: "Seu papel não pode atuar no fluxo jurídico." }, 403);
      return registrarEventoJuridico(env, access, user, id, await request.json().catch(() => ({})));
    }
    return json({ error: "Método não permitido." }, 405);
  }

  if (request.method === "GET") {
    const { limit, offset } = paginacao(url);
    const clienteId = texto(url.searchParams.get("cliente"), 120);
    const resultado = await listar(env, colecao, access, user.email, { clienteId, limit, offset });
    return json({ ...resultado, limit, offset });
  }

  // Leitura segue o vínculo; escrita exige permissão. Papel que só consulta
  // não altera premissa comercial.
  if (!podeNaVertical(access, colecao.permissao))
    return json({ error: "Seu papel não pode alterar estes registros." }, 403);

  const corpo = request.method === "DELETE" ? {} : await request.json().catch(() => ({}));

  if (request.method === "POST" && !id) return criar(env, colecao, access, user, corpo, user.email);
  if (request.method === "PATCH" && id) return atualizar(env, colecao, access, user, id, corpo, user.email);
  if (request.method === "DELETE" && id) return arquivar(env, colecao, access, user, id);
  return json({ error: "Método não permitido." }, 405);
}
