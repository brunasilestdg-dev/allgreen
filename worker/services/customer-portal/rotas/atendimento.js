// ===== Portal do Cliente: rotas do atendimento =====
//
// Contrato de todo sub-handler de rotas/: recebe o contexto da requisição já
// autenticada e com o escopo resolvido (`escopo` = o cliente da SESSÃO, nunca
// um parâmetro do pedido) e devolve a Response quando o pedido é deste
// recurso, ou null para o próximo sub-handler tentar.
//
// POST /assistente (pergunta à IA com o contexto do próprio cliente) e POST
// /caixa (triagem: responde com a IA ou abre o chamado já classificado). Ambos
// com teto de taxa por sessão e cliente (`excedeuLimite`); abrir chamado exige
// `portal:request:create`.

import { clientCan } from "../../../../src/features/logistics/customerPortalDomain.js";
import {
  RESPOSTA_FORA_DE_ESCOPO,
  foraDoEscopoDoCliente,
} from "../../../../src/features/logistics/customerAssistantDomain.js";
import {
  LIMITE_MENSAGEM,
  triagemAtendimento,
} from "../../../../src/features/logistics/atendimentoAutomatizadoDomain.js";
import { clean, response } from "../../todogreen-client-helpers.js";
import { abrirChamadoAutomatico, gerarRespostaDoAssistente } from "../assistente.js";
import { logPortalEvent } from "../auditoria.js";

export async function rotaDoAtendimento({ request, env, resource, user, escopo, excedeuLimite }) {
  // Assistente. Reusa a IA já configurada no Worker; o que muda é o contexto,
  // montado aqui com o cliente da sessão e mais nada.
  if (request.method === "POST" && resource === "assistente") {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }
    const pergunta = clean(body.pergunta ?? body.question, 2000);
    if (pergunta.length < 2)
      return response({ error: "Escreva a sua pergunta." }, 400);
    // Teto por cliente: o assistente gasta a cota de IA do espaço do dono.
    if (excedeuLimite("assistente", 20))
      return response({ error: "Muitas perguntas em pouco tempo. Aguarde um instante e tente de novo." }, 429);

    // O núcleo (recusa fora de escopo + contexto isolado + cascata de IA) está
    // em `gerarRespostaDoAssistente`, compartilhado com a caixa automatizada.
    // Aqui fica só o formato da resposta e o registro na trilha.
    const r = await gerarRespostaDoAssistente(env, escopo, pergunta);
    if (r.estado === "fora_escopo") {
      await logPortalEvent(env, escopo, user, "assistente_fora_escopo", "", pergunta.slice(0, 120));
      return response({ resposta: RESPOSTA_FORA_DE_ESCOPO, foraDeEscopo: true });
    }
    if (r.estado === "erro_contexto")
      return response({ error: "Não foi possível preparar o assistente." }, 500);
    if (r.estado === "vazio")
      return response({ error: "O assistente não respondeu. Tente de novo." }, 502);
    if (r.estado !== "ok")
      return response({ error: "O assistente está indisponível agora." }, 502);
    await logPortalEvent(env, escopo, user, "assistente_pergunta", "", pergunta.slice(0, 120));
    return response({ resposta: r.resposta, foraDeEscopo: false });
  }

  // ----- Central de atendimento automatizada -----
  //
  // Uma porta só. O cliente escreve em linguagem livre; a triagem (pura) decide
  // o caminho e a caixa OU responde na hora com a IA (mesma cadeia e mesmo
  // isolamento do Assistente) OU abre o chamado já classificado, com prazo,
  // para a equipe. Nada some: quando a IA não dá conta, cai para o chamado;
  // quando falta permissão de abrir chamado, a caixa diz o que fazer em vez de
  // engolir a mensagem. O cliente vem do escopo da sessão, nunca do corpo.
  if (request.method === "POST" && resource === "caixa") {
    if (excedeuLimite("caixa", 15))
      return response({ error: "Muitas mensagens em pouco tempo. Aguarde um instante e tente de novo." }, 429);
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }
    const mensagem = clean(body.mensagem ?? body.pergunta ?? body.texto, LIMITE_MENSAGEM);
    if (mensagem.length < 2) return response({ error: "Escreva a sua mensagem." }, 400);

    // Fora de escopo (outro cliente, concorrente): mesma recusa do Assistente,
    // antes de qualquer roteamento.
    if (foraDoEscopoDoCliente(mensagem)) {
      await logPortalEvent(env, escopo, user, "caixa_fora_escopo", "", mensagem.slice(0, 120));
      return response({ tratamento: "fora_escopo", resposta: RESPOSTA_FORA_DE_ESCOPO, foraDeEscopo: true });
    }

    const triagem = triagemAtendimento(mensagem);
    const podeAbrir = clientCan(escopo, "portal:request:create");

    // Caminho 1: dá para responder na hora, com os dados do próprio cliente.
    if (triagem.autoRespondivel) {
      const r = await gerarRespostaDoAssistente(env, escopo, mensagem);
      if (r.estado === "ok") {
        await logPortalEvent(env, escopo, user, "caixa_resposta_ia", "", mensagem.slice(0, 120));
        return response({ tratamento: "respondido_ia", resposta: r.resposta, triagem });
      }
      // A IA não respondeu: em vez de deixar a mensagem no vácuo, escala — se a
      // pessoa puder abrir chamado. Nada é engolido.
      if (podeAbrir) {
        const id = await abrirChamadoAutomatico(env, escopo, user, { triagem, mensagem });
        return response(
          {
            tratamento: "escalado",
            protocolo: id,
            triagem,
            motivo: "O assistente não conseguiu responder agora; uma pessoa vai assumir.",
          },
          201,
        );
      }
      return response({
        tratamento: "sem_resposta",
        triagem,
        resposta: "Não consegui responder agora. Peça a um gestor da sua conta para abrir uma solicitação.",
      });
    }

    // Caminho 2: escala para uma pessoa (ação da equipe ou assunto sensível).
    if (!podeAbrir)
      return response({
        tratamento: "sem_permissao",
        triagem,
        resposta: "Isso precisa virar uma solicitação para a equipe. Peça a um gestor da sua conta, que tem permissão para abrir.",
      });

    const id = await abrirChamadoAutomatico(env, escopo, user, { triagem, mensagem });
    return response({ tratamento: "escalado", protocolo: id, triagem }, 201);
  }
  return null;
}
