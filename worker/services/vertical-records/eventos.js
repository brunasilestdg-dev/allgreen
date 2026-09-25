// ===== Registros da vertical: linhas do tempo =====
//
// Contrato: o histórico de cada registro, sempre depois de confirmar o
// alcance (espaço + carteira; fora dele é 404). Tudo devolve Response, menos
// `registrarEventoContrato`, que a esteira de CRUD chama a cada alteração.
// - Operação: `listarEventosOperacao` e `registrarEventoOperacao` — a porta
//   interna do ledger: confere a carteira e audita; o efeito do fato é de
//   `aplicarEventoOperacional` (./ledger-operacional.js).
// - Contrato: `registrarEventoContrato` e `listarEventosContrato` — o histórico
//   nasce das alterações do contrato, não de POST.
// - Jurídico: `listarEventosJuridicos` e `registrarEventoJuridico`; quem pode
//   decidir (validar, reprovar, pedir ajuste) sai da máquina de estados do
//   domínio a partir de `ehJuridico(access)`.

import { TENANT_ID } from "../todogreen-access.js";
import {
  normalizarSituacaoJuridica,
  resolverAcaoJuridica,
} from "../../../src/features/logistics/legalDomain.js";
import { registrarAuditoriaTodoGreen } from "../todogreen-governance.js";
import { noAlcanceDaCarteira } from "./acesso.js";
import { COLECOES } from "./colecoes/index.js";
import { aplicarEventoOperacional } from "./ledger-operacional.js";
import { json, parse, texto } from "./util.js";

export const registrarEventoContrato = async (env, access, user, contractId, action, before, after, note = "") => {
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

export const listarEventosOperacao = async (env, access, user, operationId) => {
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

export const listarEventosJuridicos = async (env, access, legalId) => {
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
export const registrarEventoJuridico = async (env, access, user, legalId, corpo) => {
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

export const registrarEventoOperacao = async (env, access, user, operationId, corpo, origem = "") => {
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

export const listarEventosContrato = async (env, access, user, contractId) => {
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
