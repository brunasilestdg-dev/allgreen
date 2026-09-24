// ===== Portal do Cliente: API =====
//
// Regra única deste arquivo: o cliente da sessão sai do banco, nunca da
// requisição. Não existe parâmetro `client` em endpoint nenhum daqui. Quem
// tentar passar um é ignorado, porque não há onde ele entrar.
//
// A autenticação, a sessão, os usuários, a auditoria e o banco são os mesmos
// do resto do Seu Funcionário. Isto é outra experiência, não outro sistema.
//
// ----- Fachada -----
//
// Aqui ficou a porta de entrada do portal externo (`handleTodoGreenCustomerPortal`:
// sessão, escopo, limite de taxa e o despacho para o sub-handler de cada
// recurso) e as reexportações que o roteador e os testes já importavam deste
// caminho. O resto mora em `customer-portal/`:
//   sessao.js            quem é a sessão e qual empresa ela alcança
//   visao-do-cliente.js  o que sai para o cliente (whitelist e projeção)
//   visao-geral.js       os indicadores do cliente
//   auditoria.js         a trilha do portal
//   assistente.js        o assistente e o chamado automático da caixa
//   solicitacoes.js      projeção e conversa das solicitações
//   previa.js            a prévia interna do portal
//   rotas/               um sub-handler por recurso
// A API interna de clientes, a carteira comercial e o envio de e-mail moram
// em `todogreen-clients.js`, e a normalização dos campos do CRM em
// `crm-fields.js` — não são portal.

import { allowed as limitarTaxa } from "../lib/http.js";
import { rotaDoAtendimento } from "./customer-portal/rotas/atendimento.js";
import { rotaDasEvidencias } from "./customer-portal/rotas/evidencias.js";
import { rotaDoFinanceiro } from "./customer-portal/rotas/financeiro.js";
import { rotaDoNps } from "./customer-portal/rotas/nps.js";
import { rotaDasOperacoes } from "./customer-portal/rotas/operacoes.js";
import { rotaDoRelatorio } from "./customer-portal/rotas/relatorio.js";
import { rotaDaSessao } from "./customer-portal/rotas/sessao.js";
import { rotaDasSolicitacoes } from "./customer-portal/rotas/solicitacoes.js";
import { rotaDaTrilha } from "./customer-portal/rotas/trilha.js";
import {
  authenticatedUser,
  clientScopeForSession,
  vinculosDaSessao,
} from "./customer-portal/sessao.js";
import { response } from "./todogreen-client-helpers.js";

// Compatibilidade: estes nomes continuam importáveis deste caminho.
export { handleTodoGreenClientPortalPreview } from "./customer-portal/previa.js";
export { handleTodoGreenClientAssignments, handleTodoGreenClients, handleTodoGreenSendEmail } from "./todogreen-clients.js";
export { mergeImportedCrm } from "./crm-fields.js";

// Um sub-handler por recurso, na ordem em que cada recurso aparecia no
// original. Cada um só responde pelo próprio `resource` e devolve null quando
// o pedido não é dele — por isso a ordem entre recursos não muda o casamento,
// e dentro de cada recurso os casos seguem a ordem do original.
const ROTAS_DO_PORTAL = [
  rotaDaSessao,
  rotaDasOperacoes,
  rotaDoFinanceiro,
  rotaDaTrilha,
  rotaDoRelatorio,
  rotaDasEvidencias,
  rotaDoAtendimento,
  rotaDasSolicitacoes,
  rotaDoNps,
];

export async function handleTodoGreenCustomerPortal(request, env) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);

  const url = new URL(request.url);
  const caminho = url.pathname
    .replace(/^\/api\/todogreen\/portal\/?/, "")
    .split("/")
    .filter(Boolean);
  const resource = caminho[0] || "";
  // /portal/evidencias/<id>/link
  const documentoPedido = String(caminho[1] || "").slice(0, 120);
  const subresource = String(caminho[2] || "").slice(0, 40);

  const user = await authenticatedUser(request, env);
  if (!user) return response({ error: "Sessão inválida." }, 401);

  const empresaPedida = url.searchParams.get("empresa") || "";
  const empresas = await vinculosDaSessao(env, user);
  const escopo = await clientScopeForSession(env, user, empresaPedida);
  if (!escopo)
    return response(
      {
        error: empresas.length
          // Mesma resposta para empresa inexistente e para empresa de outra
          // pessoa: distinguir contaria que ela existe.
          ? "Você não tem acesso a esta empresa."
          : "Esta conta não está vinculada a nenhum cliente da To Do Green.",
      },
      403,
    );

  // Limite de taxa por cliente/ação: o portal é superfície EXTERNA e o
  // assistente consome a MESMA cota de IA do espaço da transportadora. Sem teto,
  // um cliente autenticado queima a cota (e o custo) do dono ou infla a fila de
  // solicitações/NPS. É defesa contra rajada, por sessão e por ação.
  const excedeuLimite = (acao, teto) =>
    !limitarTaxa(`portal:${acao}:${user.id}:${escopo.clientId}`, teto);

  const contexto = { request, env, url, resource, documentoPedido, subresource, user, empresas, escopo, excedeuLimite };
  for (const rota of ROTAS_DO_PORTAL) {
    const resposta = await rota(contexto);
    if (resposta) return resposta;
  }

  return response({ error: "Rota do portal não encontrada." }, 404);
}
