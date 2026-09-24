// ===== Clientes: API interna, carteira e envio de e-mail =====
//
// Contrato: o lado INTERNO da conta do cliente — nada daqui é portal.
// - `handleTodoGreenClients`: lista, cria, importa, edita (com `revision`) e
//   arquiva clientes; lista, libera e remove quem entra no portal de cada um.
// - `handleTodoGreenClientAssignments`: a carteira (cliente × vendedor).
// - `handleTodoGreenSendEmail`: envia e-mail e salva o contato no CRM.
// Entradas: (request, env, access, user) já autenticados pelo roteador
// (`internalReadAccess`); saída: Response. Autorização: o espaço é sempre o do
// vínculo (`access.ownerId`); quem não vê a carteira inteira só alcança os
// clientes atribuídos a ele (404 fora dela) — e é esse alcance que vale para
// editar (PATCH com `revision`, inclusive ligar/desligar o portal) e para o
// envio de e-mail. Excluir cliente e ver, liberar ou remover quem entra no
// portal exigem owner/admin ou clients:manage/clients:assign; criar e
// importar aceitam também crm:manage; a carteira em si exige clients:assign.
// Os campos do CRM são normalizados por `crm-fields.js` antes de gravar.

import { emailEnabled, escMail, sendEmail } from "../mensageria/envio.js";
import {
  isValidEmail,
  normalizeEmail,
  permissionsForRole,
  clientPortalRole,
} from "../../src/features/logistics/customerPortalDomain.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import { podeVerTodaCarteira } from "./todogreen-access.js";
import { crmFields, mergeImportedCrm } from "./crm-fields.js";
import { TENANT_ID, clean, parse, response } from "./todogreen-client-helpers.js";

const accountCode = (id) => `TDG-${clean(id, 60).replace(/[^a-z0-9]/gi, "").slice(0, 12).toUpperCase()}`;

// ----- Administração do portal, do lado interno -----
//
// Fica aqui porque compartilha as tabelas, mas exige acesso interno de gestão:
// é a To Do Green cadastrando clientes e liberando quem entra em cada sala.
export async function handleTodoGreenClients(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  const url = new URL(request.url);
  const agora = new Date().toISOString();
  const podeGerenciar = ["owner", "admin"].includes(access?.role) ||
    access?.permissions?.includes("*") ||
    access?.permissions?.includes("clients:manage") ||
    access?.permissions?.includes("clients:assign");
  const podeCriar = podeGerenciar || access?.permissions?.includes("*") || access?.permissions?.includes("crm:manage");
  const podeVerTodos = podeVerTodaCarteira(access);
  const emailSessao = normalizeEmail(user?.email);
  const clientIdDaRota = clean(url.pathname.split("/").filter(Boolean)[3], 60);
  const subRotaDoCliente = clean(url.pathname.split("/").filter(Boolean)[4], 40);

  // Quem tem acesso ao portal deste cliente. Sem esta lista na tela, liberar
  // acesso era cego: o PUT existia e ninguém via quem já estava dentro.
  if (request.method === "GET" && clientIdDaRota && subRotaDoCliente === "portal-usuarios") {
    if (!podeGerenciar)
      return response({ error: "Somente uma pessoa autorizada vê os usuários do portal." }, 403);
    const cliente = await env.DB.prepare(
      "SELECT id FROM todogreen_clients WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL",
    ).bind(TENANT_ID, access.ownerId, clientIdDaRota).first();
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);
    const { results } = await env.DB.prepare(
      `SELECT email, role, status, note, created_at, updated_at
         FROM todogreen_client_users
        WHERE tenant_id = ? AND client_id = ?
        ORDER BY created_at`,
    ).bind(TENANT_ID, clientIdDaRota).all();
    return response({
      usuarios: (results || []).map((linha) => ({
        email: linha.email, papel: linha.role, status: linha.status,
        observacao: linha.note, criadoEm: linha.created_at, atualizadoEm: linha.updated_at,
      })),
    });
  }

  if (request.method === "GET") {
    const linhas = await env.DB.prepare(
      `SELECT c.id, c.account_code, c.name, c.legal_name, c.document, c.segment, c.status, c.portal_enabled,
              c.notes, c.fields_json, c.revision, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM todogreen_client_users v
                WHERE v.client_id = c.id AND v.status = 'active') AS pessoas
         FROM todogreen_clients c
        WHERE c.tenant_id = ? AND c.workspace_owner_id = ? AND c.archived_at IS NULL
          AND (? = 1 OR EXISTS (
            SELECT 1 FROM todogreen_client_assignments a
             WHERE a.tenant_id = c.tenant_id AND a.client_id = c.id
               AND a.status = 'active' AND lower(a.seller_email) = ?
          ))
        ORDER BY c.name`,
    )
      .bind(TENANT_ID, access.ownerId, podeVerTodos ? 1 : 0, emailSessao)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    const ids = (linhas.results || []).map((item) => item.id);
    let atribuicoes = [];
    if (ids.length) {
      const resultado = await env.DB.prepare(
        `SELECT a.client_id, a.seller_email, a.note, a.updated_at
           FROM todogreen_client_assignments a
           JOIN todogreen_clients c
             ON c.tenant_id=a.tenant_id AND c.id=a.client_id
          WHERE a.tenant_id=? AND a.status='active' AND c.workspace_owner_id=?
            AND c.archived_at IS NULL
            AND (?=1 OR lower(a.seller_email)=?)
          ORDER BY a.seller_email`,
      ).bind(TENANT_ID, access.ownerId, podeVerTodos ? 1 : 0, emailSessao).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
      atribuicoes = resultado.results || [];
    }
    return response({
      clientes: (linhas.results || []).map((cliente) => ({
        id: cliente.id,
        accountCode: cliente.account_code || accountCode(cliente.id),
        name: cliente.name,
        legalName: cliente.legal_name,
        document: cliente.document,
        segment: cliente.segment,
        status: cliente.status,
        portalEnabled: cliente.portal_enabled === 1,
        portalUserCount: Number(cliente.pessoas || 0),
        notes: cliente.notes,
        revision: cliente.revision,
        createdAt: cliente.created_at,
        updatedAt: cliente.updated_at,
        crm: crmFields(parse(cliente.fields_json, {}), cliente.name),
        vendedores: atribuicoes
          .filter((item) => item.client_id === cliente.id)
          .map((item) => ({ email: item.seller_email, observacao: item.note, atualizadoEm: item.updated_at })),
      })),
      acesso: { podeGerenciar, podeEditar: true, podeCriar, somenteCarteira: !podeVerTodos, vendedor: emailSessao },
    });
  }

  if (request.method === "DELETE" && clientIdDaRota) {
    if (!podeGerenciar)
      return response({ error: "Somente uma pessoa autorizada pode excluir clientes." }, 403);
    const cliente = await env.DB.prepare(
      "SELECT id, name FROM todogreen_clients WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL",
    ).bind(TENANT_ID, access.ownerId, clientIdDaRota).first();
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);

    const [oportunidades, contratos, operacoes] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total FROM todogreen_opportunities WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND archived_at IS NULL").bind(TENANT_ID, access.ownerId, clientIdDaRota).first(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM todogreen_contracts WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND archived_at IS NULL").bind(TENANT_ID, access.ownerId, clientIdDaRota).first(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM todogreen_client_operations WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ?").bind(TENANT_ID, access.ownerId, clientIdDaRota).first(),
    ]);
    const vinculos = {
      oportunidades: Number(oportunidades?.total || 0),
      contratos: Number(contratos?.total || 0),
      operacoes: Number(operacoes?.total || 0),
    };
    if (Object.values(vinculos).some((total) => total > 0)) {
      const detalhes = [
        vinculos.oportunidades ? `${vinculos.oportunidades} oportunidade(s)` : "",
        vinculos.contratos ? `${vinculos.contratos} contrato(s)` : "",
        vinculos.operacoes ? `${vinculos.operacoes} operação(ões)` : "",
      ].filter(Boolean).join(", ");
      return response({
        error: `Não é possível excluir "${cliente.name}": existem ${detalhes} vinculados. Exclua ou mova esses registros antes de tentar novamente.`,
        vinculos,
      }, 409);
    }

    const { meta } = await env.DB.prepare(
      `UPDATE todogreen_clients
          SET archived_at = ?, revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL`,
    ).bind(agora, user.id, agora, TENANT_ID, access.ownerId, clientIdDaRota).run();
    if (!meta?.changes) return response({ error: "Cliente não encontrado." }, 404);
    await registrarAuditoriaTodoGreen(env, {
      access, user, action: "archived", resourceType: "client", resourceId: clientIdDaRota,
      clientId: clientIdDaRota, before: { name: cliente.name }, after: { archivedAt: agora },
    });
    return response({ ok: true, id: clientIdDaRota });
  }

  if (request.method === "PATCH" && clientIdDaRota) {
    const body = await request.json().catch(() => ({}));
    const atual = await env.DB.prepare(
      `SELECT c.* FROM todogreen_clients c
        WHERE c.id = ? AND c.tenant_id = ? AND c.workspace_owner_id = ? AND c.archived_at IS NULL
          AND (? = 1 OR EXISTS (
            SELECT 1 FROM todogreen_client_assignments a
             WHERE a.tenant_id = c.tenant_id AND a.client_id = c.id
               AND a.status = 'active' AND lower(a.seller_email) = ?
          ))`,
    ).bind(clientIdDaRota, TENANT_ID, access.ownerId, podeVerTodos ? 1 : 0, emailSessao).first();
    if (!atual) return response({ error: "Cliente não encontrado." }, 404);
    const revisao = Number(body.revision);
    if (!Number.isFinite(revisao) || revisao <= 0)
      return response({ error: "Informe a revisão do cliente que você leu." }, 400);
    const crm = crmFields({ ...parse(atual.fields_json, {}), ...(body.crm || {}) }, clean(body.name ?? atual.name, 200));
    // Liberar/bloquear o portal era impossível pela tela: o PATCH nem aceitava
    // o campo. Sem isso, cliente novo só entrava por migração de banco.
    const portalEnabled = body.portalEnabled === undefined
      ? atual.portal_enabled
      : (body.portalEnabled ? 1 : 0);
    const { meta } = await env.DB.prepare(
      `UPDATE todogreen_clients
          SET name = ?, legal_name = ?, document = ?, segment = ?, status = ?, notes = ?,
              portal_enabled = ?, fields_json = ?, revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND revision = ?`,
    ).bind(
      clean(body.name ?? atual.name, 200) || atual.name,
      clean(body.legalName ?? atual.legal_name, 200),
      clean(body.document ?? atual.document, 40),
      clean(body.segment ?? atual.segment, 80),
      clean(body.status ?? atual.status, 20) || "ativo",
      clean(body.notes ?? atual.notes, 1000),
      portalEnabled,
      JSON.stringify(crm), user.id, agora,
      clientIdDaRota, TENANT_ID, access.ownerId, revisao,
    ).run();
    if (!meta?.changes)
      return response({ error: "Este cliente mudou enquanto você editava. Recarregue e tente novamente." }, 409);
    await registrarAuditoriaTodoGreen(env, {
      access, user, action: "updated", resourceType: "client", resourceId: clientIdDaRota,
      clientId: clientIdDaRota,
      before: { name: atual.name, legalName: atual.legal_name, document: atual.document, segment: atual.segment, status: atual.status, notes: atual.notes, crm: parse(atual.fields_json, {}) },
      after: { name: clean(body.name ?? atual.name, 200), legalName: clean(body.legalName ?? atual.legal_name, 200), document: clean(body.document ?? atual.document, 40), segment: clean(body.segment ?? atual.segment, 80), status: clean(body.status ?? atual.status, 20), notes: clean(body.notes ?? atual.notes, 1000), crm },
    });
    return response({ ok: true, id: clientIdDaRota });
  }

  if (!podeCriar)
    return response({ error: "Seu papel não pode criar ou importar clientes." }, 403);

  if (request.method === "POST" && clientIdDaRota === "import") {
    const body = await request.json().catch(() => ({}));
    const clientes = Array.isArray(body.clientes) ? body.clientes : [];
    if (!clientes.length) return response({ error: "Envie ao menos um cliente para importar." }, 400);
    if (clientes.length > 100) return response({ error: "Importe no máximo 100 clientes por lote." }, 400);

    const preparados = clientes.map((item) => ({
      id: clean(item?.id, 60),
      nome: clean(item?.nome ?? item?.name, 200),
      razaoSocial: clean(item?.razaoSocial ?? item?.legalName, 200),
      documento: clean(item?.documento ?? item?.document, 40),
      segmento: clean(item?.segmento ?? item?.segment, 80),
      status: clean(item?.status, 20) || "ativo",
      observacoes: clean(item?.observacoes ?? item?.notes, 1000),
      crm: item?.crm || {},
    }));
    if (preparados.some((item) => !item.id || item.nome.length < 2))
      return response({ error: "Cada cliente precisa de identificador estável e nome válido." }, 400);

    const placeholders = preparados.map(() => "?").join(",");
    const existentes = preparados.length
      ? await env.DB.prepare(
          `SELECT id,fields_json FROM todogreen_clients
            WHERE tenant_id = ? AND workspace_owner_id = ? AND id IN (${placeholders})`,
        ).bind(TENANT_ID, access.ownerId || user.id, ...preparados.map((item) => item.id)).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }))
      : { results: [] };
    const crmExistente = new Map((existentes.results || []).map((item) => [item.id, parse(item.fields_json, {})]));
    for (const item of preparados)
      item.crm = mergeImportedCrm(crmExistente.get(item.id) || {}, item.crm, item.nome);

    for (let inicio = 0; inicio < preparados.length; inicio += 40) {
      const lote = preparados.slice(inicio, inicio + 40);
      const statements = [];
      for (const item of lote) {
        statements.push(env.DB.prepare(
          `INSERT INTO todogreen_clients
             (id, account_code, tenant_id, workspace_owner_id, name, legal_name, document, segment,
              status, portal_enabled, notes, fields_json, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             legal_name = excluded.legal_name,
             document = excluded.document,
             segment = excluded.segment,
             status = excluded.status,
             notes = excluded.notes,
             fields_json = excluded.fields_json,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at,
             archived_at = NULL,
             revision = todogreen_clients.revision + 1
           WHERE todogreen_clients.tenant_id = excluded.tenant_id
             AND todogreen_clients.workspace_owner_id = excluded.workspace_owner_id`,
        ).bind(
          item.id, accountCode(item.id), TENANT_ID, access.ownerId || user.id, item.nome, item.razaoSocial,
          item.documento, item.segmento, item.status, item.observacoes,
          JSON.stringify(item.crm), user.id, user.id, agora, agora,
        ));
        statements.push(env.DB.prepare(
          `INSERT INTO todogreen_client_assignments
             (id, tenant_id, client_id, seller_email, status, note, assigned_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
           ON CONFLICT(tenant_id, client_id, seller_email) DO UPDATE SET
             status = 'active', note = excluded.note, assigned_by = excluded.assigned_by,
             updated_at = excluded.updated_at`,
        ).bind(
          crypto.randomUUID(), TENANT_ID, item.id, emailSessao,
          "Importado e atribuído automaticamente à carteira da sessão.", user.id, agora, agora,
        ));
      }
      await env.DB.batch(statements);
    }
    await registrarAuditoriaTodoGreen(env, {
      access, user, action: "imported", resourceType: "client", details: `${preparados.length} cliente(s) importado(s).`,
      after: { ids: preparados.map((item) => item.id) },
    });
    return response({ ok: true, importados: preparados.length, vendedor: emailSessao }, 201);
  }

  if (request.method === "POST") {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }
    const nome = clean(body.nome ?? body.name, 200);
    if (nome.length < 2)
      return response({ error: "Informe o nome do cliente." }, 400);
    const id = clean(body.id, 60) || crypto.randomUUID();
    const existente = await env.DB.prepare(
      "SELECT workspace_owner_id FROM todogreen_clients WHERE id = ?",
    ).bind(id).first();
    if (existente && existente.workspace_owner_id !== access.ownerId)
      return response({ error: "Este identificador já pertence a outro espaço." }, 409);
    await env.DB.prepare(
      `INSERT INTO todogreen_clients
         (id, account_code, tenant_id, workspace_owner_id, name, legal_name, document, segment,
          status, portal_enabled, notes, fields_json, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         legal_name = excluded.legal_name,
         document = excluded.document,
         segment = excluded.segment,
         status = excluded.status,
         portal_enabled = excluded.portal_enabled,
         notes = excluded.notes,
         fields_json = excluded.fields_json,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at,
         revision = todogreen_clients.revision + 1
       WHERE todogreen_clients.tenant_id = excluded.tenant_id
         AND todogreen_clients.workspace_owner_id = excluded.workspace_owner_id`,
    )
      .bind(
        id,
        accountCode(id),
        TENANT_ID,
        access.ownerId || user.id,
        nome,
        clean(body.razaoSocial ?? body.legalName, 200),
        clean(body.documento ?? body.document, 40),
        clean(body.segmento ?? body.segment, 80),
        clean(body.status, 20) || "ativo",
        body.portalLiberado === true || body.portalEnabled === true ? 1 : 0,
        clean(body.observacoes ?? body.notes, 1000),
        JSON.stringify(crmFields(body.crm || {}, nome)),
        user.id,
        user.id,
        agora,
        agora,
      )
      .run();
    await registrarAuditoriaTodoGreen(env, {
      access, user, action: existente ? "updated" : "created", resourceType: "client",
      resourceId: id, clientId: id, after: { name: nome, legalName: clean(body.razaoSocial ?? body.legalName, 200), document: clean(body.documento ?? body.document, 40), segment: clean(body.segmento ?? body.segment, 80), status: clean(body.status, 20) || "ativo" },
    });
    return response({ ok: true, id, nome }, 201);
  }

  // Pessoas do cliente: quem, daquele cliente, entra na sala dele.
  if (request.method === "PUT") {
    if (!podeGerenciar)
      return response({ error: "Somente uma pessoa autorizada pode gerenciar usuários do portal." }, 403);
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }
    const clientId = clean(body.clienteId ?? body.clientId, 60);
    const email = normalizeEmail(body.email);
    if (!clientId) return response({ error: "Informe o cliente." }, 400);
    if (!isValidEmail(email))
      return response({ error: "Informe um e-mail válido." }, 400);

    const cliente = await env.DB.prepare(
      "SELECT id FROM todogreen_clients WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL",
    )
      .bind(TENANT_ID, access.ownerId, clientId)
      .first();
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);

    const papel = clientPortalRole(body.papel ?? body.role);
    await env.DB.prepare(
      `INSERT INTO todogreen_client_users
         (id, tenant_id, client_id, email, role, status, permissions_json, note,
          invited_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, client_id, email) DO UPDATE SET
         role = excluded.role,
         status = excluded.status,
         permissions_json = excluded.permissions_json,
         note = excluded.note,
         updated_at = excluded.updated_at`,
    )
      .bind(
        crypto.randomUUID(),
        TENANT_ID,
        clientId,
        email,
        papel,
        body.status === "inactive" ? "inactive" : "active",
        JSON.stringify(permissionsForRole(papel)),
        clean(body.observacao ?? body.note, 240),
        user.id,
        agora,
        agora,
      )
      .run();

    // Convite por e-mail: a pessoa entra no portal com uma conta comum do
    // produto, criada com este mesmo e-mail. Sem o convite, "liberar acesso"
    // era gravar uma linha que ninguém ficava sabendo. O envio nunca derruba a
    // liberação: sem BREVO_API_KEY, a tela mostra o aviso e o link é passado
    // por fora.
    let conviteEnviado = false;
    if (body.status !== "inactive" && emailEnabled(env) && body.enviarConvite !== false) {
      const nomeCliente = await env.DB.prepare(
        "SELECT name FROM todogreen_clients WHERE id = ? AND tenant_id = ?",
      ).bind(clientId, TENANT_ID).first();
      const linkPortal = `${url.origin}/portal-cliente`;
      const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1e1b35">
        <div style="background:#173d31;border-radius:14px;padding:20px;text-align:center">
          <span style="color:#fff;font-size:18px;font-weight:bold">To Do Green · Portal do Cliente</span>
        </div>
        <h2 style="margin:24px 0 8px">Seu acesso ao portal foi liberado</h2>
        <p style="color:#555;margin:0 0 18px">Você foi cadastrado como <strong>${escMail(papel)}</strong> no portal de <strong>${escMail(nomeCliente?.name || "sua empresa")}</strong>. Acompanhe entregas, comprovantes, indicadores e solicitações em um lugar só.</p>
        <p style="color:#555;margin:0 0 18px">Crie sua conta (ou entre) usando exatamente este e-mail: <strong>${escMail(email)}</strong>.</p>
        <div style="text-align:center;margin:22px 0">
          <a href="${linkPortal}" style="display:inline-block;background:#0b9f8f;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:bold">Abrir o portal</a>
        </div>
        <p style="color:#888;font-size:12px;margin:20px 0 0">Se você não esperava este acesso, ignore esta mensagem.</p>
      </div>`;
      conviteEnviado = await sendEmail(env, email, "Seu acesso ao Portal To Do Green", html)
        .then(() => true)
        .catch(() => false);
    }
    return response({ ok: true, email, papel, conviteEnviado, emailConfigurado: emailEnabled(env) });
  }

  if (request.method === "DELETE") {
    const email = normalizeEmail(url.searchParams.get("email"));
    const clientId = clean(url.searchParams.get("cliente") ?? url.searchParams.get("clientId"), 60);
    if (!email) return response({ error: "Informe o e-mail." }, 400);
    if (!clientId) return response({ error: "Informe de qual empresa remover o acesso." }, 400);
    const cliente = await env.DB.prepare(
      "SELECT id FROM todogreen_clients WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL",
    ).bind(TENANT_ID, access.ownerId, clientId).first();
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);
    await env.DB.prepare(
      "DELETE FROM todogreen_client_users WHERE tenant_id = ? AND client_id = ? AND email = ?",
    )
      .bind(TENANT_ID, clientId, email)
      .run();
    return response({ ok: true });
  }

  return response({ error: "Método não permitido." }, 405);
}

// Enviar e-mail para um contato — salvando-o automaticamente no CRM se ainda
// não existir (pedido da titular: "enviar e-mail pra contato não salvo, aí
// salva automático"). O contato mora no cliente selecionado (crm.contacts),
// que é o modelo que já existe — nada de segunda coleção de contatos. O envio
// reusa o mesmo canal transacional (Brevo) do resto do produto; sem a chave no
// cofre, a tela avisa em vez de falhar com erro de rede.
export async function handleTodoGreenSendEmail(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  if (request.method !== "POST") return response({ error: "Método não permitido." }, 405);
  let body = {};
  try { body = await request.json(); }
  catch { return response({ error: "Corpo JSON inválido." }, 400); }

  const to = normalizeEmail(body.to ?? body.para);
  const subject = clean(body.subject ?? body.assunto, 200);
  const texto = clean(body.body ?? body.mensagem ?? body.texto, 8000);
  const contactName = clean(body.contactName ?? body.contato, 160);
  const clientId = clean(body.clientId ?? body.clienteId, 60);
  if (!isValidEmail(to)) return response({ error: "Informe um e-mail de destino válido." }, 400);
  if (subject.length < 1) return response({ error: "Informe o assunto." }, 400);
  if (texto.length < 1) return response({ error: "Escreva a mensagem." }, 400);
  if (!emailEnabled(env))
    return response({ error: "O envio de e-mail ainda não está ligado neste ambiente (falta a credencial de e-mail no cofre)." }, 503);

  const podeVerTodos = podeVerTodaCarteira(access);
  const emailSessao = normalizeEmail(user?.email);

  // Auto-salvar o contato no cliente escolhido, respeitando a carteira: um
  // vendedor com carteira restrita só grava em clientes atribuídos a ele.
  let salvouContato = false;
  if (clientId) {
    const cliente = await env.DB.prepare(
      `SELECT c.id, c.name, c.fields_json
         FROM todogreen_clients c
        WHERE c.id = ? AND c.tenant_id = ? AND c.workspace_owner_id = ? AND c.archived_at IS NULL
          AND (? = 1 OR EXISTS (
            SELECT 1 FROM todogreen_client_assignments a
             WHERE a.tenant_id = c.tenant_id AND a.client_id = c.id
               AND a.status = 'active' AND lower(a.seller_email) = ?
          ))`,
    ).bind(clientId, TENANT_ID, access.ownerId, podeVerTodos ? 1 : 0, emailSessao).first();
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);
    const crmAtual = parse(cliente.fields_json, {});
    const contatos = Array.isArray(crmAtual.contacts) ? crmAtual.contacts : [];
    const jaExiste = contatos.some((c) => normalizeEmail(c?.email) === to);
    if (!jaExiste) {
      const novo = {
        id: crypto.randomUUID(),
        name: contactName || to.split("@")[0],
        email: to,
        relationshipRole: "Contato",
        source: "E-mail enviado pelo espaço",
      };
      const crmNovo = crmFields({ ...crmAtual, contacts: [...contatos, novo] }, cliente.name);
      await env.DB.prepare(
        `UPDATE todogreen_clients
            SET fields_json = ?, revision = revision + 1, updated_by = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
      ).bind(JSON.stringify(crmNovo), user.id, new Date().toISOString(), clientId, TENANT_ID, access.ownerId).run();
      salvouContato = true;
    }
  }

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1e2b27;white-space:pre-wrap">${escMail(texto)}</div>`;
  const enviado = await sendEmail(env, to, subject, html).then(() => true).catch(() => false);
  if (!enviado) return response({ error: "Não foi possível enviar o e-mail agora. Tente novamente." }, 502);

  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "email_sent", resourceType: "contact", resourceId: to,
    clientId: clientId || null, details: `E-mail "${subject}" enviado para ${to}.`,
  });
  return response({ ok: true, salvouContato });
}

export async function handleTodoGreenClientAssignments(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  const podeAtribuir = ["owner", "admin"].includes(access?.role) ||
    access?.permissions?.includes("*") ||
    access?.permissions?.includes("clients:assign");
  if (!podeAtribuir)
    return response({ error: "Você não pode definir carteiras comerciais." }, 403);

  const url = new URL(request.url);
  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT a.id, a.client_id AS clientId, c.name AS clientName,
              a.seller_email AS sellerEmail, a.note, a.status,
              a.created_at AS createdAt, a.updated_at AS updatedAt
         FROM todogreen_client_assignments a
         JOIN todogreen_clients c ON c.id = a.client_id AND c.tenant_id = a.tenant_id
        WHERE a.tenant_id = ? AND c.workspace_owner_id = ? AND a.status = 'active'
        ORDER BY c.name, a.seller_email`,
    ).bind(TENANT_ID, access.ownerId).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    return response({ atribuicoes: rows.results || [] });
  }

  if (request.method === "PUT") {
    const body = await request.json().catch(() => ({}));
    const clientId = clean(body.clientId ?? body.clienteId, 60);
    const sellerEmail = normalizeEmail(body.sellerEmail ?? body.vendedorEmail);
    if (!clientId) return response({ error: "Informe o cliente." }, 400);
    if (!isValidEmail(sellerEmail))
      return response({ error: "Informe o e-mail do vendedor." }, 400);
    const client = await env.DB.prepare(
      "SELECT id FROM todogreen_clients WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL",
    ).bind(TENANT_ID, access.ownerId, clientId).first();
    if (!client) return response({ error: "Cliente não encontrado." }, 404);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_client_assignments
         (id, tenant_id, client_id, seller_email, status, note, assigned_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
       ON CONFLICT(tenant_id, client_id, seller_email) DO UPDATE SET
         status = 'active', note = excluded.note, assigned_by = excluded.assigned_by,
         updated_at = excluded.updated_at`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, clientId, sellerEmail,
      clean(body.note ?? body.observacao, 240), user.id, now, now,
    ).run();
    return response({ ok: true, clientId, sellerEmail });
  }

  if (request.method === "DELETE") {
    const clientId = clean(url.searchParams.get("clientId"), 60);
    const sellerEmail = normalizeEmail(url.searchParams.get("sellerEmail"));
    if (!clientId || !sellerEmail)
      return response({ error: "Informe o cliente e o vendedor." }, 400);
    const client = await env.DB.prepare(
      "SELECT id FROM todogreen_clients WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL",
    ).bind(TENANT_ID, access.ownerId, clientId).first();
    if (!client) return response({ error: "Cliente não encontrado." }, 404);
    await env.DB.prepare(
      `UPDATE todogreen_client_assignments SET status = 'inactive', updated_at = ?
        WHERE tenant_id = ? AND client_id = ? AND lower(seller_email) = ?`,
    ).bind(new Date().toISOString(), TENANT_ID, clientId, sellerEmail).run();
    return response({ ok: true });
  }

  return response({ error: "Método não permitido." }, 405);
}
