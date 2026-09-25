// ===== Portal do Cliente: rotas das operações =====
//
// Contrato de todo sub-handler de rotas/: recebe o contexto da requisição já
// autenticada e com o escopo resolvido (`escopo` = o cliente da SESSÃO, nunca
// um parâmetro do pedido) e devolve a Response quando o pedido é deste
// recurso, ou null para o próximo sub-handler tentar.
//
// GET /operacoes (lista filtrada e paginada, sem posição viva), GET
// /operacoes/:id (detalhe, linha do tempo, posição só em trânsito e recente) e
// POST /operacoes/:id/comprovante|assinatura (link temporário, trilha). Toda
// leitura passa por `scopedWhere(escopo)` e pela projeção de ../visao-do-cliente.js.

import {
  filtrarOperacoes,
  ocorrenciasDaLinha,
  ordenarLinhaDoTempo,
  paginar,
  previsaoContraCombinado,
  resumirOperacoes,
  slaDaOperacao,
} from "../../../../src/features/logistics/operationTrackingDomain.js";
import { clientCan, scopedWhere } from "../../../../src/features/logistics/customerPortalDomain.js";
import { tiposDaEncomenda } from "../../../../src/features/logistics/clientRequestDomain.js";
import { response } from "../../todogreen-client-helpers.js";
import { logPortalEvent } from "../auditoria.js";
import { linhaParaSolicitacao, tipoParaCliente } from "../solicitacoes.js";
import { MAX_LIMIT, operacaoDoBanco } from "../visao-do-cliente.js";

export async function rotaDasOperacoes({ request, env, url, resource, documentoPedido, subresource, user, escopo }) {
  // A lista de operações. Era referência, status, data, origem e destino, sem
  // busca, filtro, prazo, ocorrência nem paginação — e o cliente entra no
  // portal justamente para acompanhar a carga.
  //
  // Busca, filtro e paginação acontecem no domínio, com o mesmo código que a
  // tela usa: duas implementações da mesma pergunta produzem dois "atrasado"
  // diferentes.
  if (request.method === "GET" && resource === "operacoes" && !documentoPedido) {
    const { sql, params } = scopedWhere(escopo);
    const linhas = await env.DB.prepare(
      `SELECT o.id, o.reference, o.status, o.service_date, o.origin, o.destination,
              o.fields_json, o.created_at, o.promised_at, o.delivered_at, o.eta_at,
              o.vehicle_plate, o.distance_km, o.proof_url, o.proof_hash,
              o.signature_url,
              o.last_position_at, o.last_position_lat, o.last_position_lng,
              (SELECT COUNT(*) FROM todogreen_client_operation_events e
                WHERE e.operation_id = o.id AND e.kind = 'ocorrencia') AS ocorrencias
         FROM todogreen_client_operations o
        WHERE ${sql} AND lower(o.status) != 'rascunho'
        ORDER BY o.service_date DESC, o.created_at DESC
        LIMIT ?`,
    )
      .bind(...params, MAX_LIMIT)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    const todas = (linhas.results || []).map(operacaoDoBanco);
    const filtradas = filtrarOperacoes(todas, {
      busca: url.searchParams.get("busca") || "",
      situacao: url.searchParams.get("situacao") || "",
      de: url.searchParams.get("de") || "",
      ate: url.searchParams.get("ate") || "",
    });
    const pagina = paginar(filtradas, {
      pagina: Number(url.searchParams.get("pagina")) || 1,
      porPagina: Math.min(Number(url.searchParams.get("porPagina")) || 20, 100),
    });

    return response({
      // O SLA vai junto de cada linha: calcular de novo na tela seria uma
      // segunda implementação da mesma pergunta, e duas implementações
      // produzem dois "atrasado" diferentes.
      //
      // A posição viva (last_position) NÃO viaja na lista: a tabela nunca a
      // desenha — ela só aparece no DETALHE, e lá com a janela LGPD de 6h e só
      // em trânsito. Deixá-la em toda linha (inclusive entregue/cancelada)
      // furava essa mesma proteção pela lista. Minimização de dados.
      operacoes: pagina.itens.map((operacao) => {
        const linha = { ...operacao, sla: slaDaOperacao(operacao) };
        delete linha.ultimaPosicao;
        return linha;
      }),
      paginacao: {
        pagina: pagina.pagina,
        paginas: pagina.paginas,
        total: pagina.total,
        primeiro: pagina.primeiro,
        ultimo: pagina.ultimo,
      },
      // O resumo é da seleção filtrada, não da carteira inteira: um filtro que
      // muda a lista e não muda o indicador faz a tela contar duas histórias.
      resumo: (({ lista, ...resto }) => resto)(resumirOperacoes(filtradas)),
    });
  }

  // O detalhe de uma operação: linha do tempo, ocorrências, prazo prometido
  // contra realizado, veículo, última posição e comprovante de entrega.
  if (request.method === "GET" && resource === "operacoes" && documentoPedido) {
    const { sql, params } = scopedWhere(escopo);
    const linha = await env.DB.prepare(
      `SELECT * FROM todogreen_client_operations WHERE ${sql} AND id = ? LIMIT 1`,
    )
      .bind(...params, documentoPedido)
      .first()
      .catch(() => null);
    if (!linha) return response({ error: "Operação não encontrada." }, 404);

    const eventos = await env.DB.prepare(
      `SELECT id, kind, titulo, descricao, local, ocorrido_em, created_at
         FROM todogreen_client_operation_events
        WHERE operation_id = ? AND tenant_id = ? AND client_id = ?
        ORDER BY ocorrido_em ASC
        LIMIT 300`,
    )
      .bind(documentoPedido, escopo.tenantId, escopo.clientId)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    const linhaDoTempo = ordenarLinhaDoTempo(
      (eventos.results || []).map((e) => ({
        id: e.id,
        tipo: e.kind,
        titulo: e.titulo,
        descricao: e.descricao,
        local: e.local,
        ocorridoEm: e.ocorrido_em,
        registradoEm: e.created_at,
      })),
    );

    const operacao = operacaoDoBanco(linha);

    // Rastreio de verdade: sem posição lançada à mão, a última posição vem do
    // TRACKER, casando a placa da operação com o vínculo de rastreamento. O
    // dado já era coletado por veículo e nunca chegava à operação do cliente.
    //
    // LGPD/limite de escopo: a posição do veículo só pode chegar ao embarcador
    // ENQUANTO a operação dele está em trânsito. Depois de entregue/cancelada o
    // caminhão pode estar rodando a rota de OUTRO cliente — mostrar o GPS vivo
    // ali vazaria localização de motorista para fora da operação. Por isso só
    // aplicamos o fallback se a operação não foi entregue nem cancelada e se a
    // posição é recente (janela de 6h); caso contrário fica "sem posição".
    const operacaoEmCurso = !linha.delivered_at && linha.status !== "cancelled";
    const recenteDesde = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    if (!operacao.ultimaPosicao && linha.vehicle_plate && operacaoEmCurso) {
      const rastreada = await env.DB.prepare(
        `SELECT p.latitude, p.longitude, p.recorded_at, p.address
           FROM todogreen_tracker_positions p
           JOIN todogreen_tracker_vehicle_links l ON l.id = p.vehicle_link_id
          WHERE p.workspace_owner_id = ? AND l.active = 1
            AND UPPER(REPLACE(l.plate, '-', '')) = UPPER(REPLACE(?, '-', ''))
            AND p.recorded_at >= ?
          ORDER BY p.recorded_at DESC
          LIMIT 1`,
      ).bind(escopo.workspaceOwnerId, linha.vehicle_plate, recenteDesde).first().catch(() => null);
      if (rastreada) {
        operacao.ultimaPosicao = {
          em: rastreada.recorded_at,
          latitude: rastreada.latitude,
          longitude: rastreada.longitude,
          endereco: rastreada.address || "",
          origem: "rastreador",
        };
      }
    }

    // Solicitações desta encomenda (devolução, alteração de endereço,
    // acareação) e os tipos que cabem na FASE dela. A fase decide o que a tela
    // pode oferecer: entregue → acareação; em trânsito → devolução e endereço.
    const entregueOp = Boolean(linha.delivered_at) || linha.status === "concluida";
    const { sql: sqlSol, params: paramsSol } = scopedWhere(escopo);
    const solicitacoesOp = await env.DB.prepare(
      `SELECT id, type, subject, description, urgency, status, fields_json,
              operation_id, due_at, opened_by, closed_at, created_at, updated_at
         FROM todogreen_client_requests
        WHERE ${sqlSol} AND operation_id = ?
        ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(...paramsSol, linha.id)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    return response({
      operacao,
      sla: slaDaOperacao(operacao),
      previsao: previsaoContraCombinado(operacao),
      linhaDoTempo,
      ocorrencias: ocorrenciasDaLinha(linhaDoTempo),
      // O comprovante sai pelo mesmo link temporário dos documentos: endereço
      // de origem não chega ao navegador do cliente.
      comprovante: linha.proof_url
        ? { disponivel: true, impressaoDigital: linha.proof_hash }
        : { disponivel: false, motivo: "O comprovante ainda não foi anexado a esta entrega." },
      // A assinatura digital sai pelo mesmo link temporário do comprovante.
      assinatura: linha.signature_url
        ? { disponivel: true, impressaoDigital: linha.signature_hash || "" }
        : { disponivel: false, motivo: "A assinatura ainda não foi anexada a esta entrega." },
      solicitacoes: (solicitacoesOp.results || []).map(linhaParaSolicitacao),
      // Só oferece abrir se o acesso permite; a tela some com o formulário no
      // lugar de mostrá-lo e falhar no envio.
      podeAbrirSolicitacao: clientCan(escopo, "portal:request:create"),
      tiposSolicitacao: tiposDaEncomenda(entregueOp).map(tipoParaCliente),
    });
  }

  // O comprovante de entrega sai pelo mesmo mecanismo dos documentos: link
  // temporário, endereço de origem escondido, cada abertura registrada.
  if (request.method === "POST" && resource === "operacoes" && subresource === "comprovante") {
    const { sql, params } = scopedWhere(escopo);
    const linha = await env.DB.prepare(
      `SELECT id, client_id, proof_url FROM todogreen_client_operations
        WHERE ${sql} AND id = ? LIMIT 1`,
    )
      .bind(...params, documentoPedido)
      .first()
      .catch(() => null);
    if (!linha) return response({ error: "Operação não encontrada." }, 404);
    if (!linha.proof_url)
      return response({ error: "O comprovante ainda não foi anexado a esta entrega." }, 409);

    const { emitirConcessaoDeArquivo } = await import("../../todogreen-evidences.js");
    const concessao = await emitirConcessaoDeArquivo(env, {
      url: linha.proof_url,
      clientId: linha.client_id,
      ownerId: escopo.workspaceOwnerId,
      para: user?.id || "",
      nome: `comprovante-${linha.id}`,
    });
    await logPortalEvent(env, escopo, user, "comprovante_link_emitido", linha.id, "");
    return response(
      { url: `/api/todogreen/arquivo?t=${concessao.token}`, expiraEm: concessao.expiraEm },
      201,
    );
  }

  // A assinatura digital da entrega — mesmo mecanismo do comprovante: link
  // temporário, origem escondida, cada abertura registrada.
  if (request.method === "POST" && resource === "operacoes" && subresource === "assinatura") {
    const { sql, params } = scopedWhere(escopo);
    const linha = await env.DB.prepare(
      `SELECT id, client_id, signature_url FROM todogreen_client_operations
        WHERE ${sql} AND id = ? LIMIT 1`,
    )
      .bind(...params, documentoPedido)
      .first()
      .catch(() => null);
    if (!linha) return response({ error: "Operação não encontrada." }, 404);
    if (!linha.signature_url)
      return response({ error: "A assinatura ainda não foi anexada a esta entrega." }, 409);

    const { emitirConcessaoDeArquivo } = await import("../../todogreen-evidences.js");
    const concessao = await emitirConcessaoDeArquivo(env, {
      url: linha.signature_url,
      clientId: linha.client_id,
      ownerId: escopo.workspaceOwnerId,
      para: user?.id || "",
      nome: `assinatura-${linha.id}`,
    });
    await logPortalEvent(env, escopo, user, "assinatura_link_emitido", linha.id, "");
    return response(
      { url: `/api/todogreen/arquivo?t=${concessao.token}`, expiraEm: concessao.expiraEm },
      201,
    );
  }
  return null;
}
