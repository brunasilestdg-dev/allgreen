// ===== Portal do Cliente: rotas da sessão e do resumo =====
//
// Contrato de todo sub-handler de rotas/: recebe o contexto da requisição já
// autenticada e com o escopo resolvido (`escopo` = o cliente da SESSÃO, nunca
// um parâmetro do pedido) e devolve a Response quando o pedido é deste
// recurso, ou null para o próximo sub-handler tentar.
//
// GET / e /sessao: quem sou eu, papel, permissões, menu e as empresas que a
// sessão alcança (grava `portal_aberto`). GET /resumo: os indicadores.

import { menuForAccess } from "../../../../src/features/logistics/customerPortalDomain.js";
import { response } from "../../todogreen-client-helpers.js";
import { logPortalEvent } from "../auditoria.js";
import { clientOverview } from "../visao-geral.js";

export async function rotaDaSessao({ request, env, resource, user, empresas, escopo }) {
  // Sessão — quem sou eu, o que posso ver, qual é o meu menu.
  if (request.method === "GET" && (resource === "" || resource === "sessao")) {
    await logPortalEvent(env, escopo, user, "portal_aberto");
    return response({
      cliente: { id: escopo.clientId, nome: escopo.clientName },
      papel: escopo.role,
      permissoes: escopo.permissions,
      menu: menuForAccess(escopo),
      usuario: { nome: user.name, email: escopo.email },
      // A lista vai junto na abertura: sem ela o portal não teria como oferecer
      // a troca, e um grupo empresarial ficaria preso na primeira empresa.
      empresas: empresas.map((v) => ({ id: v.clientId, nome: v.clientName, papel: v.role })),
    });
  }

  if (request.method === "GET" && resource === "resumo") {
    return response({ resumo: await clientOverview(env, escopo) });
  }
  return null;
}
