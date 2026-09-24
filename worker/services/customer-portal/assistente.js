// ===== Portal do Cliente: assistente e chamado automático =====
//
// Contrato:
// - `gerarRespostaDoAssistente(env, escopo, pergunta)` devolve
//   { estado: "fora_escopo" | "erro_contexto" | "indisponivel" | "vazio" | "ok", resposta? }.
//   Recusa o que é fora de escopo antes de tudo; o contexto leva SÓ dados do
//   cliente da sessão (`validarContexto` derruba a chamada se um campo interno
//   escapar) e o perfil PÚBLICO do espaço (`dossiePublicoDoEspaco`: sigilo
//   'publico', cortado no SQL); roda a cascata de IA com as chaves do espaço.
// - `abrirChamadoAutomatico(env, escopo, user, { triagem, mensagem })` grava o
//   chamado da caixa no cliente do ESCOPO, com a mensagem como primeira linha
//   da conversa e o registro na trilha; devolve o id.

import { scopedWhere } from "../../../src/features/logistics/customerPortalDomain.js";
import { prazoDaSolicitacao } from "../../../src/features/logistics/clientRequestDomain.js";
import {
  INSTRUCAO_ASSISTENTE,
  foraDoEscopoDoCliente,
  montarContextoDoCliente,
  validarContexto,
} from "../../../src/features/logistics/customerAssistantDomain.js";
import { runWithFallback } from "../ai.js";
import { envComChavesDoEspaco } from "../ai-keys.js";
import { blocoDeContexto as blocoDeContextoDoNegocio } from "../../../src/features/logistics/businessContextDomain.js";
import { parse } from "../todogreen-client-helpers.js";
import { logPortalEvent } from "./auditoria.js";
import { inserirMensagem } from "./solicitacoes.js";
import { camposParaCliente } from "./visao-do-cliente.js";
import { clientOverview } from "./visao-geral.js";

// ===== O perfil público da To Do Green no portal =====
//
// Lê APENAS as linhas com sigilo 'publico'. O corte é no SQL, de propósito: um
// filtro depois da leitura deixaria o dado interno passar por variável de
// aplicação, e basta um `JSON.stringify` distraído para ele acabar num log ou
// num payload. Aqui o que é interno nunca sai do banco.
const dossiePublicoDoEspaco = async (env, workspaceOwnerId) => {
  try {
    const { results } = await env.DB.prepare(
      `SELECT fact_key, category, title, content, source, effective_at, secrecy, pinned
         FROM todogreen_business_context
        WHERE tenant_id='todogreen' AND workspace_owner_id=? AND archived_at IS NULL
          AND secrecy='publico'
        ORDER BY pinned DESC, updated_at DESC LIMIT 60`,
    ).bind(workspaceOwnerId).all();
    return (results || []).map((row) => ({
      chave: row.fact_key,
      categoria: row.category,
      titulo: row.title,
      conteudo: row.content,
      fonte: row.source,
      vigenteEm: row.effective_at,
      sigilo: "publico",
      fixado: Number(row.pinned || 0) === 1,
    }));
  } catch (erro) {
    // Sem perfil o assistente responde só sobre a operação do cliente, como
    // fazia antes. Perder o perfil não pode derrubar o portal.
    console.error("portal: perfil público indisponível", erro?.message || erro);
    return [];
  }
};

// Núcleo do assistente: recusa fora de escopo, monta o contexto só do cliente
// da sessão e roda a MESMA cascata de IA do produto. Devolve um resultado
// discriminado; quem chama decide o formato da resposta e o que registra na
// trilha. Reusado pelo endpoint /assistente e pela caixa automatizada — uma só
// regra de contexto e de recusa, nunca duas versões que divergem.
export async function gerarRespostaDoAssistente(env, escopo, pergunta) {
  if (foraDoEscopoDoCliente(pergunta)) return { estado: "fora_escopo" };

  const resumo = await clientOverview(env, escopo);
  const { sql, params } = scopedWhere(escopo);
  const recentes = await env.DB.prepare(
    `SELECT reference, status, service_date, origin, destination, fields_json
       FROM todogreen_client_operations
      WHERE ${sql}
      ORDER BY service_date DESC LIMIT 20`,
  )
    .bind(...params)
    .all()
    .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

  let contexto;
  try {
    contexto = montarContextoDoCliente({
      cliente: { id: escopo.clientId, nome: escopo.clientName },
      resumo,
      greenScore: resumo.greenScore,
      operacoes: (recentes.results || []).map((linha) => ({
        referencia: linha.reference,
        data: linha.service_date,
        origem: linha.origin,
        destino: linha.destination,
        status: linha.status,
        campos: camposParaCliente(parse(linha.fields_json, {})),
      })),
    });
    // Se algum campo interno escapou para o contexto, a chamada cai aqui em vez
    // de sair pela rede.
    validarContexto(contexto);
  } catch (erro) {
    console.error("contexto do assistente", erro);
    return { estado: "erro_contexto" };
  }

  try {
    const envIa = await envComChavesDoEspaco(env, escopo.workspaceOwnerId);
    // Entra só o que está marcado como PÚBLICO no dossiê da transportadora — o
    // conteúdo que a empresa já publica em apresentação comercial. Interno e
    // restrito não chegam ao modelo, então não há o que a resposta possa vazar.
    const perfilPublico = blocoDeContextoDoNegocio(
      await dossiePublicoDoEspaco(env, escopo.workspaceOwnerId),
      { incluirRestrito: false },
    );
    const { ok, result, errors } = await runWithFallback(envIa, {
      prompt: [
        perfilPublico,
        `Dados do cliente (únicos disponíveis):\n${JSON.stringify(contexto, null, 2)}`,
        `Pergunta: ${pergunta}`,
      ].filter(Boolean).join("\n\n"),
      system: INSTRUCAO_ASSISTENTE,
    });
    if (!ok) {
      console.error("assistente do portal: todos os provedores falharam", errors);
      return { estado: "indisponivel" };
    }
    const texto = String(result?.content || "").trim();
    if (!texto) return { estado: "vazio" };
    return { estado: "ok", resposta: texto };
  } catch (erro) {
    console.error("assistente do portal", erro);
    return { estado: "indisponivel" };
  }
}

// Escalonamento da caixa: a mensagem vira o MESMO chamado que a equipe já trata
// (todogreen_client_requests), já classificado pela triagem e com prazo. A
// validação de campos obrigatórios do formulário NÃO se aplica aqui de
// propósito: a caixa é a porta em que uma pessoa completa o que faltar — o que
// não pode é a mensagem se perder. O cliente do chamado vem do escopo da
// sessão, nunca do corpo.
export async function abrirChamadoAutomatico(env, escopo, user, { triagem, mensagem }) {
  const agora = new Date().toISOString();
  const id = crypto.randomUUID();
  const tipo = triagem.tipo;
  const urgencia = triagem.urgencia;
  const assunto = String(triagem.assunto || "").slice(0, 160) || "Atendimento";
  const campos = {
    // Marca a origem para a fila da equipe saber que veio da caixa automática,
    // e guarda o porquê da triagem para a pessoa não recomeçar do zero.
    origem: "caixa-automatizada",
    triagemMotivo: String(triagem.motivo || "").slice(0, 300),
  };
  await env.DB.prepare(
    `INSERT INTO todogreen_client_requests
       (id, tenant_id, client_id, workspace_owner_id, type, subject, description,
        urgency, status, fields_json, due_at, opened_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      escopo.tenantId,
      escopo.clientId,
      escopo.workspaceOwnerId || "",
      tipo,
      assunto,
      mensagem,
      urgencia,
      JSON.stringify(campos),
      prazoDaSolicitacao(tipo, urgencia, agora),
      escopo.email,
      agora,
      agora,
    )
    .run();
  // A mensagem vira a primeira linha da conversa — a thread não começa no meio.
  await inserirMensagem(env, escopo, id, {
    lado: "cliente",
    email: escopo.email,
    nome: user?.name || escopo.email,
    texto: mensagem,
  });
  await logPortalEvent(env, escopo, user, "caixa_escalada", id, assunto);
  return id;
}
