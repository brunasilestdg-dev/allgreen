// ===== Portal do Cliente: rotas das evidências =====
//
// Contrato de todo sub-handler de rotas/: recebe o contexto da requisição já
// autenticada e com o escopo resolvido (`escopo` = o cliente da SESSÃO, nunca
// um parâmetro do pedido) e devolve a Response quando o pedido é deste
// recurso, ou null para o próximo sub-handler tentar.
//
// GET /evidencias (metadados e impressão digital, nunca a URL de origem) e POST
// /evidencias/:id/link (link temporário, trilha). Exigem
// `portal:document:download`; evidência de outro cliente é 404.

import { clientCan, scopedWhere } from "../../../../src/features/logistics/customerPortalDomain.js";
import { response } from "../../todogreen-client-helpers.js";
import { logPortalEvent } from "../auditoria.js";
import { MAX_LIMIT } from "../visao-do-cliente.js";

export async function rotaDasEvidencias({ request, env, resource, documentoPedido, subresource, user, escopo }) {
  // Cofre de evidências: os documentos que sustentam os números do período.
  if (request.method === "GET" && resource === "evidencias") {
    if (!clientCan(escopo, "portal:document:download"))
      return response({ error: "Seu acesso não permite ver documentos." }, 403);
    const { sql, params } = scopedWhere(escopo);
    const linhas = await env.DB.prepare(
      `SELECT id, titulo, tipo, referencia, emitido_em, arquivo_nome, arquivo_bytes, hash_conteudo, created_at
         FROM todogreen_evidences
        WHERE ${sql}
        ORDER BY emitido_em DESC, created_at DESC
        LIMIT ?`,
    )
      .bind(...params, MAX_LIMIT)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    return response({
      evidencias: (linhas.results || []).map((l) => ({
        id: l.id,
        titulo: l.titulo,
        tipo: l.tipo,
        referencia: l.referencia,
        emitidoEm: l.emitido_em,
        arquivoNome: l.arquivo_nome,
        arquivoBytes: l.arquivo_bytes,
        // A impressão digital do conteúdo é o que permite provar depois que o
        // documento não mudou desde a emissão.
        impressaoDigital: l.hash_conteudo,
      })),
    });
  }

  // O link de download. Até aqui a aba listava metadado e a permissão se
  // chamava `portal:document:download` — prometia um arquivo e entregava uma
  // linha de tabela.
  //
  // O link é temporário porque link de documento é credencial: quem tem, abre.
  // Um endereço permanente sobrevive em histórico, em print e em e-mail
  // encaminhado, e continua valendo.
  if (request.method === "POST" && resource === "evidencias" && subresource === "link") {
    if (!clientCan(escopo, "portal:document:download"))
      return response({ error: "Seu acesso não permite baixar documentos." }, 403);
    const { sql, params } = scopedWhere(escopo);
    const doc = await env.DB.prepare(
      `SELECT id, client_id, arquivo_url FROM todogreen_evidences
        WHERE ${sql} AND id = ? LIMIT 1`,
    )
      .bind(...params, documentoPedido)
      .first()
      .catch(() => null);
    // 404 e não 403: o escopo já respondeu que não é dele.
    if (!doc) return response({ error: "Documento não encontrado." }, 404);
    if (!doc.arquivo_url)
      return response(
        { error: "Este documento está catalogado, mas o arquivo ainda não foi anexado pela equipe." },
        409,
      );

    const { emitirConcessao } = await import("../../todogreen-evidences.js");
    const concessao = await emitirConcessao(env, {
      evidenceId: doc.id,
      clientId: doc.client_id,
      ownerId: escopo.workspaceOwnerId,
      para: user?.id || "",
    });
    await logPortalEvent(env, escopo, user, "documento_link_emitido", doc.id, "");
    return response(
      { url: `/api/todogreen/arquivo?t=${concessao.token}`, expiraEm: concessao.expiraEm },
      201,
    );
  }
  return null;
}
