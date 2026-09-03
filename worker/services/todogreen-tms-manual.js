// ===== Cadastro manual no Portal TMS =====
//
// O Portal TMS nasceu API-first: carga entrava só por /api/tms/v1, com chave
// e escopo. Isso deixava quem está na tela sem jeito de abrir uma OS na mão —
// precisava gerar uma chave de API e chamar a API por fora do próprio painel
// que deveria servir pra isso. Este serviço é a mesma regra de negócio
// (criarPedidoTms, em todogreen-public-tms-api.js) exposta pela sessão
// interna, para o formulário do painel escrever direto.

import { TENANT_ID } from "./todogreen-access.js";
import {
  criarPedidoTms, activeContract, registrarPod, findShipmentByOwner, registrarTracking, EVENT_TYPES,
} from "./todogreen-public-tms-api.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

export async function handleTodoGreenTmsManual(request, env, access, user) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/todogreen/tms-manual")) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const recurso = parts[3] || "";
  const identificador = parts[4] || "";
  const acao = parts[5] || "";

  // Bipagem: o Track ID vem de um leitor físico (que só "digita" o código e
  // aperta Enter — funciona como teclado, sem integração nenhuma), da câmera
  // do celular (leitor de código de barras/QR no navegador) ou digitado à
  // mão. Os três caem na mesma rota: só muda como o texto chegou até aqui.
  if (request.method === "POST" && recurso === "scan") {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: "Corpo JSON inválido." }, 400);
    const trackId = text(body.trackId, 120);
    if (!trackId) return json({ error: "Nenhum código lido." }, 400);
    const eventType = text(body.eventType, 40).toUpperCase();
    if (!EVENT_TYPES.has(eventType)) return json({ error: "Selecione o tipo de evento antes de bipar." }, 400);

    const pacote = await env.DB.prepare(
      `SELECT * FROM todogreen_tms_packages WHERE tenant_id = ? AND workspace_owner_id = ? AND track_id = ?`,
    ).bind(TENANT_ID, access.ownerId, trackId).first();
    if (!pacote) return json({ error: `Track ID "${trackId}" não encontrado.` }, 404);

    const shipment = await findShipmentByOwner(env, access.ownerId, pacote.service_order_id);
    if (!shipment) return json({ error: "Carga vinculada a este volume não foi encontrada." }, 404);

    const resultado = await registrarTracking(env, {
      workspaceOwnerId: access.ownerId, shipment, source: "scan_portal_tms",
      createdBy: `interno:${user.id}`, body: { eventType, location: text(body.location, 240), notes: text(body.notes, 500) },
    });
    if (resultado.error) return json(resultado.error.payload, resultado.error.status);

    const statusPacote = eventType === "DELIVERED" ? "entregue" : eventType === "CANCELLED" ? "cancelado" : "em_transito";
    await env.DB.prepare(
      `UPDATE todogreen_tms_packages SET status = ?, updated_at = ? WHERE id = ?`,
    ).bind(statusPacote, new Date().toISOString(), pacote.id).run();

    return json({
      ...resultado.payload,
      pacote: { id: pacote.id, trackId: pacote.track_id, descricao: pacote.description, status: statusPacote },
      pedido: { id: shipment.id, numero: shipment.number },
    }, 201);
  }

  if (request.method === "POST" && recurso === "shipments" && identificador && acao === "pod") {
    const shipment = await findShipmentByOwner(env, access.ownerId, identificador);
    if (!shipment) return json({ error: "Carga não encontrada." }, 404);
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: "Corpo JSON inválido." }, 400);

    const resultado = await registrarPod(env, { workspaceOwnerId: access.ownerId, shipment, createdBy: `interno:${user.id}`, body });
    if (resultado.error) return json(resultado.error.payload, resultado.error.status);
    return json(resultado.payload, 201);
  }

  if (request.method === "GET" && recurso === "clients") {
    const rows = await env.DB.prepare(
      `SELECT id, name FROM todogreen_clients
        WHERE tenant_id = ? AND workspace_owner_id = ? AND status = 'ativo'
        ORDER BY name ASC LIMIT 300`,
    ).bind(TENANT_ID, access.ownerId).all();
    return json({ clientes: (rows.results || []).map((r) => ({ id: r.id, nome: r.name })) });
  }

  if (request.method === "GET" && recurso === "positions") {
    // Posição mais recente por veículo: junta a frota com a última operação
    // que carimbou coordenada (last_position_lat/lng, escrito pelo
    // rastreador). Um veículo sem operação recente simplesmente não aparece
    // no mapa — não inventamos posição.
    const rows = await env.DB.prepare(
      `SELECT v.id, v.prefix, v.plate, v.status,
              op.last_position_lat AS lat, op.last_position_lng AS lng,
              op.last_position_at AS atualizado_em, op.driver_name AS motorista
         FROM todogreen_fleet_vehicles v
         LEFT JOIN (
           SELECT vehicle_plate, last_position_lat, last_position_lng, last_position_at, driver_name,
                  ROW_NUMBER() OVER (PARTITION BY vehicle_plate ORDER BY last_position_at DESC) AS ordem
             FROM todogreen_client_operations
            WHERE workspace_owner_id = ? AND last_position_lat IS NOT NULL
         ) op ON op.vehicle_plate = v.plate AND op.ordem = 1
        WHERE v.tenant_id = ? AND v.workspace_owner_id = ? AND v.archived_at IS NULL
        LIMIT 300`,
    ).bind(access.ownerId, TENANT_ID, access.ownerId).all();

    const veiculos = (rows.results || [])
      .filter((r) => r.lat != null && r.lng != null)
      .map((r) => ({
        id: r.id, prefixo: r.prefix, placa: r.plate, status: r.status,
        lat: r.lat, lng: r.lng, atualizadoEm: r.atualizado_em || "", motorista: r.motorista || "",
      }));
    return json({ veiculos });
  }

  if (request.method === "GET" && recurso === "contracts") {
    const clientId = text(url.searchParams.get("clientId"), 120);
    if (!clientId) return json({ error: "Informe o cliente." }, 400);
    const rows = await env.DB.prepare(
      `SELECT id, title, monthly_value FROM todogreen_contracts
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND archived_at IS NULL
          AND status NOT IN ('cancelled','draft') AND approval_status = 'approved' AND signature_status = 'signed'
        ORDER BY updated_at DESC LIMIT 50`,
    ).bind(TENANT_ID, access.ownerId, clientId).all();
    return json({ contratos: (rows.results || []).map((r) => ({ id: r.id, titulo: r.title, valorMensal: r.monthly_value })) });
  }

  if (request.method === "POST" && recurso === "shipments") {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: "Corpo JSON inválido." }, 400);
    const clientId = text(body.clientId, 120);
    if (!clientId) return json({ error: "Selecione o cliente." }, 400);

    // Confirma que a operação escolhida existe e é do mesmo espaço antes de
    // gastar o resto da validação — mensagem melhor que o 409 genérico do
    // núcleo compartilhado quando o problema é digitação, não ausência de
    // contrato.
    const contrato = await activeContract(env, access.ownerId, clientId, text(body.contractId, 120));
    if (!contrato) return json({ error: "Este cliente não tem contrato aprovado e assinado." }, 409);

    const resultado = await criarPedidoTms(env, {
      workspaceOwnerId: access.ownerId,
      clientId,
      createdBy: `interno:${user.id}`,
      body: { ...body, source: "portal_tms_manual", numberPrefix: "OS-MAN" },
    });
    if (resultado.error) return json(resultado.error.payload, resultado.error.status);
    return json(resultado.payload, 201);
  }

  return json({ error: "Rota não encontrada." }, 404);
}
