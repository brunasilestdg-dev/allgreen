// ===== Registros da vertical: efeitos do ganho e do contato =====
//
// Contrato: o que a esteira de CRUD dispara DEPOIS de gravar uma oportunidade
// ou uma interação — handoff no Planner e implantação quando a oportunidade
// vira "Fechada ganha" (`deveCriarHandoff`), aquecimento da conta vinculada
// e carimbo da última interação. Entradas: (env, access, user, registro já
// gravado); saída: nada que vire resposta HTTP.
// Autorização: quem chama já passou pela permissão da coleção; o escopo é
// sempre o espaço do vínculo (`access.ownerId`), nunca o corpo. Tudo é
// idempotente (id derivado + INSERT OR IGNORE) ou cede à trava de `revision`:
// conveniência não briga com edição humana.

import { TENANT_ID } from "../todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "../todogreen-governance.js";
import { texto } from "./util.js";

const etapaGanha = (valor) => texto(valor, 80).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === "fechada ganha";
export const deveCriarHandoff = (anterior, proxima) => !etapaGanha(anterior) && etapaGanha(proxima);

export const criarHandoffOperacional = async (env, access, user, oportunidade) => {
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

// Ganhar a oportunidade abre a IMPLANTAÇÃO de verdade — a mesma que a tela
// /todogreen/implantacao (ClientActivationPage) lê em todogreen_implementation_projects.
// Sem isto, o negócio ganho caía só no quadro do Planner e a tela de Implantação
// ficava vazia: o fluxo comercial → operação não fechava, era preciso recriar a
// implantação à mão. Idempotente: o id é derivado da oportunidade e o INSERT é
// OR IGNORE, então remarcar "ganha" (ou ganhar de novo) nunca duplica. A tabela
// exige cliente; sem vínculo de conta a implantação não é criada (o card do
// Planner ainda registra o handoff), porque uma implantação sem cliente não teria
// onde ser trabalhada.
export const idDaImplantacaoDeGanho = (oportunidadeId) => `todogreen-impl-opp-${oportunidadeId}`;
export const criarImplantacaoDeGanho = async (env, access, user, oportunidade) => {
  const clientId = texto(oportunidade.clientId, 120);
  if (!clientId) return null;
  const agora = new Date().toISOString();
  const id = idDaImplantacaoDeGanho(oportunidade.id);
  const titulo = `Implantação — ${texto(oportunidade.cliente, 200) || "cliente"}`.slice(0, 240);
  const contractId = texto(oportunidade.contractId, 120);
  const fields = JSON.stringify({ source: "opportunity_won", opportunityId: oportunidade.id });
  const { meta } = await env.DB.prepare(
    `INSERT OR IGNORE INTO todogreen_implementation_projects
       (id,tenant_id,workspace_owner_id,client_id,contract_id,operation_id,title,status,
        owner_user_id,target_go_live_at,actual_go_live_at,
        scope_json,operating_model_json,capacity_json,integrations_json,billing_json,
        support_json,rasci_json,risks_json,fields_json,
        revision,created_by,updated_by,created_at,updated_at,archived_at)
     VALUES (?,?,?,?,?,'',?,'planning',NULL,NULL,NULL,
        '{}','{}','{}','{}','{}','{}','{}','[]',?,1,?,?,?,?,NULL)`,
  ).bind(id, TENANT_ID, access.ownerId, clientId, contractId, titulo, fields, user.id, user.id, agora, agora).run();
  if (meta?.changes) {
    await registrarAuditoriaTodoGreen(env, {
      access, user, action: "created", resourceType: "implementation-projects", resourceId: id,
      clientId,
      before: {},
      after: { title: titulo, status: "planning", source: "opportunity_won", opportunityId: oportunidade.id },
    });
  }
  return meta?.changes ? id : null;
};

// Oportunidade aberta é conversa viva: uma conta Fria (ou ainda sem
// classificação) que ganha oportunidade vinculada vira "Morno" sozinha —
// pedido da titular (30/08). A régua só esquenta: nunca rebaixa "Morno" ou
// "Quente" que a equipe classificou à mão. A escrita respeita a trava de
// revision do cliente; se alguém salvou a conta no meio, o aquecimento cede
// a vez em silêncio — é conveniência, não pode brigar com edição humana.
export const aquecerContaPorOportunidade = async (env, access, user, clientId) => {
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
export const carimbarUltimaInteracao = async (env, access, user, interacao) => {
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
