// ===== Registros da vertical: simulações de preço =====
//
// Contrato: `listarCenarios(env, access, email, filtros)` devolve
// { registros, total } já com o recorte de carteira; `criarCenario(env, access,
// user, corpo)` devolve a Response (201 ou 400) e audita. A simulação é
// imutável: não existe atualizar nem arquivar (o roteador responde 405).
// Autorização: o roteador confere `pricing:simulate` para gravar e
// `podeLerCenarios` para ler; o espaço é sempre o do vínculo.

import { TENANT_ID, recorteDeCarteira } from "../todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "../todogreen-governance.js";
import { json, objeto, parse, texto } from "./util.js";

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

export const listarCenarios = async (env, access, email, { clienteId = "", limit = 200, offset = 0 } = {}) => {
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

export const criarCenario = async (env, access, user, corpo) => {
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
