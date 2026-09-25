// ===== Portal do Cliente: rotas do financeiro =====
//
// Contrato de todo sub-handler de rotas/: recebe o contexto da requisição já
// autenticada e com o escopo resolvido (`escopo` = o cliente da SESSÃO, nunca
// um parâmetro do pedido) e devolve a Response quando o pedido é deste
// recurso, ou null para o próximo sub-handler tentar.
//
// GET /financeiro (títulos a receber DO cliente) e GET /financeiro/:id/xml (2ª
// via). Exigem `portal:document:download`; nenhum número interno sai daqui.

import { clientCan } from "../../../../src/features/logistics/customerPortalDomain.js";
import { response } from "../../todogreen-client-helpers.js";
import { logPortalEvent } from "../auditoria.js";

export async function rotaDoFinanceiro({ request, env, resource, documentoPedido, subresource, user, escopo }) {
  // Faturas do cliente: títulos a receber DELE, com vencimento, saldo e a
  // 2ª via do documento fiscal quando existir. Nenhum número interno (margem,
  // custo, comissão) passa por aqui — a consulta lê títulos filtrados pelo
  // cliente da sessão, e o valor de face é exatamente o que ele já recebeu na
  // fatura.
  if (request.method === "GET" && resource === "financeiro" && !documentoPedido) {
    if (!clientCan(escopo, "portal:document:download"))
      return response({ error: "Seu papel no portal não vê faturas." }, 403);
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.number, t.issue_date, t.due_date, t.original_amount, t.open_amount, t.status,
              f.id AS fiscal_id, f.doc_type AS fiscal_tipo, f.numero AS fiscal_numero,
              f.chave_acesso AS fiscal_chave, f.status AS fiscal_status,
              CASE WHEN COALESCE(f.xml_content, '') <> '' THEN 1 ELSE 0 END AS xml_disponivel
         FROM todogreen_financial_titles t
         LEFT JOIN todogreen_fiscal_documents f
           ON f.tenant_id = t.tenant_id AND f.workspace_owner_id = t.workspace_owner_id
          AND f.invoice_id = t.invoice_id AND f.invoice_id <> '' AND f.archived_at IS NULL
        WHERE t.tenant_id = ? AND t.workspace_owner_id = ? AND t.client_id = ?
          AND t.kind = 'receivable' AND t.archived_at IS NULL
        ORDER BY t.due_date DESC
        LIMIT 200`,
    ).bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    const titulos = (results || []).map((linha) => ({
      id: linha.id,
      numero: linha.number,
      emitidoEm: linha.issue_date,
      venceEm: linha.due_date,
      valor: linha.original_amount,
      emAberto: linha.open_amount,
      status: linha.status,
      documento: linha.fiscal_id ? {
        tipo: linha.fiscal_tipo,
        numero: linha.fiscal_numero,
        chave: linha.fiscal_chave || "",
        status: linha.fiscal_status,
        xmlDisponivel: linha.xml_disponivel === 1,
      } : null,
    }));
    await logPortalEvent(env, escopo, user, "billing_viewed");
    return response({
      titulos,
      totais: titulos.reduce((soma, titulo) => ({
        emAberto: Math.round((soma.emAberto + (["open", "partial", "overdue"].includes(titulo.status) ? titulo.emAberto : 0)) * 100) / 100,
        quitado: Math.round((soma.quitado + (titulo.status === "settled" ? titulo.valor : 0)) * 100) / 100,
      }), { emAberto: 0, quitado: 0 }),
    });
  }

  // 2ª via do XML do documento fiscal de um título do próprio cliente.
  if (request.method === "GET" && resource === "financeiro" && documentoPedido && subresource === "xml") {
    if (!clientCan(escopo, "portal:document:download"))
      return response({ error: "Seu papel no portal não baixa documentos." }, 403);
    const linha = await env.DB.prepare(
      `SELECT f.xml_content, f.doc_type, f.numero
         FROM todogreen_financial_titles t
         JOIN todogreen_fiscal_documents f
           ON f.tenant_id = t.tenant_id AND f.workspace_owner_id = t.workspace_owner_id
          AND f.invoice_id = t.invoice_id AND f.invoice_id <> '' AND f.archived_at IS NULL
        WHERE t.id = ? AND t.tenant_id = ? AND t.workspace_owner_id = ? AND t.client_id = ?
          AND t.kind = 'receivable' AND t.archived_at IS NULL`,
    ).bind(documentoPedido, escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId).first().catch(() => null);
    if (!linha || !linha.xml_content) return response({ error: "Documento não encontrado." }, 404);
    await logPortalEvent(env, escopo, user, "invoice_xml_downloaded", documentoPedido);
    return new Response(linha.xml_content, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="${linha.doc_type}-${linha.numero || "documento"}.xml"`,
        "cache-control": "no-store",
      },
    });
  }
  return null;
}
