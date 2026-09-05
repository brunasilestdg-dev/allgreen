// ===== Portal do Motorista =====
//
// O que existia com esse nome era a tela interna de gestão de frota mostrando
// TODAS as operações do espaço para quem entrasse. Este handler é o portal de
// verdade: resolve QUEM dirige pelo e-mail da sessão (todogreen_drivers.
// user_email, 0070), entrega só AS VIAGENS DELE (driver_id na operação) e
// registra da rua o que fecha o ciclo — chegada, entrega com recebedor/foto/
// GPS (vira o POD do faturamento) e ocorrência.
//
// O papel `motorista` deliberadamente NÃO tem "read": este é o único canto da
// vertical que ele alcança.

import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { aplicarEventoOperacional } from "./todogreen-vertical-records.js";

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

const diasAte = (dataYmd) => {
  if (!dataYmd) return null;
  const alvo = new Date(`${String(dataYmd).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(alvo.getTime())) return null;
  return Math.floor((alvo - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
};

// O motorista da sessão. owner/admin também passam (para testar o portal),
// mas sem vínculo de motorista não há viagem para mostrar.
const motoristaDaSessao = async (env, access, user) => {
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return null;
  return env.DB.prepare(
    `SELECT * FROM todogreen_drivers
      WHERE tenant_id = ? AND workspace_owner_id = ? AND lower(user_email) = ?
        AND archived_at IS NULL
      LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId, email).first();
};

const viagemDaLinha = (row) => ({
  id: row.id,
  referencia: row.reference,
  situacao: row.status,
  dataServico: row.service_date || "",
  origem: row.origin || "",
  destino: row.destination || "",
  prometidoEm: row.promised_at || "",
  entregueEm: row.delivered_at || "",
  placa: row.vehicle_plate || "",
  comprovanteRegistrado: Boolean(row.proof_url),
  ocorrencias: Number(row.incident_count || 0),
});

export async function handleTodoGreenDriverPortal(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  // owner/admin passam pela regra geral; qualquer outro papel precisa de
  // driver:self — que só o papel `motorista` carrega.
  if (!podeNaVertical(access, "driver:self"))
    return json({ error: "Este portal é do motorista. Peça ao gestor o papel 'motorista'." }, 403);

  const url = new URL(request.url);
  const partes = url.pathname.split("/").filter(Boolean); // api, todogreen, driver-portal, [recurso], [id], [acao]
  const recurso = texto(partes[3], 40);
  const id = texto(partes[4], 120);
  const acao = texto(partes[5], 40);

  const motorista = await motoristaDaSessao(env, access, user);

  if (request.method === "GET" && (recurso === "" || recurso === "sessao")) {
    if (!motorista)
      return json({
        vinculado: false,
        aviso: "Seu e-mail ainda não está ligado a um cadastro de motorista. Peça ao gestor para preencher o e-mail de acesso no cadastro (Cadastros → Motoristas).",
      });
    const diasCnh = diasAte(motorista.cnh_expires_at);
    return json({
      vinculado: true,
      motorista: {
        id: motorista.id,
        nome: motorista.full_name,
        cnhCategoria: motorista.cnh_category || "",
        cnhValidade: motorista.cnh_expires_at || "",
        // O aviso vai na sessão porque é o motorista quem precisa agir — e a
        // CNH vencida é o motivo nº 1 de veículo parado em fiscalização.
        cnhAlerta: diasCnh === null ? "" : diasCnh < 0
          ? "Sua CNH está VENCIDA. Regularize antes de dirigir."
          : diasCnh <= 30
            ? `Sua CNH vence em ${diasCnh} dia(s). Agende a renovação.`
            : "",
        // Imagem da CNH que o motorista subiu (fica disponível à operação).
        cnhImagemUrl: motorista.cnh_image_url || "",
        disponibilidade: motorista.availability_status || "",
      },
    });
  }

  // O motorista sobe a foto da CNH e confirma a validade pelo próprio app; a
  // operação passa a ver a imagem e a data (mesmo campo cnh_expires_at do
  // cadastro). Só a própria CNH — o recorte é o vínculo do motorista.
  if (request.method === "POST" && recurso === "cnh") {
    if (!motorista) return json({ error: "Seu e-mail não está ligado a um cadastro de motorista." }, 403);
    const corpo = await request.json().catch(() => ({}));
    const dataUrl = texto(corpo.imagemBase64, 12_000_000);
    const validade = texto(corpo.validade, 10);
    if (!dataUrl && !validade)
      return json({ error: "Envie a foto da CNH ou informe a validade." }, 400);
    let url = motorista.cnh_image_url || "";
    if (dataUrl) {
      try {
        const { armazenarImagemBase64 } = await import("./todogreen-file-store.js");
        const guardado = await armazenarImagemBase64(env, {
          ownerId: access.ownerId,
          contextType: "driver_cnh",
          contextId: motorista.id,
          dataUrl,
          createdBy: user.id,
          prefixoNome: "cnh",
        });
        url = guardado.url;
      } catch (erro) {
        return json({ error: String(erro?.message || "Não consegui guardar a foto da CNH.") }, 400);
      }
    }
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE todogreen_drivers
        SET cnh_image_url = ?, cnh_expires_at = COALESCE(NULLIF(?, ''), cnh_expires_at),
            cnh_self_updated_at = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(url, validade, agora, agora, motorista.id, TENANT_ID, access.ownerId).run();
    return json({ ok: true, cnhImagemUrl: url });
  }

  if (!motorista)
    return json({ error: "Seu e-mail não está ligado a um cadastro de motorista." }, 403);

  if (request.method === "GET" && recurso === "viagens") {
    const { results } = await env.DB.prepare(
      `SELECT * FROM todogreen_client_operations
        WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ? AND archived_at IS NULL
        ORDER BY (delivered_at IS NULL) DESC, service_date DESC, updated_at DESC
        LIMIT 50`,
    ).bind(TENANT_ID, access.ownerId, motorista.id).all();
    return json({ viagens: (results || []).map(viagemDaLinha) });
  }

  if (request.method === "POST" && recurso === "viagens" && id && acao === "evento") {
    const corpo = await request.json().catch(() => ({}));
    // O recorte é o vínculo: a operação precisa ser DESTE motorista. Operação
    // de outro responde 404, não 403 — não se conta o que existe.
    const operacao = await env.DB.prepare(
      `SELECT * FROM todogreen_client_operations
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND driver_id = ?
          AND archived_at IS NULL`,
    ).bind(id, TENANT_ID, access.ownerId, motorista.id).first();
    if (!operacao) return json({ error: "Viagem não encontrada." }, 404);

    const tiposDaRua = new Set(["coleta", "chegada", "entrega", "ocorrencia"]);
    if (!tiposDaRua.has(texto(corpo.tipo, 40)))
      return json({ error: "Da rua se registra coleta, chegada, entrega ou ocorrência." }, 400);

    const resultado = await aplicarEventoOperacional(env, {
      ownerId: access.ownerId,
      operacao,
      userId: user.id,
      corpo: {
        ...corpo,
        titulo: texto(corpo.titulo, 200) || {
          coleta: "Coleta realizada",
          chegada: "Chegada ao destino",
          entrega: "Entrega concluída",
          ocorrencia: "Ocorrência na rota",
        }[texto(corpo.tipo, 40)],
        local: texto(corpo.local, 300),
      },
      origem: url.origin,
    });
    if (resultado.erro) return json({ error: resultado.erro }, 400);
    // Reenvio da fila offline com a mesma chave: devolve o que já ficou (200),
    // não um segundo "criado" (201). Ou seja: a entrega não se perde e não dobra.
    return json(
      { evento: resultado.evento, viagem: viagemDaLinha(resultado.atualizada), duplicada: resultado.duplicada || false },
      resultado.duplicada ? 200 : 201,
    );
  }

  return json({ error: "Rota do portal do motorista não encontrada." }, 404);
}
